// Scheduled work: price alerts, bundle and giveaway alerts, weekly digests, library snapshots.
// One price lookup per game and region, no matter how many people watch it.

import { summarize } from "./report.js";
import { evaluate, describeTrigger, dealVerdict, meaningfulDrop } from "./alerts.js";
import { protonTier } from "./proton.js";
import { priceInsight } from "./insight.js";
import { isDlc } from "./freemenu.js";
import { voiceGroups, voiceBuyEmbed } from "./gamenight.js";
import { releaseEmbed, alertPayload, bundleEmbed, giveawayEmbed, extrasButtons, digestEmbed, groupEmbed, freeGamesPayload } from "./render.js";
import { isQuiet, digestDue } from "./timeutil.js";
import { viewRows } from "./wishlist.js";
import { libraryView } from "./library.js";

const MAX_EMBEDS = 10; // Discord's limit per message
const MAX_CARDS = 5; // alerts with their own button row: Discord allows 5 rows per message
const EPS = 0.005;
const GROUP_REPING_MS = 14 * 86400_000;

const chunked = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/**
 * Price alerts. Items are only marked as alerted after the message was delivered, so a failed
 * delivery or a quiet-hours deferral is retried on the next run instead of being lost.
 * Returns { checked, alerts, delivered, failed, deferred, priceErrors, groupPosts }.
 */
export async function runCycle({ db, itad, notifier, voiceMap = null, now = () => Date.now(), log = () => {} }) {
    const items = db.activeItems();
    const stats = { checked: items.length, alerts: 0, delivered: 0, failed: 0, deferred: 0, priceErrors: 0, groupPosts: 0 };
    if (!items.length) return stats;

    const byRegion = new Map();
    for (const it of items) {
        if (!byRegion.has(it.region)) byRegion.set(it.region, new Set());
        byRegion.get(it.region).add(it.itad_id);
    }
    const prices = new Map();
    for (const [region, ids] of byRegion) {
        try {
            prices.set(region, await itad.getPrices([...ids], region));
        } catch (err) {
            stats.priceErrors++;
            stats.lastErrorCode = err.code ?? err.name;
            log(`price lookup failed for ${region}: ${err.code ?? err.name}`);
        }
    }

    const perUser = new Map();
    const eligible = [];
    for (const it of items) {
        const entry = prices.get(it.region)?.get(it.itad_id);
        if (entry === undefined) continue;
        const result = evaluate(it, summarize(entry, { majorOnly: it.stores === "major" }));
        if (result.action === "reset") db.clearAlerted(it.id);
        if (result.action !== "alert") continue;
        const hit = { item: it, now: result.now, reason: result.reason };
        eligible.push(hit);
        if (!perUser.has(it.discord_id)) perUser.set(it.discord_id, []);
        perUser.get(it.discord_id).push(hit);
    }

    for (const [userId, list] of perUser) {
        stats.alerts += list.length;
        const user = db.getUser(userId);
        if (!user) continue;
        if (isQuiet(user, now())) { stats.deferred += list.length; continue; }
        for (const part of chunked(list, MAX_CARDS)) {
            // History is fetched only for alerts that are really being sent, and a failure just leaves the note off.
            await Promise.all(part.map(async h => {
                try { h.insight = priceInsight(await itad.getHistory?.(h.item.itad_id, h.item.region ?? "US"), h.now.price, { now: now(), money: n => `${n.toFixed(2)} ${h.now.currency ?? "USD"}` }); }
                catch { h.insight = null; }
                h.proton = await protonTier(h.item.appid).catch(() => null);
            }));
            const payload = alertPayload(part, { trigger: describeTrigger, verdict: dealVerdict, lang: user.lang });
            const res = await notifier.deliver(user, payload, "alert");
            if (res.ok) {
                stats.delivered += part.length;
                for (const a of part) {
                    db.markAlerted(a.item.id, a.now.price);
                    if (a.item.source === "watch") db.removeWatch(userId, a.item.itad_id); // a /watch is one-shot
                    db.logAlert({ discord_id: userId, itad_id: a.item.itad_id, title: a.item.title, kind: "sale", price: a.now.price, regular: a.now.regular, shop: a.now.shop, via: res.via });
                }
            } else {
                stats.failed += part.length;
                log(`delivery failed (${res.reason})`);
            }
        }
    }

    stats.groupPosts = await groupPings({ db, notifier, eligible, now });
    if (voiceMap) {
        try {
            for (const g of voiceGroups({ db, eligible, voiceMap })) {
                const key = `vc:${g.itadId}`, deal = db.getGuildDeal(g.guildId, key);
                if (deal && !(meaningfulDrop(deal.last_price, g.now.price) || now() - deal.at > GROUP_REPING_MS)) continue;
                if (await notifier.postChannel(g.channelId, { embeds: [voiceBuyEmbed(g)] })) { db.setGuildDeal(g.guildId, key, g.now.price); stats.groupPosts++; }
            }
        } catch (err) { log(`voice nudges failed: ${err.name}`); }
    }
    return stats;
}

/** "N members are watching X and it just hit their alert", for servers that turned it on. Counts opted-in members only. */
async function groupPings({ db, notifier, eligible, now }) {
    let posts = 0;
    for (const guild of db.guildsWithGroupPings()) {
        const byGame = new Map();
        for (const h of eligible) {
            if (h.item.share !== 1 || h.item.guild_id !== guild.guild_id) continue;
            if (!byGame.has(h.item.itad_id)) byGame.set(h.item.itad_id, []);
            byGame.get(h.item.itad_id).push(h);
        }
        for (const [itadId, hits] of byGame) {
            if (hits.length < guild.group_min) continue;
            const best = hits.reduce((m, h) => (h.now.price < m.now.price ? h : m));
            const deal = db.getGuildDeal(guild.guild_id, itadId);
            const fresh = !deal || meaningfulDrop(deal.last_price, best.now.price) || now() - deal.at > GROUP_REPING_MS;
            if (!fresh) continue;
            if (await notifier.postGuild(guild.guild_id, { embeds: [groupEmbed(best.item.title, hits.length, best.now)] })) {
                db.setGuildDeal(guild.guild_id, itadId, best.now.price);
                posts++;
            }
        }
    }
    return posts;
}

/** Bundles and giveaways that include a watched game. Each is announced once per member. */
export async function runExtras({ db, itad, notifier, now = () => Date.now(), log = () => {} }) {
    const stats = { found: 0, delivered: 0, failed: 0, deferred: 0 };
    const items = db.activeItems().filter(i => i.bundles);
    if (!items.length) return stats;

    const regions = new Map();
    for (const it of items) {
        if (!regions.has(it.region)) regions.set(it.region, new Set());
        regions.get(it.region).add(it.itad_id);
    }
    const bundlesBy = new Map();
    for (const [region, ids] of regions) {
        try { bundlesBy.set(region, await itad.getBundles([...ids], region)); }
        catch (err) { log(`bundle lookup failed for ${region}: ${err.code ?? err.name}`); stats.error = err.code ?? err.name; }
    }
    let giveaways = new Map();
    try { giveaways = await itad.getGiveaways(); }
    catch (err) { log(`giveaway lookup failed: ${err.code ?? err.name}`); stats.error = err.code ?? err.name; }

    const perUser = new Map();
    for (const it of items) {
        const hits = [];
        for (const b of bundlesBy.get(it.region)?.get(it.itad_id) ?? []) {
            const key = `bundle:${b.id}:${it.itad_id}`;
            if (!db.hasSeen(it.discord_id, key)) hits.push({ kind: "bundle", key, item: it, bundle: b });
        }
        for (const g of giveaways.get(it.itad_id) ?? []) {
            const key = `giveaway:${g.id}:${it.itad_id}`;
            if (!db.hasSeen(it.discord_id, key)) hits.push({ kind: "giveaway", key, item: it, giveaway: g });
        }
        if (hits.length) {
            if (!perUser.has(it.discord_id)) perUser.set(it.discord_id, []);
            perUser.get(it.discord_id).push(...hits);
        }
    }

    for (const [userId, hits] of perUser) {
        stats.found += hits.length;
        const user = db.getUser(userId);
        if (!user) continue;
        if (isQuiet(user, now())) { stats.deferred += hits.length; continue; }
        for (const part of chunked(hits, MAX_CARDS)) {
            const payload = { embeds: part.map(h => (h.kind === "bundle" ? bundleEmbed(h) : giveawayEmbed(h))), components: extrasButtons(part) };
            const res = await notifier.deliver(user, payload, "bundle");
            if (!res.ok) { stats.failed += part.length; continue; }
            stats.delivered += part.length;
            for (const h of part) {
                db.markSeen(userId, h.key);
                db.logAlert({
                    discord_id: userId, itad_id: h.item.itad_id, title: h.item.title, kind: h.kind,
                    price: h.kind === "bundle" ? h.bundle.price : 0, shop: (h.bundle ?? h.giveaway).shop, via: res.via
                });
            }
        }
    }
    return stats;
}

/**
 * Free games on any platform (Steam, Epic, GOG and so on, whatever IsThereAnyDeal lists) for members who turned it on.
 * One message per platform, so several free games from one store are grouped with a "Claim all" button.
 * Each giveaway is announced once per member.
 */
export async function runFreeGames({ db, itad, notifier, now = () => Date.now(), log = () => {} }) {
    const stats = { found: 0, delivered: 0, failed: 0, deferred: 0 };
    const users = db.freeUsers();
    if (!users.length) return stats;
    let list;
    try { list = await itad.getGiveawayList(); }
    catch (err) { log(`free game lookup failed: ${err.code ?? err.name}`); stats.error = err.code ?? err.name; return stats; }

    for (const user of users) {
        const fresh = list.filter(g => g.url && !db.hasSeen(user.discord_id, `free:${g.id}`) && (user.free_dlc !== 0 || !isDlc(g)));
        if (!fresh.length) continue;
        stats.found += fresh.length;
        if (isQuiet(user, now())) { stats.deferred += fresh.length; continue; }
        const byShop = new Map();
        for (const g of fresh) { if (!byShop.has(g.shop)) byShop.set(g.shop, []); byShop.get(g.shop).push(g); }
        for (const [shop, games] of byShop) {
            for (const part of chunked(games, 10)) {
                const payload = freeGamesPayload(shop, part);
                if (!payload) { for (const g of part) db.markSeen(user.discord_id, `free:${g.id}`); continue; }
                const res = await notifier.deliver(user, payload, "free");
                if (!res.ok) { stats.failed += part.length; continue; }
                stats.delivered += part.length;
                for (const g of part) {
                    db.markSeen(user.discord_id, `free:${g.id}`);
                    db.logAlert({ discord_id: user.discord_id, title: g.title, kind: "free", price: 0, shop, via: res.via });
                }
            }
        }
    }
    return stats;
}

/** Weekly digest for members who turned it on. Sent once on their chosen day, from 9:00 local time. */
export async function runDigests({ db, itad, notifier, now = () => Date.now(), log = () => {} }) {
    const stats = { due: 0, sent: 0, skipped: 0, failed: 0 };
    for (const user of db.digestUsers()) {
        if (!digestDue(user, now())) continue;
        stats.due++;
        try {
            const { rows, currency } = await viewRows(db, itad, user);
            const embed = digestEmbed(rows, currency);
            if (!embed) { db.updateUser(user.discord_id, { last_digest_at: now() }); stats.skipped++; continue; }
            const res = await notifier.deliver(user, { embeds: [embed] }, "digest");
            if (res.ok) {
                db.updateUser(user.discord_id, { last_digest_at: now() });
                db.logAlert({ discord_id: user.discord_id, title: "Weekly digest", kind: "digest", via: res.via });
                stats.sent++;
            } else stats.failed++;
        } catch (err) {
            stats.failed++;
            log(`digest failed: ${err.code ?? err.name}`);
        }
    }
    return stats;
}

/** One library snapshot per member per day, for the value-over-time chart. */
export async function runSnapshots({ db, itad, log = () => {} }) {
    let made = 0;
    for (const id of db.usersWithLibrary()) {
        if (db.hasSnapshotToday(id)) continue;
        const user = db.getUser(id);
        if (!user) continue;
        try { await libraryView(db, itad, user); made++; }
        catch (err) { log(`snapshot failed: ${err.code ?? err.name}`); }
    }
    return made;
}

/** Runs `fn` now and then every `everyMs`, never overlapping itself. Returns a stop function. */
export function schedule(fn, everyMs, { onError = () => {}, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval } = {}) {
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try { await fn(); } catch (err) { onError(err); } finally { running = false; }
    };
    const handle = setIntervalImpl(tick, everyMs);
    handle.unref?.();
    tick();
    return () => clearIntervalImpl(handle);
}


/**
 * Servers that turned on the free game feed get new free games posted in their alert channel, once each.
 * Games only (no DLC), so the channel is not flooded; members who want DLC use /freegames.
 */
export async function runGuildFeeds({ db, itad, notifier, log = () => {} }) {
    const stats = { guilds: 0, posted: 0 };
    const guilds = db.guildsWithFreeFeed();
    if (!guilds.length) return stats;
    let list;
    try { list = (await itad.getGiveawayList()).filter(g => g.url && !isDlc(g)); }
    catch (err) { log(`feed lookup failed: ${err.code ?? err.name}`); return stats; }
    for (const guild of guilds) {
        const fresh = list.filter(g => !db.guildHasSeen(guild.guild_id, `free:${g.id}`));
        if (!fresh.length) continue;
        stats.guilds++;
        const byShop = new Map();
        for (const g of fresh) { if (!byShop.has(g.shop)) byShop.set(g.shop, []); byShop.get(g.shop).push(g); }
        for (const [shop, games] of byShop) {
            for (const part of chunked(games, 4)) {
                const payload = freeGamesPayload(shop, part);
                const ok = payload ? await notifier.postGuild(guild.guild_id, payload) : true;
                if (!ok) { log(`feed post failed for a server`); continue; }
                for (const g of part) db.guildMarkSeen(guild.guild_id, `free:${g.id}`);
                stats.posted += part.length;
            }
        }
    }
    return stats;
}


/**
 * Release-day alerts for wishlisted games that were not out yet when they were added. Release dates are looked up in small
 * batches (60 games a run), then each launch is announced once per member, within a week of the date.
 */
export async function runReleases({ db, itad, notifier, now = () => Date.now(), log = () => {} }) {
    const stats = { looked: 0, found: 0, delivered: 0, failed: 0, deferred: 0 };
    for (const g of db.itemsNeedingRelease(60)) {
        try {
            const info = await itad.getTitle(g.itad_id);
            db.setRelease(g.itad_id, info?.release ?? null);
            stats.looked++;
        } catch (err) { log(`release lookup failed: ${err.code ?? err.name}`); stats.error = err.code ?? err.name; break; }
    }
    const due = db.releasedItems().filter(it => !db.hasSeen(it.discord_id, `release:${it.itad_id}`));
    if (!due.length) return stats;
    const byRegion = new Map();
    for (const it of due) { if (!byRegion.has(it.region)) byRegion.set(it.region, new Set()); byRegion.get(it.region).add(it.itad_id); }
    const prices = new Map();
    for (const [region, ids] of byRegion) {
        try { prices.set(region, await itad.getPrices([...ids], region)); } catch { prices.set(region, new Map()); }
    }
    for (const it of due) {
        stats.found++;
        const user = db.getUser(it.discord_id);
        if (!user) continue;
        if (isQuiet(user, now())) { stats.deferred++; continue; }
        const sum = summarize(prices.get(it.region)?.get(it.itad_id), { majorOnly: user.stores === "major" });
        const embed = releaseEmbed({ title: it.title, releaseAt: it.release_at, best: sum.best, currency: sum.currency ?? "USD", url: sum.best?.url });
        const res = await notifier.deliver(user, { embeds: [embed] }, "release");
        if (!res.ok) { stats.failed++; continue; }
        stats.delivered++;
        db.markSeen(it.discord_id, `release:${it.itad_id}`);
        db.logAlert({ discord_id: it.discord_id, itad_id: it.itad_id, title: it.title, kind: "release", price: sum.best?.price ?? null, shop: sum.best?.shop ?? null, via: res.via });
    }
    return stats;
}

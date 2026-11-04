// Scheduled work: price alerts, bundle and giveaway alerts, weekly digests, library snapshots.
// One price lookup per game and region, no matter how many people watch it.

import { summarize } from "./report.js";
import { tasteProfile, matchScore } from "./taste.js";
import { evaluate, describeTrigger, dealVerdict, meaningfulDrop } from "./alerts.js";
import { protonTier } from "./proton.js";
import { steamReviews } from "./reviews.js";
import { priceInsight } from "./insight.js";
import { isDlc } from "./freemenu.js";
import { enrichFree, withOwnership } from "./freeinfo.js";
import { voiceGroups, voiceBuyEmbed } from "./gamenight.js";
import { digestIsDue, buildServerDigest } from "./serverdigest.js";
import { epicSoonPayload, newsPayload } from "./render.js";
import { isPatchNote } from "./news.js";
import { releaseEmbed, releaseDateEmbed, alertPayload, bundleEmbed, giveawayEmbed, extrasButtons, digestEmbed, digestItems, groupEmbed, freeGamesPayload, extrasPayload, lastChancePayload, hotDealsPayload, saleStartPayload } from "./render.js";
import { upcomingSales } from "./salescal.js";
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
        // A member can ask for sales of at least some percent. Starred games always come through, and nothing is marked as sent, so a deeper cut still alerts.
        if (it.min_discount > 0 && !it.priority && (result.now.discount ?? 0) * 100 < it.min_discount - 0.001) continue;
        // Same idea for a price ceiling and for "record lows only".
        if (it.max_price > 0 && !it.priority && (result.now.price ?? 0) > it.max_price + 0.005) continue;
        if (it.lows_only && !it.priority && !(result.now.atl !== null && result.now.price <= result.now.atl + 0.005)) continue;
        const hit = { item: it, now: result.now, reason: result.reason };
        eligible.push(hit);
        if (!perUser.has(it.discord_id)) perUser.set(it.discord_id, []);
        perUser.get(it.discord_id).push(hit);
    }

    for (const [userId, list] of perUser) {
        stats.alerts += list.length;
        const user = db.getUser(userId);
        if (!user) continue;
        // Quiet hours hold back alerts, except for games the member starred as a priority.
        const quiet = isQuiet(user, now());
        const sendable = quiet ? list.filter(h => h.item.priority) : list;
        stats.deferred += list.length - sendable.length;
        if (!sendable.length) continue;
        for (const part of chunked(sendable, MAX_CARDS)) {
            const profile = part.some(h => h.item.appid) ? (() => { try { return tasteProfile(db, userId); } catch { return null; } })() : null;
            // History is fetched only for alerts that are really being sent, and a failure just leaves the note off.
            await Promise.all(part.map(async h => {
                try { h.insight = priceInsight(await itad.getHistory?.(h.item.itad_id, h.item.region ?? "US"), h.now.price, { now: now(), money: n => `${n.toFixed(2)} ${h.now.currency ?? "USD"}` }); }
                catch { h.insight = null; }
                try { h.match = h.item.appid ? matchScore(profile, db.getAppTags([h.item.appid]).get(h.item.appid)) : null; } catch { h.match = null; }
                h.proton = await protonTier(h.item.appid).catch(() => null);
                h.reviews = await steamReviews(h.item.appid).catch(() => null);
            }));
            const payload = alertPayload(part, { trigger: describeTrigger, verdict: dealVerdict, lang: user.lang, pager: db });
            const res = await notifier.deliver(user, payload, "alert");
            if (res.ok) {
                stats.delivered += part.length;
                for (const a of part) {
                    db.markAlerted(a.item.id, a.now.price);
                    if (a.item.source === "watch") db.removeWatch(userId, a.item.itad_id); // a /games watch is one-shot
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
            if (await notifier.postGuild(guild.guild_id, { embeds: [groupEmbed(best.item.title, hits.length, best.now)] }, "deals")) {
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

    // Subscriptions: a wishlist game that joins one, or is about to leave one. A member's first look is quiet (what's already there isn't news).
    const subsBy = new Map();
    for (const [region, ids] of regions) {
        try { if (typeof itad.getSubs === "function") subsBy.set(region, await itad.getSubs([...ids], region)); }
        catch (err) { log(`subscription lookup failed for ${region}: ${err.code ?? err.name}`); stats.error = stats.error ?? (err.code ?? err.name); }
    }
    const subStart = new Set(); // members whose first look happens in this run
    const perUser = new Map();
    for (const it of items) {
        const hits = [];
        const mySubs = subsBy.get(it.region)?.get(it.itad_id);
        if (mySubs) {
            if (!db.hasSeen(it.discord_id, SUBS_MARKER)) subStart.add(it.discord_id);
            for (const s of mySubs) {
                const key = `sub:${s.id}:${it.itad_id}`;
                if (!db.hasSeen(it.discord_id, key)) { if (subStart.has(it.discord_id)) db.markSeen(it.discord_id, key); else hits.push({ kind: "sub", key, item: it, sub: s }); }
                if (s.leaving && s.leaving - now() <= SUB_LEAVING_MS) {
                    const lkey = `subleave:${s.id}:${it.itad_id}:${new Date(s.leaving).toISOString().slice(0, 10)}`;
                    if (!db.hasSeen(it.discord_id, lkey)) hits.push({ kind: "subleave", key: lkey, item: it, sub: s });
                }
            }
        }
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

    for (const id of subStart) db.markSeen(id, SUBS_MARKER);
    for (const [userId, hits] of perUser) {
        stats.found += hits.length;
        const user = db.getUser(userId);
        if (!user) continue;
        if (isQuiet(user, now())) { stats.deferred += hits.length; continue; }
        for (const part of chunked(hits, MAX_CARDS)) {
            const payload = extrasPayload(part, { pager: db });
            const res = await notifier.deliver(user, payload, "bundle");
            if (!res.ok) { stats.failed += part.length; continue; }
            stats.delivered += part.length;
            for (const h of part) {
                db.markSeen(userId, h.key);
                db.logAlert({
                    discord_id: userId, itad_id: h.item.itad_id, title: h.item.title, kind: h.kind,
                    price: h.kind === "bundle" ? h.bundle.price : 0, shop: h.sub ? h.sub.name : (h.bundle ?? h.giveaway).shop, via: res.via
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
const LAST_CHANCE_MS = 24 * 3600_000;
const SUBS_MARKER = "substart";
const SUB_LEAVING_MS = 14 * 86400_000; // "leaving soon" starts two weeks before the game goes
const QUIET_START = [{ prefix: "luna:", marker: "freestart:luna" }]; // Amazon Luna's games are already open when it first shows up

export async function runFreeGames({ db, itad, notifier, now = () => Date.now(), log = () => {}, fetchImpl = globalThis.fetch }) {
    const stats = { found: 0, delivered: 0, failed: 0, deferred: 0 };
    const users = db.freeUsers();
    if (!users.length) return stats;
    let list;
    try { list = await enrichFree(await itad.getGiveawayList(), fetchImpl); }
    catch (err) { log(`free game lookup failed: ${err.code ?? err.name}`); stats.error = err.code ?? err.name; return stats; }

    for (const user of users) {
        // A store the member has never been told about starts quietly: its open offers count as already seen, so only new ones are announced.
        for (const store of QUIET_START) {
            const open = list.filter(g => String(g.id).startsWith(store.prefix));
            if (open.length && !db.hasSeen(user.discord_id, store.marker)) {
                for (const g of open) { db.markSeen(user.discord_id, `free:${g.id}`); db.markSeen(user.discord_id, `freelast:${g.id}`); }
                db.markSeen(user.discord_id, store.marker);
            }
        }
        const mine = withOwnership(list, db, user.discord_id); // the same offers, with whether this member owns each DLC's base game
        // Last chance: a giveaway they were already told about, ending within a day, gets one reminder.
        const soon = mine.filter(g => g.url && g.expiry && g.expiry > now() && g.expiry - now() <= LAST_CHANCE_MS
            && db.hasSeen(user.discord_id, `free:${g.id}`) && !db.hasSeen(user.discord_id, `freelast:${g.id}`) && (user.free_dlc !== 0 || !isDlc(g)));
        if (soon.length && !isQuiet(user, now())) {
            const byShopSoon = new Map();
            for (const g of soon) { if (!byShopSoon.has(g.shop)) byShopSoon.set(g.shop, []); byShopSoon.get(g.shop).push(g); }
            for (const [shop, games] of byShopSoon) {
                for (const part of chunked(games, 10)) {
                    const payload = lastChancePayload(shop, part);
                    if (!payload) { for (const g of part) db.markSeen(user.discord_id, `freelast:${g.id}`); continue; }
                    const res = await notifier.deliver(user, payload, "free");
                    if (!res.ok) { stats.failed += part.length; continue; }
                    stats.reminded = (stats.reminded ?? 0) + part.length;
                    for (const g of part) db.markSeen(user.discord_id, `freelast:${g.id}`);
                }
            }
        }
        const fresh = mine.filter(g => g.url && !db.hasSeen(user.discord_id, `free:${g.id}`) && (user.free_dlc !== 0 || !isDlc(g)));
        if (!fresh.length) continue;
        stats.found += fresh.length;
        if (isQuiet(user, now())) { stats.deferred += fresh.length; continue; }
        const byShop = new Map();
        for (const g of fresh) { if (!byShop.has(g.shop)) byShop.set(g.shop, []); byShop.get(g.shop).push(g); }
        for (const [shop, games] of byShop) {
            for (const part of chunked(games, 10)) {
                const payload = freeGamesPayload(shop, part, { pager: db });
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
            const res = await notifier.deliver(user, { embeds: [embed] }, "digest", { items: digestItems(rows, currency) });
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
 * Games only (no DLC), so the channel is not flooded; members who want DLC use /games freegames.
 */
export async function runGuildFeeds({ db, itad, notifier, log = () => {} }) {
    const stats = { guilds: 0, posted: 0 };
    const guilds = db.guildsWithFreeFeed();
    if (!guilds.length) return stats;
    let list;
    try { list = (await enrichFree(await itad.getGiveawayList())).filter(g => g.url && !isDlc(g)); }
    catch (err) { log(`feed lookup failed: ${err.code ?? err.name}`); return stats; }
    for (const guild of guilds) {
        for (const store of QUIET_START) {
            const open = list.filter(g => String(g.id).startsWith(store.prefix));
            if (open.length && !db.guildHasSeen(guild.guild_id, store.marker)) { for (const g of open) db.guildMarkSeen(guild.guild_id, `free:${g.id}`); db.guildMarkSeen(guild.guild_id, store.marker); }
        }
        const fresh = list.filter(g => !db.guildHasSeen(guild.guild_id, `free:${g.id}`));
        if (!fresh.length) continue;
        stats.guilds++;
        const byShop = new Map();
        for (const g of fresh) { if (!byShop.has(g.shop)) byShop.set(g.shop, []); byShop.get(g.shop).push(g); }
        for (const [shop, games] of byShop) {
            for (const part of chunked(games, 4)) {
                const payload = freeGamesPayload(shop, part, { pager: db });
                const ok = payload ? await notifier.postGuild(guild.guild_id, payload, "free") : true;
                if (!ok) { log(`feed post failed for a server`); continue; }
                for (const g of part) db.guildMarkSeen(guild.guild_id, `free:${g.id}`);
                stats.posted += part.length;
            }
        }
    }
    return stats;
}


/**
 * Servers that turned on hot deals get Steam discounts of at least their minimum percent posted in the alert channel,
 * each deal once. A server's first run posts the best few and marks the rest as seen, so turning it on never floods the channel.
 */
export async function runHotDeals({ db, itad, notifier, log = () => {} }) {
    const stats = { guilds: 0, posted: 0 };
    const guilds = db.guildsWithHot();
    if (!guilds.length) return stats;
    let all;
    try { all = await itad.getHotDeals({ minCut: Math.min(...guilds.map(g => g.hot_min)), limit: 100 }); }
    catch (err) { log(`hot deals lookup failed: ${err.code ?? err.name}`); return stats; }
    const keyOf = d => `hot:${d.id}:${d.since ?? d.price}`;
    for (const guild of guilds) {
        const fresh = all.filter(d => d.cut >= guild.hot_min && !db.guildHasSeen(guild.guild_id, keyOf(d)));
        if (!fresh.length) continue;
        const payload = hotDealsPayload(fresh);
        if (!payload) { for (const d of fresh) db.guildMarkSeen(guild.guild_id, keyOf(d)); continue; }
        if (!(await notifier.postGuild(guild.guild_id, payload, "deals"))) { log("hot deal post failed for a server"); continue; }
        for (const d of fresh) db.guildMarkSeen(guild.guild_id, keyOf(d));
        stats.guilds++; stats.posted += Math.min(6, fresh.length);
    }
    return stats;
}

/** When a Steam sale or festival from the calendar is live, servers that asked get one post for it. */
export async function runSaleStarts({ db, notifier, now = () => Date.now(), log = () => {} }) {
    const stats = { posted: 0 };
    const guilds = db.guildsWithSaleFeed();
    if (!guilds.length) return stats;
    const live = upcomingSales(now(), { limit: 6 }).filter(e => e.live);
    for (const ev of live) {
        const key = `salestart:${ev.name}:${ev.start}`;
        for (const guild of guilds) {
            if (db.guildHasSeen(guild.guild_id, key)) continue;
            if (await notifier.postGuild(guild.guild_id, saleStartPayload(ev), "deals")) { db.guildMarkSeen(guild.guild_id, key); stats.posted++; }
            else log("sale start post failed for a server");
        }
    }
    return stats;
}

/** The Friday server digest, for servers that turned it on. Posted once a week in the alert channel. */
export async function runServerDigests({ db, itad, notifier, now = () => Date.now(), names = () => null, log = () => {} }) {
    const stats = { due: 0, posted: 0, skipped: 0 };
    for (const g of db.guildsWithDigest()) {
        if (!digestIsDue(g.digest_at, now())) continue;
        stats.due++;
        try {
            const embed = await buildServerDigest({ db, itad, guildId: g.guild_id, guildName: names(g.guild_id) ?? "this server", now: now() });
            if (!embed) { db.markGuildDigest(g.guild_id); stats.skipped++; continue; }
            if (await notifier.postGuild(g.guild_id, { embeds: [embed] })) { db.markGuildDigest(g.guild_id); stats.posted++; }
        } catch (err) { log(`server digest failed: ${err.code ?? err.name}`); }
    }
    return stats;
}

/**
 * Release-day alerts for wishlisted games that were not out yet when they were added. Release dates are looked up in small
 * batches (60 games a run), then each launch is announced once per member, within a week of the date.
 */
/**
 * Tells members when a wishlist game gets a release date, or when its date moves by two days or more.
 * What they last saw is kept as "reldate:<game>:<day>" (or ":none"). The first look at a game only remembers its date, so nobody is
 * told about dates that were already known, and a game added today doesn't announce itself.
 */
export async function runReleaseDates({ db, notifier, now = () => Date.now(), stats = {}, log = () => {} }) {
    stats.dates = stats.dates ?? 0;
    const FAR = 500 * 86400_000, MIN_MOVE = 2 * 86400_000;
    for (const it of db.upcomingItems()) {
        const at = it.release_at && it.release_at - now() < FAR ? it.release_at : null;
        const day = at ? new Date(at).toISOString().slice(0, 10) : "none";
        const key = `reldate:${it.itad_id}:${day}`;
        const prior = db.seenWith(it.discord_id, `reldate:${it.itad_id}:`);
        if (prior.includes(key)) continue;
        if (!prior.length || day === "none") { db.markSeen(it.discord_id, key); continue; } // a first look, or a date that went away: say nothing
        const wasDay = prior.map(k => k.split(":").pop()).find(d => d !== "none");
        const was = wasDay ? Date.parse(wasDay) : null;
        if (was && Math.abs(at - was) < MIN_MOVE) { db.markSeen(it.discord_id, key); continue; }
        const user = db.getUser(it.discord_id);
        if (!user) continue;
        if (isQuiet(user, now())) { stats.deferred = (stats.deferred ?? 0) + 1; continue; } // tried again on the next run
        const embed = releaseDateEmbed({ title: it.title, releaseAt: at, was, appid: it.appid ?? null });
        const res = await notifier.deliver(user, { embeds: [embed] }, "release");
        if (!res.ok) { stats.failed = (stats.failed ?? 0) + 1; continue; }
        stats.dates++; stats.delivered = (stats.delivered ?? 0) + 1;
        db.markSeen(it.discord_id, key);
        db.logAlert({ discord_id: it.discord_id, itad_id: it.itad_id, title: it.title, kind: "release", via: res.via });
    }
    return stats;
}

export async function runReleases({ db, itad, notifier, now = () => Date.now(), log = () => {}, stillUpcoming = async () => null }) {
    const stats = { looked: 0, found: 0, delivered: 0, failed: 0, deferred: 0, early: 0 };
    for (const g of db.itemsNeedingRelease(60)) {
        try {
            const info = await itad.getTitle(g.itad_id);
            db.setRelease(g.itad_id, info?.release ?? null);
            stats.looked++;
        } catch (err) { log(`release lookup failed: ${err.code ?? err.name}`); stats.error = err.code ?? err.name; break; }
    }
    await runReleaseDates({ db, notifier, now, stats, log });
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
        // The price site's date can be a day ahead of the store. If Steam still says coming soon, hold the alert for the next run.
        if (Number.isInteger(it.appid) && await stillUpcoming(it.appid) === true) { stats.early++; continue; }
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


/**
 * "Next on Epic": free games that start within the next week, told once to members who turned on free game alerts
 * and posted once in the alert channel of servers that turned on the free game feed.
 */
export async function runEpicSoon({ db, soon, notifier, now = () => Date.now(), log = () => {} }) {
    const stats = { found: 0, delivered: 0, failed: 0, deferred: 0, guilds: 0 };
    let list;
    try { list = await soon.list(); } catch (err) { log(`epic lookup failed: ${err.code ?? err.name}`); return stats; }
    if (!list.length) return stats;
    for (const user of db.freeUsers()) {
        const fresh = list.filter(g => !db.hasSeen(user.discord_id, `epicsoon:${g.id}`));
        if (!fresh.length) continue;
        stats.found += fresh.length;
        if (isQuiet(user, now())) { stats.deferred += fresh.length; continue; }
        const payload = epicSoonPayload(fresh);
        if (!payload) continue;
        const res = await notifier.deliver(user, payload, "free");
        if (!res.ok) { stats.failed += fresh.length; continue; }
        stats.delivered += fresh.length;
        for (const g of fresh.slice(0, 4)) {
            db.markSeen(user.discord_id, `epicsoon:${g.id}`);
            db.logAlert({ discord_id: user.discord_id, title: g.title, kind: "free", price: 0, shop: "Epic Games Store (soon)", via: res.via });
        }
    }
    for (const guild of db.guildsWithFreeFeed()) {
        const fresh = list.filter(g => !db.guildHasSeen(guild.guild_id, `epicsoon:${g.id}`));
        if (!fresh.length) continue;
        const payload = epicSoonPayload(fresh);
        if (!payload || !(await notifier.postGuild(guild.guild_id, payload, "free"))) continue;
        for (const g of fresh.slice(0, 4)) db.guildMarkSeen(guild.guild_id, `epicsoon:${g.id}`);
        stats.guilds++;
    }
    return stats;
}


/**
 * Patch notes and announcements for the games members own or wish for (Steam games only). A member's first look is quiet,
 * posts older than two weeks are never sent, and each post is told once. Members pick "patch notes only" or "everything".
 */
export async function runNews({ db, news, notifier, now = () => Date.now(), log = () => {} }) {
    const stats = { found: 0, delivered: 0, failed: 0, deferred: 0 };
    const users = db.newsUsers();
    if (!users.length) return stats;
    const games = new Map(); // appid -> title, per member
    const mine = new Map(), popularity = new Map();
    for (const u of users) {
        const own = new Map();
        const lib = db.listLibrary(u.discord_id).filter(g => Number.isInteger(g.appid)).sort((a, b) => (b.last_played ?? 0) - (a.last_played ?? 0) || (b.minutes ?? 0) - (a.minutes ?? 0)).slice(0, 40);
        for (const g of lib) own.set(g.appid, g.title);
        for (const it of db.listItems(u.discord_id).filter(i => Number.isInteger(i.appid)).slice(0, 30)) own.set(it.appid, it.title);
        mine.set(u.discord_id, own);
        for (const [id, t] of own) { games.set(id, t); popularity.set(id, (popularity.get(id) ?? 0) + 1); }
    }
    const wanted = [...popularity].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    let feed;
    try { feed = await news.forApps(wanted); } catch (err) { log(`news lookup failed: ${err.code ?? err.name}`); return stats; }
    const recent = now() - 14 * 86400_000;
    for (const user of users) {
        const first = !db.hasSeen(user.discord_id, "newsstart");
        const hits = [];
        for (const [appid, title] of mine.get(user.discord_id) ?? []) {
            for (const p of feed.get(appid) ?? []) {
                if (p.date < recent || db.hasSeen(user.discord_id, `news:${p.gid}`)) continue;
                if (first) { db.markSeen(user.discord_id, `news:${p.gid}`); continue; }
                if (user.news === 1 && !p.patch) continue;
                hits.push({ ...p, gameTitle: title });
            }
        }
        if (first) db.markSeen(user.discord_id, "newsstart");
        if (!hits.length) continue;
        hits.sort((a, b) => b.date - a.date);
        stats.found += hits.length;
        if (isQuiet(user, now())) { stats.deferred += hits.length; continue; }
        const part = hits.slice(0, 8);
        const payload = newsPayload(part, { pager: db });
        if (!payload) continue;
        const res = await notifier.deliver(user, payload, "news");
        if (!res.ok) { stats.failed += part.length; continue; }
        stats.delivered += part.length;
        for (const p of part) db.markSeen(user.discord_id, `news:${p.gid}`);
        db.logAlert({ discord_id: user.discord_id, title: `${part[0].gameTitle}${part.length > 1 ? ` +${part.length - 1} more` : ""}`, kind: "news", price: 0, shop: "Steam news", via: res.via });
    }
    return stats;
}

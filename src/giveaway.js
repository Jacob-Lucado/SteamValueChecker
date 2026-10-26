// Giveaway logic with no Discord or HTTP code in it. Discord is passed in as `discord`:
//   post(channelId, payload) -> { id }     edit(channelId, messageId, payload)     dm(userId, payload) throws on failure
//   memberOk(guildId, userId) -> boolean (false only when the person has left)    findChannelByName(guildId, name) -> id | null
// Prize keys are encrypted by the vault and wiped when the winner confirms, the giveaway is cancelled, or they go unused for too long.

import { randomInt } from "node:crypto";
import { UserError } from "./errors.js";
import { MAX_ACTIVE_GIVEAWAYS } from "./gwstore.js";
import { cleanText, clampInt } from "./gwparse.js";
import { giveawayPayload, winnersPayload, keyMessage, confirmPayload, vouchPayload, leftoverMessage, hostNote } from "./gwrender.js";

const CONFIRM_FIRST_MS = 10 * 60_000;
const CONFIRM_REMINDER_MS = 24 * 3600_000;
const MAX_REDRAWS = 3;

const closed = g => g.status !== "active";

/** The prize artwork Steam publishes for an app id. */
export const steamHeader = appid => `https://cdn.akamai.steamstatic.com/steam/apps/${encodeURIComponent(appid)}/header.jpg`;

const artCache = new Map(); // game name -> { at, art }
const ART_TTL_MS = 6 * 3600_000;

/** Fast path: Steam's own store search (one request, no API key, no shared rate limit). Returns an app id or null. */
async function steamSearch(title, fetchFn) {
    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&l=english&cc=us`;
    const res = await fetchFn(url, { signal: AbortSignal.timeout(4000), headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const items = (await res.json())?.items ?? [];
    const norm = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, "");
    const want = norm(title);
    const hit = items.find(i => i?.type === "app" && norm(i.name) === want) ?? items.find(i => i?.type === "app");
    return hit?.id ?? null;
}

/**
 * Picks box art for a game when the host did not provide an image: Steam's store search first (fast), IsThereAnyDeal as the
 * fallback. Results are cached for a few hours so repeat looks, including the dashboard's live preview, cost nothing.
 * Returns { image, thumbnail } or null.
 */
export async function autoImage(itad, gameTitle, { fetchFn = globalThis.fetch, nowFn = Date.now } = {}) {
    const title = String(gameTitle ?? "").trim().slice(0, 100);
    if (!title) return null;
    const key = title.toLowerCase();
    const hit = artCache.get(key);
    if (hit && nowFn() - hit.at < ART_TTL_MS) return hit.art;
    let art = null;
    try { const appid = fetchFn ? await steamSearch(title, fetchFn) : null; if (appid) art = { image: steamHeader(appid), thumbnail: null }; } catch { /* fall through */ }
    if (!art && itad) {
        try {
            const [found] = await itad.lookupTitles([title]);
            if (found?.id) {
                const info = await itad.getTitle(found.id);
                if (info?.appid) art = { image: steamHeader(info.appid), thumbnail: null };
                else if (info?.image && /^https:\/\//i.test(info.image)) art = { image: info.image, thumbnail: null };
            }
        } catch { /* artwork is optional */ }
    }
    if (artCache.size > 500) artCache.clear();
    if (art) artCache.set(key, { at: nowFn(), art }); // misses are not cached, so a later try can still succeed
    return art;
}

/** A title made from the prize names when the host did not type one. */
export function titleFromKeys(keys) {
    const labels = [...new Set(keys.map(k => k.label).filter(Boolean))];
    if (!labels.length) return "Giveaway";
    return (labels.length === 1 ? labels[0] : `${labels[0]} + ${labels.length - 1} more`).slice(0, 100);
}

/** Weighted random pick without replacement. pool: [{ id, w }]. */
function pickOne(pool, rand) {
    const total = pool.reduce((t, p) => t + p.w, 0);
    let n = rand(total);
    for (let i = 0; i < pool.length; i++) { n -= pool[i].w; if (n < 0) return pool.splice(i, 1)[0]; }
    return pool.pop();
}

export function createGiveawayService({ db, vault, discord, itad = null, now = () => Date.now(), rand = max => randomInt(max), log = () => {} }) {
    const must = id => {
        const g = db.getGiveaway(Number(id));
        if (!g) throw new UserError("I can't find that giveaway.");
        return g;
    };
    const entryCount = id => db.countEntries(id);

    /** Re-draws the giveaway post and the winners post from the database. Failures (deleted message and so on) are ignored. */
    async function refresh(id) {
        const g = db.getGiveaway(id);
        if (!g) return;
        const keys = db.listKeys(id);
        if (g.message_id) {
            try { await discord.edit(g.channel_id, g.message_id, giveawayPayload(g, keys, entryCount(id), g.status)); } catch (e) { log(`giveaway edit failed: ${e?.name ?? "error"}`); }
        }
        if (g.announce_id) {
            try { await discord.edit(g.channel_id, g.announce_id, winnersPayload(g, keys)); } catch (e) { log(`winners edit failed: ${e?.name ?? "error"}`); }
        }
    }

    // ---------- create ----------
    async function create(input) {
        if (!input.keys?.length) throw new UserError("Add at least one prize key.");
        const title = cleanText(input.title, 100) ?? titleFromKeys(input.keys);
        if (db.countActiveGiveaways(input.guild_id) >= MAX_ACTIVE_GIVEAWAYS) throw new UserError(`This server already has ${MAX_ACTIVE_GIVEAWAYS} running giveaways. End one first.`);

        let image = input.image_url ?? null, thumbnail = input.thumbnail_url ?? null, imageSource = image ? "custom" : "none";
        if (!image && input.auto_image !== false) {
            const art = await autoImage(itad, cleanText(input.game_title, 100) ?? input.keys[0].label);
            if (art) { image = art.image; thumbnail = thumbnail ?? art.thumbnail; imageSource = "auto"; }
        }
        const g = {
            guild_id: input.guild_id, channel_id: input.channel_id, host_id: input.host_id, title,
            description: cleanText(input.description, 1500), game_title: cleanText(input.game_title, 100),
            image_url: image, thumbnail_url: thumbnail, color: input.color ?? null, button_label: cleanText(input.button_label, 40),
            ping_role_id: input.ping_role_id ?? null, require_role_id: input.require_role_id ?? null, bonus_role_id: input.bonus_role_id ?? null,
            bonus_entries: clampInt(input.bonus_entries, 1, 10, 1), min_account_days: clampInt(input.min_account_days, 0, 3650, 0),
            min_member_days: clampInt(input.min_member_days, 0, 3650, 0), claim_hours: clampInt(input.claim_hours, 1, 168, 48),
            vouch_channel_id: input.vouch_channel_id ?? null, ends_at: now() + input.duration_ms
        };
        const id = db.createGiveaway(g, input.keys.map(k => ({ label: k.label, enc: vault.encrypt(k.key) })));
        try {
            const row = db.getGiveaway(id);
            const msg = await discord.post(g.channel_id, giveawayPayload(row, db.listKeys(id), 0, "active"));
            db.setGiveawayMessage(id, msg.id);
        } catch {
            db.deleteGiveaway(id); // nothing was announced, so no keys are kept
            throw new UserError("I could not post in that channel. Give the bot View Channel, Send Messages and Embed Links there, then try again.");
        }
        return { id, ends_at: g.ends_at, prizes: input.keys.length, imageSource };
    }

    // ---------- enter ----------
    /** who: { userId, roleIds, joinedAt, createdAt }. Pressing the button again leaves the giveaway. */
    async function enter(id, who) {
        const g = must(id);
        if (closed(g) || g.ends_at <= now()) throw new UserError("This giveaway has ended.");
        if (who.userId === g.host_id) throw new UserError("You are hosting this giveaway, so you can't enter it.");
        if (db.getEntry(g.id, who.userId)) {
            db.removeEntry(g.id, who.userId);
            return { status: "left", total: entryCount(g.id) };
        }
        if (g.require_role_id && !(who.roleIds ?? []).includes(g.require_role_id)) throw new UserError(`You need the <@&${g.require_role_id}> role to enter.`);
        if (g.min_account_days && who.createdAt && (now() - who.createdAt) / 86400_000 < g.min_account_days) throw new UserError(`Your Discord account must be at least ${g.min_account_days} days old to enter.`);
        if (g.min_member_days && who.joinedAt && (now() - who.joinedAt) / 86400_000 < g.min_member_days) throw new UserError(`You need to have been in this server for at least ${g.min_member_days} days to enter.`);
        const entries = g.bonus_role_id && (who.roleIds ?? []).includes(g.bonus_role_id) ? g.bonus_entries : 1;
        db.addEntry(g.id, who.userId, entries);
        return { status: "entered", entries, total: entryCount(g.id) };
    }

    // ---------- drawing ----------
    /** Picks a winner for one prize. Skips people who left, anyone already holding a prize, and anyone who forfeited this giveaway. */
    async function drawOne(g, keyId, taken) {
        const out = new Set([...taken, ...db.excludedFor(keyId)]);
        const pool = db.listEntries(g.id).filter(e => !out.has(e.discord_id)).map(e => ({ id: e.discord_id, w: e.entries }));
        while (pool.length) {
            const p = pickOne(pool, rand);
            if (await discord.memberOk(g.guild_id, p.id) !== false) return p.id;
        }
        return null;
    }

    const claimDeadline = g => now() + g.claim_hours * 3600_000;
    const holders = id => new Set(db.listKeys(id).filter(k => k.winner_id && ["assigned", "delivered", "problem", "confirmed"].includes(k.status)).map(k => k.winner_id));

    async function dmHost(g, payload) {
        if (!g.host_id || g.host_id === "deleted") return false;
        try { await discord.dm(g.host_id, payload); return true; } catch { return false; }
    }

    /** Sends unused prizes back to the host and deletes the bot's copy. If the DM fails the keys are kept for 7 days. */
    async function returnUnused(g, statuses, why) {
        const rows = db.listKeys(g.id).filter(k => statuses.includes(k.status) && k.has_key);
        if (!rows.length) return 0;
        const plain = rows.map(k => ({ label: k.label, plain: vault.decrypt(db.getKeyEnc(k.id)), id: k.id })).filter(r => r.plain);
        if (!plain.length) return 0;
        if (!await dmHost(g, leftoverMessage(g, plain, why))) return 0;
        for (const r of plain) db.wipeKey(r.id, "returned");
        return plain.length;
    }

    async function announceNew(g, text, extra = {}) {
        try { await discord.post(g.channel_id, { content: text, allowedMentions: { users: extra.users ?? [] }, components: extra.components }); } catch { /* the channel may be gone */ }
    }

    /** Ends a giveaway: draws one winner per prize, posts the winners, and tells the host. */
    async function end(id, { by = null } = {}) {
        let g = must(id);
        if (closed(g)) throw new UserError("That giveaway is already over.");
        db.setGiveawayStatus(g.id, "ended");
        g = db.getGiveaway(g.id);

        const taken = new Set();
        const won = [];
        for (const k of db.listKeys(g.id)) {
            const winner = await drawOne(g, k.id, taken);
            if (!winner) continue;
            taken.add(winner);
            db.assignKey(k.id, winner, claimDeadline(g));
            won.push({ keyId: k.id, label: k.label, userId: winner });
        }
        const keys = db.listKeys(g.id);
        if (g.message_id) { try { await discord.edit(g.channel_id, g.message_id, giveawayPayload(g, keys, entryCount(g.id), "ended")); } catch { /* ignore */ } }
        if (won.length) {
            try {
                const m = await discord.post(g.channel_id, winnersPayload(g, keys));
                db.setAnnounceMessage(g.id, m.id);
            } catch (e) { log(`winners post failed: ${e?.name ?? "error"}`); }
        } else {
            await announceNew(g, `**${g.title}** ended with no valid entries.`);
        }
        const unused = await returnUnused(g, ["available"], won.length ? "Fewer people entered than there were prizes, so these prizes had no winner." : "Nobody entered.");
        await dmHost(g, hostNote(g, `Ended${by ? "" : " on schedule"}: ${won.length} of ${keys.length} prizes have a winner (${entryCount(g.id)} entries).` +
            (unused ? `\n${unused} unused prize key${unused === 1 ? " was" : "s were"} sent to you in a separate message.` : "") +
            (won.length ? `\nWinners have ${g.claim_hours} hours to press **Claim key**.` : "")));
        return { winners: won, unused };
    }

    /** Draws again. With a user: that person's prize is taken from them. Without: any prize that has no winner yet. */
    async function reroll(id, { userId = null } = {}) {
        const g = must(id);
        if (g.status !== "ended") throw new UserError("You can only reroll a giveaway that has ended.");
        let targets;
        if (userId) {
            const k = db.keyForWinner(g.id, userId);
            if (!k) throw new UserError("That person did not win a prize in this giveaway.");
            if (k.status === "confirmed") throw new UserError("That winner already redeemed their prize.");
            for (const key of db.listKeys(g.id)) db.excludeFor(key.id, userId);
            db.releaseKey(k.id);
            targets = [k];
        } else {
            targets = db.listKeys(g.id).filter(k => k.status === "available" && k.has_key);
            if (!targets.length) throw new UserError("Every prize already has a winner.");
        }
        const taken = holders(g.id);
        const won = [];
        for (const k of targets) {
            const winner = await drawOne(g, k.id, taken);
            if (!winner) continue;
            taken.add(winner);
            db.assignKey(k.id, winner, claimDeadline(g));
            won.push({ keyId: k.id, label: k.label, userId: winner });
        }
        if (!won.length) throw new UserError("There is nobody else left to draw.");
        await postReplacement(g, won, userId);
        return { winners: won };
    }

    async function postReplacement(g, won, previous) {
        await refresh(g.id);
        const lines = won.map(w => `**${w.label}** → <@${w.userId}>`).join("\n");
        await announceNew(g, `🎉 New winner${won.length > 1 ? "s" : ""} for **${g.title}**${previous ? ` (<@${previous}> did not claim)` : ""}:\n${lines}\nPress **Claim key** on the winners message above within ${g.claim_hours} hours.`, { users: won.map(w => w.userId) });
    }

    // ---------- cancel ----------
    async function cancel(id) {
        const g = must(id);
        if (closed(g)) throw new UserError("That giveaway is already over.");
        db.setGiveawayStatus(g.id, "cancelled");
        const unused = await returnUnused(g, ["available", "assigned"], "The giveaway was cancelled.");
        await refresh(g.id);
        return { unused };
    }

    // ---------- claim, deliver, confirm ----------
    /** Checks that this person won and returns the prize to hand over. Throws UserError with a friendly reason otherwise. */
    function prepareClaim(id, userId) {
        const g = must(id);
        const k = db.keyForWinner(g.id, userId);
        if (!k) throw new UserError("You are not a winner of this giveaway.");
        if (k.status === "confirmed") throw new UserError("You already confirmed this prize. For safety the bot has deleted the key.");
        if (k.status === "problem") throw new UserError("You reported a problem with this key. The host has been told and will send a new one.");
        if (!["assigned", "delivered"].includes(k.status) || !k.has_key) throw new UserError("This prize is no longer available. Contact the host.");
        const plain = vault.decrypt(db.getKeyEnc(k.id));
        if (!plain) throw new UserError("I can't read that key any more. Please contact the host.");
        return { giveaway: g, key: k, plain };
    }

    /** Call after the key reached the winner. `via` is "dm" or "channel". Schedules the "did it work?" follow-up. */
    async function delivered(keyId, via) {
        db.markDelivered(keyId, via, now() + CONFIRM_FIRST_MS);
        const k = db.getKey(keyId);
        await refresh(k.giveaway_id);
    }

    /** The winner says the key worked. Wipes the key and posts to the vouches channel. */
    async function confirm(keyId, userId) {
        const k = db.getKey(Number(keyId));
        if (!k || k.winner_id !== userId) throw new UserError("This confirmation is not for you.");
        if (k.status === "confirmed") throw new UserError("You already confirmed this one. Thank you!");
        if (!["delivered", "problem"].includes(k.status)) throw new UserError("Press **Claim key** on the winners message first, then confirm once you have redeemed it.");
        const g = must(k.giveaway_id);
        db.markConfirmed(k.id);
        await refresh(g.id);
        const channelId = g.vouch_channel_id || db.getGiveawaySettings(g.guild_id).vouch_channel_id || await discord.findChannelByName(g.guild_id, "vouches");
        let vouched = false;
        if (channelId) { try { await discord.post(channelId, vouchPayload(g, k, userId)); vouched = true; } catch { /* no access to the channel */ } }
        await dmHost(g, hostNote(g, `<@${userId}> confirmed that **${k.label}** redeemed successfully.${vouched ? "" : "\nI could not post it in a vouches channel. Set one with `/giveaway setup`."}`));
        return { vouched };
    }

    /** The winner says the key did not work. The host is told and can send a replacement. */
    async function reportProblem(keyId, userId) {
        const k = db.getKey(Number(keyId));
        if (!k || k.winner_id !== userId) throw new UserError("This is not for you.");
        if (k.status !== "delivered") throw new UserError("There is nothing to report yet. Press **Claim key** first.");
        const g = must(k.giveaway_id);
        db.markProblem(k.id);
        await refresh(g.id);
        const told = await dmHost(g, hostNote(g, `<@${userId}> says the key for **${k.label}** did not work.\nSend a new one with the replace command: choose giveaway #${g.id} and the winner.`));
        return { hostTold: told };
    }

    /** Host swaps in a new key for a winner. The winner is told to press Claim key again. */
    async function replaceKey(id, userId, newKey) {
        const g = must(id);
        const k = db.keyForWinner(g.id, userId);
        if (!k) throw new UserError("That person did not win a prize in this giveaway.");
        if (k.status === "confirmed") throw new UserError("That winner already redeemed their prize.");
        const clean = String(newKey ?? "").trim();
        if (!clean || /\s/.test(clean) || clean.length > 200) throw new UserError("Send a single key with no spaces.");
        db.replaceKeyEnc(k.id, vault.encrypt(clean), claimDeadline(g));
        await refresh(g.id);
        let told = true;
        try { await discord.dm(userId, hostNote(g, `The host replaced your key for **${k.label}**. Press **Claim key** on the winners message to get it.`)); } catch { told = false; }
        if (!told) await announceNew(g, `<@${userId}> your key for **${k.label}** was replaced. Press **Claim key** on the winners message.`, { users: [userId] });
        return { told };
    }

    // ---------- scheduled work ----------
    async function forfeit(k) {
        const g = db.getGiveaway(k.giveaway_id);
        if (!g) return;
        const previous = k.winner_id;
        for (const key of db.listKeys(g.id)) db.excludeFor(key.id, previous);
        db.bumpRedraw(k.id);
        db.releaseKey(k.id);
        if (k.redraws + 1 >= MAX_REDRAWS) {
            await refresh(g.id);
            return;
        }
        const winner = await drawOne(g, k.id, holders(g.id));
        if (!winner) { await refresh(g.id); return; }
        db.assignKey(k.id, winner, claimDeadline(g));
        await postReplacement(g, [{ keyId: k.id, label: k.label, userId: winner }], previous);
    }

    async function sendPrompt(k) {
        const g = db.getGiveaway(k.giveaway_id);
        if (!g) return;
        const payload = confirmPayload(g, k, { reminder: k.prompts > 0 });
        try { await discord.dm(k.winner_id, payload); }
        catch {
            // DMs are closed: ask in the giveaway channel instead. Only the winner can use the buttons.
            try { await discord.post(g.channel_id, { ...payload, content: `<@${k.winner_id}> please confirm your prize.`, allowedMentions: { users: [k.winner_id] } }); } catch { /* channel gone */ }
        }
        db.setConfirmAt(k.id, k.prompts === 0 ? now() + CONFIRM_REMINDER_MS : null, k.prompts + 1);
    }

    /** Run about once a minute. */
    async function tick() {
        const done = { ended: 0, forfeited: 0, prompts: 0, purged: 0 };
        for (const g of db.dueGiveaways(now())) {
            try { await end(g.id); done.ended++; } catch (e) { log(`giveaway end failed: ${e?.name ?? "error"}`); }
        }
        for (const k of db.expiredClaims(now())) {
            try { await forfeit(k); done.forfeited++; } catch (e) { log(`forfeit failed: ${e?.name ?? "error"}`); }
        }
        for (const k of db.duePrompts(now())) {
            try { await sendPrompt(k); done.prompts++; } catch (e) { log(`prompt failed: ${e?.name ?? "error"}`); }
        }
        done.purged = db.purgeKeys() + db.purgeGiveaways();
        return done;
    }

    return { create, enter, end, reroll, cancel, prepareClaim, delivered, confirm, reportProblem, replaceKey, tick, refresh };
}

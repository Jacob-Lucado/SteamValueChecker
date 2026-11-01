// Game code posts: the embed, the poll that posts each code once per server, and the edit that marks a code as ended.
import { fetchShiftCodes, gameByKey, gameArt, SHIFT_GAMES, SHIFT_REDEEM_URL } from "./codesource.js";

const sleepDefault = ms => new Promise(r => setTimeout(r, ms));
const ORANGE = 0xff9800, GREY = 0x6b7280;
const MAX_PER_RUN = 8;     // posts per server per poll, so a server that was offline for a week is not flooded
const FIRST_RUN_POSTS = 3; // a server that has never had a code only gets the newest few; the rest are marked as seen

export const codeGames = () => SHIFT_GAMES.map(g => ({ key: g.key, title: g.title }));

const unix = ms => Math.floor(ms / 1000);

/** What the dashboard and the /codes command show for one stored code. */
export function codeView(c, at = Date.now()) {
    const game = gameByKey(c.game);
    return { id: c.id, code: c.code, game: c.game, gameTitle: game?.title ?? c.game, art: gameArt(game), platform: c.platform, reward: c.reward, note: c.note,
        expiresAt: c.expires_at ?? null, status: c.status === "active" && c.expires_at && c.expires_at < at ? "expired" : c.status, firstSeen: c.first_seen, sourceUrl: c.source_url, redeemUrl: SHIFT_REDEEM_URL };
}

/** The post for one code. `expired` greys it out, strikes the code through and drops the buttons. */
export function codeEmbed(c, { expired = false } = {}) {
    const game = gameByKey(c.game);
    const ends = c.expires_at ? `<t:${unix(c.expires_at)}:D> (<t:${unix(c.expires_at)}:R>)` : "No end date listed";
    const fields = [
        { name: "Reward", value: c.reward || "Unknown", inline: true },
        { name: "Platform", value: c.platform || "All platforms", inline: true },
        { name: expired ? "Ended" : "Expires", value: expired && !c.expires_at ? "Reported as expired" : ends, inline: true }
    ];
    if (c.note) fields.push({ name: "Heads up", value: `${c.note}. This one may only work on that region's account.`.slice(0, 300), inline: false });
    const embed = {
        color: expired ? GREY : ORANGE,
        author: { name: `${game?.title ?? "Game"} · SHiFT code` },
        title: expired ? `Expired: ${c.reward || "code"}` : (c.reward || "New code"),
        description: expired ? `~~${c.code}~~\nThis code has ended.` : `\`\`\`\n${c.code}\n\`\`\`Copy it, then redeem it on the SHiFT site while signed in to the account linked to your game.`,
        fields,
        image: game ? { url: gameArt(game) } : undefined,
        footer: { text: expired ? "Steam Value Checker · code ended" : "Codes from mentalmars.com · they can run out before the listed date" }
    };
    const buttons = [{ type: 2, style: 5, label: "Redeem on SHiFT", url: SHIFT_REDEEM_URL }];
    if (c.source_url) buttons.push({ type: 2, style: 5, label: "Source", url: c.source_url });
    return { embeds: [embed], components: expired ? [] : [{ type: 1, components: buttons }], allowed_mentions: { parse: [] } };
}

const wanted = (settings, c) => !settings.games.length || settings.games.includes(c.game);

/** Newest-first active codes this server should see and has not been sent yet. */
export function pendingFor(db, guildId, settings) {
    return db.listCodes({ status: "active", limit: 200 }).filter(c => wanted(settings, c) && !db.codePost(c.id, guildId));
}

/**
 * One poll: read the feed, store anything new, retire what ended, post what each server has not had, and edit old posts.
 * `fetchCodes` is injectable for tests. A failed fetch still lets the expiry and edit steps run.
 */
export async function runCodes({ db, api, fetchCodes = fetchShiftCodes, now = Date.now, sleep = sleepDefault, pace = 500, log = () => {} }) {
    const stats = { fetched: 0, added: 0, posted: 0, expired: 0, failed: 0, feedError: null };
    try {
        const list = await fetchCodes();
        stats.fetched = list.length;
        for (const c of list) if (db.upsertCode(c).isNew) stats.added++;
    } catch (err) { stats.feedError = err.message; log(`code feed: ${err.message}`); }

    stats.expired = db.expireDue(now()).length;

    for (const settings of db.codeGuilds()) {
        const gid = settings.guild_id;
        const fresh = pendingFor(db, gid, settings);
        if (!fresh.length) continue;
        const first = !db.hasAnyCodePost(gid);
        const toPost = first ? fresh.slice(0, FIRST_RUN_POSTS) : fresh.slice(0, MAX_PER_RUN);
        if (first) for (const c of fresh.slice(FIRST_RUN_POSTS)) db.addCodePost(c.id, gid, settings.channel_id, null); // seen, never posted
        for (const c of [...toPost].reverse()) { // oldest first, so the newest ends up at the bottom of the channel
            try {
                const msg = await api.sendMessage(settings.channel_id, { ...codeEmbed(c), content: settings.role_id ? `<@&${settings.role_id}>` : undefined, allowed_mentions: settings.role_id ? { roles: [settings.role_id] } : { parse: [] } });
                db.addCodePost(c.id, gid, settings.channel_id, msg?.id ?? null);
                stats.posted++;
            } catch (err) {
                stats.failed++;
                log(`code post failed for a server (${err?.status ?? err?.name})`);
                break; // the channel is gone or locked; try again next poll instead of burning requests
            }
            await sleep(pace);
        }
    }

    for (const p of db.stalePosts()) {
        try { await api.editMessage(p.channel_id, p.message_id, codeEmbed({ ...p, expires_at: p.expires_at }, { expired: true })); db.markPostExpired(p.code_id, p.guild_id); }
        catch (err) { if (err?.status === 404 || err?.status === 403) db.markPostExpired(p.code_id, p.guild_id); else stats.failed++; }
        await sleep(pace);
    }
    db.pruneCodes();
    return stats;
}

/** Shared by the /codes command and the dashboard: validate and save a server's settings. Throws an Error with a plain message. */
export function applyCodeSettings(db, guildId, body, { allowedGames = SHIFT_GAMES.map(g => g.key) } = {}) {
    const patch = {};
    if (body.channel_id !== undefined) patch.channel_id = body.channel_id || null;
    if (body.role_id !== undefined) patch.role_id = body.role_id || null;
    if (body.games !== undefined) {
        const games = Array.isArray(body.games) ? body.games.map(String) : [];
        const bad = games.find(g => !allowedGames.includes(g));
        if (bad) throw new Error("That is not a game I track codes for.");
        patch.games = games.length === allowedGames.length ? [] : games; // every game selected is the same as no filter
    }
    return db.setCodeSettings(guildId, patch);
}

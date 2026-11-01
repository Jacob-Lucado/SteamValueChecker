// Game code posts: the embed, the poll that posts each code once per server, and the edit that marks a code as ended.
import { fetchAllCodes, gameByKey, gameArt, redeemUrlFor, ALL_GAMES, GAME_FAMILIES, expandGames } from "./codesource.js";
import { sendCodeAlerts } from "./dropalerts.js";

const sleepDefault = ms => new Promise(r => setTimeout(r, ms));
const ORANGE = 0xff9800, GREY = 0x6b7280;
const MAX_PER_RUN = 8;     // posts per server per poll, so a server that was offline for a week is not flooded
const FIRST_RUN_POSTS = 3; // a server that has never had a code only gets the newest few; the rest are marked as seen

export const codeGames = () => ALL_GAMES.map(g => ({ key: g.key, title: g.title, provider: g.provider }));
export const codeFamilies = () => GAME_FAMILIES.map(f => ({ key: f.key, title: f.title, games: f.games }));
const hex = n => "#" + (n ?? 0xff9800).toString(16).padStart(6, "0");

const unix = ms => Math.floor(ms / 1000);

/** "Borderlands, Genshin Impact" for a list of game keys (all six Borderlands games read as one). Empty means every game. */
export function describeGames(keys) {
    const set = new Set(keys ?? []);
    if (!set.size) return "every game";
    return GAME_FAMILIES.filter(f => f.games.some(k => set.has(k))).map(f => f.title).join(", ");
}

/** What the dashboard and the /games codes command show for one stored code. */
export function codeView(c, at = Date.now()) {
    const game = gameByKey(c.game);
    return { id: c.id, code: c.code, game: c.game, gameTitle: game?.title ?? c.game, art: gameArt(game, ""), accent: hex(game?.color), provider: game?.provider ?? "shift", platform: c.platform, reward: c.reward, note: c.note,
        expiresAt: c.expires_at ?? null, status: c.status === "active" && c.expires_at && c.expires_at < at ? "expired" : c.status, firstSeen: c.first_seen, sourceUrl: c.source_url, redeemUrl: redeemUrlFor(game, c.code) };
}

/** The post for one code. `expired` greys it out, strikes the code through and drops the buttons. */
export function codeEmbed(c, { expired = false, base = null } = {}) {
    const game = gameByKey(c.game);
    const ends = c.expires_at ? `<t:${unix(c.expires_at)}:D> (<t:${unix(c.expires_at)}:R>)` : "No end date listed";
    const fields = [
        { name: "Reward", value: c.reward || "Unknown", inline: true },
        { name: "Platform", value: c.platform || "All platforms", inline: true },
        { name: expired ? "Ended" : "Expires", value: expired && !c.expires_at ? "No longer listed as working" : ends, inline: true }
    ];
    const heads = c.note ? `${c.note}. This one may only work on that region's account.` : game?.note ? `${game.note}.` : null;
    if (heads) fields.push({ name: "Heads up", value: heads.slice(0, 300), inline: false });
    const embed = {
        color: expired ? GREY : (game?.color ?? ORANGE),
        author: { name: `${game?.title ?? "Game"} · ${game?.provider === "hoyo" ? "redeem code" : "SHiFT code"}` },
        title: expired ? `Expired: ${c.reward || "code"}` : (c.reward || "New code"),
        description: expired ? `~~${c.code}~~\nThis code has ended.` : `\`\`\`\n${c.code}\n\`\`\`${game?.provider === "hoyo" ? "Copy it, then redeem it in the game (Settings, Redeem Code) or with the button below." : "Copy it, then redeem it on the SHiFT site while signed in to the account linked to your game."}`,
        fields,
        image: game && gameArt(game, base) ? { url: gameArt(game, base) } : undefined,
        footer: { text: expired ? "Steam Value Checker · code ended" : game?.provider === "hoyo" ? "Steam Value Checker · codes can stop working without warning" : "Codes from mentalmars.com · they can run out before the listed date" }
    };
    const buttons = [{ type: 2, style: 5, label: game?.provider === "hoyo" ? "Redeem this code" : "Redeem on SHiFT", url: redeemUrlFor(game, c.code) }];
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
export async function runCodes({ db, api, base = null, notifier = null, fetchCodes = fetchAllCodes, now = Date.now, sleep = sleepDefault, pace = 500, log = () => {} }) {
    const stats = { fetched: 0, added: 0, posted: 0, expired: 0, failed: 0, feedError: null };
    try {
        const got = await fetchCodes();
        const list = Array.isArray(got) ? got : got.codes;
        stats.fetched = list.length;
        for (const c of list) if (db.upsertCode(c).isNew) stats.added++;
        if (got.errors?.length) { stats.feedError = got.errors.join("; "); log(`code feed (partial): ${stats.feedError}`); }
        // lists that only show what works: a code that dropped off has ended (only when every list for that game answered)
        for (const key of got.complete ?? []) {
            const [provider, game] = key.split(":");
            const present = list.filter(c => c.provider === provider && c.game === game).map(c => c.key);
            if (present.length) stats.expired += db.expireMissing(provider, game, present).length;
        }
    } catch (err) { stats.feedError = err.message; log(`code feed: ${err.message}`); }

    stats.expired += db.expireDue(now()).length;

    for (const settings of db.codeGuilds()) {
        const gid = settings.guild_id;
        const fresh = pendingFor(db, gid, settings);
        if (!fresh.length) continue;
        const first = !db.hasAnyCodePost(gid);
        const toPost = first ? fresh.slice(0, FIRST_RUN_POSTS) : fresh.slice(0, MAX_PER_RUN);
        if (first) for (const c of fresh.slice(FIRST_RUN_POSTS)) db.addCodePost(c.id, gid, settings.channel_id, null); // seen, never posted
        const ping = settings.role_id ?? db.getCommunity?.(gid)?.ping_codes ?? null; // the server's own "Game code pings" role is the default
        for (const c of [...toPost].reverse()) { // oldest first, so the newest ends up at the bottom of the channel
            try {
                const msg = await api.sendMessage(settings.channel_id, { ...codeEmbed(c, { base }), content: ping ? `<@&${ping}>` : undefined, allowed_mentions: ping ? { roles: [ping] } : { parse: [] } });
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

    if (notifier) {
        try { const a = await sendCodeAlerts({ db, notifier, base, now, log }); stats.alerted = a.delivered; stats.failed += a.failed; }
        catch (err) { log(`code alerts: ${err.message}`); }
    }

    for (const p of db.stalePosts()) {
        try { await api.editMessage(p.channel_id, p.message_id, codeEmbed({ ...p, expires_at: p.expires_at }, { expired: true, base })); db.markPostExpired(p.code_id, p.guild_id); }
        catch (err) { if (err?.status === 404 || err?.status === 403) db.markPostExpired(p.code_id, p.guild_id); else stats.failed++; }
        await sleep(pace);
    }
    db.pruneCodes();
    return stats;
}

/** Shared by the /games codes command and the dashboard: validate and save a server's settings. Throws an Error with a plain message. */
export function applyCodeSettings(db, guildId, body, { allowedGames = ALL_GAMES.map(g => g.key) } = {}) {
    const patch = {};
    if (body.channel_id !== undefined) patch.channel_id = body.channel_id || null;
    if (body.role_id !== undefined) patch.role_id = body.role_id || null;
    if (body.games !== undefined) {
        const games = expandGames(Array.isArray(body.games) ? body.games.map(String) : []);
        const bad = games.find(g => !allowedGames.includes(g));
        if (bad) throw new Error("That is not a game I track codes for.");
        patch.games = games.length === allowedGames.length ? [] : games; // every game selected is the same as no filter
    }
    return db.setCodeSettings(guildId, patch);
}

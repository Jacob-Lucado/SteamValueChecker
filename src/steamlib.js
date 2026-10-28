// Steam library linking: read the owned games and playtime of a PUBLIC profile, store them in the member's library,
// and work out what the playtime says about value. Pure logic plus two fetches; Discord and the dashboard call this.
import { STEAM_SHOP_ID, SteamError, parseProfileInput, resolveVanity, get } from "./steam.js";
import { MAX_LIBRARY_PER_USER } from "./db.js";
import { libraryView } from "./library.js";

const PRIVATE_LIBRARY = "I can't see that library. In Steam, open Profile > Edit Profile > Privacy Settings and set **Game details** to Public (and turn off \"Always keep my total playtime private\"), then try again.";

const decode = s => String(s).replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();

/** Games from Steam's community XML list. Hours look like "1,234.5". */
export function parseGamesXml(xml) {
    const out = [];
    for (const block of String(xml).match(/<game>[\s\S]*?<\/game>/g) ?? []) {
        const appid = Number(block.match(/<appID>(\d+)<\/appID>/)?.[1]);
        const name = decode(block.match(/<name>([\s\S]*?)<\/name>/)?.[1] ?? "");
        const hours = parseFloat((block.match(/<hoursOnRecord>([^<]*)<\/hoursOnRecord>/)?.[1] ?? "0").replace(/,/g, ""));
        if (Number.isInteger(appid) && appid > 0 && name) out.push({ appid, name, minutes: Number.isFinite(hours) ? Math.round(hours * 60) : 0, lastPlayed: null });
    }
    return out;
}

/**
 * Games from the profile's games page. Steam embeds the list as HTML-escaped JSON in a data-profile-gameslist attribute.
 * Playtime is minutes (playtime_forever) or a text like "1,234.5" hours (hours_forever), depending on the page version.
 */
export function parseGamesPage(html) {
    const m = String(html).match(/data-profile-gameslist=(["'])([\s\S]*?)\1/);
    if (!m) return [];
    let data;
    try { data = JSON.parse(decode(m[2])); } catch { return []; }
    const list = data?.rgGames ?? data?.games ?? [];
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const g of list) {
        const appid = Number(g?.appid);
        const name = typeof g?.name === "string" ? g.name.trim() : "";
        let minutes = Number(g?.playtime_forever);
        if (!Number.isFinite(minutes)) minutes = Math.round(parseFloat(String(g?.hours_forever ?? "0").replace(/,/g, "")) * 60) || 0;
        const last = Number(g?.last_played);
        if (Number.isInteger(appid) && appid > 0 && name) out.push({ appid, name, minutes: Math.max(0, Math.round(minutes)), lastPlayed: Number.isFinite(last) && last > 0 ? last : null });
    }
    return out;
}

/** Games from the Web API's GetOwnedGames response. */
export function parseOwnedJson(data) {
    const games = data?.response?.games;
    if (!Array.isArray(games)) return null;
    return games.map(g => ({ appid: Number(g?.appid), name: typeof g?.name === "string" ? g.name.trim() : "", minutes: Math.max(0, Math.round(Number(g?.playtime_forever) || 0)), lastPlayed: Number(g?.rtime_last_played) || null }))
        .filter(g => Number.isInteger(g.appid) && g.appid > 0);
}

/**
 * Owned games with minutes played. With a Steam Web API key (the bot owner's, set as STEAM_API_KEY) it uses the official
 * endpoint; without one it reads the public community list. Either way a private profile cannot be read.
 */
export async function fetchOwnedGames(steamid, { apiKey = null, fetchImpl = globalThis.fetch } = {}) {
    if (apiKey) {
        const res = await get(fetchImpl, `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(apiKey)}&steamid=${steamid}&include_appinfo=1&include_played_free_games=1&format=json`);
        if (res.status === 429) throw new SteamError("rate_limited", "Steam is rate limiting the bot. Try again in a few minutes.");
        if (res.status === 401 || res.status === 403) throw new SteamError("config", "Steam rejected the bot's API key. The bot's owner needs to check STEAM_API_KEY.");
        if (!res.ok) throw new SteamError("http", `Steam returned HTTP ${res.status}.`);
        let data; try { data = await res.json(); } catch { throw new SteamError("bad_response", "Steam sent a response the bot could not read."); }
        const games = parseOwnedJson(data);
        if (!games?.length) throw new SteamError("private", PRIVATE_LIBRARY);
        return games;
    }
    // Without a key, read the public games page first, then the older XML list. Either is empty for a private profile.
    let limited = false, failed = null;
    for (const [url, parse] of [[`https://steamcommunity.com/profiles/${steamid}/games/?tab=all`, parseGamesPage], [`https://steamcommunity.com/profiles/${steamid}/games?tab=all&xml=1`, parseGamesXml]]) {
        const res = await get(fetchImpl, url);
        if (res.status === 429) { limited = true; continue; }
        if (!res.ok) { failed = res.status; continue; }
        const games = parse(await res.text());
        if (games.length) return games;
    }
    if (limited) throw new SteamError("rate_limited", "Steam is rate limiting the bot. Try again in a few minutes.");
    if (failed) throw new SteamError("http", `Steam returned HTTP ${failed}.`);
    throw new SteamError("private", PRIVATE_LIBRARY);
}

/**
 * Achievement progress for one game from the Web API: { done, total }, or { done: 0, total: 0 } for a game with none.
 * Needs the bot's STEAM_API_KEY and a public profile. Returns null when Steam would not say (private stats, a hiccup).
 * Throws rate_limited on HTTP 429 so the caller can stop.
 */
export async function fetchAchievements(steamid, appid, { apiKey, fetchImpl = globalThis.fetch }) {
    const res = await get(fetchImpl, `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/?appid=${Number(appid)}&key=${encodeURIComponent(apiKey)}&steamid=${steamid}`);
    if (res.status === 429) throw new SteamError("rate_limited", "Steam is rate limiting the bot. Try again in a few minutes.");
    let data = null;
    try { data = await res.json(); } catch { /* not json */ }
    const stats = data?.playerstats;
    if (Array.isArray(stats?.achievements)) return { done: stats.achievements.filter(a => Number(a?.achieved) === 1).length, total: stats.achievements.length };
    if (/no stats/i.test(String(stats?.error ?? ""))) return { done: 0, total: 0 };
    return null;
}

/**
 * Looks up achievements for the member's played games (most played first), a few at a time, and marks games Finished when
 * every achievement is unlocked. Games checked in the last week are skipped, so a re-sync only does what is new or stale.
 * At most `limit` games per run; run it again for the rest. Never throws: a Steam problem just ends the run early.
 */
export async function syncAchievements({ db, userId, steamid, apiKey, fetchImpl = globalThis.fetch, now = Date.now(), limit = 400, concurrency = 6 }) {
    const stale = now - 7 * 86400_000;
    const todo = db.listLibrary(userId).filter(g => g.appid && (g.minutes ?? 0) >= 30 && (!g.ach_checked || g.ach_checked < stale)).sort((a, b) => b.minutes - a.minutes).slice(0, limit);
    let checked = 0, newlyFinished = 0, stopped = false, i = 0;
    const worker = async () => {
        while (!stopped && i < todo.length) {
            const g = todo[i++];
            try {
                const a = await fetchAchievements(steamid, g.appid, { apiKey, fetchImpl });
                if (!a) continue;
                checked++;
                if (db.setAchievements(userId, g.itad_id, a).newlyFinished) newlyFinished++;
            } catch { stopped = true; }
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
    return { checked, newlyFinished, remaining: Math.max(0, todo.length - i), stopped };
}

/** The public profile card from the community XML: name, picture, location, member since. Null when Steam has nothing to show. */
export function parseProfileXml(xml, steamid) {
    const tag = n => { const m = new RegExp(`<${n}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*</${n}>`).exec(String(xml ?? "")); const v = (m?.[1] ?? m?.[2] ?? "").trim(); return v || null; };
    const name = tag("steamID");
    if (!name) return null;
    const pic = tag("avatarFull");
    return {
        steamid: String(steamid), name: name.slice(0, 64),
        avatar: pic && /^https:\/\/[\w.-]+\//.test(pic) ? pic : null,
        url: `https://steamcommunity.com/profiles/${steamid}`,
        realName: tag("realname")?.slice(0, 64) ?? null, location: tag("location")?.slice(0, 80) ?? null,
        memberSince: tag("memberSince")?.slice(0, 30) ?? null, status: tag("onlineState") ?? null,
        headline: tag("headline")?.slice(0, 120) ?? null, privacy: tag("privacyState") ?? null
    };
}

export async function fetchProfileCard(steamid, fetchImpl = globalThis.fetch) {
    try {
        const res = await get(fetchImpl, `https://steamcommunity.com/profiles/${steamid}/?xml=1`);
        return res.ok ? parseProfileXml(await res.text(), steamid) : null;
    } catch { return null; }
}

/** Profile link, custom name or SteamID64 -> SteamID64. */
export async function resolveProfile(input, fetchImpl = globalThis.fetch) {
    const parsed = parseProfileInput(input);
    if (!parsed) throw new SteamError("bad_input", "Send a Steam profile link, a custom profile name or a 17-digit SteamID64.");
    return parsed.steamid ?? await resolveVanity(parsed.vanity, fetchImpl);
}

/**
 * Reads the linked profile and syncs it into the library. `steamid` is already resolved.
 * Games over the library limit are skipped, most played first so the ones that matter are kept.
 */
export async function syncSteamLibrary({ db, itad, userId, steamid, apiKey = null, fetchImpl = globalThis.fetch }) {
    const owned = await fetchOwnedGames(steamid, { apiKey, fetchImpl });
    const ranked = [...owned].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name)).slice(0, MAX_LIBRARY_PER_USER);
    const map = await itad.lookupShopIds(STEAM_SHOP_ID, ranked.map(g => `app/${g.appid}`));
    const seen = new Set(), games = [];
    for (const g of ranked) {
        const id = map.get(`app/${g.appid}`);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        games.push({ itad_id: id, title: g.name || `App ${g.appid}`, appid: g.appid, minutes: g.minutes, lastPlayed: g.lastPlayed });
    }
    const res = db.syncSteamGames(userId, games);
    const minutes = owned.reduce((t, g) => t + g.minutes, 0);
    db.setSteamLink(userId, steamid);
    db.markSteamSynced(userId, { games: owned.length, minutes });
    // What the synced games are worth right now. A price lookup problem must not undo a good sync, so it is optional.
    let value = null;
    try {
        const view = await libraryView(db, itad, db.getUser(userId), { snapshot: false });
        value = steamValue(view.rows.filter(r => r.appid), view.currency);
    } catch { /* value stays null */ }
    // Achievements need the bot's API key. They are a bonus: any trouble just leaves them out.
    let achievements = null;
    if (apiKey) { try { achievements = await syncAchievements({ db, userId, steamid, apiKey, fetchImpl }); } catch { /* optional */ } }
    return { steamid, owned: owned.length, matched: games.length, unmatched: ranked.length - games.length, minutes, truncated: owned.length > ranked.length, value, achievements, ...res };
}

/** Total value of the Steam-synced games: at full price (MSRP) and at the cheapest current price. */
export function steamValue(rows, currency = "USD") {
    const sum = f => rows.reduce((t, r) => t + (Number.isFinite(f(r)) ? f(r) : 0), 0);
    const priced = rows.filter(r => Number.isFinite(r.msrp));
    const withAch = rows.filter(r => r.ach_total > 0);
    return {
        games: rows.length, priced: priced.length, msrp: sum(r => r.msrp), cheapest: sum(r => r.best?.price), atl: sum(r => r.atl), currency,
        achDone: withAch.reduce((t, r) => t + (r.ach_done ?? 0), 0), achTotal: withAch.reduce((t, r) => t + r.ach_total, 0), achGames: withAch.length,
        top: [...priced].sort((a, b) => b.msrp - a.msrp).slice(0, 5).map(r => ({ title: r.title, msrp: r.msrp, appid: r.appid ?? null }))
    };
}

const hours = m => m / 60;
export const fmtHours = m => (m < 60 ? `${m} min` : `${hours(m).toFixed(hours(m) < 10 ? 1 : 0)} h`);

/** What your Steam library looks like: games, hours, what is unplayed and what it is all worth. */
export function playStats(rows) {
    const played = rows.filter(r => (r.minutes ?? 0) > 0);
    const unplayed = rows.filter(r => (r.minutes ?? 0) < 60);
    const unplayedList = [...unplayed].sort((a, b) => (b.msrp ?? 0) - (a.msrp ?? 0));
    return {
        value: steamValue(rows),
        games: rows.length, playedGames: played.length, totalMinutes: rows.reduce((t, r) => t + (r.minutes ?? 0), 0),
        mostPlayed: [...played].sort((a, b) => b.minutes - a.minutes).slice(0, 5),
        unplayedCount: unplayed.length,
        unplayedMsrp: unplayed.reduce((t, r) => t + (r.msrp ?? 0), 0),
        unplayedTop: unplayedList.slice(0, 5)
    };
}

/**
 * What to play next, from your own library. In order of preference: what you marked as playing, games you started and
 * never went back to (30 minutes to 10 hours), games you never touched (worth the most first), then anything else not
 * finished or dropped. `skip` is a list of itad ids already offered, so "pick another" does not repeat. Returns
 * { pick, others, why, remaining } or null.
 */
export function steamNext(rows, { rand = Math.random, skip = [] } = {}) {
    const skipped = new Set(skip);
    const tier = r => (r.status === "playing" ? 0 : r.minutes >= 30 && r.minutes < 600 ? 1 : r.minutes < 30 ? 2 : 3);
    const pool = rows.filter(r => r.appid && r.status !== "finished" && r.status !== "dropped" && !(r.status === "played" && r.minutes >= 600)) // long-played games are not "next"
        .sort((a, b) => tier(a) - tier(b) || (tier(a) === 1 ? b.minutes - a.minutes : tier(a) === 2 ? (b.msrp ?? 0) - (a.msrp ?? 0) : a.minutes - b.minutes) || a.title.localeCompare(b.title));
    const fresh = pool.filter(r => !skipped.has(r.itad_id));
    if (!fresh.length) return null;
    const best = tier(fresh[0]);
    const top = fresh.filter(r => tier(r) === best).slice(0, 3);
    const pick = top[Math.floor(rand() * top.length)];
    const why = [
        "You are playing this right now. Finish it before you start something new.",
        `You started this (${fmtHours(pick.minutes)}) and never went back. Pick it up again.`,
        pick.msrp ? `You own it and have not played it. It is one of the most valuable games in your library (${pick.msrp.toFixed(2)} at full price).` : "You own it and have not played it yet.",
        `You have ${fmtHours(pick.minutes)} in it but it is not finished. Time to wrap it up.`
    ][tier(pick)];
    return { pick, others: fresh.filter(r => r !== pick).slice(0, 2), why, remaining: fresh.length - 1 };
}

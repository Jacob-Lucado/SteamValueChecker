// Steam library linking: read the owned games and playtime of a PUBLIC profile, store them in the member's library,
// and work out what the playtime says about value. Pure logic plus two fetches; Discord and the dashboard call this.
import { STEAM_SHOP_ID, SteamError, parseProfileInput, resolveVanity, get } from "./steam.js";
import { MAX_LIBRARY_PER_USER } from "./db.js";

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
    const res = await get(fetchImpl, `https://steamcommunity.com/profiles/${steamid}/games?tab=all&xml=1`);
    if (res.status === 429) throw new SteamError("rate_limited", "Steam is rate limiting the bot. Try again in a few minutes.");
    if (!res.ok) throw new SteamError("http", `Steam returned HTTP ${res.status}.`);
    const games = parseGamesXml(await res.text());
    if (!games.length) throw new SteamError("private", PRIVATE_LIBRARY);
    return games;
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
    return { steamid, owned: owned.length, matched: games.length, unmatched: ranked.length - games.length, minutes, truncated: owned.length > ranked.length, ...res };
}

const hours = m => m / 60;
export const fmtHours = m => (m < 60 ? `${m} min` : `${hours(m).toFixed(hours(m) < 10 ? 1 : 0)} h`);

/**
 * What the playtime says about value. Cost per hour uses what you paid, or today's cheapest price when you did not
 * record a price (flagged with `estimated`). Games under an hour are left out of the cost-per-hour ranks, because one
 * short session says little.
 */
export function playStats(rows) {
    const played = rows.filter(r => (r.minutes ?? 0) > 0);
    const totalMin = rows.reduce((t, r) => t + (r.minutes ?? 0), 0);
    const price = r => (r.paid ?? r.best?.price ?? null);
    const costed = played.filter(r => price(r) !== null && r.minutes >= 60).map(r => ({ ...r, perHour: price(r) / hours(r.minutes), estimated: r.paid === null }));
    const spend = costed.reduce((t, r) => t + price(r), 0), costedMin = costed.reduce((t, r) => t + r.minutes, 0);
    const unplayed = rows.filter(r => (r.minutes ?? 0) < 60);
    return {
        games: rows.length, playedGames: played.length, totalMinutes: totalMin,
        perHour: costedMin ? spend / hours(costedMin) : null,
        mostPlayed: [...played].sort((a, b) => b.minutes - a.minutes).slice(0, 5),
        bestValue: [...costed].sort((a, b) => a.perHour - b.perHour).slice(0, 3),
        worstValue: [...costed].sort((a, b) => b.perHour - a.perHour).slice(0, 3),
        unplayedCount: unplayed.length,
        unplayedMsrp: unplayed.reduce((t, r) => t + (r.msrp ?? 0), 0),
        unplayedTop: [...unplayed].sort((a, b) => (b.msrp ?? 0) - (a.msrp ?? 0)).slice(0, 3)
    };
}

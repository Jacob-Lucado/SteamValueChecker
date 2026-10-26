// Reads a PUBLIC Steam wishlist. No Steam login, cookie or API key is used or accepted.
// Endpoint: https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=<id64>
// Steam documents only the steamid parameter, and the response shape is read defensively.

export const STEAM_SHOP_ID = 61; // Steam's id in the IsThereAnyDeal API
export const MAX_IMPORT = 150;

export class SteamError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

const ID64 = /^7656119\d{10}$/;

/** Accepts a profile URL, a 17-digit SteamID64 or a custom profile name. Returns { steamid } | { vanity } | null. */
export function parseProfileInput(input) {
    const s = String(input ?? "").trim();
    if (!s) return null;
    if (ID64.test(s)) return { steamid: s };

    let m = s.match(/steamcommunity\.com\/profiles\/(\d{17})(?:[/?#]|$)/i);
    if (m && ID64.test(m[1])) return { steamid: m[1] };

    m = s.match(/steamcommunity\.com\/id\/([A-Za-z0-9_-]{2,32})(?:[/?#]|$)/i);
    if (m) return { vanity: m[1] };

    if (/^[A-Za-z0-9_-]{2,32}$/.test(s)) return { vanity: s };
    return null;
}

async function get(fetchImpl, url, timeoutMs = 15000) {
    try {
        return await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": "SteamValueChecker" } });
    } catch {
        throw new SteamError("network", "Could not reach Steam right now. Try again in a moment.");
    }
}

/** Custom profile name -> SteamID64, using the public profile XML. */
export async function resolveVanity(name, fetchImpl = globalThis.fetch) {
    const res = await get(fetchImpl, `https://steamcommunity.com/id/${encodeURIComponent(name)}/?xml=1`);
    if (!res.ok) throw new SteamError("not_found", "I could not find that Steam profile.");
    const text = await res.text();
    const m = text.match(/<steamID64>(\d{17})<\/steamID64>/);
    if (!m) throw new SteamError("not_found", "I could not find that Steam profile.");
    return m[1];
}

/** Returns the app ids on a public wishlist. An empty list can mean empty or private; Steam does not say which. */
export async function fetchWishlistAppIds(steamid, fetchImpl = globalThis.fetch) {
    const res = await get(fetchImpl, `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=${steamid}`);
    if (res.status === 401 || res.status === 403) throw new SteamError("private", PRIVATE_MSG);
    if (res.status === 429) throw new SteamError("rate_limited", "Steam is rate limiting the bot. Try again in a few minutes.");
    if (!res.ok) throw new SteamError("http", `Steam returned HTTP ${res.status}.`);
    let data;
    try { data = await res.json(); } catch { throw new SteamError("bad_response", "Steam sent a response the bot could not read."); }
    const items = Array.isArray(data?.response?.items) ? data.response.items : [];
    const ids = [...new Set(items.map(i => Number(i?.appid)).filter(n => Number.isInteger(n) && n > 0))];
    if (!ids.length) throw new SteamError("empty", PRIVATE_MSG);
    return ids;
}

/**
 * Game names for Steam app ids, in batches, straight from Steam's store. Returns Map(appid -> name).
 * Best effort: any failure just returns what was found, and the caller falls back to IsThereAnyDeal for the rest.
 */
export async function fetchSteamNames(appIds, fetchImpl = globalThis.fetch, { batch = 100 } = {}) {
    const names = new Map();
    for (let i = 0; i < appIds.length; i += batch) {
        const ids = appIds.slice(i, i + batch).map(appid => ({ appid }));
        const input = encodeURIComponent(JSON.stringify({ ids, context: { language: "english", country_code: "US" }, data_request: {} }));
        try {
            const res = await get(fetchImpl, `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${input}`);
            if (!res.ok) continue;
            const data = await res.json();
            for (const it of data?.response?.store_items ?? []) {
                const appid = Number(it?.appid ?? it?.id);
                if (Number.isInteger(appid) && typeof it?.name === "string" && it.name.trim()) names.set(appid, it.name.trim());
            }
        } catch { /* fall back to the other source */ }
    }
    return names;
}

const PRIVATE_MSG =
    "That wishlist is empty or not public. In Steam, open Profile > Edit Profile > Privacy Settings and set **Game details** to Public, then try again.";

/**
 * Wishlist -> ITAD games ready to store. `itad` needs lookupShopIds and getTitle.
 * Titles come from Steam in bulk. Only games Steam did not name are looked up one at a time on ITAD,
 * so the import is capped at MAX_IMPORT games.
 */
export async function importWishlist(input, itad, { fetchImpl = globalThis.fetch, max = MAX_IMPORT, onlyIds = null } = {}) {
    const parsed = parseProfileInput(input);
    if (!parsed) throw new SteamError("bad_input", "Send a Steam profile link, a custom profile name or a 17-digit SteamID64.");
    const steamid = parsed.steamid ?? await resolveVanity(parsed.vanity, fetchImpl);

    const appIds = await fetchWishlistAppIds(steamid, fetchImpl);
    const take = appIds.slice(0, max);
    const map = await itad.lookupShopIds(STEAM_SHOP_ID, take.map(a => `app/${a}`));

    const matched = [...map.values()].filter(Boolean);
    const unique = [...new Set(matched)];

    const games = [];
    // Steam names first (a few requests for the whole list), then ITAD only for the ones Steam did not name.
    const steamNames = await fetchSteamNames(take, fetchImpl);
    const itadByApp = new Map(take.map(a => [a, map.get(`app/${a}`)]));
    const appOf = new Map([...itadByApp].filter(([, id]) => id).map(([a, id]) => [id, a]));
    const named = new Set();
    for (const [appid, itadId] of itadByApp) {
        const name = steamNames.get(appid);
        if (itadId && name && !named.has(itadId)) { named.add(itadId); games.push({ itad_id: itadId, title: name, appid }); }
    }
    const rest = unique.filter(id => !named.has(id));
    let next = 0;
    let rateLimited = false;
    const worker = async () => {
        while (next < rest.length && !rateLimited) {
            const id = rest[next++];
            try {
                const info = await itad.getTitle(id);
                if (info) games.push({ itad_id: id, title: info.title, appid: appOf.get(id) ?? info.appid ?? null });
            } catch (err) {
                // Keep what we already have; titles looked up so far are cached, so running the import again finishes the rest.
                if (err?.code === "rate_limited" && games.length) { rateLimited = true; next--; } else throw err;
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(4, rest.length) }, worker));
    games.sort((a, b) => a.title.localeCompare(b.title));

    return {
        steamid,
        games,
        total: appIds.length,
        truncated: appIds.length > take.length,
        complete: appIds.length <= take.length && take.length === matched.length && games.length === unique.length,
        unmatched: take.length - matched.length,
        rateLimited
    };
}

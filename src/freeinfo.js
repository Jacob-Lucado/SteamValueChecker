// DLC detection and "do you own the base game" for free offers.
// Steam's public store data says whether an app is DLC and which game it belongs to (cached for the life of the process).
// Ownership only comes from a synced library: a library with Steam app ids in it.

const STEAM_APP = /store\.steampowered\.com\/app\/(\d+)/i;
const cache = new Map(); // appid -> { dlc, base } | null (null = Steam had nothing)
const negative = new Map(); // appid -> time of the last failed lookup, so errors are retried later and not on every message

export const steamAppid = g => { const m = STEAM_APP.exec(g?.url ?? ""); return m ? Number(m[1]) : null; };

async function steamKind(appid, fetchImpl) {
    if (cache.has(appid)) return cache.get(appid);
    if (Date.now() - (negative.get(appid) ?? 0) < 10 * 60_000) return null;
    try {
        const res = await fetchImpl(`https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic&l=english`, { headers: { "Accept-Language": "en" }, signal: AbortSignal.timeout(6000) });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json())?.[String(appid)];
        const d = data?.success ? data.data : null;
        const out = d ? { dlc: d.type === "dlc", isFree: d.is_free === true, base: d.fullgame?.appid ? { appid: Number(d.fullgame.appid), name: String(d.fullgame.name ?? "").slice(0, 100) } : null } : null;
        cache.set(appid, out);
        return out;
    } catch { negative.set(appid, Date.now()); return null; }
}

/** Copies of the offers with `type: "dlc"` and `base: { appid, name }` filled in for Steam DLC. Never throws. */
export async function enrichFree(list, fetchImpl = globalThis.fetch) {
    const out = [];
    for (const g of list) {
        const appid = steamAppid(g);
        const k = appid ? await steamKind(appid, fetchImpl) : null;
        const next = k?.dlc ? { ...g, type: "dlc", base: k.base } : k?.base ? { ...g, base: k.base } : g;
        // A game that is free to play all the time isn't a giveaway; if it shows up here, what's free is something inside it.
        out.push(k?.isFree && !k.dlc ? { ...next, alwaysFree: true } : next);
    }
    return out;
}

/** True/false for whether the user owns each DLC's base game, or null when it cannot be told (no synced library, no known base). */
export function withOwnership(list, db, userId) {
    const lib = userId ? db.listLibrary(userId) : [];
    const owned = new Set(lib.map(r => Number(r.appid)).filter(Boolean));
    return list.map(g => (g.type === "dlc" && g.base ? { ...g, baseOwned: owned.size ? owned.has(g.base.appid) : null } : g));
}

const INGAME = /\b(pack|in-game|loot|skins?|cosmetics?|starter|reward|rewards|perks?|currency|coins|gems|crate|drop|item|items|gift|bundle|booster|boost|key)\b/i;
/** What kind of free offer this is: "weekend" (free to play for a few days), "ingame" (an item or pack in a free game),
 *  "always" (a game that is free to play all the time) or "keep" (claim it and it's yours). */
export function offerKind(g) {
    if (g?.weekend) return "weekend";
    if (g?.alwaysFree) return INGAME.test(`${g.title ?? ""} ${g.blurb ?? ""}`) ? "ingame" : "always";
    return "keep";
}

export const _resetFreeInfo = () => { cache.clear(); negative.clear(); };

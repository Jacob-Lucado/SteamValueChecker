// Linux and Steam Deck compatibility from ProtonDB's public summary (an unofficial endpoint, so every failure is silent).
const cache = new Map();
const TTL = 24 * 3600_000;
const LABEL = { platinum: "Platinum", gold: "Gold", silver: "Silver", bronze: "Bronze", borked: "Borked", native: "Native Linux" };

export async function protonTier(appid, { fetchFn = globalThis.fetch, now = Date.now } = {}) {
    if (!Number.isInteger(appid) || !fetchFn) return null;
    const hit = cache.get(appid);
    if (hit && now() - hit.at < TTL) return hit.tier;
    let tier = null;
    try {
        const res = await fetchFn(`https://www.protondb.com/api/v1/reports/summaries/${appid}.json`, { signal: AbortSignal.timeout(3000) });
        if (res.ok) { const t = String((await res.json())?.tier ?? "").toLowerCase(); tier = LABEL[t] ? t : null; }
    } catch { /* optional */ }
    if (cache.size > 2000) cache.clear();
    cache.set(appid, { at: now(), tier });
    return tier;
}
export const protonLabel = tier => (LABEL[tier] ? `🐧 Linux and Steam Deck: ${LABEL[tier]} on ProtonDB` : null);

const deckCache = new Map();
const DECK = { 3: "verified", 2: "playable", 1: "unsupported" };
/** Valve's own Steam Deck rating for a game (verified, playable, unsupported), or null when unknown. Failures are silent. */
export async function deckStatus(appid, { fetchFn = globalThis.fetch, now = Date.now } = {}) {
    if (!Number.isInteger(appid) || !fetchFn) return null;
    const hit = deckCache.get(appid);
    if (hit && now() - hit.at < TTL) return hit.status;
    let status = null;
    try {
        const res = await fetchFn(`https://store.steampowered.com/saleaction/ajaxgetdeckappcompatibilityreport?nAppID=${appid}`, { signal: AbortSignal.timeout(3000) });
        if (res.ok) status = DECK[Number((await res.json())?.results?.resolved_category)] ?? null;
    } catch { /* optional */ }
    if (deckCache.size > 2000) deckCache.clear();
    deckCache.set(appid, { at: now(), status });
    return status;
}
export const DECK_LABEL = { verified: "Steam Deck Verified", playable: "Steam Deck Playable", unsupported: "Not supported on Steam Deck" };

// How many people are in a game on Steam right now, from Steam's public counter (no key). Optional everywhere it is used.
const TTL = 10 * 60_000;

export function createPlayers({ fetchImpl = globalThis.fetch, now = () => Date.now(), ttlMs = TTL } = {}) {
    const cache = new Map();
    /** Players right now, or null when Steam has no count for the app. Never throws. */
    async function current(appid) {
        if (!Number.isInteger(appid) || appid <= 0) return null;
        const hit = cache.get(appid);
        if (hit && now() - hit.at < ttlMs) return hit.value;
        let value = null;
        try {
            const res = await fetchImpl(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}`, { signal: AbortSignal.timeout(3500) });
            if (res.ok) { const n = (await res.json())?.response?.player_count; if (Number.isInteger(n) && n >= 0) value = n; }
        } catch { /* optional */ }
        if (cache.size > 3000) cache.clear();
        cache.set(appid, { at: now(), value });
        return value;
    }
    return { current };
}

/** One line for a card, or null. Tiny counts say little, so they are left off. */
export const playersLine = n => (Number.isInteger(n) && n >= 25 ? `👥 **${n.toLocaleString("en-US")}** playing on Steam right now` : null);

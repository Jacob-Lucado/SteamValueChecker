// Steam's own word on whether a game is out. IsThereAnyDeal dates can be a day ahead of the store, so a launch alert
// checks here first when it knows the Steam app id.
const cache = new Map(); // appid -> { at, soon }

/** true = Steam still lists it as coming soon, false = it is out, null = could not tell. Never throws. */
export async function steamStillUpcoming(appid, fetchImpl = globalThis.fetch) {
    if (!Number.isInteger(appid)) return null;
    const hit = cache.get(appid);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.soon;
    try {
        const res = await fetchImpl(`https://store.steampowered.com/api/appdetails?appids=${appid}&filters=release_date&l=english`, { headers: { "Accept-Language": "en" }, signal: AbortSignal.timeout(6000) });
        if (!res.ok) return null;
        const data = (await res.json())?.[String(appid)];
        if (!data?.success) return null; // not on the store (yet) tells us nothing
        const soon = Boolean(data.data?.release_date?.coming_soon);
        if (cache.size > 3000) cache.clear();
        cache.set(appid, { at: Date.now(), soon });
        return soon;
    } catch { return null; }
}

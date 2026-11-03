// Steam's own review summary for a game ("Very Positive, 94% of 52,310"), from the public store endpoint. No key.
// Every failure is silent: a card is fine without it.
const cache = new Map();
const TTL = 6 * 3600_000, MIN_REVIEWS = 10;

/** Reads the query_summary Steam returns. Null when there are too few reviews to mean anything. */
export function parseReviews(json) {
    const q = json?.query_summary;
    const pos = Number(q?.total_positive), neg = Number(q?.total_negative);
    if (!Number.isFinite(pos) || !Number.isFinite(neg)) return null;
    const total = pos + neg;
    if (total < MIN_REVIEWS) return null;
    const desc = String(q.review_score_desc ?? "").replace(/^\d+ /, "").slice(0, 40); // "9 user reviews" means too few for a rating
    if (!desc || /user reviews?$/i.test(desc)) return null;
    return { desc, pct: Math.round((pos / total) * 100), total };
}

export async function steamReviews(appid, { fetchFn = globalThis.fetch, now = Date.now } = {}) {
    if (!Number.isInteger(appid) || appid <= 0 || !fetchFn) return null;
    const hit = cache.get(appid);
    if (hit && now() - hit.at < TTL) return hit.value;
    let value = null;
    try {
        const res = await fetchFn(`https://store.steampowered.com/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=0`, { signal: AbortSignal.timeout(3500) });
        if (res.ok) value = parseReviews(await res.json());
    } catch { /* optional */ }
    if (cache.size > 3000) cache.clear();
    cache.set(appid, { at: now(), value });
    return value;
}

/** One line for a card, or null. */
export const reviewLine = r => (r ? `${r.pct >= 70 ? "⭐" : r.pct >= 40 ? "➖" : "👎"} **${r.desc}** on Steam: ${r.pct}% of ${r.total.toLocaleString("en-US")} reviews are positive` : null);

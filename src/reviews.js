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

/**
 * Spots a game whose last month of reviews is clearly worse than its overall score (a bad patch, a review bomb, a broken launch).
 * Needs enough recent reviews to mean something, and a real gap, so ordinary wobble doesn't trigger it.
 */
export function reviewDip(all, recent) {
    if (!all || !recent || recent.total < 50) return null;
    const drop = all.pct - recent.pct;
    return drop >= 15 && recent.pct < 70 ? { pct: recent.pct, total: recent.total, drop } : null;
}

export async function steamReviews(appid, { fetchFn = globalThis.fetch, now = Date.now } = {}) {
    if (!Number.isInteger(appid) || appid <= 0 || !fetchFn) return null;
    const hit = cache.get(appid);
    if (hit && now() - hit.at < TTL) return hit.value;
    let value = null;
    const url = tail => `https://store.steampowered.com/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=0${tail}`;
    try {
        const [res, rec] = await Promise.all([
            fetchFn(url(""), { signal: AbortSignal.timeout(3500) }),
            fetchFn(url("&filter=recent&day_range=30"), { signal: AbortSignal.timeout(3500) }).catch(() => null)
        ]);
        if (res.ok) {
            value = parseReviews(await res.json());
            if (value && rec?.ok) {
                const q = (await rec.json().catch(() => null))?.query_summary, pos = Number(q?.total_positive), neg = Number(q?.total_negative);
                if (Number.isFinite(pos) && Number.isFinite(neg) && pos + neg > 0) {
                    const total = pos + neg, dip = reviewDip(value, { pct: Math.round(pos / total * 100), total });
                    if (dip) value.dip = dip;
                }
            }
        }
    } catch { /* optional */ }
    if (cache.size > 3000) cache.clear();
    cache.set(appid, { at: now(), value });
    return value;
}

/** One line for a card, or null. */
export const reviewLine = r => (r ? `${r.pct >= 70 ? "⭐" : r.pct >= 40 ? "➖" : "👎"} **${r.desc}** on Steam: ${r.pct}% of ${r.total.toLocaleString("en-US")} reviews are positive${r.dip ? `\n⚠️ Lately worse: only **${r.dip.pct}%** of the last ${r.dip.total.toLocaleString("en-US")} reviews this month are positive. Worth a look before buying.` : ""}` : null);

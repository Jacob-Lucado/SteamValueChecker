// "Is this a good price?" from a game's price history: a 12 month sparkline and a plain-language nudge.
const BARS = "▁▂▃▄▅▆▇█";
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86400_000;

/** points: [{ t, price }] oldest first (price history). price: today's price. Returns null when there is too little data. */
export function priceInsight(points, price, { now = Date.now(), currency = "USD", money = n => `$${n.toFixed(2)}` } = {}) {
    const pts = (points ?? []).filter(p => Number.isFinite(p.price) && p.t >= now - 365 * DAY);
    if (pts.length < 3 || !Number.isFinite(price)) return null;

    // Twelve monthly buckets: the cheapest price seen in each (carry the last value across quiet months).
    const buckets = Array.from({ length: 12 }, () => null);
    for (const p of pts) {
        const idx = Math.min(11, Math.max(0, 11 - Math.floor((now - p.t) / (30.4 * DAY))));
        buckets[idx] = buckets[idx] === null ? p.price : Math.min(buckets[idx], p.price);
    }
    let last = pts[0].price;
    const filled = buckets.map(b => (last = b ?? last));
    const lo = Math.min(...filled), hi = Math.max(...filled);
    const spark = filled.map(v => BARS[hi === lo ? 3 : Math.round(((v - lo) / (hi - lo)) * (BARS.length - 1))]).join("");

    const prices = pts.map(p => p.price).sort((a, b) => a - b);
    const low = prices[0];
    const median = prices[Math.floor(prices.length / 2)];
    const lowAt = pts.find(p => p.price === low);
    let text, level;
    if (price <= low * 1.02) { text = `Matches its 12-month low (${money(low)}). Good time to buy.`; level = "great"; }
    else if (price <= median * 0.9) { text = `Cheaper than usual (typically ${money(median)}). Its 12-month low is ${money(low)}.`; level = "good"; }
    else { text = `Usually cheaper: it hit ${money(low)} in ${MONTH[new Date(lowAt.t).getUTCMonth()]}. You may want to wait.`; level = "wait"; }
    const next = nextSale(points, now);
    return { spark, text: next ? `${text}\n📅 ${next.text}` : text, level, low, median, next };
}

/**
 * A guess at when the next sale starts, from how often this game has dropped in price before.
 * Needs at least three drops in the history, and says plainly that it is a guess.
 */
export function nextSale(points, now = Date.now()) {
    const pts = (points ?? []).filter(p => Number.isFinite(p.price) && Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
    const starts = [];
    for (let i = 1; i < pts.length; i++) if (pts[i].price <= pts[i - 1].price * 0.9 && (!starts.length || pts[i].t - starts[starts.length - 1] > 5 * DAY)) starts.push(pts[i].t);
    if (starts.length < 3) return null;
    const gaps = starts.slice(1).map((t, i) => t - starts[i]).sort((a, b) => a - b);
    const gap = gaps[Math.floor(gaps.length / 2)];
    if (gap < 10 * DAY) return null;
    const last = starts[starts.length - 1];
    const at = last + gap > now ? last + gap : now + (gap - ((now - last) % gap));
    const d = new Date(at), part = d.getUTCDate() <= 10 ? "early" : d.getUTCDate() <= 20 ? "mid" : "late";
    const weeks = Math.round(gap / (7 * DAY));
    return { at, text: `It has dropped about every ${weeks} week${weeks === 1 ? "" : "s"}. A guess for the next one: ${part} ${MONTH[d.getUTCMonth()]}.` };
}

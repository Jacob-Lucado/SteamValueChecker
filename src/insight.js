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
    return { spark, text, level, low, median };
}

// "Buy now or wait?" from a year of price history: how close today's price is to the low, how often the game has dipped
// to that low, how long ago that was, and whether a big Steam sale is about to start. Advice only: never a promise.
const DAY = 86400_000;

/** points: [{ t, price }] oldest first. price: today's price. sales: upcoming events [{ name, kind, start, end }]. */
export function buyOrWait(points, price, { now = Date.now(), sales = [], past = [], money = n => `$${Number(n).toFixed(2)}` } = {}) {
    const pts = (points ?? []).filter(p => Number.isFinite(p.price) && p.t >= now - 365 * DAY).sort((a, b) => a.t - b.t);
    if (pts.length < 3 || !Number.isFinite(price) || price <= 0) return null;
    const low = Math.min(...pts.map(p => p.price), price);
    const sorted = pts.map(p => p.price).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const over = price / low - 1;                      // how far above the low it is today

    // Distinct dips to within 5% of the low (a new dip needs 7 quiet days since the last one).
    let dips = 0, lastDip = -Infinity, lastLowAt = null;
    for (const p of pts) if (p.price <= low * 1.05) { if (p.t - lastDip > 7 * DAY) dips++; lastDip = p.t; lastLowAt = p.t; }
    const sinceLow = lastLowAt === null ? null : Math.floor((now - lastLowAt) / DAY);
    const sale = sales.find(s => s.kind === "sale" && s.start > now && s.start - now <= 21 * DAY) ?? null;
    const saleIn = sale ? Math.ceil((sale.start - now) / DAY) : null;
    // The oracle: in how many of the big Steam sales that fit in this history did it get within 10% of its low?
    const covered = past.filter(s => s.start >= pts[0].t);
    const hit = covered.filter(s => pts.some(p => p.t >= s.start - DAY && p.t <= s.end && p.price <= low * 1.1)).length;
    const oracle = covered.length >= 2 ? { hit, of: covered.length } : null;
    const reasons = [];
    let verdict;

    if (over <= 0.05) {
        verdict = "buy";
        reasons.push(`At or within 5% of its 12-month low (${money(low)}).`);
    } else if (sale && dips >= 1) {
        verdict = "wait";
        reasons.push(`${sale.name} starts in ${saleIn} day${saleIn === 1 ? "" : "s"}, and this game has dipped to ${money(low)} before.`);
    } else if (price <= median * 0.85 && over <= 0.25) {
        verdict = "lean_buy";
        reasons.push(`Cheaper than its usual ${money(median)}, and only ${Math.round(over * 100)}% above the low.`);
    } else {
        verdict = over > 0.5 || dips >= 2 ? "wait" : "lean_wait";
        reasons.push(`${Math.round(over * 100)}% above its 12-month low of ${money(low)}.`);
    }
    if (dips >= 2) reasons.push(`It has dipped to that low ${dips} times this year${sinceLow !== null && sinceLow > 30 ? `, last ${sinceLow} days ago` : ""}.`);
    else if (dips === 1 && verdict !== "buy") reasons.push("It has only hit that low once this year, so it may not come back soon.");
    if (oracle && oracle.hit >= 1 && verdict !== "buy") reasons.push(`It got within 10% of that low in ${oracle.hit} of the last ${oracle.of} big Steam sales${sale ? ", and one starts soon" : ""}.`);
    else if (oracle && oracle.hit === 0 && verdict !== "buy") reasons.push(`It has not reached its low in any of the last ${oracle.of} big Steam sales, so waiting for one is not a sure thing.`);
    if (sale && verdict !== "wait") reasons.push(`${sale.name} starts in ${saleIn} day${saleIn === 1 ? "" : "s"}.`);

    const label = { buy: "Buy now", lean_buy: "Leaning buy", lean_wait: "Leaning wait", wait: "Wait" }[verdict];
    return { verdict, label, reasons, low, median, dips, sinceLow, saleIn, oracle };
}

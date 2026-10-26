// Turns ITAD price entries into table rows, totals and the paid-vs-value comparison.
// Pure functions with no Discord or network code, so they are easy to test.

const MAJOR_STORES = [
    "steam", "gog", "epic", "humble store", "fanatical", "green man", "gamersgate", "gamesplanet",
    "microsoft", "xbox", "playstation", "nintendo", "ubisoft", "ea app", "origin", "battle.net", "itch"
];

export const isMajorStore = name => MAJOR_STORES.some(s => String(name ?? "").toLowerCase().includes(s));

const num = v => (Number.isFinite(v) ? v : null);

/** Reduces one game's ITAD entry to the numbers the bot shows. */
export function summarize(entry, { majorOnly = false } = {}) {
    const deals = (Array.isArray(entry?.deals) ? entry.deals : []).filter(d => num(d?.price?.amount) !== null);
    const steam = deals.find(d => /^steam$/i.test(d.shop?.name ?? ""));
    const pool = majorOnly ? deals.filter(d => isMajorStore(d.shop?.name)) : deals;

    let best = null;
    for (const d of pool) if (!best || d.price.amount < best.price.amount) best = d;

    const anyRegular = deals.map(d => num(d?.regular?.amount)).find(v => v !== null) ?? null;
    return {
        currency: steam?.price?.currency ?? best?.price?.currency ?? entry?.historyLow?.all?.currency ?? null,
        msrp: num(steam?.regular?.amount) ?? anyRegular,
        steam: num(steam?.price?.amount),
        cut: steam?.cut ?? 0,
        best: best ? { price: best.price.amount, shop: best.shop?.name ?? "?" } : null,
        atl: num(entry?.historyLow?.all?.amount),
        hasPrices: deals.length > 0
    };
}

/** Joins lookup results, price entries and any per-game paid amounts into rows. */
export function buildRows(resolved, pricesById, paidByTitle = new Map(), opts = {}) {
    return resolved.map(r => ({
        title: r.title,
        matched: r.matched ?? r.title,
        approx: Boolean(r.approx),
        found: Boolean(r.id),
        paid: paidByTitle.get(r.title) ?? null,
        ...(r.id ? summarize(pricesById.get(r.id), opts) : { currency: null, msrp: null, steam: null, cut: 0, best: null, atl: null, hasPrices: false })
    }));
}

export function sortRows(rows, mode = "input") {
    const copy = [...rows];
    const desc = f => (a, b) => (f(b) ?? -1) - (f(a) ?? -1);
    switch (mode) {
        case "name": return copy.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
        case "msrp": return copy.sort(desc(r => r.msrp));
        case "cheapest": return copy.sort(desc(r => r.best?.price));
        default: return copy;
    }
}

const sum = (rows, f) => rows.reduce((t, r) => t + (num(f(r)) ?? 0), 0);

export function totals(rows) {
    const found = rows.filter(r => r.found);
    const priced = found.filter(r => r.hasPrices);
    return {
        count: rows.length,
        found: found.length,
        priced: priced.length,
        currency: rows.find(r => r.currency)?.currency ?? "USD",
        msrp: sum(rows, r => r.msrp),
        steam: sum(rows, r => r.steam),
        steamCount: rows.filter(r => r.steam !== null).length,
        best: sum(rows, r => r.best?.price),
        atl: sum(rows, r => r.atl),
        atlCount: rows.filter(r => r.atl !== null).length
    };
}

/** What the user paid: the typed total wins, otherwise the sum of per-game amounts from the file. */
export function resolvePaid(paidOption, rows) {
    if (paidOption != null) return { total: paidOption, source: "entered" };
    const withPaid = rows.filter(r => r.paid !== null);
    if (withPaid.length) return { total: sum(withPaid, r => r.paid), source: "file", games: withPaid.length };
    return null;
}

const BENCHMARKS = [
    ["msrp", "MSRP"],
    ["steam", "Steam now"],
    ["best", "Cheapest now"],
    ["atl", "All-time low"]
];

/** Compares what was paid against each benchmark total. */
export function savingsReport(paid, t, rows) {
    if (!paid) return null;
    const lines = BENCHMARKS
        .filter(([key]) => t[key] > 0)
        .map(([key, label]) => {
            const diff = t[key] - paid.total;
            return { key, label, benchmark: t[key], diff, pct: (diff / t[key]) * 100 };
        });

    const games = paid.source === "file" ? paid.games : t.found;
    const perGame = games > 0 ? paid.total / games : null;

    const withPaid = rows.filter(r => r.paid !== null && r.msrp !== null);
    const biggest = [...withPaid].sort((a, b) => (b.msrp - b.paid) - (a.msrp - a.paid)).slice(0, 3);
    const overpaid = rows.filter(r => r.paid !== null && r.best && r.paid > r.best.price + 0.005);

    const msrp = lines.find(l => l.key === "msrp");
    const best = lines.find(l => l.key === "best");
    const parts = [];
    if (msrp) parts.push(`You paid ${Math.round((paid.total / msrp.benchmark) * 100)}% of MSRP.`);
    if (best) parts.push(best.diff >= 0
        ? "That is less than the cheapest current price."
        : "That is more than the cheapest current price.");
    const verdict = parts.length ? parts.join(" ") : null;

    return { paid: paid.total, source: paid.source, games, perGame, lines, biggest, overpaid, verdict };
}

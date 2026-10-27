// Sale prep: before a Steam sale, sort your wishlist into "buy now" (already at or near its low) and "wait for the sale",
// optionally fit the best of it into a budget. After a sale, recap the drops you were alerted about.
import { summarize } from "./report.js";
import { current, dealVerdict } from "./alerts.js";
import { upcomingSales } from "./salescal.js";
import { UserError } from "./errors.js";

/** Greedy fit: best saving per dollar first, until the budget runs out. */
export function fitBudget(rows, budget) {
    const picks = [];
    let left = budget;
    for (const r of [...rows].sort((a, b) => ((b.regular ?? b.price) - b.price) / b.price - ((a.regular ?? a.price) - a.price) / a.price)) {
        if (r.price <= left + 1e-9) { picks.push(r); left -= r.price; }
    }
    return { picks, spent: budget - left, left };
}

export async function salePrep({ db, itad, user, budget = null, now = Date.now() }) {
    const items = db.listItems(user.discord_id);
    if (!items.length) throw new UserError("Your wishlist is empty. Import it with `/wishlist import` or add games with `/wishlist add`.");
    const prices = await itad.getPrices(items.map(i => i.itad_id), user.region);
    const buyNow = [], wait = [];
    let currency = "USD";
    for (const it of items) {
        const s = summarize(prices.get(it.itad_id), { majorOnly: user.stores === "major" });
        const n = current(s);
        if (n.price === null) continue;
        currency = s.currency ?? currency;
        const v = dealVerdict(n);
        const row = { itad_id: it.itad_id, title: it.title, price: n.price, regular: n.regular, discount: n.discount, shop: n.shop, atl: n.atl, verdict: v?.text ?? null };
        if (v && (v.level === "great" || v.level === "good")) buyNow.push(row);
        else if (n.atl !== null && n.price > n.atl * 1.1) wait.push({ ...row, gap: n.price - n.atl });
    }
    buyNow.sort((a, b) => b.discount - a.discount || a.title.localeCompare(b.title));
    wait.sort((a, b) => b.gap - a.gap || a.title.localeCompare(b.title));
    const sale = upcomingSales(now, { limit: 1, salesOnly: true })[0] ?? null;
    const plan = budget && budget > 0 ? fitBudget(buyNow, budget) : null;
    return { sale, buyNow, wait, plan, budget: budget && budget > 0 ? budget : null, currency, watching: items.length };
}

/** What your alerts caught recently. Only sale alerts that carry both prices count toward savings. */
export function saleRecap(db, userId, { days = 14, now = Date.now() } = {}) {
    const since = now - days * 86400_000;
    const sales = db.listAlerts(userId, 500).filter(a => a.at >= since && (a.kind ?? "sale") === "sale" && a.price !== null);
    const byGame = new Map();
    for (const a of sales) if (!byGame.has(a.itad_id ?? a.title) || a.price < byGame.get(a.itad_id ?? a.title).price) byGame.set(a.itad_id ?? a.title, a);
    const games = [...byGame.values()];
    const priced = games.filter(a => a.regular);
    return {
        days, alerts: sales.length, games: games.length,
        spend: games.reduce((t, a) => t + a.price, 0),
        saved: priced.reduce((t, a) => t + (a.regular - a.price), 0),
        top: [...games].sort((a, b) => ((b.regular ?? 0) - b.price) - ((a.regular ?? 0) - a.price)).slice(0, 8)
    };
}

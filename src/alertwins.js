// Alert wins: a sale alert came, then the game showed up in the member's Steam library within two weeks.
// That's the bot paying for itself, so we add up what the alert saved against the regular price.
const WINDOW = 14 * 86400_000;

/** Rows from db.alertWinRows → one win per game: the earliest alert it followed, and what was saved. */
export function toWins(rows) {
    const by = new Map();
    for (const r of rows) {
        if (!(r.regular > 0) || r.price == null || r.owned_at < r.at || r.owned_at - r.at > WINDOW) continue;
        const paid = r.paid != null && r.paid >= 0 ? r.paid : r.price;
        const saved = Math.max(0, r.regular - paid);
        if (!saved) continue;
        const have = by.get(r.itad_id);
        if (!have || r.at < have.at) by.set(r.itad_id, { itadId: r.itad_id, title: r.title, shop: r.shop, regular: r.regular, paid, saved, at: r.at, ownedAt: r.owned_at, actual: r.paid != null });
    }
    return [...by.values()].sort((a, b) => b.saved - a.saved);
}

export function winsSummary(wins, { since = 0 } = {}) {
    const list = wins.filter(w => w.ownedAt >= since);
    return { count: list.length, saved: Math.round(list.reduce((n, w) => n + w.saved, 0) * 100) / 100, best: list[0] ?? null, list: list.slice(0, 10) };
}

import { REGIONS } from "./constants.js";
export const currencyOfRegion = region => REGIONS.find(r => r.value === region)?.name.match(/\(([A-Z]{3})\)/)?.[1] ?? "USD";
export const winsFor = (db, userId) => toWins(db.alertWinRows(userId));

const money = (n, cur) => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(n); } catch { return n.toFixed(2); } };

export function winsEmbed(sum, cur = "USD") {
    const lines = sum.list.slice(0, 5).map(w => `• **${w.title}**: ${money(w.paid, cur)} instead of ${money(w.regular, cur)}`);
    return {
        embeds: [{
            color: 0xf5c542,
            title: `🏆 Your alerts saved you ${money(sum.saved, cur)} this month`,
            description: `${sum.count === 1 ? "One game" : `${sum.count} games`} you got an alert for ended up in your library.\n\n${lines.join("\n")}`,
            footer: { text: "Steam Value Checker · counted against the regular price · turn off in Alert settings" }
        }]
    };
}

/** Once a month: tell members whose alerts led to a game in their library. Uses the library as stored, no price lookups. */
export async function runAlertWins({ db, notifier, now = () => Date.now() }) {
    const stats = { checked: 0, delivered: 0, failed: 0 };
    const key = `wins:${new Date(now()).toISOString().slice(0, 7)}`;
    for (const user of db.winUsers()) {
        const id = user.discord_id;
        if (db.hasSeen(id, key)) continue;
        stats.checked++;
        const sum = winsSummary(winsFor(db, id), { since: now() - 30 * 86400_000 });
        if (!sum.count) { db.markSeen(id, key); continue; }
        const res = await notifier.deliver(user, winsEmbed(sum, currencyOfRegion(user.region)), "digest");
        if (!res.ok) { stats.failed++; continue; }
        stats.delivered++;
        db.markSeen(id, key);
    }
    return stats;
}

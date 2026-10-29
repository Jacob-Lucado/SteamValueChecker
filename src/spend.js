// What you have spent on games, from the "paid" amounts in your library. Games are placed in the month they were added to the
// library (the closest thing to a purchase date the bot has), so treat the months as approximate. Games with no amount are left out.
import { REGIONS } from "./constants.js";

export const regionCurrency = region => /\(([A-Z]{3})\)/.exec(REGIONS.find(r => r.value === region)?.name ?? "")?.[1] ?? "USD";
const monthOf = ms => new Date(ms).toISOString().slice(0, 7);
const hours = m => (m ?? 0) / 60;

// The extension reports the member's Steam store country. Use it when we price in that region (euro countries share Germany's prices),
// otherwise fall back to the region they set in Discord.
const EURO = new Set(["AT", "BE", "CY", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK", "DE"]);
export function grabberRegion(user, cc) {
    const c = String(cc ?? "").toUpperCase();
    if (/^[A-Z]{2}$/.test(c)) {
        if (REGIONS.some(r => r.value === c)) return c;
        if (EURO.has(c)) return "DE";
        if (c === "UK") return "GB";
    }
    return user?.region ?? "US";
}

export function spendSummary(lib, { now = Date.now(), currency = "USD" } = {}) {
    const paid = lib.filter(g => Number.isFinite(g.paid) && g.paid > 0 && !g.gifted); // gifts were not spent on
    const total = paid.reduce((a, g) => a + g.paid, 0);
    const year = new Date(now).getUTCFullYear();
    const byMonth = new Map();
    for (const g of paid) {
        const k = monthOf(g.added_at);
        const m = byMonth.get(k) ?? { month: k, total: 0, games: 0 };
        m.total += g.paid; m.games++; byMonth.set(k, m);
    }
    // The last 12 months, oldest first, with empty months shown as zero.
    const months = [];
    const d = new Date(now); d.setUTCDate(1);
    for (let n = 11; n >= 0; n--) {
        const k = monthOf(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1));
        months.push(byMonth.get(k) ?? { month: k, total: 0, games: 0 });
    }
    const thisYear = paid.filter(g => new Date(g.added_at).getUTCFullYear() === year);
    const perHour = paid.filter(g => hours(g.minutes) >= 1).map(g => ({ title: g.title, paid: g.paid, hours: hours(g.minutes), perHour: g.paid / hours(g.minutes) }));
    const unplayed = paid.filter(g => hours(g.minutes) < 1 && !["finished", "dropped"].includes(g.status));
    return {
        currency, total: round(total), games: paid.length, avg: paid.length ? round(total / paid.length) : 0,
        year: { year, total: round(thisYear.reduce((a, g) => a + g.paid, 0)), games: thisYear.length },
        months: months.map(m => ({ ...m, total: round(m.total) })),
        bestValue: [...perHour].sort((a, b) => a.perHour - b.perHour).slice(0, 5).map(r),
        worstValue: perHour.filter(g => g.hours >= 1).sort((a, b) => b.perHour - a.perHour).slice(0, 5).map(r),
        unplayed: { count: unplayed.length, total: round(unplayed.reduce((a, g) => a + g.paid, 0)) },
        tracked: lib.length
    };
}
const round = n => Math.round(n * 100) / 100;
const r = g => ({ title: g.title, paid: round(g.paid), hours: Math.round(g.hours * 10) / 10, perHour: round(g.perHour) });

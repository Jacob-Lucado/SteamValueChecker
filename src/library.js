// The member's library: games they own, what they paid, and what that adds up to.
import { summarize } from "./report.js";
import { UserError } from "./errors.js";

const sum = (arr, f) => arr.reduce((t, x) => t + (Number.isFinite(f(x)) ? f(x) : 0), 0);

/** Totals from library rows. "Saved" only counts games that have a paid price. */
export function libraryTotals(rows) {
    const withPaid = rows.filter(r => r.paid !== null);
    const paid = sum(withPaid, r => r.paid);
    const msrpPaid = sum(withPaid, r => r.msrp);
    return {
        games: rows.length,
        paidGames: withPaid.length,
        paid,
        msrp: sum(rows, r => r.msrp),
        msrpPaid,
        cheapest: sum(rows, r => r.best?.price),
        atl: sum(rows, r => r.atl),
        saved: msrpPaid - paid,
        savedPct: msrpPaid > 0 ? ((msrpPaid - paid) / msrpPaid) * 100 : 0
    };
}

/** Rows, totals and history for one member. Also records today's snapshot so charts and leaderboards stay fresh. */
export async function libraryView(db, itad, user, { snapshot = true } = {}) {
    const items = db.listLibrary(user.discord_id);
    const prices = items.length ? await itad.getPrices(items.map(i => i.itad_id), user.region) : new Map();
    const rows = items.map(it => {
        const s = summarize(prices.get(it.itad_id), { majorOnly: user.stores === "major" });
        return {
            itad_id: it.itad_id, title: it.title, paid: it.paid, currency: s.currency,
            msrp: s.msrp, best: s.best, atl: s.atl,
            saved: it.paid !== null && s.msrp !== null ? s.msrp - it.paid : null
        };
    });
    const totals = libraryTotals(rows);
    if (snapshot && rows.length) {
        db.upsertSnapshot(user.discord_id, { games: totals.games, paid: totals.paid, msrp: totals.msrp, msrp_paid: totals.msrpPaid, cheapest: totals.cheapest });
    }
    return { rows, totals, currency: rows.find(r => r.currency)?.currency ?? "USD", snapshots: db.listSnapshots(user.discord_id) };
}

export class LibraryError extends UserError {}

/**
 * Adds games with what was paid. `entries` are { title, paid } (paid may be null).
 * Titles are matched through ITAD; approximate matches use the matched name.
 */
export async function importLibrary(db, itad, userId, entries) {
    const clean = entries.filter(e => e && String(e.title ?? "").trim());
    if (!clean.length) throw new LibraryError("Nothing to add.");
    const resolved = await itad.lookupTitles(clean.map(e => String(e.title).trim().slice(0, 120)));
    const games = [];
    const notFound = [];
    resolved.forEach((r, i) => {
        if (!r.id) { notFound.push(r.title); return; }
        const paid = clean[i].paid;
        games.push({ itad_id: r.id, title: r.approx ? r.matched : r.title, paid: Number.isFinite(paid) && paid >= 0 ? paid : null });
    });
    const res = games.length ? db.upsertLibrary(userId, games) : { added: 0, updated: 0, skippedForLimit: 0 };
    return { ...res, notFound };
}

/**
 * Who has saved the most of their MSRP, among members who opted in. Ranked by percent, because members
 * shop in different currencies. Returns [{ discord_id, savedPct, games }].
 */
export function leaderboard(db, guildId, { limit = 10 } = {}) {
    return db.sharedLeaderboard(guildId)
        .filter(r => r.msrp_paid > 0 && r.paid > 0)
        .map(r => ({ discord_id: r.discord_id, savedPct: ((r.msrp_paid - r.paid) / r.msrp_paid) * 100, games: r.games }))
        .sort((a, b) => b.savedPct - a.savedPct)
        .slice(0, limit);
}

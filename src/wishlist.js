// Wishlist logic that does not depend on Discord: finding games, building the overview rows.

import { summarize } from "./report.js";
import { current, describeTrigger } from "./alerts.js";

/** Finds one of the user's games by title. Returns { item } | { ambiguous: [titles] } | { none: true }. */
export function findItem(items, query) {
    const q = String(query ?? "").trim().toLowerCase();
    if (!q) return { none: true };
    const exact = items.filter(i => i.title.toLowerCase() === q);
    if (exact.length === 1) return { item: exact[0] };
    const partial = items.filter(i => i.title.toLowerCase().includes(q));
    if (partial.length === 1) return { item: partial[0] };
    if (partial.length > 1) return { ambiguous: partial.slice(0, 5).map(i => i.title) };
    return { none: true };
}

/** Matching titles for slash-command autocomplete (Discord allows 25 choices of up to 100 characters). */
export function suggest(items, typed) {
    const q = String(typed ?? "").trim().toLowerCase();
    return items
        .filter(i => !q || i.title.toLowerCase().includes(q))
        .slice(0, 25)
        .map(i => ({ name: i.title.slice(0, 100), value: i.title.slice(0, 100) }));
}

/** Overview rows, games on sale first. */
export async function viewRows(db, itad, user) {
    const items = db.listItems(user.discord_id);
    if (!items.length) return { rows: [], currency: "USD" };
    const prices = await itad.getPrices(items.map(i => i.itad_id), user.region);
    const rows = items.map(it => {
        const s = summarize(prices.get(it.itad_id), { majorOnly: user.stores === "major" });
        const now = current(s);
        return { title: it.title, best: s.best, discount: now.discount, alert: describeTrigger(it), currency: s.currency };
    });
    rows.sort((a, b) => b.discount - a.discount || a.title.localeCompare(b.title));
    return { rows, currency: rows.find(r => r.currency)?.currency ?? "USD" };
}

/** Plain-JSON copy of everything stored about a user, for /mydata export. */
export function exportJson(db, userId) {
    const data = db.exportUser(userId);
    if (!data) return null;
    const { user, items } = data;
    return JSON.stringify({
        note: "Everything Steam Value Checker stores about you.",
        settings: {
            region: user.region, stores: user.stores, delivery: user.delivery, paused: Boolean(user.paused),
            steam_id: user.steam_id, server_id: user.guild_id
        },
        wishlist: items.map(i => ({
            title: i.title, itad_id: i.itad_id, source: i.source,
            alert: describeTrigger(i), last_alert_price: i.last_alert_price
        }))
    }, null, 2);
}

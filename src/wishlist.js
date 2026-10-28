// Wishlist logic that does not depend on Discord: finding games, building the overview rows.

import { summarize } from "./report.js";
import { current, describeTrigger, parseTrigger, dealVerdict } from "./alerts.js";

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
    const owned = new Set(db.listLibrary(user.discord_id).map(x => x.itad_id));
    const rows = items.map(it => {
        const s = summarize(prices.get(it.itad_id), { majorOnly: user.stores === "major" });
        const now = current(s);
        return {
            owned: owned.has(it.itad_id), priority: Boolean(it.priority),
            itad_id: it.itad_id, title: it.title, source: it.source,
            best: s.best, regular: now.regular, atl: now.atl, discount: now.discount, currency: s.currency,
            alert: describeTrigger(it), trigger_type: it.trigger_type, trigger_value: it.trigger_value,
            low1y: now.low1y, low3m: now.low3m, verdict: dealVerdict(now),
            release_at: it.release_at && it.release_at > Date.now() ? it.release_at : null
        };
    });
    rows.sort((a, b) => Number(a.owned) - Number(b.owned) || Number(b.priority) - Number(a.priority) || b.discount - a.discount || a.title.localeCompare(b.title));
    return { rows, currency: rows.find(r => r.currency)?.currency ?? "USD" };
}

/** Plain-JSON copy of everything stored about a user, for /mydata export. */
export function exportJson(db, userId) {
    const data = db.exportUser(userId);
    if (!data) return null;
    const { user, items, library, alerts } = data;
    return JSON.stringify({
        note: "Everything Steam Value Checker stores about you.",
        settings: {
            region: user.region, stores: user.stores, delivery: user.delivery, paused: Boolean(user.paused),
            steam_id: user.steam_id, server_id: user.guild_id,
            quiet_hours: user.quiet_start === null || user.quiet_start === undefined ? null : { start_minutes: user.quiet_start, end_minutes: user.quiet_end },
            time_zone: user.tz, weekly_digest: Boolean(user.digest), digest_day: user.digest_day,
            bundle_alerts: user.bundles !== 0, shared_with_server: Boolean(user.share)
        },
        library: (library ?? []).map(l => ({ title: l.title, itad_id: l.itad_id, paid: l.paid })),
        alert_history: (alerts ?? []).map(a => ({ at: new Date(a.at).toISOString(), kind: a.kind, title: a.title, price: a.price, shop: a.shop, via: a.via })),
        wishlist: items.map(i => ({
            title: i.title, itad_id: i.itad_id, source: i.source,
            alert: describeTrigger(i), last_alert_price: i.last_alert_price
        }))
    }, null, 2);
}

export class WishlistError extends Error {}

/** Looks a title up and adds it with an alert rule. Shared by the Discord command and the dashboard. */
export async function addGameByTitle(db, itad, userId, rawTitle, type, value, { source = "manual" } = {}) {
    let trig;
    try { trig = parseTrigger(type, value); } catch (e) { throw new WishlistError(e.message); }
    const title = String(rawTitle ?? "").trim().slice(0, 100);
    if (!title) throw new WishlistError("Type a game title.");

    const [hit] = await itad.lookupTitles([title]);
    if (!hit?.id) throw new WishlistError(`I could not find a game called ${title}. Check the spelling or try the full title.`);

    const name = hit.approx ? hit.matched : title;
    const res = db.addItems(userId, [{ itad_id: hit.id, title: name }], { trigger: trig.type, value: trig.value, source });
    if (res.skippedForLimit) throw new WishlistError("Your list is full (200 games). Remove one first.");
    if (res.existing) throw new WishlistError(`${name} is already on your list.`);
    return { name, approx: hit.approx, trigger: describeTrigger({ trigger_type: trig.type, trigger_value: trig.value }) };
}

/** Stores the result of steam.importWishlist(). Shared by the Discord command and the dashboard. */
export function applySteamImport(db, userId, r) {
    if (!r.games.length) throw new WishlistError("I read the wishlist, but none of those games could be matched to price data.");
    const res = db.addItems(userId, r.games, { source: "steam" });
    for (const g of r.games) if (Number.isInteger(g.appid)) db.setAppId(userId, g.itad_id, g.appid);
    db.updateUser(userId, { steam_id: r.steamid });
    const pruned = r.complete ? db.removeSteamNotIn(userId, r.games.map(g => g.itad_id)) : 0;
    return { ...res, pruned, unmatched: r.unmatched, truncated: r.truncated, total: r.total, rateLimited: Boolean(r.rateLimited) };
}

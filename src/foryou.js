// "For you": current discounts ranked by how well each game fits your taste and wishlist.
// Taste comes from the hours in your synced library (Steam's public genres); owned games are left out.
import { tasteProfile } from "./taste.js";
import { refreshTags } from "./taste.js";
import { summarize } from "./report.js";

/**
 * Returns { deals, pending, currency, genres }. `pending` is how many candidate games still lack genres (the page asks again).
 * Each deal: { id, title, appid, match (0-99 or null), cut, price, regular, currency, shop, url, atl, wishlist, genres }.
 */
export async function forYou({ db, itad, userId, user, fetchImpl = globalThis.fetch, tagBudget = 20 }) {
    const profile = tasteProfile(db, userId);
    const owned = new Set(db.listLibrary(userId).map(g => Number(g.appid)).filter(Boolean));
    const wish = new Set(db.listItems(userId).map(i => i.itad_id));
    const pool = (await itad.getDealsPool({ country: "US", pages: 3 })).filter(d => d.cut >= 15 && !(d.appid && owned.has(d.appid))).slice(0, 150);

    const appids = pool.map(d => d.appid).filter(Boolean);
    let tags = db.getAppTags(appids);
    const missing = appids.filter(a => !tags.has(a));
    if (missing.length && tagBudget) {
        await refreshTags({ db, appids: missing.slice(0, tagBudget), fetchImpl, delayMs: 120 });
        tags = db.getAppTags(appids);
    }
    const pending = appids.filter(a => !tags.has(a)).length;

    const prices = pool.length ? await itad.getPrices(pool.map(d => d.id), user.region) : new Map();
    const share = new Map(profile.genres.map(g => [g.name, g.share]));
    const top = profile.genres.slice(0, 2).reduce((t, g) => t + g.share, 0) || 1;
    const deals = [];
    for (const d of pool) {
        const sum = summarize(prices.get(d.id), { majorOnly: user.stores === "major" });
        const price = sum.best?.price ?? d.price, regular = sum.msrp ?? d.regular;
        const cut = regular > 0 ? Math.max(0, Math.round((1 - price / regular) * 100)) : d.cut;
        const genres = tags.get(d.appid)?.genres ?? [];
        const fit = genres.reduce((t, g) => t + (share.get(g) ?? 0), 0) / top;
        const match = genres.length && profile.genres.length ? Math.min(99, Math.round(50 + 49 * Math.min(1, fit))) : null;
        const atl = sum.atl !== null && price <= sum.atl * 1.001;
        const wishlist = wish.has(d.id);
        deals.push({
            id: d.id, title: d.title, appid: d.appid, match, cut, price, regular, currency: sum.currency ?? d.currency, shop: sum.best?.shop ?? "Steam",
            url: sum.best?.url ?? d.url, atl, wishlist, genres: genres.slice(0, 3),
            rank: (match ?? 55) * 0.6 + Math.min(cut, 90) * 0.3 + (atl ? 8 : 0) + (wishlist ? 10 : 0)
        });
    }
    deals.sort((a, b) => b.rank - a.rank);
    return { deals: deals.map(({ rank, ...x }) => x), pending, currency: deals[0]?.currency ?? "USD", genres: profile.genres.slice(0, 5).map(g => g.name), personalised: profile.genres.length > 0 };
}

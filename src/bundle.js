// "Is this bundle worth it?" For each active bundle with a game you want, works out every tier's price against what
// the games would cost you today, leaving out games you already own. Pure analysis plus the lookups.
import { summarize } from "./report.js";
import { UserError } from "./errors.js";

const MAX_BUNDLES = 3, MAX_GAMES = 60;

/**
 * One bundle. `tiers` are cheapest first and are treated as cumulative (a higher tier includes the lower ones),
 * which is how most bundles work. `price(id)` is today's cheapest price for a game, or null.
 */
export function analyzeBundle(bundle, { owned = new Set(), wanted = new Set(), price = () => null } = {}) {
    const seen = new Set();
    const tiers = [];
    for (const t of bundle.tiers) {
        for (const g of t.games) seen.add(g.id);
        const games = bundle.tiers.filter(x => x.price <= t.price).flatMap(x => x.games);
        const unique = [...new Map(games.map(g => [g.id, g])).values()];
        const fresh = unique.filter(g => !owned.has(g.id));
        const priced = fresh.filter(g => price(g.id) !== null);
        const worth = priced.reduce((s, g) => s + price(g.id), 0);
        tiers.push({
            price: t.price, games: unique.length, newToYou: fresh.length, owned: unique.length - fresh.length,
            wanted: unique.filter(g => wanted.has(g.id)).map(g => g.title),
            unpriced: fresh.length - priced.length, worth, saves: worth - t.price,
            ratio: worth > 0 ? t.price / worth : null,
            titles: unique.map(g => g.title)
        });
    }
    // Prefer a tier that adds at least two games you don't have, then the best price against value.
    const pool = tiers.filter(t => t.worth > 0), multi = pool.filter(t => t.newToYou >= 2);
    const best = [...(multi.length ? multi : pool)].sort((a, b) => (a.ratio - b.ratio) || (b.newToYou - a.newToYou))[0] ?? null;
    let verdict;
    if (!best) verdict = { level: "info", text: "Not enough price data to judge this one." };
    else if (best.ratio <= 0.5 && best.newToYou >= 2) verdict = { level: "great", text: `Good value: the ${best.price.toFixed(2)} tier gets you games worth about ${best.worth.toFixed(2)} that you don't own.` };
    else if (best.ratio < 0.9) verdict = { level: "good", text: "Decent, but check each game: the savings are modest." };
    else verdict = { level: "wait", text: "Buying these separately is about as cheap, or cheaper." };
    return { ...bundle, tiers, best, verdict, totalGames: seen.size };
}

/**
 * Bundles that include `gameIds` (a game you asked about, or your wishlist), analysed for this member.
 * Returns { bundles, currency }. Throws UserError when there is nothing to look at.
 */
export async function bundleCheck({ db, itad, user, gameIds }) {
    const ids = [...new Set(gameIds)].slice(0, 200);
    if (!ids.length) throw new UserError("Name a game, or add games to your wishlist so I know what to look for.");
    const found = await itad.getBundleDetails(ids, user.region);
    if (!found.length) return { bundles: [], currency: "USD" };
    const owned = new Set(db.listLibrary(user.discord_id).map(l => l.itad_id));
    const wanted = new Set(db.listItems(user.discord_id).map(i => i.itad_id));
    const ranked = found.sort((a, b) => b.matches.length - a.matches.length || (a.expiry ?? Infinity) - (b.expiry ?? Infinity)).slice(0, MAX_BUNDLES);
    const gameIdsToPrice = [...new Set(ranked.flatMap(b => b.tiers.flatMap(t => t.games.map(g => g.id))))].slice(0, MAX_GAMES * MAX_BUNDLES);
    let prices = new Map();
    try { prices = await itad.getPrices(gameIdsToPrice, user.region); } catch { /* still shows tiers without values */ }
    const priceOf = id => summarize(prices.get(id), { majorOnly: user.stores === "major" }).best?.price ?? null;
    const bundles = ranked.map(b => analyzeBundle(b, { owned, wanted, price: priceOf }));
    return { bundles, currency: ranked[0].currency ?? "USD" };
}

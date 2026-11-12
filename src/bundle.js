// "Is this bundle worth it?" For each active bundle with a game you want, works out every tier's price against what
// the games would cost you today, leaving out games you already own. Pure analysis plus the lookups.
import { summarize } from "./report.js";
import { UserError } from "./errors.js";
import { similarity } from "./itad.js";
import { parseMoney } from "./parse.js";

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
 * Bundles that include `gameIds` (a game you asked about, or your wishlist), analyzed for this member.
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

/** A bundle page's address without the bits that vary: "www.", a language folder (/en/), the query and a trailing slash. */
export function bundleLinkKey(link) {
    try {
        const u = new URL(String(link).trim());
        if (!/^https?:$/.test(u.protocol)) return null;
        return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/^\/[a-z]{2}(-[a-z]{2})?(?=\/)/i, "").replace(/\/+$/, "")).toLowerCase();
    } catch { return null; }
}

/**
 * "Is this bundle worth it?" from the bundle page's link. The bundle is found among the ones the bundle feed already
 * follows (Humble, Fanatical, IndieGala, Steam), so nothing is fetched from the store here. When the price site knows
 * the bundle's tiers those are used; otherwise it is judged as one tier at the price the store shows.
 */
export async function bundleFromLink({ db, itad, user, link }) {
    const key = bundleLinkKey(link);
    if (!key) throw new UserError("That doesn't look like a link to a bundle page.");
    const row = db.listFeedBundles({ status: "active", limit: 200 }).find(b => bundleLinkKey(b.url) === key);
    if (!row) throw new UserError("I don't know that bundle. I follow the current bundles on Humble, Fanatical, IndieGala and Steam; for anything else, name a game from it instead.");
    const names = (row.games ?? []).slice(0, MAX_GAMES);
    if (!names.length) throw new UserError(`I know **${row.title}**, but the store hasn't listed its games yet. Name a game from it instead.`);
    const games = (await itad.lookupTitles(names)).filter(r => r.id).map(r => ({ id: r.id, title: r.approx ? r.matched : r.title }));
    if (!games.length) throw new UserError(`I couldn't match the games in **${row.title}** to prices.`);

    let known = { bundles: [], currency: "USD" };
    try { known = await bundleCheck({ db, itad, user, gameIds: games.map(g => g.id) }); } catch { /* judged from the store's own listing below */ }
    const same = known.bundles.find(b => bundleLinkKey(b.url ?? "") === key || similarity(b.title, row.title) >= 0.8);
    if (same) return { bundles: [same], currency: known.currency };

    const price = parseMoney(row.price);
    if (price === null) throw new UserError(`I know **${row.title}** but not its price yet.`);
    const owned = new Set(db.listLibrary(user.discord_id).map(l => l.itad_id));
    const wanted = new Set(db.listItems(user.discord_id).map(i => i.itad_id));
    let prices = new Map();
    try { prices = await itad.getPrices(games.map(g => g.id), user.region); } catch { /* still shows the tier without values */ }
    const priceOf = id => summarize(prices.get(id), { majorOnly: user.stores === "major" }).best?.price ?? null;
    const bundle = { id: row.key, title: row.title, shop: row.store, url: row.url, expiry: row.expires_at ?? null, currency: "USD", tiers: [{ price, currency: "USD", games }], matches: [] };
    return { bundles: [analyzeBundle(bundle, { owned, wanted, price: priceOf })], currency: "USD" };
}

/** What someone typed into the bundle check: a bundle page link, a game, or nothing (their wishlist). */
export async function bundleLookup({ db, itad, user, query }) {
    const q = String(query ?? "").trim();
    if (/^https?:\/\//i.test(q) && !/store\.steampowered\.com\/app\//i.test(q)) return { ...(await bundleFromLink({ db, itad, user, link: q })), from: "link" };
    if (q) {
        const [hit] = await itad.lookupTitles([q.slice(0, 300)]);
        if (!hit?.id) throw new UserError(`I could not find a game called ${q}.`);
        return { ...(await bundleCheck({ db, itad, user, gameIds: [hit.id] })), from: "game" };
    }
    return { ...(await bundleCheck({ db, itad, user, gameIds: db.listItems(user.discord_id).map(x => x.itad_id) })), from: "wishlist" };
}

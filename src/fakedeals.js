// Some Steam listings put an outrageous price on a game, then "discount" it by 90% or more so it looks like a steal.
// A deal that fits that shape is only trusted when real players have reviewed the game.
const MIN_REGULAR = 30, MIN_CUT = 80, MAX_PRICE = 12, MIN_REVIEWS = 300;

/** True when the numbers look like an inflated sticker price: a high "regular" price cut to a few dollars. */
export function looksInflated(d) {
    return Boolean(d) && Number(d.regular) >= MIN_REGULAR && Number(d.cut) >= MIN_CUT && Number(d.price) <= MAX_PRICE;
}

/** Drops the suspicious deals that have no audience behind them. `reviewsFn(appid)` gives `{ total }` or null. */
export async function dropInflated(deals, reviewsFn, { minReviews = MIN_REVIEWS } = {}) {
    const list = Array.isArray(deals) ? deals : [];
    const keep = await Promise.all(list.map(async d => {
        if (!looksInflated(d)) return true;
        if (!d.appid) return false;
        const r = await Promise.resolve(reviewsFn(d.appid)).catch(() => null);
        return Boolean(r) && r.total >= minReviews;
    }));
    return list.filter((_, i) => keep[i]);
}

/** Wraps an ITAD client so every deals list it hands out has been through the check. */
export function withoutInflated(itad, reviewsFn) {
    for (const name of ["getDealsPool", "getHotDeals"]) {
        const base = itad[name].bind(itad);
        itad[name] = async (...args) => dropInflated(await base(...args), reviewsFn);
    }
    return itad;
}

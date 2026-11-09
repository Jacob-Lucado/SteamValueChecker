// Every link the bot posts to a deal can go through a page on the site first: it shows the deal, counts the visit, then sends the person
// on to the store. This is the one place that decides it. Until index.js sets it up (and in tests), links just go straight to the store.
let cfg = null;

/** `make(deal)` returns the page address for a free game or bundle, or null. `base` is the site's address, for bundle-feed pages. */
export function configureDeals(next) { cfg = next; }

/** The address to put in a post for a deal: { key, kind, title, shop, url, image, price, games, blurb, expiry }. Falls back to the store's own link. */
export function dealUrl(deal) {
    try { return cfg?.make?.(deal) || deal.url; } catch { return deal.url; }
}
/** The page for a bundle from the feed, or null when there's no site address to put on it. */
export function bundlePageUrl(id) {
    return cfg?.base && id ? `${String(cfg.base).replace(/\/+$/, "")}/b/${id}` : null;
}

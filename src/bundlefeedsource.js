// Where new game bundles come from: Humble, Fanatical, IndieGala and the Steam store's own bundle list.
// None of them has an official feed, so each one is read from the public page or listing the site itself uses. Every source
// is checked on its own: one site changing its layout or being down never hides the others, and the poll result says which failed.

export class BundleFeedError extends Error {}

export const BUNDLE_STORES = {
    humble: { name: "Humble Bundle", emoji: "💚", color: 0xcb272c, home: "https://www.humblebundle.com/bundles" },
    fanatical: { name: "Fanatical", emoji: "⚡", color: 0xff7a00, home: "https://www.fanatical.com/en/bundle" },
    indiegala: { name: "IndieGala", emoji: "🟣", color: 0x8b4fe0, home: "https://www.indiegala.com/bundles" },
    steam: { name: "Steam", emoji: "🎮", color: 0x1b9ad6, home: "https://store.steampowered.com/bundles/" }
};
export const BUNDLE_STORE_KEYS = Object.keys(BUNDLE_STORES);

const UA = "Mozilla/5.0 (compatible; SteamValueChecker Discord bot)";
const text = t => String(t ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#8217;/g, "'").replace(/&reg;|&trade;/g, "").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));
const https = u => { try { const x = new URL(u); return x.protocol === "https:" ? x.href : null; } catch { return null; } };
const money = n => (Number.isFinite(n) ? "$" + (Number.isInteger(n) ? n : n.toFixed(2)) : null);
const time = v => { const t = Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(String(v)) ? v : String(v ?? "") + "Z"); return Number.isFinite(t) ? t : null; };

async function get(fetchImpl, url, timeoutMs, accept = "text/html") {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "en-US,en;q=0.8" } });
    if (!res.ok) throw new BundleFeedError(`${new URL(url).host} answered ${res.status}`);
    return res;
}
const tidy = (b, now) => {
    const title = clip(text(b.title), 150), url = https(b.url);
    if (!title || !url || !b.id) return null;
    const games = [...new Set((b.games ?? []).map(g => clip(text(g), 90)).filter(Boolean))].slice(0, 60);
    return { key: `${b.store}:${b.id}`, store: b.store, title, url, image: https(b.image), games, gameCount: Number.isFinite(b.gameCount) && b.gameCount > 0 ? b.gameCount : games.length || null,
        price: b.price ? clip(text(b.price), 80) : null, kind: b.kind ?? null, expiresAt: Number.isFinite(b.expiresAt) && b.expiresAt > 0 ? b.expiresAt : null, seenAt: now };
};

// ---------------------------------------------------------------- Humble Bundle
const scriptJson = (html, id) => {
    const m = new RegExp(`<script[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)</script>`, "i").exec(String(html ?? ""));
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch { return null; }
};
/** The bundles page lists every running bundle in a JSON block; games bundles sit under data.games.mosaic. */
export function parseHumbleList(html, now = Date.now()) {
    const json = scriptJson(html, "landingPage-json-data");
    const out = [];
    for (const sec of json?.data?.games?.mosaic ?? []) for (const p of sec?.products ?? []) {
        const path = String(p.product_url ?? "");
        if (!path.startsWith("/games/")) continue;
        const b = tidy({ store: "humble", id: p.machine_name ?? path.slice(7), title: p.tile_name ?? p.tile_short_name, url: "https://www.humblebundle.com" + path, image: p.high_res_tile_image ?? p.tile_image,
            kind: "tiered", expiresAt: time(p["end_date|datetime"] ?? p.end_date) }, now);
        if (b) out.push(b);
    }
    return out;
}
/** A bundle's own page names every game in it and each tier's price. */
export function parseHumbleDetail(html) {
    const data = scriptJson(html, "webpack-bundle-data")?.bundleData ?? {};
    const games = Object.values(data.tier_item_data ?? {}).map(x => x?.human_name).filter(Boolean);
    const prices = [...new Set(Object.values(data.tier_pricing_data ?? {}).map(x => Number(x?.["price|money"]?.amount ?? x?.price?.amount)).filter(n => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
    return { games, price: prices.length ? prices.map(money).join(" / ") : null };
}
export async function fetchHumble({ fetchImpl, now, timeoutMs }) {
    const list = parseHumbleList(await (await get(fetchImpl, BUNDLE_STORES.humble.home, timeoutMs)).text(), now);
    for (const b of list.slice(0, 10)) {
        try { const d = parseHumbleDetail(await (await get(fetchImpl, b.url, timeoutMs)).text()); if (d.games.length) { b.games = d.games.slice(0, 60); b.gameCount = d.games.length; } if (d.price) b.price = d.price; } catch { /* the bundle still posts without its game list */ }
    }
    return list;
}

// ---------------------------------------------------------------- Fanatical
const FAN_CDN = "https://cdn.fanatical.com/production/product/original/";
/** Fanatical's own bundle listing (the one its bundles page loads). Field names are read loosely so a small rename does not break it. */
export function parseFanatical(json, now = Date.now()) {
    const items = [json?.hits, json?.bundles, json?.results, json?.data, Array.isArray(json) ? json : null].find(Array.isArray) ?? [];
    const out = [];
    for (const x of items) {
        const slug = x.slug ?? x.url_slug; const title = x.name ?? x.title;
        if (!slug || !title) continue;
        const img = x.cover_image ?? x.coverImage ?? x.image;
        const tiers = Array.isArray(x.tiers) ? x.tiers : Array.isArray(x.bundles) ? x.bundles : [];
        const price = tiers.map(t => Number(t?.price?.USD ?? t?.price)).filter(n => Number.isFinite(n) && n > 0).map(n => money(n > 500 ? n / 100 : n)).join(" / ") || (x.price?.USD ? money(Number(x.price.USD) / 100) : null);
        const kind = String(x.display_type ?? x.type ?? "");
        const b = tidy({ store: "fanatical", id: slug, title, url: `https://www.fanatical.com/en/bundle/${slug}`, image: img ? (/^https?:/.test(img) ? img : FAN_CDN + img) : null,
            gameCount: Number(x.game_count ?? x.games_count ?? x.product_count) || (Array.isArray(x.games) ? x.games.length : null), games: Array.isArray(x.games) ? x.games.map(g => g?.name ?? g).filter(g => typeof g === "string") : [],
            price: price || (/pick/i.test(kind) ? "Pick and mix" : /tier/i.test(kind) ? "Tiered" : null), kind, expiresAt: time(x.available_valid_until ?? x.valid_until ?? x.end_date) }, now);
        if (b) out.push(b);
    }
    return out;
}
export async function fetchFanatical({ fetchImpl, now, timeoutMs }) {
    return parseFanatical(await (await get(fetchImpl, "https://www.fanatical.com/api/algolia/bundles?altRank=false&page=0", timeoutMs, "application/json")).json(), now);
}

// ---------------------------------------------------------------- IndieGala
/** The bundles page is plain HTML: each bundle is a link to /bundle/<name> around its picture and title. */
export function parseIndieGala(html, now = Date.now()) {
    const out = new Map();
    for (const m of String(html ?? "").matchAll(/<a\b[^>]*href=["']((?:https:\/\/www\.indiegala\.com)?\/bundle\/([a-z0-9][a-z0-9_-]*))\/?["'][^>]*>([\s\S]{0,1500}?)<\/a>/gi)) {
        const slug = m[2].toLowerCase(); if (out.has(slug)) continue;
        const inner = m[3];
        const title = text(/alt=["']([^"']{3,})["']/i.exec(inner)?.[1] ?? /(?:title|name)[^>]*>([^<]{3,})</i.exec(inner)?.[1] ?? inner);
        const img = /(?:data-src|src)=["'](https?:[^"']+\.(?:jpe?g|png|webp)[^"']*|\/\/[^"']+\.(?:jpe?g|png|webp)[^"']*)["']/i.exec(inner)?.[1];
        const b = tidy({ store: "indiegala", id: slug, title: title.replace(/\s+bundle$/i, " Bundle"), url: "https://www.indiegala.com/bundle/" + slug, image: img ? (img.startsWith("//") ? "https:" + img : img) : null }, now);
        if (b && b.title.length > 3) out.set(slug, b);
    }
    return [...out.values()];
}
export async function fetchIndieGala({ fetchImpl, now, timeoutMs }) { return parseIndieGala(await (await get(fetchImpl, BUNDLE_STORES.indiegala.home, timeoutMs)).text(), now); }

// ---------------------------------------------------------------- Steam bundles
export const STEAM_BUNDLES_URL = "https://store.steampowered.com/search/results/?query&start=0&count=50&category1=996&sort_by=Released_DESC&infinite=1&cc=us&l=english";
/** Steam's search results for bundles, newest first. Steam shows a price and a discount; no end date. */
export function parseSteamBundles(json, now = Date.now()) {
    const out = [];
    for (const row of String(json?.results_html ?? "").split(/<a\b/i).slice(1)) {
        const id = /store\.steampowered\.com\/bundle\/(\d+)/i.exec(row)?.[1] ?? /data-ds-bundleid=["'](\d+)/i.exec(row)?.[1];
        if (!id) continue;
        const title = text(/<span class="title">([\s\S]*?)<\/span>/i.exec(row)?.[1]);
        const off = /discount_pct">\s*-?(\d+)%/i.exec(row)?.[1];
        const final = text(/discount_final_price">([\s\S]*?)<\/div>/i.exec(row)?.[1]);
        const img = /<img[^>]+src=["']([^"']+)["']/i.exec(row)?.[1];
        const b = tidy({ store: "steam", id, title, url: `https://store.steampowered.com/bundle/${id}/`, image: img, kind: "fixed",
            price: final ? (off ? `${final} (${off}% off)` : final) : null }, now);
        if (b) out.push(b);
    }
    return out;
}
export async function fetchSteamBundles({ fetchImpl, now, timeoutMs }) { return parseSteamBundles(await (await get(fetchImpl, STEAM_BUNDLES_URL, timeoutMs, "application/json")).json(), now); }

// ---------------------------------------------------------------- all of them
const FETCHERS = { humble: fetchHumble, fanatical: fetchFanatical, indiegala: fetchIndieGala, steam: fetchSteamBundles };

/**
 * Every store at once. `complete` names the stores that answered with at least one bundle; only for those is a bundle that is no
 * longer listed treated as over. Throws only when nothing at all could be read.
 */
export async function fetchAllBundles({ fetchImpl = globalThis.fetch, now = Date.now(), timeoutMs = 20_000 } = {}) {
    const bundles = [], complete = [], errors = [];
    await Promise.all(Object.entries(FETCHERS).map(async ([store, fn]) => {
        try {
            const list = await fn({ fetchImpl, now, timeoutMs });
            if (!list.length) throw new BundleFeedError("no bundles could be read from the page");
            bundles.push(...list); complete.push(store);
        } catch (err) { errors.push(`${BUNDLE_STORES[store].name}: ${err.message ?? err}`); }
    }));
    if (!bundles.length) throw new BundleFeedError(errors.join("; ") || "no bundles");
    return { bundles, complete, errors };
}

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
    if (/^bundles?$/i.test(title)) return null;
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
    try {
        const list = parseFanatical(await (await get(fetchImpl, "https://www.fanatical.com/api/algolia/bundles?altRank=false&page=0", timeoutMs, "application/json")).json(), now);
        if (list.length) return list;
    } catch { /* Fanatical turns away most server requests (403), so IsThereAnyDeal's bundle pages are the way in */ }
    return fetchViaItad("Fanatical", "fanatical", { fetchImpl, now, timeoutMs });
}

// ---------------------------------------------------------------- IsThereAnyDeal bundle pages
const ITAD = "https://isthereanydeal.com";
/** The bundles page lists what expires next across stores: an id, a title and the store's name for each. */
export function parseItadIndex(html) {
    const out = [];
    for (const m of String(html ?? "").matchAll(/<a\b[^>]*href="\/bundles\/(\d+)\/"[^>]*>([\s\S]*?)<\/a>/gi)) {
        const title = text(/class="title[^"]*">([\s\S]*?)<\/div>/i.exec(m[2])?.[1]);
        const store = text(/<span class="[^"]*">([^<]*)/i.exec(/class="page[^"]*">([\s\S]*)/i.exec(m[2])?.[1] ?? "")?.[1]);
        if (title) out.push({ id: m[1], title, store });
    }
    return out;
}
/** One bundle's page carries its store link (inside an affiliate redirect), end time and games. Only the store's own address is kept. */
export function parseItadDetail(html, host, now = Date.now()) {
    const src = String(html ?? "");
    const link = /"url":"[^"]*?ued=([^"]+)"/.exec(src)?.[1];
    let url = null;
    try { const u = new URL(decodeURIComponent(link ?? "")); if (u.hostname.endsWith(host)) url = u.origin + u.pathname; } catch { /* no usable link */ }
    if (!url) return null;
    if (/"isExpired":true/.test(src)) return null;
    const expiry = Number(/"expiry":(\d+)/.exec(src)?.[1]);
    const count = (src.match(/"bundled":\{"count"/g) ?? []).length;
    const image = /"banner300":"([^"]+)"/.exec(src)?.[1]?.replace(/\\\//g, "/");
    const pick = /pick-and-mix|build-your-own/i.test(url) || /dynamic pricing/i.test(src);
    return { url, image, gameCount: count || null, games: [], expiresAt: Number.isFinite(expiry) && expiry > 0 ? expiry * 1000 : null, kind: pick ? "pick-and-mix" : "tiered", price: pick ? "Pick and mix" : null };
}
async function fetchViaItad(label, store, { fetchImpl, now, timeoutMs }) {
    const host = BUNDLE_STORES[store].home.split("/")[2].replace(/^www\./, "");
    const ids = parseItadIndex(await (await get(fetchImpl, ITAD + "/bundles/", timeoutMs)).text()).filter(b => b.store.toLowerCase().startsWith(label.toLowerCase())).slice(0, 12);
    const out = [];
    for (const b of ids) {
        try {
            const d = parseItadDetail(await (await get(fetchImpl, `${ITAD}/bundles/${b.id}/`, timeoutMs)).text(), host, now);
            if (!d) continue;
            const t = tidy({ store, id: d.url.split("/").filter(Boolean).pop(), title: b.title, url: d.url, image: d.image, gameCount: d.gameCount, games: [], price: d.price, kind: d.kind, expiresAt: d.expiresAt }, now);
            if (t) out.push(t);
        } catch { /* skip the one bundle that would not load */ }
    }
    return out;
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
/** A bundle's own page has its cover (og:image), proper title and the Steam headers of the games inside. */
export function parseIndieGalaDetail(html) {
    const src = String(html ?? "");
    const meta = name => text(new RegExp(`<meta[^>]+(?:content="([^"]*)"[^>]+property="og:${name}"|property="og:${name}"[^>]+content="([^"]*)")`, "i").exec(src)?.slice(1, 3).find(Boolean));
    const apps = [...new Set([...src.matchAll(/steam\/apps\/(\d+)\/header/g)].map(m => m[1]))];
    return { title: meta("title"), image: meta("image") || (apps[0] ? `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${apps[0]}/header.jpg` : null), gameCount: apps.length || null };
}
export async function fetchIndieGala({ fetchImpl, now, timeoutMs }) {
    const list = parseIndieGala(await (await get(fetchImpl, BUNDLE_STORES.indiegala.home, timeoutMs)).text(), now);
    return Promise.all(list.map(async b => {
        try {
            const d = parseIndieGalaDetail(await (await get(fetchImpl, b.url, timeoutMs)).text());
            const [name, ...tags] = (d.title || b.title).split(/\s+\|\s+/);
            const off = /(\d+)%\s*off/i.exec(tags.join(" "))?.[1];
            return tidy({ ...b, id: b.key.slice(b.key.indexOf(":") + 1), title: name, price: b.price || (off ? `${off}% off` : null), image: b.image || d.image, gameCount: b.gameCount || d.gameCount }, now) ?? b;
        } catch { return b; } // still listed, just without the extras
    }));
}

// ---------------------------------------------------------------- Steam bundles
// Steam has no list of its bundles any more (search no longer filters for them), but every bundle has a page at /bundle/<id> and ids
// only go up. So the newest ids are walked: a deep check looks back a few hundred, a normal poll only what is above the last one seen.
export const steamBundleUrl = id => `https://store.steampowered.com/bundle/${id}/`;
const STEAM_APP_IMG = id => `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`;
/** One bundle page: name, what it costs and how much it saves, and the games inside. */
export function parseSteamBundlePage(html, id, now = Date.now()) {
    const src = String(html ?? "");
    const title = text(/<meta property="og:title" content="([^"]*)"/i.exec(src)?.[1] ?? /<title>([^<]*)/i.exec(src)?.[1]).replace(/\s+on Steam$/i, "").replace(/^(?:Save \d+% on|Buy)\s+/i, "");
    if (!title) return null;
    const apps = [...new Set([...src.matchAll(/data-ds-appid="(\d+)/g)].map(m => m[1]))];
    const games = [...new Set([...src.matchAll(/class="tab_item_name">([^<]+)/g)].map(m => text(m[1])))];
    const final = text(/bundle_final_price_with_discount">([^<]*)/i.exec(src)?.[1]);
    const off = /bundle_discount">\s*-?(\d+)%/i.exec(src)?.[1];
    // The bundle's own banner first. Newer games no longer have a plain /apps/<id>/header.jpg, so that is only the last resort.
    const own = /https:\/\/[\w.-]+\/store_item_assets\/steam\/bundles\/\d+\/[\w]+\/[0-9a-f]{40}\/header\.jpg(?:\?t=\d+)?/i.exec(src)?.[0]
        ?? /<meta property="og:image" content="(https:\/\/[^"]+)"/i.exec(src)?.[1]
        // Some bundles have no banner and their games have no plain header either; a screenshot of the first game is the next best picture.
        ?? /https:\/\/[\w.-]+\/store_item_assets\/steam\/apps\/\d+\/[0-9a-f]{40}\/ss_[0-9a-f]{40}\.1920x1080\.jpg(?:\?t=\d+)?/i.exec(src)?.[0];
    return tidy({ store: "steam", id: String(id), title, url: steamBundleUrl(id), image: own ?? (apps[0] ? STEAM_APP_IMG(apps[0]) : null), games, gameCount: apps.length || games.length || null,
        price: final ? (off && off !== "0" ? `${final} (${off}% off)` : final) : null, kind: "fixed" }, now);
}
let steamTop = 0, steamSeen = 0;
async function steamPage(fetchImpl, id, timeoutMs) {
    try {
        const res = await fetchImpl(steamBundleUrl(id), { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.8", Cookie: "birthtime=0; lastagecheckage=1-0-1990; wants_mature_content=1" } });
        return res.ok ? await res.text() : null; // a missing or removed bundle redirects away
    } catch { return null; }
}
/** Ids are sparse (about half exist), so "is anything alive around here" asks a small window. */
async function steamAlive(fetchImpl, from, timeoutMs) {
    const got = await Promise.all(Array.from({ length: 12 }, (_, i) => steamPage(fetchImpl, from + i, timeoutMs)));
    return got.some(Boolean);
}
async function steamFindTop(fetchImpl, timeoutMs) {
    let lo = steamTop || 60_000, hi = 400_000; // lo is known to exist; hi is far past the end
    while (hi - lo > 24) { const mid = Math.floor((lo + hi) / 2); if (await steamAlive(fetchImpl, mid, timeoutMs)) lo = mid; else hi = mid; }
    return lo + 12;
}
export async function fetchSteamBundles({ fetchImpl, now, timeoutMs, deep = false }) {
    if (!steamTop) steamTop = await steamFindTop(fetchImpl, timeoutMs);
    const back = deep ? 500 : 120;
    let id = deep || !steamSeen ? steamTop - back : steamSeen + 1, quiet = 0, last = steamSeen;
    const out = [];
    while (quiet < 40 && id < steamTop + 400) {
        const batch = Array.from({ length: 10 }, (_, i) => id + i);
        const pages = await Promise.all(batch.map(n => steamPage(fetchImpl, n, timeoutMs)));
        pages.forEach((html, i) => {
            if (!html) { quiet += 1; return; }
            quiet = 0; last = Math.max(last, batch[i]); steamTop = Math.max(steamTop, batch[i]);
            const rec = parseSteamBundlePage(html, batch[i], now);
            if (rec) out.push(rec);
        });
        id += 10;
    }
    steamSeen = Math.max(steamSeen, last);
    return out;
}

// ---------------------------------------------------------------- all of them
const FETCHERS = { humble: fetchHumble, fanatical: fetchFanatical, indiegala: fetchIndieGala, steam: fetchSteamBundles };

/**
 * Every store at once. `complete` names the stores that answered with at least one bundle; only for those is a bundle that is no
 * longer listed treated as over. Throws only when nothing at all could be read.
 */
export async function fetchAllBundles({ fetchImpl = globalThis.fetch, now = Date.now(), timeoutMs = 20_000, deep = false } = {}) {
    const bundles = [], complete = [], errors = [];
    await Promise.all(Object.entries(FETCHERS).map(async ([store, fn]) => {
        try {
            const list = await fn({ fetchImpl, now, timeoutMs, deep });
            if (!list.length && store !== "steam") throw new BundleFeedError("no bundles could be read from the page");
            bundles.push(...list);
            if (store !== "steam") complete.push(store); // Steam bundles never get an end date and a normal poll only looks at the newest ones
        } catch (err) { errors.push(`${BUNDLE_STORES[store].name}: ${err.message ?? err}`); }
    }));
    if (!bundles.length) throw new BundleFeedError(errors.join("; ") || "no bundles");
    return { bundles, complete, errors };
}

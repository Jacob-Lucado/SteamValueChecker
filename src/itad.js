// Client for the IsThereAnyDeal API (https://docs.isthereanydeal.com).
// Endpoint and field names follow ITAD's public docs. Responses are read defensively, so a missing
// field shows as "-" in the table instead of crashing the bot.

const BASE = "https://api.isthereanydeal.com";
export const TTL_MS = 30 * 60 * 1000;
const MAX_CACHE = 1000;
const LOOKUP_CHUNK = 50;
const PRICE_CHUNK = 50;

export class ItadError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

export function normalize(s) {
    return String(s)
        .replace(/[™®©]/g, "") // before NFKD, which would turn ™ into "TM"
        .normalize("NFKD").replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

/** Dice coefficient on character pairs, 0..1. Used to reject wildly wrong fuzzy matches. */
export function similarity(a, b) {
    const x = normalize(a).replace(/ /g, "");
    const y = normalize(b).replace(/ /g, "");
    if (!x || !y) return 0;
    if (x === y) return 1;
    if (x.length < 2 || y.length < 2) return 0;
    const grams = s => {
        const m = new Map();
        for (let i = 0; i < s.length - 1; i++) {
            const g = s.slice(i, i + 2);
            m.set(g, (m.get(g) ?? 0) + 1);
        }
        return m;
    };
    const gx = grams(x), gy = grams(y);
    let overlap = 0;
    for (const [g, n] of gx) overlap += Math.min(n, gy.get(g) ?? 0);
    return (2 * overlap) / (x.length - 1 + (y.length - 1));
}

export const MIN_SIMILARITY = 0.6;

async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i], i);
        }
    }));
    return out;
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export function createItad({
    apiKey,
    fetchImpl = globalThis.fetch,
    ttlMs = TTL_MS,
    timeoutMs = 15000,
    sleep = ms => new Promise(r => setTimeout(r, ms)),
    now = () => Date.now(),
    minGapMs = 250
} = {}) {
    if (!apiKey) throw new Error("createItad needs an apiKey");
    const cache = new Map();

    const getCached = k => {
        const hit = cache.get(k);
        if (!hit) return undefined;
        if (now() - hit.t > ttlMs) { cache.delete(k); return undefined; }
        return hit.v;
    };
    const setCached = (k, v) => {
        if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
        cache.set(k, { t: now(), v });
    };

    // Error messages never include the URL, because the URL carries the API key.
    // Requests start at least minGapMs apart, so a big import trickles through instead of tripping ITAD's rate limit.
    let gate = Promise.resolve();
    const pace = () => {
        const turn = gate.then(() => sleep(minGapMs));
        gate = turn.catch(() => {});
        return turn;
    };

    const health = { lastOkAt: null, lastErrorAt: null, lastError: null };
    async function call(method, path, params = {}, body, attempt = 0) {
        try {
            const out = await callInner(method, path, params, body, attempt);
            health.lastOkAt = now();
            return out;
        } catch (err) { health.lastErrorAt = now(); health.lastError = err?.code ?? err?.name ?? "error"; throw err; }
    }
    async function callInner(method, path, params = {}, body, attempt = 0) {
        if (minGapMs > 0) await pace();
        const url = new URL(BASE + path);
        url.searchParams.set("key", apiKey);
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

        let res;
        try {
            res = await fetchImpl(url, {
                method,
                headers: body ? { "Content-Type": "application/json" } : {},
                body: body ? JSON.stringify(body) : undefined,
                signal: AbortSignal.timeout(timeoutMs)
            });
        } catch (err) {
            throw new ItadError("network", `Could not reach IsThereAnyDeal (${err.name === "TimeoutError" ? "timed out" : "network error"}).`);
        }

        if (res.status === 429) {
            if (attempt < 4) {
                const wait = Math.min(Number(res.headers?.get?.("retry-after")) || 2 * 2 ** attempt, 20);
                await sleep(wait * 1000);
                return callInner(method, path, params, body, attempt + 1);
            }
            throw new ItadError("rate_limited", "IsThereAnyDeal is rate limiting the bot. Try again in a minute.");
        }
        if (res.status === 401 || res.status === 403) {
            throw new ItadError("auth", "IsThereAnyDeal rejected the bot's API key. The bot owner needs to check ITAD_API_KEY.");
        }
        if (!res.ok) throw new ItadError("http", `IsThereAnyDeal returned HTTP ${res.status}.`);
        try {
            return await res.json();
        } catch {
            throw new ItadError("bad_response", "IsThereAnyDeal sent a response the bot could not read.");
        }
    }

    /** Resolves titles to ITAD game ids. Returns [{ title, id, approx, matched }] in the same order. */
    async function lookupTitles(titles) {
        const result = new Map();
        const need = [];
        for (const t of titles) {
            const hit = getCached(`id:${t.toLowerCase()}`);
            if (hit !== undefined) result.set(t, hit);
            else need.push(t);
        }

        const unresolved = [];
        for (const part of chunk(need, LOOKUP_CHUNK)) {
            const data = await call("POST", "/lookup/id/title/v1", {}, part);
            for (const t of part) {
                const id = data?.[t] ?? null;
                if (id) {
                    const v = { id, approx: false, matched: t };
                    setCached(`id:${t.toLowerCase()}`, v);
                    result.set(t, v);
                } else unresolved.push(t);
            }
        }

        // Fuzzy fallback for exact misses (editions, subtitles, punctuation).
        await mapLimit(unresolved, 4, async t => {
            const found = await call("GET", "/games/search/v1", { title: t, results: 1 });
            const top = Array.isArray(found) ? found[0] : null;
            const ok = top?.id && similarity(t, top.title ?? "") >= MIN_SIMILARITY;
            const v = ok ? { id: top.id, approx: true, matched: top.title } : { id: null, approx: false, matched: t };
            setCached(`id:${t.toLowerCase()}`, v);
            result.set(t, v);
        });

        return titles.map(title => ({ title, ...result.get(title) }));
    }

    /** Prices for ITAD ids in a region. Returns Map(id -> price entry or null). */
    async function getPrices(ids, country = "US") {
        const out = new Map();
        const need = [];
        for (const id of ids) {
            const hit = getCached(`p:${country}:${id}`);
            if (hit !== undefined) out.set(id, hit);
            else need.push(id);
        }
        for (const part of chunk(need, PRICE_CHUNK)) {
            const data = await call("POST", "/games/prices/v3", { country, nondeals: "true", vouchers: "false" }, part);
            const byId = new Map((Array.isArray(data) ? data : []).map(e => [e?.id, e]));
            for (const id of part) {
                const entry = byId.get(id) ?? null;
                setCached(`p:${country}:${id}`, entry);
                out.set(id, entry);
            }
        }
        return out;
    }

    /** Maps a shop's own ids (e.g. "app/220" on Steam, shop 61) to ITAD ids. Returns Map(shopId -> itadId|null). */
    async function lookupShopIds(shopId, shopGameIds) {
        const out = new Map();
        const need = [];
        for (const sid of shopGameIds) {
            const hit = getCached(`shop:${shopId}:${sid}`);
            if (hit !== undefined) out.set(sid, hit);
            else need.push(sid);
        }
        for (const part of chunk(need, LOOKUP_CHUNK)) {
            const data = await call("POST", `/lookup/id/shop/${shopId}/v1`, {}, part);
            for (const sid of part) {
                const id = data?.[sid] ?? null;
                setCached(`shop:${shopId}:${sid}`, id);
                out.set(sid, id);
            }
        }
        return out;
    }

    /** Title (and Steam app id) for one ITAD id, or null when unknown. */
    async function getTitle(id) {
        const hit = getCached(`title:${id}`);
        if (hit !== undefined) return hit;
        let info = null;
        try {
            info = await call("GET", "/games/info/v2", { id });
        } catch (err) {
            if (err.code === "http") return null; // 404 and similar: this game has no info, not a bot failure
            throw err;
        }
        const v = info?.title ? { title: String(info.title), appid: info.appid ?? null, release: isoOrNull(info.releaseDate) } : null;
        setCached(`title:${id}`, v);
        return v;
    }

    const isoOrNull = v => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };

    /**
     * Active bundles that contain each game. One batch call per 200 games.
     * Returns Map(itadId -> [{ id, title, shop, url, expiry, price, currency }]), cheapest tier price that includes the game.
     */
    async function getBundles(ids, country = "US") {
        const out = new Map();
        const need = [];
        for (const id of ids) {
            const hit = getCached(`bun:${country}:${id}`);
            if (hit !== undefined) out.set(id, hit); else need.push(id);
        }
        for (const part of chunk(need, 200)) {
            const data = await call("POST", "/games/overview/v2", { country, vouchers: "false" }, part);
            const wanted = new Set(part);
            const found = new Map(part.map(id => [id, []]));
            for (const b of Array.isArray(data?.bundles) ? data.bundles : []) {
                const expiry = isoOrNull(b?.expiry);
                if (expiry !== null && expiry < now()) continue;
                const perGame = new Map();
                for (const tier of Array.isArray(b?.tiers) ? b.tiers : []) {
                    const amount = Number(tier?.price?.amount);
                    for (const g of Array.isArray(tier?.games) ? tier.games : []) {
                        if (!wanted.has(g?.id) || !Number.isFinite(amount)) continue;
                        const prev = perGame.get(g.id);
                        if (!prev || amount < prev.price) perGame.set(g.id, { price: amount, currency: tier.price.currency ?? null });
                    }
                }
                for (const [gid, tier] of perGame) {
                    found.get(gid).push({
                        id: String(b.id ?? b.title), title: String(b.title ?? "Bundle"), shop: b.page?.name ?? null,
                        url: typeof b.url === "string" ? b.url : null, expiry, price: tier.price, currency: tier.currency
                    });
                }
            }
            for (const [id, list] of found) { setCached(`bun:${country}:${id}`, list); out.set(id, list); }
        }
        return out;
    }

    /**
     * Active bundles that include any of these games, with every tier and its games.
     * Returns [{ id, title, shop, url, expiry, currency, tiers: [{ price, games: [{ id, title }] }], matches: [gameId] }].
     * Tiers are listed cheapest first. Cached for the same time as prices.
     */
    async function getBundleDetails(ids, country = "US") {
        const key = `bunx:${country}:${[...ids].sort().join(",")}`;
        const hit = getCached(key);
        if (hit !== undefined) return hit;
        const wanted = new Set(ids);
        const byId = new Map();
        for (const part of chunk([...wanted], 200)) {
            const data = await call("POST", "/games/overview/v2", { country, vouchers: "false" }, part);
            for (const b of Array.isArray(data?.bundles) ? data.bundles : []) {
                const expiry = isoOrNull(b?.expiry);
                if (expiry !== null && expiry < now()) continue;
                const tiers = (Array.isArray(b?.tiers) ? b.tiers : [])
                    .map(t => ({ price: Number(t?.price?.amount), currency: t?.price?.currency ?? null,
                        games: (Array.isArray(t?.games) ? t.games : []).filter(g => typeof g?.id === "string").map(g => ({ id: g.id, title: String(g.title ?? g.slug ?? g.id) })) }))
                    .filter(t => Number.isFinite(t.price) && t.games.length)
                    .sort((a, b2) => a.price - b2.price);
                if (!tiers.length) continue;
                const bid = String(b.id ?? b.title);
                const matches = new Set(byId.get(bid)?.matches ?? []);
                for (const t of tiers) for (const g of t.games) if (wanted.has(g.id)) matches.add(g.id);
                if (!matches.size) continue;
                byId.set(bid, { id: bid, title: String(b.title ?? "Bundle"), shop: b.page?.name ?? null, url: typeof b.url === "string" ? b.url : null, expiry, currency: tiers[0].currency, tiers, matches: [...matches] });
            }
        }
        const out = [...byId.values()];
        setCached(key, out);
        return out;
    }

    /** Every active giveaway: [{ id, title, shop, url, expiry, gameIds }]. One call, cached. */
    async function getGiveawayList() {
        const hit = getCached("giveaway-list");
        if (hit !== undefined) return hit;
        const data = await call("GET", "/giveaways/v1", { limit: 50 });
        const out = [];
        for (const g of Array.isArray(data) ? data : []) {
            const expiry = isoOrNull(g?.expiry);
            if (expiry !== null && expiry < now()) continue;
            out.push({
                id: String(g.id ?? g.title), title: String(g.title ?? "Giveaway"), shop: g.shop?.name ?? g.page?.name ?? "Other",
                url: typeof g.url === "string" ? g.url : null, expiry,
                gameIds: (Array.isArray(g.games) ? g.games : []).map(x => x?.id).filter(Boolean),
                type: Array.isArray(g.games) && g.games.length && g.games.every(x => x?.type === "dlc") ? "dlc" : "game"
            });
        }
        setCached("giveaway-list", out);
        return out;
    }

    /** The deepest current Steam discounts: [{ id, title, cut, price, regular, currency, url, appid, since, storeLow }]. Cached for ten minutes. */
    async function getHotDeals({ minCut = 75, limit = 40, country = "US" } = {}) {
        const key = `hot:${country}`;
        let list = getCached(key);
        if (list === undefined) {
            const data = await call("GET", "/deals/v2", { country, limit: 100, sort: "-cut", shops: "61", nondeals: "false", mature: "false" });
            list = [];
            for (const g of Array.isArray(data?.list) ? data.list : []) {
                const d = g?.deal;
                if (!g?.id || !d || (g.type && g.type !== "game")) continue;
                const cut = Number(d.cut), price = Number(d.price?.amount), regular = Number(d.regular?.amount);
                if (!Number.isFinite(cut) || !Number.isFinite(price) || !Number.isFinite(regular)) continue;
                const url = typeof d.url === "string" ? d.url : null;
                list.push({ id: String(g.id), title: String(g.title ?? "Game"), cut, price, regular, currency: d.price?.currency ?? "USD", url, appid: Number((url ?? "").match(/store\.steampowered\.com\/app\/(\d+)/)?.[1]) || null,
                    since: isoOrNull(d.timestamp), expiry: isoOrNull(d.expiry), storeLow: d.storeLow?.amount != null ? Number(d.storeLow.amount) : null });
            }
            setCached(key, list);
        }
        return list.filter(d => d.cut >= minCut).slice(0, limit);
    }

    /** A wide pool of current Steam discounts for personalised picks: up to `pages` x 100 deals, deepest cuts first. Cached for ten minutes. */
    async function getDealsPool({ country = "US", pages = 3 } = {}) {
        const key = `pool:${country}`;
        const hit = getCached(key);
        if (hit !== undefined) return hit;
        const list = [], seen = new Set();
        for (let page = 0; page < pages; page++) {
            let data;
            try { data = await call("GET", "/deals/v2", { country, limit: 100, offset: page * 100, sort: "-cut", shops: "61", nondeals: "false", mature: "false" }); }
            catch (err) { if (page === 0) throw err; break; } // later pages are a bonus
            const got = Array.isArray(data?.list) ? data.list : [];
            for (const g of got) {
                const d = g?.deal;
                if (!g?.id || !d || seen.has(g.id) || (g.type && g.type !== "game")) continue;
                const cut = Number(d.cut), price = Number(d.price?.amount), regular = Number(d.regular?.amount);
                if (!Number.isFinite(cut) || !Number.isFinite(price) || !Number.isFinite(regular)) continue;
                seen.add(g.id);
                const url = typeof d.url === "string" ? d.url : null;
                list.push({ id: String(g.id), title: String(g.title ?? "Game"), cut, price, regular, currency: d.price?.currency ?? "USD", url, appid: Number((url ?? "").match(/store\.steampowered\.com\/app\/(\d+)/i)?.[1]) || null });
            }
            if (got.length < 100) break;
        }
        setCached(key, list);
        return list;
    }

    /** Active giveaways by game, as Map(itadId -> [{ id, title, shop, url, expiry }]). */
    async function getGiveaways() {
        const out = new Map();
        for (const g of await getGiveawayList()) {
            for (const id of g.gameIds) {
                if (!out.has(id)) out.set(id, []);
                out.get(id).push({ id: g.id, title: g.title, shop: g.shop, url: g.url, expiry: g.expiry });
            }
        }
        return out;
    }

    /** Price history points for one game: [{ t, price, regular, shop }] oldest first. Defaults to the last year. */
    async function getHistory(id, country = "US", sinceMs = now() - 365 * 86400_000) {
        const since = new Date(sinceMs).toISOString().slice(0, 10);
        const key = `hist:${country}:${id}:${since}`;
        const hit = getCached(key);
        if (hit !== undefined) return hit;
        const data = await call("GET", "/games/history/v2", { id, country, since: `${since}T00:00:00Z` });
        const points = (Array.isArray(data) ? data : [])
            .map(e => ({ t: isoOrNull(e?.timestamp), price: Number(e?.deal?.price?.amount), regular: Number(e?.deal?.regular?.amount), shop: e?.shop?.name ?? null }))
            .filter(p => p.t !== null && Number.isFinite(p.price))
            .sort((a, b) => a.t - b.t);
        setCached(key, points);
        return points;
    }

    return { lookupTitles, getPrices, lookupShopIds, getTitle, getBundles, getBundleDetails, getGiveaways, getGiveawayList, getHotDeals, getDealsPool, getHistory, health, _cache: cache };
}

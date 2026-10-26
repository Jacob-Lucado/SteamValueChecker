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
    now = () => Date.now()
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
    async function call(method, path, params = {}, body, attempt = 0) {
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
            if (attempt < 1) {
                const wait = Math.min(Number(res.headers?.get?.("retry-after")) || 2, 10);
                await sleep(wait * 1000);
                return call(method, path, params, body, attempt + 1);
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

    return { lookupTitles, getPrices, _cache: cache };
}

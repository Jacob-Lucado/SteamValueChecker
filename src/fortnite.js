// Fortnite data for the dashboard: the item shop, news, map, new cosmetics, cosmetic search and (with a key) player stats.
// Everything comes from the free fortnite-api.com, cached for a few minutes so the dashboard never hammers it, and trimmed down
// to just what the page draws. A slow or broken upstream never takes the page down: the last good copy keeps being served.
import { UserError } from "./errors.js";

const BASE = "https://fortnite-api.com";
const MIN = 60_000;
const TTL = { shop: 10 * MIN, news: 15 * MIN, map: 60 * MIN, fresh: 30 * MIN, status: 30 * MIN, search: 10 * MIN, stats: 5 * MIN };

const https = u => (typeof u === "string" && /^https:\/\//i.test(u) ? u : null);
const clip = (t, n) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** What kind of thing a shop entry is, in the words the page uses for its filter. */
function kindOf(e) {
    if (e.bundle) return "bundle";
    const first = e.brItems?.[0];
    if (first) return String(first.type?.value ?? "item");
    if (e.tracks?.length) return "jamtrack";
    if (e.cars?.length) return "car";
    if (e.instruments?.length) return "instrument";
    return "item";
}

/** One shop entry, cut down: a name, a picture, the price and when it leaves. */
export function slimEntry(e) {
    const first = e.brItems?.[0] ?? null, track = e.tracks?.[0] ?? null, car = e.cars?.[0] ?? null, inst = e.instruments?.[0] ?? null;
    const lead = first ?? car ?? inst;
    const art = https(e.newDisplayAsset?.renderImages?.[0]?.image) ?? https(e.bundle?.image) ?? https(first?.images?.featured) ?? https(first?.images?.icon) ?? https(track?.albumArt) ?? https(car?.images?.large) ?? https(inst?.images?.large) ?? https(first?.images?.smallIcon);
    const name = clip(e.bundle?.name ?? lead?.name ?? track?.title ?? e.devName, 80);
    const rarity = lead?.series?.value ? String(lead.series.backendValue ?? lead.series.value) : String(lead?.rarity?.value ?? "common");
    const items = [...(e.brItems ?? []), ...(e.cars ?? []), ...(e.instruments ?? [])].map(i => ({ name: clip(i.name, 60), type: String(i.type?.displayValue ?? ""), art: https(i.images?.smallIcon ?? i.images?.small ?? i.images?.icon) })).slice(0, 12);
    const tracks = (e.tracks ?? []).slice(0, 3).map(t => ({ title: clip(t.title, 60), artist: clip(t.artist, 60) }));
    return {
        id: String(e.offerId ?? e.devName ?? name), name, kind: kindOf(e), rarity, rarityName: clip(lead?.series?.value ?? lead?.rarity?.displayValue ?? "", 40),
        price: Number(e.finalPrice) || 0, regular: Number(e.regularPrice) || 0, art, size: /Size_(\d+)_x_(\d+)/.exec(e.tileSize ?? "") ? e.tileSize : "Size_1_x_1",
        section: clip(e.layout?.name ?? "", 60) || "Featured", rank: Number(e.layout?.rank) || 0, index: Number(e.layout?.index) || 0, sort: Number(e.sortPriority) || 0,
        out: e.outDate || null, in: e.inDate || null, giftable: Boolean(e.giftable), bundle: Boolean(e.bundle), bundleInfo: clip(e.bundle?.info, 40),
        artist: track ? clip(track.artist, 60) : "", items, tracks,
        set: clip(first?.set?.value, 60), intro: first?.introduction ? clip(first.introduction.text, 80) : "",
        colors: e.colors && typeof e.colors === "object" ? [e.colors.color1, e.colors.color3, e.colors.textBackgroundColor].filter(c => /^[0-9a-f]{6,8}$/i.test(c ?? "")).map(c => c.slice(0, 6)) : [],
        display: String(e.layout?.displayType ?? "tileGrid")
    };
}

export function createFortnite({ fetchImpl = globalThis.fetch, now = () => Date.now(), apiKey = "", log = () => {} } = {}) {
    const cache = new Map();
    const get = async (key, ttl, load) => {
        const hit = cache.get(key);
        if (hit && now() - hit.at < ttl) return hit.v;
        try { const v = await load(); cache.set(key, { v, at: now() }); return v; }
        catch (e) { if (hit) { log(`fortnite ${key}: ${e.message}, serving the last copy`); return hit.v; } throw e; }
    };
    async function json(path, { auth = false } = {}) {
        const res = await fetchImpl(BASE + path, { headers: { Accept: "application/json", ...(auth && apiKey ? { Authorization: apiKey } : {}) }, signal: AbortSignal.timeout(12000) });
        const body = await res.json().catch(() => null);
        if (!res.ok) { const err = new Error(`Fortnite data answered ${res.status}`); err.status = res.status; err.detail = body?.error; throw err; }
        return body?.data ?? null;
    }
    const down = () => new UserError("Fortnite data isn't answering right now. Try again in a minute.");

    /** The item shop, grouped into the sections Fortnite shows, in Fortnite's order. */
    async function shop() {
        try {
            return await get("shop", TTL.shop, async () => {
                const d = await json("/v2/shop");
                const entries = (d?.entries ?? []).map(slimEntry).filter(e => e.name);
                const bySection = new Map();
                for (const e of entries) { const s = bySection.get(e.section) ?? { name: e.section, rank: e.rank, index: e.index, display: e.display, entries: [] }; s.entries.push(e); bySection.set(e.section, s); }
                const sections = [...bySection.values()].sort((a, b) => (b.rank - a.rank) || (a.index - b.index));
                for (const s of sections) s.entries.sort((a, b) => (b.sort - a.sort) || (b.price - a.price));
                const next = new Date(now()); next.setUTCHours(24, 0, 0, 0);
                return { date: d?.date ?? null, refreshAt: next.getTime(), count: entries.length, sections };
            });
        } catch { throw down(); }
    }

    /** News and the in-game messages, for battle royale and the other modes that have them. */
    async function newsFeed() {
        try {
            return await get("news", TTL.news, async () => {
                const d = await json("/v2/news");
                const out = [];
                for (const mode of ["br", "stw", "creative"]) {
                    const n = d?.[mode]; if (!n) continue;
                    for (const m of n.motds ?? []) out.push({ mode, id: String(m.id ?? m.title), title: clip(m.title, 90), body: clip(m.body, 600), image: https(m.image) ?? https(m.tileImage), tab: clip(m.tabTitle ?? m.title, 60) });
                    if (!(n.motds ?? []).length) for (const m of n.messages ?? []) out.push({ mode, id: String(m.title), title: clip(m.title, 90), body: clip(m.body, 600), image: https(m.image), tab: clip(m.title, 60) });
                }
                return { items: out.filter(n => n.title), updated: d?.br?.date ?? null };
            });
        } catch { throw down(); }
    }

    /** The island map with its named places. */
    async function map() {
        try {
            return await get("map", TTL.map, async () => {
                const d = await json("/v1/map");
                const pois = (d?.pois ?? []).map(p => ({ id: String(p.id ?? ""), name: clip(p.name, 60), x: Number(p.location?.x) || 0, y: Number(p.location?.y) || 0 })).filter(p => p.name && !/UnNamed/i.test(p.id));
                return { image: https(d?.images?.pois), blank: https(d?.images?.blank), pois };
            });
        } catch { throw down(); }
    }

    /** Cosmetics that arrived in the latest update. */
    async function fresh() {
        try {
            return await get("fresh", TTL.fresh, async () => {
                const d = await json("/v2/cosmetics/new");
                const items = (d?.items?.br ?? []).map(slimCosmetic).filter(Boolean);
                return { build: clip(String(d?.build ?? "").replace(/^\+\+Fortnite\+/, ""), 60), items };
            });
        } catch { throw down(); }
    }

    /** Search every battle royale cosmetic by name. */
    async function search(q) {
        const term = clip(q, 40);
        if (term.length < 2) throw new UserError("Type at least two letters of the name.");
        try {
            return await get("s:" + term.toLowerCase(), TTL.search, async () => {
                const d = await json(`/v2/cosmetics/br/search/all?matchMethod=contains&language=en&name=${encodeURIComponent(term)}`).catch(e => { if (e.status === 404) return []; throw e; });
                return (d ?? []).map(slimCosmetic).filter(Boolean).slice(0, 60);
            });
        } catch (e) { if (e instanceof UserError) throw e; throw down(); }
    }

    /** The current game build, and whether the shop looks fresh. */
    async function status() {
        try {
            return await get("status", TTL.status, async () => {
                const d = await json("/v2/aes");
                return { build: clip(String(d?.build ?? "").replace(/^\+\+Fortnite\+/, ""), 60) };
            });
        } catch { return { build: "" }; }
    }

    /** A player's battle royale stats. Needs a key, so the page only offers it when one is set. */
    async function stats(name, platform = "epic") {
        if (!apiKey) throw new UserError("Player stats aren't switched on.");
        const who = clip(name, 40);
        if (who.length < 3) throw new UserError("Type the player's Epic name.");
        const type = ["epic", "psn", "xbl"].includes(platform) ? platform : "epic";
        try {
            return await get(`st:${type}:${who.toLowerCase()}`, TTL.stats, async () => {
                const d = await json(`/v2/stats/br/v2?name=${encodeURIComponent(who)}&accountType=${type}`, { auth: true });
                const pick = o => o ? { wins: Number(o.wins) || 0, kills: Number(o.kills) || 0, matches: Number(o.matches) || 0, deaths: Number(o.deaths) || 0, kd: Number(o.kd) || 0, winRate: Number(o.winRate) || 0, top10: Number(o.top10) || 0, minutes: Number(o.minutesPlayed) || 0, score: Number(o.score) || 0 } : null;
                return { name: clip(d?.account?.name ?? who, 40), level: Number(d?.battlePass?.level) || 0, overall: pick(d?.stats?.all?.overall), solo: pick(d?.stats?.all?.solo), duo: pick(d?.stats?.all?.duo), squad: pick(d?.stats?.all?.squad) };
            });
        } catch (e) {
            if (e instanceof UserError) throw e;
            if (e.status === 404) throw new UserError("No player with that name. Check the spelling and the platform.");
            if (e.status === 403) throw new UserError("That player's stats are private.");
            throw down();
        }
    }
    return { shop, news: newsFeed, map, fresh, search, status, stats, hasStats: Boolean(apiKey) };
}

function slimCosmetic(c) {
    if (!c?.name) return null;
    const art = https(c.images?.icon) ?? https(c.images?.smallIcon);
    if (!art) return null;
    return { id: String(c.id ?? c.name), name: clip(c.name, 80), type: String(c.type?.value ?? ""), typeName: clip(c.type?.displayValue, 30), rarity: String(c.series?.backendValue ?? c.rarity?.value ?? "common"), rarityName: clip(c.series?.value ?? c.rarity?.displayValue ?? "", 40), art, desc: clip(c.description, 160), set: clip(c.set?.value, 60), intro: clip(c.introduction?.text, 80), added: c.added ?? null, shopHistory: Array.isArray(c.shopHistory) ? c.shopHistory.length : 0, lastSeen: Array.isArray(c.shopHistory) && c.shopHistory.length ? c.shopHistory[c.shopHistory.length - 1] : null };
}

// Steam lookups for the indie section: turn a store link into the game's details, search by name, and read a game's review totals.
// Everything goes through Steam's public store endpoints with short timeouts and a small cache, so a slow Steam never hangs a page.
import { steamArt } from "./art.js";
import { UserError } from "./errors.js";

const TTL = 10 * 60_000;

/** The app id from a store link, a bare number or "app/123". Null when it isn't one. */
export function parseApp(input) {
    const s = String(input ?? "").trim();
    if (/^\d{1,9}$/.test(s)) return Number(s);
    const m = /(?:store\.steampowered\.com|steamcommunity\.com|steamdb\.info)\/(?:agecheck\/)?(?:app|widget)\/(\d{1,9})/i.exec(s) ?? /s\.team\/a\/(\d{1,9})/i.exec(s) ?? /^app\/(\d{1,9})/i.exec(s);
    return m ? Number(m[1]) : null;
}

/** Only plain https links, and only to a short list of kinds of place, so the showcase can't be used to send people anywhere odd. */
export function cleanLinks(raw = {}) {
    const out = {};
    const ok = (v, re) => { const s = String(v ?? "").trim(); if (!s) return null; try { const u = new URL(s); return u.protocol === "https:" && re.test(u.hostname) && s.length <= 300 ? u.href : null; } catch { return null; } };
    const site = ok(raw.website, /^[a-z0-9.-]+\.[a-z]{2,}$/i);
    const disc = ok(raw.discord, /^(?:www\.)?(?:discord\.gg|discord\.com)$/i);
    const video = ok(raw.trailer, /^(?:www\.|m\.)?(?:youtube\.com|youtu\.be|vimeo\.com)$/i);
    const x = ok(raw.x, /^(?:www\.)?(?:x\.com|twitter\.com|bsky\.app)$/i);
    if (site) out.website = site; if (disc) out.discord = disc; if (video) out.trailer = video; if (x) out.x = x;
    return out;
}

export function createIndie({ fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
    const cache = new Map();
    const remember = (k, v) => { if (cache.size > 400) cache.clear(); cache.set(k, { v, at: now() }); return v; };
    const recall = k => { const c = cache.get(k); return c && now() - c.at < TTL ? c.v : null; };
    async function getJson(url) {
        const res = await fetchImpl(url, { headers: { "Accept-Language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`Steam answered ${res.status}`);
        return res.json();
    }
    const plain = t => String(t ?? "").replace(/<[^>]*>/g, " ").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

    /** Review totals for a game, or null when Steam has none. */
    async function reviews(appid) {
        const hit = recall("r" + appid); if (hit) return hit;
        try {
            const d = await getJson(`https://store.steampowered.com/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=0`);
            const q = d?.query_summary;
            if (!q) return remember("r" + appid, null);
            return remember("r" + appid, { positive: Number(q.total_positive) || 0, negative: Number(q.total_negative) || 0, total: Number(q.total_reviews) || 0, label: q.review_score_desc || null });
        } catch { return null; }
    }

    /** Fallback lookup through Steam's store browse service. Null when the page really isn't visible. */
    async function browseItem(id) {
        let it;
        try {
            const input = { ids: [{ appid: id }], context: { language: "english", country_code: "US" }, data_request: { include_basic_info: true, include_release: true, include_screenshots: true, include_assets: true, include_all_purchase_options: true, include_platforms: true } };
            it = (await getJson(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1?input_json=${encodeURIComponent(JSON.stringify(input))}`))?.response?.store_items?.[0];
        } catch { return null; }
        if (!it || it.success !== 1 || it.visible === false || !it.name) return null;
        const b = it.basic_info ?? {}, rel = it.release ?? {}, when = Number(rel.steam_release_date) || 0, buy = it.best_purchase_option;
        const soon = Boolean(rel.is_coming_soon) || !when || when * 1000 > now();
        const fmt = when ? new Date(when * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;
        const shots = (it.screenshots?.all_ages_screenshots ?? []).slice(0, 8).map(x => `https://shared.akamai.steamstatic.com/store_item_assets/${String(x.filename).replace(/\?.*$/, "")}`).filter(u => /^https:\/\//.test(u));
        const free = Boolean(it.is_free);
        return remember("g" + id, {
            appid: id, type: it.type === 0 ? "game" : "other", title: it.name, studio: b.developers?.[0]?.name ?? "", publisher: b.publishers?.[0]?.name ?? "",
            blurb: plain(b.short_description), long: plain(b.short_description), genres: [], categories: [], image: steamArt(id),
            price: free ? "Free" : buy?.formatted_final_price ?? null, free, priceCents: buy?.final_price_in_cents ? Number(buy.final_price_in_cents) : null,
            release: fmt, comingSoon: soon, website: null, screenshots: shots, hay: plain(b.short_description),
            languages: "", platforms: Object.entries(it.platforms ?? {}).filter(([k, v]) => v === true && ["windows", "mac", "linux"].includes(k)).map(([k]) => k)
        });
    }

    /** One game's public details. Throws a plain message when it isn't a game or Steam can't find it. */
    async function lookup(appid, { withReviews = false, fresh = false } = {}) {
        const id = Number(appid);
        if (fresh) cache.delete("g" + id);
        if (!Number.isInteger(id) || id <= 0) throw new UserError("That doesn't look like a Steam store link.");
        let g = recall("g" + id);
        if (!g) {
            let d = null, down = false;
            for (let tries = 0; tries < 2 && !d?.success; tries++) { // one retry: Steam sometimes answers a busy 429 or an empty reply
                try { d = (await getJson(`https://store.steampowered.com/api/appdetails?appids=${id}&l=english&cc=us`))?.[id]; down = false; }
                catch { down = true; }
            }
            if (d?.success && d.data) {
                const x = d.data;
                g = remember("g" + id, {
                    appid: id, type: x.type ?? "game", title: x.name ?? "", studio: (x.developers ?? [])[0] ?? "", publisher: (x.publishers ?? [])[0] ?? "",
                    blurb: plain(x.short_description), long: plain(x.about_the_game).slice(0, 1500), genres: (x.genres ?? []).map(t => t.description).filter(Boolean),
                    categories: (x.categories ?? []).map(t => t.description).filter(Boolean), image: steamArt(id),
                    price: x.is_free ? "Free" : x.price_overview?.final_formatted ?? null, free: Boolean(x.is_free), priceCents: x.price_overview?.initial ?? null,
                    release: x.release_date?.date ?? null, comingSoon: Boolean(x.release_date?.coming_soon), website: x.website ?? null,
                    screenshots: (x.screenshots ?? []).slice(0, 8).map(s => s.path_thumbnail).filter(u => /^https:\/\//.test(u ?? "")),
                    hay: plain([x.short_description, x.about_the_game, x.detailed_description, x.website, x.support_info?.url, x.support_info?.email].filter(Boolean).join(" ")).slice(0, 30000),
                    languages: plain(x.supported_languages).replace(/\*?languages with full audio support/i, "").slice(0, 200), platforms: Object.entries(x.platforms ?? {}).filter(([, v]) => v).map(([k]) => k)
                });
            } else {
                // appdetails says no for plenty of public pages (regional rules, age gates, new pages). The store browse service is more forgiving.
                g = await browseItem(id);
                if (!g) throw new UserError(down ? "Steam isn't answering right now. Try again in a minute." : "Steam has no public store page for that app.");
            }
        }
        return withReviews ? { ...g, reviews: await reviews(id) } : g;
    }

    /** Games matching a name, for the App ID finder. */
    async function search(term) {
        const q = String(term ?? "").trim().slice(0, 80);
        if (q.length < 2) throw new UserError("Type at least two letters of the game's name.");
        const hit = recall("s" + q.toLowerCase()); if (hit) return hit;
        try {
            const d = await getJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=english&cc=us`);
            return remember("s" + q.toLowerCase(), (d?.items ?? []).slice(0, 10).map(i => ({ appid: Number(i.id), name: String(i.name ?? ""), image: steamArt(Number(i.id)), price: i.price ? `$${(Number(i.price.final) / 100).toFixed(2)}` : null })).filter(i => i.appid && i.name));
        } catch { throw new UserError("Steam search isn't answering right now. Try again in a minute."); }
    }
    /** Brings stored games up to date from their Steam pages: new price, release date, art and description. A page Steam no longer shows is left as it was. */
    async function syncDue(db, { limit = 5, log = () => {} } = {}) {
        let done = 0;
        for (const g of db.indieDueForSync(limit)) {
            try { const fresh = await lookup(g.appid, { fresh: true }); if (fresh.type === "game") { db.indieRefresh(g.id, fresh); done++; const r = await reviews(g.appid); if (r) db.indieSnapReviews(g.id, r.total, r.positive); } else db.indieTouchSync(g.id); }
            catch (e) { db.indieTouchSync(g.id); log(`indie sync ${g.appid}: ${e.message}`); } // tried; look again tomorrow
        }
        return done;
    }
    /** Is this code written on the game's own Steam page? Only the people who control the page can put it there. */
    async function hasVerifyCode(appid, code) {
        if (!/^svc-verify-[a-z0-9]{8}$/.test(String(code ?? ""))) return false;
        const g = await lookup(appid, { fresh: true });
        return g.hay.toLowerCase().includes(code.toLowerCase());
    }
    return { lookup, search, reviews, parseApp, syncDue, hasVerifyCode };
}

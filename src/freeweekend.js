// Steam "free to play until" promotions: a paid game that anyone can play for free for a few days (free weekends and free trials).
// Steam has no list of them. So we look at the games people actually play (Steam's most-played chart, the top sellers and the
// biggest discounts), check each one's store page, which carries the exact start and end time of a free weekend. Every failure is quiet: the other free-game sources keep working.
const CHART = "https://api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1/";
const FEATURED = "https://store.steampowered.com/api/featuredcategories?cc=us&l=english";
const SALES = "https://store.steampowered.com/search/results/?query&start=0&count=100&specials=1&ndl=1&cc=us&infinite=1";
const PAGE = id => `https://store.steampowered.com/app/${id}/?cc=us&l=english`;
const HEADER = id => `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`;
/** The free-weekend block on a store page: {start_time, end_time, text}, with the page's HTML-escaped JSON. */
export function parseWeekend(html) {
    const m = /free_weekend(?:&quot;|")\s*:\s*\{(.*?)\}/s.exec(String(html ?? ""));
    if (!m) return null;
    const body = m[1].replace(/&quot;/g, '"');
    const num = k => Number(new RegExp(`"${k}"\\s*:\\s*(\\d+)`).exec(body)?.[1]);
    const start = num("start_time"), end = num("end_time");
    const text = /"text"\s*:\s*"([^"]*)"/.exec(body)?.[1] ?? "";
    return end ? { start: start || 0, end, text } : null;
}
const pageTitle = html => { const m = /<div id="appHubAppName"[^>]*>([^<]+)</.exec(String(html ?? "")) ?? /<title>([^<]+?)(?: on Steam)?<\/title>/.exec(String(html ?? "")); return m ? m[1].replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim() : ""; };

export function createFreeWeekends({ fetchImpl = globalThis.fetch, now = () => Date.now(), ttlMs = 2 * 60 * 60_000, retryMs = 15 * 60_000, enabled = true, extraApps = () => [], limit = 300, log = () => {} } = {}) {
    let cache = [], at = 0, failedAt = 0, running = null;
    const get = async (url, kind = "json") => {
        const r = await fetchImpl(url, { headers: { "User-Agent": "SteamValueChecker/1.0", "Accept-Language": "en-US", Cookie: "birthtime=0; mature_content=1; wants_mature_content=1" }, signal: AbortSignal.timeout(15_000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return kind === "json" ? r.json() : r.text();
    };
    async function candidates() {
        const ids = new Set();
        try { for (const r of (await get(CHART))?.response?.ranks ?? []) ids.add(String(r.appid)); } catch { /* the other lists still count */ }
        try { const f = await get(FEATURED); for (const k of ["top_sellers", "specials", "new_releases"]) for (const i of f?.[k]?.items ?? []) if (i?.id) ids.add(String(i.id)); } catch { /* same */ }
        // Free weekends usually run alongside a discount, so the best-liked discounted games are worth a look too.
        try { for (const m of String((await get(SALES))?.results_html ?? "").matchAll(/data-ds-appid="(\d+)"/g)) ids.add(m[1]); } catch { /* same */ }
        try { for (const id of extraApps() ?? []) ids.add(String(id)); } catch { /* same */ }
        return [...ids].filter(x => /^\d+$/.test(x)).slice(0, limit);
    }
    async function check(id) {
        try {
            // Not every free weekend is announced in the game's news, so the store page itself is the proof.
            const html = await get(PAGE(id), "text"), w = parseWeekend(html);
            if (!w || w.end * 1000 <= now() || (w.start && w.start * 1000 > now() + 3 * 86_400_000)) return null;
            const title = pageTitle(html);
            if (!title) return null;
            return { id: `fw:${id}:${w.end}`, title: title.replace(/\s+on Steam$/i, ""), shop: "Steam", url: `https://store.steampowered.com/app/${id}/`, expiry: w.end * 1000, startsAt: w.start ? w.start * 1000 : null,
                gameIds: [], type: "game", weekend: true, art: HEADER(id), blurb: w.text.slice(0, 200) };
        } catch { return null; }
    }
    async function refresh() {
        const ids = await candidates(), out = [];
        for (let i = 0; i < ids.length; i += 6) out.push(...(await Promise.all(ids.slice(i, i + 6).map(check))).filter(Boolean));
        return out;
    }
    /** The free-to-play-until games running right now, from cache for two hours. A failure keeps the last answer. */
    async function list() {
        if (!enabled) return [];
        if (now() - at < ttlMs && at) return cache.filter(g => g.expiry > now());
        if (failedAt && now() - failedAt < retryMs) return cache.filter(g => g.expiry > now());
        running ??= refresh().then(r => { cache = r; at = now(); failedAt = 0; if (r.length) log(`${r.length} free weekend${r.length === 1 ? "" : "s"} on now`); }, e => { failedAt = now(); log(`free weekends failed: ${e.message}`); }).finally(() => { running = null; });
        await running;
        return cache.filter(g => g.expiry > now());
    }
    return { list };
}

/** Adds the free weekends to `getGiveawayList`, so they travel the same road as the other free games. */
export function withFreeWeekends(itad, fw) {
    const base = itad.getGiveawayList.bind(itad);
    itad.getGiveawayList = async () => {
        const [main, extra] = await Promise.all([base(), fw.list().catch(() => [])]);
        const have = new Set(main.map(g => String(g.title).toLowerCase()));
        return [...main, ...extra.filter(g => !have.has(g.title.toLowerCase()))];
    };
    return itad;
}

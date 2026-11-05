// Limited-time free games that IsThereAnyDeal doesn't always list, like the batches of small Epic freebies that run for a few days.
// GamerPower publishes a free public list of live giveaways. We read the full-game ones for PC stores, cache the answer, and keep
// the last good list if the site is down. Every failure is quiet: the other sources keep working.
export const GP_API = "https://www.gamerpower.com/api/giveaways?sort-by=date";

const STORES = [[/epic games/i, "Epic Games Store"], [/steam/i, "Steam"], [/gog/i, "GOG"], [/ubisoft/i, "Ubisoft"], [/battle\.net/i, "Battle.net"]];
const httpsUrl = u => { try { return new URL(String(u)).protocol === "https:" ? String(u) : null; } catch { return null; } };

/** "Highway Driving (Epic Games) Giveaway" becomes "Highway Driving". */
export function cleanTitle(t) {
    return String(t ?? "").replace(/\s*\((?:[^()]*)\)\s*(?=giveaway|key giveaway|$)/i, " ").replace(/\s*\b(key\s+)?giveaway\b\s*$/i, "").replace(/\s+(steam|gog|epic games?)$/i, "").replace(/\s+/g, " ").trim();
}

/** GamerPower's own times are UTC and read "2026-11-08 23:59:00". "N/A" means no end date. */
const endMs = s => { const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(String(s ?? "")); return m ? Date.parse(`${m[1]}T${m[2]}Z`) : null; };

/** The live, full-game PC giveaways in the same shape as the other free games. */
export function parseGamerPower(json, now = Date.now()) {
    const out = [], seen = new Set();
    for (const g of Array.isArray(json) ? json : []) {
        if (!g?.id || g.status !== "Active" || !/^(game|early access)$/i.test(g.type ?? "")) continue;
        const platforms = String(g.platforms ?? "");
        const shop = STORES.find(([re]) => re.test(platforms))?.[1];
        if (!shop || /\b(ios|android|xbox|playstation|switch)\b/i.test(platforms) && !/pc/i.test(platforms)) continue;
        const end = endMs(g.end_date);
        if (end !== null && end <= now) continue;
        const title = cleanTitle(g.title), url = httpsUrl(g.open_giveaway_url);
        if (!title || !url || seen.has(g.id) || /\b(play\s?test|beta|bundle|demo|alpha)\b/i.test(title)) continue; // tests and bundles aren't games you keep
        seen.add(g.id);
        const blurb = String(g.description ?? "").replace(/\s+/g, " ").trim();
        out.push({ id: `gp:${g.id}`, title: title.slice(0, 150), shop, url, expiry: end, gameIds: [], type: "game", art: httpsUrl(g.image) ?? httpsUrl(g.thumbnail), blurb: blurb ? blurb.slice(0, 200) : null });
    }
    return out;
}

/** `list()` gives the live giveaways, from cache for 30 minutes. A failure keeps the last answer and waits before asking again. */
export function createGamerPower({ fetchImpl = globalThis.fetch, now = () => Date.now(), ttlMs = 30 * 60_000, retryMs = 10 * 60_000, enabled = true, log = () => {} } = {}) {
    let cache = [], at = 0, failedAt = 0, warned = false;
    const state = { lastOkAt: null, lastErrorAt: null, lastError: null };
    async function list() {
        if (!enabled) return [];
        if (at && now() - at < ttlMs) return cache.filter(g => !g.expiry || g.expiry > now());
        if (failedAt && now() - failedAt < retryMs) return cache.filter(g => !g.expiry || g.expiry > now());
        try {
            const res = await fetchImpl(GP_API, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
            if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: `http${res.status}` });
            cache = parseGamerPower(await res.json(), now()); at = now(); failedAt = 0; state.lastOkAt = at;
        } catch (err) {
            failedAt = now(); state.lastErrorAt = failedAt; state.lastError = err.code ?? err.name ?? "error";
            if (!warned) { warned = true; log(`GamerPower unavailable: ${state.lastError}`); }
        }
        return cache.filter(g => !g.expiry || g.expiry > now());
    }
    return { list, health: () => ({ enabled, ...state }) };
}

const norm = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Adds GamerPower's giveaways to `getGiveawayList`, skipping any game the list already has for the same store. */
export function withGamerPower(itad, gp) {
    const base = itad.getGiveawayList.bind(itad);
    itad.getGiveawayList = async () => {
        const [main, extra] = await Promise.all([base(), gp.list().catch(() => [])]);
        const have = new Set(main.map(g => `${norm(g.title)}|${norm(g.shop)}`));
        return [...main, ...extra.filter(g => !have.has(`${norm(g.title)}|${norm(g.shop)}`))];
    };
    return itad;
}

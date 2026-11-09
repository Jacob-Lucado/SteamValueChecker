// Limited-time free games that IsThereAnyDeal doesn't always list, like the batches of small Epic freebies that run for a few days.
// GamerPower publishes a free public list of live giveaways. We read the full-game ones for PC stores, cache the answer, and keep
// the last good list if the site is down. Every failure is quiet: the other sources keep working.
export const GP_API = "https://www.gamerpower.com/api/giveaways?sort-by=date";

const STORES = [[/epic games/i, "Epic Games Store"], [/steam/i, "Steam"], [/gog/i, "GOG"], [/ubisoft/i, "Ubisoft"], [/battle\.net/i, "Battle.net"],
    [/humble/i, "Humble Store"], [/\b(ea app|origin|ea play)\b/i, "EA app"], [/itch\.?io/i, "itch.io"], [/prime gaming|amazon/i, "Prime Gaming"], [/indie\s?gala/i, "IndieGala"]];
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
        // IndieGala keys are listed as plain "DRM-Free", so the store is only named in the title.
        const shop = STORES.find(([re]) => re.test(platforms))?.[1] ?? STORES.find(([re]) => re.test(g.title ?? ""))?.[1];
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

/** "Sorry We're Closed - FREE on Epic Games" is the same game as "Sorry We're Closed": drop the sales wording from the end of a title. */
export function tidyTitle(t) {
    return String(t ?? "").replace(/\s*[-\u2013\u2014:|]\s*(?:now\s+)?free\b[^()]*$/i, "").replace(/\s+(?:is\s+)?free\s+(?:on|at|from)\s+[\w .']+$/i, "").replace(/\s+/g, " ").trim() || String(t ?? "").trim();
}

const SHOP_NAMES = [[/^epic game(s)?( store)?$/i, "Epic Games Store"]];
const shopName = s => SHOP_NAMES.find(([re]) => re.test(String(s ?? "").trim()))?.[1] ?? s;

/**
 * One row per game. Several sources report the same giveaway under different wording and store names ("Epic Game Store" and
 * "Epic Games Store", a title with "- FREE on Epic Games" on the end), so a game shows once, from the first source that has it.
 */
export function tidyFree(list) {
    const seen = new Set(), out = [];
    for (const g of list) {
        const title = tidyTitle(g.title), key = norm(title) + (g.type === "dlc" ? "|dlc" : "");
        if (!norm(title) || seen.has(key)) continue;
        seen.add(key);
        out.push({ ...g, title, shop: shopName(g.shop) });
    }
    return out;
}

/** Adds GamerPower's giveaways to `getGiveawayList`, then shows each game once. */
export function withGamerPower(itad, gp) {
    const base = itad.getGiveawayList.bind(itad);
    itad.getGiveawayList = async () => {
        const [main, extra] = await Promise.all([base(), gp.list().catch(() => [])]);
        return tidyFree([...main, ...extra]);
    };
    return itad;
}

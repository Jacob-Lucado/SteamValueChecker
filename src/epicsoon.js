// Next week's free games on the Epic Games Store. Epic publishes them ahead of time in the same feed its free games page uses,
// so members can hear about them before they go live. Only offers that start within the next eight days are announced.
export const EPIC_FEED = "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US";
export const EPIC_PAGE = "https://store.epicgames.com/en-US/free-games";
const AHEAD_MS = 8 * 86400_000;

const httpsUrl = u => { try { return new URL(String(u)).protocol === "https:" ? String(u) : null; } catch { return null; } };
const ms = t => { const n = Date.parse(t ?? ""); return Number.isFinite(n) ? n : null; };

/** Where a game's Epic page is: its store slug when it has one, otherwise the free games page. */
export function epicLink(el) {
    const slug = [el?.offerMappings?.[0]?.pageSlug, el?.catalogNs?.mappings?.[0]?.pageSlug, el?.productSlug, el?.urlSlug].map(s => String(s ?? "").replace(/\/home$/, "")).find(s => /^[a-z0-9][a-z0-9-]*$/i.test(s) && !/^[0-9a-f]{32}$/i.test(s));
    return slug ? `https://store.epicgames.com/en-US/p/${slug}` : EPIC_PAGE;
}

/** The free offers that haven't started yet but will within eight days: [{ id, title, start, end, url, art, regular }], soonest first. */
export function parseEpicSoon(json, now = Date.now()) {
    const out = [];
    for (const el of json?.data?.Catalog?.searchStore?.elements ?? []) {
        for (const grp of el?.promotions?.upcomingPromotionalOffers ?? []) {
            for (const o of grp?.promotionalOffers ?? []) {
                const start = ms(o.startDate), end = ms(o.endDate);
                if (start === null || start <= now || start - now > AHEAD_MS || o.discountSetting?.discountPercentage !== 0) continue;
                const art = (el.keyImages ?? []).find(k => /^(OfferImageWide|DieselStoreFrontWide|Thumbnail)$/.test(k?.type) && httpsUrl(k.url))?.url ?? (el.keyImages ?? []).find(k => httpsUrl(k?.url))?.url ?? null;
                const price = el.price?.totalPrice;
                out.push({ id: `${el.id}:${o.startDate.slice(0, 10)}`, title: String(el.title ?? "Free game").slice(0, 150), start, end, url: epicLink(el), art: httpsUrl(art),
                    regular: price?.originalPrice > 0 ? { amount: price.originalPrice / 10 ** (price.currencyInfo?.decimals ?? 2), currency: price.currencyCode ?? "USD" } : null });
            }
        }
    }
    return out.sort((a, b) => a.start - b.start);
}

/** `list()` gives the upcoming games, from cache for three hours. A failure keeps the last answer and waits before asking again. */
export function createEpicSoon({ fetchImpl = globalThis.fetch, now = () => Date.now(), ttlMs = 3 * 3600_000, retryMs = 15 * 60_000 } = {}) {
    let cache = [], at = 0, failedAt = 0;
    const state = { lastOkAt: null, lastErrorAt: null, lastError: null };
    async function list() {
        if (at && now() - at < ttlMs) return cache.filter(g => g.start > now());
        if (failedAt && now() - failedAt < retryMs) return cache.filter(g => g.start > now());
        try {
            const res = await fetchImpl(EPIC_FEED, { headers: { "Accept-Language": "en" }, signal: AbortSignal.timeout(10_000) });
            if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: `http${res.status}` });
            cache = parseEpicSoon(await res.json(), now()); at = now(); failedAt = 0; state.lastOkAt = now();
        } catch (err) { failedAt = now(); state.lastErrorAt = now(); state.lastError = err.code ?? err.name ?? "error"; }
        return cache.filter(g => g.start > now());
    }
    return { list, health: () => ({ ...state }) };
}

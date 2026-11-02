// Amazon Luna's monthly claims (the Prime Gaming games). Luna has no public API and its claims page is built in the browser,
// so a headless Chromium opens the page, and we read the answer the page itself asks Luna's servers for. No login is needed.
// Results are cached, an outage keeps showing the last good list, and every failure is quiet: the other stores still work.
export const LUNA_SHOP = "Amazon Luna";
export const LUNA_CLAIMS_PAGE = "https://luna.amazon.com/claims/home";
const OPERATION = "OffersContext_Offers_And_Items";
const STORE_NAMES = { epic: "Epic Games Store", gog: "GOG", aga: "Amazon Games", legacy: "Amazon Games" };

const httpsOnly = u => { try { const x = new URL(String(u)); return x.protocol === "https:" ? x : null; } catch { return null; } };
const ms = t => { const n = Date.parse(t ?? ""); return Number.isFinite(n) ? n : null; };

/** The claim page on luna.amazon.com for an item, and which store the game is delivered through (its address ends in -epic, -gog and so on). */
export function claimLink(raw, id) {
    const u = httpsOnly(raw);
    const m = u && /^\/([a-z0-9-]+)\/dp\/(amzn1\.pg\.item\.[0-9a-f-]+)\/?$/i.exec(u.pathname);
    if (!m) return { url: u && /(^|\.)amazon\.com$/i.test(u.hostname) ? `${u.origin}${u.pathname}` : null, store: null };
    const suffix = m[1].split("-").pop().toLowerCase();
    return { url: `https://luna.amazon.com/claims/${m[1]}/dp/${m[2] || id}`, store: STORE_NAMES[suffix] ?? null };
}

/** Turns the page's answer into the same shape the other free games have. Only full games that are open for claiming right now. */
export function parseLunaClaims(data, now = Date.now()) {
    const items = data?.games?.items ?? data?.data?.games?.items;
    const seen = new Set(), out = [];
    for (const it of Array.isArray(items) ? items : []) {
        const title = String(it?.assets?.title ?? "").trim();
        if (!it?.id || !title || it.isTeaserCard || (it.category && it.category !== "FULL_GAME")) continue;
        const offer = (it.offers ?? []).find(o => (ms(o?.startTime) ?? 0) <= now && (ms(o?.endTime) ?? Infinity) > now);
        if (!offer || seen.has(it.id)) continue;
        const { url, store } = claimLink(it.assets?.externalClaimLink, it.id);
        if (!url) continue;
        seen.add(it.id);
        const art = httpsOnly(it.assets?.cardMedia?.defaultMedia?.src2x ?? it.assets?.cardMedia?.defaultMedia?.src1x);
        out.push({
            id: `luna:${it.id}`, title: title.slice(0, 150), shop: LUNA_SHOP, url, expiry: ms(offer.endTime), gameIds: [], type: "game",
            art: art ? art.href : null, store, blurb: it.assets?.shortformDescription ? String(it.assets.shortformDescription).slice(0, 200) : null
        });
    }
    return out;
}

/** Opens the claims page in Chromium and returns what the page loaded. Throws when the browser or the page doesn't cooperate. */
export async function fetchWithBrowser({ executablePath = process.env.LUNA_CHROMIUM || undefined, timeoutMs = 45_000 } = {}) {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
    try {
        const page = await browser.newPage({ locale: "en-US" });
        const got = new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error("Luna claims page didn't answer")), timeoutMs);
            page.on("response", async r => {
                if (!r.url().includes("/graphql")) return;
                try {
                    const body = JSON.parse(r.request().postData() ?? "{}");
                    if (body.operationName !== OPERATION) return;
                    clearTimeout(t); resolve((await r.json())?.data ?? null);
                } catch { /* some other request: keep waiting */ }
            });
        });
        got.catch(() => {});
        await page.goto(LUNA_CLAIMS_PAGE, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        return await got;
    } finally { await browser.close().catch(() => {}); }
}

/**
 * `list()` gives the claimable games, from cache when it is fresh. `fetchData` is swapped out in tests.
 * A failed refresh keeps the last good list for up to a day and waits before trying again.
 */
export function createLuna({ fetchData = fetchWithBrowser, now = () => Date.now(), ttlMs = 2 * 3600_000, retryMs = 20 * 60_000, log = () => {}, enabled = true } = {}) {
    let cache = null, at = 0, failedAt = 0, running = null, warned = false;
    async function refresh() {
        try {
            const list = parseLunaClaims(await fetchData(), now());
            cache = list; at = now(); failedAt = 0;
            if (list.length) log(`${list.length} Luna claims`);
        } catch (err) {
            failedAt = now();
            if (!warned) { warned = true; log(`Luna claims unavailable: ${err.code ?? err.message}`); }
        } finally { running = null; }
    }
    async function list() {
        if (!enabled) return [];
        const fresh = cache && now() - at < ttlMs;
        if (!fresh && !running && !(failedAt && now() - failedAt < retryMs)) running = refresh();
        if (running && (!cache || now() - at >= 24 * 3600_000)) await running; // nothing usable yet: wait for it
        return cache && now() - at < 24 * 3600_000 ? cache.filter(g => !g.expiry || g.expiry > now()) : [];
    }
    return { list };
}

/** Adds Luna's claims to an ITAD-style `getGiveawayList`, without ever letting a Luna problem break it. */
export function withLuna(itad, luna) {
    const base = itad.getGiveawayList.bind(itad);
    itad.getGiveawayList = async () => {
        const [main, extra] = await Promise.all([base(), luna.list().catch(() => [])]);
        return [...main, ...extra];
    };
    return itad;
}

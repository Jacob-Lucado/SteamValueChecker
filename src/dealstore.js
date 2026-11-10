// Pages for deals that don't live in the bundle feed: a free game, or a bundle that mentions a watched game. Each gets one stable row, so
// the link in a post keeps working and the landing page has something to show.
export const dealSchema = `
CREATE TABLE IF NOT EXISTS deal_pages (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    key     TEXT NOT NULL UNIQUE,
    kind    TEXT NOT NULL,
    title   TEXT NOT NULL,
    shop    TEXT,
    url     TEXT NOT NULL,
    image   TEXT,
    price   TEXT,
    games   TEXT,
    blurb   TEXT,
    expiry  INTEGER,
    created INTEGER NOT NULL
);
`;
const MAX_ROWS = 6000, KEEP_MS = 60 * 86_400_000;

export function dealStore({ run, get, all, now }) {
    const clip = (v, n) => (v == null || v === "" ? null : String(v).slice(0, n));
    /** One row per deal. Calling again for the same key refreshes it and gives the same id. */
    function upsertDeal({ key, kind = "free", title, shop = null, url, image = null, price = null, games = null, blurb = null, expiry = null }) {
        if (!key || !title || !/^https:\/\//i.test(String(url ?? ""))) return null;
        const g = Array.isArray(games) && games.length ? JSON.stringify(games.slice(0, 12).map(x => String(x).slice(0, 700))) : null;
        const have = get("SELECT id FROM deal_pages WHERE key = ?", String(key).slice(0, 200));
        if (have) {
            run("UPDATE deal_pages SET title = ?, shop = ?, url = ?, image = COALESCE(?, image), price = COALESCE(?, price), games = COALESCE(?, games), blurb = COALESCE(?, blurb), expiry = ? WHERE id = ?",
                clip(title, 200), clip(shop, 60), String(url).slice(0, 1000), clip(image, 1000), clip(price, 60), g, clip(blurb, 300), Number.isFinite(expiry) ? expiry : null, have.id);
            return have.id;
        }
        const r = run("INSERT INTO deal_pages (key, kind, title, shop, url, image, price, games, blurb, expiry, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            String(key).slice(0, 200), kind === "bundle" ? "bundle" : kind === "deal" ? "deal" : "free", clip(title, 200), clip(shop, 60), String(url).slice(0, 1000), clip(image, 1000), clip(price, 60), g, clip(blurb, 300), Number.isFinite(expiry) ? expiry : null, now());
        if (Math.random() < 0.02) pruneDeals();
        return Number(r.lastInsertRowid);
    }
    const getDeal = id => { const r = get("SELECT * FROM deal_pages WHERE id = ?", id); if (!r) return null; let games = []; try { games = JSON.parse(r.games ?? "[]"); } catch { /* none */ } return { ...r, games }; };
    /** Old rows go; links in posts that old are dead anyway. */
    function pruneDeals() {
        run("DELETE FROM deal_pages WHERE created < ?", now() - KEEP_MS);
        const n = get("SELECT COUNT(*) AS n FROM deal_pages")?.n ?? 0;
        if (n > MAX_ROWS) run("DELETE FROM deal_pages WHERE id IN (SELECT id FROM deal_pages ORDER BY id LIMIT ?)", n - MAX_ROWS);
    }
    /** Everything the landing pages have counted: per-page visits and clicks, plus per-day totals. Counters live in status_meta. */
    function trafficReport() {
        const rows = all("SELECT key, value FROM status_meta WHERE key LIKE 'dealvisit:%' OR key LIKE 'dealgo:%' OR key LIKE 'bundlevisit:%' OR key LIKE 'bundlego:%' OR key LIKE 'landday:%'");
        const pages = new Map(), days = new Map();
        for (const { key, value } of rows) {
            const n = Number(value) || 0, [kind, a, b] = key.split(":");
            if (kind === "landday") { const d = days.get(a) ?? { day: a, visits: 0, clicks: 0, previews: 0 }; d[b === "v" ? "visits" : b === "g" ? "clicks" : "previews"] += n; days.set(a, d); continue; }
            const path = kind.startsWith("bundle") ? "b" : "d", id = Number(a), k = path + id, p = pages.get(k) ?? { path, id, visits: 0, clicks: 0 };
            p[kind.endsWith("visit") ? "visits" : "clicks"] += n; pages.set(k, p);
        }
        return { pages: [...pages.values()], days: [...days.values()].sort((x, y) => x.day.localeCompare(y.day)) };
    }
    /** The newest free-game pages: id and store, for working out which stores' posts get opened. */
    const recentFreePages = (limit = 400) => all("SELECT id, shop FROM deal_pages WHERE kind = 'free' ORDER BY id DESC LIMIT ?", limit);
    return { upsertDeal, getDeal, pruneDeals, trafficReport, recentFreePages };
}

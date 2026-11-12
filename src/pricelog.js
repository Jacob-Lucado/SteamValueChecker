// The bot's own price history. Every price it looks up is noted once a day (the day's lowest, per game and region), so
// charts and buy-or-wait advice keep working when the price site's history is down or has nothing for a game, and the
// bot builds its own record of lows over time. Prices only: nothing about who asked.
import { summarize } from "./report.js";

const DAY = 86400_000;
export const KEEP_DAYS = 730;

export const priceLogSchema = `
CREATE TABLE IF NOT EXISTS price_points (
    itad_id TEXT NOT NULL,
    region  TEXT NOT NULL,
    day     INTEGER NOT NULL,
    price   REAL NOT NULL,
    regular REAL,
    shop    TEXT,
    PRIMARY KEY (itad_id, region, day)
) WITHOUT ROWID;`;

export function priceLogStore({ db, run, get, all, now }) {
    const put = db.prepare(`INSERT INTO price_points (itad_id, region, day, price, regular, shop) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(itad_id, region, day) DO UPDATE SET price = excluded.price, regular = excluded.regular, shop = excluded.shop WHERE excluded.price < price_points.price`);
    /** points: [{ id, price, regular, shop }]. One row per game, region and day; a lower price later the same day replaces it. */
    function logPrices(region, points, at = now()) {
        if (!points.length) return 0;
        const day = Math.floor(at / DAY);
        db.exec("BEGIN");
        try { for (const p of points) put.run(p.id, region, day, p.price, p.regular ?? null, p.shop ?? null); db.exec("COMMIT"); }
        catch (e) { db.exec("ROLLBACK"); throw e; }
        return points.length;
    }
    /** Same shape as the price site's history: [{ t, price, regular, shop }], oldest first. */
    const loggedHistory = (id, region = "US", sinceMs = now() - 365 * DAY) =>
        all("SELECT day, price, regular, shop FROM price_points WHERE itad_id = ? AND region = ? AND day >= ? ORDER BY day", id, region, Math.floor(sinceMs / DAY))
            .map(r => ({ t: r.day * DAY, price: r.price, regular: r.regular, shop: r.shop }));
    /** The lowest price the bot itself has seen: { price, shop, at, since } or null. */
    const loggedLow = (id, region = "US") => {
        const low = get("SELECT day, price, shop FROM price_points WHERE itad_id = ? AND region = ? ORDER BY price, day DESC LIMIT 1", id, region);
        if (!low) return null;
        return { price: low.price, shop: low.shop, at: low.day * DAY, since: get("SELECT MIN(day) AS d FROM price_points WHERE itad_id = ? AND region = ?", id, region).d * DAY };
    };
    const prunePricePoints = (at = now()) => run("DELETE FROM price_points WHERE day < ?", Math.floor(at / DAY) - KEEP_DAYS).changes;
    return { logPrices, loggedHistory, loggedLow, prunePricePoints };
}

/** Wraps the price client: looked-up prices are noted, and history falls back to the bot's own notes. */
export function withPriceLog(itad, db, { log = () => {} } = {}) {
    const prices = itad.getPrices.bind(itad), history = itad.getHistory?.bind(itad);
    itad.getPrices = async (ids, country = "US") => {
        const out = await prices(ids, country);
        try {
            const points = [];
            for (const [id, entry] of out) {
                const s = entry ? summarize(entry) : null;
                if (s?.best && Number.isFinite(s.best.price)) points.push({ id, price: s.best.price, regular: s.msrp, shop: s.best.shop });
            }
            db.logPrices(country, points);
        } catch (e) { log(`could not note prices: ${e?.message ?? e}`); } // the lookup itself still worked
        return out;
    };
    if (history) itad.getHistory = async (id, country = "US", sinceMs) => {
        let points = null;
        try { points = await history(id, country, sinceMs); }
        catch (e) { const own = db.loggedHistory(id, country, sinceMs); if (own.length) return own; throw e; }
        return points.length ? points : db.loggedHistory(id, country, sinceMs);
    };
    return itad;
}

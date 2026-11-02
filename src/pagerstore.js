// Messages with several cards (free games, price alerts, bundles) show one card at a time with page buttons.
// The cards are kept here so the buttons keep working after a restart.

export const pagerSchema = `
CREATE TABLE IF NOT EXISTS pager (
    token    TEXT PRIMARY KEY,
    data     TEXT NOT NULL,
    created  INTEGER NOT NULL
);
`;

const KEEP_MS = 30 * 24 * 3600_000;

export function pagerStore({ run, get, now }) {
    function savePager(token, data) {
        run("INSERT OR REPLACE INTO pager (token, data, created) VALUES (?,?,?)", token, JSON.stringify(data), now());
        if (Math.random() < 0.05) run("DELETE FROM pager WHERE created < ?", now() - KEEP_MS); // tidy up now and then
    }
    function getPager(token) {
        const r = get("SELECT data FROM pager WHERE token = ?", String(token));
        if (!r) return null;
        try { return JSON.parse(r.data); } catch { return null; }
    }
    return { savePager, getPager };
}

// Bundles a member bought: the name, what they paid and which games came in it. Value is worked out from live prices when viewed.
export const bundleSchema = `
CREATE TABLE IF NOT EXISTS bundles_bought (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    paid       REAL NOT NULL,
    bought_at  INTEGER NOT NULL,
    itad_ids   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bundles_bought_user ON bundles_bought(discord_id);`;

export const MAX_BUNDLES = 100;

export function bundleStore({ run, all, get, now }) {
    const parse = r => ({ ...r, ids: JSON.parse(r.itad_ids) });
    const listBundles = id => all("SELECT id, name, paid, bought_at, itad_ids FROM bundles_bought WHERE discord_id = ? ORDER BY bought_at DESC, id DESC", id).map(parse);
    const countBundles = id => get("SELECT COUNT(*) AS n FROM bundles_bought WHERE discord_id = ?", id).n;
    const addBundle = (id, name, paid, ids) => Number(run("INSERT INTO bundles_bought (discord_id, name, paid, bought_at, itad_ids) VALUES (?,?,?,?,?)", id, name, paid, now(), JSON.stringify(ids)).lastInsertRowid);
    const removeBundle = (id, bundleId) => run("DELETE FROM bundles_bought WHERE discord_id = ? AND id = ?", id, bundleId).changes > 0;
    return { listBundles, countBundles, addBundle, removeBundle };
}

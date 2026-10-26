// Storage for wishlists and alert settings, using Node's built-in SQLite (no extra dependency).
// Needs Node 22.13 or newer. Everything stored is listed in PRIVACY.md.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const MAX_ITEMS_PER_USER = 200;
export const TRIGGERS = ["any", "percent", "price", "atl"];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
    discord_id   TEXT PRIMARY KEY,
    guild_id     TEXT,
    steam_id     TEXT,
    region       TEXT NOT NULL DEFAULT 'US',
    stores       TEXT NOT NULL DEFAULT 'major',
    delivery     TEXT NOT NULL DEFAULT 'dm',
    paused       INTEGER NOT NULL DEFAULT 0,
    dm_failures  INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id    TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    itad_id       TEXT NOT NULL,
    title         TEXT NOT NULL,
    source        TEXT NOT NULL DEFAULT 'manual',
    trigger_type  TEXT NOT NULL DEFAULT 'any',
    trigger_value REAL,
    last_alert_price REAL,
    last_alert_at INTEGER,
    added_at      INTEGER NOT NULL,
    UNIQUE (discord_id, itad_id)
);
CREATE INDEX IF NOT EXISTS items_user ON items(discord_id);
CREATE TABLE IF NOT EXISTS guilds (
    guild_id   TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    set_by     TEXT,
    updated_at INTEGER NOT NULL
);
`;

export function openDb(path = "data/steamvaluechecker.db", { now = () => Date.now() } = {}) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    db.exec(SCHEMA);

    const run = (sql, ...p) => db.prepare(sql).run(...p);
    const get = (sql, ...p) => db.prepare(sql).get(...p);
    const all = (sql, ...p) => db.prepare(sql).all(...p);
    const clean = o => (o ? { ...o } : o); // node:sqlite rows have a null prototype

    function ensureUser(discordId, guildId = null) {
        run("INSERT OR IGNORE INTO users (discord_id, guild_id, created_at) VALUES (?, ?, ?)", discordId, guildId, now());
        if (guildId) run("UPDATE users SET guild_id = ? WHERE discord_id = ?", guildId, discordId);
        return getUser(discordId);
    }
    const getUser = id => clean(get("SELECT * FROM users WHERE discord_id = ?", id));

    const SETTABLE = new Set(["steam_id", "region", "stores", "delivery", "paused", "dm_failures", "guild_id"]);
    function updateUser(id, fields) {
        for (const [k, v] of Object.entries(fields)) {
            if (!SETTABLE.has(k)) throw new Error(`Cannot set ${k}`);
            run(`UPDATE users SET ${k} = ? WHERE discord_id = ?`, v, id);
        }
    }

    const countItems = id => get("SELECT COUNT(*) AS n FROM items WHERE discord_id = ?", id).n;
    const listItems = id => all("SELECT * FROM items WHERE discord_id = ? ORDER BY title COLLATE NOCASE", id).map(clean);

    /** Adds games, skipping ones already on the list. Returns { added, existing, skippedForLimit }. */
    function addItems(discordId, games, { source = "manual", trigger = "any", value = null } = {}) {
        let added = 0, existing = 0, skippedForLimit = 0;
        let n = countItems(discordId);
        db.exec("BEGIN");
        try {
            for (const g of games) {
                if (get("SELECT 1 AS x FROM items WHERE discord_id = ? AND itad_id = ?", discordId, g.itad_id)) { existing++; continue; }
                if (n >= MAX_ITEMS_PER_USER) { skippedForLimit++; continue; }
                run(
                    "INSERT INTO items (discord_id, itad_id, title, source, trigger_type, trigger_value, added_at) VALUES (?,?,?,?,?,?,?)",
                    discordId, g.itad_id, g.title, source, trigger, value, now()
                );
                n++; added++;
            }
            db.exec("COMMIT");
        } catch (err) {
            db.exec("ROLLBACK");
            throw err;
        }
        return { added, existing, skippedForLimit };
    }

    const removeItem = (discordId, itadId) =>
        run("DELETE FROM items WHERE discord_id = ? AND itad_id = ?", discordId, itadId).changes > 0;

    /** After a complete re-import: drop Steam-imported games that are no longer on the wishlist. Manual adds stay. */
    function removeSteamNotIn(discordId, keepIds) {
        const keep = new Set(keepIds);
        let removed = 0;
        for (const it of all("SELECT id, itad_id FROM items WHERE discord_id = ? AND source = 'steam'", discordId)) {
            if (!keep.has(it.itad_id)) { run("DELETE FROM items WHERE id = ?", it.id); removed++; }
        }
        return removed;
    }

    function setTrigger(discordId, type, value, itadId = null) {
        const sql = "UPDATE items SET trigger_type = ?, trigger_value = ?, last_alert_price = NULL WHERE discord_id = ?";
        return itadId
            ? run(`${sql} AND itad_id = ?`, type, value, discordId, itadId).changes
            : run(sql, type, value, discordId).changes;
    }

    const markAlerted = (itemId, price) =>
        run("UPDATE items SET last_alert_price = ?, last_alert_at = ? WHERE id = ?", price, now(), itemId);
    const clearAlerted = itemId => run("UPDATE items SET last_alert_price = NULL WHERE id = ?", itemId);

    /** Everything the poller needs: items of users who have not paused alerts. */
    const activeItems = () => all(
        `SELECT i.*, u.region, u.stores, u.delivery, u.guild_id
           FROM items i JOIN users u ON u.discord_id = i.discord_id
          WHERE u.paused = 0`
    ).map(clean);

    const setGuildChannel = (guildId, channelId, setBy) => run(
        `INSERT INTO guilds (guild_id, channel_id, set_by, updated_at) VALUES (?,?,?,?)
         ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id, set_by = excluded.set_by, updated_at = excluded.updated_at`,
        guildId, channelId, setBy, now()
    );
    const getGuild = guildId => (guildId ? clean(get("SELECT * FROM guilds WHERE guild_id = ?", guildId)) : undefined);
    const clearGuildChannel = guildId => run("DELETE FROM guilds WHERE guild_id = ?", guildId).changes > 0;

    function exportUser(discordId) {
        const u = getUser(discordId);
        if (!u) return null;
        return { user: u, items: listItems(discordId) };
    }

    function deleteUser(discordId) {
        db.exec("BEGIN");
        try {
            run("DELETE FROM items WHERE discord_id = ?", discordId);
            const r = run("DELETE FROM users WHERE discord_id = ?", discordId);
            db.exec("COMMIT");
            return r.changes > 0;
        } catch (err) {
            db.exec("ROLLBACK");
            throw err;
        }
    }

    return {
        ensureUser, getUser, updateUser, countItems, listItems, addItems, removeItem, removeSteamNotIn, setTrigger,
        markAlerted, clearAlerted, activeItems, setGuildChannel, getGuild, clearGuildChannel,
        exportUser, deleteUser, close: () => db.close()
    };
}

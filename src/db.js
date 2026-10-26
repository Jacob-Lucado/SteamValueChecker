// Storage for wishlists and alert settings, using Node's built-in SQLite (no extra dependency).
// Needs Node 22.13 or newer. Everything stored is listed in PRIVACY.md.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const MAX_ITEMS_PER_USER = 200;
export const MAX_LIBRARY_PER_USER = 500;
export const MAX_SERVER_LIST = 100;
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
CREATE TABLE IF NOT EXISTS library (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    itad_id    TEXT NOT NULL,
    title      TEXT NOT NULL,
    paid       REAL,
    added_at   INTEGER NOT NULL,
    UNIQUE (discord_id, itad_id)
);
CREATE TABLE IF NOT EXISTS library_snapshots (
    discord_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    day        TEXT NOT NULL,
    games      INTEGER NOT NULL,
    paid       REAL NOT NULL,
    msrp       REAL NOT NULL,
    msrp_paid  REAL NOT NULL DEFAULT 0,
    cheapest   REAL NOT NULL,
    PRIMARY KEY (discord_id, day)
);
CREATE TABLE IF NOT EXISTS alert_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    itad_id    TEXT,
    title      TEXT NOT NULL,
    kind       TEXT NOT NULL,
    price      REAL,
    regular    REAL,
    shop       TEXT,
    via        TEXT,
    at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS alert_log_user ON alert_log(discord_id, at);
CREATE TABLE IF NOT EXISTS seen (
    discord_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    key        TEXT NOT NULL,
    at         INTEGER NOT NULL,
    PRIMARY KEY (discord_id, key)
);
CREATE TABLE IF NOT EXISTS guild_deals (
    guild_id   TEXT NOT NULL,
    itad_id    TEXT NOT NULL,
    last_price REAL NOT NULL,
    at         INTEGER NOT NULL,
    PRIMARY KEY (guild_id, itad_id)
);
CREATE TABLE IF NOT EXISTS server_list (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    itad_id  TEXT NOT NULL,
    title    TEXT NOT NULL,
    added_by TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    UNIQUE (guild_id, itad_id)
);
CREATE TABLE IF NOT EXISTS server_votes (
    list_id    INTEGER NOT NULL REFERENCES server_list(id) ON DELETE CASCADE,
    discord_id TEXT NOT NULL,
    PRIMARY KEY (list_id, discord_id)
);
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

    // Columns added after the first release. Safe to run on every start.
    const cols = t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
    const addColumn = (table, name, def) => { if (!cols(table).includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`); };
    addColumn("users", "quiet_start", "INTEGER");
    addColumn("users", "quiet_end", "INTEGER");
    addColumn("users", "tz", "TEXT NOT NULL DEFAULT 'UTC'");
    addColumn("users", "digest", "INTEGER NOT NULL DEFAULT 0");
    addColumn("users", "digest_day", "INTEGER NOT NULL DEFAULT 0");
    addColumn("users", "last_digest_at", "INTEGER");
    addColumn("users", "bundles", "INTEGER NOT NULL DEFAULT 1");
    addColumn("users", "share", "INTEGER NOT NULL DEFAULT 0");
    addColumn("library_snapshots", "msrp_paid", "REAL NOT NULL DEFAULT 0");
    addColumn("guilds", "group_min", "INTEGER NOT NULL DEFAULT 0");

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

    const SETTABLE = new Set([
        "steam_id", "region", "stores", "delivery", "paused", "dm_failures", "guild_id",
        "quiet_start", "quiet_end", "tz", "digest", "digest_day", "last_digest_at", "bundles", "share"
    ]);
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

    const digestUsers = () => all("SELECT * FROM users WHERE digest = 1 AND paused = 0").map(clean);

    /** Everything the poller needs: items of users who have not paused alerts. */
    const activeItems = () => all(
        `SELECT i.*, u.region, u.stores, u.delivery, u.guild_id, u.quiet_start, u.quiet_end, u.tz, u.bundles, u.share
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


    // ---------- alert history and "already told you" memory ----------
    const logAlert = e => run(
        "INSERT INTO alert_log (discord_id, itad_id, title, kind, price, regular, shop, via, at) VALUES (?,?,?,?,?,?,?,?,?)",
        e.discord_id, e.itad_id ?? null, e.title, e.kind ?? "sale", e.price ?? null, e.regular ?? null, e.shop ?? null, e.via ?? null, now()
    );
    const listAlerts = (discordId, limit = 100) =>
        all("SELECT * FROM alert_log WHERE discord_id = ? ORDER BY at DESC, id DESC LIMIT ?", discordId, limit).map(clean);
    const pruneAlertLog = (olderThanMs = 90 * 86400_000) => run("DELETE FROM alert_log WHERE at < ?", now() - olderThanMs).changes;
    const hasSeen = (discordId, key) => Boolean(get("SELECT 1 AS x FROM seen WHERE discord_id = ? AND key = ?", discordId, key));
    const markSeen = (discordId, key) => run("INSERT OR IGNORE INTO seen (discord_id, key, at) VALUES (?,?,?)", discordId, key, now());
    const pruneSeen = (olderThanMs = 120 * 86400_000) => run("DELETE FROM seen WHERE at < ?", now() - olderThanMs).changes;

    // ---------- library: what you own and what you paid ----------
    const countLibrary = id => get("SELECT COUNT(*) AS n FROM library WHERE discord_id = ?", id).n;
    const listLibrary = id => all("SELECT * FROM library WHERE discord_id = ? ORDER BY title COLLATE NOCASE", id).map(clean);
    /** Adds or updates games. Returns { added, updated, skippedForLimit }. */
    function upsertLibrary(discordId, games) {
        let added = 0, updated = 0, skippedForLimit = 0;
        let n = countLibrary(discordId);
        db.exec("BEGIN");
        try {
            for (const g of games) {
                const have = get("SELECT id FROM library WHERE discord_id = ? AND itad_id = ?", discordId, g.itad_id);
                if (have) {
                    run("UPDATE library SET paid = ?, title = ? WHERE id = ?", g.paid ?? null, g.title, have.id);
                    updated++;
                } else if (n >= MAX_LIBRARY_PER_USER) {
                    skippedForLimit++;
                } else {
                    run("INSERT INTO library (discord_id, itad_id, title, paid, added_at) VALUES (?,?,?,?,?)", discordId, g.itad_id, g.title, g.paid ?? null, now());
                    n++; added++;
                }
            }
            db.exec("COMMIT");
        } catch (err) { db.exec("ROLLBACK"); throw err; }
        return { added, updated, skippedForLimit };
    }
    const removeLibrary = (discordId, itadId) => run("DELETE FROM library WHERE discord_id = ? AND itad_id = ?", discordId, itadId).changes > 0;

    const dayKey = (ms = now()) => new Date(ms).toISOString().slice(0, 10);
    const upsertSnapshot = (discordId, t) => run(
        `INSERT INTO library_snapshots (discord_id, day, games, paid, msrp, msrp_paid, cheapest) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(discord_id, day) DO UPDATE SET games = excluded.games, paid = excluded.paid, msrp = excluded.msrp, msrp_paid = excluded.msrp_paid, cheapest = excluded.cheapest`,
        discordId, dayKey(), t.games, t.paid, t.msrp, t.msrp_paid ?? t.msrp, t.cheapest
    );
    const listSnapshots = (discordId, limit = 365) =>
        all("SELECT day, games, paid, msrp, msrp_paid, cheapest FROM (SELECT * FROM library_snapshots WHERE discord_id = ? ORDER BY day DESC LIMIT ?) ORDER BY day", discordId, limit).map(clean);
    const hasSnapshotToday = discordId => Boolean(get("SELECT 1 AS x FROM library_snapshots WHERE discord_id = ? AND day = ?", discordId, dayKey()));
    const usersWithLibrary = () => all("SELECT DISTINCT discord_id FROM library").map(r => r.discord_id);
    /** Latest snapshot of each member who opted in and last used this server. */
    const sharedLeaderboard = guildId => all(
        `SELECT u.discord_id, s.games, s.paid, s.msrp, s.msrp_paid, s.cheapest
           FROM users u JOIN library_snapshots s ON s.discord_id = u.discord_id
          WHERE u.share = 1 AND u.guild_id = ?
            AND s.day = (SELECT MAX(day) FROM library_snapshots WHERE discord_id = u.discord_id)`, guildId).map(clean);

    // ---------- server settings: group pings ----------
    const setGroupMin = (guildId, min) => run("UPDATE guilds SET group_min = ? WHERE guild_id = ?", min, guildId).changes > 0;
    const guildsWithGroupPings = () => all("SELECT * FROM guilds WHERE group_min > 0").map(clean);
    const getGuildDeal = (guildId, itadId) => clean(get("SELECT * FROM guild_deals WHERE guild_id = ? AND itad_id = ?", guildId, itadId));
    const setGuildDeal = (guildId, itadId, price) => run(
        `INSERT INTO guild_deals (guild_id, itad_id, last_price, at) VALUES (?,?,?,?)
         ON CONFLICT(guild_id, itad_id) DO UPDATE SET last_price = excluded.last_price, at = excluded.at`, guildId, itadId, price, now());

    // ---------- shared server wishlist ----------
    function addServerGame(guildId, game, userId) {
        if (get("SELECT 1 AS x FROM server_list WHERE guild_id = ? AND itad_id = ?", guildId, game.itad_id)) return { existing: true };
        if (get("SELECT COUNT(*) AS n FROM server_list WHERE guild_id = ?", guildId).n >= MAX_SERVER_LIST) return { full: true };
        const r = run("INSERT INTO server_list (guild_id, itad_id, title, added_by, added_at) VALUES (?,?,?,?,?)", guildId, game.itad_id, game.title, userId, now());
        run("INSERT OR IGNORE INTO server_votes (list_id, discord_id) VALUES (?,?)", Number(r.lastInsertRowid), userId);
        return { added: true, id: Number(r.lastInsertRowid) };
    }
    const listServerGames = (guildId, viewerId) => all(
        `SELECT l.*, (SELECT COUNT(*) FROM server_votes v WHERE v.list_id = l.id) AS votes,
                EXISTS (SELECT 1 FROM server_votes v WHERE v.list_id = l.id AND v.discord_id = ?) AS voted
           FROM server_list l WHERE l.guild_id = ? ORDER BY votes DESC, l.title COLLATE NOCASE`, viewerId ?? "", guildId).map(r => ({ ...clean(r), voted: Boolean(r.voted) }));
    const getServerGame = (guildId, itadId) => clean(get("SELECT * FROM server_list WHERE guild_id = ? AND itad_id = ?", guildId, itadId));
    /** Toggles the member's vote. Returns the new state. */
    function toggleVote(listId, userId) {
        const had = get("SELECT 1 AS x FROM server_votes WHERE list_id = ? AND discord_id = ?", listId, userId);
        if (had) run("DELETE FROM server_votes WHERE list_id = ? AND discord_id = ?", listId, userId);
        else run("INSERT INTO server_votes (list_id, discord_id) VALUES (?,?)", listId, userId);
        return !had;
    }
    const removeServerGame = listId => run("DELETE FROM server_list WHERE id = ?", listId).changes > 0;

    // ---------- owner stats, backups ----------
    function stats() {
        const n = (sql, ...p) => get(sql, ...p).n;
        const since = ms => now() - ms;
        const byKind = Object.fromEntries(all("SELECT kind, COUNT(*) AS n FROM alert_log WHERE at > ? GROUP BY kind", since(7 * 86400_000)).map(r => [r.kind, r.n]));
        return {
            users: n("SELECT COUNT(*) AS n FROM users"),
            activeUsers: n("SELECT COUNT(DISTINCT u.discord_id) AS n FROM users u JOIN items i ON i.discord_id = u.discord_id WHERE u.paused = 0"),
            dmUsers: n("SELECT COUNT(*) AS n FROM users WHERE delivery = 'dm'"),
            channelUsers: n("SELECT COUNT(*) AS n FROM users WHERE delivery = 'channel'"),
            wishlistGames: n("SELECT COUNT(*) AS n FROM items"),
            uniqueGames: n("SELECT COUNT(DISTINCT itad_id) AS n FROM items"),
            libraryGames: n("SELECT COUNT(*) AS n FROM library"),
            serversWithChannel: n("SELECT COUNT(*) AS n FROM guilds"),
            alerts24h: n("SELECT COUNT(*) AS n FROM alert_log WHERE at > ?", since(86400_000)),
            alerts7d: byKind,
            usersFailingDm: n("SELECT COUNT(*) AS n FROM users WHERE dm_failures >= 3")
        };
    }

    /** Consistent copy of the whole database, safe while the bot is running. */
    function backupTo(path) {
        mkdirSync(dirname(path), { recursive: true });
        db.exec(`VACUUM INTO '${String(path).replace(/'/g, "''")}'`);
    }

    function exportUser(discordId) {
        const u = getUser(discordId);
        if (!u) return null;
        return { user: u, items: listItems(discordId), library: listLibrary(discordId), alerts: listAlerts(discordId, 500) };
    }

    function deleteUser(discordId) {
        db.exec("BEGIN");
        try {
            for (const t of ["items", "library", "library_snapshots", "alert_log", "seen"]) run(`DELETE FROM ${t} WHERE discord_id = ?`, discordId);
            run("DELETE FROM server_votes WHERE discord_id = ?", discordId);
            run("DELETE FROM server_list WHERE added_by = ?", discordId);
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
        markAlerted, clearAlerted, activeItems, digestUsers, setGuildChannel, getGuild, clearGuildChannel,
        logAlert, listAlerts, pruneAlertLog, hasSeen, markSeen, pruneSeen,
        countLibrary, listLibrary, upsertLibrary, removeLibrary, upsertSnapshot, listSnapshots, hasSnapshotToday, usersWithLibrary, sharedLeaderboard,
        setGroupMin, guildsWithGroupPings, getGuildDeal, setGuildDeal,
        addServerGame, listServerGames, getServerGame, toggleVote, removeServerGame,
        stats, backupTo, exportUser, deleteUser, close: () => db.close()
    };
}

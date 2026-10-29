// Storage for wishlists and alert settings, using Node's built-in SQLite (no extra dependency).
// Needs Node 22.13 or newer. Everything stored is listed in PRIVACY.md.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { giveawaySchema, giveawayStore } from "./gwstore.js";
import { ticketSchema, ticketStore } from "./ticketstore.js";
import { steamSchema, steamStore } from "./steamstore.js";
import { grabberSchema, grabberStore } from "./grabberstore.js";
import { redeemSchema, redeemStore } from "./redeemstore.js";
import { calendarSchema, calendarStore } from "./calendarstore.js";
import { lfgSchema, lfgStore } from "./lfgstore.js";
import { giftSchema, giftStore } from "./giftstore.js";
import { friendSchema, friendStore } from "./friendstore.js";
import { challengeSchema, challengeStore } from "./challengestore.js";
import { bundleSchema, bundleStore } from "./bundlestore.js";
import { broadcastSchema, broadcastStore } from "./broadcast.js";

export const MAX_ITEMS_PER_USER = 200;
export const MAX_LIBRARY_PER_USER = 1500;
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
CREATE TABLE IF NOT EXISTS card_prefs (
    discord_id TEXT PRIMARY KEY REFERENCES users(discord_id) ON DELETE CASCADE,
    prefs      TEXT NOT NULL DEFAULT '{}'
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
CREATE INDEX IF NOT EXISTS items_game ON items(itad_id);
CREATE TABLE IF NOT EXISTS site_visits (
    site     TEXT PRIMARY KEY,
    views    INTEGER NOT NULL DEFAULT 0,
    visitors INTEGER NOT NULL DEFAULT 0,
    since    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    type    TEXT NOT NULL,
    title   TEXT NOT NULL,
    body    TEXT,
    url     TEXT,
    at      INTEGER NOT NULL,
    read    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, at);
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
CREATE TABLE IF NOT EXISTS uptime_days (
    day   TEXT PRIMARY KEY,
    up    INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS status_events (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    at        INTEGER NOT NULL,
    component TEXT NOT NULL,
    state     TEXT NOT NULL,
    note      TEXT
);
CREATE TABLE IF NOT EXISTS status_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
${giveawaySchema}
${ticketSchema}
${steamSchema}
${grabberSchema}
${redeemSchema}
${calendarSchema}
${giftSchema}
${friendSchema}
${challengeSchema}
${bundleSchema}
${broadcastSchema}
${lfgSchema}`;

export function openDb(path = "data/steamvaluechecker.db", { now = () => Date.now() } = {}) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    db.exec(SCHEMA);

    // Columns added after the first release. Safe to run on every start.
    const cols = t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
    const addColumn = (table, name, def) => { if (!cols(table).includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`); };
    addColumn("items", "priority", "INTEGER NOT NULL DEFAULT 0");
    addColumn("items", "release_at", "INTEGER");
    addColumn("items", "release_check", "INTEGER");
    addColumn("items", "release_wait", "INTEGER NOT NULL DEFAULT 0");
    addColumn("users", "quiet_start", "INTEGER");
    addColumn("users", "quiet_end", "INTEGER");
    addColumn("users", "tz", "TEXT NOT NULL DEFAULT 'UTC'");
    addColumn("users", "digest", "INTEGER NOT NULL DEFAULT 0");
    addColumn("users", "digest_day", "INTEGER NOT NULL DEFAULT 0");
    addColumn("users", "last_digest_at", "INTEGER");
    addColumn("users", "bundles", "INTEGER NOT NULL DEFAULT 1");
    addColumn("users", "free", "INTEGER NOT NULL DEFAULT 0");
    addColumn("users", "share", "INTEGER NOT NULL DEFAULT 0");
    db.exec("CREATE INDEX IF NOT EXISTS users_guild ON users(guild_id, share)");
    addColumn("giveaways", "gallery", "TEXT");
    addColumn("items", "snooze_until", "INTEGER");
    addColumn("users", "muted", "TEXT NOT NULL DEFAULT ''");
    addColumn("users", "seen_version", "TEXT");
    addColumn("users", "lang", "TEXT NOT NULL DEFAULT 'en'");
    addColumn("users", "welcomed", "INTEGER NOT NULL DEFAULT 0");
    addColumn("users", "tipped", "INTEGER NOT NULL DEFAULT 0");
    addColumn("users", "free_dlc", "INTEGER NOT NULL DEFAULT 1");
    addColumn("giveaways", "require_boost", "INTEGER NOT NULL DEFAULT 0");
    addColumn("giveaways", "starts_at", "INTEGER");
    addColumn("giveaways", "duration_ms", "INTEGER");
    addColumn("guilds", "free_feed", "INTEGER NOT NULL DEFAULT 0");
    addColumn("guilds", "hot_min", "INTEGER NOT NULL DEFAULT 0");
    addColumn("guilds", "sale_feed", "INTEGER NOT NULL DEFAULT 0");
    db.exec("CREATE TABLE IF NOT EXISTS guild_seen (guild_id TEXT NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (guild_id, key))");
    addColumn("users", "min_discount", "INTEGER NOT NULL DEFAULT 0");
    addColumn("users", "profile_slug", "TEXT");
    addColumn("users", "profile_public", "INTEGER NOT NULL DEFAULT 0");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_profile_slug ON users(profile_slug) WHERE profile_slug IS NOT NULL");
    addColumn("library", "status", "TEXT NOT NULL DEFAULT 'backlog'");
    addColumn("library", "status_at", "INTEGER");
    addColumn("library", "appid", "INTEGER");
    addColumn("library", "minutes", "INTEGER NOT NULL DEFAULT 0");
    addColumn("library", "last_played", "INTEGER");
    addColumn("library", "ach_done", "INTEGER");
    addColumn("library", "ach_total", "INTEGER");
    addColumn("library", "ach_checked", "INTEGER");
    addColumn("items", "appid", "INTEGER");
    addColumn("library_snapshots", "msrp_paid", "REAL NOT NULL DEFAULT 0");
    addColumn("library_snapshots", "backlog", "INTEGER");
    addColumn("library_snapshots", "playing", "INTEGER");
    addColumn("library_snapshots", "finished", "INTEGER");
    addColumn("guilds", "group_min", "INTEGER NOT NULL DEFAULT 0");
    addColumn("guilds", "weekly_digest", "INTEGER NOT NULL DEFAULT 0");
    addColumn("guilds", "digest_at", "INTEGER");

    const run = (sql, ...p) => db.prepare(sql).run(...p);
    const get = (sql, ...p) => db.prepare(sql).get(...p);
    const all = (sql, ...p) => db.prepare(sql).all(...p);
    const clean = o => (o ? { ...o } : o); // node:sqlite rows have a null prototype
    const giveaways = giveawayStore({ db, run, get, all, clean, now });
    const tickets = ticketStore({ run, get, all, clean, now });
    const lfg = lfgStore({ db, run, get, all, clean, now });
    const grabber = grabberStore({ run, get, clean, now });
    const redeem = redeemStore({ run, get, all, clean, now });
    const calendar = calendarStore({ run, get, all, clean, now });
    const gifts = giftStore({ run, get, all, now });
    const friends = friendStore({ run, get, all, now });
    const challenges = challengeStore({ run, all });
    const bundles = bundleStore({ run, all, get, now });
    const broadcasts = broadcastStore({ run, all, get, now });
    const steam = steamStore({ db, run, get, all, clean, now, maxLibrary: MAX_LIBRARY_PER_USER });

    function ensureUser(discordId, guildId = null) {
        run("INSERT OR IGNORE INTO users (discord_id, guild_id, created_at) VALUES (?, ?, ?)", discordId, guildId, now());
        if (guildId) run("UPDATE users SET guild_id = ? WHERE discord_id = ?", guildId, discordId);
        return getUser(discordId);
    }
    const getUser = id => clean(get("SELECT * FROM users WHERE discord_id = ?", id));

    const SETTABLE = new Set(["muted", "seen_version", "lang", "welcomed", "tipped",
        "steam_id", "region", "stores", "delivery", "paused", "dm_failures", "guild_id",
        "quiet_start", "quiet_end", "tz", "digest", "digest_day", "last_digest_at", "bundles", "share", "free", "free_dlc", "min_discount"
    ]);
    function updateUser(id, fields) {
        for (const [k, v] of Object.entries(fields)) {
            if (!SETTABLE.has(k)) throw new Error(`Cannot set ${k}`);
            run(`UPDATE users SET ${k} = ? WHERE discord_id = ?`, v, id);
        }
    }

    const countItems = id => get("SELECT COUNT(*) AS n FROM items WHERE discord_id = ?", id).n;
    const listItems = id => all("SELECT * FROM items WHERE discord_id = ? ORDER BY priority DESC, title COLLATE NOCASE", id).map(clean);

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
                    "INSERT INTO items (discord_id, itad_id, title, source, trigger_type, trigger_value, added_at, appid) VALUES (?,?,?,?,?,?,?,?)",
                    discordId, g.itad_id, g.title, source, trigger, value, now(), Number.isInteger(g.appid) ? g.appid : null
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

    const getItemById = id => clean(get("SELECT * FROM items WHERE id = ?", id));
    /** Existing games get their Steam id filled in when a later import sees it (used for artwork and links). */
    const setAppId = (discordId, itadId, appid) => run("UPDATE items SET appid = ? WHERE discord_id = ? AND itad_id = ? AND appid IS NULL", appid, discordId, itadId);

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

    const freeUsers = () => all("SELECT * FROM users WHERE free = 1 AND paused = 0").map(clean);
    const digestUsers = () => all("SELECT * FROM users WHERE digest = 1 AND paused = 0").map(clean);

    /** Everything the poller needs: items of users who have not paused alerts. */
    /** Wishlist games whose release date is unknown or may have moved: unchecked, no date (weekly), or still in the future (daily). */
    const itemsNeedingRelease = (limit = 60) => all(
        `SELECT itad_id, MIN(title) AS title FROM items
          WHERE release_check IS NULL OR (release_at IS NULL AND release_check < ?) OR (release_at > ? AND release_check < ?)
          GROUP BY itad_id LIMIT ?`, now() - 7 * 86400_000, now(), now() - 86400_000, limit).map(clean);
    /** Stores a release date for every wishlist entry of a game. A game still unreleased on the first check is flagged so its launch gets announced. */
    const setRelease = (itadId, releaseAt) => run(
        `UPDATE items SET release_at = ?, release_wait = CASE WHEN release_check IS NULL AND ? > ? THEN 1 ELSE release_wait END, release_check = ? WHERE itad_id = ?`,
        releaseAt, releaseAt ?? 0, now(), now(), itadId);
    /** Wishlist entries flagged as unreleased that came out within the last week. */
    const releasedItems = () => all(
        `SELECT i.*, u.region, u.stores, u.delivery, u.guild_id, u.quiet_start, u.quiet_end, u.tz, u.muted
           FROM items i JOIN users u ON u.discord_id = i.discord_id
          WHERE u.paused = 0 AND i.release_wait = 1 AND i.release_at IS NOT NULL AND i.release_at <= ? AND i.release_at > ?`, now(), now() - 7 * 86400_000).map(clean);
    const activeItems = () => all(
        `SELECT i.*, u.region, u.stores, u.delivery, u.guild_id, u.quiet_start, u.quiet_end, u.tz, u.bundles, u.share, u.min_discount
           FROM items i JOIN users u ON u.discord_id = i.discord_id
          WHERE u.paused = 0 AND (i.snooze_until IS NULL OR i.snooze_until < ?)
            AND NOT EXISTS (SELECT 1 FROM library l WHERE l.discord_id = i.discord_id AND l.itad_id = i.itad_id)`,
        now()
    ).map(clean);
    /** Wishlist games that are already in the member's library (owned), so alerts for them are pointless. */
    const ownedWishlist = id => all("SELECT i.* FROM items i JOIN library l ON l.discord_id = i.discord_id AND l.itad_id = i.itad_id WHERE i.discord_id = ? ORDER BY i.title COLLATE NOCASE", id).map(clean);
    const removeOwnedWishlist = id => run("DELETE FROM items WHERE discord_id = ? AND itad_id IN (SELECT itad_id FROM library WHERE discord_id = ?)", id, id).changes;
    const setPriority = (id, itadId, on) => run("UPDATE items SET priority = ? WHERE discord_id = ? AND itad_id = ?", on ? 1 : 0, id, itadId).changes > 0;

    // Plain visit counters for the companion web page. Only totals are kept: no addresses, no per-visit rows.
    const siteHit = (site, newVisitor) => {
        run("INSERT INTO site_visits (site, views, visitors, since) VALUES (?, 1, ?, ?) ON CONFLICT(site) DO UPDATE SET views = views + 1, visitors = visitors + excluded.visitors", site, newVisitor ? 1 : 0, now());
        return siteCounts(site);
    };
    const siteCounts = site => clean(get("SELECT views, visitors, since FROM site_visits WHERE site = ?", site)) ?? { views: 0, visitors: 0, since: null };
    const snoozeItem = (itemId, until) => run("UPDATE items SET snooze_until = ? WHERE id = ?", until, itemId).changes;

    // Notification center: a copy of what the bot told this person, so it can be read later even if a DM was missed.
    const addNotification = (userId, { type, title, body = null, url = null }) =>
        run("INSERT INTO notifications (user_id, type, title, body, url, at) VALUES (?,?,?,?,?,?)", userId, type, String(title).slice(0, 200), body ? String(body).slice(0, 600) : null, url, now()).lastInsertRowid;
    const listNotifications = (userId, limit = 60) => all("SELECT * FROM notifications WHERE user_id = ? ORDER BY at DESC, id DESC LIMIT ?", userId, limit).map(clean);
    const unreadNotifications = userId => get("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0", userId).n;
    const readNotifications = userId => run("UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0", userId).changes;
    const pruneNotifications = (olderThanMs = 60 * 86400_000) => run("DELETE FROM notifications WHERE at < ?", now() - olderThanMs).changes;

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
    /** One-off watches are removed after their alert, or after a month if the price never moved. */
    const removeWatch = (userId, itadId) => run("DELETE FROM items WHERE discord_id = ? AND itad_id = ? AND source = 'watch'", userId, itadId).changes;
    const pruneWatches = (olderThanMs = 30 * 86400_000) => run("DELETE FROM items WHERE source = 'watch' AND added_at < ?", now() - olderThanMs).changes;
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
    const setLibraryPaid = (discordId, id, paid) => run("UPDATE library SET paid = ? WHERE id = ? AND discord_id = ?", paid, id, discordId).changes;
    const setProfile = (id, { slug, isPublic }) => run("UPDATE users SET profile_slug = ?, profile_public = ? WHERE discord_id = ?", slug, isPublic ? 1 : 0, id);
    const getProfileBySlug = slug => clean(get("SELECT * FROM users WHERE profile_slug = ?", slug));
    const LIB_STATUSES = ["backlog", "playing", "played", "finished", "dropped"];
    const setLibraryStatus = (discordId, itadId, status) => LIB_STATUSES.includes(status)
        ? run("UPDATE library SET status = ?, status_at = CASE WHEN status = ? THEN status_at ELSE ? END WHERE discord_id = ? AND itad_id = ?", status, status, now(), discordId, itadId).changes > 0 : false;
    const removeLibrary = (discordId, itadId) => run("DELETE FROM library WHERE discord_id = ? AND itad_id = ?", discordId, itadId).changes > 0;

    const dayKey = (ms = now()) => new Date(ms).toISOString().slice(0, 10);
    const upsertSnapshot = (discordId, t) => run(
        `INSERT INTO library_snapshots (discord_id, day, games, paid, msrp, msrp_paid, cheapest, backlog, playing, finished) VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(discord_id, day) DO UPDATE SET games = excluded.games, paid = excluded.paid, msrp = excluded.msrp, msrp_paid = excluded.msrp_paid, cheapest = excluded.cheapest,
             backlog = excluded.backlog, playing = excluded.playing, finished = excluded.finished`,
        discordId, dayKey(), t.games, t.paid, t.msrp, t.msrp_paid ?? t.msrp, t.cheapest, t.backlog ?? null, t.playing ?? null, t.finished ?? null
    );
    const listSnapshots = (discordId, limit = 365) =>
        all("SELECT day, games, paid, msrp, msrp_paid, cheapest, backlog, playing, finished FROM (SELECT * FROM library_snapshots WHERE discord_id = ? ORDER BY day DESC LIMIT ?) ORDER BY day", discordId, limit).map(clean);
    const hasSnapshotToday = discordId => Boolean(get("SELECT 1 AS x FROM library_snapshots WHERE discord_id = ? AND day = ?", discordId, dayKey()));
    const usersWithLibrary = () => all("SELECT DISTINCT discord_id FROM library").map(r => r.discord_id);
    /** Latest snapshot of each member who opted in and last used this server. */
    const sharedLeaderboard = guildId => all(
        `SELECT u.discord_id, s.games, s.paid, s.msrp, s.msrp_paid, s.cheapest
           FROM users u JOIN library_snapshots s ON s.discord_id = u.discord_id
          WHERE u.share = 1 AND u.guild_id = ?
            AND s.day = (SELECT MAX(day) FROM library_snapshots WHERE discord_id = u.discord_id)`, guildId).map(clean);

    /** Games finished in a time window by members who opted in, for the backlog league. */
    const sharedFinished = (guildId, from, to) => all(
        `SELECT u.discord_id, COUNT(*) AS done FROM users u JOIN library l ON l.discord_id = u.discord_id
          WHERE u.share = 1 AND u.guild_id = ? AND l.status = 'finished' AND l.status_at >= ? AND l.status_at < ?
          GROUP BY u.discord_id ORDER BY done DESC`, guildId, from, to).map(clean);

    /** Hours tracked since a day (YYYY-MM-DD) by members who opted in, for the hours board. */
    const sharedHours = (guildId, fromDay) => all(
        `SELECT u.discord_id, SUM(p.minutes) AS minutes FROM users u JOIN playtime_log p ON p.discord_id = u.discord_id
          WHERE u.share = 1 AND u.guild_id = ? AND p.day >= ? GROUP BY u.discord_id HAVING minutes > 0 ORDER BY minutes DESC`, guildId, fromDay).map(clean);

    // ---------- server settings: free game feed and stats ----------
    const setFreeFeed = (guildId, on) => run("UPDATE guilds SET free_feed = ? WHERE guild_id = ?", on ? 1 : 0, guildId).changes > 0;
    const setHotMin = (guildId, min) => run("UPDATE guilds SET hot_min = ? WHERE guild_id = ?", min, guildId).changes > 0;
    const guildsWithHot = () => all("SELECT * FROM guilds WHERE hot_min > 0").map(clean);
    const setSaleFeed = (guildId, on) => run("UPDATE guilds SET sale_feed = ? WHERE guild_id = ?", on ? 1 : 0, guildId).changes > 0;
    const guildsWithSaleFeed = () => all("SELECT * FROM guilds WHERE sale_feed = 1").map(clean);
    const guildsWithFreeFeed = () => all("SELECT * FROM guilds WHERE free_feed = 1").map(clean);
    const guildHasSeen = (guildId, key) => Boolean(get("SELECT 1 AS x FROM guild_seen WHERE guild_id = ? AND key = ?", guildId, key));
    const guildMarkSeen = (guildId, key) => run("INSERT OR IGNORE INTO guild_seen (guild_id, key, at) VALUES (?,?,?)", guildId, key, now());
    const pruneGuildSeen = (olderThanMs = 120 * 86400_000) => run("DELETE FROM guild_seen WHERE at < ?", now() - olderThanMs).changes;
    /** Aggregate numbers for members who opted in to sharing in this server. Counts only, never who wants what. */
    const guildStats = guildId => ({
        members: get("SELECT COUNT(*) AS n FROM users WHERE share = 1 AND guild_id = ?", guildId).n,
        mostWanted: all(`SELECT i.title AS title, COUNT(*) AS watchers FROM items i JOIN users u ON u.discord_id = i.discord_id
                          WHERE u.share = 1 AND u.guild_id = ? AND i.source != 'watch'
                          GROUP BY i.itad_id ORDER BY watchers DESC, i.title LIMIT 5`, guildId).map(clean),
        alerts30d: get(`SELECT COUNT(*) AS n FROM alert_log a JOIN users u ON u.discord_id = a.discord_id
                         WHERE u.share = 1 AND u.guild_id = ? AND a.at > ? AND a.kind = 'sale'`, guildId, now() - 30 * 86400_000).n
    });

    // ---------- server settings: group pings ----------
    const setWeeklyDigest = (guildId, on) => run("UPDATE guilds SET weekly_digest = ? WHERE guild_id = ?", on ? 1 : 0, guildId).changes > 0;
    const guildsWithDigest = () => all("SELECT * FROM guilds WHERE weekly_digest = 1").map(clean);
    const markGuildDigest = guildId => run("UPDATE guilds SET digest_at = ? WHERE guild_id = ?", now(), guildId);
    /** Games watched by at least one opted-in member of the server, with how many. Never says who. */
    const sharedWatchedItems = guildId => all(`SELECT i.itad_id AS itad_id, MIN(i.title) AS title, COUNT(DISTINCT u.discord_id) AS watchers
                          FROM items i JOIN users u ON u.discord_id = i.discord_id
                          WHERE u.share = 1 AND u.guild_id = ? AND i.source != 'watch'
                          GROUP BY i.itad_id ORDER BY watchers DESC, title LIMIT 60`, guildId).map(clean);
    const setGroupMin = (guildId, min) => run("UPDATE guilds SET group_min = ? WHERE guild_id = ?", min, guildId).changes > 0;
    // Game night nudges in voice channels (a per-server switch; kept in the small key/value table).
    const sharingMembers = guildId => all("SELECT discord_id FROM users WHERE share = 1 AND guild_id = ?", guildId).map(r => r.discord_id);
    const setGameNight = (guildId, on) => (on ? run("INSERT INTO status_meta (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = '1'", `gamenight:${guildId}`) : run("DELETE FROM status_meta WHERE key = ?", `gamenight:${guildId}`));
    const gameNightOn = guildId => getMeta(`gamenight:${guildId}`) === "1";
    const guildsWithGameNight = () => all("SELECT key FROM status_meta WHERE key LIKE 'gamenight:%'").map(r => ({ guild_id: r.key.slice(10) }));
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

    /** Owner-only numbers for the Admin page: growth per day, who uses which feature, what people watch and where they are. */
    function adminInsights() {
        const safe = (sql, ...p) => { try { return get(sql, ...p).n; } catch { return null; } };
        const days = 30, start = new Date(now() - (days - 1) * 86400_000), first = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
        const perDay = (table, col) => {
            const rows = new Map(all(`SELECT strftime('%Y-%m-%d', ${col} / 1000, 'unixepoch') AS d, COUNT(*) AS n FROM ${table} WHERE ${col} >= ? GROUP BY d`, first).map(r => [r.d, r.n]));
            return Array.from({ length: days }, (_, i) => { const d = new Date(first + i * 86400_000).toISOString().slice(0, 10); return { day: d, n: rows.get(d) ?? 0 }; });
        };
        const thisMonth = new Date(now()).toISOString().slice(0, 7);
        return {
            signups: perDay("users", "created_at"), alerts: perDay("alert_log", "at"),
            regions: all("SELECT region AS k, COUNT(*) AS n FROM users GROUP BY region ORDER BY n DESC LIMIT 8").map(clean),
            languages: all("SELECT COALESCE(lang, 'en') AS k, COUNT(*) AS n FROM users GROUP BY k ORDER BY n DESC").map(clean),
            watched: all("SELECT title, COUNT(DISTINCT discord_id) AS n FROM items GROUP BY itad_id ORDER BY n DESC, title LIMIT 10").map(clean),
            features: [
                ["Linked Steam", safe("SELECT COUNT(*) AS n FROM steam_links")], ["FanaticalGrabber link codes", safe("SELECT COUNT(*) AS n FROM grabber_links")],
                ["Opted in to server boards", safe("SELECT COUNT(*) AS n FROM users WHERE share = 1")], ["Public wishlist pages", safe("SELECT COUNT(*) AS n FROM users WHERE profile_public = 1")],
                ["Custom profile cards", safe("SELECT COUNT(*) AS n FROM card_prefs")], ["Bundles tracked", safe("SELECT COUNT(*) AS n FROM bundles_bought")],
                ["Hours goals this year", safe("SELECT COUNT(*) AS n FROM hour_goals")], ["Backlog challenges this month", safe("SELECT COUNT(*) AS n FROM challenges WHERE month = ?", thisMonth)],
                ["Friends added", safe("SELECT COUNT(*) AS n FROM friends")], ["Open looking-for-group posts", safe("SELECT COUNT(*) AS n FROM lfg_posts WHERE status = 'open'")],
                ["Server calendar events", safe("SELECT COUNT(*) AS n FROM calendar_events")], ["Running giveaways", safe("SELECT COUNT(*) AS n FROM giveaways WHERE status = 'active'")],
                ["Open support tickets", safe("SELECT COUNT(*) AS n FROM tickets WHERE status IN ('open','waiting')")], ["Weekly digest on", safe("SELECT COUNT(*) AS n FROM users WHERE digest = 1")],
                ["Quiet hours set", safe("SELECT COUNT(*) AS n FROM users WHERE quiet_start IS NOT NULL")], ["Minimum discount set", safe("SELECT COUNT(*) AS n FROM users WHERE min_discount > 0")],
                ["Paused alerts", safe("SELECT COUNT(*) AS n FROM users WHERE paused = 1")]
            ],
            idle: { noWishlistOrLibrary: safe("SELECT COUNT(*) AS n FROM users u WHERE NOT EXISTS (SELECT 1 FROM items i WHERE i.discord_id = u.discord_id) AND NOT EXISTS (SELECT 1 FROM library l WHERE l.discord_id = u.discord_id)"), dmFailing: safe("SELECT COUNT(*) AS n FROM users WHERE dm_failures >= 3") },
            servers: all("SELECT g.guild_id AS id, g.free_feed, g.hot_min, g.sale_feed, g.group_min, g.weekly_digest, (SELECT COUNT(*) FROM users u WHERE u.guild_id = g.guild_id) AS members FROM guilds g ORDER BY members DESC").map(clean)
        };
    }

    /** One member for the owner's lookup: counts and settings only, never keys or game lists. */
    function adminUser(id) {
        const u = getUser(id);
        if (!u) return null;
        const n = (sql) => get(sql, id).n;
        return { id: u.discord_id, joined: u.created_at, region: u.region, delivery: u.delivery, paused: Boolean(u.paused), dmFailures: u.dm_failures, share: Boolean(u.share), lang: u.lang ?? "en",
            wishlist: n("SELECT COUNT(*) AS n FROM items WHERE discord_id = ?"), library: n("SELECT COUNT(*) AS n FROM library WHERE discord_id = ?"),
            steam: Boolean(get("SELECT 1 AS n FROM steam_links WHERE discord_id = ?", id)), grabber: Boolean(get("SELECT 1 AS n FROM grabber_links WHERE discord_id = ?", id)),
            alerts: n("SELECT COUNT(*) AS n FROM alert_log WHERE discord_id = ?"), tickets: n("SELECT COUNT(*) AS n FROM tickets WHERE user_id = ?") };
    }
    const clearAllDmFailures = () => run("UPDATE users SET dm_failures = 0 WHERE dm_failures > 0").changes;

    /** Consistent copy of the whole database, safe while the bot is running. */
    function backupTo(path) {
        mkdirSync(dirname(path), { recursive: true });
        db.exec(`VACUUM INTO '${String(path).replace(/'/g, "''")}'`);
    }

    // What the shareable profile card shows: platform names, colour, picture links and which stats. One small JSON blob per member.
    const getCardPrefs = discordId => { try { return JSON.parse(get("SELECT prefs FROM card_prefs WHERE discord_id = ?", discordId)?.prefs ?? "{}"); } catch { return {}; } };
    const setCardPrefs = (discordId, prefs) => run("INSERT INTO card_prefs (discord_id, prefs) VALUES (?, ?) ON CONFLICT(discord_id) DO UPDATE SET prefs = excluded.prefs", discordId, JSON.stringify(prefs));

    function exportUser(discordId) {
        const u = getUser(discordId);
        if (!u) return null;
        const support = tickets.listTickets({ userId: discordId, limit: 200 }).map(t => ({ id: t.id, subject: t.subject, status: t.status, created_at: t.created_at, messages: tickets.listTicketMessages(t.id).map(m => ({ role: m.role, body: m.body, at: m.at })) }));
        return { user: u, friends: friends.listFriends(discordId), challenges: challenges.challengeRows(discordId), bundles: bundles.listBundles(discordId).map(b => ({ name: b.name, paid: b.paid, bought_at: b.bought_at, games: b.ids.length })), items: listItems(discordId), library: listLibrary(discordId), steam_link: steam.getSteamLink(discordId), playtime_log: steam.playtimeLog(discordId), grabber_link: grabber.getGrabberLink(discordId), calendar_feed: calendar.getCalFeed(discordId), redeem_history: redeem.redeemHistory(discordId, 500), lfg_posts: lfg.lfgForUser(discordId), alerts: listAlerts(discordId, 500), support_tickets: support, profile_card: getCardPrefs(discordId) };
    }

    function deleteUser(discordId) {
        db.exec("BEGIN");
        try {
            for (const t of ["items", "library", "library_snapshots", "alert_log", "seen", "steam_links", "playtime_log", "grabber_links", "redeem_jobs", "redeem_log", "gift_claims", "challenges", "bundles_bought", "friends"]) run(`DELETE FROM ${t} WHERE discord_id = ?`, discordId);
            run("DELETE FROM server_votes WHERE discord_id = ?", discordId);
            giveaways.forgetGiveawayUser(discordId);
            calendar.forgetCalendarUser(discordId);
            lfg.forgetLfgUser(discordId);
            tickets.deleteUserTickets(discordId);
            run("DELETE FROM server_list WHERE added_by = ?", discordId);
            const r = run("DELETE FROM users WHERE discord_id = ?", discordId);
            db.exec("COMMIT");
            return r.changes > 0;
        } catch (err) {
            db.exec("ROLLBACK");
            throw err;
        }
    }

    // Status page history: per-day up/total minutes, a log of state changes, and the last time the monitor ran.
    const uptimeAdd = (day, up, total) => run("INSERT INTO uptime_days (day, up, total) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET up = up + excluded.up, total = total + excluded.total", day, up, total);
    const uptimeDays = since => all("SELECT day, up, total FROM uptime_days WHERE day >= ? ORDER BY day", since).map(clean);
    const addStatusEvent = (at, component, state, note = null) => {
        run("INSERT INTO status_events (at, component, state, note) VALUES (?, ?, ?, ?)", at, component, state, note);
        run("DELETE FROM status_events WHERE id NOT IN (SELECT id FROM status_events ORDER BY id DESC LIMIT 200)");
    };
    const statusEvents = (limit = 20) => all("SELECT at, component, state, note FROM status_events ORDER BY id DESC LIMIT ?", limit).map(clean);
    const getMeta = key => get("SELECT value FROM status_meta WHERE key = ?", key)?.value ?? null;
    const setMeta = (key, value) => run("INSERT INTO status_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, String(value));

    // One time: an earlier version marked every Steam game with an hour or more as "playing". Only games touched in the last
    // two weeks keep that; the rest become "played". Runs once, so a status you choose later is never changed.
    if (getMeta("migrated:steam-played") === null) {
        run("UPDATE library SET status = 'played' WHERE appid IS NOT NULL AND status = 'playing' AND (last_played IS NULL OR last_played < ?)", now() - 14 * 86400_000);
        setMeta("migrated:steam-played", "1");
    }

    return {
        uptimeAdd, uptimeDays, addStatusEvent, statusEvents, getMeta, setMeta,
        siteHit, siteCounts, snoozeItem, addNotification, listNotifications, unreadNotifications, readNotifications, pruneNotifications, ensureUser, getUser, updateUser, countItems, listItems, addItems, getItemById, setAppId, removeItem, ownedWishlist, removeOwnedWishlist, setPriority, removeSteamNotIn, setTrigger,
        markAlerted, clearAlerted, activeItems, itemsNeedingRelease, setRelease, releasedItems, digestUsers, freeUsers, setGuildChannel, getGuild, clearGuildChannel,
        logAlert, listAlerts, pruneAlertLog, hasSeen, markSeen, pruneSeen, removeWatch, pruneWatches,
        countLibrary, listLibrary, upsertLibrary, setLibraryPaid, removeLibrary, setLibraryStatus, setProfile, getProfileBySlug, upsertSnapshot, listSnapshots, hasSnapshotToday, usersWithLibrary, sharedLeaderboard, sharedFinished, sharedHours,
        sharingMembers, setGameNight, gameNightOn, guildsWithGameNight, setGroupMin, setWeeklyDigest, guildsWithDigest, markGuildDigest, sharedWatchedItems, setFreeFeed, guildsWithFreeFeed, setHotMin, guildsWithHot, setSaleFeed, guildsWithSaleFeed, guildHasSeen, guildMarkSeen, pruneGuildSeen, guildStats, guildsWithGroupPings, getGuildDeal, setGuildDeal,
        addServerGame, listServerGames, getServerGame, toggleVote, removeServerGame,
        stats, adminInsights, adminUser, clearAllDmFailures, backupTo, exportUser, deleteUser, getCardPrefs, setCardPrefs, ...giveaways, ...tickets, ...steam, ...grabber, ...redeem, ...calendar, ...gifts, ...friends, ...challenges, ...bundles, ...broadcasts, ...lfg, close: () => db.close()
    };
}

// Database tables and queries for server giveaways. Prize keys are stored encrypted (see vault.js) and wiped as soon as
// they are no longer needed. Key values never appear in any query result except `key_enc`, which only giveaway.js reads.

export const MAX_ACTIVE_GIVEAWAYS = 10;
export const MAX_KEYS = 50;

export const giveawaySchema = `
CREATE TABLE IF NOT EXISTS giveaways (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id         TEXT NOT NULL,
    channel_id       TEXT NOT NULL,
    message_id       TEXT,
    announce_id      TEXT,
    host_id          TEXT NOT NULL,
    title            TEXT NOT NULL,
    description      TEXT,
    game_title       TEXT,
    image_url        TEXT,
    thumbnail_url    TEXT,
    color            INTEGER,
    button_label     TEXT,
    ping_role_id     TEXT,
    require_role_id  TEXT,
    bonus_role_id    TEXT,
    bonus_entries    INTEGER NOT NULL DEFAULT 1,
    min_account_days INTEGER NOT NULL DEFAULT 0,
    min_member_days  INTEGER NOT NULL DEFAULT 0,
    claim_hours      INTEGER NOT NULL DEFAULT 48,
    vouch_channel_id TEXT,
    status           TEXT NOT NULL DEFAULT 'active',
    ends_at          INTEGER NOT NULL,
    created_at       INTEGER NOT NULL,
    ended_at         INTEGER,
    leftover_notified INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS giveaways_guild ON giveaways(guild_id, status);
CREATE TABLE IF NOT EXISTS giveaway_entries (
    giveaway_id INTEGER NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
    discord_id  TEXT NOT NULL,
    entries     INTEGER NOT NULL DEFAULT 1,
    entered_at  INTEGER NOT NULL,
    PRIMARY KEY (giveaway_id, discord_id)
);
CREATE TABLE IF NOT EXISTS giveaway_keys (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    giveaway_id  INTEGER NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL,
    label        TEXT NOT NULL,
    key_enc      TEXT,
    status       TEXT NOT NULL DEFAULT 'available',
    winner_id    TEXT,
    assigned_at  INTEGER,
    deadline     INTEGER,
    delivered_at INTEGER,
    delivered_via TEXT,
    confirm_at   INTEGER,
    prompts      INTEGER NOT NULL DEFAULT 0,
    confirmed_at INTEGER,
    redraws      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS giveaway_keys_g ON giveaway_keys(giveaway_id);
CREATE TABLE IF NOT EXISTS giveaway_excluded (
    key_id     INTEGER NOT NULL REFERENCES giveaway_keys(id) ON DELETE CASCADE,
    discord_id TEXT NOT NULL,
    PRIMARY KEY (key_id, discord_id)
);
CREATE TABLE IF NOT EXISTS giveaway_settings (
    guild_id        TEXT PRIMARY KEY,
    vouch_channel_id TEXT,
    manager_role_id TEXT
);
`;

const GIVEAWAY_FIELDS = [
    "guild_id", "channel_id", "host_id", "title", "description", "game_title", "image_url", "thumbnail_url", "color", "button_label",
    "ping_role_id", "require_role_id", "bonus_role_id", "bonus_entries", "min_account_days", "min_member_days", "claim_hours",
    "vouch_channel_id", "ends_at"
];

export function giveawayStore({ db, run, get, all, clean, now }) {
    // Rows handed out never carry the encrypted key unless asked for.
    const KEY_COLS = "id, giveaway_id, position, label, status, winner_id, assigned_at, deadline, delivered_at, delivered_via, confirm_at, prompts, confirmed_at, redraws, (key_enc IS NOT NULL) AS has_key";

    const getGiveaway = id => clean(get("SELECT * FROM giveaways WHERE id = ?", id));
    const listGiveaways = (guildId, { limit = 25 } = {}) =>
        all("SELECT * FROM giveaways WHERE guild_id = ? ORDER BY (status = 'active') DESC, created_at DESC LIMIT ?", guildId, limit).map(clean);
    const countActiveGiveaways = guildId => get("SELECT COUNT(*) AS n FROM giveaways WHERE guild_id = ? AND status = 'active'", guildId).n;
    const dueGiveaways = ms => all("SELECT * FROM giveaways WHERE status = 'active' AND ends_at <= ?", ms).map(clean);
    const giveawayByMessage = messageId => clean(get("SELECT * FROM giveaways WHERE message_id = ?", messageId));

    /** keys: [{ label, enc }]. Creates the giveaway and its prizes in one step. */
    function createGiveaway(g, keys) {
        db.exec("BEGIN");
        try {
            const cols = GIVEAWAY_FIELDS;
            const r = run(
                `INSERT INTO giveaways (${cols.join(", ")}, created_at) VALUES (${cols.map(() => "?").join(", ")}, ?)`,
                ...cols.map(c => g[c] ?? (c === "bonus_entries" ? 1 : c === "claim_hours" ? 48 : c === "min_account_days" || c === "min_member_days" ? 0 : null)), now()
            );
            const id = Number(r.lastInsertRowid);
            keys.forEach((k, i) => run("INSERT INTO giveaway_keys (giveaway_id, position, label, key_enc) VALUES (?,?,?,?)", id, i + 1, k.label, k.enc));
            db.exec("COMMIT");
            return id;
        } catch (err) { db.exec("ROLLBACK"); throw err; }
    }
    const setGiveawayMessage = (id, messageId) => run("UPDATE giveaways SET message_id = ? WHERE id = ?", messageId, id);
    const setAnnounceMessage = (id, messageId) => run("UPDATE giveaways SET announce_id = ? WHERE id = ?", messageId, id);
    const setGiveawayStatus = (id, status) => run("UPDATE giveaways SET status = ?, ended_at = ? WHERE id = ?", status, now(), id);
    const markLeftoverNotified = id => run("UPDATE giveaways SET leftover_notified = 1 WHERE id = ?", id);
    const deleteGiveaway = id => run("DELETE FROM giveaways WHERE id = ?", id).changes > 0;

    // entries
    const getEntry = (id, userId) => clean(get("SELECT * FROM giveaway_entries WHERE giveaway_id = ? AND discord_id = ?", id, userId));
    const addEntry = (id, userId, entries) => run("INSERT OR REPLACE INTO giveaway_entries (giveaway_id, discord_id, entries, entered_at) VALUES (?,?,?,?)", id, userId, entries, now());
    const removeEntry = (id, userId) => run("DELETE FROM giveaway_entries WHERE giveaway_id = ? AND discord_id = ?", id, userId).changes > 0;
    const listEntries = id => all("SELECT discord_id, entries FROM giveaway_entries WHERE giveaway_id = ?", id).map(clean);
    const countEntries = id => get("SELECT COUNT(*) AS n FROM giveaway_entries WHERE giveaway_id = ?", id).n;

    // keys
    const listKeys = id => all(`SELECT ${KEY_COLS} FROM giveaway_keys WHERE giveaway_id = ? ORDER BY position`, id).map(r => ({ ...clean(r), has_key: Boolean(r.has_key) }));
    const getKey = keyId => { const r = get(`SELECT ${KEY_COLS} FROM giveaway_keys WHERE id = ?`, keyId); return r ? { ...clean(r), has_key: Boolean(r.has_key) } : undefined; };
    const getKeyEnc = keyId => get("SELECT key_enc FROM giveaway_keys WHERE id = ?", keyId)?.key_enc ?? null;
    const keyForWinner = (giveawayId, userId) => {
        const r = get(`SELECT ${KEY_COLS} FROM giveaway_keys WHERE giveaway_id = ? AND winner_id = ? ORDER BY position LIMIT 1`, giveawayId, userId);
        return r ? { ...clean(r), has_key: Boolean(r.has_key) } : undefined;
    };
    const assignKey = (keyId, userId, deadline) => run(
        "UPDATE giveaway_keys SET status = 'assigned', winner_id = ?, assigned_at = ?, deadline = ?, delivered_at = NULL, delivered_via = NULL, confirm_at = NULL, prompts = 0 WHERE id = ?",
        userId, now(), deadline, keyId);
    const releaseKey = keyId => run("UPDATE giveaway_keys SET status = 'available', winner_id = NULL, deadline = NULL, assigned_at = NULL WHERE id = ?", keyId);
    const bumpRedraw = keyId => run("UPDATE giveaway_keys SET redraws = redraws + 1 WHERE id = ?", keyId);
    const markDelivered = (keyId, via, confirmAt) => run(
        "UPDATE giveaway_keys SET status = 'delivered', delivered_at = COALESCE(delivered_at, ?), delivered_via = ?, confirm_at = COALESCE(confirm_at, ?) WHERE id = ? AND status IN ('assigned','delivered','problem')",
        now(), via, confirmAt, keyId);
    const markConfirmed = keyId => run("UPDATE giveaway_keys SET status = 'confirmed', confirmed_at = ?, key_enc = NULL, confirm_at = NULL WHERE id = ?", now(), keyId);
    const markProblem = keyId => run("UPDATE giveaway_keys SET status = 'problem', confirm_at = NULL WHERE id = ?", keyId);
    const replaceKeyEnc = (keyId, enc, deadline) => run(
        "UPDATE giveaway_keys SET key_enc = ?, status = 'assigned', deadline = ?, delivered_at = NULL, delivered_via = NULL, confirm_at = NULL, prompts = 0 WHERE id = ?", enc, deadline, keyId);
    const wipeKey = (keyId, status) => run("UPDATE giveaway_keys SET key_enc = NULL, status = ? WHERE id = ?", status, keyId);
    const setConfirmAt = (keyId, at, prompts) => run("UPDATE giveaway_keys SET confirm_at = ?, prompts = ? WHERE id = ?", at, prompts, keyId);
    const excludeFor = (keyId, userId) => run("INSERT OR IGNORE INTO giveaway_excluded (key_id, discord_id) VALUES (?,?)", keyId, userId);
    const excludedFor = keyId => all("SELECT discord_id FROM giveaway_excluded WHERE key_id = ?", keyId).map(r => r.discord_id);

    // work the scheduler picks up
    const expiredClaims = ms => all(`SELECT ${KEY_COLS} FROM giveaway_keys WHERE status = 'assigned' AND deadline IS NOT NULL AND deadline <= ?`, ms).map(r => ({ ...clean(r), has_key: Boolean(r.has_key) }));
    const duePrompts = ms => all(`SELECT ${KEY_COLS} FROM giveaway_keys WHERE status = 'delivered' AND confirm_at IS NOT NULL AND confirm_at <= ?`, ms).map(r => ({ ...clean(r), has_key: Boolean(r.has_key) }));
    /** Keys that are no longer needed: delivered but never confirmed after `deliveredMs`, or unclaimed on an ended giveaway after `leftoverMs`. */
    function purgeKeys(deliveredMs = 14 * 86400_000, leftoverMs = 7 * 86400_000) {
        const a = run("UPDATE giveaway_keys SET key_enc = NULL, status = 'expired' WHERE key_enc IS NOT NULL AND status = 'delivered' AND delivered_at < ?", now() - deliveredMs).changes;
        const b = run(
            `UPDATE giveaway_keys SET key_enc = NULL, status = 'expired'
              WHERE key_enc IS NOT NULL AND status IN ('available','assigned','problem')
                AND giveaway_id IN (SELECT id FROM giveaways WHERE status IN ('ended','cancelled') AND ended_at < ?)`, now() - leftoverMs).changes;
        return a + b;
    }
    /** Old giveaways (and their entries) are removed after 90 days. */
    const purgeGiveaways = (olderThanMs = 90 * 86400_000) =>
        run("DELETE FROM giveaways WHERE status IN ('ended','cancelled') AND ended_at < ?", now() - olderThanMs).changes;

    // server settings
    const getGiveawaySettings = guildId => clean(get("SELECT * FROM giveaway_settings WHERE guild_id = ?", guildId)) ?? { guild_id: guildId, vouch_channel_id: null, manager_role_id: null };
    function setGiveawaySettings(guildId, patch) {
        const cur = getGiveawaySettings(guildId);
        const next = { vouch_channel_id: cur.vouch_channel_id, manager_role_id: cur.manager_role_id, ...patch };
        run(`INSERT INTO giveaway_settings (guild_id, vouch_channel_id, manager_role_id) VALUES (?,?,?)
             ON CONFLICT(guild_id) DO UPDATE SET vouch_channel_id = excluded.vouch_channel_id, manager_role_id = excluded.manager_role_id`,
            guildId, next.vouch_channel_id ?? null, next.manager_role_id ?? null);
        return getGiveawaySettings(guildId);
    }

    /** A member's own giveaway data: used by /mydata delete. Wipes what they entered and anything waiting for them. */
    function forgetGiveawayUser(userId) {
        run("DELETE FROM giveaway_entries WHERE discord_id = ?", userId);
        run("DELETE FROM giveaway_excluded WHERE discord_id = ?", userId);
        // A prize that was waiting for them goes back to the host; a delivered key is wiped.
        run("UPDATE giveaway_keys SET status = 'available', winner_id = NULL, deadline = NULL WHERE winner_id = ? AND status = 'assigned'", userId);
        run("UPDATE giveaway_keys SET key_enc = NULL, status = 'expired', winner_id = NULL WHERE winner_id = ? AND status IN ('delivered','problem')", userId);
        run("UPDATE giveaway_keys SET winner_id = NULL WHERE winner_id = ?", userId);
        // Giveaways they hosted: stop active ones and wipe their keys.
        run("UPDATE giveaway_keys SET key_enc = NULL, status = 'expired' WHERE giveaway_id IN (SELECT id FROM giveaways WHERE host_id = ?)", userId);
        run("UPDATE giveaways SET status = 'cancelled', ended_at = COALESCE(ended_at, ?), host_id = 'deleted' WHERE host_id = ?", now(), userId);
    }
    /** Bot-wide counts for the About page. Nothing personal. */
    const giveawayTotals = () => ({
        giveaways: get("SELECT COUNT(*) AS n FROM giveaways").n,
        redeemed: get("SELECT COUNT(*) AS n FROM giveaway_keys WHERE status = 'confirmed'").n
    });
    const hasGiveawayData = userId => Boolean(get("SELECT 1 AS x FROM giveaway_entries WHERE discord_id = ? UNION SELECT 1 FROM giveaway_keys WHERE winner_id = ? UNION SELECT 1 FROM giveaways WHERE host_id = ?", userId, userId, userId));

    return {
        getGiveaway, listGiveaways, countActiveGiveaways, dueGiveaways, giveawayByMessage, createGiveaway, setGiveawayMessage, setAnnounceMessage,
        setGiveawayStatus, markLeftoverNotified, deleteGiveaway, getEntry, addEntry, removeEntry, listEntries, countEntries,
        listKeys, getKey, getKeyEnc, keyForWinner, assignKey, releaseKey, bumpRedraw, markDelivered, markConfirmed, markProblem, replaceKeyEnc,
        wipeKey, setConfirmAt, excludeFor, excludedFor, expiredClaims, duePrompts, purgeKeys, purgeGiveaways,
        giveawayTotals, getGiveawaySettings, setGiveawaySettings, forgetGiveawayUser, hasGiveawayData
    };
}

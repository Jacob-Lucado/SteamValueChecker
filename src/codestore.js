// Limited-time game codes (SHiFT and the like): the codes themselves, which server posted which one, and each server's settings.
// A code is stored once, under its provider and the code text, so the same code coming back from the feed never makes a second row.

export const codeSchema = `
CREATE TABLE IF NOT EXISTS promo_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    key        TEXT NOT NULL UNIQUE,
    provider   TEXT NOT NULL,
    code       TEXT NOT NULL,
    game       TEXT NOT NULL,
    platform   TEXT,
    reward     TEXT,
    note       TEXT,
    expires_at INTEGER,
    source_url TEXT,
    first_seen INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL,
    status     TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS promo_codes_status ON promo_codes(status, first_seen);
CREATE TABLE IF NOT EXISTS promo_posts (
    code_id    INTEGER NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
    guild_id   TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    marked_expired INTEGER NOT NULL DEFAULT 0,
    posted_at  INTEGER NOT NULL,
    PRIMARY KEY (code_id, guild_id)
);
CREATE TABLE IF NOT EXISTS code_guilds (
    guild_id   TEXT PRIMARY KEY,
    channel_id TEXT,
    games      TEXT,
    role_id    TEXT
);
`;

/** How long an expired code stays on the dashboard list before it is dropped. */
import { UNDATED_MAX_AGE_MS } from "./codesource.js";

export const KEEP_EXPIRED_MS = 14 * 86400_000;

export function codeStore({ run, get, all, clean, now }) {
    /** Adds a code, or refreshes last_seen when we already have it. Returns { id, isNew }. */
    function upsertCode(c) {
        const t = now();
        const have = get("SELECT id, status FROM promo_codes WHERE key = ?", c.key);
        if (have) {
            run("UPDATE promo_codes SET last_seen = ?, expires_at = COALESCE(?, expires_at) WHERE id = ?", t, c.expiresAt ?? null, have.id);
            return { id: Number(have.id), isNew: false };
        }
        const r = run("INSERT INTO promo_codes (key, provider, code, game, platform, reward, note, expires_at, source_url, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            c.key, c.provider, c.code, c.game, c.platform ?? null, c.reward ?? null, c.note ?? null, c.expiresAt ?? null, c.sourceUrl ?? null, c.seenAt ?? t, t);
        return { id: Number(r.lastInsertRowid), isNew: true };
    }

    const getCode = id => clean(get("SELECT * FROM promo_codes WHERE id = ?", id));
    const codeByKey = key => clean(get("SELECT * FROM promo_codes WHERE key = ?", key));

    /** Newest first. `status` is "active", "expired" or omitted for both. */
    function listCodes({ status = null, game = null, limit = 50 } = {}) {
        const where = [], args = [];
        if (status) { where.push("status = ?"); args.push(status); }
        if (game) { where.push("game = ?"); args.push(game); }
        return all(`SELECT * FROM promo_codes ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY first_seen DESC, id DESC LIMIT ?`, ...args, Math.min(200, Math.max(1, limit))).map(clean);
    }

    /** Marks every active code whose end date has passed. Returns the rows that just changed. */
    function expireDue(at = now()) {
        const due = all("SELECT * FROM promo_codes WHERE status = 'active' AND ((expires_at IS NOT NULL AND expires_at < ?) OR (expires_at IS NULL AND provider = 'shift' AND first_seen < ?))", at, at - UNDATED_MAX_AGE_MS).map(clean);
        for (const c of due) run("UPDATE promo_codes SET status = 'expired' WHERE id = ?", c.id);
        return due.map(c => ({ ...c, status: "expired" }));
    }
    /** For lists that only show what works: an active code of this game that is no longer listed has ended. Returns the rows that changed. */
    function expireMissing(provider, game, presentKeys) {
        const keep = new Set(presentKeys);
        const gone = all("SELECT * FROM promo_codes WHERE status = 'active' AND provider = ? AND game = ?", provider, game).map(clean).filter(c => !keep.has(c.key));
        for (const c of gone) run("UPDATE promo_codes SET status = 'expired' WHERE id = ?", c.id);
        return gone.map(c => ({ ...c, status: "expired" }));
    }
    /** An admin or a manager can retire a code by hand (it was reported dead). */
    const setCodeStatus = (id, status) => run("UPDATE promo_codes SET status = ? WHERE id = ?", status, id).changes > 0;

    const pruneCodes = (at = now()) => run("DELETE FROM promo_codes WHERE status = 'expired' AND COALESCE(expires_at, last_seen) < ?", at - KEEP_EXPIRED_MS).changes;

    // ----- posts: one per code per server, which is what stops repeats -----
    const codePost = (codeId, guildId) => clean(get("SELECT * FROM promo_posts WHERE code_id = ? AND guild_id = ?", codeId, guildId));
    const codePosts = codeId => all("SELECT * FROM promo_posts WHERE code_id = ?", codeId).map(clean);
    function addCodePost(codeId, guildId, channelId, messageId) {
        run("INSERT OR REPLACE INTO promo_posts (code_id, guild_id, channel_id, message_id, posted_at) VALUES (?, ?, ?, ?, ?)", codeId, guildId, channelId, messageId ?? null, now());
    }
    const hasAnyCodePost = guildId => Boolean(get("SELECT 1 AS x FROM promo_posts WHERE guild_id = ? LIMIT 1", guildId));
    const markPostExpired = (codeId, guildId) => run("UPDATE promo_posts SET marked_expired = 1 WHERE code_id = ? AND guild_id = ?", codeId, guildId);
    const dropCodePost = (codeId, guildId) => run("DELETE FROM promo_posts WHERE code_id = ? AND guild_id = ?", codeId, guildId);
    /** Posts that still show a code as live although it has ended. */
    const stalePosts = () => all("SELECT p.*, c.code, c.game, c.platform, c.reward, c.note, c.expires_at, c.source_url, c.key, c.status FROM promo_posts p JOIN promo_codes c ON c.id = p.code_id WHERE c.status = 'expired' AND p.marked_expired = 0 AND p.message_id IS NOT NULL").map(clean);

    // ----- per server settings -----
    const DEFAULT = guildId => ({ guild_id: guildId, channel_id: null, games: null, role_id: null });
    function getCodeSettings(guildId) {
        const r = clean(get("SELECT * FROM code_guilds WHERE guild_id = ?", guildId));
        if (!r) return { ...DEFAULT(guildId), games: [] };
        let games = [];
        try { games = JSON.parse(r.games ?? "[]") ?? []; } catch { games = []; }
        return { ...r, games: Array.isArray(games) ? games : [] };
    }
    /** `games` empty means every game. */
    function setCodeSettings(guildId, patch) {
        run("INSERT OR IGNORE INTO code_guilds (guild_id) VALUES (?)", guildId);
        if (patch.channel_id !== undefined) run("UPDATE code_guilds SET channel_id = ? WHERE guild_id = ?", patch.channel_id, guildId);
        if (patch.role_id !== undefined) run("UPDATE code_guilds SET role_id = ? WHERE guild_id = ?", patch.role_id, guildId);
        if (patch.games !== undefined) run("UPDATE code_guilds SET games = ? WHERE guild_id = ?", JSON.stringify([...new Set(patch.games)]), guildId);
        return getCodeSettings(guildId);
    }
    const codeGuilds = () => all("SELECT guild_id FROM code_guilds WHERE channel_id IS NOT NULL").map(r => getCodeSettings(r.guild_id));
    const codeCounts = () => ({ active: Number(get("SELECT COUNT(*) AS n FROM promo_codes WHERE status = 'active'").n), total: Number(get("SELECT COUNT(*) AS n FROM promo_codes").n), servers: Number(get("SELECT COUNT(*) AS n FROM code_guilds WHERE channel_id IS NOT NULL").n) });

    return { upsertCode, getCode, codeByKey, listCodes, expireDue, expireMissing, setCodeStatus, pruneCodes, codePost, codePosts, hasAnyCodePost, addCodePost, markPostExpired, dropCodePost, stalePosts, getCodeSettings, setCodeSettings, codeGuilds, codeCounts };
}

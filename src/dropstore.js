// Promo drops: codes or links a server's managers add by hand (a SteelSeries giveaway, an NVIDIA reward), plus
// the news posts the bot spots on the NVIDIA and SteelSeries blogs. Each one is posted once per server.

export const dropSchema = `
CREATE TABLE IF NOT EXISTS drops (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    title      TEXT NOT NULL,
    source     TEXT,
    code       TEXT,
    url        TEXT,
    note       TEXT,
    expires_at INTEGER,
    status     TEXT NOT NULL DEFAULT 'active',
    created_by TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS drops_guild ON drops(guild_id, status);
CREATE TABLE IF NOT EXISTS drop_posts (
    drop_id        INTEGER PRIMARY KEY REFERENCES drops(id) ON DELETE CASCADE,
    channel_id     TEXT NOT NULL,
    message_id     TEXT,
    marked_expired INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS drop_guilds (
    guild_id   TEXT PRIMARY KEY,
    channel_id TEXT,
    role_id    TEXT,
    news       INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS drop_news (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    key     TEXT NOT NULL UNIQUE,
    source  TEXT NOT NULL,
    kind    TEXT,
    title   TEXT NOT NULL,
    url     TEXT NOT NULL,
    summary TEXT,
    seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS drop_news_posts (
    news_id    INTEGER NOT NULL REFERENCES drop_news(id) ON DELETE CASCADE,
    guild_id   TEXT NOT NULL,
    channel_id TEXT,
    message_id TEXT,
    PRIMARY KEY (news_id, guild_id)
);
`;

const KEEP_ENDED_MS = 14 * 86400_000;
const KEEP_NEWS_MS = 60 * 86400_000;

export function dropStore({ run, get, all, clean, now }) {
    function addDrop(d) {
        const r = run("INSERT INTO drops (guild_id, title, source, code, url, note, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            d.guildId, d.title, d.source ?? null, d.code ?? null, d.url ?? null, d.note ?? null, d.expiresAt ?? null, d.createdBy ?? null, now());
        return Number(r.lastInsertRowid);
    }
    const getDrop = id => clean(get("SELECT * FROM drops WHERE id = ?", id));
    /** Newest first. status is "active", "ended" or omitted for both. */
    const listDrops = (guildId, { status = null, limit = 25 } = {}) =>
        all(`SELECT * FROM drops WHERE guild_id = ? ${status ? "AND status = ?" : ""} ORDER BY created_at DESC, id DESC LIMIT ?`, ...[guildId, ...(status ? [status] : []), Math.min(100, Math.max(1, limit))]).map(clean);
    const endDrop = id => run("UPDATE drops SET status = 'ended' WHERE id = ? AND status = 'active'", id).changes > 0;
    function expireDrops(at = now()) {
        const due = all("SELECT * FROM drops WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < ?", at).map(clean);
        for (const d of due) run("UPDATE drops SET status = 'ended' WHERE id = ?", d.id);
        return due;
    }
    const pruneDrops = (at = now()) => run("DELETE FROM drops WHERE status = 'ended' AND COALESCE(expires_at, created_at) < ?", at - KEEP_ENDED_MS).changes
        + run("DELETE FROM drop_news WHERE seen_at < ?", at - KEEP_NEWS_MS).changes;

    const dropPost = id => clean(get("SELECT * FROM drop_posts WHERE drop_id = ?", id));
    const addDropPost = (dropId, channelId, messageId) => run("INSERT OR REPLACE INTO drop_posts (drop_id, channel_id, message_id) VALUES (?, ?, ?)", dropId, channelId, messageId ?? null);
    const markDropPostEnded = id => run("UPDATE drop_posts SET marked_expired = 1 WHERE drop_id = ?", id);
    const unpostedDrops = guildId => all("SELECT d.* FROM drops d LEFT JOIN drop_posts p ON p.drop_id = d.id WHERE d.guild_id = ? AND d.status = 'active' AND p.drop_id IS NULL ORDER BY d.id", guildId).map(clean);
    const staleDropPosts = () => all("SELECT d.*, p.channel_id, p.message_id FROM drops d JOIN drop_posts p ON p.drop_id = d.id WHERE d.status = 'ended' AND p.marked_expired = 0 AND p.message_id IS NOT NULL").map(clean);

    function getDropSettings(guildId) {
        const r = clean(get("SELECT * FROM drop_guilds WHERE guild_id = ?", guildId));
        return r ? { ...r, news: Boolean(r.news) } : { guild_id: guildId, channel_id: null, role_id: null, news: false };
    }
    function setDropSettings(guildId, patch) {
        run("INSERT OR IGNORE INTO drop_guilds (guild_id) VALUES (?)", guildId);
        if (patch.channel_id !== undefined) run("UPDATE drop_guilds SET channel_id = ? WHERE guild_id = ?", patch.channel_id, guildId);
        if (patch.role_id !== undefined) run("UPDATE drop_guilds SET role_id = ? WHERE guild_id = ?", patch.role_id, guildId);
        if (patch.news !== undefined) run("UPDATE drop_guilds SET news = ? WHERE guild_id = ?", patch.news ? 1 : 0, guildId);
        return getDropSettings(guildId);
    }
    const dropGuilds = () => all("SELECT guild_id FROM drop_guilds WHERE channel_id IS NOT NULL").map(r => getDropSettings(r.guild_id));

    // ----- news from the blogs -----
    function upsertNews(n) {
        if (get("SELECT id FROM drop_news WHERE key = ?", n.key)) return { isNew: false };
        const r = run("INSERT INTO drop_news (key, source, kind, title, url, summary, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)", n.key, n.source, n.kind ?? "blog", n.title, n.url, n.summary ?? null, now());
        return { isNew: true, id: Number(r.lastInsertRowid) };
    }
    const listNews = (limit = 10) => all("SELECT * FROM drop_news ORDER BY seen_at DESC, id DESC LIMIT ?", Math.min(50, Math.max(1, limit))).map(clean);
    const unpostedNews = guildId => all("SELECT n.* FROM drop_news n LEFT JOIN drop_news_posts p ON p.news_id = n.id AND p.guild_id = ? WHERE p.news_id IS NULL ORDER BY n.id DESC", guildId).map(clean);
    const addNewsPost = (newsId, guildId, channelId, messageId) => run("INSERT OR REPLACE INTO drop_news_posts (news_id, guild_id, channel_id, message_id) VALUES (?, ?, ?, ?)", newsId, guildId, channelId ?? null, messageId ?? null);
    const hasAnyNewsPost = guildId => Boolean(get("SELECT 1 AS x FROM drop_news_posts WHERE guild_id = ? LIMIT 1", guildId));

    return { addDrop, getDrop, listDrops, endDrop, expireDrops, pruneDrops, dropPost, addDropPost, markDropPostEnded, unpostedDrops, staleDropPosts, getDropSettings, setDropSettings, dropGuilds, upsertNews, listNews, unpostedNews, addNewsPost, hasAnyNewsPost };
}

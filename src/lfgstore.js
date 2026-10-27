// Looking-for-group posts. A post belongs to a server channel; members join with a button.

export const lfgSchema = `
CREATE TABLE IF NOT EXISTS lfg_posts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    creator_id TEXT NOT NULL,
    game       TEXT NOT NULL,
    starts_at  INTEGER NOT NULL,
    slots      INTEGER NOT NULL,
    note       TEXT,
    event_id   TEXT,
    status     TEXT NOT NULL DEFAULT 'open',
    reminded   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS lfg_guild ON lfg_posts(guild_id, status);
CREATE TABLE IF NOT EXISTS lfg_members (
    post_id   INTEGER NOT NULL,
    user_id   TEXT NOT NULL,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, user_id)
);`;

export function lfgStore({ db, run, get, all, clean, now }) {
    const getLfg = id => clean(get("SELECT * FROM lfg_posts WHERE id = ?", id)) ?? null;
    const lfgMembers = id => all("SELECT user_id FROM lfg_members WHERE post_id = ? ORDER BY joined_at, rowid", id).map(r => r.user_id);
    const createLfg = p => {
        const r = run("INSERT INTO lfg_posts (guild_id, channel_id, creator_id, game, starts_at, slots, note, created_at) VALUES (?,?,?,?,?,?,?,?)",
            p.guild_id, p.channel_id, p.creator_id, p.game, p.starts_at, p.slots, p.note ?? null, now());
        run("INSERT INTO lfg_members (post_id, user_id, joined_at) VALUES (?,?,?)", r.lastInsertRowid, p.creator_id, now());
        return getLfg(Number(r.lastInsertRowid));
    };
    const setLfgMessage = (id, messageId, eventId = null) => run("UPDATE lfg_posts SET message_id = ?, event_id = ? WHERE id = ?", messageId, eventId, id);
    /** Returns "joined", "already" or "full". */
    function joinLfg(id, userId) {
        const p = getLfg(id);
        if (!p || p.status !== "open") return "closed";
        const m = lfgMembers(id);
        if (m.includes(userId)) return "already";
        if (m.length >= p.slots) return "full";
        run("INSERT INTO lfg_members (post_id, user_id, joined_at) VALUES (?,?,?)", id, userId, now());
        return "joined";
    }
    const leaveLfg = (id, userId) => run("DELETE FROM lfg_members WHERE post_id = ? AND user_id = ?", id, userId).changes > 0;
    const closeLfg = id => run("UPDATE lfg_posts SET status = 'closed' WHERE id = ? AND status = 'open'", id).changes > 0;
    const listOpenLfg = guildId => all("SELECT * FROM lfg_posts WHERE guild_id = ? AND status = 'open' ORDER BY starts_at", guildId).map(clean);
    const countOpenLfgBy = (guildId, userId) => get("SELECT COUNT(*) AS n FROM lfg_posts WHERE guild_id = ? AND creator_id = ? AND status = 'open'", guildId, userId).n;
    const lfgToRemind = at => all("SELECT * FROM lfg_posts WHERE status = 'open' AND reminded = 0 AND starts_at <= ?", at).map(clean);
    const markLfgReminded = id => run("UPDATE lfg_posts SET reminded = 1 WHERE id = ?", id);
    const lfgToExpire = (at, graceMs) => all("SELECT * FROM lfg_posts WHERE status = 'open' AND starts_at + ? <= ?", graceMs, at).map(clean);
    /** Data deletion: leave every post, and close the ones this person made. */
    function forgetLfgUser(userId) {
        run("DELETE FROM lfg_members WHERE user_id = ?", userId);
        run("UPDATE lfg_posts SET status = 'closed' WHERE creator_id = ? AND status = 'open'", userId);
    }
    const lfgForUser = userId => all("SELECT p.id, p.game, p.starts_at, p.status FROM lfg_posts p JOIN lfg_members m ON m.post_id = p.id WHERE m.user_id = ? ORDER BY p.starts_at DESC LIMIT 100", userId).map(clean);
    return { getLfg, lfgMembers, createLfg, setLfgMessage, joinLfg, leaveLfg, closeLfg, listOpenLfg, countOpenLfgBy, lfgToRemind, markLfgReminded, lfgToExpire, forgetLfgUser, lfgForUser };
}

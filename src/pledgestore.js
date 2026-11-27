// Backlog pledges: "I will put N more hours into this game by this date." Friends back or doubt it, and the bot settles it from real playtime.

export const pledgeSchema = `
CREATE TABLE IF NOT EXISTS pledges (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id     TEXT NOT NULL,
    channel_id   TEXT NOT NULL,
    message_id   TEXT,
    user_id      TEXT NOT NULL,
    itad_id      TEXT NOT NULL,
    appid        INTEGER,
    title        TEXT NOT NULL,
    hours        INTEGER NOT NULL,
    base_minutes INTEGER NOT NULL,
    status       TEXT NOT NULL DEFAULT 'open',
    final_minutes INTEGER,
    created_at   INTEGER NOT NULL,
    due_at       INTEGER NOT NULL,
    done_at      INTEGER
);
CREATE INDEX IF NOT EXISTS pledges_guild ON pledges(guild_id, status);
CREATE TABLE IF NOT EXISTS pledge_votes (
    pledge_id INTEGER NOT NULL,
    user_id   TEXT NOT NULL,
    side      TEXT NOT NULL,
    PRIMARY KEY (pledge_id, user_id)
);`;

export const POINTS = { kept: 10, right: 3 };

export function pledgeStore({ run, get, all, clean, now }) {
    const getPledge = id => clean(get("SELECT * FROM pledges WHERE id = ?", id)) ?? null;
    const createPledge = p => {
        const r = run("INSERT INTO pledges (guild_id, channel_id, user_id, itad_id, appid, title, hours, base_minutes, created_at, due_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            p.guild_id, p.channel_id, p.user_id, p.itad_id, p.appid ?? null, p.title, p.hours, p.base_minutes, now(), p.due_at);
        return getPledge(Number(r.lastInsertRowid));
    };
    const setPledgeMessage = (id, m) => run("UPDATE pledges SET message_id = ? WHERE id = ?", m, id);
    const pledgeVotes = id => all("SELECT user_id, side FROM pledge_votes WHERE pledge_id = ? ORDER BY rowid", id).map(clean);
    /** side is "back" or "doubt". Voting again switches sides. */
    function votePledge(id, userId, side) {
        const p = getPledge(id);
        if (!p || p.status !== "open") return "closed";
        if (p.user_id === userId) return "own";
        const had = get("SELECT side FROM pledge_votes WHERE pledge_id = ? AND user_id = ?", id, userId)?.side;
        if (had === side) return "same";
        run("INSERT INTO pledge_votes (pledge_id, user_id, side) VALUES (?,?,?) ON CONFLICT(pledge_id, user_id) DO UPDATE SET side = excluded.side", id, userId, side);
        return had ? "switched" : "voted";
    }
    const closePledge = (id, status, finalMinutes) => run("UPDATE pledges SET status = ?, final_minutes = ?, done_at = ? WHERE id = ? AND status = 'open'", status, finalMinutes ?? null, now(), id).changes > 0;
    const openPledges = () => all("SELECT * FROM pledges WHERE status = 'open' ORDER BY id").map(clean);
    const listPledgesGuild = (guildId, status = "open") => all("SELECT * FROM pledges WHERE guild_id = ? AND status = ? ORDER BY id DESC LIMIT 25", guildId, status).map(clean);
    const countOpenPledgesBy = (guildId, userId) => get("SELECT COUNT(*) AS n FROM pledges WHERE guild_id = ? AND user_id = ? AND status = 'open'", guildId, userId).n;
    const hasOpenPledgeFor = (userId, itadId) => Boolean(get("SELECT 1 AS x FROM pledges WHERE user_id = ? AND itad_id = ? AND status = 'open'", userId, itadId));
    /** Points per person in one server: 10 for keeping your own pledge, 3 for each call you got right. */
    function pledgeBoard(guildId, limit = 10) {
        const rows = new Map();
        const row = id => { if (!rows.has(id)) rows.set(id, { user_id: id, points: 0, kept: 0, failed: 0, calls: 0 }); return rows.get(id); };
        for (const p of all("SELECT id, user_id, status FROM pledges WHERE guild_id = ? AND status IN ('kept','failed')", guildId)) {
            const r = row(p.user_id);
            if (p.status === "kept") { r.kept++; r.points += POINTS.kept; } else r.failed++;
            for (const v of all("SELECT user_id, side FROM pledge_votes WHERE pledge_id = ?", p.id)) {
                if ((p.status === "kept") === (v.side === "back")) { const x = row(v.user_id); x.calls++; x.points += POINTS.right; }
            }
        }
        return [...rows.values()].sort((a, b) => b.points - a.points || b.kept - a.kept || a.user_id.localeCompare(b.user_id)).slice(0, limit);
    }
    const pledgesForUser = userId => all("SELECT id, guild_id, title, hours, status FROM pledges WHERE user_id = ? ORDER BY id DESC LIMIT 100", userId).map(clean);
    /** Data deletion: drop their votes, and cancel the open pledges they made. */
    function forgetPledgeUser(userId) {
        run("DELETE FROM pledge_votes WHERE user_id = ?", userId);
        run("UPDATE pledges SET status = 'cancelled' WHERE user_id = ? AND status = 'open'", userId);
    }
    return { getPledge, createPledge, setPledgeMessage, pledgeVotes, votePledge, closePledge, openPledges, listPledgesGuild, countOpenPledgesBy, hasOpenPledgeFor, pledgeBoard, pledgesForUser, forgetPledgeUser };
}

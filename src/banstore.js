// Restricted people: the bot owner can cut someone off from the bot and the dashboard. One row per person.
// last_seen on users (set when they use a command or the dashboard) is what the admin's "active" list sorts by.

export const banSchema = `
CREATE TABLE IF NOT EXISTS bans (
    discord_id TEXT PRIMARY KEY,
    reason     TEXT NOT NULL DEFAULT '',
    banned_by  TEXT,
    at         INTEGER NOT NULL
);
`;

export function banStore({ run, get, all, clean, now }) {
    const isBanned = id => Boolean(id) && Boolean(get("SELECT 1 AS n FROM bans WHERE discord_id = ?", String(id)));
    const getBan = id => clean(get("SELECT * FROM bans WHERE discord_id = ?", String(id)));
    const banUser = (id, reason = "", by = null) => {
        run("INSERT INTO bans (discord_id, reason, banned_by, at) VALUES (?,?,?,?) ON CONFLICT(discord_id) DO UPDATE SET reason = excluded.reason, banned_by = excluded.banned_by, at = excluded.at",
            String(id), String(reason ?? "").slice(0, 300), by, now());
    };
    const unbanUser = id => run("DELETE FROM bans WHERE discord_id = ?", String(id)).changes > 0;
    const listBans = () => all("SELECT * FROM bans ORDER BY at DESC").map(clean);

    /** Stamps "last seen", at most once every few minutes per person so it costs next to nothing. */
    const touchUser = id => { run("UPDATE users SET last_seen = ? WHERE discord_id = ? AND (last_seen IS NULL OR last_seen < ?)", now(), String(id), now() - 300_000); };

    /** People registered through a server, newest activity first. `activeDays` limits it to people seen lately (0 = everyone). */
    function serverMembers(guildId, { activeDays = 0, limit = 200 } = {}) {
        const since = activeDays > 0 ? now() - activeDays * 86400_000 : 0;
        return all(`SELECT u.discord_id AS id, u.created_at AS joined, u.last_seen AS lastSeen, u.paused,
            (SELECT COUNT(*) FROM items i WHERE i.discord_id = u.discord_id) AS wishlist,
            (SELECT COUNT(*) FROM alert_log a WHERE a.discord_id = u.discord_id) AS alerts,
            b.reason AS banReason, b.at AS bannedAt
            FROM users u LEFT JOIN bans b ON b.discord_id = u.discord_id
            WHERE u.guild_id = ? AND COALESCE(u.last_seen, u.created_at) >= ?
            ORDER BY COALESCE(u.last_seen, u.created_at) DESC LIMIT ?`, String(guildId), since, limit).map(clean)
            .map(r => ({ ...r, paused: Boolean(r.paused), banned: r.bannedAt != null }));
    }
    return { isBanned, getBan, banUser, unbanUser, listBans, touchUser, serverMembers };
}

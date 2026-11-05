// Tables for full profiles. Kept apart from profilepage.js so the database can load them without pulling in the page builder.
export const profileSchema = `
CREATE TABLE IF NOT EXISTS profile_ext (
    discord_id TEXT PRIMARY KEY REFERENCES users(discord_id) ON DELETE CASCADE,
    data       TEXT NOT NULL DEFAULT '{}',
    blocked    INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS profile_bg (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    mime       TEXT NOT NULL,
    data       BLOB NOT NULL,
    source     TEXT NOT NULL DEFAULT 'upload',
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS profile_bg_owner ON profile_bg (discord_id);
CREATE TABLE IF NOT EXISTS profile_reports (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    slug       TEXT NOT NULL,
    reason     TEXT NOT NULL,
    at         INTEGER NOT NULL
);
`;

export function profileStore({ run, get, all }) {
    const now = () => Date.now();
    return {
        getProfileData(id) {
            const r = get("SELECT data, blocked FROM profile_ext WHERE discord_id = ?", String(id));
            let data = {}; try { data = JSON.parse(r?.data ?? "{}"); } catch { /* start fresh */ }
            return { data, blocked: Boolean(r?.blocked) };
        },
        setProfileData(id, data) {
            run("INSERT INTO profile_ext (discord_id, data, updated_at) VALUES (?,?,?) ON CONFLICT(discord_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at", String(id), JSON.stringify(data), now());
        },
        blockProfile(id, on) {
            run("INSERT INTO profile_ext (discord_id, blocked, updated_at) VALUES (?,?,?) ON CONFLICT(discord_id) DO UPDATE SET blocked = excluded.blocked", String(id), on ? 1 : 0, now());
        },
        // the pictures behind a profile page, a few per member
        listProfileBgs: id => all("SELECT id, mime, source, created_at, LENGTH(data) AS bytes FROM profile_bg WHERE discord_id = ? ORDER BY id", String(id)),
        getProfileBg: id => get("SELECT id, discord_id, mime, data, created_at FROM profile_bg WHERE id = ?", Number(id)),
        countProfileBgs: id => get("SELECT COUNT(*) AS n FROM profile_bg WHERE discord_id = ?", String(id)).n,
        addProfileBg(id, mime, data, source = "upload") { return Number(run("INSERT INTO profile_bg (discord_id, mime, data, source, created_at) VALUES (?,?,?,?,?)", String(id), mime, data, source, now()).lastInsertRowid); },
        deleteProfileBg: (id, bgId) => run("DELETE FROM profile_bg WHERE id = ? AND discord_id = ?", Number(bgId), String(id)).changes > 0,
        deleteSteamProfileBg: id => run("DELETE FROM profile_bg WHERE discord_id = ? AND source = 'steam'", String(id)).changes,
        /** Clears stored pictures for members who have not opened the bot or dashboard for `maxIdleMs`. Returns how many pictures went. */
        pruneInactiveProfileBgs(maxIdleMs) {
            const cut = now() - maxIdleMs;
            return run("DELETE FROM profile_bg WHERE discord_id IN (SELECT discord_id FROM users WHERE COALESCE(last_seen, created_at, 0) < ?)", cut).changes;
        },
        addProfileReport: (slug, reason) => run("INSERT INTO profile_reports (slug, reason, at) VALUES (?,?,?)", String(slug), String(reason).slice(0, 300), now()),
        listProfileReports: () => all("SELECT * FROM profile_reports ORDER BY at DESC LIMIT 100"),
        clearProfileReports: slug => run("DELETE FROM profile_reports WHERE slug = ?", String(slug))
    };
}


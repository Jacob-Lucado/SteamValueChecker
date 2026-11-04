// Tables for full profiles. Kept apart from profilepage.js so the database can load them without pulling in the page builder.
export const profileSchema = `
CREATE TABLE IF NOT EXISTS profile_ext (
    discord_id TEXT PRIMARY KEY REFERENCES users(discord_id) ON DELETE CASCADE,
    data       TEXT NOT NULL DEFAULT '{}',
    blocked    INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
);
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
        addProfileReport: (slug, reason) => run("INSERT INTO profile_reports (slug, reason, at) VALUES (?,?,?)", String(slug), String(reason).slice(0, 300), now()),
        listProfileReports: () => all("SELECT * FROM profile_reports ORDER BY at DESC LIMIT 100"),
        clearProfileReports: slug => run("DELETE FROM profile_reports WHERE slug = ?", String(slug))
    };
}


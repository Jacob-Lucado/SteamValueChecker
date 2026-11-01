// Music settings per server and the playlists members save. Plain data, no audio.

export const musicSchema = `
CREATE TABLE IF NOT EXISTS music_settings (
    guild_id       TEXT PRIMARY KEY,
    enabled        INTEGER NOT NULL DEFAULT 1,
    dj_role_id     TEXT,
    channel_id     TEXT,
    volume         INTEGER NOT NULL DEFAULT 50,
    max_queue      INTEGER NOT NULL DEFAULT 100,
    max_minutes    INTEGER NOT NULL DEFAULT 0,
    announce       INTEGER NOT NULL DEFAULT 1,
    leave_minutes  INTEGER NOT NULL DEFAULT 5,
    stay           INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS music_submissions (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    track    TEXT NOT NULL,
    at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_music_submissions_guild ON music_submissions (guild_id, id);
CREATE TABLE IF NOT EXISTS music_playlists (
    user_id TEXT NOT NULL,
    name    TEXT NOT NULL,
    tracks  TEXT NOT NULL,
    at      INTEGER NOT NULL,
    PRIMARY KEY (user_id, name)
);
`;

/** Columns added after the first release. db.js adds them to servers that already have the table. */
export const MUSIC_EXTRA_COLUMNS = [
    ["autodj", "INTEGER NOT NULL DEFAULT 0"], ["autodj_idle", "INTEGER NOT NULL DEFAULT 30"], ["autodj_channel_id", "TEXT"],
    ["autodj_submit", "INTEGER NOT NULL DEFAULT 1"], ["autodj_shuffle", "INTEGER NOT NULL DEFAULT 1"], ["autodj_playlist", "TEXT"], ["autodj_source", "TEXT"],
    ["radio", "INTEGER NOT NULL DEFAULT 1"]
];
export const MUSIC_DEFAULTS = { enabled: 1, dj_role_id: null, channel_id: null, volume: 50, max_queue: 100, max_minutes: 0, announce: 1, leave_minutes: 5, stay: 0,
    autodj: 0, autodj_idle: 30, autodj_channel_id: null, autodj_submit: 1, autodj_shuffle: 1, autodj_playlist: null, autodj_source: null, radio: 1 };
export const MAX_AUTO_TRACKS = 200, MAX_PENDING_PER_USER = 5, MAX_PENDING_PER_GUILD = 100;
export const MAX_PLAYLISTS = 10, MAX_PLAYLIST_TRACKS = 100;

export function musicStore({ run, get, all, clean, now }) {
    const getMusicSettings = guildId => ({ guild_id: String(guildId), ...MUSIC_DEFAULTS, ...(clean(get("SELECT * FROM music_settings WHERE guild_id = ?", String(guildId))) ?? {}) });
    const FIELDS = ["enabled", "dj_role_id", "channel_id", "volume", "max_queue", "max_minutes", "announce", "leave_minutes", "stay", "autodj", "autodj_idle", "autodj_channel_id", "autodj_submit", "autodj_shuffle", "autodj_playlist", "autodj_source", "radio"];
    const slimTrack = t => ({ url: t.url, title: String(t.title ?? "").slice(0, 150), artist: String(t.artist ?? "").slice(0, 80), duration: t.duration ?? null, thumb: t.thumb ?? null });
    /** The tracks the Auto DJ plays when nothing else is queued. */
    const getAutoPlaylist = guildId => { try { const v = JSON.parse(getMusicSettings(guildId).autodj_playlist ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
    function setAutoPlaylist(guildId, tracks, source = null) {
        const slim = tracks.slice(0, MAX_AUTO_TRACKS).map(slimTrack);
        setMusicSettings(guildId, { autodj_playlist: slim.length ? JSON.stringify(slim) : null, autodj_source: slim.length ? source : null });
        return slim.length;
    }
    /** Songs members asked for while the Auto DJ is on. They play, oldest first, before the Auto DJ's own playlist. */
    const listSubmissions = guildId => all("SELECT id, user_id, track, at FROM music_submissions WHERE guild_id = ? ORDER BY id", String(guildId)).map(clean).map(r => ({ id: r.id, user_id: r.user_id, at: r.at, ...JSON.parse(r.track) }));
    const countSubmissions = (guildId, userId = null) => (userId
        ? get("SELECT COUNT(*) AS n FROM music_submissions WHERE guild_id = ? AND user_id = ?", String(guildId), String(userId))
        : get("SELECT COUNT(*) AS n FROM music_submissions WHERE guild_id = ?", String(guildId))).n;
    function addSubmissions(guildId, userId, tracks) {
        let added = 0;
        for (const t of tracks) {
            if (countSubmissions(guildId, userId) >= MAX_PENDING_PER_USER || countSubmissions(guildId) >= MAX_PENDING_PER_GUILD) break;
            run("INSERT INTO music_submissions (guild_id, user_id, track, at) VALUES (?,?,?,?)", String(guildId), String(userId), JSON.stringify(slimTrack(t)), now()); added++;
        }
        return added;
    }
    /** Takes the oldest request off the list (it is about to play). */
    function takeSubmission(guildId) {
        const r = clean(get("SELECT id, user_id, track FROM music_submissions WHERE guild_id = ? ORDER BY id LIMIT 1", String(guildId)));
        if (!r) return null;
        run("DELETE FROM music_submissions WHERE id = ?", r.id);
        return { ...JSON.parse(r.track), requestedBy: r.user_id, submitted: true };
    }
    const removeSubmission = (guildId, id, userId = null) => run(`DELETE FROM music_submissions WHERE guild_id = ? AND id = ?${userId ? " AND user_id = ?" : ""}`, ...[String(guildId), Number(id), ...(userId ? [String(userId)] : [])]).changes > 0;
    const clearSubmissions = guildId => run("DELETE FROM music_submissions WHERE guild_id = ?", String(guildId)).changes;
    const autoChannelGuilds = () => all("SELECT guild_id, autodj_channel_id FROM music_settings WHERE autodj = 1 AND autodj_channel_id IS NOT NULL").map(clean);
    function setMusicSettings(guildId, patch) {
        run("INSERT OR IGNORE INTO music_settings (guild_id) VALUES (?)", String(guildId));
        for (const [k, v] of Object.entries(patch)) {
            if (!FIELDS.includes(k)) throw new Error(`Cannot set ${k}`);
            run(`UPDATE music_settings SET ${k} = ? WHERE guild_id = ?`, v, String(guildId));
        }
        return getMusicSettings(guildId);
    }

    const listPlaylists = userId => all("SELECT name, tracks, at FROM music_playlists WHERE user_id = ? ORDER BY name", String(userId)).map(clean)
        .map(r => ({ name: r.name, at: r.at, tracks: JSON.parse(r.tracks) }));
    const getPlaylist = (userId, name) => { const r = clean(get("SELECT name, tracks, at FROM music_playlists WHERE user_id = ? AND name = ? COLLATE NOCASE", String(userId), String(name))); return r ? { name: r.name, at: r.at, tracks: JSON.parse(r.tracks) } : null; };
    function savePlaylist(userId, name, tracks) {
        const n = String(name).trim().slice(0, 40);
        if (!n) throw new Error("Give the playlist a name.");
        const exists = getPlaylist(userId, n);
        if (!exists && listPlaylists(userId).length >= MAX_PLAYLISTS) throw new Error(`You can keep ${MAX_PLAYLISTS} playlists. Delete one first.`);
        const slim = tracks.slice(0, MAX_PLAYLIST_TRACKS).map(t => ({ url: t.url, title: t.title, artist: t.artist, duration: t.duration ?? null, thumb: t.thumb ?? null }));
        run("DELETE FROM music_playlists WHERE user_id = ? AND name = ? COLLATE NOCASE", String(userId), n);
        run("INSERT INTO music_playlists (user_id, name, tracks, at) VALUES (?,?,?,?)", String(userId), n, JSON.stringify(slim), now());
        return { name: n, count: slim.length };
    }
    const deletePlaylist = (userId, name) => run("DELETE FROM music_playlists WHERE user_id = ? AND name = ? COLLATE NOCASE", String(userId), String(name)).changes > 0;
    const forgetMusicUser = userId => { run("DELETE FROM music_playlists WHERE user_id = ?", String(userId)); run("DELETE FROM music_submissions WHERE user_id = ?", String(userId)); };

    return { getAutoPlaylist, setAutoPlaylist, listSubmissions, countSubmissions, addSubmissions, takeSubmission, removeSubmission, clearSubmissions, autoChannelGuilds, getMusicSettings, setMusicSettings, listPlaylists, getPlaylist, savePlaylist, deletePlaylist, forgetMusicUser };
}

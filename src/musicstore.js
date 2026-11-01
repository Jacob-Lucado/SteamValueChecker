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
CREATE TABLE IF NOT EXISTS music_playlists (
    user_id TEXT NOT NULL,
    name    TEXT NOT NULL,
    tracks  TEXT NOT NULL,
    at      INTEGER NOT NULL,
    PRIMARY KEY (user_id, name)
);
`;

export const MUSIC_DEFAULTS = { enabled: 1, dj_role_id: null, channel_id: null, volume: 50, max_queue: 100, max_minutes: 0, announce: 1, leave_minutes: 5, stay: 0 };
export const MAX_PLAYLISTS = 10, MAX_PLAYLIST_TRACKS = 100;

export function musicStore({ run, get, all, clean, now }) {
    const getMusicSettings = guildId => ({ guild_id: String(guildId), ...MUSIC_DEFAULTS, ...(clean(get("SELECT * FROM music_settings WHERE guild_id = ?", String(guildId))) ?? {}) });
    const FIELDS = ["enabled", "dj_role_id", "channel_id", "volume", "max_queue", "max_minutes", "announce", "leave_minutes", "stay"];
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
    const forgetMusicUser = userId => run("DELETE FROM music_playlists WHERE user_id = ?", String(userId));

    return { getMusicSettings, setMusicSettings, listPlaylists, getPlaylist, savePlaylist, deletePlaylist, forgetMusicUser };
}

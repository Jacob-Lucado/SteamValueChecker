// Who is streaming right now in each server, and when each streamer was last announced (so a ping is not repeated every few minutes).

export const streamSchema = `
CREATE TABLE IF NOT EXISTS stream_live (
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    title      TEXT NOT NULL,
    url        TEXT NOT NULL,
    game       TEXT,
    started    INTEGER NOT NULL,
    channel_id TEXT,
    message_id TEXT,
    PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS stream_link (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    platform TEXT NOT NULL,
    handle   TEXT NOT NULL,
    via      TEXT NOT NULL DEFAULT 'role',
    added    INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, platform)
);
CREATE TABLE IF NOT EXISTS stream_pinged (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    at       INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
);
`;

export function streamStore({ run, get, all, clean }) {
    const live = r => { const c = clean(r); if (c) { try { c.also = c.also ? JSON.parse(c.also) : []; } catch { c.also = []; } } return c; };
    const getStreamLive = (guildId, userId) => live(get("SELECT * FROM stream_live WHERE guild_id = ? AND user_id = ?", guildId, userId));
    const listStreamLive = guildId => all("SELECT * FROM stream_live WHERE guild_id = ? ORDER BY started", guildId).map(live);
    const setStreamLive = (guildId, userId, o) => run(
        "INSERT INTO stream_live (guild_id, user_id, title, url, game, started, channel_id, message_id, auto, also) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET title = excluded.title, url = excluded.url, game = excluded.game, channel_id = excluded.channel_id, message_id = excluded.message_id, auto = excluded.auto, also = excluded.also",
        guildId, userId, o.title, o.url, o.game ?? null, o.started, o.channelId ?? null, o.messageId ?? null, o.auto ? 1 : 0, o.also?.length ? JSON.stringify(o.also) : null);
    const endStreamLive = (guildId, userId) => { const row = getStreamLive(guildId, userId); if (row) run("DELETE FROM stream_live WHERE guild_id = ? AND user_id = ?", guildId, userId); return row; };
    const lastStreamPing = (guildId, userId) => get("SELECT at FROM stream_pinged WHERE guild_id = ? AND user_id = ?", guildId, userId)?.at ?? 0;
    const markStreamPing = (guildId, userId, at) => run("INSERT INTO stream_pinged (guild_id, user_id, at) VALUES (?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET at = excluded.at", guildId, userId, at);
    /** A streamer can link one channel on each site. This gives the oldest one (or the one on `platform`), for the places that only need one. */
    const getStreamLink = (guildId, userId, platform = null) => clean(platform
        ? get("SELECT * FROM stream_link WHERE guild_id = ? AND user_id = ? AND platform = ?", guildId, userId, platform)
        : get("SELECT * FROM stream_link WHERE guild_id = ? AND user_id = ? ORDER BY added, platform LIMIT 1", guildId, userId));
    const getStreamLinks = (guildId, userId) => all("SELECT * FROM stream_link WHERE guild_id = ? AND user_id = ? ORDER BY added, platform", guildId, userId).map(clean);
    const setStreamLink = (guildId, userId, o) => run("INSERT INTO stream_link (guild_id, user_id, platform, handle, via, added) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(guild_id, user_id, platform) DO UPDATE SET handle = excluded.handle, via = excluded.via", guildId, userId, o.platform, o.handle, o.via ?? "role", o.added);
    /** Without a platform, every channel the person linked here goes. */
    const removeStreamLink = (guildId, userId, platform = null) => platform
        ? run("DELETE FROM stream_link WHERE guild_id = ? AND user_id = ? AND platform = ?", guildId, userId, platform).changes > 0
        : run("DELETE FROM stream_link WHERE guild_id = ? AND user_id = ?", guildId, userId).changes > 0;
    const allStreamLinks = () => all("SELECT * FROM stream_link ORDER BY added").map(clean);
    const listStreamLinks = guildId => all("SELECT * FROM stream_link WHERE guild_id = ? ORDER BY added", guildId).map(clean);
    return { listStreamLinks, getStreamLink, getStreamLinks, setStreamLink, removeStreamLink, allStreamLinks, getStreamLive, listStreamLive, setStreamLive, endStreamLive, lastStreamPing, markStreamPing };
}

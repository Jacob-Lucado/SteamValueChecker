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
    PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS stream_pinged (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    at       INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
);
`;

export function streamStore({ run, get, all, clean }) {
    const getStreamLive = (guildId, userId) => clean(get("SELECT * FROM stream_live WHERE guild_id = ? AND user_id = ?", guildId, userId));
    const listStreamLive = guildId => all("SELECT * FROM stream_live WHERE guild_id = ? ORDER BY started", guildId).map(clean);
    const setStreamLive = (guildId, userId, o) => run(
        "INSERT INTO stream_live (guild_id, user_id, title, url, game, started, channel_id, message_id, auto) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET title = excluded.title, url = excluded.url, game = excluded.game, channel_id = excluded.channel_id, message_id = excluded.message_id, auto = excluded.auto",
        guildId, userId, o.title, o.url, o.game ?? null, o.started, o.channelId ?? null, o.messageId ?? null, o.auto ? 1 : 0);
    const endStreamLive = (guildId, userId) => { const row = getStreamLive(guildId, userId); if (row) run("DELETE FROM stream_live WHERE guild_id = ? AND user_id = ?", guildId, userId); return row; };
    const lastStreamPing = (guildId, userId) => get("SELECT at FROM stream_pinged WHERE guild_id = ? AND user_id = ?", guildId, userId)?.at ?? 0;
    const markStreamPing = (guildId, userId, at) => run("INSERT INTO stream_pinged (guild_id, user_id, at) VALUES (?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET at = excluded.at", guildId, userId, at);
    const getStreamLink = (guildId, userId) => clean(get("SELECT * FROM stream_link WHERE guild_id = ? AND user_id = ?", guildId, userId));
    const setStreamLink = (guildId, userId, o) => run("INSERT INTO stream_link (guild_id, user_id, platform, handle, via, added) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET platform = excluded.platform, handle = excluded.handle, via = excluded.via", guildId, userId, o.platform, o.handle, o.via ?? "role", o.added);
    const removeStreamLink = (guildId, userId) => run("DELETE FROM stream_link WHERE guild_id = ? AND user_id = ?", guildId, userId);
    const allStreamLinks = () => all("SELECT * FROM stream_link ORDER BY added").map(clean);
    const listStreamLinks = guildId => all("SELECT * FROM stream_link WHERE guild_id = ? ORDER BY added", guildId).map(clean);
    return { listStreamLinks, getStreamLink, setStreamLink, removeStreamLink, allStreamLinks, getStreamLive, listStreamLive, setStreamLive, endStreamLive, lastStreamPing, markStreamPing };
}

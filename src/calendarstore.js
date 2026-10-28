// The built-in calendar: events that server managers add for their members, and optional private feed links so a member can
// subscribe in Google, Apple or Outlook calendar. Everything else on the calendar (release dates, Steam sales, looking-for-group
// posts) is read from data the bot already has.
import { createHash, randomBytes } from "node:crypto";

export const calendarSchema = `
CREATE TABLE IF NOT EXISTS calendar_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    title      TEXT NOT NULL,
    notes      TEXT,
    starts_at  INTEGER NOT NULL,
    channel_id TEXT,
    message_id TEXT,
    created_by TEXT,
    remind_min INTEGER NOT NULL DEFAULT 60,
    reminded   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cal_guild ON calendar_events(guild_id, starts_at);
CREATE TABLE IF NOT EXISTS calendar_feeds (
    discord_id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    guild_ids  TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    used_at    INTEGER
);`;

const hash = t => createHash("sha256").update(String(t)).digest("hex");
export const FEED_TOKEN = /^svcc_[A-Za-z0-9_-]{43}$/;

export function calendarStore({ run, get, all, clean, now }) {
    const createCalEvent = e => Number(run(
        "INSERT INTO calendar_events (guild_id, title, notes, starts_at, channel_id, created_by, remind_min, reminded, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        e.guild_id, e.title, e.notes ?? null, e.starts_at, e.channel_id ?? null, e.created_by ?? null, e.remind_min, e.remind_min > 0 ? 0 : 1, now()).lastInsertRowid);
    const getCalEvent = id => clean(get("SELECT * FROM calendar_events WHERE id = ?", id)) ?? null;
    const setCalMessage = (id, messageId) => run("UPDATE calendar_events SET message_id = ? WHERE id = ?", messageId, id);
    const deleteCalEvent = (id, guildId) => run("DELETE FROM calendar_events WHERE id = ? AND guild_id = ?", id, guildId).changes > 0;
    const listCalEvents = (guildId, from, to) => all("SELECT * FROM calendar_events WHERE guild_id = ? AND starts_at >= ? AND starts_at <= ? ORDER BY starts_at", guildId, from, to).map(clean);
    const countUpcomingCalEvents = (guildId, at) => get("SELECT COUNT(*) AS n FROM calendar_events WHERE guild_id = ? AND starts_at >= ?", guildId, at).n;
    const calEventsToRemind = at => all("SELECT * FROM calendar_events WHERE reminded = 0 AND starts_at - remind_min * 60000 <= ?", at).map(clean);
    const markCalReminded = id => run("UPDATE calendar_events SET reminded = 1 WHERE id = ?", id);
    const pruneCalEvents = (at, keepMs = 30 * 86400_000) => run("DELETE FROM calendar_events WHERE starts_at < ?", at - keepMs).changes;
    const forgetCalendarUser = id => { run("DELETE FROM calendar_feeds WHERE discord_id = ?", id); run("UPDATE calendar_events SET created_by = NULL WHERE created_by = ?", id); };

    /** Makes a new private feed link token (replacing any old one). Only its hash is stored. */
    function createCalFeed(id, guildIds) {
        const token = `svcc_${randomBytes(32).toString("base64url")}`;
        run(`INSERT INTO calendar_feeds (discord_id, token_hash, guild_ids, created_at) VALUES (?,?,?,?)
             ON CONFLICT(discord_id) DO UPDATE SET token_hash = excluded.token_hash, guild_ids = excluded.guild_ids, created_at = excluded.created_at, used_at = NULL`,
            id, hash(token), (guildIds ?? []).join(","), now());
        return token;
    }
    const calFeedForToken = token => {
        if (!FEED_TOKEN.test(String(token ?? ""))) return null;
        const r = clean(get("SELECT discord_id, guild_ids FROM calendar_feeds WHERE token_hash = ?", hash(token)));
        return r ? { discord_id: r.discord_id, guild_ids: String(r.guild_ids || "").split(",").filter(Boolean) } : null;
    };
    const noteCalFeedUse = id => run("UPDATE calendar_feeds SET used_at = ? WHERE discord_id = ?", now(), id);
    const getCalFeed = id => clean(get("SELECT created_at, used_at, guild_ids FROM calendar_feeds WHERE discord_id = ?", id)) ?? null;
    const revokeCalFeed = id => run("DELETE FROM calendar_feeds WHERE discord_id = ?", id).changes > 0;
    return { createCalEvent, getCalEvent, setCalMessage, deleteCalEvent, listCalEvents, countUpcomingCalEvents, calEventsToRemind, markCalReminded, pruneCalEvents, forgetCalendarUser,
        createCalFeed, calFeedForToken, noteCalFeedUse, getCalFeed, revokeCalFeed };
}

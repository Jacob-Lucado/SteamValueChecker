// The staff chat: a small private room for the owner and the people the owner let into the admin panel.
// Channels for everyone, direct messages between two people, replies, and unread counts. Nothing here is shown outside the panel.
export const staffChatSchema = `
CREATE TABLE IF NOT EXISTS staff_channels (
    id      TEXT PRIMARY KEY,
    name    TEXT NOT NULL,
    topic   TEXT NOT NULL DEFAULT '',
    created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS staff_msgs (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,
    author  TEXT NOT NULL,
    name    TEXT NOT NULL,
    body    TEXT NOT NULL,
    reply   INTEGER,
    at      INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS staff_react (
    msg_id  INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    emoji   TEXT NOT NULL,
    PRIMARY KEY (msg_id, user_id, emoji)
);
CREATE TABLE IF NOT EXISTS staff_media (
    id      TEXT PRIMARY KEY,
    owner   TEXT NOT NULL,
    kind    TEXT NOT NULL,
    mime    TEXT NOT NULL,
    ext     TEXT NOT NULL,
    size    INTEGER NOT NULL,
    at      INTEGER NOT NULL,
    msg     INTEGER
);
CREATE TABLE IF NOT EXISTS radio_tracks (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    url     TEXT NOT NULL,
    embed   TEXT NOT NULL,
    title   TEXT NOT NULL,
    author  TEXT NOT NULL DEFAULT '',
    art     TEXT,
    by_key  TEXT NOT NULL,
    by_name TEXT NOT NULL,
    at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_staff_msgs_channel ON staff_msgs (channel, id);
CREATE TABLE IF NOT EXISTS staff_reads (
    user_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    last_id INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, channel)
);
`;

export const dmChannel = (a, b) => "dm:" + [String(a), String(b)].sort().join(":");
export const isDm = c => String(c).startsWith("dm:");
export const dmParts = c => String(c).slice(3).split(":");

export function staffChatStore({ run, get, all, now }) {
    const ensureDefaults = () => {
        if (get("SELECT 1 AS x FROM staff_channels LIMIT 1")) return;
        const t = now();
        run("INSERT OR IGNORE INTO staff_channels (id, name, topic, created) VALUES ('general', 'general', 'Everyone on the panel', ?)", t);
        run("INSERT OR IGNORE INTO staff_channels (id, name, topic, created) VALUES ('support', 'support', 'Bug reports, requests and member questions', ?)", t);
    };
    const channels = () => { ensureDefaults(); return all("SELECT id, name, topic FROM staff_channels ORDER BY created, name").map(r => ({ ...r })); };
    const addChannel = name => {
        const id = String(name).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
        if (!id || id.startsWith("dm")) return null;
        if (get("SELECT 1 AS x FROM staff_channels WHERE id = ?", id)) return null;
        run("INSERT INTO staff_channels (id, name, topic, created) VALUES (?,?,'',?)", id, id, now());
        return id;
    };
    const removeChannel = id => { run("DELETE FROM staff_channels WHERE id = ?", id); run("DELETE FROM staff_msgs WHERE channel = ?", id); run("DELETE FROM staff_reads WHERE channel = ?", id); };
    const hasChannel = id => Boolean(get("SELECT 1 AS x FROM staff_channels WHERE id = ?", String(id)));
    const send = (channel, author, name, body, reply = null, media = null) => {
        const r = run("INSERT INTO staff_msgs (channel, author, name, body, reply, at, media) VALUES (?,?,?,?,?,?,?)", channel, String(author), String(name).slice(0, 40), String(body).slice(0, 1000), reply ? Number(reply) : null, now(), media ?? null);
        if (media) run("UPDATE staff_media SET msg = ? WHERE id = ?", Number(r.lastInsertRowid), media);
        // keep each room to its latest 2000 messages
        if (Number(r.lastInsertRowid) % 50 === 0) run("DELETE FROM staff_msgs WHERE channel = ? AND id <= (SELECT id FROM staff_msgs WHERE channel = ? ORDER BY id DESC LIMIT 1 OFFSET 2000)", channel, channel);
        return Number(r.lastInsertRowid);
    };
    /** The newest 80 messages, or everything after `after`. Each carries a short quote of what it replies to. */
    const messages = (channel, after = 0) => {
        const rows = after > 0 ? all("SELECT * FROM staff_msgs WHERE channel = ? AND id > ? ORDER BY id LIMIT 200", channel, after) : all("SELECT * FROM (SELECT * FROM staff_msgs WHERE channel = ? ORDER BY id DESC LIMIT 80) ORDER BY id", channel);
        return rows.map(m => {
            const q = m.reply ? get("SELECT name, body FROM staff_msgs WHERE id = ?", m.reply) : null;
            const rx = {}; for (const r of all("SELECT emoji, user_id FROM staff_react WHERE msg_id = ?", m.id)) (rx[r.emoji] ??= []).push(r.user_id);
            return { id: m.id, author: m.author, name: m.name, body: m.body, at: m.at, edited: m.edited || 0, reactions: rx, media: m.media ? (get("SELECT id, kind FROM staff_media WHERE id = ?", m.media) ?? null) : null, reply: q ? { id: m.reply, name: q.name, body: String(q.body).slice(0, 90) } : null };
        });
    };
    const getMsg = id => get("SELECT * FROM staff_msgs WHERE id = ?", Number(id)) ?? null;
    const addMedia = (id, owner, kind, mime, ext, size) => run("INSERT INTO staff_media (id, owner, kind, mime, ext, size, at) VALUES (?,?,?,?,?,?,?)", id, String(owner), kind, mime, ext, size, now());
    const getMedia = id => get("SELECT * FROM staff_media WHERE id = ?", String(id)) ?? null;
    const dropMedia = id => run("DELETE FROM staff_media WHERE id = ?", String(id));
    /** Pictures and clips that were uploaded but never sent in a message, older than `before`. */
    const strayMedia = before => all("SELECT * FROM staff_media WHERE msg IS NULL AND at < ?", before).map(r => ({ ...r }));
    /** The files behind a message or a whole room, so they can be removed from disk. */
    const mediaOfMsg = id => all("SELECT * FROM staff_media WHERE msg = ?", Number(id)).map(r => ({ ...r }));
    const mediaOfChannel = channel => all("SELECT m.* FROM staff_media m JOIN staff_msgs s ON s.id = m.msg WHERE s.channel = ?", channel).map(r => ({ ...r }));
    // radio
    const radioList = () => all("SELECT * FROM radio_tracks ORDER BY id").map(r => ({ ...r }));
    const radioAdd = t => Number(run("INSERT INTO radio_tracks (url, embed, title, author, art, by_key, by_name, at) VALUES (?,?,?,?,?,?,?,?)", t.url, t.embed, String(t.title).slice(0, 160), String(t.author ?? "").slice(0, 80), t.art ?? null, String(t.by_key), String(t.by_name).slice(0, 40), now()).lastInsertRowid);
    const radioGet = id => get("SELECT * FROM radio_tracks WHERE id = ?", Number(id)) ?? null;
    const radioRemove = id => run("DELETE FROM radio_tracks WHERE id = ?", Number(id));
    const radioCount = () => get("SELECT COUNT(*) AS n FROM radio_tracks").n;
    const radioHas = embed => Boolean(get("SELECT 1 AS x FROM radio_tracks WHERE embed = ?", embed));
    const deleteMsg = id => { run("DELETE FROM staff_msgs WHERE id = ?", Number(id)); run("DELETE FROM staff_react WHERE msg_id = ?", Number(id)); };
    const editMsg = (id, body) => run("UPDATE staff_msgs SET body = ?, edited = ? WHERE id = ?", String(body).slice(0, 1000), now(), Number(id));
    /** Adds the reaction, or takes it back if this person already used it. */
    const toggleReact = (id, user, emoji) => {
        const had = get("SELECT 1 AS x FROM staff_react WHERE msg_id = ? AND user_id = ? AND emoji = ?", Number(id), String(user), emoji);
        if (had) run("DELETE FROM staff_react WHERE msg_id = ? AND user_id = ? AND emoji = ?", Number(id), String(user), emoji);
        else if (get("SELECT COUNT(DISTINCT emoji) AS n FROM staff_react WHERE msg_id = ?", Number(id)).n < 12) run("INSERT INTO staff_react (msg_id, user_id, emoji) VALUES (?,?,?)", Number(id), String(user), emoji);
    };
    /** The newest message in a room, for notification text. */
    const lastMsg = channel => get("SELECT id, author, name, body FROM staff_msgs WHERE channel = ? ORDER BY id DESC LIMIT 1", channel) ?? null;
    /** How many unread messages in each room mention this name. */
    const mentions = (user, name, channelIds) => {
        const out = {}, tag = "%@" + String(name).split(/\s+/)[0].replace(/[%_]/g, "") + "%";
        for (const c of channelIds) {
            const last = get("SELECT last_id FROM staff_reads WHERE user_id = ? AND channel = ?", String(user), c)?.last_id ?? 0;
            const n = get("SELECT COUNT(*) AS n FROM staff_msgs WHERE channel = ? AND id > ? AND author != ? AND body LIKE ? COLLATE NOCASE", c, last, String(user), tag).n;
            if (n) out[c] = n;
        }
        return out;
    };
    const markRead = (user, channel, id) => run("INSERT INTO staff_reads (user_id, channel, last_id) VALUES (?,?,?) ON CONFLICT(user_id, channel) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)", String(user), channel, Number(id));
    /** Unread counts per channel for one person, counting only other people's messages. dmIds are the direct-message rooms they are in. */
    const unread = (user, channelIds) => {
        const out = {};
        for (const c of channelIds) {
            const last = get("SELECT last_id FROM staff_reads WHERE user_id = ? AND channel = ?", String(user), c)?.last_id ?? 0;
            const n = get("SELECT COUNT(*) AS n FROM staff_msgs WHERE channel = ? AND id > ? AND author != ?", c, last, String(user)).n;
            if (n) out[c] = n;
        }
        return out;
    };
    /** Direct-message rooms that already have messages and include this person. */
    const dmRooms = user => all("SELECT DISTINCT channel FROM staff_msgs WHERE channel LIKE 'dm:%' AND (channel LIKE ? OR channel LIKE ?)", `dm:${user}:%`, `dm:%:${user}`).map(r => r.channel);
    return { addStaffMedia: addMedia, getStaffMedia: getMedia, dropStaffMedia: dropMedia, strayStaffMedia: strayMedia, staffMediaOfMsg: mediaOfMsg, staffMediaOfChannel: mediaOfChannel, radioList, radioAdd, radioGet, radioRemove, radioCount, radioHas, staffChannels: channels, addStaffChannel: addChannel, removeStaffChannel: removeChannel, hasStaffChannel: hasChannel, sendStaff: send, staffMessages: messages, getStaffMsg: getMsg, deleteStaffMsg: deleteMsg, editStaffMsg: editMsg, toggleStaffReact: toggleReact, lastStaffMsg: lastMsg, staffMentions: mentions, markStaffRead: markRead, staffUnread: unread, staffDmRooms: dmRooms };
}

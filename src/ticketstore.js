// Ticket tables. A ticket belongs to a server (guild_id) or to the bot owner (guild_id NULL). The "scope" used for
// settings and canned replies is the guild id, or "*" for the bot owner's own queue.

export const ticketSchema = `
CREATE TABLE IF NOT EXISTS tickets (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT NOT NULL,
    user_name    TEXT,
    guild_id     TEXT,
    subject      TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'open',
    assignee_id  TEXT,
    tags         TEXT NOT NULL DEFAULT '',
    giveaway_id  INTEGER,
    context      TEXT,
    channel_id   TEXT,
    message_id   TEXT,
    rating       INTEGER,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    closed_at    INTEGER
);
CREATE INDEX IF NOT EXISTS tickets_user ON tickets(user_id, status);
CREATE INDEX IF NOT EXISTS tickets_guild ON tickets(guild_id, status);
CREATE TABLE IF NOT EXISTS ticket_messages (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_id TEXT,
    role      TEXT NOT NULL,
    body      TEXT NOT NULL,
    at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ticket_messages_t ON ticket_messages(ticket_id);
CREATE TABLE IF NOT EXISTS ticket_settings (
    scope         TEXT PRIMARY KEY,
    channel_id    TEXT,
    staff_role_id TEXT
);
CREATE TABLE IF NOT EXISTS canned_replies (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    title TEXT NOT NULL,
    body  TEXT NOT NULL
);
`;

export const TICKET_STATUSES = ["open", "waiting", "resolved", "closed"];

export function ticketStore({ run, get, all, clean, now }) {
    const row = r => (r ? { ...clean(r), tags: r.tags ? String(r.tags).split(",").filter(Boolean) : [], context: r.context ? safeParse(r.context) : null } : r);
    const safeParse = s => { try { return JSON.parse(s); } catch { return null; } };

    function createTicket(t) {
        const r = run(
            "INSERT INTO tickets (user_id, user_name, guild_id, subject, giveaway_id, context, tags, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            t.user_id, t.user_name ?? null, t.guild_id ?? null, t.subject, t.giveaway_id ?? null, t.context ? JSON.stringify(t.context) : null, (t.tags ?? []).join(","), now(), now());
        return Number(r.lastInsertRowid);
    }
    const getTicket = id => row(get("SELECT * FROM tickets WHERE id = ?", id));
    const addTicketMessage = (ticketId, authorId, role, body) => {
        run("INSERT INTO ticket_messages (ticket_id, author_id, role, body, at) VALUES (?,?,?,?,?)", ticketId, authorId ?? null, role, body, now());
        run("UPDATE tickets SET updated_at = ? WHERE id = ?", now(), ticketId);
    };
    const listTicketMessages = ticketId => all("SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY id", ticketId).map(clean);
    const setTicketStatus = (id, status) => run("UPDATE tickets SET status = ?, updated_at = ?, closed_at = ? WHERE id = ?", status, now(), status === "closed" || status === "resolved" ? now() : null, id);
    const setTicketAssignee = (id, userId) => run("UPDATE tickets SET assignee_id = ?, updated_at = ? WHERE id = ?", userId, now(), id);
    const setTicketTags = (id, tags) => run("UPDATE tickets SET tags = ? WHERE id = ?", tags.join(","), id);
    const setTicketMessage = (id, channelId, messageId) => run("UPDATE tickets SET channel_id = ?, message_id = ? WHERE id = ?", channelId, messageId, id);
    const setTicketRating = (id, rating) => run("UPDATE tickets SET rating = ? WHERE id = ?", rating, id);

    /** filters: userId (their own), guildIds (a manager's servers), all (the owner), status, q. */
    function listTickets({ userId = null, guildIds = null, all: everything = false, status = null, q = "", limit = 100 } = {}) {
        const where = [], args = [];
        if (userId) { where.push("user_id = ?"); args.push(userId); }
        else if (!everything) {
            const ids = guildIds ?? [];
            if (!ids.length) return [];
            where.push(`guild_id IN (${ids.map(() => "?").join(",")})`); args.push(...ids);
        }
        if (status === "active") where.push("status IN ('open','waiting')");
        else if (status) { where.push("status = ?"); args.push(status); }
        if (q) { where.push("(subject LIKE ? OR tags LIKE ? OR CAST(id AS TEXT) = ?)"); args.push(`%${q}%`, `%${q}%`, q.replace("#", "")); }
        return all(`SELECT * FROM tickets ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY (status IN ('open','waiting')) DESC, updated_at DESC LIMIT ?`, ...args, limit).map(row);
    }
    /** User-reported bugs (tickets tagged "bug"), newest first, with the first message of each. */
    const BUG = "(',' || tags || ',') LIKE '%,bug,%'";
    const listBugs = ({ limit = 100 } = {}) => all(`SELECT * FROM tickets WHERE ${BUG} ORDER BY created_at DESC LIMIT ?`, limit).map(row)
        .map(t => ({ ...t, first: get("SELECT body FROM ticket_messages WHERE ticket_id = ? ORDER BY id LIMIT 1", t.id)?.body ?? "", replies: get("SELECT COUNT(*) AS n FROM ticket_messages WHERE ticket_id = ? AND role = 'staff'", t.id).n }));
    const countNewBugs = since => get(`SELECT COUNT(*) AS n FROM tickets WHERE ${BUG} AND created_at > ? AND status IN ('open','waiting')`, since ?? 0).n;
    const staleWaiting = cutoff => all("SELECT * FROM tickets WHERE status = 'waiting' AND updated_at < ?", cutoff).map(row);
    const countOpenTickets = userId => get("SELECT COUNT(*) AS n FROM tickets WHERE user_id = ? AND status IN ('open','waiting')", userId).n;
    const purgeTickets = (olderThanMs = 180 * 86400_000) => run("DELETE FROM tickets WHERE status IN ('closed','resolved') AND closed_at < ?", now() - olderThanMs).changes;
    const deleteUserTickets = userId => run("DELETE FROM tickets WHERE user_id = ?", userId).changes;

    const getTicketSettings = scope => clean(get("SELECT * FROM ticket_settings WHERE scope = ?", scope)) ?? { scope, channel_id: null, staff_role_id: null };
    const setTicketSettings = (scope, { channelId, staffRoleId }) => run(
        `INSERT INTO ticket_settings (scope, channel_id, staff_role_id) VALUES (?,?,?)
         ON CONFLICT(scope) DO UPDATE SET channel_id = excluded.channel_id, staff_role_id = excluded.staff_role_id`, scope, channelId ?? null, staffRoleId ?? null);

    const listCanned = scope => all("SELECT * FROM canned_replies WHERE scope = ? ORDER BY title COLLATE NOCASE", scope).map(clean);
    const addCanned = (scope, title, body) => Number(run("INSERT INTO canned_replies (scope, title, body) VALUES (?,?,?)", scope, title, body).lastInsertRowid);
    const removeCanned = (scope, id) => run("DELETE FROM canned_replies WHERE scope = ? AND id = ?", scope, id).changes > 0;

    return {
        createTicket, listBugs, countNewBugs, getTicket, addTicketMessage, listTicketMessages, setTicketStatus, setTicketAssignee, setTicketTags, setTicketMessage, setTicketRating,
        listTickets, staleWaiting, countOpenTickets, purgeTickets, deleteUserTickets, getTicketSettings, setTicketSettings, listCanned, addCanned, removeCanned
    };
}

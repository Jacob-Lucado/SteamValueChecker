// Feature requests: members suggest and upvote, the bot owner sets a status and a note. Global to the bot, not per server.

export const REQUEST_STATUSES = {
    open: "Under review", planned: "Planned", in_development: "In development", shipped: "Shipped", rejected: "Rejected", duplicate: "Duplicate", on_hold: "On hold"
};
export const MAX_OPEN_PER_USER = 5, MAX_TITLE = 100, MAX_BODY = 1000, MAX_NOTE = 500;

export const requestSchema = `
CREATE TABLE IF NOT EXISTS feature_requests (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    user_name  TEXT,
    title      TEXT NOT NULL,
    body       TEXT,
    status     TEXT NOT NULL DEFAULT 'open',
    note       TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS feature_requests_status ON feature_requests(status, created_at);
CREATE TABLE IF NOT EXISTS feature_votes (
    request_id INTEGER NOT NULL REFERENCES feature_requests(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL,
    PRIMARY KEY (request_id, user_id)
);`;

export function requestStore({ run, get, all, clean, now }) {
    const getRequest = id => clean(get("SELECT * FROM feature_requests WHERE id = ?", id));
    /** Everything, newest or most-voted first. `viewer` marks which ones they voted for and wrote. */
    const listRequests = (viewer, { status = null, sort = "votes" } = {}) => all(`
        SELECT r.id, r.user_id, r.user_name, r.title, r.body, r.status, r.note, r.created_at, r.updated_at,
               (SELECT COUNT(*) FROM feature_votes v WHERE v.request_id = r.id) AS votes,
               EXISTS (SELECT 1 FROM feature_votes v WHERE v.request_id = r.id AND v.user_id = ?) AS voted
        FROM feature_requests r ${status ? "WHERE r.status = ?" : ""}
        ORDER BY ${sort === "new" ? "r.created_at DESC" : "votes DESC, r.created_at DESC"} LIMIT 300`, ...(status ? [viewer ?? "", status] : [viewer ?? ""]))
        .map(r => ({ ...clean(r), voted: Boolean(r.voted), mine: r.user_id === viewer }));
    const openCountFor = userId => get("SELECT COUNT(*) AS n FROM feature_requests WHERE user_id = ? AND status IN ('open','on_hold')", userId).n;
    const addRequest = ({ userId, userName, title, body }) => {
        const id = Number(run("INSERT INTO feature_requests (user_id, user_name, title, body, created_at, updated_at) VALUES (?,?,?,?,?,?)", userId, userName ?? null, title, body || null, now(), now()).lastInsertRowid);
        run("INSERT OR IGNORE INTO feature_votes (request_id, user_id) VALUES (?,?)", id, userId);
        return id;
    };
    /** Toggles a vote; returns whether the person now votes for it. */
    const toggleRequestVote = (id, userId) => {
        if (run("DELETE FROM feature_votes WHERE request_id = ? AND user_id = ?", id, userId).changes) return false;
        run("INSERT INTO feature_votes (request_id, user_id) VALUES (?,?)", id, userId);
        return true;
    };
    const setRequestStatus = (id, status, note) => run("UPDATE feature_requests SET status = ?, note = ?, updated_at = ? WHERE id = ?", status, note || null, now(), id).changes > 0;
    const deleteRequest = id => run("DELETE FROM feature_requests WHERE id = ?", id).changes > 0;
    const requestCounts = () => Object.fromEntries(all("SELECT status, COUNT(*) AS n FROM feature_requests GROUP BY status").map(r => [r.status, r.n]));
    const forgetRequestUser = userId => { run("DELETE FROM feature_votes WHERE user_id = ?", userId); run("DELETE FROM feature_requests WHERE user_id = ?", userId); };
    return { getRequest, listRequests, openCountFor, addRequest, toggleRequestVote, setRequestStatus, deleteRequest, requestCounts, forgetRequestUser };
}

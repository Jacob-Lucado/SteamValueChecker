// What the owner did in the admin panel: who, what, to what, when. Kept for six months so a mistake can be traced.
export const auditSchema = `
CREATE TABLE IF NOT EXISTS admin_audit (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    at      INTEGER NOT NULL,
    actor   TEXT NOT NULL,
    action  TEXT NOT NULL,
    target  TEXT,
    detail  TEXT
);
CREATE INDEX IF NOT EXISTS admin_audit_at ON admin_audit (at DESC);
`;

const KEEP_MS = 180 * 24 * 3600_000;

export function auditStore({ run, all, now }) {
    function logAudit({ actor, action, target = null, detail = null }) {
        run("INSERT INTO admin_audit (at, actor, action, target, detail) VALUES (?,?,?,?,?)", now(), String(actor), String(action).slice(0, 80), target === null ? null : String(target).slice(0, 80), detail === null ? null : String(detail).slice(0, 400));
        if (Math.random() < 0.02) run("DELETE FROM admin_audit WHERE at < ?", now() - KEEP_MS);
    }
    /** Newest first. Pass the last row's id as `before` to get the next page. */
    function listAudit({ limit = 50, before = null, q = "" } = {}) {
        const like = q ? `%${String(q).replace(/[%_]/g, m => "\\" + m).slice(0, 60)}%` : null;
        return all(
            `SELECT id, at, actor, action, target, detail FROM admin_audit WHERE (? IS NULL OR id < ?) AND (? IS NULL OR action LIKE ? ESCAPE '\\' OR target LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\') ORDER BY id DESC LIMIT ?`,
            before, before, like, like, like, like, Math.max(1, Math.min(200, Number(limit) || 50)));
    }
    return { logAudit, listAudit };
}

// Batch redeem jobs queued from Discord (/redeem). The member's open dashboard page picks a job up and hands the keys to the
// FanaticalGrabber extension, which redeems them in their own logged-in browser. Keys are kept only until the job finishes
// (or 24 hours pass), then erased; only counts remain.
export const redeemSchema = `
CREATE TABLE IF NOT EXISTS redeem_jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id  TEXT NOT NULL,
    keys        TEXT,
    total       INTEGER NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  INTEGER NOT NULL,
    finished_at INTEGER,
    summary     TEXT
);
CREATE INDEX IF NOT EXISTS idx_redeem_user ON redeem_jobs(discord_id, status);
CREATE TABLE IF NOT EXISTS redeem_log (
    discord_id TEXT NOT NULL,
    key_hash   TEXT NOT NULL,
    hint       TEXT NOT NULL,
    status     TEXT NOT NULL,
    game       TEXT,
    at         INTEGER NOT NULL,
    PRIMARY KEY (discord_id, key_hash)
);`;

import { createHash } from "node:crypto";
/** Statuses that settle a key for good: it never needs trying again. */
export const SETTLED = ["redeemed", "owned", "used", "invalid"];
const keyHash = key => createHash("sha256").update(String(key).toUpperCase()).digest("hex");
const hintOf = key => `${String(key).slice(0, 5).toUpperCase()}-•••••-${String(key).slice(-5).toUpperCase()}`;

export const REDEEM_TTL_MS = 24 * 3600_000;
export const MAX_REDEEM_KEYS = 500;
export const STEAM_KEY_GLOBAL = /\b[A-Z0-9]{5}(?:-[A-Z0-9]{5}){2}\b/gi;

/** Every Steam-format key in some text, upper-cased and de-duplicated. */
export const extractKeys = text => [...new Set((String(text ?? "").match(STEAM_KEY_GLOBAL) || []).map(k => k.toUpperCase()))].slice(0, MAX_REDEEM_KEYS);

export function redeemStore({ run, get, all, clean, now }) {
    /** Queues keys for a member, replacing any job of theirs that is still waiting. */
    function createRedeemJob(id, keys) {
        run("UPDATE redeem_jobs SET status = 'replaced', keys = NULL WHERE discord_id = ? AND status = 'pending'", id);
        return Number(run("INSERT INTO redeem_jobs (discord_id, keys, total, created_at) VALUES (?,?,?,?)", id, JSON.stringify(keys), keys.length, now()).lastInsertRowid);
    }
    function pendingRedeemJob(id) {
        const r = clean(get("SELECT id, keys, total, created_at FROM redeem_jobs WHERE discord_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1", id));
        if (!r) return null;
        if (now() - r.created_at > REDEEM_TTL_MS) { run("UPDATE redeem_jobs SET status = 'expired', keys = NULL WHERE id = ?", r.id); return null; }
        return { id: r.id, total: r.total, created_at: r.created_at, keys: JSON.parse(r.keys || "[]") };
    }
    /** Marks a member's pending job done, erases its keys and stores the summary line. Returns false when there is no such job. */
    function finishRedeemJob(id, jobId, summary) {
        return run("UPDATE redeem_jobs SET status = 'done', keys = NULL, finished_at = ?, summary = ? WHERE id = ? AND discord_id = ? AND status = 'pending'", now(), summary, jobId, id).changes > 0;
    }
    const cancelRedeemJob = id => run("UPDATE redeem_jobs SET status = 'cancelled', keys = NULL WHERE discord_id = ? AND status = 'pending'", id).changes > 0;
    const pruneRedeemJobs = () => run("DELETE FROM redeem_jobs WHERE created_at < ?", now() - 60 * 86400_000).changes
        + run("UPDATE redeem_jobs SET status = 'expired', keys = NULL WHERE status = 'pending' AND created_at < ?", now() - REDEEM_TTL_MS).changes;
    /** Remembers how keys ended up (a hash and a masked hint, never the key). Only settled results are kept. */
    function logRedeem(id, results) {
        let n = 0;
        for (const r of results) {
            if (!SETTLED.includes(r.status) || !/^[A-Z0-9]{5}(-[A-Z0-9]{5}){2}$/i.test(String(r.key))) continue;
            run(`INSERT INTO redeem_log (discord_id, key_hash, hint, status, game, at) VALUES (?,?,?,?,?,?)
                 ON CONFLICT(discord_id, key_hash) DO UPDATE SET status = excluded.status, game = COALESCE(NULLIF(excluded.game, ''), redeem_log.game), at = excluded.at`,
                id, keyHash(r.key), hintOf(r.key), r.status, String(r.game ?? "").slice(0, 100), now());
            n++;
        }
        return n;
    }
    /** Which of these keys this member already redeemed or found owned or used. Returns Map(KEY -> { status, game, at }). */
    function knownRedeems(id, keys) {
        const out = new Map();
        for (const k of keys) {
            const r = get("SELECT status, game, at FROM redeem_log WHERE discord_id = ? AND key_hash = ? AND status IN ('redeemed','owned','used')", id, keyHash(k));
            if (r) out.set(String(k).toUpperCase(), clean(r));
        }
        return out;
    }
    const redeemHistory = (id, limit = 100) => all("SELECT hint, status, game, at FROM redeem_log WHERE discord_id = ? ORDER BY at DESC LIMIT ?", id, limit).map(clean);
    const clearRedeemHistory = id => run("DELETE FROM redeem_log WHERE discord_id = ?", id).changes;
    return { logRedeem, knownRedeems, redeemHistory, clearRedeemHistory, createRedeemJob, pendingRedeemJob, finishRedeemJob, cancelRedeemJob, pruneRedeemJobs };
}

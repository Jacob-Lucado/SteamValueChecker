// One link code per member, so the FanaticalGrabber extension can send games to their library in one click.
// Only a SHA-256 hash of the code is stored. The code itself is shown once and can only add games to that member's library.
import { createHash, randomBytes } from "node:crypto";

export const grabberSchema = `
CREATE TABLE IF NOT EXISTS grabber_links (
    discord_id TEXT PRIMARY KEY REFERENCES users(discord_id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    used_at    INTEGER,
    sends      INTEGER NOT NULL DEFAULT 0
);`;

const hash = token => createHash("sha256").update(String(token)).digest("hex");
export const TOKEN_PATTERN = /^svcg_[A-Za-z0-9_-]{43}$/;

export function grabberStore({ run, get, clean, now }) {
    /** Makes a new code (replacing any old one) and returns it. This is the only time it exists in readable form. */
    function createGrabberToken(id) {
        const token = `svcg_${randomBytes(32).toString("base64url")}`;
        run(`INSERT INTO grabber_links (discord_id, token_hash, created_at) VALUES (?,?,?)
             ON CONFLICT(discord_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at, used_at = NULL, sends = 0`,
            id, hash(token), now());
        return token;
    }
    const grabberUserForToken = token => TOKEN_PATTERN.test(String(token ?? "")) ? get("SELECT discord_id FROM grabber_links WHERE token_hash = ?", hash(token))?.discord_id ?? null : null;
    const noteGrabberUse = id => run("UPDATE grabber_links SET used_at = ?, sends = sends + 1 WHERE discord_id = ?", now(), id);
    const getGrabberLink = id => clean(get("SELECT created_at, used_at, sends FROM grabber_links WHERE discord_id = ?", id)) ?? null;
    const revokeGrabberToken = id => run("DELETE FROM grabber_links WHERE discord_id = ?", id).changes > 0;
    return { createGrabberToken, grabberUserForToken, noteGrabberUse, getGrabberLink, revokeGrabberToken };
}

// Gift claims on a public wishlist page: a visitor marks a game as "I'm gifting this" so two friends do not buy the same one.
// The owner never sees who claimed what. A claim stores only a hash of a random code the visitor's browser made up.
import { createHash } from "node:crypto";

export const giftSchema = `
CREATE TABLE IF NOT EXISTS gift_claims (
    discord_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    itad_id    TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    at         INTEGER NOT NULL,
    PRIMARY KEY (discord_id, itad_id)
);`;

export const GIFT_TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
export const MAX_CLAIMS_PER_VISITOR = 10;
export const CLAIM_TTL_MS = 45 * 86400_000;
const hash = t => createHash("sha256").update(String(t)).digest("hex");

export function giftStore({ run, get, all, now }) {
    /** Returns "claimed", "taken" (someone else has it) or "full" (this visitor already holds the maximum). */
    function claimGift(ownerId, itadId, token) {
        const h = hash(token);
        const have = get("SELECT token_hash FROM gift_claims WHERE discord_id = ? AND itad_id = ?", ownerId, itadId);
        if (have) return have.token_hash === h ? "claimed" : "taken";
        if (get("SELECT COUNT(*) AS n FROM gift_claims WHERE discord_id = ? AND token_hash = ?", ownerId, h).n >= MAX_CLAIMS_PER_VISITOR) return "full";
        run("INSERT INTO gift_claims (discord_id, itad_id, token_hash, at) VALUES (?,?,?,?)", ownerId, itadId, h, now());
        return "claimed";
    }
    const unclaimGift = (ownerId, itadId, token) => run("DELETE FROM gift_claims WHERE discord_id = ? AND itad_id = ? AND token_hash = ?", ownerId, itadId, hash(token)).changes > 0;
    /** itad_id -> "mine" | "taken", from the point of view of the visitor holding `token` (or nobody). */
    function giftClaimMap(ownerId, token) {
        const h = token ? hash(token) : null;
        return new Map(all("SELECT itad_id, token_hash FROM gift_claims WHERE discord_id = ?", ownerId).map(r => [r.itad_id, r.token_hash === h ? "mine" : "taken"]));
    }
    const countGiftClaims = ownerId => get("SELECT COUNT(*) AS n FROM gift_claims WHERE discord_id = ?", ownerId).n;
    const clearGiftClaims = ownerId => run("DELETE FROM gift_claims WHERE discord_id = ?", ownerId).changes;
    const pruneGiftClaims = () => run("DELETE FROM gift_claims WHERE at < ?", now() - CLAIM_TTL_MS).changes;
    return { claimGift, unclaimGift, giftClaimMap, countGiftClaims, clearGiftClaims, pruneGiftClaims };
}

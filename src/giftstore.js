// "I'll gift this" marks on a public wishlist page, so two friends do not buy the same game.
// A mark belongs to a signed-in Discord account. The list's owner is never told who, but the bot's owner can see it when a mark is reported.
// Abuse is held back four ways: you must sign in with an account that is not brand new, you can only hold a few marks, marks run out
// by themselves unless you renew them, and an owner can release a mark and report it. Enough reports and the account loses gifting.
export const giftSchema = `
DROP TABLE IF EXISTS gift_claims;
CREATE TABLE IF NOT EXISTS gift_marks (
    discord_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    itad_id    TEXT NOT NULL,
    claimer_id TEXT NOT NULL,
    claimer_name TEXT NOT NULL DEFAULT '',
    at         INTEGER NOT NULL,
    PRIMARY KEY (discord_id, itad_id)
);
CREATE INDEX IF NOT EXISTS gift_marks_by_claimer ON gift_marks (claimer_id);
CREATE TABLE IF NOT EXISTS gift_owner (
    discord_id TEXT PRIMARY KEY REFERENCES users(discord_id) ON DELETE CASCADE,
    paused     INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS gift_reports (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id   TEXT NOT NULL,
    slug       TEXT NOT NULL DEFAULT '',
    itad_id    TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT '',
    claimer_id TEXT NOT NULL,
    claimer_name TEXT NOT NULL DEFAULT '',
    at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS gift_reports_by_claimer ON gift_reports (claimer_id);
CREATE TABLE IF NOT EXISTS gift_bans (
    claimer_id TEXT PRIMARY KEY,
    reason     TEXT NOT NULL DEFAULT '',
    auto       INTEGER NOT NULL DEFAULT 0,
    at         INTEGER NOT NULL
);`;

export const MAX_CLAIMS_PER_LIST = 5;     // marks one person can hold on a single list
export const MAX_CLAIMS_TOTAL = 15;       // marks one person can hold anywhere
export const CLAIM_TTL_MS = 21 * 86400_000; // a mark runs out unless it is renewed
export const MIN_ACCOUNT_AGE_MS = 7 * 86400_000;
export const STRIKES_TO_BAN = 3;          // reports inside STRIKE_WINDOW_MS that switch gifting off for an account
export const STRIKE_WINDOW_MS = 60 * 86400_000;

const DISCORD_EPOCH = 1420070400000n;
/** When a Discord account was made, read from its id. null when the id is not a real snowflake. */
export function accountCreatedAt(id) {
    if (!/^\d{15,22}$/.test(String(id))) return null;
    return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
}
export const accountOldEnough = (id, nowMs) => { const t = accountCreatedAt(id); return t === null || nowMs - t >= MIN_ACCOUNT_AGE_MS; };

export function giftStore({ run, get, all, now }) {
    const strikes = claimerId => get("SELECT COUNT(*) AS n FROM gift_reports WHERE claimer_id = ? AND at > ?", String(claimerId), now() - STRIKE_WINDOW_MS).n;
    const isGiftBanned = claimerId => Boolean(get("SELECT 1 AS x FROM gift_bans WHERE claimer_id = ?", String(claimerId)));
    /** Returns "claimed", "taken" (someone else has it), "full" (this list's limit) or "limit" (the overall limit). Claiming again renews. */
    function claimGift(ownerId, itadId, claimerId, claimerName = "") {
        const c = String(claimerId);
        const have = get("SELECT claimer_id FROM gift_marks WHERE discord_id = ? AND itad_id = ?", ownerId, itadId);
        if (have) {
            if (have.claimer_id !== c) return "taken";
            run("UPDATE gift_marks SET at = ? WHERE discord_id = ? AND itad_id = ?", now(), ownerId, itadId);
            return "claimed";
        }
        if (get("SELECT COUNT(*) AS n FROM gift_marks WHERE discord_id = ? AND claimer_id = ?", ownerId, c).n >= MAX_CLAIMS_PER_LIST) return "full";
        if (get("SELECT COUNT(*) AS n FROM gift_marks WHERE claimer_id = ?", c).n >= MAX_CLAIMS_TOTAL) return "limit";
        run("INSERT INTO gift_marks (discord_id, itad_id, claimer_id, claimer_name, at) VALUES (?,?,?,?,?)", ownerId, itadId, c, String(claimerName).slice(0, 60), now());
        return "claimed";
    }
    const unclaimGift = (ownerId, itadId, claimerId) => run("DELETE FROM gift_marks WHERE discord_id = ? AND itad_id = ? AND claimer_id = ?", ownerId, itadId, String(claimerId)).changes > 0;
    /** itad_id -> "mine" | "taken", from the point of view of the signed-in visitor (or nobody). */
    function giftClaimMap(ownerId, viewerId) {
        const v = viewerId ? String(viewerId) : null;
        return new Map(all("SELECT itad_id, claimer_id FROM gift_marks WHERE discord_id = ?", ownerId).map(r => [r.itad_id, r.claimer_id === v ? "mine" : "taken"]));
    }
    /** The list owner lets go of a mark. With `report`, the claimer gets a strike and loses gifting after STRIKES_TO_BAN of them. */
    function releaseGift(ownerId, itadId, { report = false, slug = "", title = "" } = {}) {
        const m = get("SELECT claimer_id, claimer_name FROM gift_marks WHERE discord_id = ? AND itad_id = ?", ownerId, itadId);
        if (!m) return { released: false, banned: false };
        run("DELETE FROM gift_marks WHERE discord_id = ? AND itad_id = ?", ownerId, itadId);
        let banned = false;
        if (report) {
            run("INSERT INTO gift_reports (owner_id, slug, itad_id, title, claimer_id, claimer_name, at) VALUES (?,?,?,?,?,?,?)", ownerId, String(slug), itadId, String(title).slice(0, 120), m.claimer_id, m.claimer_name, now());
            if (strikes(m.claimer_id) >= STRIKES_TO_BAN && !isGiftBanned(m.claimer_id)) {
                run("INSERT INTO gift_bans (claimer_id, reason, auto, at) VALUES (?,?,1,?)", m.claimer_id, `${STRIKES_TO_BAN} reports from list owners`, now());
                run("DELETE FROM gift_marks WHERE claimer_id = ?", m.claimer_id);
                banned = true;
            }
        }
        return { released: true, banned };
    }
    const countGiftClaims = ownerId => get("SELECT COUNT(*) AS n FROM gift_marks WHERE discord_id = ?", ownerId).n;
    const clearGiftClaims = ownerId => run("DELETE FROM gift_marks WHERE discord_id = ?", ownerId).changes;
    const pruneGiftClaims = () => run("DELETE FROM gift_marks WHERE at < ?", now() - CLAIM_TTL_MS).changes;
    const giftsPaused = ownerId => Boolean(get("SELECT paused FROM gift_owner WHERE discord_id = ?", ownerId)?.paused);
    const setGiftsPaused = (ownerId, on) => run("INSERT INTO gift_owner (discord_id, paused) VALUES (?,?) ON CONFLICT(discord_id) DO UPDATE SET paused = excluded.paused", ownerId, on ? 1 : 0);
    // what the bot's owner sees
    const listGiftReports = () => all(`SELECT claimer_id, MAX(claimer_name) AS name, COUNT(*) AS reports, MAX(at) AS last_at, GROUP_CONCAT(DISTINCT slug) AS lists, GROUP_CONCAT(DISTINCT title) AS games FROM gift_reports GROUP BY claimer_id ORDER BY last_at DESC LIMIT 100`)
        .map(r => ({ ...r, strikes: strikes(r.claimer_id), banned: isGiftBanned(r.claimer_id), holding: get("SELECT COUNT(*) AS n FROM gift_marks WHERE claimer_id = ?", r.claimer_id).n }));
    const listGiftBans = () => all("SELECT claimer_id, reason, auto, at FROM gift_bans ORDER BY at DESC LIMIT 100");
    const banGift = (claimerId, reason = "", auto = false) => { run("INSERT OR REPLACE INTO gift_bans (claimer_id, reason, auto, at) VALUES (?,?,?,?)", String(claimerId), String(reason).slice(0, 200), auto ? 1 : 0, now()); run("DELETE FROM gift_marks WHERE claimer_id = ?", String(claimerId)); };
    const unbanGift = claimerId => { run("DELETE FROM gift_bans WHERE claimer_id = ?", String(claimerId)); run("DELETE FROM gift_reports WHERE claimer_id = ?", String(claimerId)); };
    const dismissGiftReports = claimerId => run("DELETE FROM gift_reports WHERE claimer_id = ?", String(claimerId)).changes;
    return { claimGift, unclaimGift, giftClaimMap, releaseGift, countGiftClaims, clearGiftClaims, pruneGiftClaims, giftsPaused, setGiftsPaused, isGiftBanned, listGiftReports, listGiftBans, banGift, unbanGift, dismissGiftReports };
}

// Buy pacts: friends agree on a price for a game, join with a button, and everyone is pinged together the moment it hits that price.

export const pactSchema = `
CREATE TABLE IF NOT EXISTS pacts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id     TEXT NOT NULL,
    channel_id   TEXT NOT NULL,
    message_id   TEXT,
    creator_id   TEXT NOT NULL,
    itad_id      TEXT NOT NULL,
    title        TEXT NOT NULL,
    target       REAL NOT NULL,
    currency     TEXT NOT NULL,
    country      TEXT NOT NULL DEFAULT 'US',
    min_players  INTEGER NOT NULL DEFAULT 2,
    status       TEXT NOT NULL DEFAULT 'open',
    nudged       INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    done_at      INTEGER,
    done_price   REAL,
    done_shop    TEXT
);
CREATE INDEX IF NOT EXISTS pacts_guild ON pacts(guild_id, status);
CREATE TABLE IF NOT EXISTS pact_members (
    pact_id   INTEGER NOT NULL,
    user_id   TEXT NOT NULL,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (pact_id, user_id)
);`;

export function pactStore({ run, get, all, clean, now }) {
    const getPact = id => clean(get("SELECT * FROM pacts WHERE id = ?", id)) ?? null;
    const pactMembers = id => all("SELECT user_id FROM pact_members WHERE pact_id = ? ORDER BY joined_at, rowid", id).map(r => r.user_id);
    const createPact = p => {
        const r = run("INSERT INTO pacts (guild_id, channel_id, creator_id, itad_id, title, target, currency, country, min_players, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            p.guild_id, p.channel_id, p.creator_id, p.itad_id, p.title, p.target, p.currency, p.country ?? "US", p.min_players ?? 2, now(), p.expires_at);
        run("INSERT INTO pact_members (pact_id, user_id, joined_at) VALUES (?,?,?)", r.lastInsertRowid, p.creator_id, now());
        return getPact(Number(r.lastInsertRowid));
    };
    const setPactMessage = (id, messageId) => run("UPDATE pacts SET message_id = ? WHERE id = ?", messageId, id);
    function joinPact(id, userId) {
        const p = getPact(id);
        if (!p || p.status !== "open") return "closed";
        if (pactMembers(id).includes(userId)) return "already";
        run("INSERT INTO pact_members (pact_id, user_id, joined_at) VALUES (?,?,?)", id, userId, now());
        return "joined";
    }
    const leavePact = (id, userId) => run("DELETE FROM pact_members WHERE pact_id = ? AND user_id = ?", id, userId).changes > 0;
    /** Moves an open pact to done, cancelled or expired. Returns false when it was not open any more. */
    const closePact = (id, status, patch = {}) => run("UPDATE pacts SET status = ?, done_at = ?, done_price = ?, done_shop = ? WHERE id = ? AND status = 'open'", status, status === "done" ? now() : null, patch.price ?? null, patch.shop ?? null, id).changes > 0;
    const markPactNudged = id => run("UPDATE pacts SET nudged = 1 WHERE id = ?", id);
    const openPacts = () => all("SELECT * FROM pacts WHERE status = 'open' ORDER BY id").map(clean);
    const listPactsGuild = (guildId, status = "open") => all("SELECT * FROM pacts WHERE guild_id = ? AND status = ? ORDER BY id DESC LIMIT 25", guildId, status).map(clean);
    const countOpenPactsBy = (guildId, userId) => get("SELECT COUNT(*) AS n FROM pacts WHERE guild_id = ? AND creator_id = ? AND status = 'open'", guildId, userId).n;
    const pactsForUser = userId => all("SELECT p.id, p.guild_id, p.title, p.target, p.currency, p.status, p.done_price, p.done_shop FROM pacts p JOIN pact_members m ON m.pact_id = p.id WHERE m.user_id = ? ORDER BY p.id DESC LIMIT 100", userId).map(clean);
    /** Data deletion: leave every pact, and cancel the open ones this person started. */
    function forgetPactUser(userId) {
        run("DELETE FROM pact_members WHERE user_id = ?", userId);
        run("UPDATE pacts SET status = 'cancelled' WHERE creator_id = ? AND status = 'open'", userId);
    }
    return { getPact, pactMembers, createPact, setPactMessage, joinPact, leavePact, closePact, markPactNudged, openPacts, listPactsGuild, countOpenPactsBy, pactsForUser, forgetPactUser };
}

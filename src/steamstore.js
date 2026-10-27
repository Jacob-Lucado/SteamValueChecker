// A member's linked Steam profile, and the owned games (with playtime) synced from it into their library.
// Only the public SteamID64 and per-game minutes are stored. Nothing here can read a private profile.

export const steamSchema = `
CREATE TABLE IF NOT EXISTS steam_links (
    discord_id TEXT PRIMARY KEY REFERENCES users(discord_id) ON DELETE CASCADE,
    steamid    TEXT NOT NULL,
    linked_at  INTEGER NOT NULL,
    synced_at  INTEGER,
    games      INTEGER NOT NULL DEFAULT 0,
    minutes    INTEGER NOT NULL DEFAULT 0
);`;

export function steamStore({ db, run, get, all, clean, now, maxLibrary }) {
    const getSteamLink = id => clean(get("SELECT * FROM steam_links WHERE discord_id = ?", id)) ?? null;
    const setSteamLink = (id, steamid) => run(
        `INSERT INTO steam_links (discord_id, steamid, linked_at) VALUES (?,?,?)
         ON CONFLICT(discord_id) DO UPDATE SET steamid = excluded.steamid, linked_at = CASE WHEN steam_links.steamid = excluded.steamid THEN steam_links.linked_at ELSE excluded.linked_at END`,
        id, steamid, now());
    const markSteamSynced = (id, { games, minutes }) => run("UPDATE steam_links SET synced_at = ?, games = ?, minutes = ? WHERE discord_id = ?", now(), games, minutes, id);
    const removeSteamLink = id => run("DELETE FROM steam_links WHERE discord_id = ?", id).changes > 0;
    const steamLinkedUsers = () => all("SELECT discord_id FROM steam_links").map(r => r.discord_id);

    /**
     * Adds or refreshes owned games. What the member paid is never touched. New games start as "backlog", or "playing"
     * if they have an hour or more on record; games already in the library keep the status the member chose.
     * Returns { added, updated, skippedForLimit }.
     */
    function syncSteamGames(discordId, games) {
        let added = 0, updated = 0, skippedForLimit = 0;
        let n = get("SELECT COUNT(*) AS n FROM library WHERE discord_id = ?", discordId).n;
        db.exec("BEGIN");
        try {
            for (const g of games) {
                const have = get("SELECT id FROM library WHERE discord_id = ? AND itad_id = ?", discordId, g.itad_id);
                const played = g.lastPlayed ? g.lastPlayed * 1000 : null;
                if (have) {
                    run("UPDATE library SET appid = ?, minutes = ?, last_played = ? WHERE id = ?", g.appid ?? null, g.minutes ?? 0, played, have.id);
                    updated++;
                } else if (n >= maxLibrary) {
                    skippedForLimit++;
                } else {
                    run("INSERT INTO library (discord_id, itad_id, title, paid, added_at, status, appid, minutes, last_played) VALUES (?,?,?,?,?,?,?,?,?)",
                        discordId, g.itad_id, g.title, null, now(), (g.minutes ?? 0) >= 60 ? "playing" : "backlog", g.appid ?? null, g.minutes ?? 0, played);
                    n++; added++;
                }
            }
            db.exec("COMMIT");
        } catch (err) { db.exec("ROLLBACK"); throw err; }
        return { added, updated, skippedForLimit };
    }

    return { getSteamLink, setSteamLink, markSteamSynced, removeSteamLink, steamLinkedUsers, syncSteamGames };
}

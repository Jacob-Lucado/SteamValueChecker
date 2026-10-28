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
);
CREATE TABLE IF NOT EXISTS playtime_log (
    discord_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    day        TEXT NOT NULL,
    itad_id    TEXT NOT NULL,
    title      TEXT NOT NULL,
    minutes    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS playtime_log_user ON playtime_log(discord_id, day);`;

/** Rows of { day, title, minutes } for one calendar year into a recap: totals, hours per month, top games. */
export function recapSummary(rows, year) {
    const months = Array(12).fill(0), per = new Map(), days = new Set();
    let total = 0;
    for (const r of rows) {
        if (!String(r.day).startsWith(String(year))) continue;
        const m = Number(String(r.day).slice(5, 7)) - 1;
        if (!(m >= 0 && m < 12)) continue;
        months[m] += r.minutes; total += r.minutes; days.add(r.day);
        const g = per.get(r.title) ?? { title: r.title, minutes: 0 };
        g.minutes += r.minutes; per.set(r.title, g);
    }
    const top = [...per.values()].sort((a, b) => b.minutes - a.minutes || a.title.localeCompare(b.title)).slice(0, 5);
    const best = total ? months.indexOf(Math.max(...months)) : null;
    return { year, totalMinutes: total, months, top, games: per.size, activeDays: days.size, busiestMonth: best };
}

/** A new Steam game starts as backlog (barely touched), played (an hour or more), or playing (an hour or more, in the last two weeks). */
const startStatus = (g, lastPlayedMs, nowMs) => ((g.minutes ?? 0) < 60 ? "backlog" : lastPlayedMs && nowMs - lastPlayedMs < 14 * 86400_000 ? "playing" : "played");

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
                    // Growth since the last sync is the playtime for that period: that is what the recap adds up.
                    const before = get("SELECT minutes FROM library WHERE id = ?", have.id)?.minutes ?? 0;
                    const gained = Math.max(0, (g.minutes ?? 0) - before);
                    if (gained > 0 && before > 0) run("INSERT INTO playtime_log (discord_id, day, itad_id, title, minutes) VALUES (?,?,?,?,?)", discordId, new Date(now()).toISOString().slice(0, 10), g.itad_id, g.title, gained);
                    run("UPDATE library SET appid = ?, minutes = ?, last_played = ? WHERE id = ?", g.appid ?? null, g.minutes ?? 0, played, have.id);
                    updated++;
                } else if (n >= maxLibrary) {
                    skippedForLimit++;
                } else {
                    run("INSERT INTO library (discord_id, itad_id, title, paid, added_at, status, appid, minutes, last_played) VALUES (?,?,?,?,?,?,?,?,?)",
                        discordId, g.itad_id, g.title, null, now(), startStatus(g, played, now()), g.appid ?? null, g.minutes ?? 0, played);
                    n++; added++;
                }
            }
            db.exec("COMMIT");
        } catch (err) { db.exec("ROLLBACK"); throw err; }
        return { added, updated, skippedForLimit };
    }

    /**
     * Saves achievement progress for one game. If the game just reached 100% and the member has not already marked it
     * finished or dropped, it becomes "finished". It only does that on the change to 100%, so a status you pick later sticks.
     * Returns { newlyFinished }.
     */
    function setAchievements(discordId, itadId, { done, total }) {
        const row = get("SELECT status, ach_done, ach_total FROM library WHERE discord_id = ? AND itad_id = ?", discordId, itadId);
        if (!row) return { newlyFinished: false };
        const wasComplete = row.ach_total > 0 && row.ach_done === row.ach_total;
        const complete = total > 0 && done === total;
        const finish = complete && !wasComplete && !["finished", "dropped"].includes(row.status);
        run("UPDATE library SET ach_done = ?, ach_total = ?, ach_checked = ?, status = ?, status_at = CASE WHEN ? THEN ? ELSE status_at END WHERE discord_id = ? AND itad_id = ?", done, total, now(), finish ? "finished" : row.status, finish ? 1 : 0, now(), discordId, itadId);
        return { newlyFinished: finish };
    }

    const playtimeLog = id => all("SELECT day, itad_id, title, minutes FROM playtime_log WHERE discord_id = ? ORDER BY day", id);
    const playRecap = (id, year) => recapSummary(playtimeLog(id), year);
    const prunePlaytime = () => run("DELETE FROM playtime_log WHERE day < ?", new Date(now() - 3 * 366 * 86400_000).toISOString().slice(0, 10)).changes;

    return { playtimeLog, playRecap, prunePlaytime, getSteamLink, setSteamLink, markSteamSynced, removeSteamLink, steamLinkedUsers, syncSteamGames, setAchievements };
}

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
CREATE TABLE IF NOT EXISTS ach_rare (
    discord_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    appid      INTEGER NOT NULL,
    apiname    TEXT NOT NULL,
    game       TEXT NOT NULL,
    name       TEXT NOT NULL,
    icon       TEXT,
    pct        REAL NOT NULL,
    PRIMARY KEY (discord_id, appid, apiname)
);
CREATE TABLE IF NOT EXISTS ach_recent (
    discord_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    appid      INTEGER NOT NULL,
    apiname    TEXT NOT NULL,
    name       TEXT NOT NULL,
    icon       TEXT,
    at         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (discord_id, appid, apiname)
);
CREATE TABLE IF NOT EXISTS playtime_log (
    discord_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    day        TEXT NOT NULL,
    itad_id    TEXT NOT NULL,
    title      TEXT NOT NULL,
    minutes    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS app_tags (
    appid      INTEGER PRIMARY KEY,
    genres     TEXT NOT NULL DEFAULT '',
    cats       TEXT NOT NULL DEFAULT '',
    fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS app_dlc (
    appid      INTEGER PRIMARY KEY,
    dlc        TEXT NOT NULL DEFAULT '',
    fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hour_goals (
    discord_id TEXT PRIMARY KEY REFERENCES users(discord_id) ON DELETE CASCADE,
    year       INTEGER NOT NULL,
    hours      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS playtime_log_user ON playtime_log(discord_id, day);`;

/** Progress toward a yearly hours goal: hours done, percent, where this pace ends up by Dec 31, and hours a week still needed. */
export function goalProgress(goalHours, totalMinutes, nowMs = Date.now()) {
    const d = new Date(nowMs), start = Date.UTC(d.getUTCFullYear(), 0, 1), end = Date.UTC(d.getUTCFullYear() + 1, 0, 1);
    const dayOfYear = Math.max(1, Math.floor((nowMs - start) / 86400_000) + 1), daysLeft = Math.max(0, Math.ceil((end - nowMs) / 86400_000));
    const done = totalMinutes / 60;
    return { goal: goalHours, done: Math.round(done * 10) / 10, pct: Math.min(100, Math.round(done / goalHours * 100)), reached: done >= goalHours,
        projected: Math.round(done / dayOfYear * (dayOfYear + daysLeft)), perWeek: done >= goalHours || !daysLeft ? 0 : Math.round((goalHours - done) / (daysLeft / 7) * 10) / 10, daysLeft };
}

/** Rows of { day, title, minutes } for one calendar year into a recap: totals, hours per month, top games. */
export function recapSummary(rows, year) {
    const months = Array(12).fill(0), per = new Map(), days = new Set();
    let total = 0;
    for (const r of rows) {
        if (year !== null && !String(r.day).startsWith(String(year))) continue;
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
    /** The two-letter country on the member's Steam profile, read during a sync. Used to warn about cross-region gifts. */
    const setSteamCountry = (id, cc) => run("UPDATE steam_links SET country = ? WHERE discord_id = ?", /^[A-Z]{2}$/.test(String(cc)) ? String(cc) : null, id);
    const getSteamLink = id => clean(get("SELECT * FROM steam_links WHERE discord_id = ?", id)) ?? null;
    // `verified` means the owner signed in through Steam. A pasted profile stays unverified and can never be used to sign in.
    const setSteamLink = (id, steamid, { verified = false } = {}) => run(
        `INSERT INTO steam_links (discord_id, steamid, linked_at, verified) VALUES (?,?,?,?)
         ON CONFLICT(discord_id) DO UPDATE SET
           verified = CASE WHEN steam_links.steamid = excluded.steamid THEN MAX(steam_links.verified, excluded.verified) ELSE excluded.verified END,
           steamid = excluded.steamid, linked_at = CASE WHEN steam_links.steamid = excluded.steamid THEN steam_links.linked_at ELSE excluded.linked_at END`,
        id, steamid, now(), verified ? 1 : 0);
    /** Who proved they own this Steam account (newest first). Only verified links count, so a pasted ID cannot take over a login. */
    const findVerifiedSteamUser = steamid => clean(get("SELECT discord_id, uname, avatar FROM steam_links WHERE steamid = ? AND verified = 1 ORDER BY linked_at DESC LIMIT 1", steamid)) ?? null;
    const setSteamWho = (id, uname, avatar) => run("UPDATE steam_links SET uname = ?, avatar = ? WHERE discord_id = ?", uname ?? null, avatar ?? null, id);
    const markSteamSynced = (id, { games, minutes }) => run("UPDATE steam_links SET synced_at = ?, games = ?, minutes = ? WHERE discord_id = ?", now(), games, minutes, id);
    const removeSteamLink = id => run("DELETE FROM steam_links WHERE discord_id = ?", id).changes > 0;
    const steamLinkedUsers = () => all("SELECT discord_id FROM steam_links").map(r => r.discord_id);

    /**
     * Adds or refreshes owned games. What the member paid is never touched. New games start as "backlog", or "playing"
     * if they have an hour or more on record; games already in the library keep the status the member chose.
     * Returns { added, updated, skippedForLimit }.
     */
    function syncSteamGames(discordId, games, { track } = {}) {
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
                    if ((track === undefined ? before > 0 : track) && gained > 0) run("INSERT INTO playtime_log (discord_id, day, itad_id, title, minutes) VALUES (?,?,?,?,?)", discordId, new Date(now()).toISOString().slice(0, 10), g.itad_id, g.title, gained);
                    run("UPDATE library SET appid = ?, minutes = ?, last_played = ?, min_2w = ? WHERE id = ?", g.appid ?? null, g.minutes ?? 0, played, g.recent ?? 0, have.id);
                    updated++;
                } else if (n >= maxLibrary) {
                    skippedForLimit++;
                } else {
                    run("INSERT INTO library (discord_id, itad_id, title, paid, added_at, status, appid, minutes, last_played, min_2w) VALUES (?,?,?,?,?,?,?,?,?,?)",
                        discordId, g.itad_id, g.title, null, now(), startStatus(g, played, now()), g.appid ?? null, g.minutes ?? 0, played, g.recent ?? 0);
                    // Only after the first sync (the first one just imports what was already played), a new game that shows up already played counts too.
                    if (track === true && (g.minutes ?? 0) > 0) run("INSERT INTO playtime_log (discord_id, day, itad_id, title, minutes) VALUES (?,?,?,?,?)", discordId, new Date(now()).toISOString().slice(0, 10), g.itad_id, g.title, g.minutes);
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

    /** Replaces one game's rare unlocks (achievements under 10% of players). */
    function setRareAchievements(discordId, appid, game, list) {
        run("DELETE FROM ach_rare WHERE discord_id = ? AND appid = ?", discordId, appid);
        for (const a of list.slice(0, 40)) run("INSERT OR REPLACE INTO ach_rare (discord_id, appid, apiname, game, name, icon, pct) VALUES (?,?,?,?,?,?,?)", discordId, appid, String(a.apiname).slice(0, 120), String(game).slice(0, 120), String(a.name).slice(0, 160), a.icon ?? null, Number(a.pct));
    }
    function setRecentUnlocks(discordId, appid, list) {
        run("DELETE FROM ach_recent WHERE discord_id = ? AND appid = ?", discordId, appid);
        for (const a of list.slice(0, 5)) run("INSERT OR REPLACE INTO ach_recent (discord_id, appid, apiname, name, icon, at) VALUES (?,?,?,?,?,?)", discordId, appid, String(a.apiname).slice(0, 120), String(a.name).slice(0, 160), a.icon ?? null, Number(a.at) || 0);
    }
    /** Games played in the last two weeks, newest first, with their achievement progress and latest unlocks. */
    function recentActivity(discordId, limit = 3) {
        const since = now() - 14 * 86400_000;
        const games = all("SELECT appid, title, minutes, min_2w, last_played, ach_done, ach_total FROM library WHERE discord_id = ? AND appid IS NOT NULL AND last_played > ? ORDER BY last_played DESC LIMIT ?", discordId, since, limit).map(clean);
        const total2w = get("SELECT COALESCE(SUM(min_2w),0) AS m FROM library WHERE discord_id = ?", discordId)?.m ?? 0;
        return { minutes2w: total2w, games: games.map(g => ({ ...g, unlocks: all("SELECT name, icon FROM ach_recent WHERE discord_id = ? AND appid = ? ORDER BY at DESC", discordId, g.appid).map(clean) })) };
    }
    /** What the profile shows: every unlock counted, how many are rare, and the rarest few. */
    function achievementShowcase(discordId, limit = 14) {
        const t = get("SELECT COALESCE(SUM(ach_done),0) AS done, COUNT(CASE WHEN ach_total > 0 THEN 1 END) AS games FROM library WHERE discord_id = ?", discordId);
        const rare = get("SELECT COUNT(*) AS n FROM ach_rare WHERE discord_id = ?", discordId)?.n ?? 0;
        const top = all("SELECT appid, game, name, icon, pct FROM ach_rare WHERE discord_id = ? ORDER BY pct ASC, game ASC, name ASC LIMIT ?", discordId, limit).map(clean);
        return { done: t?.done ?? 0, games: t?.games ?? 0, rare, top };
    }

    const playtimeLog = id => all("SELECT day, itad_id, title, minutes FROM playtime_log WHERE discord_id = ? ORDER BY day", id);
    const playRecap = (id, year) => recapSummary(playtimeLog(id), year);
    /** Everything tracked since the profile was linked, across all years (the per-month split is not meaningful here). */
    const playRecapAll = id => recapSummary(playtimeLog(id), null);
    /** The member's hours goal for this year (a goal from an earlier year is ignored), or null. */
    const getHourGoal = id => { const r = get("SELECT year, hours FROM hour_goals WHERE discord_id = ?", id); return r && r.year === new Date(now()).getUTCFullYear() ? r.hours : null; };
    const setHourGoal = (id, hours) => hours ? run("INSERT INTO hour_goals (discord_id, year, hours) VALUES (?,?,?) ON CONFLICT(discord_id) DO UPDATE SET year = excluded.year, hours = excluded.hours", id, new Date(now()).getUTCFullYear(), hours) : run("DELETE FROM hour_goals WHERE discord_id = ?", id);
    const prunePlaytime = () => run("DELETE FROM playtime_log WHERE day < ?", new Date(now() - 3 * 366 * 86400_000).toISOString().slice(0, 10)).changes;

    // Genres and categories from Steam's public store data, shared by everyone (nothing about a member is stored here).
    const saveAppTags = (appid, genres, cats) => run("INSERT INTO app_tags (appid, genres, cats, fetched_at) VALUES (?,?,?,?) ON CONFLICT(appid) DO UPDATE SET genres = excluded.genres, cats = excluded.cats, fetched_at = excluded.fetched_at", appid, genres.join("|"), cats.join("|"), now());
    const getAppTags = appids => {
        const out = new Map();
        for (const id of appids) { const r = get("SELECT genres, cats FROM app_tags WHERE appid = ?", id); if (r) out.set(id, { genres: r.genres ? r.genres.split("|") : [], cats: r.cats ? r.cats.split("|") : [] }); }
        return out;
    };
    /** Apps of this member (library by hours played, then wishlist) with no tags fetched in the last 30 days. */
    const appsNeedingTags = (id, limit = 25) => all(
        `SELECT appid FROM (SELECT appid, minutes AS w FROM library WHERE discord_id = ? AND appid IS NOT NULL
                            UNION ALL SELECT appid, -1 AS w FROM items WHERE discord_id = ? AND appid IS NOT NULL)
         WHERE appid NOT IN (SELECT appid FROM app_tags WHERE fetched_at > ?) GROUP BY appid ORDER BY MAX(w) DESC LIMIT ?`, id, id, now() - 30 * 86400_000, limit).map(r => r.appid);
    const allAppsNeedingTags = (limit = 40) => all(
        `SELECT appid FROM (SELECT appid FROM library WHERE appid IS NOT NULL UNION SELECT appid FROM items WHERE appid IS NOT NULL)
         WHERE appid NOT IN (SELECT appid FROM app_tags WHERE fetched_at > ?) LIMIT ?`, now() - 30 * 86400_000, limit).map(r => r.appid);

    // ---- DLC lists, so a sale on an add-on for a game someone plays can be told to them ----
    const DLC_MIN_MINUTES = 120; // a game they tried for two hours or more
    const saveAppDlc = (appid, ids) => run("INSERT INTO app_dlc (appid, dlc, fetched_at) VALUES (?,?,?) ON CONFLICT(appid) DO UPDATE SET dlc = excluded.dlc, fetched_at = excluded.fetched_at", appid, [...new Set(ids)].slice(0, 400).join(","), now());
    /** Played games (any member who turned DLC alerts on) whose DLC list is missing or older than two weeks, most played first. */
    const appsNeedingDlc = (limit = 30) => all(
        `SELECT l.appid, MAX(l.minutes) AS minutes FROM library l JOIN users u ON u.discord_id = l.discord_id
          WHERE u.dlc = 1 AND u.paused = 0 AND l.appid IS NOT NULL AND l.minutes >= ?
            AND l.appid NOT IN (SELECT appid FROM app_dlc WHERE fetched_at > ?)
          GROUP BY l.appid ORDER BY minutes DESC LIMIT ?`, DLC_MIN_MINUTES, now() - 14 * 86400_000, limit).map(r => r.appid);
    /** One member's played games that have add-ons: [{ appid, title, dlc: [appid, ...] }]. */
    const ownedWithDlc = userId => all(
        `SELECT l.appid, l.title, d.dlc FROM library l JOIN app_dlc d ON d.appid = l.appid
          WHERE l.discord_id = ? AND l.minutes >= ? AND d.dlc != '' ORDER BY l.minutes DESC LIMIT 150`, userId, DLC_MIN_MINUTES)
        .map(r => ({ appid: r.appid, title: r.title, dlc: String(r.dlc).split(",").map(Number).filter(Number.isInteger) }));
    const dlcUsers = () => all("SELECT * FROM users WHERE dlc = 1 AND paused = 0").map(clean);
    const refundUsers = () => all("SELECT * FROM users WHERE refund = 1 AND paused = 0").map(clean);
    /** Steam games added to a library after the first import, under two hours played, not gifted, newer than `since`. */
    const refundCandidates = (userId, since) => {
        const link = get("SELECT linked_at FROM steam_links WHERE discord_id = ?", userId);
        if (!link) return [];
        return all("SELECT itad_id, title, appid, minutes, added_at, paid FROM library WHERE discord_id = ? AND appid IS NOT NULL AND minutes < 120 AND COALESCE(gifted,0) = 0 AND added_at >= ? AND added_at > ?", userId, since, link.linked_at + 6 * 3600_000).map(clean);
    };
    const paidGameCount = userId => get("SELECT COUNT(*) AS n FROM library WHERE discord_id = ? AND paid > 0 AND COALESCE(gifted,0) = 0", userId).n;
    const milestoneUsers = () => all("SELECT * FROM users WHERE milestones = 1 AND paused = 0").map(clean);
    const playedGames = (userId, minMinutes) => all("SELECT itad_id, title, appid, minutes FROM library WHERE discord_id = ? AND minutes >= ?", userId, minMinutes).map(clean);
    const yearlyUsers = () => all("SELECT * FROM users WHERE yearly = 1 AND paused = 0").map(clean);
    const nudgeUsers = () => all("SELECT * FROM users WHERE nudge = 1 AND paused = 0").map(clean);
    const achvUsers = () => all("SELECT * FROM users WHERE achv = 1 AND paused = 0").map(clean);
    /** Games with synced achievement counts that are partly done. */
    const achievementGames = userId => all("SELECT itad_id, title, appid, minutes, ach_done, ach_total FROM library WHERE discord_id = ? AND ach_total > 0 AND ach_done < ach_total", userId).map(clean);
    return { setRecentUnlocks, recentActivity, setRareAchievements, achievementShowcase, setSteamCountry, paidGameCount, achvUsers, achievementGames, nudgeUsers, yearlyUsers, milestoneUsers, playedGames, refundUsers, refundCandidates, saveAppDlc, appsNeedingDlc, ownedWithDlc, dlcUsers, saveAppTags, getAppTags, appsNeedingTags, allAppsNeedingTags, playtimeLog, playRecap, playRecapAll, getHourGoal, setHourGoal, prunePlaytime, getSteamLink, setSteamLink, findVerifiedSteamUser, setSteamWho, markSteamSynced, removeSteamLink, steamLinkedUsers, syncSteamGames, setAchievements };
}

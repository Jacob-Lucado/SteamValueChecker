// The indie showcase: games that small studios submit so people can find them. Every game starts as "pending" and only shows
// up publicly once the owner has looked at it. The picture, name and blurb come from the game's own Steam page when it is
// submitted, so nobody can pass off someone else's game with their own text on top of it.
export const indieSchema = `
CREATE TABLE IF NOT EXISTS indie_games (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    appid     INTEGER NOT NULL UNIQUE,
    owner_id  TEXT NOT NULL,
    title     TEXT NOT NULL,
    studio    TEXT,
    blurb     TEXT,
    pitch     TEXT,
    genres    TEXT,
    image     TEXT,
    price     TEXT,
    release   TEXT,
    links     TEXT,
    status    TEXT NOT NULL DEFAULT 'pending',
    note      TEXT,
    featured  INTEGER NOT NULL DEFAULT 0,
    likes     INTEGER NOT NULL DEFAULT 0,
    clicks    INTEGER NOT NULL DEFAULT 0,
    views     INTEGER NOT NULL DEFAULT 0,
    created   INTEGER NOT NULL,
    decided   INTEGER,
    synced    INTEGER,
    verified  INTEGER NOT NULL DEFAULT 0,
    verify_code TEXT,
    keys_open INTEGER NOT NULL DEFAULT 0,
    spotlit   INTEGER
);
CREATE INDEX IF NOT EXISTS indie_games_status ON indie_games (status, created);
CREATE INDEX IF NOT EXISTS indie_games_owner ON indie_games (owner_id);
CREATE TABLE IF NOT EXISTS indie_follows (
    user_id TEXT NOT NULL,
    kind    TEXT NOT NULL,
    target  TEXT NOT NULL,
    created INTEGER NOT NULL,
    PRIMARY KEY (user_id, kind, target)
);
CREATE TABLE IF NOT EXISTS indie_updates (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    kind    TEXT NOT NULL,
    title   TEXT NOT NULL,
    body    TEXT,
    link    TEXT,
    created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS indie_updates_game ON indie_updates (game_id, created);
CREATE TABLE IF NOT EXISTS indie_reports (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id  INTEGER NOT NULL,
    reporter TEXT NOT NULL,
    reason   TEXT NOT NULL,
    status   TEXT NOT NULL DEFAULT 'open',
    created  INTEGER NOT NULL,
    UNIQUE (game_id, reporter)
);
CREATE TABLE IF NOT EXISTS indie_keyreq (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    name    TEXT,
    channel TEXT,
    note    TEXT,
    status  TEXT NOT NULL DEFAULT 'pending',
    created INTEGER NOT NULL,
    UNIQUE (game_id, user_id)
);
CREATE TABLE IF NOT EXISTS indie_keys (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    key     TEXT NOT NULL,
    added   INTEGER NOT NULL,
    sent_to TEXT,
    sent_at INTEGER,
    req_id  INTEGER,
    UNIQUE (game_id, key)
);
CREATE INDEX IF NOT EXISTS indie_keys_game ON indie_keys (game_id, sent_to);
CREATE TABLE IF NOT EXISTS indie_days (
    game_id INTEGER NOT NULL,
    day     TEXT NOT NULL,
    views   INTEGER NOT NULL DEFAULT 0,
    clicks  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (game_id, day)
);
CREATE TABLE IF NOT EXISTS indie_reviews (
    game_id  INTEGER NOT NULL,
    day      TEXT NOT NULL,
    total    INTEGER NOT NULL,
    positive INTEGER NOT NULL,
    PRIMARY KEY (game_id, day)
);
CREATE TABLE IF NOT EXISTS indie_likes (
    game_id  INTEGER NOT NULL,
    user_id  TEXT NOT NULL,
    PRIMARY KEY (game_id, user_id)
);
`;

export const MAX_PENDING_PER_USER = 3, MAX_GAMES_PER_USER = 10;

export function indieStore({ run, get, all, now }) {
    const clip = (v, n) => (v == null || v === "" ? null : String(v).replace(/\s+/g, " ").trim().slice(0, n) || null);
    const json = (v, fallback) => { try { const x = JSON.parse(v ?? ""); return x ?? fallback; } catch { return fallback; } };
    const shape = r => (r ? { ...r, genres: json(r.genres, []), links: json(r.links, {}), featured: Boolean(r.featured) } : null);

    function indieAdd({ appid, ownerId, title, studio, blurb, pitch, genres, image, price, release, links }) {
        const r = run("INSERT INTO indie_games (appid, owner_id, title, studio, blurb, pitch, genres, image, price, release, links, created, synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            Number(appid), String(ownerId), clip(title, 200), clip(studio, 120), clip(blurb, 400), clip(pitch, 600), JSON.stringify((genres ?? []).slice(0, 8).map(g => String(g).slice(0, 40))),
            clip(image, 500), clip(price, 40), clip(release, 40), JSON.stringify(links ?? {}), now(), now());
        return Number(r.lastInsertRowid);
    }
    const indieGet = id => shape(get("SELECT * FROM indie_games WHERE id = ?", Number(id)));
    const indieByApp = appid => shape(get("SELECT * FROM indie_games WHERE appid = ?", Number(appid)));
    const indieByOwner = ownerId => all("SELECT * FROM indie_games WHERE owner_id = ? ORDER BY created DESC LIMIT 50", String(ownerId)).map(shape);
    const indieCountOwner = (ownerId, status) => get(`SELECT COUNT(*) n FROM indie_games WHERE owner_id = ?${status ? " AND status = ?" : ""}`, ...(status ? [String(ownerId), status] : [String(ownerId)])).n;

    /** The public list. Only approved games, newest first unless told otherwise. */
    function indieList({ status = "approved", genre = null, q = null, sort = "new", limit = 24, offset = 0 } = {}) {
        const where = ["status = ?"], args = [status];
        if (genre) { where.push("genres LIKE ?"); args.push(`%"${String(genre).replace(/[%_"\\]/g, "")}"%`); }
        if (q) { where.push("(title LIKE ? OR studio LIKE ?)"); const s = `%${String(q).replace(/[%_]/g, "").slice(0, 60)}%`; args.push(s, s); }
        const order = sort === "popular" ? "likes DESC, clicks DESC, created DESC" : sort === "az" ? "title COLLATE NOCASE ASC" : status === "pending" ? "created ASC" : "featured DESC, created DESC";
        const lim = Math.max(1, Math.min(60, Number(limit) || 24));
        const rows = all(`SELECT * FROM indie_games WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?`, ...args, lim, Math.max(0, Number(offset) || 0));
        const total = get(`SELECT COUNT(*) n FROM indie_games WHERE ${where.join(" AND ")}`, ...args).n;
        return { games: rows.map(shape), total };
    }
    const indieFeatured = (limit = 3) => all("SELECT * FROM indie_games WHERE status = 'approved' AND featured = 1 ORDER BY decided DESC LIMIT ?", limit).map(shape);
    function indieGenres() {
        const count = new Map();
        for (const r of all("SELECT genres FROM indie_games WHERE status = 'approved'")) for (const g of json(r.genres, [])) count.set(g, (count.get(g) ?? 0) + 1);
        return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, n]) => ({ name, n }));
    }
    function indieDecide(id, status, note = null) {
        run("UPDATE indie_games SET status = ?, note = ?, decided = ?, featured = CASE WHEN ? = 'approved' THEN featured ELSE 0 END WHERE id = ?", status, clip(note, 300), now(), status, Number(id));
    }
    const indieFeature = (id, on) => run("UPDATE indie_games SET featured = ?, decided = ? WHERE id = ? AND status = 'approved'", on ? 1 : 0, now(), Number(id));
    /** The owner can change the pitch and links. An approved game stays approved; a rejected one goes back in the queue. */
    function indieEdit(id, { pitch, links }) {
        run("UPDATE indie_games SET pitch = ?, links = ?, status = CASE WHEN status = 'rejected' THEN 'pending' ELSE status END, note = CASE WHEN status = 'rejected' THEN NULL ELSE note END WHERE id = ?", clip(pitch, 600), JSON.stringify(links ?? {}), Number(id));
    }
    function indieRefresh(id, { title, studio, blurb, genres, image, price, release }) {
        run("UPDATE indie_games SET title = ?, studio = ?, blurb = ?, genres = ?, image = ?, price = ?, release = ?, synced = " + now() + " WHERE id = ?", clip(title, 200), clip(studio, 120), clip(blurb, 400), JSON.stringify((genres ?? []).slice(0, 8)), clip(image, 500), clip(price, 40), clip(release, 40), Number(id));
    }
    function indieRemove(id) {
        const n = Number(id);
        for (const t of ["indie_likes", "indie_updates", "indie_reports", "indie_keyreq", "indie_keys", "indie_days", "indie_reviews"]) run(`DELETE FROM ${t} WHERE game_id = ?`, n);
        run("DELETE FROM indie_follows WHERE kind = 'game' AND target = ?", String(n)); run("DELETE FROM indie_games WHERE id = ?", n);
    }
    /** One like per person. Returns whether the game is liked now. */
    function indieToggleLike(id, userId) {
        const had = get("SELECT 1 x FROM indie_likes WHERE game_id = ? AND user_id = ?", Number(id), String(userId));
        if (had) { run("DELETE FROM indie_likes WHERE game_id = ? AND user_id = ?", Number(id), String(userId)); run("UPDATE indie_games SET likes = MAX(0, likes - 1) WHERE id = ?", Number(id)); return false; }
        run("INSERT INTO indie_likes (game_id, user_id) VALUES (?, ?)", Number(id), String(userId)); run("UPDATE indie_games SET likes = likes + 1 WHERE id = ?", Number(id)); return true;
    }
    const indieLikedBy = userId => all("SELECT game_id FROM indie_likes WHERE user_id = ?", String(userId)).map(r => r.game_id);
    const indieLiked = (id, userId) => Boolean(userId && get("SELECT 1 x FROM indie_likes WHERE game_id = ? AND user_id = ?", Number(id), String(userId)));
    const dayOf = (t = now()) => new Date(t).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const indieBump = (id, field) => {
        if (field !== "views" && field !== "clicks") return;
        const r = run(`UPDATE indie_games SET ${field} = ${field} + 1 WHERE id = ? AND status = 'approved'`, Number(id));
        if (r.changes) run(`INSERT INTO indie_days (game_id, day, ${field}) VALUES (?, ?, 1) ON CONFLICT(game_id, day) DO UPDATE SET ${field} = ${field} + 1`, Number(id), dayOf());
    };
    /** The last n days for one game, oldest first, with the quiet days filled in as zeros. */
    function indieDays(id, n = 14) {
        const rows = new Map(all("SELECT day, views, clicks FROM indie_days WHERE game_id = ? AND day >= ?", Number(id), dayOf(now() - n * 86_400_000)).map(r => [r.day, r]));
        return Array.from({ length: n }, (_, i) => { const day = dayOf(now() - (n - 1 - i) * 86_400_000), r = rows.get(day); return { day, views: r?.views ?? 0, clicks: r?.clicks ?? 0 }; });
    }
    /** All games over the last week, for the owner's Monday summary. */
    const indieWeek = () => ({ ...get("SELECT COALESCE(SUM(views),0) views, COALESCE(SUM(clicks),0) clicks FROM indie_days WHERE day >= ?", dayOf(now() - 6 * 86_400_000)), submitted: get("SELECT COUNT(*) n FROM indie_games WHERE created >= ?", now() - 7 * 86_400_000).n, pending: get("SELECT COUNT(*) n FROM indie_games WHERE status = 'pending'").n, reports: get("SELECT COUNT(*) n FROM indie_reports WHERE status = 'open'").n });
    const indieSnapReviews = (id, total, positive) => run("INSERT INTO indie_reviews (game_id, day, total, positive) VALUES (?, ?, ?, ?) ON CONFLICT(game_id, day) DO UPDATE SET total = excluded.total, positive = excluded.positive", Number(id), dayOf(), Number(total) || 0, Number(positive) || 0);
    const indieReviewHistory = (id, n = 60) => all("SELECT day, total, positive FROM indie_reviews WHERE game_id = ? ORDER BY day DESC LIMIT ?", Number(id), n).reverse();

    // follows: a game, or every game a studio (its owner) makes
    function indieToggleFollow(userId, kind, target) {
        if (kind !== "game" && kind !== "studio") return false;
        const t = String(target), had = get("SELECT 1 x FROM indie_follows WHERE user_id = ? AND kind = ? AND target = ?", String(userId), kind, t);
        if (had) { run("DELETE FROM indie_follows WHERE user_id = ? AND kind = ? AND target = ?", String(userId), kind, t); return false; }
        run("INSERT INTO indie_follows (user_id, kind, target, created) VALUES (?, ?, ?, ?)", String(userId), kind, t, now()); return true;
    }
    const indieFollowing = userId => all("SELECT kind, target FROM indie_follows WHERE user_id = ? ORDER BY created DESC LIMIT 200", String(userId));
    const indieIsFollowing = (userId, kind, target) => Boolean(userId && get("SELECT 1 x FROM indie_follows WHERE user_id = ? AND kind = ? AND target = ?", String(userId), kind, String(target)));
    const indieFollowers = (kind, target) => all("SELECT user_id FROM indie_follows WHERE kind = ? AND target = ?", kind, String(target)).map(r => r.user_id);
    const indieLikers = id => all("SELECT user_id FROM indie_likes WHERE game_id = ?", Number(id)).map(r => r.user_id);
    const indieFollowCount = id => get("SELECT COUNT(*) n FROM indie_follows WHERE kind = 'game' AND target = ?", String(id)).n;

    // developer updates
    function indieAddUpdate({ gameId, kind = "news", title, body = null, link = null }) {
        const k = ["news", "demo", "playtest", "release", "sale"].includes(kind) ? kind : "news";
        const r = run("INSERT INTO indie_updates (game_id, kind, title, body, link, created) VALUES (?, ?, ?, ?, ?, ?)", Number(gameId), k, clip(title, 120), clip(body, 600), clip(link, 300), now());
        return Number(r.lastInsertRowid);
    }
    const indieUpdates = (gameId, limit = 10) => all("SELECT * FROM indie_updates WHERE game_id = ? ORDER BY created DESC LIMIT ?", Number(gameId), limit);
    const indieUpdate = id => get("SELECT * FROM indie_updates WHERE id = ?", Number(id)) ?? null;
    const indieDeleteUpdate = id => run("DELETE FROM indie_updates WHERE id = ?", Number(id));
    const indieUpdatesSince = (gameId, since) => get("SELECT COUNT(*) n FROM indie_updates WHERE game_id = ? AND created >= ?", Number(gameId), since).n;
    /** The newest developer news across the showcase, approved games only. */
    const indieNewsFeed = (limit = 6) => all("SELECT u.*, g.title AS game_title, g.image, g.studio FROM indie_updates u JOIN indie_games g ON g.id = u.game_id WHERE g.status = 'approved' ORDER BY u.created DESC LIMIT ?", limit);

    // reports
    function indieReport({ gameId, reporter, reason }) {
        const had = get("SELECT id FROM indie_reports WHERE game_id = ? AND reporter = ?", Number(gameId), String(reporter));
        if (had) return false;
        run("INSERT INTO indie_reports (game_id, reporter, reason, created) VALUES (?, ?, ?, ?)", Number(gameId), String(reporter), clip(reason, 300) ?? "No reason given", now()); return true;
    }
    const indieReports = (status = "open") => all("SELECT r.*, g.title, g.appid, g.image FROM indie_reports r LEFT JOIN indie_games g ON g.id = r.game_id WHERE r.status = ? ORDER BY r.created DESC LIMIT 100", status);
    const indieResolveReports = (gameId, status = "closed") => run("UPDATE indie_reports SET status = ? WHERE game_id = ?", status, Number(gameId));

    // review key requests
    function indieKeyRequest({ gameId, userId, name, channel, note }) {
        if (get("SELECT 1 x FROM indie_keyreq WHERE game_id = ? AND user_id = ?", Number(gameId), String(userId))) return false;
        run("INSERT INTO indie_keyreq (game_id, user_id, name, channel, note, created) VALUES (?, ?, ?, ?, ?, ?)", Number(gameId), String(userId), clip(name, 60), clip(channel, 300), clip(note, 300), now()); return true;
    }
    const indieKeyRequests = gameId => all("SELECT * FROM indie_keyreq WHERE game_id = ? ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created DESC LIMIT 100", Number(gameId));
    const indieKeyRequestOf = (gameId, userId) => get("SELECT status FROM indie_keyreq WHERE game_id = ? AND user_id = ?", Number(gameId), String(userId)) ?? null;
    const indieKeyRequestGet = id => get("SELECT * FROM indie_keyreq WHERE id = ?", Number(id)) ?? null;
    const indieKeyDecide = (id, status, reply = null) => run("UPDATE indie_keyreq SET status = ?, reply = ?, decided = ? WHERE id = ?", status === "approved" ? "approved" : "declined", clip(reply, 300), now(), Number(id));

    // ---- the dev panel: every key request for a developer's games, and an optional pool of keys to hand out ----
    /** The developer's requests across all of their games, newest pending first. */
    function indieKeyInbox(ownerId, { game = null, status = null, q = null, limit = 200 } = {}) {
        const where = ["g.owner_id = ?"], args = [String(ownerId)];
        if (game) { where.push("k.game_id = ?"); args.push(Number(game)); }
        if (["pending", "approved", "declined"].includes(status)) { where.push("k.status = ?"); args.push(status); }
        if (q) { where.push("(k.name LIKE ? OR k.channel LIKE ? OR k.note LIKE ?)"); const like = `%${String(q).replace(/[%_]/g, "").slice(0, 60)}%`; args.push(like, like, like); }
        return all(`SELECT k.*, g.title AS game_title, g.image AS game_image, (SELECT COUNT(*) FROM indie_keys x WHERE x.req_id = k.id) AS key_sent FROM indie_keyreq k JOIN indie_games g ON g.id = k.game_id WHERE ${where.join(" AND ")} ORDER BY CASE k.status WHEN 'pending' THEN 0 ELSE 1 END, k.created DESC LIMIT ?`, ...args, Math.min(500, Math.max(1, Number(limit) || 200)));
    }
    const indieKeyCounts = gameId => Object.fromEntries(["pending", "approved", "declined"].map(s => [s, get("SELECT COUNT(*) n FROM indie_keyreq WHERE game_id = ? AND status = ?", Number(gameId), s).n]));
    /** Adds keys to a game's pool. Returns { added, skipped }: blank lines and repeats are skipped. */
    function indieKeysAdd(gameId, keys, max = 2000) {
        let added = 0, skipped = 0;
        const have = get("SELECT COUNT(*) n FROM indie_keys WHERE game_id = ?", Number(gameId)).n;
        for (const raw of keys) {
            const k = String(raw ?? "").trim();
            if (!/^[\w-]{4,80}$/.test(k) || have + added >= max || get("SELECT 1 x FROM indie_keys WHERE game_id = ? AND key = ?", Number(gameId), k)) { skipped++; continue; }
            run("INSERT INTO indie_keys (game_id, key, added) VALUES (?, ?, ?)", Number(gameId), k, now()); added++;
        }
        return { added, skipped };
    }
    const indieKeyPool = gameId => ({ total: get("SELECT COUNT(*) n FROM indie_keys WHERE game_id = ?", Number(gameId)).n, left: get("SELECT COUNT(*) n FROM indie_keys WHERE game_id = ? AND sent_to IS NULL", Number(gameId)).n });
    const indieKeyList = gameId => all("SELECT id, key, added, sent_to, sent_at FROM indie_keys WHERE game_id = ? ORDER BY CASE WHEN sent_to IS NULL THEN 0 ELSE 1 END, id LIMIT 500", Number(gameId));
    /** Takes the next unsent key for this request, or null when the pool is empty. One request never gets two. */
    function indieKeyTake(gameId, userId, reqId) {
        const had = get("SELECT key FROM indie_keys WHERE req_id = ?", Number(reqId)); if (had) return had.key;
        const k = get("SELECT id, key FROM indie_keys WHERE game_id = ? AND sent_to IS NULL ORDER BY id LIMIT 1", Number(gameId)); if (!k) return null;
        run("UPDATE indie_keys SET sent_to = ?, sent_at = ?, req_id = ? WHERE id = ? AND sent_to IS NULL", String(userId), now(), Number(reqId), k.id);
        return k.key;
    }
    const indieKeyRemove = (gameId, keyId) => run("DELETE FROM indie_keys WHERE id = ? AND game_id = ? AND sent_to IS NULL", Number(keyId), Number(gameId));
    const indieKeyClear = gameId => run("DELETE FROM indie_keys WHERE game_id = ? AND sent_to IS NULL", Number(gameId));
    const indieApprovedOwned = ownerId => get("SELECT COUNT(*) n FROM indie_games WHERE owner_id = ? AND status = 'approved'", String(ownerId)).n;
    const indieSetKeysOpen = (id, on) => run("UPDATE indie_games SET keys_open = ? WHERE id = ?", on ? 1 : 0, Number(id));

    // verification and spotlight
    const indieSetVerifyCode = (id, code) => run("UPDATE indie_games SET verify_code = ? WHERE id = ?", code, Number(id));
    const indieSetVerified = (id, on) => run("UPDATE indie_games SET verified = ?, verify_code = CASE WHEN ? = 1 THEN NULL ELSE verify_code END WHERE id = ?", on ? 1 : 0, on ? 1 : 0, Number(id));
    /** The approved game spotlighted longest ago (never first), skipping anything spotlighted in the last `restDays`. */
    const indieSpotlightPick = (restDays = 21) => get("SELECT * FROM indie_games WHERE status = 'approved' AND COALESCE(spotlit, 0) < ? ORDER BY COALESCE(spotlit, 0) ASC, verified DESC, likes DESC, created DESC LIMIT 1", now() - restDays * 86_400_000);
    const indieMarkSpotlit = id => run("UPDATE indie_games SET spotlit = ? WHERE id = ?", now(), Number(id));
    const indieApprovedAll = () => all("SELECT * FROM indie_games WHERE status = 'approved'").map(shape);
    const indieReportsFor = gameId => get("SELECT COUNT(*) n FROM indie_reports WHERE game_id = ? AND status = 'open'", Number(gameId)).n;
    const indieCounts = () => Object.fromEntries(all("SELECT status, COUNT(*) n FROM indie_games GROUP BY status").map(r => [r.status, r.n]));
    /** Approved games not refreshed from Steam in a day, least recently synced first. */
    const indieDueForSync = (limit = 5, olderThanMs = 86_400_000) => all("SELECT id, appid FROM indie_games WHERE status = 'approved' AND COALESCE(synced, 0) < ? ORDER BY COALESCE(synced, 0) ASC LIMIT ?", now() - olderThanMs, limit);
    const indieTouchSync = id => run("UPDATE indie_games SET synced = ? WHERE id = ?", now(), Number(id));
    const indieTotals = () => get("SELECT COALESCE(SUM(views),0) views, COALESCE(SUM(clicks),0) clicks, COALESCE(SUM(likes),0) likes FROM indie_games WHERE status = 'approved'");
    /** Someone deleting their data takes their games and likes with them. */
    function forgetIndieUser(userId) {
        for (const g of all("SELECT id FROM indie_games WHERE owner_id = ?", String(userId))) indieRemove(g.id);
        run("DELETE FROM indie_follows WHERE user_id = ? OR (kind = 'studio' AND target = ?)", String(userId), String(userId));
        run("DELETE FROM indie_reports WHERE reporter = ?", String(userId)); run("DELETE FROM indie_keyreq WHERE user_id = ?", String(userId));
        for (const l of all("SELECT game_id FROM indie_likes WHERE user_id = ?", String(userId))) run("UPDATE indie_games SET likes = MAX(0, likes - 1) WHERE id = ?", l.game_id);
        run("DELETE FROM indie_likes WHERE user_id = ?", String(userId));
    }
    const indieExport = userId => ({ following: indieFollowing(userId), keyRequests: all("SELECT game_id, status, created FROM indie_keyreq WHERE user_id = ?", String(userId)), games: indieByOwner(userId).map(g => ({ appid: g.appid, title: g.title, status: g.status, pitch: g.pitch, links: g.links, submitted_at: g.created })), liked: all("SELECT game_id FROM indie_likes WHERE user_id = ?", String(userId)).map(r => r.game_id) });
    return { indieLikedBy, indieDays, indieWeek, indieSnapReviews, indieReviewHistory, indieToggleFollow, indieFollowing, indieIsFollowing, indieFollowers, indieLikers, indieFollowCount, indieAddUpdate, indieUpdates, indieUpdate, indieDeleteUpdate, indieUpdatesSince, indieNewsFeed, indieReport, indieReports, indieResolveReports, indieKeyRequest, indieKeyRequests, indieKeyRequestOf, indieKeyRequestGet, indieKeyDecide, indieKeyInbox, indieKeyCounts, indieKeysAdd, indieKeyPool, indieKeyList, indieKeyTake, indieKeyRemove, indieKeyClear, indieApprovedOwned, indieSetKeysOpen, indieSetVerifyCode, indieSetVerified, indieSpotlightPick, indieMarkSpotlit, indieApprovedAll, indieReportsFor, indieAdd, indieGet, indieByApp, indieByOwner, indieCountOwner, indieList, indieFeatured, indieGenres, indieDecide, indieFeature, indieEdit, indieRefresh, indieRemove, indieToggleLike, indieLiked, indieBump, indieCounts, indieDueForSync, indieTouchSync, indieTotals, forgetIndieUser, indieExport };
}

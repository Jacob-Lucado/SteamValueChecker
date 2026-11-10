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
    synced    INTEGER
);
CREATE INDEX IF NOT EXISTS indie_games_status ON indie_games (status, created);
CREATE INDEX IF NOT EXISTS indie_games_owner ON indie_games (owner_id);
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
    function indieRemove(id) { run("DELETE FROM indie_likes WHERE game_id = ?", Number(id)); run("DELETE FROM indie_games WHERE id = ?", Number(id)); }
    /** One like per person. Returns whether the game is liked now. */
    function indieToggleLike(id, userId) {
        const had = get("SELECT 1 x FROM indie_likes WHERE game_id = ? AND user_id = ?", Number(id), String(userId));
        if (had) { run("DELETE FROM indie_likes WHERE game_id = ? AND user_id = ?", Number(id), String(userId)); run("UPDATE indie_games SET likes = MAX(0, likes - 1) WHERE id = ?", Number(id)); return false; }
        run("INSERT INTO indie_likes (game_id, user_id) VALUES (?, ?)", Number(id), String(userId)); run("UPDATE indie_games SET likes = likes + 1 WHERE id = ?", Number(id)); return true;
    }
    const indieLiked = (id, userId) => Boolean(userId && get("SELECT 1 x FROM indie_likes WHERE game_id = ? AND user_id = ?", Number(id), String(userId)));
    const indieBump = (id, field) => { if (field === "views" || field === "clicks") run(`UPDATE indie_games SET ${field} = ${field} + 1 WHERE id = ? AND status = 'approved'`, Number(id)); };
    const indieCounts = () => Object.fromEntries(all("SELECT status, COUNT(*) n FROM indie_games GROUP BY status").map(r => [r.status, r.n]));
    /** Approved games not refreshed from Steam in a day, least recently synced first. */
    const indieDueForSync = (limit = 5, olderThanMs = 86_400_000) => all("SELECT id, appid FROM indie_games WHERE status = 'approved' AND COALESCE(synced, 0) < ? ORDER BY COALESCE(synced, 0) ASC LIMIT ?", now() - olderThanMs, limit);
    const indieTouchSync = id => run("UPDATE indie_games SET synced = ? WHERE id = ?", now(), Number(id));
    const indieTotals = () => get("SELECT COALESCE(SUM(views),0) views, COALESCE(SUM(clicks),0) clicks, COALESCE(SUM(likes),0) likes FROM indie_games WHERE status = 'approved'");
    /** Someone deleting their data takes their games and likes with them. */
    function forgetIndieUser(userId) {
        for (const g of all("SELECT id FROM indie_games WHERE owner_id = ?", String(userId))) indieRemove(g.id);
        for (const l of all("SELECT game_id FROM indie_likes WHERE user_id = ?", String(userId))) run("UPDATE indie_games SET likes = MAX(0, likes - 1) WHERE id = ?", l.game_id);
        run("DELETE FROM indie_likes WHERE user_id = ?", String(userId));
    }
    const indieExport = userId => ({ games: indieByOwner(userId).map(g => ({ appid: g.appid, title: g.title, status: g.status, pitch: g.pitch, links: g.links, submitted_at: g.created })), liked: all("SELECT game_id FROM indie_likes WHERE user_id = ?", String(userId)).map(r => r.game_id) });
    return { indieAdd, indieGet, indieByApp, indieByOwner, indieCountOwner, indieList, indieFeatured, indieGenres, indieDecide, indieFeature, indieEdit, indieRefresh, indieRemove, indieToggleLike, indieLiked, indieBump, indieCounts, indieDueForSync, indieTouchSync, indieTotals, forgetIndieUser, indieExport };
}

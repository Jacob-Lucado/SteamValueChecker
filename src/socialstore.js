// The community feed. People follow each other's public pages and see what they finish, which rare achievements they unlock
// and what they post. Events write themselves; posts are short, tied to a game if you like, and can be replied to.
// Nothing here is shown for a page that is private, switched off or blocked, and a few simple limits plus reporting keep it tidy.
export const socialSchema = `
CREATE TABLE IF NOT EXISTS feed (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    appid      INTEGER,
    game       TEXT,
    body       TEXT,
    parent_id  INTEGER,
    ref        TEXT,
    data       TEXT,
    at         INTEGER NOT NULL,
    hidden     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS feed_by_author ON feed (discord_id, id);
CREATE INDEX IF NOT EXISTS feed_by_parent ON feed (parent_id);
CREATE INDEX IF NOT EXISTS feed_by_game ON feed (appid, id);
CREATE UNIQUE INDEX IF NOT EXISTS feed_event_once ON feed (discord_id, kind, ref) WHERE kind <> 'post' AND ref IS NOT NULL;
CREATE TABLE IF NOT EXISTS follows (
    follower TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    followee TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    at       INTEGER NOT NULL,
    PRIMARY KEY (follower, followee)
);
CREATE INDEX IF NOT EXISTS follows_by_followee ON follows (followee);
CREATE TABLE IF NOT EXISTS feed_reactions (
    feed_id    INTEGER NOT NULL,
    discord_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    emoji      TEXT NOT NULL,
    PRIMARY KEY (feed_id, discord_id)
);
CREATE TABLE IF NOT EXISTS social_blocks (
    discord_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    blocked_id TEXT NOT NULL,
    PRIMARY KEY (discord_id, blocked_id)
);
CREATE TABLE IF NOT EXISTS feed_reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id     INTEGER NOT NULL,
    author_id   TEXT NOT NULL,
    reporter_id TEXT NOT NULL,
    reason      TEXT NOT NULL DEFAULT '',
    snapshot    TEXT NOT NULL DEFAULT '',
    at          INTEGER NOT NULL,
    UNIQUE (feed_id, reporter_id)
);
CREATE TABLE IF NOT EXISTS user_guilds (
    discord_id TEXT NOT NULL,
    guild_id   TEXT NOT NULL,
    PRIMARY KEY (discord_id, guild_id)
);
CREATE INDEX IF NOT EXISTS user_guilds_by_guild ON user_guilds (guild_id);
CREATE TABLE IF NOT EXISTS guild_social (
    guild_id TEXT PRIMARY KEY,
    listed   INTEGER NOT NULL DEFAULT 1,
    about    TEXT NOT NULL DEFAULT '',
    invite   TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS social_bans (
    discord_id TEXT PRIMARY KEY,
    reason     TEXT NOT NULL DEFAULT '',
    at         INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS social_prefs (
    discord_id  TEXT PRIMARY KEY REFERENCES users(discord_id) ON DELETE CASCADE,
    events      INTEGER NOT NULL DEFAULT 1,
    digest      INTEGER NOT NULL DEFAULT 0,
    last_digest INTEGER NOT NULL DEFAULT 0,
    notify      INTEGER NOT NULL DEFAULT 1,
    dm          INTEGER NOT NULL DEFAULT 0,
    guestbook   INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS guestbook (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id  TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    body      TEXT NOT NULL,
    at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS guestbook_by_owner ON guestbook (owner_id, id);
CREATE INDEX IF NOT EXISTS guestbook_by_author ON guestbook (author_id, at);
CREATE TABLE IF NOT EXISTS feed_images (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id    INTEGER NOT NULL UNIQUE,
    discord_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    mime       TEXT NOT NULL,
    data       BLOB NOT NULL,
    at         INTEGER NOT NULL
);`;
export const IMAGES_PER_DAY = 5;
export const GUESTBOOK_PER_HOUR = 6, GUESTBOOK_KEEP = 300;

/** Only real Discord invite links, so a server cannot point visitors somewhere else. */
export const INVITE_RE = /^https:\/\/(discord\.gg|discord\.com\/invite)\/[A-Za-z0-9-]{2,32}$/;
export const MAX_ABOUT_CHARS = 200;

export const REACTIONS = ["👍", "🔥", "😂", "🎮", "❤️", "😮"];
export const MAX_POST_CHARS = 280;
export const POSTS_PER_HOUR = 8;
export const REPLIES_PER_HOUR = 20;
export const ITEMS_PER_DAY = 60;
export const REPORTS_TO_HIDE = 3;
export const MAX_FOLLOWING = 500;
export const EVENT_KEEP_MS = 90 * 86400_000;
export const IMAGE_KEEP_MS = 180 * 86400_000; // post text stays, but the pictures are the heavy part, so they go after about six months
const HOUR = 3600_000, DAY = 86400_000;

/** Visible authors only: a page that is on, not blocked, and not set to keep its activity to itself (posts are always the author's choice). */
const LIVE = `EXISTS (SELECT 1 FROM users au WHERE au.discord_id = f.discord_id AND au.profile_public = 1 AND au.profile_slug IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM profile_ext pb WHERE pb.discord_id = f.discord_id AND pb.blocked = 1)
    AND NOT (f.kind <> 'post' AND EXISTS (SELECT 1 FROM social_prefs sp WHERE sp.discord_id = f.discord_id AND sp.events = 0))`;
const NOT_BLOCKED = viewer => `NOT EXISTS (SELECT 1 FROM social_blocks b WHERE (b.discord_id = ? AND b.blocked_id = f.discord_id) OR (b.discord_id = f.discord_id AND b.blocked_id = ?))`;

/** A post's text, tidied. Links are not allowed: this is a place to talk about games, not to advertise. */
export function cleanPostText(input) {
    const text = String(input ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f​-‏‪-‮⁦-⁩]/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) return { error: "Write something first." };
    if ([...text].length > MAX_POST_CHARS) return { error: `Keep it to ${MAX_POST_CHARS} characters.` };
    if (/(https?:\/\/|www\.|discord\.gg\/|discord(app)?\.com\/invite|\b[a-z0-9-]+\.(com|net|org|io|gg|tv|ru|xyz|ly|co)\b\/)/i.test(text)) return { error: "Links are not allowed here." };
    return { text };
}

/** Only members whose home server is one of these. */
const inGuilds = (col, guilds) => { const q = guilds.map(() => "?").join(","); return `${col} IN (SELECT discord_id FROM users WHERE guild_id IN (${q}) UNION SELECT discord_id FROM user_guilds WHERE guild_id IN (${q}))`; };

export function socialStore({ run, get, all, now, clean = x => x }) {
    const rows = (sql, ...args) => all(sql, ...args).map(clean);

    const getPrefs = id => {
        const r = get("SELECT events, digest, last_digest, notify, dm, guestbook FROM social_prefs WHERE discord_id = ?", id);
        return { events: r ? Boolean(r.events) : true, digest: r ? Boolean(r.digest) : false, lastDigest: r?.last_digest ?? 0, notify: r ? Boolean(r.notify) : true, dm: r ? Boolean(r.dm) : false, guestbook: r ? Boolean(r.guestbook) : true };
    };
    function setPrefs(id, patch) {
        const cur = getPrefs(id), v = k => (patch[k] === undefined ? cur[k] : Boolean(patch[k])) ? 1 : 0;
        run("INSERT INTO social_prefs (discord_id, events, digest, last_digest, notify, dm, guestbook) VALUES (?,?,?,?,?,?,?) ON CONFLICT(discord_id) DO UPDATE SET events = excluded.events, digest = excluded.digest, notify = excluded.notify, dm = excluded.dm, guestbook = excluded.guestbook",
            id, v("events"), v("digest"), cur.lastDigest, v("notify"), v("dm"), v("guestbook"));
        return getPrefs(id);
    }

    // ---- guestbook: short notes left on someone's page. The owner can delete any of them, close it, or block a person.
    function guestbookList(ownerId, viewerId = null, { before = null, limit = 20 } = {}) {
        const rows = all(`SELECT g.id, g.author_id AS author, g.body, g.at FROM guestbook g WHERE g.owner_id = ? ${before ? "AND g.id < ?" : ""}
            AND NOT EXISTS (SELECT 1 FROM social_blocks b WHERE b.discord_id = ? AND b.blocked_id = g.author_id)
            AND NOT EXISTS (SELECT 1 FROM social_blocks b WHERE b.discord_id = ? AND b.blocked_id = g.author_id)
            AND NOT EXISTS (SELECT 1 FROM social_bans x WHERE x.discord_id = g.author_id)
            ORDER BY g.id DESC LIMIT ?`, ownerId, ...(before ? [Number(before)] : []), ownerId, viewerId ?? "", Math.min(50, Math.max(1, limit)) + 1);
        const more = rows.length > limit;
        return { items: rows.slice(0, limit).map(clean), more, total: get("SELECT COUNT(*) AS n FROM guestbook WHERE owner_id = ?", ownerId).n };
    }
    function guestbookPost(ownerId, authorId, body, { staff = false } = {}) {
        if (ownerId === authorId) return { error: "Sign someone else's guestbook.", status: 400 };
        const c = cleanPostText(body);
        if (c.error) return { error: c.error, status: 400 };
        if (!getPrefs(ownerId).guestbook) return { error: "This guestbook is closed.", status: 403 };
        if (!staff && isSocialBanned(authorId)) return { error: "Posting is turned off for your account.", status: 403 };
        if (blockedEither(ownerId, authorId)) return { error: "You can't sign this guestbook.", status: 403 };
        const t = now();
        if (!staff) {
            if (get("SELECT COUNT(*) AS n FROM guestbook WHERE author_id = ? AND at > ?", authorId, t - HOUR).n >= GUESTBOOK_PER_HOUR) return { error: "That's a lot of notes. Give it a little while.", status: 429 };
            if (get("SELECT 1 FROM guestbook WHERE owner_id = ? AND author_id = ? AND body = ? AND at > ?", ownerId, authorId, c.text, t - 10 * 60_000)) return { error: "You already said that.", status: 409 };
        }
        const info = run("INSERT INTO guestbook (owner_id, author_id, body, at) VALUES (?,?,?,?)", ownerId, authorId, c.text, t);
        run("DELETE FROM guestbook WHERE owner_id = ? AND id NOT IN (SELECT id FROM guestbook WHERE owner_id = ? ORDER BY id DESC LIMIT ?)", ownerId, ownerId, GUESTBOOK_KEEP);
        return { id: Number(info.lastInsertRowid) };
    }
    const guestbookEntry = id => clean(get("SELECT id, owner_id AS owner, author_id AS author, body, at FROM guestbook WHERE id = ?", Number(id))) ?? null;
    const guestbookDelete = id => run("DELETE FROM guestbook WHERE id = ?", Number(id));
    const markDigest = (id, at = now()) => run("INSERT INTO social_prefs (discord_id, last_digest) VALUES (?,?) ON CONFLICT(discord_id) DO UPDATE SET last_digest = excluded.last_digest", id, at);

    // ---- servers in the community directory. Every server the bot is in is listed unless its managers opt out.
    function guildSocial(id) { const r = get("SELECT listed, about, invite FROM guild_social WHERE guild_id = ?", String(id)); return { listed: r ? Boolean(r.listed) : true, about: r?.about ?? "", invite: r?.invite ?? "" }; }
    /** Returns { error } for a bad invite or description, otherwise the saved settings. */
    function setGuildSocial(id, { listed, about, invite }) {
        const cur = guildSocial(id);
        const a = about === undefined ? cur.about : String(about).replace(/\s+/g, " ").trim();
        if ([...a].length > MAX_ABOUT_CHARS) return { error: `Keep the description to ${MAX_ABOUT_CHARS} characters.` };
        const inv = invite === undefined ? cur.invite : String(invite).trim();
        if (inv && !INVITE_RE.test(inv)) return { error: "That doesn't look like a Discord invite link (discord.gg/… or discord.com/invite/…)." };
        run("INSERT INTO guild_social (guild_id, listed, about, invite) VALUES (?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET listed = excluded.listed, about = excluded.about, invite = excluded.invite", String(id), (listed ?? cur.listed) ? 1 : 0, a, inv);
        return guildSocial(id);
    }
    const MEMBERS = "(SELECT discord_id, guild_id FROM users WHERE guild_id IS NOT NULL UNION SELECT discord_id, guild_id FROM user_guilds)";
    /** For each server: members with a public page, and how many of them did something in the feed since `sinceMs`. */
    function socialGuildStats(guildIds, sinceMs) {
        if (!guildIds.length) return new Map();
        const q = guildIds.map(() => "?").join(",");
        const out = new Map();
        for (const r of all(`SELECT m.guild_id, COUNT(DISTINCT m.discord_id) AS people,
              COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM feed f WHERE f.discord_id = m.discord_id AND f.parent_id IS NULL AND f.hidden = 0 AND f.at > ?) THEN m.discord_id END) AS active
            FROM ${MEMBERS} m JOIN users u ON u.discord_id = m.discord_id AND u.profile_public = 1 AND u.profile_slug IS NOT NULL
            WHERE m.guild_id IN (${q}) AND NOT EXISTS (SELECT 1 FROM profile_ext p WHERE p.discord_id = m.discord_id AND p.blocked = 1) GROUP BY m.guild_id`, sinceMs, ...guildIds)) out.set(r.guild_id, { people: r.people, active: r.active });
        return out;
    }
    /** Members of a server with a public page, the most recently active first. */
    const guildMembers = (guildId, limit = 24) => rows(`SELECT u.discord_id, u.profile_slug AS slug, (SELECT MAX(f.id) FROM feed f WHERE f.discord_id = u.discord_id AND f.hidden = 0) AS last
        FROM ${MEMBERS} m JOIN users u ON u.discord_id = m.discord_id WHERE m.guild_id = ? AND u.profile_public = 1 AND u.profile_slug IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM profile_ext p WHERE p.discord_id = u.discord_id AND p.blocked = 1)
        ORDER BY last IS NULL, last DESC, u.profile_slug LIMIT ?`, String(guildId), limit);

    /** The servers a member is in, noted when they sign in, so their public activity can show up in those servers' feeds. */
    function rememberGuilds(id, guildIds) {
        run("DELETE FROM user_guilds WHERE discord_id = ?", id);
        for (const g of [...new Set(guildIds.map(String))].slice(0, 200)) run("INSERT OR IGNORE INTO user_guilds (discord_id, guild_id) VALUES (?,?)", id, g);
    }
    const userGuildIds = id => [...new Set([get("SELECT guild_id FROM users WHERE discord_id = ?", id)?.guild_id, ...all("SELECT guild_id FROM user_guilds WHERE discord_id = ?", id).map(r => r.guild_id)].filter(Boolean))];

    // ---- who is who
    const isSocialBanned = id => Boolean(get("SELECT 1 FROM social_bans WHERE discord_id = ?", id));
    const blockedEither = (a, b) => Boolean(get("SELECT 1 FROM social_blocks WHERE (discord_id = ? AND blocked_id = ?) OR (discord_id = ? AND blocked_id = ?)", a, b, b, a));
    function setBlock(id, other, on) {
        if (id === other) return;
        if (on) { run("INSERT OR IGNORE INTO social_blocks (discord_id, blocked_id) VALUES (?,?)", id, other); run("DELETE FROM follows WHERE (follower = ? AND followee = ?) OR (follower = ? AND followee = ?)", id, other, other, id); }
        else run("DELETE FROM social_blocks WHERE discord_id = ? AND blocked_id = ?", id, other);
    }
    const listBlocks = id => rows("SELECT u.discord_id, u.profile_slug AS slug FROM social_blocks b LEFT JOIN users u ON u.discord_id = b.blocked_id WHERE b.discord_id = ?", id);

    // ---- following
    /** Returns "ok", "self", "blocked", "limit" or "closed" (a page that is off cannot be followed). */
    function follow(follower, followee, on) {
        if (follower === followee) return "self";
        if (!on) { run("DELETE FROM follows WHERE follower = ? AND followee = ?", follower, followee); return "ok"; }
        if (blockedEither(follower, followee)) return "blocked";
        if (!get("SELECT 1 FROM users WHERE discord_id = ? AND profile_public = 1 AND profile_slug IS NOT NULL", followee)) return "closed";
        if (get("SELECT 1 FROM follows WHERE follower = ? AND followee = ?", follower, followee)) return "ok";
        if (get("SELECT COUNT(*) AS n FROM follows WHERE follower = ?", follower).n >= MAX_FOLLOWING) return "limit";
        run("INSERT INTO follows (follower, followee, at) VALUES (?,?,?)", follower, followee, now());
        return "new";
    }
    const isFollowing = (follower, followee) => Boolean(get("SELECT 1 FROM follows WHERE follower = ? AND followee = ?", follower, followee));
    const followCounts = id => ({ followers: get("SELECT COUNT(*) AS n FROM follows f JOIN users u ON u.discord_id = f.follower WHERE f.followee = ?", id).n, following: get("SELECT COUNT(*) AS n FROM follows WHERE follower = ?", id).n });
    const listFollowers = id => rows("SELECT u.discord_id, u.profile_slug AS slug FROM follows f JOIN users u ON u.discord_id = f.follower WHERE f.followee = ? AND u.profile_public = 1 AND u.profile_slug IS NOT NULL ORDER BY f.at DESC LIMIT 200", id);
    const listFollowing = id => rows("SELECT u.discord_id, u.profile_slug AS slug, u.profile_public AS open FROM follows f JOIN users u ON u.discord_id = f.followee WHERE f.follower = ? ORDER BY f.at DESC LIMIT 500", id);

    // ---- what goes in the feed
    /** An event that writes itself. `ref` makes it happen once: finishing the same game or unlocking the same achievement does not post twice. */
    function addEvent(id, kind, { appid = null, game = null, ref = null, data = null, at = now(), quiet = false } = {}) {
        return run("INSERT OR IGNORE INTO feed (discord_id, kind, appid, game, ref, data, at, hidden) VALUES (?,?,?,?,?,?,?,?)",
            id, kind, appid, game ? String(game).slice(0, 120) : null, ref === null ? null : String(ref).slice(0, 160), data ? JSON.stringify(data) : null, at, quiet ? 2 : 0).changes > 0;
    }
    /** First sight of a member's trophies is recorded quietly so a long-time member does not flood the feed. Later tier-ups post. */
    function trophyEvents(id, badges) {
        const seeded = Boolean(get("SELECT 1 FROM feed WHERE discord_id = ? AND kind = 'trophy' LIMIT 1", id));
        let posted = 0;
        for (const b of badges) {
            if (!b.tier) continue;
            if (addEvent(id, "trophy", { ref: `${b.id}:${b.tier}`, data: { icon: b.icon, name: b.name, tier: b.tier }, quiet: !seeded }) && seeded) posted++;
        }
        return posted;
    }

    function recentCount(id, since, replies) {
        return get(`SELECT COUNT(*) AS n FROM feed WHERE discord_id = ? AND kind = 'post' AND at > ? AND parent_id IS ${replies ? "NOT" : ""} NULL`, id, since).n;
    }
    /** A post or a reply. Returns { id } or { error, status }. */
    function createPost(id, { body, appid = null, game = null, parentId = null, hasImage = false }, { staff = false } = {}) {
        const c = hasImage && !parentId && !String(body ?? "").trim() ? { text: "" } : cleanPostText(body);
        if (c.error) return { error: c.error, status: 400 };
        if (!staff && isSocialBanned(id)) return { error: "Posting is turned off for your account.", status: 403 };
        let parent = null;
        if (parentId !== null && parentId !== undefined && parentId !== "") {
            parent = get("SELECT id, discord_id, parent_id, hidden FROM feed WHERE id = ?", Number(parentId));
            if (!parent || parent.parent_id !== null || parent.hidden) return { error: "That post is gone.", status: 404 };
            if (blockedEither(id, parent.discord_id)) return { error: "You can't reply to that one.", status: 403 };
        }
        if (!staff) {
            const t = now();
            if (recentCount(id, t - HOUR, Boolean(parent)) >= (parent ? REPLIES_PER_HOUR : POSTS_PER_HOUR)) return { error: parent ? "That's a lot of replies. Give it a little while." : "That's a lot of posts for one hour. Give it a little while.", status: 429 };
            if (get("SELECT COUNT(*) AS n FROM feed WHERE discord_id = ? AND kind = 'post' AND at > ?", id, t - DAY).n >= ITEMS_PER_DAY) return { error: "You've hit today's posting limit. It resets tomorrow.", status: 429 };
            if (get("SELECT 1 FROM feed WHERE discord_id = ? AND kind = 'post' AND body = ? AND at > ?", id, c.text, t - 10 * 60_000)) return { error: "You already said that.", status: 409 };
        }
        if (hasImage && !parentId && !staff && get("SELECT COUNT(*) AS n FROM feed_images WHERE discord_id = ? AND at > ?", id, now() - DAY).n >= IMAGES_PER_DAY) return { error: `That's ${IMAGES_PER_DAY} pictures today. Try again tomorrow.`, status: 429 };
        const info = run("INSERT INTO feed (discord_id, kind, appid, game, body, parent_id, at) VALUES (?,?,?,?,?,?,?)", id, "post", parent ? null : (Number.isInteger(appid) && appid > 0 ? appid : null), parent ? null : (game ? String(game).slice(0, 120) : null), c.text, parent ? parent.id : null, now());
        return { id: Number(info.lastInsertRowid), parentAuthor: parent?.discord_id ?? null };
    }

    function deleteItem(feedId) {
        run("DELETE FROM feed_reactions WHERE feed_id IN (SELECT id FROM feed WHERE id = ? OR parent_id = ?)", feedId, feedId);
        run("DELETE FROM feed_images WHERE feed_id = ?", feedId);
        run("DELETE FROM feed WHERE id = ? OR parent_id = ?", feedId, feedId);
        run("DELETE FROM feed_reports WHERE feed_id = ?", feedId);
    }
    const getItem = feedId => clean(get("SELECT * FROM feed WHERE id = ?", Number(feedId))) ?? null;

    // ---- one picture per post, kept in the database and served from our own address
    const addPostImage = (feedId, id, mime, buf) => Number(run("INSERT INTO feed_images (feed_id, discord_id, mime, data, at) VALUES (?,?,?,?,?)", Number(feedId), id, mime, buf, now()).lastInsertRowid);
    const getPostImage = imageId => get("SELECT i.id, i.mime, i.data, i.discord_id AS author, f.hidden FROM feed_images i JOIN feed f ON f.id = i.feed_id WHERE i.id = ?", Number(imageId)) ?? null;

    /** One reaction per person per item. The same emoji again takes it back; a different one swaps it. */
    function react(feedId, id, emoji) {
        const have = get("SELECT emoji FROM feed_reactions WHERE feed_id = ? AND discord_id = ?", feedId, id);
        if (!emoji || have?.emoji === emoji) { run("DELETE FROM feed_reactions WHERE feed_id = ? AND discord_id = ?", feedId, id); return null; }
        run("INSERT INTO feed_reactions (feed_id, discord_id, emoji) VALUES (?,?,?) ON CONFLICT(feed_id, discord_id) DO UPDATE SET emoji = excluded.emoji", feedId, id, emoji);
        return emoji;
    }

    /** Fills in reactions, reply counts and the author's page name for a batch of rows. */
    function decorate(list, viewer) {
        if (!list.length) return list;
        const ids = list.map(r => r.id), q = ids.map(() => "?").join(",");
        const reacts = new Map(), mine = new Map(), replies = new Map();
        for (const r of all(`SELECT feed_id, emoji, COUNT(*) AS n FROM feed_reactions WHERE feed_id IN (${q}) GROUP BY feed_id, emoji`, ...ids)) { const m = reacts.get(r.feed_id) ?? {}; m[r.emoji] = r.n; reacts.set(r.feed_id, m); }
        if (viewer) for (const r of all(`SELECT feed_id, emoji FROM feed_reactions WHERE discord_id = ? AND feed_id IN (${q})`, viewer, ...ids)) mine.set(r.feed_id, r.emoji);
        for (const r of all(`SELECT parent_id, COUNT(*) AS n FROM feed WHERE parent_id IN (${q}) AND hidden = 0 GROUP BY parent_id`, ...ids)) replies.set(r.parent_id, r.n);
        const images = new Map();
        for (const r of all(`SELECT feed_id, id FROM feed_images WHERE feed_id IN (${q})`, ...ids)) images.set(r.feed_id, r.id);
        const authors = new Map();
        for (const a of all(`SELECT discord_id, profile_slug AS slug, guild_id AS guild FROM users WHERE discord_id IN (${[...new Set(list.map(r => r.discord_id))].map(() => "?").join(",")})`, ...new Set(list.map(r => r.discord_id)))) authors.set(a.discord_id, a);
        return list.map(r => {
            let data = null; try { data = r.data ? JSON.parse(r.data) : null; } catch { /* old row */ }
            return { id: r.id, author: r.discord_id, slug: authors.get(r.discord_id)?.slug ?? null, guild: authors.get(r.discord_id)?.guild ?? null, kind: r.kind, appid: r.appid, game: r.game, body: r.body, parentId: r.parent_id, data, at: r.at, hidden: Boolean(r.hidden),
                reactions: reacts.get(r.id) ?? {}, mine: mine.get(r.id) ?? null, replies: replies.get(r.id) ?? 0, image: images.get(r.id) ?? null };
        });
    }

    /** One page of the feed, newest first. scope: "following" (people you follow and you), "everyone", "mine" or a single author. */
    function feed(viewer, { scope = "everyone", before = null, limit = 20, appid = null, author = null, guilds = null } = {}) {
        const where = ["f.parent_id IS NULL", "(f.hidden = 0 OR (f.hidden = 1 AND f.discord_id = ?))", `(${LIVE} OR f.discord_id = ?)`], args = [viewer ?? "", viewer ?? ""];
        if (viewer) { where.push(NOT_BLOCKED(viewer)); args.push(viewer, viewer); }
        if (scope === "following" && viewer) { where.push("(f.discord_id = ? OR f.discord_id IN (SELECT followee FROM follows WHERE follower = ?))"); args.push(viewer, viewer); }
        if (scope === "mine" && viewer) { where.push("f.discord_id = ?"); args.push(viewer); }
        if (scope === "servers") { if (!guilds?.length) return { items: [], more: false }; where.push(inGuilds("f.discord_id", guilds)); args.push(...guilds, ...guilds); }
        if (author) { where.push("f.discord_id = ?"); args.push(author); }
        if (appid) { where.push("f.appid = ?"); args.push(Number(appid)); }
        if (before) { where.push("f.id < ?"); args.push(Number(before)); }
        const lim = Math.min(Math.max(Number(limit) || 20, 1), 50);
        const found = all(`SELECT f.* FROM feed f WHERE ${where.join(" AND ")} ORDER BY f.id DESC LIMIT ?`, ...args, lim + 1);
        const more = found.length > lim;
        return { items: decorate(found.slice(0, lim), viewer), more };
    }
    /** One post with its replies, oldest reply first. Null when it is gone or the viewer may not see it. */
    function thread(feedId, viewer) {
        const f = get(`SELECT f.* FROM feed f WHERE f.id = ? AND f.parent_id IS NULL AND (f.hidden = 0 OR f.discord_id = ?) AND (${LIVE} OR f.discord_id = ?)${viewer ? " AND " + NOT_BLOCKED(viewer) : ""}`, Number(feedId), viewer ?? "", viewer ?? "", ...(viewer ? [viewer, viewer] : []));
        if (!f) return null;
        const replies = all(`SELECT f.* FROM feed f WHERE f.parent_id = ? AND (f.hidden = 0 OR f.discord_id = ?)${viewer ? " AND " + NOT_BLOCKED(viewer) : ""} ORDER BY f.id ASC LIMIT 200`, f.id, viewer ?? "", ...(viewer ? [viewer, viewer] : []));
        const [item, ...rest] = decorate([f, ...replies], viewer);
        return { item, replies: rest };
    }

    // ---- reporting and moderation
    /** Three different people reporting an item hides it until the bot owner has looked. */
    function report(feedId, reporter, reason) {
        const f = get("SELECT * FROM feed WHERE id = ?", Number(feedId));
        if (!f || f.discord_id === reporter) return null;
        const snap = f.kind === "post" ? String(f.body ?? "") : `${f.kind}: ${f.game ?? ""}`;
        run("INSERT OR IGNORE INTO feed_reports (feed_id, author_id, reporter_id, reason, snapshot, at) VALUES (?,?,?,?,?,?)", f.id, f.discord_id, reporter, String(reason ?? "").slice(0, 200), snap.slice(0, 400), now());
        const n = get("SELECT COUNT(*) AS n FROM feed_reports WHERE feed_id = ?", f.id).n;
        if (n >= REPORTS_TO_HIDE && !f.hidden) run("UPDATE feed SET hidden = 1 WHERE id = ?", f.id);
        return { reports: n, hidden: n >= REPORTS_TO_HIDE };
    }
    const listReports = () => rows(`SELECT r.feed_id, r.author_id, COUNT(*) AS reports, MAX(r.at) AS last_at, MAX(r.snapshot) AS snapshot, GROUP_CONCAT(NULLIF(r.reason, ''), ' | ') AS reasons,
        (SELECT hidden FROM feed WHERE id = r.feed_id) AS hidden, (SELECT profile_slug FROM users WHERE discord_id = r.author_id) AS slug
        FROM feed_reports r GROUP BY r.feed_id ORDER BY MAX(r.at) DESC LIMIT 100`);
    const dismissReports = feedId => { run("DELETE FROM feed_reports WHERE feed_id = ?", Number(feedId)); run("UPDATE feed SET hidden = 0 WHERE id = ? AND hidden = 1", Number(feedId)); };
    const listSocialBans = () => rows("SELECT b.discord_id, b.reason, b.at, (SELECT profile_slug FROM users WHERE discord_id = b.discord_id) AS slug FROM social_bans b ORDER BY b.at DESC");
    const banPoster = (id, reason = "") => { run("INSERT OR REPLACE INTO social_bans (discord_id, reason, at) VALUES (?,?,?)", id, String(reason).slice(0, 200), now()); run("UPDATE feed SET hidden = 1 WHERE discord_id = ? AND kind = 'post' AND hidden = 0", id); };
    const unbanPoster = id => { run("DELETE FROM social_bans WHERE discord_id = ?", id); };

    // ---- discovery
    /** Games people are talking about or finishing this week, across public pages. */
    function trendingGames(sinceMs, limit = 10, guilds = null) {
        const g = guilds?.length ? ` AND ${inGuilds("f.discord_id", guilds)}` : "";
        return rows(`SELECT f.appid, MAX(f.game) AS game, COUNT(DISTINCT f.discord_id) AS people, SUM(f.kind = 'post') AS posts, SUM(f.kind = 'finished') AS finishes
            FROM feed f WHERE f.appid IS NOT NULL AND f.parent_id IS NULL AND f.hidden = 0 AND f.at > ? AND ${LIVE}${g}
            GROUP BY f.appid ORDER BY people DESC, posts DESC, finishes DESC LIMIT ?`, sinceMs, ...(guilds?.length ? [...guilds, ...guilds] : []), limit);
    }
    /** The rarest achievements held by members with public pages. */
    function rareBoard(limit = 10, perPerson = 2, guilds = null) {
        const g = guilds?.length ? ` AND ${inGuilds("a.discord_id", guilds)}` : "";
        const found = rows(`SELECT a.appid, a.game, a.name, a.icon, a.pct, u.profile_slug AS slug, u.discord_id
            FROM ach_rare a JOIN users u ON u.discord_id = a.discord_id
            WHERE u.profile_public = 1 AND u.profile_slug IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profile_ext p WHERE p.discord_id = a.discord_id AND p.blocked = 1)${g}
            ORDER BY a.pct ASC, a.game ASC LIMIT ?`, ...(guilds?.length ? [...guilds, ...guilds] : []), limit * 8);
        const seen = new Map(), out = [];
        for (const r of found) { const n = seen.get(r.discord_id) ?? 0; if (n >= perPerson) continue; seen.set(r.discord_id, n + 1); out.push({ ...r, pct: Math.round(r.pct * 10) / 10 }); if (out.length >= limit) break; }
        return out;
    }
    /**
     * Three small boards for some servers: who has been posting, who has finished the most games lately, and who holds the most
     * rare achievements. Only members whose public page is on appear, and nothing here shows hours or anything a page keeps private.
     */
    function leaderboards(guilds, { postsSince, finishedSince, limit = 5 }) {
        if (!guilds?.length) return { active: [], finished: [], rare: [] };
        const ok = col => `${col} IN (SELECT discord_id FROM users WHERE profile_public = 1 AND profile_slug IS NOT NULL) AND ${col} NOT IN (SELECT discord_id FROM profile_ext WHERE blocked = 1) AND ${col} NOT IN (SELECT discord_id FROM social_bans)`;
        const g2 = [...guilds, ...guilds];
        const top = (sql, args) => rows(sql, ...args).map(r => ({ id: r.id, n: r.n }));
        return {
            active: top(`SELECT f.discord_id AS id, COUNT(*) AS n FROM feed f WHERE f.kind = 'post' AND f.hidden = 0 AND f.at >= ? AND ${inGuilds("f.discord_id", guilds)} AND ${ok("f.discord_id")} GROUP BY f.discord_id ORDER BY n DESC, MAX(f.at) DESC LIMIT ?`, [postsSince, ...g2, limit]),
            finished: top(`SELECT l.discord_id AS id, COUNT(*) AS n FROM library l WHERE l.status = 'finished' AND l.status_at >= ? AND ${inGuilds("l.discord_id", guilds)} AND ${ok("l.discord_id")} GROUP BY l.discord_id ORDER BY n DESC LIMIT ?`, [finishedSince, ...g2, limit]),
            rare: top(`SELECT a.discord_id AS id, COUNT(*) AS n FROM ach_rare a WHERE ${inGuilds("a.discord_id", guilds)} AND ${ok("a.discord_id")} GROUP BY a.discord_id ORDER BY n DESC LIMIT ?`, [...g2, limit])
        };
    }
    /** Public pages whose libraries overlap yours the most, skipping people you follow or block. */
    function similarPeople(viewer, limit = 8) {
        return rows(`SELECT u.discord_id, u.profile_slug AS slug, COUNT(*) AS shared FROM library a JOIN library b ON b.itad_id = a.itad_id AND b.discord_id <> a.discord_id
            JOIN users u ON u.discord_id = b.discord_id
            WHERE a.discord_id = ? AND u.profile_public = 1 AND u.profile_slug IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower = ? AND f.followee = u.discord_id)
              AND NOT EXISTS (SELECT 1 FROM social_blocks k WHERE (k.discord_id = ? AND k.blocked_id = u.discord_id) OR (k.discord_id = u.discord_id AND k.blocked_id = ?))
              AND NOT EXISTS (SELECT 1 FROM profile_ext p WHERE p.discord_id = u.discord_id AND p.blocked = 1)
            GROUP BY u.discord_id HAVING shared >= 2 ORDER BY shared DESC LIMIT ?`, viewer, viewer, viewer, viewer, limit);
    }
    /** Members with a public page who own a game. */
    const gameOwners = (appid, limit = 12) => rows(`SELECT u.discord_id, u.profile_slug AS slug FROM library l JOIN users u ON u.discord_id = l.discord_id
        WHERE l.appid = ? AND u.profile_public = 1 AND u.profile_slug IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profile_ext p WHERE p.discord_id = u.discord_id AND p.blocked = 1) ORDER BY l.minutes DESC LIMIT ?`, Number(appid), limit);
    const ownerCount = appid => get(`SELECT COUNT(*) AS n FROM library l JOIN users u ON u.discord_id = l.discord_id WHERE l.appid = ? AND u.profile_public = 1 AND u.profile_slug IS NOT NULL`, Number(appid)).n;
    /** Two libraries side by side. */
    function compareLibraries(mine, theirs) {
        const a = rows("SELECT itad_id, title, minutes FROM library WHERE discord_id = ?", mine), b = rows("SELECT itad_id, title, minutes FROM library WHERE discord_id = ?", theirs);
        const have = new Set(a.map(g => g.itad_id)), their = new Set(b.map(g => g.itad_id));
        const byTitle = (x, y) => x.title.localeCompare(y.title);
        return {
            yours: a.length, theirs: b.length,
            shared: b.filter(g => have.has(g.itad_id)).map(g => g.title).sort((x, y) => x.localeCompare(y)),
            theyHave: b.filter(g => !have.has(g.itad_id)).sort(byTitle).map(g => g.title).slice(0, 60),
            youHave: a.filter(g => !their.has(g.itad_id)).sort(byTitle).map(g => g.title).slice(0, 60)
        };
    }

    // ---- digest
    /** What the people you follow did since `since`: counts and a few highlights. */
    function digestFor(id, since) {
        const base = `FROM feed f JOIN follows fo ON fo.followee = f.discord_id AND fo.follower = ? WHERE f.parent_id IS NULL AND f.hidden = 0 AND f.at > ? AND ${LIVE} AND ${NOT_BLOCKED(id)}`;
        const args = [id, since, id, id];
        const counts = rows(`SELECT f.kind, COUNT(*) AS n ${base} GROUP BY f.kind`, ...args);
        const items = decorate(all(`SELECT f.* ${base} ORDER BY f.id DESC LIMIT 40`, ...args), id);
        const people = get(`SELECT COUNT(DISTINCT f.discord_id) AS n ${base}`, ...args).n;
        return { counts: Object.fromEntries(counts.map(c => [c.kind, c.n])), items, people };
    }
    const socialDigestUsers = () => rows("SELECT discord_id, last_digest FROM social_prefs WHERE digest = 1");

    function prune() {
        const t = now();
        run("DELETE FROM feed WHERE kind <> 'post' AND hidden = 0 AND at < ?", t - EVENT_KEEP_MS);
        run("DELETE FROM feed_reactions WHERE feed_id NOT IN (SELECT id FROM feed)");
        run("DELETE FROM feed_reports WHERE feed_id NOT IN (SELECT id FROM feed)");
        run("DELETE FROM feed_images WHERE feed_id NOT IN (SELECT id FROM feed)");
        run("DELETE FROM feed_images WHERE at < ?", t - IMAGE_KEEP_MS);
    }
    /** Everything a member left behind goes when they delete their data. */
    function forgetSocialUser(id) {
        run("DELETE FROM feed_reactions WHERE feed_id IN (SELECT id FROM feed WHERE discord_id = ? OR parent_id IN (SELECT id FROM feed WHERE discord_id = ?))", id, id);
        run("DELETE FROM feed_images WHERE discord_id = ? OR feed_id IN (SELECT id FROM feed WHERE discord_id = ?)", id, id);
        run("DELETE FROM feed WHERE discord_id = ? OR parent_id IN (SELECT id FROM feed WHERE discord_id = ?)", id, id);
        for (const [t, c] of [["guestbook", "owner_id"], ["guestbook", "author_id"], ["follows", "follower"], ["follows", "followee"], ["feed_reactions", "discord_id"], ["social_blocks", "discord_id"], ["social_blocks", "blocked_id"], ["feed_reports", "reporter_id"], ["feed_reports", "author_id"], ["social_prefs", "discord_id"], ["user_guilds", "discord_id"]]) run(`DELETE FROM ${t} WHERE ${c} = ?`, id);
    }

    return { guildSocial, setGuildSocial, socialGuildStats, guildMembers, rememberGuilds, userGuildIds, getPrefs, setPrefs, leaderboards, guestbookList, guestbookPost, guestbookEntry, guestbookDelete, markDigest, isSocialBanned, blockedEither, setBlock, listBlocks, follow, isFollowing, followCounts, listFollowers, listFollowing, addEvent, trophyEvents, createPost, addPostImage, getPostImage, deleteItem, getItem, react, feed, thread, report, listReports, dismissReports, listSocialBans, banPoster, unbanPoster, trendingGames, rareBoard, similarPeople, gameOwners, ownerCount, compareLibraries, digestFor, socialDigestUsers, pruneFeed: prune, forgetSocialUser };
}

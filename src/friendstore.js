// Friends you want to gift to: a nickname, an optional birthday (month and day only) and their public wishlist page name.
export const friendSchema = `
CREATE TABLE IF NOT EXISTS friends (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id  TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    slug        TEXT,
    birthday    TEXT,
    reminded_in INTEGER,
    UNIQUE (discord_id, name)
);
-- A member's own birthday (month and day only). \`share\` = 1 lets people who have their page on their friends list get the reminder.
CREATE TABLE IF NOT EXISTS user_birthdays (
    discord_id TEXT PRIMARY KEY REFERENCES users(discord_id) ON DELETE CASCADE,
    mmdd       TEXT NOT NULL,
    share      INTEGER NOT NULL DEFAULT 0
);`;

export const MAX_FRIENDS = 100;
export const BIRTHDAY_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Days from today (UTC) to the next occurrence of MM-DD. 0 means today. Feb 29 counts as Mar 1 in a common year. */
export function daysUntilBirthday(mmdd, nowMs) {
    const [m, d] = mmdd.split("-").map(Number);
    const t = new Date(nowMs), today = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
    const at = y => { const day = Date.UTC(y, m - 1, d); return new Date(day).getUTCMonth() === m - 1 ? day : Date.UTC(y, m - 1, d + 1); };
    let next = at(t.getUTCFullYear());
    if (next < today) next = at(t.getUTCFullYear() + 1);
    return Math.round((next - today) / 86400_000);
}

export function friendStore({ run, get, all, now }) {
    const countFriends = id => get("SELECT COUNT(*) AS n FROM friends WHERE discord_id = ?", id).n;
    const listFriends = id => all("SELECT id, name, slug, birthday, auto FROM friends WHERE discord_id = ? ORDER BY name COLLATE NOCASE", id);
    function addFriend(id, { name, slug = null, birthday = null }) {
        const have = get("SELECT id FROM friends WHERE discord_id = ? AND name = ? COLLATE NOCASE", id, name);
        if (have) { run("UPDATE friends SET slug = COALESCE(?, slug), birthday = COALESCE(?, birthday) WHERE id = ?", slug, birthday, have.id); return { updated: true }; }
        if (countFriends(id) >= MAX_FRIENDS) return { full: true };
        run("INSERT INTO friends (discord_id, name, slug, birthday) VALUES (?,?,?,?)", id, name, slug, birthday);
        return { added: true };
    }
    const getBirthday = id => get("SELECT mmdd, share FROM user_birthdays WHERE discord_id = ?", id) ?? null;
    function setBirthday(id, mmdd, share) {
        if (!mmdd) return run("DELETE FROM user_birthdays WHERE discord_id = ?", id);
        return run("INSERT INTO user_birthdays (discord_id, mmdd, share) VALUES (?,?,?) ON CONFLICT(discord_id) DO UPDATE SET mmdd = excluded.mmdd, share = excluded.share", id, mmdd, share ? 1 : 0);
    }
    /** The birthday a member chose to share, by their public page name. */
    const sharedBirthdayBySlug = slug => get("SELECT b.mmdd FROM user_birthdays b JOIN users u ON u.discord_id = b.discord_id WHERE u.profile_slug = ? COLLATE NOCASE AND u.profile_public = 1 AND b.share = 1", slug)?.mmdd ?? null;
    const friendBySlug = (id, slug) => get("SELECT id, name, slug, birthday, auto FROM friends WHERE discord_id = ? AND slug = ? COLLATE NOCASE", id, slug) ?? null;
    /** A friend that came from following their page: skipped when they are already a friend or the list is full, and the nickname is made unique. */
    function addFollowedFriend(id, { name, slug }) {
        if (friendBySlug(id, slug)) return { exists: true };
        if (countFriends(id) >= MAX_FRIENDS) return { full: true };
        let n = name, i = 1;
        while (get("SELECT 1 FROM friends WHERE discord_id = ? AND name = ? COLLATE NOCASE", id, n)) n = `${name.slice(0, 26)} ${++i}`;
        run("INSERT INTO friends (discord_id, name, slug, birthday, auto) VALUES (?,?,?,NULL,1)", id, n, slug);
        return { added: true, name: n };
    }
    /** Unfollowing removes a friend the follow created, as long as nothing was added to it (a birthday). */
    const dropFollowedFriend = (id, slug) => run("DELETE FROM friends WHERE discord_id = ? AND slug = ? COLLATE NOCASE AND auto = 1 AND birthday IS NULL", id, slug).changes > 0;
    const setFriendBirthday = (id, name, birthday) => run("UPDATE friends SET birthday = ?, reminded_in = NULL WHERE discord_id = ? AND name = ? COLLATE NOCASE", birthday, id, name).changes > 0;
    const removeFriend = (id, name) => run("DELETE FROM friends WHERE discord_id = ? AND name = ? COLLATE NOCASE", id, name).changes > 0;
    const getFriend = (id, name) => get("SELECT id, name, slug, birthday FROM friends WHERE discord_id = ? AND name = ? COLLATE NOCASE", id, name) ?? null;
    /** Everyone with a birthday, for the daily reminder run. */
    const friendsWithBirthdays = () => all("SELECT id, discord_id, name, slug, birthday, reminded_in FROM friends WHERE birthday IS NOT NULL OR slug IS NOT NULL");
    const markFriendReminded = (id, year) => run("UPDATE friends SET reminded_in = ? WHERE id = ?", year, id);
    return { getBirthday, setBirthday, sharedBirthdayBySlug, countFriends, listFriends, addFriend, friendBySlug, addFollowedFriend, dropFollowedFriend, setFriendBirthday, removeFriend, getFriend, friendsWithBirthdays, markFriendReminded };
}

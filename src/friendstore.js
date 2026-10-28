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
);`;

export const MAX_FRIENDS = 20;
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
    const listFriends = id => all("SELECT id, name, slug, birthday FROM friends WHERE discord_id = ? ORDER BY name COLLATE NOCASE", id);
    function addFriend(id, { name, slug = null, birthday = null }) {
        const have = get("SELECT id FROM friends WHERE discord_id = ? AND name = ? COLLATE NOCASE", id, name);
        if (have) { run("UPDATE friends SET slug = COALESCE(?, slug), birthday = COALESCE(?, birthday) WHERE id = ?", slug, birthday, have.id); return { updated: true }; }
        if (countFriends(id) >= MAX_FRIENDS) return { full: true };
        run("INSERT INTO friends (discord_id, name, slug, birthday) VALUES (?,?,?,?)", id, name, slug, birthday);
        return { added: true };
    }
    const removeFriend = (id, name) => run("DELETE FROM friends WHERE discord_id = ? AND name = ? COLLATE NOCASE", id, name).changes > 0;
    const getFriend = (id, name) => get("SELECT id, name, slug, birthday FROM friends WHERE discord_id = ? AND name = ? COLLATE NOCASE", id, name) ?? null;
    /** Everyone with a birthday, for the daily reminder run. */
    const friendsWithBirthdays = () => all("SELECT id, discord_id, name, slug, birthday, reminded_in FROM friends WHERE birthday IS NOT NULL");
    const markFriendReminded = (id, year) => run("UPDATE friends SET reminded_in = ? WHERE id = ?", year, id);
    return { countFriends, listFriends, addFriend, removeFriend, getFriend, friendsWithBirthdays, markFriendReminded };
}

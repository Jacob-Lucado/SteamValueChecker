// Storage for the server tools: role menus, the starboard, polls, suggestions and custom commands.
// Starboard and suggestion settings are one small JSON value per server in the meta table, so they need no table of their own.

export const toolsSchema = `
CREATE TABLE IF NOT EXISTS push_subs (
    endpoint   TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    fails      INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subs(user_id);
CREATE TABLE IF NOT EXISTS role_menus (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT NOT NULL,
    channel_id  TEXT NOT NULL,
    message_id  TEXT,
    title       TEXT NOT NULL,
    description TEXT,
    mode        TEXT NOT NULL DEFAULT 'toggle',
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_role_menus_guild ON role_menus(guild_id);
CREATE TABLE IF NOT EXISTS role_menu_items (
    menu_id  INTEGER NOT NULL REFERENCES role_menus(id) ON DELETE CASCADE,
    role_id  TEXT NOT NULL,
    label    TEXT NOT NULL,
    emoji    TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (menu_id, role_id)
);
CREATE TABLE IF NOT EXISTS starboard_posts (
    guild_id       TEXT NOT NULL,
    source_id      TEXT NOT NULL,
    source_channel TEXT NOT NULL,
    board_id       TEXT NOT NULL,
    board_channel  TEXT NOT NULL,
    author_id      TEXT,
    stars          INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL,
    PRIMARY KEY (guild_id, source_id)
);
CREATE TABLE IF NOT EXISTS server_polls (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    question   TEXT NOT NULL,
    options    TEXT NOT NULL,
    multi      INTEGER NOT NULL DEFAULT 0,
    ends_at    INTEGER,
    closed     INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_server_polls_guild ON server_polls(guild_id, closed);
CREATE TABLE IF NOT EXISTS server_poll_votes (
    poll_id INTEGER NOT NULL REFERENCES server_polls(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    option  INTEGER NOT NULL,
    PRIMARY KEY (poll_id, user_id, option)
);
CREATE TABLE IF NOT EXISTS suggestions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    channel_id TEXT,
    message_id TEXT,
    author_id  TEXT NOT NULL,
    text       TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'open',
    note       TEXT,
    decided_by TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_suggestions_guild ON suggestions(guild_id, id);
CREATE TABLE IF NOT EXISTS suggestion_votes (
    suggestion_id INTEGER NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
    user_id       TEXT NOT NULL,
    vote          INTEGER NOT NULL,
    PRIMARY KEY (suggestion_id, user_id)
);
CREATE TABLE IF NOT EXISTS custom_commands (
    guild_id   TEXT NOT NULL,
    name       TEXT NOT NULL,
    response   TEXT NOT NULL,
    created_by TEXT,
    uses       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, name)
);`;

export const MAX_MENUS = 10, MAX_MENU_ROLES = 25, MAX_TAGS = 100, MAX_OPEN_POLLS = 10;

export function toolsStore({ run, get, all, clean, now, getMeta, setMeta }) {
    // ---- role menus
    const createRoleMenu = m => Number(run("INSERT INTO role_menus (guild_id, channel_id, message_id, title, description, mode, created_at) VALUES (?,?,?,?,?,?,?)",
        m.guild_id, m.channel_id, m.message_id ?? null, m.title, m.description ?? null, m.mode === "single" ? "single" : "toggle", now()).lastInsertRowid);
    const getRoleMenu = id => clean(get("SELECT * FROM role_menus WHERE id = ?", id)) ?? null;
    const listRoleMenus = guildId => all("SELECT * FROM role_menus WHERE guild_id = ? ORDER BY id", guildId).map(clean);
    const countRoleMenus = guildId => get("SELECT COUNT(*) AS n FROM role_menus WHERE guild_id = ?", guildId).n;
    const setRoleMenuMessage = (id, messageId, channelId = null) => run("UPDATE role_menus SET message_id = ?, channel_id = COALESCE(?, channel_id) WHERE id = ?", messageId, channelId, id);
    const deleteRoleMenu = (id, guildId) => run("DELETE FROM role_menus WHERE id = ? AND guild_id = ?", id, guildId).changes > 0;
    const roleMenuItems = menuId => all("SELECT * FROM role_menu_items WHERE menu_id = ? ORDER BY position, rowid", menuId).map(clean);
    const addRoleMenuItem = (menuId, roleId, label, emoji) => {
        const pos = get("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM role_menu_items WHERE menu_id = ?", menuId).p;
        run("INSERT INTO role_menu_items (menu_id, role_id, label, emoji, position) VALUES (?,?,?,?,?) ON CONFLICT(menu_id, role_id) DO UPDATE SET label = excluded.label, emoji = excluded.emoji", menuId, roleId, label, emoji ?? null, pos);
    };
    const removeRoleMenuItem = (menuId, roleId) => run("DELETE FROM role_menu_items WHERE menu_id = ? AND role_id = ?", menuId, roleId).changes > 0;
    const forgetRole = (guildId, roleId) => run("DELETE FROM role_menu_items WHERE role_id = ? AND menu_id IN (SELECT id FROM role_menus WHERE guild_id = ?)", roleId, guildId).changes;

    // ---- starboard
    const getStarPost = (guildId, sourceId) => clean(get("SELECT * FROM starboard_posts WHERE guild_id = ? AND source_id = ?", guildId, sourceId)) ?? null;
    const saveStarPost = p => run(`INSERT INTO starboard_posts (guild_id, source_id, source_channel, board_id, board_channel, author_id, stars, created_at) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(guild_id, source_id) DO UPDATE SET stars = excluded.stars, board_id = excluded.board_id, board_channel = excluded.board_channel`,
        p.guild_id, p.source_id, p.source_channel, p.board_id, p.board_channel, p.author_id ?? null, p.stars, now());
    const deleteStarPost = (guildId, sourceId) => run("DELETE FROM starboard_posts WHERE guild_id = ? AND source_id = ?", guildId, sourceId).changes > 0;
    const topStarPosts = (guildId, limit = 5) => all("SELECT * FROM starboard_posts WHERE guild_id = ? ORDER BY stars DESC, created_at DESC LIMIT ?", guildId, limit).map(clean);
    const starCount = guildId => get("SELECT COUNT(*) AS n FROM starboard_posts WHERE guild_id = ?", guildId).n;
    const pruneStarPosts = (keepMs = 365 * 86400_000) => run("DELETE FROM starboard_posts WHERE created_at < ?", now() - keepMs).changes;

    // ---- polls
    const createPoll = p => Number(run("INSERT INTO server_polls (guild_id, channel_id, question, options, multi, ends_at, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)",
        p.guild_id, p.channel_id, p.question, JSON.stringify(p.options), p.multi ? 1 : 0, p.ends_at ?? null, p.created_by ?? null, now()).lastInsertRowid);
    const parsePoll = r => { const p = clean(r); if (!p) return null; try { p.options = JSON.parse(p.options); } catch { p.options = []; } return p; };
    const getPoll = id => parsePoll(get("SELECT * FROM server_polls WHERE id = ?", id));
    const setPollMessage = (id, messageId) => run("UPDATE server_polls SET message_id = ? WHERE id = ?", messageId, id);
    const listPolls = (guildId, limit = 20) => all("SELECT * FROM server_polls WHERE guild_id = ? ORDER BY id DESC LIMIT ?", guildId, limit).map(parsePoll);
    const countOpenPolls = guildId => get("SELECT COUNT(*) AS n FROM server_polls WHERE guild_id = ? AND closed = 0", guildId).n;
    const closePoll = (id, guildId = null) => run(`UPDATE server_polls SET closed = 1 WHERE id = ? AND closed = 0${guildId ? " AND guild_id = ?" : ""}`, ...(guildId ? [id, guildId] : [id])).changes > 0;
    const pollsDue = at => all("SELECT * FROM server_polls WHERE closed = 0 AND ends_at IS NOT NULL AND ends_at <= ?", at).map(parsePoll);
    const pollVotes = pollId => all("SELECT user_id, option FROM server_poll_votes WHERE poll_id = ?", pollId).map(clean);
    /** Records a vote. A single-choice poll replaces the person's earlier pick; a multiple-choice one toggles it. Returns the new list of their picks. */
    const castVote = (pollId, userId, option, multi) => {
        const had = get("SELECT 1 AS x FROM server_poll_votes WHERE poll_id = ? AND user_id = ? AND option = ?", pollId, userId, option);
        if (!multi) run("DELETE FROM server_poll_votes WHERE poll_id = ? AND user_id = ?", pollId, userId);
        if (had) run("DELETE FROM server_poll_votes WHERE poll_id = ? AND user_id = ? AND option = ?", pollId, userId, option);
        else run("INSERT OR IGNORE INTO server_poll_votes (poll_id, user_id, option) VALUES (?,?,?)", pollId, userId, option);
        return all("SELECT option FROM server_poll_votes WHERE poll_id = ? AND user_id = ? ORDER BY option", pollId, userId).map(r => r.option);
    };
    const prunePolls2 = (keepMs = 90 * 86400_000) => run("DELETE FROM server_polls WHERE closed = 1 AND created_at < ?", now() - keepMs).changes;

    // ---- suggestions
    const createSuggestion = s => Number(run("INSERT INTO suggestions (guild_id, channel_id, author_id, text, created_at) VALUES (?,?,?,?,?)", s.guild_id, s.channel_id ?? null, s.author_id, s.text, now()).lastInsertRowid);
    const getSuggestion = id => clean(get("SELECT * FROM suggestions WHERE id = ?", id)) ?? null;
    const setSuggestionMessage = (id, messageId) => run("UPDATE suggestions SET message_id = ? WHERE id = ?", messageId, id);
    const listSuggestions = (guildId, { status = null, limit = 30 } = {}) => all(`SELECT * FROM suggestions WHERE guild_id = ?${status ? " AND status = ?" : ""} ORDER BY id DESC LIMIT ?`, ...(status ? [guildId, status, limit] : [guildId, limit])).map(clean);
    const decideSuggestion = (id, guildId, status, note, by) => run("UPDATE suggestions SET status = ?, note = ?, decided_by = ? WHERE id = ? AND guild_id = ?", status, note ?? null, by ?? null, id, guildId).changes > 0;
    const suggestionVotes = id => { const r = all("SELECT vote, COUNT(*) AS n FROM suggestion_votes WHERE suggestion_id = ? GROUP BY vote", id); return { up: r.find(x => x.vote === 1)?.n ?? 0, down: r.find(x => x.vote === -1)?.n ?? 0 }; };
    const voteSuggestion = (id, userId, vote) => {
        const cur = get("SELECT vote FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?", id, userId);
        if (cur?.vote === vote) run("DELETE FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?", id, userId);
        else run("INSERT INTO suggestion_votes (suggestion_id, user_id, vote) VALUES (?,?,?) ON CONFLICT(suggestion_id, user_id) DO UPDATE SET vote = excluded.vote", id, userId, vote);
        return suggestionVotes(id);
    };
    const lastSuggestionAt = (guildId, userId) => get("SELECT MAX(created_at) AS t FROM suggestions WHERE guild_id = ? AND author_id = ?", guildId, userId).t ?? 0;

    // ---- custom commands
    const getTag = (guildId, name) => clean(get("SELECT * FROM custom_commands WHERE guild_id = ? AND name = ?", guildId, name)) ?? null;
    const listTags = guildId => all("SELECT * FROM custom_commands WHERE guild_id = ? ORDER BY name", guildId).map(clean);
    const countTags = guildId => get("SELECT COUNT(*) AS n FROM custom_commands WHERE guild_id = ?", guildId).n;
    const saveTag = (guildId, name, response, by) => run(`INSERT INTO custom_commands (guild_id, name, response, created_by, created_at) VALUES (?,?,?,?,?)
        ON CONFLICT(guild_id, name) DO UPDATE SET response = excluded.response, created_by = excluded.created_by`, guildId, name, response, by ?? null, now());
    const deleteTag = (guildId, name) => run("DELETE FROM custom_commands WHERE guild_id = ? AND name = ?", guildId, name).changes > 0;
    const bumpTag = (guildId, name) => run("UPDATE custom_commands SET uses = uses + 1 WHERE guild_id = ? AND name = ?", guildId, name);

    // ---- settings (JSON in meta)
    const readJson = key => { try { const v = JSON.parse(getMeta(key) ?? "null"); return v && typeof v === "object" ? v : null; } catch { return null; } };
    const getToolSetting = (kind, guildId) => readJson(`${kind}:${guildId}`);
    const setToolSetting = (kind, guildId, value) => setMeta(`${kind}:${guildId}`, JSON.stringify(value));
    /** Everything these tools keep for a server, for when it is removed. */
    const forgetToolsGuild = guildId => {
        for (const t of ["role_menus", "starboard_posts", "server_polls", "suggestions", "custom_commands"]) run(`DELETE FROM ${t} WHERE guild_id = ?`, guildId);
        setMeta(`starboard:${guildId}`, "null"); setMeta(`suggest:${guildId}`, "null");
    };

    /** Servers that post playtime milestones, where this person is a member and has a public page. */
    const milestoneTargets = id => all(`SELECT c.guild_id, c.milestone_channel FROM community c WHERE c.milestone_channel IS NOT NULL
        AND c.guild_id IN (SELECT guild_id FROM users WHERE discord_id = ? AND guild_id IS NOT NULL UNION SELECT guild_id FROM user_guilds WHERE discord_id = ?)
        AND (SELECT profile_public FROM users WHERE discord_id = ?) = 1`, id, id, id).map(clean);
    /** Hours played in the last week per listed server (needs at least 3 players so nobody is singled out). */
    const weeklyBoard = (sinceDay, guildIds) => {
        if (!guildIds.length) return [];
        const q = guildIds.map(() => "?").join(",");
        return all(`SELECT m.guild_id, SUM(p.minutes) AS minutes, COUNT(DISTINCT p.discord_id) AS players FROM playtime_log p
            JOIN (SELECT discord_id, guild_id FROM users WHERE guild_id IS NOT NULL UNION SELECT discord_id, guild_id FROM user_guilds) m ON m.discord_id = p.discord_id
            WHERE p.day >= ? AND m.guild_id IN (${q}) GROUP BY m.guild_id HAVING players >= 3 ORDER BY minutes DESC LIMIT 10`, sinceDay, ...guildIds).map(r => ({ guild_id: r.guild_id, hours: Math.round(Number(r.minutes) / 60), players: Number(r.players) }));
    };
    // ---- web push
    const addPushSub = (userId, sub) => run("INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created_at) VALUES (?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, fails = 0", sub.endpoint, userId, sub.p256dh, sub.auth, now());
    const pushSubs = userId => all("SELECT endpoint, p256dh, auth FROM push_subs WHERE user_id = ? ORDER BY created_at", userId).map(clean);
    const dropPushSub = endpoint => run("DELETE FROM push_subs WHERE endpoint = ?", endpoint).changes;
    const dropPushSubsOf = (userId, endpoint = null) => (endpoint ? run("DELETE FROM push_subs WHERE user_id = ? AND endpoint = ?", userId, endpoint) : run("DELETE FROM push_subs WHERE user_id = ?", userId)).changes;
    const countPushSubs = userId => get("SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?", userId).n;
    const failPushSub = endpoint => { run("UPDATE push_subs SET fails = fails + 1 WHERE endpoint = ?", endpoint); run("DELETE FROM push_subs WHERE endpoint = ? AND fails >= 5", endpoint); };
    return {
        weeklyBoard, milestoneTargets, addPushSub, pushSubs, dropPushSub, dropPushSubsOf, countPushSubs, failPushSub,
        createRoleMenu, getRoleMenu, listRoleMenus, countRoleMenus, setRoleMenuMessage, deleteRoleMenu, roleMenuItems, addRoleMenuItem, removeRoleMenuItem, forgetRole,
        getStarPost, saveStarPost, deleteStarPost, topStarPosts, starCount, pruneStarPosts,
        createPoll, getPoll, setPollMessage, listPolls, countOpenPolls, closePoll, pollsDue, pollVotes, castVote, prunePolls2,
        createSuggestion, getSuggestion, setSuggestionMessage, listSuggestions, decideSuggestion, suggestionVotes, voteSuggestion, lastSuggestionAt,
        getTag, listTags, countTags, saveTag, deleteTag, bumpTag,
        getToolSetting, setToolSetting, forgetToolsGuild
    };
}

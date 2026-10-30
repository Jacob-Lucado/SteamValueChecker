// Community tables: per-server settings, XP and levels, invite tracking and referrals, self-assign roles.
// Member data here is only Discord ids, XP counters and which invite a member joined with (listed in PRIVACY.md).

export const communitySchema = `
CREATE TABLE IF NOT EXISTS community (
    guild_id        TEXT PRIMARY KEY,
    welcome_on      INTEGER NOT NULL DEFAULT 1,
    welcome_channel TEXT,
    welcome_msg     TEXT,
    welcome_dm      INTEGER NOT NULL DEFAULT 0,
    leave_on        INTEGER NOT NULL DEFAULT 0,
    autorole_id     TEXT,
    log_channel     TEXT,
    xp_on           INTEGER NOT NULL DEFAULT 1,
    xp_mult         REAL NOT NULL DEFAULT 1,
    levelup_mode    TEXT NOT NULL DEFAULT 'same',
    levelup_channel TEXT,
    referral_xp     INTEGER NOT NULL DEFAULT 100,
    mod_role_id     TEXT,
    member_role_id  TEXT,
    setup_at        INTEGER
);
CREATE TABLE IF NOT EXISTS member_xp (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    xp       INTEGER NOT NULL DEFAULT 0,
    level    INTEGER NOT NULL DEFAULT 0,
    messages INTEGER NOT NULL DEFAULT 0,
    voice_minutes INTEGER NOT NULL DEFAULT 0,
    last_at  INTEGER,
    PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS member_xp_rank ON member_xp(guild_id, xp DESC);
CREATE TABLE IF NOT EXISTS level_roles (
    guild_id TEXT NOT NULL,
    level    INTEGER NOT NULL,
    role_id  TEXT NOT NULL,
    PRIMARY KEY (guild_id, level)
);
CREATE TABLE IF NOT EXISTS invite_joins (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    inviter_id TEXT,
    code       TEXT,
    joined_at  INTEGER NOT NULL,
    left_at    INTEGER
);
CREATE INDEX IF NOT EXISTS invite_joins_inviter ON invite_joins(guild_id, inviter_id);
CREATE INDEX IF NOT EXISTS invite_joins_user ON invite_joins(guild_id, user_id);
CREATE TABLE IF NOT EXISTS invite_links (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    code     TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS referral_rewards (
    guild_id TEXT NOT NULL,
    count    INTEGER NOT NULL,
    role_id  TEXT NOT NULL,
    PRIMARY KEY (guild_id, count)
);
CREATE TABLE IF NOT EXISTS community_usage (
    key     TEXT PRIMARY KEY,
    n       INTEGER NOT NULL DEFAULT 0,
    last_at INTEGER
);
CREATE TABLE IF NOT EXISTS mod_cases (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT NOT NULL,
    case_no     INTEGER NOT NULL,
    user_id     TEXT,
    mod_id      TEXT,
    action      TEXT NOT NULL,
    reason      TEXT,
    duration_s  INTEGER,
    cleared     INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS announcements (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    user_id    TEXT,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    title      TEXT,
    at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS announcements_guild ON announcements (guild_id, id);
CREATE INDEX IF NOT EXISTS mod_cases_guild ON mod_cases (guild_id, case_no);
CREATE INDEX IF NOT EXISTS mod_cases_user ON mod_cases (guild_id, user_id);
CREATE TABLE IF NOT EXISTS self_roles (
    guild_id TEXT NOT NULL,
    role_id  TEXT NOT NULL,
    label    TEXT NOT NULL,
    PRIMARY KEY (guild_id, role_id)
);
`;

const SETTABLE = new Set(["welcome_on", "welcome_channel", "welcome_msg", "welcome_dm", "leave_on", "autorole_id", "log_channel", "xp_on", "xp_mult",
    "levelup_mode", "levelup_channel", "referral_xp", "mod_role_id", "member_role_id", "setup_at", "verified_role_id", "mod_log_channel", "ping_deals", "ping_free", "ping_giveaway", "ping_lfg", "announce_channel", "rules_channel", "rules_text"]);

/** XP needed to go from `level` to the next one. */
export const xpForNext = level => 5 * level * level + 50 * level + 100;
/** Level and the progress inside it for a total XP amount. */
export function levelFromXp(xp) {
    let level = 0, left = Math.max(0, Math.floor(xp));
    while (left >= xpForNext(level)) { left -= xpForNext(level); level++; }
    return { level, into: left, need: xpForNext(level) };
}

export function communityStore({ run, get, all, clean, now }) {
    const getCommunity = guildId => clean(get("SELECT * FROM community WHERE guild_id = ?", guildId))
        ?? { guild_id: guildId, welcome_on: 1, welcome_channel: null, welcome_msg: null, welcome_dm: 0, leave_on: 0, autorole_id: null, log_channel: null, xp_on: 1, xp_mult: 1,
            levelup_mode: "same", levelup_channel: null, referral_xp: 100, mod_role_id: null, member_role_id: null, setup_at: null, verified_role_id: null, mod_log_channel: null, ping_deals: null, ping_free: null, ping_giveaway: null, ping_lfg: null, announce_channel: null, rules_channel: null, rules_text: null };
    function setCommunity(guildId, patch) {
        run("INSERT OR IGNORE INTO community (guild_id) VALUES (?)", guildId);
        for (const [k, v] of Object.entries(patch)) {
            if (!SETTABLE.has(k)) throw new Error(`Cannot set ${k}`);
            run(`UPDATE community SET ${k} = ? WHERE guild_id = ?`, v, guildId);
        }
        return getCommunity(guildId);
    }
    const allCommunity = () => all("SELECT * FROM community").map(clean);

    // ---- XP ----
    const getXp = (guildId, userId) => clean(get("SELECT * FROM member_xp WHERE guild_id = ? AND user_id = ?", guildId, userId));
    /** Adds XP and returns { before, after, xp, messages }. */
    function addXp(guildId, userId, amount, { message = false, voiceMinutes = 0 } = {}) {
        const cur = getXp(guildId, userId);
        const before = cur ? cur.level : 0;
        const xp = Math.max(0, (cur?.xp ?? 0) + Math.round(amount));
        const level = levelFromXp(xp).level;
        run("INSERT INTO member_xp (guild_id, user_id, xp, level, messages, voice_minutes, last_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(guild_id, user_id) DO UPDATE SET xp = excluded.xp, level = excluded.level, messages = messages + ?, voice_minutes = voice_minutes + ?, last_at = excluded.last_at",
            guildId, userId, xp, level, message ? 1 : 0, voiceMinutes, now(), message ? 1 : 0, voiceMinutes);
        return { before, after: level, xp };
    }
    const setXp = (guildId, userId, xp) => {
        const v = Math.max(0, Math.round(xp)), level = levelFromXp(v).level;
        run("INSERT INTO member_xp (guild_id, user_id, xp, level, last_at) VALUES (?,?,?,?,?) ON CONFLICT(guild_id, user_id) DO UPDATE SET xp = excluded.xp, level = excluded.level", guildId, userId, v, level, now());
    };
    const xpRank = (guildId, userId) => {
        const me = getXp(guildId, userId);
        if (!me) return null;
        return Number(get("SELECT COUNT(*) AS n FROM member_xp WHERE guild_id = ? AND (xp > ? OR (xp = ? AND user_id < ?))", guildId, me.xp, me.xp, userId).n) + 1;
    };
    const xpTop = (guildId, limit = 10) => all("SELECT user_id, xp, level, messages FROM member_xp WHERE guild_id = ? AND xp > 0 ORDER BY xp DESC, user_id LIMIT ?", guildId, limit).map(clean);
    const countXpMembers = guildId => Number(get("SELECT COUNT(*) AS n FROM member_xp WHERE guild_id = ? AND xp > 0", guildId).n);

    // ---- level roles ----
    const listLevelRoles = guildId => all("SELECT level, role_id FROM level_roles WHERE guild_id = ? ORDER BY level", guildId).map(clean);
    const setLevelRole = (guildId, level, roleId) => run("INSERT INTO level_roles (guild_id, level, role_id) VALUES (?,?,?) ON CONFLICT(guild_id, level) DO UPDATE SET role_id = excluded.role_id", guildId, level, roleId);
    const removeLevelRole = (guildId, level) => run("DELETE FROM level_roles WHERE guild_id = ? AND level = ?", guildId, level).changes > 0;

    // ---- invites and referrals ----
    const recordJoin = (guildId, userId, inviterId, code) => {
        run("UPDATE invite_joins SET left_at = ? WHERE guild_id = ? AND user_id = ? AND left_at IS NULL", now(), guildId, userId);
        return Number(run("INSERT INTO invite_joins (guild_id, user_id, inviter_id, code, joined_at) VALUES (?,?,?,?,?)", guildId, userId, inviterId ?? null, code ?? null, now()).lastInsertRowid);
    };
    const recordLeave = (guildId, userId) => run("UPDATE invite_joins SET left_at = ? WHERE guild_id = ? AND user_id = ? AND left_at IS NULL", now(), guildId, userId).changes > 0;
    /** Has this person ever been counted as a referral in this server? (a rejoin must not pay the bonus twice) */
    const everJoined = (guildId, userId) => Boolean(get("SELECT 1 AS x FROM invite_joins WHERE guild_id = ? AND user_id = ? LIMIT 1", guildId, userId));
    const inviteStats = (guildId, userId) => {
        const r = get("SELECT COUNT(*) AS total, SUM(CASE WHEN left_at IS NULL THEN 1 ELSE 0 END) AS active FROM invite_joins WHERE guild_id = ? AND inviter_id = ?", guildId, userId);
        return { total: Number(r.total), active: Number(r.active ?? 0), left: Number(r.total) - Number(r.active ?? 0) };
    };
    const inviteTop = (guildId, limit = 10) => all("SELECT inviter_id AS user_id, COUNT(*) AS total, SUM(CASE WHEN left_at IS NULL THEN 1 ELSE 0 END) AS active FROM invite_joins WHERE guild_id = ? AND inviter_id IS NOT NULL GROUP BY inviter_id ORDER BY active DESC, total DESC LIMIT ?", guildId, limit)
        .map(r => ({ user_id: r.user_id, total: Number(r.total), active: Number(r.active ?? 0) }));
    const whoInvited = (guildId, userId) => clean(get("SELECT inviter_id, code, joined_at FROM invite_joins WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1", guildId, userId));
    const getInviteLink = (guildId, userId) => get("SELECT code FROM invite_links WHERE guild_id = ? AND user_id = ?", guildId, userId)?.code ?? null;
    const setInviteLink = (guildId, userId, code) => run("INSERT INTO invite_links (guild_id, user_id, code) VALUES (?,?,?) ON CONFLICT(guild_id, user_id) DO UPDATE SET code = excluded.code", guildId, userId, code);
    const inviteLinkOwner = (guildId, code) => get("SELECT user_id FROM invite_links WHERE guild_id = ? AND code = ?", guildId, code)?.user_id ?? null;
    const listRewards = guildId => all("SELECT count, role_id FROM referral_rewards WHERE guild_id = ? ORDER BY count", guildId).map(clean);
    const setReward = (guildId, count, roleId) => run("INSERT INTO referral_rewards (guild_id, count, role_id) VALUES (?,?,?) ON CONFLICT(guild_id, count) DO UPDATE SET role_id = excluded.role_id", guildId, count, roleId);
    const removeReward = (guildId, count) => run("DELETE FROM referral_rewards WHERE guild_id = ? AND count = ?", guildId, count).changes > 0;

    // ---- self-assign roles ----
    const listSelfRoles = guildId => all("SELECT role_id, label FROM self_roles WHERE guild_id = ? ORDER BY label", guildId).map(clean);
    const addSelfRole = (guildId, roleId, label) => run("INSERT INTO self_roles (guild_id, role_id, label) VALUES (?,?,?) ON CONFLICT(guild_id, role_id) DO UPDATE SET label = excluded.label", guildId, roleId, label);
    const isSelfRole = (guildId, roleId) => Boolean(get("SELECT 1 AS x FROM self_roles WHERE guild_id = ? AND role_id = ?", guildId, roleId));

    // ---- XP page and the owner's usage view ----
    const xpPage = (guildId, limit, offset) => all("SELECT user_id, xp, level, messages, voice_minutes FROM member_xp WHERE guild_id = ? AND xp > 0 ORDER BY xp DESC, user_id LIMIT ? OFFSET ?", guildId, limit, offset).map(clean);
    const xpTotals = guildId => { const r = get("SELECT COUNT(*) AS members, COALESCE(SUM(xp),0) AS xp, COALESCE(SUM(messages),0) AS messages, COALESCE(SUM(voice_minutes),0) AS voice, COALESCE(MAX(level),0) AS top FROM member_xp WHERE guild_id = ? AND xp > 0", guildId); return { members: Number(r.members), xp: Number(r.xp), messages: Number(r.messages), voiceMinutes: Number(r.voice), topLevel: Number(r.top) }; };
    /** Counts how often a feature is used, so the owner can see what is worth keeping. */
    const bumpUsage = (key, n = 1) => { if (n > 0) run("INSERT INTO community_usage (key, n, last_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET n = n + excluded.n, last_at = excluded.last_at", key, n, now()); };
    const usageCounts = () => Object.fromEntries(all("SELECT key, n, last_at FROM community_usage").map(r => [r.key, { n: Number(r.n), last_at: r.last_at }]));
    /** Everything the Admin page shows about the community features, across all servers. */
    function adminCommunity() {
        const n = (sql, ...p) => { try { return Number(get(sql, ...p).n ?? 0); } catch { return 0; } };
        const servers = all(`SELECT c.guild_id AS id, c.setup_at, c.welcome_on, c.welcome_dm, c.leave_on, c.xp_on, c.xp_mult, c.autorole_id IS NOT NULL AS autorole,
            (SELECT COUNT(*) FROM member_xp m WHERE m.guild_id = c.guild_id AND m.xp > 0) AS xp_members, (SELECT COALESCE(SUM(xp),0) FROM member_xp m WHERE m.guild_id = c.guild_id) AS xp_total,
            (SELECT COUNT(*) FROM invite_joins j WHERE j.guild_id = c.guild_id) AS joins, (SELECT COUNT(*) FROM invite_joins j WHERE j.guild_id = c.guild_id AND j.inviter_id IS NOT NULL) AS referred,
            (SELECT COUNT(*) FROM level_roles l WHERE l.guild_id = c.guild_id) AS level_roles, (SELECT COUNT(*) FROM referral_rewards r WHERE r.guild_id = c.guild_id) AS rewards, (SELECT COUNT(*) FROM mod_cases x WHERE x.guild_id = c.guild_id) AS mod_cases
            FROM community c ORDER BY xp_total DESC LIMIT 100`).map(r => ({ ...clean(r), xp_members: Number(r.xp_members), xp_total: Number(r.xp_total), joins: Number(r.joins), referred: Number(r.referred), mod_cases: Number(r.mod_cases) }));
        const gw = {
            crossServer: n("SELECT COUNT(*) AS n FROM giveaways WHERE is_global = 1"), partner: n("SELECT COUNT(*) AS n FROM giveaways WHERE host_kind = 'partner'"),
            withSteps: n("SELECT COUNT(*) AS n FROM giveaways WHERE steps IS NOT NULL"), crossEntries: n("SELECT COUNT(*) AS n FROM giveaway_entries e JOIN giveaways g ON g.id = e.giveaway_id WHERE g.is_global = 1"),
            partners: all("SELECT host_name AS name, COUNT(*) AS giveaways, SUM((SELECT COUNT(*) FROM giveaway_entries e WHERE e.giveaway_id = giveaways.id)) AS entries FROM giveaways WHERE host_kind = 'partner' GROUP BY host_name ORDER BY giveaways DESC LIMIT 10").map(r => ({ name: r.name, giveaways: Number(r.giveaways), entries: Number(r.entries ?? 0) }))
        };
        return {
            totals: { servers: servers.length, built: servers.filter(s => s.setup_at).length, welcomeOn: servers.filter(s => s.welcome_on).length, xpOn: servers.filter(s => s.xp_on).length,
                xpMembers: n("SELECT COUNT(*) AS n FROM member_xp WHERE xp > 0"), xpTotal: n("SELECT COALESCE(SUM(xp),0) AS n FROM member_xp"), joins: n("SELECT COUNT(*) AS n FROM invite_joins"),
                referred: n("SELECT COUNT(*) AS n FROM invite_joins WHERE inviter_id IS NOT NULL"), inviteLinks: n("SELECT COUNT(*) AS n FROM invite_links"), levelRoles: n("SELECT COUNT(*) AS n FROM level_roles"), rewards: n("SELECT COUNT(*) AS n FROM referral_rewards"), selfRoles: n("SELECT COUNT(*) AS n FROM self_roles"), modCases: n("SELECT COUNT(*) AS n FROM mod_cases"), modServers: n("SELECT COUNT(DISTINCT guild_id) AS n FROM mod_cases"), activeWarnings: n("SELECT COUNT(*) AS n FROM mod_cases WHERE action = 'warn' AND cleared = 0") },
            usage: usageCounts(), servers, giveaways: gw
        };
    }

    /** What a member can see and delete about themselves. */
    // ---- moderation cases: one row per warning, timeout, kick, ban and so on ----
    function addCase(guildId, { userId = null, modId = null, action, reason = null, durationS = null }) {
        const no = (get("SELECT MAX(case_no) AS n FROM mod_cases WHERE guild_id = ?", guildId)?.n ?? 0) + 1;
        run("INSERT INTO mod_cases (guild_id, case_no, user_id, mod_id, action, reason, duration_s, created_at) VALUES (?,?,?,?,?,?,?,?)", guildId, no, userId, modId, action, reason, durationS, now());
        return getCase(guildId, no);
    }
    const getCase = (guildId, no) => clean(get("SELECT * FROM mod_cases WHERE guild_id = ? AND case_no = ?", guildId, no)) ?? null;
    const listCases = (guildId, { userId = null, limit = 25, offset = 0 } = {}) => userId
        ? all("SELECT * FROM mod_cases WHERE guild_id = ? AND user_id = ? ORDER BY case_no DESC LIMIT ? OFFSET ?", guildId, userId, limit, offset).map(clean)
        : all("SELECT * FROM mod_cases WHERE guild_id = ? ORDER BY case_no DESC LIMIT ? OFFSET ?", guildId, limit, offset).map(clean);
    const countCases = (guildId, userId = null) => (userId
        ? get("SELECT COUNT(*) AS n FROM mod_cases WHERE guild_id = ? AND user_id = ?", guildId, userId)
        : get("SELECT COUNT(*) AS n FROM mod_cases WHERE guild_id = ?", guildId)).n;
    const warnCount = (guildId, userId) => get("SELECT COUNT(*) AS n FROM mod_cases WHERE guild_id = ? AND user_id = ? AND action = 'warn' AND cleared = 0", guildId, userId).n;
    const clearWarns = (guildId, userId) => run("UPDATE mod_cases SET cleared = 1 WHERE guild_id = ? AND user_id = ? AND action = 'warn' AND cleared = 0", guildId, userId).changes;
    const addAnnouncement = (guildId, userId, channelId, messageId, title) => Number(run("INSERT INTO announcements (guild_id, user_id, channel_id, message_id, title, at) VALUES (?,?,?,?,?,?)", guildId, userId, channelId, messageId, title || null, now()).lastInsertRowid);
    const listAnnouncements = (guildId, limit = 10) => all("SELECT id, user_id, channel_id, message_id, title, at FROM announcements WHERE guild_id = ? ORDER BY id DESC LIMIT ?", guildId, limit).map(clean);
    const modCounts = guildId => Object.fromEntries(all("SELECT action, COUNT(*) AS n FROM mod_cases WHERE guild_id = ? GROUP BY action", guildId).map(r => [r.action, r.n]));

    const communityExport = userId => ({
        moderation: all("SELECT guild_id, case_no, action, reason, duration_s, cleared, created_at FROM mod_cases WHERE user_id = ?", userId).map(clean),
        xp: all("SELECT guild_id, xp, level, messages, voice_minutes FROM member_xp WHERE user_id = ?", userId).map(clean),
        joined_with: all("SELECT guild_id, inviter_id, code, joined_at, left_at FROM invite_joins WHERE user_id = ?", userId).map(clean),
        invited: all("SELECT guild_id, user_id, joined_at, left_at FROM invite_joins WHERE inviter_id = ?", userId).map(clean)
    });
    const forgetCommunityUser = userId => {
        run("DELETE FROM member_xp WHERE user_id = ?", userId);
        run("DELETE FROM invite_joins WHERE user_id = ?", userId);
        run("UPDATE invite_joins SET inviter_id = NULL WHERE inviter_id = ?", userId);
        run("DELETE FROM invite_links WHERE user_id = ?", userId);
        run("DELETE FROM mod_cases WHERE user_id = ?", userId);
        run("UPDATE mod_cases SET mod_id = NULL WHERE mod_id = ?", userId);
        run("UPDATE announcements SET user_id = NULL WHERE user_id = ?", userId);
    };
    /** Server gone: drop its community data. */
    const forgetCommunityGuild = guildId => { for (const t of ["community", "member_xp", "level_roles", "invite_joins", "invite_links", "referral_rewards", "self_roles", "mod_cases", "announcements"]) run(`DELETE FROM ${t} WHERE guild_id = ?`, guildId); };

    return { getCommunity, setCommunity, allCommunity, getXp, addXp, setXp, xpRank, xpTop, countXpMembers, listLevelRoles, setLevelRole, removeLevelRole,
        recordJoin, recordLeave, everJoined, inviteStats, inviteTop, whoInvited, getInviteLink, setInviteLink, inviteLinkOwner, listRewards, setReward, removeReward,
        listSelfRoles, addSelfRole, isSelfRole, xpPage, xpTotals, bumpUsage, usageCounts, adminCommunity, addCase, getCase, listCases, countCases, warnCount, clearWarns, modCounts, addAnnouncement, listAnnouncements, communityExport, forgetCommunityUser, forgetCommunityGuild };
}

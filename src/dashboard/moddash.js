// What the dashboard's Moderation page does. server.js checks the Discord permission each action needs, then calls these.
import { ModError, parseUserId } from "../moderation.js";

export class ModDashError extends Error { constructor(status, message) { super(message); this.status = status; } }

export function createModDash({ db, rest, mod, automod = null }) {
    const fail = (status, m) => { throw new ModDashError(status, m); };
    const wrap = async fn => { try { return await fn(); } catch (e) { if (e instanceof ModError) throw new ModDashError(e.status, e.message); throw e; } };
    const nameOf = async (gid, id) => (id ? (await rest.memberName(gid, id).catch(() => null)) : null);
    const withNames = async (gid, cases) => {
        const ids = [...new Set(cases.flatMap(c => [c.user_id, c.mod_id]).filter(Boolean))];
        const names = new Map(await Promise.all(ids.map(async id => [id, (await nameOf(gid, id)) ?? null])));
        return cases.map(c => ({ ...c, user_name: names.get(c.user_id) ?? null, mod_name: names.get(c.mod_id) ?? null }));
    };

    async function overview(gid, { manager, perms }) {
        const channels = await rest.listChannels(gid).catch(() => fail(400, "The bot is not in that server yet. Invite it first."));
        const h = mod.history(gid, { page: 1, perPage: 10 });
        return { perms, manager, logChannel: mod.logChannel(gid), channels, counts: db.modCounts(gid), total: h.total, cases: await withNames(gid, h.cases), pages: h.pages };
    }
    async function cases(gid, user, page) {
        const uid = user ? parseUserId(user) ?? fail(400, "Paste the person's user ID or mention.") : null;
        const h = mod.history(gid, { userId: uid, page, perPage: 10 });
        return { ...h, cases: await withNames(gid, h.cases) };
    }
    /** One moderation action. `body` carries user, reason, duration, delete_days, channel_id, amount. */
    function act(gid, actorId, action, body) {
        return wrap(async () => {
            const userId = parseUserId(body.user);
            const reason = String(body.reason ?? "");
            const common = { guildId: gid, actorId, userId, reason };
            if (action === "slowmode") return mod.slowmode({ guildId: gid, actorId, channelId: String(body.channel_id ?? ""), seconds: body.duration ?? body.seconds, reason });
            if (action === "lock" || action === "unlock") return mod.lock({ guildId: gid, actorId, channelId: String(body.channel_id ?? ""), reason, unlock: action === "unlock" });
            if (action === "purge") return mod.purge({ guildId: gid, actorId, channelId: String(body.channel_id ?? ""), amount: body.amount, userId: body.user ? userId ?? fail(400, "Paste the person's user ID or mention, or leave it empty.") : null }).then(r => ({ ...r, summary: `Deleted ${r.deleted} message${r.deleted === 1 ? "" : "s"}.` }));
            if (!userId) fail(400, "Paste the person's user ID or mention. In Discord, turn on Developer Mode, then right-click them and choose Copy User ID.");
            db.bumpUsage("dash_mod");
            if (action === "warn") return mod.warn(common);
            if (action === "note") return mod.note({ guildId: gid, actorId, userId, text: reason });
            if (action === "timeout") return mod.timeout({ ...common, duration: body.duration });
            if (action === "untimeout") return mod.untimeout(common);
            if (action === "kick") return mod.kick(common);
            if (action === "ban") return mod.ban({ ...common, deleteDays: body.delete_days, duration: body.duration || null });
            if (action === "unban") return mod.unban(common);
            return fail(400, "Choose an action.");
        });
    }
    const clearWarns = (gid, user) => wrap(async () => mod.clearWarnings({ guildId: gid, userId: parseUserId(user) ?? fail(400, "Paste the person's user ID or mention.") }));
    async function setLog(gid, channelId) {
        if (channelId) { const list = await rest.listChannels(gid).catch(() => fail(400, "The bot is not in that server yet. Invite it first.")); if (!list.some(c => c.id === channelId)) fail(400, "I can't see that channel."); }
        db.setCommunity(gid, { mod_log_channel: channelId || null });
        return { logChannel: mod.logChannel(gid) };
    }
    async function automodGet(gid, { canEdit }) {
        if (!automod) fail(503, "The auto-moderator is not available right now.");
        const [channels, roles] = await Promise.all([rest.listChannels(gid).catch(() => []), Promise.resolve(rest.allRoles?.(gid)).catch(() => [])]);
        return { settings: automod.get(gid), canEdit, rules: automod.rules, channels, roles: (roles ?? []).filter(r => r.id !== gid && !r.managed).map(r => ({ id: r.id, name: r.name })) };
    }
    function automodSave(gid, settings) {
        if (!automod) fail(503, "The auto-moderator is not available right now.");
        if (!settings || typeof settings !== "object") fail(400, "Nothing to save.");
        db.bumpUsage("dash_automod");
        return { settings: automod.save(gid, settings) };
    }
    async function stats(gid, days) {
        const rows = mod.stats(gid, days);
        const names = new Map(await Promise.all(rows.map(async r => [r.mod_id, await nameOf(gid, r.mod_id)])));
        return { stats: rows.map(r => ({ ...r, name: names.get(r.mod_id) ?? null })) };
    }
    async function appeals(gid) {
        const list = db.listAppeals(gid), c = db.getCommunity(gid);
        const names = new Map(await Promise.all(list.map(async a => [a.user_id, await nameOf(gid, a.user_id)])));
        return { appeals: list.map(a => ({ ...a, name: names.get(a.user_id) ?? null })), appealsOn: Boolean(c.appeals_on), warnDays: c.warn_days ?? 0, tempBans: db.tempBans(gid) };
    }
    const decideAppeal = (gid, actorId, body) => wrap(async () => mod.decideAppeal({ guildId: gid, actorId, id: body.id, accept: body.accept === true, note: String(body.note ?? "") }));
    function saveSettings(gid, body) {
        const patch = {};
        if (body.warn_days !== undefined) { const n = Math.trunc(Number(body.warn_days)); if (!Number.isInteger(n) || n < 0 || n > 365) fail(400, "Warnings can expire after 0 to 365 days."); patch.warn_days = n; }
        if (body.appeals_on !== undefined) patch.appeals_on = body.appeals_on ? 1 : 0;
        if (Object.keys(patch).length) db.setCommunity(gid, patch);
        return { warnDays: db.getCommunity(gid).warn_days ?? 0, appealsOn: Boolean(db.getCommunity(gid).appeals_on) };
    }
    const submitAppeal = (gid, userId, text) => wrap(async () => mod.appeal({ guildId: gid, userId, text }));
    return { stats, appeals, decideAppeal, saveSettings, submitAppeal, overview, cases, act, clearWarns, setLog, automodGet, automodSave };
}

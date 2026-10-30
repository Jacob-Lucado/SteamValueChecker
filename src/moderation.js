// Moderation: warn, time out, kick, ban, unban and clean up messages. The Discord commands and the dashboard both call this,
// so the rules are the same everywhere: nobody can act on themselves, the owner, the bot or someone above them, every action
// becomes a numbered case, and every case is posted to the server's mod log.

export class ModError extends Error { constructor(status, message) { super(message); this.status = status; } }

export const ACTIONS = {
    warn: { label: "Warning", color: 0xfee75c, icon: "⚠️" },
    timeout: { label: "Timeout", color: 0xe67e22, icon: "🔇" },
    untimeout: { label: "Timeout lifted", color: 0x57f287, icon: "🔈" },
    kick: { label: "Kick", color: 0xe67e22, icon: "👢" },
    ban: { label: "Ban", color: 0xed4245, icon: "🔨" },
    unban: { label: "Unban", color: 0x57f287, icon: "🕊️" },
    purge: { label: "Messages cleared", color: 0x95a5a6, icon: "🧹" }
};
export const MAX_REASON = 400;
export const MAX_TIMEOUT_S = 28 * 86400;
export const MIN_TIMEOUT_S = 60;
const DAY = 86400_000;

/** "10m", "2h", "3d", "1w" (or just minutes: "30") -> seconds, or null when it cannot be read. */
export function parseDuration(text) {
    const m = /^\s*(\d{1,4})\s*(s|sec|m|min|h|hr|d|day|days|w|wk)?\s*$/i.exec(String(text ?? ""));
    if (!m) return null;
    const unit = (m[2] ?? "m").toLowerCase();
    const per = unit.startsWith("s") ? 1 : unit.startsWith("m") ? 60 : unit.startsWith("h") ? 3600 : unit.startsWith("d") ? 86400 : 604800;
    return Number(m[1]) * per;
}
export function fmtDuration(s) {
    if (!s) return "";
    const parts = [];
    for (const [n, label] of [[604800, "week"], [86400, "day"], [3600, "hour"], [60, "minute"], [1, "second"]]) {
        if (s >= n) { const c = Math.floor(s / n); s -= c * n; parts.push(`${c} ${label}${c === 1 ? "" : "s"}`); }
        if (parts.length === 2) break;
    }
    return parts.join(" ");
}

const clean = v => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_REASON);
const idOk = v => /^\d{15,25}$/.test(String(v ?? ""));
/** A pasted mention (<@123>) or a bare ID -> the ID, or null. */
export function parseUserId(v) { const m = /^\s*(?:<@!?)?(\d{15,25})>?\s*$/.exec(String(v ?? "")); return m ? m[1] : null; }
const snowflakeMs = id => Number((BigInt(id) >> 22n) + 1420070400000n);

export function createModeration({ db, api, dm = null, botId = () => null, now = () => Date.now() }) {
    const fail = (status, m) => { throw new ModError(status, m); };
    const top = (member, roles, guildId) => {
        if (!member) return -1;
        let t = 0;
        for (const id of member.roles ?? []) { const r = roles.find(x => x.id === id); if (r && r.id !== guildId) t = Math.max(t, r.position ?? 0); }
        return t;
    };

    /** Looks at who is acting on whom. Returns { member, guild }. Throws a ModError with a plain explanation. */
    async function gate({ guildId, actorId, targetId, needMember = true }) {
        if (!idOk(targetId)) fail(400, "That does not look like a Discord user ID. Paste the person's ID or mention.");
        if (targetId === actorId) fail(400, "You cannot do that to yourself.");
        if (targetId === botId()) fail(400, "I will not do that to myself.");
        const [guild, roles, member] = await Promise.all([api.getGuild(guildId), api.allRoles(guildId), api.getMember(guildId, targetId)]).catch(e => {
            fail(e?.status === 404 ? 400 : 502, e?.status === 404 ? "The bot is not in that server yet. Invite it first." : "Discord did not answer. Try again in a moment.");
        });
        if (!member) { if (needMember) fail(404, "That person is not in this server."); return { member: null, guild }; }
        if (targetId === guild.owner_id) fail(403, "Nobody can act on the server owner.");
        const targetTop = top(member, roles, guildId);
        if (actorId !== guild.owner_id) {
            const actor = await api.getMember(guildId, actorId).catch(() => null);
            if (top(actor, roles, guildId) <= targetTop) fail(403, "That person's top role is at or above yours.");
        }
        const me = await api.getMember(guildId, botId()).catch(() => null);
        if (me && top(me, roles, guildId) <= targetTop) fail(403, "My role must be above theirs. Move my role up in Server Settings, Roles.");
        return { member, guild };
    }

    const caseEmbed = (c, guild) => {
        const a = ACTIONS[c.action] ?? { label: c.action, color: 0x95a5a6, icon: "•" };
        const fields = [];
        if (c.user_id) fields.push({ name: "Member", value: `<@${c.user_id}>\n\`${c.user_id}\``, inline: true });
        if (c.mod_id) fields.push({ name: "Moderator", value: `<@${c.mod_id}>`, inline: true });
        if (c.duration_s) fields.push({ name: "Length", value: fmtDuration(c.duration_s), inline: true });
        fields.push({ name: "Reason", value: c.reason || "No reason given" });
        return { color: a.color, title: `${a.icon} Case #${c.case_no} · ${a.label}`, fields, timestamp: new Date(c.created_at).toISOString(), ...(guild?.name ? { footer: { text: guild.name } } : {}) };
    };
    const logChannel = guildId => { const c = db.getCommunity(guildId); return c.mod_log_channel ?? c.log_channel ?? null; };

    /** Saves the case, tells the mod log and counts it. A mod log the bot cannot write to never stops the action. */
    async function record({ guildId, guild, userId, modId, action, reason, durationS }) {
        const c = db.addCase(guildId, { userId, modId, action, reason: reason || null, durationS: durationS || null });
        db.bumpUsage(`mod_${action}`);
        const ch = logChannel(guildId);
        if (ch) await api.sendMessage(ch, { embeds: [caseEmbed(c, guild)], allowed_mentions: { parse: [] } }).catch(() => {});
        return c;
    }
    const tell = async (userId, guild, verb, reason, extra = "") => {
        if (!dm) return false;
        try { await dm(userId, { content: `You were ${verb} in **${guild?.name ?? "a server"}**${extra}.${reason ? `\nReason: ${reason}` : ""}`, allowed_mentions: { parse: [] } }); return true; } catch { return false; }
    };
    const discordFail = (e, what) => {
        if (e instanceof ModError) throw e;
        if (e?.status === 403) fail(403, `I do not have permission to ${what}. Check my role is above theirs and that I have the permission for it.`);
        if (e?.status === 404) fail(404, "I can't find that person.");
        fail(502, `Discord refused to ${what}. Try again in a moment.`);
    };

    async function warn({ guildId, actorId, userId, reason }) {
        const { guild } = await gate({ guildId, actorId, targetId: userId });
        const why = clean(reason);
        const c = await record({ guildId, guild, userId, modId: actorId, action: "warn", reason: why });
        const dmd = await tell(userId, guild, "warned", why);
        return { case: c, dmSent: dmd, warnings: db.warnCount(guildId, userId) };
    }
    async function timeout({ guildId, actorId, userId, duration, reason }) {
        const s = typeof duration === "number" ? duration : parseDuration(duration);
        if (!s || s < MIN_TIMEOUT_S || s > MAX_TIMEOUT_S) fail(400, "Give a length from 1 minute to 28 days, like 10m, 2h or 3d.");
        const { guild } = await gate({ guildId, actorId, targetId: userId });
        const why = clean(reason);
        try { await api.timeoutMember(guildId, userId, new Date(now() + s * 1000).toISOString(), why); } catch (e) { discordFail(e, "time that person out"); }
        const c = await record({ guildId, guild, userId, modId: actorId, action: "timeout", reason: why, durationS: s });
        await tell(userId, guild, "timed out", why, ` for ${fmtDuration(s)}`);
        return { case: c };
    }
    async function untimeout({ guildId, actorId, userId, reason }) {
        const { guild } = await gate({ guildId, actorId, targetId: userId });
        const why = clean(reason);
        try { await api.timeoutMember(guildId, userId, null, why); } catch (e) { discordFail(e, "lift that timeout"); }
        return { case: await record({ guildId, guild, userId, modId: actorId, action: "untimeout", reason: why }) };
    }
    async function kick({ guildId, actorId, userId, reason }) {
        const { guild } = await gate({ guildId, actorId, targetId: userId });
        const why = clean(reason);
        const dmd = await tell(userId, guild, "kicked", why); // before they are gone
        try { await api.kickMember(guildId, userId, why); } catch (e) { discordFail(e, "kick that person"); }
        return { case: await record({ guildId, guild, userId, modId: actorId, action: "kick", reason: why }), dmSent: dmd };
    }
    async function ban({ guildId, actorId, userId, reason, deleteDays = 0 }) {
        const days = Math.min(7, Math.max(0, Math.trunc(Number(deleteDays)) || 0));
        const { guild } = await gate({ guildId, actorId, targetId: userId, needMember: false });
        const why = clean(reason);
        const dmd = await tell(userId, guild, "banned", why);
        try { await api.banMember(guildId, userId, { deleteSeconds: days * 86400, reason: why }); } catch (e) { discordFail(e, "ban that person"); }
        return { case: await record({ guildId, guild, userId, modId: actorId, action: "ban", reason: why }), dmSent: dmd };
    }
    async function unban({ guildId, actorId, userId, reason }) {
        if (!idOk(userId)) fail(400, "Paste the banned person's user ID.");
        const guild = await api.getGuild(guildId).catch(() => fail(400, "The bot is not in that server yet. Invite it first."));
        const why = clean(reason);
        try { await api.unbanMember(guildId, userId, why); } catch (e) { if (e?.status === 404) fail(404, "That person is not banned."); discordFail(e, "unban that person"); }
        return { case: await record({ guildId, guild, userId, modId: actorId, action: "unban", reason: why }) };
    }
    /** Deletes up to `amount` recent messages (optionally only one person's). Discord cannot bulk-delete anything older than 14 days. */
    async function purge({ guildId, actorId, channelId, amount, userId = null }) {
        const n = Math.trunc(Number(amount));
        if (!Number.isInteger(n) || n < 1 || n > 100) fail(400, "Choose 1 to 100 messages.");
        if (!idOk(channelId)) fail(400, "Choose a channel.");
        if (userId && !idOk(userId)) fail(400, "That does not look like a Discord user ID.");
        const guild = await api.getGuild(guildId).catch(() => fail(400, "The bot is not in that server yet. Invite it first."));
        let msgs;
        try { msgs = await api.getMessages(channelId, 100); } catch (e) { discordFail(e, "read that channel"); }
        const cutoff = now() - 14 * DAY + 60_000;
        const ids = (Array.isArray(msgs) ? msgs : []).filter(m => (!userId || m.author?.id === userId) && snowflakeMs(m.id) > cutoff).slice(0, n).map(m => m.id);
        if (!ids.length) fail(404, "There is nothing recent to delete there (Discord only lets bots clear messages newer than 14 days).");
        try { if (ids.length === 1) await api.deleteMessage(channelId, ids[0]); else await api.bulkDelete(channelId, ids); } catch (e) { discordFail(e, "delete those messages"); }
        const c = await record({ guildId, guild, userId, modId: actorId, action: "purge", reason: `${ids.length} message${ids.length === 1 ? "" : "s"} in <#${channelId}>` });
        db.bumpUsage("mod_messages_cleared", ids.length);
        return { case: c, deleted: ids.length };
    }

    function history(guildId, { userId = null, page = 1, perPage = 10 } = {}) {
        const total = db.countCases(guildId, userId), pages = Math.max(1, Math.ceil(total / perPage));
        const p = Math.min(pages, Math.max(1, Math.trunc(Number(page)) || 1));
        return { total, page: p, pages, cases: db.listCases(guildId, { userId, limit: perPage, offset: (p - 1) * perPage }), warnings: userId ? db.warnCount(guildId, userId) : null };
    }
    function clearWarnings({ guildId, userId }) {
        if (!idOk(userId)) fail(400, "That does not look like a Discord user ID.");
        const n = db.clearWarns(guildId, userId);
        if (n) db.bumpUsage("mod_warnings_cleared", n);
        return { cleared: n };
    }

    return { warn, timeout, untimeout, kick, ban, unban, purge, history, clearWarnings, caseEmbed, logChannel, parseDuration };
}

// The community actions behind both the Discord commands and the dashboard. Everything talks to Discord through `api`
// (dashboard/discord.js), so it runs the same from a command, an event or a web request, and the tests use a fake.
import { welcomeDmPayload, messageXp, XP_COOLDOWN_MS, VOICE_XP, rolesForLevel, welcomePayload, findUsedInvite, levelFromXp, xpForNext, bar } from "./community.js";

import { isHidden } from "./hidden.js";

export const BETA_ROLE = "Beta Tester", BETA_COLOR = 0x2ecc71;
const avatarOf = u => (u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : null);

export function createCommunity({ db, api, dm = null, dashboardUrl = null, ownerId = null, now = () => Date.now(), rng = Math.random }) {
    const bump = (guildId, key) => { if (!isHidden(guildId)) db.bumpUsage(key); }; // feature counters never include a hidden test server
    const last = new Map();          // `${guild}:${user}` -> last time XP was earned from a message
    const invites = new Map();       // guildId -> Map(code -> { uses, maxUses, inviterId })

    // ---------- XP ----------
    async function syncLevelRoles(guildId, userId, level) {
        for (const r of rolesForLevel(db.listLevelRoles(guildId), level)) await api.addRole(guildId, userId, r.role_id).catch(() => {});
    }

    /** XP for one chat message. Returns { leveled, level } or null when it did not count (off, too soon). */
    async function onMessage({ guildId, userId }) {
        const c = db.getCommunity(guildId);
        if (!c.xp_on) return null;
        const key = `${guildId}:${userId}`;
        if (now() - (last.get(key) ?? 0) < XP_COOLDOWN_MS) return null;
        last.set(key, now());
        if (last.size > 50_000) for (const k of [...last.keys()].slice(0, 10_000)) last.delete(k);
        const r = db.addXp(guildId, userId, messageXp(c.xp_mult, rng), { message: true });
        if (r.after > r.before) { await syncLevelRoles(guildId, userId, r.after); bump(guildId, "level_ups"); return { leveled: true, level: r.after, xp: r.xp }; }
        return { leveled: false, level: r.after, xp: r.xp };
    }

    /** One minute of voice for these people (the caller picks who counts). */
    async function onVoiceMinute(guildId, userIds) {
        const c = db.getCommunity(guildId);
        if (!c.xp_on) return;
        for (const id of userIds) {
            const r = db.addXp(guildId, id, Math.round(VOICE_XP * c.xp_mult), { voiceMinutes: 1 });
            if (r.after > r.before) await syncLevelRoles(guildId, id, r.after);
        }
    }

    function rankOf(guildId, userId) {
        const row = db.getXp(guildId, userId) ?? { xp: 0, level: 0, messages: 0, voice_minutes: 0 };
        const lv = levelFromXp(row.xp);
        return { xp: row.xp, level: lv.level, into: lv.into, need: lv.need, bar: bar(lv.into, lv.need), rank: db.xpRank(guildId, userId), messages: row.messages ?? 0, voiceMinutes: row.voice_minutes ?? 0, members: db.countXpMembers(guildId) };
    }

    // ---------- invites ----------
    const toCache = list => new Map(list.map(i => [i.code, { uses: i.uses ?? 0, maxUses: i.max_uses ?? 0, inviterId: i.inviter?.id ?? null }]));
    async function refreshInvites(guildId) {
        try { const list = await api.listInvites(guildId); invites.set(guildId, toCache(list)); return list; }
        catch { invites.delete(guildId); return null; } // no Manage Server permission: attribution is simply off
    }
    const cacheInvite = (guildId, i) => { const m = invites.get(guildId) ?? new Map(); m.set(i.code, { uses: i.uses ?? 0, maxUses: i.max_uses ?? i.maxUses ?? 0, inviterId: i.inviter?.id ?? i.inviterId ?? null }); invites.set(guildId, m); };
    const dropInvite = (guildId, code) => invites.get(guildId)?.delete(code);

    /** Which invite brought this member in, as { code, inviterId } (inviterId is the member who owns the link), or null. */
    async function attribute(guildId) {
        const before = invites.get(guildId);
        const after = await refreshInvites(guildId);
        if (!before || !after) return null;
        const used = findUsedInvite(before, after.map(i => ({ code: i.code, uses: i.uses ?? 0, maxUses: i.max_uses ?? 0, inviterId: i.inviter?.id ?? null })));
        if (!used) return null;
        return { code: used.code, inviterId: db.inviteLinkOwner(guildId, used.code) ?? used.inviterId ?? null };
    }

    async function checkRewards(guildId, inviterId) {
        const stats = db.inviteStats(guildId, inviterId);
        for (const r of db.listRewards(guildId)) if (stats.active >= r.count) await api.addRole(guildId, inviterId, r.role_id).catch(() => {});
        return stats;
    }

    /**
     * A member joined: work out who invited them, hand out the auto role, greet them, log it and pay the referral bonus.
     * `member` is { id, username, avatar, bot }.
     */
    /** Anyone the bot's owner invites gets the Beta Tester role (created, green, the first time it is needed). Returns the role id or null. */
    async function grantBeta(guildId, userId) {
        try {
            const roles = await api.allRoles(guildId);
            let role = roles.find(r => !r.managed && String(r.name).toLowerCase() === BETA_ROLE.toLowerCase());
            if (!role) role = await api.createRole(guildId, { name: BETA_ROLE, color: BETA_COLOR, hoist: false, mentionable: false, permissions: "0" });
            await api.addRole(guildId, userId, role.id);
            bump(guildId, "beta_testers");
            return role.id;
        } catch { return null; }
    }

    async function onJoin({ guildId, guildName, member, count }) {
        if (member.bot) return { skipped: "bot" };
        const c = db.getCommunity(guildId);
        const rejoin = db.everJoined(guildId, member.id);
        const via = await attribute(guildId);
        const inviterId = via?.inviterId && via.inviterId !== member.id ? via.inviterId : null;
        db.recordJoin(guildId, member.id, inviterId, via?.code ?? null);
        bump(guildId, "joins_tracked"); if (inviterId && !rejoin) bump(guildId, "referrals");
        if (c.autorole_id) await api.addRole(guildId, member.id, c.autorole_id).catch(() => {});
        const beta = ownerId && inviterId === ownerId ? await grantBeta(guildId, member.id) : null;
        if (c.verified_role_id && db.getSteamLink(member.id)?.verified) await api.addRole(guildId, member.id, c.verified_role_id).then(() => bump(guildId, "steam_verified_roles")).catch(() => {});
        if (inviterId && !rejoin) {
            if (c.referral_xp > 0) { const r = db.addXp(guildId, inviterId, c.referral_xp); if (r.after > r.before) await syncLevelRoles(guildId, inviterId, r.after); }
            await checkRewards(guildId, inviterId);
        }
        if (c.welcome_on && c.welcome_channel) {
            bump(guildId, "welcomes");
            await api.sendMessage(c.welcome_channel, welcomePayload({ settings: c, userId: member.id, username: member.username, avatarUrl: avatarOf(member), server: guildName, count, inviterId })).catch(() => {});
        }
        if (c.welcome_dm && dm && !rejoin) { bump(guildId, "welcome_dms"); await dm(member.id, welcomeDmPayload({ server: guildName, dashboardUrl })).catch(() => bump(guildId, "welcome_dm_failed")); }
        if (c.log_channel) await api.sendMessage(c.log_channel, { content: `📥 <@${member.id}> joined (member #${count}).${via ? ` Invite \`${via.code}\`${inviterId ? ` from <@${inviterId}>` : ""}.${beta ? " Given the Beta Tester role." : ""}` : " The invite could not be told."}`, allowed_mentions: { parse: [] } }).catch(() => {});
        return { inviterId, code: via?.code ?? null, rejoin };
    }

    async function onLeave({ guildId, member }) {
        if (member.bot) return;
        const c = db.getCommunity(guildId);
        db.recordLeave(guildId, member.id);
        const text = c.leave_on ? `<@${member.id}> (${String(member.username).replace(/[@`*_~|>]/g, "")}) left the server.` : null;
        if (text && (c.log_channel || c.welcome_channel)) await api.sendMessage(c.log_channel ?? c.welcome_channel, { content: text, allowed_mentions: { parse: [] } }).catch(() => {});
    }

    /** The member's own permanent invite link (made once, then reused). */
    async function inviteLinkFor(guildId, userId) {
        const have = db.getInviteLink(guildId, userId);
        if (have) return `https://discord.gg/${have}`;
        const c = db.getCommunity(guildId);
        let channelId = c.welcome_channel;
        if (!channelId) channelId = (await api.allChannels(guildId)).find(ch => ch.type === 0)?.id;
        if (!channelId) throw Object.assign(new Error("There is no text channel to make an invite for."), { userFacing: true });
        let inv;
        try { inv = await api.createInvite(channelId, { max_age: 0, max_uses: 0, unique: true }); }
        catch (e) { throw Object.assign(new Error(e?.status === 403 ? "I need the Create Invite permission to make your link." : "I could not make an invite link right now."), { userFacing: true }); }
        db.setInviteLink(guildId, userId, inv.code); bump(guildId, "invite_links");
        cacheInvite(guildId, { code: inv.code, uses: 0, max_uses: 0 });
        return `https://discord.gg/${inv.code}`;
    }

    function inviteSummary(guildId, userId) {
        return { ...db.inviteStats(guildId, userId), link: db.getInviteLink(guildId, userId) ? `https://discord.gg/${db.getInviteLink(guildId, userId)}` : null, rewards: db.listRewards(guildId), by: db.whoInvited(guildId, userId)?.inviter_id ?? null };
    }

    /** Gives the Steam Verified role when this person has proven their Steam account. Returns "granted", "no_role" or "not_verified". */
    async function grantVerified(guildId, userId) {
        const c = db.getCommunity(guildId);
        if (!c.verified_role_id) return "no_role";
        if (!db.getSteamLink(userId)?.verified) return "not_verified";
        await api.addRole(guildId, userId, c.verified_role_id);
        bump(guildId, "steam_verified_roles");
        return "granted";
    }

    return { grantVerified, onMessage, onVoiceMinute, rankOf, refreshInvites, cacheInvite, dropInvite, attribute, onJoin, onLeave, inviteLinkFor, inviteSummary, syncLevelRoles, checkRewards, _invites: invites, xpForNext };
}

// The bot owner's own server (the support server). It is the one server the bot was in first, or whatever MAIN_GUILD_ID says.
// The dashboard links to it, and the AI companion is never limited there.
import { ChannelType, PermissionFlagsBits } from "discord.js";

const INVITE = /^https:\/\/(discord\.gg|discord\.com\/invite)\/[\w-]{2,40}$/i;

export function createMainGuild({ db, client, configuredId = null, configuredInvite = null, log = () => {} }) {
    const id = () => configuredId || db.getMeta("main_guild") || null;
    const isMain = gid => Boolean(gid) && String(gid) === id();

    /** Picks the main server when none is set: if the bot is in exactly one server, that is it. It sticks even when the bot joins others later. */
    function detect() {
        if (id()) return id();
        const all = [...client.guilds.cache.keys()];
        if (all.length === 1) { db.setMeta("main_guild", all[0]); log(`main server is ${all[0]}`); return all[0]; }
        return null;
    }

    /** A permanent invite to the main server, made once and remembered. */
    async function ensureInvite() {
        if (configuredInvite && INVITE.test(configuredInvite)) return configuredInvite;
        const saved = db.getMeta("support:invite");
        if (saved && INVITE.test(saved)) return saved;
        const gid = detect();
        const guild = gid ? client.guilds.cache.get(gid) : null;
        if (!guild) return null;
        try {
            const me = guild.members.me ?? await guild.members.fetchMe();
            const ch = [guild.systemChannel, guild.rulesChannel, ...guild.channels.cache.values()]
                .find(c => c && c.type === ChannelType.GuildText && c.permissionsFor(me)?.has(PermissionFlagsBits.CreateInstantInvite));
            if (!ch) { log("no channel where I may create an invite"); return null; }
            const inv = await ch.createInvite({ maxAge: 0, maxUses: 0, unique: false, reason: "Support server link for the dashboard" });
            const url = `https://discord.gg/${inv.code}`;
            db.setMeta("support:invite", url);
            return url;
        } catch (e) { log(`could not make a support invite: ${e.message}`); return null; }
    }

    /** What the dashboard shows. Never creates anything while a visitor waits. */
    const inviteUrl = () => (configuredInvite && INVITE.test(configuredInvite) ? configuredInvite : (INVITE.test(db.getMeta("support:invite") ?? "") ? db.getMeta("support:invite") : null));

    return { id, isMain, detect, ensureInvite, inviteUrl };
}

// Gives the bot's owner a "Bot Creator" role in any server they're in, shown as its own group in the member list.
export const CREATOR_ROLE = "Bot Creator";

export async function ensureCreatorRole(guild, ownerId, log = () => {}) {
    if (!ownerId || !guild) return "skipped";
    try {
        const me = guild.members.me ?? await guild.members.fetchMe();
        if (!me.permissions.has("ManageRoles")) return "no-permission";
        const member = await guild.members.fetch(ownerId).catch(() => null);
        if (!member) return "not-a-member";
        const roles = await guild.roles.fetch();
        let role = roles.find(r => r.name === CREATOR_ROLE);
        if (!role) role = await guild.roles.create({ name: CREATOR_ROLE, hoist: true, mentionable: false, color: 0x5865f2, reason: "Role for the person who made the bot" });
        if (role.position >= me.roles.highest.position) return "role-too-high"; // the bot can only hand out roles below its own
        if (member.roles.cache.has(role.id)) return "already";
        await member.roles.add(role, "Owner of the bot");
        return "given";
    } catch (err) {
        log(`[creator-role] ${guild.name ?? guild.id}: ${err.message}`);
        return "failed";
    }
}

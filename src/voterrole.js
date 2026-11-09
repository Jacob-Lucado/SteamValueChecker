// A "Top Voter" role in the bot's home server for as long as a Top.gg vote counts (twelve hours), so voters show up there and
// can be thanked. The role is made on the first vote and taken off again once the vote runs out.
export const VOTER_ROLE = "Top Voter";
const KEY = "voterrole:";
const VOTE_MS = 12 * 3600_000;

export function createVoterRole({ db, client, mainGuild, now = () => Date.now(), log = () => {} }) {
    const guild = () => { const id = mainGuild.detect?.() ?? null; return id ? client.guilds.cache.get(id) ?? null : null; };

    async function roleIn(g, create) {
        const roles = await g.roles.fetch();
        let role = roles.find(r => r.name === VOTER_ROLE);
        if (!role && create) role = await g.roles.create({ name: VOTER_ROLE, hoist: true, color: 0xf1c40f, mentionable: false, reason: "Thanks for voting on Top.gg" });
        return role ?? null;
    }

    /** Called on each counted vote. Quietly does nothing when the voter isn't in the home server or the bot can't manage roles. */
    async function grant(userId, expiresAt = null) {
        try {
            const g = guild();
            if (!g) return "no-home-server";
            const me = g.members.me ?? await g.members.fetchMe();
            if (!me.permissions.has("ManageRoles")) return "no-permission";
            const member = await g.members.fetch(userId).catch(() => null);
            if (!member) return "not-a-member";
            const role = await roleIn(g, true);
            if (!role || role.position >= me.roles.highest.position) return "role-too-high";
            if (!member.roles.cache.has(role.id)) await member.roles.add(role, "Voted on Top.gg");
            db.setMeta(KEY + userId, String(expiresAt && expiresAt > now() ? expiresAt : now() + VOTE_MS));
            return "given";
        } catch (err) { log(`could not give the voter role: ${err.message}`); return "failed"; }
    }

    /** Takes the role off anyone whose vote has run out. Safe to call as often as you like. */
    async function sweep() {
        let removed = 0;
        const due = db.listMetaPrefix(KEY).filter(r => Number(r.value) > 0 && Number(r.value) <= now());
        if (!due.length) return removed;
        try {
            const g = guild();
            const role = g ? await roleIn(g, false) : null;
            for (const r of due) {
                const id = r.key.slice(KEY.length);
                try {
                    if (role) { const m = await g.members.fetch(id).catch(() => null); if (m?.roles.cache.has(role.id)) await m.roles.remove(role, "The vote ran out"); }
                    db.setMeta(r.key, ""); removed++;
                } catch (err) { log(`could not remove the voter role: ${err.message}`); }
            }
        } catch (err) { log(`voter role sweep failed: ${err.message}`); }
        return removed;
    }

    return { grant, sweep };
}

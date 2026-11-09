// Supporters: a pass from the Square checkout, or one the owner hands out, gives a Supporter role in the home server,
// a badge on the profile page and a bit more XP, for as long as the pass lasts. Nothing in the bot is locked behind it.
import { pushEvent, readEvents } from "./adminlog.js";
import { PLANS, SUPPORTER_XP_BOOST } from "./square.js";

export const SUPPORTER_ROLE = "Supporter";
const UNTIL = "supporter:";
const PAID = "supporterpay:";
const DAY = 86_400_000;

export const supporterUntil = (db, userId) => Number(db.getMeta(UNTIL + userId)) || 0;
export const isSupporter = (db, userId, now = Date.now()) => supporterUntil(db, userId) > now;
export const xpBoost = (db, userId, now = Date.now()) => (isSupporter(db, userId, now) ? SUPPORTER_XP_BOOST : 1);

export function createSupporters({ db, client = null, mainGuild = null, dm = null, now = () => Date.now(), log = () => {} }) {
    const guild = () => { const id = mainGuild?.detect?.() ?? null; return id ? client?.guilds.cache.get(id) ?? null : null; };

    async function roleIn(g, create) {
        const roles = await g.roles.fetch();
        let role = roles.find(r => r.name === SUPPORTER_ROLE);
        if (!role && create) role = await g.roles.create({ name: SUPPORTER_ROLE, hoist: true, color: 0xeb459e, mentionable: false, reason: "Thanks for supporting Steam Value Checker" });
        return role ?? null;
    }

    async function syncRole(userId, on) {
        try {
            const g = guild(); if (!g) return "no-home-server";
            const me = g.members.me ?? await g.members.fetchMe();
            if (!me.permissions.has("ManageRoles")) return "no-permission";
            const member = await g.members.fetch(userId).catch(() => null);
            if (!member) return "not-a-member";
            const role = await roleIn(g, on);
            if (!role || role.position >= me.roles.highest.position) return "role-too-high";
            if (on && !member.roles.cache.has(role.id)) await member.roles.add(role, "Supporter pass");
            if (!on && member.roles.cache.has(role.id)) await member.roles.remove(role, "Supporter pass ended");
            return "ok";
        } catch (err) { log(`supporter role: ${err.message}`); return "failed"; }
    }

    /** Adds days to a person's pass (from today, or from the end of the one they have). Safe to call twice for the same payment. */
    async function grant(userId, days, paymentId, via = "Square") {
        if (db.getMeta(PAID + paymentId)) return { duplicate: true };
        const d = Math.max(1, Math.min(3660, Math.round(Number(days) || 0)));
        const start = Math.max(now(), supporterUntil(db, userId)), until = start + d * DAY;
        db.setMeta(PAID + paymentId, String(now()));
        db.setMeta(UNTIL + userId, String(until));
        pushEvent(db, "adminlog:supporters", { id: userId, days: d, via, at: now() }, 100);
        await syncRole(userId, true);
        try { await dm?.(userId, { embeds: [{ color: 0xeb459e, title: "Thank you! 💖", description: `Your supporter pass runs until <t:${Math.floor(until / 1000)}:D>. You've got the Supporter role in our server, a badge on your profile, and a little extra XP. Everything else stays free for everyone.` }] }); } catch { /* DMs may be closed */ }
        return { duplicate: false, until };
    }

    /** Takes the role off anyone whose pass has ended. */
    async function sweep() {
        let n = 0;
        for (const r of db.listMetaPrefix(UNTIL)) {
            const until = Number(r.value); if (!until || until > now()) continue;
            const id = r.key.slice(UNTIL.length);
            await syncRole(id, false); db.setMeta(r.key, ""); n++;
        }
        return n;
    }

    /** Someone with a pass joined the home server: give the role back. */
    const onJoin = userId => (isSupporter(db, userId, now()) ? syncRole(userId, true) : null);

    function list() {
        return db.listMetaPrefix(UNTIL).map(r => ({ id: r.key.slice(UNTIL.length), until: Number(r.value) })).filter(r => r.until > now()).sort((a, b) => b.until - a.until);
    }

    return { grant, sweep, onJoin, list, recent: () => readEvents(db, "adminlog:supporters", 30), plans: PLANS };
}

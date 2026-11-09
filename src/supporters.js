// Supporters: a pass from the Square checkout, or one the owner hands out, gives a Supporter role in the home server,
// a badge on the profile page and a bit more XP, for as long as the pass lasts. Nothing in the bot is locked behind it.
import { pushEvent, readEvents } from "./adminlog.js";
import { PLANS, SUPPORTER_XP_BOOST } from "./square.js";

export const SUPPORTER_ROLE = "Supporter";
const UNTIL = "supporter:";
const PAID = "supporterpay:";
const DAY = 86_400_000;
const REMIND = "supporterremind:";
const REMIND_BEFORE_MS = 3 * DAY;
const parse = v => { try { const o = JSON.parse(v); return o && typeof o === "object" ? o : null; } catch { return null; } };

export const supporterUntil = (db, userId) => Number(db.getMeta(UNTIL + userId)) || 0;
export const isSupporter = (db, userId, now = Date.now()) => supporterUntil(db, userId) > now;
export const xpBoost = (db, userId, now = Date.now()) => (isSupporter(db, userId, now) ? SUPPORTER_XP_BOOST : 1);

export function createSupporters({ db, client = null, mainGuild = null, dm = null, renewUrl = null, now = () => Date.now(), log = () => {} }) {
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

    /** Adds days to a person's pass (from today, or from the end of the one they have). Safe to call twice for the same payment. `cents` is what they paid, 0 for a gift. */
    async function grant(userId, days, paymentId, via = "Square", cents = 0) {
        if (db.getMeta(PAID + paymentId)) return { duplicate: true };
        const d = Math.max(1, Math.min(3660, Math.round(Number(days) || 0)));
        const start = Math.max(now(), supporterUntil(db, userId)), until = start + d * DAY;
        db.setMeta(PAID + paymentId, JSON.stringify({ at: now(), userId, days: d, cents: Math.max(0, Math.round(Number(cents) || 0)), via }));
        db.setMeta(UNTIL + userId, String(until));
        pushEvent(db, "adminlog:supporters", { id: userId, days: d, via, at: now() }, 100);
        await syncRole(userId, true);
        try { await dm?.(userId, { embeds: [{ color: 0xeb459e, title: "Thank you! 💖", description: `Your supporter pass runs until <t:${Math.floor(until / 1000)}:D>. You've got the Supporter role in our server, a badge and glow on your profile, three extra profile themes, more overlay slots and a little extra XP. Everything else stays free for everyone.` }] }); } catch { /* DMs may be closed */ }
        return { duplicate: false, until };
    }

    /** A full refund takes back the days that payment bought. A partial one is left for the owner to sort out by hand. */
    async function refund(paymentId, cents) {
        const rec = parse(db.getMeta(PAID + paymentId));
        if (!rec || rec.refunded || !rec.userId) return { ignored: true };
        if (rec.cents > 0 && Number(cents) < rec.cents) return { ignored: true, partial: true };
        db.setMeta(PAID + paymentId, JSON.stringify({ ...rec, refunded: now() }));
        const until = supporterUntil(db, rec.userId) - rec.days * DAY;
        pushEvent(db, "adminlog:supporters", { id: rec.userId, days: -rec.days, via: "Refund", at: now() }, 100);
        if (until > now()) { db.setMeta(UNTIL + rec.userId, String(until)); return { ended: false, until }; }
        db.setMeta(UNTIL + rec.userId, ""); await syncRole(rec.userId, false);
        return { ended: true };
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

    /** One DM, three days before a pass ends, with a way back to the page. Passes are one-time, so this is the only nudge. */
    async function remind() {
        let n = 0;
        for (const r of db.listMetaPrefix(UNTIL)) {
            const until = Number(r.value), left = until - now();
            if (!until || left <= 0 || left > REMIND_BEFORE_MS || db.getMeta(REMIND + r.key.slice(UNTIL.length)) === String(until)) continue;
            const id = r.key.slice(UNTIL.length);
            db.setMeta(REMIND + id, String(until));
            try {
                await dm?.(id, { embeds: [{ color: 0xeb459e, title: "Your supporter pass ends soon", description: `It runs out <t:${Math.floor(until / 1000)}:R>. Thanks for backing the bot. If you'd like to keep the role, badge and perks, you can add more time any time, and it stacks on top of what you have left.` }],
                    components: renewUrl ? [{ type: 1, components: [{ type: 2, style: 5, label: "Add more time", url: renewUrl }] }] : [] });
                n++;
            } catch { /* DMs may be closed; nothing else to try */ }
        }
        return n;
    }

    /** Someone with a pass joined the home server: give the role back. */
    const onJoin = userId => (isSupporter(db, userId, now()) ? syncRole(userId, true) : null);

    function list() {
        return db.listMetaPrefix(UNTIL).map(r => ({ id: r.key.slice(UNTIL.length), until: Number(r.value) })).filter(r => r.until > now()).sort((a, b) => b.until - a.until);
    }

    /** What the Square passes have brought in. Gifts from the owner and refunded payments don't count. */
    function revenue() {
        const out = { total: 0, count: 0, last30: 0, count30: 0, refunded: 0 };
        for (const r of db.listMetaPrefix(PAID)) {
            const p = parse(r.value); if (!p || !(p.cents > 0)) continue;
            if (p.refunded) { out.refunded += p.cents || 0; continue; }
            out.total += p.cents; out.count++;
            if (now() - p.at <= 30 * DAY) { out.last30 += p.cents; out.count30++; }
        }
        return out;
    }

    return { grant, refund, sweep, remind, onJoin, list, revenue, recent: () => readEvents(db, "adminlog:supporters", 30), plans: PLANS };
}

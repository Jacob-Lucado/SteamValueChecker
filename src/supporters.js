// Supporters: a pass from the Square checkout, or one the owner hands out, gives a Supporter role in the home server,
// a badge on the profile page and a bit more XP, for as long as the pass lasts. Nothing in the bot is locked behind it.
import { pushEvent, readEvents } from "./adminlog.js";
import { PLANS, SUPPORTER_XP_BOOST } from "./square.js";

export const SUPPORTER_ROLE = "Supporter";
const UNTIL = "supporter:";
const PAID = "supporterpay:";
const DAY = 86_400_000;
const REMIND = "supporterremind:";
const LAST = "supporterlast:";
const WALL = "supporterwall:";
const FOUNDER = "supporterfounder:";
export const FOUNDERS_MAX = 50;
const REMIND_BEFORE_MS = 3 * DAY;
const parse = v => { try { const o = JSON.parse(v); return o && typeof o === "object" ? o : null; } catch { return null; } };

/** The last minute of a calendar day (YYYY-MM-DD) in Eastern time, as a timestamp. Null for anything that isn't a real date. */
export function endOfDayEastern(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str ?? "")); if (!m) return null;
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    for (const off of [4, 5]) { // EDT, then EST
        const t = Date.UTC(y, mo - 1, d, 23, 59) + off * 3600_000;
        const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
        if (+p.year === y && +p.month === mo && +p.day === d && +p.hour === 23 && +p.minute === 59) return t;
    }
    return null;
}

export const supporterUntil = (db, userId) => Number(db.getMeta(UNTIL + userId)) || 0;
export const isSupporter = (db, userId, now = Date.now()) => supporterUntil(db, userId) > now;
/** The first 50 people to have a paid pass are founding supporters for good, even after their pass ends. */
export const isFounder = (db, userId) => Boolean(db.getMeta(FOUNDER + userId));
export const wallName = (db, userId) => db.getMeta(WALL + userId) || null;
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
    async function grant(userId, days, paymentId, via = "Square", cents = 0, { giftFrom = null } = {}) {
        if (db.getMeta(PAID + paymentId)) return { duplicate: true };
        const d = Math.max(1, Math.min(3660, Math.round(Number(days) || 0)));
        const start = Math.max(now(), supporterUntil(db, userId)), until = start + d * DAY;
        db.setMeta(PAID + paymentId, JSON.stringify({ at: now(), userId, days: d, cents: Math.max(0, Math.round(Number(cents) || 0)), via, giftFrom }));
        const founding = cents > 0 && !isFounder(db, userId) && db.listMetaPrefix(FOUNDER).filter(r => r.value).length < FOUNDERS_MAX;
        if (founding) db.setMeta(FOUNDER + userId, String(now()));
        db.setMeta(UNTIL + userId, String(until));
        pushEvent(db, "adminlog:supporters", { id: userId, days: d, via, at: now() }, 100);
        const role = await syncRole(userId, true);
        if (role !== "ok") log(`Supporter role for ${userId} not given: ${role}`);
        try { await dm?.(userId, { embeds: [{ color: 0xeb459e, title: "Thank you! 💖", description: `${giftFrom ? `<@${giftFrom}> gifted you a supporter pass. ` : ""}Your supporter pass runs until <t:${Math.floor(until / 1000)}:D>. ${founding ? "You're one of the first 50 supporters, so you keep a **Founding supporter** mark on your profile for good. " : ""}You've got the Supporter role in our server, a badge and glow on your profile, three extra profile themes, more overlay slots and a little extra XP. Everything else stays free for everyone.` }] }); } catch { /* DMs may be closed */ }
        if (giftFrom) try { await dm?.(giftFrom, { embeds: [{ color: 0xeb459e, title: "Your gift is on its way 🎁", description: `<@${userId}> now has a supporter pass. Thank you for backing the bot.` }] }); } catch { /* DMs may be closed */ }
        return { duplicate: false, until, founding, role };
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
            const id = r.key.slice(UNTIL.length), lastDay = left > 0 && left <= DAY;
            if (!until || left <= 0 || left > REMIND_BEFORE_MS) continue;
            if (lastDay ? db.getMeta(LAST + id) === String(until) : db.getMeta(REMIND + id) === String(until) || db.getMeta(LAST + id) === String(until)) continue;
            db.setMeta(lastDay ? LAST + id : REMIND + id, String(until));
            try {
                await dm?.(id, { embeds: [{ color: 0xeb459e, title: lastDay ? "Last day of your supporter pass" : "Your supporter pass ends soon", description: `It runs out <t:${Math.floor(until / 1000)}:R>. Thanks for backing the bot. If you'd like to keep the role, badge and perks, you can add more time any time, and it stacks on top of what you have left.` }],
                    components: renewUrl ? [{ type: 1, components: [{ type: 2, style: 5, label: "Add more time", url: renewUrl }] }] : [] });
                n++;
            } catch { /* DMs may be closed; nothing else to try */ }
        }
        return n;
    }

    /** Everyone the owner might want to touch: live passes, founders whose pass ended, and anyone on the wall. */
    function everyone() {
        const ids = new Set([...db.listMetaPrefix(UNTIL), ...db.listMetaPrefix(FOUNDER), ...db.listMetaPrefix(WALL)].map(r => r.key.split(":")[1]));
        return [...ids].filter(Boolean).map(id => ({ id, until: supporterUntil(db, id), active: isSupporter(db, id, now()), founder: isFounder(db, id), wall: wallName(db, id) ?? "" }))
            .filter(r => r.until || r.founder || r.wall).sort((a, b) => Number(b.active) - Number(a.active) || b.until - a.until);
    }

    /** Owner edits. Setting a time in the past (or nothing) ends the pass and takes the role back. Returns where the pass stands. */
    async function setUntil(userId, ms, why = "Owner edit") {
        const until = Number(ms) > now() ? Math.round(Number(ms)) : 0;
        db.setMeta(UNTIL + userId, until ? String(until) : "");
        pushEvent(db, "adminlog:supporters", { id: userId, days: until ? Math.round((until - now()) / DAY) : 0, via: until ? why : "Ended by owner", at: now() }, 100);
        const role = await syncRole(userId, Boolean(until));
        if (role !== "ok") log(`Supporter role for ${userId} not synced: ${role}`);
        return { until: until || null, role };
    }
    const addDays = (userId, days, why) => setUntil(userId, Math.max(now(), supporterUntil(db, userId)) + Math.round(Number(days) || 0) * DAY, why);
    const remove = userId => setUntil(userId, 0);
    function setFounder(userId, on) { db.setMeta(FOUNDER + userId, on ? String(now()) : ""); return Boolean(on); }

    /** Where the role stands right now: which server it goes in, and whether the bot is able to hand it out. */
    async function homeStatus() {
        const id = mainGuild?.detect?.() ?? null;
        if (!id) return { ok: false, why: "no-home-server" };
        const g = client?.guilds.cache.get(id);
        if (!g) return { ok: false, why: "not-in-server", id };
        try {
            const me = g.members.me ?? await g.members.fetchMe();
            if (!me.permissions.has("ManageRoles")) return { ok: false, why: "no-permission", id, name: g.name };
            const role = (await g.roles.fetch()).find(r => r.name === SUPPORTER_ROLE);
            if (role && role.position >= me.roles.highest.position) return { ok: false, why: "role-too-high", id, name: g.name };
            return { ok: true, id, name: g.name, roleExists: Boolean(role) };
        } catch (err) { return { ok: false, why: "failed", id, name: g.name, detail: err.message }; }
    }

    /** Gives the role to everyone with a live pass, for when it didn't land the first time. Says what happened to each. */
    async function resync() {
        const out = { ok: 0, problems: {} };
        for (const a of list()) { const r = await syncRole(a.id, true); if (r === "ok") out.ok++; else out.problems[r] = (out.problems[r] ?? 0) + 1; }
        return out;
    }

    /** Someone with a pass joined the home server: give the role back. */
    const onJoin = userId => (isSupporter(db, userId, now()) ? syncRole(userId, true) : null);

    /** Opt in to (or out of) the supporter wall. Only a short name they pick is shown, never their Discord account. */
    function setWall(userId, name) {
        const clean = String(name ?? "").replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f<>@#`*_~|\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 24);
        db.setMeta(WALL + userId, clean);
        return clean || null;
    }

    /** Active supporters and founders who chose to be shown, founders first. */
    function wall() {
        const out = [];
        for (const r of db.listMetaPrefix(WALL)) {
            const id = r.key.slice(WALL.length), name = r.value; if (!name) continue;
            const founder = isFounder(db, id), active = isSupporter(db, id, now());
            if (founder || active) out.push({ name, founder, active, since: Number(db.getMeta(FOUNDER + id)) || 0 });
        }
        return out.sort((a, b) => Number(b.founder) - Number(a.founder) || a.since - b.since || a.name.localeCompare(b.name));
    }

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

    return { grant, refund, sweep, remind, onJoin, homeStatus, resync, everyone, setUntil, addDays, remove, setFounder, list, setWall, wall, revenue, recent: () => readEvents(db, "adminlog:supporters", 30), plans: PLANS };
}

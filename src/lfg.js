// Looking for group: post, join, leave, close, and a reminder when it starts. The Discord calls go through `discord`
// (post, edit, createEvent), so the rules here are testable on their own.
import { UserError } from "./errors.js";
import { localParts } from "./timeutil.js";
import { parseClock } from "./timeutil.js";
import { lfgPayload } from "./lfgrender.js";

const MAX_OPEN_PER_PERSON = 3, GRACE_MS = 3 * 3600_000, MAX_AHEAD_MS = 30 * 86400_000;
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Wall-clock time in a time zone -> UTC milliseconds. */
export function zonedMs(ymd, minutes, tz) {
    const [y, m, d] = ymd.split("-").map(Number);
    const target = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
    let t = target;
    for (let n = 0; n < 3; n++) {
        const lp = localParts(t, tz);
        const [ly, lm, ld] = lp.ymd.split("-").map(Number);
        t += target - Date.UTC(ly, lm - 1, ld, Math.floor(lp.minutes / 60), lp.minutes % 60);
    }
    return t;
}
const addDays = (ymd, n) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

/**
 * "now", "in 90 minutes", "in 2 hours", "8pm", "tonight 8pm", "tomorrow 19:30", "friday 9pm" or "2026-11-07 20:00",
 * read in the person's time zone. Returns UTC milliseconds, or null when it can't be understood.
 */
export function parseWhen(text, { tz = "UTC", now = Date.now() } = {}) {
    const s = String(text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!s) return null;
    if (s === "now") return now;
    let m = s.match(/^in (\d{1,3}) ?(m|min|mins|minutes?|h|hr|hrs|hours?)$/);
    if (m) return now + Number(m[1]) * (m[2].startsWith("m") ? 60_000 : 3600_000);
    m = s.match(/^(\d{4}-\d{2}-\d{2}) (.+)$/);
    if (m) { const c = parseClock(m[2]); return c === null ? null : zonedMs(m[1], c, tz); }
    m = s.match(/^(today|tonight|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?: at)? (.+)$/);
    const here = localParts(now, tz);
    if (m) {
        const c = parseClock(m[2]);
        if (c === null) return null;
        let add = 0;
        if (m[1] === "tomorrow") add = 1;
        else if (DAYS.includes(m[1])) { add = (DAYS.indexOf(m[1]) - here.weekday + 7) % 7; if (add === 0 && c <= here.minutes) add = 7; }
        return zonedMs(addDays(here.ymd, add), c, tz);
    }
    const c = parseClock(s.replace(/^at /, ""));
    if (c === null) return null;
    return zonedMs(addDays(here.ymd, c <= here.minutes ? 1 : 0), c, tz);
}

export function createLfgService({ db, discord, now = () => Date.now(), log = () => {} }) {
    const refresh = async post => {
        if (!post.message_id) return;
        try { await discord.edit(post.channel_id, post.message_id, lfgPayload(post, db.lfgMembers(post.id))); }
        catch (err) { log(`could not update post ${post.id}: ${err.message}`); }
    };

    async function create({ guildId, channelId, creatorId, game, startsAt, slots, note, event = false }) {
        game = String(game ?? "").trim().slice(0, 80);
        if (!game) throw new UserError("Say which game.");
        slots = Math.round(Number(slots ?? 4));
        if (!(slots >= 2 && slots <= 20)) throw new UserError("Slots must be from 2 to 20, counting you.");
        if (!Number.isFinite(startsAt)) throw new UserError("I couldn't read that time. Try `8pm`, `tonight 8pm`, `tomorrow 19:30`, `in 2 hours` or `2026-11-07 20:00`.");
        if (startsAt < now() - 60_000) throw new UserError("That time has already passed.");
        if (startsAt > now() + MAX_AHEAD_MS) throw new UserError("Pick a time within the next 30 days.");
        if (db.countOpenLfgBy(guildId, creatorId) >= MAX_OPEN_PER_PERSON) throw new UserError(`You already have ${MAX_OPEN_PER_PERSON} open posts here. Close one first.`);
        const post = db.createLfg({ guild_id: guildId, channel_id: channelId, creator_id: creatorId, game, starts_at: Math.max(startsAt, now()), slots, note: String(note ?? "").trim().slice(0, 200) || null });
        const pingRole = db.getCommunity?.(guildId)?.ping_lfg;
        const msg = await discord.post(channelId, { ...lfgPayload(post, db.lfgMembers(post.id)), ...(pingRole ? { content: `<@&${pingRole}> **${post.game}**`, allowedMentions: { roles: [pingRole] } } : {}) });
        let eventId = null, eventError = null;
        if (event) {
            if (!discord.createEvent) eventError = "Events are not available here.";
            else {
                try {
                    eventId = (await discord.createEvent(guildId, { name: `${game} (looking for group)`.slice(0, 100), start: post.starts_at, end: post.starts_at + 2 * 3600_000, location: `Discord, <#${channelId}>`, description: post.note ?? "Join with the button on the post." }))?.id ?? null;
                } catch (err) { eventError = "I couldn't create the event. The bot needs the Manage Events permission."; log(`event failed: ${err.message}`); }
            }
        }
        db.setLfgMessage(post.id, msg.id, eventId);
        return { post: db.getLfg(post.id), eventError };
    }

    async function join(id, userId) {
        const p = db.getLfg(id);
        if (!p || p.status !== "open") throw new UserError("That post is closed.");
        const r = db.joinLfg(id, userId);
        if (r === "full") throw new UserError("That group is full.");
        if (r === "joined") await refresh(p);
        return { result: r, post: p };
    }
    async function leave(id, userId) {
        const p = db.getLfg(id);
        if (!p || p.status !== "open") throw new UserError("That post is closed.");
        if (!db.leaveLfg(id, userId)) throw new UserError("You are not in that group.");
        await refresh(p);
        return p;
    }
    async function close(id, userId, { canManage = false } = {}) {
        const p = db.getLfg(id);
        if (!p) throw new UserError("I can't find that post.");
        if (p.creator_id !== userId && !canManage) throw new UserError("Only the person who posted it, or a server manager, can close it.");
        if (!db.closeLfg(id)) throw new UserError("That post is already closed.");
        await refresh({ ...p, status: "closed" });
        return p;
    }

    /** Reminds the group when it starts, and closes posts a few hours after. Safe to run often. */
    async function tick() {
        const at = now();
        let reminded = 0, expired = 0;
        for (const p of db.lfgToRemind(at)) {
            db.markLfgReminded(p.id);
            const m = db.lfgMembers(p.id);
            if (m.length >= 2) {
                try { await discord.post(p.channel_id, { content: `**${p.game}** is starting: ${m.map(x => `<@${x}>`).join(" ")}`, allowedMentions: { users: m } }); reminded++; }
                catch (err) { log(`reminder failed for post ${p.id}: ${err.message}`); }
            }
        }
        for (const p of db.lfgToExpire(at, GRACE_MS)) { db.closeLfg(p.id); await refresh({ ...p, status: "closed" }); expired++; }
        return { reminded, expired };
    }
    return { create, join, leave, close, tick };
}

// The calendar: one list of what is coming up for a member (release dates of wishlisted games, Steam sales, their servers' events
// and open looking-for-group posts), server events added by managers with an announcement and a reminder, and a standard .ics
// feed for anyone who wants it in another calendar app.
import { SALES } from "./salescal.js";
import { UserError } from "./errors.js";

export const MAX_UPCOMING_PER_SERVER = 40;
export const KINDS = ["release", "sale", "event", "lfg"];
const DAY = 86400_000;

/** Entries { kind, title, start, end, allDay, notes, guild_id, id } between `from` and `to` (ms), soonest first. */
export function calendarEntries(db, userId, { from, to, guildIds = [], kinds = KINDS }) {
    const out = [];
    const want = new Set(kinds);
    if (want.has("release")) {
        for (const it of db.listItems(userId)) {
            if (it.release_at && it.release_at >= from && it.release_at <= to) out.push({ kind: "release", title: `${it.title} releases`, start: it.release_at, end: null, allDay: true, notes: "A game on your wishlist.", itad_id: it.itad_id });
        }
    }
    if (want.has("sale")) {
        for (const s of SALES) if (s.end >= from && s.start <= to) out.push({ kind: "sale", title: s.name, start: s.start, end: s.end, allDay: true, notes: s.note ?? "" });
    }
    for (const gid of guildIds) {
        if (want.has("event")) for (const e of db.listCalEvents(gid, from, to)) out.push({ kind: "event", id: e.id, guild_id: gid, title: e.title, start: e.starts_at, end: null, allDay: false, notes: e.notes ?? "", channel_id: e.channel_id });
        if (want.has("lfg")) for (const p of db.listOpenLfg(gid)) if (p.starts_at >= from && p.starts_at <= to) out.push({ kind: "lfg", id: p.id, guild_id: gid, title: `${p.game} (group)`, start: p.starts_at, end: null, allDay: false, notes: p.note ?? "" });
    }
    return out.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
}

const esc = s => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = ms => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const dateOnly = ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
const fold = line => { const out = []; let s = line; while (s.length > 74) { out.push(s.slice(0, 74)); s = " " + s.slice(74); } out.push(s); return out.join("\r\n"); };

/** A standard iCalendar (.ics) document for any calendar app. */
export function toIcs(entries, { name = "Steam Value Checker", now = Date.now() } = {}) {
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Steam Value Checker//Calendar//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${esc(name)}`];
    for (const e of entries) {
        lines.push("BEGIN:VEVENT", `UID:svc-${e.kind}-${e.id ?? e.itad_id ?? e.start}-${e.guild_id ?? "me"}@steamvaluechecker`, `DTSTAMP:${stamp(now)}`);
        if (e.allDay) {
            lines.push(`DTSTART;VALUE=DATE:${dateOnly(e.start)}`, `DTEND;VALUE=DATE:${dateOnly((e.end ?? e.start) + DAY)}`);
        } else {
            lines.push(`DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end ?? e.start + 3600_000)}`);
        }
        lines.push(`SUMMARY:${esc(e.title)}`);
        if (e.notes) lines.push(`DESCRIPTION:${esc(e.notes)}`);
        lines.push("END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    return lines.map(fold).join("\r\n") + "\r\n";
}

export const REMIND_CHOICES = [0, 15, 60, 1440];

/** Checks a new server event. Throws UserError with a plain message. */
export function cleanEvent({ title, notes, startsAt, remindMin = 60 }, now = Date.now()) {
    const t = String(title ?? "").trim().replace(/\s+/g, " ");
    if (!t) throw new UserError("Give the event a title.");
    if (t.length > 80) throw new UserError("Keep the title to 80 characters.");
    const n = String(notes ?? "").trim();
    if (n.length > 400) throw new UserError("Keep the notes to 400 characters.");
    const at = Number(startsAt);
    if (!Number.isFinite(at)) throw new UserError("I could not read that date and time.");
    if (at < now - 5 * 60_000) throw new UserError("That time has already passed.");
    if (at > now + 400 * DAY) throw new UserError("Pick a date within the next year.");
    const r = Number(remindMin);
    if (!REMIND_CHOICES.includes(r)) throw new UserError("Reminder can be none, 15 minutes, 1 hour or 1 day before.");
    return { title: t, notes: n || null, starts_at: Math.round(at), remind_min: r };
}

export function eventEmbed(ev, { reminder = false } = {}) {
    const ts = Math.floor(ev.starts_at / 1000);
    return {
        color: 0x5865f2, title: `${reminder ? "⏰ Starting soon: " : "📅 "}${ev.title}`,
        description: [`<t:${ts}:F> (<t:${ts}:R>)`, ev.notes].filter(Boolean).join("\n\n"),
        footer: { text: "Server event · /calendar view shows what is coming up" }
    };
}

export function createCalendarService({ db, discord, now = () => Date.now(), log = () => {} }) {
    async function create({ guildId, creatorId, title, notes, startsAt, channelId = null, remindMin = 60 }) {
        const c = cleanEvent({ title, notes, startsAt, remindMin }, now());
        if (db.countUpcomingCalEvents(guildId, now()) >= MAX_UPCOMING_PER_SERVER) throw new UserError(`This server already has ${MAX_UPCOMING_PER_SERVER} upcoming events. Remove one first.`);
        const id = db.createCalEvent({ ...c, guild_id: guildId, channel_id: channelId, created_by: creatorId });
        let announced = false;
        if (channelId) {
            try { const m = await discord.post(channelId, { embeds: [eventEmbed({ ...c, id })], allowedMentions: { parse: [] } }); db.setCalMessage(id, m.id); announced = true; }
            catch (err) { log(`event announcement failed: ${err.message}`); }
        }
        return { id, announced };
    }
    const remove = (id, guildId) => db.deleteCalEvent(Number(id), guildId);
    /** Posts the "starting soon" reminder once, and tidies up old events. Run every few minutes. */
    async function tick() {
        for (const ev of db.calEventsToRemind(now())) {
            db.markCalReminded(ev.id);
            if (!ev.channel_id || now() > ev.starts_at + 30 * 60_000) continue;
            try { await discord.post(ev.channel_id, { embeds: [eventEmbed(ev, { reminder: true })], allowedMentions: { parse: [] } }); }
            catch (err) { log(`event reminder failed: ${err.message}`); }
        }
        db.pruneCalEvents(now());
    }
    return { create, remove, tick };
}

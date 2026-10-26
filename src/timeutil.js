// Local-time helpers for quiet hours and the weekly digest. Uses the built-in Intl, no packages.

export function validTimezone(tz) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return typeof tz === "string" && tz.length > 0; }
    catch { return false; }
}

/** { minutes (since local midnight), weekday (0=Sunday), ymd } for a moment in a time zone. */
export function localParts(ms, tz = "UTC") {
    const zone = validTimezone(tz) ? tz : "UTC";
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
        timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", weekday: "short"
    }).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
    return {
        minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
        weekday,
        ymd: `${parts.year}-${parts.month}-${parts.day}`
    };
}

/** "22:30" or "10:30 pm" or "7" -> minutes since midnight, or null. */
export function parseClock(text) {
    const m = String(text ?? "").trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (!m) return null;
    let h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    if (min > 59) return null;
    if (m[3]) { if (h < 1 || h > 12) return null; h = (h % 12) + (m[3] === "pm" ? 12 : 0); }
    else if (h > 23) return null;
    return h * 60 + min;
}

export function formatClock(minutes) {
    if (minutes === null || minutes === undefined) return null;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Is it inside the user's quiet hours right now? Windows may cross midnight (22:00 to 07:00). */
export function isQuiet(user, ms) {
    const { quiet_start: a, quiet_end: b } = user;
    if (a === null || a === undefined || b === null || b === undefined || a === b) return false;
    const m = localParts(ms, user.tz).minutes;
    return a < b ? m >= a && m < b : m >= a || m < b;
}

export const DIGEST_HOUR = 9;

/** Weekly digest: on the chosen weekday, from 9:00 local time, once per local day. */
export function digestDue(user, ms) {
    if (!user.digest) return false;
    const here = localParts(ms, user.tz);
    if (here.weekday !== user.digest_day || here.minutes < DIGEST_HOUR * 60) return false;
    if (user.last_digest_at && localParts(user.last_digest_at, user.tz).ymd === here.ymd) return false;
    return true;
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

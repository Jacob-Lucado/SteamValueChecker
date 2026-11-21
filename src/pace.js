// "When will I get through my backlog?" An honest guess from the member's own habits, not from game-length databases:
// how many hours a week they have really been playing (the playtime the bot tracked) and how long the games they
// finished took them. It says so plainly, because it is a guess.

const DAY = 86400_000;
export const WINDOW_DAYS = 56;      // eight weeks of play decides the pace
export const DEFAULT_HOURS = 12;    // used when nothing has been finished yet
const MIN_HOURS_WEEK = 0.5;

/** Average hours of the games marked finished (at least an hour each), or the default. */
export function hoursPerGame(rows) {
    const done = rows.filter(r => r.status === "finished" && (r.minutes ?? 0) >= 60).map(r => r.minutes / 60);
    if (!done.length) return { hours: DEFAULT_HOURS, basis: "default" };
    done.sort((a, b) => a - b);
    // The middle value, so one 900-hour game doesn't make every backlog game look endless.
    const mid = done.length % 2 ? done[(done.length - 1) / 2] : (done[done.length / 2 - 1] + done[done.length / 2]) / 2;
    return { hours: Math.min(60, Math.max(3, Math.round(mid * 10) / 10)), basis: "finished", samples: done.length };
}

/** Hours per week across the last eight weeks, from the tracked day-by-day log. */
export function weeklyHours(log, nowMs = Date.now()) {
    const from = new Date(nowMs - WINDOW_DAYS * DAY).toISOString().slice(0, 10);
    const minutes = log.filter(r => String(r.day) >= from).reduce((t, r) => t + (r.minutes ?? 0), 0);
    return Math.round((minutes / 60 / (WINDOW_DAYS / 7)) * 10) / 10;
}

/**
 * The forecast: { games, hoursNeeded, perGame, perWeek, weeks, date, label, enough }.
 * `enough` is false when there is no recent play to base it on (no date is given then).
 */
export function backlogForecast(rows, log, nowMs = Date.now()) {
    const open = rows.filter(r => (r.status ?? "backlog") === "backlog" && (r.minutes ?? 0) < 60);
    const per = hoursPerGame(rows);
    const perWeek = weeklyHours(log, nowMs);
    const hoursNeeded = Math.round(open.length * per.hours);
    const out = { games: open.length, hoursNeeded, perGame: per.hours, perGameBasis: per.basis, perWeek, enough: perWeek >= MIN_HOURS_WEEK, weeks: null, date: null, label: null };
    if (!open.length) return { ...out, label: "Your backlog is empty." };
    if (!out.enough) return { ...out, label: `About ${hoursNeeded.toLocaleString("en-US")} hours of games waiting. Play a little with Steam linked and a finish date shows up here.` };
    const weeks = hoursNeeded / perWeek;
    out.weeks = Math.round(weeks);
    const d = new Date(nowMs + weeks * 7 * DAY);
    out.date = d.toISOString().slice(0, 10);
    const when = weeks > 520 ? "more than ten years from now" : weeks > 104 ? `around ${d.getUTCFullYear()}` : d.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    out.label = `At ${perWeek} hours a week, ${when}.`;
    return out;
}

// Steam's sale calendar. Valve publishes it ahead of time; update this list when new dates are announced
// (source: Valve's published sale and festival schedule). Black Friday week has no fixed Valve date.
export const SALES_UPDATED = "2026-10-26";
const d = s => Date.parse(s + "T17:00:00Z"); // Steam events start at 10am Pacific
export const SALES = [
    { name: "Steam Scream V Fest", kind: "fest", start: d("2026-10-26"), end: d("2026-11-02") },
    { name: "Steam Winter Sale", kind: "sale", start: d("2026-12-17"), end: d("2027-01-04"), note: "Usually the deepest discounts of the year." },
    { name: "Steam Next Fest", kind: "fest", start: d("2027-02-22"), end: d("2027-03-01"), note: "Free demos." },
    { name: "Steam Spring Sale", kind: "sale", start: d("2027-03-18"), end: d("2027-03-25") },
    { name: "Steam Next Fest", kind: "fest", start: d("2027-06-14"), end: d("2027-06-21"), note: "Free demos." },
    { name: "Steam Summer Sale", kind: "sale", start: d("2027-06-24"), end: d("2027-07-08"), note: "A major sale, second only to winter." }
];

/** Events that are on now or still to come, soonest first. */
export function upcomingSales(now = Date.now(), { limit = 6, salesOnly = false } = {}) {
    return SALES.filter(s => s.end > now && (!salesOnly || s.kind === "sale"))
        .map(s => ({ ...s, live: s.start <= now }))
        .sort((a, b) => a.start - b.start)
        .slice(0, limit);
}

export function salesEmbed(events, { now = Date.now(), watching = null } = {}) {
    const t = (ms, f = "R") => `<t:${Math.floor(ms / 1000)}:${f}>`;
    const lines = events.map(e => `${e.live ? "🟢 **ON NOW**" : e.kind === "sale" ? "🏷️" : "🎪"} **${e.name}**\n${t(e.start, "D")} to ${t(e.end, "D")}  •  ${e.live ? "ends " + t(e.end) : "starts " + t(e.start)}${e.note ? `\n*${e.note}*` : ""}`);
    return {
        color: 0x1b9aaa, title: "Steam sale calendar",
        description: lines.join("\n\n") || "No upcoming Steam events are listed right now.",
        footer: { text: `Dates from Valve's published schedule (updated ${SALES_UPDATED}). Black Friday week deals are announced closer to the time.${watching ? `  •  You watch ${watching} games` : ""}` }
    };
}

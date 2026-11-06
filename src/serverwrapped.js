// Server wrapped: the year so far for everyone in a server who opted in with /alerts share. One picture with the group's
// hours, the games the server actually played, who put in the most time and how many games got finished.
import { renderPanel } from "./aipics.js";

const hoursOf = m => Math.round(m / 60);
const n = x => x.toLocaleString("en-US");

/** The numbers behind the picture, or null when nobody who shares has tracked any time this year. */
export function buildServerWrapped(db, guildId, nowMs = Date.now()) {
    const year = new Date(nowMs).getUTCFullYear();
    const fromDay = `${year}-01-01`;
    const games = db.sharedGameHours(guildId, fromDay);
    if (!games.length) return null;
    const people = db.sharedHours(guildId, fromDay);
    const totalMinutes = people.reduce((t, p) => t + p.minutes, 0);
    const finished = db.sharedFinished(guildId, Date.UTC(year, 0, 1), Date.UTC(year + 1, 0, 1)).reduce((t, r) => t + r.done, 0);
    const everyonesGame = [...games].filter(g => g.players >= 2).sort((a, b) => b.players - a.players || b.minutes - a.minutes)[0] ?? null;
    return { year, members: people.length, totalMinutes, top: games.slice(0, 5), everyonesGame, finished, mvp: people.slice(0, 3), gamesPlayed: games.length };
}

/** `nameOf(discordId)` gives a display name. Returns a PNG buffer. */
export async function renderServerWrapped(data, { guildName = "Your server", nameOf = id => id, fetchImpl } = {}) {
    const topMinutes = data.top[0]?.minutes || 1;
    const rows = data.top.map((g, i) => ({ label: `${i + 1}. ${g.title}`, sub: `${g.players} ${g.players === 1 ? "member" : "members"} played it`, value: `${n(hoursOf(g.minutes))} h`, pct: Math.max(6, g.minutes / topMinutes * 100) }));
    if (data.everyonesGame && data.everyonesGame.title !== data.top[0].title) rows.push({ label: `Shared favourite: ${data.everyonesGame.title}`, sub: `${data.everyonesGame.players} members played it`, value: `${n(hoursOf(data.everyonesGame.minutes))} h` });
    const mvp = data.mvp[0];
    return renderPanel({
        title: `${guildName}: ${data.year} wrapped`, sub: "The year so far, from members who share with this server",
        accent: "#c084fc",
        tiles: [{ label: "Hours played", value: n(hoursOf(data.totalMinutes)) }, { label: "Members", value: n(data.members) }, { label: "Different games", value: n(data.gamesPlayed) }, { label: "Games finished", value: n(data.finished) }],
        rows: [...rows, ...(mvp ? [{ label: `Most hours: ${nameOf(mvp.discord_id)}`, sub: data.mvp.slice(1).map(p => `${nameOf(p.discord_id)} ${n(hoursOf(p.minutes))} h`).join(" · ") || undefined, value: `${n(hoursOf(mvp.minutes))} h` }] : [])].slice(0, 8),
        foot: "Only members who opted in with /alerts share are counted."
    }, { fetchImpl });
}

// Two small things for the bot owner: a Monday summary DM, and posting new release notes to a channel of their choosing.
import { readEvents } from "./adminlog.js";

const WEEK = 7 * 86_400_000;

// Week number in Eastern time, so "Monday morning" means Monday for the owner and the summary goes out once per week.
export function easternWeek(ms) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
        .formatToParts(new Date(ms)).map(x => [x.type, x.value]));
    const day = Date.UTC(+p.year, +p.month - 1, +p.day);
    const monday = day - ((["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday)) * 86_400_000);
    return { weekday: p.weekday, key: new Date(monday).toISOString().slice(0, 10) };
}

/** The past week of landing-page traffic and the most opened pages, or null when nothing has been counted. */
export function trafficOf(db) {
    try {
        const { pages, days } = db.trafficReport();
        const week = days.slice(-7), sum = f => week.reduce((n, d) => n + d[f], 0);
        const top = pages.filter(p => p.visits > 0).sort((a, b) => b.visits - a.visits).slice(0, 3).map(p => ({ title: (p.path === "b" ? db.getFeedBundle(p.id) : db.getDeal(p.id))?.title ?? "(removed)", visits: p.visits, clicks: p.clicks }));
        return sum("visits") || sum("clicks") || top.length ? { visits: sum("visits"), clicks: sum("clicks"), previews: sum("previews"), top } : null;
    } catch { return null; }
}

export function summaryEmbed({ servers, joined, left, votes, errors, diskPct, openTickets, week, traffic = null }) {
    const fields = [
        { name: "🌐 Servers", value: `**${servers ?? "-"}**${joined || left ? `  (+${joined} / -${left} this week)` : ""}`, inline: true },
        { name: "🗳️ Votes", value: `**${votes}**`, inline: true },
        { name: "⚠️ Errors logged", value: `**${errors ?? "-"}**`, inline: true }
    ];
    if (diskPct != null) fields.push({ name: "💾 Disk", value: `**${diskPct}%** used`, inline: true });
    if (openTickets != null) fields.push({ name: "🎫 Open tickets", value: `**${openTickets}**`, inline: true });
    if (traffic) {
        const rate = traffic.visits ? ` (${Math.round(traffic.clicks / traffic.visits * 100)}% went on to the store)` : "";
        fields.push({ name: "🔗 Link traffic, last 7 days", value: `**${traffic.visits}** visits, **${traffic.clicks}** clicks${rate}` + (traffic.top.length ? `\nMost opened overall: ${traffic.top.map(p => `**${p.title}** (${p.visits})`).join(", ")}` : ""), inline: false });
    }
    return { color: 0xff9800, title: "Your week with Steam Value Checker", description: `Week of ${week}`, fields, footer: { text: "Sent Mondays. Details are on the Admin pages." } };
}

/** Sends the summary once each Monday (Eastern). `gather` returns the live numbers; the rest comes from the stored event lists. */
export async function runOwnerSummary({ db, ownerId, sendDm, gather, now = () => Date.now() }) {
    if (!ownerId) return { sent: false, why: "no owner" };
    const t = now(), wk = easternWeek(t);
    if (wk.weekday !== "Mon") return { sent: false, why: "not monday" };
    const key = `ownersummary:${wk.key}`;
    if (db.getMeta(key)) return { sent: false, why: "already sent" };
    const since = t - WEEK;
    const srv = readEvents(db, "adminlog:servers").filter(e => e.at >= since);
    const votes = readEvents(db, "topgg:recent", 30).filter(e => e.at >= since).length;
    let live = {};
    try { live = (await gather?.()) ?? {}; } catch { /* the numbers that need a live connection just show a dash */ }
    db.setMeta(key, String(t));
    await sendDm(ownerId, { embeds: [summaryEmbed({ ...live, joined: srv.filter(e => e.kind === "join").length, left: srv.filter(e => e.kind === "leave").length, votes, week: wk.key, traffic: trafficOf(db) })] });
    return { sent: true };
}

/** Posts the newest changelog entry to a channel when a new version ships. The first run only records the version, so old notes aren't replayed. */
export async function runReleaseNotes({ db, channelId, version, entry, sendChannel }) {
    if (!channelId || !entry) return { posted: false };
    const seen = db.getMeta("release:posted");
    if (seen === version) return { posted: false };
    if (!seen) { db.setMeta("release:posted", version); return { posted: false, recorded: true }; }
    await sendChannel(channelId, { embeds: [{ color: 0xff9800, title: `🆕 ${entry.title}`, description: entry.items.map(x => "• " + x).join("\n").slice(0, 4000), footer: { text: `Version ${version}  ·  ${entry.date}` } }] });
    db.setMeta("release:posted", version);
    return { posted: true };
}

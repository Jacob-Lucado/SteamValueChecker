// A monthly pick from the member's backlog. Uses the library as stored (no price lookups), so it is cheap to run for everyone.
import { playNext } from "./library.js";
import { steamArt } from "./render.js";
import { isQuiet } from "./timeutil.js";

const PER_RUN = 25;

export function nudgeEmbed(pick, remaining) {
    return {
        color: 0x5865f2, title: `🎯 This month, try ${pick.title}`,
        description: `${pick.why}${remaining > 0 ? `\n\n${remaining} more game${remaining === 1 ? "" : "s"} are waiting in your backlog.` : ""}`,
        thumbnail: Number.isInteger(pick.appid) ? { url: steamArt(pick.appid) } : undefined,
        footer: { text: "Mark games with /me library status  •  Turn this off with /alerts nudge" }
    };
}

export async function runBacklogNudge({ db, notifier, now = () => Date.now() }) {
    const stats = { checked: 0, delivered: 0, failed: 0, deferred: 0, skipped: 0 };
    const month = new Date(now()).toISOString().slice(0, 7), key = `nudge:${month}`;
    let sent = 0;
    for (const user of db.nudgeUsers()) {
        const id = user.discord_id;
        if (db.hasSeen(id, key)) continue;
        if (sent >= PER_RUN) break;
        stats.checked++;
        const rows = db.listLibrary(id).map(r => ({ ...r, status: r.status ?? "backlog", minutes: r.minutes ?? 0 })).filter(r => r.minutes < 120);
        // Same pick the "play next" button would make, but always the top spend so the message doesn't change if it is resent.
        const next = playNext(rows, { rand: () => 0 });
        if (!next) { db.markSeen(id, key); stats.skipped++; continue; }
        if (isQuiet(user, now())) { stats.deferred++; continue; }
        sent++;
        const res = await notifier.deliver(user, { embeds: [nudgeEmbed({ ...next.pick, why: next.why }, next.remaining)] }, "nudge");
        if (!res.ok) { stats.failed++; continue; }
        stats.delivered++;
        db.markSeen(id, key);
        db.logAlert({ discord_id: id, itad_id: next.pick.itad_id, title: next.pick.title, kind: "nudge", via: res.via });
    }
    return stats;
}

export const ACH_MAX_LEFT = 3, ACH_MIN_PERCENT = 0.85, ACH_MIN_MINUTES = 300;

export function achievementEmbed({ title, appid, left, done, total }) {
    return {
        color: 0xfee75c, title: `🏅 ${left === 1 ? "One achievement" : `${left} achievements`} left in ${title}`,
        description: `You have **${done} of ${total}** achievements in **${title}**. ${left === 1 ? "One more" : "A few more"} and it is 100%.`,
        thumbnail: Number.isInteger(appid) ? { url: steamArt(appid) } : undefined,
        footer: { text: "Counts update when your Steam library syncs  •  Turn this off with /alerts achievements" }
    };
}

/** Games a member has played for hours and is nearly complete in. The first check is quiet, and each game is mentioned once. */
export async function runAchievementNudges({ db, notifier, now = () => Date.now() }) {
    const stats = { checked: 0, found: 0, delivered: 0, failed: 0, deferred: 0 };
    for (const user of db.achvUsers()) {
        const id = user.discord_id;
        const near = db.achievementGames(id).filter(g => g.minutes >= ACH_MIN_MINUTES && g.ach_total - g.ach_done <= ACH_MAX_LEFT && g.ach_done / g.ach_total >= ACH_MIN_PERCENT);
        stats.checked++;
        const first = !db.hasSeen(id, "achstart");
        const fresh = near.filter(g => !db.hasSeen(id, `ach:${g.itad_id}`));
        if (first) { for (const g of near) db.markSeen(id, `ach:${g.itad_id}`); db.markSeen(id, "achstart"); continue; }
        if (!fresh.length) continue;
        stats.found += fresh.length;
        if (isQuiet(user, now())) { stats.deferred += fresh.length; continue; }
        const part = fresh.sort((a, b) => (a.ach_total - a.ach_done) - (b.ach_total - b.ach_done)).slice(0, 4);
        const res = await notifier.deliver(user, { embeds: part.map(g => achievementEmbed({ title: g.title, appid: g.appid, left: g.ach_total - g.ach_done, done: g.ach_done, total: g.ach_total })) }, "achv");
        if (!res.ok) { stats.failed += part.length; continue; }
        stats.delivered += part.length;
        for (const g of part) { db.markSeen(id, `ach:${g.itad_id}`); db.logAlert({ discord_id: id, itad_id: g.itad_id, title: g.title, kind: "achv", via: res.via }); }
    }
    return stats;
}

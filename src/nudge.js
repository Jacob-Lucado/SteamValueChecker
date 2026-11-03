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

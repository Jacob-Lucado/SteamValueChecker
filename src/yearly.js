// The year in games card: sent once, from December 26, to members who asked for it and have tracked hours.
import { isQuiet } from "./timeutil.js";

export const YEARLY_FROM_MONTH = 11, YEARLY_FROM_DAY = 26; // December 26 (UTC)
const PER_RUN = 5;

export const yearlyOpen = t => { const d = new Date(t); return d.getUTCMonth() > YEARLY_FROM_MONTH || (d.getUTCMonth() === YEARLY_FROM_MONTH && d.getUTCDate() >= YEARLY_FROM_DAY); };

/** `render(userId, name)` returns the recap picture (a PNG buffer) or null when nothing is tracked. */
export async function runYearInGames({ db, notifier, render, now = () => Date.now() }) {
    const stats = { checked: 0, delivered: 0, failed: 0, deferred: 0, skipped: 0 };
    if (!yearlyOpen(now())) return stats;
    const year = new Date(now()).getUTCFullYear();
    let sentThisRun = 0;
    for (const user of db.yearlyUsers()) {
        const id = user.discord_id, key = `yir:${year}`;
        if (db.hasSeen(id, key)) continue;
        if (sentThisRun >= PER_RUN) break;
        stats.checked++;
        if (isQuiet(user, now())) { stats.deferred++; continue; }
        let png = null;
        try { png = await render(id, null); } catch { png = null; }
        if (!png) { db.markSeen(id, key); stats.skipped++; continue; } // nothing tracked this year: nothing to send
        sentThisRun++;
        const embed = { color: 0x5865f2, title: `🎮 Your ${year} in games`, image: { url: "attachment://year-in-games.png" }, footer: { text: "Turn this off with /alerts yearinreview. See it any time with /me steam recap" } };
        const res = await notifier.deliver(user, { embeds: [embed], files: [{ attachment: Buffer.from(png), name: "year-in-games.png", description: `Your ${year} in games` }] }, "yearly");
        if (!res.ok) { stats.failed++; continue; }
        stats.delivered++;
        db.markSeen(id, key);
        db.logAlert({ discord_id: id, itad_id: "yearly", title: `Your ${year} in games`, kind: "yearly", via: res.via });
    }
    return stats;
}

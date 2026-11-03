// Two small play-based alerts: a heads-up before the refund window closes, and cards for playtime milestones.
// Both only look at the member's own Steam library rows, so they need no outside lookups.
import { steamArt } from "./render.js";
import { isQuiet } from "./timeutil.js";

const DAY = 86400_000;
export const REFUND_DAYS = 14;
export const REFUND_WARN_DAYS_LEFT = 2;
export const REFUND_MAX_MINUTES = 120;
export const MILESTONE_HOURS = [100, 250, 500, 1000, 2000];

export function refundEmbed({ title, appid, hoursLeft, minutes }) {
    const left = hoursLeft <= 24 ? "about a day" : `about ${Math.ceil(hoursLeft / 24)} days`;
    return {
        color: 0xfee75c, title: `⏳ Refund window for ${title} closes in ${left}`,
        description: `Steam refunds a game within 14 days of buying it if you have played under 2 hours${minutes ? ` (you are at ${minutes} min)` : ""}. If it isn't for you, now is the time.`,
        thumbnail: Number.isInteger(appid) ? { url: steamArt(appid) } : undefined,
        footer: { text: "The date is estimated from when the bot first saw the game. Refund reminders can be turned off with /alerts refund" }
    };
}

export function runRefundWarnings({ db, notifier, now = () => Date.now() }) {
    return (async () => {
        const stats = { checked: 0, found: 0, delivered: 0, failed: 0, deferred: 0 };
        for (const user of db.refundUsers()) {
            const id = user.discord_id, t = now();
            const rows = db.refundCandidates(id, t - REFUND_DAYS * DAY)
                .map(r => ({ ...r, hoursLeft: (r.added_at + REFUND_DAYS * DAY - t) / 3600_000 }))
                .filter(r => r.hoursLeft > 0 && r.hoursLeft <= REFUND_WARN_DAYS_LEFT * 24 && !db.hasSeen(id, `refund:${r.itad_id}`));
            stats.checked++;
            if (!rows.length) continue;
            stats.found += rows.length;
            if (isQuiet(user, t)) { stats.deferred += rows.length; continue; }
            const part = rows.slice(0, 5);
            const res = await notifier.deliver(user, { embeds: part.map(r => refundEmbed({ title: r.title, appid: r.appid, hoursLeft: r.hoursLeft, minutes: r.minutes })) }, "refund");
            if (!res.ok) { stats.failed += part.length; continue; }
            stats.delivered += part.length;
            for (const r of part) { db.markSeen(id, `refund:${r.itad_id}`); db.logAlert({ discord_id: id, itad_id: r.itad_id, title: r.title, kind: "refund", via: res.via }); }
        }
        return stats;
    })();
}

export function milestoneEmbed({ title, appid, hours, minutes }) {
    const total = Math.floor(minutes / 60);
    return {
        color: 0x5865f2, title: `🏆 ${hours} hours in ${title}`,
        description: `You have played **${total.toLocaleString("en-US")} hours** of **${title}**. That is about ${(total / 24).toFixed(total >= 240 ? 0 : 1)} full days.`,
        thumbnail: Number.isInteger(appid) ? { url: steamArt(appid) } : undefined,
        footer: { text: "Playtime milestones can be turned off with /alerts milestones" }
    };
}

export const highestMilestone = minutes => MILESTONE_HOURS.filter(h => minutes >= h * 60).pop() ?? null;

/** The first check only remembers where each game already is; after that a card goes out when a game reaches a higher milestone. */
export async function runMilestones({ db, notifier, now = () => Date.now() }) {
    const stats = { checked: 0, found: 0, delivered: 0, failed: 0, deferred: 0 };
    for (const user of db.milestoneUsers()) {
        const id = user.discord_id;
        const rows = db.playedGames(id, MILESTONE_HOURS[0] * 60);
        stats.checked++;
        const first = !db.hasSeen(id, "milestart");
        const hits = [];
        for (const r of rows) {
            const h = highestMilestone(r.minutes);
            if (!h) continue;
            const key = `mile:${r.itad_id}:${h}`;
            if (db.hasSeen(id, key)) continue;
            if (first) { db.markSeen(id, key); continue; }
            hits.push({ ...r, hours: h, key });
        }
        if (first) { db.markSeen(id, "milestart"); continue; }
        if (!hits.length) continue;
        stats.found += hits.length;
        if (isQuiet(user, now())) { stats.deferred += hits.length; continue; }
        const part = hits.sort((a, b) => b.hours - a.hours).slice(0, 5);
        const res = await notifier.deliver(user, { embeds: part.map(r => milestoneEmbed({ title: r.title, appid: r.appid, hours: r.hours, minutes: r.minutes })) }, "milestones");
        if (!res.ok) { stats.failed += part.length; continue; }
        stats.delivered += part.length;
        // Every lower milestone for the same game counts as told as well.
        for (const r of part) { for (const h of MILESTONE_HOURS.filter(h => h <= r.hours)) db.markSeen(id, `mile:${r.itad_id}:${h}`); db.logAlert({ discord_id: id, itad_id: r.itad_id, title: r.title, kind: "milestones", via: res.via }); }
    }
    return stats;
}

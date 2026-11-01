// Sends new game codes and promo news to members who asked for them, as DMs (or their alert channel), and keeps a copy in
// their notification center. Each one goes to each member once, and only what showed up after they turned it on.
import { codeEmbed } from "./codes.js";
import { newsEmbed } from "./drops.js";
import { isQuiet } from "./timeutil.js";

const MAX_PER_RUN = 5;
// Direct messages carry no allowed_mentions of ours, and the channel route adds its own.
const plain = ({ allowed_mentions, ...rest }) => rest;

export async function sendCodeAlerts({ db, notifier, now = Date.now, log = () => {} }) {
    const stats = { delivered: 0, failed: 0, deferred: 0 };
    const active = db.listCodes({ status: "active", limit: 100 }).filter(c => !c.expires_at || c.expires_at > now());
    for (const sub of db.alertSubscribers("codes")) {
        const user = db.getUser(sub.id);
        if (!user) continue;
        const mine = active.filter(c => (c.added_at ?? c.first_seen) >= (sub.codes_since ?? 0) && (!sub.games.length || sub.games.includes(c.game)) && !db.hasSeen(sub.id, `code:${c.id}`));
        if (!mine.length) continue;
        if (isQuiet(user, now())) { stats.deferred += mine.length; continue; }
        for (const c of mine.slice(0, MAX_PER_RUN).reverse()) {
            const res = await notifier.deliver(user, plain(codeEmbed(c)), "codes");
            if (!res.ok) { stats.failed++; log(`code alert not delivered (${res.reason ?? "unknown"})`); break; }
            db.markSeen(sub.id, `code:${c.id}`);
            stats.delivered++;
        }
        for (const c of mine.slice(MAX_PER_RUN)) db.markSeen(sub.id, `code:${c.id}`); // a backlog is not worth a flood
    }
    return stats;
}

export async function sendNewsAlerts({ db, notifier, now = Date.now, log = () => {} }) {
    const stats = { delivered: 0, failed: 0, deferred: 0 };
    const news = db.listNews(30);
    for (const sub of db.alertSubscribers("promos")) {
        const user = db.getUser(sub.id);
        if (!user) continue;
        const mine = news.filter(n => n.seen_at >= (sub.promos_since ?? 0) && !db.hasSeen(sub.id, `news:${n.id}`));
        if (!mine.length) continue;
        if (isQuiet(user, now())) { stats.deferred += mine.length; continue; }
        for (const n of mine.slice(0, MAX_PER_RUN).reverse()) {
            const res = await notifier.deliver(user, plain(newsEmbed(n)), "promo");
            if (!res.ok) { stats.failed++; log(`promo alert not delivered (${res.reason ?? "unknown"})`); break; }
            db.markSeen(sub.id, `news:${n.id}`);
            stats.delivered++;
        }
        for (const n of mine.slice(MAX_PER_RUN)) db.markSeen(sub.id, `news:${n.id}`);
    }
    return stats;
}

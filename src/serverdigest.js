// The weekly server digest: what is cheap among the games opted-in members watch, free games on now, and the week's server events.
// It never names a member. Games are listed only when at least one member who chose to share watches them.
import { summarize } from "./report.js";
import { current } from "./alerts.js";
import { isDlc } from "./freemenu.js";
import { money } from "./render.js";

export const DIGEST_HOUR_UTC = 17;   // Friday evening, ahead of the weekend
export const DIGEST_DAY_UTC = 5;

/** Friday, 17:00 UTC or later, and not already sent in the last 6 days. */
export function digestIsDue(lastAt, nowMs) {
    const d = new Date(nowMs);
    if (d.getUTCDay() !== DIGEST_DAY_UTC || d.getUTCHours() < DIGEST_HOUR_UTC) return false;
    return !lastAt || nowMs - lastAt > 6 * 86400_000;
}

export async function buildServerDigest({ db, itad, guildId, guildName = "this server", now = Date.now() }) {
    const fields = [];
    const watched = db.sharedWatchedItems(guildId);
    if (watched.length) {
        try {
            const prices = await itad.getPrices(watched.map(w => w.itad_id), "US");
            const deals = watched.map(w => ({ ...w, cur: current(summarize(prices.get(w.itad_id))), cur_c: summarize(prices.get(w.itad_id)).currency }))
                .filter(w => w.cur.discount >= 0.2 && w.cur.price !== null)
                .sort((a, b) => b.cur.discount - a.cur.discount || b.watchers - a.watchers).slice(0, 5);
            if (deals.length) fields.push({ name: "Cheap among what members watch", value: deals.map(d =>
                `• **${d.title}** ${money(d.cur.price, d.cur_c)} (-${Math.round(d.cur.discount * 100)}%)${d.watchers > 1 ? ` · ${d.watchers} members` : ""}`).join("\n") });
        } catch { /* skip this section */ }
    }
    try {
        const free = (await itad.getGiveawayList()).filter(g => g.url && !isDlc(g)).slice(0, 5);
        if (free.length) fields.push({ name: "Free right now", value: free.map(g => `• **${g.title}** on ${g.shop}${g.expiry ? ` (ends <t:${Math.floor(g.expiry / 1000)}:R>)` : ""}`).join("\n") });
    } catch { /* skip this section */ }
    const events = db.listCalEvents(guildId, now, now + 7 * 86400_000).slice(0, 5);
    if (events.length) fields.push({ name: "Coming up this week", value: events.map(e => `• **${e.title}** <t:${Math.floor(e.starts_at / 1000)}:F>`).join("\n") });
    if (!fields.length) return null;
    return { color: 0x66c0f4, title: `This week in ${guildName}`, description: "Your Friday round-up from Steam Value Checker.", fields, footer: { text: "Turn this off with /alertchannel digest" } };
}

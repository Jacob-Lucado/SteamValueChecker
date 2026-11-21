// "Smart alerts": three small, rare nudges behind one switch (/alerts extras).
//  - Review drop: a wishlist game whose last month of Steam reviews turned clearly worse (a bad patch, a review bomb).
//  - Win-back: a patch for a game you put hours into and then left alone.
//  - Time capsule: what you wishlisted or picked up a year ago, and where it ended up.
// Everything is read from what the bot already keeps, plus Steam's public review and news endpoints. Each thing is told once.
import { steamArt } from "./render.js";
import { isQuiet } from "./timeutil.js";
import { steamReviews } from "./reviews.js";

const DAY = 86400_000;
const hrs = m => Math.round((m ?? 0) / 60);
export const WIN_BACK_MIN_MINUTES = 300;       // five hours or more
export const WIN_BACK_AWAY_DAYS = 60;          // and not touched for two months
export const PATCH_FRESH_DAYS = 5;
const REVIEW_CHECKS_PER_USER = 6, REVIEW_CHECKS_PER_RUN = 60;

export function reviewDropEmbed({ title, appid, dip, overall }) {
    return {
        color: 0xed4245, title: `📉 Reviews for ${title} just got worse`,
        description: `Only **${dip.pct}%** of the last ${dip.total.toLocaleString("en-US")} reviews this month are positive${overall ? `, against ${overall}% overall` : ""}. That usually means a bad update, a broken launch or a review bomb.\n\nIt's on your wishlist, so give it a look before you buy.`,
        thumbnail: Number.isInteger(appid) ? { url: steamArt(appid) } : undefined,
        footer: { text: "Steam's own reviews  •  Turn this off with /alerts extras" }
    };
}

export function winBackEmbed({ title, appid, hours, post, away }) {
    return {
        color: 0x57f287, title: `🛠️ ${title} got an update`,
        description: `You put **${hours} hours** into it and haven't played in about ${away >= 90 ? `${Math.round(away / 30)} months` : `${away} days`}. Steam just posted: **${String(post.title).slice(0, 150)}**${post.url ? `\n[Read the patch notes](${post.url})` : ""}\n\nMight be a good time to jump back in.`,
        thumbnail: Number.isInteger(appid) ? { url: steamArt(appid) } : undefined,
        footer: { text: "Turn this off with /alerts extras" }
    };
}

export function capsuleEmbed(entries, more = 0) {
    const lines = entries.map(e => e.kind === "wish"
        ? (e.owned ? `🎮 **${e.title}**: you wishlisted it, and you own it now${e.minutes ? ` (${hrs(e.minutes)} hours played)` : ", though you haven't played it yet"}.`
            : `🕰️ **${e.title}**: you wishlisted it and it's still waiting.`)
        : `📦 **${e.title}**: you added it to your library${e.minutes >= 60 ? ` and have played ${hrs(e.minutes)} hours since` : ", and it's still untouched"}.`);
    return {
        color: 0x5865f2, title: "⏳ A year ago today",
        description: lines.join("\n") + (more > 0 ? `\n\n…and ${more} more.` : ""),
        thumbnail: Number.isInteger(entries[0]?.appid) ? { url: steamArt(entries[0].appid) } : undefined,
        footer: { text: "Turn this off with /alerts extras" }
    };
}

/** Wishlist games (not owned) whose recent reviews dropped. Each game is checked at most once a week per member and told once a month. */
export async function runReviewDrops({ db, notifier, reviews = steamReviews, now = () => Date.now() }) {
    const stats = { checked: 0, found: 0, delivered: 0, failed: 0, deferred: 0 };
    const week = Math.floor(now() / (7 * DAY)), month = new Date(now()).toISOString().slice(0, 7);
    let budget = REVIEW_CHECKS_PER_RUN;
    for (const user of db.smartUsers()) {
        if (budget <= 0) break;
        const id = user.discord_id;
        if (isQuiet(user, now())) { stats.deferred++; continue; }
        const own = new Set(db.listLibrary(id).map(g => g.itad_id));
        const queue = db.listItems(id).filter(i => Number.isInteger(i.appid) && !own.has(i.itad_id) && !db.hasSeen(id, `rvchk:${i.appid}:${week}`)).slice(0, REVIEW_CHECKS_PER_USER);
        const hits = [];
        for (const it of queue) {
            if (budget-- <= 0) break;
            stats.checked++;
            const r = await reviews(it.appid).catch(() => null);
            db.markSeen(id, `rvchk:${it.appid}:${week}`);
            if (r?.dip && !db.hasSeen(id, `rvdrop:${it.appid}:${month}`)) hits.push({ it, r });
        }
        if (!hits.length) continue;
        stats.found += hits.length;
        const part = hits.slice(0, 3);
        const res = await notifier.deliver(user, { embeds: part.map(({ it, r }) => reviewDropEmbed({ title: it.title, appid: it.appid, dip: r.dip, overall: r.pct })) }, "smart");
        if (!res.ok) { stats.failed += part.length; continue; }
        stats.delivered += part.length;
        for (const { it } of part) { db.markSeen(id, `rvdrop:${it.appid}:${month}`); db.logAlert({ discord_id: id, itad_id: it.itad_id, title: it.title, kind: "smart", via: res.via }); }
    }
    return stats;
}

/** Patch notes for games a member sank hours into and then left. `news` is the shared Steam news source. */
export async function runWinBack({ db, news, notifier, now = () => Date.now() }) {
    const stats = { checked: 0, found: 0, delivered: 0, failed: 0, deferred: 0 };
    const fresh = now() - PATCH_FRESH_DAYS * DAY, away = now() - WIN_BACK_AWAY_DAYS * DAY;
    const users = db.smartUsers();
    const mine = new Map();
    for (const u of users) {
        const games = db.listLibrary(u.discord_id).filter(g => Number.isInteger(g.appid) && (g.minutes ?? 0) >= WIN_BACK_MIN_MINUTES && (!g.last_played || g.last_played < away) && !["finished", "dropped"].includes(g.status))
            .sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0)).slice(0, 12);
        if (games.length) mine.set(u.discord_id, games);
    }
    if (!mine.size) return stats;
    let feed;
    try { feed = await news.forApps([...new Set([...mine.values()].flat().map(g => g.appid))]); } catch { return stats; }
    for (const user of users) {
        const games = mine.get(user.discord_id);
        if (!games) continue;
        const cards = [];
        for (const g of games) {
            stats.checked++;
            const post = (feed.get(g.appid) ?? []).find(p => p.patch && p.date >= fresh && !db.hasSeen(user.discord_id, `winback:${p.gid}`));
            if (post) cards.push({ g, post });
        }
        if (!cards.length) continue;
        stats.found += cards.length;
        if (isQuiet(user, now())) { stats.deferred += cards.length; continue; }
        const part = cards.slice(0, 3);
        const res = await notifier.deliver(user, { embeds: part.map(({ g, post }) => winBackEmbed({ title: g.title, appid: g.appid, hours: hrs(g.minutes), post, away: g.last_played ? Math.round((now() - g.last_played) / DAY) : 365 })) }, "smart");
        if (!res.ok) { stats.failed += part.length; continue; }
        stats.delivered += part.length;
        for (const { g, post } of part) { db.markSeen(user.discord_id, `winback:${post.gid}`); db.logAlert({ discord_id: user.discord_id, itad_id: g.itad_id, title: g.title, kind: "smart", via: res.via }); }
    }
    return stats;
}

/** What a member added about a year ago, once a day. A day with nothing from last year sends nothing. */
export async function runTimeCapsule({ db, notifier, now = () => Date.now() }) {
    const stats = { checked: 0, delivered: 0, failed: 0, deferred: 0, skipped: 0 };
    const today = new Date(now()).toISOString().slice(0, 10), key = `capsule:${today}`;
    const lo = now() - 366.5 * DAY, hi = now() - 364.5 * DAY;
    for (const user of db.smartUsers()) {
        const id = user.discord_id;
        if (db.hasSeen(id, key)) continue;
        stats.checked++;
        const lib = db.listLibrary(id), byId = new Map(lib.map(g => [g.itad_id, g]));
        const wish = db.listItems(id).filter(i => i.added_at >= lo && i.added_at <= hi).map(i => ({ kind: "wish", title: i.title, appid: i.appid ?? null, owned: byId.has(i.itad_id), minutes: byId.get(i.itad_id)?.minutes ?? 0 }));
        const wishIds = new Set(db.listItems(id).filter(i => i.added_at >= lo && i.added_at <= hi).map(i => i.itad_id));
        const bought = lib.filter(g => g.added_at >= lo && g.added_at <= hi && !wishIds.has(g.itad_id)).map(g => ({ kind: "lib", title: g.title, appid: g.appid ?? null, minutes: g.minutes ?? 0 }));
        // Games with hours first, so the card leads with something that has a story.
        const all = [...wish, ...bought].sort((a, b) => b.minutes - a.minutes || a.title.localeCompare(b.title));
        if (!all.length) { db.markSeen(id, key); stats.skipped++; continue; }
        if (isQuiet(user, now())) { stats.deferred++; continue; }
        const shown = all.slice(0, 4);
        const res = await notifier.deliver(user, { embeds: [capsuleEmbed(shown, all.length - shown.length)] }, "smart");
        if (!res.ok) { stats.failed++; continue; }
        stats.delivered++;
        db.markSeen(id, key);
        db.logAlert({ discord_id: id, itad_id: null, title: shown[0].title, kind: "smart", via: res.via });
    }
    return stats;
}

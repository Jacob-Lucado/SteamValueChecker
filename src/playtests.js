// Playtests, demos, betas and free weekends. Studios announce these in a game's Steam news, so this reads the same
// announcements the news alerts use and picks out the ones that are about trying a game early.
// Members get a DM for wishlist games they don't own; a server with a "Playtests" ping role gets a post in its alert channel
// for games its sharing members watch, with the role mentioned.
import { steamArt, safeUrl } from "./render.js";
import { isQuiet } from "./timeutil.js";

export const PLAYTEST_KINDS = {
    playtest: { icon: "🧪", label: "Playtest", re: /\bplay[\s-]?tests?\b/i },
    weekend: { icon: "🎟️", label: "Free weekend", re: /\bfree\s+(?:to\s+play\s+)?weekend\b|\bfree\s+to\s+play\s+(?:this|for)\b/i },
    demo: { icon: "🎮", label: "Demo", re: /\b(?:demo|free\s+trial)\b/i },
    beta: { icon: "🔧", label: "Beta", re: /\b(?:open|closed)?\s*beta\b/i }
};
const ORDER = ["playtest", "weekend", "demo", "beta"];
const RECENT_MS = 21 * 86400_000;
const PER_GUILD_RUN = 4;

/** What a news post is about, or null. Patch notes and hotfix posts are left out so "beta patch 1.2" doesn't count. */
export function classifyPost(post) {
    const title = String(post?.title ?? "");
    if (post?.patch || /\b(?:hotfix|patch\s*notes?|changelog)\b/i.test(title)) return null;
    return ORDER.find(k => PLAYTEST_KINDS[k].re.test(title)) ?? null;
}

export function playtestEmbed(post, kind, { watchers = 0 } = {}) {
    const k = PLAYTEST_KINDS[kind];
    return {
        color: 0xeb459e, title: `${k.icon} ${k.label}: ${post.gameTitle}`.slice(0, 256), url: safeUrl(post.url),
        description: `**${post.title}**\n${post.summary || "Open the post for how to join."}`.slice(0, 1000), timestamp: new Date(post.date).toISOString(),
        image: safeUrl(post.image) ? { url: post.image } : undefined, thumbnail: safeUrl(post.image) ? undefined : { url: steamArt(post.appid) },
        footer: { text: `${watchers > 1 ? `${watchers} members here are watching this game  •  ` : ""}Steam announcements  •  /alerts playtests to change this` }
    };
}

const button = post => ({ type: 1, components: [{ type: 2, style: 5, label: "Open the post", url: safeUrl(post.url) }] });

export async function runPlaytests({ db, news, notifier, now = () => Date.now(), log = () => {} }) {
    const stats = { checked: 0, found: 0, delivered: 0, failed: 0, deferred: 0, posted: 0 };
    const users = db.playtestUsers(), guilds = db.guildsWithPlaytest().filter(g => db.getGuild(g.guild_id)?.channel_id);
    if (!users.length && !guilds.length) return stats;

    // Who watches what: members by their own wishlists (minus what they own), servers by their sharing members' wishlists.
    const mine = new Map(), guildApps = new Map(), titles = new Map(), pop = new Map();
    for (const u of users) {
        const owned = new Set(db.listLibrary(u.discord_id).map(l => l.itad_id));
        const own = new Map();
        for (const it of db.listItems(u.discord_id).filter(i => Number.isInteger(i.appid) && i.source !== "watch" && !owned.has(i.itad_id)).slice(0, 60)) own.set(it.appid, it.title);
        mine.set(u.discord_id, own);
        for (const [a, t] of own) { titles.set(a, t); pop.set(a, (pop.get(a) ?? 0) + 1); }
    }
    for (const g of guilds) {
        const apps = db.guildWatchedApps(g.guild_id);
        guildApps.set(g.guild_id, apps);
        for (const a of apps) { titles.set(a.appid, a.title); pop.set(a.appid, (pop.get(a.appid) ?? 0) + a.watchers); }
    }
    const wanted = [...pop].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    if (!wanted.length) return stats;
    let feed;
    try { feed = await news.forApps(wanted); } catch (err) { log(`playtest lookup failed: ${err.code ?? err.name}`); return stats; }
    const recent = now() - RECENT_MS;
    const hitsFor = appid => (feed.get(appid) ?? []).filter(p => p.date >= recent).map(p => ({ p, kind: classifyPost(p) })).filter(x => x.kind);

    for (const user of users) {
        const id = user.discord_id, first = !db.hasSeen(id, "ptstart");
        const hits = [];
        for (const [appid, title] of mine.get(id) ?? []) for (const { p, kind } of hitsFor(appid)) {
            const key = `pt:${p.gid}`;
            if (db.hasSeen(id, key)) continue;
            if (first) { db.markSeen(id, key); continue; }
            hits.push({ post: { ...p, gameTitle: title }, kind, key });
        }
        if (first) db.markSeen(id, "ptstart");
        stats.checked++;
        if (!hits.length) continue;
        stats.found += hits.length;
        if (isQuiet(user, now())) { stats.deferred += hits.length; continue; }
        const part = hits.sort((a, b) => b.post.date - a.post.date).slice(0, 4);
        const res = await notifier.deliver(user, { embeds: part.map(h => playtestEmbed(h.post, h.kind)), components: part.length === 1 ? [button(part[0].post)] : [] }, "playtest");
        if (!res.ok) { stats.failed += part.length; continue; }
        stats.delivered += part.length;
        for (const h of part) db.markSeen(id, h.key);
        db.logAlert({ discord_id: id, title: `${part[0].post.gameTitle}${part.length > 1 ? ` +${part.length - 1} more` : ""}`, kind: "playtest", price: 0, shop: "Steam news", via: res.via });
    }

    for (const g of guilds) {
        const gid = g.guild_id, startKey = `ptg:start:${gid}`, first = db.getMeta(startKey) == null;
        const hits = [];
        for (const a of guildApps.get(gid) ?? []) for (const { p, kind } of hitsFor(a.appid)) {
            const key = `ptg:${gid}:${p.gid}`;
            if (db.getMeta(key) != null) continue;
            if (first) { db.setMeta(key, "1"); continue; }
            hits.push({ post: { ...p, gameTitle: a.title }, kind, key, watchers: a.watchers });
        }
        if (first) db.setMeta(startKey, String(now()));
        stats.checked++;
        if (!hits.length) continue;
        stats.found += hits.length;
        for (const h of hits.sort((x, y) => y.post.date - x.post.date).slice(0, PER_GUILD_RUN)) {
            const ok = await notifier.postGuild(gid, { embeds: [playtestEmbed(h.post, h.kind, { watchers: h.watchers })], components: [button(h.post)] }, "playtest");
            if (!ok) { stats.failed++; continue; }
            stats.posted++;
            db.setMeta(h.key, "1");
        }
    }
    return stats;
}

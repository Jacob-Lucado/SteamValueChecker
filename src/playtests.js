// Playtests, demos, betas and free weekends. Two sources: a game's own Steam announcements, and the Alpha Beta Gamer site
// (alphabetagamer.com), which lists free alpha and beta sign-ups and demos for games Steam news may never mention.
// Studios announce these in a game's Steam news, so this reads the same
// announcements the news alerts use and picks out the ones that are about trying a game early.
// Members get a DM for wishlist games they don't own; a server with a "Playtests" ping role gets a post in its alert channel
// for games its sharing members watch, with the role mentioned.
import { steamArt, safeUrl } from "./render.js";
import { sameGame } from "./abgfeed.js";
import { gameKeys, kindGroup } from "./playsources.js";
import { isQuiet } from "./timeutil.js";
import { UserError } from "./errors.js";

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


const ABG_KINDS = { signup: ["🧪", "Beta sign-up"], playtest: ["🧪", "Playtest"], demo: ["🎮", "Beta demo"], alpha: ["🅰️", "Alpha"], beta: ["🔧", "Beta"] };
/** A post from alphabetagamer.com as a card. `watchers` is how many sharing members of a server have the game on their wishlist. */
export function abgEmbed(item, { watchers = 0 } = {}) {
    const [icon, kindLabel] = ABG_KINDS[item.kind] ?? ABG_KINDS.beta, label = item.label ?? kindLabel;
    return {
        color: 0xeb459e, title: `${icon} ${label}: ${item.game}`.slice(0, 256), url: safeUrl(item.url),
        description: item.summary || "Open the post for how to join.", timestamp: new Date(item.date).toISOString(),
        image: safeUrl(item.image) ? { url: item.image } : undefined,
        footer: { text: `${watchers > 0 ? `${watchers} member${watchers === 1 ? "" : "s"} here ${watchers === 1 ? "has" : "have"} this on a wishlist  •  ` : ""}Found on ${item.sourceName ?? "Alpha Beta Gamer"}  •  /alerts playtests to change this` }
    };
}

/** Members' modes for /alerts playtests: 0 off, 1 only games on their wishlist, 2 every playtest the bot finds. */
export const PLAYTEST_MODES = { off: 0, wishlist: 1, all: 2 };

export async function runPlaytests({ db, news, abg = null, notifier, now = () => Date.now(), log = () => {} }) {
    const stats = { checked: 0, found: 0, delivered: 0, failed: 0, deferred: 0, posted: 0 };
    const users = db.playtestUsers(), guilds = db.guildsWithPlaytest().filter(g => g.playtest_channel || db.getGuild(g.guild_id)?.channel_id);
    if (!users.length && !guilds.length) return stats;
    const recent = now() - RECENT_MS;

    // The site's list, if reachable. A failure only costs that source for this run.
    let site = [];
    if (abg) { try { site = (await abg.latest()).filter(x => x.date >= recent); } catch (err) { log(`alpha beta gamer lookup failed: ${err.code ?? err.name ?? err.message}`); } }

    // Who watches what: members by their own wishlists (minus what they own), servers by their sharing members' wishlists.
    const mine = new Map(), guildApps = new Map(), titles = new Map(), pop = new Map(), wished = new Map();
    for (const u of users) {
        const owned = new Set(db.listLibrary(u.discord_id).map(l => l.itad_id));
        const own = new Map(), names = [];
        for (const it of db.listItems(u.discord_id).filter(i => i.source !== "watch" && !owned.has(i.itad_id)).slice(0, 200)) {
            names.push(it.title);
            if (Number.isInteger(it.appid) && own.size < 60) own.set(it.appid, it.title);
        }
        mine.set(u.discord_id, own); wished.set(u.discord_id, names);
        for (const [a, t] of own) { titles.set(a, t); pop.set(a, (pop.get(a) ?? 0) + 1); }
    }
    for (const g of guilds) {
        const apps = db.guildWatchedApps(g.guild_id);
        guildApps.set(g.guild_id, apps);
        for (const a of apps) { titles.set(a.appid, a.title); pop.set(a.appid, (pop.get(a.appid) ?? 0) + a.watchers); }
    }
    const wanted = [...pop].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    let feed = new Map();
    if (wanted.length) { try { feed = await news.forApps(wanted); } catch (err) { log(`playtest lookup failed: ${err.code ?? err.name}`); } }
    const hitsFor = appid => (feed.get(appid) ?? []).filter(p => p.date >= recent).map(p => ({ p, kind: classifyPost(p) })).filter(x => x.kind);

    for (const user of users) {
        const id = user.discord_id, all = user.playtest >= PLAYTEST_MODES.all;
        const firstSteam = !db.hasSeen(id, "ptstart"), firstSite = !db.hasSeen(id, "abgstart"), firstAll = all && !db.hasSeen(id, "abgall");
        const hits = [];
        for (const [appid, title] of mine.get(id) ?? []) for (const { p, kind } of hitsFor(appid)) {
            const key = `pt:${p.gid}`;
            if (db.hasSeen(id, key)) continue;
            if (firstSteam) { db.markSeen(id, key); db.markSeen(id, gameKeys({ game: title, kind }, now()).mark); continue; }
            const gk = gameKeys({ game: title, kind }, now());
            if (gk.check.some(k => db.hasSeen(id, k))) { db.markSeen(id, key); continue; }
            hits.push({ embed: playtestEmbed({ ...p, gameTitle: title }, kind), url: p.url, date: p.date, key, gk: gk.mark, group: kindGroup(kind), game: title, source: "steam" });
        }
        if (firstSteam) db.markSeen(id, "ptstart");
        const names = wished.get(id) ?? [], appids = new Set(mine.get(id)?.keys() ?? []);
        const skipped = new Set(String(user.playtest_skip ?? "").split(",").filter(Boolean)); // sources this member doesn't want
        for (const item of site) {
            const key = `abg:${item.id}`;
            if (skipped.has(item.source ?? "abg")) continue;
            if (db.hasSeen(id, key)) continue;
            const onList = names.some(n => sameGame(n, item.game)) || (item.appid != null && appids.has(item.appid));
            if (!all && !onList) continue;
            if (item.wishlistOnly && !onList) continue; // Steam's demo list is far too long to post whole
            const gk = gameKeys(item, now()), src = item.source ?? "abg";
            const newSrc = src !== "abg" && !db.hasSeen(id, `abgsrc:${src}`); // a source added later also gets a quiet first look
            if (firstSite || newSrc || (all && firstAll && !onList)) { db.markSeen(id, key); db.markSeen(id, gk.mark); continue; } // the first look at the site is quiet
            // The same game announced by another source (or by Steam) recently is not announced again.
            if (gk.check.some(k => db.hasSeen(id, k)) || hits.some(h => sameGame(h.game, item.game) && (h.group === kindGroup(item.kind) || h.source === "steam"))) { db.markSeen(id, key); continue; }
            hits.push({ embed: abgEmbed(item), url: item.url, date: item.date, key, gk: gk.mark, group: kindGroup(item.kind), game: item.game, source: item.source ?? "abg", sourceName: item.sourceName ?? "Alpha Beta Gamer" });
        }
        if (site.length) { db.markSeen(id, "abgstart"); if (all) db.markSeen(id, "abgall"); for (const src of new Set(site.map(x => x.source ?? "abg"))) db.markSeen(id, `abgsrc:${src}`); }
        stats.checked++;
        if (!hits.length) continue;
        stats.found += hits.length;
        if (isQuiet(user, now())) { stats.deferred += hits.length; continue; }
        const part = hits.sort((a, b) => b.date - a.date).slice(0, 4);
        const res = await notifier.deliver(user, { embeds: part.map(h => h.embed), components: part.length === 1 ? [button({ url: part[0].url })] : [] }, "playtest");
        if (!res.ok) { stats.failed += part.length; continue; }
        stats.delivered += part.length;
        for (const h of part) { db.markSeen(id, h.key); db.markSeen(id, h.gk); }
        db.logAlert({ discord_id: id, title: `${part[0].game}${part.length > 1 ? ` +${part.length - 1} more` : ""}`, kind: "playtest", price: 0, shop: part[0].source === "steam" ? "Steam news" : (part[0].sourceName ?? "Alpha Beta Gamer"), via: res.via });
    }

    for (const g of guilds) {
        const gid = g.guild_id, startKey = `ptg:start:${gid}`, first = db.getMeta(startKey) == null;
        // A playtest channel posts every playtest the bot finds, whatever members have set for their own alerts. The switch only matters
        // for servers that have no playtest channel and post to the alert channel instead.
        const everything = Boolean(g.playtest_channel) || Boolean(db.getCommunity(gid)?.playtest_all);
        const apps = guildApps.get(gid) ?? [];
        const hits = [];
        // Sources the server picked to post in full (every listing, demos included), not just games its members watch.
        const full = new Set(String(db.getCommunity(gid)?.playtest_full ?? "").split(",").filter(Boolean));
        const genres = new Set(String(db.getCommunity(gid)?.playtest_genres ?? "").split(",").filter(Boolean));
        const quietFull = new Set();
        for (const src of full) if (db.getMeta(`ptg:full:${gid}:${src}`) == null) { db.setMeta(`ptg:full:${gid}:${src}`, "1"); if (!first) quietFull.add(src); } // switching one on starts quiet: today's backlog isn't dumped
        const gkey = (item, now_) => { const k = gameKeys(item, now_); return { mark: `ptg:${gid}:${k.mark}`, check: k.check.map(x => `ptg:${gid}:${x}`) }; };
        for (const a of apps) for (const { p, kind } of hitsFor(a.appid)) {
            const key = `ptg:${gid}:${p.gid}`, gk = gkey({ game: a.title, kind }, now());
            if (db.getMeta(key) != null) continue;
            if (first) { db.setMeta(key, "1"); db.setMeta(gk.mark, "1"); continue; }
            if (gk.check.some(k => db.getMeta(k) != null)) { db.setMeta(key, "1"); continue; }
            hits.push({ embed: playtestEmbed({ ...p, gameTitle: a.title }, kind, { watchers: a.watchers }), url: p.url, date: p.date, key, gk: gk.mark, group: kindGroup(kind), source: "steam", game: a.title });
        }
        const skipped = new Set(String(db.getCommunity(gid)?.playtest_skip ?? "").split(",").filter(Boolean)); // sources this server doesn't want
        for (const item of site) {
            const key = `ptg:${gid}:abg:${item.id}`;
            if (skipped.has(item.source ?? "abg")) continue;
            if (db.getMeta(key) != null) continue;
            const match = apps.find(a => sameGame(a.title, item.game) || (item.appid != null && a.appid === item.appid));
            const gk = gkey(item, now()), src = item.source ?? "abg";
            if (!everything && !match && !full.has(src)) continue;
            if (item.wishlistOnly && !match && !full.has(src)) continue; // Steam's demo list is far too long to post whole, unless the server chose this source in full
            if (src === "playtester" && !match && genres.size && !(item.tags ?? []).some(t => genres.has(String(t).toLowerCase()))) continue; // the server only wants some genres from Playtester
            if (quietFull.has(src) && !match) { db.setMeta(key, "1"); db.setMeta(gk.mark, "1"); continue; }
            const newSrc = src !== "abg" && db.getMeta(`ptg:src:${gid}:${src}`) == null;
            if (first || newSrc) { db.setMeta(key, "1"); db.setMeta(gk.mark, "1"); continue; }
            if (gk.check.some(k => db.getMeta(k) != null) || hits.some(h => sameGame(h.game, item.game) && (h.group === kindGroup(item.kind) || h.source === "steam"))) { db.setMeta(key, "1"); continue; }
            hits.push({ embed: abgEmbed(item, { watchers: match?.watchers ?? 0 }), url: item.url, date: item.date, key, gk: gk.mark, group: kindGroup(item.kind), source: item.source ?? "abg", game: item.game });
        }
        for (const src of new Set(site.map(x => x.source ?? "abg"))) if (db.getMeta(`ptg:src:${gid}:${src}`) == null) db.setMeta(`ptg:src:${gid}:${src}`, "1");
        // Switching on "every playtest" later starts quiet too: what the site already listed is not dumped on the server.
        if (everything && site.length && db.getMeta(`ptg:all:${gid}`) == null) {
            db.setMeta(`ptg:all:${gid}`, "1");
            if (!first) { for (const h of hits.filter(h => h.key.includes(":abg:") && !apps.some(a => sameGame(a.title, h.game)))) { db.setMeta(h.key, "1"); db.setMeta(h.gk, "1"); } continue; }
        }
        if (first && (site.length || apps.length)) db.setMeta(startKey, String(now()));
        stats.checked++;
        if (!hits.length || first) continue;
        stats.found += hits.length;
        for (const h of hits.sort((x, y) => y.date - x.date).slice(0, PER_GUILD_RUN)) {
            const payload = { embeds: [h.embed], components: [button({ url: h.url })] };
            // A playtest channel gets the post with the role mentioned; without one it goes to the server's alert channel.
            const ok = g.playtest_channel ? await notifier.postChannel(g.playtest_channel, payload, g.ping_playtest || null) : await notifier.postGuild(gid, payload, "playtest");
            if (!ok) { stats.failed++; continue; }
            stats.posted++;
            db.setMeta(h.key, "1"); db.setMeta(h.gk, "1");
        }
    }
    return stats;
}


const REFRESH_WINDOW_MS = 45 * 86400_000;
export const REFRESH_MAX = 15;

/**
 * Posts what is listed right now into a server's playtest channel, not just what is new since the last check. A manager runs this
 * when the channel is empty or after changing it. It never pings the role, posts the newest `limit` listings oldest first so the
 * newest ends up at the bottom, and marks everything it saw as posted so the regular check doesn't repeat it.
 */
export async function refreshPlaytestChannel({ db, news, abg = null, notifier, guildId, limit = 8, now = () => Date.now(), log = () => {} }) {
    const c = db.getCommunity(guildId);
    if (!c?.playtest_channel) throw new UserError("This server has no playtest channel yet. Run `/manage community setup`, or pick one on the dashboard under Community, Ping roles.");
    const cap = Math.min(REFRESH_MAX, Math.max(1, Math.round(Number(limit)) || 8));
    const since = now() - REFRESH_WINDOW_MS;
    let site = [];
    if (abg) { try { site = (await abg.latest()).filter(x => x.date >= since); } catch (err) { log(`playtest refresh: alpha beta gamer ${err.code ?? err.name ?? err.message}`); } }
    const apps = db.guildWatchedApps(guildId);
    let feed = new Map();
    if (apps.length && news) { try { feed = await news.forApps(apps.map(a => a.appid)); } catch (err) { log(`playtest refresh: steam news ${err.code ?? err.name}`); } }
    const found = [];
    for (const item of site) {
        const match = apps.find(a => sameGame(a.title, item.game) || (item.appid != null && a.appid === item.appid));
        if (item.wishlistOnly && !match && !String(c.playtest_full ?? "").split(",").includes(item.source)) continue;
        if (String(c.playtest_skip ?? "").split(",").includes(item.source ?? "abg")) continue;
        const only = String(c.playtest_genres ?? "").split(",").filter(Boolean);
        if (item.source === "playtester" && !match && only.length && !(item.tags ?? []).some(t => only.includes(String(t).toLowerCase()))) continue;
        found.push({ embed: abgEmbed(item, { watchers: match?.watchers ?? 0 }), url: item.url, date: item.date, key: `ptg:${guildId}:abg:${item.id}`, game: item.game, kind: item.kind });
    }
    for (const a of apps) for (const p of feed.get(a.appid) ?? []) {
        const kind = classifyPost(p);
        if (!kind || p.date < since) continue;
        if (found.some(x => sameGame(x.game, a.title) && Math.abs(x.date - p.date) < 5 * 86400_000)) continue;
        found.push({ embed: playtestEmbed({ ...p, gameTitle: a.title }, kind, { watchers: a.watchers }), url: p.url, date: p.date, key: `ptg:${guildId}:${p.gid}`, game: a.title, kind });
    }
    found.sort((x, y) => y.date - x.date);
    const chosen = found.slice(0, cap).reverse();
    let posted = 0, failed = 0;
    for (const h of chosen) {
        const ok = await notifier.postChannel(c.playtest_channel, { embeds: [h.embed], components: [button({ url: h.url })] }, null);
        if (ok) posted++; else failed++;
        if (!ok && !posted) break; // the first one failing means the channel is out of reach: stop instead of trying them all
    }
    if (posted) for (const h of found) { db.setMeta(h.key, "1"); db.setMeta(`ptg:${guildId}:${gameKeys(h, now()).mark}`, "1"); }
    if (!posted && chosen.length) throw new UserError("I could not post in the playtest channel. Check that I can see it and send messages and embeds there.");
    return { found: found.length, posted, failed, channel: c.playtest_channel };
}

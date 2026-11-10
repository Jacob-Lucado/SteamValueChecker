// What happens when a developer posts news: who hears about it, and how. Followers and the studio's followers get a notification and a
// message. People who liked the game get a notification only. For demos, playtests and releases it also reaches members who have
// playtest alerts on and whose own library and wishlist lean toward the same genres, so the right players find out.
// It never sends more than a capped number of messages in one go.
import { INDIE_KIND_LABEL } from "./indiemeta.js";

const MAX_DM = 150, GAP_MS = 150;

export function updateEmbed(game, update, { base } = {}) {
    const page = `${base ?? ""}/indie/game/${game.id}`;
    const label = INDIE_KIND_LABEL[update.kind] ?? INDIE_KIND_LABEL.news;
    const embed = {
        color: 0xff8a4c, title: `${label.icon} ${game.title}: ${update.title}`.slice(0, 250), url: page,
        description: [update.body, game.studio ? `*From ${game.studio}*` : null].filter(Boolean).join("\n\n").slice(0, 1500),
        footer: { text: "Indie showcase · you follow this game or studio" }
    };
    if (/^https:\/\//.test(game.image ?? "")) embed.image = { url: game.image };
    const buttons = [{ type: 2, style: 5, label: "Open the game page", url: page }];
    if (/^https:\/\//.test(update.link ?? "")) buttons.push({ type: 2, style: 5, label: label.cta, url: update.link });
    return { embeds: [embed], components: [{ type: 1, components: buttons }] };
}

/** Members whose library and wishlist lean toward any of these genres, among those with playtest alerts on. */
export function genreAudience(db, genres, { limit = MAX_DM, exclude = new Set() } = {}) {
    const want = new Set((genres ?? []).map(g => String(g).toLowerCase()));
    if (!want.size) return [];
    const out = [];
    for (const u of db.playtestUsers?.() ?? []) {
        if (exclude.has(u.discord_id)) continue;
        const ids = [...db.listLibrary(u.discord_id).map(l => l.appid), ...db.listItems(u.discord_id).map(i => i.appid)].filter(Number.isInteger).slice(0, 120);
        const counts = new Map();
        for (const t of db.getAppTags(ids).values()) for (const g of t.genres) counts.set(g.toLowerCase(), (counts.get(g.toLowerCase()) ?? 0) + 1);
        const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => g);
        if (top.some(g => want.has(g))) out.push(u.discord_id);
        if (out.length >= limit) break;
    }
    return out;
}

/** Games that match what a member plays and wishes for, with the genres that made the match. */
export function picksFor(db, userId, { limit = 6 } = {}) {
    const ids = [...db.listLibrary(userId).map(l => l.appid), ...db.listItems(userId).map(i => i.appid)].filter(Number.isInteger).slice(0, 200);
    const counts = new Map();
    for (const t of db.getAppTags(ids).values()) for (const g of t.genres) counts.set(g, (counts.get(g) ?? 0) + 1);
    if (!counts.size) return { picks: [], reason: "no-data" };
    const owned = new Set(ids), liked = new Set(db.indieLikedBy?.(userId) ?? []);
    const scored = db.indieApprovedAll().filter(g => !owned.has(g.appid) && !liked.has(g.id) && g.owner_id !== userId).map(g => {
        const hits = g.genres.filter(x => counts.has(x));
        return { g, hits, score: hits.reduce((n, x) => n + counts.get(x), 0) + (g.verified ? 2 : 0) + Math.min(5, g.likes) * 0.2 };
    }).filter(x => x.hits.length).sort((a, b) => b.score - a.score).slice(0, limit);
    return { picks: scored.map(x => ({ game: x.g, because: x.hits.slice(0, 2) })), reason: scored.length ? "ok" : "no-match" };
}

export function createIndieNews({ db, dm = null, base = null, now = () => Date.now(), log = () => {}, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
    /** Tells everyone who should hear. Returns counts. Safe to call without awaiting: it never throws. */
    async function publish(game, update) {
        const out = { followers: 0, likers: 0, matched: 0, messaged: 0, failed: 0 };
        try {
            const follow = new Set([...db.indieFollowers("game", game.id), ...db.indieFollowers("studio", game.owner_id)]);
            follow.delete(game.owner_id);
            const likers = new Set(db.indieLikers(game.id).filter(u => !follow.has(u) && u !== game.owner_id));
            const matched = ["demo", "playtest", "release"].includes(update.kind) ? genreAudience(db, game.genres, { exclude: new Set([...follow, ...likers, game.owner_id]) }) : [];
            out.followers = follow.size; out.likers = likers.size; out.matched = matched.length;
            const label = INDIE_KIND_LABEL[update.kind] ?? INDIE_KIND_LABEL.news, page = `/indie/game/${game.id}`;
            const note = (id, why) => { try { db.addNotification(id, { type: "indie", title: `${game.title}: ${update.title}`.slice(0, 190), body: `${label.name}${why ? " · " + why : ""}`, url: page }); } catch { /* the message below still goes */ } };
            for (const id of follow) note(id, "from a game you follow");
            for (const id of likers) note(id, "from a game you liked");
            for (const id of matched) note(id, "matches games you play");
            if (dm) {
                const payload = updateEmbed(game, update, { base });
                for (const id of [...follow, ...matched].slice(0, MAX_DM)) {
                    try { if (db.getUser?.(id)?.paused) continue; await dm(id, payload); out.messaged++; } catch (e) { out.failed++; log(`indie news DM ${id}: ${e.code ?? e.message}`); }
                    await sleep(GAP_MS);
                }
            }
        } catch (e) { log(`indie news: ${e.message}`); }
        return out;
    }
    return { publish };
}

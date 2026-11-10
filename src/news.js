// Patch notes and announcements for the games a member owns or wants, from Steam's own news feed (public, no key).
// A post is a "patch note" when its title says so; members choose between only those or every announcement.
export const NEWS_MODES = { off: 0, patch: 1, all: 2 };
const PATCH = /\b(patch|hotfix|hot fix|changelog|change log|release notes|bug ?fix(es)?|balance (changes|update)|update\b|v\d+(\.\d+)+|\d+\.\d+(\.\d+)?)/i;
export const isPatchNote = title => PATCH.test(String(title ?? ""));

import { findVideo } from "./video.js";

const IMG = /\{STEAM_CLAN_IMAGE\}\/([A-Za-z0-9/_.-]+\.(?:png|jpe?g|gif|webp))/i;

/** Plain text from a Steam post: no BBCode, HTML or Steam image tags, short, on whole words. */
export function cleanPost(text, max = 380) {
    let t = String(text ?? "").replace(/\{STEAM_CLAN_IMAGE\}\S*/g, " ").replace(/\[\/?[a-z0-9*]+(?:=[^\]]*)?\]/gi, " ").replace(/<[^>]+>/g, " ").replace(/https?:\/\/\S+/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#?\w+;/g, " ").replace(/\s+/g, " ").trim();
    if (t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, "") + "…";
    return t;
}

/** Steam's answer for one game, reduced to what the bot shows. Newest first. */
export function parseNews(json, appid) {
    const out = [];
    for (const n of Array.isArray(json?.appnews?.newsitems) ? json.appnews.newsitems : []) {
        const date = Number(n?.date) * 1000, gid = String(n?.gid ?? "");
        if (!gid || !Number.isFinite(date) || !n?.title) continue;
        const img = IMG.exec(String(n.contents ?? ""))?.[1], vid = findVideo(n.contents);
        out.push({ gid, appid, title: String(n.title).slice(0, 200), date, summary: cleanPost(n.contents), patch: isPatchNote(n.title),
            url: `https://steamcommunity.com/games/${appid}/announcements/detail/${gid}`, image: img ? `https://clan.fastly.steamstatic.com/images/${img}` : (vid?.thumb ?? null), video: vid?.url ?? null });
    }
    return out.sort((a, b) => b.date - a.date);
}

/** `forApps([appid...])` gives Map(appid -> posts), asking Steam for a few games at a time and remembering answers for 50 minutes. */
export function createNews({ fetchImpl = globalThis.fetch, now = () => Date.now(), ttlMs = 50 * 60_000, parallel = 4, maxApps = 150, perGame = 4 } = {}) {
    const cache = new Map();
    const state = { lastOkAt: null, lastErrorAt: null, lastError: null };
    async function one(appid) {
        const hit = cache.get(appid);
        if (hit && now() - hit.at < ttlMs) return hit.items;
        try {
            const res = await fetchImpl(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appid}&count=${perGame}&maxlength=6000&feeds=steam_community_announcements`, { signal: AbortSignal.timeout(8000) });
            if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: `http${res.status}` });
            const items = parseNews(await res.json(), appid);
            cache.set(appid, { at: now(), items }); state.lastOkAt = now();
            return items;
        } catch (err) { state.lastErrorAt = now(); state.lastError = err.code ?? err.name ?? "error"; cache.set(appid, { at: now() - ttlMs + 5 * 60_000, items: hit?.items ?? [] }); return hit?.items ?? []; }
    }
    async function forApps(appids) {
        const ids = [...new Set(appids.filter(Number.isInteger))].slice(0, maxApps), out = new Map();
        for (let i = 0; i < ids.length; i += parallel) await Promise.all(ids.slice(i, i + parallel).map(async id => out.set(id, await one(id))));
        if (cache.size > 2000) for (const k of [...cache.keys()].slice(0, 500)) cache.delete(k);
        return out;
    }
    return { forApps, health: () => ({ ...state }) };
}

/** The latest posts for the Steam games a member plays or wants, newest first: [{ ...post, gameTitle }]. */
export async function newsForUser(db, source, userId, { games = 12, wished = 8, perGame = 2, limit = 8 } = {}) {
    const own = new Map();
    for (const g of db.listLibrary(userId).filter(g => Number.isInteger(g.appid)).sort((a, b) => (b.last_played ?? 0) - (a.last_played ?? 0) || (b.minutes ?? 0) - (a.minutes ?? 0)).slice(0, games)) own.set(g.appid, g.title);
    for (const it of db.listItems(userId).filter(x => Number.isInteger(x.appid)).slice(0, wished)) own.set(it.appid, it.title);
    if (!own.size) return { known: false, posts: [] };
    const feed = await source.forApps([...own.keys()]);
    const posts = [...own].flatMap(([appid, title]) => (feed.get(appid) ?? []).slice(0, perGame).map(p => ({ ...p, gameTitle: title }))).sort((a, b) => b.date - a.date).slice(0, limit);
    return { known: true, posts };
}

// Auto go-live: streamers link their channel once, and the bot notices when they start and stop streaming, so nobody has to post "I'm live".
// Twitch and Kick are checked through their own official APIs (needs app keys in the environment); YouTube is a best-effort check of the channel's live page.
import { UserError } from "./errors.js";

export const CHECK_EVERY_MS = 2 * 60_000;
const OFFLINE_MISSES = 2; // a stream must look offline on two checks in a row before the post is closed, so one blip doesn't end it
const clip = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

/** Reads a channel link (or "twitch.tv/name") into { platform, handle }. Throws a plain sentence when it isn't one. */
export function parseChannel(raw) {
    let text = String(raw ?? "").trim();
    if (!text) throw new UserError("Paste your channel link, like https://twitch.tv/yourname.");
    if (!/^https?:\/\//i.test(text)) text = "https://" + text;
    let u;
    try { u = new URL(text); } catch { throw new UserError("That doesn't look like a channel link."); }
    if (u.protocol !== "https:" || u.username || u.password) throw new UserError("The link has to start with https://.");
    const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, ""), parts = u.pathname.split("/").filter(Boolean);
    if (host === "twitch.tv") {
        const name = (parts[0] ?? "").toLowerCase();
        if (!/^[a-z0-9_]{3,25}$/.test(name) || ["directory", "videos", "p", "downloads", "settings", "subscriptions", "turbo", "jobs"].includes(name)) throw new UserError("Use your channel link, like https://twitch.tv/yourname.");
        return { platform: "twitch", handle: name };
    }
    if (host === "kick.com") {
        const name = (parts[0] ?? "").toLowerCase();
        if (!/^[a-z0-9_-]{3,25}$/.test(name) || ["categories", "browse", "following", "dashboard", "search"].includes(name)) throw new UserError("Use your channel link, like https://kick.com/yourname.");
        return { platform: "kick", handle: name };
    }
    if (host === "youtube.com" || host === "youtu.be") {
        const first = parts[0] ?? "";
        if (/^@[\w.-]{3,40}$/.test(first)) return { platform: "youtube", handle: first.toLowerCase() };
        if (first === "channel" && /^UC[\w-]{20,24}$/.test(parts[1] ?? "")) return { platform: "youtube", handle: parts[1] };
        throw new UserError("Use your YouTube channel link, like https://youtube.com/@yourname.");
    }
    throw new UserError("I can watch Twitch, Kick and YouTube channels for you. For anywhere else, use `/server stream live` when you start.");
}

export const channelUrl = (platform, handle) => platform === "twitch" ? `https://twitch.tv/${handle}` : platform === "kick" ? `https://kick.com/${handle}` : handle.startsWith("@") ? `https://www.youtube.com/${handle}/live` : `https://www.youtube.com/channel/${handle}/live`;

/** The sites we can check right now, given which app keys are set. */
export const watchable = env => ({ twitch: Boolean(env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET), kick: Boolean(env.KICK_CLIENT_ID && env.KICK_CLIENT_SECRET), youtube: true });

/** One checker per site. Each takes a list of handles and gives back a Map of handle -> { title, game, url } for the ones that are live. */
export function createCheckers({ fetchImpl = globalThis.fetch, env = process.env, now = () => Date.now() } = {}) {
    const tokens = {};
    const getJson = async (url, headers) => { const r = await fetchImpl(url, { headers, signal: AbortSignal.timeout(10_000) }); if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; } return r.json(); };
    async function token(site, url, id, secret) {
        const t = tokens[site];
        if (t && t.exp > now() + 60_000) return t.value;
        const r = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "client_credentials" }), signal: AbortSignal.timeout(10_000) });
        if (!r.ok) throw new Error(`${site} login failed (${r.status})`);
        const j = await r.json(); tokens[site] = { value: j.access_token, exp: now() + (Number(j.expires_in) || 3600) * 1000 };
        return tokens[site].value;
    }
    return {
        async twitch(handles) {
            const out = new Map();
            for (let i = 0; i < handles.length; i += 100) {
                const part = handles.slice(i, i + 100), tk = await token("twitch", "https://id.twitch.tv/oauth2/token", env.TWITCH_CLIENT_ID, env.TWITCH_CLIENT_SECRET);
                const j = await getJson("https://api.twitch.tv/helix/streams?first=100&" + part.map(h => "user_login=" + encodeURIComponent(h)).join("&"), { "Client-Id": env.TWITCH_CLIENT_ID, Authorization: "Bearer " + tk });
                for (const s of j.data ?? []) if (s.type === "live") out.set(String(s.user_login).toLowerCase(), { title: clip(s.title, 120), game: clip(s.game_name, 60), url: `https://twitch.tv/${String(s.user_login).toLowerCase()}` });
            }
            return out;
        },
        async kick(handles) {
            const out = new Map();
            for (let i = 0; i < handles.length; i += 50) {
                const part = handles.slice(i, i + 50), tk = await token("kick", "https://id.kick.com/oauth/token", env.KICK_CLIENT_ID, env.KICK_CLIENT_SECRET);
                const j = await getJson("https://api.kick.com/public/v1/channels?" + part.map(h => "slug=" + encodeURIComponent(h)).join("&"), { Authorization: "Bearer " + tk });
                for (const c of j.data ?? []) if (c.stream?.is_live) out.set(String(c.slug).toLowerCase(), { title: clip(c.stream_title, 120), game: clip(c.category?.name, 60), url: `https://kick.com/${String(c.slug).toLowerCase()}` });
            }
            return out;
        },
        async youtube(handles) {
            const out = new Map();
            for (const h of handles) {
                try {
                    const page = `https://www.youtube.com/${h.startsWith("@") ? h : "channel/" + h}/live`;
                    const r = await fetchImpl(page, { headers: { "user-agent": "Mozilla/5.0 (compatible; SteamValueChecker/1.0)", "accept-language": "en" }, signal: AbortSignal.timeout(10_000) });
                    if (!r.ok) continue;
                    const html = (await r.text()).slice(0, 600_000);
                    if (!/"isLiveNow":true/.test(html) || !/rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/.test(html)) continue;
                    const id = /rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/.exec(html)[1];
                    const title = /<meta name="title" content="([^"]*)"/.exec(html)?.[1] ?? "Live on YouTube";
                    out.set(h.toLowerCase(), { title: clip(title.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'"), 120), game: "", url: `https://www.youtube.com/watch?v=${id}` });
                } catch { /* unknown: treated as not live this round */ }
            }
            return out;
        }
    };
}

/**
 * Every few minutes: finds out who is live among the linked channels, posts new streams in the live channel (with the ping, once) and closes the post
 * when the stream ends. Only streams the bot posted itself are closed automatically; a post someone made by hand is left for them to end.
 */
export function createStreamWatch({ db, streams, api, checkers = createCheckers(), env = process.env, now = () => Date.now(), log = () => {}, access = null }) {
    const misses = new Map(); // "guild:user" -> consecutive offline checks
    const can = watchable(env);
    async function tick() {
        const links = db.allStreamLinks();
        if (!links.length) return { live: 0, ended: 0 };
        const bySite = {};
        for (const l of links) if (can[l.platform]) (bySite[l.platform] ??= new Set()).add(l.handle.toLowerCase());
        const liveBy = {}, failed = new Set();
        for (const [site, set] of Object.entries(bySite)) {
            try { liveBy[site] = await checkers[site]([...set]); } catch (e) { failed.add(site); log(`${site} check failed: ${e.message}`); }
        }
        let started = 0, ended = 0;
        for (const l of links) {
            if (!can[l.platform] || failed.has(l.platform)) continue; // can't tell: leave things as they are
            const key = `${l.guild_id}:${l.user_id}`, hit = liveBy[l.platform]?.get(l.handle.toLowerCase()), row = db.getStreamLive(l.guild_id, l.user_id);
            try {
                if (hit) {
                    misses.delete(key);
                    if (access && !(await access(l))) { db.removeStreamLink(l.guild_id, l.user_id); log(`removed ${key}: no longer allowed to stream there`); continue; }
                    const same = row && row.title === (clip(hit.title, 120) || "Live now") && (row.game ?? "") === (clip(hit.game, 60) || "") && row.url === hit.url;
                    if (same) continue;
                    if (row && !row.auto && row.url !== hit.url) continue; // they posted a different stream by hand: leave it
                    const name = (await api.memberName?.(l.guild_id, l.user_id).catch(() => null)) || "Someone";
                    await streams.goLive(l.guild_id, { id: l.user_id, name, avatarUrl: null }, { title: hit.title, url: hit.url, game: hit.game, auto: true });
                    if (!row) started++;
                } else if (row?.auto) {
                    const n = (misses.get(key) ?? 0) + 1; misses.set(key, n);
                    if (n >= OFFLINE_MISSES) { misses.delete(key); const name = (await api.memberName?.(l.guild_id, l.user_id).catch(() => null)) || "Someone"; await streams.endLive(l.guild_id, { id: l.user_id, name }); ended++; }
                } else misses.delete(key);
            } catch (e) { log(`${key}: ${e.message}`); }
        }
        return { live: started, ended };
    }
    return { tick, can };
}

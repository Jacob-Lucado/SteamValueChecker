// Full public profiles. Each member can turn sections on or off, set who sees each one, pick a look, write a short bio,
// add links, choose favorite games and a profile song. Nothing shows unless they chose it: the wishlist page that already
// existed is now just one section. Validation lives here so the Discord commands and the dashboard follow the same rules.
import { UserError } from "./errors.js";
import { THEMES } from "./cardprefs.js";
import { artUrl, steamArt } from "./render.js";
import { publicWishlist, fillAppIds } from "./profile.js";
import { cleanPageBg, defaultPageBg } from "./profilebg.js";
import { isSupporter } from "./supporters.js";
import { trophyCase } from "./badges.js";
import { channelUrl } from "./streamwatch.js";

// ---------------------------------------------------------------- looks
const EXTRA = { light: ["#f3f5fa", "#3b6df0"], mono: ["#121212", "#e6e6e6"], rose: ["#2a1420", "#ff6fa5"], ocean: ["#0f2231", "#43c6e8"] };
export const PROFILE_THEMES = Object.fromEntries(Object.entries({ ...THEMES, ...EXTRA }).map(([k, [bg, accent]]) => [k, { bg, accent, light: k === "light" }]));
export const BG_STYLES = ["plain", "gradient", "dots", "grid"];
export const LAYOUTS = ["classic", "wide", "compact"];
export const VISIBILITY = ["public", "server", "hidden"];
export const SECTIONS = {
    about: "About me", favorites: "Favorite games", nowplaying: "Playing now", wishlist: "Wishlist", recent: "Recently finished",
    posts: "Latest posts", trophies: "Trophies", achievements: "Rarest achievements", activity: "Recent activity", steam: "Steam stats", value: "Library value", streams: "Streaming", guestbook: "Guestbook"
};
export const DEFAULT_SECTIONS = [["about", "public"], ["favorites", "public"], ["wishlist", "public"], ["recent", "hidden"], ["nowplaying", "hidden"], ["posts", "public"], ["trophies", "hidden"], ["achievements", "public"], ["activity", "public"], ["guestbook", "public"], ["steam", "hidden"], ["value", "hidden"], ["streams", "hidden"]]
    .map(([key, vis]) => ({ key, vis }));

const HEX = /^#[0-9a-f]{6}$/i;
const clean = (t, n) => String(t ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "").trim().slice(0, n);

// ---------------------------------------------------------------- links
const LINK_KINDS = {
    twitch: { label: "Twitch", hosts: ["twitch.tv", "www.twitch.tv"] },
    kick: { label: "Kick", hosts: ["kick.com", "www.kick.com"] },
    youtube: { label: "YouTube", hosts: ["youtube.com", "www.youtube.com", "youtu.be"] },
    x: { label: "X", hosts: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"] },
    bluesky: { label: "Bluesky", hosts: ["bsky.app"] },
    steam: { label: "Steam", hosts: ["steamcommunity.com", "www.steamcommunity.com"] },
    github: { label: "GitHub", hosts: ["github.com", "www.github.com"] },
    website: { label: "Website", hosts: null }
};
export const LINK_KIND_NAMES = Object.entries(LINK_KINDS).map(([k, v]) => [k, v.label]);

export function cleanLink(kind, raw) {
    const spec = LINK_KINDS[kind];
    if (!spec) throw new UserError("Pick one of: " + Object.keys(LINK_KINDS).join(", ") + ".");
    let text = String(raw ?? "").trim();
    if (!text) throw new UserError("Paste the link.");
    if (!/^https?:\/\//i.test(text)) text = "https://" + text;
    let u; try { u = new URL(text); } catch { throw new UserError("That doesn't look like a link."); }
    if (u.protocol !== "https:") throw new UserError("Links must start with https://.");
    if (u.username || u.password) throw new UserError("Leave the username and password out of the link.");
    const host = u.hostname.toLowerCase();
    if (spec.hosts ? !spec.hosts.includes(host) : (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":") || /(^|\.)(localhost|local|internal)$/.test(host))) {
        throw new UserError(spec.hosts ? `That is not a ${spec.label} link.` : "Use a normal website address.");
    }
    u.hash = "";
    const href = u.href;
    if (href.length > 200) throw new UserError("That link is too long.");
    return { kind, url: href };
}

// ---------------------------------------------------------------- the profile song
// YouTube, SoundCloud and Spotify (through their official embeds) or a live radio stream address. Playing starts when a visitor
// presses the button.
export function cleanSong(input) {
    if (input === null || input === undefined || input === "" || input.url === "" || input.url === null) return null;
    const raw = String(typeof input === "string" ? input : input.url ?? "").trim();
    const title = clean(typeof input === "string" ? "" : input.title, 60);
    let u; try { u = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw); } catch { throw new UserError("That doesn't look like a link."); }
    if (u.protocol !== "https:") throw new UserError("Song links must start with https://.");
    const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
    if (!["youtu.be", "youtube.com", "music.youtube.com", "soundcloud.com", "open.spotify.com"].includes(host)) return radioStream(u, title);
    if (host === "youtu.be" || host === "youtube.com" || host === "music.youtube.com") {
        const id = host === "youtu.be" ? u.pathname.slice(1).split("/")[0] : u.searchParams.get("v") ?? (/^\/(shorts|embed)\/([\w-]{11})/.exec(u.pathname) ?? [])[2];
        if (!/^[\w-]{11}$/.test(id ?? "")) throw new UserError("Paste a YouTube video link, like https://youtu.be/dQw4w9WgXcQ.");
        return { provider: "youtube", id, title };
    }
    if (host === "soundcloud.com") {
        const parts = u.pathname.split("/").filter(Boolean);
        if (parts.length < 2 || !parts.every(p => /^[\w.-]+$/.test(p))) throw new UserError("Paste a SoundCloud track link, like https://soundcloud.com/artist/track.");
        return { provider: "soundcloud", id: parts.join("/"), title };
    }
    if (host === "open.spotify.com") {
        const m = /^\/(?:intl-[a-z]+\/)?(track|album|playlist|episode)\/([A-Za-z0-9]{22})$/.exec(u.pathname);
        if (!m) throw new UserError("Paste a Spotify track, album or playlist link.");
        return { provider: "spotify", id: m[2], kind: m[1], title };
    }
    throw new UserError("Paste a YouTube, SoundCloud or Spotify link, or the address of a live radio stream.");
}

/** A live radio stream: the direct https address of an Icecast, Shoutcast or similar stream. The visitor's browser plays it in a plain audio tag. */
function radioStream(u, title) {
    const host = u.hostname.toLowerCase();
    if (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[") || /(^|\.)(localhost|local|internal|lan)$/.test(host)) throw new UserError("Use a stream address with a real domain name.");
    if (u.username || u.password) throw new UserError("Leave the username and password out of the link.");
    if (/\.(m3u8?|pls|asx|xspf)$/i.test(u.pathname)) throw new UserError("That is a playlist file. Open it, copy the stream address inside (it ends in something like /stream or .mp3), and paste that.");
    const href = u.href;
    if (href.length > 300) throw new UserError("That link is too long.");
    return { provider: "radio", id: href, title };
}

/** The official embed address for a saved song. Built only from the validated pieces above. */
export function songEmbed(song) {
    if (!song) return null;
    if (song.provider === "youtube") return `https://www.youtube-nocookie.com/embed/${song.id}?autoplay=1&rel=0&modestbranding=1`;
    if (song.provider === "soundcloud") return `https://w.soundcloud.com/player/?url=${encodeURIComponent("https://soundcloud.com/" + song.id)}&auto_play=true&visual=false&show_comments=false&hide_related=true`;
    if (song.provider === "spotify") return `https://open.spotify.com/embed/${song.kind}/${song.id}?utm_source=generator`;
    return null;
}
export const songLink = song => (!song ? null : song.provider === "radio" ? song.id : song.provider === "youtube" ? `https://youtu.be/${song.id}` : song.provider === "soundcloud" ? `https://soundcloud.com/${song.id}` : `https://open.spotify.com/${song.kind}/${song.id}`);

// ---------------------------------------------------------------- the whole profile
export function cleanProfile(input, prev = {}) {
    const has = k => input[k] !== undefined;
    const out = { ...prev };
    if (has("name")) out.name = clean(input.name, 32);
    if (has("bio")) out.bio = clean(input.bio, 300).split(/\r?\n/).slice(0, 6).join("\n");
    if (has("theme")) { if (!PROFILE_THEMES[input.theme]) throw new UserError("Pick one of the colour themes."); out.theme = input.theme; }
    if (has("accent")) { if (input.accent && !HEX.test(input.accent)) throw new UserError("Colours look like #66c0f4."); out.accent = input.accent ? String(input.accent).toLowerCase() : null; }
    if (has("bgstyle")) { if (!BG_STYLES.includes(input.bgstyle)) throw new UserError("Pick a background style from the list."); out.bgstyle = input.bgstyle; }
    if (has("layout")) { if (!LAYOUTS.includes(input.layout)) throw new UserError("Pick a layout from the list."); out.layout = input.layout; }
    if (has("banner")) { if (!["gradient", "game", "none"].includes(input.banner)) throw new UserError("Pick a banner style."); out.banner = input.banner; }
    if (has("pagebg")) out.pagebg = cleanPageBg(input.pagebg, prev.pagebg, m => { throw new UserError(m); });
    if (has("avatar")) out.avatar = Boolean(input.avatar);
    if (has("links")) {
        if (!Array.isArray(input.links)) throw new UserError("Links should be a list.");
        if (input.links.length > 6) throw new UserError("You can add up to 6 links.");
        const seen = new Set();
        out.links = input.links.map(l => cleanLink(l.kind, l.url)).filter(l => !seen.has(l.url) && seen.add(l.url));
    }
    if (has("favorites")) {
        if (!Array.isArray(input.favorites)) throw new UserError("Favorites should be a list.");
        out.favorites = [...new Set(input.favorites.map(x => clean(x, 80)).filter(Boolean))].slice(0, 5);
    }
    if (has("song")) out.song = cleanSong(input.song);
    if (has("enter")) out.enter = Boolean(input.enter);
    if (has("sections")) {
        if (!Array.isArray(input.sections)) throw new UserError("Sections should be a list.");
        const seen = new Set(), list = [];
        for (const s of input.sections) {
            if (!SECTIONS[s?.key] || seen.has(s.key)) continue;
            if (!VISIBILITY.includes(s.vis)) throw new UserError("Each section is public, server only or hidden.");
            seen.add(s.key); list.push({ key: s.key, vis: s.vis });
        }
        for (const d of DEFAULT_SECTIONS) if (!seen.has(d.key)) list.push({ key: d.key, vis: "hidden" });
        out.sections = list;
    }
    return out;
}

/** What a saved profile looks like with every default filled in. */
/** A saved layout from before a section existed gets that section added at its default setting, so new sections can be found and used. */
function mergeSections(saved) {
    if (!Array.isArray(saved) || !saved.length) return DEFAULT_SECTIONS;
    const have = new Set(saved.map(x => x.key));
    return [...saved, ...DEFAULT_SECTIONS.filter(d => !have.has(d.key))];
}

export function withDefaults(data = {}) {
    return {
        name: data.name ?? "", bio: data.bio ?? "", theme: PROFILE_THEMES[data.theme] ? data.theme : "night", accent: HEX.test(data.accent ?? "") ? data.accent : null,
        bgstyle: BG_STYLES.includes(data.bgstyle) ? data.bgstyle : "gradient", layout: LAYOUTS.includes(data.layout) ? data.layout : "classic",
        banner: ["gradient", "game", "none"].includes(data.banner) ? data.banner : "gradient", avatar: Boolean(data.avatar),
        pagebg: { ...defaultPageBg(), ...(data.pagebg && typeof data.pagebg === "object" ? data.pagebg : {}) },
        enter: Boolean(data.enter), links: data.links ?? [], favorites: data.favorites ?? [], song: data.song ?? null,
        sections: mergeSections(data.sections)
    };
}

const canSee = (vis, viewer) => viewer.owner || vis === "public" || (vis === "server" && viewer.sameServer);

/**
 * Everything the page needs, for one viewer. Sections the viewer may not see are left out entirely, so nothing leaks
 * through the data. `draft` lets the owner preview unsaved changes.
 */
/** What the page needs to paint its background. An uploaded picture only counts while it is still stored (it can be cleared for inactivity). */
function pageBgFor(db, owner, bg) {
    const b = { ...defaultPageBg(), ...(bg || {}) };
    if (b.kind === "preset") return { kind: "preset", preset: b.preset, dim: b.dim, url: null };
    if (b.kind === "video" && b.video) return { kind: "video", preset: b.preset, dim: b.dim, url: b.video };
    if (b.kind === "image" && b.image) {
        const row = db.getProfileBg(b.image);
        if (row && row.discord_id === owner.discord_id) return { kind: "image", preset: b.preset, dim: b.dim, url: `/pbg/${row.id}?v=${row.created_at}` };
    }
    return { kind: "none", preset: b.preset, dim: b.dim, url: null };
}

export async function buildProfile({ db, itad, nowPlaying = null }, owner, viewer, { viewerId = null, draft = null } = {}) {
    const cfg = withDefaults(draft ?? db.getProfileData(owner.discord_id).data);
    const theme = PROFILE_THEMES[cfg.theme];
    const lib = db.listLibrary(owner.discord_id);
    const items = db.listItems(owner.discord_id);
    const known = new Map([...lib, ...items].map(x => [x.itad_id, x]));
    const byTitle = t => [...known.values()].find(x => x.title.toLowerCase() === String(t).toLowerCase());
    const favRows = cfg.favorites.map(t => ({ ...(byTitle(t) ?? { title: t }) }));
    await fillAppIds(db, itad, owner.discord_id, favRows);
    const favs = favRows.map(x => ({ title: x.title, art: x.itad_id ? artUrl(x) ?? null : null }));
    const steam = db.getSteamLink(owner.discord_id);
    const sections = [];
    for (const s of cfg.sections) {
        if (!canSee(s.vis, viewer)) continue;
        try {
            if (s.key === "about") sections.push({ key: "about", vis: s.vis });
            else if (s.key === "guestbook") sections.push({ key: "guestbook", vis: s.vis, open: db.getPrefs(owner.discord_id).guestbook, total: db.guestbookList(owner.discord_id, viewerId, { limit: 1 }).total });
            else if (s.key === "favorites") { if (favs.length || viewer.owner) sections.push({ key: "favorites", vis: s.vis, games: favs }); }
            else if (s.key === "wishlist") {
                const w = await publicWishlist(db, itad, owner.profile_slug, viewerId);
                sections.push({ key: "wishlist", vis: s.vis, games: w?.games ?? [], giftsOpen: w?.giftsOpen ?? true });
            } else if (s.key === "recent") {
                const rows = lib.filter(x => x.status === "finished").sort((a, b) => (b.status_at ?? 0) - (a.status_at ?? 0)).slice(0, 8).map(x => ({ ...x }));
                await fillAppIds(db, itad, owner.discord_id, rows);
                sections.push({ key: "recent", vis: s.vis, games: rows.map(x => ({ title: x.title, art: artUrl(x) ?? null, at: x.status_at ?? null })) });
            } else if (s.key === "nowplaying") {
                let now = null;
                if (steam && nowPlaying?.enabled) {
                    const v = (await nowPlaying.lookup([steam.steamid]).catch(() => new Map())).get(String(steam.steamid));
                    if (v?.appid && v.game) now = { title: v.game, art: steamArt(v.appid) };
                }
                sections.push({ key: "nowplaying", vis: s.vis, now });
            } else if (s.key === "trophies") {
                const t = trophyCase(db, owner.discord_id);
                sections.push({ key: "trophies", vis: s.vis, earned: t.earned, total: t.total, badges: t.badges.filter(b => b.tier).map(b => ({ icon: b.icon, name: b.name, tier: b.tier })) });
            } else if (s.key === "posts") {
                const mine = db.feed(viewerId ?? null, { author: owner.discord_id, limit: 8 }).items.filter(x => x.kind === "post").slice(0, 3);
                if (mine.length || viewer.owner) sections.push({ key: "posts", vis: s.vis, items: mine.map(x => ({ id: x.id, body: x.body, game: x.game, at: x.at, reactions: x.reactions, replies: x.replies })) });
            } else if (s.key === "achievements") {
                const a = steam ? db.achievementShowcase(owner.discord_id) : null;
                if (a && (a.done || a.top.length)) sections.push({ key: "achievements", vis: s.vis, done: a.done, rare: a.rare, games: a.games, top: a.top.map(x => ({ game: x.game, name: x.name, icon: x.icon, pct: x.pct })) });
            } else if (s.key === "activity") {
                const r = steam ? db.recentActivity(owner.discord_id) : null;
                if (r?.games.length) sections.push({ key: "activity", vis: s.vis, hours2w: Math.round(r.minutes2w / 6) / 10, games: r.games.map(g => ({ title: g.title, art: steamArt(g.appid), hours: Math.round((g.minutes ?? 0) / 6) / 10, hours2w: Math.round((g.min_2w ?? 0) / 6) / 10, last: g.last_played, done: g.ach_done ?? 0, total: g.ach_total ?? 0, unlocks: g.unlocks })) });
            } else if (s.key === "steam") {
                if (steam) sections.push({ key: "steam", vis: s.vis, games: steam.games ?? lib.length, hours: Math.round((steam.minutes ?? 0) / 60), library: lib.length, finished: lib.filter(x => x.status === "finished").length });
            } else if (s.key === "value") {
                // The newest daily snapshot: what the games would cost at full price, what was actually paid, and what that saved.
                const snap = db.listSnapshots(owner.discord_id, 1)[0];
                if (snap && snap.games > 0 && snap.msrp > 0) sections.push({ key: "value", vis: s.vis, games: snap.games, worth: Math.round(snap.msrp), paid: Math.round(snap.paid), saved: Math.max(0, Math.round(snap.msrp_paid ?? 0) - Math.round(snap.paid)), day: snap.day });
            } else if (s.key === "streams") {
                const l = owner.guild_id ? db.getStreamLink(owner.guild_id, owner.discord_id) : null;
                const live = owner.guild_id ? db.getStreamLive(owner.guild_id, owner.discord_id) : null;
                if (l) sections.push({ key: "streams", vis: s.vis, platform: l.platform, handle: l.handle, url: channelUrl(l.platform, l.handle).replace(/\/live$/, ""), live: live ? { title: live.title, game: live.game ?? null } : null });
            }
        } catch { /* one broken section should not take the page down */ }
    }
    const bannerGame = cfg.banner === "game" ? favs.find(f => f.art)?.art ?? null : null;
    const song = cfg.song && canSee("public", viewer) ? { provider: cfg.song.provider, title: cfg.song.title || "", embed: songEmbed(cfg.song), stream: cfg.song.provider === "radio" ? cfg.song.id : null, link: cfg.song.provider === "radio" ? null : songLink(cfg.song) } : null;
    return {
        enter: Boolean(song && cfg.enter),
        supporter: isSupporter(db, owner.discord_id),
        slug: owner.profile_slug, name: cfg.name || owner.profile_slug, bio: cfg.bio, avatar: cfg.avatar && steam?.avatar ? steam.avatar : null,
        theme: { key: cfg.theme, bg: theme.bg, accent: cfg.accent ?? theme.accent, light: theme.light, bgstyle: cfg.bgstyle, layout: cfg.layout },
        banner: { kind: cfg.banner, art: bannerGame },
        pagebg: pageBgFor(db, owner, cfg.pagebg),
        links: cfg.links.map(l => ({ kind: l.kind, label: LINK_KINDS[l.kind]?.label ?? l.kind, url: l.url })),
        song, sections, owner: Boolean(viewer.owner), since: owner.created_at ?? null
    };
}

// Web dashboard: everything the slash commands do, in a browser. Uses Node's http module only.
// Login is Discord OAuth2 (identify + guilds). Sessions live in memory, so a restart logs everyone out.

import http from "node:http";
import { gameNight } from "../gamenight.js";
import { setupStatus, autoSetup } from "../setup.js";
import { CHANGELOG, LATEST } from "../changelog.js";
import { randomBytes, createHash } from "node:crypto";
import { brotliCompressSync, gzipSync, constants as zc } from "node:zlib";
import { readdirSync, readFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { REGIONS, ALERT_TYPES, FANATICAL_GRABBER_URL, EXTENSION_LATEST, EXTENSION_STORE_URL } from "../constants.js";
import { runValue, ValueError, MAX_UPLOAD_CHARS } from "../value.js";
import { viewRows, exportJson, addGameByTitle, applySteamImport, WishlistError } from "../wishlist.js";
import { importWishlist, SteamError, STEAM_SHOP_ID } from "../steam.js";
import { ItadError } from "../itad.js";
import { parseTrigger, describeTrigger } from "../alerts.js";
import { DiscordApiError } from "./discord.js";
import { createCommunityDash, CommunityError } from "./communitydash.js";
import { createModDash, ModDashError } from "./moddash.js";
import { botInviteUrl } from "../community.js";
import { connectionPayload } from "../linkedroles.js";
import { parseHost, parseSteps, StepError, STEP_KINDS } from "../gwpartner.js";
import { HELP, ABOUT, PRIVACY } from "../text.js";
import { enrichFree, withOwnership } from "../freeinfo.js";
import { forYou } from "../foryou.js";
import { libraryAnalytics } from "../analytics.js";
import { steamLoginUrl, verifySteamLogin } from "../steamopenid.js";
import { UserError } from "../errors.js";
import { parseUpload, sanitize } from "../parse.js";
import { prefsPatch, prefsView } from "../prefs.js";
import { trophyCase } from "../badges.js";
import { profileCardData, renderProfileCard, renderSteamValue, renderRecap } from "../cardimg.js";
import { PLATFORMS, mergePrefs, viewPrefs } from "../cardprefs.js";
import { createBroadcaster, MAX_BODY } from "../broadcast.js";
import { grabberPromo } from "../promo.js";
import { addBundle, bundleView } from "../bundles.js";
import { goalProgress } from "../steamstore.js";
import { fillGifted, fillPrices, fillRetail, importLibrary, libraryView, leaderboard, finishedLeague, extraBoard, EXTRA_BOARDS, serverStats } from "../library.js";
import { extractKeys } from "../redeemstore.js";
import { compareLibraries } from "../compare.js";
import { regionPrices } from "../regions.js";
import { calendarEntries, toIcs, KINDS } from "../calendar.js";
import { addToServerList, serverListView, vote, removeFromServerList } from "../serverlist.js";
import { createLimiter } from "../ratelimit.js";
import { setProfile, publicWishlist } from "../profile.js";
import { summarize } from "../report.js";
import { refreshTags, tasteProfile, recommend, tasteWhy } from "../taste.js";
import { buyOrWait } from "../advice.js";
import { friendDeals, friendRows, saveFriend } from "../friends.js";
import { spendSummary, regionCurrency, grabberRegion } from "../spend.js";
import { challengeView, monthKey, MAX_GOAL } from "../challenge.js";
import { GIFT_TOKEN, MAX_CLAIMS_PER_VISITOR } from "../giftstore.js";
import { upcomingSales, salesBefore, SALES_UPDATED } from "../salescal.js";
import { playNext } from "../library.js";
import { resolveProfile, syncSteamLibrary, playStats, steamNext, fetchProfileCard, fetchOwnedGames } from "../steamlib.js";
import { bundleCheck } from "../bundle.js";
import { salePrep, saleRecap } from "../saleprep.js";
import { isDlc } from "../freemenu.js";
import { freeArt } from "../render.js";
import { autoImage } from "../giveaway.js";
import { parseKeys, parseDuration, parseColor, parseImageUrl } from "../gwparse.js";
import { MAX_KEYS } from "../gwstore.js";

const PUBLIC_DIR = fileURLToPath(new URL("../../public/", import.meta.url));
const FILES = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/app.js": ["app.js", "text/javascript; charset=utf-8"],
    "/theme.js": ["theme.js", "text/javascript; charset=utf-8"],
    "/style.css": ["style.css", "text/css; charset=utf-8"],
    "/logo.png": ["logo.png", "image/png"],
    "/creator.png": ["creator.png", "image/png"],
    "/creator-bg.webp": ["creator-bg.webp", "image/webp"],
    "/banner.png": ["banner.png", "image/png"],
    "/multikey.png": ["multikey.png", "image/png"],
    "/grabber-ad-hero.png": ["grabber-ad-hero.png", "image/png"],
    "/grabber-ad-cart.png": ["grabber-ad-cart.png", "image/png"],
    "/grabber-ad-paid.png": ["grabber-ad-paid.png", "image/png"],
    "/preview.jpg": ["preview.jpg", "image/jpeg"],
    "/favicon.png": ["favicon.png", "image/png"]
};
const SESSION_MS = 7 * 24 * 3600_000;
const MAX_SESSIONS = 10_000;
const COOKIE = "svc_session";
const STATE_COOKIE = "svc_state";
const STEAM_STATE_COOKIE = "svc_steamstate", STEAM_PENDING_COOKIE = "svc_steampending", STEAM_KNOWN_COOKIE = "svc_steamknown", NEXT_COOKIE = "svc_next";
const COOLDOWNS = { broadcast: 120_000, value: 15_000, import: 60_000, add: 3_000, hist: 2_000, lib: 3_000, steam: 60_000, deals: 5_000, grabber: 10_000, grabbergame: 1_000, gamepage: 1_500, taste: 5_000, steamlookup: 8_000, grabberprices: 2_000, grabbertoken: 5_000, deals: 3_000, cardimg: 4_000, analytics: 2_500, foryou: 2_500, csetup: 20_000, cemoji: 8_000, clink: 3_000, cpage: 2_000, mod: 1_000, announce: 5_000, lbrefresh: 15_000 };
const MAX_HISTORY_POINTS = 180;
const MANAGE_GUILD = 0x20n;
const ADMINISTRATOR = 0x8n;

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const MOD_PERMS = { moderate: { bit: 1n << 40n, text: "Moderate Members" }, kick: { bit: 1n << 1n, text: "Kick Members" }, ban: { bit: 1n << 2n, text: "Ban Members" }, manageMessages: { bit: 1n << 13n, text: "Manage Messages" }, manageGuild: { bit: MANAGE_GUILD, text: "Manage Server" } };
const MOD_ACTION_PERM = { warn: "moderate", timeout: "moderate", untimeout: "moderate", kick: "kick", ban: "ban", unban: "ban", purge: "manageMessages" };
/** Does this person have the permission in that server (owner and Administrator have all of them)? */
const hasGuildPerm = (g, need) => {
    if (g.owner) return true;
    try { const p = BigInt(g.permissions ?? "0"); return (p & ADMINISTRATOR) !== 0n || (p & MOD_PERMS[need].bit) !== 0n; } catch { return false; }
};
const isManager = g => {
    if (g.owner) return true;
    try {
        const p = BigInt(g.permissions ?? "0");
        return (p & MANAGE_GUILD) !== 0n || (p & ADMINISTRATOR) !== 0n;
    } catch { return false; }
};

export function createDashboard({ db, itad, rest, ops = null, giveaways = null, tickets = null, logs = null, botInfo = null, status = null, djsVersion = null, botGuilds = null, guildList = null, lfg = null, calendar = null, community = null, moderation = null, membersIntent = () => true, broadcaster: sharedBroadcaster = null, dm = null, fx = null, steamFetch = globalThis.fetch, config, now = () => Date.now(), log = () => {} }) {
    const origin = new URL(config.publicUrl).origin;
    const secure = origin.startsWith("https://");
    const sessions = new Map();
    const states = new Map();
    const steamKnown = new Map();   // one-time token -> { user, exp }: a Steam sign-in of a known member, waiting for the Discord half
    const steamPending = new Map(); // one-time token -> { steamid, exp }: a Steam sign-in that still needs a Discord account to attach to
    const lastRun = new Map();
    const cache = new Map();
    const apiLimit = createLimiter({ windowMs: 60_000, max: config.apiPerMinute ?? 120, now });
    const giftLimit = createLimiter({ windowMs: 3600_000, max: 60, now });
    const authLimit = createLimiter({ windowMs: 60_000, max: config.authPerMinute ?? 20, now });
    const names = new Map(); // "guild:user" -> { name, until }

    // ---------- helpers ----------
    const cookies = req => Object.fromEntries(String(req.headers.cookie ?? "").split(";").map(c => {
        const i = c.indexOf("=");
        return i < 0 ? [] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
    }).filter(p => p.length));

    const setCookie = (res, name, value, maxAgeS) => {
        const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeS}`];
        if (secure) parts.push("Secure");
        const prev = res.getHeader("Set-Cookie") ?? [];
        res.setHeader("Set-Cookie", [...(Array.isArray(prev) ? prev : [prev]), parts.join("; ")]);
    };

    // Text is sent compressed to browsers that accept it: the page code is about a fifth of its size that way.
    const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml)|image\/svg)/;
    const encodingOf = req => { const a = String(req?.headers?.["accept-encoding"] ?? ""); return /\bbr\b/.test(a) ? "br" : /\bgzip\b/.test(a) ? "gzip" : null; };
    const squeeze = (buf, enc, quality) => (enc === "br" ? brotliCompressSync(buf, { params: { [zc.BROTLI_PARAM_QUALITY]: quality } }) : gzipSync(buf, { level: Math.min(9, quality) }));
    const send = (res, status, body, headers = {}) => {
        const type = String(headers["Content-Type"] ?? "");
        if (COMPRESSIBLE.test(type) && !headers["Content-Encoding"] && body && Buffer.byteLength(body) > 1024) {
            const enc = encodingOf(res.req);
            if (enc) { body = squeeze(Buffer.from(body), enc, 4); headers = { ...headers, "Content-Encoding": enc, Vary: "Accept-Encoding" }; }
        }
        res.writeHead(status, {
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "no-referrer",
            "Content-Security-Policy":
                "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https://cdn.discordapp.com https://cdn.akamai.steamstatic.com https://shared.akamai.steamstatic.com https://cdn.cloudflare.steamstatic.com https://shared.akamai.steamstatic.com https://assets.isthereanydeal.com https://media.discordapp.net https: data:; " +
                "connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
            ...headers
        });
        res.end(body);
    };
    const json = (res, status, data, headers = {}) =>
        send(res, status, JSON.stringify(data), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });

    async function readJson(req, limit) {
        const chunks = [];
        let size = 0;
        for await (const c of req) {
            size += c.length;
            if (size > limit) throw new HttpError(413, "That request is too large.");
            chunks.push(c);
        }
        if (!size) return {};
        try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { throw new HttpError(400, "Bad request."); }
    }

    // Public profile cards are cached for a minute and a half so the Steam page does not ask Steam every time.
    const cardCache = new Map();
    async function profileCard(steamid) {
        const hit = cardCache.get(steamid);
        if (hit && now() - hit.at < 90_000) return hit.card;
        const card = await fetchProfileCard(steamid, steamFetch);
        if (card) { if (cardCache.size > 500) cardCache.clear(); cardCache.set(steamid, { at: now(), card }); }
        return card;
    }

    function sweep() {
        const t = now();
        for (const [k, s] of sessions) if (s.expires < t) sessions.delete(k);
        for (const [k, exp] of states) if (exp < t) states.delete(k);
        for (const [k, p] of steamPending) if (p.exp < t) steamPending.delete(k);
        for (const [k, p] of steamKnown) if (p.exp < t) steamKnown.delete(k);
        for (const [k, at] of lastRun) if (t - at > 120_000) lastRun.delete(k); // the longest cooldown is a minute
    }

    function session(req) {
        const s = sessions.get(cookies(req)[COOKIE]);
        if (!s || s.expires < now()) throw new HttpError(401, "Please sign in with Discord.");
        return s;
    }

    function checkWrite(req) {
        const type = String(req.headers["content-type"] ?? "");
        if (!type.startsWith("application/json") || req.headers["x-requested-with"] !== "dashboard") {
            throw new HttpError(403, "Request blocked.");
        }
        if (req.headers.origin && req.headers.origin !== origin) throw new HttpError(403, "Request blocked.");
    }

    function cooldown(userId, key) {
        const k = `${key}:${userId}`;
        const wait = COOLDOWNS[key] - (now() - (lastRun.get(k) ?? 0));
        if (wait > 0) throw new HttpError(429, `Slow down a little. Try again in ${Math.ceil(wait / 1000)}s.`);
        lastRun.set(k, now());
        return () => lastRun.delete(k);
    }

    const clientIp = req => {
        const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",").map(x => x.trim()).filter(Boolean);
        // Behind a trusted proxy the last entry is the one the proxy added; otherwise ignore the header.
        return (config.trustProxy && fwd.length ? fwd[fwd.length - 1] : req.socket.remoteAddress) ?? "unknown";
    };

    const isOwner = s => Boolean(config.ownerId) && s.userId === config.ownerId && !s.steamOnly; // admin always needs a real Discord sign-in
    let broadcasterInstance = null;
    const broadcaster = () => sharedBroadcaster ?? (broadcasterInstance ??= createBroadcaster({ publicUrl: config.publicUrl, db, ownerId: config.ownerId, delayMs: config.broadcastDelayMs ?? 1100,
        sendDm: (id, p) => dm(id, p), sendChannel: (id, p) => rest.sendMessage(id, p), promoPayload: () => grabberPromo({ base: config.publicUrl, url: process.env.EXTENSION_STORE_URL || EXTENSION_STORE_URL, dashboardUrl: config.publicUrl }) }));

    function managerGuild(s, id) {
        const g = guildFor(s, id);
        if (!isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
        return g;
    }
    const needGiveaways = () => { if (!giveaways) throw new HttpError(503, "Giveaways are not set up on this bot. The owner needs to set KEY_ENCRYPTION_SECRET."); };
    function giveawayOf(g, id) {
        const x = db.getGiveaway(Number(id));
        if (!x || x.guild_id !== g.id) throw new HttpError(404, "I can't find that giveaway.");
        return x;
    }

    const needTickets = () => { if (!tickets) throw new HttpError(503, "Support tickets are not available."); };
    const settingsView = scope => { const x = db.getTicketSettings(scope); return { channel_id: x.channel_id, staff_role_id: x.staff_role_id, canned: db.listCanned(scope) }; };
    /** The ticket's owner, the bot owner, or a manager of the ticket's server may open it. `staff` says which side they are on. */
    function ticketAccess(s, id) {
        const t = db.getTicket(Number(id));
        if (!t) throw new HttpError(404, "I can't find that ticket.");
        const staff = isOwner(s) || Boolean(t.guild_id && s.guilds.some(g => g.id === t.guild_id && isManager(g)));
        if (t.user_id !== s.userId && !staff) throw new HttpError(404, "I can't find that ticket.");
        return { t, staff };
    }

    function guildFor(s, id) {
        const g = s.guilds.find(x => x.id === id);
        if (!g) throw new HttpError(403, "You are not in that server.");
        return g;
    }

    const cd = community ? createCommunityDash({ db, rest, community, membersIntent, botId: config.clientId, publicUrl: config.publicUrl }) : null;
    /** Community actions: the same Discord permissions as the commands. Errors from the helper become normal dashboard errors. */
    const comm = async fn => {
        if (!cd) throw new HttpError(503, "Community features are not available on this bot.");
        try { return await fn(); } catch (e) { if (e instanceof CommunityError) throw new HttpError(e.status, e.message); throw e; }
    };
    const md = moderation ? createModDash({ db, rest, mod: moderation }) : null;
    /** Moderation from the dashboard needs the same Discord permission the command does, on top of seeing the server. */
    const modGuild = (s, id, need) => {
        const g = guildFor(s, id);
        if (!hasGuildPerm(g, need)) throw new HttpError(403, `You need the ${MOD_PERMS[need].text} permission there.`);
        return g;
    };
    const modr = async fn => {
        if (!md) throw new HttpError(503, "Moderation is not available on this bot.");
        try { return await fn(); } catch (e) { if (e instanceof ModDashError) throw new HttpError(e.status, e.message); throw e; }
    };
    const botIn = g => { if (botGuilds && !botGuilds(g.id)) throw new HttpError(400, "The bot is not in that server yet. Invite it first."); };
    const num = v => (v === null || v === undefined || v === "" ? null : Number(v));
    const userRow = s => db.ensureUser(s.userId);
    /** A pasted profile if there is one, else the Steam account the person signed in with. */
    const profileOrLinked = async (s, pasted) => {
        const text = String(pasted ?? "").trim();
        if (text) return text;
        const link = db.getSteamLink(s.userId);
        if (!link) throw new HttpError(400, "Sign in through Steam first.");
        return link.steamid;
    };

    function publicSettings(u) {
        return { region: u.region, stores: u.stores, delivery: u.delivery, paused: Boolean(u.paused), guild_id: u.guild_id, steam_id: u.steam_id, ...prefsView(u) };
    }

    function serversFor(s, u) {
        return s.guilds
            .map(g => ({
                id: g.id, name: g.name, icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null,
                manageable: isManager(g), bot: botGuilds ? Boolean(botGuilds(g.id)) : null, freeFeed: Boolean(db.getGuild(g.id)?.free_feed), hotMin: db.getGuild(g.id)?.hot_min ?? 0, saleFeed: Boolean(db.getGuild(g.id)?.sale_feed), alertChannel: db.getGuild(g.id)?.channel_id ?? null,
                groupMin: db.getGuild(g.id)?.group_min ?? 0, weeklyDigest: Boolean(db.getGuild(g.id)?.weekly_digest)
            }))
            .sort((a, b) => Number(b.manageable) - Number(a.manageable) || a.name.localeCompare(b.name));
    }

    const PAGES = [["value", "Value Checker"], ["wishlist", "Wishlist"], ["library", "Library"], ["steam", "Steam"], ["deals", "Deals"], ["alerts", "Alerts"], ["servers", "Servers"], ["giveaways", "Giveaways"], ["support", "Support"], ["notifications", "Notifications"], ["mydata", "My Data"], ["help", "Help"], ["status", "Status"], ["changelog", "What's new"]];
    /** The first-run checklist on the dashboard home. */
    function setupSteps(s, u) {
        return [
            { id: "wishlist", text: "Add games to your wishlist", done: db.countItems(s.userId) > 0, href: "#/wishlist" },
            { id: "alerts", text: "Pick how you want alerts (DM or a server channel)", done: u.delivery === "channel" || u.quiet_start != null || Boolean(u.digest) || db.listAlerts(s.userId, 1).length > 0, href: "#/alerts" },
            { id: "free", text: "Turn on free game alerts", done: Boolean(u.free), href: "#/alerts" },
            { id: "library", text: "Add games you own to the library", done: db.countLibrary(s.userId) > 0, href: "#/library" },
            { id: "steam", text: "Link your public Steam profile for hours, recap and taste (optional)", done: Boolean(db.getSteamLink(s.userId)), href: "#/steam", optional: true },
            { id: "challenge", text: "Set a monthly backlog challenge (optional)", done: db.challengeRows(s.userId).some(r => r.month === monthKey(Date.now())), href: "#/library", optional: true },
            { id: "friend", text: "Add a friend's birthday for gift reminders (optional)", done: db.countFriends(s.userId) > 0, href: "#/friends", optional: true },
            { id: "server", text: "Add the bot to a server", done: s.guilds.some(g => (botGuilds ? botGuilds(g.id) : false)), href: "#/servers" }
        ];
    }

    // ---------- API ----------
    const routes = {
        // The extension asks this (no sign-in, nothing sent about the person) to remind its users to update.
        "GET /api/extension/latest": async () => ({ latest: process.env.EXTENSION_LATEST || EXTENSION_LATEST, url: process.env.EXTENSION_STORE_URL || EXTENSION_STORE_URL }),
        "GET /api/config": async () => ({
            regions: REGIONS, alertTypes: ALERT_TYPES, fanaticalUrl: FANATICAL_GRABBER_URL,
            help: HELP, about: ABOUT, extension: { latest: process.env.EXTENSION_LATEST || EXTENSION_LATEST },
            privacy: PRIVACY.split("\n").filter(l => !/github\.com/i.test(l)).join("\n"), maxUploadChars: MAX_UPLOAD_CHARS,
            // View Channel + Send Messages + Embed Links, the least the bot needs to post alerts
            userInstallUrl: config.clientId
                ? `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(config.clientId)}&integration_type=1&scope=applications.commands`
                : null,
            inviteUrl: config.clientId
                ? botInviteUrl(config.clientId)
                : null
        }),

        "GET /api/me": async (req) => {
            const s = session(req);
            const u = userRow(s);
            return {
                user: { id: s.userId, username: s.username, avatar: s.avatar },
                settings: publicSettings(u),
                games: db.countItems(s.userId),
                servers: serversFor(s, u),
                isOwner: isOwner(s),
                steamOnly: Boolean(s.steamOnly),
                giveaways: Boolean(giveaways),
                library: db.countLibrary(s.userId),
                unread: db.unreadNotifications(s.userId),
                bugsNew: isOwner(s) ? db.countNewBugs(Number(db.getMeta("bugs_seen") ?? 0)) : 0,
                news: u.seen_version === LATEST ? null : LATEST,
                newsTitle: CHANGELOG[0]?.title ?? null,
                tour: !u.welcomed,
                steam: (l => l ? { linked: true, verified: Boolean(l.verified), synced: Boolean(l.synced_at) } : { linked: false })(db.getSteamLink(s.userId)),
                setup: setupSteps(s, u)
            };
        },

        "POST /api/tour/done": async (req) => { const s = session(req); userRow(s); db.updateUser(s.userId, { welcomed: 1 }); return { ok: true }; },

        "GET /api/notifications": async (req) => {
            const s = session(req); userRow(s);
            return { items: db.listNotifications(s.userId, 80), unread: db.unreadNotifications(s.userId) };
        },
        "POST /api/notifications/read": async (req) => { const s = session(req); userRow(s); db.readNotifications(s.userId); return { unread: 0 }; },

        "GET /api/changelog": async (req) => {
            const s = session(req); const u = userRow(s);
            db.updateUser(s.userId, { seen_version: LATEST });
            return { entries: CHANGELOG, wasNew: u.seen_version !== LATEST };
        },
        "POST /api/changelog/seen": async (req) => { const s = session(req); userRow(s); db.updateUser(s.userId, { seen_version: LATEST }); return { ok: true }; },

        "POST /api/wishlist/snooze": async (req, body) => {
            const s = session(req);
            const item = db.listItems(s.userId).find(i => i.itad_id === body.itad_id);
            if (!item) throw new HttpError(404, "That game is not on your list.");
            const days = Math.min(90, Math.max(0, Math.trunc(Number(body.days ?? 7)) || 0));
            db.snoozeItem(item.id, days ? now() + days * 86400_000 : null);
            return { snoozed_until: days ? now() + days * 86400_000 : null };
        },

        // One box that finds your games, library, tickets, pages and (for managers) giveaways.
        "GET /api/search": async (req, _b, url) => {
            const s = session(req); userRow(s);
            const q = String(url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 60);
            if (q.length < 2) return { results: [] };
            const hit = t => String(t).toLowerCase().includes(q);
            const out = [];
            for (const i of db.listItems(s.userId)) if (hit(i.title)) out.push({ kind: "Wishlist", title: i.title, href: "#/wishlist" });
            for (const l of db.listLibrary(s.userId)) if (hit(l.title)) out.push({ kind: "Library", title: l.title, href: "#/library" });
            for (const t of db.listTickets({ userId: s.userId, limit: 50 })) if (hit(t.subject) || `#${t.id}` === q) out.push({ kind: "Ticket", title: `#${t.id} ${t.subject}`, href: `#/support/${t.id}` });
            for (const g of s.guilds) if (hit(g.name)) out.push({ kind: "Server", title: g.name, href: `#/servers/${g.id}` });
            for (const [id, name] of PAGES) if (hit(name)) out.push({ kind: "Page", title: name, href: "#/" + id });
            return { results: out.slice(0, 25) };
        },

        "POST /api/value": async (req, body) => {
            const s = session(req);
            cooldown(s.userId, "value");
            try {
                return await runValue({
                    itad,
                    typed: String(body.titles ?? "").slice(0, 20_000),
                    upload: body.file && typeof body.file === "object" ? { name: String(body.file.name ?? ""), text: String(body.file.text ?? "") } : null,
                    paid: num(body.paid),
                    region: REGIONS.some(r => r.value === body.region) ? body.region : "US",
                    stores: body.stores === "major" ? "major" : "all",
                    sort: String(body.sort ?? "input")
                });
            } catch (err) {
                lastRun.delete(`value:${s.userId}`);
                throw err;
            }
        },

        "GET /api/wishlist": async (req) => {
            const s = session(req);
            const u = userRow(s);
            const { rows, currency } = await viewRows(db, itad, u);
            return { rows, currency };
        },

        "POST /api/wishlist/import": async (req, body) => {
            const s = session(req);
            const undo = cooldown(s.userId, "import");
            userRow(s);
            try {
                const r = await importWishlist(await profileOrLinked(s, body.profile), itad);
                return applySteamImport(db, s.userId, r);
            } catch (err) {
                undo();
                throw err;
            }
        },

        "POST /api/wishlist/add": async (req, body) => {
            const s = session(req);
            cooldown(s.userId, "add");
            userRow(s);
            return addGameByTitle(db, itad, s.userId, body.title, body.type, num(body.value), { source: body.watch ? "watch" : "manual" });
        },

        "POST /api/wishlist/remove": async (req, body) => {
            const s = session(req);
            const item = db.listItems(s.userId).find(i => i.itad_id === body.itad_id);
            if (!item) throw new HttpError(404, "That game is not on your list.");
            db.removeItem(s.userId, item.itad_id);
            return { removed: item.title };
        },

        "POST /api/wishlist/cleanup": async (req) => {
            const s = session(req);
            const owned = db.ownedWishlist(s.userId);
            db.removeOwnedWishlist(s.userId);
            return { removed: owned.length, titles: owned.slice(0, 30).map(x => x.title) };
        },

        "POST /api/wishlist/priority": async (req, body) => {
            const s = session(req);
            if (!db.setPriority(s.userId, String(body.itad_id), body.starred !== false)) throw new HttpError(404, "That game is not on your list.");
            return { starred: body.starred !== false };
        },

        "POST /api/wishlist/alert": async (req, body) => {
            const s = session(req);
            let trig;
            try { trig = parseTrigger(body.type, num(body.value)); } catch (e) { throw new HttpError(400, e.message); }
            const label = describeTrigger({ trigger_type: trig.type, trigger_value: trig.value });
            if (body.itad_id) {
                const item = db.listItems(s.userId).find(i => i.itad_id === body.itad_id);
                if (!item) throw new HttpError(404, "That game is not on your list.");
                db.setTrigger(s.userId, trig.type, trig.value, item.itad_id);
                return { updated: 1, label };
            }
            return { updated: db.setTrigger(s.userId, trig.type, trig.value), label };
        },

        "POST /api/settings": async (req, body) => {
            const s = session(req);
            const u = userRow(s);
            const patch = {};
            if (body.region !== undefined) {
                if (!REGIONS.some(r => r.value === body.region)) throw new HttpError(400, "Unknown region.");
                patch.region = body.region;
            }
            if (body.stores !== undefined) {
                if (!["major", "all"].includes(body.stores)) throw new HttpError(400, "Unknown store setting.");
                patch.stores = body.stores;
            }
            if (body.paused !== undefined) patch.paused = body.paused ? 1 : 0;
            if (body.guild_id !== undefined) {
                if (body.guild_id !== null && !s.guilds.some(g => g.id === body.guild_id)) throw new HttpError(400, "You are not in that server.");
                patch.guild_id = body.guild_id;
            }
            const nextGuild = patch.guild_id !== undefined ? patch.guild_id : u.guild_id;
            const nextDelivery = body.delivery ?? u.delivery;
            if (!["dm", "channel"].includes(nextDelivery)) throw new HttpError(400, "Unknown delivery mode.");
            if (nextDelivery === "channel" && !db.getGuild(nextGuild)) {
                throw new HttpError(400, "Pick a server that has an alert channel first. A server admin can set one on the Servers page.");
            }
            patch.delivery = nextDelivery;
            const prefInput = Object.fromEntries(["quiet_start", "quiet_end", "tz", "digest", "digest_day", "bundles", "share", "free", "free_dlc", "min_discount", "muted", "lang"].filter(k => body[k] !== undefined).map(k => [k, body[k]]));
            Object.assign(patch, prefsPatch(prefInput, u));
            db.updateUser(s.userId, patch);
            return { settings: publicSettings(db.getUser(s.userId)) };
        },

        "GET /api/servers/channels": async (req, _b, url) => {
            const s = session(req);
            const g = s.guilds.find(x => x.id === url.searchParams.get("guild"));
            if (!g || !isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            try {
                return { channels: await rest.listChannels(g.id), current: db.getGuild(g.id)?.channel_id ?? null };
            } catch (err) {
                if (err instanceof DiscordApiError && [403, 404].includes(err.status)) throw new HttpError(400, "The bot is not in that server yet. Invite it first.");
                throw err;
            }
        },

        "POST /api/servers/channel": async (req, body) => {
            const s = session(req);
            const g = s.guilds.find(x => x.id === body.guild_id);
            if (!g || !isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            if (body.clear) return { cleared: db.clearGuildChannel(g.id) };

            let channels;
            try { channels = await rest.listChannels(g.id); }
            catch (err) {
                if (err instanceof DiscordApiError && [403, 404].includes(err.status)) throw new HttpError(400, "The bot is not in that server yet. Invite it first.");
                throw err;
            }
            const channel = channels.find(c => c.id === body.channel_id);
            if (!channel) throw new HttpError(400, "Pick a text channel from the list.");

            // Posting a message proves the bot can use the channel, and tells the server who changed it.
            try {
                await rest.sendMessage(channel.id, {
                    content: `Wishlist alert channel set from the dashboard by <@${s.userId}>. Members get sale alerts here when a DM cannot be delivered, or when they choose channel delivery.`,
                    allowed_mentions: { parse: [] }
                });
            } catch {
                throw new HttpError(400, `I cannot post in #${channel.name}. Give the bot View Channel, Send Messages and Embed Links there, then try again.`);
            }
            db.setGuildChannel(g.id, channel.id, s.userId);
            return { channel };
        },

        // ----- price history, bulk actions, alert history -----
        "GET /api/wishlist/history": async (req, _b, url) => {
            const s = session(req);
            const id = String(url.searchParams.get("itad_id") ?? "");
            const own = db.listItems(s.userId).find(i => i.itad_id === id) ?? db.listLibrary(s.userId).find(i => i.itad_id === id);
            if (!own) throw new HttpError(404, "That game is not on your wishlist or in your library.");
            cooldown(s.userId, "hist");
            const u = userRow(s);
            const all = await itad.getHistory(id, u.region);
            const step = Math.max(1, Math.ceil(all.length / MAX_HISTORY_POINTS));
            const points = all.filter((_, i) => i % step === 0 || i === all.length - 1).map(p => ({ t: p.t, price: p.price, shop: p.shop }));
            let advice = null;
            try {
                const prices = await itad.getPrices([id], u.region);
                const sum = summarize(prices.get(id), { majorOnly: u.stores === "major" });
                const nowPrice = sum.best?.price ?? all.at(-1)?.price;
                const cur = sum.currency || "USD";
                advice = buyOrWait(all, nowPrice, { sales: upcomingSales(Date.now()), past: salesBefore(), money: n => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(n); } catch { return String(n); } } });
            } catch { /* the chart works without it */ }
            return { title: own.title, points, advice };
        },

        "POST /api/wishlist/bulk": async (req, body) => {
            const s = session(req);
            const ids = Array.isArray(body.itad_ids) ? [...new Set(body.itad_ids.map(String))].slice(0, 200) : [];
            if (!ids.length) throw new HttpError(400, "Select at least one game.");
            const mine = new Set(db.listItems(s.userId).map(i => i.itad_id));
            const targets = ids.filter(id => mine.has(id));
            if (body.action === "remove") {
                for (const id of targets) db.removeItem(s.userId, id);
                return { removed: targets.length };
            }
            if (body.action === "alert") {
                let trig;
                try { trig = parseTrigger(body.type, num(body.value)); } catch (e) { throw new HttpError(400, e.message); }
                for (const id of targets) db.setTrigger(s.userId, trig.type, trig.value, id);
                return { updated: targets.length, label: describeTrigger({ trigger_type: trig.type, trigger_value: trig.value }) };
            }
            throw new HttpError(400, "Unknown action.");
        },

        "GET /api/alerts/history": async (req) => {
            const s = session(req);
            return { alerts: db.listAlerts(s.userId, 100).map(a => ({ at: a.at, kind: a.kind, title: a.title, price: a.price, regular: a.regular, shop: a.shop, via: a.via })) };
        },

        // ----- library -----
        "GET /api/library": async (req) => {
            const s = session(req);
            const u = userRow(s);
            const v = await libraryView(db, itad, u);
            const tags = db.getAppTags(v.rows.map(r => r.appid).filter(Boolean)); // Steam's public genres, for the card view's tags and filter
            for (const r of v.rows) r.genres = (tags.get(r.appid)?.genres ?? []).slice(0, 4);
            return v;
        },

        "POST /api/library/add": async (req, body) => {
            const s = session(req);
            cooldown(s.userId, "lib");
            userRow(s);
            const paid = num(body.paid);
            if (paid !== null && !(Number.isFinite(paid) && paid >= 0 && paid <= 10_000)) throw new HttpError(400, "Paid must be a number from 0 to 10,000.");
            const r = await importLibrary(db, itad, s.userId, [{ title: String(body.title ?? ""), paid }]);
            if (r.notFound.length) throw new HttpError(400, `I could not find a game called ${r.notFound[0]}.`);
            if (r.skippedForLimit) throw new HttpError(400, "Your library is full (1,500 games).");
            return r;
        },

        "POST /api/library/import": async (req, body) => {
            const s = session(req);
            cooldown(s.userId, "lib");
            userRow(s);
            let entries = [];
            if (body.file && typeof body.file === "object") {
                const name = String(body.file.name ?? "");
                if (!/\.(csv|json|txt|md)$/i.test(name)) throw new HttpError(400, "Unsupported file type. Use a .csv, .json, .txt or .md export.");
                const text = String(body.file.text ?? "");
                if (text.length > MAX_UPLOAD_CHARS) throw new HttpError(400, "That file is too large (200 KB max).");
                entries = parseUpload(text, name.toLowerCase());
            } else if (Array.isArray(body.entries)) {
                entries = body.entries.slice(0, 500).map(e => ({ title: String(e?.title ?? ""), paid: Number.isFinite(Number(e?.paid)) && e?.paid !== null && e?.paid !== "" ? Number(e.paid) : null }));
            }
            const clean = sanitize(entries, { max: 500 }).entries;
            if (!clean.length) throw new HttpError(400, "I need game titles, not keys.");
            return await importLibrary(db, itad, s.userId, clean);
        },

        "GET /api/redeem": async (req) => {
            const s = session(req);
            db.pruneRedeemJobs();
            return { job: db.pendingRedeemJob(s.userId) };
        },

        "GET /api/redeem/history": async (req) => {
            const s = session(req);
            const entries = db.redeemHistory(s.userId, 100);
            const count = st => entries.filter(e => e.status === st).length;
            return { entries, counts: { redeemed: count("redeemed"), owned: count("owned"), used: count("used"), invalid: count("invalid") } };
        },

        "POST /api/redeem/check": async (req, body) => {
            // Which pasted keys were already redeemed here, so the page can skip them instead of spending a Steam attempt.
            const s = session(req);
            const keys = extractKeys((Array.isArray(body.keys) ? body.keys : []).slice(0, 500).join("\n"));
            return { known: Object.fromEntries(db.knownRedeems(s.userId, keys)) };
        },

        "POST /api/redeem/log": async (req, body) => {
            // A batch run straight from the page: remember how the keys ended up (hashes only).
            const s = session(req);
            const results = (Array.isArray(body.results) ? body.results : []).slice(0, 500).map(r => ({ key: String(r?.key ?? ""), status: String(r?.status ?? ""), game: String(r?.game ?? "").slice(0, 100) }));
            return { logged: db.logRedeem(s.userId, results) };
        },

        "POST /api/redeem/history/clear": async (req) => {
            const s = session(req);
            return { cleared: db.clearRedeemHistory(s.userId) };
        },

        "POST /api/redeem/finish": async (req, body) => {
            // The page reports what the extension did with a batch that was queued by /redeem. Results go back to the member's Discord DMs.
            const s = session(req);
            const job = db.pendingRedeemJob(s.userId);
            if (body.cancel) { db.cancelRedeemJob(s.userId); return { ok: true }; }
            if (!job || job.id !== Number(body.id)) throw new HttpError(404, "That batch is no longer waiting.");
            const mine = new Set(job.keys);
            const results = (Array.isArray(body.results) ? body.results : []).slice(0, 500)
                .map(r => ({ key: String(r?.key ?? "").toUpperCase(), status: String(r?.status ?? "error").slice(0, 20), game: String(r?.game ?? "").slice(0, 100), message: String(r?.message ?? "").slice(0, 120) }))
                .filter(r => mine.has(r.key));
            const count = (...st) => results.filter(r => st.includes(r.status)).length;
            const failed = results.filter(r => !["redeemed", "owned", "used"].includes(r.status));
            const left = job.keys.length - results.length;
            const summary = `${count("redeemed")} redeemed, ${count("owned", "used")} already owned or used, ${failed.length} failed${left > 0 ? `, ${left} not tried` : ""}`;
            const aborted = String(body.aborted ?? "").slice(0, 160);
            const lines = [`Your batch redeem finished: **${summary}.**`];
            if (aborted) lines.push(`⚠️ ${aborted}`);
            const done = results.filter(r => r.status === "redeemed");
            if (done.length) lines.push("", "**Redeemed**", ...done.slice(0, 25).map(r => `• ${r.game || "Unnamed product"} (\`${r.key.slice(0, 5)}-•••••-${r.key.slice(-5)}\`)`));
            if (failed.length) lines.push("", "**Failed** (still yours to retry)", ...failed.slice(0, 25).map(r => `• \`${r.key}\` ${r.message || r.status}`));
            if (left > 0) lines.push("", `**${left}** key${left === 1 ? "" : "s"} were not tried. Send them again with /redeem.`);
            db.logRedeem(s.userId, results);
            if (!db.finishRedeemJob(s.userId, job.id, summary)) throw new HttpError(404, "That batch is no longer waiting.");
            const text = lines.join("\n").slice(0, 3900);
            try { db.addNotification(s.userId, { type: "redeem", title: "Batch redeem finished", body: summary, url: "#/redeem" }); } catch { /* the DM is what counts */ }
            let sent = false;
            if (dm) { try { await dm(s.userId, { embeds: [{ color: 0x57f287, title: "Batch redeem", description: text }] }); sent = true; } catch { /* DMs closed: it is in Notifications */ } }
            return { ok: true, summary, dm: sent };
        },

        // The key vault shows titles only: what the unredeemed games are worth right now. Keys never come here.
        "POST /api/vault/value": async (req, body) => {
            const s = session(req);
            cooldown(s.userId, "value");
            const u = userRow(s);
            const titles = [...new Set((Array.isArray(body.titles) ? body.titles : []).map(t => String(t ?? "").trim().slice(0, 150)).filter(Boolean))].slice(0, 150);
            if (!titles.length) throw new HttpError(400, "No titles.");
            const looked = (await itad.lookupTitles(titles)).filter(r => r.id);
            const prices = looked.length ? await itad.getPrices(looked.map(r => r.id), u.region) : new Map();
            let total = 0, currency = null;
            const rows = looked.map(r => {
                const sum = summarize(prices.get(r.id), { majorOnly: u.stores === "major" });
                currency ??= sum.currency;
                const price = sum.best?.price ?? sum.steam ?? null;
                if (price !== null) total += sum.msrp && sum.msrp > price ? sum.msrp : price;
                return { title: r.title, msrp: sum.msrp, price };
            });
            const nowTotal = rows.reduce((a, r) => a + (r.price ?? 0), 0);
            return { currency: currency ?? "USD", fullPrice: Math.round(total * 100) / 100, cheapestNow: Math.round(nowTotal * 100) / 100, matched: rows.length, unmatched: titles.length - rows.length };
        },

        // One page per game: prices, a year of history with the buy-now-or-wait verdict, bundles, free offers and server interest.
        "GET /api/game": async (req, _b, url) => {
            const s = session(req);
            const id = String(url.searchParams.get("id") ?? "");
            if (!/^[0-9a-f-]{20,40}$/i.test(id)) throw new HttpError(400, "That is not a game id.");
            cooldown(s.userId, "gamepage");
            const u = userRow(s);
            const info = await itad.getTitle(id);
            if (!info) throw new HttpError(404, "That game was not found.");
            const [prices, history, bundles, giveaways] = await Promise.all([
                itad.getPrices([id], u.region).catch(() => new Map()),
                itad.getHistory(id, u.region).catch(() => []),
                itad.getBundles([id], u.region).catch(() => new Map()),
                itad.getGiveaways().catch(() => new Map())
            ]);
            const sum = summarize(prices.get(id), { majorOnly: u.stores === "major" });
            const cur = sum.currency || "USD";
            const fmt = n => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(n); } catch { return String(n); } };
            const nowPrice = sum.best?.price ?? null;
            const step = Math.max(1, Math.ceil(history.length / MAX_HISTORY_POINTS));
            const watchers = u.guild_id ? db.sharedWatchedItems(u.guild_id).find(w => w.itad_id === id)?.watchers ?? 0 : 0;
            return {
                id, title: info.title, appid: info.appid ?? null, release: info.release ?? null, currency: cur,
                price: nowPrice, shop: sum.best?.shop ?? null, url: /^https:\/\//i.test(sum.best?.url ?? "") ? sum.best.url : null,
                steam: sum.steam, msrp: sum.msrp, atl: sum.atl, low1y: sum.low1y, low3m: sum.low3m,
                points: history.filter((_, i) => i % step === 0 || i === history.length - 1).map(p => ({ t: p.t, price: p.price })),
                advice: nowPrice !== null ? buyOrWait(history, nowPrice, { sales: upcomingSales(Date.now()), past: salesBefore(), money: fmt }) : null,
                bundles: (bundles.get(id) ?? []).slice(0, 5).map(b => ({ title: b.title, shop: b.shop, price: b.price, currency: b.currency, expiry: b.expiry, url: /^https:\/\//i.test(b.url ?? "") ? b.url : null })),
                free: (giveaways.get(id) ?? []).slice(0, 3).map(g => ({ title: g.title, shop: g.shop, expiry: g.expiry, url: /^https:\/\//i.test(g.url ?? "") ? g.url : null })),
                onWishlist: db.listItems(s.userId).some(g => g.itad_id === id), inLibrary: db.listLibrary(s.userId).some(g => g.itad_id === id),
                watchers
            };
        },

        "GET /api/friends": async (req) => { const s = session(req); userRow(s); return { friends: friendRows(db, s.userId) }; },
        "POST /api/friends/add": async (req, body) => { const s = session(req); userRow(s); return saveFriend(db, s.userId, { name: body.name, birthday: body.birthday, page: body.page }); },
        "POST /api/friends/remove": async (req, body) => { const s = session(req); if (!db.removeFriend(s.userId, String(body.name ?? ""))) throw new HttpError(404, "No friend by that name."); return { removed: true }; },
        "GET /api/friends/deals": async (req, _b, url) => {
            const s = session(req);
            const f = db.getFriend(s.userId, String(url.searchParams.get("name") ?? ""));
            if (!f) throw new HttpError(404, "No friend by that name.");
            if (!f.slug) throw new HttpError(400, "Add their public page name first.");
            cooldown(s.userId, "deals");
            const deals = await friendDeals(db, itad, f.slug, 10);
            if (!deals) throw new HttpError(404, "That page is not public, or does not exist.");
            return { name: f.name, deals };
        },

        "GET /api/library/spend": async (req) => { const s = session(req); const u = userRow(s); return spendSummary(db.listLibrary(s.userId), { currency: regionCurrency(u.region) }); },
        // Everything the shareable profile card shows, from stored data only (no price lookups), plus the choices saved for it.
        "GET /api/profile/card": async (req) => {
            const s = session(req); userRow(s);
            return { ...profileCardData(db, s.userId, s.username), prefs: viewPrefs(db.getCardPrefs(s.userId)), platforms: PLATFORMS.map(([id, label]) => ({ id, label })) };
        },
        // Save what the card shows: gaming names, colour, picture links, which stats. Only the keys sent are changed.
        "POST /api/profile/card-settings": async (req, body) => {
            const s = session(req); userRow(s);
            const prefs = mergePrefs(db.getCardPrefs(s.userId), body ?? {});
            db.setCardPrefs(s.userId, prefs);
            return { prefs: viewPrefs(prefs) };
        },
        "GET /api/library/bundles": async (req) => { const s = session(req); return await bundleView(db, itad, userRow(s)); },
        "POST /api/library/bundle": async (req, body) => {
            const s = session(req);
            cooldown(s.userId, "lib");
            userRow(s);
            try { return await addBundle(db, itad, s.userId, { name: body.name, paid: Number(body.paid), titles: body.titles }); }
            catch (e) { if (e instanceof UserError) throw new HttpError(400, e.message); throw e; }
        },
        "POST /api/library/bundle/remove": async (req, body) => {
            const s = session(req);
            if (!db.removeBundle(s.userId, Number(body.id))) throw new HttpError(404, "That bundle is not in your tracker.");
            return { ok: true };
        },
        "GET /api/library/badges": async (req) => { const s = session(req); userRow(s); return trophyCase(db, s.userId); },
        "GET /api/library/challenge": async (req) => { const s = session(req); return challengeView(db, s.userId); },
        "POST /api/library/challenge": async (req, body) => {
            const s = session(req);
            const goal = Number(body.goal);
            if (!Number.isInteger(goal) || goal < 0 || goal > MAX_GOAL) throw new HttpError(400, `Pick a goal from 0 to ${MAX_GOAL}.`);
            userRow(s);
            db.setChallenge(s.userId, monthKey(Date.now()), goal);
            return challengeView(db, s.userId);
        },

        "POST /api/library/status": async (req, body) => {
            const s = session(req);
            const lib = db.listLibrary(s.userId);
            if (Array.isArray(body.itad_ids)) {
                // Many games at once (the Library page's selection). Unknown ids are ignored.
                const mine = new Set(lib.map(i => i.itad_id));
                const ids = [...new Set(body.itad_ids.map(String))].filter(id => mine.has(id)).slice(0, 1500);
                if (!ids.length) throw new HttpError(400, "Select some games first.");
                let updated = 0;
                for (const id of ids) {
                    if (!db.setLibraryStatus(s.userId, id, String(body.status))) throw new HttpError(400, "Pick backlog, playing, played, finished or dropped.");
                    updated++;
                }
                return { updated, status: body.status };
            }
            const item = lib.find(i => i.itad_id === body.itad_id);
            if (!item) throw new HttpError(404, "That game is not in your library.");
            if (!db.setLibraryStatus(s.userId, item.itad_id, String(body.status))) throw new HttpError(400, "Pick backlog, playing, played, finished or dropped.");
            return { title: item.title, status: body.status };
        },

        "GET /api/grabber": async (req) => {
            const s = session(req);
            userRow(s);
            return { link: db.getGrabberLink(s.userId) };
        },

        // Makes (or replaces) the link code the FanaticalGrabber extension uses. The code is returned once and never stored readable.
        "POST /api/grabber/token": async (req, body) => {
            const s = session(req);
            cooldown(s.userId, "grabbertoken");
            userRow(s);
            if (body.action === "off") return { ok: true, removed: db.revokeGrabberToken(s.userId) };
            return { token: db.createGrabberToken(s.userId) };
        },

        "GET /api/steam": async (req) => {
            const s = session(req);
            const u = userRow(s);
            const link = db.getSteamLink(s.userId);
            if (!link) return { link: null };
            const view = await libraryView(db, itad, u, { snapshot: false });
            return { link, currency: view.currency, stats: playStats(view.rows.filter(r => r.appid)), card: await profileCard(link.steamid) };
        },

        // Look at anyone's PUBLIC Steam profile without linking or storing anything: their card and play stats.
        "GET /api/steam/lookup": async (req, _b, url) => {
            const s = session(req);
            userRow(s);
            const undo = cooldown(s.userId, "steamlookup");
            try {
                const steamid = await resolveProfile(String(url.searchParams.get("profile") ?? ""), steamFetch);
                const [card, games] = await Promise.all([profileCard(steamid), fetchOwnedGames(steamid, { apiKey: config.steamApiKey ?? null, fetchImpl: steamFetch })]);
                const played = games.filter(g => g.minutes > 0), barely = games.filter(g => g.minutes < 60);
                return { card: card ?? { steamid, name: "Steam user " + steamid, avatar: null, url: `https://steamcommunity.com/profiles/${steamid}` }, mine: db.getSteamLink(s.userId)?.steamid === steamid,
                    stats: { games: games.length, playedGames: played.length, totalMinutes: games.reduce((t, g) => t + g.minutes, 0), barely: barely.length,
                        mostPlayed: [...played].sort((a, b) => b.minutes - a.minutes).slice(0, 8).map(g => ({ appid: g.appid, title: g.name || "App " + g.appid, minutes: g.minutes })) } };
            } catch (err) { undo(); throw err; }
        },

        // What to play next from the Steam library. `skip` (comma-separated ids already offered) makes "pick another" fresh.
        // Library analytics: tiles, hours by genre, played vs backlog, most played. Genre tags are fetched a few at a time, so
        // `pending` says how many games are still waiting; the page asks again until it is 0.
        // Discord Linked Roles: show Steam on your Discord profile. The same as /steam verify.
        "GET /api/steam/linkedroles": async (req) => {
            const s = session(req); userRow(s);
            const p = connectionPayload(db, s.userId);
            return { available: Boolean(config.clientId), verified: Boolean(p?.metadata.steam_verified), preview: p ? { name: p.platform_username, ...p.metadata } : null, url: "/auth/linked" };
        },
        "GET /api/steam/analytics": async (req) => {
            const s = session(req);
            const u = userRow(s);
            if (!db.getSteamLink(s.userId)) throw new HttpError(400, "Sign in through Steam first.");
            cooldown(s.userId, "analytics");
            const need = db.appsNeedingTags(s.userId, 25);
            if (need.length) await refreshTags({ db, appids: need, fetchImpl: steamFetch ?? globalThis.fetch, delayMs: 150 });
            const w = await libraryView(db, itad, u, { snapshot: false });
            return { ...libraryAnalytics(db, s.userId, w.rows), currency: w.currency ?? "USD", pending: db.appsNeedingTags(s.userId, 500).length };
        },

        // Deals picked for you: discounts ranked by taste and wishlist. `pending` = games still waiting for genres; the page asks again.
        "GET /api/foryou": async (req) => {
            const s = session(req);
            const u = userRow(s);
            cooldown(s.userId, "foryou");
            return await forYou({ db, itad, userId: s.userId, user: u, fetchImpl: steamFetch ?? globalThis.fetch });
        },

        "GET /api/steam/taste": async (req) => {
            const s = session(req);
            const u = userRow(s);
            if (!db.getSteamLink(s.userId)) throw new HttpError(400, "Link your Steam profile first.");
            cooldown(s.userId, "taste");
            const need = db.appsNeedingTags(s.userId, 10);
            if (need.length) await refreshTags({ db, appids: need, fetchImpl: steamFetch ?? globalThis.fetch, delayMs: 300 });
            const profile = tasteProfile(db, s.userId);
            let picks = [], currency = "USD";
            try { const w = await viewRows(db, itad, u); currency = w.currency ?? "USD"; picks = recommend(db, s.userId, w.rows, profile).map(p => ({ ...p, why: tasteWhy(p) })); } catch { /* optional */ }
            return { ...profile, picks, currency };
        },

        "GET /api/steam/recap": async (req, _body, url) => {
            const s = session(req);
            if (!db.getSteamLink(s.userId)) throw new HttpError(400, "Link your Steam profile first.");
            const year = Number(url.searchParams.get("year")) || new Date().getUTCFullYear();
            if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new HttpError(400, "Pick a year from 2020 on.");
            const all = db.playRecapAll(s.userId);
            const goalHours = db.getHourGoal(s.userId), thisYear = year === new Date(now()).getUTCFullYear();
            const rec = db.playRecap(s.userId, year);
            return { ...rec, goal: goalHours && thisYear ? goalProgress(goalHours, rec.totalMinutes, now()) : null, allTime: { totalMinutes: all.totalMinutes, games: all.games, activeDays: all.activeDays }, since: db.getSteamLink(s.userId).linked_at };
        },

        "POST /api/steam/goal": async (req, body) => {
            const s = session(req);
            if (!db.getSteamLink(s.userId)) throw new HttpError(400, "Link your Steam profile first.");
            const hours = Number(body.hours);
            if (!Number.isInteger(hours) || hours < 0 || hours > 5000) throw new HttpError(400, "Pick a whole number of hours from 1 to 5000 (0 clears it).");
            db.setHourGoal(s.userId, hours);
            return { ok: true };
        },

        "GET /api/steam/next": async (req, _body, url) => {
            const s = session(req);
            const u = userRow(s);
            if (!db.getSteamLink(s.userId)) throw new HttpError(400, "Link your Steam profile first.");
            const skip = String(url.searchParams.get("skip") ?? "").split(",").filter(x => /^[\w-]{1,64}$/.test(x)).slice(0, 200);
            const view = await libraryView(db, itad, u, { snapshot: false });
            return { next: steamNext(view.rows, { skip }), currency: view.currency };
        },

        "POST /api/steam/link": async (req, body) => {
            const s = session(req);
            const undo = cooldown(s.userId, "steam");
            userRow(s);
            try {
                const steamid = String(body.profile ?? "").trim() ? await resolveProfile(String(body.profile), steamFetch) : db.getSteamLink(s.userId)?.steamid ?? (() => { throw new HttpError(400, "Sign in through Steam first."); })();
                return await syncSteamLibrary({ db, itad, userId: s.userId, steamid, apiKey: config.steamApiKey ?? null, fetchImpl: steamFetch });
            } catch (err) { undo(); throw err; }
        },

        "POST /api/steam/sync": async (req) => {
            const s = session(req);
            const undo = cooldown(s.userId, "steam");
            userRow(s);
            const link = db.getSteamLink(s.userId);
            if (!link) { undo(); throw new HttpError(400, "Link your Steam profile first."); }
            try { return await syncSteamLibrary({ db, itad, userId: s.userId, steamid: link.steamid, apiKey: config.steamApiKey ?? null, fetchImpl: steamFetch }); }
            catch (err) { undo(); throw err; }
        },

        "POST /api/steam/unlink": async (req, body) => {
            const s = session(req);
            userRow(s);
            if (!db.removeSteamLink(s.userId)) throw new HttpError(400, "No Steam profile is linked.");
            let removed = 0;
            if (body.removeGames === true) for (const g of db.listLibrary(s.userId).filter(g => g.appid)) if (db.removeLibrary(s.userId, g.itad_id)) removed++;
            return { ok: true, removed };
        },

        "GET /api/library/next": async (req, _body, url) => {
            const s = session(req);
            const skip = String(url.searchParams.get("skip") ?? "").split(",").filter(x => /^[\w-]{1,64}$/.test(x)).slice(0, 500);
            const view = await libraryView(db, itad, userRow(s), { snapshot: false });
            const n = playNext(view.rows, { skip });
            return { next: n ? { pick: n.pick, others: n.others, why: n.why, remaining: n.remaining } : null, totals: view.totals, currency: view.currency };
        },

        "POST /api/library/remove": async (req, body) => {
            const s = session(req);
            const item = db.listLibrary(s.userId).find(i => i.itad_id === body.itad_id);
            if (!item) throw new HttpError(404, "That game is not in your library.");
            db.removeLibrary(s.userId, item.itad_id);
            return { removed: item.title };
        },

        // ----- shared server list, leaderboard, group alerts -----
        "GET /api/servers/list": async (req, _b, url) => {
            const s = session(req);
            const g = guildFor(s, url.searchParams.get("guild"));
            const u = userRow(s);
            return { ...(await serverListView(db, itad, g.id, u)), manager: isManager(g) };
        },

        "POST /api/servers/list/add": async (req, body) => {
            const s = session(req);
            const g = guildFor(s, body.guild_id);
            cooldown(s.userId, "add");
            userRow(s);
            return await addToServerList(db, itad, g.id, s.userId, body.title);
        },

        "POST /api/servers/list/vote": async (req, body) => {
            const s = session(req);
            const g = guildFor(s, body.guild_id);
            const game = db.listServerGames(g.id, s.userId).find(x => x.itad_id === body.itad_id);
            if (!game) throw new HttpError(404, "That game is not on the server list.");
            const voted = db.toggleVote(game.id, s.userId);
            return { voted, votes: game.votes + (voted ? 1 : -1) };
        },

        "POST /api/servers/list/remove": async (req, body) => {
            const s = session(req);
            const g = guildFor(s, body.guild_id);
            const game = db.listServerGames(g.id, s.userId).find(x => x.itad_id === body.itad_id);
            if (!game) throw new HttpError(404, "That game is not on the server list.");
            return removeFromServerList(db, g.id, s.userId, game.title, isManager(g));
        },

        "GET /api/servers/leaderboard": async (req, _b, url) => {
            const s = session(req);
            const g = guildFor(s, url.searchParams.get("guild"));
            const which = url.searchParams.get("board");
            const finished = which === "finished";
            const entries = finished ? finishedLeague(db, g.id, now()) : EXTRA_BOARDS[which] ? extraBoard(db, g.id, which, now()) : leaderboard(db, g.id);
            const t = now();
            const out = [];
            for (const e of entries) {
                const key = `${g.id}:${e.discord_id}`;
                let hit = names.get(key);
                if (!hit || hit.until < t) {
                    hit = { name: await rest.memberName(g.id, e.discord_id).catch(() => null), until: t + 10 * 60_000 };
                    names.set(key, hit);
                    if (names.size > 2000) names.delete(names.keys().next().value);
                }
                out.push({ name: hit.name ?? "A member", savedPct: e.savedPct, games: e.games, done: e.done, label: e.label, you: e.discord_id === s.userId });
            }
            return { entries: out, joined: Boolean(userRow(s).share) };
        },

        "POST /api/servers/group": async (req, body) => {
            const s = session(req);
            const g = guildFor(s, body.guild_id);
            if (!isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            if (!db.getGuild(g.id)) throw new HttpError(400, "Set an alert channel for that server first.");
            const n = Number(body.minimum);
            if (!Number.isInteger(n) || n < 0 || n === 1 || n > 20) throw new HttpError(400, "Use 2 to 20, or 0 to turn it off.");
            db.setGroupMin(g.id, n);
            return { groupMin: n };
        },

        "POST /api/servers/hot": async (req, body) => {
            const s = session(req);
            const g = guildFor(s, body.guild_id);
            if (!isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            if (!db.getGuild(g.id)) throw new HttpError(400, "Set an alert channel for that server first.");
            const n = Math.round(Number(body.minimum));
            if (!Number.isFinite(n) || n < 0 || n > 95 || (n !== 0 && n < 30)) throw new HttpError(400, "Pick 30 to 95, or 0 to turn it off.");
            db.setHotMin(g.id, n);
            return { hotMin: n };
        },
        "POST /api/servers/sales": async (req, body) => {
            const s = session(req);
            const g = guildFor(s, body.guild_id);
            if (!isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            if (!db.getGuild(g.id)) throw new HttpError(400, "Set an alert channel for that server first.");
            db.setSaleFeed(g.id, Boolean(body.enabled));
            return { saleFeed: Boolean(body.enabled) };
        },
        "POST /api/servers/feed": async (req, body) => {
            const s = session(req);
            const g = guildFor(s, body.guild_id);
            if (!isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            if (!db.getGuild(g.id)) throw new HttpError(400, "Set an alert channel for that server first.");
            db.setFreeFeed(g.id, Boolean(body.enabled));
            return { freeFeed: Boolean(body.enabled) };
        },

        "POST /api/servers/digest": async (req, body) => {
            const s = session(req);
            const g = guildFor(s, body.guild_id);
            if (!isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            if (!db.getGuild(g.id)) throw new HttpError(400, "Set an alert channel for that server first.");
            db.setWeeklyDigest(g.id, Boolean(body.enabled));
            return { weeklyDigest: Boolean(body.enabled) };
        },

        // The same checklist as /setup in Discord.
        "GET /api/servers/setup": async (req, _b, url) => {
            const s = session(req);
            const g = managerGuild(s, url.searchParams.get("guild"));
            return { ...setupStatus(db, g.id), gameNightOn: db.gameNightOn(g.id), staffRole: db.getTicketSettings(g.id).staff_role_id, bot: botGuilds ? Boolean(botGuilds(g.id)) : null };
        },

        "POST /api/servers/gamenight": async (req, body) => {
            const g = managerGuild(session(req), String(body.guild_id));
            db.setGameNight(g.id, Boolean(body.enabled));
            return { gameNight: Boolean(body.enabled) };
        },
        // Game night on the dashboard: pick opted-in members of a server and see what they can play and buy together.
        "GET /api/gamenight/members": async (req, _b, url) => {
            const s = session(req); const g = guildFor(s, url.searchParams.get("guild"));
            const ids = db.sharingMembers(g.id).slice(0, 60);
            return { members: await Promise.all(ids.map(async id => ({ id, name: (await rest.memberName(g.id, id)) || "Member " + id.slice(-4) }))) };
        },
        "GET /api/compare": async (req, _b, url) => {
            // Same rules as /compare: a friend in one of your servers who turned on sharing (/alerts share).
            const s = session(req);
            const g = guildFor(s, String(url.searchParams.get("guild") ?? ""));
            const them = String(url.searchParams.get("user") ?? "");
            if (them === s.userId) throw new HttpError(400, "Pick someone else.");
            if (!db.sharingMembers(g.id).includes(them)) throw new HttpError(403, "That member has not opted in with /alerts share.");
            const r = compareLibraries(db, s.userId, them);
            const name = (await rest.memberName(g.id, them).catch(() => null)) || "Member " + them.slice(-4);
            return { name, ...r, shared: r.shared.slice(0, 300), onlyA: r.onlyA.slice(0, 300), onlyB: r.onlyB.slice(0, 300) };
        },
        "GET /api/lfg": async (req, _b, url) => {
            const s = session(req);
            const g = guildFor(s, String(url.searchParams.get("guild") ?? ""));
            const posts = db.listOpenLfg(g.id);
            const ids = [...new Set(posts.flatMap(p => [p.creator_id, ...db.lfgMembers(p.id)]))].slice(0, 40);
            const names = Object.fromEntries(await Promise.all(ids.map(async id => [id, (await rest.memberName(g.id, id).catch(() => null)) || "Member " + id.slice(-4)])));
            return { me: s.userId, manageable: isManager(g), posts: posts.map(p => {
                const members = db.lfgMembers(p.id);
                return { id: p.id, game: p.game, starts_at: p.starts_at, slots: p.slots, note: p.note, host: names[p.creator_id] ?? p.creator_id, members: members.map(m => names[m] ?? "Member " + m.slice(-4)),
                    joined: members.includes(s.userId), canClose: p.creator_id === s.userId || isManager(g), url: p.message_id ? `https://discord.com/channels/${p.guild_id}/${p.channel_id}/${p.message_id}` : null };
            }) };
        },

        "POST /api/lfg": async (req, body) => {
            const s = session(req);
            if (!lfg) throw new HttpError(503, "Looking for group is not available.");
            const g = managerGuild(s, String(body.guild_id));
            let channels;
            try { channels = await rest.listChannels(g.id); } catch { throw new HttpError(400, "The bot is not in that server yet. Invite it first."); }
            const channelId = String(body.channel_id ?? "");
            if (!channels.some(c => c.id === channelId)) throw new HttpError(400, "Pick one of the server's text channels.");
            const startsAt = Number(body.starts_at);
            const { post, eventError } = await lfg.create({ guildId: g.id, channelId, creatorId: s.userId, game: body.game, startsAt, slots: body.slots, note: body.note, event: body.event === true });
            return { id: post.id, eventError };
        },

        "POST /api/lfg/join": async (req, body) => {
            const s = session(req);
            if (!lfg) throw new HttpError(503, "Looking for group is not available.");
            const g = guildFor(s, String(body.guild_id));
            const p = db.getLfg(Number(body.id));
            if (!p || p.guild_id !== g.id) throw new HttpError(404, "I can't find that post.");
            return { result: (await lfg.join(p.id, s.userId)).result };
        },

        "POST /api/lfg/leave": async (req, body) => {
            const s = session(req);
            if (!lfg) throw new HttpError(503, "Looking for group is not available.");
            const g = guildFor(s, String(body.guild_id));
            const p = db.getLfg(Number(body.id));
            if (!p || p.guild_id !== g.id) throw new HttpError(404, "I can't find that post.");
            await lfg.leave(p.id, s.userId);
            return { ok: true };
        },

        "POST /api/lfg/close": async (req, body) => {
            const s = session(req);
            if (!lfg) throw new HttpError(503, "Looking for group is not available.");
            const g = guildFor(s, String(body.guild_id));
            const p = db.getLfg(Number(body.id));
            if (!p || p.guild_id !== g.id) throw new HttpError(404, "I can't find that post.");
            await lfg.close(p.id, s.userId, { canManage: isManager(g) });
            return { ok: true };
        },

        "POST /api/gamenight": async (req, body) => {
            const s = session(req); const g = guildFor(s, String(body.guild_id));
            const allowed = new Set(db.sharingMembers(g.id));
            const ids = (Array.isArray(body.user_ids) ? body.user_ids : []).map(String).filter(id => allowed.has(id));
            const r = await gameNight({ db, itad, userIds: ids, region: userRow(s).region }).catch(e => { if (e.constructor?.name === "UserError") throw new HttpError(400, e.message); throw e; });
            const names = Object.fromEntries(await Promise.all(r.people.map(async id => [id, (await rest.memberName(g.id, id)) || "Member " + id.slice(-4)])));
            const n = id => names[id] ?? id;
            return { people: r.people.map(n), hidden: r.hidden, allOwn: r.allOwn.map(x => x.title), almost: r.almost.map(x => ({ title: x.title, missing: x.missing.map(n) })),
                buy: r.buy.map(b => ({ title: b.title, wanters: b.wanters.map(n), price: b.now?.price ?? null, currency: b.now?.currency ?? "USD", shop: b.now?.shop ?? null, discount: b.now?.discount ?? 0 })) };
        },

        "POST /api/servers/setup/auto": async (req, body) => {
            const s = session(req);
            const g = managerGuild(s, String(body.guild_id));
            if (botGuilds && !botGuilds(g.id)) throw new HttpError(400, "The bot is not in that server yet. Invite it first.");
            const roles = body.staff_role_id ? await rest.listRoles(g.id).catch(() => []) : [];
            const staffRoleId = body.staff_role_id && roles.some(r => r.id === body.staff_role_id) ? body.staff_role_id : null;
            try { return { ...(await autoSetup({ api: rest, db, guildId: g.id, botId: config.clientId, userId: s.userId, staffRoleId })), status: setupStatus(db, g.id) }; }
            catch (e) { if (e.userFacing) throw new HttpError(400, e.message); if (e instanceof DiscordApiError && e.status === 403) throw new HttpError(400, "I need the Manage Channels permission to create channels."); throw e; }
        },

        // ---- community: welcome, XP and levels, invites and referrals, emoji, one-click server build ----
        "GET /api/community": async (req, _b, url) => {
            const s = session(req); const g = guildFor(s, url.searchParams.get("guild"));
            return comm(async () => ({ bot: botGuilds ? Boolean(botGuilds(g.id)) : null, ...(await cd.overview(g.id, s.userId, isManager(g))) }));
        },
        "GET /api/community/rank": async (req, _b, url) => {
            const s = session(req); const g = guildFor(s, url.searchParams.get("guild"));
            return comm(async () => { const o = await cd.overview(g.id, s.userId, false); return o.me; });
        },
        "GET /api/community/leaderboard": async (req, _b, url) => {
            const s = session(req); const g = guildFor(s, url.searchParams.get("guild"));
            return comm(async () => ({ top: (await cd.overview(g.id, s.userId, false)).xpTop }));
        },
        "GET /api/community/invites": async (req, _b, url) => {
            const s = session(req); const g = guildFor(s, url.searchParams.get("guild"));
            return comm(async () => { const o = await cd.overview(g.id, s.userId, false); return { me: o.me.invites, top: o.inviteTop, rewards: o.rewards }; });
        },
        "POST /api/community/invite-link": async (req, body) => {
            const s = session(req); const g = guildFor(s, String(body.guild_id)); botIn(g);
            cooldown(s.userId, "clink");
            return comm(() => cd.inviteLink(g.id, s.userId));
        },
        "POST /api/community/setup": async (req, body) => {
            const s = session(req); const g = managerGuild(s, String(body.guild_id)); botIn(g);
            cooldown(s.userId, "csetup");
            return comm(() => cd.setup(g.id, s.userId));
        },
        "POST /api/community/verify": async (req, body) => {
            const s = session(req); const g = guildFor(s, String(body.guild_id)); botIn(g);
            return comm(() => cd.verify(g.id, s.userId));
        },
        "POST /api/community/verifyrole": async (req, body) => comm(() => cd.verifyRole(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/welcome": async (req, body) => comm(() => cd.welcome(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/support": async (req, body) => comm(() => cd.support(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/places": async (req, body) => comm(() => cd.places(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/rules": async (req, body) => comm(() => cd.rules(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/announce": async (req, body) => {
            const s = session(req), g = managerGuild(s, String(body.guild_id));
            const undo = cooldown(s.userId, "announce");
            try { return await comm(() => cd.announce(g.id, body, s.userId)); } catch (e) { undo(); throw e; }
        },
        "POST /api/community/leaderboard": async (req, body) => {
            const s = session(req), g = managerGuild(s, String(body.guild_id));
            const undo = body.refresh ? cooldown(s.userId, "lbrefresh") : () => {};
            try { return await comm(() => cd.leaderboard(g.id, body)); } catch (e) { undo(); throw e; }
        },
        "POST /api/community/pings": async (req, body) => comm(() => cd.pings(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/autorole": async (req, body) => comm(() => cd.autorole(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/xp": async (req, body) => comm(() => cd.xp(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/levelrole": async (req, body) => comm(() => cd.levelrole(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/referral": async (req, body) => comm(() => cd.referral(managerGuild(session(req), String(body.guild_id)).id, body)),
        "GET /api/community/emoji": async (req, _b, url) => comm(() => cd.emojiList(managerGuild(session(req), url.searchParams.get("guild")).id)),
        "GET /api/community/xp": async (req, _b, url) => {
            const s = session(req); const g = guildFor(s, url.searchParams.get("guild"));
            return comm(async () => ({ bot: botGuilds ? Boolean(botGuilds(g.id)) : null, ...(await cd.xpPage(g.id, s.userId, isManager(g), url.searchParams.get("page"))) }));
        },
        "GET /api/mod": async (req, _b, url) => {
            const s = session(req); const g = modGuild(s, url.searchParams.get("guild"), "moderate"); botIn(g);
            return modr(() => md.overview(g.id, { manager: isManager(g), perms: Object.keys(MOD_PERMS).filter(k => hasGuildPerm(g, k)) }));
        },
        "GET /api/mod/cases": async (req, _b, url) => {
            const s = session(req); const g = modGuild(s, url.searchParams.get("guild"), "moderate");
            return modr(() => md.cases(g.id, url.searchParams.get("user"), url.searchParams.get("page")));
        },
        "POST /api/mod/action": async (req, body) => {
            const s = session(req); const action = String(body.action ?? "");
            if (!MOD_ACTION_PERM[action]) throw new HttpError(400, "Choose an action.");
            const g = modGuild(s, String(body.guild_id), MOD_ACTION_PERM[action]); botIn(g);
            const undo = cooldown(s.userId, "mod");
            try { return await modr(() => md.act(g.id, s.userId, action, body)); } catch (e) { undo(); throw e; }
        },
        "POST /api/mod/clearwarns": async (req, body) => {
            const s = session(req); const g = modGuild(s, String(body.guild_id), "moderate");
            return modr(() => md.clearWarns(g.id, body.user));
        },
        "POST /api/mod/log": async (req, body) => {
            const s = session(req); const g = modGuild(s, String(body.guild_id), "manageGuild"); botIn(g);
            return modr(() => md.setLog(g.id, body.channel_id));
        },
        "POST /api/community/emoji": async (req, body) => {
            const s = session(req); const g = managerGuild(s, String(body.guild_id)); botIn(g);
            const undo = cooldown(s.userId, "cemoji"); // a refused request does not use up the wait
            try {
                if (body.image_data) return await comm(() => cd.emojiUpload(g.id, body.name, body.image_data));
                return await comm(() => cd.emojiImport(g.id, String(body.text ?? "").slice(0, 5000)));
            } catch (e) { undo(); throw e; }
        },

        "GET /api/servers/stats": async (req, _b, url) => {
            const s = session(req);
            const g = guildFor(s, url.searchParams.get("guild"));
            return serverStats(db, g.id);
        },

        // ----- free games right now, grouped by platform -----
        // Live numbers for the About panel. Aggregate only, so it is open to everyone like the Help page.
        "GET /api/about": async () => {
            let freeNow = null; // a count only: shown on the home page as "N free offers live right now"
            try { freeNow = (await itad.getGiveawayList()).filter(g => /^https:\/\//i.test(g.url ?? "")).length; } catch { /* the page just leaves it out */ }
            return { about: botInfo ? botInfo() : null, creator: config.creator ?? null, freeNow };
        },

        // Public, like /about: aggregate health only, nothing about any person.
        "GET /api/status": async () => {
            if (!status) throw new HttpError(404, "Status is not available.");
            const info = botInfo ? botInfo() : null, mem = process.memoryUsage();
            return {
                ...status.snapshot(),
                telemetry: {
                    version: info?.version ?? null, node: process.version, discordjs: djsVersion, uptime: info?.uptime ?? null, pingMs: info?.pingMs ?? null,
                    heapMb: Math.round(mem.heapUsed / 1048576), rssMb: Math.round(mem.rss / 1048576), region: process.env.FLY_REGION ?? null
                },
                stats: info ? { servers: info.servers, members: info.members, gamesWatched: info.gamesWatched, alerts24h: info.alerts24h } : null
            };
        },

        "GET /api/profile": async (req) => { const s = session(req); const u = userRow(s); return { slug: u.profile_slug ?? null, public: Boolean(u.profile_public), claims: db.countGiftClaims(s.userId) }; },
        "POST /api/profile": async (req, body) => {
            const s = session(req); userRow(s);
            const r = setProfile(db, s.userId, { enabled: Boolean(body.enabled), slug: body.slug });
            const cleared = body.resetClaims ? db.clearGiftClaims(s.userId) : 0;
            return { ...r, cleared, claims: db.countGiftClaims(s.userId) };
        },
        // Public on purpose (anyone with the link), but only for members who switched their page on.
        "GET /api/public/wishlist": async (_req, _b, url) => {
            const t = url.searchParams.get("t");
            const page = await publicWishlist(db, itad, url.searchParams.get("slug"), GIFT_TOKEN.test(t ?? "") ? t : null);
            if (!page) throw new HttpError(404, "That page does not exist or is private.");
            return page;
        },
        // Anyone with the link can mark or unmark a gift. A made-up code from their browser is the only identity; the owner is never told who.
        "POST /api/public/gift": async (req, body) => {
            if (!giftLimit.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little.");
            const token = String(body.token ?? "");
            if (!GIFT_TOKEN.test(token)) throw new HttpError(400, "Bad request.");
            const owner = db.getProfileBySlug(String(body.slug ?? "").toLowerCase());
            if (!owner || !owner.profile_public) throw new HttpError(404, "That page does not exist or is private.");
            const id = String(body.id ?? "");
            if (!db.listItems(owner.discord_id).some(g => g.itad_id === id && g.source !== "watch")) throw new HttpError(404, "That game is not on this list.");
            if (body.claim === false) return { claim: db.unclaimGift(owner.discord_id, id, token) ? null : "taken" };
            const r = db.claimGift(owner.discord_id, id, token);
            if (r === "taken") throw new HttpError(409, "Someone else already said they are gifting this one.");
            if (r === "full") throw new HttpError(429, `You can claim up to ${MAX_CLAIMS_PER_VISITOR} games per list.`);
            return { claim: "mine" };
        },

        "GET /api/bundles": async (req, _b, url) => {
            const s = session(req);
            cooldown(s.userId, "deals");
            const u = userRow(s);
            const title = String(url.searchParams.get("game") ?? "").trim().slice(0, 100);
            let gameIds;
            if (title) {
                const [hit] = await itad.lookupTitles([title]);
                if (!hit?.id) throw new HttpError(400, `I could not find a game called ${title}.`);
                gameIds = [hit.id];
            } else gameIds = db.listItems(s.userId).map(i => i.itad_id);
            return await bundleCheck({ db, itad, user: u, gameIds });
        },

        "GET /api/regions": async (req, _b, url) => {
            const s = session(req);
            cooldown(s.userId, "deals");
            const u = userRow(s);
            const title = String(url.searchParams.get("game") ?? "").trim().slice(0, 100);
            if (!title) throw new HttpError(400, "Type a game title.");
            const [hit] = await itad.lookupTitles([title]);
            if (!hit?.id) throw new HttpError(400, `I could not find a game called ${title}.`);
            const rows = await regionPrices({ itad, fx, itadId: hit.id, home: u.region, majorOnly: u.stores === "major" }).catch(e => { throw new HttpError(502, e.message); });
            return { game: hit.matched || title, rows };
        },

        "GET /api/calendar": async (req, _b, url) => {
            // One list for the member: wishlist release dates, Steam sales, events and group games from their servers.
            const s = session(req);
            const days = Math.min(365, Math.max(1, Math.round(Number(url.searchParams.get("days"))) || 60));
            const t = now();
            const mine = s.guilds.filter(g => !botGuilds || botGuilds(g.id));
            const wanted = String(url.searchParams.get("guild") ?? "");
            const guildIds = (wanted ? mine.filter(g => g.id === wanted) : mine).map(g => g.id);
            const kinds = String(url.searchParams.get("kinds") ?? "").split(",").filter(k => KINDS.includes(k));
            const entries = calendarEntries(db, s.userId, { from: t - 86400_000, to: t + days * 86400_000, guildIds, kinds: kinds.length ? kinds : KINDS });
            const names = Object.fromEntries(mine.map(g => [g.id, g.name]));
            const feed = db.getCalFeed(s.userId);
            return { now: t, servers: mine.map(g => ({ id: g.id, name: g.name, manageable: isManager(g) })),
                entries: entries.map(e => ({ ...e, server: e.guild_id ? names[e.guild_id] ?? null : null, canRemove: e.kind === "event" && isManager(mine.find(g => g.id === e.guild_id) ?? {}) })),
                feed: feed ? { created_at: feed.created_at, used_at: feed.used_at } : null };
        },

        "POST /api/calendar/events": async (req, body) => {
            const s = session(req);
            if (!calendar) throw new HttpError(503, "The calendar is not available.");
            const g = managerGuild(s, String(body.guild_id));
            let channelId = null;
            if (body.channel_id) {
                let channels;
                try { channels = await rest.listChannels(g.id); } catch { throw new HttpError(400, "The bot is not in that server yet. Invite it first."); }
                channelId = String(body.channel_id);
                if (!channels.some(c => c.id === channelId)) throw new HttpError(400, "Pick one of the server's text channels.");
            }
            const r = await calendar.create({ guildId: g.id, creatorId: s.userId, title: body.title, notes: body.notes, startsAt: Number(body.starts_at), channelId, remindMin: body.remind_min === undefined ? 60 : Number(body.remind_min) });
            return r;
        },

        "POST /api/calendar/events/delete": async (req, body) => {
            const s = session(req);
            if (!calendar) throw new HttpError(503, "The calendar is not available.");
            const g = managerGuild(s, String(body.guild_id));
            if (!calendar.remove(Number(body.id), g.id)) throw new HttpError(404, "I can't find that event.");
            return { ok: true };
        },

        "POST /api/calendar/feed": async (req, body) => {
            // An optional private link for Google, Apple or Outlook calendar. The link is shown once; only its hash is kept.
            const s = session(req);
            if (body.action === "off") return { off: db.revokeCalFeed(s.userId) };
            cooldown(s.userId, "grabbertoken");
            const mine = s.guilds.filter(g => !botGuilds || botGuilds(g.id)).map(g => g.id);
            const token = db.createCalFeed(s.userId, mine.slice(0, 20));
            return { url: `${origin}/calendar/feed/${token}.ics` };
        },

        "GET /api/saleprep": async (req, _b, url) => {
            const s = session(req);
            cooldown(s.userId, "deals");
            const budget = Number(url.searchParams.get("budget"));
            return await salePrep({ db, itad, user: userRow(s), budget: Number.isFinite(budget) && budget > 0 && budget <= 10_000 ? budget : null });
        },

        "GET /api/saleprep/recap": async (req, _b, url) => {
            const s = session(req);
            const days = Math.min(90, Math.max(1, Math.round(Number(url.searchParams.get("days"))) || 14));
            return saleRecap(db, s.userId, { days });
        },

        "GET /api/sales": async (req) => { session(req); return { sales: upcomingSales(Date.now(), { limit: 8 }), updated: SALES_UPDATED }; },

        "GET /api/free": async (req) => {
            const s = session(req);
            const showDlc = db.getUser(s.userId)?.free_dlc !== 0;
            const groups = new Map();
            for (const g of withOwnership(await enrichFree(await itad.getGiveawayList()), db, s.userId)) {
                if (!/^https:\/\//i.test(g.url ?? "")) continue;
                const dlc = isDlc(g);
                if (dlc && !showDlc) continue;
                if (!groups.has(g.shop)) groups.set(g.shop, []);
                groups.get(g.shop).push({ id: g.id, title: g.title, url: g.url, expiry: g.expiry, dlc, art: freeArt(g) ?? null, base: dlc && g.base ? g.base.name : null, baseOwned: dlc && g.base ? g.baseOwned ?? null : null });
            }
            return { showDlc, platforms: [...groups].map(([shop, games]) => ({ shop, games })) };
        },

        // ----- giveaways (server managers) -----
        "GET /api/giveaways": async (req, _b, url) => {
            const s = session(req);
            const g = managerGuild(s, url.searchParams.get("guild"));
            const rows = db.listGiveaways(g.id, { limit: 50 }).map(x => {
                const keys = db.listKeys(x.id);
                return { id: x.id, title: x.title, status: x.status, starts_at: x.starts_at, ends_at: x.ends_at, channel_id: x.channel_id, entries: db.countEntries(x.id), prizes: keys.length, redeemed: keys.filter(k => k.status === "confirmed").length };
            });
            return { giveaways: rows, settings: db.getGiveawaySettings(g.id), max: MAX_KEYS };
        },

        "GET /api/giveaways/templates": async (req, _b, url) => {
            const s = session(req); needGiveaways();
            const g = managerGuild(s, url.searchParams.get("guild"));
            return { templates: db.listTemplates(g.id) };
        },
        "POST /api/giveaways/templates": async (req, body) => {
            const s = session(req); needGiveaways();
            const g = managerGuild(s, String(body.guild_id));
            if (body.remove) { db.removeTemplate(g.id, Number(body.remove)); return { templates: db.listTemplates(g.id) }; }
            const name = String(body.name ?? "").trim().slice(0, 40);
            if (!name) throw new HttpError(400, "Give the template a name.");
            if (db.listTemplates(g.id).length >= 25 && !db.listTemplates(g.id).some(t => t.name === name)) throw new HttpError(400, "You can keep up to 25 templates.");
            // Only plain form values are kept: strings, numbers and booleans, never anything that looks like a prize list.
            const data = {};
            for (const [k, v] of Object.entries(body.data ?? {}).slice(0, 40)) if (/^[a-zA-Z]{1,24}$/.test(k) && k !== "keys" && ["string", "number", "boolean"].includes(typeof v)) data[k] = typeof v === "string" ? v.slice(0, 1500) : v;
            db.saveTemplate(g.id, name, data);
            return { templates: db.listTemplates(g.id) };
        },
        // The signed-in member's own prizes: where each one stands and when to claim it. Keys are never included.
        "GET /api/claims": async (req) => {
            const s = session(req); userRow(s);
            return { prizes: db.prizesFor(s.userId).map(p => ({ ...p, link: p.message_id ? `https://discord.com/channels/${p.guild_id}/${p.channel_id}/${p.message_id}` : null })) };
        },

        "GET /api/giveaways/art": async (req, _b, url) => {
            session(req);
            const q = (url.searchParams.get("game") ?? "").trim().slice(0, 100);
            if (!q) return { image: null };
            const art = await autoImage(itad, q);
            return { image: art?.image ?? null };
        },

        "GET /api/giveaways/info": async (req, _b, url) => {
            const s = session(req);
            const g = managerGuild(s, url.searchParams.get("guild"));
            const x = giveawayOf(g, url.searchParams.get("id"));
            // names only, never key values
            return { id: x.id, title: x.title, status: x.status, entries: db.countEntries(x.id), keys: db.listKeys(x.id).map(k => ({ position: k.position, label: k.label, status: k.status, winner_id: k.winner_id })) };
        },

        "POST /api/giveaways/create": async (req, body) => {
            const s = session(req);
            const g = managerGuild(s, body.guild_id);
            needGiveaways();
            const undo = cooldown(s.userId, "add");
            try {
            const channels = await rest.listChannels(g.id).catch(err => {
                if (err instanceof DiscordApiError && [403, 404].includes(err.status)) throw new HttpError(400, "The bot is not in that server yet. Invite it first.");
                throw err;
            });
            if (!channels.some(c => c.id === body.channel_id)) throw new HttpError(400, "Pick a text channel from the list.");
            const text = v => (v === null || v === undefined || v === "" ? null : String(v));
            const int = v => (v === null || v === undefined || v === "" ? undefined : Number(v));
            const { keys, duplicates } = parseKeys(String(body.keys ?? "").slice(0, 20_000), text(body.game) ?? text(body.title) ?? "Prize");
            const r = await giveaways.create({
                guild_id: g.id, channel_id: body.channel_id, host_id: s.userId, title: body.title, duration_ms: parseDuration(text(body.length) ?? "24h"),
                game_title: text(body.game), description: text(body.description), image_url: parseImageUrl(body.image, "image"), thumbnail_url: parseImageUrl(body.thumbnail, "thumbnail"),
                color: parseColor(body.color), button_label: text(body.button_label), ping_role_id: text(body.ping_role_id), require_role_id: text(body.require_role_id),
                bonus_role_id: text(body.bonus_role_id), bonus_entries: int(body.bonus_entries), claim_hours: int(body.claim_hours),
                min_account_days: int(body.min_account_days), min_member_days: int(body.min_member_days),
                vouch_channel_id: channels.some(c => c.id === body.vouch_channel_id) ? body.vouch_channel_id : null,
                auto_image: body.auto_image !== false, keys, require_boost: Boolean(body.boosters),
                start_in_ms: text(body.start_in) ? parseDuration(text(body.start_in), { min: 0 }) : 0,
                rounds: int(body.rounds) ?? 1, repeat_ms: text(body.repeat_every) ? parseDuration(text(body.repeat_every)) : null
            });
            return { ...r, duplicates };
            } catch (err) { undo(); throw err; }
        },

        "POST /api/giveaways/end": async (req, body) => { const g = managerGuild(session(req), body.guild_id); needGiveaways(); const x = giveawayOf(g, body.id); const r = await giveaways.end(x.id); return { winners: r.winners.length, unused: r.unused }; },
        "POST /api/giveaways/cancel": async (req, body) => { const g = managerGuild(session(req), body.guild_id); needGiveaways(); const x = giveawayOf(g, body.id); return await giveaways.cancel(x.id); },
        "POST /api/giveaways/reroll": async (req, body) => { const g = managerGuild(session(req), body.guild_id); needGiveaways(); const x = giveawayOf(g, body.id); const r = await giveaways.reroll(x.id, { userId: body.user_id || null }); return { winners: r.winners.length }; },
        "POST /api/giveaways/replace": async (req, body) => {
            const g = managerGuild(session(req), body.guild_id); needGiveaways();
            const x = giveawayOf(g, body.id);
            return await giveaways.replaceKey(x.id, String(body.user_id ?? ""), body.key);
        },

        "POST /api/giveaways/setup": async (req, body) => {
            const g = managerGuild(session(req), body.guild_id);
            const ids = new Set([...(await rest.listChannels(g.id).catch(() => [])).map(c => c.id)]);
            const patch = {};
            if (body.vouch_channel_id !== undefined) {
                if (body.vouch_channel_id && !ids.has(body.vouch_channel_id)) throw new HttpError(400, "Pick a text channel from the list.");
                patch.vouch_channel_id = body.vouch_channel_id || null;
            }
            if (body.manager_role_id !== undefined) {
                const roles = body.manager_role_id ? await rest.listRoles(g.id).catch(() => []) : [];
                if (body.manager_role_id && !roles.some(r => r.id === body.manager_role_id)) throw new HttpError(400, "Pick a role from the list.");
                patch.manager_role_id = body.manager_role_id || null;
            }
            if (body.giveaway_channel_id !== undefined) {
                if (body.giveaway_channel_id && !ids.has(body.giveaway_channel_id)) throw new HttpError(400, "Pick a text channel from the list.");
                patch.giveaway_channel_id = body.giveaway_channel_id || null;
            }
            return { settings: db.setGiveawaySettings(g.id, patch) };
        },

        "GET /api/servers/roles": async (req, _b, url) => {
            const g = managerGuild(session(req), url.searchParams.get("guild"));
            try { return { roles: await rest.listRoles(g.id) }; }
            catch (err) {
                if (err instanceof DiscordApiError && [403, 404].includes(err.status)) throw new HttpError(400, "The bot is not in that server yet. Invite it first.");
                throw err;
            }
        },

        // ----- owner -----
        "GET /api/admin/stats": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            return { stats: db.stats(), health: ops ? ops.snapshot() : null };
        },

        "GET /api/admin/insights": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const ins = db.adminInsights(), info = botInfo ? botInfo() : null, mem = process.memoryUsage();
            const live = guildList ? guildList() : [];
            const byId = new Map(live.map(g => [g.id, g]));
            // Every server the bot is in, with what has been set up there. Servers that never set anything are still listed.
            const rows = new Map(ins.servers.map(r => [r.id, r]));
            const servers = [...new Set([...live.map(g => g.id), ...rows.keys()])].map(id => ({ id, name: byId.get(id)?.name ?? null, members: byId.get(id)?.members ?? null, tracked: rows.get(id)?.members ?? 0, channel: rows.has(id), freeFeed: Boolean(rows.get(id)?.free_feed), groupMin: rows.get(id)?.group_min ?? 0, digest: Boolean(rows.get(id)?.weekly_digest), inServer: guildList ? byId.has(id) : null }))
                .sort((a, b) => (b.members ?? 0) - (a.members ?? 0) || b.tracked - a.tracked);
            return { ...ins, servers, bot: { version: info?.version ?? null, uptime: info?.uptime ?? null, pingMs: info?.pingMs ?? null, servers: info?.servers ?? null, rssMb: Math.round(mem.rss / 1048576), node: process.version } };
        },
        // What the community features are being used for, across every server (counts only, never messages).
        "GET /api/admin/community": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const live = new Map((guildList?.() ?? []).map(g => [g.id, g]));
            const c = db.adminCommunity();
            return { ...c, membersIntent: membersIntent(), servers: c.servers.map(r => ({ ...r, name: live.get(r.id)?.name ?? null, members: live.get(r.id)?.members ?? null })) };
        },
        "GET /api/admin/user": async (req, _b, url) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const id = String(url.searchParams.get("id") ?? "").trim();
            if (!/^\d{5,25}$/.test(id)) throw new HttpError(400, "Paste a Discord user ID (numbers only).");
            const u = db.adminUser(id);
            if (!u) throw new HttpError(404, "Nobody with that ID has used the bot.");
            return u;
        },
        "POST /api/admin/user": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const id = String(body.id ?? "").trim();
            if (!/^\d{5,25}$/.test(id) || !db.getUser(id)) throw new HttpError(404, "Nobody with that ID has used the bot.");
            if (body.action === "reset_dm") db.updateUser(id, { dm_failures: 0 });
            else if (body.action === "pause") db.updateUser(id, { paused: 1 });
            else if (body.action === "resume") db.updateUser(id, { paused: 0 });
            else throw new HttpError(400, "Unknown action.");
            log(`Bot owner ran "${body.action}" on member ${id}`);
            return db.adminUser(id);
        },
        "POST /api/admin/clear-dm-failures": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const n = db.clearAllDmFailures();
            log(`Bot owner cleared the DM failure count for ${n} member${n === 1 ? "" : "s"}`);
            return { cleared: n };
        },

        "GET /api/admin/broadcast": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const b = broadcaster();
            return { counts: b.counts(), current: b.current(), history: db.listBroadcasts(8), maxBody: MAX_BODY, canSend: Boolean(dm) };
        },
        "POST /api/admin/broadcast": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            if (!dm) throw new HttpError(400, "Sending is not available here.");
            const audience = String(body.audience ?? "");
            // Test sends go only to the owner. Anything bigger needs the word SEND typed, so it cannot go out by accident.
            if (audience !== "me" && body.confirm !== "SEND") throw new HttpError(400, "Type SEND to confirm.");
            const undo = audience !== "me" ? cooldown(s.userId, "broadcast") : () => {};
            try {
                const r = broadcaster().start({ title: body.title, body: body.body, audience, promo: body.kind === "promo" });
                log(`Bot owner started broadcast #${r.id} to ${audience} (${r.total} recipient${r.total === 1 ? "" : "s"})`);
                return { ...r, current: broadcaster().current() };
            } catch (e) { undo(); if (e instanceof UserError) throw new HttpError(400, e.message); throw e; }
        },

        "GET /api/admin/bugs": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const seen = Number(db.getMeta("bugs_seen") ?? 0);
            const bugs = db.listBugs({ limit: 100 }).map(t => ({ id: t.id, subject: t.subject, status: t.status, user_id: t.user_id, user_name: t.user_name, created_at: t.created_at, updated_at: t.updated_at, text: String(t.first).slice(0, 600), replies: t.replies, isNew: t.created_at > seen && ["open", "waiting"].includes(t.status) }));
            return { bugs, newCount: bugs.filter(b => b.isNew).length, open: bugs.filter(b => ["open", "waiting"].includes(b.status)).length };
        },
        "POST /api/admin/bugs/seen": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            db.setMeta("bugs_seen", Date.now()); // same clock the ticket store stamps with
            return { ok: true };
        },

        // ----- network-wide giveaways: one giveaway shown in every server's giveaway channel and in DMs -----
        "GET /api/admin/giveaways": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const names = new Map((guildList?.() ?? []).map(g => [g.id, g.name]));
            const dest = db.giveawayDestinations().map(d => ({ id: d.guild_id, name: names.get(d.guild_id) ?? d.guild_id, channel_id: d.channel_id }));
            const list = db.listGlobalGiveaways(15).map(g => ({ id: g.id, title: g.title, host: g.host_name ?? null, steps: g.steps ? JSON.parse(g.steps).length : 0, status: g.status, ends_at: g.ends_at, entries: db.countEntries(g.id), prizes: db.listKeys(g.id).length,
                channels: db.listMirrors(g.id).filter(m => m.kind === "channel").length + 1, dms: db.listMirrors(g.id).filter(m => m.kind === "dm").length, spread: giveaways?.spreadStatus(g.id) ?? null }));
            return { available: Boolean(giveaways), destinations: dest, dm: db.broadcastTargets().users.length, list, ownerName: config.creator?.name ?? "You", stepKinds: Object.entries(STEP_KINDS).map(([id, k]) => ({ id, label: k.label, hint: k.hint })) };
        },
        "POST /api/admin/giveaways/create": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            needGiveaways();
            if (String(body.confirm ?? "").trim().toUpperCase() !== "SEND") throw new HttpError(400, "Type SEND to confirm.");
            const audience = ["channels", "dm", "both"].includes(body.audience) ? body.audience : "both";
            const dest = db.giveawayDestinations();
            if (!dest.length) throw new HttpError(400, "No server has a giveaway or alert channel yet. Set one first.");
            const home = dest.find(d => d.guild_id === body.home) ?? dest[0];
            const undo = cooldown(s.userId, "broadcast");
            try {
                const text = v => (v === null || v === undefined || v === "" ? null : String(v));
                const { keys, duplicates } = parseKeys(String(body.keys ?? "").slice(0, 20_000), text(body.game) ?? text(body.title) ?? "Prize");
                let host, steps;
                try { host = parseHost(body.host, config.creator?.name ?? "the bot owner"); steps = parseSteps(body.steps); }
                catch (e) { if (e instanceof StepError) throw new HttpError(400, e.message); throw e; }
                const r = await giveaways.create({
                    guild_id: home.guild_id, channel_id: home.channel_id, host_id: s.userId, title: body.title, duration_ms: parseDuration(text(body.length) ?? "24h"),
                    game_title: text(body.game), description: text(body.description), image_url: parseImageUrl(body.image, "image"), thumbnail_url: parseImageUrl(body.thumbnail, "thumbnail"),
                    color: parseColor(body.color), button_label: text(body.button_label),
                    claim_hours: Number(body.claim_hours) || undefined, keys, auto_image: true, is_global: true, host, steps
                });
                const targets = db.broadcastTargets();
                const sent = await giveaways.spread(r.id, {
                    channelIds: audience === "dm" ? [] : dest.map(d => d.channel_id),
                    dmUsers: audience === "channels" ? [] : targets.users, delayMs: config.broadcastDelayMs ?? 1100
                });
                log(`Bot owner started global giveaway #${r.id}`);
                return { id: r.id, prizes: r.prizes, ends_at: r.ends_at, total: sent.total, duplicates };
            } catch (err) { undo(); throw err; }
        },
        "POST /api/admin/giveaways/end": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            needGiveaways();
            const g = db.getGiveaway(Number(body.id));
            if (!g || !g.is_global) throw new HttpError(404, "That is not a network-wide giveaway.");
            const r = await giveaways.end(g.id);
            return { winners: r.winners.length };
        },

        "GET /api/admin/logs": async (req, _b, url) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const level = ["error", "warn", "activity", "all"].includes(url.searchParams.get("level")) ? url.searchParams.get("level") : "error";
            return { lines: logs ? logs.recent({ level, limit: 200 }) : [], available: Boolean(logs) };
        },

        // ----- support tickets (same thread as the Discord side) -----
        "GET /api/tickets": async (req, _b, url) => {
            const s = session(req); needTickets();
            const q = String(url.searchParams.get("q") ?? "").slice(0, 60), status = url.searchParams.get("status") || null;
            const mine = db.listTickets({ userId: s.userId, limit: 50 });
            const mgd = s.guilds.filter(isManager);
            const staff = isOwner(s) || mgd.length > 0;
            const inbox = staff ? db.listTickets({ all: isOwner(s), guildIds: mgd.map(g => g.id), status, q, limit: 100 }) : [];
            const cut = t => ({ id: t.id, subject: t.subject, status: t.status, assignee_id: t.assignee_id, tags: t.tags, user_id: t.user_id, user_name: t.user_name, guild_id: t.guild_id, updated_at: t.updated_at, created_at: t.created_at, rating: t.rating });
            return { mine: mine.map(cut), inbox: inbox.map(cut), staff, owner: isOwner(s),
                guilds: mgd.map(g => ({ id: g.id, name: g.name, ...settingsView(g.id) })), ownerSettings: isOwner(s) ? settingsView("*") : null };
        },
        "GET /api/tickets/one": async (req, _b, url) => {
            const s = session(req); needTickets();
            const { t, staff } = ticketAccess(s, url.searchParams.get("id"));
            const out = { ticket: t, messages: db.listTicketMessages(t.id), staff, canned: staff ? db.listCanned(t.guild_id ?? "*") : [] };
            // Recent errors help the owner debug a problem report. Staff of other servers never see them.
            if (isOwner(s) && logs) out.errors = logs.recent({ level: "error", limit: 15 });
            return out;
        },
        "POST /api/tickets": async (req, body) => {
            const s = session(req); needTickets();
            const gid = body.guild_id && s.guilds.some(g => g.id === body.guild_id) ? body.guild_id : null;
            return tickets.open({ userId: s.userId, userName: s.username ?? null, guildId: gid, subject: body.subject, body: body.body, kind: body.kind === "bug" ? "bug" : "help" });
        },
        "POST /api/tickets/reply": async (req, body) => {
            const s = session(req); needTickets();
            const { t, staff } = ticketAccess(s, body.id);
            const asStaff = staff && t.user_id !== s.userId;
            await tickets.reply(t.id, { authorId: s.userId, role: asStaff ? "staff" : "user", body: body.body });
            return { ok: true };
        },
        "POST /api/tickets/status": async (req, body) => {
            const s = session(req); needTickets();
            const { t, staff } = ticketAccess(s, body.id);
            if (!staff && body.status !== "closed") throw new HttpError(403, "Only support staff can do that.");
            if (body.status === "resolved") await tickets.resolve(t.id, { by: s.userId, note: body.note ? String(body.note).slice(0, 500) : null });
            else if (body.status === "closed") await tickets.close(t.id, { by: s.userId });
            else throw new HttpError(400, "Unknown status.");
            return { ok: true };
        },
        "POST /api/tickets/assign": async (req, body) => {
            const s = session(req); needTickets();
            const { t, staff } = ticketAccess(s, body.id);
            if (!staff) throw new HttpError(403, "Only support staff can do that.");
            await tickets.assign(t.id, body.assignee === null ? null : s.userId);
            return { ok: true };
        },
        "POST /api/tickets/tags": async (req, body) => {
            const s = session(req); needTickets();
            const { t, staff } = ticketAccess(s, body.id);
            if (!staff) throw new HttpError(403, "Only support staff can do that.");
            await tickets.setTags(t.id, body.tags);
            return { ok: true };
        },
        "POST /api/tickets/rate": async (req, body) => { const s = session(req); needTickets(); return { rating: tickets.rate(Number(body.id), s.userId, body.rating) }; },
        "GET /api/tickets/transcript": async (req, _b, url) => {
            const s = session(req); needTickets();
            const { t } = ticketAccess(s, url.searchParams.get("id"));
            return { name: `ticket-${t.id}.txt`, text: tickets.transcript(t.id) };
        },
        "POST /api/tickets/setup": async (req, body) => {
            const s = session(req); needTickets();
            const scope = body.guild_id === "*" ? "*" : managerGuild(s, String(body.guild_id)).id;
            if (scope === "*" && !isOwner(s)) throw new HttpError(403, "Only the bot owner can set this.");
            const id = v => (/^\d{15,25}$/.test(String(v ?? "").trim()) ? String(v).trim() : null);
            if (body.channel_id && !id(body.channel_id)) throw new HttpError(400, "That does not look like a channel ID. Enable Developer Mode, right-click the channel, Copy Channel ID.");
            db.setTicketSettings(scope, { channelId: id(body.channel_id), staffRoleId: id(body.staff_role_id) });
            return settingsView(scope);
        },
        "POST /api/tickets/canned": async (req, body) => {
            const s = session(req); needTickets();
            const scope = body.guild_id === "*" ? "*" : managerGuild(s, String(body.guild_id)).id;
            if (scope === "*" && !isOwner(s)) throw new HttpError(403, "Only the bot owner can edit these.");
            if (body.remove) db.removeCanned(scope, Number(body.remove));
            else {
                const title = String(body.title ?? "").trim().slice(0, 60), text = String(body.body ?? "").trim().slice(0, 1500);
                if (!title || !text) throw new HttpError(400, "Give the reply a title and some text.");
                db.addCanned(scope, title, text);
            }
            return { canned: db.listCanned(scope) };
        },

        "POST /api/mydata/delete": async (req, body) => {
            const s = session(req);
            if (body.confirm !== "DELETE") throw new HttpError(400, "Type DELETE to confirm.");
            return { deleted: db.deleteUser(s.userId) };
        }
    };

    // ---------- auth ----------
    async function login(req, res) {
        sweep();
        const state = randomBytes(24).toString("hex");
        states.set(state, now() + 10 * 60_000);
        setCookie(res, STATE_COOKIE, state, 600);
        send(res, 302, "", { Location: rest.authorizeUrl(state) });
    }

    // Linked Roles: the same Discord sign-in, plus permission to show Steam on the member's Discord profile.
    const linkedStates = new Set();
    async function linkedStart(req, res) {
        sweep();
        const state = randomBytes(24).toString("hex");
        states.set(state, now() + 10 * 60_000);
        linkedStates.add(state);
        setCookie(res, STATE_COOKIE, state, 600);
        send(res, 302, "", { Location: rest.authorizeUrl(state, { linkedRoles: true }) });
    }

    async function callback(req, res, url) {
        const state = url.searchParams.get("state");
        const linked = linkedStates.delete(state);
        const code = url.searchParams.get("code");
        const ok = state && states.has(state) && states.get(state) > now() && cookies(req)[STATE_COOKIE] === state;
        states.delete(state);
        setCookie(res, STATE_COOKIE, "", 0);
        // Signed in with Steam first, and Discord would not finish silently (not signed in to Discord here, or it was declined):
        // keep the Steam session so nothing is lost, and the page offers the Discord half.
        const kt = cookies(req)[STEAM_KNOWN_COOKIE], known = steamKnown.get(kt);
        if (kt) { steamKnown.delete(kt); setCookie(res, STEAM_KNOWN_COOKIE, "", 0); }
        if (ok && !code && known && known.exp > now()) {
            startSession(res, { userId: known.user.discord_id, username: known.user.uname || "Steam player", avatar: known.user.avatar || null, guilds: [], steamOnly: true });
            return send(res, 302, "", { Location: "/#/steam" });
        }
        if (!ok || !code) return send(res, 302, "", { Location: "/?error=login" });

        let who;
        try { who = await rest.login(code, linked ? { withToken: true } : undefined); }
        catch (err) { log(`Discord sign-in failed (${err.status ?? err.name})`, "warn"); return send(res, 302, "", { Location: "/?error=login" }); }

        const name = who.user.global_name || who.user.username;
        const avatar = who.user.avatar ? `https://cdn.discordapp.com/avatars/${who.user.id}/${who.user.avatar}.png?size=64` : null;
        startSession(res, {
            userId: who.user.id, username: name, avatar,
            guilds: (who.guilds ?? []).map(g => ({ id: g.id, name: g.name, icon: g.icon, owner: Boolean(g.owner), permissions: String(g.permissions ?? "0") }))
        });
        db.ensureUser(who.user.id);
        // Came here from "Sign in through Steam" and had no account yet: attach the proven Steam account now.
        const pend = steamPending.get(cookies(req)[STEAM_PENDING_COOKIE]);
        steamPending.delete(cookies(req)[STEAM_PENDING_COOKIE]);
        setCookie(res, STEAM_PENDING_COOKIE, "", 0);
        if (pend && pend.exp > now()) {
            db.setSteamLink(who.user.id, pend.steamid, { verified: true });
            db.setSteamWho(who.user.id, name, avatar);
            if (!linked) return send(res, 302, "", { Location: "/#/steam?linked=1" });
        }
        if (db.getSteamLink(who.user.id)?.verified) db.setSteamWho(who.user.id, name, avatar); // keep the Steam sign-in's name and picture fresh
        if (linked) {
            if (!db.getSteamLink(who.user.id)?.verified) { // prove the Steam account first, then this flow comes straight back
                setCookie(res, NEXT_COOKIE, "linked", 600);
                return send(res, 302, "", { Location: "/auth/steam" });
            }
            try { await rest.setRoleConnection(who.accessToken, connectionPayload(db, who.user.id)); db.bumpUsage("linked_roles_connected"); }
            catch (err) { log(`Could not link Discord roles for a Steam sign-in (${err.status ?? err.name})`, "warn"); return send(res, 302, "", { Location: "/#/steam?roles=failed" }); }
            return send(res, 302, "", { Location: "/#/steam?roles=1" });
        }
        send(res, 302, "", { Location: "/#/mypage" });
    }

    function startSession(res, data) {
        if (sessions.size >= MAX_SESSIONS) sweep();
        if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
        const id = randomBytes(32).toString("hex");
        sessions.set(id, { ...data, expires: now() + SESSION_MS });
        setCookie(res, COOKIE, id, SESSION_MS / 1000);
    }

    // ---- Sign in through Steam (OpenID). Steam proves the account; a Discord account is what the bot's alerts attach to. ----
    async function steamLogin(req, res) {
        sweep();
        const state = randomBytes(24).toString("hex");
        states.set("steam:" + state, now() + 10 * 60_000);
        setCookie(res, STEAM_STATE_COOKIE, state, 600);
        send(res, 302, "", { Location: steamLoginUrl(`${origin}/auth/steam/return?state=${state}`, origin) });
    }

    async function steamReturn(req, res, url) {
        const state = url.searchParams.get("state") ?? "";
        const ok = state && states.get("steam:" + state) > now() && cookies(req)[STEAM_STATE_COOKIE] === state;
        states.delete("steam:" + state);
        setCookie(res, STEAM_STATE_COOKIE, "", 0);
        if (!ok) return send(res, 302, "", { Location: "/?error=steam" });
        let steamid;
        try { steamid = await verifySteamLogin(url.searchParams, `${origin}/auth/steam/return?state=${state}`, steamFetch); }
        catch { return send(res, 302, "", { Location: "/?error=steam" }); }

        const s = sessions.get(cookies(req)[COOKIE]);
        if (s && s.expires > now()) { // already signed in with Discord: this proves the Steam account is theirs
            db.ensureUser(s.userId);
            db.setSteamLink(s.userId, steamid, { verified: true });
            db.setSteamWho(s.userId, s.username, s.avatar);
            if (cookies(req)[NEXT_COOKIE] === "linked") { setCookie(res, NEXT_COOKIE, "", 0); return send(res, 302, "", { Location: "/auth/linked" }); } // back to finish connecting Linked Roles
            return send(res, 302, "", { Location: "/#/steam?linked=1" });
        }
        const known = db.findVerifiedSteamUser(steamid);
        if (known) { // Steam proved who this is. Finish with Discord (it says yes without asking if they have signed in before) so servers, giveaways and admin work too.
            const kt = randomBytes(24).toString("hex");
            steamKnown.set(kt, { user: known, exp: now() + 10 * 60_000 });
            setCookie(res, STEAM_KNOWN_COOKIE, kt, 600);
            return send(res, 302, "", { Location: "/auth/login" });
        }
        const token = randomBytes(24).toString("hex");
        steamPending.set(token, { steamid, exp: now() + 15 * 60_000 });
        setCookie(res, STEAM_PENDING_COOKIE, token, 900);
        send(res, 302, "", { Location: "/auth/login" }); // one Discord sign-in connects it, once
    }

    function logout(req, res) {
        sessions.delete(cookies(req)[COOKIE]);
        setCookie(res, COOKIE, "", 0);
        json(res, 200, { ok: true });
    }

    // ---------- static ----------
    const zcache = new Map(); // `${file}:${encoding}` -> the compressed page code, made once
    async function serveFile(res, path) {
        const [file, type] = FILES[path];
        let body = cache.get(file);
        if (!body) {
            try { body = await readFile(join(PUBLIC_DIR, file)); } catch { return send(res, 404, "Not found", { "Content-Type": "text/plain" }); }
            // The page's share-preview tags need the real public address, so it is filled in once here.
            if (file === "index.html") body = Buffer.from(body.toString("utf8").replaceAll("__ORIGIN__", origin));
            cache.set(file, body);
            cache.set(file + ":etag", `W/"${createHash("sha1").update(body).digest("hex").slice(0, 16)}"`);
        }
        const etag = cache.get(file + ":etag");
        const text = /\.(js|css|html)$/.test(file);
        const headers = { "Content-Type": type, "Cache-Control": text ? "no-cache" : "public, max-age=3600", ETag: etag };
        if (res.req?.headers?.["if-none-match"] === etag) return send(res, 304, "", { ETag: etag, "Cache-Control": headers["Cache-Control"] });
        const enc = COMPRESSIBLE.test(type) ? encodingOf(res.req) : null;
        if (enc) {
            let z = zcache.get(`${file}:${enc}`);
            if (!z) zcache.set(`${file}:${enc}`, z = squeeze(body, enc, 9));
            return send(res, 200, z, { ...headers, "Content-Encoding": enc, Vary: "Accept-Encoding" });
        }
        send(res, 200, body, headers);
    }

    // ---------- server ----------
    function toHttp(err) {
        if (err instanceof HttpError) return err;
        if (err instanceof ValueError || err instanceof WishlistError || err instanceof UserError) return new HttpError(400, err.message);
        if (err instanceof SteamError) return new HttpError(err.code === "rate_limited" || err.code === "network" ? 503 : 400, err.message);
        if (err instanceof ItadError) return new HttpError(503, err.message);
        log(`Dashboard request failed with an unexpected error: ${err.name}: ${err.message}`, "error"); // never log request bodies
        return new HttpError(500, "Something went wrong. Try again in a moment.");
    }

    // Visit counter for the FanaticalGrabber web page (GitHub Pages). Public, tiny, totals only, and only that site may call it.
    const VISIT_SITES = { fanaticalgrabber: "https://jacob-lucado.github.io", dashboard: origin }; // the dashboard counts its own visitors, same origin
    const seenVisitors = new Map(); // ip -> time, in memory only, so one address counts as a new visitor once a day
    const visitLimit = createLimiter({ windowMs: 3600_000, max: 40, now });
    const presentBySite = new Map(); // site -> (random per-tab id -> last seen). In memory only; nothing about a person is kept.
    const presentFor = site => { let m = presentBySite.get(site); if (!m) presentBySite.set(site, m = new Map()); return m; };
    const pingLimit = createLimiter({ windowMs: 60_000, max: 12, now });
    const ONLINE_MS = 75_000;
    const online = site => { const present = presentFor(site), t = now(); for (const [k, at] of present) if (t - at > ONLINE_MS) present.delete(k); return present.size; };
    const markPresent = (site, id) => { const present = presentFor(site); if (/^[a-z0-9]{8,32}$/i.test(id ?? "") && (present.size < 5000 || present.has(id))) present.set(id, now()); };
    function visits(req, res, url) {
        const [site, action] = url.pathname.slice("/api/visits/".length).split("/");
        const allowed = VISIT_SITES[site];
        if (!allowed || (action && action !== "ping")) throw new HttpError(404, "Not found.");
        const cors = { "Access-Control-Allow-Origin": allowed, "Vary": "Origin", "Cross-Origin-Resource-Policy": "cross-origin" };
        const counts = () => ({ ...db.siteCounts(site), online: online(site) });
        if (req.method === "OPTIONS") return send(res, 204, "", { ...cors, "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Max-Age": "86400" });
        if (req.method === "GET") return json(res, 200, counts(), { ...cors, "Cache-Control": "public, max-age=10" });
        if (req.method !== "POST") throw new HttpError(405, "Not allowed.");
        const ip = clientIp(req);
        if (req.headers.origin !== allowed) return json(res, 200, counts(), cors); // ignore other origins quietly
        const id = url.searchParams.get("id");
        if (action === "ping") {
            if (pingLimit.hit(ip).ok) markPresent(site, id);
            return json(res, 200, counts(), cors);
        }
        if (!visitLimit.hit(ip).ok) return json(res, 200, counts(), cors);
        markPresent(site, id);
        const t = now();
        for (const [k, at] of seenVisitors) if (t - at > 86400_000) seenVisitors.delete(k);
        const fresh = url.searchParams.get("new") === "1" && !seenVisitors.has(ip);
        if (fresh) seenVisitors.set(ip, t);
        return json(res, 200, { ...db.siteHit(site, fresh), online: online(site) }, cors);
    }

    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, origin);
            const key = `${req.method} ${url.pathname}`;
            if (url.pathname.startsWith("/api/visits/")) return visits(req, res, url);

            if (req.method === "GET" && FILES[url.pathname]) return await serveFile(res, url.pathname);
            if (req.method === "GET" && url.pathname === "/robots.txt") {
                return send(res, 200, `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /auth/\nSitemap: ${origin}/sitemap.xml\n`, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" });
            }
            if (req.method === "GET" && url.pathname === "/sitemap.xml") {
                return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url></urlset>\n`, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" });
            }
            if (url.pathname.startsWith("/auth/")) {
                const r = authLimit.hit(clientIp(req));
                if (!r.ok) throw new HttpError(429, `Too many requests. Try again in ${r.retryAfterS}s.`);
            } else if (url.pathname.startsWith("/api/")) {
                const sid = cookies(req)[COOKIE];
                const r = apiLimit.hit(sessions.has(sid) ? `s:${sid}` : `ip:${clientIp(req)}`);
                if (!r.ok) throw new HttpError(429, `Too many requests. Try again in ${r.retryAfterS}s.`);
            }
            if (key === "GET /auth/login") return await login(req, res);
            if (key === "GET /auth/callback") return await callback(req, res, url);
            if (key === "GET /auth/linked") return await linkedStart(req, res);
            if (key === "GET /auth/steam") return await steamLogin(req, res);
            if (key === "GET /auth/steam/return") return await steamReturn(req, res, url);
            if (key === "POST /auth/logout") { checkWrite(req); return logout(req, res); }

            // The same pictures /profilecard and /steam value post in Discord. Saved straight from the website with a download name.
            if (key === "GET /api/profile/card.png" || key === "GET /api/steam/value.png" || key === "GET /api/steam/recap.png") {
                const s = session(req); userRow(s);
                const undo = cooldown(s.userId, "cardimg");
                try {
                    const png = key === "GET /api/profile/card.png"
                        ? await renderProfileCard({ db, userId: s.userId, name: s.username, fetchImpl: steamFetch })
                        : key === "GET /api/steam/recap.png" ? await renderRecap({ db, userId: s.userId, name: s.username, fetchImpl: steamFetch, now: now() })
                        : await renderSteamValue({ db, itad, userId: s.userId, fetchImpl: steamFetch });
                    if (!png) throw new HttpError(404, "Link your Steam profile and sync first, so there is something to draw.");
                    return send(res, 200, Buffer.from(png), { "Content-Type": "image/png", "Cache-Control": "no-store", "Content-Disposition": `inline; filename="${key.includes("card") ? "my-game-profile" : key.includes("recap") ? "my-year-in-games" : "steam-account-value"}.png"` });
                } catch (err) { undo(); throw err; }
            }

            if (key === "GET /api/mydata/download") {
                const s = session(req);
                const data = exportJson(db, s.userId);
                if (!data) throw new HttpError(404, "Nothing is stored about you.");
                return send(res, 200, data, {
                    "Content-Type": "application/json; charset=utf-8",
                    "Content-Disposition": 'attachment; filename="my-steam-value-checker-data.json"',
                    "Cache-Control": "no-store"
                });
            }

            if (key === "GET /api/admin/backup") {
                const s = session(req);
                if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can download backups.");
                let names = [];
                try { names = readdirSync(config.backupDir ?? "").filter(n => /^steamvaluechecker-\d{4}-\d{2}-\d{2}\.db$/.test(n)).sort(); } catch { /* none yet */ }
                if (!names.length) throw new HttpError(404, "There is no backup yet.");
                const name = names[names.length - 1];
                return send(res, 200, readFileSync(joinPath(config.backupDir, name)), {
                    "Content-Type": "application/vnd.sqlite3", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store"
                });
            }

            const icsMatch = req.method === "GET" ? /^\/calendar\/feed\/(svcc_[A-Za-z0-9_-]{43})\.ics$/.exec(url.pathname) : null;
            if (icsMatch) {
                // A private calendar link: the secret in the address is the only credential, so it is never cached or indexed.
                const f = db.calFeedForToken(icsMatch[1]);
                if (!f) throw new HttpError(404, "Not found.");
                db.noteCalFeedUse(f.discord_id);
                const t = now();
                const body = toIcs(calendarEntries(db, f.discord_id, { from: t - 7 * 86400_000, to: t + 400 * 86400_000, guildIds: f.guild_ids }), { now: t });
                return send(res, 200, body, { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" });
            }

            if (key === "POST /api/grabber/import") {
                // Called by the FanaticalGrabber extension with a link code instead of a dashboard session. Adds titles only.
                const m = /^Bearer (\S+)$/.exec(String(req.headers.authorization ?? ""));
                const uid = m ? db.grabberUserForToken(m[1]) : null;
                if (!uid) throw new HttpError(401, "That link code is not valid. Make a new one with /library grabber.");
                if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(400, "Bad request.");
                cooldown(uid, "grabber");
                const body = await readJson(req, 60_000);
                const entries = (Array.isArray(body.entries) ? body.entries : []).slice(0, 500).map(e => ({ title: String(e?.title ?? ""), paid: e?.paid === null || e?.paid === "" || !Number.isFinite(Number(e?.paid)) ? null : Number(e.paid) }));
                const clean = sanitize(entries, { max: 500 }).entries;
                if (!clean.length) throw new HttpError(400, "I need game titles, not keys.");
                db.ensureUser(uid);
                if (body.mode === "gifted") {
                    // Games given to you: recorded at retail, marked gifted, left out of spend and savings.
                    const r = await fillGifted(db, itad, db.getUser(uid), clean.map(e => e.title));
                    db.noteGrabberUse(uid);
                    return json(res, 200, { mode: "gifted", filled: r.filled, updated: r.filled, added: r.added, notFound: r.missing.length, missing: r.missing.slice(0, 50), noRetail: r.noRetail.slice(0, 50), noRetailCount: r.noRetail.length });
                }
                if (body.mode === "retail") {
                    // Steam key activations: no price paid is known, so use the retail price, only where nothing is recorded yet.
                    const r = await fillRetail(db, itad, db.getUser(uid), clean.map(e => e.title));
                    db.noteGrabberUse(uid);
                    return json(res, 200, { mode: "retail", filled: r.filled, updated: r.filled, alreadyPriced: r.alreadyPriced, notFound: r.missing.length, missing: r.missing.slice(0, 50), noRetail: r.noRetail.slice(0, 50), noRetailCount: r.noRetail.length });
                }
                if (body.mode === "prices") {
                    // Steam purchase history: fill in prices for games already in the library (a Steam sync's games), add nothing new.
                    const r = await fillPrices(db, itad, uid, clean.filter(e => e.paid !== null));
                    db.noteGrabberUse(uid);
                    return json(res, 200, { mode: r.mode, added: r.added, updated: r.filled, filled: r.filled, notFound: r.missing.length, missing: r.missing.slice(0, 50), unpriced: r.unpriced.length, unpricedTitles: r.unpriced.slice(0, 50) });
                }
                const r = await importLibrary(db, itad, uid, clean);
                db.noteGrabberUse(uid);
                return json(res, 200, { added: r.added, updated: r.updated, notFound: r.notFound.length, skippedForLimit: r.skippedForLimit });
            }

            if (key === "POST /api/grabber/prices") {
                // The extension's bundle and cart helpers: current prices for up to 60 Steam apps, by link code. Only app numbers are sent.
                const m = /^Bearer (\S+)$/.exec(String(req.headers.authorization ?? ""));
                const uid = m ? db.grabberUserForToken(m[1]) : null;
                if (!uid) throw new HttpError(401, "That link code is not valid. Make a new one with /library grabber.");
                if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(400, "Bad request.");
                cooldown(uid, "grabberprices");
                const body = await readJson(req, 5_000);
                const appids = [...new Set((Array.isArray(body.appids) ? body.appids : []).map(Number).filter(n => Number.isInteger(n) && n > 0 && n < 1e9))].slice(0, 60);
                if (!appids.length) throw new HttpError(400, "No app numbers.");
                const user = db.getUser(uid);
                const ids = await itad.lookupShopIds(STEAM_SHOP_ID, appids.map(a => `app/${a}`));
                const found = appids.map(a => [a, ids.get(`app/${a}`)]).filter(([, id]) => id);
                const prices = found.length ? await itad.getPrices(found.map(([, id]) => id), grabberRegion(user, body.cc)) : new Map();
                const items = found.map(([appid, id]) => {
                    const sum = summarize(prices.get(id), { majorOnly: user?.stores === "major" });
                    return { appid, steam: sum.steam, msrp: sum.msrp, best: sum.best ? { price: sum.best.price, shop: sum.best.shop } : null, atl: sum.atl, currency: sum.currency };
                });
                return json(res, 200, { items });
            }

            if (key === "GET /api/grabber/game") {
                // Called by the extension on a Steam store page, with the member's link code. Returns prices and whether they own or wishlisted it.
                const m = /^Bearer (\S+)$/.exec(String(req.headers.authorization ?? ""));
                const uid = m ? db.grabberUserForToken(m[1]) : null;
                if (!uid) throw new HttpError(401, "That link code is not valid. Make a new one with /library grabber.");
                const appid = Number(url.searchParams.get("appid"));
                if (!Number.isInteger(appid) || appid <= 0 || appid > 1e9) throw new HttpError(400, "Bad app id.");
                cooldown(uid, "grabbergame");
                const user = db.getUser(uid);
                const map = await itad.lookupShopIds(STEAM_SHOP_ID, [`app/${appid}`]);
                const id = map.get(`app/${appid}`);
                if (!id) return json(res, 200, { found: false });
                const prices = await itad.getPrices([id], grabberRegion(user, url.searchParams.get("cc")));
                const sum = summarize(prices.get(id), { majorOnly: user?.stores === "major" });
                return json(res, 200, {
                    found: true, currency: sum.currency, msrp: sum.msrp, steam: sum.steam, cut: sum.cut,
                    best: sum.best ? { price: sum.best.price, shop: sum.best.shop } : null, atl: sum.atl, low1y: sum.low1y,
                    owned: db.listLibrary(uid).some(g => g.itad_id === id),
                    wishlisted: db.listItems(uid).some(g => g.itad_id === id)
                });
            }

            const handler = routes[key];
            if (!handler) throw new HttpError(404, "Not found.");
            let body = {};
            if (req.method === "POST") {
                checkWrite(req);
                body = await readJson(req, key === "POST /api/value" ? MAX_UPLOAD_CHARS * 2 + 50_000 : key === "POST /api/giveaways/create" ? 60_000 : key === "POST /api/community/emoji" ? 400_000 : 20_000);
            }
            json(res, 200, await handler(req, body, url));
        } catch (err) {
            const e = toHttp(err);
            json(res, e.status, { error: e.message });
        }
    });

    return {
        server,
        listen: (port = config.port, host = config.host) => new Promise(resolve => server.listen(port, host, () => resolve(server.address()))),
        close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); }),
        _sessions: sessions
    };
}

// Web dashboard: everything the slash commands do, in a browser. Uses Node's http module only.
// Login is Discord OAuth2 (identify + guilds). Sessions live in memory, so a restart logs everyone out.

import http from "node:http";
import { gameNight } from "../gamenight.js";
import { setupStatus, autoSetup } from "../setup.js";
import { CHANGELOG, LATEST } from "../changelog.js";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { REGIONS, ALERT_TYPES, FANATICAL_GRABBER_URL } from "../constants.js";
import { runValue, ValueError, MAX_UPLOAD_CHARS } from "../value.js";
import { viewRows, findItem, exportJson, addGameByTitle, applySteamImport, WishlistError } from "../wishlist.js";
import { importWishlist, SteamError } from "../steam.js";
import { ItadError } from "../itad.js";
import { parseTrigger, describeTrigger } from "../alerts.js";
import { DiscordApiError } from "./discord.js";
import { HELP, ABOUT, PRIVACY } from "../text.js";
import { UserError } from "../errors.js";
import { parseUpload, sanitize } from "../parse.js";
import { prefsPatch, prefsView } from "../prefs.js";
import { importLibrary, libraryView, leaderboard, serverStats } from "../library.js";
import { addToServerList, serverListView, vote, removeFromServerList } from "../serverlist.js";
import { createLimiter } from "../ratelimit.js";
import { setProfile, publicWishlist } from "../profile.js";
import { upcomingSales, SALES_UPDATED } from "../salescal.js";
import { playNext } from "../library.js";
import { resolveProfile, syncSteamLibrary, playStats, steamNext } from "../steamlib.js";
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
    "/preview.jpg": ["preview.jpg", "image/jpeg"],
    "/favicon.png": ["favicon.png", "image/png"]
};
const SESSION_MS = 7 * 24 * 3600_000;
const MAX_SESSIONS = 10_000;
const COOKIE = "svc_session";
const STATE_COOKIE = "svc_state";
const COOLDOWNS = { value: 15_000, import: 60_000, add: 3_000, hist: 2_000, lib: 3_000, steam: 60_000, deals: 5_000, grabber: 10_000, grabbertoken: 5_000 };
const MAX_HISTORY_POINTS = 180;
const MANAGE_GUILD = 0x20n;
const ADMINISTRATOR = 0x8n;

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const isManager = g => {
    if (g.owner) return true;
    try {
        const p = BigInt(g.permissions ?? "0");
        return (p & MANAGE_GUILD) !== 0n || (p & ADMINISTRATOR) !== 0n;
    } catch { return false; }
};

export function createDashboard({ db, itad, rest, ops = null, giveaways = null, tickets = null, logs = null, botInfo = null, status = null, djsVersion = null, botGuilds = null, lfg = null, steamFetch = globalThis.fetch, config, now = () => Date.now(), log = () => {} }) {
    const origin = new URL(config.publicUrl).origin;
    const secure = origin.startsWith("https://");
    const sessions = new Map();
    const states = new Map();
    const lastRun = new Map();
    const cache = new Map();
    const apiLimit = createLimiter({ windowMs: 60_000, max: config.apiPerMinute ?? 120, now });
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

    const send = (res, status, body, headers = {}) => {
        res.writeHead(status, {
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "no-referrer",
            "Content-Security-Policy":
                "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https://cdn.discordapp.com https://cdn.akamai.steamstatic.com https://cdn.cloudflare.steamstatic.com https://shared.akamai.steamstatic.com https://assets.isthereanydeal.com https://media.discordapp.net data:; " +
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

    function sweep() {
        const t = now();
        for (const [k, s] of sessions) if (s.expires < t) sessions.delete(k);
        for (const [k, exp] of states) if (exp < t) states.delete(k);
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

    const isOwner = s => Boolean(config.ownerId) && s.userId === config.ownerId;

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

    const num = v => (v === null || v === undefined || v === "" ? null : Number(v));
    const userRow = s => db.ensureUser(s.userId);

    function publicSettings(u) {
        return { region: u.region, stores: u.stores, delivery: u.delivery, paused: Boolean(u.paused), guild_id: u.guild_id, steam_id: u.steam_id, ...prefsView(u) };
    }

    function serversFor(s, u) {
        return s.guilds
            .map(g => ({
                id: g.id, name: g.name, icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null,
                manageable: isManager(g), bot: botGuilds ? Boolean(botGuilds(g.id)) : null, freeFeed: Boolean(db.getGuild(g.id)?.free_feed), alertChannel: db.getGuild(g.id)?.channel_id ?? null,
                groupMin: db.getGuild(g.id)?.group_min ?? 0
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
            { id: "server", text: "Add the bot to a server", done: s.guilds.some(g => (botGuilds ? botGuilds(g.id) : false)), href: "#/servers" }
        ];
    }

    // ---------- API ----------
    const routes = {
        "GET /api/config": async () => ({
            regions: REGIONS, alertTypes: ALERT_TYPES, fanaticalUrl: FANATICAL_GRABBER_URL,
            help: HELP, about: ABOUT,
            privacy: PRIVACY.split("\n").filter(l => !/github\.com/i.test(l)).join("\n"), maxUploadChars: MAX_UPLOAD_CHARS,
            // View Channel + Send Messages + Embed Links, the least the bot needs to post alerts
            userInstallUrl: config.clientId
                ? `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(config.clientId)}&integration_type=1&scope=applications.commands`
                : null,
            inviteUrl: config.clientId
                ? `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(config.clientId)}&scope=bot%20applications.commands&permissions=8589954064`
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
                giveaways: Boolean(giveaways),
                library: db.countLibrary(s.userId),
                unread: db.unreadNotifications(s.userId),
                news: u.seen_version === LATEST ? null : LATEST,
                setup: setupSteps(s, u)
            };
        },

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
                const r = await importWishlist(String(body.profile ?? ""), itad);
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
            const prefInput = Object.fromEntries(["quiet_start", "quiet_end", "tz", "digest", "digest_day", "bundles", "share", "free", "free_dlc", "muted", "lang"].filter(k => body[k] !== undefined).map(k => [k, body[k]]));
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
            return { title: own.title, points };
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
            return await libraryView(db, itad, u);
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

        "POST /api/library/status": async (req, body) => {
            const s = session(req);
            const item = db.listLibrary(s.userId).find(i => i.itad_id === body.itad_id);
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
            return { link, currency: view.currency, stats: playStats(view.rows.filter(r => r.appid)) };
        },

        // What to play next from the Steam library. `skip` (comma-separated ids already offered) makes "pick another" fresh.
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
                const steamid = await resolveProfile(String(body.profile ?? ""), steamFetch);
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

        "GET /api/library/next": async (req) => {
            const s = session(req);
            const view = await libraryView(db, itad, userRow(s), { snapshot: false });
            const n = playNext(view.rows);
            return { next: n ? { pick: n.pick, others: n.others, why: n.why } : null, totals: view.totals, currency: view.currency };
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
            const entries = leaderboard(db, g.id);
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
                out.push({ name: hit.name ?? "A member", savedPct: e.savedPct, games: e.games, you: e.discord_id === s.userId });
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

        "POST /api/servers/feed": async (req, body) => {
            const s = session(req);
            const g = guildFor(s, body.guild_id);
            if (!isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            if (!db.getGuild(g.id)) throw new HttpError(400, "Set an alert channel for that server first.");
            db.setFreeFeed(g.id, Boolean(body.enabled));
            return { freeFeed: Boolean(body.enabled) };
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

        "GET /api/servers/stats": async (req, _b, url) => {
            const s = session(req);
            const g = guildFor(s, url.searchParams.get("guild"));
            return serverStats(db, g.id);
        },

        // ----- free games right now, grouped by platform -----
        // Live numbers for the About panel. Aggregate only, so it is open to everyone like the Help page.
        "GET /api/about": async () => ({ about: botInfo ? botInfo() : null, creator: config.creator ?? null }),

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

        "GET /api/profile": async (req) => { const s = session(req); const u = userRow(s); return { slug: u.profile_slug ?? null, public: Boolean(u.profile_public) }; },
        "POST /api/profile": async (req, body) => { const s = session(req); userRow(s); return setProfile(db, s.userId, { enabled: Boolean(body.enabled), slug: body.slug }); },
        // Public on purpose (anyone with the link), but only for members who switched their page on.
        "GET /api/public/wishlist": async (_req, _b, url) => {
            const page = await publicWishlist(db, itad, url.searchParams.get("slug"));
            if (!page) throw new HttpError(404, "That page does not exist or is private.");
            return page;
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
            for (const g of await itad.getGiveawayList()) {
                if (!/^https:\/\//i.test(g.url ?? "")) continue;
                const dlc = isDlc(g);
                if (dlc && !showDlc) continue;
                if (!groups.has(g.shop)) groups.set(g.shop, []);
                groups.get(g.shop).push({ id: g.id, title: g.title, url: g.url, expiry: g.expiry, dlc, art: freeArt(g) ?? null });
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

        "GET /api/admin/logs": async (req, _b, url) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const level = ["error", "warn", "all"].includes(url.searchParams.get("level")) ? url.searchParams.get("level") : "error";
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
            return tickets.open({ userId: s.userId, userName: s.username ?? null, guildId: gid, subject: body.subject, body: body.body });
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

    async function callback(req, res, url) {
        const state = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        const ok = state && states.has(state) && states.get(state) > now() && cookies(req)[STATE_COOKIE] === state;
        states.delete(state);
        setCookie(res, STATE_COOKIE, "", 0);
        if (!ok || !code) return send(res, 302, "", { Location: "/?error=login" });

        let who;
        try { who = await rest.login(code); }
        catch (err) { log(`login failed: ${err.status ?? err.name}`); return send(res, 302, "", { Location: "/?error=login" }); }

        if (sessions.size >= MAX_SESSIONS) sweep();
        if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
        const id = randomBytes(32).toString("hex");
        sessions.set(id, {
            userId: who.user.id,
            username: who.user.global_name || who.user.username,
            avatar: who.user.avatar ? `https://cdn.discordapp.com/avatars/${who.user.id}/${who.user.avatar}.png?size=64` : null,
            guilds: (who.guilds ?? []).map(g => ({ id: g.id, name: g.name, icon: g.icon, owner: Boolean(g.owner), permissions: String(g.permissions ?? "0") })),
            expires: now() + SESSION_MS
        });
        setCookie(res, COOKIE, id, SESSION_MS / 1000);
        send(res, 302, "", { Location: "/" });
    }

    function logout(req, res) {
        sessions.delete(cookies(req)[COOKIE]);
        setCookie(res, COOKIE, "", 0);
        json(res, 200, { ok: true });
    }

    // ---------- static ----------
    async function serveFile(res, path) {
        const [file, type] = FILES[path];
        let body = cache.get(file);
        if (!body) {
            try { body = await readFile(join(PUBLIC_DIR, file)); } catch { return send(res, 404, "Not found", { "Content-Type": "text/plain" }); }
            cache.set(file, body);
        }
        // The page's share-preview tags need the real public address, so it is filled in here.
        if (file === "index.html") body = Buffer.from(body.toString("utf8").replaceAll("__ORIGIN__", origin));
        send(res, 200, body, { "Content-Type": type, "Cache-Control": /\.(js|css|html)$/.test(file) ? "no-cache" : "public, max-age=3600" });
    }

    // ---------- server ----------
    function toHttp(err) {
        if (err instanceof HttpError) return err;
        if (err instanceof ValueError || err instanceof WishlistError || err instanceof UserError) return new HttpError(400, err.message);
        if (err instanceof SteamError) return new HttpError(err.code === "rate_limited" || err.code === "network" ? 503 : 400, err.message);
        if (err instanceof ItadError) return new HttpError(503, err.message);
        log(`${err.name}: ${err.message}`); // never log request bodies
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
            if (key === "POST /auth/logout") { checkWrite(req); return logout(req, res); }

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
                const r = await importLibrary(db, itad, uid, clean);
                db.noteGrabberUse(uid);
                return json(res, 200, { added: r.added, updated: r.updated, notFound: r.notFound.length, skippedForLimit: r.skippedForLimit });
            }

            const handler = routes[key];
            if (!handler) throw new HttpError(404, "Not found.");
            let body = {};
            if (req.method === "POST") {
                checkWrite(req);
                body = await readJson(req, key === "POST /api/value" ? MAX_UPLOAD_CHARS * 2 + 50_000 : key === "POST /api/giveaways/create" ? 60_000 : 20_000);
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

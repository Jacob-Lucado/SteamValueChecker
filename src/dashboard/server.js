// Web dashboard: everything the slash commands do, in a browser. Uses Node's http module only.
// Login is Discord OAuth2 (identify + guilds). Sessions live in memory, so a restart logs everyone out.

import http from "node:http";
import { randomBytes } from "node:crypto";
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
import { importLibrary, libraryView, leaderboard } from "../library.js";
import { addToServerList, serverListView, vote, removeFromServerList } from "../serverlist.js";
import { createLimiter } from "../ratelimit.js";
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
    "/banner.png": ["banner.png", "image/png"],
    "/preview.jpg": ["preview.jpg", "image/jpeg"],
    "/favicon.png": ["favicon.png", "image/png"]
};
const SESSION_MS = 7 * 24 * 3600_000;
const MAX_SESSIONS = 10_000;
const COOKIE = "svc_session";
const STATE_COOKIE = "svc_state";
const COOLDOWNS = { value: 15_000, import: 60_000, add: 3_000, hist: 2_000, lib: 3_000 };
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

export function createDashboard({ db, itad, rest, ops = null, giveaways = null, logs = null, botInfo = null, config, now = () => Date.now(), log = () => {} }) {
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
                "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https://cdn.discordapp.com data:; " +
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
                manageable: isManager(g), alertChannel: db.getGuild(g.id)?.channel_id ?? null,
                groupMin: db.getGuild(g.id)?.group_min ?? 0
            }))
            .sort((a, b) => Number(b.manageable) - Number(a.manageable) || a.name.localeCompare(b.name));
    }

    // ---------- API ----------
    const routes = {
        "GET /api/config": async () => ({
            regions: REGIONS, alertTypes: ALERT_TYPES, fanaticalUrl: FANATICAL_GRABBER_URL,
            help: HELP, about: ABOUT,
            privacy: PRIVACY.split("\n").filter(l => !/github\.com/i.test(l)).join("\n"), maxUploadChars: MAX_UPLOAD_CHARS,
            // View Channel + Send Messages + Embed Links, the least the bot needs to post alerts
            inviteUrl: config.clientId
                ? `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(config.clientId)}&scope=bot%20applications.commands&permissions=19456`
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
                library: db.countLibrary(s.userId)
            };
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
            return addGameByTitle(db, itad, s.userId, body.title, body.type, num(body.value));
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
            const prefInput = Object.fromEntries(["quiet_start", "quiet_end", "tz", "digest", "digest_day", "bundles", "share", "free"].filter(k => body[k] !== undefined).map(k => [k, body[k]]));
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
            if (r.skippedForLimit) throw new HttpError(400, "Your library is full (500 games).");
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

        // ----- free games right now, grouped by platform -----
        // Live numbers for the About panel. Aggregate only, so it is open to everyone like the Help page.
        "GET /api/about": async () => ({ about: botInfo ? botInfo() : null, creator: config.creator ?? null }),

        "GET /api/free": async (req) => {
            session(req);
            const groups = new Map();
            for (const g of await itad.getGiveawayList()) {
                if (!/^https:\/\//i.test(g.url ?? "")) continue;
                if (!groups.has(g.shop)) groups.set(g.shop, []);
                groups.get(g.shop).push({ id: g.id, title: g.title, url: g.url, expiry: g.expiry });
            }
            return { platforms: [...groups].map(([shop, games]) => ({ shop, games })) };
        },

        // ----- giveaways (server managers) -----
        "GET /api/giveaways": async (req, _b, url) => {
            const s = session(req);
            const g = managerGuild(s, url.searchParams.get("guild"));
            const rows = db.listGiveaways(g.id, { limit: 50 }).map(x => {
                const keys = db.listKeys(x.id);
                return { id: x.id, title: x.title, status: x.status, ends_at: x.ends_at, channel_id: x.channel_id, entries: db.countEntries(x.id), prizes: keys.length, redeemed: keys.filter(k => k.status === "confirmed").length };
            });
            return { giveaways: rows, settings: db.getGiveawaySettings(g.id), max: MAX_KEYS };
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
            const { keys, duplicates } = parseKeys(String(body.keys ?? "").slice(0, 20_000), text(body.game) ?? String(body.title ?? "Prize"));
            const r = await giveaways.create({
                guild_id: g.id, channel_id: body.channel_id, host_id: s.userId, title: body.title, duration_ms: parseDuration(body.length),
                game_title: text(body.game), description: text(body.description), image_url: parseImageUrl(body.image, "image"), thumbnail_url: parseImageUrl(body.thumbnail, "thumbnail"),
                color: parseColor(body.color), button_label: text(body.button_label), ping_role_id: text(body.ping_role_id), require_role_id: text(body.require_role_id),
                bonus_role_id: text(body.bonus_role_id), bonus_entries: int(body.bonus_entries), claim_hours: int(body.claim_hours),
                min_account_days: int(body.min_account_days), min_member_days: int(body.min_member_days),
                vouch_channel_id: channels.some(c => c.id === body.vouch_channel_id) ? body.vouch_channel_id : null,
                auto_image: body.auto_image !== false, keys
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
        send(res, 200, body, { "Content-Type": type, "Cache-Control": file === "index.html" ? "no-cache" : "public, max-age=3600" });
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

    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, origin);
            const key = `${req.method} ${url.pathname}`;

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

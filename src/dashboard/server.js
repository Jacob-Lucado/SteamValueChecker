// Web dashboard: everything the slash commands do, in a browser. Uses Node's http module only.
// Login is Discord OAuth2 (identify + guilds). Sessions live in memory, so a restart logs everyone out.

import http from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { REGIONS, ALERT_TYPES, FANATICAL_GRABBER_URL, REPO_URL } from "../constants.js";
import { runValue, ValueError, MAX_UPLOAD_CHARS } from "../value.js";
import { viewRows, findItem, exportJson, addGameByTitle, applySteamImport, WishlistError } from "../wishlist.js";
import { importWishlist, SteamError } from "../steam.js";
import { ItadError } from "../itad.js";
import { parseTrigger, describeTrigger } from "../alerts.js";
import { DiscordApiError } from "./discord.js";
import { HELP, ABOUT, PRIVACY } from "../text.js";

const PUBLIC_DIR = fileURLToPath(new URL("../../public/", import.meta.url));
const FILES = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/app.js": ["app.js", "text/javascript; charset=utf-8"],
    "/style.css": ["style.css", "text/css; charset=utf-8"],
    "/logo.png": ["logo.png", "image/png"],
    "/favicon.png": ["favicon.png", "image/png"]
};
const SESSION_MS = 7 * 24 * 3600_000;
const MAX_SESSIONS = 10_000;
const COOKIE = "svc_session";
const STATE_COOKIE = "svc_state";
const COOLDOWNS = { value: 15_000, import: 60_000, add: 3_000 };
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

export function createDashboard({ db, itad, rest, config, now = () => Date.now(), log = () => {} }) {
    const origin = new URL(config.publicUrl).origin;
    const secure = origin.startsWith("https://");
    const sessions = new Map();
    const states = new Map();
    const lastRun = new Map();
    const cache = new Map();

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

    const num = v => (v === null || v === undefined || v === "" ? null : Number(v));
    const userRow = s => db.ensureUser(s.userId);

    function publicSettings(u) {
        return { region: u.region, stores: u.stores, delivery: u.delivery, paused: Boolean(u.paused), guild_id: u.guild_id, steam_id: u.steam_id };
    }

    function serversFor(s, u) {
        return s.guilds
            .map(g => ({
                id: g.id, name: g.name, icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null,
                manageable: isManager(g), alertChannel: db.getGuild(g.id)?.channel_id ?? null
            }))
            .filter(g => g.manageable || g.alertChannel)
            .sort((a, b) => Number(b.manageable) - Number(a.manageable) || a.name.localeCompare(b.name));
    }

    // ---------- API ----------
    const routes = {
        "GET /api/config": async () => ({
            regions: REGIONS, alertTypes: ALERT_TYPES, fanaticalUrl: FANATICAL_GRABBER_URL, repoUrl: REPO_URL,
            help: HELP, about: ABOUT, privacy: PRIVACY, maxUploadChars: MAX_UPLOAD_CHARS,
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
                servers: serversFor(s, u)
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
        send(res, 200, body, { "Content-Type": type, "Cache-Control": file === "index.html" ? "no-cache" : "public, max-age=3600" });
    }

    // ---------- server ----------
    function toHttp(err) {
        if (err instanceof HttpError) return err;
        if (err instanceof ValueError || err instanceof WishlistError) return new HttpError(400, err.message);
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
                body = await readJson(req, key === "POST /api/value" ? MAX_UPLOAD_CHARS * 2 + 50_000 : 20_000);
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

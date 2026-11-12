// Supporters, requests, notifications and other small pages.
// server.js passes in the helpers it already has (ctx) and merges these routes into its table.
import { CHANGELOG, LATEST } from "../changelog.js";
import { FOUNDERS_MAX, alertColorHex, foundersTaken, isFounder, isSupporter, supporterUntil, wallName } from "../supporters.js";
import { HttpError } from "./http.js";
import { MAX_OPEN_PER_USER, REQUEST_STATUSES } from "../requeststore.js";
import { PLANS, SUPPORTER_XP_BOOST } from "../square.js";
import { REGIONS } from "../constants.js";
import { VOTE_XP } from "../topgg.js";
import { cleanRequest, limitMessage } from "../requests.js";
import { commandGuide } from "../hubpanel.js";
import { hubCommands } from "../commands.js";
import { prefsPatch } from "../prefs.js";
import { publishRequest } from "../requestsync.js";

export function createMiscRoutes(ctx) {
    const { PAGES, checkoutLimit, config, cooldown, db, isOwner, log, now, origin, publicSettings, referrals, remember, rest, session, square, supporters, topgg, userRow } = ctx;
    return {
        "GET /api/topgg": async (req) => {
            const u = session(req);
            if (!topgg?.enabled) return { enabled: false };
            const st = await topgg.status(u.id);
            return { enabled: true, voted: st.voted, nextAt: st.nextAt, votes: st.votes, xp: VOTE_XP, url: `https://top.gg/bot/${encodeURIComponent(config.clientId ?? "")}/vote` };
        },
        "POST /api/tour/done": async (req) => { const s = session(req); userRow(s); db.updateUser(s.userId, { welcomed: 1 }); return { ok: true }; },
        "GET /api/notifications": async (req) => {
            const s = session(req); userRow(s);
            return { items: db.listNotifications(s.userId, 80).map(({ extra, ...n }) => {
                let items = null;
                try { items = JSON.parse(extra ?? "null")?.items ?? null; } catch { /* old or damaged row */ }
                return items ? { ...n, items } : n;
            }), unread: db.unreadNotifications(s.userId) };
        },
        "POST /api/notifications/read": async (req) => { const s = session(req); userRow(s); db.readNotifications(s.userId); return { unread: 0 }; },
        "GET /api/commands": async () => remember("commandguide", 3600_000, () => ({ hubs: commandGuide(hubCommands) })),
        "GET /api/changelog": async (req) => {
            const s = session(req); const u = userRow(s);
            db.updateUser(s.userId, { seen_version: LATEST });
            return { entries: CHANGELOG, wasNew: u.seen_version !== LATEST };
        },
        "POST /api/changelog/seen": async (req) => { const s = session(req); userRow(s); db.updateUser(s.userId, { seen_version: LATEST }); return { ok: true }; },
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
            const prefInput = Object.fromEntries(["quiet_start", "quiet_end", "tz", "digest", "digest_day", "bundles", "share", "free", "free_dlc", "dlc", "refund", "milestones", "yearly", "nudge", "achv", "nowplaying", "playtest", "playtest_skip", "news", "min_discount", "max_price", "lows_only", "muted", "lang"].filter(k => body[k] !== undefined).map(k => [k, body[k]]));
            Object.assign(patch, prefsPatch(prefInput, u));
            db.updateUser(s.userId, patch);
            return { settings: publicSettings(db.getUser(s.userId)) };
        },
        // ----- supporter passes -----
        "GET /api/supporter": async (req) => {
            const s = session(req), until = supporterUntil(db, s.userId);
            return { enabled: Boolean(square?.enabled), plans: PLANS, until: until > now() ? until : null, boost: SUPPORTER_XP_BOOST, founder: isFounder(db, s.userId), wall: wallName(db, s.userId), alert_color: alertColorHex(db, s.userId), founding_left: Math.max(0, FOUNDERS_MAX - foundersTaken(db)) };
        },
        "POST /api/supporter/wall": async (req, body) => {
            const s = session(req);
            if (!supporters) throw new HttpError(404, "Not found.");
            if (!isSupporter(db, s.userId, now()) && !isFounder(db, s.userId)) throw new HttpError(403, "The wall is for supporters.");
            return { wall: supporters.setWall(s.userId, body.on === false ? "" : body.name) };
        },
        "POST /api/supporter/alertcolor": async (req, body) => {
            const s = session(req);
            if (!supporters) throw new HttpError(404, "Not found.");
            if (!isSupporter(db, s.userId, now()) && !isFounder(db, s.userId)) throw new HttpError(403, "Alert colors are a supporter perk.");
            try { return { alert_color: supporters.setAlertColor(s.userId, body.color) }; } catch (e) { throw new HttpError(400, e.message); }
        },
        "POST /api/supporter/checkout": async (req, body) => {
            const s = session(req);
            if (!square?.enabled) throw new HttpError(404, "Supporter passes aren't switched on yet.");
            if (!checkoutLimit.hit("u" + s.userId).ok) throw new HttpError(429, "Slow down a little.");
            let target = s.userId, giftFrom = null;
            const to = String(body.gift_to ?? "").trim().replace(/^@/, "").toLowerCase();
            if (to) {
                const hit = /^\d{5,25}$/.test(to) ? db.getUser(to) : db.getProfileBySlug(to);
                if (!hit) throw new HttpError(404, "I couldn't find anyone by that page name or ID. They need to have used the bot or turned on their profile page.");
                if (hit.discord_id === s.userId) throw new HttpError(400, "That's you. Use the normal buttons to buy a pass for yourself.");
                target = hit.discord_id; giftFrom = s.userId;
            }
            try { return { url: await square.checkout({ userId: target, planId: String(body.plan ?? ""), redirectUrl: `${origin}/#/tip?thanks=${giftFrom ? "gift" : "1"}`, giftFrom }) }; }
            catch (e) { log(`[square] ${e.message}`); throw new HttpError(400, /Pick one|Sign in|switched on/.test(e.message) ? e.message : "Couldn't open the checkout page. Try again in a minute."); }
        },
        "GET /api/referral": async (req) => {
            const s = session(req);
            if (!s) throw new HttpError(401, "Sign in first.");
            if (!referrals) throw new HttpError(404, "Not found.");
            return referrals.stats(s.userId);
        },
        // ----- feature requests: members suggest and vote, the owner sets the status -----
        "GET /api/requests": async (req, _b, url) => {
            const s = session(req);
            const status = url.searchParams.get("status");
            return { requests: db.listRequests(s.userId, { status: REQUEST_STATUSES[status] ? status : null, sort: url.searchParams.get("sort") === "new" ? "new" : "votes" }),
                statuses: REQUEST_STATUSES, counts: db.requestCounts(), max: MAX_OPEN_PER_USER, isOwner: isOwner(s) };
        },
        "POST /api/requests": async (req, body) => {
            const s = session(req);
            const { title, body: text } = cleanRequest({ title: body.title, body: body.body });
            if (db.openCountFor(s.userId) >= MAX_OPEN_PER_USER) throw new HttpError(429, limitMessage());
            const undo = cooldown(s.userId, "request");
            let id;
            try { id = db.addRequest({ userId: s.userId, userName: s.username ?? null, title, body: text }); } catch (e) { undo(); throw e; }
            publishRequest({ db, api: rest, id, base: config.publicUrl }).catch(() => {}); // into each server's feature-requests forum, in the background
            return { id };
        },
        "POST /api/requests/vote": async (req, body) => {
            const s = session(req); cooldown(s.userId, "requestvote");
            const r = db.getRequest(Number(body.id));
            if (!r) throw new HttpError(404, "I can't find that request.");
            return { voted: db.toggleRequestVote(r.id, s.userId) };
        },
    };
}

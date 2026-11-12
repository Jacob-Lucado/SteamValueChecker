// The owner admin panel's API: indie review, admin accounts and sign-in, the staff chat and radio, bans and broadcasts, tickets, giveaways and logs.
// server.js passes in the helpers it already has (ctx) and merges these routes into its table.
import { parseRegions } from "../gwregion.js";
import { videoFromBody } from "../gwmedia.js";
import { HttpError } from "./http.js";
import { MAX_BODY } from "../broadcast.js";
import { PANEL_AREAS, cleanEdit } from "../paneluser.js";
import { REQUEST_STATUSES } from "../requeststore.js";
import { STEP_KINDS, StepError, parseHost, parseSteps } from "../gwpartner.js";
import { USERNAME_RE, checkPassword, matchTotp, newTotpSecret, passwordProblem, totpUri } from "../adminlogin.js";
import { UserError } from "../errors.js";
import { enrichFree } from "../freeinfo.js";
import { indieSpotlightText } from "../indiemeta.js";
import { isHidden } from "../hidden.js";
import { join } from "node:path";
import { parseColor, parseDuration, parseImageUrl, parseKeys } from "../gwparse.js";
import { randomBytes } from "node:crypto";
import { readEvents } from "../adminlog.js";
import v8 from "node:v8";

export function createAdminRoutes(ctx) {
    const { indiePublic, COOKIE, RADIO_MAX, WALLS, adminHost, botInfo, broadcaster, chatChannel, chatLimit, chatMe, chatPeople, chatSeen, chatSession, chatTyping, cleanLook, commandWatch, community, config, cookieDomain, cookies, cooldown, db, dm, dropFiles, giveaways, guildInvite, guildList, health, indieApi, isOwner, itad, leaveGuild, log, logs, membersIntent, needGiveaways, needTickets, now, offsite, ops, origin, outcomeOf, pendingClaimsFor, remember, rest, session, sessions, spotlight, storage, syncIndieDev, ticketAccess, tickets, verifyCurrent, weekly, xposter } = ctx;
    return {
        "GET /api/admin/indie": async (req, _b, url) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            const status = ["pending", "approved", "rejected"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "pending";
            const { games } = db.indieList({ status, limit: 60, sort: "new" });
            return { open: db.getMeta("indie:open") !== "0", counts: db.indieCounts(), totals: db.indieTotals(), games: games.map(g => ({ ...indiePublic(g), status: g.status, note: g.note, owner: g.owner_id, views: g.views, clicks: g.clicks, created: g.created, reports: db.indieReportsFor(g.id) })), reports: db.indieReports("open").length };
        },
        "POST /api/admin/indie/open": async (req, body) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            db.setMeta("indie:open", body.open ? "1" : "0");
            return { open: Boolean(body.open) };
        },
        "POST /api/admin/indie/review": async (req, body) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            if (body.action === "syncall") { const n = await indieApi.syncDue(db, { limit: 30 }); return { ok: true, synced: n, counts: db.indieCounts() }; }
            const g = db.indieGet(body.id);
            if (!g) throw new HttpError(404, "That game is gone.");
            const note = String(body.note ?? "").trim().slice(0, 300) || null, tell = (title, text) => { try { db.addNotification(g.owner_id, { type: "indie", title, body: text, url: "/indie/mine" }); } catch { /* best effort */ } };
            switch (body.action) {
                case "approve": db.indieDecide(g.id, "approved", note); tell(`${g.title} is live in the indie showcase`, "People can find it now. Share the page anywhere you like."); break;
                case "reject": db.indieDecide(g.id, "rejected", note); tell(`${g.title} wasn't accepted yet`, note || "You can edit your pitch and send it back in."); break;
                case "remove": db.indieRemove(g.id); break;
                case "xpost": {
                    if (!xposter) throw new HttpError(503, "X posting isn't available on this bot.");
                    if (g.status !== "approved") throw new HttpError(400, "Approve the game first.");
                    try { await xposter.manual({ text: indieSpotlightText(g, `${origin}/indie/game/${g.id}`), kind: "auto" }); } catch (e) { throw new HttpError(400, e.message); }
                    break;
                }
                case "verify": db.indieSetVerified(g.id, true); tell(`${g.title} is now verified`, "Your game page shows the verified mark."); break;
                case "unverify": db.indieSetVerified(g.id, false); break;
                case "feature": db.indieFeature(g.id, true); break;
                case "unfeature": db.indieFeature(g.id, false); break;
                case "refresh": { try { const fresh = await indieApi.lookup(g.appid); db.indieRefresh(g.id, fresh); } catch (e) { throw new HttpError(400, e.message); } break; }
                default: throw new HttpError(400, "Unknown action.");
            }
            if (["approve", "reject", "remove"].includes(body.action)) await syncIndieDev(g.owner_id, body.action === "approve" ? g : null);
            return { ok: true, counts: db.indieCounts() };
        },
        "GET /api/admin/indie/reports": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            return { reports: db.indieReports("open").map(r => ({ id: r.id, gameId: r.game_id, title: r.title, appid: r.appid, image: r.image, reason: r.reason, reporter: r.reporter, created: r.created })) };
        },
        "POST /api/admin/indie/report": async (req, body) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            const g = db.indieGet(body.gameId);
            if (!g) throw new HttpError(404, "That game is gone.");
            db.indieResolveReports(g.id, body.action === "remove" ? "actioned" : "closed");
            if (body.action === "remove") { db.indieDecide(g.id, "rejected", "Taken down after a report."); try { db.addNotification(g.owner_id, { type: "indie", title: `${g.title} was taken down`, body: "It was reported and a person looked at it. Edit and resubmit if you think that's a mistake.", url: "/indie/mine" }); } catch { /* best effort */ } }
            return { ok: true };
        },
        "GET /api/admin/indie/spotlight": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            if (!spotlight) throw new HttpError(503, "The weekly spotlight isn't available.");
            return spotlight.status();
        },
        "POST /api/admin/indie/spotlight": async (req, body) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            if (!spotlight) throw new HttpError(503, "The weekly spotlight isn't available.");
            if (body.run) { const r = await spotlight.run({ force: true, gameId: body.gameId || null }); return { ran: r, ...spotlight.status() }; }
            try { return spotlight.set({ on: body.on, channel: body.channel }); } catch (e) { if (e instanceof UserError) throw new HttpError(400, e.message); throw e; }
        },
        "GET /api/admin/problems": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            return { list: readEvents(db, "adminlog:problems", 40) };
        },
        "POST /api/admin/problems/clear": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            db.setMeta("adminlog:problems", "[]");
            return { ok: true };
        },
        "GET /api/admin/xposter/next": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            if (!xposter) throw new HttpError(503, "X posting isn't available on this bot.");
            let list = [];
            try { list = await enrichFree(await itad.getGiveawayList()); } catch { /* shown as nothing queued */ }
            return xposter.peek(list);
        },
        "GET /api/admin/datarequests": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            const list = readEvents(db, "adminlog:datareq", 100), since = now() - 30 * 86400_000;
            return { list, month: { export: list.filter(r => r.kind === "export" && r.at > since).length, delete: list.filter(r => r.kind === "delete" && r.at > since).length } };
        },
        "GET /api/admin/serverevents": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            return { list: readEvents(db, "adminlog:servers", 30) };
        },
        "GET /api/admin/commandwatch": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            return commandWatch ? commandWatch.report() : { threshold: 0, rows: [] };
        },
        "GET /api/admin/offsite": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            if (!offsite?.enabled) return { enabled: false };
            let list = [], error = null;
            try { list = (await offsite.list()).slice(-14).reverse(); } catch (e) { error = e.message; }
            let last = null; try { last = JSON.parse(db.getMeta("offsite:last") || "null"); } catch { /* none yet */ }
            return { enabled: true, list, last, error };
        },
        "POST /api/admin/offsite/verify": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            if (!offsite?.enabled) throw new HttpError(400, "Offsite backups aren't set up.");
            try { return await offsite.verify(); } catch (e) { throw new HttpError(400, e.message || "The check failed."); }
        },
        "GET /api/admin/storage": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            return storage ? await storage() : { volume: null, dbMb: 0, walMb: 0, backupsMb: 0, backupCount: 0, tables: [] };
        },
        "GET /api/admin/system": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const mem = process.memoryUsage(), heap = v8.getHeapStatistics();
            const lag = await new Promise(r => { const t0 = process.hrtime.bigint(); setImmediate(() => r(Number(process.hrtime.bigint() - t0) / 1e6)); });
            const t = now();
            let live = 0; for (const v of sessions.values()) if (v.expires > t) live++;
            return {
                process: { uptimeS: Math.round(process.uptime()), rssMb: Math.round(mem.rss / 1048576), heapMb: Math.round(mem.heapUsed / 1048576), heapLimitMb: Math.round(heap.heap_size_limit / 1048576), node: process.version, platform: process.platform, lagMs: Math.round(lag * 10) / 10 },
                sessions: { signedIn: live, steamOnly: [...sessions.values()].filter(v => v.expires > t && v.steamOnly).length },
                bot: botInfo ? botInfo() : null,
                errors: ops ? (ops.snapshot()?.errors ?? []).slice(0, 10) : [],
                jobs: ops ? Object.entries(ops.snapshot()?.jobs ?? {}).map(([name, j]) => ({ name, ...j })) : [],
                admin: { host: adminHost, sharedCookie: Boolean(cookieDomain) },
                // which release and machine answered, so a deploy that didn't take is easy to spot
                deploy: { release: String(process.env.FLY_IMAGE_REF ?? "").split(":").pop().slice(0, 40) || null, machine: process.env.FLY_MACHINE_ID ?? null, region: process.env.FLY_REGION ?? null, startedAt: Date.now() - Math.round(process.uptime()) * 1000 }
            };
        },
        // The owner's own username and password, a second way into this panel. Changing anything needs the current password again.
        "GET /api/admin/account": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const r = db.getAdminLogin(config.ownerId);
            return { exists: Boolean(r), username: r?.username ?? null, created: r?.created ?? null, lastLogin: r?.last_login ?? null, totp: Boolean(r?.totp_on), pendingTotp: Boolean(r?.totp_secret && !r?.totp_on), viaPassword: Boolean(s.adminOnly) };
        },
        "POST /api/admin/account/save": async (req, b) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            const prev = db.getAdminLogin(config.ownerId);
            if (prev) verifyCurrent(prev, b.current);
            const username = String(b.username ?? "").trim().toLowerCase();
            if (!USERNAME_RE.test(username)) throw new HttpError(400, "The username needs 3 to 32 letters, numbers, dots, dashes or underscores, starting with a letter or number.");
            const bad = passwordProblem(b.password, username);
            if (bad) throw new HttpError(400, bad);
            db.saveAdminLogin(config.ownerId, username, String(b.password));
            const mine = cookies(req)[COOKIE];
            for (const [k, v] of sessions) if (v.adminOnly && !v.subAdmin && k !== mine) sessions.delete(k); // other password sessions end when the password changes
            return { ok: true, username };
        },
        "POST /api/admin/account/remove": async (req, b) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            const prev = db.getAdminLogin(config.ownerId);
            if (!prev) return { ok: true };
            verifyCurrent(prev, b.current);
            db.removeAdminLogin(config.ownerId);
            for (const [k, v] of sessions) if (v.adminOnly && !v.subAdmin) sessions.delete(k);
            return { ok: true };
        },
        "POST /api/admin/account/totp/start": async (req, b) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            const prev = db.getAdminLogin(config.ownerId);
            if (!prev) throw new HttpError(400, "Make a username and password first.");
            verifyCurrent(prev, b.current);
            const secret = newTotpSecret();
            db.setAdminTotp(config.ownerId, secret, false);
            return { secret, uri: totpUri(secret, prev.username) };
        },
        "POST /api/admin/account/totp/enable": async (req, b) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            const r = db.getAdminLogin(config.ownerId);
            if (!r?.totp_secret) throw new HttpError(400, "Start the setup first.");
            const step = matchTotp(r.totp_secret, b.code, now(), r.totp_step);
            if (!step) throw new HttpError(400, "That code is not right. Check the clock on your phone and try the next one.");
            db.setAdminTotp(config.ownerId, r.totp_secret, true);
            db.useAdminTotpStep(config.ownerId, step);
            return { ok: true };
        },
        "POST /api/admin/account/totp/disable": async (req, b) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            const r = db.getAdminLogin(config.ownerId);
            if (!r) return { ok: true };
            verifyCurrent(r, b.current);
            db.setAdminTotp(config.ownerId, null, false);
            return { ok: true };
        },
        // Extra panel logins the owner hands out. They open this admin panel and nothing else, and they never touch bot commands.
        "GET /api/admin/admins": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            return { admins: db.listAdminAccess(), areas: PANEL_AREAS.map(a => ({ id: a.id, label: a.label })) };
        },
        "POST /api/admin/admins/add": async (req, b) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (db.listAdminAccess().length >= 25) throw new HttpError(400, "That's plenty of admin users. Remove one before adding another.");
            const edit = cleanEdit(b.edit);
            if (b.kind === "discord") {
                const id = String(b.discordId ?? "").trim();
                if (!/^\d{17,20}$/.test(id)) throw new HttpError(400, "A Discord ID is 17 to 20 digits. Turn on Developer Mode in Discord, right-click the person and choose Copy User ID.");
                if (id === config.ownerId) throw new HttpError(400, "That's you. You already have full access.");
                if (db.getAdminAccess(id)) throw new HttpError(409, "That person is already an admin user.");
                db.setAdminAccess(id, "discord", String(b.label ?? "").trim().slice(0, 40), edit);
                try { db.logAudit({ actor: config.ownerId, action: "admin-user-add", target: id, detail: "discord" }); } catch { /* best effort */ }
                return { ok: true, id };
            }
            const username = String(b.username ?? "").trim().toLowerCase();
            if (!USERNAME_RE.test(username)) throw new HttpError(400, "The username needs 3 to 32 letters, numbers, dots, dashes or underscores, starting with a letter or number.");
            const bad = passwordProblem(b.password, username);
            if (bad) throw new HttpError(400, bad);
            if (db.getAdminLoginByName(username)) throw new HttpError(409, "Someone already has that username.");
            const id = "adm-" + randomBytes(6).toString("hex");
            db.saveAdminLogin(id, username, String(b.password));
            db.setAdminAccess(id, "password", username, edit);
            try { db.logAudit({ actor: config.ownerId, action: "admin-user-add", target: username, detail: id }); } catch { /* best effort */ }
            return { ok: true, id };
        },
        // What one admin user may change.
        "POST /api/admin/admins/access": async (req, b) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!db.getAdminAccess(b.id)) throw new HttpError(404, "That admin user isn't there anymore.");
            db.setAdminAccessEdit(b.id, cleanEdit(b.edit));
            try { db.logAudit({ actor: config.ownerId, action: "admin-user-access", target: String(b.id), detail: JSON.stringify(cleanEdit(b.edit)) }); } catch { /* best effort */ }
            return { ok: true };
        },
        "POST /api/admin/admins/reset": async (req, b) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            const row = /^adm-[0-9a-f]{12}$/.test(String(b.id)) && db.getAdminAccess(b.id) ? db.getAdminLogin(b.id) : null;
            if (!row) throw new HttpError(404, "That admin user isn't there anymore, or signs in with Discord.");
            const bad = passwordProblem(b.password, row.username);
            if (bad) throw new HttpError(400, bad);
            db.saveAdminLogin(row.owner_id, row.username, String(b.password));
            for (const [k, v] of sessions) if (v.userId === row.owner_id) sessions.delete(k);
            try { db.logAudit({ actor: config.ownerId, action: "admin-user-reset", target: row.username, detail: row.owner_id }); } catch { /* best effort */ }
            return { ok: true };
        },
        "POST /api/admin/admins/remove": async (req, b) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            const id = String(b.id ?? "");
            if (!id || id === config.ownerId || !db.getAdminAccess(id)) return { ok: true };
            db.removeAdminAccess(id);
            for (const [k, v] of sessions) if (v.userId === id && v.subAdmin) sessions.delete(k);
            try { db.logAudit({ actor: config.ownerId, action: "admin-user-remove", target: id, detail: "" }); } catch { /* best effort */ }
            return { ok: true };
        },
        // ---- the staff chat: the owner and the people let into the panel ----
        "GET /api/admin/chat/state": async (req) => {
            const s = chatSession(req); const me = chatMe(s); chatSeen(me);
            const people = chatPeople();
            const dms = db.staffDmRooms(me.key);
            const rooms = [...db.staffChannels().map(c => c.id), ...dms], unread = db.staffUnread(me.key, rooms);
            const latest = {}; for (const c of Object.keys(unread)) { const m = db.lastStaffMsg(c); if (m) latest[c] = { id: m.id, name: m.name, body: String(m.body).slice(0, 140) || "Sent a picture or clip" }; }
            return { me, channels: db.staffChannels(), people, unread, mentions: db.staffMentions(me.key, me.name, rooms), latest, dmRooms: dms };
        },
        "GET /api/admin/chat/messages": async (req, _b, url) => {
            const s = chatSession(req); const me = chatMe(s); chatSeen(me);
            const channel = chatChannel(me, String(url.searchParams.get("channel") ?? ""));
            const after = Math.max(0, Number(url.searchParams.get("after")) || 0);
            const messages = db.staffMessages(channel, after);
            if (messages.length) db.markStaffRead(me.key, channel, messages[messages.length - 1].id);
            const t = Date.now(), typing = [...(chatTyping.get(channel) ?? new Map())].filter(([k, at]) => k !== me.key && t - at < 5000).map(([k]) => chatPeople().find(p => p.key === k)?.name ?? "Someone");
            return { messages, typing, people: chatPeople().map(p => ({ key: p.key, online: p.online })) };
        },
        "POST /api/admin/chat/send": async (req, b) => {
            const s = chatSession(req); const me = chatMe(s);
            if (!chatLimit.hit(me.key).ok) throw new HttpError(429, "Slow down a little.");
            const channel = chatChannel(me, String(b.channel ?? ""));
            const body = String(b.body ?? "").replace(/\r/g, "").trim();
            const media = b.media ? db.getStaffMedia(String(b.media)) : null;
            if (b.media && (!media || media.owner !== me.key || media.msg)) throw new HttpError(400, "That picture didn't upload. Try attaching it again.");
            if (!body && !media) throw new HttpError(400, "Type something first.");
            const reply = b.reply && db.getStaffMsg(b.reply)?.channel === channel ? Number(b.reply) : null;
            const id = db.sendStaff(channel, me.key, me.name, body, reply, media?.id ?? null);
            db.markStaffRead(me.key, channel, id); chatSeen(me);
            return { ok: true, id };
        },
        // How the desktop looks for each person signed in: the look and the wallpaper. Everyone on the panel may change their own.
        "GET /api/admin/prefs": async (req) => {
            const s = chatSession(req); const me = chatMe(s);
            let p = {}; try { p = JSON.parse(db.getMeta("admprefs:" + me.key) || "{}"); } catch { /* fresh */ }
            return { prefs: cleanLook(p), walls: WALLS.map(w => ({ id: w.id, name: w.name, css: w.css })) };
        },
        "POST /api/admin/prefs": async (req, b) => {
            const s = chatSession(req); const me = chatMe(s);
            const p = cleanLook(b);
            db.setMeta("admprefs:" + me.key, JSON.stringify(p));
            return { ok: true, prefs: p };
        },
        // ----- radio: SoundCloud links the staff add, played from one shared list -----
        "GET /api/admin/radio": async (req) => {
            const s = chatSession(req); const me = chatMe(s);
            return { tracks: db.radioList().map(t => ({ id: t.id, title: t.title, author: t.author, art: t.art, embed: t.embed, url: t.url, by: t.by_name, mine: t.by_key === me.key, at: t.at })), owner: me.owner, max: RADIO_MAX };
        },
        "POST /api/admin/radio/add": async (req, b) => {
            const s = chatSession(req); const me = chatMe(s);
            if (!chatLimit.hit(me.key).ok) throw new HttpError(429, "Slow down a little.");
            let u; try { u = new URL(String(b.url ?? "").trim()); } catch { throw new HttpError(400, "That doesn't look like a link."); }
            if (u.protocol !== "https:" || !/^(www\.|m\.)?soundcloud\.com$|^on\.soundcloud\.com$/.test(u.hostname)) throw new HttpError(400, "Paste a SoundCloud link, like https://soundcloud.com/artist/track.");
            if (db.radioCount() >= RADIO_MAX) throw new HttpError(400, `The radio holds ${RADIO_MAX} tracks. Remove a few first.`);
            let info;
            try {
                const r = await (config.soundcloudFetch ?? globalThis.fetch)(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(u.toString())}`, { signal: AbortSignal.timeout(10_000) });
                if (!r.ok) throw new Error(String(r.status));
                info = await r.json();
            } catch { throw new HttpError(400, "SoundCloud didn't know that link. Check it's a public track or set."); }
            const src = /src="(https:\/\/w\.soundcloud\.com\/player\/\?[^"]+)"/.exec(String(info.html ?? ""))?.[1]?.replace(/&amp;/g, "&");
            let embed = null; try { embed = new URL(src).searchParams.get("url"); } catch { /* handled below */ }
            if (!embed || !/^https:\/\/api\.soundcloud\.com\/(tracks|playlists)\/\d+$/.test(embed)) throw new HttpError(400, "I couldn't play that one. Try another link.");
            if (db.radioHas(embed)) throw new HttpError(409, "That one is already on the radio.");
            const art = /^https:\/\/[a-z0-9.-]*sndcdn\.com\//.test(String(info.thumbnail_url ?? "")) ? info.thumbnail_url : null;
            const id = db.radioAdd({ url: u.toString().slice(0, 300), embed, title: String(info.title ?? "Untitled").replace(/\s+by\s+.+$/i, ""), author: info.author_name ?? "", art, by_key: me.key, by_name: me.name });
            return { ok: true, id };
        },
        "POST /api/admin/radio/remove": async (req, b) => {
            const s = chatSession(req); const me = chatMe(s);
            const t = db.radioGet(b.id);
            if (!t) return { ok: true };
            if (t.by_key !== me.key && !me.owner) throw new HttpError(403, "You can only remove tracks you added.");
            db.radioRemove(t.id);
            return { ok: true };
        },
        "POST /api/admin/chat/typing": async (req, b) => {
            const s = chatSession(req); const me = chatMe(s);
            const channel = chatChannel(me, String(b.channel ?? ""));
            if (!chatTyping.has(channel)) chatTyping.set(channel, new Map());
            chatTyping.get(channel).set(me.key, Date.now());
            return { ok: true };
        },
        "POST /api/admin/chat/edit": async (req, b) => {
            const s = chatSession(req); const me = chatMe(s);
            const m = db.getStaffMsg(b.id);
            if (!m) throw new HttpError(404, "That message is gone.");
            if (m.author !== me.key) throw new HttpError(403, "You can only edit your own messages.");
            const body = String(b.body ?? "").replace(/\r/g, "").trim();
            if (!body) throw new HttpError(400, "A message can't be empty. Delete it instead.");
            db.editStaffMsg(m.id, body);
            return { ok: true };
        },
        "POST /api/admin/chat/react": async (req, b) => {
            const s = chatSession(req); const me = chatMe(s);
            const m = db.getStaffMsg(b.id), emoji = String(b.emoji ?? "");
            if (!m) throw new HttpError(404, "That message is gone.");
            if (!["👍", "❤️", "😂", "🎉", "👀", "✅", "🙏", "🔥"].includes(emoji)) throw new HttpError(400, "Pick one of the listed reactions.");
            chatChannel(me, m.channel);
            db.toggleStaffReact(m.id, me.key, emoji);
            return { ok: true };
        },
        "GET /api/admin/chat/requests": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const list = db.listRequests(s.userId, { sort: "new" }).map(r => ({ id: r.id, title: r.title, body: String(r.body ?? "").slice(0, 1500), status: r.status, note: r.note, user_name: r.user_name, votes: r.votes, created_at: r.created_at }));
            return { requests: list, statuses: REQUEST_STATUSES, open: list.filter(r => r.status === "open").length };
        },
        "POST /api/admin/chat/delete": async (req, b) => {
            const s = chatSession(req); const me = chatMe(s);
            const m = db.getStaffMsg(b.id);
            if (!m) return { ok: true };
            if (m.author !== me.key && !me.owner) throw new HttpError(403, "You can only delete your own messages.");
            dropFiles(db.staffMediaOfMsg(m.id));
            db.deleteStaffMsg(m.id);
            return { ok: true };
        },
        "POST /api/admin/chat/channel": async (req, b) => {
            const s = chatSession(req); const me = chatMe(s);
            if (!me.owner) throw new HttpError(403, "Only the owner can add channels.");
            if (db.staffChannels().length >= 12) throw new HttpError(400, "That's enough channels for now.");
            const id = db.addStaffChannel(b.name);
            if (!id) throw new HttpError(400, "Pick a different name. Use letters, numbers and dashes, and not one that already exists.");
            return { ok: true, id };
        },
        "POST /api/admin/chat/channel/delete": async (req, b) => {
            const s = chatSession(req); const me = chatMe(s);
            if (!me.owner) throw new HttpError(403, "Only the owner can remove channels.");
            if (["general", "support"].includes(String(b.id))) throw new HttpError(400, "That one stays.");
            dropFiles(db.staffMediaOfChannel(String(b.id)));
            db.removeStaffChannel(String(b.id));
            return { ok: true };
        },
        // A panel user changing their own password.
        "POST /api/admin/self/password": async (req, b) => {
            const s = session(req);
            if (!s.viaSub) throw new HttpError(403, "This is for admin users. The owner changes the password on the Account page.");
            const row = db.getAdminLogin(s.viaSub);
            if (!row) throw new HttpError(400, "You sign in with Discord, so there is no password to change.");
            const t = now();
            if (row.locked_until > t) throw new HttpError(429, "Too many wrong passwords. Try again later.");
            if (!checkPassword(String(b.current ?? ""), row.salt, row.hash)) { db.failAdminLogin(row.owner_id, t); throw new HttpError(403, "That is not your current password."); }
            const bad = passwordProblem(b.password, row.username);
            if (bad) throw new HttpError(400, bad);
            db.saveAdminLogin(row.owner_id, row.username, String(b.password));
            const mine = cookies(req)[COOKIE];
            for (const [k, v] of sessions) if (v.userId === row.owner_id && k !== mine) sessions.delete(k);
            return { ok: true };
        },
        // Names for Discord IDs shown on admin pages, so a number is easy to put a face to. Unknown IDs just come back without a name.
        "GET /api/admin/names": async (req, _b, url) => {
            const s = session(req);
            if (!isOwner(s) && !s.subAdmin) throw new HttpError(403, "Only admins can look names up.");
            const ids = [...new Set(String(url.searchParams.get("ids") ?? "").split(",").filter(x => /^\d{15,22}$/.test(x)))].slice(0, 40);
            const names = {};
            await Promise.all(ids.map(async id => {
                const n = db.getMeta?.("staffname:" + id) || await remember("uname:" + id, 6 * 3_600_000, async () => (await rest?.userName?.(id)) ?? null).catch(() => null);
                if (n) names[id] = String(n).slice(0, 60);
            }));
            return { names };
        },
        "GET /api/admin/stats": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            return { stats: db.stats(), health: ops ? ops.snapshot() : null };
        },

        // How often each command is run from a panel's Run button (counts only), so you can see which panels people use.
        "GET /api/admin/panels": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const rows = db.listMetaPrefix("pnuse:").map(r => ({ command: "/" + r.key.slice(6), runs: Number(r.value) })).sort((a, b) => b.runs - a.runs).slice(0, 100);
            return { rows, total: rows.reduce((t, r) => t + r.runs, 0) };
        },

        "GET /api/admin/insights": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const ins = db.adminInsights(), info = botInfo ? botInfo() : null, mem = process.memoryUsage();
            const live = (guildList ? guildList() : []).filter(g => !isHidden(g.id));
            const byId = new Map(live.map(g => [g.id, g]));
            // Every server the bot is in, with what has been set up there. Servers that never set anything are still listed.
            const rows = new Map(ins.servers.filter(r => !isHidden(r.id)).map(r => [r.id, r]));
            const blocked = new Map(db.blockedGuilds().map(b => [b.id, b]));
            const servers = [...new Set([...live.map(g => g.id), ...rows.keys(), ...blocked.keys()])].map(id => ({ blocked: blocked.has(id) ? blocked.get(id).reason || "blocked" : null, id, name: byId.get(id)?.name ?? null, members: byId.get(id)?.members ?? null, tracked: rows.get(id)?.members ?? 0, channel: rows.has(id), freeFeed: Boolean(rows.get(id)?.free_feed), groupMin: rows.get(id)?.group_min ?? 0, digest: Boolean(rows.get(id)?.weekly_digest), inServer: guildList ? byId.has(id) : null }))
                .sort((a, b) => (b.members ?? 0) - (a.members ?? 0) || b.tracked - a.tracked);
            const fun = db.funnelStats(Date.now() - 30 * 86400_000);
            return { ...ins, funnel: { joined: fun.joined, started: fun.started, setup: fun.setup, recent: fun.recent.map(r => ({ id: r.id, name: byId.get(r.id)?.name ?? null, join: r.join, start: r.start ?? null, setup: r.setup ?? null })) }, servers, bot: { version: info?.version ?? null, uptime: info?.uptime ?? null, pingMs: info?.pingMs ?? null, servers: info?.servers ?? null, rssMb: Math.round(mem.rss / 1048576), node: process.version } };
        },
        // What the community features are being used for, across every server (counts only, never messages).
        "GET /api/admin/community": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const live = new Map((guildList?.() ?? []).filter(g => !isHidden(g.id)).map(g => [g.id, g]));
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
        "GET /api/admin/server-members": async (req, _b, url) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const gid = String(url.searchParams.get("guild") ?? "");
            if (!/^\d{5,25}$/.test(gid) || isHidden(gid)) throw new HttpError(404, "Unknown server.");
            const days = Math.min(365, Math.max(0, Number(url.searchParams.get("days") ?? 30) || 0));
            const members = db.serverMembers(gid, { activeDays: days, limit: 200 });
            // Names are a nice-to-have; ask Discord for the first batch and carry on without them if it won't say.
            await Promise.all(members.slice(0, 60).map(async m => {
                try { const r = await rest.getMember?.(gid, m.id); const u = r?.user ?? r; m.name = r?.nick || u?.global_name || u?.username || null; if (u?.username) m.username = u.username; } catch { /* left the server, or Discord is busy */ }
            }));
            return { members, days };
        },
        "GET /api/admin/bans": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            return { bans: db.listBans() };
        },
        "POST /api/admin/ban": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            const id = String(body.id ?? "").replace(/\D/g, "");
            if (!/^\d{5,25}$/.test(id)) throw new HttpError(400, "Paste a Discord user ID (numbers only).");
            if (id === config.ownerId) throw new HttpError(400, "You can't restrict yourself.");
            if (body.ban === false) { db.unbanUser(id); log(`Bot owner lifted the restriction on ${id}`); return { banned: false, id }; }
            db.banUser(id, String(body.reason ?? ""), s.userId);
            for (const [k, v] of sessions) if (v.userId === id) sessions.delete(k); // signed out right away
            log(`Bot owner restricted ${id}`);
            return { banned: true, id };
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
                const r = broadcaster().start({ title: body.title, body: body.body, audience, promo: body.kind === "promo", preset: body.kind === "preset" ? String(body.preset ?? "") : null, mention: ["everyone", "here"].includes(body.mention) ? body.mention : "none" });
                log(`Bot owner started broadcast #${r.id} to ${audience} (${r.total} recipient${r.total === 1 ? "" : "s"})`);
                return { ...r, current: broadcaster().current() };
            } catch (e) { undo(); if (e instanceof UserError) throw new HttpError(400, e.message); throw e; }
        },

        "POST /api/admin/server/leave": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            const id = String(body.id ?? "");
            if (!/^\d{5,25}$/.test(id)) throw new HttpError(400, "Pick a server first.");
            const block = Boolean(body.block);
            if (block) db.blockGuild(id, String(body.reason ?? ""));
            let left = false;
            if (leaveGuild) { try { left = await leaveGuild(id); } catch (e) { if (!block) throw new HttpError(400, e.message || "Could not leave that server."); } }
            log(`Bot owner ${block ? "blocked" : "left"} server ${id}`);
            return { left: Boolean(left), blocked: block };
        },

        "POST /api/admin/server/unblock": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            return { unblocked: db.unblockGuild(String(body.id ?? "")) };
        },

        "POST /api/admin/server/invite": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!guildInvite) throw new HttpError(400, "Invites aren't available here.");
            const id = String(body.id ?? "");
            if (!/^\d{5,25}$/.test(id)) throw new HttpError(400, "Pick a server first.");
            try { const url = await guildInvite(id); log(`Bot owner made a one-use invite for server ${id}`); return { url }; }
            catch (e) { throw new HttpError(400, e.message || "Could not make an invite."); }
        },

        "GET /api/admin/bugs": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const seen = Number(db.getMeta("bugs_seen") ?? 0);
            const bugs = db.listBugs({ limit: 100 }).map(t => ({ id: t.id, subject: t.subject, status: t.status, user_id: t.user_id, user_name: t.user_name, created_at: t.created_at, updated_at: t.updated_at, text: String(t.first).slice(0, 600), replies: t.replies, isNew: t.created_at > seen && ["open", "waiting"].includes(t.status) }));
            return { bugs, newCount: bugs.filter(b => b.isNew).length, open: bugs.filter(b => ["open", "waiting"].includes(b.status)).length };
        },
        // Support tickets and bug reports inside the staff chat. Panel users act as the owner here, same as the rest of /api/admin.
        "GET /api/admin/chat/tickets": async (req, _b, url) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            needTickets();
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const status = ["active", "resolved", "closed"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "active";
            const seen = Number(db.getMeta("bugs_seen") ?? 0);
            const list = db.listTickets({ all: true, status, limit: 60 }).map(t => ({ id: t.id, subject: t.subject, status: t.status, user_name: t.user_name, updated_at: t.updated_at, created_at: t.created_at,
                bug: String(t.tags ?? "").split(",").includes("bug"), assigned: Boolean(t.assignee_id), isNew: t.created_at > seen && ["open", "waiting"].includes(t.status) }));
            return { tickets: list, open: db.listTickets({ all: true, status: "active", limit: 200 }).length };
        },
        "GET /api/admin/chat/ticket": async (req, _b, url) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            needTickets();
            const { t } = ticketAccess(s, url.searchParams.get("id"));
            return { ticket: { id: t.id, subject: t.subject, status: t.status, user_id: t.user_id, user_name: t.user_name, assignee_id: t.assignee_id, tags: t.tags, created_at: t.created_at },
                messages: db.listTicketMessages(t.id), canned: db.listCanned(t.guild_id ?? "*"), errors: logs && String(t.tags ?? "").includes("bug") ? logs.recent({ level: "error", limit: 8 }) : [] };
        },
        "POST /api/admin/tickets/reply": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            needTickets();
            const { t } = ticketAccess(s, body.id);
            await tickets.reply(t.id, { authorId: s.userId, role: t.user_id === s.userId ? "user" : "staff", body: body.body });
            return { ok: true };
        },
        "POST /api/admin/tickets/status": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            needTickets();
            const { t } = ticketAccess(s, body.id);
            if (body.status === "resolved") await tickets.resolve(t.id, { by: s.userId, note: body.note ? String(body.note).slice(0, 500) : null });
            else if (body.status === "closed") await tickets.close(t.id, { by: s.userId });
            else throw new HttpError(400, "Unknown status.");
            return { ok: true };
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
            const list = db.listGlobalGiveaways(15).map(g => ({ id: g.id, title: g.title, host: g.host_name ?? null, steps: g.steps ? JSON.parse(g.steps).length : 0, status: g.status, ends_at: g.ends_at, entries: db.countEntries(g.id), prizes: db.listKeys(g.id).length, outcome: outcomeOf(g, db.listKeys(g.id)),
                channels: db.listMirrors(g.id).filter(m => m.kind === "channel").length + 1, dms: db.listMirrors(g.id).filter(m => m.kind === "dm").length, spread: giveaways?.spreadStatus(g.id) ?? null }));
            const reached = new Set(dest.map(d => d.id));
            const skipped = (guildList?.() ?? []).filter(g => !reached.has(g.id)).map(g => g.name).slice(0, 30);
            return { available: Boolean(giveaways), pending: await pendingClaimsFor(null), destinations: dest, skipped, dm: db.broadcastTargets().users.length, list, ownerName: config.creator?.name ?? "You", stepKinds: Object.entries(STEP_KINDS).map(([id, k]) => ({ id, label: k.label, hint: k.hint })) };
        },
        "POST /api/admin/giveaways/remind": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!giveaways) throw new HttpError(503, "Giveaways are not set up on this bot.");
            try { await giveaways.remind(Number(body.key_id)); } catch (e) { if (e instanceof UserError) throw new HttpError(400, e.message); throw e; }
            return { ok: true };
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
                    color: parseColor(body.color), button_label: text(body.button_label), regions: parseRegions(body.regions), video: videoFromBody(body),
                    claim_hours: Number(body.claim_hours) || undefined, keys, auto_image: true, is_global: true, host, steps, require_steam: Boolean(body.steam_verified)
                });
                const targets = db.broadcastTargets();
                const sent = await giveaways.spread(r.id, {
                    channelIds: audience === "dm" ? [] : dest.map(d => d.channel_id), labels: new Map(dest.map(d => [d.channel_id, (guildList?.() ?? []).find(g => g.id === d.guild_id)?.name ?? d.guild_id])),
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

        "POST /api/admin/logs/clear": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!logs?.clear) throw new HttpError(503, "Logging is not turned on.");
            const cleared = logs.clear();
            log(`Bot owner cleared the logs (${cleared} lines)`);
            return { cleared };
        },

    };
}

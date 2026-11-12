// More admin tools: the invite report, daily numbers, moderation and server management.
// server.js passes in the helpers it already has (ctx) and merges these routes into its table.
import { HttpError } from "./http.js";
import { PLANS } from "../square.js";
import { REQUEST_STATUSES, MAX_NOTE as REQ_NOTE } from "../requeststore.js";
import { UserError } from "../errors.js";
import { aiStats, aiUsedToday } from "../aichat.js";
import { bundleFeedView } from "../bundlefeed.js";
import { endOfDayEastern, supporterUntil } from "../supporters.js";
import { freeArt, ideaStatusEmbed } from "../render.js";
import { groupErrors, readEvents } from "../adminlog.js";
import { isHidden } from "../hidden.js";
import { listModels } from "../aiproviders.js";
import { randomUUID } from "node:crypto";
import { refreshRequest, removeRequestPosts } from "../requestsync.js";
import * as xposterText from "../xposter.js";

export function createAdminExtraRoutes(ctx) {
    const { ai, authorCard, bundleFeed, codes, config, dayKey, db, dm, guildList, health, inviteReport, isOwner, itad, logs, music, musicCall, now, ops, origin, rest, rt, session, square, storage, supporters, topgg, weekly, xposter } = ctx;
    return {
        "POST /api/admin/bundles/poll": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!bundleFeed?.poll) throw new HttpError(400, "The bundle poll is not running on this bot.");
            const r = await bundleFeed.poll({ deep: true });
            return { result: r ?? { skipped: true } };
        },
        "POST /api/admin/codes/poll": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!codes?.poll) throw new HttpError(400, "The code poll is not running on this bot.");
            const r = await codes.poll();
            return { result: r ?? { skipped: true } };
        },


        "GET /api/admin/supporters": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            return { enabled: Boolean(square?.enabled), active: supporters ? supporters.list() : [], everyone: supporters ? supporters.everyone() : [], payments: readEvents(db, "adminlog:square", 20), recent: supporters ? supporters.recent() : [], revenue: supporters ? supporters.revenue() : null, home: supporters ? await supporters.homeStatus() : null, plans: PLANS };
        },
        // Full edit of one supporter: pass end date, add or take away days, end it, founding mark, wall name, resend the role.
        "POST /api/admin/supporters/edit": async (req, body) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            if (!supporters) throw new HttpError(404, "Not found.");
            const id = String(body.id ?? "").trim();
            if (!/^\d{5,25}$/.test(id)) throw new HttpError(400, "That doesn't look like a Discord ID.");
            switch (body.action) {
                case "set_until": {
                    const ms = endOfDayEastern(body.date);
                    if (ms === null) throw new HttpError(400, "Pick a date.");
                    if (ms - Date.now() > 3660 * 86_400_000) throw new HttpError(400, "That's more than ten years out.");
                    return await supporters.setUntil(id, ms);
                }
                case "add_days": {
                    const d = Math.round(Number(body.days));
                    if (!Number.isFinite(d) || d === 0 || Math.abs(d) > 3660) throw new HttpError(400, "Pick a number of days between -3660 and 3660.");
                    return await supporters.addDays(id, d);
                }
                case "remove": return await supporters.remove(id);
                case "founder": return { founder: supporters.setFounder(id, body.on !== false) };
                case "wall": return { wall: supporters.setWall(id, body.name) };
                case "resync": return { role: (await supporters.setUntil(id, supporterUntil(db, id) || 0, "Role re-sent")).role };
                default: throw new HttpError(400, "Unknown action.");
            }
        },
        "GET /api/admin/supporters.csv": async (req, _b, url) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
            const rows = (supporters ? supporters.everyone() : []).map(r => [r.id, r.active ? "active" : "ended", r.until ? new Date(r.until).toISOString() : "", r.founder ? "yes" : "", r.wall].map(q).join(","));
            return { csv: ["discord_id,status,pass_ends,founder,wall_name", ...rows].join("\n") };
        },
        // One glance at what needs the owner: new reports, failing jobs, a full disk, a payment or role problem.
        "GET /api/admin/attention": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            const items = [];
            const add = (level, text, href) => items.push({ level, text, href });
            const newBugs = db.countNewBugs(Number(db.getMeta("bugs_seen") ?? 0));
            if (newBugs) add("warn", `${newBugs} new bug report${newBugs === 1 ? "" : "s"}`, "#/bugs");
            const prof = db.listProfileReports();
            if (prof.length) add("warn", `${prof.length} reported profile${prof.length === 1 ? "" : "s"} to look at`, "#/profiles");
            const gifts = db.listGiftReports?.() ?? [];
            if (gifts.length) add("warn", `${gifts.length} reported gift mark${gifts.length === 1 ? "" : "s"}`, "#/gifts");
            const posts = db.listReports?.() ?? [];
            if (posts.length) add("warn", `${posts.length} reported post${posts.length === 1 ? "" : "s"}`, "#/social");
            try {
                const waiting = db.pendingClaims({ limit: 200 });
                if (waiting.length) {
                    const soon = waiting.filter(k => (k.deadline ?? Infinity) - now() < 6 * 3600_000);
                    add(soon.length ? "warn" : "info", `${waiting.length} giveaway prize${waiting.length === 1 ? " is" : "s are"} waiting for the winner to claim${soon.length ? `, ${soon.length} with under 6 hours left` : ""}`, "#/giveaway");
                }
            } catch { /* the giveaway tables may not exist on an old copy */ }
            const failing = ops ? Object.entries(ops.snapshot()?.jobs ?? {}).filter(([, j]) => j.lastError) : [];
            if (failing.length) add("bad", `${failing.length} background job${failing.length === 1 ? " is" : "s are"} failing: ${failing.slice(0, 3).map(([n]) => n).join(", ")}`, "#/system");
            try { const st = storage ? await storage() : null; if (st?.volume?.pct >= 80) add(st.volume.pct >= 90 ? "bad" : "warn", `The disk is ${st.volume.pct}% full`, "#/system"); } catch { /* skip */ }
            if (supporters) { try { const h = await supporters.homeStatus(); if (!h.ok) add("warn", "The Supporter role can't be given right now", "#/supporters"); } catch { /* skip */ } }
            if (health && !health()) add("bad", "The bot isn't connected to Discord", "#/system");
            return { items };
        },
        "POST /api/admin/supporters/resync": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            if (!supporters) throw new HttpError(404, "Not found.");
            return await supporters.resync();
        },
        "POST /api/admin/supporters/grant": async (req, body) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            const id = String(body.user_id ?? "").trim();
            if (!/^\d{5,25}$/.test(id)) throw new HttpError(400, "Paste the person's Discord ID (digits only).");
            const days = Number(body.days);
            if (!supporters || !Number.isFinite(days) || days < 1 || days > 3660) throw new HttpError(400, "Pick between 1 and 3660 days.");
            const r = await supporters.grant(id, days, "manual:" + randomUUID(), "Owner");
            return { until: r.until, role: r.role };
        },
        "GET /api/admin/traffic": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            const { pages, days } = db.trafficReport();
            const invites = inviteReport();
            const today = dayKey(), sum = (list, f) => list.reduce((n, x) => n + x[f], 0);
            const last = days.slice(-14), week = days.slice(-7);
            const top = pages.sort((a, b) => b.visits - a.visits || b.clicks - a.clicks).slice(0, 15).map(p => {
                const row = p.path === "b" ? db.getFeedBundle(p.id) : db.getDeal(p.id);
                return { ...p, title: row?.title ?? "(removed)", store: p.path === "b" ? row?.store ?? "" : row?.shop ?? "", kind: p.path === "b" ? "Bundle" : row?.kind === "free" ? "Free game" : "Deal", url: `${origin}/${p.path}/${p.id}` };
            });
            return { invites, today: days.find(d => d.day === today) ?? { day: today, visits: 0, clicks: 0, previews: 0 }, week: { visits: sum(week, "visits"), clicks: sum(week, "clicks"), previews: sum(week, "previews") }, total: { visits: sum(pages, "visits"), clicks: sum(pages, "clicks") }, days: last, top };
        },
        "GET /api/admin/xposter": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!xposter) throw new HttpError(503, "X posting isn't available on this bot.");
            return xposter.status();
        },
        "POST /api/admin/xposter": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!xposter) throw new HttpError(503, "X posting isn't available on this bot.");
            if (body.enabled && !xposter.configured()) throw new HttpError(400, "Add the four X keys in Fly first (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET).");
            try { return xposter.setSettings({ enabled: body.enabled, daily: body.daily, tags: body.tags, links: body.links, always: body.always, ingame: body.ingame, steamOnly: body.steamOnly }); } catch (e) { if (e.user) throw new HttpError(400, e.message); throw e; }
        },
        "GET /api/admin/xposter/bundles": async (req, _b, url) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!xposter) throw new HttpError(503, "X posting isn't available on this bot.");
            const link = url.searchParams.get("link") !== "0", tags = xposter.tags();
            return { bundles: db.listFeedBundles({ status: "active", limit: 8, adult: false }).map(bundleFeedView).map(b => ({ id: b.id, title: b.title, storeName: b.storeName, price: b.price, expiresAt: b.expiresAt, gameCount: b.gameCount, posted: xposter.bundlePosted(b.id), text: xposterText.bundleText({ ...b, url: `${origin}/b/${b.id}` }, { tags, link }), visits: Number(db.getMeta(`bundlevisit:${b.id}`)) || 0, clicks: Number(db.getMeta(`bundlego:${b.id}`)) || 0 })) };
        },
        "GET /api/admin/weekly": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!weekly) throw new HttpError(503, "The weekly deals post isn't available on this bot.");
            return await weekly.status();
        },
        "POST /api/admin/weekly": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!weekly) throw new HttpError(503, "The weekly deals post isn't available on this bot.");
            try { weekly.set({ on: body.on === undefined ? undefined : Boolean(body.on), channel: body.channel }); } catch (e) { if (e instanceof UserError) throw new HttpError(400, e.message); throw e; }
            return { ok: true, ...(await weekly.status()) };
        },
        "POST /api/admin/weekly/run": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!weekly) throw new HttpError(503, "The weekly deals post isn't available on this bot.");
            const r = await weekly.run({ force: true });
            if (r.skipped) throw new HttpError(400, r.skipped === "not enough good deals" ? "There aren't enough good deals to post right now." : "Nothing to post.");
            return { ok: true, ...r };
        },
        "GET /api/admin/xposter/free": async (req, _b, url) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!xposter) throw new HttpError(503, "X posting isn't available on this bot.");
            const link = url.searchParams.get("link") !== "0", tags = xposter.tags();
            let list = [];
            try { list = await itad.getGiveawayList(); } catch { /* shown as an empty list */ }
            const games = list.filter(g => g.type !== "dlc" && /^https:\/\//.test(g.url ?? "") && g.title).sort((a, b) => (a.expiry ?? Infinity) - (b.expiry ?? Infinity)).slice(0, 12);
            return { games: games.map(g => {
                const page = link ? db.upsertDeal({ key: `free:${g.id ?? g.url}`, kind: "free", title: g.title, shop: g.shop, url: g.url, image: freeArt(g), expiry: g.expiry }) : null;
                const text = xposterText.freeGameText({ ...g, url: page ? `${origin}/d/${page}` : g.url }, Date.now(), tags, { link });
                return { id: String(g.id), title: g.title, shop: g.shop, expiry: g.expiry, posted: xposter.freePosted(g.id), text, visits: page ? Number(db.getMeta(`dealvisit:${page}`)) || 0 : 0, clicks: page ? Number(db.getMeta(`dealgo:${page}`)) || 0 : 0 };
            }) };
        },
        "POST /api/admin/xposter/post": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!xposter) throw new HttpError(503, "X posting isn't available on this bot.");
            if (!xposter.configured()) throw new HttpError(400, "Add the four X keys in Fly first.");
            try {
                const text = String(body.text ?? ""), image = body.image ? String(body.image) : null;
                if (body.at && body.video) throw new HttpError(400, "The promo video can only be posted right now, not scheduled.");
                if (body.at) { const item = xposter.schedule({ text, at: Number(body.at), image }); return { ok: true, scheduled: item }; }
                const bundle = body.bundle_id ? db.getFeedBundle(body.bundle_id) : null; // the picture comes from our own record of the bundle, never an address sent from the page
                let free = null; // same for a free game: it's looked up in the bot's own list, and its picture comes from there
                if (body.free_id) free = (await itad.getGiveawayList().catch(() => [])).find(g => String(g.id) === String(body.free_id)) ?? null;
                return { ok: true, ...(await xposter.manual({ text, image, video: body.video === "promo", imageUrl: bundle?.image ?? (free ? freeArt(free) : null) ?? null, bundleId: bundle ? String(bundle.id) : null, freeId: free ? String(free.id) : null })) };
            } catch (e) { if (e.user || e.status) throw new HttpError(400, e.message); throw e; }
        },
        "POST /api/admin/xposter/unschedule": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!xposter) throw new HttpError(503, "X posting isn't available on this bot.");
            xposter.unschedule(String(body.key ?? "")); return { ok: true };
        },
        "POST /api/admin/xposter/delete": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!xposter) throw new HttpError(503, "X posting isn't available on this bot.");
            try { return await xposter.remove(String(body.id ?? "")); } catch (e) { if (e.user || e.status) throw new HttpError(400, e.message); throw e; }
        },
        "POST /api/admin/xposter/check": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!xposter) throw new HttpError(503, "X posting isn't available on this bot.");
            try { return { ok: true, ...(await xposter.check()) }; } catch (e) { throw new HttpError(400, e.message); }
        },
        "GET /api/admin/music": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!music) throw new HttpError(503, "Music isn't available on this bot right now.");
            const nameOf = id => guildList?.().find(x => x.id === id)?.name ?? null;
            return { sessions: music.sessions().filter(x => !isHidden(x.guildId)).map(x => ({ ...x, guildName: nameOf(x.guildId) ?? "Server " + x.guildId.slice(-4) })) };
        },
        "POST /api/admin/music": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!music) throw new HttpError(503, "Music isn't available on this bot right now.");
            if (isHidden(String(body.guild_id ?? ""))) throw new HttpError(404, "Unknown server.");
            await musicCall(async () => music.adminForce(String(body.guild_id ?? ""), String(body.action ?? "")));
            return { ok: true, sessions: music.sessions().filter(x => !isHidden(x.guildId)).length };
        },
        // ---- the bot owner's live settings and the AI companion ----
        "GET /api/admin/settings": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            if (!rt) throw new HttpError(503, "Live settings are not available here.");
            return rt.view();
        },
        "POST /api/admin/settings": async (req, body) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            if (!rt) throw new HttpError(503, "Live settings are not available here.");
            const changed = rt.set(body.patch);
            if (changed.length) db.logAudit({ actor: session(req).userId, action: "settings", target: null, detail: `changed ${changed.join(", ")}`.slice(0, 200) });
            return { ...rt.view(), changed };
        },
        "GET /api/admin/ai": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            if (!rt) throw new HttpError(503, "Live settings are not available here.");
            const names = new Map((guildList?.() ?? []).map(g => [g.id, g.name]));
            const view = rt.view();
            const rows = new Map();
            const row = id => { if (!rows.has(id)) rows.set(id, { id, name: names.get(id) ?? null }); return rows.get(id); };
            for (const c of db.allCommunity()) if (c.ai_on) Object.assign(row(c.guild_id), { on: true, channel: c.ai_channel ?? null });
            for (const c of db.allCommunity()) { if (c.ai_key) row(c.guild_id).ownKey = true; if (c.ai_plus) row(c.guild_id).plus = true; if (c.ai_plus_interest) row(c.guild_id).interested = true; }
            if (config.mainGuild?.id()) row(config.mainGuild.id()).main = true;
            for (const id of Object.keys(view.serverCaps)) row(id);
            for (const id of view.blockedServers) row(id);
            for (const m of db.listMetaPrefix("aiday:")) row(m.key.slice(6));
            const servers = [...rows.values()].map(r => ({ ...r, on: Boolean(r.on), ownKey: Boolean(r.ownKey), plus: Boolean(r.plus), interested: Boolean(r.interested), main: Boolean(r.main), used: aiUsedToday(db, r.id), cap: rt.serverCap(r.id), blocked: rt.isServerBlocked(r.id) })).sort((a, b) => b.used - a.used || String(a.name).localeCompare(String(b.name)));
            return { ...view, lite: config.aiLite !== false, available: Boolean(config.aiAvailable), phrase: Boolean(config.aiPhrase), stats: aiStats(db, 14), servers, lastError: db.getMeta("ai:lasterr") ?? null };
        },
        "POST /api/admin/ai/block": async (req, body) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            if (!rt) throw new HttpError(503, "Live settings are not available here.");
            const on = body.on !== false;
            if (body.kind === "user") rt.blockUser(body.id, on); else if (body.kind === "server") rt.blockServer(body.id, on); else throw new HttpError(400, "Block a user or a server.");
            return { ok: true };
        },
        "POST /api/admin/ai/server": async (req, body) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            if (!rt) throw new HttpError(503, "Live settings are not available here.");
            const id = String(body.id ?? "");
            if (body.cap !== undefined) rt.setServerCap(id, body.cap);
            if (body.resetToday) db.setMeta(`aiday:${id}`, "");
            if (body.turnOff) db.setCommunity(id, { ai_on: 0 });
            if (body.plus !== undefined) db.setCommunity(id, { ai_plus: body.plus ? 1 : 0 });
            return { ok: true };
        },
        "POST /api/admin/ai/models": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            if (!rt || !config.aiKey) throw new HttpError(400, "The bot has no AI key yet.");
            const provider = rt.get("ai_provider");
            const r = await listModels({ provider, apiKey: config.aiKey }).catch(() => ({ ok: false, status: 0, error: "could not be reached" }));
            if (!r.ok) throw new HttpError(400, `The service answered ${r.status || "with an error"}${r.error ? ` (${r.error})` : ""}.`);
            return { provider, models: r.models };
        },
        "POST /api/admin/ai/test": async (req, body) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            if (!ai) throw new HttpError(503, "The AI companion is not available here.");
            const q = String(body.question ?? "").trim().slice(0, 500);
            if (!q) throw new HttpError(400, "Type a question to try.");
            return await ai.test(q, session(req).userId);
        },
        "GET /api/admin/profiles": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            return { reports: db.listProfileReports().map(r => ({ ...r, hidden: Boolean(db.getProfileBySlug(r.slug) && db.getProfileData(db.getProfileBySlug(r.slug).discord_id).blocked) })) };
        },
        "POST /api/admin/profiles": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            const owner = db.getProfileBySlug(String(body.slug ?? "").toLowerCase());
            if (!owner) throw new HttpError(404, "No profile with that name.");
            if (body.action === "hide" && owner.discord_id === config.ownerId) throw new HttpError(400, "You can't hide your own page.");
            if (body.action === "dismiss") db.clearProfileReports(owner.profile_slug);
            else db.blockProfile(owner.discord_id, body.action === "hide");
            return { ok: true };
        },
        "GET /api/admin/social": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            return { reports: db.listReports().map(r => ({ ...r, by: authorCard(r.author_id) })), bans: db.listSocialBans().map(b => ({ ...b, by: authorCard(b.discord_id) })) };
        },
        "POST /api/admin/social": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do that.");
            const id = Number(body.id);
            if (body.action === "dismiss") db.dismissReports(id);
            else if (body.action === "delete") db.deleteItem(id);
            else if (body.action === "ban" || body.action === "unban") {
                const who = body.action === "ban" && id ? db.getItem(id)?.discord_id : String(body.user ?? "");
                if (!who) throw new HttpError(404, "Nobody to act on.");
                if (body.action === "ban") db.banPoster(who, body.reason); else db.unbanPoster(who);
            } else throw new HttpError(400, "Unknown action.");
            return { ok: true };
        },
        "GET /api/admin/gifts": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            return { reports: db.listGiftReports(), bans: db.listGiftBans() };
        },
        "POST /api/admin/gifts": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            const id = String(body.claimer ?? "");
            if (!/^[\w-]{1,40}$/.test(id)) throw new HttpError(400, "Pick an account first.");
            if (body.action === "ban") db.banGift(id, "Blocked by the bot owner");
            else if (body.action === "unban") db.unbanGift(id);
            else if (body.action === "dismiss") db.dismissGiftReports(id);
            else throw new HttpError(400, "Unknown action.");
            return { ok: true };
        },
        // ----- owner -----
        // A trail of what the owner did in the admin panel. Only short, harmless fields are kept: never prize keys or message text.
        "GET /api/admin/audit": async (req, _b, url) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const before = Number(url.searchParams.get("before")) || null;
            const rows = db.listAudit({ limit: 50, before, q: url.searchParams.get("q") ?? "" });
            return { rows, more: rows.length === 50 };
        },
        // How the bot itself is doing right now: process, memory, sign-ins and the event loop.
        "GET /api/admin/votes": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            return topgg ? topgg.adminStats() : { enabled: false };
        },
        "GET /api/admin/errors": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            return { groups: logs ? groupErrors(logs.recent({ level: "error", limit: 400 })) : [], available: Boolean(logs) };
        },
        // The bot owner moves a request along (in development, shipped, rejected…) with an optional note. The requester gets a DM.
        "POST /api/admin/requests/status": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do that.");
            const r = db.getRequest(Number(body.id));
            if (!r) throw new HttpError(404, "I can't find that request.");
            const status = String(body.status ?? "");
            if (!REQUEST_STATUSES[status]) throw new HttpError(400, "Pick a valid status.");
            const note = String(body.note ?? "").trim().slice(0, REQ_NOTE);
            db.setRequestStatus(r.id, status, note);
            refreshRequest({ db, api: rest, id: r.id, base: config.publicUrl }).catch(() => {}); // move the tag in each forum
            let notified = false;
            if (body.notify !== false && status !== r.status && r.user_id !== s.userId) {
                try {
                    await dm(r.user_id, ideaStatusEmbed({ title: r.title, status, label: REQUEST_STATUSES[status], note, url: config.publicUrl ? `${config.publicUrl}/#/requests` : null }));
                    notified = true;
                } catch { /* DMs closed: the status is still saved and visible on the page */ }
            }
            return { ok: true, notified };
        },
        "POST /api/admin/requests/delete": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do that.");
            const id = Number(body.id);
            await removeRequestPosts({ db, api: rest, id }).catch(() => {});
            return { removed: db.deleteRequest(id) };
        },
    };
}

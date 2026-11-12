// The indie showcase's API: browsing, submitting, a developer's own games, keys and requests, and the developer tools.
// server.js passes in the helpers it already has (ctx) and merges these routes into its table.
import { HttpError } from "./http.js";
import { INDIE_CATS, INDIE_TOOLS } from "../indiemeta.js";
import { MAX_GAMES_PER_USER, MAX_PENDING_PER_USER } from "../indiestore.js";
import { SALES, SALES_UPDATED } from "../salescal.js";
import { UserError } from "../errors.js";
import { cleanLinks, parseApp } from "../indie.js";
import { picksFor } from "../indienews.js";
import { randomBytes } from "node:crypto";

export function createIndieRoutes(ctx) {
    const { CRAWLER, adminRoutes, clientIp, config, db, decideKeyRequest, devSession, indieApi, indieHerald, indieKeyLimit, indieLookupLimit, indiePublic, indieReportLimit, indieSyncLimit, indieUpdateLimit, indieVerifyLimit, indieWriteLimit, isOwner, now, origin, session, socialWrite, softSession, syncIndieDev } = ctx;
    return {
        // ---------- indie showcase and developer tools ----------
        "GET /api/indie/tools": async () => ({ cats: INDIE_CATS, tools: INDIE_TOOLS }),
        "GET /api/indie/calendar": async () => ({ sales: SALES.map(e => ({ name: e.name, kind: e.kind, start: e.start, end: e.end, note: e.note ?? null })), updated: SALES_UPDATED }),
        "GET /api/indie/lookup": async (req, _b, url) => {
            if (!indieLookupLimit.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little and try again in a minute.");
            const q = String(url.searchParams.get("q") ?? "").trim().slice(0, 200);
            if (!q) throw new HttpError(400, "Paste a Steam store link or type a game's name.");
            const id = parseApp(q);
            try {
                if (id) return { game: await indieApi.lookup(id, { withReviews: true }) };
                return { results: await indieApi.search(q) };
            } catch (e) { if (e instanceof UserError) throw new HttpError(400, e.message); throw e; }
        },
        "GET /api/indie": async (req, _b, url) => {
            const sp = url.searchParams, genre = sp.get("genre") || null, q = (sp.get("q") || "").trim() || null, sort = ["new", "popular", "az"].includes(sp.get("sort")) ? sp.get("sort") : "new";
            const page = Math.max(0, Math.floor(Number(sp.get("page")) || 0)), per = 24;
            const { games, total } = db.indieList({ genre, q, sort, limit: per, offset: page * per });
            const plain = !genre && !q && page === 0;
            return { open: db.getMeta("indie:open") !== "0", games: games.map(indiePublic), total, page, per, genres: db.indieGenres(), featured: plain ? db.indieFeatured(3).map(indiePublic) : [], news: plain ? db.indieNewsFeed(5).map(u => ({ id: u.id, gameId: u.game_id, game: u.game_title, studio: u.studio, image: u.image, kind: u.kind, title: u.title, created: u.created })) : [] };
        },
        "GET /api/indie/game": async (req, _b, url) => {
            const g = db.indieGet(url.searchParams.get("id")), sess = softSession(req);
            const mine = Boolean(g && sess && sess.userId === g.owner_id), staff = Boolean(sess && isOwner(sess));
            if (!g || (g.status !== "approved" && !mine && !staff)) throw new HttpError(404, "That game isn't in the showcase.");
            if (g.status === "approved" && !CRAWLER.test(String(req.headers["user-agent"] ?? ""))) db.indieBump(g.id, "views");
            return { game: { ...indiePublic(g), status: mine || staff ? g.status : undefined, note: mine ? g.note : undefined, liked: db.indieLiked(g.id, sess?.userId), mine, keysOpen: Boolean(g.keys_open), followers: db.indieFollowCount(g.id), following: { game: db.indieIsFollowing(sess?.userId, "game", g.id), studio: db.indieIsFollowing(sess?.userId, "studio", g.owner_id) }, keyRequest: sess ? db.indieKeyRequestOf(g.id, sess.userId)?.status ?? null : null, updates: db.indieUpdates(g.id, 8).map(u => ({ id: u.id, kind: u.kind, title: u.title, body: u.body, link: u.link, created: u.created })), studioGames: db.indieByOwner(g.owner_id).filter(x => x.status === "approved" && x.id !== g.id).slice(0, 4).map(indiePublic) }, more: db.indieList({ limit: 4, sort: "popular" }).games.filter(x => x.id !== g.id).slice(0, 3).map(indiePublic) };
        },
        "GET /api/indie/mine": async (req) => {
            const s = session(req);
            return { games: db.indieByOwner(s.userId).map(g => ({ ...indiePublic(g), status: g.status, note: g.note, views: g.views, clicks: g.clicks, keysOpen: Boolean(g.keys_open), followers: db.indieFollowCount(g.id), pendingKeys: db.indieKeyRequests(g.id).filter(k => k.status === "pending").length })), limits: { pending: MAX_PENDING_PER_USER, total: MAX_GAMES_PER_USER } };
        },
        "POST /api/indie/submit": async (req, body) => {
            const s = session(req);
            if (db.getMeta("indie:open") === "0" && s.userId !== config.ownerId) throw new HttpError(400, "Submissions are paused for a bit. Check back soon.");
            if (!indieWriteLimit.hit(s.userId).ok) throw new HttpError(429, "That's a lot of submissions at once. Try again in a few minutes.");
            const appid = parseApp(body.url);
            if (!appid) throw new HttpError(400, "Paste your game's Steam store link, like https://store.steampowered.com/app/123456/Your_Game/");
            if (body.team !== true) throw new HttpError(400, "Tick the box to confirm you're part of the team that makes this game.");
            const pitch = String(body.pitch ?? "").replace(/\s+/g, " ").trim();
            if (pitch.length < 20 || pitch.length > 400) throw new HttpError(400, "Write a pitch between 20 and 400 characters: what makes your game worth a look?");
            if (db.indieByApp(appid)) throw new HttpError(400, "That game is already in the showcase, or waiting to be looked at.");
            if (db.indieCountOwner(s.userId) >= MAX_GAMES_PER_USER) throw new HttpError(400, `You can have up to ${MAX_GAMES_PER_USER} games here.`);
            if (db.indieCountOwner(s.userId, "pending") >= MAX_PENDING_PER_USER) throw new HttpError(400, `You already have ${MAX_PENDING_PER_USER} games waiting to be looked at. They'll be reviewed soon.`);
            let g;
            try { g = await indieApi.lookup(appid); } catch (e) { if (e instanceof UserError) throw new HttpError(400, e.message); throw e; }
            if (g.type !== "game") throw new HttpError(400, "Only games can go in the showcase, not DLC, demos or soundtracks. Use the main game's page.");
            const id = db.indieAdd({ appid, ownerId: s.userId, title: g.title, studio: g.studio, blurb: g.blurb, pitch, genres: g.genres, image: g.image, price: g.price, release: g.release, links: cleanLinks(body.links) });
            const auto = s.userId === config.ownerId;
            if (auto) db.indieDecide(id, "approved");
            else if (config.ownerId) { try { db.addNotification(config.ownerId, { type: "indie", title: "New indie submission", body: g.title, url: "/admin#/indie" }); } catch { /* the queue still shows it */ } }
            return { id, status: auto ? "approved" : "pending", title: g.title };
        },
        "POST /api/indie/edit": async (req, body) => {
            const s = session(req), g = db.indieGet(body.id);
            if (!g || g.owner_id !== s.userId) throw new HttpError(404, "That game isn't yours.");
            const pitch = String(body.pitch ?? "").replace(/\s+/g, " ").trim();
            if (pitch.length < 20 || pitch.length > 400) throw new HttpError(400, "Write a pitch between 20 and 400 characters.");
            db.indieEdit(g.id, { pitch, links: cleanLinks(body.links) });
            return { ok: true };
        },
        // Pull the latest price, release date, picture and description from the game's Steam page.
        "POST /api/indie/sync": async (req, body) => {
            const s = session(req), g = db.indieGet(body.id);
            if (!g || g.owner_id !== s.userId) throw new HttpError(404, "That game isn't yours.");
            if (!indieSyncLimit.hit(`${s.userId}:${g.id}`).ok) throw new HttpError(429, "Give it a minute before syncing again.");
            let fresh; try { fresh = await indieApi.lookup(g.appid, { fresh: true }); } catch (e) { if (e instanceof UserError) throw new HttpError(400, e.message); throw e; }
            if (fresh.type !== "game") throw new HttpError(400, "Steam no longer lists that as a game.");
            db.indieRefresh(g.id, fresh);
            return { game: indiePublic(db.indieGet(g.id)) };
        },
        "POST /api/indie/withdraw": async (req, body) => {
            const s = session(req), g = db.indieGet(body.id);
            if (!g || g.owner_id !== s.userId) throw new HttpError(404, "That game isn't yours.");
            db.indieRemove(g.id);
            await syncIndieDev(s.userId);
            return { ok: true };
        },
        "POST /api/indie/like": async (req, body) => {
            const s = session(req);
            if (!socialWrite.hit(s.userId).ok) throw new HttpError(429, "Slow down a little.");
            const g = db.indieGet(body.id);
            if (!g || g.status !== "approved") throw new HttpError(404, "That game isn't in the showcase.");
            const liked = db.indieToggleLike(g.id, s.userId);
            return { liked, likes: db.indieGet(g.id).likes };
        },
        "POST /api/indie/click": async (req, body) => {
            if (!socialWrite.hit(clientIp(req)).ok) return { ok: true };
            if (!CRAWLER.test(String(req.headers["user-agent"] ?? ""))) db.indieBump(Number(body.id) || 0, "clicks");
            return { ok: true };
        },
        "GET /api/indie/news": async () => ({ news: db.indieNewsFeed(12).map(u => ({ id: u.id, gameId: u.game_id, game: u.game_title, studio: u.studio, image: u.image, kind: u.kind, title: u.title, created: u.created })) }),
        "GET /api/indie/foryou": async (req) => {
            const s = softSession(req);
            if (!s) return { signedIn: false, picks: [] };
            const r = picksFor(db, s.userId, { limit: 6 });
            return { signedIn: true, reason: r.reason, picks: r.picks.map(p => ({ ...indiePublic(p.game), because: p.because })) };
        },
        // Follow a game, or the studio behind it. Followers hear about news and get a message.
        "POST /api/indie/follow": async (req, body) => {
            const s = session(req);
            if (!socialWrite.hit(s.userId).ok) throw new HttpError(429, "Slow down a little.");
            const g = db.indieGet(body.id);
            if (!g || g.status !== "approved") throw new HttpError(404, "That game isn't in the showcase.");
            const kind = body.kind === "studio" ? "studio" : "game";
            if (kind === "studio" && g.owner_id === s.userId) throw new HttpError(400, "That's your own studio.");
            const on = db.indieToggleFollow(s.userId, kind, kind === "studio" ? g.owner_id : g.id);
            return { following: on, kind, followers: db.indieFollowCount(g.id) };
        },
        "GET /api/indie/following": async (req) => {
            const s = session(req), games = [], seen = new Set();
            for (const f of db.indieFollowing(s.userId)) {
                const found = f.kind === "game" ? [db.indieGet(f.target)] : db.indieByOwner(f.target);
                for (const g of found) if (g && g.status === "approved" && !seen.has(g.id)) { seen.add(g.id); games.push({ ...indiePublic(g), via: f.kind }); }
            }
            return { games: games.slice(0, 40) };
        },
        // Developer news on a game's page. Owner only, and only once the game is public.
        "POST /api/indie/update": async (req, body) => {
            const s = session(req), g = db.indieGet(body.id);
            if (!g || g.owner_id !== s.userId) throw new HttpError(404, "That game isn't yours.");
            if (g.status !== "approved") throw new HttpError(400, "You can post news once your game is in the showcase.");
            if (!indieUpdateLimit.hit(`${s.userId}:${g.id}`).ok) throw new HttpError(429, "That's plenty of news for one hour. Try again later.");
            const title = String(body.title ?? "").replace(/\s+/g, " ").trim(), text = String(body.body ?? "").replace(/[ \t]+/g, " ").trim();
            if (title.length < 3 || title.length > 100) throw new HttpError(400, "Give the update a short headline, 3 to 100 characters.");
            if (text.length > 500) throw new HttpError(400, "Keep the details to 500 characters. Link out for the long version.");
            let link = null;
            if (String(body.link ?? "").trim()) { try { const u = new URL(String(body.link).trim()); if (u.protocol !== "https:" || String(body.link).length > 300) throw new Error(); link = u.href; } catch { throw new HttpError(400, "The link needs to be a full https:// address."); } }
            const id = db.indieAddUpdate({ gameId: g.id, kind: body.kind, title, body: text || null, link });
            const u = db.indieUpdate(id);
            indieHerald.publish(g, u).catch(() => {});
            return { id, update: { id, kind: u.kind, title: u.title, body: u.body, link: u.link, created: u.created } };
        },
        "POST /api/indie/update/delete": async (req, body) => {
            const s = session(req), u = db.indieUpdate(body.id), g = u && db.indieGet(u.game_id);
            if (!u || !g || (g.owner_id !== s.userId && !isOwner(s))) throw new HttpError(404, "That update isn't yours.");
            db.indieDeleteUpdate(u.id);
            return { ok: true };
        },
        // Review keys: the developer opens requests, creators and players ask, the developer says yes or no. Keys themselves are sent by the developer.
        "POST /api/indie/keys/open": async (req, body) => {
            const s = session(req), g = db.indieGet(body.id);
            if (!g || g.owner_id !== s.userId) throw new HttpError(404, "That game isn't yours.");
            db.indieSetKeysOpen(g.id, Boolean(body.open));
            return { open: Boolean(body.open) };
        },
        "POST /api/indie/keys/request": async (req, body) => {
            const s = session(req), g = db.indieGet(body.id);
            if (!g || g.status !== "approved" || !g.keys_open) throw new HttpError(404, "This game isn't taking review key requests right now.");
            if (g.owner_id === s.userId) throw new HttpError(400, "That's your own game.");
            if (!indieKeyLimit.hit(s.userId).ok) throw new HttpError(429, "That's a lot of requests. Try again in a while.");
            const name = String(body.name ?? "").trim(), channel = String(body.channel ?? "").trim(), note = String(body.note ?? "").trim();
            if (name.length < 2 || name.length > 60) throw new HttpError(400, "Tell them who you are: a channel name, outlet or handle.");
            if (channel.length < 4 || channel.length > 300) throw new HttpError(400, "Add a link to your channel, site or profile so they can check it.");
            if (!db.indieKeyRequest({ gameId: g.id, userId: s.userId, name, channel, note })) throw new HttpError(400, "You've already asked for a key for this game.");
            try { db.addNotification(g.owner_id, { type: "indie", title: `${name} asked for a key for ${g.title}`, body: "Open your games to say yes or no.", url: "/indie/mine" }); } catch { /* it is in their list either way */ }
            return { ok: true };
        },
        "GET /api/indie/keys": async (req, _b, url) => {
            const s = session(req), g = db.indieGet(url.searchParams.get("id"));
            if (!g || g.owner_id !== s.userId) throw new HttpError(404, "That game isn't yours.");
            return { open: Boolean(g.keys_open), requests: db.indieKeyRequests(g.id).map(k => ({ id: k.id, name: k.name, channel: k.channel, note: k.note, status: k.status, created: k.created })) };
        },
        "POST /api/indie/keys/decide": async (req, body) => {
            const s = session(req), k = db.indieKeyRequestGet(body.id), g = k && db.indieGet(k.game_id);
            if (!k || !g || g.owner_id !== s.userId) throw new HttpError(404, "That request isn't for your game.");
            await decideKeyRequest(g, k, Boolean(body.approve), null);
            return { ok: true };
        },
        // Verified badge: put a one-time code in the game's Steam page text, then check. Only the page's owner can do that.
        "POST /api/indie/verify/start": async (req, body) => {
            const s = session(req), g = db.indieGet(body.id);
            if (!g || g.owner_id !== s.userId) throw new HttpError(404, "That game isn't yours.");
            if (g.verified) return { verified: true };
            const code = g.verify_code || `svc-verify-${randomBytes(5).toString("hex").slice(0, 8)}`;
            if (!g.verify_code) db.indieSetVerifyCode(g.id, code);
            return { verified: false, code };
        },
        "POST /api/indie/verify/check": async (req, body) => {
            const s = session(req), g = db.indieGet(body.id);
            if (!g || g.owner_id !== s.userId) throw new HttpError(404, "That game isn't yours.");
            if (g.verified) return { verified: true };
            if (!g.verify_code) throw new HttpError(400, "Start verification first to get your code.");
            if (!indieVerifyLimit.hit(s.userId).ok) throw new HttpError(429, "Give it a minute before checking again.");
            let found; try { found = await indieApi.hasVerifyCode(g.appid, g.verify_code); } catch (e) { if (e instanceof UserError) throw new HttpError(400, e.message); throw e; }
            if (!found) return { verified: false, code: g.verify_code, message: "I can't see the code on your Steam page yet. Steam can take a few minutes to show edits, so wait a bit and check again." };
            db.indieSetVerified(g.id, true);
            return { verified: true };
        },
        "POST /api/indie/report": async (req, body) => {
            const s = session(req), g = db.indieGet(body.id);
            if (!g || g.status !== "approved") throw new HttpError(404, "That game isn't in the showcase.");
            if (!indieReportLimit.hit(s.userId).ok) throw new HttpError(429, "You've sent a few reports already. We'll look at those first.");
            const reason = String(body.reason ?? "").replace(/\s+/g, " ").trim();
            if (reason.length < 5) throw new HttpError(400, "Tell us briefly what's wrong.");
            const fresh = db.indieReport({ gameId: g.id, reporter: s.userId, reason });
            if (fresh && config.ownerId) { try { db.addNotification(config.ownerId, { type: "indie", title: `Report on ${g.title}`, body: reason.slice(0, 150), url: "/admin#/indie" }); } catch { /* the queue shows it */ } }
            return { ok: true, already: !fresh };
        },
        // Numbers for the developer: the last two weeks of views and clicks, review growth, followers.
        "GET /api/indie/stats": async (req, _b, url) => {
            const s = session(req), g = db.indieGet(url.searchParams.get("id"));
            if (!g || g.owner_id !== s.userId) throw new HttpError(404, "That game isn't yours.");
            return { days: db.indieDays(g.id, 14), reviews: db.indieReviewHistory(g.id, 60), views: g.views, clicks: g.clicks, likes: g.likes, followers: db.indieFollowCount(g.id), updates7: db.indieUpdatesSince(g.id, now() - 7 * 86_400_000), release: g.release };
        },
        // ---------- the indie dev panel: for developers with an approved game ----------
        "GET /api/indie/dev": async (req) => {
            const s = devSession(req);
            const games = db.indieByOwner(s.userId).map(g => ({ id: g.id, title: g.title, image: g.image, status: g.status, studio: g.studio, verified: Boolean(g.verified), keysOpen: Boolean(g.keys_open), views: g.views, clicks: g.clicks, likes: g.likes, followers: db.indieFollowCount(g.id), requests: db.indieKeyCounts(g.id), pool: db.indieKeyPool(g.id), days: db.indieDays(g.id, 14), updates: db.indieUpdates(g.id, 3).map(u => ({ id: u.id, title: u.title, created: u.created })) }));
            return { games, pending: games.reduce((n, g) => n + g.requests.pending, 0), site: origin };
        },
        "GET /api/indie/dev/requests": async (req, _b, url) => {
            const s = devSession(req), q = url.searchParams;
            const game = Number(q.get("game")) || null;
            if (game && db.indieGet(game)?.owner_id !== s.userId) throw new HttpError(404, "That game isn't yours.");
            return { requests: db.indieKeyInbox(s.userId, { game, status: q.get("status"), q: q.get("q"), limit: 300 }).map(k => ({ id: k.id, gameId: k.game_id, game: k.game_title, name: k.name, channel: k.channel, note: k.note, status: k.status, created: k.created, decided: k.decided, reply: k.reply, keySent: Boolean(k.key_sent) })) };
        },
        "POST /api/indie/dev/decide": async (req, body) => {
            const s = devSession(req);
            const ids = [...new Set((Array.isArray(body.ids) ? body.ids : [body.id]).map(Number).filter(Boolean))].slice(0, 50);
            if (!ids.length) throw new HttpError(400, "Pick at least one request.");
            const note = String(body.note ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || null, out = [];
            for (const id of ids) {
                const k = db.indieKeyRequestGet(id), g = k && db.indieGet(k.game_id);
                if (!k || !g || g.owner_id !== s.userId) { out.push({ id, skipped: "not yours" }); continue; }
                out.push(await decideKeyRequest(g, k, Boolean(body.approve), note));
            }
            return { results: out, approved: out.filter(r => r.status === "approved").length, declined: out.filter(r => r.status === "declined").length, sent: out.filter(r => r.sent).length, noKeys: out.filter(r => r.status === "approved" && !r.sent).length };
        },
        "GET /api/indie/dev/keys": async (req, _b, url) => {
            const s = devSession(req), g = db.indieGet(url.searchParams.get("id"));
            if (!g || g.owner_id !== s.userId) throw new HttpError(404, "That game isn't yours.");
            return { pool: db.indieKeyPool(g.id), keys: db.indieKeyList(g.id).map(k => ({ id: k.id, key: k.key, sentTo: k.sent_to ? true : false, sentAt: k.sent_at })) };
        },
        "POST /api/indie/dev/keys/add": async (req, body) => {
            const s = devSession(req), g = db.indieGet(body.id);
            if (!g || g.owner_id !== s.userId) throw new HttpError(404, "That game isn't yours.");
            const lines = String(body.keys ?? "").split(/[\r\n,;]+/).map(x => x.trim()).filter(Boolean).slice(0, 500);
            if (!lines.length) throw new HttpError(400, "Paste one key per line.");
            const r = db.indieKeysAdd(g.id, lines);
            return { ...r, pool: db.indieKeyPool(g.id) };
        },
        "POST /api/indie/dev/keys/remove": async (req, body) => {
            const s = devSession(req), g = db.indieGet(body.game);
            if (!g || g.owner_id !== s.userId) throw new HttpError(404, "That game isn't yours.");
            if (body.all) db.indieKeyClear(g.id); else db.indieKeyRemove(g.id, body.id);
            return { pool: db.indieKeyPool(g.id) };
        },
        ...adminRoutes,
    };
}

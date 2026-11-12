// The social pages' API: the feed, people and servers directory, leaderboards and discovery.
// server.js passes in the helpers it already has (ctx) and merges these routes into its table.
import { HttpError } from "./http.js";
import { REACTIONS } from "../socialstore.js";
import { decodeUpload } from "../profilebg.js";
import { friendFromFollow } from "../friends.js";
import { steamArt } from "../render.js";

export function createSocialRoutes(ctx) {
    const { authorCard, clientIp, config, db, directory, guildList, isManager, isOwner, mayPost, notifySocial, now, peopleList, reactSeen, serverFilter, session, shapeItems, slugOwner, socialRead, socialWrite, softSession, userRow } = ctx;
    return {
        // ---- the community feed
        "GET /api/social/feed": async (req, _b, url) => {
            const sess = softSession(req);
            if (!socialRead.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little.");
            const asked = url.searchParams.get("scope");
            const scope = asked === "servers" ? "servers" : ["following", "mine"].includes(asked) && sess ? asked : "everyone";
            const servers = directory();
            const guilds = scope === "servers" ? serverFilter(sess, url.searchParams.get("server")) : null;
            const author = url.searchParams.get("author") ? slugOwner(url.searchParams.get("author")).discord_id : null;
            const r = db.feed(sess?.userId ?? null, { scope, before: url.searchParams.get("before"), appid: Number(url.searchParams.get("game")) || null, author, limit: 20, guilds });
            const following = sess ? db.followCounts(sess.userId).following : 0;
            return { items: shapeItems(r.items, sess?.userId, servers), more: r.more, signedIn: Boolean(sess), following, reactions: REACTIONS, servers: servers.map(g => ({ id: g.id, name: g.name })) };
        },
        // The games a member can tag a post with: their own library, most played first.
        "GET /api/social/mygames": async (req) => {
            const s = session(req); userRow(s);
            return { games: db.listLibrary(s.userId).filter(g => g.appid).sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0)).slice(0, 300).map(g => ({ appid: g.appid, title: g.title })) };
        },
        // Every server the bot is in (that has not opted out), busiest first, so anyone can find a community to join.
        "GET /api/social/servers": async (req) => {
            const sess = softSession(req);
            if (!socialRead.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little.");
            const dir = directory(), stats = db.socialGuildStats(dir.map(g => g.id), now() - 7 * 86400_000);
            const list = dir.map(g => { const st = stats.get(g.id) ?? { people: 0, active: 0 }, gs = db.guildSocial(g.id); return { id: g.id, name: g.name, members: g.members, people: st.people, active: st.active, about: gs.about, invite: gs.invite || null }; })
                .sort((a, b) => b.active - a.active || b.people - a.people || (b.members ?? 0) - (a.members ?? 0) || a.name.localeCompare(b.name));
            const mine = sess ? (sess.guilds ?? []).filter(g => isManager(g) && (guildList?.() ?? []).some(x => x.id === g.id)).map(g => ({ id: g.id, name: g.name, ...db.guildSocial(g.id) })) : [];
            return { servers: list, manage: mine };
        },
        "GET /api/social/server": async (req, _b, url) => {
            const sess = softSession(req);
            const id = String(url.searchParams.get("id") ?? "");
            const g = directory().find(x => x.id === id);
            if (!g) throw new HttpError(404, "That server isn't in the community directory.");
            const st = db.socialGuildStats([id], now() - 7 * 86400_000).get(id) ?? { people: 0, active: 0 }, gs = db.guildSocial(id);
            return { server: { id, name: g.name, members: g.members, people: st.people, active: st.active, about: gs.about, invite: gs.invite || null }, people: peopleList(db.guildMembers(id, 24), sess?.userId ?? null) };
        },
        // A server's managers choose whether it is listed, what it says about itself and where people can join.
        "POST /api/social/server": async (req, body) => {
            const s = session(req);
            const g = s.guilds.find(x => x.id === String(body.guild ?? ""));
            if (!g || !isManager(g)) throw new HttpError(403, "Only people who manage that server can change this.");
            const r = db.setGuildSocial(g.id, { listed: body.listed === undefined ? undefined : Boolean(body.listed), about: body.about, invite: body.invite });
            if (r.error) throw new HttpError(400, r.error);
            return { settings: r };
        },
        "GET /api/social/item": async (req, _b, url) => {
            const sess = softSession(req);
            const t = db.thread(url.searchParams.get("id"), sess?.userId ?? null);
            if (!t) throw new HttpError(404, "That post is gone.");
            const servers = directory();
            return { item: shapeItems([t.item], sess?.userId, servers)[0], replies: shapeItems(t.replies, sess?.userId, servers), reactions: REACTIONS };
        },
        "POST /api/social/post": async (req, body) => {
            const s = session(req); userRow(s); mayPost(s);
            if (!socialWrite.hit("u" + s.userId).ok) throw new HttpError(429, "Slow down a little.");
            let appid = null, game = null;
            if (body.appid && !body.parent) {
                const g = db.listLibrary(s.userId).find(x => x.appid === Number(body.appid));
                if (!g) throw new HttpError(400, "Pick a game from your own library.");
                appid = g.appid; game = g.title;
            }
            let img = null;
            if (body.image) {
                if (body.parent) throw new HttpError(400, "Pictures go on posts, not replies.");
                try { img = decodeUpload(body.image); } catch (e) { throw new HttpError(400, e.message); }
            }
            const r = db.createPost(s.userId, { body: body.body, appid, game, parentId: body.parent ?? null, hasImage: Boolean(img) }, { staff: s.userId === config.ownerId });
            if (r.error) throw new HttpError(r.status ?? 400, r.error);
            if (img) db.addPostImage(r.id, s.userId, img.mime, img.buf);
            if (r.parentAuthor && r.parentAuthor !== s.userId) notifySocial(r.parentAuthor, { title: `${authorCard(s.userId).name} replied to your post`, body: String(body.body ?? "").trim().slice(0, 140), url: "/feed" });
            return { id: r.id };
        },
        "POST /api/social/react": async (req, body) => {
            const s = session(req); userRow(s);
            if (!socialWrite.hit("u" + s.userId).ok) throw new HttpError(429, "Slow down a little.");
            const emoji = body.emoji === null || body.emoji === undefined ? null : String(body.emoji);
            if (emoji !== null && !REACTIONS.includes(emoji)) throw new HttpError(400, "Pick one of the reactions.");
            const id = Number(body.id);
            const item = db.getItem(id);
            const visible = item && (item.hidden === 0 || item.discord_id === s.userId) && !db.blockedEither(s.userId, item.discord_id);
            if (!visible) throw new HttpError(404, "That post is gone.");
            const mine = db.react(id, s.userId, emoji);
            if (mine && item.discord_id !== s.userId && !reactSeen.has(`${s.userId}:${id}`)) {
                reactSeen.add(`${s.userId}:${id}`); if (reactSeen.size > 20000) reactSeen.clear();
                notifySocial(item.discord_id, { title: `${authorCard(s.userId).name} reacted ${mine} to your ${item.parent_id ? "reply" : "post"}`, body: String(item.body ?? "").slice(0, 100) || null, url: "/feed" });
            }
            return { mine };
        },
        "POST /api/social/delete": async (req, body) => {
            const s = session(req);
            const item = db.getItem(Number(body.id));
            if (!item) throw new HttpError(404, "That post is gone.");
            if (item.discord_id !== s.userId && !isOwner(s)) throw new HttpError(403, "That one is not yours.");
            db.deleteItem(item.id);
            return { deleted: true };
        },
        "POST /api/social/report": async (req, body) => {
            const s = session(req);
            if (!socialWrite.hit("u" + s.userId).ok) throw new HttpError(429, "Slow down a little.");
            const r = db.report(Number(body.id), s.userId, body.reason);
            if (!r) throw new HttpError(404, "Nothing to report there.");
            return { reported: true };
        },
        "POST /api/social/follow": async (req, body) => {
            const s = session(req); userRow(s);
            if (!socialWrite.hit("u" + s.userId).ok) throw new HttpError(429, "Slow down a little.");
            const o = slugOwner(body.slug);
            const r = db.follow(s.userId, o.discord_id, body.on !== false);
            if (r === "self") throw new HttpError(400, "That's you.");
            if (r === "blocked") throw new HttpError(403, "You can't follow this person.");
            if (r === "limit") throw new HttpError(429, "You are following as many people as you can. Unfollow someone first.");
            if (r === "new") friendFromFollow(db, s.userId, { name: authorCard(o.discord_id).name, slug: o.profile_slug ?? body.slug });
            if (r === "ok" && body.on === false) db.dropFollowedFriend(s.userId, String(o.profile_slug ?? body.slug).toLowerCase());
            if (r === "new") { const me = authorCard(s.userId); notifySocial(o.discord_id, { title: `${me.name} followed you`, url: me.slug ? "/u/" + me.slug : "/feed" }); }
            return { following: body.on !== false, ...db.followCounts(o.discord_id) };
        },
        "POST /api/social/block": async (req, body) => {
            const s = session(req);
            const o = db.getProfileBySlug(String(body.slug ?? "").toLowerCase());
            if (!o) throw new HttpError(404, "That page does not exist.");
            if (o.discord_id === s.userId) throw new HttpError(400, "That's you.");
            db.setBlock(s.userId, o.discord_id, body.on !== false);
            return { blocked: body.on !== false };
        },
        "GET /api/social/people": async (req) => {
            const s = session(req); userRow(s);
            return { ...db.followCounts(s.userId), followers: peopleList(db.listFollowers(s.userId), s.userId), following: peopleList(db.listFollowing(s.userId).filter(x => x.slug), s.userId),
                blocked: db.listBlocks(s.userId).map(b => ({ slug: b.slug, name: b.slug ?? "Someone" })).filter(b => b.slug), prefs: db.getPrefs(s.userId) };
        },
        "POST /api/social/prefs": async (req, body) => {
            const s = session(req); userRow(s);
            return { prefs: db.setPrefs(s.userId, { events: body.events, digest: body.digest, notify: body.notify, dm: body.dm, guestbook: body.guestbook }) };
        },
        "GET /api/social/leaderboards": async (req, _b, url) => {
            if (!socialRead.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little.");
            const guilds = serverFilter(softSession(req), url.searchParams.get("server"));
            const b = db.leaderboards(guilds, { postsSince: now() - 7 * 86400_000, finishedSince: now() - 30 * 86400_000 });
            const shape = rows => rows.map(r => ({ by: authorCard(r.id), n: r.n })).filter(r => r.by.slug);
            return { boards: [
                { key: "active", title: "Most active this week", unit: "posts", rows: shape(b.active) },
                { key: "finished", title: "Most games finished this month", unit: "finished", rows: shape(b.finished) },
                { key: "rare", title: "Most rare achievements", unit: "rare", rows: shape(b.rare) }] };
        },
        "GET /api/social/discover": async (req, _b, url) => {
            const sess = softSession(req);
            if (!socialRead.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little.");
            const week = now() - 7 * 86400_000;
            const which = url.searchParams.get("server");
            const guilds = sess && which ? serverFilter(sess, which) : null;
            return {
                servers: directory().map(g => ({ id: g.id, name: g.name })),
                trending: db.trendingGames(week, 10, guilds).map(g => ({ appid: g.appid, game: g.game, people: g.people, posts: g.posts, finishes: g.finishes, art: steamArt(g.appid) })),
                rare: db.rareBoard(10, 2, guilds).map(r => ({ ...authorCard(r.discord_id), game: r.game, achievement: r.name, icon: r.icon, pct: r.pct })),
                similar: sess ? peopleList(db.similarPeople(sess.userId, 8), sess.userId) : []
            };
        },
        "GET /api/social/game": async (req, _b, url) => {
            const sess = softSession(req);
            const appid = Number(url.searchParams.get("appid"));
            if (!Number.isInteger(appid) || appid <= 0) throw new HttpError(400, "Which game?");
            return { appid, art: steamArt(appid), owners: db.ownerCount(appid), people: peopleList(db.gameOwners(appid, 12), sess?.userId ?? null) };
        },
        // Two libraries side by side. Only for members who chose to show their Steam stats, since this shows what they own.
        "GET /api/social/compare": async (req, _b, url) => {
            const s = session(req); userRow(s);
            const o = slugOwner(url.searchParams.get("slug"));
            if (o.discord_id === s.userId) throw new HttpError(400, "That's you.");
            const shows = (db.getProfileData(o.discord_id).data.sections ?? []).some(x => x.key === "steam" && x.vis === "public");
            if (!shows) throw new HttpError(403, "This member keeps their library to themselves.");
            return { them: authorCard(o.discord_id), ...db.compareLibraries(s.userId, o.discord_id) };
        },
    };
}

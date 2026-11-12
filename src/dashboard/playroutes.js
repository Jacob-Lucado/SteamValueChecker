// Play together: looking for group, the calendar, game night, Santa, trivia and co-op.
// server.js passes in the helpers it already has (ctx) and merges these routes into its table.
import { HttpError } from "./http.js";
import { KINDS, calendarEntries } from "../calendar.js";
import { UserError } from "../errors.js";
import { compareLibraries } from "../compare.js";
import { createEvent, drawEvent, endEvent, eventEmbed, joinEvent, leaveEvent, myAssignment, revealEmbed } from "../santa.js";
import { gameNight } from "../gamenight.js";
import { whoIsPlaying } from "../nowplaying.js";

export function createPlayRoutes(ctx) {
    const { botGuilds, calendar, cooldown, db, dm, guildFor, isManager, isOwner, itad, lfg, managerGuild, now, nowPlaying, origin, rest, session, trivia, userRow } = ctx;
    return {
        // Game night on the dashboard: pick opted-in members of a server and see what they can play and buy together.
        "GET /api/gamenight/members": async (req, _b, url) => {
            const s = session(req); const g = guildFor(s, url.searchParams.get("guild"));
            const ids = db.sharingMembers(g.id).slice(0, 60);
            return { members: await Promise.all(ids.map(async id => ({ id, name: (await rest.memberName(g.id, id)) || "Member " + id.slice(-4) }))) };
        },
        "GET /api/santa": async (req, _b, url) => {
            const s = session(req), g = guildFor(s, String(url.searchParams.get("guild") ?? ""));
            const ev = db.getSanta(g.id), canManage = isManager(g) || isOwner(s);
            const channels = canManage ? (await rest.listChannels(g.id).catch(() => [])).filter(c => c.type === undefined || c.type === 0 || c.type === 5).map(c => ({ id: c.id, name: c.name })) : [];
            if (!ev) return { event: null, canManage, channels };
            const entries = db.santaEntries(ev.id);
            const people = await Promise.all(entries.map(async e => ({ userId: e.user_id, name: (await rest.memberName(g.id, e.user_id).catch(() => null)) || "Member " + String(e.user_id).slice(-4) })));
            const mine = db.santaEntry(ev.id, s.userId);
            return { event: { id: ev.id, title: ev.title, budget: ev.budget, currency: ev.currency, status: ev.status, channel: ev.channel_id }, people, joined: Boolean(mine), drawn: Boolean(mine?.giftee_id), canManage, channels };
        },
        "POST /api/santa": async (req, body) => {
            const s = session(req), g = guildFor(s, String(body.guild_id ?? ""));
            const manager = isManager(g) || isOwner(s);
            const nameOf = async id => (await rest.memberName(g.id, id).catch(() => null)) || `<@${id}>`;
            const fail = e => { if (e instanceof UserError) throw new HttpError(400, e.message); throw e; };
            try {
                switch (body.action) {
                    case "join": return { ok: true, joined: joinEvent(db, g.id, s.userId).joined };
                    case "leave": return { ok: true, left: leaveEvent(db, g.id, s.userId).left };
                    case "ideas": {
                        const dm_ = await myAssignment({ db, itad, guildId: g.id, userId: s.userId, nameOf, guildName: g.name });
                        return { ok: true, text: dm_.embeds[0].description, title: dm_.embeds[0].title };
                    }
                }
                if (!manager) throw new HttpError(403, "You need the Manage Server permission for that.");
                if (body.action === "create") {
                    const channelId = String(body.channel_id ?? "");
                    if (channelId && !(await rest.listChannels(g.id).catch(() => [])).some(c => c.id === channelId)) throw new HttpError(400, "That channel isn't in this server.");
                    const ev = createEvent(db, { guildId: g.id, channelId: channelId || null, title: body.title, budget: body.budget, region: userRow(s).region || "US", by: s.userId });
                    if (channelId) await rest.sendMessage(channelId, { embeds: [eventEmbed(ev, [], { guildName: g.name })], allowed_mentions: { parse: [] } }).catch(() => {});
                    return { ok: true };
                }
                if (body.action === "draw") {
                    if (!dm) throw new HttpError(400, "Sending messages isn't available here.");
                    const r = await drawEvent({ db, itad, sendDm: (id, p) => dm(id, p), nameOf, guildName: g.name, guildId: g.id });
                    return { ok: true, count: r.count, failed: r.failed.length };
                }
                if (body.action === "reveal") {
                    const { event, entries } = endEvent(db, g.id);
                    if (event.channel_id) await rest.sendMessage(event.channel_id, { embeds: [revealEmbed(event, entries)], allowed_mentions: { parse: [] } }).catch(() => {});
                    return { ok: true };
                }
            } catch (e) { fail(e); }
            throw new HttpError(400, "Unknown action.");
        },
        "GET /api/trivia": async (req, _b, url) => {
            const s = session(req), g = guildFor(s, String(url.searchParams.get("guild") ?? ""));
            const canManage = isManager(g) || isOwner(s);
            const channels = canManage ? (await rest.listChannels(g.id).catch(() => [])).filter(c => c.type === undefined || c.type === 0 || c.type === 5).map(c => ({ id: c.id, name: c.name })) : [];
            if (!trivia) return { enabled: false, canManage, channels, active: null, top: [] };
            const top = await Promise.all(trivia.top(g.id, 10).map(async r => ({ userId: r.user_id, name: (await rest.memberName(g.id, r.user_id).catch(() => null)) || "Member " + String(r.user_id).slice(-4), points: r.points, correct: r.correct, wins: r.wins })));
            return { enabled: true, canManage, channels, active: trivia.active(g.id), top, mine: db.triviaRank(g.id, s.userId) };
        },
        "POST /api/trivia": async (req, body) => {
            const s = session(req), g = guildFor(s, String(body.guild_id ?? ""));
            if (!(isManager(g) || isOwner(s))) throw new HttpError(403, "You need the Manage Server permission to run trivia.");
            if (!trivia) throw new HttpError(400, "Trivia isn't available right now.");
            try {
                if (body.action === "start") {
                    const channelId = String(body.channel_id ?? "");
                    if (!(await rest.listChannels(g.id).catch(() => [])).some(c => c.id === channelId)) throw new HttpError(400, "Pick a channel in this server.");
                    const r = await trivia.start({ guildId: g.id, channelId, rounds: body.rounds, by: s.userId });
                    return { ok: true, rounds: r.rounds };
                }
                if (body.action === "stop") { trivia.stop(g.id); return { ok: true }; }
            } catch (e) { if (e instanceof UserError) throw new HttpError(400, e.message); throw e; }
            throw new HttpError(400, "Unknown action.");
        },
        "GET /api/nowplaying": async (req, _b, url) => {
            // Same rules as /server nowplaying: members who turned it on (/alerts nowplaying) and share their library.
            const s = session(req);
            const g = guildFor(s, String(url.searchParams.get("guild") ?? ""));
            if (!nowPlaying?.enabled) return { enabled: false, games: [], watching: 0 };
            const r = await whoIsPlaying(db, nowPlaying, g.id);
            const games = await Promise.all(r.games.map(async x => ({ appid: x.appid, game: x.game, players: await Promise.all(x.players.map(async p => ({ userId: p.userId, name: (await rest.memberName(g.id, p.userId).catch(() => null)) || p.name || "Member " + String(p.userId).slice(-4) }))) })));
            return { enabled: true, games, watching: r.watching };
        },
        "GET /api/compare": async (req, _b, url) => {
            // Same rules as /server compare: a friend in one of your servers who turned on sharing (/alerts share).
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
        "GET /api/coop": async (req, _b, url) => {
            const s = session(req); const g = guildFor(s, String(url.searchParams.get("guild") ?? ""));
            const title = String(url.searchParams.get("game") ?? "").trim().slice(0, 100);
            if (!title) throw new HttpError(400, "Type a game name first.");
            const [hit] = await itad.lookupTitles([title]);
            if (!hit?.id) throw new HttpError(404, `I could not find a game called ${title}.`);
            const owners = await Promise.all(db.ownersOf(g.id, hit.id).map(async o => ({ name: (await rest.memberName(g.id, o.discord_id)) || "Member " + o.discord_id.slice(-4), hours: Math.round((o.minutes ?? 0) / 60) })));
            return { game: hit.approx ? hit.matched : title, owners };
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
    };
}

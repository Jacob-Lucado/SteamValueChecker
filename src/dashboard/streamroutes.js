// Streaming: going live, the stream card, who is live, and the giveaway overlay's data.
// server.js passes in the helpers it already has (ctx) and merges these routes into its table.
import { HttpError } from "./http.js";
import { STEP_KINDS, StepError, parseSteps, stepsOf } from "../gwpartner.js";
import { STREAMCARD_KINDS, chatCommandSets } from "../streamcard.js";
import { UserError } from "../errors.js";
import { canStreamIn } from "../streamlive.js";
import { channelUrl, parseChannel, watchable } from "../streamwatch.js";
import { giveawayInput } from "../gwinput.js";

export function createStreamRoutes(ctx) {
    const { cardsFor, clientIp, cooldown, db, guildChoices, gwOverlayPicks, isManager, isOwner, musicCall, musicMember, now, origin, overlayLimit, remember, rest, rolesIn, session, streamAccess, streamGw, streams, twitchReply, userRow } = ctx;
    return {
        // ----- going live: the streamer role, the live channel and the opt-in ping -----
        "GET /api/streams": async (req, _b, url) => {
            const s = session(req); const g = musicMember(s, url.searchParams.get("guild"));
            const c = db.getCommunity(g.id), mgr = isManager(g) || isOwner(s), roleIds = mgr ? [] : await rolesIn(g.id, s.userId);
            const out = {
                guild: { id: g.id, name: g.name }, me: s.userId,
                settings: { streamer_role_id: c.streamer_role_id, live_channel: c.live_channel, ping_stream: c.ping_stream, auto: c.stream_auto !== 0 },
                live: db.listStreamLive(g.id).map(r => ({ userId: r.user_id, title: r.title, url: r.url, game: r.game, since: r.started, mine: r.user_id === s.userId })),
                can: { go: canStreamIn(c, { roleIds, isManager: isManager(g), isBotOwner: isOwner(s) }), manage: mgr },
                optedIn: streams ? await streams.optedIn(g.id, s.userId) : null,
                links: db.getStreamLinks(g.id, s.userId).map(l => ({ platform: l.platform, handle: l.handle, url: channelUrl(l.platform, l.handle) })),
                link: (l => (l ? { platform: l.platform, handle: l.handle, url: channelUrl(l.platform, l.handle) } : null))(db.getStreamLink(g.id, s.userId)),
                watch: watchable(process.env),
                chatReplies: Boolean(twitchReply), stepKinds: Object.entries(STEP_KINDS).map(([id, k]) => ({ id, label: k.label, hint: k.hint }))
            };
            if (mgr) { const ch = await remember("choices:" + g.id, 60_000, () => guildChoices(g.id)); out.channels = ch.channels; out.roles = ch.roles; }
            return out;
        },
        "POST /api/streams/live": async (req, body) => {
            const s = session(req); const g = await streamAccess(s, body.guild_id);
            if (!streams) throw new HttpError(503, "Streams aren't available on this bot right now.");
            cooldown(s.userId, "streamlive");
            const me = (await remember("mname:" + g.id + ":" + s.userId, 10 * 60_000, () => rest.memberName(g.id, s.userId)).catch(() => null)) || s.username || "Someone";
            return musicCall(() => streams.goLive(g.id, { id: s.userId, name: me, avatarUrl: null }, { title: body.title, url: body.url, game: body.game }));
        },
        // A giveaway for the viewers of this stream: one key, drawn when the stream ends.
        "POST /api/streams/giveaway": async (req, body) => {
            const s = session(req); const g = await streamAccess(s, body.guild_id);
            if (!streamGw.enabled()) throw new HttpError(503, "Giveaways aren't set up on this bot.");
            cooldown(s.userId, "streamgw");
            const me = (await remember("mname:" + g.id + ":" + s.userId, 10 * 60_000, () => rest.memberName(g.id, s.userId)).catch(() => null)) || s.username || "Someone";
            // The full form sends `keys` (a list of prizes) and every option; the short one sends a single `key`.
            if (body.keys === undefined) {
                const r = await musicCall(() => streamGw.start(g.id, { id: s.userId, name: me }, { game: body.game, key: body.key, minutes: body.minutes }));
                return { ok: true, channelId: r.channelId, endsAt: r.endsAt, endsWithStream: true, prizes: 1 };
            }
            const form = { ...body };
            if (!(isManager(g) || isOwner(s))) for (const k of ["require_role_id", "require_role_ids", "require_all", "bonus_role_id", "bonus_role_ids", "override_role_id", "override_role_ids", "ping_role_id", "vouch_channel_id"]) delete form[k]; // server rules are the managers' call
            const r = await musicCall(async () => {
                const { input } = giveawayInput(form, { defaults: { length: "1h", prize: "Prize" } });
                // Chat entry: viewers type !enter in the streamer's Twitch chat. Needs their Twitch channel linked here, and a Discord invite to point newcomers at.
                let chat = null;
                if (body.chat_enter) {
                    if (!db.getStreamLink(g.id, s.userId, "twitch")) throw new UserError("Link your Twitch channel first (the Your channel box above), so I know which chat to listen to.");
                    let invite = null;
                    if (String(body.chat_invite ?? "").trim()) { try { invite = parseSteps([{ kind: "join_discord", url: body.chat_invite }])[0].url; } catch (e) { if (e instanceof StepError) throw new UserError("The Discord link for chat must be an invite, like https://discord.gg/yourserver."); throw e; } }
                    chat = { invite };
                }
                return streamGw.start(g.id, { id: s.userId, name: me }, { input, endWithStream: body.end_with_stream !== false, chat });
            });
            return { ok: true, channelId: r.channelId, endsAt: r.endsAt, endsWithStream: r.endsWithStream, prizes: r.prizes, chat: r.chat, chatReplies: Boolean(twitchReply) };
        },
        // everyone linked in a server, with who is live right now (any member may look: it is only public channel names)
        "GET /api/streams/roster": async (req, _b, url) => {
            const s = session(req); const g = musicMember(s, url.searchParams.get("guild"));
            const live = new Map(db.listStreamLive(g.id).map(r => [r.user_id, r]));
            const watch = watchable(process.env);
            const people = (await Promise.all([...new Map(db.listStreamLinks(g.id).map(l => [l.user_id, l])).values()].map(async l => { // one card per person, however many channels they linked
                const m = await remember("smem:" + g.id + ":" + l.user_id, 10 * 60_000, () => rest.getMember(g.id, l.user_id)).catch(() => undefined);
                if (m === null) return null; // left the server
                const u = m?.user ?? {};
                const avatar = m?.avatar ? `https://cdn.discordapp.com/guilds/${g.id}/users/${l.user_id}/avatars/${m.avatar}.png?size=96` : u.avatar ? `https://cdn.discordapp.com/avatars/${l.user_id}/${u.avatar}.png?size=96` : null;
                const row = live.get(l.user_id);
                return { userId: l.user_id, name: m?.nick || u.global_name || u.username || "Streamer", avatar, platform: l.platform, handle: l.handle, url: channelUrl(l.platform, l.handle).replace(/\/live$/, ""), checked: Boolean(watch[l.platform]), mine: l.user_id === s.userId,
                    channels: db.getStreamLinks(g.id, l.user_id).map(x => ({ platform: x.platform, handle: x.handle, url: channelUrl(x.platform, x.handle).replace(/\/live$/, ""), checked: Boolean(watch[x.platform]) })),
                    live: row ? { title: row.title, game: row.game, url: row.url, since: row.started, also: row.also ?? [] } : null };
            }))).filter(Boolean);
            people.sort((a, b) => Number(Boolean(b.live)) - Number(Boolean(a.live)) || a.name.localeCompare(b.name));
            return { guild: { id: g.id, name: g.name }, people, liveChannel: db.getCommunity(g.id).live_channel ? true : false, now: now() };
        },
        "POST /api/streams/link": async (req, body) => {
            const s = session(req); const g = await streamAccess(s, body.guild_id);
            cooldown(s.userId, "streamlink");
            if (!db.getCommunity(g.id).live_channel) throw new HttpError(400, "This server has no live channel yet. A manager can pick one below.");
            let ch; try { ch = parseChannel(body.channel); } catch (e) { throw new HttpError(400, e.message); }
            db.setStreamLink(g.id, s.userId, { platform: ch.platform, handle: ch.handle, via: isOwner(s) ? "owner" : isManager(g) ? "manager" : "role", added: now() });
            return { link: { platform: ch.platform, handle: ch.handle, url: channelUrl(ch.platform, ch.handle) }, links: db.getStreamLinks(g.id, s.userId).map(l => ({ platform: l.platform, handle: l.handle, url: channelUrl(l.platform, l.handle) })), watch: watchable(process.env) };
        },
        "POST /api/streams/unlink": async (req, body) => {
            const s = session(req); const g = musicMember(s, body.guild_id);
            const site = ["twitch", "kick", "youtube"].includes(body.platform) ? body.platform : null;
            db.removeStreamLink(g.id, s.userId, site);
            return { ok: true, links: db.getStreamLinks(g.id, s.userId).map(l => ({ platform: l.platform, handle: l.handle, url: channelUrl(l.platform, l.handle) })) };
        },
        "POST /api/streams/end": async (req, body) => {
            const s = session(req); const g = musicMember(s, body.guild_id);
            if (!streams) throw new HttpError(503, "Streams aren't available on this bot right now.");
            const target = body.user_id && body.user_id !== s.userId ? String(body.user_id) : s.userId;
            if (target !== s.userId && !(isManager(g) || isOwner(s))) throw new HttpError(403, "Only managers can end someone else's stream.");
            const me = (await remember("mname:" + g.id + ":" + target, 10 * 60_000, () => rest.memberName(g.id, target)).catch(() => null)) || "Someone";
            await musicCall(() => streams.endLive(g.id, { id: target, name: me }));
            return { ok: true };
        },
        "POST /api/streams/ping": async (req, body) => {
            const s = session(req); const g = musicMember(s, body.guild_id);
            if (!streams) throw new HttpError(503, "Streams aren't available on this bot right now.");
            cooldown(s.userId, "streamping");
            const r = await musicCall(() => streams.setOptIn(g.id, s.userId, Boolean(body.on)));
            return { optedIn: r.on };
        },
        "POST /api/streams/settings": async (req, body) => {
            const s = session(req); const g = musicMember(s, body.guild_id);
            if (!(isManager(g) || isOwner(s))) throw new HttpError(403, "You need the Manage Server permission there.");
            const ch = await remember("choices:" + g.id, 60_000, () => guildChoices(g.id));
            const patch = {};
            const pick = (k, list) => { if (!(k in body)) return; const v = body[k] ? String(body[k]) : null; if (v && !list.some(x => x.id === v)) throw new HttpError(400, "That isn't in this server."); return v; };
            for (const [k, list] of [["streamer_role_id", ch.roles], ["live_channel", ch.channels], ["ping_stream", ch.roles]]) { const v = pick(k, list); if (v !== undefined) patch[k] = v; }
            if ("auto" in body) patch.stream_auto = body.auto ? 1 : 0;
            const c = db.setCommunity(g.id, patch);
            return { settings: { streamer_role_id: c.streamer_role_id, live_channel: c.live_channel, ping_stream: c.ping_stream, auto: c.stream_auto !== 0 } };
        },
        // The streamer's deals overlay for OBS: their own private link, no server needed.
        "GET /api/streamcard": async (req) => {
            const s = session(req), o = db.getStreamCard(s.userId), u = userRow(s);
            return { on: Boolean(o), token: o?.token ?? null, kinds: o?.kinds ?? STREAMCARD_KINDS, base: origin + "/streamcard", chat: o ? chatCommandSets(k => `${origin}/api/streamcard/text?token=${o.token}&kind=${k}`) : null, slug: u.profile_slug ?? null, public: Boolean(u.profile_public) };
        },
        "POST /api/streamcard": async (req, body) => {
            const s = session(req); userRow(s);
            if (body.action === "remove") { db.removeStreamCard(s.userId); return { on: false, token: null }; }
            if (body.action === "save") { if (!db.getStreamCard(s.userId)) throw new HttpError(404, "Make your link first."); db.setStreamCardKinds(s.userId, Array.isArray(body.kinds) ? body.kinds : []); return { on: true, kinds: db.getStreamCard(s.userId).kinds }; }
            if (body.action !== "create" && body.action !== "reset") throw new HttpError(400, "Unknown action.");
            const had = db.getStreamCard(s.userId), token = db.resetStreamCard(s.userId);
            if (had && body.action === "reset") db.setStreamCardKinds(s.userId, had.kinds);
            return { on: true, token, kinds: db.getStreamCard(s.userId).kinds };
        },
        // What the overlay page asks for. No sign-in: the long random link is the key. Answers are kept five minutes so OBS can ask often.
        "GET /api/streamcard/data": async (req, _b, url) => {
            if (!overlayLimit.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little.");
            const o = db.streamCardByToken(String(url.searchParams.get("token") ?? ""));
            if (!o) throw new HttpError(404, "This overlay link isn't valid. Make a new one on the Streamer hub.");
            return await cardsFor(o, o.kinds);
        },
        // The giveaway overlay's numbers: the giveaways the streamer picked (or, with no pick, their latest stream giveaway), with winners once drawn.
        "GET /api/giveawayoverlay/data": async (req, _b, url) => {
            if (!overlayLimit.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little.");
            const o = db.streamCardByToken(String(url.searchParams.get("token") ?? ""));
            if (!o) throw new HttpError(404, "This overlay link isn't valid. Make a new one on the Streamer hub.");
            const HOLD = 10 * 60_000, picked = gwOverlayPicks(o.user_id);
            let rows = picked.map(id => db.getGiveaway(id)).filter(g => g && (g.status === "active" || g.status === "scheduled" || now() - (g.ended_at ?? g.ends_at) <= HOLD));
            if (!rows.length) { const l = streamGw.latest(o.user_id); rows = l ? [l] : []; }
            const card = async g => {
                const keys = db.listKeys(g.id), over = g.status !== "active" && g.status !== "scheduled";
                const winners = over ? await Promise.all(keys.filter(k => k.winner_id).map(async k => ({ prize: k.label, name: (await remember("mname:" + g.guild_id + ":" + k.winner_id, 10 * 60_000, () => rest.memberName(g.guild_id, k.winner_id)).catch(() => null)) || "A viewer" }))) : [];
                return { id: g.id, title: g.title, game: g.game_title ?? null, prizes: keys.map(k => k.label), entries: db.countEntries(g.id), endsAt: g.ends_at, startedAt: g.starts_at ?? g.created_at, status: over ? "ended" : g.status, steps: stepsOf(g).map(x => ({ label: x.label, kind: x.kind })), winners, chat: Boolean(streamGw.chatFor(g.id)) };
            };
            return { giveaways: await Promise.all(rows.slice(0, 6).map(card)), now: now() };
        },
        // Which giveaways in a server the streamer can put on screen, and which are picked now.
        "GET /api/giveawayoverlay/pick": async (req, _b, url) => {
            const s = session(req), g = await streamAccess(s, url.searchParams.get("guild"));
            const picked = new Set(gwOverlayPicks(s.userId));
            const rows = db.listGiveaways(g.id, { limit: 50 }).filter(x => x.status === "active" || x.status === "scheduled");
            return { giveaways: rows.map(x => ({ id: x.id, title: x.title, status: x.status, endsAt: x.ends_at, entries: db.countEntries(x.id), prizes: db.listKeys(x.id).length, mine: x.host_id === s.userId, picked: picked.has(x.id) })) };
        },
        "POST /api/giveawayoverlay/pick": async (req, body) => {
            const s = session(req), g = await streamAccess(s, body.guild_id);
            const want = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Number.isInteger))].slice(0, 6);
            for (const id of want) { const x = db.getGiveaway(id); if (!x || x.guild_id !== g.id || !["active", "scheduled"].includes(x.status)) throw new HttpError(400, "One of those giveaways isn't running in this server."); }
            const keep = gwOverlayPicks(s.userId).filter(id => db.getGiveaway(id)?.guild_id !== g.id);
            const all = [...keep, ...want].slice(-6);
            db.setMeta("gwov:" + s.userId, JSON.stringify(all));
            return { ok: true, ids: all };
        },
    };
}

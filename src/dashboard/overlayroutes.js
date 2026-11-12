// The Overlay studio: each person's OBS overlays (goal bars, alerts, polls, deals and so on), their private links, and the page OBS asks
// for numbers every few seconds. server.js passes in what it already has and merges these routes into its table.
import { HttpError } from "./http.js";
import { nextSeq, currentSeq, hasNamedFeed, overlayEventsFor } from "../ovfeed.js";
import { overlayData, OVERLAY_KINDS, OVERLAY_FONTS, MAX_SUPPORTER_OVERLAYS, SCENE_KINDS } from "../overlays.js";
import { pollEmbed, pollButtons } from "../gamenight.js";
import { pickDeals } from "../weeklydeals.js";
import { isSupporter } from "../supporters.js";
import { whoIsPlaying } from "../nowplaying.js";
import { summarize } from "../report.js";
import { buyOrWait } from "../advice.js";
import { upcomingSales, salesBefore } from "../salescal.js";
import { isDlc } from "../freemenu.js";

export function createOverlayRoutes({ db, rest, itad, now, remember, session, streamAccess, mayStream, clientIp, overlayLimit, origin, botGuilds, guildList, nowPlaying }) {
    // Studio overlays: when each link was last opened (so the studio can say "connected"), and the live feed the alerts overlay reads.
    // The feed is worked out from member and boost counts every time an overlay asks, so nothing runs while nobody is streaming.
    const ovSeen = new Map(), ovFeed = new Map(), ovTest = new Map(), ovPolls = new Map();
    function feedFor(guildId, g) {
        if (!guildId || !g) return { ev: [] };
        let f = ovFeed.get(guildId);
        if (!f) { f = { m: g.members ?? null, b: g.boosts ?? null, ev: [] }; ovFeed.set(guildId, f); }
        const add = (type, count, by) => f.ev.push({ seq: nextSeq(), type, count, by, at: now() });
        const named = hasNamedFeed(); // then the bot reports each person itself, with their name
        if (!named && g.members != null && f.m != null && g.members > f.m) add("join", g.members, g.members - f.m);
        if (!named && g.boosts != null && f.b != null && g.boosts > f.b) add("boost", g.boosts, g.boosts - f.b);
        if (g.members != null) f.m = g.members;
        if (g.boosts != null) f.b = g.boosts;
        f.ev = f.ev.filter(e => now() - e.at < 10 * 60_000).slice(-30);
        return { ev: [...f.ev, ...overlayEventsFor(guildId, now())] };
    }
    // One game's price for the price overlay: best price now, the lowest ever, and the buy-or-wait call. Looked up at most every 30 minutes per game.
    const gamePrice = appid => remember("ovprice:" + appid, 30 * 60_000, async () => {
        const id = (await itad.lookupShopIds(61, [`app/${appid}`])).get(`app/${appid}`); if (!id) return null;
        const info = await itad.getTitle(id); if (!info?.title) return null;
        const [prices, history] = await Promise.all([itad.getPrices([id], "US").catch(() => new Map()), itad.getHistory(id, "US").catch(() => [])]);
        const sum = summarize(prices.get(id), {}), price = sum.best?.price ?? null, cur = sum.currency || "USD";
        const advice = price !== null ? buyOrWait(history, price, { sales: upcomingSales(Date.now()), past: salesBefore() }) : null;
        return { title: info.title, price, currency: cur, shop: sum.best?.shop ?? null, msrp: sum.msrp ?? null, atl: sum.atl ?? null, verdict: advice?.verdict ?? null };
    });
    async function overlayPayload(o) {
        const g = o.guild_id && guildList ? guildList().find(x => x.id === o.guild_id) ?? null : null;
        let data = overlayData(o, g ? { members: g.members ?? null, boosts: g.boosts ?? null } : null, now());
        const nameOf = id => remember("mname:" + o.guild_id + ":" + id, 10 * 60_000, () => rest.memberName(o.guild_id, id)).then(n => n || "a member").catch(() => "a member");
        try {
            if (o.kind === "board" && o.guild_id) {
                const top = db.xpTop(o.guild_id, o.config.limit);
                data = { rows: await Promise.all(top.map(async r => ({ name: await nameOf(r.user_id), level: r.level, xp: r.xp }))) };
            } else if (o.kind === "poll") {
                let st = null; try { st = o.config.pollId ? JSON.parse(db.getMeta(`poll:${o.config.pollId}`) || "null") : null; } catch { st = null; }
                if (st) { const counts = st.options.map(() => 0); for (const v of Object.values(st.votes ?? {})) if (counts[v] !== undefined) counts[v]++; data = { on: true, question: st.question || "What should we play?", open: now() <= st.until, until: st.until, total: counts.reduce((a, b) => a + b, 0), options: st.options.map((x, i) => ({ title: x.title, count: counts[i] })) }; }
                else data = { on: false };
            } else if (o.kind === "price") {
                data = o.config.appid ? { game: await gamePrice(o.config.appid) } : { game: null };
            } else if (o.kind === "deals") {
                const list = await remember("ovdeals", 30 * 60_000, async () => pickDeals(await itad.getDealsPool({ country: "US", pages: 3 }), 8).map(d => ({ title: String(d.title).slice(0, 80), cut: Math.round(d.cut), price: d.price, currency: String(d.currency || "USD").slice(0, 3) })));
                data = { deals: list.slice(0, o.config.limit) };
            } else if (o.kind === "free") {
                const list = await remember("ovfree", 10 * 60_000, async () => (await itad.getGiveawayList()).filter(g => /^https:\/\//i.test(g.url ?? "")).map(g => ({ title: String(g.title ?? "").slice(0, 80), shop: String(g.shop ?? "").slice(0, 30), expiry: g.expiry ?? null, dlc: isDlc(g) })));
                data = { games: list.filter(g => o.config.showDlc || !g.dlc).filter(g => !g.expiry || new Date(g.expiry).getTime() > now()).slice(0, o.config.limit).map(({ title, shop, expiry }) => ({ title, shop, expiry })) };
            } else if (o.kind === "playing" && o.guild_id) {
                const r = nowPlaying?.enabled ? await whoIsPlaying(db, nowPlaying, o.guild_id) : { games: [] };
                data = { games: await Promise.all(r.games.slice(0, o.config.limit).map(async x => ({ game: x.game, count: x.players.length, names: await Promise.all(x.players.slice(0, 3).map(p => nameOf(p.userId))) }))) };
            }
        } catch { /* leave the numbers empty rather than fail the overlay */ }
        return { kind: o.kind, name: o.name, config: o.config, data, g };
    }
    const routes = {
        // ----- overlay studio: goal bars, server stats and timers, each with its own link and look -----
        "GET /api/overlays": async (req) => {
            const s = session(req);
            const guilds = (await Promise.all(s.guilds.filter(g => botGuilds?.(g.id)).map(async g => (await mayStream(s, g)) ? { id: g.id, name: g.name } : null))).filter(Boolean);
            return { overlays: db.listOvs(s.userId).map(o => ({ token: o.token, kind: o.kind, name: o.name, guild_id: o.guild_id, value: o.value, config: o.config, url: `${origin}/ov?token=${o.token}`, seen: ovSeen.has(o.token) ? now() - ovSeen.get(o.token) : null })), kinds: OVERLAY_KINDS, fonts: OVERLAY_FONTS, guilds };
        },
        "POST /api/overlays": async (req, body) => {
            const s = session(req), action = String(body.action ?? "");
            const guildId = body.guild_id ? String((await streamAccess(s, body.guild_id)).id) : null;
            const wants = (kind, cfg) => kind === "stats" || kind === "alerts" || kind === "board" || kind === "playing" || kind === "poll" || (kind === "goal" && ["members", "boosts"].includes(cfg?.source));
            try {
                if (action === "create") {
                    if (!OVERLAY_KINDS.includes(body.kind)) throw new HttpError(400, "Pick an overlay type.");
                    if (wants(body.kind, body.config) && !guildId) throw new HttpError(400, "Pick a server for this overlay.");
                    return { token: db.createOv(s.userId, body.kind, { name: body.name, guildId, config: body.config, max: isSupporter(db, s.userId, now()) ? MAX_SUPPORTER_OVERLAYS : undefined }) };
                }
                const mine = db.ovById(s.userId, String(body.token ?? ""));
                if (!mine) throw new HttpError(404, "That overlay doesn't exist any more.");
                if (action === "save") {
                    const cfg = body.config ?? mine.config;
                    if (wants(mine.kind, cfg) && !(guildId ?? mine.guild_id)) throw new HttpError(400, "Pick a server for this overlay.");
                    db.updateOv(s.userId, mine.token, { name: body.name, guildId: body.guild_id === undefined ? undefined : guildId, config: body.config ? { ...body.config, pollId: body.config.pollId ?? mine.config.pollId } : body.config, value: body.value });
                    return { ok: true };
                }
                if (action === "bump") { db.updateOv(s.userId, mine.token, { value: Math.max(0, Number(mine.value) + Math.max(-1_000_000, Math.min(1_000_000, Number(body.by) || 0))) }); return { value: db.ovById(s.userId, mine.token).value }; }
                if (action === "test") {
                    if (mine.kind !== "alerts") throw new HttpError(400, "Only an alerts overlay has test alerts.");
                    const list = ovTest.get(mine.token) ?? []; list.push({ seq: nextSeq(), type: ["join", "boost", "level"][list.length % 3], count: 1281 + list.length, by: 1, name: "Test Member", avatar: null, at: now(), test: true });
                    ovTest.set(mine.token, list.slice(-5));
                    return { ok: true, seen: ovSeen.has(mine.token) ? now() - ovSeen.get(mine.token) : null };
                }
                if (action === "game") {
                    if (mine.kind !== "price") throw new HttpError(400, "That isn't a price overlay.");
                    const m = /(?:app\/)?(\d{1,9})(?:[\/?#]|$)/.exec(String(body.game ?? "").trim());
                    if (!m) throw new HttpError(400, "Paste the game's Steam store link or its app number.");
                    const g = await gamePrice(m[1]).catch(() => null);
                    if (!g) throw new HttpError(400, "I couldn't find that game. Check the link.");
                    db.updateOv(s.userId, mine.token, { config: { ...mine.config, appid: m[1], gameName: g.title } });
                    return { ok: true, title: g.title };
                }
                if (action === "poll") {
                    if (mine.kind !== "poll" || !mine.guild_id) throw new HttpError(400, "Pick a server for this poll first.");
                    const question = String(body.question ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
                    const options = (Array.isArray(body.options) ? body.options : []).map(x => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, 60)).filter(Boolean).slice(0, 5);
                    const minutes = [1, 2, 5, 10, 30, 60].includes(Number(body.minutes)) ? Number(body.minutes) : 5;
                    if (!question) throw new HttpError(400, "Write the question first.");
                    if (options.length < 2) throw new HttpError(400, "Give at least two options.");
                    const channels = await rest.listChannels(mine.guild_id).catch(() => { throw new HttpError(400, "The bot can't see that server right now."); });
                    if (!channels.some(c => String(c.id) === String(body.channel_id))) throw new HttpError(400, "Pick a channel to post the poll in.");
                    const state = { question, options: options.map(title => ({ title })), votes: {}, chat: true, until: now() + minutes * 60_000 };
                    let sent; try { sent = await rest.sendMessage(String(body.channel_id), { embeds: [pollEmbed(state, now())], components: pollButtons(state.options), allowed_mentions: { parse: [] } }); } catch { throw new HttpError(400, "I couldn't post there. Check that the bot can send messages in that channel."); }
                    if (!sent?.id) throw new HttpError(400, "I couldn't post there.");
                    db.setMeta(`poll:${sent.id}`, JSON.stringify(state));
                    db.setMeta(`pollch:${String(body.channel_id)}`, String(sent.id));
                    try { db.prunePolls(); } catch { /* old votes can wait */ }
                    db.updateOv(s.userId, mine.token, { config: { ...mine.config, pollId: String(sent.id) } });
                    ovPolls.set(mine.token, { channel: String(body.channel_id), id: String(sent.id) });
                    return { ok: true, pollId: String(sent.id) };
                }
                if (action === "endpoll") {
                    const st = mine.config.pollId ? JSON.parse(db.getMeta(`poll:${mine.config.pollId}`) || "null") : null;
                    if (st) { st.until = now() - 1; db.setMeta(`poll:${mine.config.pollId}`, JSON.stringify(st)); const at = ovPolls.get(mine.token); if (at && at.id === mine.config.pollId) { try { await rest.editMessage?.(at.channel, at.id, { embeds: [pollEmbed(st, now())], components: pollButtons(st.options, false) }); } catch { /* the next click closes it anyway */ } } }
                    return { ok: true };
                }
                if (action === "reset") return { token: db.resetOvToken(s.userId, mine.token) };
                if (action === "delete") { db.removeOv(s.userId, mine.token); return { ok: true }; }
            } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, e.message || "That didn't work."); }
            throw new HttpError(400, "Unknown action.");
        },
        "GET /api/overlays/channels": async (req, _b, url) => {
            const s = session(req);
            await streamAccess(s, String(url.searchParams.get("guild") ?? ""));
            try { return { channels: await rest.listChannels(String(url.searchParams.get("guild"))) }; } catch { throw new HttpError(400, "The bot can't see that server right now."); }
        },
        // What the OBS page asks for every few seconds. Only the chosen look and the numbers on screen, nothing about the owner.
        "GET /api/ov/data": async (req, _b, url) => {
            if (!overlayLimit.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little.");
            const o = db.ovByToken(String(url.searchParams.get("token") ?? ""));
            if (!o) throw new HttpError(404, "This overlay link isn't valid. Make a new one on the Overlay studio page.");
            if (ovSeen.size > 2000) for (const [k, at] of ovSeen) if (now() - at > 3600_000) ovSeen.delete(k);
            ovSeen.set(o.token, now());
            const p = await overlayPayload(o);
            if (o.kind === "alerts") {
                const since = url.searchParams.has("since") ? Number(url.searchParams.get("since")) : NaN;
                const f = feedFor(o.guild_id, p.g), mine = ovTest.get(o.token) ?? [];
                const all = [...f.ev, ...mine].sort((a, b) => a.seq - b.seq);
                const events = Number.isFinite(since) && since >= 0 ? all.filter(e => e.seq > since && (e.type !== "join" || o.config.showJoins) && (e.type !== "boost" || o.config.showBoosts) && (e.type !== "level" || o.config.showLevels)).slice(-8).map(({ seq, type, count, by, name, avatar }) => ({ seq, type, count: count ?? (type === "level" ? null : type === "join" ? p.g?.members : p.g?.boosts) ?? null, by, ...(o.config.showNames && name ? { name, avatar } : {}) })) : [];
                ovTest.set(o.token, mine.filter(e => now() - e.at < 60_000));
                return { kind: o.kind, name: o.name, config: o.config, data: { seq: currentSeq(), events }, now: now() };
            }
            if (o.kind === "scene") {
                const kids = await Promise.all(o.config.items.map(t => db.ovByToken(t)).filter(k => k && k.user_id === o.user_id && SCENE_KINDS.includes(k.kind)).map(async k => { const q = await overlayPayload(k); return { kind: q.kind, name: q.name, config: q.config, data: q.data }; }));
                return { kind: o.kind, name: o.name, config: o.config, data: { children: kids }, now: now() };
            }
            return { kind: o.kind, name: o.name, config: o.config, data: p.data, now: now() };
        },
    };
    return routes;
}

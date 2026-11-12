// Server tools on the dashboard: role menus, starboard, polls, suggestions and custom commands.
// Anyone in a server can see its custom commands; Manage Server is needed for everything else.
import { HttpError } from "./http.js";
import { createRoleMenus, createPolls, createSuggestions, getStarboard, cleanStarboard, getSuggestCfg, cleanSuggest, SUGGEST_STATUS, parseOptions, parseEmoji, saveTagChecked, roleIsSafe } from "../servertools.js";

export function createToolsRoutes(ctx) {
    const { db, guildFor, isManager, isOwner, rest, session, now, push = null } = ctx;
    const menus = createRoleMenus({ db, api: rest }), polls = createPolls({ db, api: rest, now }), suggestions = createSuggestions({ db, api: rest, now });
    const wrap = async fn => {
        try { return await fn(); } catch (e) {
            if (e instanceof HttpError) throw e;
            if (e?.status === 403 || e?.status === 401) throw new HttpError(400, "I'm missing a permission in that channel. Give me View Channel, Send Messages and Embed Links there.");
            if (e?.status === 404) throw new HttpError(400, "I couldn't find that channel or message. It may have been deleted.");
            throw new HttpError(400, e?.message || "That didn't work.");
        }
    };
    const manager = (req, id) => {
        const s = session(req), g = guildFor(s, String(id ?? ""));
        return { s, g, can: isManager(g) || isOwner(s) };
    };
    const must = (req, id) => { const m = manager(req, id); if (!m.can) throw new HttpError(403, "You need the Manage Server permission for that."); return m; };
    const textChannels = async gid => (await rest.listChannels(gid).catch(() => [])).filter(c => c.type === undefined || c.type === 0 || c.type === 5).map(c => ({ id: c.id, name: c.name }));
    const channelOk = async (gid, id) => { id = String(id ?? ""); if (!(await textChannels(gid)).some(c => c.id === id)) throw new HttpError(400, "Pick a channel from this server."); return id; };

    const pushOn = () => { if (!push) throw new HttpError(503, "Browser notifications are not available right now."); return push; };
    return {
        "GET /api/push": async req => { const s = session(req); return { available: Boolean(push), key: push?.publicKey() ?? null, devices: push ? push.devices(s.userId) : 0 }; },
        "POST /api/push/subscribe": async (req, body) => {
            const s = session(req);
            try { return pushOn().subscribe(s.userId, body.subscription); } catch (e) { throw e instanceof HttpError ? e : new HttpError(400, e.message); }
        },
        "POST /api/push/unsubscribe": async (req, body) => { const s = session(req); return pushOn().unsubscribe(s.userId, body.endpoint ? String(body.endpoint) : null); },
        "POST /api/push/test": async req => {
            const s = session(req), n = await pushOn().send(s.userId, { title: "Steam Value Checker", body: "Browser notifications are on. Price drops will show up like this.", url: "/alerts", tag: "test" });
            if (!n) throw new HttpError(400, "Nothing was delivered. Turn notifications on in this browser first.");
            return { sent: n };
        },
        "GET /api/tools": async (req, _b, url) => {
            const { g, can } = manager(req, url.searchParams.get("guild"));
            const tags = db.listTags(g.id).map(t => ({ name: t.name, uses: t.uses, response: can ? t.response : undefined }));
            if (!can) return { canManage: false, tags: tags.map(t => ({ name: t.name })) };
            const [channels, roles] = await Promise.all([textChannels(g.id), rest.allRoles(g.id).catch(() => [])]);
            const top = db.topStarPosts(g.id, 5);
            return {
                canManage: true, channels, roles: roles.filter(r => roleIsSafe(r, g.id)).sort((a, b) => (b.position ?? 0) - (a.position ?? 0)).map(r => ({ id: r.id, name: r.name })),
                menus: db.listRoleMenus(g.id).map(m => ({ id: m.id, title: m.title, channel_id: m.channel_id, mode: m.mode, items: db.roleMenuItems(m.id).map(x => ({ role_id: x.role_id, label: x.label, emoji: x.emoji })) })),
                starboard: { ...getStarboard(db, g.id), posts: db.starCount(g.id), top: top.map(p => ({ stars: p.stars, link: `https://discord.com/channels/${g.id}/${p.source_channel}/${p.source_id}` })) },
                suggest: { ...getSuggestCfg(db, g.id), statuses: Object.entries(SUGGEST_STATUS).map(([id, v]) => ({ id, label: v.label })), items: db.listSuggestions(g.id, { limit: 25 }).map(s => ({ id: s.id, text: s.text, status: s.status, note: s.note, author_id: s.author_id, votes: db.suggestionVotes(s.id) })) },
                polls: db.listPolls(g.id, 10).map(p => ({ id: p.id, question: p.question, options: p.options, closed: Boolean(p.closed), ends_at: p.ends_at, votes: db.pollVotes(p.id).length })),
                tags
            };
        },
        "POST /api/tools/rolemenu": async (req, b) => {
            const { g } = must(req, b.guild_id);
            return wrap(async () => {
                if (b.action === "create") { const m = await menus.create({ guildId: g.id, channelId: await channelOk(g.id, b.channel_id), title: String(b.title ?? "").trim() || "Pick your roles", description: b.description ? String(b.description) : null, mode: b.mode === "single" ? "single" : "toggle" }); return { ok: true, id: m.id }; }
                const menuId = Number(b.menu_id);
                if (b.action === "add") { await menus.addRole({ guildId: g.id, menuId, roleId: String(b.role_id ?? ""), label: b.label ? String(b.label) : "", emoji: b.emoji ? String(b.emoji) : "" }); return { ok: true }; }
                if (b.action === "remove") { await menus.removeRole({ guildId: g.id, menuId, roleId: String(b.role_id ?? "") }); return { ok: true }; }
                if (b.action === "delete") { await menus.remove({ guildId: g.id, menuId }); return { ok: true }; }
                throw new HttpError(400, "Unknown action.");
            });
        },
        "POST /api/tools/starboard": async (req, b) => {
            const { g } = must(req, b.guild_id);
            const cur = getStarboard(db, g.id);
            if (b.emoji && !parseEmoji(b.emoji)) throw new HttpError(400, "That doesn't look like an emoji.");
            const next = cleanStarboard({ ...cur, on: b.on === undefined ? cur.on : Boolean(b.on), channel: b.channel_id ? await channelOk(g.id, b.channel_id) : cur.channel, threshold: b.threshold ?? cur.threshold, emoji: b.emoji ?? cur.emoji, selfStar: b.selfStar === undefined ? cur.selfStar : Boolean(b.selfStar) });
            if (next.on && !next.channel) throw new HttpError(400, "Pick the channel where starred messages go first.");
            db.setToolSetting("starboard", g.id, next);
            return { ok: true, starboard: next };
        },
        "POST /api/tools/suggest": async (req, b) => {
            const { s, g } = must(req, b.guild_id);
            return wrap(async () => {
                if (b.action === "setup") { db.setToolSetting("suggest", g.id, cleanSuggest({ channel: await channelOk(g.id, b.channel_id), role: getSuggestCfg(db, g.id).role })); return { ok: true }; }
                if (b.action === "off") { db.setToolSetting("suggest", g.id, cleanSuggest({})); return { ok: true }; }
                if (b.action === "decide") { const r = await suggestions.decide({ guildId: g.id, id: Number(b.id), status: String(b.status ?? ""), note: b.note ? String(b.note) : null, by: s.userId }); return { ok: true, status: r.status }; }
                throw new HttpError(400, "Unknown action.");
            });
        },
        "POST /api/tools/poll": async (req, b) => {
            const { s, g } = must(req, b.guild_id);
            return wrap(async () => {
                if (b.action === "create") { const p = await polls.create({ guildId: g.id, channelId: await channelOk(g.id, b.channel_id), question: String(b.question ?? "").trim(), options: parseOptions(Array.isArray(b.options) ? b.options.join("|") : b.options), hours: Math.min(720, Math.max(0, Math.trunc(Number(b.hours) || 0))), multi: Boolean(b.multi), by: s.userId }); return { ok: true, id: p.id }; }
                if (b.action === "end") { await polls.end(Number(b.id), g.id); return { ok: true }; }
                throw new HttpError(400, "Unknown action.");
            });
        },
        "POST /api/tools/tag": async (req, b) => {
            const { s, g } = must(req, b.guild_id);
            return wrap(async () => {
                if (b.action === "save") { const name = saveTagChecked(db, g.id, b.name, b.response, s.userId); return { ok: true, name }; }
                if (b.action === "remove") { if (!db.deleteTag(g.id, String(b.name ?? "").toLowerCase())) throw new HttpError(404, "There is no command by that name."); return { ok: true }; }
                throw new HttpError(400, "Unknown action.");
            });
        }
    };
}

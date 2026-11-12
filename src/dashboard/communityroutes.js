// The server Community page's API: welcome, XP, roles, invites, self-roles and guides, for the servers a person manages.
// server.js passes in the helpers it already has (ctx) and merges these routes into its table.
import { HttpError } from "./http.js";
import { UserError } from "../errors.js";
import { renderWelcomeCard } from "../cardimg.js";

export function createCommunityRoutes(ctx) {
    const { botGuilds, botIn, cd, comm, cooldown, guildFor, guildList, isManager, managerGuild, playtests, session } = ctx;
    return {
        // ---- community: welcome, XP and levels, invites and referrals, emoji, one-click server build ----
        "GET /api/community": async (req, _b, url) => {
            const s = session(req); const g = guildFor(s, url.searchParams.get("guild"));
            return comm(async () => ({ bot: botGuilds ? Boolean(botGuilds(g.id)) : null, ...(await cd.overview(g.id, s.userId, isManager(g))) }));
        },
        "GET /api/community/rank": async (req, _b, url) => {
            const s = session(req); const g = guildFor(s, url.searchParams.get("guild"));
            return comm(async () => { const o = await cd.overview(g.id, s.userId, false); return o.me; });
        },
        "GET /api/community/leaderboard": async (req, _b, url) => {
            const s = session(req); const g = guildFor(s, url.searchParams.get("guild"));
            return comm(async () => ({ top: (await cd.overview(g.id, s.userId, false)).xpTop }));
        },
        "GET /api/community/invites": async (req, _b, url) => {
            const s = session(req); const g = guildFor(s, url.searchParams.get("guild"));
            return comm(async () => { const o = await cd.overview(g.id, s.userId, false); return { me: o.me.invites, top: o.inviteTop, rewards: o.rewards }; });
        },
        "POST /api/community/invite-link": async (req, body) => {
            const s = session(req); const g = guildFor(s, String(body.guild_id)); botIn(g);
            cooldown(s.userId, "clink");
            return comm(() => cd.inviteLink(g.id, s.userId));
        },
        "POST /api/community/setup": async (req, body) => {
            const s = session(req); const g = managerGuild(s, String(body.guild_id)); botIn(g);
            cooldown(s.userId, "csetup");
            return comm(() => cd.setup(g.id, s.userId));
        },
        "POST /api/community/verify": async (req, body) => {
            const s = session(req); const g = guildFor(s, String(body.guild_id)); botIn(g);
            return comm(() => cd.verify(g.id, s.userId));
        },
        "POST /api/community/verifyrole": async (req, body) => comm(() => cd.verifyRole(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/welcome": async (req, body) => comm(() => cd.welcome(managerGuild(session(req), String(body.guild_id)).id, body)),
        // What the picture card in the welcome message looks like, drawn for the manager asking and this server's name.
        "POST /api/community/welcome/preview": async (req, body) => {
            const s = session(req), g = managerGuild(s, String(body.guild_id));
            cooldown(s.userId, "cardimg");
            const live = (guildList ? guildList() : []).find(x => x.id === g.id);
            const png = await renderWelcomeCard({ name: s.username ?? "New member", server: live?.name ?? g.name ?? "Your server", count: Math.max(1, Number(live?.members) || 100) + 1 });
            return { image: "data:image/png;base64," + Buffer.from(png).toString("base64") };
        },
        "POST /api/community/support": async (req, body) => comm(() => cd.support(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/ai-models": async (req, body) => comm(() => cd.aiModels(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/places": async (req, body) => comm(() => cd.places(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/rules": async (req, body) => comm(() => cd.rules(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/announce": async (req, body) => {
            const s = session(req), g = managerGuild(s, String(body.guild_id));
            const undo = cooldown(s.userId, "announce");
            try { return await comm(() => cd.announce(g.id, body, s.userId)); } catch (e) { undo(); throw e; }
        },
        "POST /api/community/leaderboard": async (req, body) => {
            const s = session(req), g = managerGuild(s, String(body.guild_id));
            const undo = body.refresh ? cooldown(s.userId, "lbrefresh") : () => {};
            try { return await comm(() => cd.leaderboard(g.id, body)); } catch (e) { undo(); throw e; }
        },
        "POST /api/community/memes": async (req, body) => {
            const s = session(req), g = managerGuild(s, String(body.guild_id));
            const undo = body.now ? cooldown(s.userId, "memenow") : () => {};
            try { return await comm(() => cd.memesSettings(g.id, body)); } catch (e) { undo(); throw e; }
        },
        // Posts what is listed right now into the playtest channel (not only new ones). Server managers only, once a minute.
        "POST /api/community/playtests": async (req, body) => {
            const s = session(req), g = managerGuild(s, String(body.guild_id));
            if (!playtests) throw new HttpError(503, "Playtests are not set up on this bot.");
            const undo = cooldown(s.userId, "ptrefresh");
            try {
                const r = await comm(() => playtests.refresh(g.id, { limit: body.count }));
                if (!r.posted) { undo(); return { ok: true, posted: 0, found: r.found }; }
                return { ok: true, posted: r.posted, found: r.found };
            } catch (e) { undo(); if (e instanceof UserError) throw new HttpError(400, e.message); throw e; }
        },
        "POST /api/community/pings": async (req, body) => comm(() => cd.pings(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/guides": async (req, body) => { const s = session(req); return comm(() => cd.guides(managerGuild(s, String(body.guild_id)).id, body, s.userId ?? s.id ?? null)); },
        "POST /api/community/autorole": async (req, body) => comm(() => cd.autorole(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/xp": async (req, body) => comm(() => cd.xp(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/levelrole": async (req, body) => comm(() => cd.levelrole(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/referral": async (req, body) => comm(() => cd.referral(managerGuild(session(req), String(body.guild_id)).id, body)),
        "GET /api/community/emoji": async (req, _b, url) => comm(() => cd.emojiList(managerGuild(session(req), url.searchParams.get("guild")).id)),
        "GET /api/community/xp": async (req, _b, url) => {
            const s = session(req); const g = guildFor(s, url.searchParams.get("guild"));
            return comm(async () => ({ bot: botGuilds ? Boolean(botGuilds(g.id)) : null, ...(await cd.xpPage(g.id, s.userId, isManager(g), url.searchParams.get("page"))) }));
        },
        "POST /api/community/emoji": async (req, body) => {
            const s = session(req); const g = managerGuild(s, String(body.guild_id)); botIn(g);
            const undo = cooldown(s.userId, "cemoji"); // a refused request does not use up the wait
            try {
                if (body.image_data) return await comm(() => cd.emojiUpload(g.id, body.name, body.image_data));
                return await comm(() => cd.emojiImport(g.id, String(body.text ?? "").slice(0, 5000)));
            } catch (e) { undo(); throw e; }
        },
        "GET /api/community/emoji-packs": async (req, _b, url) => {
            const s = session(req); managerGuild(s, url.searchParams.get("guild"));
            cooldown(s.userId, "cemojipacks");
            return comm(() => cd.emojiPacks(url.searchParams.get("sort") ?? "recent", Number(url.searchParams.get("page") ?? 1)));
        },
        "GET /api/community/emoji-pack": async (req, _b, url) => {
            const s = session(req); managerGuild(s, url.searchParams.get("guild"));
            cooldown(s.userId, "cemojipack");
            return comm(() => cd.emojiPack(url.searchParams.get("key")));
        },
        "POST /api/community/emoji-pack": async (req, body) => {
            const s = session(req); const g = managerGuild(s, String(body.guild_id)); botIn(g);
            const undo = cooldown(s.userId, "cemojipackimp");
            try { return await comm(() => cd.emojiPackImport(g.id, String(body.key ?? ""), body.ids)); } catch (e) { undo(); throw e; }
        },
    };
}

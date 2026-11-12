// The Moderation page's API.
// server.js passes in the helpers it already has (ctx) and merges these routes into its table.
import { HttpError } from "./http.js";

export function createModRoutes(ctx) {
    const { MOD_ACTION_PERM, MOD_PERMS, botIn, cooldown, hasGuildPerm, isManager, md, modGuild, modr, session } = ctx;
    return {
        "GET /api/mod": async (req, _b, url) => {
            const s = session(req); const g = modGuild(s, url.searchParams.get("guild"), "moderate"); botIn(g);
            return modr(() => md.overview(g.id, { manager: isManager(g), perms: Object.keys(MOD_PERMS).filter(k => hasGuildPerm(g, k)) }));
        },
        "GET /api/mod/cases": async (req, _b, url) => {
            const s = session(req); const g = modGuild(s, url.searchParams.get("guild"), "moderate");
            return modr(() => md.cases(g.id, url.searchParams.get("user"), url.searchParams.get("page")));
        },
        "POST /api/mod/action": async (req, body) => {
            const s = session(req); const action = String(body.action ?? "");
            if (!MOD_ACTION_PERM[action]) throw new HttpError(400, "Choose an action.");
            const g = modGuild(s, String(body.guild_id), MOD_ACTION_PERM[action]); botIn(g);
            const undo = cooldown(s.userId, "mod");
            try { return await modr(() => md.act(g.id, s.userId, action, body)); } catch (e) { undo(); throw e; }
        },
        "POST /api/mod/clearwarns": async (req, body) => {
            const s = session(req); const g = modGuild(s, String(body.guild_id), "moderate");
            return modr(() => md.clearWarns(g.id, body.user));
        },
        "GET /api/mod/automod": async (req, _b, url) => {
            const s = session(req); const g = modGuild(s, url.searchParams.get("guild"), "moderate"); botIn(g);
            return modr(() => md.automodGet(g.id, { canEdit: hasGuildPerm(g, "manageGuild") }));
        },
        "POST /api/mod/automod": async (req, body) => {
            const s = session(req); const g = modGuild(s, String(body.guild_id), "manageGuild"); botIn(g);
            return modr(() => md.automodSave(g.id, body.settings));
        },
        "GET /api/mod/stats": async (req, _b, url) => {
            const s = session(req); const g = modGuild(s, url.searchParams.get("guild"), "moderate"); botIn(g);
            return modr(() => md.stats(g.id, url.searchParams.get("days")));
        },
        "GET /api/mod/appeals": async (req, _b, url) => {
            const s = session(req); const g = modGuild(s, url.searchParams.get("guild"), "ban"); botIn(g);
            return modr(() => md.appeals(g.id));
        },
        "POST /api/mod/appeals/decide": async (req, body) => {
            const s = session(req); const g = modGuild(s, String(body.guild_id), "ban"); botIn(g);
            return modr(() => md.decideAppeal(g.id, s.userId, body));
        },
        "POST /api/mod/settings": async (req, body) => {
            const s = session(req); const g = modGuild(s, String(body.guild_id), "manageGuild"); botIn(g);
            return modr(() => md.saveSettings(g.id, body));
        },
        "POST /api/appeal": async (req, body) => {
            const s = session(req);
            const undo = cooldown(s.userId, "appeal");
            try { return await modr(() => md.submitAppeal(String(body.guild_id ?? ""), s.userId, body.text)); } catch (e) { undo(); throw e; }
        },
        "POST /api/mod/log": async (req, body) => {
            const s = session(req); const g = modGuild(s, String(body.guild_id), "manageGuild"); botIn(g);
            return modr(() => md.setLog(g.id, body.channel_id));
        },
    };
}

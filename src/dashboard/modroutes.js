// The Moderation page's API.
// server.js passes in the helpers it already has (ctx) and merges these routes into its table.
import { HttpError } from "./http.js";
import { createSiteAppeals } from "../siteappeal.js";

export function createModRoutes(ctx) {
    const { MOD_ACTION_PERM, MOD_PERMS, appealLimit, botIn, clientIp, config, cooldown, db, dm, hasGuildPerm, isManager, isOwner, md, modGuild, mod, modr, now, session } = ctx;
    const siteAppeals = createSiteAppeals({ db, config, dm, now });
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
        "POST /api/mod/automod/test": async (req, body) => {
            const s = session(req); const g = modGuild(s, String(body.guild_id), "moderate"); botIn(g);
            return modr(() => md.automodTest(g.id, body.text));
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
        // The public appeal page. No account needed, because a restricted person can't sign in. `kind` is "site" (a Steam Value Checker restriction,
        // answered in the owner's Admin panel) or "server" (a Discord ban, answered by that server's moderators on their Moderation page).
        "POST /api/public/appeal": async (req, body) => {
            if (!appealLimit.hit(clientIp(req)).ok) throw new HttpError(429, "That's a lot of appeals from one place. Try again in an hour.");
            const userId = String(body.user_id ?? "").replace(/\D/g, "");
            if (String(body.kind) === "server") {
                if (!mod) throw new HttpError(503, "Server appeals aren't available right now.");
                if (!/^\d{15,25}$/.test(userId)) throw new HttpError(400, "That doesn't look like a Discord user ID.");
                return modr(() => mod.appeal({ guildId: String(body.guild_id ?? "").replace(/\D/g, ""), userId, text: body.text, contact: body.contact, verified: false }));
            }
            return { ...siteAppeals.submit({ userId, text: body.text, contact: body.contact, verified: false }) };
        },
        "GET /api/admin/appeals": async (req, _b, url) => {
            const s = session(req); if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const status = ["open", "accepted", "denied"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "open";
            return { appeals: siteAppeals.list(status), status };
        },
        "POST /api/admin/appeals/decide": async (req, body) => {
            const s = session(req); if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            return siteAppeals.decide({ id: body.id, accept: body.accept === true, note: body.note, actorId: s.userId });
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

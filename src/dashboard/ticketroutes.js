// The ticket desk's API: opening, replying to and closing support tickets.
// server.js passes in the helpers it already has (ctx) and merges these routes into its table.
import { HttpError } from "./http.js";

export function createTicketRoutes(ctx) {
    const { db, isManager, isOwner, logs, managerGuild, needTickets, session, settingsView, ticketAccess, tickets } = ctx;
    return {
        // ----- support tickets (same thread as the Discord side) -----
        "GET /api/tickets": async (req, _b, url) => {
            const s = session(req); needTickets();
            const q = String(url.searchParams.get("q") ?? "").slice(0, 60), status = url.searchParams.get("status") || null;
            const mine = db.listTickets({ userId: s.userId, limit: 50 });
            const mgd = s.guilds.filter(isManager);
            const staff = isOwner(s) || mgd.length > 0;
            const inbox = staff ? db.listTickets({ all: isOwner(s), guildIds: mgd.map(g => g.id), status, q, limit: 100 }) : [];
            const cut = t => ({ id: t.id, subject: t.subject, status: t.status, assignee_id: t.assignee_id, tags: t.tags, user_id: t.user_id, user_name: t.user_name, guild_id: t.guild_id, updated_at: t.updated_at, created_at: t.created_at, rating: t.rating });
            return { mine: mine.map(cut), inbox: inbox.map(cut), staff, owner: isOwner(s),
                guilds: mgd.map(g => ({ id: g.id, name: g.name, ...settingsView(g.id) })), ownerSettings: isOwner(s) ? settingsView("*") : null };
        },
        "GET /api/tickets/one": async (req, _b, url) => {
            const s = session(req); needTickets();
            const { t, staff } = ticketAccess(s, url.searchParams.get("id"));
            const out = { ticket: t, messages: db.listTicketMessages(t.id), staff, canned: staff ? db.listCanned(t.guild_id ?? "*") : [] };
            // Recent errors help the owner debug a problem report. Staff of other servers never see them.
            if (isOwner(s) && logs) out.errors = logs.recent({ level: "error", limit: 15 });
            return out;
        },
        "POST /api/tickets": async (req, body) => {
            const s = session(req); needTickets();
            const gid = body.guild_id && s.guilds.some(g => g.id === body.guild_id) ? body.guild_id : null;
            return tickets.open({ userId: s.userId, userName: s.username ?? null, guildId: gid, subject: body.subject, body: body.body, kind: body.kind === "bug" ? "bug" : "help" });
        },
        "POST /api/tickets/reply": async (req, body) => {
            const s = session(req); needTickets();
            const { t, staff } = ticketAccess(s, body.id);
            const asStaff = staff && t.user_id !== s.userId;
            await tickets.reply(t.id, { authorId: s.userId, role: asStaff ? "staff" : "user", body: body.body });
            return { ok: true };
        },
        "POST /api/tickets/status": async (req, body) => {
            const s = session(req); needTickets();
            const { t, staff } = ticketAccess(s, body.id);
            if (!staff && body.status !== "closed") throw new HttpError(403, "Only support staff can do that.");
            if (body.status === "resolved") await tickets.resolve(t.id, { by: s.userId, note: body.note ? String(body.note).slice(0, 500) : null });
            else if (body.status === "closed") await tickets.close(t.id, { by: s.userId });
            else throw new HttpError(400, "Unknown status.");
            return { ok: true };
        },
        "POST /api/tickets/assign": async (req, body) => {
            const s = session(req); needTickets();
            const { t, staff } = ticketAccess(s, body.id);
            if (!staff) throw new HttpError(403, "Only support staff can do that.");
            await tickets.assign(t.id, body.assignee === null ? null : s.userId);
            return { ok: true };
        },
        "POST /api/tickets/tags": async (req, body) => {
            const s = session(req); needTickets();
            const { t, staff } = ticketAccess(s, body.id);
            if (!staff) throw new HttpError(403, "Only support staff can do that.");
            await tickets.setTags(t.id, body.tags);
            return { ok: true };
        },
        "POST /api/tickets/rate": async (req, body) => { const s = session(req); needTickets(); return { rating: tickets.rate(Number(body.id), s.userId, body.rating) }; },
        "GET /api/tickets/transcript": async (req, _b, url) => {
            const s = session(req); needTickets();
            const { t } = ticketAccess(s, url.searchParams.get("id"));
            return { name: `ticket-${t.id}.txt`, text: tickets.transcript(t.id) };
        },
        "POST /api/tickets/setup": async (req, body) => {
            const s = session(req); needTickets();
            const scope = body.guild_id === "*" ? "*" : managerGuild(s, String(body.guild_id)).id;
            if (scope === "*" && !isOwner(s)) throw new HttpError(403, "Only the bot owner can set this.");
            const id = v => (/^\d{15,25}$/.test(String(v ?? "").trim()) ? String(v).trim() : null);
            if (body.channel_id && !id(body.channel_id)) throw new HttpError(400, "That does not look like a channel ID. Enable Developer Mode, right-click the channel, Copy Channel ID.");
            db.setTicketSettings(scope, { channelId: id(body.channel_id), staffRoleId: id(body.staff_role_id) });
            return settingsView(scope);
        },
        "POST /api/tickets/canned": async (req, body) => {
            const s = session(req); needTickets();
            const scope = body.guild_id === "*" ? "*" : managerGuild(s, String(body.guild_id)).id;
            if (scope === "*" && !isOwner(s)) throw new HttpError(403, "Only the bot owner can edit these.");
            if (body.remove) db.removeCanned(scope, Number(body.remove));
            else {
                const title = String(body.title ?? "").trim().slice(0, 60), text = String(body.body ?? "").trim().slice(0, 1500);
                if (!title || !text) throw new HttpError(400, "Give the reply a title and some text.");
                db.addCanned(scope, title, text);
            }
            return { canned: db.listCanned(scope) };
        },
    };
}

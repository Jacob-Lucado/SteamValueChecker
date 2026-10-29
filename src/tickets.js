// Support tickets with no Discord or HTTP code in it. Discord is passed in as `discord`:
//   post(channelId, payload) -> { id }    edit(channelId, messageId, payload)    dm(userId, payload) throws on failure
// A ticket is answered from Discord (buttons and forms, no message-content access needed) or from the dashboard. Both
// sides see the same thread, and each reply is also delivered to the other side.
import { UserError } from "./errors.js";

export const TK = { reply: "tk_reply", assign: "tk_assign", resolve: "tk_resolve", ureply: "tk_ureply", rate: "tk_rate", open: "tk_open",
    mReply: "tk_m_reply", mUreply: "tk_m_ureply", mOpen: "tk_m_open", mBug: "tk_m_bug" };
const MAX_BODY = 1500, MAX_SUBJECT = 100, MAX_OPEN = 5;
const WAITING_TO_RESOLVED_MS = 7 * 86400_000, RESOLVED_TO_CLOSED_MS = 3 * 86400_000;
const ICON = { open: "🟢", waiting: "🟡", resolved: "✅", closed: "⚫" };
const COLOR = { open: 0x57f287, waiting: 0xf2b84b, resolved: 0x5865f2, closed: 0x747f8d };
const clip = (s, n) => String(s ?? "").trim().slice(0, n);

export function staffEmbed(t, messages) {
    const last = messages.filter(m => m.role !== "system").at(-1);
    const fields = [
        { name: "From", value: `<@${t.user_id}>`, inline: true },
        { name: "Status", value: `${ICON[t.status]} ${t.status}`, inline: true },
        { name: "Assigned", value: t.assignee_id ? `<@${t.assignee_id}>` : "Nobody yet", inline: true }
    ];
    if (t.giveaway_id) fields.push({ name: "Giveaway", value: `#${t.giveaway_id}`, inline: true });
    if (t.tags.length) fields.push({ name: "Tags", value: t.tags.join(", "), inline: true });
    if (last) fields.push({ name: last.role === "staff" ? "Last reply (staff)" : "Latest message", value: clip(last.body, 900) });
    return { color: COLOR[t.status] ?? COLOR.open, title: `Ticket #${t.id}: ${clip(t.subject, 200)}`, fields, footer: { text: `Opened` }, timestamp: new Date(t.created_at).toISOString() };
}

export function staffButtons(t) {
    const off = t.status === "closed";
    return [{ type: 1, components: [
        { type: 2, style: 1, label: "Reply", custom_id: `${TK.reply}:${t.id}`, disabled: off },
        { type: 2, style: 2, label: "Assign me", custom_id: `${TK.assign}:${t.id}`, disabled: off },
        { type: 2, style: 3, label: "Resolve", custom_id: `${TK.resolve}:${t.id}`, disabled: off || t.status === "resolved" }
    ] }];
}

export function createTicketService({ db, discord, ownerId = null, publicUrl = null, now = () => Date.now(), log = () => {} }) {
    const must = id => { const t = db.getTicket(Number(id)); if (!t) throw new UserError("That ticket does not exist."); return t; };
    const link = id => (publicUrl ? `${publicUrl}/#/support/${id}` : null);
    const scopeOf = t => t.guild_id ?? "*";

    /** Everyone who may act on this ticket from the dashboard: the owner, or a manager of its server (checked by the caller). */
    const isOwner = userId => Boolean(ownerId) && userId === ownerId;

    async function syncStaffMessage(t) {
        const ch = db.getTicketSettings(scopeOf(t)).channel_id;
        if (!ch) return;
        const payload = { embeds: [staffEmbed(t, db.listTicketMessages(t.id))], components: staffButtons(t) };
        try {
            if (t.message_id && t.channel_id === ch) await discord.edit(ch, t.message_id, payload);
            else { const m = await discord.post(ch, payload); db.setTicketMessage(t.id, ch, m.id); }
        } catch (e) { log(`ticket message failed: ${e?.name ?? "error"}`); }
    }

    async function notifyStaff(t, text) {
        const ch = db.getTicketSettings(scopeOf(t)).channel_id;
        if (!ch) return;
        try { await discord.post(ch, { content: text.slice(0, 1900), allowedMentions: { parse: [] }, reply: t.message_id ? { messageReference: t.message_id, failIfNotExists: false } : undefined }); }
        catch (e) { log(`ticket notice failed: ${e?.name ?? "error"}`); }
    }

    const userEmbed = (t, body, who) => ({
        embeds: [{ color: COLOR[t.status], title: `Ticket #${t.id}: ${clip(t.subject, 200)}`, description: clip(body, 3500), footer: { text: who } }],
        components: t.status === "closed" ? [] : [{ type: 1, components: [
            { type: 2, style: 1, label: "Reply", custom_id: `${TK.ureply}:${t.id}` },
            ...(link(t.id) ? [{ type: 2, style: 5, label: "Open on the dashboard", url: link(t.id) }] : [])
        ] }]
    });

    async function dmUser(t, payload) {
        try { await discord.dm(t.user_id, payload); return true; }
        catch { db.addTicketMessage(t.id, null, "system", "The bot could not send you a DM. Open the dashboard to read replies."); return false; }
    }

    // ---------- open ----------
    async function open({ userId, userName = null, guildId = null, subject, body, giveawayId = null, context = null, kind = "help" }) {
        const sub = clip(subject, MAX_SUBJECT), text = clip(body, MAX_BODY);
        if (!sub) throw new UserError("Give the ticket a short subject.");
        if (!text) throw new UserError("Describe what you need help with.");
        if (db.countOpenTickets(userId) >= MAX_OPEN) throw new UserError(`You already have ${MAX_OPEN} open tickets. Close or resolve one first.`);
        // A server's own queue only if that server has set one up; otherwise it goes to the bot owner.
        // Bug reports always go to the bot owner (and show on the Admin page), never to a server's own queue.
        const bug = kind === "bug";
        const routed = !bug && guildId && db.getTicketSettings(guildId).channel_id ? guildId : null;
        const id = db.createTicket({ user_id: userId, user_name: userName, guild_id: routed, subject: sub, giveaway_id: giveawayId, context: bug ? { ...(context ?? {}), from_server: guildId ?? null } : context, tags: bug ? ["bug"] : [] });
        if (bug) log(`[bug #${id}] ${sub} (from ${userName ?? userId})`);
        db.addTicketMessage(id, userId, "user", text);
        const t = db.getTicket(id);
        await syncStaffMessage(t);
        return { id, routedTo: routed ? "server" : "owner", queued: Boolean(db.getTicketSettings(scopeOf(t)).channel_id) };
    }

    // ---------- reply ----------
    async function reply(id, { authorId, role, body }) {
        let t = must(id);
        const text = clip(body, MAX_BODY);
        if (!text) throw new UserError("Write a message first.");
        if (t.status === "closed") throw new UserError("That ticket is closed. Open a new one if you still need help.");
        db.addTicketMessage(t.id, authorId, role, text);
        if (role === "staff") {
            db.setTicketStatus(t.id, "waiting");
            if (!t.assignee_id) db.setTicketAssignee(t.id, authorId);
            t = db.getTicket(t.id);
            await dmUser(t, userEmbed(t, text, "Support reply"));
            await notifyStaff(t, `↩️ <@${authorId}> replied on #${t.id}: ${text}`);
        } else {
            db.setTicketStatus(t.id, "open");
            t = db.getTicket(t.id);
            await notifyStaff(t, `💬 New message from <@${t.user_id}> on #${t.id}: ${text}`);
        }
        await syncStaffMessage(t);
        return db.getTicket(t.id);
    }

    // ---------- status ----------
    async function resolve(id, { by, note = null }) {
        let t = must(id);
        if (t.status === "closed" || t.status === "resolved") throw new UserError("That ticket is already resolved.");
        if (note) db.addTicketMessage(t.id, by, "staff", clip(note, MAX_BODY));
        db.addTicketMessage(t.id, by, "system", `Resolved${by ? "" : " automatically"}.`);
        db.setTicketStatus(t.id, "resolved");
        t = db.getTicket(t.id);
        await syncStaffMessage(t);
        await dmUser(t, {
            embeds: [{ color: COLOR.resolved, title: `Ticket #${t.id} was resolved`, description: `${note ? clip(note, 1500) + "\n\n" : ""}Reply to this ticket if it is not fixed, and it reopens. How did we do?` }],
            components: [{ type: 1, components: [1, 2, 3, 4, 5].map(n => ({ type: 2, style: 2, label: "⭐".repeat(n), custom_id: `${TK.rate}:${t.id}:${n}` })) }]
        });
        return t;
    }

    async function close(id, { by = null } = {}) {
        const t = must(id);
        if (t.status === "closed") return t;
        db.addTicketMessage(t.id, by, "system", by ? "Closed." : "Closed automatically after being resolved for a few days.");
        db.setTicketStatus(t.id, "closed");
        const n = db.getTicket(t.id);
        await syncStaffMessage(n);
        return n;
    }

    async function assign(id, staffId) {
        const t = must(id);
        db.setTicketAssignee(t.id, staffId || null);
        await syncStaffMessage(db.getTicket(t.id));
        return db.getTicket(t.id);
    }

    async function setTags(id, tags) {
        const t = must(id);
        const clean = [...new Set((tags ?? []).map(x => clip(x, 20).toLowerCase().replace(/[^a-z0-9 _-]/g, "")).filter(Boolean))].slice(0, 6);
        db.setTicketTags(t.id, clean);
        await syncStaffMessage(db.getTicket(t.id));
        return clean;
    }

    function rate(id, userId, n) {
        const t = must(id);
        if (t.user_id !== userId) throw new UserError("That rating is not for you.");
        const r = Math.trunc(Number(n));
        if (!(r >= 1 && r <= 5)) throw new UserError("Pick 1 to 5 stars.");
        db.setTicketRating(t.id, r);
        return r;
    }

    /** Plain text copy of a ticket, for a download. */
    function transcript(id) {
        const t = must(id), msgs = db.listTicketMessages(t.id);
        const who = m => (m.role === "system" ? "System" : m.role === "staff" ? "Staff" : t.user_name || "User");
        return [`Ticket #${t.id}: ${t.subject}`, `Status: ${t.status}`, `Opened: ${new Date(t.created_at).toISOString()}`, "",
            ...msgs.map(m => `[${new Date(m.at).toISOString()}] ${who(m)}: ${m.body}`), ""].join("\n");
    }

    /** Quiet tickets move along on their own: waiting a week -> resolved, resolved for three days -> closed. */
    async function tick() {
        const done = { resolved: 0, closed: 0 };
        for (const t of db.staleWaiting(now() - WAITING_TO_RESOLVED_MS)) { try { await resolve(t.id, { by: null }); done.resolved++; } catch (e) { log(`ticket auto-resolve failed: ${e?.name}`); } }
        for (const t of db.listTickets({ all: true, status: "resolved", limit: 200 })) {
            if (t.closed_at && now() - t.closed_at > RESOLVED_TO_CLOSED_MS) { try { await close(t.id); done.closed++; } catch { /* next time */ } }
        }
        db.purgeTickets();
        return done;
    }

    return { open, reply, resolve, close, assign, setTags, rate, transcript, tick, isOwner, link, syncStaffMessage };
}

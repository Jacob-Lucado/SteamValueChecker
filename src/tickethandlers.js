// Discord side of support tickets: /support, and the Reply / Assign / Resolve buttons and forms.
import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { UserError } from "./errors.js";
import { TK } from "./tickets.js";

const eph = (i, content) => i.reply({ content, flags: MessageFlags.Ephemeral });
const field = (id, label, style, max, placeholder = "", required = true) => ({ type: 1, components: [{ type: 4, custom_id: id, label, style, required, max_length: max, placeholder }] });

export function createTicketHandlers({ db, tickets, ownerId = null, publicUrl = null }) {
    async function failed(i, err) {
        if (!(err instanceof UserError)) console.error(`[ticket] ${err.name}: ${err.message}`);
        const content = err instanceof UserError ? err.message : "Something went wrong. Try again in a moment.";
        if (i.deferred || i.replied) await i.editReply({ content, embeds: [], components: [] }).catch(() => {});
        else await eph(i, content).catch(() => {});
    }

    /** Staff for a ticket: the bot owner, or in that server a Manage Server member or the server's staff role. */
    function isStaff(i, t) {
        if (ownerId && i.user.id === ownerId) return true;
        if (!t.guild_id || i.guildId !== t.guild_id) return false;
        if (i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
        const role = db.getTicketSettings(t.guild_id).staff_role_id;
        const roles = i.member?.roles;
        const ids = Array.isArray(roles) ? roles : [...(roles?.cache?.keys?.() ?? [])];
        return Boolean(role && ids.includes(role));
    }
    const needStaff = (i, id) => {
        const t = db.getTicket(Number(id));
        if (!t) throw new UserError("That ticket no longer exists.");
        if (!isStaff(i, t)) throw new UserError("Only support staff can do that.");
        return t;
    };

    const openModal = (i, giveawayId = 0) => i.showModal({
        custom_id: `${TK.mOpen}:${giveawayId}`, title: "Get help",
        components: [field("subject", "What is this about?", 1, 100, "e.g. My key did not work"), field("body", "Tell us what happened", 2, 1500)]
    });

    // A bug report: always goes to the bot owner and shows on the Admin page.
    const bugModal = i => i.showModal({
        custom_id: TK.mBug, title: "Report a bug",
        components: [field("subject", "Short title", 1, 100, "e.g. /steam recap shows no image"), field("body", "What happened?", 2, 1000, "What you did and what went wrong"), field("steps", "Steps to repeat it / what you expected", 2, 500, "Optional", false)]
    });
    async function handleBug(i) { try { return await bugModal(i); } catch (err) { await failed(i, err); } }

    // ---------- /support ----------
    async function handleCommand(i) {
        try {
            const sub = i.options.getSubcommand();
            if (sub === "open") return i.options.getString("type") === "bug" ? await bugModal(i) : await openModal(i);
            if (sub === "mine") {
                const rows = db.listTickets({ userId: i.user.id, limit: 15 });
                if (!rows.length) return eph(i, "You have no tickets. Use `/support open` if you need help.");
                const icon = { open: "🟢", waiting: "🟡", resolved: "✅", closed: "⚫" };
                return i.reply({ flags: MessageFlags.Ephemeral, embeds: [{ color: 0xff9800, title: "Your tickets",
                    description: rows.map(t => `${icon[t.status]} **#${t.id}** ${t.subject}${publicUrl ? ` ([open](${publicUrl}/#/support/${t.id}))` : ""}`).join("\n").slice(0, 4000) }] });
            }
            if (sub === "setup") {
                const global = i.options.getBoolean("global") === true;
                if (global && !(ownerId && i.user.id === ownerId)) throw new UserError("Only the bot owner can set the owner's support channel.");
                if (!global && !(i.inGuild() && i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))) throw new UserError("Run this in your server with the Manage Server permission.");
                const channel = i.options.getChannel("channel", true);
                if (![0, 5].includes(channel.type)) throw new UserError("Pick a text channel.");
                const role = i.options.getRole("staffrole");
                db.setTicketSettings(global ? "*" : i.guildId, { channelId: channel.id, staffRoleId: role?.id ?? null });
                return eph(i, `${global ? "Owner tickets" : "Tickets for this server"} will be posted in <#${channel.id}>.${role ? ` Members with <@&${role.id}> can answer them.` : ""} Give the bot View Channel, Send Messages and Embed Links there.`);
            }
        } catch (err) { await failed(i, err); }
    }

    // ---------- buttons ----------
    async function handleButton(i) {
        const [kind, a, b] = i.customId.split(":");
        try {
            if (kind === TK.open) return await openModal(i, Number(a) || 0);
            if (kind === TK.bug) return await bugModal(i);
            if (kind === TK.reply) {
                needStaff(i, a);
                return await i.showModal({ custom_id: `${TK.mReply}:${a}`, title: `Reply to ticket #${a}`, components: [field("body", "Your reply", 2, 1500)] });
            }
            if (kind === TK.ureply) {
                const t = db.getTicket(Number(a));
                if (!t || t.user_id !== i.user.id) throw new UserError("That ticket is not yours.");
                return await i.showModal({ custom_id: `${TK.mUreply}:${a}`, title: `Reply to ticket #${a}`, components: [field("body", "Your message", 2, 1500)] });
            }
            if (kind === TK.assign) {
                needStaff(i, a);
                await i.deferUpdate();
                await tickets.assign(Number(a), i.user.id);
                return;
            }
            if (kind === TK.resolve) {
                needStaff(i, a);
                await i.deferUpdate();
                await tickets.resolve(Number(a), { by: i.user.id });
                return;
            }
            if (kind === TK.rate) {
                const r = tickets.rate(Number(a), i.user.id, Number(b));
                return await i.update({ content: `Thanks for the ${"⭐".repeat(r)} rating!`, embeds: [], components: [] });
            }
        } catch (err) { await failed(i, err); }
    }

    // ---------- forms ----------
    async function handleModal(i) {
        const [kind, a] = i.customId.split(":");
        try {
            if (kind === TK.mOpen) {
                await i.deferReply({ flags: MessageFlags.Ephemeral });
                const giveawayId = Number(a) || null;
                const r = await tickets.open({ userId: i.user.id, userName: i.user.username, guildId: i.guildId, subject: i.fields.getTextInputValue("subject"), body: i.fields.getTextInputValue("body"), giveawayId });
                return void await i.editReply(`Ticket **#${r.id}** is open. ${r.queued ? "The team has been told." : "Nobody has been notified yet because no support channel is set up, but your message is saved."} You will get replies here in your DMs${publicUrl ? ` and at ${publicUrl}/#/support/${r.id}` : ""}.`);
            }
            if (kind === TK.mBug) {
                await i.deferReply({ flags: MessageFlags.Ephemeral });
                const steps = i.fields.getTextInputValue("steps")?.trim();
                const r = await tickets.open({ userId: i.user.id, userName: i.user.username, guildId: i.guildId, kind: "bug", subject: i.fields.getTextInputValue("subject"),
                    body: i.fields.getTextInputValue("body") + (steps ? `\n\nSteps / expected:\n${steps}` : "") });
                return void await i.editReply(`Thanks. Bug report **#${r.id}** is sent to the bot owner.${publicUrl ? ` You can follow it at ${publicUrl}/#/support/${r.id}.` : ""} You will get a DM if there is a reply.`);
            }
            if (kind === TK.mReply) {
                const t = needStaff(i, a);
                await i.deferReply({ flags: MessageFlags.Ephemeral });
                await tickets.reply(t.id, { authorId: i.user.id, role: "staff", body: i.fields.getTextInputValue("body") });
                return void await i.editReply("Reply sent.");
            }
            if (kind === TK.mUreply) {
                const t = db.getTicket(Number(a));
                if (!t || t.user_id !== i.user.id) throw new UserError("That ticket is not yours.");
                await i.deferReply({ flags: MessageFlags.Ephemeral });
                await tickets.reply(t.id, { authorId: i.user.id, role: "user", body: i.fields.getTextInputValue("body") });
                return void await i.editReply("Sent. The team will see it.");
            }
        } catch (err) { await failed(i, err); }
    }

    return { handleCommand, handleBug, handleButton, handleModal };
}

// Guided server setup: the same checklist in Discord (/setup, channel pickers) and on the dashboard (Setup page).
// No discord.js import here: the dashboard shares setupStatus, and it runs without discord.js.
const EPHEMERAL = 64;
const PermissionFlagsBits = { ManageGuild: 1n << 5n, ViewChannel: 1n << 10n, SendMessages: 1n << 11n, EmbedLinks: 1n << 14n };

export const SU = { alert: "su_alert", support: "su_support", vouch: "su_vouch", feed: "su_feed", gn: "su_gn", refresh: "su_refresh", auto: "su_auto" };

/** Where a server stands. Used by both sides so they always agree. */
export function setupStatus(db, guildId) {
    const g = db.getGuild(guildId), t = db.getTicketSettings(guildId), gw = db.getGiveawaySettings(guildId);
    const s = { alertChannel: g?.channel_id ?? null, feed: Boolean(g?.free_feed), supportChannel: t.channel_id ?? null, staffRole: t.staff_role_id ?? null, vouchChannel: gw.vouch_channel_id ?? null, gameNight: db.gameNightOn(guildId) };
    const steps = [
        { id: "alert", text: "Alert channel (used when a DM fails, and for the free-games feed)", done: Boolean(s.alertChannel) },
        { id: "feed", text: "Post new free games for everyone (optional)", done: s.feed, optional: true },
        { id: "support", text: "Support ticket channel for your members", done: Boolean(s.supportChannel) },
        { id: "gamenight", text: "Game night: nudge voice channels when a game they all want goes on sale (optional)", done: s.gameNight, optional: true },
        { id: "vouch", text: "Vouches channel for giveaways (optional)", done: Boolean(s.vouchChannel), optional: true }
    ];
    return { ...s, steps, complete: steps.filter(x => !x.optional).every(x => x.done) };
}

export function setupEmbed(st, dashboardUrl = null, guildId = null, note = null) {
    const mark = x => (x.done ? "✅" : x.optional ? "➖" : "⬜");
    const where = { alert: st.alertChannel, support: st.supportChannel, vouch: st.vouchChannel };
    return { color: 0xff9800, title: "Server setup",
        description: [...st.steps.map(x => `${mark(x)} ${x.text}${where[x.id] ? ` → <#${where[x.id]}>` : ""}`),
            "", st.complete ? "The essentials are done. Members can use `/wishlist import`, `/support open` and the rest." : "Pick channels below. Everything can be changed again any time with `/setup`.",
            dashboardUrl ? `\nPrefer a web page? ${dashboardUrl}/#/setup/${guildId}` : "",
            note ? `\n${note}` : ""].join("\n").slice(0, 4000) };
}

const picker = (id, placeholder) => ({ type: 1, components: [{ type: 8, custom_id: id, placeholder, channel_types: [0, 5], min_values: 1, max_values: 1 }] });
export function setupComponents(st) {
    return [picker(SU.alert, "Choose the alert channel"), picker(SU.support, "Choose the support ticket channel"), picker(SU.vouch, "Choose the giveaway vouches channel"),
        { type: 1, components: [
            { type: 2, style: 3, label: "Create the channels for me", custom_id: SU.auto },
            { type: 2, style: st.gameNight ? 4 : 2, label: st.gameNight ? "Stop game night nudges" : "Game night nudges", custom_id: SU.gn },
            { type: 2, style: st.feed ? 4 : 2, label: st.feed ? "Stop free-games feed" : "Free-games feed", custom_id: SU.feed },
            { type: 2, style: 2, label: "Refresh", custom_id: SU.refresh }] }];
}

const OVERWRITE = { view: 1024n, send: 2048n, embed: 16384n };
const ALLOW_BOT = String(OVERWRITE.view | OVERWRITE.send | OVERWRITE.embed);

/**
 * Creates a "Steam Value Checker" category with #deal-alerts, #support-tickets (private) and #vouches, and points the bot at them.
 * Channels that are already set up are left alone. `api` needs createChannel(guildId, body) -> { id } and sendMessage(channelId, payload);
 * a failure with status 403 means the bot lacks Manage Channels.
 */
export async function autoSetup({ api, db, guildId, botId, userId, staffRoleId = null }) {
    const st = setupStatus(db, guildId), created = [];
    const need = { alert: !st.alertChannel, support: !st.supportChannel, vouch: !st.vouchChannel };
    if (!need.alert && !need.support && !need.vouch) return { created, note: "Everything is already set up." };
    const bot = { id: botId, type: 1, allow: ALLOW_BOT, deny: "0" };
    const readOnly = [{ id: guildId, type: 0, allow: String(OVERWRITE.view), deny: String(OVERWRITE.send) }, bot];
    const priv = [{ id: guildId, type: 0, allow: "0", deny: String(OVERWRITE.view) }, bot, { id: userId, type: 1, allow: String(OVERWRITE.view | OVERWRITE.send), deny: "0" },
        ...(staffRoleId ? [{ id: staffRoleId, type: 0, allow: String(OVERWRITE.view | OVERWRITE.send), deny: "0" }] : [])];
    const make = async body => {
        try { return await api.createChannel(guildId, body); }
        catch (e) {
            if (e?.status === 403) throw Object.assign(new Error("I need the Manage Channels permission to create channels. Give it to my role in Server Settings, or pick existing channels instead."), { userFacing: true });
            throw e;
        }
    };
    const say = (id, content) => api.sendMessage(id, { content, allowed_mentions: { parse: [] } }).catch(() => {});
    db.setGameNight(guildId, true);
    const cat = await make({ name: "Steam Value Checker", type: 4 });
    if (need.alert) {
        const c = await make({ name: "deal-alerts", type: 0, parent_id: cat.id, topic: "Sale alerts and free games from Steam Value Checker", permission_overwrites: readOnly });
        db.setGuildChannel(guildId, c.id, userId); db.setFreeFeed(guildId, true); created.push({ id: c.id, role: "alerts" });
        await say(c.id, "Alerts land here when a member's DM fails, and new free games are posted for everyone. Members: use `/wishlist import` to get your own sale alerts.");
    }
    if (need.support) {
        const c = await make({ name: "support-tickets", type: 0, parent_id: cat.id, topic: "Member help tickets (staff only)", permission_overwrites: priv });
        db.setTicketSettings(guildId, { channelId: c.id, staffRoleId: staffRoleId ?? st.staffRole }); created.push({ id: c.id, role: "support" });
        await say(c.id, "Member tickets from `/support open` appear here with Reply, Assign me and Resolve buttons. Only you and the bot can see this channel. Add your staff in the channel's permissions, or set a staff role in `/setup`.");
    }
    if (need.vouch) {
        const c = await make({ name: "vouches", type: 0, parent_id: cat.id, topic: "Giveaway winners confirm their keys worked", permission_overwrites: readOnly });
        db.setGiveawaySettings(guildId, { vouch_channel_id: c.id }); created.push({ id: c.id, role: "vouches" });
    }
    return { created, note: `Created ${created.map(c => `<#${c.id}>`).join(", ")}. #support-tickets is private to you and the bot; add your staff to it.` };
}

export function createSetupHandlers({ db, publicUrl = null }) {
    const eph = (i, content) => i.reply({ content, flags: EPHEMERAL });
    const allowed = i => i.inGuild() && i.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
    const panel = i => { const st = setupStatus(db, i.guildId); return { embeds: [setupEmbed(st, publicUrl, i.guildId)], components: setupComponents(st) }; };

    async function handleCommand(i) {
        if (!allowed(i)) return eph(i, "Run this in your server with the Manage Server permission.");
        return i.reply({ ...panel(i), flags: EPHEMERAL });
    }

    async function canPost(i, channelId) {
        try {
            const ch = await i.guild.channels.fetch(channelId);
            const me = await i.guild.members.fetchMe();
            const p = ch.permissionsFor(me);
            const need = [[PermissionFlagsBits.ViewChannel, "View Channel"], [PermissionFlagsBits.SendMessages, "Send Messages"], [PermissionFlagsBits.EmbedLinks, "Embed Links"]].filter(([f]) => !p?.has(f)).map(([, n]) => n);
            return need.length ? `I cannot post in <#${channelId}> yet. Give me: ${need.join(", ")}.` : null;
        } catch { return "I cannot see that channel."; }
    }

    async function handleComponent(i) {
        if (!allowed(i)) return eph(i, "Only members with Manage Server can change setup.");
        let note = null;
        if (i.isChannelSelectMenu?.() || i.isAnySelectMenu?.()) {
            const channelId = i.values[0];
            const problem = await canPost(i, channelId);
            if (problem) return eph(i, problem);
            if (i.customId === SU.alert) db.setGuildChannel(i.guildId, channelId, i.user.id);
            else if (i.customId === SU.support) db.setTicketSettings(i.guildId, { channelId, staffRoleId: db.getTicketSettings(i.guildId).staff_role_id });
            else if (i.customId === SU.vouch) db.setGiveawaySettings(i.guildId, { vouch_channel_id: channelId });
        } else if (i.customId === SU.auto) {
            await i.deferUpdate();
            try {
                const api = { createChannel: (g, body) => i.client.rest.post(`/guilds/${g}/channels`, { body }), // a DiscordAPIError carries status 403 when permission is missing
                    sendMessage: (c, body) => i.client.rest.post(`/channels/${c}/messages`, { body }) };
                const r = await autoSetup({ api, db, guildId: i.guildId, botId: i.client.user.id, userId: i.user.id });
                note = r.note;
            } catch (e) { note = e.userFacing ? e.message : "I could not create the channels. Check my permissions and try again, or pick channels from the menus."; }
            const st = setupStatus(db, i.guildId);
            return i.editReply({ embeds: [setupEmbed(st, publicUrl, i.guildId, note)], components: setupComponents(st) });
        } else if (i.customId === SU.gn) {
            db.setGameNight(i.guildId, !db.gameNightOn(i.guildId));
        } else if (i.customId === SU.feed) {
            if (!db.getGuild(i.guildId)) return eph(i, "Choose an alert channel first. The free-games feed posts there.");
            db.setFreeFeed(i.guildId, !db.getGuild(i.guildId).free_feed);
        }
        return i.update(panel(i));
    }
    return { handleCommand, handleComponent };
}

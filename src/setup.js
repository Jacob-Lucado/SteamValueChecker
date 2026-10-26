// Guided server setup: the same checklist in Discord (/setup, channel pickers) and on the dashboard (Setup page).
// No discord.js import here: the dashboard shares setupStatus, and it runs without discord.js.
const EPHEMERAL = 64;
const PermissionFlagsBits = { ManageGuild: 1n << 5n, ViewChannel: 1n << 10n, SendMessages: 1n << 11n, EmbedLinks: 1n << 14n };

export const SU = { alert: "su_alert", support: "su_support", vouch: "su_vouch", feed: "su_feed", refresh: "su_refresh" };

/** Where a server stands. Used by both sides so they always agree. */
export function setupStatus(db, guildId) {
    const g = db.getGuild(guildId), t = db.getTicketSettings(guildId), gw = db.getGiveawaySettings(guildId);
    const s = { alertChannel: g?.channel_id ?? null, feed: Boolean(g?.free_feed), supportChannel: t.channel_id ?? null, staffRole: t.staff_role_id ?? null, vouchChannel: gw.vouch_channel_id ?? null };
    const steps = [
        { id: "alert", text: "Alert channel (used when a DM fails, and for the free-games feed)", done: Boolean(s.alertChannel) },
        { id: "feed", text: "Post new free games for everyone (optional)", done: s.feed, optional: true },
        { id: "support", text: "Support ticket channel for your members", done: Boolean(s.supportChannel) },
        { id: "vouch", text: "Vouches channel for giveaways (optional)", done: Boolean(s.vouchChannel), optional: true }
    ];
    return { ...s, steps, complete: steps.filter(x => !x.optional).every(x => x.done) };
}

export function setupEmbed(st, dashboardUrl = null, guildId = null) {
    const mark = x => (x.done ? "✅" : x.optional ? "➖" : "⬜");
    const where = { alert: st.alertChannel, support: st.supportChannel, vouch: st.vouchChannel };
    return { color: 0xff9800, title: "Server setup",
        description: [...st.steps.map(x => `${mark(x)} ${x.text}${where[x.id] ? ` → <#${where[x.id]}>` : ""}`),
            "", st.complete ? "The essentials are done. Members can use `/wishlist import`, `/support open` and the rest." : "Pick channels below. Everything can be changed again any time with `/setup`.",
            dashboardUrl ? `\nPrefer a web page? ${dashboardUrl}/#/setup/${guildId}` : ""].join("\n").slice(0, 4000) };
}

const picker = (id, placeholder) => ({ type: 1, components: [{ type: 8, custom_id: id, placeholder, channel_types: [0, 5], min_values: 1, max_values: 1 }] });
export function setupComponents(st) {
    return [picker(SU.alert, "Choose the alert channel"), picker(SU.support, "Choose the support ticket channel"), picker(SU.vouch, "Choose the giveaway vouches channel"),
        { type: 1, components: [
            { type: 2, style: st.feed ? 4 : 3, label: st.feed ? "Stop free-games feed" : "Post free games for everyone", custom_id: SU.feed },
            { type: 2, style: 2, label: "Refresh", custom_id: SU.refresh }] }];
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
        } else if (i.customId === SU.feed) {
            if (!db.getGuild(i.guildId)) return eph(i, "Choose an alert channel first. The free-games feed posts there.");
            db.setFreeFeed(i.guildId, !db.getGuild(i.guildId).free_feed);
        }
        return i.update(panel(i));
    }
    return { handleCommand, handleComponent };
}

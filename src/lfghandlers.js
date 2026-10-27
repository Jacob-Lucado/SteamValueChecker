// /lfg: Discord side of looking-for-group posts.
import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { parseWhen } from "./lfg.js";
import { LFG_JOIN, LFG_LEAVE, LFG_CLOSE } from "./lfgrender.js";
import { validTimezone } from "./timeutil.js";
import { UserError } from "./errors.js";

export function createLfgHandlers({ db, lfg }) {
    const eph = (i, content) => i.reply({ content, flags: MessageFlags.Ephemeral });
    const canManage = i => Boolean(i.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
    async function failed(i, err) {
        if (!(err instanceof UserError)) console.error(`[lfg] ${err.name}: ${err.message}`);
        const content = err instanceof UserError ? err.message : "Something went wrong. Try again in a moment.";
        if (i.deferred || i.replied) await i.editReply({ content }).catch(() => {});
        else await eph(i, content).catch(() => {});
    }

    async function handleCommand(i) {
        if (!i.guildId) return eph(i, "Use this in a server.");
        const sub = i.options.getSubcommand();
        try {
            if (sub === "list") {
                const posts = db.listOpenLfg(i.guildId);
                if (!posts.length) return eph(i, "No open posts here. Start one with `/lfg post`.");
                return i.reply({ flags: MessageFlags.Ephemeral, embeds: [{ color: 0x57f287, title: "Open looking-for-group posts",
                    description: posts.slice(0, 15).map(p => `**#${p.id}** ${p.game}, <t:${Math.floor(p.starts_at / 1000)}:R>, ${db.lfgMembers(p.id).length}/${p.slots}${p.message_id ? ` [open](https://discord.com/channels/${p.guild_id}/${p.channel_id}/${p.message_id})` : ""}`).join("\n") }] });
            }
            if (sub === "close") {
                const p = await lfg.close(i.options.getInteger("id", true), i.user.id, { canManage: canManage(i) });
                return eph(i, `Closed **${p.game}**.`);
            }
            const user = db.ensureUser(i.user.id, i.guildId);
            const tz = validTimezone(user.tz) ? user.tz : "UTC";
            const startsAt = parseWhen(i.options.getString("when", true), { tz });
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            const { post, eventError } = await lfg.create({
                guildId: i.guildId, channelId: i.channelId, creatorId: i.user.id, game: i.options.getString("game", true),
                startsAt: startsAt ?? NaN, slots: i.options.getInteger("slots") ?? 4, note: i.options.getString("note"), event: Boolean(i.options.getBoolean("event"))
            });
            return void await i.editReply(`Posted **${post.game}** in this channel.${eventError ? ` ${eventError}` : ""}${user.tz === "UTC" && !i.options.getString("when").match(/^in |^now$/i) ? "\nTimes use your time zone. Set it with `/alerts quiethours timezone:`, or it is read as UTC." : ""}`);
        } catch (err) { await failed(i, err); }
    }

    async function handleButton(i) {
        const [action, idText] = i.customId.split(":");
        const id = Number(idText);
        try {
            if (action === LFG_JOIN) {
                const r = await lfg.join(id, i.user.id);
                return eph(i, r.result === "already" ? "You are already in." : `You are in for **${r.post.game}**.`);
            }
            if (action === LFG_LEAVE) { const p = await lfg.leave(id, i.user.id); return eph(i, `You left **${p.game}**.`); }
            if (action === LFG_CLOSE) { const p = await lfg.close(id, i.user.id, { canManage: canManage(i) }); return eph(i, `Closed **${p.game}**.`); }
        } catch (err) { await failed(i, err); }
    }
    return { handleCommand, handleButton };
}

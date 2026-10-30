// The /mod commands. No discord.js import: the interaction object and the shared moderation service are all it needs.
import { ModError, ACTIONS, fmtDuration } from "./moderation.js";

const EPHEMERAL = 64;
const BIT = { kick: 1n << 1n, ban: 1n << 2n, manageGuild: 1n << 5n, manageMessages: 1n << 13n, moderate: 1n << 40n };
/** What each /mod command needs, the same permissions Discord's own moderation uses. */
export const NEEDS = { warn: "moderate", warnings: "moderate", clearwarns: "moderate", cases: "moderate", timeout: "moderate", untimeout: "moderate", kick: "kick", ban: "ban", unban: "ban", purge: "manageMessages", log: "manageGuild" };
export const PERMISSION_TEXT = { moderate: "Moderate Members", kick: "Kick Members", ban: "Ban Members", manageMessages: "Manage Messages", manageGuild: "Manage Server" };

export const caseLine = c => {
    const a = ACTIONS[c.action] ?? { label: c.action, icon: "•" };
    return `**#${c.case_no}** ${a.icon} ${a.label}${c.cleared ? " (cleared)" : ""} · <t:${Math.floor(c.created_at / 1000)}:R>${c.mod_id ? ` · by <@${c.mod_id}>` : ""}${c.duration_s ? ` · ${fmtDuration(c.duration_s)}` : ""}${c.reason ? `\n> ${String(c.reason).slice(0, 150)}` : ""}`;
};

export function createModHandlers({ db, mod, publicUrl = null }) {
    const eph = (i, content) => i.reply({ content, flags: EPHEMERAL, allowedMentions: { parse: [] } });
    const historyEmbed = (title, h, who) => ({
        color: 0x5865f2, title,
        description: h.cases.length ? h.cases.map(caseLine).join("\n\n") : "Nothing yet.",
        footer: { text: `Page ${h.page} of ${h.pages} · ${h.total} case${h.total === 1 ? "" : "s"}${who && h.warnings !== null ? ` · ${h.warnings} active warning${h.warnings === 1 ? "" : "s"}` : ""}` }
    });

    async function handleCommand(i) {
        if (!i.inGuild?.()) return eph(i, "Use this in a server.");
        const sub = i.options.getSubcommand(), need = NEEDS[sub];
        if (need && !i.memberPermissions?.has(BIT[need])) return eph(i, `You need the ${PERMISSION_TEXT[need]} permission for that.`);
        const gid = i.guildId, actorId = i.user.id, o = i.options;
        db.bumpUsage(`cmd:mod/${sub}`);
        const user = () => o.getUser("user", true).id;
        const reason = () => o.getString("reason");
        try {
            if (sub === "log") {
                const ch = o.getChannel("channel");
                if (ch) { db.setCommunity(gid, { mod_log_channel: ch.id }); return eph(i, `Moderation actions will be logged in <#${ch.id}>.`); }
                const cur = mod.logChannel(gid);
                return eph(i, cur ? `Moderation actions are logged in <#${cur}>. Pick another with the channel option.` : "No mod log yet. Pick a channel with the channel option, or run `/community setup`.");
            }
            if (sub === "cases" || sub === "warnings") {
                const u = sub === "warnings" ? o.getUser("user", true) : o.getUser("user");
                const h = mod.history(gid, { userId: u?.id ?? null, page: o.getInteger("page") ?? 1 });
                return i.reply({ embeds: [historyEmbed(u ? `Cases for ${u.username}` : "Recent cases", h, Boolean(u))], flags: EPHEMERAL, allowedMentions: { parse: [] } });
            }
            if (sub === "clearwarns") { const r = mod.clearWarnings({ guildId: gid, userId: user() }); return eph(i, r.cleared ? `Cleared ${r.cleared} warning${r.cleared === 1 ? "" : "s"}. They stay in the case history.` : "That person has no active warnings."); }
            if (sub === "purge") {
                await i.deferReply({ flags: EPHEMERAL });
                const r = await mod.purge({ guildId: gid, actorId, channelId: o.getChannel("channel")?.id ?? i.channelId, amount: o.getInteger("amount", true), userId: o.getUser("user")?.id ?? null });
                return i.editReply({ content: `🧹 Deleted ${r.deleted} message${r.deleted === 1 ? "" : "s"} (case #${r.case.case_no}).` });
            }
            await i.deferReply({ flags: EPHEMERAL });
            let r, text;
            if (sub === "warn") { r = await mod.warn({ guildId: gid, actorId, userId: user(), reason: reason() }); text = `⚠️ Warned <@${r.case.user_id}> (case #${r.case.case_no}). They now have ${r.warnings} active warning${r.warnings === 1 ? "" : "s"}.${r.dmSent ? "" : " I could not message them."}`; }
            else if (sub === "timeout") { r = await mod.timeout({ guildId: gid, actorId, userId: user(), duration: o.getString("duration", true), reason: reason() }); text = `🔇 Timed out <@${r.case.user_id}> for ${fmtDuration(r.case.duration_s)} (case #${r.case.case_no}).`; }
            else if (sub === "untimeout") { r = await mod.untimeout({ guildId: gid, actorId, userId: user(), reason: reason() }); text = `🔈 Lifted the timeout on <@${r.case.user_id}> (case #${r.case.case_no}).`; }
            else if (sub === "kick") { r = await mod.kick({ guildId: gid, actorId, userId: user(), reason: reason() }); text = `👢 Kicked <@${r.case.user_id}> (case #${r.case.case_no}).`; }
            else if (sub === "ban") { r = await mod.ban({ guildId: gid, actorId, userId: user(), reason: reason(), deleteDays: o.getInteger("delete_days") ?? 0 }); text = `🔨 Banned <@${r.case.user_id}> (case #${r.case.case_no}).`; }
            else if (sub === "unban") { r = await mod.unban({ guildId: gid, actorId, userId: o.getString("user_id", true).trim(), reason: reason() }); text = `🕊️ Unbanned <@${r.case.user_id}> (case #${r.case.case_no}).`; }
            else return i.editReply({ content: "I do not know that command." });
            return i.editReply({ content: text, allowedMentions: { parse: [] } });
        } catch (e) {
            const msg = e instanceof ModError ? e.message : "Something went wrong. Nothing was changed that I know of.";
            if (!(e instanceof ModError)) console.error("[mod]", e);
            return (i.deferred || i.replied) ? i.editReply({ content: msg }) : eph(i, msg);
        }
    }
    return { handleCommand };
}

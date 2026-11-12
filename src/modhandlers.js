// The /mod commands. No discord.js import: the interaction object and the shared moderation service are all it needs.
import { ModError, ACTIONS, fmtDuration } from "./moderation.js";

const EPHEMERAL = 64;
const BIT = { kick: 1n << 1n, ban: 1n << 2n, manageGuild: 1n << 5n, manageMessages: 1n << 13n, manageChannels: 1n << 4n, moderate: 1n << 40n };
/** What each /mod command needs, the same permissions Discord's own moderation uses. */
export const NEEDS = { warn: "moderate", warnings: "moderate", clearwarns: "moderate", cases: "moderate", timeout: "moderate", untimeout: "moderate", kick: "kick", ban: "ban", unban: "ban", stats: "moderate", appeals: "ban", settings: "manageGuild", purge: "manageMessages", log: "manageGuild" , note: "moderate", slowmode: "manageChannels", lock: "manageChannels", unlock: "manageChannels", automod: "manageGuild" };
export const PERMISSION_TEXT = { moderate: "Moderate Members", kick: "Kick Members", ban: "Ban Members", manageMessages: "Manage Messages", manageChannels: "Manage Channels", manageGuild: "Manage Server" };

export const caseLine = c => {
    const a = ACTIONS[c.action] ?? { label: c.action, icon: "•" };
    return `**#${c.case_no}** ${a.icon} ${a.label}${c.cleared ? " (cleared)" : ""} · <t:${Math.floor(c.created_at / 1000)}:R>${c.mod_id ? ` · by <@${c.mod_id}>` : ""}${c.duration_s ? ` · ${fmtDuration(c.duration_s)}` : ""}${c.reason ? `\n> ${String(c.reason).slice(0, 150)}` : ""}`;
};

export function createModHandlers({ db, mod, automod = null, publicUrl = null }) {
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
                return eph(i, cur ? `Moderation actions are logged in <#${cur}>. Pick another with the channel option.` : "No mod log yet. Pick a channel with the channel option, or run `/manage community setup`.");
            }
            if (sub === "automod") {
                if (!automod) return eph(i, "The auto-moderator is not available right now.");
                const rule = o.getString("rule"), on = o.getBoolean("enabled");
                if (rule && on !== null && on !== undefined) {
                    const cur = automod.get(gid);
                    automod.save(gid, rule === "on" ? { on } : rule === "raid" ? { raid: { on } } : { rules: { [rule]: { on } } });
                    if (on && rule !== "on" && !cur.on) automod.save(gid, { on: true });
                }
                const c = automod.get(gid), flag = v => (v ? "🟢 on" : "⚫ off");
                const lines = [`**Auto-moderator:** ${flag(c.on)}`, ...Object.entries(automod.rules).map(([k, label]) => `• ${label}: ${flag(c.rules[k].on)}`), `• Raid guard: ${flag(c.raid.on)}`,
                    `**When a rule is broken:** the message is deleted${c.action.timeoutMinutes ? `, and they are timed out for ${c.action.timeoutMinutes} minute${c.action.timeoutMinutes === 1 ? "" : "s"}` : c.action.warn ? " and they get a warning" : ""}.`,
                    c.escalate.warns ? `**After ${c.escalate.warns} warnings:** ${c.escalate.action}${c.escalate.action === "timeout" ? ` for ${c.escalate.minutes} minutes` : ""}.` : null].filter(Boolean);
                return i.reply({ embeds: [{ color: 0xed4245, title: "🤖 Auto-moderator", description: lines.join("\n"), footer: { text: `Blocked words, link allow-list, exemptions and the rest are on the dashboard${publicUrl ? ` at ${publicUrl}` : ""}.` } }], flags: EPHEMERAL });
            }
            if (sub === "note") { const r = await mod.note({ guildId: gid, actorId, userId: user(), text: o.getString("text", true) }); return eph(i, `Noted on <@${r.case.user_id}> (case #${r.case.case_no}). They are not told.`); }
            if (sub === "slowmode") {
                await i.deferReply({ flags: EPHEMERAL });
                const r = await mod.slowmode({ guildId: gid, actorId, channelId: o.getChannel("channel")?.id ?? i.channelId, seconds: o.getString("length", true), reason: o.getString("reason") });
                return i.editReply({ content: r.seconds ? `Slowmode set to ${fmtDuration(r.seconds)} (case #${r.case.case_no}).` : `Slowmode is off (case #${r.case.case_no}).` });
            }
            if (sub === "lock" || sub === "unlock") {
                await i.deferReply({ flags: EPHEMERAL });
                const ch = o.getChannel("channel")?.id ?? i.channelId;
                const r = await mod.lock({ guildId: gid, actorId, channelId: ch, reason: o.getString("reason"), unlock: sub === "unlock" });
                return i.editReply({ content: `${sub === "lock" ? "Locked" : "Unlocked"} <#${ch}> (case #${r.case.case_no}).` });
            }
            if (sub === "cases" || sub === "warnings") {
                const u = sub === "warnings" ? o.getUser("user", true) : o.getUser("user");
                const h = mod.history(gid, { userId: u?.id ?? null, page: o.getInteger("page") ?? 1 });
                return i.reply({ embeds: [historyEmbed(u ? `Cases for ${u.username}` : "Recent cases", h, Boolean(u))], flags: EPHEMERAL, allowedMentions: { parse: [] } });
            }
            if (sub === "stats") {
                const days = o.getInteger("days") ?? 30, rows = mod.stats(gid, days).slice(0, 15);
                return i.reply({ embeds: [{ color: 0x5865f2, title: `Moderator activity, last ${days} days`, description: rows.length ? rows.map(r => `<@${r.mod_id}> · **${r.total}** · ${Object.entries(r.actions).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${ACTIONS[k]?.label?.toLowerCase() ?? k}`).join(", ")}`).join("\n") : "No moderator actions in that time." }], flags: EPHEMERAL, allowedMentions: { parse: [] } });
            }
            if (sub === "settings") {
                const days = o.getInteger("warn_expiry_days"), ap = o.getBoolean("appeals"), patch = {};
                if (days !== null && days !== undefined) patch.warn_days = days;
                if (ap !== null && ap !== undefined) patch.appeals_on = ap ? 1 : 0;
                if (Object.keys(patch).length) db.setCommunity(gid, patch);
                const c = db.getCommunity(gid);
                return eph(i, `Warnings ${c.warn_days ? `stop counting after ${c.warn_days} days` : "never expire"}. Ban appeals are ${c.appeals_on ? "on (permanent bans tell the person where to appeal)" : "off"}.`);
            }
            if (sub === "appeals") {
                const id = o.getInteger("id"), ans = o.getString("answer");
                if (id && ans) { const r = await mod.decideAppeal({ guildId: gid, actorId, id, accept: ans === "accept", note: o.getString("note") ?? "" }); return eph(i, `Appeal #${r.appeal.id} ${r.appeal.status}.`); }
                const list = db.listAppeals(gid);
                return i.reply({ embeds: [{ color: 0x5865f2, title: "Open ban appeals", description: list.length ? list.map(a => `**#${a.id}** <@${a.user_id}> · <t:${Math.floor(a.created_at / 1000)}:R>\n${a.text.slice(0, 300)}`).join("\n\n") : "Nothing waiting.", footer: { text: "Answer with /mod appeals id:<number> answer:accept or deny" } }], flags: EPHEMERAL, allowedMentions: { parse: [] } });
            }
            if (sub === "clearwarns") { const r = mod.clearWarnings({ guildId: gid, userId: user() }); return eph(i, r.cleared ? `Cleared ${r.cleared} warning${r.cleared === 1 ? "" : "s"}. They stay in the case history.` : "That person has no active warnings."); }
            if (sub === "purge") {
                await i.deferReply({ flags: EPHEMERAL });
                const r = await mod.purge({ guildId: gid, actorId, channelId: o.getChannel("channel")?.id ?? i.channelId, amount: o.getInteger("amount", true), userId: o.getUser("user")?.id ?? null });
                return i.editReply({ content: `Deleted ${r.deleted} message${r.deleted === 1 ? "" : "s"} (case #${r.case.case_no}).` });
            }
            await i.deferReply({ flags: EPHEMERAL });
            let r, text;
            if (sub === "warn") { r = await mod.warn({ guildId: gid, actorId, userId: user(), reason: reason() }); text = `Warned <@${r.case.user_id}> (case #${r.case.case_no}). They now have ${r.warnings} active warning${r.warnings === 1 ? "" : "s"}.${r.dmSent ? "" : " I could not message them."}`; }
            else if (sub === "timeout") { r = await mod.timeout({ guildId: gid, actorId, userId: user(), duration: o.getString("duration", true), reason: reason() }); text = `Timed out <@${r.case.user_id}> for ${fmtDuration(r.case.duration_s)} (case #${r.case.case_no}).`; }
            else if (sub === "untimeout") { r = await mod.untimeout({ guildId: gid, actorId, userId: user(), reason: reason() }); text = `Lifted the timeout on <@${r.case.user_id}> (case #${r.case.case_no}).`; }
            else if (sub === "kick") { r = await mod.kick({ guildId: gid, actorId, userId: user(), reason: reason() }); text = `Kicked <@${r.case.user_id}> (case #${r.case.case_no}).`; }
            else if (sub === "ban") { r = await mod.ban({ guildId: gid, actorId, userId: user(), reason: reason(), deleteDays: o.getInteger("delete_days") ?? 0, duration: o.getString("length") }); text = `Banned <@${r.case.user_id}>${r.case.duration_s ? ` for ${fmtDuration(r.case.duration_s)} (lifts itself)` : ""} (case #${r.case.case_no}).`; }
            else if (sub === "unban") { r = await mod.unban({ guildId: gid, actorId, userId: o.getString("user_id", true).trim(), reason: reason() }); text = `Unbanned <@${r.case.user_id}> (case #${r.case.case_no}).`; }
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

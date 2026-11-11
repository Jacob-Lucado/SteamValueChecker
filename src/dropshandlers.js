// Discord side of promo drops: /server promos add, list, end, channel, ping and news.
import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { UserError } from "./errors.js";
import { applyDropSettings, cleanDrop, dropView } from "./drops.js";

const eph = (i, payload) => i.reply({ ...(typeof payload === "string" ? { content: payload } : payload), flags: MessageFlags.Ephemeral });

export function dropLine(d) {
    const v = dropView(d);
    const ends = v.expiresAt ? `ends <t:${Math.floor(v.expiresAt / 1000)}:R>` : "no end date";
    return `**#${v.id} ${v.title}**${v.source ? ` (${v.source})` : ""}\n${v.code ? `\`${v.code}\` · ` : ""}${ends}${v.url ? ` · [Link](${v.url})` : ""}`;
}

export function createDropHandlers({ db, runNow = null }) {
    const managerOnly = i => {
        if (!i.inGuild()) throw new UserError("Use this in a server.");
        if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new UserError("You need the Manage Server permission to change this.");
    };
    const summary = (gid, s = db.getDropSettings(gid)) => [
        s.channel_id ? `Promo drops are posted in <#${s.channel_id}>.` : "No promo channel yet. Pick one with `/server promos channel`.",
        s.news ? "I also watch NVIDIA, SteelSeries and the Steam news of games like Dead by Daylight and post anything that sounds like a giveaway or a code." : "News watching is off (`/server promos news`).",
        s.role_id ? `Pings <@&${s.role_id}>.` : "No role is pinged."
    ].join("\n");

    async function handleCommand(i) {
        try {
            if (!i.inGuild()) throw new UserError("Promo drops live in servers. Use this in one.");
            const sub = i.options.getSubcommand();
            const gid = i.guildId;
            if (sub === "list") {
                const rows = db.listDrops(gid, { status: "active", limit: 10 }).filter(d => !d.expires_at || d.expires_at > Date.now());
                return await eph(i, { embeds: [{ color: 0x1abc9c, title: "Promo drops in this server", description: rows.length ? rows.map(dropLine).join("\n\n") : "Nothing right now. Managers can add one with `/server promos add`.", footer: { text: "These can run out before they are marked as ended" } }] });
            }
            managerOnly(i);
            if (sub === "add") {
                let clean;
                try { clean = cleanDrop({ title: i.options.getString("title"), code: i.options.getString("code"), url: i.options.getString("link"), source: i.options.getString("from"), days: i.options.getInteger("days"), note: i.options.getString("note") }); }
                catch (err) { throw new UserError(err.message); }
                if (!db.getDropSettings(gid).channel_id) throw new UserError("Pick a channel first with `/server promos channel`, then add the drop.");
                const id = db.addDrop({ guildId: gid, ...clean, createdBy: i.user.id });
                runNow?.().catch(() => {});
                return await eph(i, `Added as #${id}. It goes out in the promo channel in a moment. End it early with \`/server promos end id:${id}\`.`);
            }
            if (sub === "end") {
                const id = i.options.getInteger("id");
                const d = db.getDrop(id);
                if (!d || d.guild_id !== gid) throw new UserError("I don't have a drop with that number in this server. `/server promos list` shows them.");
                if (!db.endDrop(id)) throw new UserError("That one has already ended.");
                runNow?.().catch(() => {});
                return await eph(i, `Ended #${id}. Its post will be grayed out.`);
            }
            if (sub === "channel") {
                const ch = i.options.getChannel("channel");
                if (i.options.getBoolean("clear")) { db.setDropSettings(gid, { channel_id: null }); return await eph(i, "Done. Promo drops won't be posted here anymore.\n" + summary(gid)); }
                if (!ch) return await eph(i, summary(gid));
                try { await ch.send({ content: "Promo drops will be posted in this channel.", allowedMentions: { parse: [] } }); }
                catch { throw new UserError("I can't post in that channel. Give me View Channel, Send Messages and Embed Links there."); }
                const s = applyDropSettings(db, gid, { channel_id: ch.id });
                runNow?.().catch(() => {});
                return await eph(i, `Saved. Drops go to <#${ch.id}>.\n` + summary(gid, s));
            }
            if (sub === "ping") {
                const role = i.options.getRole("role");
                return await eph(i, (role ? "I'll ping that role for new drops." : "No role will be pinged.") + "\n" + summary(gid, applyDropSettings(db, gid, { role_id: role?.id ?? null })));
            }
            if (sub === "news") {
                const on = i.options.getBoolean("on");
                if (on === null || on === undefined) return await eph(i, summary(gid));
                if (on && !db.getDropSettings(gid).channel_id) throw new UserError("Pick a channel first with `/server promos channel`.");
                return await eph(i, (on ? "Okay, I'll post news that sounds like a giveaway or a code. Only new ones, nothing old." : "News watching is off.") + "\n" + summary(gid, applyDropSettings(db, gid, { news: on })));
            }
        } catch (err) {
            if (!(err instanceof UserError)) console.error(`[promos] ${err.name}: ${err.message}`);
            const content = err instanceof UserError ? err.message : "Something went wrong. Try again in a moment.";
            if (i.deferred || i.replied) await i.editReply({ content }).catch(() => {}); else await eph(i, content).catch(() => {});
        }
    }
    return { handleCommand, summary };
}

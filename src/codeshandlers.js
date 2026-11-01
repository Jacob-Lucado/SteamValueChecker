// Discord side of game codes: /games codes latest, channel, games and ping.
import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { UserError } from "./errors.js";
import { applyCodeSettings, codeEmbed, codeView, describeGames, pendingFor } from "./codes.js";
import { expandGames, GAME_FAMILIES } from "./codesource.js";
import { codeGames } from "./codes.js";

const eph = (i, payload) => i.reply({ ...(typeof payload === "string" ? { content: payload } : payload), flags: MessageFlags.Ephemeral });

/** One line per code for the /games codes latest list. */
export function codeLine(c) {
    const v = codeView(c);
    const ends = v.expiresAt ? `ends <t:${Math.floor(v.expiresAt / 1000)}:R>` : "no end date listed";
    return `**${v.gameTitle}** · ${v.reward || "Unknown reward"}\n\`${v.code}\` · ${ends} · [Redeem](${v.redeemUrl})`;
}

export function createCodeHandlers({ db, runNow = null }) {
    const managerOnly = i => {
        if (!i.inGuild()) throw new UserError("Use this in a server.");
        if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new UserError("You need the Manage Server permission to change this.");
    };
    const summary = (gid, s = db.getCodeSettings(gid)) => [
        s.channel_id ? `Codes are posted in <#${s.channel_id}>.` : "No codes channel yet. Pick one with `/games codes channel`.",
        s.games.length ? `Only: ${describeGames(s.games)}.` : "Every game is included.",
        s.role_id ? `Pings <@&${s.role_id}>.` : "No role is pinged."
    ].join("\n");

    async function handleCommand(i) {
        try {
            const sub = i.options.getSubcommand();
            if (sub === "latest") {
                const game = i.options.getString("game");
                const rows = db.listCodes({ status: "active", game: game ? expandGames([game]) : null, limit: 8 }).filter(c => !c.expires_at || c.expires_at > Date.now());
                const embed = { color: 0xff9800, title: game ? `${GAME_FAMILIES.find(f => f.key === game)?.title ?? "Game"} codes` : "Latest game codes",
                    description: rows.length ? rows.map(codeLine).join("\n\n") : "No active codes right now. New ones show up here as soon as they are listed.",
                    footer: { text: "Codes can run out before they are marked as ended" } };
                return await eph(i, { embeds: [embed] });
            }
            managerOnly(i);
            const gid = i.guildId;
            if (sub === "channel") {
                const ch = i.options.getChannel("channel");
                if (i.options.getBoolean("clear")) { db.setCodeSettings(gid, { channel_id: null }); return await eph(i, "Done. No more codes will be posted here.\n" + summary(gid)); }
                if (!ch) return await eph(i, summary(gid));
                try { await ch.send({ content: "Game codes will be posted in this channel. New SHiFT codes show up here as they are listed.", allowedMentions: { parse: [] } }); }
                catch { throw new UserError("I can't post in that channel. Give me View Channel, Send Messages and Embed Links there."); }
                const s = applyCodeSettings(db, gid, { channel_id: ch.id });
                runNow?.().catch(() => {});
                return await eph(i, `Saved. I'll post new codes in <#${ch.id}>.\n` + summary(gid, s));
            }
            if (sub === "games") {
                const game = i.options.getString("game");
                const on = i.options.getBoolean("on");
                if (!game) return await eph(i, summary(gid));
                const cur = db.getCodeSettings(gid).games;
                const all = codeGames().map(g => g.key);
                const base = cur.length ? cur : all;
                const keys = expandGames([game]);
                const next = on === false ? base.filter(k => !keys.includes(k)) : [...new Set([...base, ...keys])];
                if (!next.length) throw new UserError("Keep at least one game, or turn the codes channel off with `/games codes channel clear:true`.");
                return await eph(i, "Updated.\n" + summary(gid, applyCodeSettings(db, gid, { games: next })));
            }
            if (sub === "ping") {
                const role = i.options.getRole("role");
                return await eph(i, (role ? "I'll ping that role for new codes." : "No role will be pinged.") + "\n" + summary(gid, applyCodeSettings(db, gid, { role_id: role?.id ?? null })));
            }
        } catch (err) {
            if (!(err instanceof UserError)) console.error(`[codes] ${err.name}: ${err.message}`);
            const content = err instanceof UserError ? err.message : "Something went wrong. Try again in a moment.";
            if (i.deferred || i.replied) await i.editReply({ content }).catch(() => {}); else await eph(i, content).catch(() => {});
        }
    }
    return { handleCommand, summary };
}
export { codeEmbed, pendingFor };

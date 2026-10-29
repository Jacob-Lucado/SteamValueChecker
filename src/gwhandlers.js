// Discord side of giveaways: the /giveaway command, the Enter / Claim key / confirm buttons, and the key forms.
// Prize keys are typed into a private form (modal), never into a channel, and are encrypted before they are saved.

import { randomBytes } from "node:crypto";
import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { UserError } from "./errors.js";
import { parseKeys, parseDuration, parseColor, parseImageUrl, cleanText } from "./gwparse.js";
import { ID, keyMessage, infoPayload } from "./gwrender.js";

const DRAFT_MS = 15 * 60_000;
const REFRESH_EVERY_MS = 20_000;
const eph = (i, content) => i.reply({ content, flags: MessageFlags.Ephemeral });
const NOT_SET_UP = "Giveaways are not set up on this bot. The bot owner needs to set `KEY_ENCRYPTION_SECRET` so prize keys can be stored safely.";

const idFrom = value => {
    const n = Number(String(value ?? "").replace(/\D/g, ""));
    if (!Number.isInteger(n) || n <= 0) throw new UserError("Pick a giveaway from the list.");
    return n;
};

export function createGiveawayHandlers({ db, giveaways, now = () => Date.now() }) {
    const drafts = new Map();
    const lastRefresh = new Map();

    function stash(data) {
        const t = now();
        for (const [k, v] of drafts) if (v.exp < t) drafts.delete(k);
        const nonce = randomBytes(8).toString("hex");
        drafts.set(nonce, { ...data, exp: t + DRAFT_MS });
        return nonce;
    }
    function take(nonce, i) {
        const d = drafts.get(nonce);
        drafts.delete(nonce);
        if (!d || d.exp < now() || d.userId !== i.user.id || d.guildId !== i.guildId) throw new UserError("That form expired. Run the command again.");
        return d;
    }

    function isManager(i) {
        if (i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
        const roleId = db.getGiveawaySettings(i.guildId).manager_role_id;
        const roles = i.member?.roles;
        const ids = Array.isArray(roles) ? roles : [...(roles?.cache?.keys?.() ?? [])];
        return Boolean(roleId && ids.includes(roleId));
    }
    function needManager(i) {
        if (!i.inGuild()) throw new UserError("Use this command in a server.");
        if (!isManager(i)) throw new UserError("You need the Manage Server permission, or the giveaway manager role, to do this.");
    }
    function giveawayIn(i, value) {
        const g = db.getGiveaway(idFrom(value));
        if (!g || g.guild_id !== i.guildId) throw new UserError("I can't find that giveaway in this server.");
        return g;
    }

    async function failed(i, err) {
        if (!(err instanceof UserError)) console.error(`[giveaway] ${err.name}: ${err.message}`);
        const content = err instanceof UserError ? err.message : "Something went wrong. Try again in a moment.";
        if (i.deferred || i.replied) await i.editReply({ content, embeds: [], components: [] }).catch(() => {});
        else await eph(i, content).catch(() => {});
    }

    // ---------- /giveaway ----------
    function readCreate(o, i) {
        const textChannel = (c, what) => {
            if (c && ![0, 5].includes(c.type)) throw new UserError(`The ${what} must be a text channel.`);
            return c?.id ?? null;
        };
        const game = cleanText(o.getString("game"), 100);
        return {
            guild_id: i.guildId, host_id: i.user.id,
            title: o.getString("title"), duration_ms: parseDuration(o.getString("length") ?? "24h"),
            channel_id: textChannel(o.getChannel("channel"), "giveaway channel") ?? i.channelId,
            game_title: game, description: o.getString("description"),
            image_url: parseImageUrl(o.getString("image"), "image"), thumbnail_url: parseImageUrl(o.getString("thumbnail"), "thumbnail"),
            color: parseColor(o.getString("color")), button_label: o.getString("buttonlabel"),
            require_role_id: o.getRole("requirerole")?.id ?? null, bonus_role_id: o.getRole("bonusrole")?.id ?? null,
            bonus_entries: o.getInteger("bonusentries") ?? 2, ping_role_id: o.getRole("pingrole")?.id ?? null,
            claim_hours: o.getInteger("claimhours") ?? 48, min_account_days: o.getInteger("accountage") ?? 0, min_member_days: o.getInteger("memberage") ?? 0,
            vouch_channel_id: textChannel(o.getChannel("vouchchannel"), "vouches channel"),
            auto_image: !o.getBoolean("noautoimage"), require_boost: o.getBoolean("boosters") === true,
            start_in_ms: o.getString("startin") ? parseDuration(o.getString("startin"), { min: 0 }) : 0,
            rounds: o.getInteger("rounds") ?? 1, repeat_ms: o.getString("repeatevery") ? parseDuration(o.getString("repeatevery")) : null
        };
    }

    async function create(i) {
        needManager(i);
        const draft = readCreate(i.options, i);
        const nonce = stash({ draft, userId: i.user.id, guildId: i.guildId });
        await i.showModal({
            custom_id: `${ID.keysModal}:${nonce}`, title: "Prize keys",
            components: [{ type: 1, components: [{
                type: 4, custom_id: "keys", label: "One prize per line:  Name | KEY", style: 2, required: true, max_length: 4000,
                placeholder: "Hades | AAAAA-BBBBB-CCCCC\nCeleste | DDDDD-EEEEE-FFFFF\n(a key on its own uses the game name)"
            }] }]
        });
    }

    async function keysSubmitted(i) {
        try {
            const d = take(i.customId.split(":")[1], i);
            const { keys, duplicates } = parseKeys(i.fields.getTextInputValue("keys"), d.draft.game_title ?? d.draft.title ?? "Prize");
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            const r = await giveaways.create({ ...d.draft, keys });
            const art = { auto: "Artwork was found automatically.", custom: "Using your image.", none: "No artwork (none was found; you can recreate it with an `image:` link)." }[r.imageSource];
            await i.editReply([
                r.rounds > 1 ? `Series created: **${r.rounds} rounds** scheduled in <#${d.draft.channel_id}>, the first starting <t:${Math.floor(r.starts_at / 1000)}:R> (giveaway #${r.ids.join(", #")}). Cancel any round with \`/giveaway cancel\`.`
                  : r.scheduled ? `Giveaway **#${r.id}** is scheduled in <#${d.draft.channel_id}>. It starts <t:${Math.floor(r.starts_at / 1000)}:R> and runs until <t:${Math.floor(r.ends_at / 1000)}:R>.`
                  : `Giveaway **#${r.id}** is live in <#${d.draft.channel_id}> with ${r.prizes} prize${r.prizes === 1 ? "" : "s"}. It ends <t:${Math.floor(r.ends_at / 1000)}:R>.`,
                art, duplicates ? `${duplicates} duplicate key${duplicates === 1 ? " was" : "s were"} skipped.` : null,
                "Your keys are encrypted. The bot deletes each one once the winner confirms, and sends back any that go unused."
            ].filter(Boolean).join("\n"));
        } catch (err) { await failed(i, err); }
    }

    async function manage(i, action) {
        needManager(i);
        const g = giveawayIn(i, i.options.getString("giveaway", true));
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        if (action === "end") {
            const r = await giveaways.end(g.id, { by: i.user.id });
            return i.editReply(`Ended. ${r.winners.length} winner${r.winners.length === 1 ? "" : "s"} drawn.${r.unused ? ` ${r.unused} unused key${r.unused === 1 ? " was" : "s were"} sent to you by DM.` : ""}`);
        }
        if (action === "cancel") {
            const r = await giveaways.cancel(g.id);
            return i.editReply(`Cancelled.${r.unused ? ` ${r.unused} unused key${r.unused === 1 ? " was" : "s were"} sent to you by DM and deleted from the bot.` : ""}`);
        }
        if (action === "reroll") {
            const user = i.options.getUser("winner");
            const r = await giveaways.reroll(g.id, { userId: user?.id ?? null });
            return i.editReply(`Drew ${r.winners.length} new winner${r.winners.length === 1 ? "" : "s"}. They were announced in the channel.`);
        }
        if (action === "info") {
            return i.editReply(infoPayload(g, db.listKeys(g.id), db.countEntries(g.id)));
        }
    }

    async function replace(i) {
        needManager(i);
        const g = giveawayIn(i, i.options.getString("giveaway", true));
        const user = i.options.getUser("winner", true);
        if (!db.keyForWinner(g.id, user.id)) throw new UserError("That person did not win a prize in this giveaway.");
        const nonce = stash({ giveawayId: g.id, winner: user.id, userId: i.user.id, guildId: i.guildId });
        await i.showModal({
            custom_id: `${ID.replaceModal}:${nonce}`, title: "Replacement key",
            components: [{ type: 1, components: [{ type: 4, custom_id: "key", label: "The new key", style: 1, required: true, max_length: 200 }] }]
        });
    }

    async function replaceSubmitted(i) {
        try {
            const d = take(i.customId.split(":")[1], i);
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            const r = await giveaways.replaceKey(d.giveawayId, d.winner, i.fields.getTextInputValue("key"));
            await i.editReply(`Replaced. <@${d.winner}> ${r.told ? "was told by DM" : "was told in the channel"} to press **Claim key** again.`);
        } catch (err) { await failed(i, err); }
    }

    async function list(i) {
        needManager(i);
        const rows = db.listGiveaways(i.guildId, { limit: 15 });
        const lines = rows.map(g => `**#${g.id}** ${g.title}: ${g.status}${g.status === "active" ? `, ends <t:${Math.floor(g.ends_at / 1000)}:R>` : ""}, ${db.countEntries(g.id)} entries`);
        return i.reply({ embeds: [{ color: 0xff9800, title: "Giveaways", description: lines.join("\n") || "None yet. Start one with `/giveaway create`." }], flags: MessageFlags.Ephemeral });
    }

    async function setup(i) {
        if (!i.inGuild()) throw new UserError("Use this command in a server.");
        if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new UserError("You need the Manage Server permission to change giveaway settings.");
        const vouch = i.options.getChannel("vouchchannel");
        const role = i.options.getRole("managerrole");
        const clear = i.options.getBoolean("clear");
        const gwChannel = i.options.getChannel("giveawaychannel");
        if (vouch && ![0, 5].includes(vouch.type)) throw new UserError("The vouches channel must be a text channel.");
        if (gwChannel && ![0, 5].includes(gwChannel.type)) throw new UserError("The giveaway channel must be a text channel.");
        const patch = {};
        if (vouch) patch.vouch_channel_id = vouch.id;
        if (role) patch.manager_role_id = role.id;
        if (gwChannel) patch.giveaway_channel_id = gwChannel.id;
        if (clear) { patch.vouch_channel_id = null; patch.manager_role_id = null; patch.giveaway_channel_id = null; }
        const s = Object.keys(patch).length ? db.setGiveawaySettings(i.guildId, patch) : db.getGiveawaySettings(i.guildId);
        return eph(i, [
            `Vouches channel: ${s.vouch_channel_id ? `<#${s.vouch_channel_id}>` : "a channel named #vouches, if there is one"}`,
            `Giveaway manager role: ${s.manager_role_id ? `<@&${s.manager_role_id}>` : "none (only people with Manage Server)"}`,
            `Giveaway channel (network-wide giveaways from the bot owner): ${s.giveaway_channel_id ? `<#${s.giveaway_channel_id}>` : "the alert channel, if one is set"}`
        ].join("\n"));
    }

    async function handleCommand(i) {
        if (!giveaways) return eph(i, NOT_SET_UP);
        try {
            switch (i.options.getSubcommand()) {
                case "create": return await create(i);
                case "end": return await manage(i, "end");
                case "cancel": return await manage(i, "cancel");
                case "reroll": return await manage(i, "reroll");
                case "info": return await manage(i, "info");
                case "replace": return await replace(i);
                case "list": return await list(i);
                case "setup": return await setup(i);
            }
        } catch (err) { await failed(i, err); }
    }

    // ---------- buttons ----------
    function who(i) {
        const roles = i.member?.roles;
        return {
            userId: i.user.id,
            roleIds: Array.isArray(roles) ? roles : [...(roles?.cache?.keys?.() ?? [])],
            boosting: Boolean(i.member?.premiumSinceTimestamp ?? i.member?.premiumSince), joinedAt: i.member?.joinedTimestamp ?? null, createdAt: i.user.createdTimestamp ?? null
        };
    }

    async function enter(i, id) {
        const r = await giveaways.enter(id, who(i));
        await eph(i, r.status === "left" ? "You left the giveaway." : `You're in!${r.entries > 1 ? ` You have ${r.entries} entries.` : ""} Press the button again to leave. Good luck!`);
        const t = now();
        if (t - (lastRefresh.get(id) ?? 0) > REFRESH_EVERY_MS) { lastRefresh.set(id, t); giveaways.refresh(id).catch(() => {}); }
    }

    async function claim(i, id) {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const c = giveaways.prepareClaim(id, i.user.id);
        let sent = false;
        try { await i.user.send(keyMessage(c.giveaway, c.key.label, c.plain)); sent = true; } catch { /* DMs are closed */ }
        if (sent) {
            await giveaways.delivered(c.key.id, "dm");
            await i.editReply("I sent your prize to your DMs. After you redeem it, I'll ask you to confirm.");
        } else {
            // Hand the key over here, visible only to the winner.
            await i.editReply(keyMessage(c.giveaway, c.key.label, c.plain, { fallback: true }));
            await giveaways.delivered(c.key.id, "channel");
        }
    }

    async function handleButton(i) {
        if (!giveaways) return eph(i, NOT_SET_UP);
        const [kind, rest] = i.customId.split(":");
        try {
            if (kind === ID.enter) return await enter(i, Number(rest));
            if (kind === ID.claim) return await claim(i, Number(rest));
            if (kind === ID.confirm) {
                const r = await giveaways.confirm(Number(rest), i.user.id);
                return await i.update({ content: `✅ Thank you for confirming!${r.vouched ? " It was posted in the vouches channel." : ""}`, embeds: [], components: [] });
            }
            if (kind === ID.problem) {
                const r = await giveaways.reportProblem(Number(rest), i.user.id);
                return await i.update({ content: `Sorry about that. ${r.hostTold ? "The host has been told and will send a new key." : "I couldn't reach the host, so please message them directly."}`, embeds: [], components: [] });
            }
        } catch (err) { await failed(i, err); }
    }

    async function handleModal(i) {
        if (!giveaways) return eph(i, NOT_SET_UP);
        if (i.customId.startsWith(`${ID.keysModal}:`)) return keysSubmitted(i);
        if (i.customId.startsWith(`${ID.replaceModal}:`)) return replaceSubmitted(i);
    }

    async function handleAutocomplete(i) {
        const q = String(i.options.getFocused() ?? "").toLowerCase();
        if (!i.inGuild() || !giveaways || !isManager(i)) return i.respond([]);
        return i.respond(db.listGiveaways(i.guildId, { limit: 25 })
            .filter(g => !q || g.title.toLowerCase().includes(q) || String(g.id) === q.replace("#", ""))
            .map(g => ({ name: `#${g.id} ${g.title} (${g.status})`.slice(0, 100), value: String(g.id) })));
    }

    return { handleCommand, handleButton, handleModal, handleAutocomplete };
}

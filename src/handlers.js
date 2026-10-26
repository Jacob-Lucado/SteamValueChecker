// Discord handlers for the wishlist, alert, channel and data commands.
// Logic lives in db.js, alerts.js, steam.js and wishlist.js; this file only talks to Discord.

import {
    ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags, PermissionFlagsBits
} from "discord.js";
import { ItadError } from "./itad.js";
import { importWishlist, SteamError, MAX_IMPORT } from "./steam.js";
import { parseTrigger, describeTrigger } from "./alerts.js";
import { findItem, suggest, viewRows, exportJson, addGameByTitle, applySteamImport, WishlistError } from "./wishlist.js";
import { wishlistEmbed, WISHLIST_PER_PAGE } from "./render.js";

export class UserError extends Error {}

const PAGE_TIMEOUT_MS = 10 * 60_000;
const COOLDOWNS = { import: 60_000, view: 10_000, add: 3_000 };
const lastRun = new Map();

const eph = (i, content) => i.reply({ content, flags: MessageFlags.Ephemeral });

function cooldown(i, key) {
    const k = `${key}:${i.user.id}`;
    const wait = COOLDOWNS[key] - (Date.now() - (lastRun.get(k) ?? 0));
    if (wait > 0) throw new UserError(`Slow down a little. Try again in ${Math.ceil(wait / 1000)}s.`);
    lastRun.set(k, Date.now());
    return () => lastRun.delete(k);
}

/** Turns known errors into a message for the user and logs anything else without user input. */
async function failed(i, tag, err) {
    const known = err instanceof UserError || err instanceof WishlistError || err instanceof ItadError || err instanceof SteamError;
    if (!(err instanceof UserError || err instanceof WishlistError)) console.error(`[${tag}] ${err.name}: ${err.message}`);
    const content = known ? err.message : "Something went wrong. Try again in a moment.";
    if (i.deferred || i.replied) await i.editReply({ content, embeds: [], components: [] }).catch(() => {});
    else await eph(i, content).catch(() => {});
}

function pageButtons(page, pages) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("wl_prev").setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId("wl_page").setLabel(`${page + 1} / ${pages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId("wl_next").setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1)
    );
}

const deliveryText = u => (u.delivery === "channel" ? "the server alert channel (you are mentioned)" : "direct message");

export function createHandlers({ db, itad }) {
    // ---------- /wishlist ----------
    async function wishlistImport(i, user) {
        const undo = cooldown(i, "import");
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const r = await importWishlist(i.options.getString("profile", true), itad);
            const res = applySteamImport(db, i.user.id, r);
            const pruned = res.pruned;

            const lines = [`Imported **${res.added}** new game${res.added === 1 ? "" : "s"} from your Steam wishlist (${res.existing} already on your list).`];
            if (pruned) lines.push(`Removed ${pruned} game${pruned === 1 ? "" : "s"} that left your Steam wishlist.`);
            if (r.unmatched) lines.push(`${r.unmatched} could not be matched to price data and were skipped.`);
            if (r.truncated) lines.push(`Only the first ${MAX_IMPORT} of ${r.total} games were imported.`);
            if (res.skippedForLimit) lines.push(`Your list is full (200 games), so ${res.skippedForLimit} were skipped.`);
            lines.push("", `Alerts: **any sale**, delivered by **${deliveryText(db.getUser(i.user.id))}**.`);
            lines.push("Use `/wishlist alert` to change when you get alerted, and `/wishlist view` to see prices. Run `/wishlist import` again any time to sync.");
            if (user.delivery === "dm") lines.push("Make sure your DMs from this server are open, or ask an admin to set `/alertchannel`.");
            await i.editReply(lines.join("\n"));
        } catch (err) {
            undo();
            await failed(i, "wishlist import", err);
        }
    }

    async function wishlistAdd(i) {
        cooldown(i, "add");
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const out = await addGameByTitle(
                db, itad, i.user.id, i.options.getString("title", true), i.options.getString("type"), i.options.getNumber("value")
            );
            await i.editReply(`Added **${out.name}**${out.approx ? " (closest match)" : ""}. Alert: ${out.trigger}.`);
        } catch (err) {
            await failed(i, "wishlist add", err);
        }
    }

    async function wishlistRemove(i) {
        const found = findItem(db.listItems(i.user.id), i.options.getString("game", true));
        if (found.ambiguous) return eph(i, `More than one match: ${found.ambiguous.map(t => `**${t}**`).join(", ")}. Be more specific.`);
        if (!found.item) return eph(i, "That game is not on your list.");
        db.removeItem(i.user.id, found.item.itad_id);
        return eph(i, `Removed **${found.item.title}**.`);
    }

    async function wishlistView(i, user) {
        cooldown(i, "view");
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const { rows, currency } = await viewRows(db, itad, user);
            if (!rows.length) throw new UserError("Your wishlist is empty. Use `/wishlist import` or `/wishlist add`.");
            const pages = Math.max(1, Math.ceil(rows.length / WISHLIST_PER_PAGE));
            const view = page => [wishlistEmbed(rows, page, currency)];
            const message = await i.editReply({ embeds: view(0), components: pages > 1 ? [pageButtons(0, pages)] : [] });
            if (pages < 2) return;

            let page = 0;
            const collector = message.createMessageComponentCollector({
                componentType: ComponentType.Button, time: PAGE_TIMEOUT_MS, filter: b => b.user.id === i.user.id
            });
            collector.on("collect", async b => {
                page = b.customId === "wl_next" ? Math.min(page + 1, pages - 1) : Math.max(page - 1, 0);
                await b.update({ embeds: view(page), components: [pageButtons(page, pages)] });
            });
            collector.on("end", () => i.editReply({ components: [] }).catch(() => {}));
        } catch (err) {
            await failed(i, "wishlist view", err);
        }
    }

    async function wishlistAlert(i) {
        let trig;
        try { trig = parseTrigger(i.options.getString("type", true), i.options.getNumber("value")); }
        catch (e) { return eph(i, e.message); }

        const game = i.options.getString("game");
        const label = describeTrigger({ trigger_type: trig.type, trigger_value: trig.value });
        if (game) {
            const found = findItem(db.listItems(i.user.id), game);
            if (found.ambiguous) return eph(i, `More than one match: ${found.ambiguous.map(t => `**${t}**`).join(", ")}. Be more specific.`);
            if (!found.item) return eph(i, "That game is not on your list.");
            db.setTrigger(i.user.id, trig.type, trig.value, found.item.itad_id);
            return eph(i, `**${found.item.title}** will alert you on: ${label}.`);
        }
        const n = db.setTrigger(i.user.id, trig.type, trig.value);
        return eph(i, n ? `All ${n} games will now alert you on: ${label}.` : "Your wishlist is empty.");
    }

    async function handleWishlist(i) {
        const user = db.ensureUser(i.user.id, i.guildId);
        try {
            switch (i.options.getSubcommand()) {
                case "import": return await wishlistImport(i, user);
                case "add": return await wishlistAdd(i);
                case "remove": return await wishlistRemove(i);
                case "view": return await wishlistView(i, user);
                case "alert": return await wishlistAlert(i);
            }
        } catch (err) {
            await failed(i, "wishlist", err);
        }
    }

    // ---------- /alerts ----------
    async function handleAlerts(i) {
        const user = db.ensureUser(i.user.id, i.guildId);
        const sub = i.options.getSubcommand();
        switch (sub) {
            case "status": {
                const guild = db.getGuild(user.guild_id);
                return i.reply({
                    flags: MessageFlags.Ephemeral,
                    embeds: [{
                        color: 0xff9800,
                        title: "Your alert settings",
                        fields: [
                            { name: "Alerts", value: user.paused ? "Paused" : "On", inline: true },
                            { name: "Games watched", value: String(db.countItems(user.discord_id)), inline: true },
                            { name: "Delivery", value: deliveryText(user), inline: true },
                            { name: "Region", value: user.region, inline: true },
                            { name: "Stores", value: user.stores === "major" ? "Major stores" : "All tracked stores", inline: true },
                            { name: "Server alert channel", value: guild ? `<#${guild.channel_id}>` : "Not set (DMs only)", inline: true }
                        ]
                    }]
                });
            }
            case "delivery": {
                const mode = i.options.getString("mode", true);
                if (mode === "channel" && !db.getGuild(user.guild_id)) {
                    return eph(i, "This server has no alert channel yet. Ask a server admin to run `/alertchannel set`, then try again.");
                }
                db.updateUser(user.discord_id, { delivery: mode });
                return eph(i, mode === "channel"
                    ? "Done. Alerts will be posted in the server alert channel and you will be mentioned. Everyone who can see that channel can see the game."
                    : "Done. Alerts will come by DM. If a DM cannot be delivered, the server alert channel is used as a fallback.");
            }
            case "pause":
                db.updateUser(user.discord_id, { paused: 1 });
                return eph(i, "Alerts paused. Your wishlist is kept. Use `/alerts resume` to turn them back on.");
            case "resume":
                db.updateUser(user.discord_id, { paused: 0 });
                return eph(i, "Alerts are on again.");
            case "region":
                db.updateUser(user.discord_id, { region: i.options.getString("region", true) });
                return eph(i, "Region updated. Alerts compare prices in that region from now on.");
            case "stores":
                db.updateUser(user.discord_id, { stores: i.options.getString("stores", true) });
                return eph(i, "Store setting updated.");
        }
    }

    // ---------- /alertchannel ----------
    async function handleAlertChannel(i) {
        if (!i.inGuild()) return eph(i, "Use this command in a server.");
        if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return eph(i, "You need the Manage Server permission to use this.");

        switch (i.options.getSubcommand()) {
            case "set": {
                const channel = i.options.getChannel("channel", true);
                const me = await i.guild.members.fetchMe();
                const perms = channel.permissionsFor(me);
                const need = [
                    [PermissionFlagsBits.ViewChannel, "View Channel"],
                    [PermissionFlagsBits.SendMessages, "Send Messages"],
                    [PermissionFlagsBits.EmbedLinks, "Embed Links"]
                ].filter(([flag]) => !perms?.has(flag)).map(([, name]) => name);
                if (need.length) return eph(i, `I cannot post in <#${channel.id}> yet. Give me: ${need.join(", ")}.`);

                db.setGuildChannel(i.guildId, channel.id, i.user.id);
                return eph(i, [
                    `Alert channel set to <#${channel.id}>.`,
                    "Members get alerts by DM first. This channel is used when a DM cannot be delivered, or when a member chooses channel delivery. The member is mentioned and the game name is visible to everyone who can see the channel.",
                    "Tip: pick a channel members are comfortable seeing their wishlist in."
                ].join("\n"));
            }
            case "clear":
                return eph(i, db.clearGuildChannel(i.guildId) ? "Alert channel removed. Alerts will be DMs only." : "No alert channel was set.");
            case "show": {
                const g = db.getGuild(i.guildId);
                return eph(i, g ? `Alert channel: <#${g.channel_id}>` : "No alert channel is set. Use `/alertchannel set`.");
            }
        }
    }

    // ---------- /mydata ----------
    async function handleMyData(i) {
        if (i.options.getSubcommand() === "export") {
            const json = exportJson(db, i.user.id);
            if (!json) return eph(i, "Nothing is stored about you.");
            return i.reply({
                content: "Everything stored about you:",
                files: [new AttachmentBuilder(Buffer.from(json, "utf8"), { name: "my-steam-value-checker-data.json" })],
                flags: MessageFlags.Ephemeral
            });
        }

        if (!db.getUser(i.user.id)) return eph(i, "Nothing is stored about you.");
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("md_confirm").setLabel("Delete everything").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("md_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
        );
        const message = await i.reply({
            content: "This deletes your wishlist, alert settings and Steam profile ID from the bot. It cannot be undone.",
            components: [row],
            flags: MessageFlags.Ephemeral,
            fetchReply: true
        });
        try {
            const b = await message.awaitMessageComponent({
                componentType: ComponentType.Button, time: 60_000, filter: x => x.user.id === i.user.id
            });
            if (b.customId === "md_confirm") {
                db.deleteUser(i.user.id);
                await b.update({ content: "Deleted. The bot no longer stores anything about you.", components: [] });
            } else {
                await b.update({ content: "Cancelled. Nothing was deleted.", components: [] });
            }
        } catch {
            await i.editReply({ content: "Timed out. Nothing was deleted.", components: [] }).catch(() => {});
        }
    }

    // ---------- autocomplete ----------
    async function handleAutocomplete(i) {
        const focused = i.options.getFocused(true);
        if (focused.name !== "game") return i.respond([]);
        return i.respond(suggest(db.listItems(i.user.id), focused.value));
    }

    return { handleWishlist, handleAlerts, handleAlertChannel, handleMyData, handleAutocomplete };
}

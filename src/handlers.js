// Discord handlers for the wishlist, alert, channel and data commands.
// Logic lives in db.js, alerts.js, steam.js and wishlist.js; this file only talks to Discord.

import {
    ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags, PermissionFlagsBits
} from "discord.js";
import { setProfile } from "./profile.js";
import { salesEmbed, upcomingSales, salesBefore } from "./salescal.js";
import { freeMenu, shopSlug } from "./freemenu.js";
import { ItadError } from "./itad.js";
import { importWishlist, SteamError, MAX_IMPORT } from "./steam.js";
import { gameNight, gameNightEmbed, gameNightButtons, pickGame } from "./gamenight.js";
import { SNOOZE_ID, BELOW_ID, BELOW_MODAL_ID } from "./render.js";
import { LATEST, changelogEmbed } from "./changelog.js";
import { parseTrigger, describeTrigger } from "./alerts.js";
import { findItem, suggest, viewRows, exportJson, addGameByTitle, applySteamImport, WishlistError } from "./wishlist.js";
import { money, wishlistEmbed, WISHLIST_PER_PAGE, checkEmbed, libraryEmbed, serverListEmbed, leaderboardEmbed, boardEmbed, bundlesEmbed, leagueEmbed, badgesEmbed, alertHistoryEmbed, backlogEmbed, trendEmbed, challengeEmbed, spendEmbed, compareEmbed, serverStatsEmbed, statusEmbed } from "./render.js";
import { summarize } from "./report.js";
import { current, dealVerdict } from "./alerts.js";
import { prefsPatch, describeQuiet, describeDigest } from "./prefs.js";
import { compareLibraries } from "./compare.js";
import { challengeView, monthKey, MAX_GOAL } from "./challenge.js";
import { buyOrWait } from "./advice.js";
import { daysUntilBirthday } from "./friendstore.js";
import { friendDeals, friendRows, saveFriend, birthdayEmbed } from "./friends.js";
import { spendSummary, regionCurrency } from "./spend.js";
import { trophyCase } from "./badges.js";
import { addBundle, bundleView } from "./bundles.js";
import { importLibrary, libraryView, leaderboard, finishedLeague, extraBoard, EXTRA_BOARDS, LibraryError, playNext, serverStats, trendSummary } from "./library.js";
import { addToServerList, serverListView, vote, removeFromServerList } from "./serverlist.js";
import { readUpload } from "./upload.js";
import { sanitize } from "./parse.js";

import { UserError } from "./errors.js";
export { UserError };

const PAGE_TIMEOUT_MS = 10 * 60_000;
const COOLDOWNS = { import: 60_000, view: 10_000, add: 3_000, lib: 10_000 };
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
    const known = err instanceof UserError || err instanceof WishlistError || err instanceof LibraryError || err instanceof ItadError || err instanceof SteamError;
    if (!(err instanceof UserError || err instanceof WishlistError || err instanceof LibraryError)) console.error(`[${tag}] ${err.name}: ${err.message}`);
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

export function createHandlers({ db, itad, publicUrl = null, getStatus = () => null, getAbout = () => null }) {
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
            if (r.rateLimited) lines.push("IsThereAnyDeal asked the bot to slow down, so only part of the wishlist was added. Run the import again in a minute to add the rest.");
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

    async function wishlistCleanup(i) {
        const owned = db.ownedWishlist(i.user.id);
        if (!owned.length) return eph(i, "Nothing to clean up. None of your wishlist games are in your library.");
        db.removeOwnedWishlist(i.user.id);
        return eph(i, `Removed **${owned.length}** game${owned.length === 1 ? "" : "s"} you already own from your wishlist: ${owned.slice(0, 15).map(x => x.title).join(", ")}${owned.length > 15 ? ", and more" : ""}.`);
    }

    async function wishlistPriority(i) {
        const found = findItem(db.listItems(i.user.id), i.options.getString("game", true));
        if (found.ambiguous) return eph(i, `More than one match: ${found.ambiguous.map(t => `**${t}**`).join(", ")}. Be more specific.`);
        if (!found.item) return eph(i, "That game is not on your list.");
        const on = i.options.getBoolean("starred") !== false;
        db.setPriority(i.user.id, found.item.itad_id, on);
        return eph(i, on ? `⭐ **${found.item.title}** is a priority: it is listed first and its alerts come through even in quiet hours.` : `**${found.item.title}** is no longer a priority.`);
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

    async function wishlistCheck(i, user) {
        cooldown(i, "view");
        const found = findItem(db.listItems(i.user.id), i.options.getString("game", true));
        if (found.ambiguous) return eph(i, `More than one match: ${found.ambiguous.map(t => `**${t}**`).join(", ")}. Be more specific.`);
        if (!found.item) return eph(i, "That game is not on your list.");
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const prices = await itad.getPrices([found.item.itad_id], user.region);
            const s = summarize(prices.get(found.item.itad_id), { majorOnly: user.stores === "major" });
            const now = { ...current(s), currency: s.currency };
            if (now.price === null) throw new UserError("No current price found for that game.");
            let advice = null;
            try { advice = buyOrWait(await itad.getHistory(found.item.itad_id, user.region), now.price, { sales: upcomingSales(Date.now()), past: salesBefore(), money: n => money(n, now.currency) }); } catch { /* the check works without it */ }
            await i.editReply({ embeds: [checkEmbed(found.item.title, now, dealVerdict(now), advice)] });
        } catch (err) {
            await failed(i, "wishlist check", err);
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

    /** Snooze and "only below" buttons under a sale alert. The item must belong to the person pressing. */
    async function handleAlertButton(i) {
        const [kind, rest] = i.customId.split(":");
        const item = db.getItemById(Number(rest));
        try {
            if (!item || item.discord_id !== i.user.id) return await eph(i, "That game is no longer on your wishlist, or this alert is not yours.");
            if (kind === SNOOZE_ID) {
                db.snoozeItem(item.id, Date.now() + 7 * 86400_000);
                return await eph(i, `Okay. I will not alert you about **${item.title}** for 7 days.`);
            }
            if (kind === BELOW_ID) {
                return await i.showModal({ custom_id: `${BELOW_MODAL_ID}:${item.id}`, title: "Only alert below a price", components: [
                    { type: 1, components: [{ type: 4, custom_id: "price", label: "Alert me at this price or less", style: 1, required: true, max_length: 10, placeholder: "e.g. 9.99" }] }] });
            }
            if (kind === BELOW_MODAL_ID) {
                const value = Number(String(i.fields.getTextInputValue("price")).replace(",", "."));
                const trig = parseTrigger("price", value);
                db.setTrigger(i.user.id, trig.type, trig.value, item.itad_id);
                return await eph(i, `**${item.title}** will alert you only at ${value.toFixed(2)} or less.`);
            }
        } catch (e) { return eph(i, e.message); }
    }

    /** Ids of the people in a voice channel right now (bots left out). Needs the GuildVoiceStates intent. */
    const inVoice = (guild, channelId) => [...guild.voiceStates.cache.values()].filter(v => v.channelId === channelId && !v.member?.user?.bot).map(v => v.id);

    async function handleGameNight(i) {
        if (!i.inGuild()) return eph(i, "Use this in a server, from a voice channel.");
        const channel = i.options.getChannel("channel");
        const channelId = channel?.id ?? i.member?.voice?.channelId;
        if (!channelId) return eph(i, "Join a voice channel first, or choose one with the `channel` option.");
        await i.deferReply({ flags: i.options.getBoolean("post") ? undefined : MessageFlags.Ephemeral });
        try {
            const user = db.ensureUser(i.user.id, i.guildId);
            const r = await gameNight({ db, itad, userIds: inVoice(i.guild, channelId), region: user.region });
            await i.editReply({ embeds: [gameNightEmbed(r)], components: gameNightButtons(channelId) });
        } catch (err) {
            await i.editReply({ content: err instanceof UserError ? err.message : "I could not work that out. Try again in a moment." });
            if (!(err instanceof UserError)) console.error(`[gamenight] ${err.name}: ${err.message}`);
        }
    }

    async function handleGameNightButton(i) {
        const channelId = i.customId.split(":")[1];
        try {
            const user = db.ensureUser(i.user.id, i.guildId);
            const r = await gameNight({ db, itad, userIds: inVoice(i.guild, channelId), region: user.region });
            const g = pickGame(r);
            return await i.reply({ content: g ? `🎲 Tonight: **${g.title}**${g.missing ? ` (missing: ${g.missing.map(m => `<@${m}>`).join(", ")})` : ""}` : "There is nothing everyone owns yet. See the buy list.", allowedMentions: { parse: [] } });
        } catch (err) { return eph(i, err instanceof UserError ? err.message : "I could not pick one. Try again."); }
    }

    async function handleChangelog(i) {
        db.ensureUser(i.user.id, i.guildId);
        db.updateUser(i.user.id, { seen_version: LATEST });
        return i.reply({ embeds: [changelogEmbed()], flags: MessageFlags.Ephemeral });
    }

    async function handleWishlist(i) {
        const user = db.ensureUser(i.user.id, i.guildId);
        try {
            switch (i.options.getSubcommand()) {
                case "import": return await wishlistImport(i, user);
                case "add": return await wishlistAdd(i);
                case "remove": return await wishlistRemove(i);
                case "cleanup": return await wishlistCleanup(i);
                case "priority": return await wishlistPriority(i);
                case "view": return await wishlistView(i, user);
                case "alert": return await wishlistAlert(i);
                case "check": return await wishlistCheck(i, user);
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
                            { name: "Server alert channel", value: guild ? `<#${guild.channel_id}>` : "Not set (DMs only)", inline: true },
                            { name: "Quiet hours", value: describeQuiet(user), inline: true },
                            { name: "Weekly digest", value: describeDigest(user), inline: true },
                            { name: "Bundle and giveaway alerts", value: user.bundles === 0 ? "Off" : "On", inline: true },
                            { name: "Free game alerts", value: user.free ? "On" : "Off", inline: true },
                            { name: "Server group alerts and leaderboard", value: user.share ? "Opted in" : "Not shared", inline: true }
                        ]
                    }]
                });
            }
            case "delivery": {
                const mode = i.options.getString("mode", true);
                if (mode === "channel" && !db.getGuild(user.guild_id)) {
                    return eph(i, i.inGuild() || user.guild_id
                        ? "This server has no alert channel yet. Ask a server admin to run `/alertchannel set`, then try again."
                        : "Channel delivery needs a server where the bot is installed and has an alert channel. Run this in that server, or keep alerts by DM.");
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
            case "quiethours": {
                try {
                    const off = i.options.getBoolean("off");
                    const input = off ? { quiet_start: null, quiet_end: null } : {
                        quiet_start: i.options.getString("start") ?? undefined,
                        quiet_end: i.options.getString("end") ?? undefined,
                        tz: i.options.getString("timezone") ?? undefined
                    };
                    for (const k of Object.keys(input)) if (input[k] === undefined) delete input[k];
                    if (!Object.keys(input).length) return eph(i, `Quiet hours: ${describeQuiet(user)}. Set them with \`start\`, \`end\` and \`timezone\`, or use \`off\`.`);
                    db.updateUser(user.discord_id, prefsPatch(input, user));
                    const u = db.getUser(user.discord_id);
                    return eph(i, u.quiet_start === null ? "Quiet hours are off." : `Quiet hours: ${describeQuiet(u)}. Alerts that come in then are held and sent afterwards.`);
                } catch (err) { return failed(i, "alerts quiethours", err); }
            }
            case "digest": {
                try {
                    const input = { digest: i.options.getBoolean("enabled", true) };
                    const day = i.options.getInteger("day");
                    if (day !== null) input.digest_day = day;
                    db.updateUser(user.discord_id, prefsPatch(input, user));
                    const u = db.getUser(user.discord_id);
                    return eph(i, u.digest ? `Weekly digest on. You will get it ${describeDigest(u).replace("Weekly, ", "")} from 9:00 in your time zone (${u.tz}). Set your time zone with \`/alerts quiethours\`.` : "Weekly digest off.");
                } catch (err) { return failed(i, "alerts digest", err); }
            }
            case "bundles": {
                const on = i.options.getBoolean("enabled", true);
                db.updateUser(user.discord_id, { bundles: on ? 1 : 0 });
                return eph(i, on ? "You will be told when a wishlist game is in a bundle or being given away." : "Bundle and giveaway alerts are off.");
            }
            case "freegames": {
                const on = i.options.getBoolean("enabled", true);
                const dlc = i.options.getBoolean("dlc");
                db.updateUser(user.discord_id, { free: on ? 1 : 0, ...(dlc === null ? {} : { free_dlc: dlc ? 1 : 0 }) });
                const dlcNote = dlc === null ? "" : dlc ? " Free DLC is included." : " Free DLC is hidden.";
                return eph(i, (on ? "You will be told when a game is free to claim. Several free games from one store come in one message with a Claim all button." : "Free game alerts are off.") + dlcNote);
            }
            case "mute": {
                const type = i.options.getString("type", true), on = i.options.getBoolean("muted", true);
                const list = new Set(String(user.muted ?? "").split(",").filter(Boolean));
                on ? list.add(type) : list.delete(type);
                db.updateUser(user.discord_id, { muted: [...list].join(",") });
                return eph(i, on ? "Muted. Those alerts will not be sent to you, but you can still read them on the dashboard's Notifications page." : "Unmuted. You will get those alerts again.");
            }
            case "language": {
                const lang = i.options.getString("language", true);
                db.updateUser(user.discord_id, { lang });
                return eph(i, lang === "es" ? "Listo. Los botones y mensajes clave ahora están en español." : lang === "fr" ? "C'est fait. Les boutons et messages clés sont maintenant en français." : "Done. Buttons and messages are in English.");
            }
            case "mindiscount": {
                const pct = i.options.getInteger("percent", true);
                try { db.updateUser(user.discord_id, prefsPatch({ min_discount: pct }, user)); } catch (err) { return failed(i, "alerts mindiscount", err); }
                return eph(i, pct ? `Sale alerts now need at least **${pct}%** off. Games you starred still alert at any discount.` : "Sale alerts now fire for any discount that meets each game's own trigger.");
            }
            case "share": {
                const on = i.options.getBoolean("enabled", true);
                db.updateUser(user.discord_id, { share: on ? 1 : 0 });
                return eph(i, on
                    ? "You are in. Your server may now see your name in group alerts (\"N members are watching…\") and on `/leaderboard`. Only your name, the number of games and your percent saved are shown. Turn this off any time."
                    : "You are out of group alerts and the leaderboard.");
            }
            case "history": {
                return i.reply({ embeds: [alertHistoryEmbed(db.listAlerts(user.discord_id, 15))], flags: MessageFlags.Ephemeral });
            }
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
            case "feed": {
                if (!db.getGuild(i.guildId)) return eph(i, "Set an alert channel first with `/alertchannel set`.");
                const on = i.options.getBoolean("enabled", true);
                db.setFreeFeed(i.guildId, on);
                return eph(i, on ? "Free game feed on. New free games (not DLC) are posted in the alert channel, once each." : "Free game feed off.");
            }
            case "hot": {
                if (!db.getGuild(i.guildId)) return eph(i, "Set an alert channel first with `/alertchannel set`.");
                const n = i.options.getInteger("minimum", true);
                if (n !== 0 && n < 30) return eph(i, "Pick 30 or more, or 0 to turn it off. Below 30 would post nearly every sale.");
                db.setHotMin(i.guildId, n);
                return eph(i, n ? `Hot deals on. Steam discounts of ${n}% or more are posted in the alert channel, each deal once.` : "Hot deals off.");
            }
            case "sales": {
                if (!db.getGuild(i.guildId)) return eph(i, "Set an alert channel first with `/alertchannel set`.");
                const on = i.options.getBoolean("enabled", true);
                db.setSaleFeed(i.guildId, on);
                return eph(i, on ? "Sale posts on. The alert channel gets one post when a Steam sale or festival starts (including one that is already running)." : "Sale posts off.");
            }
            case "digest": {
                if (!db.getGuild(i.guildId)) return eph(i, "Set an alert channel first with `/alertchannel set`.");
                const on = i.options.getBoolean("enabled", true);
                db.setWeeklyDigest(i.guildId, on);
                return eph(i, on ? "Weekly digest on. Fridays the alert channel gets cheap games that opted-in members watch (never who), free games and the week's server events." : "Weekly digest off.");
            }
            case "group": {
                if (!db.getGuild(i.guildId)) return eph(i, "Set an alert channel first with `/alertchannel set`.");
                const n = i.options.getInteger("minimum", true);
                if (n === 1) return eph(i, "Use 2 or more, or 0 to turn it off.");
                db.setGroupMin(i.guildId, n);
                return eph(i, n ? `Group alerts on. When ${n} or more members who opted in (\`/alerts share\`) have a game on their wishlist and it hits their alert, the channel gets one post.` : "Group alerts are off.");
            }
            case "show": {
                const g = db.getGuild(i.guildId);
                return eph(i, g ? `Alert channel: <#${g.channel_id}>` : "No alert channel is set. Use `/alertchannel set`.");
            }
        }
    }

    // ---------- /library ----------
    async function handleLibrary(i) {
        const user = db.ensureUser(i.user.id, i.guildId);
        const sub = i.options.getSubcommand();
        try {
            if (sub === "remove") {
                const found = findItem(db.listLibrary(i.user.id), i.options.getString("game", true));
                if (found.ambiguous) return eph(i, `More than one match: ${found.ambiguous.map(t => `**${t}**`).join(", ")}. Be more specific.`);
                if (!found.item) return eph(i, "That game is not in your library.");
                db.removeLibrary(i.user.id, found.item.itad_id);
                return eph(i, `Removed **${found.item.title}** from your library.`);
            }
            if (sub === "status") {
                const found = findItem(db.listLibrary(i.user.id), i.options.getString("game", true));
                if (found.ambiguous) return eph(i, `More than one match: ${found.ambiguous.map(t => `**${t}**`).join(", ")}. Be more specific.`);
                if (!found.item) return eph(i, "That game is not in your library.");
                const state = i.options.getString("state", true);
                db.setLibraryStatus(i.user.id, found.item.itad_id, state);
                return eph(i, `**${found.item.title}** is now marked as ${state}.`);
            }
            if (sub === "grabber") {
                if (i.options.getString("action") === "off") {
                    return eph(i, db.revokeGrabberToken(i.user.id) ? "The FanaticalGrabber link is off. The old code no longer works." : "You do not have a FanaticalGrabber link.");
                }
                cooldown(i, "lib");
                const token = db.createGrabberToken(i.user.id);
                return eph(i, [
                    "Your FanaticalGrabber link code (shown once, keep it private; anyone with it can add games to your library):",
                    `\`${token}\``,
                    "Open the Grabber panel on Fanatical, choose **Send to Steam Value Checker**, and paste it when asked.",
                    "To fill in **what you paid** for your Steam games, open your Steam purchase history (store.steampowered.com/account/history) and press **Send what I paid**. For games you activated with keys, use the licenses page (store.steampowered.com/account/licenses) to record their retail price.",
                    "Making a new code replaces this one. `/library grabber action:Turn the link off` removes it."
                ].join("\n"));
            }
            if (sub === "bundle") {
                cooldown(i, "lib");
                await i.deferReply({ flags: MessageFlags.Ephemeral });
                const r = await addBundle(db, itad, i.user.id, { name: i.options.getString("name", true), paid: i.options.getNumber("paid", true), titles: i.options.getString("titles", true) });
                return void await i.editReply(`Saved bundle **#${r.id}** with ${r.matched} games${r.newGames ? ` (${r.newGames} new in your library, paid split evenly)` : ""}.${r.notFound.length ? ` Not found: ${r.notFound.slice(0, 5).join(", ")}.` : ""} See it with \`/library bundles\`.`);
            }
            if (sub === "bundles") {
                const rm = i.options.getInteger("remove");
                if (rm !== null) return eph(i, db.removeBundle(i.user.id, rm) ? `Removed bundle #${rm}. The games stay in your library.` : "I could not find that bundle number.");
                await i.deferReply({ flags: MessageFlags.Ephemeral });
                return void await i.editReply({ embeds: [bundlesEmbed(await bundleView(db, itad, user))] });
            }
            if (sub === "badges") return void await i.reply({ embeds: [badgesEmbed(trophyCase(db, i.user.id))], flags: MessageFlags.Ephemeral });
            if (sub === "spend") {
                return void await i.reply({ embeds: [spendEmbed(spendSummary(db.listLibrary(i.user.id), { currency: regionCurrency(user.region) }))], flags: MessageFlags.Ephemeral });
            }
            if (sub === "challenge") {
                const goal = i.options.getInteger("goal");
                if (goal !== null) db.setChallenge(i.user.id, monthKey(Date.now()), Math.min(MAX_GOAL, Math.max(0, goal)));
                return void await i.reply({ embeds: [challengeEmbed(challengeView(db, i.user.id))], flags: MessageFlags.Ephemeral });
            }
            cooldown(i, "lib");
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            if (sub === "backlog") {
                const view = await libraryView(db, itad, user, { snapshot: false });
                if (!view.rows.length) throw new UserError("Your library is empty. Use `/library add` or `/library import`.");
                return void await i.editReply({ embeds: [backlogEmbed(view, playNext(view.rows))] });
            }
            if (sub === "trend") {
                const view = await libraryView(db, itad, user);
                if (!view.rows.length) throw new UserError("Your library is empty. Use `/library add` or `/library import`.");
                const tr = trendSummary(view.snapshots);
                if (!tr) throw new UserError("A trend needs at least two days of data. I take a snapshot every day, so check back tomorrow.");
                return void await i.editReply({ embeds: [trendEmbed(tr, view.currency, view.totals.backlogGames)] });
            }
            if (sub === "add") {
                const paid = i.options.getNumber("paid");
                const r = await importLibrary(db, itad, i.user.id, [{ title: i.options.getString("title", true), paid }]);
                if (r.notFound.length) throw new UserError(`I could not find a game called ${r.notFound[0]}.`);
                if (r.skippedForLimit) throw new UserError("Your library is full (1,500 games).");
                return void await i.editReply(r.updated ? "Updated that game in your library." : "Added to your library.");
            }
            if (sub === "import") {
                const entries = sanitize(await readUpload(i.options.getAttachment("file", true)), { max: 500 }).entries;
                const r = await importLibrary(db, itad, i.user.id, entries);
                const lines = [`Added **${r.added}**, updated **${r.updated}**.`];
                if (r.notFound.length) lines.push(`${r.notFound.length} could not be matched and were skipped.`);
                if (r.skippedForLimit) lines.push(`Your library is full (1,500 games), so ${r.skippedForLimit} were skipped.`);
                if (entries.some(e => e.paid === null)) lines.push("Games without a Paid column are counted in value but not in savings.");
                return void await i.editReply(lines.join("\n"));
            }
            const view = await libraryView(db, itad, user);
            if (!view.rows.length) throw new UserError("Your library is empty. Use `/library add` or `/library import`.");
            return void await i.editReply({ embeds: [libraryEmbed(view, view.currency)] });
        } catch (err) {
            await failed(i, "library", err);
        }
    }

    // ---------- /serverlist and /leaderboard ----------
    const canManage = i => Boolean(i.memberPermissions?.has(PermissionFlagsBits.ManageGuild));

    /**
     * The server a server command is about. In a server it is that server. In a DM it is the server the person last used the bot in,
     * and only if they are still a member (so nobody reads another server's list by leaving it).
     */
    async function homeGuild(i) {
        if (i.guildId) return i.guildId;
        const gid = db.getUser(i.user.id)?.guild_id;
        if (!gid) throw new UserError("Use this once in a server first, so I know which server you mean.");
        try { const g = await i.client.guilds.fetch(gid); await g.members.fetch(i.user.id); }
        catch { throw new UserError("I can't see you in your server any more. Use the command in the server itself."); }
        return gid;
    }

    async function handleServerList(i) {
        const user = db.ensureUser(i.user.id, i.guildId);
        const sub = i.options.getSubcommand();
        try {
            const gid = await homeGuild(i);
            if (sub === "vote") {
                const r = vote(db, gid, i.user.id, i.options.getString("game", true));
                return void await eph(i, r.voted ? `Voted for **${r.title}** (${r.votes} now).` : `Took back your vote on **${r.title}** (${r.votes} now).`);
            }
            if (sub === "remove") {
                const r = removeFromServerList(db, gid, i.user.id, i.options.getString("game", true), canManage(i));
                return void await eph(i, `Removed **${r.title}** from the server list.`);
            }
            cooldown(i, "view");
            // Visible to the channel: the list is shared on purpose.
            await i.deferReply();
            if (sub === "add") {
                const r = await addToServerList(db, itad, gid, i.user.id, i.options.getString("title", true));
                return void await i.editReply({ content: `<@${i.user.id}> added **${r.name}** to the server wishlist.`, allowedMentions: { parse: [] } });
            }
            const view = await serverListView(db, itad, gid, user);
            return void await i.editReply({ embeds: [serverListEmbed(view.rows, view.currency)] });
        } catch (err) {
            await failed(i, "serverlist", err);
        }
    }

    async function handleLeaderboard(i) {
        try {
            const board = i.options.getString("board"), guild = await homeGuild(i);
            const embed = board === "finished" ? leagueEmbed(finishedLeague(db, guild))
                : EXTRA_BOARDS[board] ? boardEmbed(EXTRA_BOARDS[board], extraBoard(db, guild, board), board === "hours" ? "Only members who opted in. Counts hours tracked since they linked Steam." : "Only members who opted in.")
                : leaderboardEmbed(leaderboard(db, guild));
            await i.reply({ embeds: [embed], allowedMentions: { parse: [] } });
        }
        catch (err) { await eph(i, err instanceof UserError ? err.message : "Something went wrong. Try again in a moment."); }
    }

    // ---------- /freegames ----------
    const MAX_FREE_PLATFORMS = 6;
    async function handleFreeGames(i) {
        const store = (i.options.getString("store") ?? "").trim().toLowerCase();
        const share = i.options.getBoolean("public") === true;
        await i.deferReply(share ? {} : { flags: MessageFlags.Ephemeral });
        try {
            const list = await itad.getGiveawayList();
            const showDlc = db.getUser(i.user.id)?.free_dlc !== 0;
            const shops = [...new Set(list.map(g => g.shop))];
            const wanted = store ? shops.find(s => String(s).toLowerCase().includes(store)) : null;
            if (store && !wanted) return await i.editReply({ content: `No free games found on a store matching "${store.slice(0, 40)}" right now.` });
            await i.editReply(freeMenu(list, { cat: "games", store: wanted ? shopSlug(wanted) : "all", page: 0, showDlc }));
        } catch (err) { await failed(i, "freegames", err); }
    }

    /** Buttons and the store menu on the /freegames message. The whole state lives in the custom id, so it survives restarts. */
    async function handleFreeMenu(i) {
        try {
            let cat, store, page;
            if (i.isStringSelectMenu()) { [, cat] = i.customId.split(":"); store = i.values[0] ?? "all"; page = 0; }
            else { [, cat, store, page] = i.customId.split(":"); page = Number(page) || 0; }
            const showDlc = db.getUser(i.user.id)?.free_dlc !== 0;
            const payload = freeMenu(await itad.getGiveawayList(), { cat, store, page, showDlc });
            const owner = i.message?.interactionMetadata?.user?.id ?? i.message?.interaction?.user?.id;
            if (owner && owner !== i.user.id) return await i.reply({ ...payload, flags: MessageFlags.Ephemeral }); // somebody else's public menu: give them their own
            await i.update(payload);
        } catch (err) { await failed(i, "freegames", err); }
    }

    // ---------- /status ----------
    async function handleStatus(i) {
        const st = getStatus();
        if (!st) return eph(i, "Status is not available right now.");
        return i.reply({ embeds: [statusEmbed(st.snapshot(), getAbout(), publicUrl)], flags: MessageFlags.Ephemeral });
    }

    // ---------- /serverstats ----------
    async function handleServerStats(i) {
        try {
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            await i.editReply({ embeds: [serverStatsEmbed(serverStats(db, await homeGuild(i)))] });
        } catch (err) { await failed(i, "serverstats", err); }
    }

    // ---------- /friend ----------
    async function handleFriend(i) {
        const sub = i.options.getSubcommand();
        db.ensureUser(i.user.id, i.guildId);
        try {
            if (sub === "add") {
                const r = saveFriend(db, i.user.id, { name: i.options.getString("name", true), birthday: i.options.getString("birthday"), page: i.options.getString("page") });
                return eph(i, `${r.updated ? "Updated" : "Added"} **${r.name}**. I will remind you a week before their birthday${i.options.getString("birthday") ? "" : " once you add it (`birthday:03-27`)"}.`);
            }
            if (sub === "remove") return eph(i, db.removeFriend(i.user.id, i.options.getString("name", true)) ? "Removed." : "No friend by that name.");
            if (sub === "list") {
                const rows = friendRows(db, i.user.id);
                if (!rows.length) return eph(i, "No friends yet. Add one with `/friend add`.");
                return i.reply({ flags: MessageFlags.Ephemeral, embeds: [{ color: 0xe91e63, title: "Your friends", description: rows.map(f => `• **${f.name}**${f.birthday ? ` 🎂 ${f.birthday}${f.daysToBirthday <= 30 ? ` (in ${f.daysToBirthday} day${f.daysToBirthday === 1 ? "" : "s"})` : ""}` : ""}${f.slug ? " · has a public page" : ""}`).join("\n") }] });
            }
            const f = db.getFriend(i.user.id, i.options.getString("name", true));
            if (!f) return eph(i, "No friend by that name. See `/friend list`.");
            if (!f.slug) return eph(i, `Add **${f.name}**'s public page first: \`/friend add name:${f.name} page:their-page-name\`.`);
            cooldown(i, "view");
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            const deals = await friendDeals(db, itad, f.slug, 8);
            if (!deals) return void await i.editReply({ content: `${f.name}'s page \`${f.slug}\` is not public, or does not exist.` });
            return void await i.editReply({ embeds: [{ ...birthdayEmbed(f, f.birthday ? daysUntilBirthday(f.birthday, Date.now()) : 0, deals), title: `🎁 On sale for ${f.name}`, description: deals.length ? deals.map(d => `• **${d.title}** ${money(d.price, d.currency ?? "USD")}${d.discount > 0 ? ` (-${d.discount}%)` : ""} at ${d.shop}`).join("\n") : "Nothing on their public wishlist is on sale right now.", footer: { text: "Games someone already said they will gift are left out." } }] });
        } catch (err) { await failed(i, "friend", err); }
    }

    // ---------- /publicpage ----------
    async function handlePublicPage(i) {
        try {
            db.ensureUser(i.user.id, i.guildId);
            const r = setProfile(db, i.user.id, { enabled: i.options.getBoolean("enabled", true), slug: i.options.getString("name") });
            const cleared = i.options.getBoolean("reset_claims") ? db.clearGiftClaims(i.user.id) : 0;
            if (!r.public) return eph(i, "Your public page is off. Nobody can open it." + (cleared ? ` Cleared ${cleared} gift claim${cleared === 1 ? "" : "s"}.` : ""));
            const link = publicUrl ? `${publicUrl}/#/u/${r.slug}` : null;
            const n = db.countGiftClaims(i.user.id);
            return eph(i, `Your page is on${link ? `: ${link}` : `, as **${r.slug}**`}\nIt shows only game names, art and today's best prices. Never your Discord account.\n` +
                `Visitors can mark a game as "I'm gifting this" so nobody doubles up. You are not told who, or which games` + (n ? `, only that **${n}** ${n === 1 ? "is" : "are"} claimed right now.` : ".") +
                (cleared ? ` Cleared ${cleared} just now.` : n ? " Add `reset_claims: true` to clear them." : ""));
        } catch (err) { await failed(i, "publicpage", err); }
    }

    // ---------- /sales and /watch ----------
    async function handleSales(i) {
        return i.reply({ embeds: [salesEmbed(upcomingSales(Date.now()), { watching: db.countItems(i.user.id) || null })], flags: MessageFlags.Ephemeral });
    }

    async function handleWatch(i) {
        cooldown(i, "add");
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            db.ensureUser(i.user.id, i.guildId);
            const out = await addGameByTitle(db, itad, i.user.id, i.options.getString("title", true), i.options.getString("type"), i.options.getNumber("value"), { source: "watch" });
            await i.editReply(`Watching **${out.name}**${out.approx ? " (closest match)" : ""}. Alert: ${out.trigger}. It is removed from your list once the alert is sent, or after 30 days.`);
        } catch (err) { await failed(i, "watch", err); }
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

        if (!db.getUser(i.user.id) && !db.hasGiveawayData(i.user.id)) return eph(i, "Nothing is stored about you.");
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("md_confirm").setLabel("Delete everything").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("md_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
        );
        const message = await i.reply({
            content: "This deletes your wishlist, library, alert settings, giveaway entries and Steam profile ID from the bot. Giveaways you host are cancelled and their keys wiped. It cannot be undone.",
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
        if (i.commandName === "library") return i.respond(suggest(db.listLibrary(i.user.id), focused.value));
        if (i.commandName === "serverlist") {
            const gid = i.guildId ?? db.getUser(i.user.id)?.guild_id;
            if (!gid) return i.respond([]);
            return i.respond(suggest(db.listServerGames(gid, i.user.id), focused.value));
        }
        return i.respond(suggest(db.listItems(i.user.id), focused.value));
    }

    async function handleCompare(i) {
        const friend = i.options.getUser("friend", true);
        const pub = i.options.getBoolean("public") === true;
        const reply = content => i.reply({ content, flags: MessageFlags.Ephemeral });
        if (!i.guildId) return reply("Use this in a server, so I know who you can compare with.");
        if (friend.id === i.user.id) return reply("That is you. Pick someone else.");
        if (!db.sharingMembers(i.guildId).includes(friend.id)) return reply(`${friend.displayName ?? friend.username} has not opted in. They can turn it on with \`/alerts share\`.`);
        db.ensureUser(i.user.id, i.guildId);
        const r = compareLibraries(db, i.user.id, friend.id);
        if (!r.a.games) return reply("Your library is empty. Use `/library add`, `/library import` or `/steam link` first.");
        if (!r.b.games) return reply(`${friend.displayName ?? friend.username} has no games in their library yet.`);
        return i.reply({ embeds: [compareEmbed(r, "You", friend.displayName ?? friend.username)], ...(pub ? {} : { flags: MessageFlags.Ephemeral }) });
    }

    return { handleFriend, handleCompare, handleWishlist, handleGameNight, handleGameNightButton, handleChangelog, handleAlertButton, handleAlerts, handleAlertChannel, handleLibrary, handleServerList, handleLeaderboard, handleFreeGames, handleFreeMenu, handleSales, handleWatch, handlePublicPage, handleServerStats, handleStatus, handleMyData, handleAutocomplete };
}

// Discord handlers for the wishlist, alert, channel and data commands.
// Logic lives in db.js, alerts.js, steam.js and wishlist.js; this file only talks to Discord.

import {
    ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags, PermissionFlagsBits
} from "discord.js";
import { setProfile } from "./profile.js";
import { salesEmbed, upcomingSales } from "./salescal.js";
import { freeMenu, shopSlug } from "./freemenu.js";
import { ItadError } from "./itad.js";
import { importWishlist, SteamError, MAX_IMPORT } from "./steam.js";
import { parseTrigger, describeTrigger } from "./alerts.js";
import { findItem, suggest, viewRows, exportJson, addGameByTitle, applySteamImport, WishlistError } from "./wishlist.js";
import { wishlistEmbed, WISHLIST_PER_PAGE, checkEmbed, libraryEmbed, serverListEmbed, leaderboardEmbed, alertHistoryEmbed, freeGamesPayload, backlogEmbed, serverStatsEmbed, statusEmbed } from "./render.js";
import { summarize } from "./report.js";
import { current, dealVerdict } from "./alerts.js";
import { prefsPatch, describeQuiet, describeDigest } from "./prefs.js";
import { importLibrary, libraryView, leaderboard, LibraryError, playNext, serverStats } from "./library.js";
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
            await i.editReply({ embeds: [checkEmbed(found.item.title, now, dealVerdict(now))] });
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

    async function handleWishlist(i) {
        const user = db.ensureUser(i.user.id, i.guildId);
        try {
            switch (i.options.getSubcommand()) {
                case "import": return await wishlistImport(i, user);
                case "add": return await wishlistAdd(i);
                case "remove": return await wishlistRemove(i);
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
            cooldown(i, "lib");
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            if (sub === "backlog") {
                const view = await libraryView(db, itad, user, { snapshot: false });
                if (!view.rows.length) throw new UserError("Your library is empty. Use `/library add` or `/library import`.");
                return void await i.editReply({ embeds: [backlogEmbed(view, playNext(view.rows))] });
            }
            if (sub === "add") {
                const paid = i.options.getNumber("paid");
                const r = await importLibrary(db, itad, i.user.id, [{ title: i.options.getString("title", true), paid }]);
                if (r.notFound.length) throw new UserError(`I could not find a game called ${r.notFound[0]}.`);
                if (r.skippedForLimit) throw new UserError("Your library is full (500 games).");
                return void await i.editReply(r.updated ? "Updated that game in your library." : "Added to your library.");
            }
            if (sub === "import") {
                const entries = sanitize(await readUpload(i.options.getAttachment("file", true)), { max: 500 }).entries;
                const r = await importLibrary(db, itad, i.user.id, entries);
                const lines = [`Added **${r.added}**, updated **${r.updated}**.`];
                if (r.notFound.length) lines.push(`${r.notFound.length} could not be matched and were skipped.`);
                if (r.skippedForLimit) lines.push(`Your library is full (500 games), so ${r.skippedForLimit} were skipped.`);
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

    async function handleServerList(i) {
        const user = db.ensureUser(i.user.id, i.guildId);
        const sub = i.options.getSubcommand();
        try {
            if (sub === "vote") {
                const r = vote(db, i.guildId, i.user.id, i.options.getString("game", true));
                return void await eph(i, r.voted ? `Voted for **${r.title}** (${r.votes} now).` : `Took back your vote on **${r.title}** (${r.votes} now).`);
            }
            if (sub === "remove") {
                const r = removeFromServerList(db, i.guildId, i.user.id, i.options.getString("game", true), canManage(i));
                return void await eph(i, `Removed **${r.title}** from the server list.`);
            }
            cooldown(i, "view");
            // Visible to the channel: the list is shared on purpose.
            await i.deferReply();
            if (sub === "add") {
                const r = await addToServerList(db, itad, i.guildId, i.user.id, i.options.getString("title", true));
                return void await i.editReply({ content: `<@${i.user.id}> added **${r.name}** to the server wishlist.`, allowedMentions: { parse: [] } });
            }
            const view = await serverListView(db, itad, i.guildId, user);
            return void await i.editReply({ embeds: [serverListEmbed(view.rows, view.currency)] });
        } catch (err) {
            await failed(i, "serverlist", err);
        }
    }

    async function handleLeaderboard(i) {
        await i.reply({ embeds: [leaderboardEmbed(leaderboard(db, i.guildId))], allowedMentions: { parse: [] } });
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
            await i.editReply({ embeds: [serverStatsEmbed(serverStats(db, i.guildId))] });
        } catch (err) { await failed(i, "serverstats", err); }
    }

    // ---------- /publicpage ----------
    async function handlePublicPage(i) {
        try {
            db.ensureUser(i.user.id, i.guildId);
            const r = setProfile(db, i.user.id, { enabled: i.options.getBoolean("enabled", true), slug: i.options.getString("name") });
            if (!r.public) return eph(i, "Your public page is off. Nobody can open it.");
            const link = publicUrl ? `${publicUrl}/#/u/${r.slug}` : null;
            return eph(i, `Your page is on${link ? `: ${link}` : `, as **${r.slug}**`}\nIt shows only game names, art and today's best prices. Never your Discord account.`);
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
            if (!i.guildId) return i.respond([]);
            return i.respond(suggest(db.listServerGames(i.guildId, i.user.id), focused.value));
        }
        return i.respond(suggest(db.listItems(i.user.id), focused.value));
    }

    return { handleWishlist, handleAlerts, handleAlertChannel, handleLibrary, handleServerList, handleLeaderboard, handleFreeGames, handleFreeMenu, handleSales, handleWatch, handlePublicPage, handleServerStats, handleStatus, handleMyData, handleAutocomplete };
}

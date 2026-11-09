// Discord handlers for the wishlist, alert, channel and data commands.
// Logic lives in db.js, alerts.js, steam.js and wishlist.js; this file only talks to Discord.

import {
    ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags, PermissionFlagsBits
} from "discord.js";
import { setProfile, publicWishlist } from "./profile.js";
import { CONTEXT_COMPARE, CONTEXT_WISHLIST, CONTEXT_GIFTS, CONTEXT_TOGETHER, CONTEXT_PRICE, CONTEXT_ADD, CONTEXT_OWNERS } from "./commands.js";
import { salesEmbed, upcomingSales, salesBefore } from "./salescal.js";
import { freeMenu, shopSlug } from "./freemenu.js";
import { enrichFree, withOwnership } from "./freeinfo.js";
import { ItadError } from "./itad.js";
import { importWishlist, SteamError, MAX_IMPORT } from "./steam.js";
import { gameNight, gameNightEmbed, gameNightButtons, pickGame, pollOptions, pollState, castVote, pollEmbed, pollButtons } from "./gamenight.js";
import { SNOOZE_ID, BELOW_ID, BELOW_MODAL_ID } from "./render.js";
import { LANGS, languageDone } from "./i18n.js";
import { LATEST, changelogEmbed } from "./changelog.js";
import { parseTrigger, describeTrigger } from "./alerts.js";
import { pushEvent } from "./adminlog.js";
import { findItem, suggest, viewRows, exportJson, addGameByTitle, applySteamImport, WishlistError } from "./wishlist.js";
import { newsPayload } from "./render.js";
import { contextWishlistEmbed, giftIdeasEmbed, playTogetherEmbed, ownersEmbed, coopEmbed } from "./render.js";
import { renderHistoryChart } from "./historychart.js";
import { steamReviews } from "./reviews.js";
import { money, wishlistEmbed, WISHLIST_PER_PAGE, checkEmbed, libraryEmbed, serverListEmbed, leaderboardEmbed, boardEmbed, bundlesEmbed, leagueEmbed, badgesEmbed, alertHistoryEmbed, backlogEmbed, trendEmbed, challengeEmbed, spendEmbed, compareEmbed, serverStatsEmbed, statusEmbed } from "./render.js";
import { summarize } from "./report.js";
import { createNews, newsForUser } from "./news.js";
import { current, dealVerdict } from "./alerts.js";
import { prefsPatch, describeQuiet, describeDigest } from "./prefs.js";
import { compareLibraries, playTogether } from "./compare.js";
import { challengeView, monthKey, MAX_GOAL } from "./challenge.js";
import { buyOrWait } from "./advice.js";
import { daysUntilBirthday } from "./friendstore.js";
import { friendDeals, friendRows, saveFriend, birthdayEmbed } from "./friends.js";
import { spendSummary, regionCurrency } from "./spend.js";
import { trophyCase } from "./badges.js";
import { addBundle, bundleView } from "./bundles.js";
import { buildServerWrapped, renderServerWrapped } from "./serverwrapped.js";
import { importLibrary, libraryView, leaderboard, finishedLeague, extraBoard, EXTRA_BOARDS, LibraryError, playNext, serverStats, trendSummary } from "./library.js";
import { addToServerList, serverListView, vote, removeFromServerList } from "./serverlist.js";
import { readUpload } from "./upload.js";
import { sanitize } from "./parse.js";

import { UserError } from "./errors.js";
import { codeGames, describeGames } from "./codes.js";
import { expandGames } from "./codesource.js";
import { whoIsPlaying, nowPlayingEmbed } from "./nowplaying.js";
import { boardSvg, artFor } from "./communitycards.js";
import { panelSvg, toPng, challengeSpec, spendSpec, trendSpec, compareSpec, badgesSpec, statusSpec, serverStatsSpec } from "./panelcards.js";
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

/** A picture card for a command, or the plain embed if the picture can't be drawn. */
const withCard = (spec, name, alt, embed) => {
    try { return { files: [{ attachment: Buffer.from(toPng(panelSvg(spec))), name, description: alt }] }; }
    catch { return { embeds: [embed] }; }
};

/** A game title out of a chat message: first line, links and mentions removed, kept short. Null when nothing is left. */
export function gameTitleFromText(text) {
    const line = String(text ?? "").split("\n").map(l => l.trim()).find(Boolean) ?? "";
    const t = line.replace(/https?:\/\/\S+/g, " ").replace(/<[@#:][^>]*>/g, " ").replace(/[*_`~>|]/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
    return t.length >= 2 ? t : null;
}

export function createHandlers({ panels, db, itad, nowPlaying = null, publicUrl = null, getStatus = () => null, getAbout = () => null, news: newsSource = createNews() }) {
    // ---------- /me wishlist ----------
    async function wishlistImport(i, user) {
        const undo = cooldown(i, "import");
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const pasted = (i.options.getString("profile") ?? "").trim();
            const linked = db.getSteamLink?.(i.user.id)?.steamid;
            if (!pasted && !linked) { undo(); return void await i.editReply(`Sign in through Steam once and this works with no links: ${publicUrl ? `${publicUrl}/auth/steam` : "open the dashboard and press Sign in through Steam"}`); }
            const r = await importWishlist(pasted || linked, itad);
            const res = applySteamImport(db, i.user.id, r);
            const pruned = res.pruned;

            const lines = [`Imported **${res.added}** new game${res.added === 1 ? "" : "s"} from your Steam wishlist (${res.existing} already on your list).`];
            if (pruned) lines.push(`Removed ${pruned} game${pruned === 1 ? "" : "s"} that left your Steam wishlist.`);
            if (r.unmatched) lines.push(`${r.unmatched} could not be matched to price data and were skipped.`);
            if (r.truncated) lines.push(`Only the first ${MAX_IMPORT} of ${r.total} games were imported.`);
            if (r.rateLimited) lines.push("IsThereAnyDeal asked the bot to slow down, so only part of the wishlist was added. Run the import again in a minute to add the rest.");
            if (res.skippedForLimit) lines.push(`Your list is full (200 games), so ${res.skippedForLimit} were skipped.`);
            lines.push("", `Alerts: **any sale**, delivered by **${deliveryText(db.getUser(i.user.id))}**.`);
            lines.push("Use `/me wishlist alert` to change when you get alerted, and `/me wishlist view` to see prices. Run `/me wishlist import` again any time to sync.");
            if (user.delivery === "dm") lines.push("Make sure your DMs from this server are open, or ask an admin to set `/manage alertchannel`.");
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
            if (!rows.length) throw new UserError("Your wishlist is empty. Use `/me wishlist import` or `/me wishlist add`.");
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
            let history = null;
            try { history = await itad.getHistory(found.item.itad_id, user.region); advice = buyOrWait(history, now.price, { sales: upcomingSales(Date.now()), past: salesBefore(), money: n => money(n, now.currency) }); } catch { /* the check works without it */ }
            let subs = [];
            try { subs = (await itad.getSubs?.([found.item.itad_id], user.region))?.get(found.item.itad_id) ?? []; } catch { /* the check works without it */ }
            const reviews = await steamReviews(found.item.appid).catch(() => null);
            const embed = checkEmbed(found.item.title, now, dealVerdict(now), advice, subs, reviews);
            let chart = null;
            try { chart = history ? renderHistoryChart({ title: found.item.title, points: history, currency: now.currency, now: now.price }) : null; } catch { /* the card is fine without the picture */ }
            if (chart) embed.image = { url: "attachment://price-history.png" };
            await i.editReply({ embeds: [embed], files: chart ? [{ attachment: chart, name: "price-history.png", description: `Price history of ${found.item.title} over the last year` }] : [] });
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

    async function handleCoop(i) {
        if (!i.inGuild()) return eph(i, "Use this in a server, so I know whose libraries to look at.");
        const ping = Boolean(i.options.getBoolean("ping"));
        await i.deferReply(ping ? {} : { flags: MessageFlags.Ephemeral });
        try {
            db.ensureUser(i.user.id, i.guildId);
            const title = i.options.getString("game", true);
            const [hit] = await itad.lookupTitles([title]);
            if (!hit?.id) throw new UserError(`I could not find a game called ${title}.`);
            const name = hit.approx ? hit.matched : title;
            const owners = db.ownersOf(i.guildId, hit.id);
            const mentions = ping ? owners.slice(0, 12).map(o => `<@${o.discord_id}>`).join(" ") : "";
            await i.editReply({ content: ping && mentions ? `${i.user} wants a ${name} group: ${mentions}` : undefined, embeds: [coopEmbed(name, owners, { ping })], allowedMentions: ping ? { users: [i.user.id, ...owners.slice(0, 12).map(o => o.discord_id)] } : { parse: [] } });
        } catch (err) { await failed(i, "coop", err); }
    }

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

    /** "Start a vote": posts a poll for the group in the channel. Votes live in the key-value store under the poll message. */
    async function handleGameNightPoll(i) {
        const channelId = i.customId.split(":")[1];
        try {
            const user = db.ensureUser(i.user.id, i.guildId);
            const r = await gameNight({ db, itad, userIds: inVoice(i.guild, channelId), region: user.region });
            const options = pollOptions(r);
            if (options.length < 2) return await eph(i, "There aren't enough games the group owns to vote on yet. See the buy list instead.");
            const state = pollState(options);
            await i.reply({ embeds: [pollEmbed(state)], components: pollButtons(options), allowedMentions: { parse: [] } });
            const sent = await i.fetchReply();
            db.setMeta(`poll:${sent.id}`, JSON.stringify(state));
            try { db.prunePolls(); } catch { /* old votes can wait */ }
        } catch (err) { return eph(i, err instanceof UserError ? err.message : "I could not start a vote. Try again."); }
    }

    async function handlePollVote(i) {
        try {
            const raw = db.getMeta(`poll:${i.message.id}`);
            if (!raw) return await eph(i, "That vote is no longer available.");
            const state = JSON.parse(raw);
            if (!castVote(state, i.user.id, Number(i.customId.split(":")[1]))) {
                return await i.update({ embeds: [pollEmbed(state)], components: pollButtons(state.options, false) });
            }
            db.setMeta(`poll:${i.message.id}`, JSON.stringify(state));
            return await i.update({ embeds: [pollEmbed(state)], components: pollButtons(state.options) });
        } catch (err) { return eph(i, "I could not record that vote. Try again."); }
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
    /** /language, and /alerts language. Saves the choice and answers in the language that was picked. */
    async function handleLanguage(i) {
        const user = db.ensureUser(i.user.id, i.guildId);
        const lang = i.options.getString("language", true);
        if (!LANGS[lang]) return eph(i, "Pick a language from the list.");
        db.updateUser(user.discord_id, { lang });
        return eph(i, languageDone(lang));
    }

    async function handleAlerts(i) {
        const user = db.ensureUser(i.user.id, i.guildId);
        const sub = i.options.getSubcommand();
        switch (sub) {
            case "status": {
                if (panels?.has("alerts")) return panels.open(i, "alerts");
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
                            { name: "Bundle, giveaway and subscription alerts", value: user.bundles === 0 ? "Off" : "On", inline: true },
                            { name: "Free game alerts", value: user.free ? "On" : "Off", inline: true },
                            { name: "News and patch notes", value: ["Off", "Patch notes only", "Every announcement"][user.news ?? 0], inline: true },
                            { name: "Server group alerts and leaderboard", value: user.share ? "Opted in" : "Not shared", inline: true }
                        ]
                    }]
                });
            }
            case "delivery": {
                const mode = i.options.getString("mode", true);
                if (mode === "channel" && !db.getGuild(user.guild_id)) {
                    return eph(i, i.inGuild() || user.guild_id
                        ? "This server has no alert channel yet. Ask a server admin to run `/manage alertchannel set`, then try again."
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
                return eph(i, on ? "You will be told when a wishlist game is in a bundle, being given away, or joins or leaves a subscription like Game Pass." : "Bundle and giveaway alerts are off.");
            }
            case "news": {
                const mode = i.options.getInteger("mode", true);
                db.updateUser(user.discord_id, { news: mode });
                return eph(i, mode === 0 ? "News alerts are off." : `You will get ${mode === 1 ? "patch notes" : "every announcement"} for the Steam games you own or wishlist. Your first check is quiet, so only new posts reach you. Link Steam or import your wishlist if you haven't, so I know your games.`);
            }
            case "dlc": {
                const on = i.options.getBoolean("enabled", true);
                db.updateUser(user.discord_id, { dlc: on ? 1 : 0 });
                return eph(i, on ? "You will be told when DLC and add-ons for the games you play (two hours or more, from your Steam library) go on a big sale. Your first check is quiet, so only new sales reach you." : "DLC sale alerts are off.");
            }
            case "refund": {
                const on = i.options.getBoolean("enabled", true);
                db.updateUser(user.discord_id, { refund: on ? 1 : 0 });
                const priced = on ? db.paidGameCount(user.discord_id) : 0;
                const extra = on ? ` You will also hear if a game still in its refund window drops below what you paid, so a refund and rebuy would save money. That part only works with prices from the extension's purchase sync (Steam purchase history).${priced ? "" : " None of your games have a price recorded yet, so it will stay quiet until you run that sync."}` : "";
                return eph(i, on ? `You will get a heads-up two days before the 14-day refund window closes on a Steam game you barely played (under two hours). It needs your Steam account linked, and only games that show up after you link count.${extra}` : "Refund reminders are off.");
            }
            case "playtests": {
                const mode = i.options.getInteger("mode", true);
                db.updateUser(user.discord_id, { playtest: mode });
                return eph(i, mode === 0 ? "Playtest and demo alerts are off." : mode === 1
                    ? "You will be told when a game on your wishlist (that you don't own) has a playtest, demo, beta or free weekend. It reads the game's Steam announcements and sites that list playtests (Alpha Beta Gamer, GamerPower, itch.io, Steam's new demos). Steam announcements need the game imported from Steam (`/me wishlist import`). Your first check is quiet."
                    : "You will be told about every free playtest, beta and demo the bot finds, from Steam announcements for your wishlist games and from Alpha Beta Gamer, GamerPower and itch.io. Steam's new demos only count for games on your wishlist. Expect a few a day. Your first check is quiet, and `/alerts quiethours` still applies.");
            }
            case "achievements": {
                const on = i.options.getBoolean("enabled", true);
                db.updateUser(user.discord_id, { achv: on ? 1 : 0 });
                return eph(i, on ? "You will get a heads-up when a game you have played for 5 hours or more is within 3 achievements of 100%. It needs Steam linked and achievements synced (`/me steam sync`). Your first check is quiet." : "Achievement heads-ups are off.");
            }
            case "nudge": {
                const on = i.options.getBoolean("enabled", true);
                db.updateUser(user.discord_id, { nudge: on ? 1 : 0 });
                return eph(i, on ? "On the 1st of each month you will get one game from your backlog to try, picked from what you haven't started. Mark games with `/me library status` and the pick gets better." : "The monthly backlog pick is off.");
            }
            case "yearinreview": {
                const on = i.options.getBoolean("enabled", true);
                db.updateUser(user.discord_id, { yearly: on ? 1 : 0 });
                return eph(i, on ? "You will get your year in games card (hours, months, top games) by DM from December 26. It needs Steam linked. You can see it any time with `/me steam recap`." : "The year in games card is off.");
            }
            case "milestones": {
                const on = i.options.getBoolean("enabled", true);
                db.updateUser(user.discord_id, { milestones: on ? 1 : 0 });
                return eph(i, on ? "You will get a card when a game of yours passes 100, 250, 500, 1000 or 2000 hours. Your first check is quiet, so only new milestones reach you." : "Playtime milestone cards are off.");
            }
            case "freegames": {
                const on = i.options.getBoolean("enabled", true);
                const dlc = i.options.getBoolean("dlc");
                db.updateUser(user.discord_id, { free: on ? 1 : 0, ...(dlc === null ? {} : { free_dlc: dlc ? 1 : 0 }) });
                const dlcNote = dlc === null ? "" : dlc ? " Free DLC is included." : " Free DLC is hidden.";
                return eph(i, (on ? "You will be told when a game is free to claim. Several free games from one store come in one message with a Claim all button." : "Free game alerts are off.") + dlcNote);
            }
            case "codes": {
                const on = i.options.getBoolean("enabled", true);
                const game = i.options.getString("game");
                const keep = i.options.getBoolean("on");
                let games = db.getAlertSubs(user.discord_id).games;
                if (game) {
                    const all = codeGames().map(g => g.key);
                    const base = games.length ? games : all;
                    const keys = expandGames([game]);
                    games = keep === false ? base.filter(k => !keys.includes(k)) : [...new Set([...base, ...keys])];
                    if (!games.length) throw new UserError("Keep at least one game, or turn code alerts off.");
                    if (games.length === all.length) games = [];
                }
                const s = db.setAlertSubs(user.discord_id, { codes: on, ...(game ? { games } : {}) });
                return eph(i, on ? `I'll message you when a new game code drops${s.games.length ? ` for ${describeGames(s.games)}` : " for any game"}. Only codes from now on, nothing old.` : "Game code alerts are off.");
            }
            case "promos": {
                const on = i.options.getBoolean("enabled", true);
                db.setAlertSubs(user.discord_id, { promos: on });
                return eph(i, on ? "I'll message you when NVIDIA, SteelSeries or a game's news mentions a giveaway or a code. Only new posts, and it can be a false alarm now and then." : "Promo news alerts are off.");
            }
            case "mute": {
                const type = i.options.getString("type", true), on = i.options.getBoolean("muted", true);
                const list = new Set(String(user.muted ?? "").split(",").filter(Boolean));
                on ? list.add(type) : list.delete(type);
                db.updateUser(user.discord_id, { muted: [...list].join(",") });
                return eph(i, on ? "Muted. Those alerts will not be sent to you, but you can still read them on the dashboard's Notifications page." : "Unmuted. You will get those alerts again.");
            }
            case "language": {
                return await handleLanguage(i);
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
                    ? "You are in. Your server may now see your name in group alerts (\"N members are watching…\") and on `/server leaderboard`. Only your name, the number of games and your percent saved are shown. Turn this off any time."
                    : "You are out of group alerts and the leaderboard.");
            }
            case "history": {
                return i.reply({ embeds: [alertHistoryEmbed(db.listAlerts(user.discord_id, 15))], flags: MessageFlags.Ephemeral });
            }
        }
    }

    // ---------- /manage alertchannel ----------
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
                if (!db.getGuild(i.guildId)) return eph(i, "Set an alert channel first with `/manage alertchannel set`.");
                const on = i.options.getBoolean("enabled", true);
                db.setFreeFeed(i.guildId, on);
                return eph(i, on ? "Free game feed on. New free games (not DLC) are posted in the alert channel, once each." : "Free game feed off.");
            }
            case "hot": {
                if (!db.getGuild(i.guildId)) return eph(i, "Set an alert channel first with `/manage alertchannel set`.");
                const n = i.options.getInteger("minimum", true);
                if (n !== 0 && n < 30) return eph(i, "Pick 30 or more, or 0 to turn it off. Below 30 would post nearly every sale.");
                db.setHotMin(i.guildId, n);
                return eph(i, n ? `Hot deals on. Steam discounts of ${n}% or more are posted in the alert channel, each deal once.` : "Hot deals off.");
            }
            case "sales": {
                if (!db.getGuild(i.guildId)) return eph(i, "Set an alert channel first with `/manage alertchannel set`.");
                const on = i.options.getBoolean("enabled", true);
                db.setSaleFeed(i.guildId, on);
                return eph(i, on ? "Sale posts on. The alert channel gets one post when a Steam sale or festival starts (including one that is already running)." : "Sale posts off.");
            }
            case "digest": {
                if (!db.getGuild(i.guildId)) return eph(i, "Set an alert channel first with `/manage alertchannel set`.");
                const on = i.options.getBoolean("enabled", true);
                db.setWeeklyDigest(i.guildId, on);
                return eph(i, on ? "Weekly digest on. Fridays the alert channel gets cheap games that opted-in members watch (never who), free games and the week's server events." : "Weekly digest off.");
            }
            case "group": {
                if (!db.getGuild(i.guildId)) return eph(i, "Set an alert channel first with `/manage alertchannel set`.");
                const n = i.options.getInteger("minimum", true);
                if (n === 1) return eph(i, "Use 2 or more, or 0 to turn it off.");
                db.setGroupMin(i.guildId, n);
                return eph(i, n ? `Group alerts on. When ${n} or more members who opted in (\`/alerts share\`) have a game on their wishlist and it hits their alert, the channel gets one post.` : "Group alerts are off.");
            }
            case "show": {
                const g = db.getGuild(i.guildId);
                return eph(i, g ? `Alert channel: <#${g.channel_id}>` : "No alert channel is set. Use `/manage alertchannel set`.");
            }
        }
    }

    // ---------- /me library ----------
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
                    "Making a new code replaces this one. `/me library grabber action:Turn the link off` removes it."
                ].join("\n"));
            }
            if (sub === "bundle") {
                cooldown(i, "lib");
                await i.deferReply({ flags: MessageFlags.Ephemeral });
                const r = await addBundle(db, itad, i.user.id, { name: i.options.getString("name", true), paid: i.options.getNumber("paid", true), titles: i.options.getString("titles", true) });
                return void await i.editReply(`Saved bundle **#${r.id}** with ${r.matched} games${r.newGames ? ` (${r.newGames} new in your library, paid split evenly)` : ""}.${r.notFound.length ? ` Not found: ${r.notFound.slice(0, 5).join(", ")}.` : ""} See it with \`/me library bundles\`.`);
            }
            if (sub === "bundles") {
                const rm = i.options.getInteger("remove");
                if (rm !== null) return eph(i, db.removeBundle(i.user.id, rm) ? `Removed bundle #${rm}. The games stay in your library.` : "I could not find that bundle number.");
                await i.deferReply({ flags: MessageFlags.Ephemeral });
                return void await i.editReply({ embeds: [bundlesEmbed(await bundleView(db, itad, user))] });
            }
            if (sub === "badges") return void await (async () => { const tc = trophyCase(db, i.user.id); return i.reply({ ...withCard(badgesSpec(tc), "trophy-case.png", `Trophy case: ${tc.earned} of ${tc.total}`, badgesEmbed(tc)), flags: MessageFlags.Ephemeral }); })();
            if (sub === "spend") {
                const sp = spendSummary(db.listLibrary(i.user.id), { currency: regionCurrency(user.region) });
                return void await i.reply({ ...withCard(spendSpec(sp), "spend.png", "What you have spent", spendEmbed(sp)), flags: MessageFlags.Ephemeral });
            }
            if (sub === "challenge") {
                const goal = i.options.getInteger("goal");
                if (goal !== null) db.setChallenge(i.user.id, monthKey(Date.now()), Math.min(MAX_GOAL, Math.max(0, goal)));
                const ch = challengeView(db, i.user.id);
                return void await i.reply({ ...withCard(challengeSpec(ch), "challenge.png", "Your backlog challenge", challengeEmbed(ch)), flags: MessageFlags.Ephemeral });
            }
            cooldown(i, "lib");
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            if (sub === "backlog") {
                const view = await libraryView(db, itad, user, { snapshot: false });
                if (!view.rows.length) throw new UserError("Your library is empty. Use `/me library add` or `/me library import`.");
                return void await i.editReply({ embeds: [backlogEmbed(view, playNext(view.rows))] });
            }
            if (sub === "news") {
                const { known, posts } = await newsForUser(db, newsSource, user.discord_id);
                if (!known) throw new UserError("I don't know any of your Steam games yet. Link Steam with `/me steam link` or import your wishlist, then try again.");
                const payload = newsPayload(posts, { pager: db });
                if (!payload) throw new UserError("No recent news for your games right now.");
                return void await i.editReply(payload);
            }
            if (sub === "trend") {
                const view = await libraryView(db, itad, user);
                if (!view.rows.length) throw new UserError("Your library is empty. Use `/me library add` or `/me library import`.");
                const tr = trendSummary(view.snapshots);
                if (!tr) throw new UserError("A trend needs at least two days of data. I take a snapshot every day, so check back tomorrow.");
                return void await i.editReply(withCard(trendSpec(tr, view.currency, view.totals.backlogGames), "trend.png", "Your library trend", trendEmbed(tr, view.currency, view.totals.backlogGames)));
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
            if (!view.rows.length) throw new UserError("Your library is empty. Use `/me library add` or `/me library import`.");
            return void await i.editReply({ embeds: [libraryEmbed(view, view.currency)] });
        } catch (err) {
            await failed(i, "library", err);
        }
    }

    // ---------- /server serverlist and /server leaderboard ----------
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
            if (board === "wrapped") {
                const data = buildServerWrapped(db, guild);
                if (!data) return void await eph(i, "Nothing to show yet. Wrapped uses hours tracked this year by members who turned on `/alerts share`, so once a few people have linked Steam and opted in it fills up.");
                await i.deferReply();
                const names = new Map();
                await Promise.all([...new Set(data.mvp.map(p => p.discord_id))].map(async id => { try { const u = await i.client.users.fetch(id); names.set(id, u.globalName ?? u.username); } catch { names.set(id, "a member"); } }));
                const png = await renderServerWrapped(data, { guildName: i.guild?.name ?? "Your server", nameOf: id => names.get(id) ?? "a member" });
                return void await i.editReply({ content: `**${i.guild?.name ?? "Your server"}: ${data.year} wrapped.** Want to be in it? Turn on \`/alerts share\` and link Steam.`, files: [{ attachment: Buffer.from(png), name: "server-wrapped.png", description: `Server wrapped ${data.year}` }], allowedMentions: { parse: [] } });
            }
            const finished = board === "finished", extra = EXTRA_BOARDS[board];
            const entries = finished ? finishedLeague(db, guild) : extra ? extraBoard(db, guild, board) : leaderboard(db, guild);
            const footer = board === "hours" ? "Only members who opted in. Counts hours tracked since they linked Steam." : "Only members who opted in.";
            const embed = finished ? leagueEmbed(entries) : extra ? boardEmbed(extra, entries, footer) : leaderboardEmbed(entries);
            // Names and pictures for the card. If anything goes wrong the plain embed answers instead.
            try {
                if (!entries.length) throw new Error("nothing to draw");
                await i.deferReply();
                const people = await Promise.all(entries.map(async e => { try { const u = await i.client.users.fetch(e.discord_id); return { name: u.globalName ?? u.username, url: u.displayAvatarURL?.({ extension: "png", size: 128 }) ?? null }; } catch { return { name: "Member", url: null }; } }));
                const art = await artFor(people.map(p => p.url));
                const title = finished ? "Backlog league" : extra ? extra : "Savings leaderboard";
                const sub = finished ? "Games finished this month" : board === "hours" ? "Hours tracked since linking Steam" : extra ? "Only members who opted in" : "Percent saved vs full price";
                const svg = boardSvg({ title, subtitle: sub, accent: "#f5c542", accent2: "#f0883e", rows: entries.map((e, n) => finished ? { name: people[n].name, art: art(people[n].url), big: `${e.done} finished` } : extra ? { name: people[n].name, art: art(people[n].url), big: String(e.label) } : { name: people[n].name, art: art(people[n].url), big: `${e.savedPct.toFixed(0)}% saved`, small: `across ${e.games} games` }) });
                return void await i.editReply({ files: [{ attachment: Buffer.from(toPng(svg)), name: "leaderboard.png", description: title }] });
            } catch { /* fall through to the embed */ }
            await (i.deferred || i.replied ? i.editReply({ embeds: [embed], allowedMentions: { parse: [] } }) : i.reply({ embeds: [embed], allowedMentions: { parse: [] } }));
        }
        catch (err) { await eph(i, err instanceof UserError ? err.message : "Something went wrong. Try again in a moment."); }
    }

    // ---------- /games freegames ----------
    const MAX_FREE_PLATFORMS = 6;
    async function handleFreeGames(i) {
        const store = (i.options.getString("store") ?? "").trim().toLowerCase();
        const share = i.options.getBoolean("public") === true;
        await i.deferReply(share ? {} : { flags: MessageFlags.Ephemeral });
        try {
            const list = withOwnership(await enrichFree(await itad.getGiveawayList()), db, i.user.id);
            const showDlc = db.getUser(i.user.id)?.free_dlc !== 0;
            const shops = [...new Set(list.map(g => g.shop))];
            const wanted = store ? shops.find(s => String(s).toLowerCase().includes(store)) : null;
            if (store && !wanted) return await i.editReply({ content: `No free games found on a store matching "${store.slice(0, 40)}" right now.` });
            await i.editReply(freeMenu(list, { cat: "games", store: wanted ? shopSlug(wanted) : "all", page: 0, showDlc }));
        } catch (err) { await failed(i, "freegames", err); }
    }

    /** Buttons and the store menu on the /games freegames message. The whole state lives in the custom id, so it survives restarts. */
    async function handleFreeMenu(i) {
        try {
            let cat, store, page;
            if (i.isStringSelectMenu()) { [, cat] = i.customId.split(":"); store = i.values[0] ?? "all"; page = 0; }
            else { [, cat, store, page] = i.customId.split(":"); page = Number(page) || 0; }
            const showDlc = db.getUser(i.user.id)?.free_dlc !== 0;
            const payload = freeMenu(withOwnership(await enrichFree(await itad.getGiveawayList()), db, i.user.id), { cat, store, page, showDlc });
            const owner = i.message?.interactionMetadata?.user?.id ?? i.message?.interaction?.user?.id;
            if (owner && owner !== i.user.id) return await i.reply({ ...payload, flags: MessageFlags.Ephemeral }); // somebody else's public menu: give them their own
            await i.update(payload);
        } catch (err) { await failed(i, "freegames", err); }
    }

    // ---------- /bot status ----------
    async function handleStatus(i) {
        const st = getStatus();
        if (!st) return eph(i, "Status is not available right now.");
        const snap = st.snapshot();
        return i.reply({ ...withCard(statusSpec(snap, getAbout()), "status.png", "Bot status", statusEmbed(snap, getAbout(), publicUrl)), flags: MessageFlags.Ephemeral });
    }

    // ---------- /server serverstats ----------
    async function handleNowPlaying(i) {
        try {
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            const join = i.options.getBoolean("join");
            if (join !== null) {
                db.ensureUser(i.user.id, null); db.updateUser(i.user.id, { nowplaying: join ? 1 : 0 });
                if (!join) return await i.editReply({ content: "You are off the Now playing board and out of squad-up posts." });
                const link = db.getSteamLink(i.user.id), u = db.getUser(i.user.id);
                const todo = [!link && "link Steam with `/me steam link`", !u.share && "turn on `/alerts share` so your server may see you", "set Game details to Public in your Steam privacy settings (Steam only reports what you are playing when it is)"].filter(Boolean);
                return await i.editReply({ content: `You are on. Members of your server can see which game you are in right now (\`/server nowplaying\`), and when two or more of you are in the same game the bot may post a squad-up card naming you. Only the game and your name, never your friends list or anything else. To make it work: ${todo.join("; ")}.` });
            }
            if (!nowPlaying?.enabled) return await i.editReply({ content: "Now playing isn't set up on this bot yet (it needs a Steam API key)." });
            const gid = await homeGuild(i);
            await i.editReply({ embeds: [nowPlayingEmbed(await whoIsPlaying(db, nowPlaying, gid), { serverName: i.guild?.name ?? "this server" })], allowedMentions: { parse: [] } });
        } catch (err) { await failed(i, "nowplaying", err); }
    }

    async function handleServerStats(i) {
        try {
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            const ss = serverStats(db, await homeGuild(i));
            await i.editReply(withCard(serverStatsSpec(ss, i.guild?.name ?? ""), "server-stats.png", "Server stats", serverStatsEmbed(ss)));
        } catch (err) { await failed(i, "serverstats", err); }
    }

    // ---------- /me friend ----------
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
                if (!rows.length) return eph(i, "No friends yet. Add one with `/me friend add`.");
                return i.reply({ flags: MessageFlags.Ephemeral, embeds: [{ color: 0xe91e63, title: "Your friends", description: rows.map(f => `• **${f.name}**${f.birthday ? ` 🎂 ${f.birthday}${f.daysToBirthday <= 30 ? ` (in ${f.daysToBirthday} day${f.daysToBirthday === 1 ? "" : "s"})` : ""}` : ""}${f.slug ? " · has a public page" : ""}`).join("\n") }] });
            }
            const f = db.getFriend(i.user.id, i.options.getString("name", true));
            if (!f) return eph(i, "No friend by that name. See `/me friend list`.");
            if (!f.slug) return eph(i, `Add **${f.name}**'s public page first: \`/me friend add name:${f.name} page:their-page-name\`.`);
            cooldown(i, "view");
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            const deals = await friendDeals(db, itad, f.slug, 8);
            if (!deals) return void await i.editReply({ content: `${f.name}'s page \`${f.slug}\` is not public, or does not exist.` });
            return void await i.editReply({ embeds: [{ ...birthdayEmbed(f, f.birthday ? daysUntilBirthday(f.birthday, Date.now()) : 0, deals), title: `🎁 On sale for ${f.name}`, description: deals.length ? deals.map(d => `• **${d.title}** ${money(d.price, d.currency ?? "USD")}${d.discount > 0 ? ` (-${d.discount}%)` : ""} at ${d.shop}`).join("\n") : "Nothing on their public wishlist is on sale right now.", footer: { text: "Games someone already said they will gift are left out." } }] });
        } catch (err) { await failed(i, "friend", err); }
    }

    // ---------- /me publicpage ----------
    /** A public card for "here is my wishlist": a few game names (all of which the page shows anyway) and a button to open it. */
    function sharePayload(u, who) {
        const games = db.listItems(u.discord_id).filter(x => x.source !== "watch"), owned = new Set(db.listLibrary(u.discord_id).map(x => x.itad_id));
        const wanted = games.filter(x => !owned.has(x.itad_id)).sort((a, b) => Number(b.priority) - Number(a.priority));
        const url = publicUrl ? `${publicUrl}/u/${u.profile_slug}` : null;
        const embed = { color: 0x4da3ff, title: `🎁 ${who}'s wishlist`, ...(url ? { url } : {}),
            description: wanted.length ? `${wanted.length} game${wanted.length === 1 ? "" : "s"} on the list, with today's best prices. Open it to see them, and sign in to mark one as "I'm gifting this" so nobody doubles up.\n\n` + wanted.slice(0, 6).map(x => `• ${x.title}`).join("\n") + (wanted.length > 6 ? `\n…and ${wanted.length - 6} more` : "") : "Open it to see what is on the list, and mark a game as \"I'm gifting this\" so nobody doubles up.",
            footer: { text: "Only game names, art and prices are shown  •  /me publicpage to get your own" } };
        return { embeds: [embed], components: url ? [{ type: 1, components: [{ type: 2, style: 5, label: "Open the wishlist", url }] }] : [], allowedMentions: { parse: [] } };
    }

    async function handlePublicPage(i) {
        try {
            db.ensureUser(i.user.id, i.guildId);
            const wantOn = i.options.getBoolean("enabled"), share = i.options.getBoolean("share") === true, name = i.options.getString("name"), reset = i.options.getBoolean("reset_claims") === true;
            const link = slug => (publicUrl && slug ? `${publicUrl}/u/${slug}` : null);
            if (wantOn === null && !name && !reset) {
                // Nothing to change: show (or post) the link.
                const u = db.getUser(i.user.id);
                if (!u?.profile_public || !u.profile_slug) return eph(i, "Your public page is off. Turn it on with `/me publicpage enabled:true name:yourname`, then share it with `/me publicpage share:true`.");
                if (!share) return eph(i, `Your page: ${link(u.profile_slug) ?? "**" + u.profile_slug + "**"}\nPost it for everyone in this channel with \`/me publicpage share:true\`.`);
                return await i.reply(sharePayload(u, i.member?.displayName ?? i.user.globalName ?? i.user.username));
            }
            const r = setProfile(db, i.user.id, { enabled: wantOn ?? Boolean(db.getUser(i.user.id)?.profile_public), slug: name });
            const cleared = reset ? db.clearGiftClaims(i.user.id) : 0;
            if (share && r.public) { await i.reply(sharePayload(db.getUser(i.user.id), i.member?.displayName ?? i.user.globalName ?? i.user.username)); return; }
            if (!r.public) return eph(i, "Your public page is off. Nobody can open it." + (cleared ? ` Cleared ${cleared} gift claim${cleared === 1 ? "" : "s"}.` : ""));
            const n = db.countGiftClaims(i.user.id), shown = link(r.slug);
            return eph(i, `Your page is on${shown ? `: ${shown}` : `, as **${r.slug}**`}\nIt shows only game names, art and today's best prices. Never your Discord account.\n` +
                `Visitors who sign in with Discord can mark a game as "I'm gifting this" so nobody doubles up. You are not told who, or which games` + (n ? `, only that **${n}** ${n === 1 ? "is" : "are"} claimed right now.` : ".") +
                (cleared ? ` Cleared ${cleared} just now.` : n ? " Add `reset_claims: true` to clear them." : ""));
        } catch (err) { await failed(i, "publicpage", err); }
    }

    // ---------- /games sales and /games watch ----------
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

    // ---------- /me mydata ----------
    async function handleMyData(i) {
        if (i.options.getSubcommand() === "export") {
            const json = exportJson(db, i.user.id);
            if (!json) return eph(i, "Nothing is stored about you.");
            pushEvent(db, "adminlog:datareq", { kind: "export", via: "Discord", at: Date.now() }, 100);
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
                pushEvent(db, "adminlog:datareq", { kind: "delete", via: "Discord", at: Date.now() }, 100);
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

    /** Compares the caller's library with another member's. `pub` posts it for the channel instead of only the caller. */
    async function compareWith(i, friend, pub) {
        const reply = content => i.reply({ content, flags: MessageFlags.Ephemeral });
        if (!i.guildId) return reply("Use this in a server, so I know who you can compare with.");
        if (friend.id === i.user.id) return reply("That is you. Pick someone else.");
        if (friend.bot) return reply("Bots don't have a library.");
        if (!db.sharingMembers(i.guildId).includes(friend.id)) return reply(`${friend.displayName ?? friend.username} has not opted in. They can turn it on with \`/alerts share\`.`);
        db.ensureUser(i.user.id, i.guildId);
        const r = compareLibraries(db, i.user.id, friend.id);
        if (!r.a.games) return reply("Your library is empty. Use `/me library add`, `/me library import` or `/me steam link` first.");
        if (!r.b.games) return reply(`${friend.displayName ?? friend.username} has no games in their library yet.`);
        const name = friend.displayName ?? friend.username;
        return i.reply({ ...withCard(compareSpec(r, "You", name), "compare.png", "Library comparison", compareEmbed(r, "You", name)), ...(pub ? {} : { flags: MessageFlags.Ephemeral }) });
    }
    async function handleCompare(i) {
        return compareWith(i, i.options.getUser("friend", true), i.options.getBoolean("public") === true);
    }

    /** Right-click a member: compare libraries, or see their public wishlist. Only the caller sees the answer. */
    async function handleContextMenu(i) {
        try {
            const target = i.targetUser;
            if (i.commandName === CONTEXT_COMPARE) return await compareWith(i, target, false);
            if (i.commandName === CONTEXT_TOGETHER) {
                const name = target.displayName ?? target.username;
                if (!i.guildId) return await eph(i, "Use this in a server, so I know who you can play with.");
                if (target.id === i.user.id) return await eph(i, "That is you. Pick someone else.");
                if (target.bot) return await eph(i, "Bots don't have a library.");
                if (!db.sharingMembers(i.guildId).includes(target.id)) return await eph(i, `${name} has not opted in. They can turn it on with \`/alerts share\`.`);
                db.ensureUser(i.user.id, i.guildId);
                return await i.reply({ embeds: [playTogetherEmbed(name, playTogether(db, i.user.id, target.id))], flags: MessageFlags.Ephemeral });
            }
            if (i.commandName !== CONTEXT_WISHLIST && i.commandName !== CONTEXT_GIFTS) return;
            if (target.bot) return eph(i, "Bots don't have a wishlist.");
            const them = db.getUser(target.id);
            const name = target.displayName ?? target.username;
            if (!them?.profile_public || !them.profile_slug) return eph(i, `${name} hasn't shared a wishlist page. They can turn one on with \`/me publicpage\`.`);
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            const page = await publicWishlist(db, itad, them.profile_slug);
            if (!page) return void await i.editReply(`${name} hasn't shared a wishlist page.`);
            const link = publicUrl ? `${publicUrl}/u/${page.slug}` : null;
            await i.editReply({ embeds: [i.commandName === CONTEXT_GIFTS ? giftIdeasEmbed(name, page, link) : contextWishlistEmbed(name, page, link)] });
        } catch (err) { await failed(i, "context menu", err); }
    }

    /** Right-click a message: its text is read as a game title, to price it or to add it to the caller's wishlist. */
    async function handleMessageContext(i) {
        try {
            const title = gameTitleFromText(i.targetMessage?.content);
            if (!title) return await eph(i, "That message has no game title I can read. Try one that is just the name of a game.");
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            db.ensureUser(i.user.id, i.guildId ?? null);
            if (i.commandName === CONTEXT_OWNERS) {
                if (!i.guildId) return void await i.editReply("Use this in a server, so I know whose libraries to look at.");
                const [hit] = await itad.lookupTitles([title]);
                if (!hit?.id) throw new UserError(`I could not find a game called ${title}.`);
                const name = hit.approx ? hit.matched : title;
                const owners = db.ownersOf(i.guildId, hit.id);
                return void await i.editReply({ embeds: [ownersEmbed(name, owners)], allowedMentions: { parse: [] } });
            }
            if (i.commandName === CONTEXT_ADD) {
                const out = await addGameByTitle(db, itad, i.user.id, title, null, null);
                return void await i.editReply(`Added **${out.name}**${out.approx ? " (closest match)" : ""}. Alert: ${out.trigger}.`);
            }
            const user = db.getUser(i.user.id);
            const [hit] = await itad.lookupTitles([title]);
            if (!hit?.id) throw new UserError(`I could not find a game called ${title}.`);
            const name = hit.approx ? hit.matched : title;
            const prices = await itad.getPrices([hit.id], user.region);
            const s = summarize(prices.get(hit.id), { majorOnly: user.stores === "major" });
            const now = { ...current(s), currency: s.currency };
            if (now.price === null) throw new UserError("No current price found for that game.");
            await i.editReply({ embeds: [checkEmbed(name, now, dealVerdict(now), null, [], null)] });
        } catch (err) { await failed(i, "message menu", err); }
    }

    return { handleCoop, handleNowPlaying, handleGameNightPoll, handlePollVote, handleMessageContext, handleFriend, handleCompare, handleContextMenu, handleWishlist, handleGameNight, handleGameNightButton, handleChangelog, handleAlertButton, handleAlerts, handleLanguage, handleAlertChannel, handleLibrary, handleServerList, handleLeaderboard, handleFreeGames, handleFreeMenu, handleSales, handleWatch, handlePublicPage, handleServerStats, handleStatus, handleMyData, handleAutocomplete };
}

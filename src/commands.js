import { ApplicationIntegrationType, ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import { REGIONS, ALERT_TYPES } from "./constants.js";
export { REGIONS };

// Commands that work anywhere: installed on a server, or on a person's own account (DMs, group chats, any server).
const everywhere = b => b
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel);
// Commands about a server (alert channel, shared list, giveaways) stay in servers where the bot is installed.
const serverOnly = b => b
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild);
// Server lists, the leaderboard and server stats also work in a DM with the bot, about the server you last used it in.
const serverOrDm = b => b
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM);

const alertType = o => o.setName("type").setDescription("When to alert you").addChoices(...ALERT_TYPES);
const alertValue = o => o
    .setName("value")
    .setDescription("The percentage (for a percentage alert) or the price (for a price alert)")
    .setMinValue(0.01)
    .setMaxValue(100000);
const gameOption = (o, required = false) => o
    .setName("game").setDescription("A game on your wishlist").setAutocomplete(true).setRequired(required);

const value = new SlashCommandBuilder()
    .setName("value")
    .setDescription("Price a list of games: MSRP, Steam price, cheapest price now, and what you saved")
    .addStringOption(o => o
        .setName("titles")
        .setDescription("Game titles separated by ; or new lines. Never paste keys"))
    .addAttachmentOption(o => o
        .setName("file")
        .setDescription("FanaticalGrabber export (.csv, .json, .txt or .md). Only game titles are read"))
    .addNumberOption(o => o
        .setName("paid")
        .setDescription("Total you paid for all of these games, to see what you saved")
        .setMinValue(0)
        .setMaxValue(1000000))
    .addStringOption(o => o
        .setName("region")
        .setDescription("Price region (default United States)")
        .addChoices(...REGIONS))
    .addStringOption(o => o
        .setName("stores")
        .setDescription("Which stores count for the cheapest price (default all tracked stores)")
        .addChoices(
            { name: "All tracked stores, including key sites", value: "all" },
            { name: "Major stores only", value: "major" }
        ))
    .addStringOption(o => o
        .setName("sort")
        .setDescription("Table order (default: as entered)")
        .addChoices(
            { name: "As entered", value: "input" },
            { name: "Name (A-Z)", value: "name" },
            { name: "MSRP (high to low)", value: "msrp" },
            { name: "Cheapest price (high to low)", value: "cheapest" }
        ));

const library = new SlashCommandBuilder()
    .setName("library")
    .setDescription("Games you own and what you paid, with what they are worth now")
    .addSubcommand(s => s.setName("add").setDescription("Add a game you own")
        .addStringOption(o => o.setName("title").setDescription("Game title").setRequired(true).setMaxLength(100))
        .addNumberOption(o => o.setName("paid").setDescription("What you paid for it").setMinValue(0).setMaxValue(10000)))
    .addSubcommand(s => s.setName("import").setDescription("Add games from a FanaticalGrabber export (uses a Paid column if there is one)")
        .addAttachmentOption(o => o.setName("file").setDescription(".csv, .json, .txt or .md export").setRequired(true)))
    .addSubcommand(s => s.setName("view").setDescription("Your library value and savings"))
    .addSubcommand(s => s.setName("status").setDescription("Mark a game as backlog, playing, finished or dropped")
        .addStringOption(o => gameOption(o, true))
        .addStringOption(o => o.setName("state").setDescription("Where you are with it").setRequired(true).addChoices(
            { name: "Backlog (not started)", value: "backlog" }, { name: "Playing", value: "playing" }, { name: "Finished", value: "finished" }, { name: "Dropped", value: "dropped" })))
    .addSubcommand(s => s.setName("backlog").setDescription("How much you have spent on games you have not played, and what to play next"))
    .addSubcommand(s => s.setName("remove").setDescription("Remove a game")
        .addStringOption(o => gameOption(o, true)));

const steam = new SlashCommandBuilder()
    .setName("steam")
    .setDescription("Link your public Steam profile: playtime, cost per hour and your library, filled in for you")
    .addSubcommand(s => s.setName("link").setDescription("Link a public Steam profile and import your games")
        .addStringOption(o => o.setName("profile").setDescription("Profile link, custom name or SteamID64").setRequired(true).setMaxLength(200)))
    .addSubcommand(s => s.setName("sync").setDescription("Refresh your games and playtime from Steam"))
    .addSubcommand(s => s.setName("view").setDescription("Playtime, best and worst value per hour, and what you never played"))
    .addSubcommand(s => s.setName("unlink").setDescription("Forget your Steam profile")
        .addBooleanOption(o => o.setName("remove_games").setDescription("Also remove the games that came from Steam")));

const bundle = new SlashCommandBuilder()
    .setName("bundle")
    .setDescription("Is a bundle worth it? Tier prices against what the games cost today, skipping ones you own")
    .addStringOption(o => o.setName("game").setDescription("A game to look for (default: bundles with anything on your wishlist)").setMaxLength(100));

const saleprep = new SlashCommandBuilder()
    .setName("saleprep")
    .setDescription("Get your wishlist ready for a Steam sale, or see what your alerts caught")
    .addSubcommand(s => s.setName("plan").setDescription("What to buy now, what to wait on, and what fits a budget")
        .addNumberOption(o => o.setName("budget").setDescription("How much you want to spend").setMinValue(1).setMaxValue(10000)))
    .addSubcommand(s => s.setName("recap").setDescription("The drops your alerts caught recently")
        .addIntegerOption(o => o.setName("days").setDescription("How far back (default 14)").setMinValue(1).setMaxValue(90)));

const lfgCmd = new SlashCommandBuilder()
    .setName("lfg")
    .setDescription("Looking for group: find people to play with, with a join button and a reminder")
    .addSubcommand(s => s.setName("post").setDescription("Post a game and a time in this channel")
        .addStringOption(o => o.setName("game").setDescription("What you want to play").setRequired(true).setMaxLength(80))
        .addStringOption(o => o.setName("when").setDescription("e.g. 8pm, tonight 8pm, tomorrow 19:30, in 2 hours").setRequired(true).setMaxLength(40))
        .addIntegerOption(o => o.setName("slots").setDescription("How many players, counting you (default 4)").setMinValue(2).setMaxValue(20))
        .addStringOption(o => o.setName("note").setDescription("Anything else, like skill level or voice channel").setMaxLength(200))
        .addBooleanOption(o => o.setName("event").setDescription("Also create a Discord event (the bot needs Manage Events)")))
    .addSubcommand(s => s.setName("list").setDescription("Open posts in this server"))
    .addSubcommand(s => s.setName("close").setDescription("Close a post you made (managers can close any)")
        .addIntegerOption(o => o.setName("id").setDescription("The post number from /lfg list").setRequired(true).setMinValue(1)));

const serverlist = new SlashCommandBuilder()
    .setName("serverlist")
    .setDescription("A wishlist shared by this server, with votes")
    .addSubcommand(s => s.setName("add").setDescription("Suggest a game for the server")
        .addStringOption(o => o.setName("title").setDescription("Game title").setRequired(true).setMaxLength(100)))
    .addSubcommand(s => s.setName("view").setDescription("The server's list, most votes first, with current prices"))
    .addSubcommand(s => s.setName("vote").setDescription("Vote for (or take back your vote on) a game")
        .addStringOption(o => gameOption(o, true)))
    .addSubcommand(s => s.setName("remove").setDescription("Remove a game (the person who added it, or Manage Server)")
        .addStringOption(o => gameOption(o, true)));

const leaderboard = new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Who in this server has saved the most (members who opted in with /alerts share)");

const giveawayOption = o => o.setName("giveaway").setDescription("Which giveaway").setRequired(true).setAutocomplete(true);
const giveaway = new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Run a giveaway of game keys in your server")
    .addSubcommand(s => s.setName("create").setDescription("Start a giveaway. You will be asked for the prize keys in a private form")
        .addStringOption(o => o.setName("title").setDescription("Title (optional, made from the prizes)").setRequired(false).setMaxLength(100))
        .addStringOption(o => o.setName("length").setDescription("How long it runs (default 24h), e.g. 90m, 2h, 3d, 1w, 1d12h").setRequired(false).setMaxLength(20))
        .addChannelOption(o => o.setName("channel").setDescription("Where to post it (default: here)").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addStringOption(o => o.setName("game").setDescription("Game name, used to find artwork automatically").setMaxLength(100))
        .addStringOption(o => o.setName("description").setDescription("Extra text on the giveaway").setMaxLength(1500))
        .addStringOption(o => o.setName("image").setDescription("Your own image, GIF or video link (https). Skips automatic artwork").setMaxLength(500))
        .addStringOption(o => o.setName("thumbnail").setDescription("Your own small picture or GIF (https link)").setMaxLength(500))
        .addBooleanOption(o => o.setName("noautoimage").setDescription("Do not look up artwork automatically"))
        .addStringOption(o => o.setName("color").setDescription("Embed color, like #5865F2").setMaxLength(8))
        .addStringOption(o => o.setName("buttonlabel").setDescription("Text on the enter button").setMaxLength(40))
        .addRoleOption(o => o.setName("requirerole").setDescription("Only members with this role can enter"))
        .addRoleOption(o => o.setName("bonusrole").setDescription("Members with this role get extra entries"))
        .addIntegerOption(o => o.setName("bonusentries").setDescription("Entries for the bonus role (2 to 10)").setMinValue(2).setMaxValue(10))
        .addRoleOption(o => o.setName("pingrole").setDescription("Role to ping when it starts"))
        .addIntegerOption(o => o.setName("claimhours").setDescription("Hours a winner has to claim (default 48)").setMinValue(1).setMaxValue(168))
        .addIntegerOption(o => o.setName("accountage").setDescription("Minimum Discord account age in days").setMinValue(0).setMaxValue(3650))
        .addIntegerOption(o => o.setName("memberage").setDescription("Minimum days in this server").setMinValue(0).setMaxValue(3650))
        .addChannelOption(o => o.setName("vouchchannel").setDescription("Where to post the winner's confirmation (default: #vouches)").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addBooleanOption(o => o.setName("boosters").setDescription("Only server boosters can enter"))
        .addStringOption(o => o.setName("startin").setDescription("Start later instead of now, e.g. 2h, 1d, 1w").setMaxLength(20))
        .addIntegerOption(o => o.setName("rounds").setDescription("Repeat as a series: split the prizes over this many rounds (2 to 12)").setMinValue(2).setMaxValue(12))
        .addStringOption(o => o.setName("repeatevery").setDescription("Time between rounds, e.g. 7d (needs rounds)").setMaxLength(20)))
    .addSubcommand(s => s.setName("list").setDescription("Giveaways in this server"))
    .addSubcommand(s => s.setName("info").setDescription("Where each prize is (keys are never shown)").addStringOption(giveawayOption))
    .addSubcommand(s => s.setName("end").setDescription("End a giveaway now and draw the winners").addStringOption(giveawayOption))
    .addSubcommand(s => s.setName("cancel").setDescription("Cancel a giveaway. Unused keys are sent back to you").addStringOption(giveawayOption))
    .addSubcommand(s => s.setName("reroll").setDescription("Draw again for prizes with no winner, or replace one winner")
        .addStringOption(giveawayOption).addUserOption(o => o.setName("winner").setDescription("Replace this winner")))
    .addSubcommand(s => s.setName("replace").setDescription("Give a winner a new key (for example if theirs did not work)")
        .addStringOption(giveawayOption).addUserOption(o => o.setName("winner").setDescription("The winner").setRequired(true)))
    .addSubcommand(s => s.setName("setup").setDescription("Vouches channel and who else can run giveaways")
        .addChannelOption(o => o.setName("vouchchannel").setDescription("Where confirmations are posted").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addRoleOption(o => o.setName("managerrole").setDescription("Members with this role can run giveaways"))
        .addBooleanOption(o => o.setName("clear").setDescription("Reset both settings")));

const freegames = new SlashCommandBuilder()
    .setName("freegames")
    .setDescription("Games that are free to claim right now on Steam, Epic, GOG and others")
    .addStringOption(o => o.setName("store").setDescription("Only this store, e.g. steam, epic, gog").setMaxLength(40))
    .addBooleanOption(o => o.setName("public").setDescription("Post it in the channel so everyone can see (default: only you)"));

const help = new SlashCommandBuilder().setName("help").setDescription("How to use Steam Value Checker");
const about = new SlashCommandBuilder().setName("about").setDescription("About this bot and its price data");
const privacy = new SlashCommandBuilder().setName("privacy").setDescription("What the bot does and does not do with your data");

const wishlist = new SlashCommandBuilder()
    .setName("wishlist")
    .setDescription("Your wishlist and sale alerts")
    .addSubcommand(s => s.setName("import").setDescription("Import your public Steam wishlist")
        .addStringOption(o => o.setName("profile").setDescription("Steam profile link, custom name or SteamID64. No login needed").setRequired(true)))
    .addSubcommand(s => s.setName("add").setDescription("Add one game by title")
        .addStringOption(o => o.setName("title").setDescription("Game title").setRequired(true).setMaxLength(100))
        .addStringOption(alertType).addNumberOption(alertValue))
    .addSubcommand(s => s.setName("remove").setDescription("Remove a game")
        .addStringOption(o => gameOption(o, true)))
    .addSubcommand(s => s.setName("view").setDescription("See your wishlist with current prices"))
    .addSubcommand(s => s.setName("check").setDescription("Is a wishlist game a good deal right now? Shows its lows")
        .addStringOption(o => gameOption(o, true)))
    .addSubcommand(s => s.setName("alert").setDescription("Change when a game (or all games) alerts you")
        .addStringOption(o => alertType(o).setRequired(true))
        .addNumberOption(alertValue)
        .addStringOption(o => gameOption(o).setDescription("One game. Leave empty to change every game")));

const status = new SlashCommandBuilder()
    .setName("status")
    .setDescription("Is the bot healthy? Live checks, uptime and any recent incidents");

const publicpage = new SlashCommandBuilder()
    .setName("publicpage")
    .setDescription("A public page of your wishlist and its best prices that you can share, for gifts")
    .addBooleanOption(o => o.setName("enabled").setDescription("Turn the page on or off").setRequired(true))
    .addStringOption(o => o.setName("name").setDescription("Page name, 3 to 24 letters, numbers, - or _").setMinLength(3).setMaxLength(24));

const sales = new SlashCommandBuilder()
    .setName("sales")
    .setDescription("Upcoming Steam sales and festivals, with countdowns");

const watch = new SlashCommandBuilder()
    .setName("watch")
    .setDescription("Watch one game for a price drop without adding it to your wishlist. It is removed after the alert")
    .addStringOption(o => o.setName("title").setDescription("Game title").setRequired(true).setMaxLength(100))
    .addStringOption(alertType).addNumberOption(alertValue);

const alerts = new SlashCommandBuilder()
    .setName("alerts")
    .setDescription("How and where you get sale alerts")
    .addSubcommand(s => s.setName("status").setDescription("See your alert settings"))
    .addSubcommand(s => s.setName("delivery").setDescription("Get alerts by DM or in the server's alert channel")
        .addStringOption(o => o.setName("mode").setDescription("Where alerts go").setRequired(true).addChoices(
            { name: "Direct message (falls back to the server channel if DMs are closed)", value: "dm" },
            { name: "Server alert channel only (you get mentioned there)", value: "channel" }
        )))
    .addSubcommand(s => s.setName("pause").setDescription("Stop all alerts until you resume"))
    .addSubcommand(s => s.setName("resume").setDescription("Start alerts again"))
    .addSubcommand(s => s.setName("region").setDescription("Which country's prices to watch")
        .addStringOption(o => o.setName("region").setDescription("Region").setRequired(true).addChoices(...REGIONS)))
    .addSubcommand(s => s.setName("stores").setDescription("Which stores count for alerts")
        .addStringOption(o => o.setName("stores").setDescription("Stores").setRequired(true).addChoices(
            { name: "Major stores only (recommended)", value: "major" },
            { name: "All tracked stores, including key sites", value: "all" }
        )));

alerts
    .addSubcommand(s => s.setName("quiethours").setDescription("Hold alerts during certain hours (they are sent after)")
        .addStringOption(o => o.setName("start").setDescription("When quiet hours start, e.g. 22:00 or 10pm"))
        .addStringOption(o => o.setName("end").setDescription("When they end, e.g. 07:00 or 7am"))
        .addStringOption(o => o.setName("timezone").setDescription("Your time zone, e.g. America/New_York").setMaxLength(60))
        .addBooleanOption(o => o.setName("off").setDescription("Turn quiet hours off")))
    .addSubcommand(s => s.setName("digest").setDescription("A weekly summary of your wishlist sales")
        .addBooleanOption(o => o.setName("enabled").setDescription("On or off").setRequired(true))
        .addIntegerOption(o => o.setName("day").setDescription("Day it is sent (from 9:00 your time)").addChoices(
            { name: "Sunday", value: 0 }, { name: "Monday", value: 1 }, { name: "Tuesday", value: 2 }, { name: "Wednesday", value: 3 },
            { name: "Thursday", value: 4 }, { name: "Friday", value: 5 }, { name: "Saturday", value: 6 })))
    .addSubcommand(s => s.setName("bundles").setDescription("Alerts when a wishlist game is in a bundle or given away")
        .addBooleanOption(o => o.setName("enabled").setDescription("On or off").setRequired(true)))
    .addSubcommand(s => s.setName("freegames").setDescription("Get told when a game is free to claim on Steam, Epic, GOG and others")
        .addBooleanOption(o => o.setName("enabled").setDescription("On or off").setRequired(true))
        .addBooleanOption(o => o.setName("dlc").setDescription("Also show free DLC and add-ons (default on)")))
    .addSubcommand(s => s.setName("mute").setDescription("Stop DMs for one kind of alert (you can still read them on the dashboard's Notifications page)")
        .addStringOption(o => o.setName("type").setDescription("Which alerts").setRequired(true).addChoices(
            { name: "Sale alerts", value: "alert" }, { name: "Bundle and giveaway alerts", value: "bundle" }, { name: "Free game alerts", value: "free" }, { name: "Weekly digest", value: "digest" }))
        .addBooleanOption(o => o.setName("muted").setDescription("True to mute, false to get them again").setRequired(true)))
    .addSubcommand(s => s.setName("language").setDescription("Language for the bot's buttons and messages")
        .addStringOption(o => o.setName("language").setDescription("Language").setRequired(true).addChoices({ name: "English", value: "en" }, { name: "Español", value: "es" }, { name: "Français", value: "fr" })))
    .addSubcommand(s => s.setName("share").setDescription("Count you in server group alerts and the leaderboard (off by default)")
        .addBooleanOption(o => o.setName("enabled").setDescription("On or off").setRequired(true)))
    .addSubcommand(s => s.setName("history").setDescription("Your recent alerts"));

const alertchannel = new SlashCommandBuilder()
    .setName("alertchannel")
    .setDescription("Server admins: choose where alerts go when a DM fails or a member opts out of DMs")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName("set").setDescription("Set the alert channel")
        .addChannelOption(o => o.setName("channel").setDescription("Text channel").setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand(s => s.setName("clear").setDescription("Remove the alert channel"))
    .addSubcommand(s => s.setName("show").setDescription("Show the current alert channel"))
    .addSubcommand(s => s.setName("feed").setDescription("Post new free games in the alert channel for everyone (games only, no DLC)")
        .addBooleanOption(o => o.setName("enabled").setDescription("On or off").setRequired(true)))
    .addSubcommand(s => s.setName("group").setDescription("Post when several opted-in members watch the same game and it hits their alert")
        .addIntegerOption(o => o.setName("minimum").setDescription("How many members (2 to 20). 0 turns it off").setRequired(true).setMinValue(0).setMaxValue(20)));

const serverstats = new SlashCommandBuilder()
    .setName("serverstats")
    .setDescription("This server's numbers: most wanted games, savings and top savers (members who opted in)");

const mydata = new SlashCommandBuilder()
    .setName("mydata")
    .setDescription("See or delete everything the bot stores about you")
    .addSubcommand(s => s.setName("export").setDescription("Download your stored data"))
    .addSubcommand(s => s.setName("delete").setDescription("Delete your wishlist and settings"));

const gamenight = new SlashCommandBuilder().setName("gamenight")
    .setDescription("What can everyone in your voice channel play together, and what is worth buying together?")
    .addChannelOption(o => o.setName("channel").setDescription("A voice channel (default: the one you are in)").addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice))
    .addBooleanOption(o => o.setName("post").setDescription("Show it to everyone in this channel (default: only you)"));

const setup = new SlashCommandBuilder().setName("setup").setDescription("Server managers: guided setup for alerts, support tickets and giveaways")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

const changelog = new SlashCommandBuilder().setName("changelog").setDescription("What is new in the bot");

const support = new SlashCommandBuilder()
    .setName("support")
    .setDescription("Get help from the bot's team")
    .addSubcommand(s => s.setName("open").setDescription("Open a support ticket"))
    .addSubcommand(s => s.setName("mine").setDescription("See your tickets"))
    .addSubcommand(s => s.setName("setup").setDescription("Staff: choose the channel where tickets are posted")
        .addChannelOption(o => o.setName("channel").setDescription("Text channel").setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addRoleOption(o => o.setName("staffrole").setDescription("Role that may answer tickets (Manage Server always can)"))
        .addBooleanOption(o => o.setName("global").setDescription("Bot owner only: set the channel for tickets with no server queue")));

export const commands = [
    ...[value, wishlist, watch, sales, publicpage, status, alerts, library, freegames, steam, bundle, saleprep, support, changelog, mydata, help, about, privacy].map(everywhere),
    ...[alertchannel, giveaway, setup, gamenight, lfgCmd].map(serverOnly),
    ...[serverlist, leaderboard, serverstats].map(serverOrDm)
].map(c => c.toJSON());

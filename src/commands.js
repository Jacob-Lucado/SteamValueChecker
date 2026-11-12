import { ApplicationCommandType, ApplicationIntegrationType, ChannelType, ContextMenuCommandBuilder, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import { REGIONS, ALERT_TYPES } from "./constants.js";
import { CATEGORIES } from "./stations.js";
import { MENU } from "./hubpanel.js";
import { LANGS } from "./i18n.js";
const LANG_CHOICES = Object.entries(LANGS).map(([value, name]) => ({ name, value }));
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
        .setDescription("Price region and currency (default: the one you saved, else United States)")
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
    .addSubcommand(s => s.setName("news").setDescription("The latest patch notes and announcements for your games"))
    .addSubcommand(s => s.setName("add").setDescription("Add a game you own")
        .addStringOption(o => o.setName("title").setDescription("Game title").setRequired(true).setMaxLength(100))
        .addNumberOption(o => o.setName("paid").setDescription("What you paid for it").setMinValue(0).setMaxValue(10000)))
    .addSubcommand(s => s.setName("import").setDescription("Add games from a FanaticalGrabber export (uses a Paid column if there is one)")
        .addAttachmentOption(o => o.setName("file").setDescription(".csv, .json, .txt or .md export").setRequired(true)))
    .addSubcommand(s => s.setName("grabber").setDescription("Get a link code so the FanaticalGrabber extension can send games straight to your library")
        .addStringOption(o => o.setName("action").setDescription("What to do (default: make a code)").addChoices(
            { name: "Make a new link code", value: "new" }, { name: "Turn the link off", value: "off" })))
    .addSubcommand(s => s.setName("view").setDescription("Your library value and savings"))
    .addSubcommand(s => s.setName("status").setDescription("Mark a game as backlog, playing, finished or dropped")
        .addStringOption(o => gameOption(o, true))
        .addStringOption(o => o.setName("state").setDescription("Where you are with it").setRequired(true).addChoices(
            { name: "Backlog (not started)", value: "backlog" }, { name: "Playing", value: "playing" }, { name: "Played (not finished)", value: "played" }, { name: "Finished", value: "finished" }, { name: "Dropped", value: "dropped" })))
    .addSubcommand(s => s.setName("badges").setDescription("Your trophy case: badges earned from your library and challenge streak"))
    .addSubcommand(s => s.setName("spend").setDescription("What you have spent: by month, cost per hour played, and bought-but-unplayed"))
    .addSubcommand(s => s.setName("challenge").setDescription("Monthly backlog challenge: set a goal of games to finish, keep a streak")
        .addIntegerOption(o => o.setName("goal").setDescription("Games to finish this month (1 to 20). 0 clears it. Leave empty to see progress").setMinValue(0).setMaxValue(20)))
    .addSubcommand(s => s.setName("trend").setDescription("How your library value and backlog have changed over time"))
    .addSubcommand(s => s.setName("backlog").setDescription("How much you have spent on games you have not played, and what to play next"))
    .addSubcommand(s => s.setName("bundle").setDescription("Record a bundle you bought: the games go in your library and it tracks what you got for your money")
        .addStringOption(o => o.setName("name").setDescription("Bundle name").setRequired(true).setMaxLength(80))
        .addNumberOption(o => o.setName("paid").setDescription("What you paid for the whole bundle").setRequired(true).setMinValue(0).setMaxValue(10000))
        .addStringOption(o => o.setName("titles").setDescription("The games in it, separated by commas").setRequired(true).setMaxLength(1500)))
    .addSubcommand(s => s.setName("bundles").setDescription("Your bundles: what you paid, what the games are worth now and hours played")
        .addIntegerOption(o => o.setName("remove").setDescription("A bundle number to remove from the tracker").setMinValue(1)))
    .addSubcommand(s => s.setName("remove").setDescription("Remove a game")
        .addStringOption(o => gameOption(o, true)));

const steam = new SlashCommandBuilder()
    .setName("steam")
    .setDescription("Link your public Steam profile: your library, hours played, account value and what to play next")
    .addSubcommand(s => s.setName("link").setDescription("Link your Steam account (sign in through Steam on the dashboard) and import your games")
        .addStringOption(o => o.setName("profile").setDescription("Optional: a profile link, custom name or SteamID64 instead of signing in through Steam").setMaxLength(200)))
    .addSubcommand(s => s.setName("sync").setDescription("Refresh your games and playtime from Steam"))
    .addSubcommand(s => s.setName("taste").setDescription("Your taste in games from what you play, and wishlist picks that fit it"))
    .addSubcommand(s => s.setName("recap").setDescription("Hours tracked this year and since you linked Steam, per month, and your top games")
        .addBooleanOption(o => o.setName("public").setDescription("Post it in the channel so others can see it")))
    .addSubcommand(s => s.setName("wrapped").setDescription("Your year in games as five shareable pictures: hours, top games, best month and player type")
        .addIntegerOption(o => o.setName("year").setDescription("Which year (default: this one)").setMinValue(2020).setMaxValue(2100))
        .addBooleanOption(o => o.setName("public").setDescription("Post it in the channel so others can see it")))
    .addSubcommand(s => s.setName("goal").setDescription("Set a goal for hours played this year and see how you are tracking")
        .addIntegerOption(o => o.setName("hours").setDescription("Hours to play this year (1 to 5000). 0 clears it. Leave empty to see progress").setMinValue(0).setMaxValue(5000)))
    .addSubcommand(s => s.setName("view").setDescription("Your Steam library: games, hours played, what you never played and what it is worth"))
    .addSubcommand(s => s.setName("next").setDescription("What should I play next? A pick from your own library"))
    .addSubcommand(s => s.setName("verify").setDescription("Get the Steam Verified role here and show your Steam on your Discord profile"))
    .addSubcommand(s => s.setName("foryou").setDescription("Deals picked for you: current discounts ranked by how well they fit your taste and wishlist"))
    .addSubcommand(s => s.setName("value").setDescription("Your Steam account value as a picture: at full price, today's cheapest and all-time-low prices")
        .addBooleanOption(o => o.setName("public").setDescription("Post it in the channel so others can see it")))
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
    .setDescription("Looking for group: a join button and a reminder")
    .addSubcommand(s => s.setName("post").setDescription("Post a game and a time in this channel")
        .addStringOption(o => o.setName("game").setDescription("What you want to play").setRequired(true).setMaxLength(80))
        .addStringOption(o => o.setName("when").setDescription("e.g. 8pm, tomorrow 19:30, in 2 hours").setRequired(true).setMaxLength(40))
        .addIntegerOption(o => o.setName("slots").setDescription("How many players, counting you (default 4)").setMinValue(2).setMaxValue(20))
        .addStringOption(o => o.setName("note").setDescription("Anything else, like skill level").setMaxLength(200))
        .addBooleanOption(o => o.setName("event").setDescription("Also create a Discord event")))
    .addSubcommand(s => s.setName("list").setDescription("Open posts in this server"))
    .addSubcommand(s => s.setName("close").setDescription("Close a post you made (managers can close any)")
        .addIntegerOption(o => o.setName("id").setDescription("The post number from /server lfg list").setRequired(true).setMinValue(1)));

const calendarCmd = new SlashCommandBuilder()
    .setName("calendar")
    .setDescription("Coming up: game releases, Steam sales and server events")
    .addSubcommand(s => s.setName("view").setDescription("Releases, sales, events and group games coming up")
        .addIntegerOption(o => o.setName("days").setDescription("How far ahead (default 14)").setMinValue(1).setMaxValue(90)))
    .addSubcommand(s => s.setName("add").setDescription("Managers: add a server event and announce it here")
        .addStringOption(o => o.setName("title").setDescription("What is happening").setRequired(true).setMaxLength(80))
        .addStringOption(o => o.setName("when").setDescription("e.g. tomorrow 19:30 or friday 9pm").setRequired(true).setMaxLength(40))
        .addStringOption(o => o.setName("notes").setDescription("Details, like the game or voice channel").setMaxLength(400))
        .addBooleanOption(o => o.setName("announce").setDescription("Post it here and remind members (default on)"))
        .addIntegerOption(o => o.setName("reminder").setDescription("When to remind (default 1 hour before)").addChoices(
            { name: "No reminder", value: 0 }, { name: "15 minutes before", value: 15 }, { name: "1 hour before", value: 60 }, { name: "1 day before", value: 1440 })))
    .addSubcommand(s => s.setName("remove").setDescription("Remove a server event (managers)")
        .addIntegerOption(o => o.setName("id").setDescription("The event number from /server calendar view").setRequired(true).setMinValue(1)))
    .addSubcommand(s => s.setName("feed").setDescription("A private link for Google, Apple or Outlook calendars")
        .addStringOption(o => o.setName("action").setDescription("What to do (default: make a link)").addChoices(
            { name: "Make a new link", value: "new" }, { name: "Turn the link off", value: "off" })));

const serverlist = new SlashCommandBuilder()
    .setName("serverlist")
    .setDescription("A wishlist shared by this server, with votes")
    .addSubcommand(s => s.setName("add").setDescription("Suggest a game for the server")
        .addStringOption(o => o.setName("title").setDescription("Game title").setRequired(true).setMaxLength(100)))
    .addSubcommand(s => s.setName("view").setDescription("The server's list, most votes first, with prices"))
    .addSubcommand(s => s.setName("vote").setDescription("Vote for (or take back your vote on) a game")
        .addStringOption(o => gameOption(o, true)))
    .addSubcommand(s => s.setName("remove").setDescription("Remove a game (who added it, or Manage Server)")
        .addStringOption(o => gameOption(o, true)));

const leaderboard = new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Boards for members who opted in with /alerts share")
    .addStringOption(o => o.setName("board").setDescription("Which board (default: savings)")
        .addChoices({ name: "Most saved vs MSRP", value: "savings" }, { name: "Backlog league: most finished this month", value: "finished" }, { name: "Most hours played this year", value: "hours" }, { name: "Biggest library", value: "games" }, { name: "Most games finished, all time", value: "completed" }, { name: "Server wrapped", value: "wrapped" }));

const giveawayOption = o => o.setName("giveaway").setDescription("Which giveaway").setRequired(true).setAutocomplete(true);
const giveaway = new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Run a giveaway of game keys in your server")
    .addSubcommand(s => s.setName("create").setDescription("Start a giveaway. Prize keys go in a private form")
        .addStringOption(o => o.setName("title").setDescription("Title (optional)").setRequired(false).setMaxLength(100))
        .addStringOption(o => o.setName("length").setDescription("How long it runs (default 24h), e.g. 2h or 3d").setRequired(false).setMaxLength(20))
        .addChannelOption(o => o.setName("channel").setDescription("Where to post it (default: here)").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addStringOption(o => o.setName("game").setDescription("Game name, for automatic artwork").setMaxLength(100))
        .addStringOption(o => o.setName("description").setDescription("Extra text on the giveaway").setMaxLength(1500))
        .addStringOption(o => o.setName("image").setDescription("Your own image or GIF link (https)").setMaxLength(500))
        .addStringOption(o => o.setName("thumbnail").setDescription("Your own small picture (https)").setMaxLength(500))
        .addBooleanOption(o => o.setName("noautoimage").setDescription("Skip automatic artwork"))
        .addStringOption(o => o.setName("color").setDescription("Embed color, like #5865F2").setMaxLength(8))
        .addStringOption(o => o.setName("buttonlabel").setDescription("Text on the enter button").setMaxLength(40))
        .addRoleOption(o => o.setName("requirerole").setDescription("Role needed to enter"))
        .addRoleOption(o => o.setName("bonusrole").setDescription("Role that gets extra entries"))
        .addIntegerOption(o => o.setName("bonusentries").setDescription("Bonus role entries (2 to 10)").setMinValue(2).setMaxValue(10))
        .addRoleOption(o => o.setName("pingrole").setDescription("Role to ping at the start"))
        .addIntegerOption(o => o.setName("claimhours").setDescription("Hours to claim (default 48)").setMinValue(1).setMaxValue(168))
        .addIntegerOption(o => o.setName("accountage").setDescription("Minimum account age in days").setMinValue(0).setMaxValue(3650))
        .addIntegerOption(o => o.setName("memberage").setDescription("Minimum days in this server").setMinValue(0).setMaxValue(3650))
        .addChannelOption(o => o.setName("vouchchannel").setDescription("Where winners confirm (default #vouches)").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addBooleanOption(o => o.setName("boosters").setDescription("Only server boosters can enter"))
        .addBooleanOption(o => o.setName("steamverified").setDescription("Only Steam Verified members can enter"))
        .addStringOption(o => o.setName("startin").setDescription("Start later, e.g. 2h or 1d").setMaxLength(20))
        .addIntegerOption(o => o.setName("rounds").setDescription("Split the prizes over this many rounds").setMinValue(2).setMaxValue(12))
        .addStringOption(o => o.setName("repeatevery").setDescription("Time between rounds, e.g. 7d").setMaxLength(20)))
    .addSubcommand(s => s.setName("rules").setDescription("Change who can enter a giveaway")
        .addStringOption(giveawayOption)
        .addRoleOption(o => o.setName("requirerole").setDescription("Role needed to enter"))
        .addRoleOption(o => o.setName("requirerole2").setDescription("Another role"))
        .addBooleanOption(o => o.setName("needall").setDescription("Need every role, not just one"))
        .addRoleOption(o => o.setName("overriderole").setDescription("Skips all requirements (Booster?)"))
        .addRoleOption(o => o.setName("bonusrole").setDescription("Gets extra entries"))
        .addIntegerOption(o => o.setName("bonusentries").setDescription("Bonus entries (2 to 10)").setMinValue(2).setMaxValue(10))
        .addBooleanOption(o => o.setName("steamverified").setDescription("Steam Verified only"))
        .addBooleanOption(o => o.setName("clear").setDescription("Clear the old role rules first")))
    .addSubcommand(s => s.setName("list").setDescription("Giveaways in this server"))
    .addSubcommand(s => s.setName("info").setDescription("Where each prize is (keys are never shown)").addStringOption(giveawayOption))
    .addSubcommand(s => s.setName("end").setDescription("End a giveaway now and draw the winners").addStringOption(giveawayOption))
    .addSubcommand(s => s.setName("cancel").setDescription("Cancel a giveaway; unused keys come back to you").addStringOption(giveawayOption))
    .addSubcommand(s => s.setName("reroll").setDescription("Draw again for prizes with no winner, or replace one winner")
        .addStringOption(giveawayOption).addUserOption(o => o.setName("winner").setDescription("Replace this winner")))
    .addSubcommand(s => s.setName("replace").setDescription("Give a winner a new key if theirs did not work")
        .addStringOption(giveawayOption).addUserOption(o => o.setName("winner").setDescription("The winner").setRequired(true)))
    .addSubcommand(s => s.setName("setup").setDescription("Vouches channel and who else can run giveaways")
        .addChannelOption(o => o.setName("vouchchannel").setDescription("Where confirmations are posted").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addRoleOption(o => o.setName("managerrole").setDescription("Members with this role can run giveaways"))
        .addChannelOption(o => o.setName("giveawaychannel").setDescription("Where network-wide giveaways are shown").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addBooleanOption(o => o.setName("clear").setDescription("Reset these settings")));

const freegames = new SlashCommandBuilder()
    .setName("freegames")
    .setDescription("Games that are free to claim right now on Steam, Epic, GOG and others")
    .addStringOption(o => o.setName("store").setDescription("Only this store, e.g. steam, epic, gog").setMaxLength(40))
    .addBooleanOption(o => o.setName("public").setDescription("Post it in the channel so everyone can see (default: only you)"));

const help = new SlashCommandBuilder().setName("help").setDescription("How to use Steam Value Checker");
const DASH_PAGES = [["Library", "library"], ["Steam", "steam"], ["Value checker", "value"], ["Wishlist", "wishlist"], ["For you", "foryou"], ["Free games", "free"], ["Servers", "servers"], ["Community", "community"], ["Server XP", "xp"], ["Moderation", "mod"], ["Alert settings", "alerts"], ["Help", "help"]];
const dashCmd = name => new SlashCommandBuilder().setName(name).setDescription("Get the link to the dashboard")
    .addStringOption(o => o.setName("page").setDescription("Open a specific page").addChoices(...DASH_PAGES.map(([n, v]) => ({ name: n, value: v }))));
const about = new SlashCommandBuilder().setName("about").setDescription("About this bot and its price data");
const vote = new SlashCommandBuilder().setName("vote").setDescription("Vote for the bot on Top.gg and get bonus XP");
const privacy = new SlashCommandBuilder().setName("privacy").setDescription("What the bot does and does not do with your data");

const wishlist = new SlashCommandBuilder()
    .setName("wishlist")
    .setDescription("Your wishlist and sale alerts")
    .addSubcommand(s => s.setName("import").setDescription("Import your public Steam wishlist")
        .addStringOption(o => o.setName("profile").setDescription("Optional: a Steam profile link or ID. Leave empty to use the Steam account you signed in with")))
    .addSubcommand(s => s.setName("add").setDescription("Add one game by title")
        .addStringOption(o => o.setName("title").setDescription("Game title").setRequired(true).setMaxLength(100))
        .addStringOption(alertType).addNumberOption(alertValue))
    .addSubcommand(s => s.setName("remove").setDescription("Remove a game")
        .addStringOption(o => gameOption(o, true)))
    .addSubcommand(s => s.setName("cleanup").setDescription("Remove wishlist games you already own (they are in your library)"))
    .addSubcommand(s => s.setName("priority").setDescription("Star a game: listed first, and its alerts come through quiet hours")
        .addStringOption(o => gameOption(o, true))
        .addBooleanOption(o => o.setName("starred").setDescription("Star it (default) or false to remove the star")))
    .addSubcommand(s => s.setName("view").setDescription("See your wishlist with current prices"))
    .addSubcommand(s => s.setName("check").setDescription("Is a wishlist game a good deal right now? Shows its lows")
        .addStringOption(o => gameOption(o, true)))
    .addSubcommand(s => s.setName("alert").setDescription("Change when a game (or all games) alerts you")
        .addStringOption(o => alertType(o).setRequired(true))
        .addNumberOption(alertValue)
        .addStringOption(o => gameOption(o).setDescription("One game. Leave empty to change every game")));

const friendCmd = new SlashCommandBuilder()
    .setName("friend")
    .setDescription("Gift helper: your friends' birthdays and what is on sale on their public wishlists")
    .addSubcommand(s => s.setName("add").setDescription("Add or update a friend (a reminder comes a week before their birthday)")
        .addStringOption(o => o.setName("name").setDescription("A nickname").setRequired(true).setMaxLength(30))
        .addStringOption(o => o.setName("birthday").setDescription("Month and day as MM-DD, for example 03-27").setMaxLength(5))
        .addStringOption(o => o.setName("page").setDescription("Their public wishlist page name (from /me publicpage)").setMaxLength(24)))
    .addSubcommand(s => s.setName("list").setDescription("Your friends and their upcoming birthdays"))
    .addSubcommand(s => s.setName("deals").setDescription("What is on sale on a friend's public wishlist")
        .addStringOption(o => o.setName("name").setDescription("The friend").setRequired(true).setMaxLength(30)))
    .addSubcommand(s => s.setName("remove").setDescription("Remove a friend")
        .addStringOption(o => o.setName("name").setDescription("The friend").setRequired(true).setMaxLength(30)));

const status = new SlashCommandBuilder()
    .setName("status")
    .setDescription("Is the bot healthy? Live checks, uptime and any recent incidents");

const publicpage = new SlashCommandBuilder()
    .setName("publicpage")
    .setDescription("A public page of your wishlist and its best prices that you can share, for gifts")
    .addBooleanOption(o => o.setName("share").setDescription("Post your page link in this channel for everyone to see"))
    .addBooleanOption(o => o.setName("enabled").setDescription("Turn the page on or off"))
    .addStringOption(o => o.setName("name").setDescription("Page name, 3 to 24 letters, numbers, - or _").setMinLength(3).setMaxLength(24))
    .addBooleanOption(o => o.setName("reset_claims").setDescription("Clear every \"I'm gifting this\" mark visitors made on your page"));

const currency = new SlashCommandBuilder()
    .setName("currency")
    .setDescription("Choose the currency prices are shown in (also used on the dashboard). Leave empty to see yours")
    .addStringOption(o => o.setName("currency").setDescription("Currency and region").addChoices(...REGIONS));

const redeem = new SlashCommandBuilder()
    .setName("redeem")
    .setDescription("Redeem Steam keys in a batch: queue them here, then confirm on the dashboard")
    .addStringOption(o => o.setName("keys").setDescription("Steam keys (AAAAA-BBBBB-CCCCC), separated by spaces or lines").setMaxLength(6000))
    .addAttachmentOption(o => o.setName("file").setDescription("A .txt, .csv or .json file with keys (a FanaticalGrabber export works)"))
    .addBooleanOption(o => o.setName("cancel").setDescription("Cancel the batch that is waiting"))
    .addBooleanOption(o => o.setName("history").setDescription("Show how your recent keys turned out"));

const compare = new SlashCommandBuilder()
    .setName("compare")
    .setDescription("Compare libraries with a friend: shared games")
    .addUserOption(o => o.setName("friend").setDescription("Someone in this server who turned on /alerts share").setRequired(true))
    .addBooleanOption(o => o.setName("public").setDescription("Post it in the channel (default: only you see it)"));

const regions = new SlashCommandBuilder()
    .setName("regions")
    .setDescription("See one game's cheapest price in other regions, ranked in US dollars")
    .addStringOption(o => o.setName("game").setDescription("Game title").setRequired(true).setMaxLength(100));

const sales = new SlashCommandBuilder()
    .setName("sales")
    .setDescription("Upcoming Steam sales and festivals, with countdowns");

const watch = new SlashCommandBuilder()
    .setName("watch")
    .setDescription("Watch one game for a price drop without adding it to your wishlist. It is removed after the alert")
    .addStringOption(o => o.setName("title").setDescription("Game title").setRequired(true).setMaxLength(100))
    .addStringOption(alertType).addNumberOption(alertValue);

const CODE_GAME_CHOICES = [{ name: "Borderlands (all of them)", value: "borderlands" }, { name: "Genshin Impact", value: "genshin" }, { name: "Honkai: Star Rail", value: "hsr" }, { name: "Zenless Zone Zero", value: "zzz" }, { name: "Destiny 2", value: "destiny2" }, { name: "Warframe", value: "warframe" }];
const alerts = new SlashCommandBuilder()
    .setName("alerts")
    .setDescription("How and where you get sale alerts")
    .addSubcommand(s => s.setName("status").setDescription("Open your alert settings: toggles, dropdowns and quiet hours"))
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
    .addSubcommand(s => s.setName("mindiscount").setDescription("Only alert me for sales of at least this percent off (starred games always come through)")
        .addIntegerOption(o => o.setName("percent").setDescription("0 to 90. 0 means any discount").setRequired(true).setMinValue(0).setMaxValue(90)))
    .addSubcommand(s => s.setName("bundles").setDescription("Alerts when a wishlist game is in a bundle, given away or joins a subscription")
        .addBooleanOption(o => o.setName("enabled").setDescription("On or off").setRequired(true)))
    .addSubcommand(s => s.setName("freegames").setDescription("Get told when a game is free to claim on Steam, Epic, GOG and others")
        .addBooleanOption(o => o.setName("enabled").setDescription("On or off").setRequired(true))
        .addBooleanOption(o => o.setName("dlc").setDescription("Also show free DLC and add-ons (default on)")))
    .addSubcommand(s => s.setName("news").setDescription("Patch notes and announcements for the Steam games you own or wishlist")
        .addIntegerOption(o => o.setName("mode").setDescription("What to send (off by default)").setRequired(true).addChoices({ name: "Off", value: 0 }, { name: "Patch notes only", value: 1 }, { name: "Every announcement", value: 2 })))
    .addSubcommand(s => s.setName("dlc").setDescription("Sale alerts for DLC and add-ons of games you play (off by default)")
        .addBooleanOption(o => o.setName("enabled").setDescription("On or off").setRequired(true)))
    .addSubcommand(s => s.setName("refund").setDescription("A heads-up on the last days to refund a new Steam game you barely played (off by default)")
        .addBooleanOption(o => o.setName("enabled").setDescription("On or off").setRequired(true)))
    .addSubcommand(s => s.setName("milestones").setDescription("A card when a game passes 100, 250, 500, 1000 or 2000 hours (off by default)")
        .addBooleanOption(o => o.setName("enabled").setDescription("On or off").setRequired(true)))
    .addSubcommand(s => s.setName("playtests").setDescription("Playtests, demos and betas: for your wishlist games, or every one the bot finds (off by default)")
        .addIntegerOption(o => o.setName("mode").setDescription("What to send").setRequired(true).addChoices({ name: "Off", value: 0 }, { name: "Only games on my wishlist", value: 1 }, { name: "Every playtest and demo the bot finds", value: 2 })))
    .addSubcommand(s => s.setName("achievements").setDescription("A heads-up when you are a few achievements short of 100% in a game you play a lot (off by default)")
        .addBooleanOption(o => o.setName("enabled").setDescription("On or off").setRequired(true)))
    .addSubcommand(s => s.setName("nudge").setDescription("A monthly pick from your backlog, so unplayed games get their turn (off by default)")
        .addBooleanOption(o => o.setName("enabled").setDescription("On or off").setRequired(true)))
    .addSubcommand(s => s.setName("yearinreview").setDescription("Get your year in games card at the end of December (off by default)")
        .addBooleanOption(o => o.setName("enabled").setDescription("On or off").setRequired(true)))
    .addSubcommand(s => s.setName("codes").setDescription("Get a DM when a new game code drops (Borderlands, Genshin, Destiny 2 and more)")
        .addBooleanOption(o => o.setName("enabled").setDescription("On or off").setRequired(true))
        .addStringOption(o => o.setName("game").setDescription("Only some games: pick one to add or drop it").addChoices(...CODE_GAME_CHOICES))
        .addBooleanOption(o => o.setName("on").setDescription("With game: include it (default) or leave it out")))
    .addSubcommand(s => s.setName("promos").setDescription("Get a DM about giveaways and codes in NVIDIA, SteelSeries and game news")
        .addBooleanOption(o => o.setName("enabled").setDescription("On or off").setRequired(true)))
    .addSubcommand(s => s.setName("mute").setDescription("Stop DMs for one kind of alert (you can still read them on the dashboard's Notifications page)")
        .addStringOption(o => o.setName("type").setDescription("Which alerts").setRequired(true).addChoices(
            { name: "Sale alerts", value: "alert" }, { name: "Bundle and giveaway alerts", value: "bundle" }, { name: "Free game alerts", value: "free" }, { name: "News and patch notes", value: "news" }, { name: "DLC sale alerts", value: "dlc" }, { name: "Refund reminders", value: "refund" }, { name: "Playtime milestones", value: "milestones" }, { name: "Year in games card", value: "yearly" }, { name: "Monthly backlog pick", value: "nudge" }, { name: "Almost-complete achievements", value: "achv" }, { name: "Playtests and demos", value: "playtest" }, { name: "Weekly digest", value: "digest" }, { name: "Release-day alerts", value: "release" }, { name: "Friend birthday reminders", value: "friend" }, { name: "Game code alerts", value: "codes" }, { name: "Promo news alerts", value: "promo" }))
        .addBooleanOption(o => o.setName("muted").setDescription("True to mute, false to get them again").setRequired(true)))
    .addSubcommand(s => s.setName("language").setDescription("Language for the bot's buttons and messages")
        .addStringOption(o => o.setName("language").setDescription("Language").setRequired(true).addChoices(...LANG_CHOICES)))
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
    .addSubcommand(s => s.setName("hot").setDescription("Post big Steam discounts in the alert channel, even for games nobody watches")
        .addIntegerOption(o => o.setName("minimum").setDescription("Smallest discount to post, in percent (30 to 95). 0 turns it off").setRequired(true).setMinValue(0).setMaxValue(95)))
    .addSubcommand(s => s.setName("sales").setDescription("Post in the alert channel when a Steam sale or festival starts")
        .addBooleanOption(o => o.setName("enabled").setDescription("On or off").setRequired(true)))
    .addSubcommand(s => s.setName("digest").setDescription("Post a weekly round-up on Fridays: cheap games members watch, free games and events")
        .addBooleanOption(o => o.setName("enabled").setDescription("On or off").setRequired(true)))
    .addSubcommand(s => s.setName("group").setDescription("Post when several opted-in members watch the same game and it hits their alert")
        .addIntegerOption(o => o.setName("minimum").setDescription("How many members (2 to 20). 0 turns it off").setRequired(true).setMinValue(0).setMaxValue(20)));

const serverstats = new SlashCommandBuilder()
    .setName("serverstats")
    .setDescription("This server's most wanted games, savings and top savers");

const clubCmd = new SlashCommandBuilder()
    .setName("club")
    .setDescription("The server's game of the month and how far everyone is")
    .addSubcommand(s => s.setName("status").setDescription("This month's pick and who is playing it"))
    .addSubcommand(s => s.setName("pick").setDescription("Managers: set this month's game").addStringOption(o => o.setName("game").setDescription("Game title").setRequired(true).setMaxLength(100)))
    .addSubcommand(s => s.setName("channel").setDescription("Managers: where the weekly club card is posted").addChannelOption(o => o.setName("channel").setDescription("Text channel").setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s => s.setName("off").setDescription("Managers: turn the game club off"));

const santaCmd = new SlashCommandBuilder()
    .setName("santa")
    .setDescription("Secret Santa: draw names and get gift ideas from wishlists")
    .addSubcommand(s => s.setName("create").setDescription("Managers: start a Secret Santa")
        .addNumberOption(o => o.setName("budget").setDescription("Spend limit per gift, in your store's currency").setRequired(true).setMinValue(1).setMaxValue(1000))
        .addStringOption(o => o.setName("title").setDescription("A name for it (default: Secret Santa)").setMaxLength(80)))
    .addSubcommand(s => s.setName("join").setDescription("Join the Secret Santa (shares your wishlist with your giver)"))
    .addSubcommand(s => s.setName("leave").setDescription("Leave the Secret Santa before names are drawn"))
    .addSubcommand(s => s.setName("status").setDescription("The budget and who is in"))
    .addSubcommand(s => s.setName("ideas").setDescription("Who you're buying for and what fits their wishlist"))
    .addSubcommand(s => s.setName("draw").setDescription("Managers: draw names and DM everyone"))
    .addSubcommand(s => s.setName("reveal").setDescription("Managers: show who had who and wrap it up"));

const triviaCmd = new SlashCommandBuilder()
    .setName("trivia")
    .setDescription("Game trivia: guess the game from clues that get easier")
    .addSubcommand(s => s.setName("start").setDescription("Managers: start a round of trivia in a channel")
        .addIntegerOption(o => o.setName("rounds").setDescription("How many questions (default 5)").setMinValue(3).setMaxValue(10))
        .addChannelOption(o => o.setName("channel").setDescription("Where to play (default: here)").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand(s => s.setName("stop").setDescription("Managers: end the current game, keeping the scores"))
    .addSubcommand(s => s.setName("top").setDescription("The server's all-time trivia leaderboard"));

const nowplayingCmd = new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("Who is in a game right now (members who turned it on)")
    .addBooleanOption(o => o.setName("join").setDescription("Join or leave the board and squad-up posts (off by default)"));

const THEME_CHOICES = ["steam", "night", "forest", "sunset", "light", "mono", "rose", "ocean"].map(v => ({ name: v[0].toUpperCase() + v.slice(1), value: v }));
const PROFILE_SECTIONS = [["about", "About me (bio and links)"], ["favorites", "Favorite games"], ["nowplaying", "Playing now"], ["wishlist", "Wishlist"], ["recent", "Recently finished"], ["trophies", "Trophies"], ["steam", "Steam stats"], ["streams", "Streaming"]].map(([value, name]) => ({ name, value }));
const LINK_KIND_CHOICES = ["twitch", "kick", "youtube", "x", "bluesky", "steam", "github", "website"].map(v => ({ name: v === "x" ? "X" : v[0].toUpperCase() + v.slice(1), value: v }));
const profileCmd = new SlashCommandBuilder()
    .setName("profile")
    .setDescription("Your public profile page: bio, look, links, favorites and a profile song")
    .addSubcommand(s => s.setName("view").setDescription("See your profile settings and what each section shows"))
    .addSubcommand(s => s.setName("bio").setDescription("Write the short bio on your profile")
        .addStringOption(o => o.setName("text").setDescription("Up to 300 characters").setRequired(true).setMaxLength(300)))
    .addSubcommand(s => s.setName("name").setDescription("The name shown at the top of your profile")
        .addStringOption(o => o.setName("text").setDescription("Up to 32 characters").setRequired(true).setMaxLength(32)))
    .addSubcommand(s => s.setName("look").setDescription("Colors, background, layout and banner")
        .addStringOption(o => o.setName("theme").setDescription("Color theme").addChoices(...THEME_CHOICES))
        .addStringOption(o => o.setName("accent").setDescription("A custom color like #66c0f4, or reset").setMaxLength(7))
        .addStringOption(o => o.setName("background").setDescription("Page background").addChoices({ name: "Plain", value: "plain" }, { name: "Glow", value: "gradient" }, { name: "Dots", value: "dots" }, { name: "Grid", value: "grid" }))
        .addStringOption(o => o.setName("layout").setDescription("How sections are laid out").addChoices({ name: "Classic", value: "classic" }, { name: "Wide", value: "wide" }, { name: "Compact", value: "compact" }))
        .addStringOption(o => o.setName("banner").setDescription("The banner across the top").addChoices({ name: "Color", value: "gradient" }, { name: "Art of your first favorite game", value: "game" }, { name: "None", value: "none" })))
    .addSubcommand(s => s.setName("song").setDescription("Set a profile song: YouTube, SoundCloud, Spotify or a live radio stream")
        .addStringOption(o => o.setName("url").setDescription("A YouTube, SoundCloud or Spotify link, or a live radio stream address").setMaxLength(300))
        .addStringOption(o => o.setName("title").setDescription("Name shown next to the play button").setMaxLength(60))
        .addBooleanOption(o => o.setName("enter").setDescription("Show a Click to enter screen that starts the song"))
        .addBooleanOption(o => o.setName("remove").setDescription("Remove your profile song")))
    .addSubcommand(s => s.setName("link").setDescription("Add a link: Twitch, YouTube, X, Steam and more (one per kind)")
        .addStringOption(o => o.setName("kind").setDescription("Where it goes").setRequired(true).addChoices(...LINK_KIND_CHOICES))
        .addStringOption(o => o.setName("url").setDescription("The address").setRequired(true).setMaxLength(200)))
    .addSubcommand(s => s.setName("unlink").setDescription("Remove one of your profile links")
        .addStringOption(o => o.setName("kind").setDescription("Which one").setRequired(true).addChoices(...LINK_KIND_CHOICES)))
    .addSubcommand(s => s.setName("favorite").setDescription("Add a favorite game (up to five)")
        .addStringOption(o => o.setName("game").setDescription("Game title").setRequired(true).setMaxLength(80)))
    .addSubcommand(s => s.setName("unfavorite").setDescription("Remove a favorite game")
        .addStringOption(o => o.setName("game").setDescription("Game title").setRequired(true).setMaxLength(80)))
    .addSubcommand(s => s.setName("show").setDescription("Choose who sees a section of your profile")
        .addStringOption(o => o.setName("section").setDescription("Which section").setRequired(true).addChoices(...PROFILE_SECTIONS))
        .addStringOption(o => o.setName("who").setDescription("Who can see it").setRequired(true).addChoices({ name: "Everyone", value: "public" }, { name: "Members of my server", value: "server" }, { name: "Nobody (hidden)", value: "hidden" })));

const profilecard = new SlashCommandBuilder()
    .setName("profilecard")
    .setDescription("Your profile page as a card picture: favorites, achievements, wishlist and links")
    .addBooleanOption(o => o.setName("public").setDescription("Post it in the channel so others can see it"));

const mydata = new SlashCommandBuilder()
    .setName("mydata")
    .setDescription("See or delete everything the bot stores about you")
    .addSubcommand(s => s.setName("export").setDescription("Download your stored data"))
    .addSubcommand(s => s.setName("delete").setDescription("Delete your wishlist and settings"));

const coop = new SlashCommandBuilder().setName("coop")
    .setDescription("Who here owns a game? Gets a group going")
    .addStringOption(o => o.setName("game").setDescription("Game name").setRequired(true).setMaxLength(100))
    .addBooleanOption(o => o.setName("ping").setDescription("Post here and ping the owners"));

const gamenight = new SlashCommandBuilder().setName("gamenight")
    .setDescription("What your voice channel can play or buy together")
    .addChannelOption(o => o.setName("channel").setDescription("A voice channel (default: the one you are in)").addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice))
    .addBooleanOption(o => o.setName("post").setDescription("Show it in this channel (default: only you)"));

const setup = new SlashCommandBuilder().setName("setup").setDescription("Server managers: guided setup for alerts, support tickets and giveaways")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

const textChan = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const community = new SlashCommandBuilder()
    .setName("community")
    .setDescription("Server managers: build and run your gaming community")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName("setup").setDescription("Create the usual gaming-server channels and roles, with welcome messages and XP, and connect the bot"))
    .addSubcommand(s => s.setName("status").setDescription("What is switched on in this server"))
    .addSubcommand(s => s.setName("playtests").setDescription("Post the playtests, demos and betas listed right now in the playtest channel, not only new ones")
        .addIntegerOption(o => o.setName("count").setDescription("How many of the newest to post (default 8)").setMinValue(1).setMaxValue(15)))
    .addSubcommand(s => s.setName("welcome").setDescription("Greet new members")
        .addBooleanOption(o => o.setName("enabled").setDescription("Turn the welcome message on or off"))
        .addChannelOption(o => o.setName("channel").setDescription("Where to greet them").addChannelTypes(...textChan))
        .addStringOption(o => o.setName("message").setDescription("Use {user} {username} {server} {count} {inviter}").setMaxLength(1000))
        .addBooleanOption(o => o.setName("dm").setDescription("Also send each new member a private welcome"))
        .addBooleanOption(o => o.setName("card").setDescription("Show a picture card with their avatar and member number (on by default)"))
        .addBooleanOption(o => o.setName("leave").setDescription("Post a note when someone leaves"))
        .addBooleanOption(o => o.setName("test").setDescription("Show a sample welcome here (only you see it)")))
    .addSubcommand(s => s.setName("verifyrole").setDescription("The role members get when they prove their Steam account")
        .addRoleOption(o => o.setName("role").setDescription("Role to give (leave empty with clear to stop)"))
        .addBooleanOption(o => o.setName("clear").setDescription("Stop giving a role")))
    .addSubcommand(s => s.setName("autorole").setDescription("The role every new member gets")
        .addRoleOption(o => o.setName("role").setDescription("Role to give (leave empty with clear to stop)"))
        .addBooleanOption(o => o.setName("clear").setDescription("Stop giving a role")))
    .addSubcommand(s => s.setName("ai").setDescription("AI companion: members say \"Hey AI\" and ask anything. Turn it on or off")
        .addBooleanOption(o => o.setName("on").setDescription("On or off"))
        .addChannelOption(o => o.setName("channel").setDescription("Only answer in this channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addBooleanOption(o => o.setName("anywhere").setDescription("Answer in every channel instead of just one"))
        .addBooleanOption(o => o.setName("guides").setDescription("Answer how-to questions (like getting Steam Verified) with a step by step guide, no AI needed")))
    .addSubcommand(s => s.setName("links").setDescription("Reply to Steam store links with the price, its lows and a buy-or-wait verdict")
        .addBooleanOption(o => o.setName("on").setDescription("On or off (needs the Message Content intent on this bot)").setRequired(true)))
    .addSubcommand(s => s.setName("xp").setDescription("Levels and XP settings")
        .addBooleanOption(o => o.setName("enabled").setDescription("Turn XP on or off"))
        .addNumberOption(o => o.setName("multiplier").setDescription("XP speed, 1 is normal").setMinValue(0.1).setMaxValue(5))
        .addStringOption(o => o.setName("announce").setDescription("Where level-ups are announced").addChoices({ name: "In the channel where they chat", value: "same" }, { name: "In one channel", value: "channel" }, { name: "Nowhere", value: "off" }))
        .addChannelOption(o => o.setName("channel").setDescription("The channel for level-ups").addChannelTypes(...textChan)))
    .addSubcommand(s => s.setName("levelrole").setDescription("A role members earn at a level")
        .addIntegerOption(o => o.setName("level").setDescription("The level").setRequired(true).setMinValue(1).setMaxValue(200))
        .addRoleOption(o => o.setName("role").setDescription("The role to give"))
        .addBooleanOption(o => o.setName("remove").setDescription("Remove the reward for this level")))
    .addSubcommand(s => s.setName("referral").setDescription("Referral rewards for inviting members")
        .addIntegerOption(o => o.setName("bonus").setDescription("XP the inviter gets for each new member (0 for none)").setMinValue(0).setMaxValue(1000))
        .addIntegerOption(o => o.setName("count").setDescription("Reward at this many invited members").setMinValue(1).setMaxValue(1000))
        .addRoleOption(o => o.setName("role").setDescription("The reward role"))
        .addBooleanOption(o => o.setName("remove").setDescription("Remove the reward for this count")));

const grabberAd = new SlashCommandBuilder()
    .setName("grabberad")
    .setDescription("Bot owner only: send the FanaticalGrabber advertisement")
    .setDefaultMemberPermissions(0)
    .addStringOption(o => o.setName("audience").setDescription("Who gets it").setRequired(true).addChoices({ name: "Only me (preview)", value: "me" }, { name: "Everyone the bot knows (DMs)", value: "dm" }, { name: "Every server's #announcements", value: "channels" }, { name: "Both", value: "both" }))
    .addStringOption(o => o.setName("confirm").setDescription("Type SEND to send it to anyone but yourself"));

const lbRefresh = new SlashCommandBuilder()
    .setName("leaderboardrefresh")
    .setDescription("Server managers: update the #leaderboard channel right now")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

const rank = new SlashCommandBuilder().setName("rank").setDescription("Your level, XP and place in this server")
    .addUserOption(o => o.setName("member").setDescription("Look at someone else"));

const levels = new SlashCommandBuilder().setName("levels").setDescription("The most active members of this server");

const invitesCmd = new SlashCommandBuilder()
    .setName("invites")
    .setDescription("Invite people and see who joined through you")
    .addSubcommand(s => s.setName("me").setDescription("How many people joined through your invites")
        .addUserOption(o => o.setName("member").setDescription("Look at someone else")))
    .addSubcommand(s => s.setName("top").setDescription("Who has brought in the most members"))
    .addSubcommand(s => s.setName("link").setDescription("Get your own invite link; joins through it count for you"));

const rolemenuCmd = new SlashCommandBuilder()
    .setName("rolemenu")
    .setDescription("Role menus: members pick their own roles with buttons")
    .addSubcommand(s => s.setName("create").setDescription("Post a new role menu in a channel")
        .addStringOption(o => o.setName("title").setDescription("What the menu is for, like Pick your platforms").setRequired(true).setMaxLength(100))
        .addChannelOption(o => o.setName("channel").setDescription("Where to post it").setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addStringOption(o => o.setName("mode").setDescription("How picking works").addChoices({ name: "Pick as many as you like", value: "toggle" }, { name: "Pick one at a time", value: "single" }))
        .addStringOption(o => o.setName("description").setDescription("A line of text above the roles").setMaxLength(500)))
    .addSubcommand(s => s.setName("add").setDescription("Add a role to a menu")
        .addIntegerOption(o => o.setName("menu").setDescription("The menu number (see /manage rolemenu list)").setRequired(true).setMinValue(1))
        .addRoleOption(o => o.setName("role").setDescription("The role members can pick").setRequired(true))
        .addStringOption(o => o.setName("label").setDescription("Button text (default: the role name)").setMaxLength(80))
        .addStringOption(o => o.setName("emoji").setDescription("An emoji for the button").setMaxLength(60)))
    .addSubcommand(s => s.setName("remove").setDescription("Take a role off a menu")
        .addIntegerOption(o => o.setName("menu").setDescription("The menu number").setRequired(true).setMinValue(1))
        .addRoleOption(o => o.setName("role").setDescription("The role to remove").setRequired(true)))
    .addSubcommand(s => s.setName("delete").setDescription("Delete a menu and its message")
        .addIntegerOption(o => o.setName("menu").setDescription("The menu number").setRequired(true).setMinValue(1)))
    .addSubcommand(s => s.setName("list").setDescription("All the role menus in this server"));

const starboardCmd = new SlashCommandBuilder()
    .setName("starboard")
    .setDescription("Starboard: the messages members love most get their own channel")
    .addSubcommand(s => s.setName("setup").setDescription("Turn it on or change it")
        .addChannelOption(o => o.setName("channel").setDescription("Where starred messages are posted").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addIntegerOption(o => o.setName("threshold").setDescription("How many reactions it takes (1 to 25, default 3)").setMinValue(1).setMaxValue(25))
        .addStringOption(o => o.setName("emoji").setDescription("The emoji to count (default ⭐)").setMaxLength(60))
        .addBooleanOption(o => o.setName("selfstar").setDescription("Count the author's own reaction (default no)")))
    .addSubcommand(s => s.setName("off").setDescription("Turn the starboard off"))
    .addSubcommand(s => s.setName("status").setDescription("The settings and the top posts"));

const suggestionsCmd = new SlashCommandBuilder()
    .setName("suggestions")
    .setDescription("Suggestion box: members propose ideas, everyone votes, you answer")
    .addSubcommand(s => s.setName("setup").setDescription("Choose where suggestions are posted")
        .addChannelOption(o => o.setName("channel").setDescription("The suggestions channel").setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addRoleOption(o => o.setName("role").setDescription("A role to mention in the setup message (optional)")))
    .addSubcommand(s => s.setName("decide").setDescription("Answer a suggestion")
        .addIntegerOption(o => o.setName("id").setDescription("The suggestion number").setRequired(true).setMinValue(1))
        .addStringOption(o => o.setName("status").setDescription("What happens to it").setRequired(true).addChoices({ name: "Open", value: "open" }, { name: "Considering", value: "considering" }, { name: "Approved", value: "approved" }, { name: "Done", value: "done" }, { name: "Not planned", value: "denied" }))
        .addStringOption(o => o.setName("note").setDescription("A short answer shown on it").setMaxLength(500)))
    .addSubcommand(s => s.setName("list").setDescription("The latest suggestions")
        .addStringOption(o => o.setName("status").setDescription("Only this status").addChoices({ name: "Open", value: "open" }, { name: "Considering", value: "considering" }, { name: "Approved", value: "approved" }, { name: "Done", value: "done" }, { name: "Not planned", value: "denied" })));

const tagsCmd = new SlashCommandBuilder()
    .setName("tags")
    .setDescription("Custom commands: your own short answers members can call up")
    .addSubcommand(s => s.setName("add").setDescription("Make or change a custom command")
        .addStringOption(o => o.setName("name").setDescription("The name, like rules or ip").setRequired(true).setMaxLength(32))
        .addStringOption(o => o.setName("response").setDescription("What it says").setRequired(true).setMaxLength(1800)))
    .addSubcommand(s => s.setName("remove").setDescription("Delete a custom command")
        .addStringOption(o => o.setName("name").setDescription("The name").setRequired(true).setMaxLength(32)))
    .addSubcommand(s => s.setName("list").setDescription("All the custom commands"));

const pollCmd = new SlashCommandBuilder()
    .setName("poll")
    .setDescription("Polls with live results")
    .addSubcommand(s => s.setName("create").setDescription("Start a poll (Manage Messages)")
        .addStringOption(o => o.setName("question").setDescription("What are you asking?").setRequired(true).setMaxLength(240))
        .addStringOption(o => o.setName("options").setDescription("Two to ten choices, separated by |").setRequired(true).setMaxLength(900))
        .addIntegerOption(o => o.setName("hours").setDescription("End after this many hours (0 = until you end it)").setMinValue(0).setMaxValue(720))
        .addBooleanOption(o => o.setName("multi").setDescription("Let people pick more than one"))
        .addChannelOption(o => o.setName("channel").setDescription("Where to post it (default: here)").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand(s => s.setName("end").setDescription("End a poll now and show the result")
        .addIntegerOption(o => o.setName("id").setDescription("The poll number").setRequired(true).setMinValue(1)));

const suggestCmd = new SlashCommandBuilder()
    .setName("suggest")
    .setDescription("Send an idea to this server's suggestion box")
    .addStringOption(o => o.setName("idea").setDescription("Your idea").setRequired(true).setMinLength(10).setMaxLength(1500));

const tagCmd = new SlashCommandBuilder()
    .setName("tag")
    .setDescription("Use one of this server's custom commands")
    .addStringOption(o => o.setName("name").setDescription("Which one").setRequired(true).setAutocomplete(true).setMaxLength(32));

const memesCmd = new SlashCommandBuilder()
    .setName("memes")
    .setDescription("Auto memes: the bot posts a fresh meme in the memes channel on a timer")
    .addSubcommand(s => s.setName("setup").setDescription("Choose the channel, how often, or turn it off")
        .addChannelOption(o => o.setName("channel").setDescription("Where the memes go").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addIntegerOption(o => o.setName("hours").setDescription("Post one every…").addChoices(...[1, 2, 3, 6, 12, 24].map(n => ({ name: `${n} hour${n === 1 ? "" : "s"}`, value: n }))))
        .addBooleanOption(o => o.setName("enabled").setDescription("Turn auto memes on or off")))
    .addSubcommand(s => s.setName("now").setDescription("Post a meme right now"));

const streamCmd = new SlashCommandBuilder()
    .setName("stream")
    .setDescription("Tell the server you're live, or choose pings")
    .addSubcommand(s => s.setName("live").setDescription("Announce your stream in the live channel")
        .addStringOption(o => o.setName("link").setDescription("Your stream link").setRequired(true).setMaxLength(300))
        .addStringOption(o => o.setName("title").setDescription("What you're streaming").setMaxLength(120))
        .addStringOption(o => o.setName("game").setDescription("The game").setMaxLength(60)))
    .addSubcommand(s => s.setName("link").setDescription("Post when you go live on Twitch, Kick or YouTube")
        .addStringOption(o => o.setName("channel").setDescription("Your channel link").setRequired(true).setMaxLength(200)))
    .addSubcommand(s => s.setName("unlink").setDescription("Stop posting when you go live")
        .addStringOption(o => o.setName("site").setDescription("Just this site (empty: all)").addChoices({ name: "Twitch", value: "twitch" }, { name: "Kick", value: "kick" }, { name: "YouTube", value: "youtube" })))
    .addSubcommand(s => s.setName("end").setDescription("Mark your stream as finished"))
    .addSubcommand(s => s.setName("ping").setDescription("Get pinged when someone goes live")
        .addBooleanOption(o => o.setName("enabled").setDescription("On or off (leave empty to switch)")))
    .addSubcommand(s => s.setName("list").setDescription("Who is live right now"))
    .addSubcommand(s => s.setName("giveaway").setDescription("Give a key to viewers when your stream ends")
        .addStringOption(o => o.setName("game").setDescription("Which game the key is for").setRequired(true).setMaxLength(80))
        .addStringOption(o => o.setName("key").setDescription("The key. Only the winner ever sees it").setRequired(true).setMaxLength(200))
        .addIntegerOption(o => o.setName("minutes").setDescription("Max minutes (default 60)").setMinValue(5).setMaxValue(720)))
    .addSubcommand(s => s.setName("chat").setDescription("Chat commands for your stream bot")
        .addStringOption(o => o.setName("bot").setDescription("Which chat bot (default: all)").addChoices({ name: "Nightbot", value: "nightbot" }, { name: "StreamElements", value: "streamelements" }, { name: "Streamlabs Cloudbot", value: "streamlabs" }, { name: "Fossabot", value: "fossabot" })))
    .addSubcommand(s => s.setName("setup").setDescription("Managers: streamer role, live channel and ping role")
        .addRoleOption(o => o.setName("streamerrole").setDescription("People with this role can announce streams"))
        .addChannelOption(o => o.setName("channel").setDescription("Where go-live posts appear").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addRoleOption(o => o.setName("pingrole").setDescription("The opt-in role that gets pinged"))
        .addBooleanOption(o => o.setName("auto").setDescription("Post when linked streamers go live (default on)")));

const modCmd = new SlashCommandBuilder()
    .setName("mod")
    .setDescription("Moderators: warn, time out, kick, ban and clean up. Every action is logged")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand(s => s.setName("menu").setDescription("Open the guided menu: browse every moderation command and run it"))
    .addSubcommand(s => s.setName("warn").setDescription("Warn a member (they get a private message and it is logged)")
        .addUserOption(o => o.setName("user").setDescription("Who to warn").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Why").setMaxLength(400)))
    .addSubcommand(s => s.setName("warnings").setDescription("A member's warnings and everything done to them")
        .addUserOption(o => o.setName("user").setDescription("Who").setRequired(true))
        .addIntegerOption(o => o.setName("page").setDescription("Page number").setMinValue(1)))
    .addSubcommand(s => s.setName("clearwarns").setDescription("Clear a member's active warnings (the history stays)")
        .addUserOption(o => o.setName("user").setDescription("Who").setRequired(true)))
    .addSubcommand(s => s.setName("timeout").setDescription("Stop a member from talking for a while")
        .addUserOption(o => o.setName("user").setDescription("Who").setRequired(true))
        .addStringOption(o => o.setName("duration").setDescription("How long: 10m, 2h, 3d (1 minute to 28 days)").setRequired(true).setMaxLength(10))
        .addStringOption(o => o.setName("reason").setDescription("Why").setMaxLength(400)))
    .addSubcommand(s => s.setName("untimeout").setDescription("Lift a timeout")
        .addUserOption(o => o.setName("user").setDescription("Who").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Why").setMaxLength(400)))
    .addSubcommand(s => s.setName("kick").setDescription("Remove a member (they can rejoin)")
        .addUserOption(o => o.setName("user").setDescription("Who").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Why").setMaxLength(400)))
    .addSubcommand(s => s.setName("ban").setDescription("Ban a member")
        .addUserOption(o => o.setName("user").setDescription("Who").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Why").setMaxLength(400))
        .addIntegerOption(o => o.setName("delete_days").setDescription("Also delete their messages from the last 0 to 7 days").setMinValue(0).setMaxValue(7))
        .addStringOption(o => o.setName("length").setDescription("Temporary ban, lifts itself: 12h, 7d, 30d (empty = permanent)").setMaxLength(10)))
    .addSubcommand(s => s.setName("stats").setDescription("What each moderator has done lately")
        .addIntegerOption(o => o.setName("days").setDescription("How far back, 1 to 365 (default 30)").setMinValue(1).setMaxValue(365)))
    .addSubcommand(s => s.setName("appeals").setDescription("See and answer ban appeals")
        .addIntegerOption(o => o.setName("id").setDescription("The appeal to answer"))
        .addStringOption(o => o.setName("answer").setDescription("Accept (unbans them) or deny").addChoices({ name: "Accept and unban", value: "accept" }, { name: "Deny", value: "deny" }))
        .addStringOption(o => o.setName("note").setDescription("A short message back to them").setMaxLength(300)))
    .addSubcommand(s => s.setName("settings").setDescription("Warnings expire after some days, and whether bans can be appealed")
        .addIntegerOption(o => o.setName("warn_expiry_days").setDescription("Warnings stop counting after this many days (0 = never)").setMinValue(0).setMaxValue(365))
        .addBooleanOption(o => o.setName("appeals").setDescription("Let banned people appeal on the website")))
    .addSubcommand(s => s.setName("unban").setDescription("Lift a ban")
        .addStringOption(o => o.setName("user_id").setDescription("The banned person's user ID").setRequired(true).setMaxLength(25))
        .addStringOption(o => o.setName("reason").setDescription("Why").setMaxLength(400)))
    .addSubcommand(s => s.setName("purge").setDescription("Delete recent messages (newer than 14 days)")
        .addIntegerOption(o => o.setName("amount").setDescription("How many, 1 to 100").setRequired(true).setMinValue(1).setMaxValue(100))
        .addUserOption(o => o.setName("user").setDescription("Only this person's messages"))
        .addChannelOption(o => o.setName("channel").setDescription("Which channel (default: this one)").addChannelTypes(...textChan)))
    .addSubcommand(s => s.setName("cases").setDescription("Recent moderation actions in this server")
        .addUserOption(o => o.setName("user").setDescription("Only this person"))
        .addIntegerOption(o => o.setName("page").setDescription("Page number").setMinValue(1)))
    .addSubcommand(s => s.setName("note").setDescription("Add a private staff note to a member's history (they are never told)")
        .addUserOption(o => o.setName("user").setDescription("Who the note is about").setRequired(true))
        .addStringOption(o => o.setName("text").setDescription("The note").setRequired(true).setMaxLength(400)))
    .addSubcommand(s => s.setName("slowmode").setDescription("Set slowmode on a channel (Manage Channels)")
        .addStringOption(o => o.setName("length").setDescription("Time between messages: 5s, 30s, 2m, 1h, or off").setRequired(true).setMaxLength(10))
        .addChannelOption(o => o.setName("channel").setDescription("Which channel (default: this one)").addChannelTypes(...textChan))
        .addStringOption(o => o.setName("reason").setDescription("Why").setMaxLength(300)))
    .addSubcommand(s => s.setName("lock").setDescription("Stop everyone from sending messages in a channel (Manage Channels)")
        .addChannelOption(o => o.setName("channel").setDescription("Which channel (default: this one)").addChannelTypes(...textChan))
        .addStringOption(o => o.setName("reason").setDescription("Why").setMaxLength(300)))
    .addSubcommand(s => s.setName("unlock").setDescription("Let everyone send messages in a channel again (Manage Channels)")
        .addChannelOption(o => o.setName("channel").setDescription("Which channel (default: this one)").addChannelTypes(...textChan))
        .addStringOption(o => o.setName("reason").setDescription("Why").setMaxLength(300)))
    .addSubcommand(s => s.setName("automod").setDescription("See or switch the auto-moderator and raid guard (Manage Server). Full settings are on the dashboard")
        .addStringOption(o => o.setName("rule").setDescription("What to switch").addChoices(
            { name: "Everything (master switch)", value: "on" }, { name: "Message spam", value: "spam" }, { name: "Mass mentions", value: "mentions" },
            { name: "Discord invite links", value: "invites" }, { name: "Links", value: "links" }, { name: "Blocked words", value: "words" },
            { name: "SHOUTING", value: "caps" }, { name: "Raid guard", value: "raid" }))
        .addBooleanOption(o => o.setName("enabled").setDescription("Turn it on or off")))
    .addSubcommand(s => s.setName("log").setDescription("Choose where moderation actions are logged (Manage Server)")
        .addChannelOption(o => o.setName("channel").setDescription("The mod log channel").addChannelTypes(...textChan)));

const emojiCmd = new SlashCommandBuilder()
    .setName("emoji")
    .setDescription("Server managers: add custom emoji to this server")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions)
    .addSubcommand(s => s.setName("import").setDescription("Copy emoji from other servers, or add pictures from a link or file")
        .addStringOption(o => o.setName("emojis").setDescription("Paste custom emoji, Discord emoji links, or links to pictures anywhere (up to 20)"))
        .addAttachmentOption(o => o.setName("image").setDescription("An image to add (PNG, GIF or JPG, under 256 KB)"))
        .addStringOption(o => o.setName("name").setDescription("Name for the image").setMinLength(2).setMaxLength(32)))
    .addSubcommand(s => s.setName("list").setDescription("The custom emoji this server has and how many slots are left"))
    .addSubcommand(s => s.setName("packs").setDescription("Browse emoji packs from emoji.gg and import one into this server")
        .addStringOption(o => o.setName("sort").setDescription("Which packs first").addChoices({ name: "Newest", value: "recent" }, { name: "Most popular", value: "downloads" }, { name: "Oldest", value: "oldest" })));

const bug = new SlashCommandBuilder().setName("bug").setDescription("Report a problem with the bot. It goes straight to the bot owner");


const feature = new SlashCommandBuilder()
    .setName("feature")
    .setDescription("Suggest a feature for the bot and vote on ideas")
    .addSubcommand(s => s.setName("request").setDescription("Suggest something you would like the bot to do"))
    .addSubcommand(s => s.setName("list").setDescription("See the ideas, most voted first")
        .addStringOption(o => o.setName("status").setDescription("Only show one status").addChoices(
            { name: "Under review", value: "open" }, { name: "Planned", value: "planned" }, { name: "In development", value: "in_development" },
            { name: "Shipped", value: "shipped" }, { name: "Rejected", value: "rejected" }, { name: "On hold", value: "on_hold" })))
    .addSubcommand(s => s.setName("vote").setDescription("Vote for an idea, or take your vote back")
        .addIntegerOption(o => o.setName("id").setDescription("The number shown in /bot feature list").setRequired(true).setMinValue(1)));

const codes = new SlashCommandBuilder()
    .setName("codes")
    .setDescription("Limited-time game codes: Borderlands, Genshin, Star Rail, Zenless, Destiny 2, Warframe")
    .addSubcommand(s => s.setName("latest").setDescription("The newest codes that still work")
        .addStringOption(o => o.setName("game").setDescription("Only one game").addChoices(...CODE_GAME_CHOICES)))
    .addSubcommand(s => s.setName("channel").setDescription("Server managers: where new codes are posted")
        .addChannelOption(o => o.setName("channel").setDescription("Channel (empty shows the current one)").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addBooleanOption(o => o.setName("clear").setDescription("Stop posting codes in this server")))
    .addSubcommand(s => s.setName("games").setDescription("Server managers: choose which games' codes get posted")
        .addStringOption(o => o.setName("game").setDescription("The game to turn on or off").addChoices(...CODE_GAME_CHOICES))
        .addBooleanOption(o => o.setName("on").setDescription("On (default) or off")))
    .addSubcommand(s => s.setName("ping").setDescription("Server managers: a role to ping when a new code drops")
        .addRoleOption(o => o.setName("role").setDescription("Role to ping (leave empty to stop pinging)")));

const promos = new SlashCommandBuilder()
    .setName("promos")
    .setDescription("Promo drops like SteelSeries or NVIDIA keys, posted once each")
    .addSubcommand(s => s.setName("list").setDescription("Promo drops that are still going in this server"))
    .addSubcommand(s => s.setName("add").setDescription("Managers: post a code or link being given away")
        .addStringOption(o => o.setName("title").setDescription("Short name of the drop").setRequired(true).setMaxLength(100))
        .addStringOption(o => o.setName("code").setDescription("The code, if there is one").setMaxLength(120))
        .addStringOption(o => o.setName("link").setDescription("Where to claim it (https://...)").setMaxLength(300))
        .addStringOption(o => o.setName("from").setDescription("Who is giving it away").setMaxLength(60))
        .addIntegerOption(o => o.setName("days").setDescription("Days until it ends, if you know").setMinValue(1).setMaxValue(365))
        .addStringOption(o => o.setName("note").setDescription("Anything people should know").setMaxLength(300)))
    .addSubcommand(s => s.setName("end").setDescription("Server managers: mark a drop as over")
        .addIntegerOption(o => o.setName("id").setDescription("The number shown in /server promos list").setRequired(true).setMinValue(1)))
    .addSubcommand(s => s.setName("channel").setDescription("Server managers: where promo drops are posted")
        .addChannelOption(o => o.setName("channel").setDescription("Channel (empty shows the current one)").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addBooleanOption(o => o.setName("clear").setDescription("Stop posting promo drops")))
    .addSubcommand(s => s.setName("ping").setDescription("Server managers: a role to ping for new drops")
        .addRoleOption(o => o.setName("role").setDescription("Role to ping (leave empty to stop pinging)")))
    .addSubcommand(s => s.setName("bundles").setDescription("Game bundle feed (managers set it up)")
        .addChannelOption(o => o.setName("channel").setDescription("Where to post").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addStringOption(o => o.setName("store").setDescription("Store to turn on or off").addChoices({ name: "Humble Bundle", value: "humble" }, { name: "Fanatical", value: "fanatical" }, { name: "IndieGala", value: "indiegala" }, { name: "Steam", value: "steam" }))
        .addBooleanOption(o => o.setName("on").setDescription("On (default) or off"))
        .addRoleOption(o => o.setName("role").setDescription("Role to ping"))
        .addBooleanOption(o => o.setName("adult").setDescription("Include adult bundles"))
        .addBooleanOption(o => o.setName("clear").setDescription("Stop posting bundles")))
    .addSubcommand(s => s.setName("news").setDescription("Managers: also post giveaway and code news")
        .addBooleanOption(o => o.setName("on").setDescription("On or off (leave empty to see the setting)")));

const supporterCmd = new SlashCommandBuilder().setName("supporter").setDescription("Your supporter pass and what it gives you");
const changelog = new SlashCommandBuilder().setName("changelog").setDescription("What is new in the bot");

const support = new SlashCommandBuilder()
    .setName("support")
    .setDescription("Get help from the bot's team")
    .addSubcommand(s => s.setName("open").setDescription("Open a support ticket")
        .addStringOption(o => o.setName("type").setDescription("What kind of ticket (default: help)").addChoices({ name: "I need help", value: "help" }, { name: "Report a bug", value: "bug" })))
    .addSubcommand(s => s.setName("mine").setDescription("See your tickets"))
    .addSubcommand(s => s.setName("setup").setDescription("Staff: choose the channel where tickets are posted")
        .addChannelOption(o => o.setName("channel").setDescription("Text channel").setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addRoleOption(o => o.setName("staffrole").setDescription("Role that may answer tickets (Manage Server always can)"))
        .addBooleanOption(o => o.setName("global").setDescription("Bot owner only: set the channel for tickets with no server queue")));

const musicCmd = new SlashCommandBuilder()
    .setName("music")
    .setDescription("Play music from SoundCloud in your voice channel")
    .addSubcommand(s => s.setName("play").setDescription("Play a SoundCloud link or search for a song")
        .addStringOption(o => o.setName("song").setDescription("A SoundCloud track or playlist link, or words to search for").setRequired(true).setMaxLength(300))
        .addBooleanOption(o => o.setName("next").setDescription("Put it at the front of the queue"))
        .addBooleanOption(o => o.setName("shuffle").setDescription("Shuffle a playlist as it's added")))
    .addSubcommand(s => s.setName("search").setDescription("Search SoundCloud and pick from the top results")
        .addStringOption(o => o.setName("query").setDescription("What to look for").setRequired(true).setMaxLength(120)))
    .addSubcommand(s => s.setName("nowplaying").setDescription("What's playing right now"))
    .addSubcommand(s => s.setName("queue").setDescription("See what's coming up")
        .addIntegerOption(o => o.setName("page").setDescription("Page number").setMinValue(1).setMaxValue(20)))
    .addSubcommand(s => s.setName("pause").setDescription("Pause the music"))
    .addSubcommand(s => s.setName("resume").setDescription("Carry on playing"))
    .addSubcommand(s => s.setName("skip").setDescription("Skip this song (others vote if you didn't add it)"))
    .addSubcommand(s => s.setName("skipto").setDescription("Jump to a song in the queue")
        .addIntegerOption(o => o.setName("number").setDescription("Its number in /music queue").setRequired(true).setMinValue(1).setMaxValue(500)))
    .addSubcommand(s => s.setName("previous").setDescription("Go back to the last song"))
    .addSubcommand(s => s.setName("seek").setDescription("Jump to a time in the song")
        .addStringOption(o => o.setName("time").setDescription("Like 1:30, 90 or 1m30s").setRequired(true).setMaxLength(12)))
    .addSubcommand(s => s.setName("stop").setDescription("Stop and clear the queue"))
    .addSubcommand(s => s.setName("leave").setDescription("Make the bot leave the voice channel"))
    .addSubcommand(s => s.setName("volume").setDescription("Set the volume")
        .addIntegerOption(o => o.setName("percent").setDescription("1 to 100").setRequired(true).setMinValue(1).setMaxValue(100)))
    .addSubcommand(s => s.setName("loop").setDescription("Repeat the song or the whole queue")
        .addStringOption(o => o.setName("mode").setDescription("What to repeat").setRequired(true).addChoices({ name: "Off", value: "off" }, { name: "This song", value: "track" }, { name: "The whole queue", value: "queue" })))
    .addSubcommand(s => s.setName("shuffle").setDescription("Shuffle what's coming up"))
    .addSubcommand(s => s.setName("remove").setDescription("Take a song out of the queue")
        .addIntegerOption(o => o.setName("number").setDescription("Its number in /music queue").setRequired(true).setMinValue(1).setMaxValue(500)))
    .addSubcommand(s => s.setName("move").setDescription("Move a song to another place in the queue")
        .addIntegerOption(o => o.setName("from").setDescription("Its number now").setRequired(true).setMinValue(1).setMaxValue(500))
        .addIntegerOption(o => o.setName("to").setDescription("Where it should go").setRequired(true).setMinValue(1).setMaxValue(500)))
    .addSubcommand(s => s.setName("clear").setDescription("Empty the queue (keeps the current song)"))
    .addSubcommand(s => s.setName("saveplaylist").setDescription("Save what's playing and queued as your own playlist")
        .addStringOption(o => o.setName("name").setDescription("Name for the playlist").setRequired(true).setMaxLength(40)))
    .addSubcommand(s => s.setName("loadplaylist").setDescription("Queue one of your saved playlists")
        .addStringOption(o => o.setName("name").setDescription("Which one").setRequired(true).setAutocomplete(true).setMaxLength(40)))
    .addSubcommand(s => s.setName("playlists").setDescription("Your saved playlists"))
    .addSubcommand(s => s.setName("deleteplaylist").setDescription("Delete one of your saved playlists")
        .addStringOption(o => o.setName("name").setDescription("Which one").setRequired(true).setAutocomplete(true).setMaxLength(40)))
    .addSubcommand(s => s.setName("settings").setDescription("Server managers: DJ role, volume, limits and the announcement channel")
        .addBooleanOption(o => o.setName("enabled").setDescription("Turn music on or off for this server"))
        .addRoleOption(o => o.setName("djrole").setDescription("Only this role (and Manage Server) can use the controls"))
        .addBooleanOption(o => o.setName("cleardj").setDescription("Remove the DJ role so everyone can use the controls"))
        .addChannelOption(o => o.setName("channel").setDescription("Where now-playing messages go (default: where /play was used)").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addIntegerOption(o => o.setName("volume").setDescription("Starting volume, 1 to 100").setMinValue(1).setMaxValue(100))
        .addIntegerOption(o => o.setName("maxqueue").setDescription("Most songs allowed in the queue").setMinValue(5).setMaxValue(500))
        .addIntegerOption(o => o.setName("maxminutes").setDescription("Longest single song in minutes (0 = no limit)").setMinValue(0).setMaxValue(600))
        .addBooleanOption(o => o.setName("announce").setDescription("Post a message when each song starts"))
        .addBooleanOption(o => o.setName("channelstatus").setDescription("Show the current song as the voice channel's status"))
        .addBooleanOption(o => o.setName("stay").setDescription("Wait in the last voice channel; go back to the live station or Auto DJ when someone joins"))
        .addBooleanOption(o => o.setName("radio").setDescription("Allow live radio stream links")))
    .addSubcommand(s => s.setName("live").setDescription("Pick a live radio station to play (only ones that are on the air right now)")
        .addStringOption(o => o.setName("type").setDescription("What kind of music").addChoices(...CATEGORIES.map(([value, name]) => ({ name, value })))))
    .addSubcommandGroup(g => g.setName("autodj").setDescription("The Auto DJ keeps music going when nobody has queued anything")
        .addSubcommand(s => s.setName("submit").setDescription("Request a song or playlist for the Auto DJ to play (you don't need to be in voice)")
            .addStringOption(o => o.setName("song").setDescription("A SoundCloud song or playlist link, or words to search for").setRequired(true).setMaxLength(300)))
        .addSubcommand(s => s.setName("requests").setDescription("See the requests waiting for the Auto DJ"))
        .addSubcommand(s => s.setName("setup").setDescription("Server managers: turn on the Auto DJ and set what it plays")
            .addBooleanOption(o => o.setName("enabled").setDescription("Turn the Auto DJ on or off"))
            .addStringOption(o => o.setName("playlist").setDescription("A SoundCloud playlist link for it to play from").setMaxLength(300))
            .addStringOption(o => o.setName("savedplaylist").setDescription("Or use one of your own saved playlists").setAutocomplete(true).setMaxLength(40))
            .addBooleanOption(o => o.setName("clearplaylist").setDescription("Remove the Auto DJ playlist"))
            .addChannelOption(o => o.setName("channel").setDescription("A voice channel it joins by itself when someone is in it").addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice))
            .addBooleanOption(o => o.setName("clearchannel").setDescription("Stop joining a voice channel by itself"))
            .addIntegerOption(o => o.setName("idle").setDescription("Seconds of silence before it starts (5 to 600)").setMinValue(5).setMaxValue(600))
            .addBooleanOption(o => o.setName("requests").setDescription("Let members request songs for it"))
            .addBooleanOption(o => o.setName("shuffle").setDescription("Play the playlist in random order"))));

const playCmd = new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a SoundCloud link or search for a song in your voice channel")
    .addStringOption(o => o.setName("song").setDescription("A SoundCloud track or playlist link, or words to search for").setRequired(true).setMaxLength(300))
    .addBooleanOption(o => o.setName("next").setDescription("Put it at the front of the queue"))
    .addBooleanOption(o => o.setName("shuffle").setDescription("Shuffle a playlist as it's added"));

const languageCmd = new SlashCommandBuilder()
    .setName("language")
    .setDescription("Language for the bot's buttons and messages")
    .addStringOption(o => o.setName("language").setDescription("Language").setRequired(true).addChoices(...LANG_CHOICES));

const playerCmd = new SlashCommandBuilder()
    .setName("player")
    .setDescription("Open the big music player for this server");

export const commands = [
    ...[value, wishlist, friendCmd, profileCmd, watch, currency, redeem, regions, sales, publicpage, status, alerts, library, freegames, steam, profilecard, bundle, saleprep, support, bug, codes, feature, grabberAd, changelog, supporterCmd, mydata, help, about, vote, privacy, dashCmd("dashboard"), dashCmd("dash"), languageCmd].map(everywhere),
    ...[alertchannel, giveaway, promos, musicCmd, playCmd, playerCmd, setup, gamenight, coop, lfgCmd, compare, nowplayingCmd, clubCmd, santaCmd, triviaCmd, community, rank, levels, invitesCmd, streamCmd, memesCmd, emojiCmd, modCmd, lbRefresh, rolemenuCmd, starboardCmd, suggestionsCmd, tagsCmd, pollCmd, suggestCmd, tagCmd].map(serverOnly),
    ...[serverlist, leaderboard, serverstats, calendarCmd].map(serverOrDm)
].map(c => c.toJSON());

// ---------- the commands people actually see ----------
// Everything above is written as one command per feature because that is how each feature grew. Discord shows a long,
// noisy list that way, so they are folded into a few grouped commands. The handlers still think in the old names:
// legacyRoute() turns "/me wishlist add" back into ("wishlist", "add") before anything else runs.
const HUBS = [
    { name: "games", description: "Prices, deals, free games and sales", kind: "everywhere", flat: ["value", "regions", "bundle", "sales", "freegames", "watch", "redeem"], groups: ["saleprep", "codes"] },
    { name: "me", description: "Your wishlist, library, Steam link, alerts and data", kind: "everywhere", flat: ["currency", "profilecard", "publicpage"], groups: ["wishlist", "library", "steam", "friend", "profile", "mydata"] },
    { name: "server", description: "Your server: giveaways, game nights, levels, boards and events", kind: "serverOrDm", flat: ["gamenight", "coop", "compare", "nowplaying", "rank", "levels", "serverstats", "leaderboard", "suggest", "tag"], groups: ["club", "santa", "trivia", "giveaway", "promos", "serverlist", "lfg", "calendar", "invites", "stream"] },
    { name: "manage", description: "Server managers: setup, community, alert channels and emoji", kind: "serverOnly", perm: PermissionFlagsBits.ManageGuild, flat: ["setup", "leaderboardrefresh"], groups: ["community", "alertchannel", "emoji", "memes", "rolemenu", "starboard", "suggestions", "tags", "poll"] },
    { name: "bot", description: "About the bot, its status, changelog, support and ideas", kind: "everywhere", flat: ["about", "privacy", "status", "changelog", "supporter", "bug", "grabberad"], groups: ["support", "feature"] }
];
const KEEP = ["help", "dashboard", "alerts", "language", "vote", "mod", "music", "play", "player"];
const KINDS = { everywhere, serverOnly, serverOrDm };
const byName = new Map(commands.map(c => [c.name, c]));

export const hubCommands = [
    ...HUBS.map(hub => {
        const b = new SlashCommandBuilder().setName(hub.name).setDescription(hub.description);
        if (hub.perm) b.setDefaultMemberPermissions(hub.perm);
        const j = KINDS[hub.kind](b).toJSON();
        j.options = [
            MENU,
            ...hub.flat.map(n => { const c = byName.get(n); return { type: 1, name: c.name, description: c.description, options: c.options ?? [] }; }),
            ...hub.groups.map(n => { const c = byName.get(n); return { type: 2, name: c.name, description: c.description, options: c.options }; })
        ];
        return j;
    }),
    ...KEEP.map(n => byName.get(n))
];
// Right-click a member, then Apps. These sit beside the slash commands and don't count toward their limits.
export const CONTEXT_COMPARE = "Compare libraries";
export const CONTEXT_WISHLIST = "See their wishlist";
export const CONTEXT_GIFTS = "Gift ideas";
export const CONTEXT_TOGETHER = "Play together";
// Right-click a message, then Apps: the message text is read as a game title.
export const CONTEXT_PRICE = "Check this game's price";
export const CONTEXT_ADD = "Add to my wishlist";
export const CONTEXT_OWNERS = "Who owns this?";
export const contextCommands = [
    ...[CONTEXT_COMPARE, CONTEXT_WISHLIST, CONTEXT_GIFTS, CONTEXT_TOGETHER].map(name => new ContextMenuCommandBuilder().setName(name).setType(ApplicationCommandType.User).setContexts(InteractionContextType.Guild).toJSON()),
    ...[CONTEXT_PRICE, CONTEXT_ADD, CONTEXT_OWNERS].map(name => new ContextMenuCommandBuilder().setName(name).setType(ApplicationCommandType.Message).setContexts(InteractionContextType.Guild, InteractionContextType.BotDM).toJSON())
];
export const HUB_NAMES = new Set(HUBS.map(h => h.name));
// Old command names that only worked inside a server (their hub also serves DMs, so the dispatcher checks).
export const SERVER_ONLY_LEGACY = new Set(commands.filter(c => !(c.contexts ?? []).includes(1)).map(c => c.name));

// ("games", null, "value") -> { command: "value", sub: null };  ("me", "wishlist", "add") -> { command: "wishlist", sub: "add" }
export function legacyRoute(commandName, group, sub) {
    if (!HUB_NAMES.has(commandName)) return null;
    return group ? { command: group, sub } : { command: sub, sub: null };
}

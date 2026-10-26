import { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import { REGIONS, ALERT_TYPES } from "./constants.js";
export { REGIONS };

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
    .addSubcommand(s => s.setName("remove").setDescription("Remove a game")
        .addStringOption(o => gameOption(o, true)));

const serverlist = new SlashCommandBuilder()
    .setName("serverlist")
    .setDescription("A wishlist shared by this server, with votes")
    .setContexts(InteractionContextType.Guild)
    .addSubcommand(s => s.setName("add").setDescription("Suggest a game for the server")
        .addStringOption(o => o.setName("title").setDescription("Game title").setRequired(true).setMaxLength(100)))
    .addSubcommand(s => s.setName("view").setDescription("The server's list, most votes first, with current prices"))
    .addSubcommand(s => s.setName("vote").setDescription("Vote for (or take back your vote on) a game")
        .addStringOption(o => gameOption(o, true)))
    .addSubcommand(s => s.setName("remove").setDescription("Remove a game (the person who added it, or Manage Server)")
        .addStringOption(o => gameOption(o, true)));

const leaderboard = new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Who in this server has saved the most (members who opted in with /alerts share)")
    .setContexts(InteractionContextType.Guild);

const help = new SlashCommandBuilder().setName("help").setDescription("How to use Steam Value Checker");
const about = new SlashCommandBuilder().setName("about").setDescription("About this bot and its price data");
const privacy = new SlashCommandBuilder().setName("privacy").setDescription("What the bot does and does not do with your data");

const alertType = o => o.setName("type").setDescription("When to alert you").addChoices(...ALERT_TYPES);
const alertValue = o => o
    .setName("value")
    .setDescription("The percentage (for a percentage alert) or the price (for a price alert)")
    .setMinValue(0.01)
    .setMaxValue(100000);
const gameOption = (o, required = false) => o
    .setName("game").setDescription("A game on your wishlist").setAutocomplete(true).setRequired(required);

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
    .addSubcommand(s => s.setName("share").setDescription("Count you in server group alerts and the leaderboard (off by default)")
        .addBooleanOption(o => o.setName("enabled").setDescription("On or off").setRequired(true)))
    .addSubcommand(s => s.setName("history").setDescription("Your recent alerts"));

const alertchannel = new SlashCommandBuilder()
    .setName("alertchannel")
    .setDescription("Server admins: choose where alerts go when a DM fails or a member opts out of DMs")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand(s => s.setName("set").setDescription("Set the alert channel")
        .addChannelOption(o => o.setName("channel").setDescription("Text channel").setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand(s => s.setName("clear").setDescription("Remove the alert channel"))
    .addSubcommand(s => s.setName("show").setDescription("Show the current alert channel"))
    .addSubcommand(s => s.setName("group").setDescription("Post when several opted-in members watch the same game and it hits their alert")
        .addIntegerOption(o => o.setName("minimum").setDescription("How many members (2 to 20). 0 turns it off").setRequired(true).setMinValue(0).setMaxValue(20)));

const mydata = new SlashCommandBuilder()
    .setName("mydata")
    .setDescription("See or delete everything the bot stores about you")
    .addSubcommand(s => s.setName("export").setDescription("Download your stored data"))
    .addSubcommand(s => s.setName("delete").setDescription("Delete your wishlist and settings"));

export const commands = [value, wishlist, alerts, alertchannel, library, serverlist, leaderboard, mydata, help, about, privacy].map(c => c.toJSON());

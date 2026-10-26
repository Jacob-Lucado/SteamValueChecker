import { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const REGIONS = [
    { name: "United States (USD)", value: "US" },
    { name: "United Kingdom (GBP)", value: "GB" },
    { name: "Europe - Germany (EUR)", value: "DE" },
    { name: "Canada (CAD)", value: "CA" },
    { name: "Australia (AUD)", value: "AU" },
    { name: "Brazil (BRL)", value: "BR" }
];

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

const help = new SlashCommandBuilder().setName("help").setDescription("How to use Steam Value Checker");
const about = new SlashCommandBuilder().setName("about").setDescription("About this bot and its price data");
const privacy = new SlashCommandBuilder().setName("privacy").setDescription("What the bot does and does not do with your data");

const ALERT_TYPES = [
    { name: "Any sale", value: "any" },
    { name: "A percentage off or more", value: "percent" },
    { name: "A price or lower", value: "price" },
    { name: "All-time low", value: "atl" }
];
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

const alertchannel = new SlashCommandBuilder()
    .setName("alertchannel")
    .setDescription("Server admins: choose where alerts go when a DM fails or a member opts out of DMs")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand(s => s.setName("set").setDescription("Set the alert channel")
        .addChannelOption(o => o.setName("channel").setDescription("Text channel").setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand(s => s.setName("clear").setDescription("Remove the alert channel"))
    .addSubcommand(s => s.setName("show").setDescription("Show the current alert channel"));

const mydata = new SlashCommandBuilder()
    .setName("mydata")
    .setDescription("See or delete everything the bot stores about you")
    .addSubcommand(s => s.setName("export").setDescription("Download your stored data"))
    .addSubcommand(s => s.setName("delete").setDescription("Delete your wishlist and settings"));

export const commands = [value, wishlist, alerts, alertchannel, mydata, help, about, privacy].map(c => c.toJSON());

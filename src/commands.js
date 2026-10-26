import { SlashCommandBuilder } from "discord.js";

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

export const commands = [value, help, about, privacy].map(c => c.toJSON());

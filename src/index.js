import "dotenv/config";
import {
    ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, Client, ComponentType,
    Events, GatewayIntentBits, MessageFlags
} from "discord.js";
import { loadConfig } from "./config.js";
import { createItad, ItadError } from "./itad.js";
import { parseTyped, sanitize } from "./parse.js";
import { readUpload } from "./upload.js";
import { buildRows, sortRows, totals, resolvePaid, savingsReport } from "./report.js";
import { pageCount, tableEmbed, summaryEmbed, toCsv, FREE_CLAIM_ALL_ID, STOP_ID, aboutPayload } from "./render.js";
import { collectAbout } from "./about.js";
import { FANATICAL_GRABBER_URL } from "./constants.js";
import { readFileSync } from "node:fs";
import { HELP, ABOUT, PRIVACY } from "./text.js";
import { openDb } from "./db.js";
import { createHandlers } from "./handlers.js";
import { UserError } from "./errors.js";
import { registerCommands } from "./registercmds.js";
import { createLogBuffer } from "./logbuffer.js";
import { dirname, join } from "node:path";
import { createNotifier } from "./notify.js";
import { runCycle, runExtras, runDigests, runSnapshots, runFreeGames, schedule } from "./poller.js";
import { createOps } from "./ops.js";
import { runBackup } from "./backup.js";
import { createDashboard } from "./dashboard/server.js";
import { createDiscordRest } from "./dashboard/discord.js";
import { createVault } from "./vault.js";
import { createGiveawayService } from "./giveaway.js";
import { createGiveawayHandlers } from "./gwhandlers.js";

const MAX_TITLES = 100;
const COOLDOWN_MS = 15_000;
const PAGE_TIMEOUT_MS = 10 * 60_000;

const cfg = loadConfig();
const STARTED_AT = Date.now();
const VERSION = (() => { try { return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version; } catch { return "1.0.0"; } })();
// Recent log lines for the dashboard's Admin page. Errors are also kept in a file so crashes survive a restart.
const logs = createLogBuffer({ file: join(dirname(cfg.dbPath), "errors.jsonl"), secrets: [cfg.token, cfg.itadKey, cfg.keySecret, cfg.dashboard?.clientSecret] });
logs.capture();
const itad = createItad({ apiKey: cfg.itadKey });
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const lastRun = new Map();
const db = openDb(cfg.dbPath);
const handlers = createHandlers({ db, itad });

// DMs and channel posts go through here, so notify.js can be tested without Discord.
const discord = {
    async sendDm(userId, payload) {
        const user = await client.users.fetch(userId);
        await user.send(payload);
    },
    async sendChannel(channelId, payload) {
        const channel = await client.channels.fetch(channelId);
        if (!channel?.isTextBased()) throw new Error("Not a text channel");
        await channel.send(payload);
    }
};
const notifier = createNotifier({ db, discord });

// Giveaways keep prize keys, so they only run when KEY_ENCRYPTION_SECRET is set.
const gwDiscord = {
    async post(channelId, payload) {
        const channel = await client.channels.fetch(channelId);
        if (!channel?.isTextBased()) throw new Error("Not a text channel");
        const m = await channel.send(payload);
        return { id: m.id };
    },
    async edit(channelId, messageId, payload) {
        const channel = await client.channels.fetch(channelId);
        const m = await channel.messages.fetch(messageId);
        await m.edit(payload);
    },
    dm: (userId, payload) => discord.sendDm(userId, payload),
    async memberOk(guildId, userId) {
        try { const g = await client.guilds.fetch(guildId); await g.members.fetch(userId); return true; }
        catch (e) { return !(e?.code === 10007 || e?.status === 404); } // false only for "Unknown Member"
    },
    async findChannelByName(guildId, name) {
        try {
            const g = await client.guilds.fetch(guildId);
            const channels = await g.channels.fetch();
            return channels.find(c => c?.isTextBased() && c.name.toLowerCase() === name)?.id ?? null;
        } catch { return null; }
    }
};
const giveaways = cfg.keySecret
    ? createGiveawayService({ db, vault: createVault(cfg.keySecret), discord: gwDiscord, itad, log: m => console.log(`[giveaway] ${m}`) })
    : null;
const gw = createGiveawayHandlers({ db, giveaways });

// Tracks health and DMs the owner (OWNER_DISCORD_ID) when something keeps failing.
const ops = createOps({
    sendOwner: async message => { if (cfg.ownerId) await discord.sendDm(cfg.ownerId, { content: message }); }
});

client.once(Events.ClientReady, c => {
    console.log(`Logged in as ${c.user.tag}`);

    // Price alerts
    schedule(
        async () => {
            const s = await runCycle({ db, itad, notifier, log: m => console.log(`[alerts] ${m}`) });
            console.log(`[alerts] checked ${s.checked} items, ${s.alerts} alerts, ${s.delivered} delivered, ${s.failed} failed, ${s.deferred} held for quiet hours`);
            await ops.cycleDone(s);
        },
        cfg.checkEveryMinutes * 60_000,
        { onError: err => { console.error(`[alerts] ${err.name}: ${err.message}`); ops.cycleThrew(err); } }
    );

    // Giveaways: ends them on time, passes unclaimed prizes on, sends "did it work?" follow-ups, deletes old keys
    if (giveaways) {
        schedule(
            async () => { await giveaways.tick(); },
            60_000,
            { onError: err => { console.error(`[giveaway] ${err.name}: ${err.message}`); ops.error("giveaways", err); } }
        );
    } else console.log("Giveaways are off (set KEY_ENCRYPTION_SECRET to turn them on).");

    // Bundles, giveaways, weekly digests, library snapshots, cleanup and the daily backup
    schedule(
        async () => {
            const log = m => console.log(`[maintenance] ${m}`);
            const result = {};
            try { result.extras = await runExtras({ db, itad, notifier, log }); } catch (err) { ops.error("extras", err); }
            try { result.free = await runFreeGames({ db, itad, notifier, log }); } catch (err) { ops.error("free games", err); }
            try { result.digests = await runDigests({ db, itad, notifier, log }); } catch (err) { ops.error("digests", err); }
            try { result.snapshots = await runSnapshots({ db, itad, log }); } catch (err) { ops.error("snapshots", err); }
            try { db.pruneAlertLog(); db.pruneSeen(); } catch (err) { ops.error("cleanup", err); }
            ops.maintenanceDone(result);
            try { await ops.backupDone(runBackup({ db, dir: cfg.backupDir, keep: cfg.backupKeep })); }
            catch (err) { await ops.backupDone(null, err); }
        },
        60 * 60_000,
        { onError: err => { console.error(`[maintenance] ${err.name}: ${err.message}`); ops.error("maintenance", err); } }
    );
});

// If the bot is removed from a server, forget that server's alert channel.
client.on(Events.GuildDelete, guild => { if (guild.available !== false) db.clearGuildChannel(guild.id); });

const reply = (i, content) => i.reply({ content, flags: MessageFlags.Ephemeral });
const aboutInfo = () => collectAbout({ client, db, cfg, startedAt: STARTED_AT, version: VERSION });
const embedReply = (i, description) =>
    i.reply({ embeds: [{ color: 0xff9800, description }], flags: MessageFlags.Ephemeral });

function pageButtons(page, pages) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("sv_prev").setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId("sv_page").setLabel(`${page + 1} / ${pages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId("sv_next").setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1)
    );
}

async function handleValue(i) {
    const wait = COOLDOWN_MS - (Date.now() - (lastRun.get(i.user.id) ?? 0));
    if (wait > 0) return reply(i, `Slow down a little. Try again in ${Math.ceil(wait / 1000)}s.`);
    lastRun.set(i.user.id, Date.now());

    await i.deferReply({ flags: MessageFlags.Ephemeral }); // only the user sees the result

    try {
        const entries = [];
        const file = i.options.getAttachment("file");
        if (file) entries.push(...await readUpload(file));
        entries.push(...parseTyped(i.options.getString("titles")));

        const clean = sanitize(entries, { max: MAX_TITLES });
        if (!clean.entries.length) {
            throw new UserError(
                "I need game **titles**, not keys. Use `titles:` or upload the CSV/JSON/TXT export from FanaticalGrabber. " +
                "A key on its own does not say which game it is."
            );
        }

        const region = i.options.getString("region") ?? "US";
        const majorOnly = i.options.getString("stores") === "major";
        const sort = i.options.getString("sort") ?? "input";
        const paidOption = i.options.getNumber("paid");

        const titles = clean.entries.map(e => e.title);
        const resolved = await itad.lookupTitles(titles);
        const ids = [...new Set(resolved.filter(r => r.id).map(r => r.id))];
        const prices = ids.length ? await itad.getPrices(ids, region) : new Map();

        const paidByTitle = new Map(clean.entries.filter(e => e.paid !== null).map(e => [e.title, e.paid]));
        const rows = sortRows(buildRows(resolved, prices, paidByTitle, { majorOnly }), sort);
        const t = totals(rows);
        const savings = savingsReport(resolvePaid(paidOption, rows), t, rows);

        const pages = pageCount(rows);
        const view = page => [summaryEmbed(t, savings, { region, majorOnly }), tableEmbed(rows, page, t.currency)];

        const notes = [];
        if (clean.sawKeys) notes.push("I ignored anything that looked like a key. Please do not post keys in Discord.");
        if (clean.truncated) notes.push(`Only the first ${MAX_TITLES} of ${clean.total} titles were checked.`);
        if (savings && t.found < t.count) notes.push(`The comparison covers the ${t.found} games that were found, but "paid" covers everything you entered.`);

        const payload = {
            content: notes.join("\n") || undefined,
            embeds: view(0),
            components: pages > 1 ? [pageButtons(0, pages)] : [],
            files: [new AttachmentBuilder(Buffer.from(toCsv(rows, t.currency), "utf8"), { name: "steam-value.csv" })]
        };
        const message = await i.editReply(payload);

        if (pages > 1) {
            let page = 0;
            const collector = message.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: PAGE_TIMEOUT_MS,
                filter: b => b.user.id === i.user.id
            });
            collector.on("collect", async b => {
                page = b.customId === "sv_next" ? Math.min(page + 1, pages - 1) : Math.max(page - 1, 0);
                await b.update({ embeds: view(page), components: [pageButtons(page, pages)] });
            });
            collector.on("end", () => i.editReply({ components: [] }).catch(() => {}));
        }
    } catch (err) {
        lastRun.delete(i.user.id); // a failed run should not cost the user their cooldown
        const message = err instanceof UserError || err instanceof ItadError
            ? err.message
            : "Something went wrong while pricing that list. Try again in a moment.";
        if (!(err instanceof UserError)) console.error(`[value] ${err.name}: ${err.message}`); // never log user input
        await i.editReply({ content: message, embeds: [], components: [] }).catch(() => {});
    }
}

client.on(Events.InteractionCreate, async i => {
    if (i.isAutocomplete()) {
        try { await (i.commandName === "giveaway" ? gw.handleAutocomplete(i) : handlers.handleAutocomplete(i)); } catch (err) { console.error(`[autocomplete] ${err.name}: ${err.message}`); }
        return;
    }
    if (i.isButton() && i.customId.startsWith("gw_")) return gw.handleButton(i);
    if (i.isModalSubmit() && i.customId.startsWith("gw_")) return gw.handleModal(i);
    if (i.isButton() && i.customId.startsWith(`${STOP_ID}:`)) {
        // "Stop watching" under a sale alert. Only the person the alert was sent to can use it.
        try {
            const item = db.getItemById(Number(i.customId.split(":")[1]));
            if (!item || item.discord_id !== i.user.id) {
                await i.reply({ content: "That game is no longer on your wishlist, or this alert is not yours.", flags: MessageFlags.Ephemeral });
            } else {
                db.removeItem(item.discord_id, item.itad_id);
                await i.reply({ content: `Stopped watching **${item.title}**. You can add it again any time with /wishlist add.`, flags: MessageFlags.Ephemeral });
            }
        } catch (err) { console.error(`[stop] ${err.stack ?? err.message}`); }
        return;
    }
    if (i.isButton() && i.customId === FREE_CLAIM_ALL_ID) {
        // Every link is read from the message the bot itself sent, so nothing is stored or taken from the user.
        const links = (i.message.embeds ?? []).filter(e => /^https:\/\//i.test(e.url ?? "")).map(e => `• [${String(e.title).slice(0, 80)}](${e.url})`);
        try { await i.reply({ content: links.length ? `Open each link and claim it:\n${links.join("\n")}` : "Those links are no longer available.", flags: MessageFlags.Ephemeral }); }
        catch (err) { console.error(`[claim] ${err.name}: ${err.message}`); }
        return;
    }
    if (!i.isChatInputCommand()) return;
    console.log(`[command] /${i.commandName}${i.options?.getSubcommand?.(false) ? " " + i.options.getSubcommand(false) : ""}`);
    try {
        switch (i.commandName) {
            case "value": return await handleValue(i);
            case "wishlist": return await handlers.handleWishlist(i);
            case "alerts": return await handlers.handleAlerts(i);
            case "alertchannel": return await handlers.handleAlertChannel(i);
            case "giveaway": return await gw.handleCommand(i);
            case "library": return await handlers.handleLibrary(i);
            case "serverlist": return await handlers.handleServerList(i);
            case "leaderboard": return await handlers.handleLeaderboard(i);
            case "freegames": return await handlers.handleFreeGames(i);
            case "mydata": return await handlers.handleMyData(i);
            case "help": return await embedReply(i, HELP);
            case "about": return await i.reply(aboutPayload(aboutInfo(), { about: ABOUT, fanaticalUrl: FANATICAL_GRABBER_URL }));
            case "privacy": return await embedReply(i, PRIVACY);
        }
    } catch (err) {
        console.error(`[${i.commandName}] ${err.stack ?? `${err.name}: ${err.message}`}`);
        // Never leave the person staring at "The application did not respond".
        const msg = { content: "Something went wrong on the bot's side. Please try again in a moment.", flags: MessageFlags.Ephemeral };
        try { if (i.deferred || i.replied) await i.followUp(msg); else await i.reply(msg); } catch { /* the interaction may already be gone */ }
    }
});

if (cfg.dashboard) {
    const d = cfg.dashboard;
    const rest = createDiscordRest({
        clientId: cfg.clientId, clientSecret: d.clientSecret, botToken: cfg.token, redirectUri: `${d.publicUrl}/auth/callback`
    });
    const dashboard = createDashboard({ db, itad, rest, ops, giveaways, logs, botInfo: aboutInfo, config: { ...d, creator: cfg.creator, clientId: cfg.clientId, ownerId: cfg.ownerId, trustProxy: cfg.trustProxy }, log: m => console.error(`[dashboard] ${m}`) });
    dashboard.listen().then(a => console.log(`Dashboard listening on ${a.address}:${a.port} (public address ${d.publicUrl})`))
        .catch(err => console.error(`[dashboard] could not start: ${err.message}`));
} else {
    console.log("Dashboard is off (set DASHBOARD_URL and DISCORD_CLIENT_SECRET to turn it on).");
}

process.on("unhandledRejection", err => console.error(`[unhandledRejection] ${err?.stack ?? err}`));
process.on("uncaughtException", err => {
    console.error(`[crash] ${err?.stack ?? err}`);
    setTimeout(() => process.exit(1), 200); // Fly restarts the bot; the crash is saved for the Admin page
});

// Commands are pushed to Discord at startup, but only when they changed since last time.
registerCommands(cfg, { onlyIfChanged: true })
    .then(r => console.log(r.skipped ? `Slash commands already up to date (${r.count}).` : `Registered ${r.count} slash commands${r.guild ? " to your test server" : " globally (global commands can take up to an hour to appear)"}.`))
    .catch(err => console.error(`[register] could not register commands: ${err.message}`));

client.login(cfg.token);

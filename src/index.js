import "dotenv/config";
import v8 from "node:v8";
import {
    ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, Client, ComponentType,
    Events, GatewayIntentBits, MessageFlags, Routes,
    version as DJS_VERSION
} from "discord.js";
import { loadConfig } from "./config.js";
import { createItad, ItadError } from "./itad.js";
import { parseTyped, sanitize } from "./parse.js";
import { readUpload } from "./upload.js";
import { buildRows, sortRows, totals, resolvePaid, savingsReport } from "./report.js";
import { pageCount, tableEmbed, summaryEmbed, toCsv, FREE_CLAIM_ALL_ID, STOP_ID, aboutPayload } from "./render.js";
import { collectAbout } from "./about.js";
import { FANATICAL_GRABBER_URL, REGIONS } from "./constants.js";
import { readFileSync } from "node:fs";
import { HELP, ABOUT, PRIVACY } from "./text.js";
import { openDb } from "./db.js";
import { createHandlers } from "./handlers.js";
import { UserError } from "./errors.js";
import { registerCommands } from "./registercmds.js";
import { createLogBuffer } from "./logbuffer.js";
import { createStatusMonitor } from "./status.js";
import { dirname, join } from "node:path";
import { createNotifier } from "./notify.js";
import { runCycle, runExtras, runReleases, runDigests, runSnapshots, runFreeGames, runGuildFeeds, schedule } from "./poller.js";
import { createOps } from "./ops.js";
import { runBackup } from "./backup.js";
import { createSteamHandlers } from "./steamhandlers.js";
import { createRedeemHandlers } from "./redeemhandlers.js";
import { createDealHandlers } from "./dealhandlers.js";
import { createFx } from "./fx.js";
import { createLfgService } from "./lfg.js";
import { createLfgHandlers } from "./lfghandlers.js";
import { createDashboard } from "./dashboard/server.js";
import { createDiscordRest } from "./dashboard/discord.js";
import { createVault } from "./vault.js";
import { createGiveawayService } from "./giveaway.js";
import { createTicketService } from "./tickets.js";
import { createSetupHandlers } from "./setup.js";
import { createTicketHandlers } from "./tickethandlers.js";
import { createGiveawayHandlers } from "./gwhandlers.js";

const MAX_TITLES = 100;
const COOLDOWN_MS = 15_000;
const PAGE_TIMEOUT_MS = 10 * 60_000;

const cfg = loadConfig();
const STARTED_AT = Date.now();
const VERSION = (() => { try { return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version; } catch { return "1.0.0"; } })();
// Recent log lines for the dashboard's Admin page. Errors are also kept in a file so crashes survive a restart.
const logs = createLogBuffer({ file: join(dirname(cfg.dbPath), "errors.jsonl"), secrets: [cfg.token, cfg.itadKey, cfg.keySecret, cfg.dashboard?.clientSecret, cfg.steamApiKey] });
logs.capture();
const itad = createItad({ apiKey: cfg.itadKey });
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const lastRun = new Map();
const db = openDb(cfg.dbPath);
const handlers = createHandlers({ db, itad, publicUrl: cfg.dashboard?.publicUrl ?? null, getStatus: () => status, getAbout: () => aboutInfo() });
const redeemUi = createRedeemHandlers({ db, publicUrl: cfg.dashboard?.publicUrl ?? null });
const steamUi = createSteamHandlers({ db, itad, apiKey: cfg.steamApiKey });
const fx = createFx();
const dealUi = createDealHandlers({ db, itad, fx });

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
// Who is in which voice channel right now, for game night nudges (needs the GuildVoiceStates intent).
const voiceMap = guildId => {
    const g = client.guilds.cache.get(guildId);
    if (!g) return null;
    const m = new Map();
    for (const v of g.voiceStates.cache.values()) {
        if (!v.channelId || v.member?.user?.bot) continue;
        if (!m.has(v.channelId)) m.set(v.channelId, []);
        m.get(v.channelId).push(v.id);
    }
    return m;
};

// Giveaways keep prize keys, so they only run when KEY_ENCRYPTION_SECRET is set.
const gwDiscord = {
    async post(channelId, payload) {
        const channel = await client.channels.fetch(channelId);
        if (!channel?.isTextBased()) throw new Error("Not a text channel");
        const m = await channel.send(payload);
        return { id: m.id };
    },
    /** A server event for a looking-for-group post. Needs the Manage Events permission; the caller handles the failure. */
    async createEvent(guildId, e) {
        const ev = await client.rest.post(Routes.guildScheduledEvents(guildId), { body: {
            name: e.name, description: e.description, scheduled_start_time: new Date(e.start).toISOString(), scheduled_end_time: new Date(e.end).toISOString(),
            privacy_level: 2, entity_type: 3, entity_metadata: { location: e.location }
        } });
        return { id: ev.id };
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
const publicBase = cfg.dashboard?.publicUrl ? cfg.dashboard.publicUrl.replace(/\/$/, "") : null;
const tickets = createTicketService({ db, discord: gwDiscord, ownerId: cfg.ownerId, publicUrl: publicBase, log: m => console.log(`[tickets] ${m}`) });
const ticketUi = createTicketHandlers({ db, tickets, ownerId: cfg.ownerId, publicUrl: publicBase });
const setupUi = createSetupHandlers({ db, publicUrl: publicBase });
const giveaways = cfg.keySecret
    ? createGiveawayService({ db, tickets, vault: createVault(cfg.keySecret), discord: gwDiscord, itad, multiBannerUrl: cfg.dashboard?.publicUrl ? `${cfg.dashboard.publicUrl.replace(/\/$/, "")}/multikey.png` : null, log: m => console.log(`[giveaway] ${m}`) })
    : null;
const gw = createGiveawayHandlers({ db, giveaways });
const lfg = createLfgService({ db, discord: gwDiscord, log: m => console.log(`[lfg] ${m}`) });
const lfgUi = createLfgHandlers({ db, lfg });

// Tracks health and DMs the owner (OWNER_DISCORD_ID) when something keeps failing.
const ops = createOps({
    sendOwner: async message => { if (cfg.ownerId) await discord.sendDm(cfg.ownerId, { content: message }); }
});

client.once(Events.ClientReady, c => {
    console.log(`Logged in as ${c.user.tag}`);

    // Price alerts
    schedule(
        async () => {
            const s = await runCycle({ db, itad, notifier, voiceMap, log: m => console.log(`[alerts] ${m}`) });
            console.log(`[alerts] checked ${s.checked} items, ${s.alerts} alerts, ${s.delivered} delivered, ${s.failed} failed, ${s.deferred} held for quiet hours`);
            beat.alerts = Date.now();
            await ops.cycleDone(s);
        },
        cfg.checkEveryMinutes * 60_000,
        { onError: err => { console.error(`[alerts] ${err.name}: ${err.message}`); ops.cycleThrew(err); } }
    );

    // Giveaways: ends them on time, passes unclaimed prizes on, sends "did it work?" follow-ups, deletes old keys
    if (giveaways) {
        schedule(
            async () => { await giveaways.tick(); beat.giveaways = Date.now(); },
            60_000,
            { onError: err => { console.error(`[giveaway] ${err.name}: ${err.message}`); ops.error("giveaways", err); } }
        );
    } else console.log("Giveaways are off (set KEY_ENCRYPTION_SECRET to turn them on).");

    // Support tickets: quiet ones resolve and close on their own
    schedule(async () => { await lfg.tick(); }, 5 * 60_000, { onError: err => { console.error(`[lfg] ${err.name}: ${err.message}`); ops.error("lfg", err); } });
    schedule(async () => { await tickets.tick(); }, 15 * 60_000, { onError: err => { console.error(`[tickets] ${err.name}: ${err.message}`); ops.error("tickets", err); } });

    // Bundles, giveaways, weekly digests, library snapshots, cleanup and the daily backup
    schedule(
        async () => {
            const log = m => console.log(`[maintenance] ${m}`);
            const result = {};
            try { result.extras = await runExtras({ db, itad, notifier, log }); } catch (err) { ops.error("extras", err); }
            try { result.releases = await runReleases({ db, itad, notifier, log }); } catch (err) { ops.error("releases", err); }
            try { result.free = await runFreeGames({ db, itad, notifier, log }); } catch (err) { ops.error("free games", err); }
            try { result.feeds = await runGuildFeeds({ db, itad, notifier, log }); } catch (err) { ops.error("server feeds", err); }
            try { result.digests = await runDigests({ db, itad, notifier, log }); } catch (err) { ops.error("digests", err); }
            try { result.snapshots = await runSnapshots({ db, itad, log }); } catch (err) { ops.error("snapshots", err); }
            try { db.pruneAlertLog(); db.pruneSeen(); db.pruneWatches(); db.pruneGuildSeen(); } catch (err) { ops.error("cleanup", err); }
            ops.maintenanceDone(result);
            try { await ops.backupDone(runBackup({ db, dir: cfg.backupDir, keep: cfg.backupKeep })); }
            catch (err) { await ops.backupDone(null, err); }
        },
        60 * 60_000,
        { onError: err => { console.error(`[maintenance] ${err.name}: ${err.message}`); ops.error("maintenance", err); } }
    );
});

// If the bot is removed from a server, forget that server's alert channel.
// A short setup guide for whoever owns a server the bot just joined. Once per server; a closed DM is ignored.
client.on(Events.GuildCreate, async guild => {
    try {
        if (!guild.joinedTimestamp || Date.now() - guild.joinedTimestamp > 5 * 60_000) return; // GuildCreate also fires for every server at startup
        if (db.getMeta(`welcomed:${guild.id}`)) return;
        db.setMeta(`welcomed:${guild.id}`, "1");
        const link = publicBase ? `${publicBase}/#/setup/${guild.id}` : null;
        const embed = { color: 0xff9800, title: `Thanks for adding Steam Value Checker to ${guild.name}`,
            description: ["It takes about a minute to set up:", "1. In your server, run **`/setup`** and press **Create the channels for me** (or pick existing channels from the menus).", link ? "2. Or do the same on the web: press the button below." : "", "", "Members can then use `/wishlist import`, `/value` and `/support open`. `/help` lists everything."].filter(x => x !== "" || true).join("\n") };
        const components = link ? [{ type: 1, components: [{ type: 2, style: 5, label: "Open setup page", url: link }] }] : [];
        await discord.sendDm(guild.ownerId, { embeds: [embed], components }).catch(async () => {
            // DMs closed: leave a short note where managers will see it
            const ch = guild.systemChannel; if (ch) await ch.send({ content: "Thanks for adding me! A server manager can run `/setup` to get started.", allowedMentions: { parse: [] } });
        });
    } catch { /* the owner may have DMs closed */ }
});

client.on(Events.GuildDelete, guild => { if (guild.available !== false) db.clearGuildChannel(guild.id); });

const reply = (i, content) => i.reply({ content, flags: MessageFlags.Ephemeral });
const beat = { alerts: null, giveaways: null }; // when each background job last finished, for the status page
const staleAfter = (at, everyMs) => (at === null ? Date.now() - STARTED_AT > everyMs * 3 : Date.now() - at > everyMs * 3);
const status = createStatusMonitor({
    db, log: m => console.error(`[status] ${m}`),
    notify: text => (cfg.ownerId ? discord.sendDm(cfg.ownerId, { content: text }) : null),
    probes: {
        gateway: { name: "Discord gateway and bot", desc: "Connection to Discord and slash command handling", critical: true, check: () => {
            if (!client.isReady() || client.ws.status !== 0) return { state: "down", detail: "Not connected to Discord" };
            const ping = client.ws.ping;
            return { state: ping > 1000 ? "degraded" : "operational", detail: Number.isFinite(ping) && ping >= 0 ? `${Math.round(ping)} ms` : null };
        } },
        database: { name: "Database", desc: "Wishlists, libraries, settings and giveaways", critical: true, check: () => { db.getMeta("last_run"); return { state: "operational" }; } },
        prices: { name: "Price data", desc: "IsThereAnyDeal lookups for prices, bundles and free games", critical: false, check: () => {
            const h = itad.health;
            if (!h?.lastErrorAt) return { state: "operational" };
            const recentErr = Date.now() - h.lastErrorAt < 15 * 60_000 && (!h.lastOkAt || h.lastErrorAt > h.lastOkAt);
            return recentErr ? { state: "degraded", detail: `Lookups failing (${h.lastError})` } : { state: "operational" };
        } },
        alerts: { name: "Deal and free game alerts", desc: "Hourly checks of every wishlist, free games and bundles", critical: false, check: () =>
            staleAfter(beat.alerts, cfg.checkEveryMinutes * 60_000) ? { state: "degraded", detail: "The last check is overdue" } : { state: "operational" } },
        ...(giveaways ? { giveaways: { name: "Giveaway engine", desc: "Ends giveaways on time and delivers prize keys", critical: false, check: () =>
            staleAfter(beat.giveaways, 60_000) ? { state: "degraded", detail: "The last run is overdue" } : { state: "operational" } } } : {}),
        dashboard: { name: "Web dashboard", desc: "This website and its API", critical: false, check: () => ({ state: "operational" }) }
    }
});
client.once(Events.ClientReady, () => { status.start(); });
const aboutInfo = () => collectAbout({ client, db, cfg, startedAt: STARTED_AT, version: VERSION });
/** Splits long text at line breaks so each piece fits one embed description (4096). Discord allows 6000 characters across a message's embeds. */
export function chunkText(text, max = 3900) {
    const out = [];
    let cur = "";
    for (const line of String(text).split("\n")) {
        if (cur && cur.length + line.length + 1 > max) { out.push(cur); cur = ""; }
        cur += (cur ? "\n" : "") + line;
    }
    if (cur) out.push(cur);
    return out;
}
const embedReply = (i, description) =>
    i.reply({ embeds: chunkText(description).map(d => ({ color: 0xff9800, description: d })), flags: MessageFlags.Ephemeral });

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

        const region = i.options.getString("region") ?? db.getUser(i.user.id)?.region ?? "US"; // reading a saved setting does not store anything
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
    if ((i.isButton() && /^alert_(snooze|below):/.test(i.customId)) || (i.isModalSubmit() && i.customId.startsWith("alert_m_below:"))) return handlers.handleAlertButton(i);
    if (i.isButton() && i.customId.startsWith("gn_pick:")) return handlers.handleGameNightButton(i);
    if (i.isButton() && i.customId.startsWith("lfg_")) return lfgUi.handleButton(i);
    if ((i.isButton() || i.isAnySelectMenu?.()) && i.customId.startsWith("su_")) return setupUi.handleComponent(i);
    if (i.isButton() && i.customId.startsWith("tk_")) return ticketUi.handleButton(i);
    if (i.isModalSubmit() && i.customId.startsWith("tk_")) return ticketUi.handleModal(i);
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
    if ((i.isButton() && i.customId.startsWith("fg:")) || (i.isStringSelectMenu() && i.customId.startsWith("fgs:"))) return handlers.handleFreeMenu(i);
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
            case "currency": {
                const user = db.ensureUser(i.user.id, i.guildId);
                const pick = i.options.getString("currency");
                const name = v => REGIONS.find(r => r.value === v)?.name ?? v;
                if (!pick) return await i.reply({ content: `Prices are shown in **${name(user.region)}**. Change it with \`/currency currency:\`, or from the dashboard's top bar.`, flags: MessageFlags.Ephemeral });
                db.updateUser(user.discord_id, { region: pick });
                return await i.reply({ content: `Prices are now in **${name(pick)}**, here and on the dashboard.`, flags: MessageFlags.Ephemeral });
            }
            case "redeem": return await redeemUi.handle(i);
            case "compare": return await handlers.handleCompare(i);
            case "steam": return await steamUi.handle(i);
            case "bundle": return await dealUi.handleBundle(i);
            case "regions": return await dealUi.handleRegions(i);
            case "saleprep": return await dealUi.handleSalePrep(i);
            case "serverlist": return await handlers.handleServerList(i);
            case "leaderboard": return await handlers.handleLeaderboard(i);
            case "freegames": return await handlers.handleFreeGames(i);
            case "status": return await handlers.handleStatus(i);
            case "support": return await ticketUi.handleCommand(i);
            case "gamenight": return await handlers.handleGameNight(i);
            case "lfg": return await lfgUi.handleCommand(i);
            case "setup": return await setupUi.handleCommand(i);
            case "changelog": return await handlers.handleChangelog(i);
            case "sales": return await handlers.handleSales(i);
            case "watch": return await handlers.handleWatch(i);
            case "serverstats": return await handlers.handleServerStats(i);
            case "publicpage": return await handlers.handlePublicPage(i);
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
    const dashboard = createDashboard({ db, itad, rest, fx, dm: (id, payload) => discord.sendDm(id, payload), ops, giveaways, tickets, logs, botInfo: aboutInfo, status, djsVersion: DJS_VERSION, botGuilds: id => client.guilds.cache.has(id), lfg, config: { ...d, steamApiKey: cfg.steamApiKey, backupDir: cfg.backupDir, creator: cfg.creator, clientId: cfg.clientId, ownerId: cfg.ownerId, trustProxy: cfg.trustProxy }, log: m => console.error(`[dashboard] ${m}`) });
    dashboard.listen().then(a => console.log(`Dashboard listening on ${a.address}:${a.port} (public address ${d.publicUrl})`))
        .catch(err => console.error(`[dashboard] could not start: ${err.message}`));
} else {
    console.log("Dashboard is off (set DASHBOARD_URL and DISCORD_CLIENT_SECRET to turn it on).");
}

// Breadcrumbs for the Admin log, so a restart is never silent: why it stopped, and how much memory it was using.
const memNote = () => { const m = process.memoryUsage(); return `rss ${Math.round(m.rss / 1048576)} MB, heap ${Math.round(m.heapUsed / 1048576)} MB`; };
console.log(`[boot] started, ${memNote()}, heap limit ${Math.round(v8.getHeapStatistics().heap_size_limit / 1048576)} MB`);
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { console.error(`[shutdown] received ${sig} (the host stopped the bot, e.g. a deploy or restart), ${memNote()}`); setTimeout(() => process.exit(0), 300); });
process.on("exit", code => { try { console.error(`[exit] code ${code}, ${memNote()}`); } catch { /* nothing left to do */ } });
setInterval(() => { const m = process.memoryUsage(); if (m.rss > 380 * 1048576) console.error(`[memory] high usage: ${memNote()}`); }, 60_000).unref();

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

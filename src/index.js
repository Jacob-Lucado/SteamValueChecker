import "dotenv/config";
import {
    ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, Client, ComponentType,
    Events, GatewayIntentBits, MessageFlags
} from "discord.js";
import { loadConfig } from "./config.js";
import { createItad, ItadError } from "./itad.js";
import { parseUpload, parseTyped, sanitize } from "./parse.js";
import { buildRows, sortRows, totals, resolvePaid, savingsReport } from "./report.js";
import { pageCount, tableEmbed, summaryEmbed, toCsv } from "./render.js";
import { HELP, ABOUT, PRIVACY } from "./text.js";
import { openDb } from "./db.js";
import { createHandlers, UserError } from "./handlers.js";
import { createNotifier } from "./notify.js";
import { runCycle, schedule } from "./poller.js";
import { createDashboard } from "./dashboard/server.js";
import { createDiscordRest } from "./dashboard/discord.js";

const MAX_TITLES = 100;
const MAX_FILE_BYTES = 200_000;
const COOLDOWN_MS = 15_000;
const PAGE_TIMEOUT_MS = 10 * 60_000;
const FILE_TYPES = [".csv", ".json", ".txt", ".md"];
const ALLOWED_HOSTS = [/(^|\.)discordapp\.com$/i, /(^|\.)discordapp\.net$/i, /(^|\.)discord\.com$/i];

const cfg = loadConfig();
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

client.once(Events.ClientReady, c => {
    console.log(`Logged in as ${c.user.tag}`);
    schedule(
        async () => {
            const s = await runCycle({ db, itad, notifier, log: m => console.log(`[alerts] ${m}`) });
            console.log(`[alerts] checked ${s.checked} items, ${s.alerts} alerts, ${s.delivered} delivered, ${s.failed} failed`);
        },
        cfg.checkEveryMinutes * 60_000,
        { onError: err => console.error(`[alerts] ${err.name}: ${err.message}`) }
    );
});

// If the bot is removed from a server, forget that server's alert channel.
client.on(Events.GuildDelete, guild => { if (guild.available !== false) db.clearGuildChannel(guild.id); });

const reply = (i, content) => i.reply({ content, flags: MessageFlags.Ephemeral });
const embedReply = (i, description) =>
    i.reply({ embeds: [{ color: 0xff9800, description }], flags: MessageFlags.Ephemeral });

async function readUpload(file) {
    const name = file.name.toLowerCase();
    if (!FILE_TYPES.some(ext => name.endsWith(ext))) {
        throw new UserError(`Unsupported file type. Upload a ${FILE_TYPES.join(", ")} export.`);
    }
    if (file.size > MAX_FILE_BYTES) throw new UserError("That file is too large (200 KB max).");
    const host = new URL(file.url).hostname;
    if (!ALLOWED_HOSTS.some(re => re.test(host))) throw new UserError("That attachment could not be read.");

    const res = await fetch(file.url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new UserError("Discord would not let the bot download that file.");
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_FILE_BYTES) throw new UserError("That file is too large (200 KB max).");
    return parseUpload(new TextDecoder("utf-8").decode(buf), name);
}


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
        try { await handlers.handleAutocomplete(i); } catch (err) { console.error(`[autocomplete] ${err.name}: ${err.message}`); }
        return;
    }
    if (!i.isChatInputCommand()) return;
    try {
        switch (i.commandName) {
            case "value": return await handleValue(i);
            case "wishlist": return await handlers.handleWishlist(i);
            case "alerts": return await handlers.handleAlerts(i);
            case "alertchannel": return await handlers.handleAlertChannel(i);
            case "mydata": return await handlers.handleMyData(i);
            case "help": return await embedReply(i, HELP);
            case "about": return await embedReply(i, ABOUT);
            case "privacy": return await embedReply(i, PRIVACY);
        }
    } catch (err) {
        console.error(`[${i.commandName}] ${err.name}: ${err.message}`);
    }
});

if (cfg.dashboard) {
    const d = cfg.dashboard;
    const rest = createDiscordRest({
        clientId: cfg.clientId, clientSecret: d.clientSecret, botToken: cfg.token, redirectUri: `${d.publicUrl}/auth/callback`
    });
    const dashboard = createDashboard({ db, itad, rest, config: { ...d, clientId: cfg.clientId }, log: m => console.error(`[dashboard] ${m}`) });
    dashboard.listen().then(a => console.log(`Dashboard listening on ${a.address}:${a.port} (public address ${d.publicUrl})`))
        .catch(err => console.error(`[dashboard] could not start: ${err.message}`));
} else {
    console.log("Dashboard is off (set DASHBOARD_URL and DISCORD_CLIENT_SECRET to turn it on).");
}

process.on("unhandledRejection", err => console.error(`[unhandledRejection] ${err?.message ?? err}`));

client.login(cfg.token);

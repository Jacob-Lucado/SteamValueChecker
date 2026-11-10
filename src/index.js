import { withoutInflated } from "./fakedeals.js";
import { steamReviews } from "./reviews.js";
import { createFortnite } from "./fortnite.js";
import "dotenv/config";
import { pingIndexNow } from "./indexnow.js";
import { dailySocial } from "./socialevents.js";
import { noticePreset } from "./noticepresets.js";
import { asksCreator, creatorEmbed } from "./aicreator.js";
import { missingAiPerms, permsNotice, shouldTell } from "./aiperms.js";
import v8 from "node:v8";
import {
    ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, Client, ComponentType,
    Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits, Routes,
    version as DJS_VERSION
} from "discord.js";
import { loadConfig } from "./config.js";
import { createItad, ItadError } from "./itad.js";
import { createLuna, withLuna } from "./luna.js";
import { createGamerPower, withGamerPower } from "./gamerpower.js";
import { createFreeWeekends, withFreeWeekends } from "./freeweekend.js";
import { createTopgg, VOTE_XP } from "./topgg.js";
import { pushEvent, readEvents } from "./adminlog.js";
import { createVoterRole } from "./voterrole.js";
import { createOffsite, offsiteConfig } from "./offsite.js";
import { runWatchdog } from "./watchdog.js";
import { runBootNotice } from "./bootnotice.js";
import { createSquare, squareConfig } from "./square.js";
import { createSupporters } from "./supporters.js";
import { groupErrors } from "./adminlog.js";
import { runOwnerSummary, runReleaseNotes } from "./ownersummary.js";
import { CHANGELOG, LATEST } from "./changelog.js";
import { createCommandWatch } from "./cmdwatch.js";
import { ensureCreatorRole } from "./creatorrole.js";
import { storageReport } from "./storage.js";
import { createEpicSoon } from "./epicsoon.js";
import { createNews } from "./news.js";
import { humanCount, warmMembers } from "./members.js";
import { renderWelcomeCard, renderRecap } from "./cardimg.js";
import { parseTyped, sanitize } from "./parse.js";
import { readUpload } from "./upload.js";
import { buildRows, sortRows, totals, resolvePaid, savingsReport } from "./report.js";
import { voteThanksEmbed, pageCount, tableEmbed, summaryEmbed, toCsv, FREE_CLAIM_ALL_ID, STOP_ID, aboutPayload } from "./render.js";
import { collectAbout } from "./about.js";
import { SUPPORT_PAGE_URL, FANATICAL_GRABBER_URL, EXTENSION_STORE_URL, REGIONS } from "./constants.js";
import { readFileSync } from "node:fs";
import { ABOUT, PRIVACY, quickStart } from "./text.js";
import { helpPayload, handleHelpPick, configureHelp, isHelpNav } from "./helpui.js";
import { brandInteraction, brandRest } from "./brand.js";
import { pagedPayload, handlePager, tokenOf, PAGE_PREFIX, JUMP_PREFIX } from "./pager.js";
import { legacyRoute, SERVER_ONLY_LEGACY, hubCommands } from "./commands.js";
import { hubPanel, replayAsCommand, areaIndex } from "./hubpanel.js";
import { wishlistPanel, libraryPanel, streamPanel } from "./bespoke.js";
import { areaGlance } from "./panelglance.js";
import { createProfileHandlers } from "./profilehandlers.js";
import { createStreams } from "./streamlive.js";
import { createStreamHandlers } from "./streamhandlers.js";
import { createStreamWatch, watchable, CHECK_EVERY_MS } from "./streamwatch.js";
import { openDb } from "./db.js";
import { createHandlers } from "./handlers.js";
import { createPanels, PANEL_PREFIX } from "./panel.js";
import { alertPanel } from "./alertpanel.js";
import { UserError } from "./errors.js";
import { registerCommands } from "./registercmds.js";
import { createLogBuffer, ACTIVITY } from "./logbuffer.js";
import { isHidden } from "./hidden.js";
import { createStatusMonitor } from "./status.js";
import { dirname, join } from "node:path";
import { configureArt } from "./art.js";
import { BG_INACTIVE_MS } from "./profilebg.js";
import { createNotifier } from "./notify.js";
import { refreshDlc, runDlcSales } from "./dlc.js";
import { runYearInGames } from "./yearly.js";
import { runServerWrapped } from "./serverwrapped.js";
import { runRivalries } from "./rivalry.js";
import { runBacklogNudge, runAchievementNudges } from "./nudge.js";
import { runSocialDigest } from "./socialdigest.js";
import { runPlaytests, refreshPlaytestChannel } from "./playtests.js";
import { createNowPlaying, runSquadUps } from "./nowplaying.js";
import { createClubHandlers, runGameClubs } from "./gameclub.js";
import { createSantaHandlers } from "./santa.js";
import { createTrivia, createTriviaHandlers } from "./trivia.js";
import { createStreamGiveaways } from "./streamgiveaway.js";
import { createTwitchChat } from "./twitchchat.js";
import { createAbgFeed } from "./abgfeed.js";
import { createPlaytestSources } from "./playsources.js";
import { runRefundWarnings, runRefundDrops, runMilestones } from "./playalerts.js";
import { refreshTags } from "./taste.js";
import { runSteamAutoSync } from "./steamlib.js";
import { runWishlistAutoSync } from "./wishlist.js";
import { importWishlist } from "./steam.js";
import { runFriendReminders } from "./friends.js";
import { steamStillUpcoming } from "./steamrelease.js";
import { runCycle, runExtras, runReleases, runDigests, runSnapshots, runFreeGames, runEpicSoon, runNews, runGuildFeeds, runHotDeals, runSaleStarts, runServerDigests, schedule } from "./poller.js";
import { createOps } from "./ops.js";
import { runBackup } from "./backup.js";
import { createSteamHandlers } from "./steamhandlers.js";
import { createCardHandlers } from "./cardhandlers.js";
import { createRedeemHandlers } from "./redeemhandlers.js";
import { createDealHandlers } from "./dealhandlers.js";
import { createFx } from "./fx.js";
import { createLfgService } from "./lfg.js";
import { createCalendarService } from "./calendar.js";
import { createCalendarHandlers } from "./calendarhandlers.js";
import { createLfgHandlers } from "./lfghandlers.js";
import { createDashboard, RESTRICTED_TEXT } from "./dashboard/server.js";
import { createDiscordRest } from "./dashboard/discord.js";
import { createVault } from "./vault.js";
import { createGiveawayService } from "./giveaway.js";
import { createTicketService } from "./tickets.js";
import { createSetupHandlers } from "./setup.js";
import { createTicketHandlers } from "./tickethandlers.js";
import { createCodeHandlers } from "./codeshandlers.js";
import { runCodes } from "./codes.js";
import { runBundleFeed } from "./bundlefeed.js";
import { createXPoster } from "./xposter.js";
import { createIndie } from "./indie.js";
import { configureDeals } from "./deallinks.js";
import { createWeekly } from "./weeklydeals.js";
import { createSpotlight } from "./indiespotlight.js";
import { createIndieNews } from "./indienews.js";
import { createReferrals } from "./referrals.js";
import { createBundleFeedHandlers } from "./bundlefeedhandlers.js";
import { createDropHandlers } from "./dropshandlers.js";
import { runDrops } from "./drops.js";
import { createMusic } from "./music.js";
import { createSource } from "./musicsource.js";
import { createStations } from "./stations.js";
import { probeRadio } from "./musicradio.js";
import { createMusicHandlers, guildAdapter } from "./musichandlers.js";
import { nowPlayingPayload, playerLink } from "./musicrender.js";
import { createRequestHandlers, FR } from "./requesthandlers.js";
import { publishRequest } from "./requestsync.js";
import { createGiveawayHandlers } from "./gwhandlers.js";
import { createCommunity } from "./communityservice.js";
import { createCommunityHandlers, setupSummary } from "./communityhandlers.js";
import { dashPayload } from "./dashlink.js";
import { startPresence } from "./presence.js";
import { createModeration } from "./moderation.js";
import { createModHandlers } from "./modhandlers.js";
import { tickLeaderboards } from "./leaderboard.js";
import { createMemes, createMemeHandlers, tickMemes } from "./memes.js";
import { createBroadcaster } from "./broadcast.js";
import { honeypotHit, refreshHoneypotNotice } from "./honeypot.js";
import { createAiChat, parseTrigger, AI_FAILURES } from "./aichat.js";
import { createRuntimeCfg } from "./runtimecfg.js";
import { createAiTools } from "./aitools.js";
import { cardsPayload, handleAiButton, AI_PREFIX } from "./aicards.js";
import { matchGuide, matchServerGuide, serverGuidePayload, guidePayload, handleGuideInteraction, GUIDE_BUTTON, createGuideThrottle } from "./guides.js";
import { PROVIDER_IDS } from "./aiproviders.js";
import { createMainGuild } from "./mainguild.js";
import { liteAnswer } from "./ailite.js";
import { guildBannerSvg, toPng, artFor } from "./communitycards.js";
let logoUri;
const brandLogo = () => { try { return (logoUri ??= "data:image/png;base64," + readFileSync(new URL("../public/logo.png", import.meta.url)).toString("base64")); } catch { return null; } };
import { grabberPromo, PROMO_OFF_ID } from "./promo.js";
import { communitySetup, isFreshGuild, botInviteUrl } from "./community.js";
import { registerLinkedRoles } from "./linkedroles.js";

const MAX_TITLES = 100;
const COOLDOWN_MS = 15_000;
const PAGE_TIMEOUT_MS = 10 * 60_000;

const cfg = loadConfig();
const STARTED_AT = Date.now();
const VERSION = (() => { try { return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version; } catch { return "1.0.0"; } })();
// Recent log lines for the dashboard's Admin page. Errors are also kept in a file so crashes survive a restart.
const logs = createLogBuffer({ file: join(dirname(cfg.dbPath), "errors.jsonl"), secrets: [cfg.token, cfg.itadKey, cfg.keySecret, cfg.dashboard?.clientSecret, cfg.steamApiKey, process.env.TOPGG_TOKEN] });
logs.capture();
const luna = createLuna({ enabled: process.env.LUNA_CLAIMS !== "off", log: m => console.log(`[luna] ${m}`) });
const epicSoon = createEpicSoon();
const news = createNews();
// Every playtest source in one list (Alpha Beta Gamer, GamerPower, itch.io, Steam's new demos), with duplicates between them removed.
const abg = createPlaytestSources({ abg: createAbgFeed(), log: m => console.warn(`[playtests] ${m}`) });
const gamerPower = createGamerPower({ enabled: process.env.GAMERPOWER !== "off", log: m => console.log(`[gamerpower] ${m}`) });
const freeWeekends = createFreeWeekends({ enabled: process.env.FREE_WEEKENDS !== "off", log: m => console.log(`[free weekends] ${m}`) });
const itad = withoutInflated(withFreeWeekends(withGamerPower(withLuna(createItad({ apiKey: cfg.itadKey }), luna), gamerPower), freeWeekends), steamReviews);
// Welcome messages and invite tracking need the Server Members intent, which is a switch in the Developer Portal.
// Ask Discord whether it is on before using it: asking for an intent that is off makes the login fail.
const APP_FLAGS = await (async () => {
    try {
        const r = await fetch("https://discord.com/api/v10/applications/@me", { headers: { Authorization: `Bot ${cfg.token}` }, signal: AbortSignal.timeout(10_000) });
        if (!r.ok) return 0;
        return (await r.json()).flags ?? 0;
    } catch { return 0; }
})();
const MEMBERS_INTENT = Boolean(APP_FLAGS & ((1 << 14) | (1 << 15))); // GATEWAY_GUILD_MEMBERS or the limited version
// "Hey AI ..." needs the Message Content intent (another Developer Portal switch). Mentioning the bot works without it.
const CONTENT_INTENT = Boolean(APP_FLAGS & ((1 << 18) | (1 << 19)));
console.log(CONTENT_INTENT ? "[ai] Message Content intent is on: \"Hey AI\" and mentions work." : "[ai] Message Content intent is off: only mentions of the bot work. Turn it on in the Developer Portal (Bot > Privileged Gateway Intents) so \"Hey AI\" works too.");
console.log(cfg.anthropicKey ? "[ai] The bot has its own AI key." : "[ai] No bot AI key: the bot answers common questions itself, and servers can bring their own key.");
console.log(MEMBERS_INTENT ? "[community] Server Members intent is on: welcome messages and invite tracking are active." : "[community] Server Members intent is off: turn it on in the Developer Portal (Bot > Privileged Gateway Intents) for welcome messages and invite tracking.");
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildInvites, ...(MEMBERS_INTENT ? [GatewayIntentBits.GuildMembers] : []), ...(CONTENT_INTENT ? [GatewayIntentBits.MessageContent] : [])] });
client.setMaxListeners(30); // each feature adds its own startup listener, and there are now more than the default ten
const lastRun = new Map();
const db = openDb(cfg.dbPath);
const offsite = createOffsite({ ...offsiteConfig(), secret: cfg.keySecret, db, log: t => console.log(`[offsite] ${t}`) });
try { db.purgeHiddenGuilds(); } catch { /* nothing to purge yet */ } // test servers keep no history (hidden.js)
setInterval(() => { try { db.purgeHiddenGuilds(); } catch { /* try again next time */ } }, 30 * 60_000).unref();
const nowPlaying = createNowPlaying({ apiKey: cfg.steamApiKey });
const panels = createPanels({ db });
panels.register("alerts", alertPanel({ db }));
// "Run it" in a hub menu replays the command as if it had been typed, minus options (only commands with none are offered).
const runFromPanel = (i, hub, path, vals) => { try { db.bumpMeta(`pnuse:${hub} ${path.join(" ")}`); } catch { /* counting is best effort */ } return replayAsCommand(i, hub, path, onInteraction, vals); };
const glanceFor = areaGlance(db);
const HUB_MENUS = ["games", "me", "server", "manage", "bot", "mod", "music"];
const GLANCE = {
    me: ctx => { const u = ctx.user; return ["", `Watching **${ctx.db.countItems(u.discord_id)}** games · prices in **${u.region}** · alerts ${u.paused ? "paused" : "on"}`]; }
};
const BESPOKE = { me: { wishlist: ["wl", "Wishlist panel"], library: ["lib", "Library panel"] }, server: { stream: ["strm", "Streaming panel"] } };
for (const json of hubCommands.filter(c => HUB_MENUS.includes(c.name))) {
    panels.register(`hub-${json.name}`, hubPanel({ json, bespoke: BESPOKE[json.name], glance: GLANCE[json.name], areaGlance: (ctx, area) => glanceFor(ctx, json.name, area), dashUrl: cfg.dashboard?.publicUrl ?? null, runner: runFromPanel }));
}
{
    const meJson = hubCommands.find(c => c.name === "me"), srvJson = hubCommands.find(c => c.name === "server");
    const back = (hub, json, key) => ({ id: `hub-${hub}`, page: `a${areaIndex(json, key)}` });
    panels.register("wl", { ...wishlistPanel({ db, replay: runFromPanel }), back: back("me", meJson, "wishlist") });
    panels.register("lib", { ...libraryPanel({ db }), back: back("me", meJson, "library") });
    panels.register("strm", { ...streamPanel({ db, replay: runFromPanel }), back: back("server", srvJson, "stream") });
}
const handlers = createHandlers({ ownerId: cfg.ownerId, panels, db, itad, nowPlaying, publicUrl: cfg.dashboard?.publicUrl ?? null, getStatus: () => status, getAbout: () => aboutInfo(), news });
const redeemUi = createRedeemHandlers({ db, publicUrl: cfg.dashboard?.publicUrl ?? null });
const steamUi = createSteamHandlers({ db, itad, apiKey: cfg.steamApiKey, publicUrl: cfg.dashboard?.publicUrl ?? null });
const profileUi = createProfileHandlers({ db, publicUrl: cfg.dashboard?.publicUrl ?? null });
const cardUi = createCardHandlers({ db, itad, nowPlaying, publicUrl: cfg.dashboard?.publicUrl ?? null });
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
// Community features (welcome, XP, invites, emoji) use the bot's REST helper, the same one the dashboard uses.
const botRest = createDiscordRest({ clientId: cfg.clientId, clientSecret: cfg.dashboard?.clientSecret ?? "", botToken: cfg.token, redirectUri: "http://localhost/unused" });
const community = createCommunity({ db, api: botRest, renderCard: renderWelcomeCard, dm: (id, p) => discord.sendDm(id, p), dashboardUrl: cfg.dashboard?.publicUrl ?? null, ownerId: cfg.ownerId });
// Top.gg votes: thank each voter with bonus XP. Needs the TOPGG_TOKEN secret; without it this stays quiet.
let voterRole = null; // made once the main server helper exists, a few lines further down
const topgg = createTopgg({
    token: process.env.TOPGG_TOKEN, db, log: m => console.log(`[topgg] ${m}`),
    reward: (userId, xp) => community.grantBonusXp(userId, xp),
    notify: async (userId, v) => {
        const got = v.servers ? `You just got **+${v.xp} XP** in ${v.servers} server${v.servers === 1 ? "" : "s"}.` : "Chat in a server with levels turned on and your next vote will pay out there.";
        voterRole?.grant(userId, v.expiresAt);
        await discord.sendDm(userId, voteThanksEmbed({ got, expiresAt: v.expiresAt, total: v.total, voteUrl: `https://top.gg/bot/${client.user?.id ?? cfg.clientId}/vote` }));
    }
});
const moderation = createModeration({ db, api: botRest, dm: (id, p) => discord.sendDm(id, p), botId: () => client.user?.id ?? cfg.clientId });
const modUi = createModHandlers({ db, mod: moderation });
const streamGw = createStreamGiveaways({ db, giveaways: () => giveaways });
const streams = createStreams({ db, api: botRest, onEnd: (g, u) => streamGw.onEnd(g, u) });
const memes = createMemes();
const memeUi = createMemeHandlers({ db, api: botRest, memes });
const streamSites = watchable(process.env);
const streamWatch = createStreamWatch({ db, streams, api: botRest, log: m => console.log(`[stream watch] ${m}`),
    // someone who linked as a role-holder must still hold the streamer or moderator role
    access: async l => { if (l.via !== "role") return true; const c = db.getCommunity(l.guild_id); const m = await botRest.getMember(l.guild_id, l.user_id).catch(() => null); if (!m) return true; return Boolean((c.streamer_role_id && m.roles?.includes(c.streamer_role_id)) || (c.mod_role_id && m.roles?.includes(c.mod_role_id))); } });
const streamUi = createStreamHandlers({ db, streams, streamGw, ownerId: cfg.ownerId, publicUrl: cfg.dashboard?.publicUrl ?? null, canWatch: p => Boolean(streamSites[p]) });
const playtestRefresh = { refresh: (guildId, { limit } = {}) => refreshPlaytestChannel({ db, news, abg, notifier, guildId, limit, log: m => console.warn(`[playtests] ${m}`) }) };
const communityUi = createCommunityHandlers({ db, api: botRest, service: community, playtests: playtestRefresh, publicUrl: cfg.dashboard?.publicUrl ?? null, membersIntent: () => MEMBERS_INTENT, aiAvailable: () => ai.available, aiPhrase: () => CONTENT_INTENT });
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
    dm: async (userId, payload) => { const user = await client.users.fetch(userId); const m = await user.send(payload); return { id: m.id, channelId: m.channelId }; },
    async memberOk(guildId, userId) {
        try { const g = await client.guilds.fetch(guildId); await g.members.fetch(userId); return true; }
        catch (e) { return !(e?.code === 10007 || e?.status === 404); } // false only for "Unknown Member"
    },
    /** Roles and join dates for a server member, or null when they aren't in the server. Used when a viewer types !enter in Twitch chat. */
    async memberInfo(guildId, userId) {
        try {
            const g = await client.guilds.fetch(guildId), m = await g.members.fetch(userId);
            return { roleIds: [...m.roles.cache.keys()], boosting: Boolean(m.premiumSinceTimestamp), joinedAt: m.joinedTimestamp ?? null, createdAt: m.user.createdTimestamp ?? null };
        } catch (e) { if (e?.code === 10007 || e?.status === 404) return null; throw e; }
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
// every message the bot sends gets the same finish: colour, name and logo in the footer, bare text turned into a card
// links to free games and bundles go through a page on the site first (it shows the deal, counts the visit, then sends people to the store)
if (publicBase) configureDeals({ base: publicBase, make: deal => { const id = db.upsertDeal(deal); return id ? `${publicBase}/d/${id}` : null; } });
configureArt({ base: publicBase, dir: join(dirname(cfg.dbPath), "art") });
const brandOpts = { logo: publicBase ? `${publicBase}/logo.png` : null };
brandRest(botRest, brandOpts); brandRest(discord, brandOpts);
configureHelp({ base: publicBase, supportUrl: cfg.creator?.url ?? null, inviteUrl: cfg.clientId ? botInviteUrl(cfg.clientId) : null });
const tickets = createTicketService({ db, discord: gwDiscord, ownerId: cfg.ownerId, publicUrl: publicBase, log: m => (m.startsWith("[bug") ? console.error(m) : console.log(`[tickets] ${m}`)) });
let codesBusy = false;
const pollCodes = async () => {
    if (codesBusy) return null;
    codesBusy = true;
    try { return await runCodes({ db, api: botRest, base: publicBase, notifier, log: m => console.log(`[codes] ${m}`) }); } finally { codesBusy = false; }
};
const codeUi = createCodeHandlers({ db, runNow: pollCodes });
let bundlesBusy = false;
const pollBundles = async ({ deep = false } = {}) => {
    if (bundlesBusy) return null;
    bundlesBusy = true;
    try { const r = await runBundleFeed({ db, api: botRest, deep, log: m => console.log(`[bundles] ${m}`) }); beat.bundles = Date.now(); beat.bundleError = r?.feedError ?? null; return r; } finally { bundlesBusy = false; }
};
const bundleUi = createBundleFeedHandlers({ db, runNow: pollBundles });
let dropsBusy = false;
const pollDrops = async () => {
    if (dropsBusy) return null;
    dropsBusy = true;
    try { return await runDrops({ db, api: botRest, notifier, log: m => console.log(`[promos] ${m}`) }); } finally { dropsBusy = false; }
};
const dropUi = createDropHandlers({ db, runNow: pollDrops });
// Music needs Discord's voice library. If it ever fails to load the rest of the bot still runs.
const musicGuild = guildAdapter(client);
const playerBase = cfg.dashboard ? (cfg.dashboard.musicUrl ? cfg.dashboard.musicUrl.replace(/\/$/, "") + "/" : publicBase + "/music") : null;
let music = null, musicUi = null;
const stations = createStations({ probe: probeRadio });
try {
    const voice = await import("@discordjs/voice");
    music = createMusic({ db, source: createSource(), voice, getGuild: musicGuild, api: botRest, panel: (gid, st) => nowPlayingPayload(st, playerLink(playerBase, gid), gid), log: m => console.log(`[music] ${m}`) });
    musicUi = createMusicHandlers({ db, music, adapter: musicGuild, stations, playerBase });
} catch (err) { console.error(`[music] turned off: ${err.message}`); }
const musicOff = i => (i.isRepliable?.() ? i.reply({ content: "Music isn't available on this bot right now.", flags: MessageFlags.Ephemeral }).catch(() => {}) : null);
const requestUi = createRequestHandlers({ db, publicUrl: publicBase, publish: id => publishRequest({ db, api: botRest, id, base: publicBase }) });
const ticketUi = createTicketHandlers({ db, tickets, ownerId: cfg.ownerId, publicUrl: publicBase });
const setupUi = createSetupHandlers({ db, publicUrl: publicBase });
const giveaways = cfg.keySecret
    ? createGiveawayService({ db, tickets, vault: createVault(cfg.keySecret), discord: gwDiscord, itad, multiBannerUrl: cfg.dashboard?.publicUrl ? `${cfg.dashboard.publicUrl.replace(/\/$/, "")}/multikey.png` : null, log: m => console.log(`[giveaway] ${m}`) })
    : null;
const gw = createGiveawayHandlers({ db, giveaways });
const twitchChat = createTwitchChat({ db, giveaways, streamGw, member: (g, u) => discord.memberInfo(g, u), site: publicBase ?? "", env: process.env, log: m => console.log(`[twitch chat] ${m}`) });
client.once(Events.ClientReady, () => { if (giveaways && process.env.TWITCH_CHAT !== "off") twitchChat.start(); });
const lfg = createLfgService({ db, discord: gwDiscord, log: m => console.log(`[lfg] ${m}`) });
const lfgUi = createLfgHandlers({ db, lfg });
const calendar = createCalendarService({ db, discord: gwDiscord, log: m => console.log(`[calendar] ${m}`) });
const clubUi = createClubHandlers({ db });
const santaUi = createSantaHandlers({ db, itad, sendDm: (id, p) => discord.sendDm(id, p), nameOf: async id => { const u = await client.users.fetch(id).catch(() => null); return u ? (u.globalName || u.username) : `<@${id}>`; } });
const trivia = createTrivia({ db, sendMessage: (c, p) => botRest.sendMessage(c, p), editMessage: (c, m, p) => botRest.editMessage(c, m, p), log: m => console.log(`[trivia] ${m}`) });
const triviaUi = createTriviaHandlers({ trivia });
const calendarUi = createCalendarHandlers({ db, calendar, publicUrl: publicBase });

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
    schedule(async () => { await calendar.tick(); }, 5 * 60_000, { onError: err => { console.error(`[calendar] ${err.name}: ${err.message}`); ops.error("calendar", err); } });
    schedule(async () => { await lfg.tick(); }, 5 * 60_000, { onError: err => { console.error(`[lfg] ${err.name}: ${err.message}`); ops.error("lfg", err); } });
    schedule(async () => { await pollBundles(); }, 30 * 60_000, { onError: err => { console.error(`[bundles] ${err.name}: ${err.message}`); ops.error("bundle feed", err); } });
    schedule(async () => { await pollCodes(); }, 20 * 60_000, { onError: err => { console.error(`[codes] ${err.name}: ${err.message}`); ops.error("game codes", err); } });
    schedule(async () => { await pollDrops(); }, 30 * 60_000, { onError: err => { console.error(`[promos] ${err.name}: ${err.message}`); ops.error("promo drops", err); } });
    schedule(async () => { await tickets.tick(); }, 15 * 60_000, { onError: err => { console.error(`[tickets] ${err.name}: ${err.message}`); ops.error("tickets", err); } });

    // Bundles, giveaways, weekly digests, library snapshots, cleanup and the daily backup
    schedule(
        async () => {
            const log = m => console.log(`[maintenance] ${m}`);
            const result = {};
            result.extras = await ops.job("extras", () => runExtras({ db, itad, notifier, log }));
            result.tags = await ops.job("genre tags", () => refreshTags({ db, appids: db.allAppsNeedingTags(30), delayMs: 1200 }));
            result.dlcLists = await ops.job("dlc lists", async () => ({ checked: await refreshDlc({ db, appids: db.appsNeedingDlc(30) }) }));
            result.dlc = await ops.job("dlc sales", () => runDlcSales({ db, itad, notifier, log }));
            result.refund = await ops.job("refund warnings", () => runRefundWarnings({ db, notifier }));
            result.refundDrops = await ops.job("refund price drops", () => runRefundDrops({ db, itad, notifier }));
            result.milestones = await ops.job("milestones", () => runMilestones({ db, notifier }));
            result.achv = await ops.job("achievement nudges", () => runAchievementNudges({ db, notifier }));
            result.digest = await ops.job("feed digest", () => runSocialDigest({ db, notifier, dashboardUrl: cfg.dashboard?.publicUrl ?? null }));
            result.nudge = await ops.job("backlog pick", () => runBacklogNudge({ db, notifier }));
            result.yearly = await ops.job("year in games", () => runYearInGames({ db, notifier, render: (userId, name) => renderRecap({ db, userId, name }) }));
            result.serverWrapped = await ops.job("server wrapped", () => runServerWrapped({ db, notifier, log, guildName: id => client.guilds.cache.get(id)?.name,
                nameOfMany: async ids => { const m = new Map(); await Promise.all([...new Set(ids)].map(async id => { try { const u = await client.users.fetch(id); m.set(id, u.globalName ?? u.username); } catch { m.set(id, "a member"); } })); return m; } }));
            result.rivalry = await ops.job("server rivalries", () => runRivalries({ db, notifier, log, guildName: id => client.guilds.cache.get(id)?.name }));
            result.releases = await ops.job("releases", () => runReleases({ db, itad, notifier, log, stillUpcoming: steamStillUpcoming }));
            result.free = await ops.job("free games", () => runFreeGames({ db, itad, notifier, log }));
            result.news = await ops.job("news", () => runNews({ db, news, notifier, log }));
            result.gameClub = await ops.job("game club", () => runGameClubs({ db, notifier, log }));
            result.playtests = await ops.job("playtests", () => runPlaytests({ db, news, abg, notifier, log }));
            result.epicSoon = await ops.job("epic soon", () => runEpicSoon({ db, soon: epicSoon, notifier, log }));
            result.feeds = await ops.job("server feeds", () => runGuildFeeds({ db, itad, notifier, log }));
            result.hotDeals = await ops.job("hot deals", () => runHotDeals({ db, itad, notifier, log }));
            result.saleStarts = await ops.job("sale starts", () => runSaleStarts({ db, notifier, log }));
            result.serverDigests = await ops.job("server digests", () => runServerDigests({ db, itad, notifier, names: id => client.guilds.cache.get(id)?.name, log }));
            result.friends = await ops.job("friend reminders", () => runFriendReminders({ db, itad, notifier, log }));
            result.digests = await ops.job("digests", () => runDigests({ db, itad, notifier, log }));
            result.snapshots = await ops.job("snapshots", () => runSnapshots({ db, itad, log }));
            result.steamSync = await ops.job("steam auto-sync", () => runSteamAutoSync({ db, itad, apiKey: cfg.steamApiKey, log }));
            result.wishSync = await ops.job("wishlist auto-sync", () => runWishlistAutoSync({ db, itad, importWishlist, log }));
            try { db.pruneAlertLog(); db.pruneSeen(); db.pruneWatches(); db.pruneGuildSeen(); db.prunePlaytime(); db.pruneGiftClaims(); db.pruneInactiveProfileBgs(BG_INACTIVE_MS); dailySocial(db); } catch (err) { ops.error("cleanup", err); }
            result.watchdog = await ops.job("watchdog", () => runWatchdog({ ops, logs, storage: () => storageReport({ dbPath: cfg.dbPath, backupDir: cfg.backupDir, db }) }));
            result.ownerSummary = await ops.job("owner summary", () => runOwnerSummary({ db, ownerId: cfg.ownerId, sendDm: (id, p) => discord.sendDm(id, p), gather: async () => ({
                servers: client.guilds.cache.size, errors: logs.recent({ level: "error", limit: 500 }).filter(l => l.at >= Date.now() - 7 * 86_400_000).length,
                diskPct: (await storageReport({ dbPath: cfg.dbPath, backupDir: cfg.backupDir, db }))?.volume?.pct ?? null }) }));
            result.releaseNotes = await ops.job("release notes", () => runReleaseNotes({ db, channelId: process.env.RELEASE_CHANNEL_ID, version: LATEST, entry: CHANGELOG[0], sendChannel: (id, p) => discord.sendChannel(id, p) }));
            ops.maintenanceDone(result);
            let backedUp = null;
            try { backedUp = runBackup({ db, dir: cfg.backupDir, keep: cfg.backupKeep }); await ops.backupDone(backedUp); }
            catch (err) { await ops.backupDone(null, err); }
            // Then the same file goes offsite (once per day; it skips what it already sent). A failure here only warns the owner.
            if (offsite.enabled && backedUp?.file) {
                result.offsite = await ops.job("offsite backup", async () => {
                    try { return await offsite.upload(backedUp.file); }
                    catch (err) { await ops.incident("offsite", `Steam Value Checker: the offsite backup could not be uploaded (${String(err.message).slice(0, 120)}). The local backup is fine.`); throw err; }
                });
            }
        },
        60 * 60_000,
        { onError: err => { console.error(`[maintenance] ${err.name}: ${err.message}`); ops.error("maintenance", err); } }
    );
});

// If the bot is removed from a server, forget that server's alert channel.
// A short setup guide for whoever owns a server the bot just joined. Once per server; a closed DM is ignored.
let adLast = 0;
// A heads-up for the owner whenever the bot is added to or removed from a server, and a short history for the admin Servers page.
client.on(Events.GuildCreate, async guild => {
    try {
        if (isHidden(guild.id) || db.isGuildBlocked(guild.id) || !guild.joinedTimestamp || Date.now() - guild.joinedTimestamp > 5 * 60_000) return;
        const key = `joinalert:${guild.id}:${guild.joinedTimestamp}`;
        if (db.getMeta(key)) return;
        db.setMeta(key, "1");
        const members = humanCount(guild);
        pushEvent(db, "adminlog:servers", { kind: "join", at: Date.now(), id: guild.id, name: guild.name, members }, 60);
        if (cfg.ownerId) await discord.sendDm(cfg.ownerId, { embeds: [{ color: 0x57f287, title: "New server", description: `The bot was added to **${guild.name}**.`, fields: [{ name: "Members", value: String(members), inline: true }, { name: "Servers now", value: String(client.guilds.cache.size), inline: true }], footer: { text: `Server ${guild.id}` }, timestamp: new Date().toISOString() }] }).catch(() => {});
    } catch (err) { console.error(`[join-alert] ${err.message}`); }
});
// A server the owner has blocked: leave again right away, before anything else reacts to the join.
client.on(Events.GuildCreate, guild => { if (db.isGuildBlocked(guild.id)) guild.leave().catch(err => console.warn(`[blocked-server] ${err.message}`)); });
client.on(Events.GuildCreate, async guild => {
    if (db.isGuildBlocked(guild.id)) return;
    ensureCreatorRole(guild, cfg.ownerId, console.warn); // also runs for every server at startup, which covers servers the owner is already in
    try {
        if (!guild.joinedTimestamp || Date.now() - guild.joinedTimestamp > 5 * 60_000) return; // GuildCreate also fires for every server at startup
        if (MEMBERS_INTENT) guild.members.fetch({ time: 30_000 }).catch(() => {}); // so its bots can be left out of the member count
        if (db.getMeta(`welcomed:${guild.id}`)) return;
        db.setMeta(`welcomed:${guild.id}`, "1");
        // A brand-new server (only Discord's default channels) is built for them right away: the usual gaming layout, welcome, XP, and the bot's own channels.
        let auto = null, autoNote = null;
        try {
            const [channels, roles] = await Promise.all([botRest.allChannels(guild.id), botRest.allRoles(guild.id)]);
            if (isFreshGuild({ channels, roles: roles.map(r => ({ ...r, guild_id: guild.id })), memberCount: humanCount(guild) })) {
                auto = await communitySetup({ api: botRest, db, guildId: guild.id, botId: client.user.id, userId: guild.ownerId, fresh: true, baseUrl: publicBase });
            }
        } catch (e) { autoNote = e.userFacing ? e.message : "I tried to set the server up but hit a problem. Run /manage community setup to try again."; }
        const link = publicBase ? `${publicBase}/#/setup/${guild.id}` : null;
        let embed = { color: 0xff9800, title: `Steam Value Checker is now in ${guild.name}`,
            description: ["It takes about a minute to set up:", "1. In your server, run **`/manage setup`** and press **Create the channels for me** (or pick existing channels from the menus).", link ? "2. Or do the same on the web: press the button below." : "", "", "Members can then use `/me wishlist import`, `/games value` and `/bot support open`. `/help` lists everything."].filter(x => x !== "" || true).join("\n") };
        if (auto) embed = { ...setupSummary(auto, publicBase, guild.id, MEMBERS_INTENT), title: `${guild.name} is ready`, description: "This looked like a brand-new server, so I set it up for you.\n\n" + setupSummary(auto, publicBase, guild.id, MEMBERS_INTENT).description };
        else if (autoNote) embed = { ...embed, description: embed.description + `\n\n⚠️ ${autoNote}` };
        else embed = { ...embed, description: embed.description + "\n\nWant the full gaming-community layout (channels, roles, welcome, XP, invites)? Run **`/manage community setup`**." };
        const comp = auto ? (publicBase ? [{ type: 1, components: [{ type: 2, style: 5, label: "Fine-tune on the dashboard", url: `${publicBase}/#/community/${guild.id}` }] }] : []) : (link ? [{ type: 1, components: [{ type: 2, style: 5, label: "Open setup page", url: link }] }] : []);
        await discord.sendDm(guild.ownerId, { embeds: [embed], components: comp }).catch(async () => {
            // DMs closed: leave a short note where managers will see it
            const ch = guild.systemChannel; if (ch) await ch.send({ content: "A server manager can run `/manage setup` to get started.", allowedMentions: { parse: [] } });
        });
    } catch { /* the owner may have DMs closed */ }
});

// Music: leave a few minutes after everyone has left the voice channel, and clean up if the bot is removed from one.
client.on(Events.VoiceStateUpdate, (oldS, newS) => {
    try {
        if (!music) return;
        if (oldS.id === client.user?.id && oldS.channelId && !newS.channelId) music.onBotDisconnected(oldS.guild.id);
        else music.onVoiceChange(oldS.guild.id);
    } catch (err) { console.error(`[music] ${err.message}`); }
});
client.once(Events.ClientReady, () => { setTimeout(() => music?.autoBoot().catch(err => console.error(`[music] ${err.message}`)), 8000).unref?.(); }); // rejoin Auto DJ channels that have people in them after a restart
client.on(Events.GuildDelete, guild => { if (guild.available !== false && !isHidden(guild.id)) { try { pushEvent(db, "adminlog:servers", { kind: "leave", at: Date.now(), id: guild.id, name: guild.name ?? "a server", members: null }, 60); if (cfg.ownerId) discord.sendDm(cfg.ownerId, { embeds: [{ color: 0xed4245, title: "Server left", description: `The bot is no longer in **${guild.name ?? guild.id}**.`, fields: [{ name: "Servers now", value: String(client.guilds.cache.size), inline: true }], timestamp: new Date().toISOString() }] }).catch(() => {}); } catch { /* the alert is a nicety */ } } music?.onBotDisconnected(guild.id); if (guild.available !== false) { db.clearGuildChannel(guild.id); db.forgetCommunityGuild(guild.id); } });

// The AI companion. Only answers in servers where a manager turned it on, in the channel they picked (or any channel).
const rt = createRuntimeCfg(db, { ...(cfg.aiModel ? { ai_model: cfg.aiModel } : {}), ...(PROVIDER_IDS.includes(cfg.aiProvider) ? { ai_provider: cfg.aiProvider } : {}), ai_daily_cap: cfg.aiDailyCap });
const keyVault = cfg.keySecret ? createVault(cfg.keySecret) : null;
/** A server's own API key, decrypted, or null. */
const serverKey = gid => {
    const c = gid ? db.getCommunity(gid) : null;
    const key = c?.ai_key && keyVault ? keyVault.decrypt(c.ai_key) : null;
    return key ? { key, provider: c.ai_provider || "anthropic", model: c.ai_model || null } : null;
};
const aiTools = createAiTools({ db, itad, news, fx, lfg, calendar, dashUrl: cfg.dashboard?.publicUrl ?? null, nameOf: id => client.users.cache.get(id)?.displayName ?? null });
const mainGuild = createMainGuild({ db, client, configuredId: cfg.mainGuildId, configuredInvite: cfg.supportInvite, log: t => console.log(`[main server] ${t}`) });
client.once(Events.ClientReady, () => { // a minute after start, tell the owner it came back and whether anything has gone wrong since
    setTimeout(() => {
        const errs = logs.recent({ level: "error", limit: 200 }).filter(l => l.at >= STARTED_AT);
        runBootNotice({ db, ownerId: cfg.ownerId, sendDm: (id, p) => discord.sendDm(id, p), version: LATEST, servers: client.guilds.cache.size, errors: errs.length,
            topError: groupErrors(errs, 1).map(g => `${g.where}: ${g.message} (${g.count})`)[0] ?? null }).catch(err => console.error(`[boot] ${err.message}`));
    }, 60_000).unref?.();
});
client.once(Events.ClientReady, () => { mainGuild.detect(); mainGuild.ensureInvite().catch(() => {}); });
voterRole = createVoterRole({ db, client, mainGuild, log: t => console.log(`[voter role] ${t}`) });
setInterval(() => voterRole.sweep().catch(() => {}), 5 * 60_000).unref?.();
const supporters = createSupporters({ db, client, mainGuild, renewUrl: publicBase ? publicBase + "/#/tip" : null, publicUrl: publicBase ?? null, dm: (id, p) => discord.sendDm(id, p), log: t => console.log(`[supporters] ${t}`) });
setInterval(() => supporters.sweep().then(() => supporters.remind()).catch(() => {}), 15 * 60_000).unref?.();
// Free games to the project's X account. Off until the owner turns it on in the admin panel and the four X keys are set.
const indieSvc = createIndie();
const xposter = createXPoster({ db, log: m => console.log(`[x] ${m}`) });
// Friday's roundup of the week's best Steam sales: an X post and, if a channel is set on the admin page, a Discord post
const indieNews = createIndieNews({ db, dm: (id, p) => discord.sendDm(id, p), base: publicBase, log: m => console.log(`[indie news] ${m}`) });
const indieSpotlight = createSpotlight({ db, xposter, postChannel: notifier.postChannel, base: publicBase, postDiscord: (id, p) => discord.sendChannel(id, p), inviteUrl: () => (cfg.clientId ? botInviteUrl(cfg.clientId) : null), log: m => console.log(`[indie spotlight] ${m}`) });
const referrals = createReferrals({ db, supporters, dm: (id, p) => discord.sendDm(id, p), publicUrl: publicBase, log: t => console.log(`[referrals] ${t}`) });
const weekly = createWeekly({ db, itad, xposter, base: publicBase, postDiscord: (id, p) => discord.sendChannel(id, p), inviteUrl: () => (cfg.clientId ? botInviteUrl(cfg.clientId) : null), log: t => console.log(`[weekly deals] ${t}`) });
// every few minutes: send any scheduled posts that have come due, then the automatic free-game post if that's switched on
setTimeout(() => setInterval(() => {
    ops.job("weekly deals", () => weekly.tick()).catch(() => {});
    ops.job("indie spotlight", () => indieSpotlight.tick()).catch(() => {});
    ops.job("indie sync", () => indieSvc.syncDue(db, { limit: 5, log: m => console.log(`[indie] ${m}`) })).catch(() => {});
    if (!xposter.configured()) return;
    xposter.flush().catch(() => {});
    if (xposter.status().enabled) ops.job("x posts", async () => xposter.tick(await itad.getGiveawayList())).catch(() => {});
}, 3 * 60_000).unref?.(), 2 * 60_000).unref?.();
const square = createSquare({ ...squareConfig(), publicUrl: publicBase ?? "" });
const ai = createAiChat({ db, key: cfg.anthropicKey, rt, tools: aiTools, keyFor: serverKey, lite: q => liteAnswer({ ...q, tools: aiTools }), isMain: g => mainGuild.isMain(g), isPlus: g => Boolean(db.getCommunity(g)?.ai_plus), ownerId: cfg.ownerId, log: t => console.error(`[ai] ${t}`) });
const guideThrottle = createGuideThrottle();
/** A how-to question gets a step by step guide from the bot itself. Returns true when it answered. */
async function guideReply(m, c) {
    const own = matchServerGuide(m.content, db.listServerGuides(m.guildId));
    const g = own ?? matchGuide(m.content, { hasVerifiedRole: Boolean(c.verified_role_id) });
    if (!g) return false;
    const me = m.guild?.members?.me;
    const perms = me ? m.channel.permissionsFor(me) : null;
    if (perms && !perms.has(["SendMessages", "EmbedLinks", "AttachFiles"])) return false;
    if (!guideThrottle.allow({ guildId: m.guildId, channelId: m.channelId, userId: m.author.id, guideId: own ? `s${own.id}` : g.id })) return false;
    await m.channel.sendTyping?.().catch(() => {});
    const payload = own ? serverGuidePayload(own) : await guidePayload(g, { publicUrl: cfg.dashboard?.publicUrl ?? null });
    db.bumpUsage?.(own ? "guide:server" : `guide:${g.id}`);
    await m.reply({ ...payload, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
    return true;
}
async function aiReply(m, t) {
    const need = permsNotice(missingAiPerms(m.guild?.members?.me ? m.channel.permissionsFor(m.guild.members.me) : null), m.channelId);
    if (need) {
        if (!shouldTell(m.channelId)) return;
        if (need.where === "channel") return void await m.channel.send({ content: need.text, allowedMentions: { parse: [] } }).catch(() => {});
        return void await m.author.send({ content: need.text }).catch(() => {});
    }
    if (asksCreator(t.question)) {
        const embed = creatorEmbed({ creator: cfg.creator, logo: publicBase ? `${publicBase}/creator.png` : null });
        return void await m.reply({ embeds: [embed], allowedMentions: { parse: [], repliedUser: rt.get("ai_ping_reply") } }).catch(() => {});
    }
    // The conversation so far: walk up the chain of replies, so "and what about the second one?" has something to refer to.
    const history = [];
    try {
        let ref = m.reference?.messageId ? await m.channel.messages.fetch(m.reference.messageId) : null;
        for (let n = 0; ref && n < rt.get("ai_history"); n++) {
            const mine = ref.author.id === client.user.id;
            history.unshift({ role: mine ? "assistant" : "user", content: mine ? ref.content : parseTrigger(ref.content, client.user.id, { phrase: true })?.question ?? ref.content });
            ref = ref.reference?.messageId ? await m.channel.messages.fetch(ref.reference.messageId).catch(() => null) : null;
        }
    } catch { /* no history: answer on its own */ }
    await m.channel.sendTyping?.().catch(() => {});
    const r = await ai.answer({ guildId: m.guildId, userId: m.author.id, name: m.member?.displayName ?? m.author.globalName ?? m.author.username, question: t.question, history,
        scope: { channelId: m.channelId, canManage: Boolean(m.member?.permissions?.has?.("ManageGuild")), mentions: [...m.mentions.users.values()].filter(u => !u.bot && u.id !== m.author.id).slice(0, 3).map(u => ({ id: u.id, name: m.guild?.members?.cache?.get(u.id)?.displayName ?? u.globalName ?? u.username })) } });
    const mentions = { parse: [], repliedUser: rt.get("ai_ping_reply") };
    if (r.ok) {
        const extra = cardsPayload(r.cards ?? [], { db, userId: m.author.id });
        return void await m.reply({ content: r.text, allowedMentions: mentions, ...extra }).catch(() => m.reply({ content: r.text, allowedMentions: mentions }).catch(() => {}));
    }
    if (r.reason === "cooldown") return void (rt.get("ai_react") && await m.react("⏳").catch(() => {}));
    if (r.reason === "cap" && !rt.get("ai_limit_notice")) return;
    if (AI_FAILURES[r.reason]) await m.reply({ content: AI_FAILURES[r.reason], allowedMentions: mentions }).catch(() => {});
}

// The trap channel's notice shows how many accounts it has banned. A raid can ban many at once, so edits are bundled to one every few seconds.
const trapTimers = new Map();
function queueTrapCount(guildId) {
    if (trapTimers.has(guildId)) return;
    trapTimers.set(guildId, setTimeout(() => {
        trapTimers.delete(guildId);
        refreshHoneypotNotice({ db, api: rest, guildId }).catch(err => console.error(`[honeypot] counter: ${err.message}`));
    }, 4000).unref?.() ?? null);
}

// ---- community: XP, welcome, invites ----
client.on(Events.MessageCreate, async m => {
    try {
        if (!m.guildId || m.author.bot || m.webhookId || m.system) return;
        // The trap channel: anyone who talks there (other than staff) is banned, and never earns XP.
        if (m.channelId === db.getCommunity(m.guildId).honeypot_channel) {
            const p = m.member?.permissions;
            const staff = m.guild?.ownerId === m.author.id || Boolean(p?.has?.(["Administrator"]) || p?.has?.(["BanMembers"]) || p?.has?.(["ManageMessages"]) || p?.has?.(["ModerateMembers"]));
            const res = await honeypotHit({ db, moderation, guildId: m.guildId, channelId: m.channelId, userId: m.author.id, botId: client.user.id, staff,
                deleteMessage: () => m.delete(), log: t => console.error(`[honeypot] ${t}`), onBan: () => queueTrapCount(m.guildId), settings: { enabled: rt.get("trap_enabled"), deleteDays: rt.get("trap_delete_days") } });
            if (res === "banned") await m.delete().catch(() => {});
            return;
        }
        let guided = false;
        {
            const c = db.getCommunity(m.guildId);
            if (c.guides_on !== 0 && m.content) guided = await guideReply(m, c);
            if (!guided && c.ai_on && rt.get("ai_enabled") && (!c.ai_channel || c.ai_channel === m.channelId)) {
                const t = parseTrigger(m.content, client.user.id, { phrase: CONTENT_INTENT, max: rt.get("ai_max_question") });
                if (t) aiReply(m, t).catch(err => console.error(`[ai] ${err.message}`));
            }
        }
        const r = await community.onMessage({ guildId: m.guildId, userId: m.author.id });
        if (!r?.leveled) return;
        const c = db.getCommunity(m.guildId);
        if (c.levelup_mode === "off") return;
        const target = c.levelup_mode === "channel" && c.levelup_channel ? await client.channels.fetch(c.levelup_channel).catch(() => null) : m.channel;
        await target?.send({ content: `🎉 <@${m.author.id}> reached **level ${r.level}**!`, allowedMentions: { users: [m.author.id] } }).catch(() => {});
    } catch (err) { console.error(`[xp] ${err.name}: ${err.message}`); }
});
client.on(Events.GuildMemberAdd, async member => {
    if (member.id === cfg.ownerId) ensureCreatorRole(member.guild, cfg.ownerId, console.warn);
    if (member.guild.id === mainGuild.detect?.()) supporters.onJoin(member.id);
    try { await community.onJoin({ guildId: member.guild.id, guildName: member.guild.name, count: humanCount(member.guild), member: { id: member.id, username: member.user.username, avatar: member.user.avatar, bot: member.user.bot } }); }
    catch (err) { console.error(`[welcome] ${err.name}: ${err.message}`); }
});
client.on(Events.GuildMemberRemove, async member => {
    try { await community.onLeave({ guildId: member.guild.id, member: { id: member.id, username: member.user?.username ?? "someone", bot: member.user?.bot } }); }
    catch (err) { console.error(`[leave] ${err.name}: ${err.message}`); }
});
client.on(Events.InviteCreate, inv => { if (inv.guild) community.cacheInvite(inv.guild.id, { code: inv.code, uses: inv.uses ?? 0, max_uses: inv.maxUses ?? 0, inviter: inv.inviter ? { id: inv.inviter.id } : null }); });
client.on(Events.InviteDelete, inv => { /* kept in the cache until the next join so a last-use invite can still be matched */ });
// Voice XP: a few points a minute for people in a voice channel with someone else, not muted or deafened.
setInterval(async () => {
    try {
        for (const g of client.guilds.cache.values()) {
            if (!db.getCommunity(g.id).xp_on) continue;
            const by = new Map();
            for (const v of g.voiceStates.cache.values()) { if (!v.channelId || v.member?.user?.bot || v.channelId === g.afkChannelId) continue; if (!by.has(v.channelId)) by.set(v.channelId, []); by.get(v.channelId).push(v); }
            const ids = [...by.values()].filter(a => a.length >= 2).flat().filter(v => !v.selfMute && !v.selfDeaf && !v.serverMute && !v.serverDeaf).map(v => v.id);
            if (ids.length) await community.onVoiceMinute(g.id, ids);
        }
    } catch (err) { console.error(`[voice xp] ${err.message}`); }
}, 60_000).unref();

const reply = (i, content) => i.reply({ content, flags: MessageFlags.Ephemeral });
const beat = { alerts: null, giveaways: null, bundles: null, bundleError: null }; // when each background job last finished, for the status page
const staleAfter = (at, everyMs) => (at === null ? Date.now() - STARTED_AT > everyMs * 3 : Date.now() - at > everyMs * 3);
const status = createStatusMonitor({
    db, log: m => console.warn(`[status] ${m}`),
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
        freesources: { name: "Free game sources", desc: "Amazon Luna claims, GamerPower giveaways, Epic's upcoming free games, Steam news and Top.gg votes", critical: false, check: () => {
            const bad = [["Amazon Luna", luna.health()], ["GamerPower", gamerPower.health()], ["Epic Games Store", epicSoon.health()], ["Steam news", news.health()], ["Top.gg votes", topgg.health()]].filter(([, h]) => h.enabled !== false && h.lastErrorAt && (!h.lastOkAt || h.lastErrorAt > h.lastOkAt));
            return bad.length ? { state: "degraded", detail: `Can't read ${bad.map(([n, h]) => `${n} (${h.lastError})`).join(" or ")}` } : { state: "operational" };
        } },
        bundlefeed: { name: "Bundle feed", desc: "Humble, Fanatical, IndieGala and Steam bundles posted to servers", critical: false, check: () => {
            if (staleAfter(beat.bundles, 30 * 60_000)) return { state: "degraded", detail: "The last check is overdue" };
            return beat.bundleError ? { state: "degraded", detail: `Can't read ${String(beat.bundleError).slice(0, 120)}` } : { state: "operational" };
        } },
        ...(square?.enabled ? { payments: { name: "Supporter payments", desc: "Square checkout and the webhook that hands out passes", critical: false, check: () => {
            const last = readEvents(db, "adminlog:square", 20).find(e => /^(Paid|Rejected|Refunded|Error)/.test(e.what));
            return last && /^(Rejected|Error)/.test(last.what) ? { state: "degraded", detail: "Square's last call was turned away. Check the webhook key and address" } : { state: "operational" };
        } } } : {}),
        golive: { name: "Go-live detection", desc: "Noticing when linked Twitch, Kick and YouTube streamers go live", critical: false, check: () => {
            const h = streamWatch.health();
            if (!h.linked) return { state: "operational" };
            if (h.failed.length) return { state: "degraded", detail: `Can't check ${h.failed.join(" and ")}` };
            return h.lastTickAt && Date.now() - h.lastTickAt > 15 * 60_000 ? { state: "degraded", detail: "The last check is overdue" } : { state: "operational" };
        } },
        dashboard: { name: "Web dashboard", desc: "This website and its API", critical: false, check: () => ({ state: "operational" }) }
    }
});
client.once(Events.ClientReady, () => { if (MEMBERS_INTENT) warmMembers(client.guilds.cache, { log: m => console.log(`[members] ${m}`) }); }); // so bots can be left out of member counts
client.once(Events.ClientReady, () => { if (process.env.PRESENCE !== "off") startPresence({ client, db, supportUrl: cfg.creator?.url, log: m => console.log(m) }); });
client.once(Events.ClientReady, () => { status.start(); registerLinkedRoles(botRest, cfg.dashboard?.publicUrl ?? null, m => console.log(m)).then(ok => ok && console.log("[linked roles] conditions registered")); });
// Remember each server's invite counts so a join can be matched to the invite that was used.
client.once(Events.ClientReady, () => { // refresh each server's #leaderboard when it is due
    const tick = () => tickLeaderboards({ db, api: botRest, base: publicBase, has: id => client.guilds.cache.has(id), log: m => console.log(`[leaderboard] ${m}`) }).catch(() => {});
    setTimeout(tick, 60_000).unref?.(); setInterval(tick, 10 * 60_000).unref?.();
});
client.once(Events.ClientReady, () => { // notice when linked streamers go live or finish
    let busy = false;
    const tick = () => { if (busy) return; busy = true; streamWatch.tick().catch(e => console.log(`[stream watch] ${e.message}`)).finally(() => { busy = false; }); };
    setTimeout(tick, 75_000).unref?.(); setInterval(tick, CHECK_EVERY_MS).unref?.();
});
client.once(Events.ClientReady, () => { // Top.gg votes, checked every three minutes
    if (!topgg.enabled) return;
    let busy = false;
    const tick = () => { if (busy) return; busy = true; topgg.poll().catch(e => console.log(`[topgg] ${e.message}`)).finally(() => { busy = false; }); };
    setTimeout(tick, 45_000).unref?.(); setInterval(tick, 3 * 60_000).unref?.();
});
client.once(Events.ClientReady, () => { // squad-up posts: two or more members in the same game (checked every three minutes)
    if (!nowPlaying.enabled) return;
    let busy = false;
    const tick = () => { if (busy) return; busy = true; runSquadUps({ db, src: nowPlaying, notifier, log: m => console.log(`[now playing] ${m}`) }).catch(e => console.log(`[now playing] ${e.message}`)).finally(() => { busy = false; }); };
    setTimeout(tick, 100_000).unref?.(); setInterval(tick, 3 * 60_000).unref?.();
});
client.once(Events.ClientReady, () => { // post a meme in every server whose timer is up (checked every five minutes)
    let busy = false;
    const tick = () => { if (busy) return; busy = true; tickMemes({ db, api: botRest, memes, has: id => client.guilds.cache.has(id), log: m => console.log(`[memes] ${m}`) }).catch(() => {}).finally(() => { busy = false; }); };
    setTimeout(tick, 90_000).unref?.(); setInterval(tick, 5 * 60_000).unref?.();
});
client.once(Events.ClientReady, async () => { if (!MEMBERS_INTENT) return; for (const g of client.guilds.cache.values()) { await community.refreshInvites(g.id); await new Promise(r => setTimeout(r, 300)); } });
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
    i.reply({ ...pagedPayload(db, { pages: chunkText(description).map((d, n) => ({ embed: { color: 0xff9800, description: d }, label: `Page ${n + 1}` })), jump: false }), flags: MessageFlags.Ephemeral });

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

const commandWatch = createCommandWatch();
async function onInteraction(i, again = false) {
    if (!again) brandInteraction(i, brandOpts);
    // Restricted people get nothing from the bot (the owner can't be locked out).
    if (i.user?.id !== cfg.ownerId && db.isBanned(i.user?.id)) {
        if (!i.isAutocomplete()) await i.reply({ content: RESTRICTED_TEXT, flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
    }
    if (i.user?.id && db.getUser(i.user.id)) db.touchUser(i.user.id);
    if (!again && i.isChatInputCommand?.()) commandWatch.note(i.user?.id, i.commandName + (i.options.getSubcommand(false) ? " " + i.options.getSubcommand(false) : ""));
    // "/me wishlist add" arrives as the old "/me wishlist add" from here on, so every handler stays as it was.
    if (i.isChatInputCommand() || i.isAutocomplete()) {
        const route = legacyRoute(i.commandName, i.options.getSubcommandGroup(false), i.options.getSubcommand(false));
        if (route) {
            i.hubName = i.commandName; i.commandName = route.command;
            i.options.getSubcommand = (required = true) => { if (route.sub == null && required) throw new Error("This command has no subcommand."); return route.sub; };
            i.options.getSubcommandGroup = () => null;
            if (i.isChatInputCommand() && SERVER_ONLY_LEGACY.has(route.command) && !i.inGuild()) return void i.reply({ content: "That one works inside a server. Try it there.", flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    }
    if (i.isAutocomplete()) {
        try { await (i.commandName === "giveaway" ? gw.handleAutocomplete(i) : i.commandName === "music" ? (musicUi?.handleAutocomplete(i) ?? i.respond([])) : handlers.handleAutocomplete(i)); } catch (err) { console.error(`[autocomplete] ${err.name}: ${err.message}`); }
        return;
    }
    if ((i.isButton() || i.isAnySelectMenu?.() || i.isModalSubmit()) && i.customId.startsWith(PANEL_PREFIX)) return panels.handle(i);
    if ((i.isButton() && /^alert_(snooze|below|story):/.test(i.customId)) || (i.isModalSubmit() && i.customId.startsWith("alert_m_below:"))) return handlers.handleAlertButton(i);
    if ((i.isStringSelectMenu() && i.customId === "help_pick") || isHelpNav(i)) return handleHelpPick(i);
    if ((i.isButton() && i.customId === `${GUIDE_BUTTON}list`) || (i.isStringSelectMenu() && i.customId === `${GUIDE_BUTTON}pick`)) return handleGuideInteraction(i, { publicUrl: cfg.dashboard?.publicUrl ?? null });
    if (i.isButton() && i.customId.startsWith(AI_PREFIX)) return handleAiButton(i, { db, itad });
    if ((i.isButton() && i.customId.startsWith(PAGE_PREFIX)) || (i.isStringSelectMenu() && i.customId.startsWith(JUMP_PREFIX))) return handlePager(i, db);
    if (i.isButton() && i.customId === "mu:cmds") return panels.open(i, "hub-music");
    if (i.isButton() && i.customId.startsWith("mu:")) return musicUi ? musicUi.handleButton(i) : musicOff(i);
    if (i.isStringSelectMenu() && i.customId.startsWith("mu_pick:")) return musicUi ? musicUi.handleSelect(i) : musicOff(i);
    if (i.isButton() && i.customId.startsWith("gn_poll:")) return handlers.handleGameNightPoll(i);
    if (i.isButton() && i.customId.startsWith("gn_vote:")) return handlers.handlePollVote(i);
    if (i.isButton() && i.customId.startsWith("gn_pick:")) return handlers.handleGameNightButton(i);
    if (i.isButton() && i.customId.startsWith("lfg_")) return lfgUi.handleButton(i);
    if ((i.isButton() || i.isAnySelectMenu?.()) && i.customId.startsWith("su_")) return setupUi.handleComponent(i);
    if (i.isButton() && i.customId === PROMO_OFF_ID) {
        db.ensureUser(i.user.id); db.updateUser(i.user.id, { promo_off: 1 }); db.bumpUsage("promo_opt_out");
        return i.reply({ content: "Done. I won't send you promotions again. Alerts you set up yourself are not affected.", flags: MessageFlags.Ephemeral });
    }
    if (i.isButton() && i.customId.startsWith("rr:")) return communityUi.roleButton(i);
    if (i.isButton() && i.customId.startsWith("emp:")) return communityUi.packButton(i);
    if (i.isButton() && i.customId === communityUi.verifyButtonId) return communityUi.verify(i);
    if (i.isButton() && i.customId.startsWith("tk_")) return ticketUi.handleButton(i);
    if (i.isModalSubmit() && i.customId.startsWith("tk_")) return ticketUi.handleModal(i);
    if (i.isModalSubmit() && i.customId === FR.modal) return requestUi.handleModal(i);
    if (i.isButton() && i.customId.startsWith("trivia:")) return triviaUi.handleButton(i);
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
                await i.reply({ content: `Stopped watching **${item.title}**. You can add it again any time with /me wishlist add.`, flags: MessageFlags.Ephemeral });
            }
        } catch (err) { console.error(`[stop] ${err.stack ?? err.message}`); }
        return;
    }
    if ((i.isButton() && i.customId.startsWith("fg:")) || (i.isStringSelectMenu() && i.customId.startsWith("fgs:"))) return handlers.handleFreeMenu(i);
    if (i.isButton() && i.customId === FREE_CLAIM_ALL_ID) {
        // Every link is read from the message the bot itself sent, so nothing is stored or taken from the user.
        const saved = tokenOf(i.message) ? db.getPager(tokenOf(i.message)) : null;
        const cards = saved ? saved.pages.map(p => p.embed) : (i.message.embeds ?? []);
        const links = cards.filter(e => /^https:\/\//i.test(e.url ?? "")).map(e => `• [${String(e.title).slice(0, 80)}](${e.url})`);
        try { await i.reply({ content: links.length ? `Open each link and claim it:\n${links.join("\n")}` : "Those links are no longer available.", flags: MessageFlags.Ephemeral }); }
        catch (err) { console.error(`[claim] ${err.name}: ${err.message}`); }
        return;
    }
    if (i.isMessageContextMenuCommand()) return void handlers.handleMessageContext(i).catch(err => console.error(`[context] ${err.stack ?? err.message}`));
    if (i.isUserContextMenuCommand()) return void handlers.handleContextMenu(i).catch(err => console.error(`[context] ${err.stack ?? err.message}`));
    if (!i.isChatInputCommand()) return;
    if (!again && i.options.getSubcommand(false) === "menu" && panels.has(`hub-${i.commandName}`)) {
        return void panels.open(i, `hub-${i.commandName}`).catch(err => console.error(`[menu] ${err.message}`));
    }
    console.log(`[command] /${i.hubName ? i.hubName + " " : ""}${i.commandName}${i.options?.getSubcommand?.(false) ? " " + i.options.getSubcommand(false) : ""}`);
    const known = db.getUser(i.user.id);
    const showTip = !known?.tipped && !["help", "about", "privacy", "mydata", "changelog"].includes(i.commandName);
    try {
        await (async () => { switch (i.commandName) {
            case "value": return await handleValue(i);
            case "wishlist": return await handlers.handleWishlist(i);
            case "alerts": return await handlers.handleAlerts(i);
            case "language": return await handlers.handleLanguage(i);
            case "alertchannel": return await handlers.handleAlertChannel(i);
            case "giveaway": return await gw.handleCommand(i);
            case "library": return await handlers.handleLibrary(i);
            case "currency": {
                const user = db.ensureUser(i.user.id, i.guildId);
                const pick = i.options.getString("currency");
                const name = v => REGIONS.find(r => r.value === v)?.name ?? v;
                if (!pick) return await i.reply({ content: `Prices are shown in **${name(user.region)}**. Change it with \`/me currency currency:\`, or from the dashboard's top bar.`, flags: MessageFlags.Ephemeral });
                db.updateUser(user.discord_id, { region: pick });
                return await i.reply({ content: `Prices are now in **${name(pick)}**, here and on the dashboard.`, flags: MessageFlags.Ephemeral });
            }
            case "redeem": return await redeemUi.handle(i);
            case "compare": return await handlers.handleCompare(i);
            case "steam": return i.options.getSubcommand() === "verify" ? await communityUi.verify(i) : await steamUi.handle(i);
            case "profilecard": return await cardUi.handle(i);
            case "profile": return await profileUi.handle(i);
            case "bundle": return await dealUi.handleBundle(i);
            case "regions": return await dealUi.handleRegions(i);
            case "saleprep": return await dealUi.handleSalePrep(i);
            case "serverlist": return await handlers.handleServerList(i);
            case "leaderboard": return await handlers.handleLeaderboard(i);
            case "freegames": return await handlers.handleFreeGames(i);
            case "status": return await handlers.handleStatus(i);
            case "support": return await ticketUi.handleCommand(i);
            case "bug": return await ticketUi.handleBug(i);
            case "feature": return await requestUi.handleCommand(i);
            case "codes": return await codeUi.handleCommand(i);
            case "promos": return i.options.getSubcommand() === "bundles" ? await bundleUi.handle(i) : await dropUi.handleCommand(i);
            case "music": case "play": case "player": return musicUi ? await musicUi.handleCommand(i) : await musicOff(i);
            case "grabberad": {
                const eph = content => i.reply({ content, flags: MessageFlags.Ephemeral });
                if (!cfg.ownerId || i.user.id !== cfg.ownerId) return await eph("Only the bot owner can use this.");
                const audience = i.options.getString("audience", true);
                if (audience !== "me" && i.options.getString("confirm") !== "SEND") return await eph("To send it to other people, type SEND in the confirm option. Use audience \"Only me\" to preview it.");
                if (audience !== "me" && Date.now() - adLast < 120_000) return await eph("You just sent one. Wait a couple of minutes.");
                try {
                    const r = broadcaster.start({ audience, promo: true });
                    if (audience !== "me") adLast = Date.now();
                    db.bumpUsage("cmd:grabberad/" + audience);
                    return await eph(audience === "me" ? "Sent the preview to your DMs." : `Sending the FanaticalGrabber advertisement to ${r.total} places (about one a second). Follow progress on the dashboard's Admin page.`);
                } catch (e) { return await eph(e.userFacing || e.name === "UserError" ? e.message : "I could not start that."); }
            }
            case "gamenight": return await handlers.handleGameNight(i);
            case "coop": return await handlers.handleCoop(i);
            case "lfg": return await lfgUi.handleCommand(i);
            case "stream": return await streamUi.handleCommand(i);
            case "memes": return await memeUi.handleCommand(i);
            case "calendar": return await calendarUi.handle(i);
            case "setup": return await setupUi.handleCommand(i);
            case "mod": return await modUi.handleCommand(i);
            case "community": case "rank": case "levels": case "leaderboardrefresh": case "invites": case "emoji": return await communityUi.handleCommand(i);
            case "changelog": return await handlers.handleChangelog(i);
            case "supporter": return await handlers.handleSupporter(i);
            case "sales": return await handlers.handleSales(i);
            case "watch": return await handlers.handleWatch(i);
            case "serverstats": return await handlers.handleServerStats(i);
            case "nowplaying": return await handlers.handleNowPlaying(i);
            case "club": return await clubUi.handle(i);
            case "santa": return await santaUi.handle(i);
            case "trivia": return await triviaUi.handle(i);
            case "publicpage": return await handlers.handlePublicPage(i);
            case "friend": return await handlers.handleFriend(i);
            case "mydata": return await handlers.handleMyData(i);
            case "help": return await i.reply({ ...helpPayload("start"), flags: MessageFlags.Ephemeral });
            case "dashboard": case "dash": return await i.reply(dashPayload(cfg.dashboard?.publicUrl ?? null, i.options.getString("page")));
            case "vote": {
                const st = await topgg.status(i.user.id), id = client.user?.id ?? cfg.clientId, url = `https://top.gg/bot/${id}/vote`;
                const line = !topgg.enabled ? "Voting isn't switched on yet."
                    : st.voted ? `You already voted. You can vote again <t:${Math.floor(st.nextAt / 1000)}:R>.` : "You can vote right now.";
                return await i.reply({ flags: MessageFlags.Ephemeral, embeds: [{ color: 0xff9800, title: "Vote for Steam Value Checker", description: `Every vote on Top.gg pays out **${VOTE_XP} XP** in every server where you already have XP (double on weekends, when Top.gg counts votes twice). Voting also helps other gamers find the bot.\n\n${line}`, footer: { text: st.votes ? `You have voted ${st.votes} time${st.votes === 1 ? "" : "s"} here.` : "Takes about ten seconds." } }],
                    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("Vote on Top.gg").setStyle(ButtonStyle.Link).setURL(url))] });
            }
            case "about": return await i.reply(aboutPayload(aboutInfo(), { about: ABOUT, fanaticalUrl: FANATICAL_GRABBER_URL, tipUrl: SUPPORT_PAGE_URL }));
            case "privacy": { const base = cfg.dashboard?.publicUrl?.replace(/\/$/, ""); return await embedReply(i, base ? `${PRIVACY}\n\nFull text: [Privacy Policy](${base}/privacy.html) · [Terms of Service](${base}/terms.html)` : PRIVACY); }
        } })();
        if (showTip && (i.replied || i.deferred)) {
            db.ensureUser(i.user.id, i.guildId);
            db.updateUser(i.user.id, { tipped: 1 });
            await i.followUp({ embeds: [quickStart(publicBase)], flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    } catch (err) {
        console.error(`[${i.commandName}] ${err.stack ?? `${err.name}: ${err.message}`}`);
        // Never leave the person staring at "The application did not respond".
        const msg = { content: "Something went wrong on the bot's side. Please try again in a moment.", flags: MessageFlags.Ephemeral };
        try { if (i.deferred || i.replied) await i.followUp(msg); else await i.reply(msg); } catch { /* the interaction may already be gone */ }
    }
}
client.on(Events.InteractionCreate, i => onInteraction(i));

if (cfg.dashboard) {
    const d = cfg.dashboard;
    const rest = brandRest(createDiscordRest({
        clientId: cfg.clientId, clientSecret: d.clientSecret, botToken: cfg.token, redirectUri: `${d.publicUrl}/auth/callback`
    }), brandOpts);
    // One broadcaster for the dashboard's Admin page and /bot grabberad, so only one announcement or promotion goes out at a time.
const broadcaster = createBroadcaster({ publicUrl: publicBase, db, ownerId: cfg.ownerId, sendDm: (id, p) => discord.sendDm(id, p), sendChannel: (id, p) => discord.sendChannel(id, p),
    presetPayload: id => noticePreset(id, { base: publicBase, dashboardUrl: publicBase, creator: cfg.creator }),
    guildInfo: id => { const g = client.guilds.cache.get(id); return g ? { name: g.name, icon: g.iconURL({ extension: "png", size: 256 }) } : null; },
    guildBanner: async info => {
        const art = await artFor([info.icon]);
        return { attachment: Buffer.from(toPng(guildBannerSvg({ name: info.name, art: art(info.icon), logo: brandLogo() }))), name: "for-your-server.png", description: `Steam Value Checker message for ${info.name}` };
    },
    promoPayload: () => grabberPromo({ base: publicBase, url: process.env.EXTENSION_STORE_URL || EXTENSION_STORE_URL, dashboardUrl: publicBase }) });
const dashboard = createDashboard({ referrals, weekly, indieSvc, fortniteSvc: createFortnite({ apiKey: process.env.FORTNITE_API_KEY || "", creatorCode: process.env.FORTNITE_CREATOR_CODE || "LUCADO", log: m => console.log(`[fortnite] ${m}`) }), indieNews, spotlight: indieSpotlight, offsite, commandWatch, health: () => client.isReady(), square, supporters, leaveGuild: async id => { const g = client.guilds.cache.get(id); if (!g) return false; await g.leave(); return true; }, storage: () => storageReport({ dbPath: cfg.dbPath, backupDir: cfg.backupDir, db }), topgg, twitchReply: twitchChat.canSay, trivia, news, abg, nowPlaying, playtests: playtestRefresh, music, musicGuild, stations, broadcaster, db, itad, rest, codes: { poll: pollCodes }, bundleFeed: { poll: pollBundles }, xposter, drops: { poll: pollDrops }, fx, dm: (id, payload) => discord.sendDm(id, payload), ops, giveaways, tickets, logs, botInfo: aboutInfo, status, djsVersion: DJS_VERSION, botGuilds: id => client.guilds.cache.has(id), guildInvite: async id => {
        const g = client.guilds.cache.get(id);
        if (!g) throw new Error("The bot isn't in that server.");
        const me = g.members.me;
        const ch = g.channels.cache.find(c => c.isTextBased?.() && !c.isThread?.() && c.permissionsFor(me)?.has(PermissionFlagsBits.CreateInstantInvite) && c.permissionsFor(me)?.has(PermissionFlagsBits.ViewChannel));
        if (!ch) throw new Error("The bot doesn't have the Create Invite permission in any channel there. Ask the server's owner for an invite.");
        const inv = await ch.createInvite({ maxAge: 3600, maxUses: 1, unique: true, reason: "Bot owner asked for an invite from the dashboard" });
        return inv.url;
    },
    guildList: () => client.guilds.cache.map(g => ({ id: g.id, name: g.name, members: humanCount(g), boosts: g.premiumSubscriptionCount ?? 0 })), lfg, calendar, community, moderation, membersIntent: () => MEMBERS_INTENT, rt, ai, config: { ...d, steamApiKey: cfg.steamApiKey, backupDir: cfg.backupDir, creator: cfg.creator, clientId: cfg.clientId, ownerId: cfg.ownerId, trustProxy: cfg.trustProxy, aiAvailable: Boolean(cfg.anthropicKey), aiKey: cfg.anthropicKey, aiLite: true, aiKeyVault: keyVault, mainGuild, aiCheckKey: (k, o) => ai.checkKey(k, o), aiPhrase: CONTENT_INTENT, aiDailyCap: cfg.aiDailyCap }, log: (m, level = "activity") => (level === "error" ? console.error(`[dashboard] ${m}`) : level === "warn" ? console.warn(`[dashboard] ${m}`) : console.log(`${ACTIVITY}[dashboard] ${m}`)) });
    dashboard.listen().then(a => { console.log(`Dashboard listening on ${a.address}:${a.port} (public address ${d.publicUrl})`); setTimeout(() => pingIndexNow({ origin: new URL(d.publicUrl).origin, db }), 30_000).unref(); })
        .catch(err => console.error(`[dashboard] could not start: ${err.message}`));
} else {
    console.log("Dashboard is off (set DASHBOARD_URL and DISCORD_CLIENT_SECRET to turn it on).");
}

// Breadcrumbs for the Admin log, so a restart is never silent: why it stopped, and how much memory it was using.
const memNote = () => { const m = process.memoryUsage(); return `rss ${Math.round(m.rss / 1048576)} MB, heap ${Math.round(m.heapUsed / 1048576)} MB`; };
console.log(`${ACTIVITY}[boot] Bot started, ${memNote()}, heap limit ${Math.round(v8.getHeapStatistics().heap_size_limit / 1048576)} MB`);
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { try { music?.shutdown(); } catch { /* */ } console.log(`${ACTIVITY}[restart] Bot stopping: the host sent ${sig} (a deploy or restart). Memory: ${memNote()}`); setTimeout(() => process.exit(0), 300); });
process.on("exit", code => { try { if (code !== 0) console.error(`[exit] bot exited unexpectedly with code ${code}, ${memNote()}`); } catch { /* nothing left to do */ } });
setInterval(() => { const m = process.memoryUsage(); if (m.rss > 380 * 1048576) console.error(`[memory] high usage: ${memNote()}`); }, 60_000).unref();

process.on("unhandledRejection", err => console.error(`[unhandledRejection] ${err?.stack ?? err}`));
// Discord's gateway sits behind Cloudflare, and when that has a bad minute the connection attempt fails with a 5xx. That's their outage, not a bug:
// keep running and let the library reconnect. If we still aren't connected a couple of minutes later, restart so we never sit there dead.
let gatewayWatch = null;
const gatewayBlip = err => /Unexpected server response: 5\d\d/.test(String(err?.message ?? err));
process.on("uncaughtException", err => {
    if (gatewayBlip(err)) {
        console.error(`[gateway] Discord's gateway is having trouble (${err.message}). Waiting for it to come back.`);
        if (!gatewayWatch) gatewayWatch = setTimeout(() => { gatewayWatch = null; if (client.ws.status !== 0) { console.error("[crash] gateway did not recover, restarting"); process.exit(1); } }, 120_000).unref();
        return;
    }
    console.error(`[crash] ${err?.stack ?? err}`);
    setTimeout(() => process.exit(1), 200); // Fly restarts the bot; the crash is saved for the Admin page
});

// Commands are pushed to Discord at startup, but only when they changed since last time.
registerCommands(cfg, { onlyIfChanged: true })
    .then(r => console.log(r.skipped ? `Slash commands already up to date (${r.count}).` : `Registered ${r.count} slash commands${r.guild ? " to your test server" : " globally (global commands can take up to an hour to appear)"}.`))
    .catch(err => console.error(`[register] could not register commands: ${err.message}`));

client.login(cfg.token);

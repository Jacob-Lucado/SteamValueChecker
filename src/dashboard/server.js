// Web dashboard: everything the slash commands do, in a browser. Uses Node's http module only.
// Login is Discord OAuth2 (identify + guilds). Sessions live in memory, so a restart logs everyone out.

import { roleIds } from "../gwroles.js";
import { VOTE_XP } from "../topgg.js";
import { pushEvent, readEvents, groupErrors } from "../adminlog.js";
import { aiStats, aiUsedToday } from "../aichat.js";
import { sampleAlert, SAMPLE_KINDS } from "../samples.js";
import http from "node:http";
import { gameNight } from "../gamenight.js";
import { setupStatus, autoSetup } from "../setup.js";
import { CHANGELOG, LATEST } from "../changelog.js";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { indexNowKey } from "../indexnow.js";
import { PAGE_SEO } from "../pageseo.js";
import { SEO_PAGES, seoSlugs, seoIsLive, renderSeoPage } from "../seopages.js";
import { pickDeals } from "../weeklydeals.js";
import { fillArt, withPictures } from "../dealart.js";
import { brotliCompressSync, gzipSync, constants as zc } from "node:zlib";
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, unlinkSync, createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import v8 from "node:v8";
import { join as joinPath, dirname as dirnameOf } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { REGIONS, ALERT_TYPES, FANATICAL_GRABBER_URL, SUPPORT_PAGE_URL, EXTENSION_LATEST, EXTENSION_STORE_URL } from "../constants.js";
import { runValue, ValueError, MAX_UPLOAD_CHARS } from "../value.js";
import { applyCodeSettings, codeFamilies, codeGames, codeView } from "../codes.js";
import { applyBundleFeedSettings, bundleFeedView } from "../bundlefeed.js";
import * as xposterText from "../xposter.js";
import { renderBundleLanding, renderDealLanding, renderBundleGone, bundleDestination, dealDestination, safePictureUrl, splitGame } from "../bundlelanding.js";
import { BUNDLE_STORES } from "../bundlefeedsource.js";
import { resolveArt, resolveUrlArt, ART_KINDS } from "../art.js";
import { compareGiftRegions } from "../giftregion.js";
import { PAGE_PRESETS, MAX_BG_STORED, decodeUpload, fetchSteamBackground } from "../profilebg.js";
import { expandGames } from "../codesource.js";
import { applyDropSettings, cleanDrop, dropView } from "../drops.js";
import { viewRows, exportJson, addGameByTitle, applySteamImport, WishlistError } from "../wishlist.js";
import { importWishlist, SteamError, STEAM_SHOP_ID } from "../steam.js";
import { ItadError } from "../itad.js";
import { parseTrigger, describeTrigger } from "../alerts.js";
import { DiscordApiError } from "./discord.js";
import { createCommunityDash, CommunityError } from "./communitydash.js";
import { createModDash, ModDashError } from "./moddash.js";
import { botInviteUrl } from "../community.js";
import { listModels } from "../aiproviders.js";
import { connectionPayload } from "../linkedroles.js";
import { parseHost, stepsOf, parseSteps, StepError, STEP_KINDS } from "../gwpartner.js";
import { HELP, ABOUT, PRIVACY } from "../text.js";
import { hubCommands } from "../commands.js";
import { valueBadgeSvg } from "../valuebadge.js";
import { pollEmbed, pollButtons } from "../gamenight.js";
import { nextSeq, currentSeq, hasNamedFeed, overlayEventsFor } from "../ovfeed.js";
import { overlayData, OVERLAY_KINDS, OVERLAY_FONTS, MAX_SUPPORTER_OVERLAYS, SCENE_KINDS } from "../overlays.js";
import { PLANS, SUPPORTER_XP_BOOST } from "../square.js";
import { supporterUntil, isSupporter, isFounder, wallName, alertColorHex, foundersTaken, FOUNDERS_MAX, endOfDayEastern } from "../supporters.js";
import { buildProfile, cleanProfile, withDefaults, PROFILE_THEMES, PROFILE_STYLES, BG_STYLES, LAYOUTS, SECTIONS, LINK_KIND_NAMES } from "../profilepage.js";
import { commandGuide } from "../hubpanel.js";
import { enrichFree, withOwnership } from "../freeinfo.js";
import { forYou } from "../foryou.js";
import { libraryAnalytics } from "../analytics.js";
import { steamLoginUrl, verifySteamLogin } from "../steamopenid.js";
import { UserError } from "../errors.js";
import { createIndie, parseApp, cleanLinks } from "../indie.js";
import { createFortnite } from "../fortnite.js";
import { INDIE_CATS, INDIE_TOOLS, indieSeo, indieSpotlightText } from "../indiemeta.js";
import { MAX_PENDING_PER_USER, MAX_GAMES_PER_USER } from "../indiestore.js";
import { createIndieNews, picksFor } from "../indienews.js";
import { indieBadgeSvg } from "../indiebadge.js";
import { createStreams, canStreamIn } from "../streamlive.js";
import { parseUpload, sanitize } from "../parse.js";
import { prefsPatch, prefsView } from "../prefs.js";
import { trophyCase } from "../badges.js";
import { renderSteamValue, renderRecap, renderWelcomeCard, renderProfileShare } from "../cardimg.js";
import { createBroadcaster, MAX_BODY } from "../broadcast.js";
import { grabberPromo } from "../promo.js";
import { createEvent, joinEvent, leaveEvent, drawEvent, endEvent, myAssignment, eventEmbed, revealEmbed } from "../santa.js";
import { noticePreset } from "../noticepresets.js";
import { addBundle, bundleView } from "../bundles.js";
import { createNews, newsForUser } from "../news.js";
import { playtestBoard } from "../playboard.js";
import { whoIsPlaying } from "../nowplaying.js";
import { streamCardData, streamCardLine, chatCommandSets, STREAMCARD_KINDS } from "../streamcard.js";
import { clubProgress, setPick } from "../gameclub.js";
import { createStreamGiveaways } from "../streamgiveaway.js";
import { playtestFor, socialFor, setSpotlight, getSpotlight, badgeFor, syncFromApps, listGifts, offerGift, claimGift, withdrawGift } from "../extapi.js";
import { createPlaytestSources } from "../playsources.js";
import { goalProgress } from "../steamstore.js";
import { fillGifted, fillPrices, fillRetail, importLibrary, libraryView, leaderboard, finishedLeague, extraBoard, EXTRA_BOARDS, serverStats } from "../library.js";
import { extractKeys } from "../redeemstore.js";
import { compareLibraries } from "../compare.js";
import { regionPrices } from "../regions.js";
import { calendarEntries, toIcs, KINDS } from "../calendar.js";
import { addToServerList, serverListView, vote, removeFromServerList } from "../serverlist.js";
import { createLimiter } from "../ratelimit.js";
import { setProfile, publicWishlist } from "../profile.js";
import { artUrl, steamArt, ideaStatusEmbed } from "../render.js";
import { REACTIONS } from "../socialstore.js";
import { isSoundcloudUrl } from "../musicsource.js";
import { CATEGORIES } from "../stations.js";
import { parseChannel, channelUrl, watchable } from "../streamwatch.js";
import { publishRequest, refreshRequest, removeRequestPosts } from "../requestsync.js";
import { cleanRequest, limitMessage } from "../requests.js";
import { REQUEST_STATUSES, MAX_OPEN_PER_USER, MAX_TITLE as REQ_TITLE, MAX_BODY as REQ_BODY, MAX_NOTE as REQ_NOTE } from "../requeststore.js";
import { summarize } from "../report.js";
import { refreshTags, tasteProfile, recommend, tasteWhy } from "../taste.js";
import { buyOrWait } from "../advice.js";
import { renderGamePage, slugify } from "../gamepage.js";
import { saveOwnBirthday, friendDeals, friendRows, saveFriend, friendFromFollow, syncFollowedFriends, cleanFriendName, cleanBirthday } from "../friends.js";
import { spendSummary, regionCurrency, grabberRegion } from "../spend.js";
import { challengeView, monthKey, MAX_GOAL } from "../challenge.js";
import { MAX_CLAIMS_PER_LIST, MAX_CLAIMS_TOTAL, accountOldEnough } from "../giftstore.js";
import { upcomingSales, salesBefore, SALES_UPDATED, SALES } from "../salescal.js";
import { playNext } from "../library.js";
import { resolveProfile, syncSteamLibrary, playStats, steamNext, fetchProfileCard, fetchOwnedGames } from "../steamlib.js";
import { bundleCheck } from "../bundle.js";
import { salePrep, saleRecap } from "../saleprep.js";
import { isDlc } from "../freemenu.js";
import { freeArt } from "../render.js";
import { autoImage } from "../giveaway.js";
import { isHidden } from "../hidden.js";
import { legalPage, legalFramePage } from "../legal.js";
import { parseKeys, parseDuration, parseColor, parseImageUrl } from "../gwparse.js";
import { giveawayInput } from "../gwinput.js";
import { MAX_KEYS } from "../gwstore.js";
import { createMusicChat } from "../musicchat.js";
import { dmChannel, isDm, dmParts } from "../staffchat.js";
import { PANEL_AREAS, mayChange, cleanEdit } from "../paneluser.js";
import { checkPassword, burnTime, passwordProblem, USERNAME_RE, newTotpSecret, matchTotp, totpUri } from "../adminlogin.js";

const PUBLIC_DIR = fileURLToPath(new URL("../../public/", import.meta.url));
const SEO_SRC = fileURLToPath(new URL("../seopages.js", import.meta.url));
const FILES = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/app.js": ["app.js", "text/javascript; charset=utf-8"],
    "/theme.js": ["theme.js", "text/javascript; charset=utf-8"],
    "/i18n.js": ["i18n.js", "text/javascript; charset=utf-8"],
    "/style.css": ["style.css", "text/css; charset=utf-8"],
    "/logo.png": ["logo.png", "image/png"],
    "/favicon.ico": ["logo.png", "image/png"], // browsers and link previews ask for this by name
    "/creator.png": ["creator.png", "image/png"],
    "/creator-bg.webp": ["creator-bg.webp", "image/webp"],
    "/banner.png": ["banner.png", "image/png"],
    "/tag.svg": ["tag.svg", "image/svg+xml"],
    "/multikey.png": ["multikey.png", "image/png"],
    "/grabber-ad-hero.png": ["grabber-ad-hero.png", "image/png"],
    "/grabber-ad-cart.png": ["grabber-ad-cart.png", "image/png"],
    "/grabber-ad-paid.png": ["grabber-ad-paid.png", "image/png"],
    "/notice-restart.png": ["notice-restart.png", "image/png"],
    "/notice-dev.png": ["notice-dev.png", "image/png"],
    "/notice-thanks.png": ["notice-thanks.png", "image/png"],
    "/preview.jpg": ["preview.jpg", "image/jpeg"],
    "/page-support.jpg": ["page-support.jpg", "image/jpeg"],
    "/page-help.jpg": ["page-help.jpg", "image/jpeg"],
    "/page-about.jpg": ["page-about.jpg", "image/jpeg"],
    "/page-status.jpg": ["page-status.jpg", "image/jpeg"],
    "/page-tip.jpg": ["page-tip.jpg", "image/jpeg"],
    "/page-fortnite.jpg": ["page-fortnite.jpg", "image/jpeg"],
    "/page-feed.jpg": ["page-feed.jpg", "image/jpeg"],
    "/page-discover.jpg": ["page-discover.jpg", "image/jpeg"],
    "/page-communities.jpg": ["page-communities.jpg", "image/jpeg"],
    "/page-indie.jpg": ["page-indie.jpg", "image/jpeg"],
    "/page-indie-tools.jpg": ["page-indie-tools.jpg", "image/jpeg"],
    "/indiecalc.js": ["indiecalc.js", "text/javascript; charset=utf-8"],
    "/indietools.js": ["indietools.js", "text/javascript; charset=utf-8"],
    "/profilefx.js": ["profilefx.js", "text/javascript; charset=utf-8"],
    "/indiewaves.js": ["indiewaves.js", "text/javascript; charset=utf-8"],
    "/lucadoos.js": ["lucadoos.js", "text/javascript; charset=utf-8"],
    "/devpanel.js": ["devpanel.js", "text/javascript; charset=utf-8"],
    "/fortnite.js": ["fortnite.js", "text/javascript; charset=utf-8"],
    "/lucadoos.css": ["lucadoos.css", "text/css; charset=utf-8"],
    "/indie.js": ["indie.js", "text/javascript; charset=utf-8"],
    "/terms.pdf": ["terms.pdf", "application/pdf"],
    "/privacy.pdf": ["privacy.pdf", "application/pdf"],
    "/licenses.pdf": ["licenses.pdf", "application/pdf"],
    "/overlay": ["overlay.html", "text/html; charset=utf-8"],
    "/ov": ["ov.html", "text/html; charset=utf-8"],
    "/ov.css": ["ov.css", "text/css; charset=utf-8"],
    "/ov.js": ["ov.js", "text/javascript; charset=utf-8"],
    "/streamcard": ["streamcard.html", "text/html; charset=utf-8"],
    "/streamcard.css": ["streamcard.css", "text/css; charset=utf-8"],
    "/streamcard.js": ["streamcard.js", "text/javascript; charset=utf-8"],
    "/giveawayoverlay": ["giveawayoverlay.html", "text/html; charset=utf-8"],
    "/giveawayoverlay.css": ["giveawayoverlay.css", "text/css; charset=utf-8"],
    "/giveawayoverlay.js": ["giveawayoverlay.js", "text/javascript; charset=utf-8"],
    "/overlay.css": ["overlay.css", "text/css; charset=utf-8"],
    "/overlay.js": ["overlay.js", "text/javascript; charset=utf-8"],
    "/music": ["music.html", "text/html; charset=utf-8"],
    "/music.css": ["music.css", "text/css; charset=utf-8"],
    "/music.js": ["music.js", "text/javascript; charset=utf-8"],
    "/overlayui.css": ["overlayui.css", "text/css; charset=utf-8"],
    "/overlayui.js": ["overlayui.js", "text/javascript; charset=utf-8"],
    "/admin": ["admin.html", "text/html; charset=utf-8"],
    "/adminradio.js": ["adminradio.js", "text/javascript; charset=utf-8"],
    "/adminchat.js": ["adminchat.js", "text/javascript; charset=utf-8"],
    "/adminos.js": ["adminos.js", "text/javascript; charset=utf-8"],
    "/admin.css": ["admin.css", "text/css; charset=utf-8"],
    "/BingSiteAuth.xml": ["BingSiteAuth.xml", "application/xml; charset=utf-8"],
    "/seo.css": ["seo.css", "text/css; charset=utf-8"],
    "/scrollbar.css": ["scrollbar.css", "text/css; charset=utf-8"],
    "/motion.css": ["motion.css", "text/css; charset=utf-8"],
    "/motion.js": ["motion.js", "text/javascript; charset=utf-8"],
    "/tools/timestamp.js": ["tools/timestamp.js", "text/javascript; charset=utf-8"],
    "/tools/steamid.js": ["tools/steamid.js", "text/javascript; charset=utf-8"],
    "/tools/refund.js": ["tools/refund.js", "text/javascript; charset=utf-8"],
    "/tools/sales.js": ["tools/sales.js", "text/javascript; charset=utf-8"],
    ...Object.fromEntries(Object.keys(SEO_PAGES).map(slug => [`/${slug}`, [`seo/${slug}.html`, "text/html; charset=utf-8"]])),
    "/ai": ["ai.html", "text/html; charset=utf-8"],
    "/ai.css": ["ai.css", "text/css; charset=utf-8"],
    "/go.css": ["go.css", "text/css; charset=utf-8"],
    "/go.js": ["go.js", "text/javascript; charset=utf-8"],
    "/ai.js": ["ai.js", "text/javascript; charset=utf-8"],
    "/ai-ad-hero.png": ["ai-ad-hero.png", "image/png"],
    "/img/x-post.jpg": ["img/x-post.jpg", "image/jpeg"],
    "/img/x-logo.jpg": ["img/x-logo.jpg", "image/jpeg"],
    "/img/ai/history.png": ["img/ai/history.png", "image/png"],
    "/img/ai/compare.png": ["img/ai/compare.png", "image/png"],
    "/img/ai/library.png": ["img/ai/library.png", "image/png"],
    "/img/ai/plan.png": ["img/ai/plan.png", "image/png"],
    "/img/ai/achievements.png": ["img/ai/achievements.png", "image/png"],
    "/img/ai/guide.png": ["img/ai/guide.png", "image/png"],
    "/grabber": ["grabber.html", "text/html; charset=utf-8"],
    "/grabber.html": ["grabber.html", "text/html; charset=utf-8"],
    "/grabber.css": ["grabber.css", "text/css; charset=utf-8"],
    "/grabber.js": ["grabber.js", "text/javascript; charset=utf-8"],
    "/grabber-og.png": ["grabber-og.png", "image/png"],
    "/grabber-favicon.ico": ["grabber-favicon.ico", "image/x-icon"],
    "/grabber-favicon-32.png": ["grabber-favicon-32.png", "image/png"],
    "/grabber-apple-touch-icon.png": ["grabber-apple-touch-icon.png", "image/png"],
    "/favicon.png": ["favicon.png", "image/png"],
    "/manifest.webmanifest": ["manifest.webmanifest", "application/manifest+json; charset=utf-8"],
    "/icon-192.png": ["icon-192.png", "image/png"],
    "/icon-512.png": ["icon-512.png", "image/png"],
    "/icon-maskable-512.png": ["icon-maskable-512.png", "image/png"],
    "/img/codes/genshin.jpg": ["img/codes/genshin.jpg", "image/jpeg"],
    "/img/codes/hsr.jpg": ["img/codes/hsr.jpg", "image/jpeg"],
    "/img/codes/zzz.jpg": ["img/codes/zzz.jpg", "image/jpeg"]
};
const SESSION_MS = 7 * 24 * 3600_000;
const MAX_SESSIONS = 10_000;
const COOKIE = "svc_session";
const ADMIN_SESSION_MS = 12 * 3600_000; // a password sign-in is shorter lived than the Discord one
const STATE_COOKIE = "svc_state";
const REF_COOKIE = "svc_ref", STEAM_STATE_COOKIE = "svc_steamstate", STEAM_PENDING_COOKIE = "svc_steampending", STEAM_KNOWN_COOKIE = "svc_steamknown", NEXT_COOKIE = "svc_next";
const MUTE_DAYS = 3650;
const COOLDOWNS = { grabbersync: 4_000, grabbergifts: 1_000, grabbercompare: 1_500, grabberact: 1_500, grabberbadge: 20_000, streamgw: 5_000, sample: 5_000, libnews: 3_000, streamlink: 2_000, ptrefresh: 60_000, memenow: 10_000, cemojipackimp: 300, cemojipacks: 300, cemojipack: 300, music: 800, musicsearch: 3_000, musicplay: 2_000, musicsubmit: 2_500, musicauto: 4_000, musicstations: 5_000, request: 20_000, requestvote: 1_000, broadcast: 120_000, value: 15_000, import: 60_000, add: 3_000, hist: 2_000, lib: 3_000, steam: 60_000, grabber: 10_000, grabbergame: 1_000, gamepage: 1_500, taste: 5_000, steamlookup: 8_000, grabberprices: 2_000, grabbertoken: 5_000, deals: 3_000, bundles: 3_000, regions: 3_000, saleprep: 3_000, cardimg: 4_000, analytics: 2_500, foryou: 2_500, csetup: 20_000, cemoji: 8_000, clink: 3_000, cpage: 2_000, mod: 1_000, announce: 5_000, lbrefresh: 15_000, streamlive: 4_000, streamping: 3_000 };
const MAX_HISTORY_POINTS = 180;
const MANAGE_GUILD = 0x20n;
const ADMINISTRATOR = 0x8n;

export const RESTRICTED_TEXT = "Your access to Steam Value Checker has been restricted by the bot owner. You can no longer use the bot or this dashboard, and you won't get alerts. If you think this is a mistake, contact the bot owner.";
class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const MOD_PERMS = { moderate: { bit: 1n << 40n, text: "Moderate Members" }, kick: { bit: 1n << 1n, text: "Kick Members" }, ban: { bit: 1n << 2n, text: "Ban Members" }, manageMessages: { bit: 1n << 13n, text: "Manage Messages" }, manageGuild: { bit: MANAGE_GUILD, text: "Manage Server" } };
const MOD_ACTION_PERM = { warn: "moderate", timeout: "moderate", untimeout: "moderate", kick: "kick", ban: "ban", unban: "ban", purge: "manageMessages" };
/** Does this person have the permission in that server (owner and Administrator have all of them)? */
const hasGuildPerm = (g, need) => {
    if (g.owner) return true;
    try { const p = BigInt(g.permissions ?? "0"); return (p & ADMINISTRATOR) !== 0n || (p & MOD_PERMS[need].bit) !== 0n; } catch { return false; }
};
const isManager = g => {
    if (g.owner) return true;
    try {
        const p = BigInt(g.permissions ?? "0");
        return (p & MANAGE_GUILD) !== 0n || (p & ADMINISTRATOR) !== 0n;
    } catch { return false; }
};

export function createDashboard({ referrals = null, weekly = null, indieSvc = null, fortniteSvc = null, indieNews = null, spotlight = null, storage = null, topgg = null, twitchReply = false, trivia = null, emojigg = null, news = null, abg = null, nowPlaying = null, playtests = null, db, itad, rest, music = null, musicGuild = null, stations = null, codes = null, bundleFeed = null, xposter = null, imageFetch = globalThis.fetch, drops = null, ops = null, giveaways = null, tickets = null, logs = null, botInfo = null, status = null, djsVersion = null, botGuilds = null, guildList = null, guildInvite = null, leaveGuild = null, commandWatch = null, offsite = null, health = null, square = null, supporters = null, lfg = null, calendar = null, community = null, moderation = null, membersIntent = () => true, rt = null, ai = null, broadcaster: sharedBroadcaster = null, dm = null, fx = null, steamFetch = globalThis.fetch, config, now = () => Date.now(), log = () => {} }) {
    const origin = new URL(config.publicUrl).origin;
    // The admin panel can live on its own subdomain. It shares the sign-in with the main site through a cookie for the whole domain.
    const adminOrigin = config.adminUrl ? new URL(config.adminUrl).origin : null;
    const adminHost = adminOrigin ? new URL(adminOrigin).host.toLowerCase() : null;
    // The music studio is the same idea: its own address, one shared sign-in.
    const musicOrigin = config.musicUrl ? new URL(config.musicUrl).origin : null;
    const musicHost = musicOrigin ? new URL(musicOrigin).host.toLowerCase() : null;
    const onMusicHost = req => Boolean(musicHost) && String(req?.headers?.host ?? "").toLowerCase() === musicHost;
    // Live visualizer: one open connection per viewer, fed from what the player is sending to Discord.
    const vizOpen = new Map();
    let vizTotal = 0;
    function vizStream(req, res, url) {
        const s = session(req);
        if (!music?.viz) throw new HttpError(503, "The visualizer isn't available on this bot right now.");
        const g = musicMember(s, url.searchParams.get("guild"));
        if (vizTotal >= 150 || (vizOpen.get(s.userId) ?? 0) >= 3) throw new HttpError(429, "Too many visualizers are open. Close one and try again.");
        vizTotal++; vizOpen.set(s.userId, (vizOpen.get(s.userId) ?? 0) + 1);
        res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex" });
        res.write("retry: 3000\n\n");
        const born = now();
        let quiet = 0, timer = 0, over = false;
        const end = () => { if (over) return; over = true; clearInterval(timer); vizTotal--; vizOpen.set(s.userId, Math.max(0, (vizOpen.get(s.userId) ?? 1) - 1)); try { res.end(); } catch { /* gone */ } };
        const tick = () => {
            const live = sessions.get(cookies(req)[COOKIE]);
            if (!live || live.expires < now() || now() - born > 4 * 3600_000) return end();
            let v = null;
            try { v = music.viz(g.id, 200); } catch { /* the player is busy; skip a beat */ }
            if (!v || v.paused || !v.frames?.length) { if (quiet++ % 10 === 0) res.write(`data: {"p":0}\n\n`); return; } // a heartbeat about once a second while nothing plays
            quiet = 0;
            res.write(`data: ${JSON.stringify({ p: 1, m: Math.round(v.playMs), f: v.first, d: Buffer.concat(v.frames.map(x => Buffer.from(x))).toString("base64") })}\n\n`);
        };
        timer = setInterval(tick, 100); tick();
        req.on("close", end); res.on("error", end);
    }
    // The OBS overlay: a private link for each person and server, no sign-in. It gets the song that is playing and (optionally) the visualizer levels, nothing else.
    /** The overlay cards for a streamer's link. Kept five minutes, so OBS and chat bots can ask as often as they like. */
    const cardsFor = async (o, kinds) => {
        const base = await baseCards(o, kinds.filter(k => k !== "game"));
        if (!kinds.includes("game") && !getSpotlight(db, o.user_id, now())) return base;
        const g = await gameNow(o.user_id).catch(() => null), spot = getSpotlight(db, o.user_id, now());
        return { ...base, cards: [...(spot ? [spot] : []), ...(g ? [g] : []), ...base.cards] };
    };
    /** The game this streamer is in right now (Steam's own current-game field, kept for a minute), with the hours they have in it. */
    async function gameNow(userId) {
        const link = db.getSteamLink(userId);
        if (!link || !nowPlaying?.enabled) return null;
        const v = (await nowPlaying.lookup([link.steamid])).get(String(link.steamid));
        if (!v?.appid || !v.game) return null;
        const lib = db.listLibrary(userId).find(x => x.appid === v.appid);
        return { kind: "game", title: v.game, appid: v.appid, hours: lib?.minutes ? Math.round(lib.minutes / 6) / 10 : null };
    }
    const baseCards = (o, kinds) => remember("scard:" + o.token + ":" + kinds.join(), 5 * 60_000, () => {
        const u = db.getUser(o.user_id);
        return streamCardData({
            kinds, user: null,
            deals: async () => (await viewRows(db, itad, u)).rows,
            free: async () => (await enrichFree(await itad.getGiveawayList())).filter(g => /^https:\/\//i.test(g.url ?? "") && !isDlc(g)).map(g => ({ title: g.title, shop: g.shop, expiry: g.expiry, art: freeArt(g) ?? null })),
            giftUrl: u?.profile_slug && u.profile_public ? `${origin}/u/${u.profile_slug}` : null
        });
    });
    // One line of text for a chat bot command (!deals, !free, !wishlist). Same private link as the overlay.
    async function streamCardText(req, res, url) {
        if (!overlayLimit.hit(clientIp(req)).ok) return send(res, 429, "Slow down a little.", { "Content-Type": "text/plain; charset=utf-8" });
        const o = db.streamCardByToken(String(url.searchParams.get("token") ?? "")), kind = String(url.searchParams.get("kind") ?? "");
        if (!o || !STREAMCARD_KINDS.includes(kind)) return send(res, 404, "This link isn't valid.", { "Content-Type": "text/plain; charset=utf-8" });
        let line;
        try { line = streamCardLine((await cardsFor(o, STREAMCARD_KINDS)).cards.filter(c => !c.spot), kind); } catch { line = "Can't look that up right now."; }
        return send(res, 200, line, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    }
    const overlayOpen = new Map();
    let overlayTotal = 0;
    function overlayStream(req, res, url) {
        const token = url.searchParams.get("token") ?? "";
        const ov = db.overlayByToken(token), gid = ov?.guild_id;
        if (!gid || !music) throw new HttpError(404, "This overlay link isn't valid. Make a new one in the music studio's Settings.");
        const lim = overlayLimit.hit(clientIp(req));
        if (!lim.ok) throw new HttpError(429, `Too many tries. Try again in ${lim.retryAfterS}s.`);
        if (overlayTotal >= 100 || (overlayOpen.get(token) ?? 0) >= 4) throw new HttpError(429, "This overlay is open in too many places.");
        overlayTotal++; overlayOpen.set(token, (overlayOpen.get(token) ?? 0) + 1);
        const wantViz = url.searchParams.get("viz") === "1" && Boolean(music.viz);
        res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" });
        res.write("retry: 2000\n\n");
        const born = now();
        let n = 0, timer = 0, over = false, lastNp = "";
        const end = () => { if (over) return; over = true; clearInterval(timer); clearInterval(recheck); overlayTotal--; overlayOpen.set(token, Math.max(0, (overlayOpen.get(token) ?? 1) - 1)); try { res.end(); } catch { /* gone */ } };
        const np = () => {
            let st = null;
            try { st = music.status(gid); } catch { /* busy */ }
            const t = st?.current;
            const body = t ? { on: Boolean(st.active), playing: Boolean(st.playing), paused: Boolean(st.paused), id: `${t.url ?? ""}|${t.title}`, title: String(t.title ?? "").slice(0, 150), artist: String(t.artist ?? "").slice(0, 80), thumb: typeof t.thumb === "string" && t.thumb.startsWith("https://") ? t.thumb : null, duration: t.live ? 0 : Number(t.duration) || 0, live: Boolean(t.live), position: st.position ?? 0, next: st.next?.[0]?.title ? String(st.next[0].title).slice(0, 100) : null, auto: Boolean(t.auto), volume: st.volume ?? null }
                : { on: false, playing: false };
            return body;
        };
        // A link made through the streamer role stops working soon after the role is taken away. (Managers and the bot owner keep theirs until they reset it.)
        const recheck = ov.via === "role" ? setInterval(async () => {
            try { if (!canStreamIn(db.getCommunity(gid), { roleIds: await rolesIn(gid, ov.user_id) })) db.removeOverlay(gid, ov.user_id); } catch { /* keep going */ }
        }, 60_000) : 0;
        const tick = () => {
            if (db.overlayByToken(token)?.user_id !== ov.user_id || now() - born > 12 * 3600_000) return end(); // reset or removed: the old link stops at once
            if (n % 10 === 0) { const b = np(); const s = JSON.stringify(b); res.write(`event: np\ndata: ${s}\n\n`); lastNp = s; }
            if (wantViz) {
                let v = null;
                try { v = music.viz(gid, 200); } catch { /* skip a beat */ }
                if (v && !v.paused && v.frames?.length) res.write(`event: viz\ndata: ${JSON.stringify({ m: Math.round(v.playMs), f: v.first, d: Buffer.concat(v.frames.map(x => Buffer.from(x))).toString("base64") })}\n\n`);
            }
            n++;
        };
        timer = setInterval(tick, 100); tick();
        req.on("close", end); res.on("error", end);
    }
    const musicHome = musicOrigin ? musicOrigin + "/" : "/music";
    const cookieDomain = config.cookieDomain && [adminHost, musicHost].some(x => x && x.endsWith("." + config.cookieDomain)) ? config.cookieDomain : null;
    const chat = createMusicChat({ now });
    const onAdminHost = req => Boolean(adminHost) && String(req?.headers?.host ?? "").toLowerCase() === adminHost;
    const adminHome = adminOrigin ? adminOrigin + "/" : "/admin";
    const secure = origin.startsWith("https://");
    const sessions = new Map();
    const states = new Map();
    const steamKnown = new Map();   // one-time token -> { user, exp }: a Steam sign-in of a known member, waiting for the Discord half
    const steamPending = new Map(); // one-time token -> { steamid, exp }: a Steam sign-in that still needs a Discord account to attach to
    const lastRun = new Map();
    const cache = new Map();
    const overlayLimit = createLimiter({ windowMs: 60_000, max: 120, now });
    // Studio overlays: when each link was last opened (so the studio can say "connected"), and the live feed the alerts overlay reads.
    // The feed is worked out from member and boost counts every time an overlay asks, so nothing runs while nobody is streaming.
    const ovSeen = new Map(), ovFeed = new Map(), ovTest = new Map(), ovPolls = new Map();
    function feedFor(guildId, g) {
        if (!guildId || !g) return { ev: [] };
        let f = ovFeed.get(guildId);
        if (!f) { f = { m: g.members ?? null, b: g.boosts ?? null, ev: [] }; ovFeed.set(guildId, f); }
        const add = (type, count, by) => f.ev.push({ seq: nextSeq(), type, count, by, at: now() });
        const named = hasNamedFeed(); // then the bot reports each person itself, with their name
        if (!named && g.members != null && f.m != null && g.members > f.m) add("join", g.members, g.members - f.m);
        if (!named && g.boosts != null && f.b != null && g.boosts > f.b) add("boost", g.boosts, g.boosts - f.b);
        if (g.members != null) f.m = g.members;
        if (g.boosts != null) f.b = g.boosts;
        f.ev = f.ev.filter(e => now() - e.at < 10 * 60_000).slice(-30);
        return { ev: [...f.ev, ...overlayEventsFor(guildId, now())] };
    }
    async function overlayPayload(o) {
        const g = o.guild_id && guildList ? guildList().find(x => x.id === o.guild_id) ?? null : null;
        let data = overlayData(o, g ? { members: g.members ?? null, boosts: g.boosts ?? null } : null, now());
        const nameOf = id => remember("mname:" + o.guild_id + ":" + id, 10 * 60_000, () => rest.memberName(o.guild_id, id)).then(n => n || "a member").catch(() => "a member");
        try {
            if (o.kind === "board" && o.guild_id) {
                const top = db.xpTop(o.guild_id, o.config.limit);
                data = { rows: await Promise.all(top.map(async r => ({ name: await nameOf(r.user_id), level: r.level, xp: r.xp }))) };
            } else if (o.kind === "poll") {
                let st = null; try { st = o.config.pollId ? JSON.parse(db.getMeta(`poll:${o.config.pollId}`) || "null") : null; } catch { st = null; }
                if (st) { const counts = st.options.map(() => 0); for (const v of Object.values(st.votes ?? {})) if (counts[v] !== undefined) counts[v]++; data = { on: true, question: st.question || "What should we play?", open: now() <= st.until, until: st.until, total: counts.reduce((a, b) => a + b, 0), options: st.options.map((x, i) => ({ title: x.title, count: counts[i] })) }; }
                else data = { on: false };
            } else if (o.kind === "free") {
                const list = await remember("ovfree", 10 * 60_000, async () => (await itad.getGiveawayList()).filter(g => /^https:\/\//i.test(g.url ?? "")).map(g => ({ title: String(g.title ?? "").slice(0, 80), shop: String(g.shop ?? "").slice(0, 30), expiry: g.expiry ?? null, dlc: isDlc(g) })));
                data = { games: list.filter(g => o.config.showDlc || !g.dlc).filter(g => !g.expiry || new Date(g.expiry).getTime() > now()).slice(0, o.config.limit).map(({ title, shop, expiry }) => ({ title, shop, expiry })) };
            } else if (o.kind === "playing" && o.guild_id) {
                const r = nowPlaying?.enabled ? await whoIsPlaying(db, nowPlaying, o.guild_id) : { games: [] };
                data = { games: await Promise.all(r.games.slice(0, o.config.limit).map(async x => ({ game: x.game, count: x.players.length, names: await Promise.all(x.players.slice(0, 3).map(p => nameOf(p.userId))) }))) };
            }
        } catch { /* leave the numbers empty rather than fail the overlay */ }
        return { kind: o.kind, name: o.name, config: o.config, data, g };
    }
    const idFinderLimit = createLimiter({ windowMs: 60_000, max: 15, now });
    const indieApi = indieSvc ?? createIndie();
    const fortniteCall = async fn => { try { return await fn(); } catch (e) { if (e instanceof UserError) throw new HttpError(400, e.message); throw e; } };
    const indieHerald = indieNews ?? createIndieNews({ db, dm, base: origin, log });
    const indieUpdateLimit = createLimiter({ windowMs: 3600_000, max: 6, now });
    const indieKeyLimit = createLimiter({ windowMs: 3600_000, max: 8, now });
    const indieVerifyLimit = createLimiter({ windowMs: 60_000, max: 3, now });
    const indieReportLimit = createLimiter({ windowMs: 3600_000, max: 6, now });
    const indieLookupLimit = createLimiter({ windowMs: 60_000, max: 20, now });
    const fortniteLimit = createLimiter({ windowMs: 60_000, max: 40, now });
    const fnSvc = fortniteSvc ?? createFortnite();
    const indieSyncLimit = createLimiter({ windowMs: 60_000, max: 1, now });
    const indieWriteLimit = createLimiter({ windowMs: 10 * 60_000, max: 12, now });
    const socialRead = createLimiter({ windowMs: 60_000, max: 90, now });
    const socialWrite = createLimiter({ windowMs: 60_000, max: 25, now });
    const apiLimit = createLimiter({ windowMs: 60_000, max: config.apiPerMinute ?? 120, now });
    const bgLimit = createLimiter({ windowMs: 3600_000, max: 20, now });
    const giftLimit = createLimiter({ windowMs: 3600_000, max: 60, now });
    const shareLimit = createLimiter({ windowMs: 60_000, max: 120, now });
    const artLimit = createLimiter({ windowMs: 60_000, max: 900, now });
    const artFetch = config.artFetch ?? globalThis.fetch;
    const loginLimit = createLimiter({ windowMs: 60_000, max: 8, now });
    const authLimit = createLimiter({ windowMs: 60_000, max: config.authPerMinute ?? 20, now });
    const names = new Map(); // "guild:user" -> { name, until }

    // ---------- helpers ----------
    const cookies = req => Object.fromEntries(String(req.headers.cookie ?? "").split(";").map(c => {
        const i = c.indexOf("=");
        return i < 0 ? [] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
    }).filter(p => p.length));

    const setCookie = (res, name, value, maxAgeS) => {
        const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeS}`];
        if (secure) parts.push("Secure");
        if (cookieDomain && name === COOKIE) parts.push(`Domain=${cookieDomain}`);
        const prev = res.getHeader("Set-Cookie") ?? [];
        res.setHeader("Set-Cookie", [...(Array.isArray(prev) ? prev : [prev]), parts.join("; ")]);
    };

    // Text is sent compressed to browsers that accept it: the page code is about a fifth of its size that way.
    const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml)|image\/svg)/;
    const encodingOf = req => { const a = String(req?.headers?.["accept-encoding"] ?? ""); return /\bbr\b/.test(a) ? "br" : /\bgzip\b/.test(a) ? "gzip" : null; };
    const squeeze = (buf, enc, quality) => (enc === "br" ? brotliCompressSync(buf, { params: { [zc.BROTLI_PARAM_QUALITY]: quality } }) : gzipSync(buf, { level: Math.min(9, quality) }));
    const CSP =
"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: https://cdn.discordapp.com https://cdn.akamai.steamstatic.com https://shared.akamai.steamstatic.com https://cdn.cloudflare.steamstatic.com https://shared.akamai.steamstatic.com https://assets.isthereanydeal.com https://media.discordapp.net https: data:; " +
        "media-src 'self' blob: https:; connect-src 'self'; manifest-src 'self'; form-action 'self'; base-uri 'none'; frame-src 'self' https://www.youtube-nocookie.com https://w.soundcloud.com https://open.spotify.com; object-src 'self'; frame-ancestors 'none'";
    // ---------- public game pages ----------
    const gamePages = new Map(); // appid -> { at, page }; a few hundred at most, an hour or three old at most
    async function publicGamePage(appid) {
        const hit = gamePages.get(appid);
        if (hit && Date.now() - hit.at < 3 * 3600_000) return hit.page;
        let page = null;
        try {
            const id = (await itad.lookupShopIds(61, [`app/${appid}`])).get(`app/${appid}`);
            if (id) {
                const info = await itad.getTitle(id);
                if (info?.title) {
                    const [prices, history] = await Promise.all([itad.getPrices([id], "US").catch(() => new Map()), itad.getHistory(id, "US").catch(() => [])]);
                    const sum = summarize(prices.get(id), {});
                    const cur = sum.currency || "USD", fmt = n => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(n); } catch { return String(n); } };
                    const price = sum.best?.price ?? null, step = Math.max(1, Math.ceil(history.length / MAX_HISTORY_POINTS));
                    const data = { title: info.title, appid, itadId: id, currency: cur, price, shop: sum.best?.shop ?? null, shopUrl: /^https:\/\//i.test(sum.best?.url ?? "") ? sum.best.url : null,
                        msrp: sum.msrp, low1y: sum.low1y, atl: sum.atl, image: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`,
                        points: history.filter((_, i) => i % step === 0 || i === history.length - 1).map(p => ({ t: p.t, price: p.price })),
                        advice: price !== null ? buyOrWait(history, price, { sales: upcomingSales(Date.now()), past: salesBefore(), money: fmt }) : null };
                    page = { path: `/game/${appid}-${slugify(info.title)}`, html: renderGamePage(data, { origin }) };
                }
            }
        } catch { page = null; }
        if (page) { if (gamePages.size >= 400) gamePages.delete(gamePages.keys().next().value); gamePages.set(appid, { at: Date.now(), page }); }
        return page;
    }
    const send = (res, status, body, headers = {}) => {
        const type = String(headers["Content-Type"] ?? "");
        if (COMPRESSIBLE.test(type) && !headers["Content-Encoding"] && body && Buffer.byteLength(body) > 1024) {
            const enc = encodingOf(res.req);
            if (enc) { body = squeeze(Buffer.from(body), enc, 4); headers = { ...headers, "Content-Encoding": enc, Vary: "Accept-Encoding" }; }
        }
        const path = String(res.req?.url ?? "");
        // LucadoOS shows the site's own pages in windows, which are same-origin frames. Nobody else can frame them.
        const ownFrame = res.req?.headers?.["sec-fetch-dest"] === "iframe" && res.req?.headers?.["sec-fetch-site"] === "same-origin" && !onAdminHost(res.req) && !onMusicHost(res.req);
        res.writeHead(status, {
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "no-referrer",
            "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
            "Cross-Origin-Opener-Policy": "same-origin",
            ...(origin.startsWith("https://") ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
            // The data and sign-in endpoints never belong in a search result, even if something links to them.
            ...(/^\/(api|auth)\//.test(path) || /^\/(admin|music|overlay|streamcard|giveawayoverlay)(\.css|\.js)?(\?|$)/.test(path) || onAdminHost(res.req) || onMusicHost(res.req) ? { "X-Robots-Tag": "noindex, nofollow" } : {}),
            "Content-Security-Policy": /^\/(overlay|giveawayoverlay|ov)(\?|$)/.test(path) || ownFrame ? CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'") : CSP,
            ...(/^\/(overlay|giveawayoverlay|ov)(\?|$)/.test(path) || ownFrame ? { "X-Frame-Options": "SAMEORIGIN" } : {}),
            // The terms and privacy PDFs are shown in a frame on our own pages, so they may be framed by us and by no one else.
            ...(/^\/[a-z-]+\.pdf(\?|$)/.test(path) ? { "X-Frame-Options": "SAMEORIGIN", "Content-Security-Policy": "frame-ancestors 'self'", "Content-Disposition": "inline" } : {}),
            ...headers
        });
        res.end(body);
    };
    const json = (res, status, data, headers = {}) =>
        send(res, status, JSON.stringify(data), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });

    async function readJson(req, limit) {
        const chunks = [];
        let size = 0;
        for await (const c of req) {
            size += c.length;
            if (size > limit) throw new HttpError(413, "That request is too large.");
            chunks.push(c);
        }
        if (!size) return {};
        try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { throw new HttpError(400, "Bad request."); }
    }

    // Public profile cards are cached for a minute and a half so the Steam page does not ask Steam every time.
    const cardCache = new Map();
    async function profileCard(steamid) {
        const hit = cardCache.get(steamid);
        if (hit && now() - hit.at < 90_000) return hit.card;
        const card = await fetchProfileCard(steamid, steamFetch);
        if (card) { if (cardCache.size > 500) cardCache.clear(); cardCache.set(steamid, { at: now(), card }); }
        return card;
    }

    function sweep() {
        chat.sweep();
        const t = now();
        for (const [k, s] of sessions) if (s.expires < t) sessions.delete(k);
        for (const [k, exp] of states) if (exp < t) states.delete(k);
        for (const [k, p] of steamPending) if (p.exp < t) steamPending.delete(k);
        for (const [k, p] of steamKnown) if (p.exp < t) steamKnown.delete(k);
        for (const [k, at] of lastRun) if (t - at > 120_000) lastRun.delete(k); // the longest cooldown is a minute
    }


    // ---- community feed helpers
    /** What a feed card shows for a member: their page name, picture and address. No account ids leave the server. */
    const authorCard = id => {
        const u = db.getUser(id), data = db.getProfileData(id).data, link = db.getSteamLink(id);
        return { slug: u?.profile_slug ?? null, name: data.name || u?.profile_slug || "Someone", avatar: data.avatar && link?.avatar ? link.avatar : null };
    };
    /** Every server the bot is in that has not opted out, as the community directory lists them. */
    // Square calls this when a payment finishes. It isn't a browser, so it skips the dashboard's request checks and proves itself with a signature instead.
    async function squareWebhook(req, res) {
        if (!square?.enabled || !supporters) return json(res, 404, { error: "Not found." });
        const raw = await new Promise((resolve, reject) => {
            const chunks = []; let size = 0;
            req.on("data", c => { size += c.length; if (size > 200_000) { reject(new HttpError(413, "Too large.")); req.destroy(); } else chunks.push(c); });
            req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8"))); req.on("error", reject);
        });
        const note = (what, detail = "") => { try { pushEvent(db, "adminlog:square", { at: now(), what, detail: String(detail).slice(0, 160) }, 60); } catch { /* the log is a nicety */ } };
        if (!square.verify(raw, req.headers["x-square-hmacsha256-signature"])) { note("Rejected", "The signature didn't match. Check the signature key and the webhook address."); return json(res, 403, { error: "Bad signature." }); }
        let event; try { event = JSON.parse(raw); } catch { return json(res, 400, { error: "Bad request." }); }
        try {
            const paid = await square.paidPass(event);
            if (paid) { const g = await supporters.grant(paid.userId, paid.plan.days, paid.paymentId, paid.giftFrom ? "Square gift" : "Square", paid.plan.cents, { giftFrom: paid.giftFrom }); note(g.duplicate ? "Paid (already counted)" : "Paid", `${paid.plan.name} for ${paid.userId}${paid.giftFrom ? " (gift)" : ""}${g.role && g.role !== "ok" ? ", role not given: " + g.role : ""}`); }
            const back = square.refund(event);
            if (back) { const r = await supporters.refund(back.paymentId, back.cents); note(r.ignored ? "Refund ignored" : "Refunded", r.partial ? "A partial refund: change the pass by hand if you want." : r.ignored ? "No matching pass." : `Payment ${back.paymentId}`); }
            if (!paid && !back) note("Other event", String(event?.type ?? "unknown"));
        } catch (err) { log(`[square] ${err.message}`); note("Error", err.message); return json(res, 500, { error: "Try again." }); } // Square tries again later
        return json(res, 200, { ok: true });
    }
    const checkoutLimit = createLimiter({ windowMs: 60_000, max: 6, now });
    const directory = () => (guildList ? guildList() : []).filter(g => !isHidden(g.id) && db.guildSocial(g.id).listed).map(g => ({ id: g.id, name: g.name, members: g.members ?? null }));
    /** "all" or one listed server id. Returns the guild ids to filter by. */
    const serverFilter = (_sess, which) => {
        const dir = directory();
        if (!which || which === "all") return dir.map(g => g.id);
        if (!dir.some(g => g.id === which)) throw new HttpError(404, "That server isn't in the community directory.");
        return [which];
    };
    const shapeItems = (items, viewerId, servers = []) => {
        const cache = new Map(), names = new Map(servers.map(g => [g.id, g.name])), shared = new Map();
        return items.map(i => {
            if (!cache.has(i.author)) { cache.set(i.author, authorCard(i.author)); shared.set(i.author, db.userGuildIds(i.author).filter(g => names.has(g)).map(g => ({ id: g, name: names.get(g) })).slice(0, 2)); }
            const { author, slug, guild, ...rest } = i;
            return { ...rest, own: author === viewerId, by: cache.get(i.author), art: i.appid ? steamArt(i.appid) : null, servers: shared.get(i.author) };
        });
    };
    const peopleList = (rows, viewerId) => rows.map(r => ({ ...authorCard(r.discord_id), shared: r.shared ?? undefined, following: viewerId ? db.isFollowing(viewerId, r.discord_id) : false }));
    /** Posting needs a real Discord account, not a brand new one, and not one the bot's owner has turned posting off for. */
    const mayPost = s => {
        if (s.steamOnly) throw new HttpError(403, "Sign in with Discord to post.");
        if (s.userId !== config.ownerId && !accountOldEnough(s.userId, now())) throw new HttpError(403, "Your Discord account is too new to post yet. Try again in a few days.");
    };
    // Feed activity reaches a person in the dashboard's notifications and, if they ask for it, in a Discord message. A few a hour at most.
    const dmCounts = new Map(), reactSeen = new Set();
    function notifySocial(userId, { title, body = null, url = "/feed" }) {
        const prefs = db.getPrefs(userId);
        if (prefs.notify) db.addNotification(userId, { type: "social", title, body, url });
        if (!prefs.dm || !dm) return;
        const hour = Math.floor(now() / 3_600_000), c = dmCounts.get(userId);
        if (c && c.hour === hour && c.n >= 5) return;
        dmCounts.set(userId, { hour, n: c && c.hour === hour ? c.n + 1 : 1 });
        if (dmCounts.size > 5000) dmCounts.clear();
        const origin = config.publicUrl ?? "";
        Promise.resolve(dm(userId, { embeds: [{ color: 0x66c0f4, title: String(title).slice(0, 200), description: [body, origin ? `${origin}${url}` : null].filter(Boolean).join("\n\n").slice(0, 1000) || undefined, footer: { text: "Steam Value Checker · turn these off under Feed settings" } }] })).catch(() => {});
    }
    const slugOwner = slug => {
        const o = db.getProfileBySlug(String(slug ?? "").toLowerCase());
        if (!o || !o.profile_public || db.getProfileData(o.discord_id).blocked) throw new HttpError(404, "That page does not exist or is private.");
        return o;
    };

    function session(req) {
        const s = sessions.get(cookies(req)[COOKIE]);
        if (!s || s.expires < now()) throw new HttpError(401, "Please sign in with Discord.");
        // A username and password sign-in opens the admin panel and nothing else, even though the cookie is shared across the site.
        if (s.adminOnly && !/^\/api\/(admin\/|me$|config$)/.test(String(req.url).split("?")[0])) throw new HttpError(401, "Please sign in with Discord.");
        if (s.userId && s.userId !== config.ownerId && db.isBanned(s.userId)) {
            sessions.delete(cookies(req)[COOKIE]);
            throw Object.assign(new HttpError(403, RESTRICTED_TEXT), { restricted: true });
        }
        const path = String(req.url).split("?")[0], onPanel = /^\/api\/admin\//.test(path);
        // Someone the owner let into the admin panel (a username login or a Discord account). On the panel's own pages they act with the owner's rights,
        // limited to the areas they were given, and never on the owner-only ones.
        const access = s.subAdmin || (onPanel && s.userId !== config.ownerId && !s.steamOnly) ? db.getAdminAccess(s.userId) : null;
        if (s.subAdmin && !access) { sessions.delete(cookies(req)[COOKIE]); throw new HttpError(401, "Please sign in with Discord."); }
        if (access && onPanel) {
            if (/^\/api\/admin\/(account|admins|backup)/.test(path)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!mayChange(access.edit, req.method, path)) throw new HttpError(403, "You can look at this page, but you don't have permission to change it. Ask the owner for edit access.");
            if (req.method === "POST" && !auditedReq.has(req)) { auditedReq.add(req); try { db.logAudit({ actor: s.userId, action: "admin-action", target: path, detail: "panel user " + (access.label || s.username) }); } catch { /* best effort */ } }
            return { ...s, userId: config.ownerId, steamOnly: false, viaSub: s.userId, adminOnly: true };
        }
        if (s.subAdmin) return s;
        if (s.userId) db.touchUser(s.userId);
        return s;
    }
    const auditedReq = new WeakSet();

    /** The signed-in session if there is one, otherwise null (for public pages that show a little more to staff). */
    function softSession(req) {
        const s = sessions.get(cookies(req)[COOKIE]);
        return s && !s.adminOnly && s.expires >= now() && !(s.userId && s.userId !== config.ownerId && db.isBanned(s.userId)) ? s : null;
    }
    const STAFF_PERMS = ["moderate", "kick", "ban", "manageMessages"];
    /** Owner, Manage Server, Administrator or any moderator permission in that server. */
    const isStaff = g => Boolean(g) && (isManager(g) || STAFF_PERMS.some(k => hasGuildPerm(g, k)));

    function checkWrite(req) {
        const type = String(req.headers["content-type"] ?? "");
        if (!type.startsWith("application/json") || req.headers["x-requested-with"] !== "dashboard") {
            throw new HttpError(403, "Request blocked.");
        }
        if (req.headers.origin && req.headers.origin !== origin && req.headers.origin !== adminOrigin && req.headers.origin !== musicOrigin) throw new HttpError(403, "Request blocked.");
    }

    // The board with names filled in. A claimed copy shows who claimed it only to the lister and the claimer.
    async function giftRows(guildId, me) {
        const name = async id => (await remember("mname:" + guildId + ":" + id, 10 * 60_000, () => rest.memberName(guildId, id)).catch(() => null)) || "a member";
        const out = [];
        for (const g of listGifts(db, guildId).filter(x => !x.claimedBy || x.user === me || x.claimedBy === me)) out.push({ id: g.id, title: g.title, at: g.at, mine: g.user === me, from: g.user === me ? null : await name(g.user), claimed: Boolean(g.claimedBy), claimedByMe: g.claimedBy === me, claimedBy: g.user === me && g.claimedBy ? await name(g.claimedBy) : null });
        return out;
    }
    function cooldown(userId, key) {
        const k = `${key}:${userId}`;
        const wait = COOLDOWNS[key] - (now() - (lastRun.get(k) ?? 0));
        if (wait > 0) throw new HttpError(429, `Slow down a little. Try again in ${Math.ceil(wait / 1000)}s.`);
        lastRun.set(k, now());
        return () => lastRun.delete(k);
    }

    const clientIp = req => {
        const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",").map(x => x.trim()).filter(Boolean);
        // Behind a trusted proxy the last entry is the one the proxy added; otherwise ignore the header.
        return (config.trustProxy && fwd.length ? fwd[fwd.length - 1] : req.socket.remoteAddress) ?? "unknown";
    };

    const managedGuild = (req, guildId) => {
        const g = session(req).guilds.find(x => x.id === guildId);
        if (!g || !isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
        return g;
    };
    /** Anyone signed in who is in that server (and the bot is too) may use its player; the player itself checks the rest. */
    const musicMember = (s, guildId) => {
        const g = s.guilds.find(x => x.id === String(guildId ?? ""));
        if (!g || !botGuilds?.(g.id)) throw new HttpError(404, "I'm not in that server, or you're not in it.");
        return g;
    };
    // ----- streams: who may announce one, show the OBS overlay, or change the settings -----
    const gwOverlayPicks = uid => { try { const v = JSON.parse(db.getMeta("gwov:" + uid) ?? "[]"); return Array.isArray(v) ? v.map(Number).filter(Number.isInteger).slice(0, 6) : []; } catch { return []; } };
    const streamGw = createStreamGiveaways({ db, giveaways: () => giveaways, now });
    const streams = rest?.sendMessage ? createStreams({ db, api: rest, now, onEnd: (g, u) => streamGw.onEnd(g, u) }) : null;
    const rolesIn = (gid, uid) => remember("mroles:" + gid + ":" + uid, 20_000, async () => { try { return (await rest.getMember?.(gid, uid))?.roles ?? []; } catch { return []; } }).catch(() => []);
    /** Streamers, moderators, managers and the bot owner. Returns the server entry, or throws. */
    const streamAccess = async (s, guildId) => {
        const g = musicMember(s, guildId);
        const ok = canStreamIn(db.getCommunity(g.id), { isManager: isManager(g), isBotOwner: isOwner(s), roleIds: isManager(g) || isOwner(s) ? [] : await rolesIn(g.id, s.userId) });
        if (!ok) throw new HttpError(403, "Only moderators, managers and people with this server's streamer role can do that.");
        return g;
    };
    const mayStream = async (s, g) => { try { await streamAccess(s, g.id); return true; } catch { return false; } };
    /** Player errors are plain sentences meant for people, so they go back as they are. */
    const musicCall = async fn => { try { return await fn(); } catch (e) { if (e instanceof UserError) throw new HttpError(400, e.message); throw e; } };
    async function guildChoices(guildId, withRoles = true) {
        try { return { channels: await rest.listChannels(guildId), roles: withRoles ? await Promise.resolve(rest.listRoles?.(guildId) ?? []).catch(() => []) : [] }; }
        catch (err) {
            if (err instanceof DiscordApiError && [403, 404].includes(err.status)) throw new HttpError(400, "The bot is not in that server yet. Invite it first.");
            throw err;
        }
    }
    // The Music page refreshes every few seconds, so anything it asks Discord for is remembered for a while.
    const memo = new Map();
    // What the profile editor needs in one go.
    async function profileEditorPayload(u) {
        const { data, blocked } = db.getProfileData(u.discord_id);
        const titles = [...new Set([...db.listLibrary(u.discord_id), ...db.listItems(u.discord_id)].map(x => x.title))].sort((a, b) => a.localeCompare(b)).slice(0, 500);
        return {
            slug: u.profile_slug ?? null, public: Boolean(u.profile_public), blocked, config: withDefaults(data), birthday: { value: db.getBirthday(u.discord_id)?.mmdd ?? "", share: Boolean(db.getBirthday(u.discord_id)?.share) },
            steamLinked: Boolean(db.getSteamLink(u.discord_id)),
            backgrounds: db.listProfileBgs(u.discord_id).map(b => ({ id: b.id, source: b.source, bytes: b.bytes, url: `/pbg/${b.id}?v=${b.created_at}` })), maxBackgrounds: MAX_BG_STORED, presets: PAGE_PRESETS,
            choices: { themes: Object.entries(PROFILE_THEMES).map(([k, v]) => ({ key: k, bg: v.bg, accent: v.accent, locked: Boolean(v.supporter) && !isSupporter(db, u.discord_id, now()) })), styles: Object.entries(PROFILE_STYLES).map(([k, v]) => ({ key: k, name: v.name, blurb: v.blurb, bg: v.bg ?? null, accent: v.accent ?? null, locked: Boolean(v.supporter) && !isSupporter(db, u.discord_id, now()) })), bgstyles: BG_STYLES, layouts: LAYOUTS, sections: Object.entries(SECTIONS), links: LINK_KIND_NAMES, titles },
            profile: u.profile_slug ? await buildProfile({ db, itad, nowPlaying }, u, { owner: true, sameServer: true }) : null
        };
    }
    const remember = async (key, ttl, fn) => {
        const hit = memo.get(key);
        if (hit && hit.until > Date.now()) return hit.value;
        try { const value = await fn(); memo.set(key, { value, until: Date.now() + ttl }); if (memo.size > 2000) memo.delete(memo.keys().next().value); return value; }
        catch (err) { if (hit) return hit.value; throw err; } // Discord is busy: show the last answer rather than an error
    };
    const AUDIT_FIELDS = ["id", "ban", "action", "audience", "guild_id", "status", "kind", "reason", "title"];
    function auditAdmin(req, path, body) {
        try {
            const s = session(req);
            if (body && isHidden(String(body.guild_id ?? ""))) return;
            const detail = Object.entries(body ?? {}).filter(([k, v]) => AUDIT_FIELDS.includes(k) && ["string", "number", "boolean"].includes(typeof v) && String(v).length <= 120).map(([k, v]) => `${k}=${v}`).join(" ");
            db.logAudit({ actor: s.userId, action: path.replace("/api/admin/", ""), target: body?.id ?? body?.guild_id ?? null, detail: detail || null });
        } catch { /* the action already happened; a missing log line must not undo it */ }
    }
    /** Re-asks for the password before a sensitive change. Wrong answers count toward the same lockout as sign-in. */
    function verifyCurrent(row, password) {
        const t = now();
        if (row.locked_until > t) throw new HttpError(429, `Too many wrong passwords. Try again in ${Math.ceil((row.locked_until - t) / 60000)} minutes.`);
        if (!password || !checkPassword(String(password), row.salt, row.hash)) { db.failAdminLogin(config.ownerId, now()); throw new HttpError(403, "That is not your current password."); }
    }
    /** Username and password (plus an authenticator code when turned on). The reply never says which part was wrong. */
    function adminPasswordLogin(req, res, b) {
        const ip = clientIp(req);
        const r = loginLimit.hit(ip);
        if (!r.ok) throw new HttpError(429, `Too many tries. Try again in ${r.retryAfterS}s.`);
        const row = config.ownerId ? db.getAdminLoginByName(String(b.username ?? "").trim().toLowerCase()) : null;
        const wrong = () => new HttpError(401, "Wrong username or password.");
        if (!row || (row.owner_id !== config.ownerId && !db.getAdminAccess(row.owner_id))) { burnTime(); throw wrong(); }
        const t = now();
        if (row.locked_until > t) { burnTime(); throw new HttpError(429, "This sign-in is locked for a while after too many wrong tries. Use Discord, or wait."); }
        if (!checkPassword(String(b.password ?? ""), row.salt, row.hash)) {
            const lock = db.failAdminLogin(row.owner_id, t);
            try { db.logAudit({ actor: row.owner_id, action: "login-failed", target: null, detail: `ip=${ip}${lock ? " locked" : ""}` }); } catch { /* best effort */ }
            throw wrong();
        }
        let step = 0;
        if (row.totp_on) {
            if (!String(b.code ?? "").trim()) return { needCode: true };
            step = matchTotp(row.totp_secret, b.code, t, row.totp_step);
            if (!step) { db.failAdminLogin(row.owner_id, t); throw new HttpError(401, "That code is not right."); }
        }
        db.okAdminLogin(row.owner_id, step, t);
        startSession(res, { userId: row.owner_id, username: row.username, avatar: null, guilds: [], adminOnly: true, subAdmin: row.owner_id !== config.ownerId }, ADMIN_SESSION_MS);
        try { db.logAudit({ actor: row.owner_id, action: "login-password", target: null, detail: `ip=${ip}` }); } catch { /* best effort */ }
        return { ok: true };
    }
    const isOwner = s => Boolean(config.ownerId) && s.userId === config.ownerId && !s.steamOnly; // admin always needs a real Discord sign-in
    // The staff chat knows people by one key: the owner's Discord ID, a Discord admin's ID, or an adm-... login.
    const WALLS = [
        { id: "default", name: "Default", css: "" },
        { id: "ocean", name: "Ocean", css: "linear-gradient(135deg, #0a3a86 0%, #0e55b8 45%, #1b86e0 100%)" },
        { id: "dusk", name: "Dusk", css: "linear-gradient(135deg, #2b1055 0%, #7597de 100%)" },
        { id: "sunset", name: "Sunset", css: "linear-gradient(135deg, #42275a 0%, #a8456b 55%, #f09a5b 100%)" },
        { id: "forest", name: "Forest", css: "linear-gradient(135deg, #0b3d2e 0%, #1c7a52 60%, #6bbf8a 100%)" },
        { id: "graphite", name: "Graphite", css: "linear-gradient(135deg, #16181d 0%, #2b2f38 100%)" },
        { id: "aurora", name: "Aurora", css: "radial-gradient(900px 600px at 20% 10%, #2dd4bf55, transparent 60%), radial-gradient(900px 600px at 85% 80%, #8b5cf655, transparent 60%), linear-gradient(135deg, #0b1220, #101a33)" }
    ];
    /** Only known looks and wallpapers, and a plain hex color; anything else falls back to the defaults. */
    const cleanLook = b => ({ look: b?.look === "windows" ? "windows" : "original", waves: b?.waves === true, wall: WALLS.some(w => w.id === b?.wall) ? b.wall : /^#[0-9a-fA-F]{6}$/.test(String(b?.wall ?? "")) ? String(b.wall).toLowerCase() : "default" });
    /** Only the owner and people the owner let into the panel (they arrive here acting as the owner). */
    const chatSession = req => { const s = session(req); if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this."); return s; };
    // ----- staff chat pictures and clips: kept on disk next to the database, checked by what the bytes really are -----
    const mediaDir = config.chatMediaDir ?? joinPath(config.backupDir ? dirnameOf(config.backupDir) : tmpdir(), "chat-media");
    const RADIO_MAX = 200;
    const MEDIA_MAX = { image: 10_000_000, video: 30_000_000 };
    const mediaLimit = createLimiter({ windowMs: 60_000, max: 8, now });
    function sniffMedia(b) {
        if (b.length < 12) return null;
        const t4 = b.toString("latin1", 0, 4);
        if (b[0] === 0x89 && t4.slice(1) === "PNG") return { kind: "image", mime: "image/png", ext: "png" };
        if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: "image", mime: "image/jpeg", ext: "jpg" };
        if (t4 === "GIF8") return { kind: "image", mime: "image/gif", ext: "gif" };
        if (t4 === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return { kind: "image", mime: "image/webp", ext: "webp" };
        if (b.toString("latin1", 4, 8) === "ftyp") { const brand = b.toString("latin1", 8, 12); if (/^(heic|heix|mif1|msf1|hevc)/.test(brand)) return null; return brand.startsWith("qt") ? { kind: "video", mime: "video/quicktime", ext: "mov" } : { kind: "video", mime: "video/mp4", ext: "mp4" }; }
        if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: "video", mime: "video/webm", ext: "webm" };
        return null;
    }
    const mediaPath = m => joinPath(mediaDir, `${m.id}.${m.ext}`);
    const dropFiles = list => { for (const m of list) { try { unlinkSync(mediaPath(m)); } catch { /* already gone */ } try { db.dropStaffMedia(m.id); } catch { /* best effort */ } } };
    const chatTyping = new Map(); // room -> Map(person key -> when they last typed)
    const chatLimit = createLimiter({ windowMs: 5000, max: 6, now });
    const chatOnline = new Map();
    const chatMe = s => { const key = s.viaSub ?? s.userId, owner = !s.viaSub && key === config.ownerId, access = owner ? null : db.getAdminAccess(key); const pic = /^https:\/\/cdn\.discordapp\.com\//.test(String(s.avatar ?? "")) && /^\d{17,20}$/.test(key) ? String(s.avatar) : null; return { key, owner, name: String(access?.label || s.username || "Someone").slice(0, 40), pic }; };
    const chatSeen = me => { chatOnline.set(me.key, now()); try { db.setMeta("staffname:" + me.key, me.name); if (me.pic) db.setMeta("staffpic:" + me.key, me.pic); } catch { /* the name is a nicety */ } };
    const chatPeople = () => {
        const t = now(), nameOf = k => db.getMeta("staffname:" + k) || null;
        const list = [{ key: config.ownerId, name: nameOf(config.ownerId) || "Owner", role: "owner" }, ...db.listAdminAccess().map(a => ({ key: a.id, name: a.label || a.username || nameOf(a.id) || "Admin", role: a.edit.includes("*") ? "admin" : "staff" }))];
        return list.map(p => ({ ...p, avatar: db.getMeta("staffpic:" + p.key) || null, online: (chatOnline.get(p.key) ?? 0) > t - 45_000 }));
    };
    /** A room the person may use: a channel that exists, or a direct message with one other person on the panel. */
    const chatChannel = (me, id) => {
        if (isDm(id)) {
            const parts = dmParts(id), other = parts.find(x => x !== me.key);
            if (!parts.includes(me.key) || !other || parts.length !== 2 || !chatPeople().some(p => p.key === other)) throw new HttpError(403, "That conversation isn't yours.");
            return dmChannel(parts[0], parts[1]);
        }
        if (!db.hasStaffChannel(id)) { db.staffChannels(); if (!db.hasStaffChannel(id)) throw new HttpError(404, "That channel isn't there."); }
        return id;
    };
    let broadcasterInstance = null;
    const broadcaster = () => sharedBroadcaster ?? (broadcasterInstance ??= createBroadcaster({ publicUrl: config.publicUrl, db, ownerId: config.ownerId, delayMs: config.broadcastDelayMs ?? 1100,
        guildInfo: id => { const g = (guildList ? guildList() : []).find(x => x.id === id); return g ? { name: g.name, icon: g.icon ?? null } : null; },
        sendDm: (id, p) => dm(id, p), sendChannel: (id, p) => rest.sendMessage(id, p), presetPayload: id => noticePreset(id, { base: config.publicUrl, dashboardUrl: config.publicUrl, creator: config.creator }), promoPayload: () => grabberPromo({ base: config.publicUrl, url: process.env.EXTENSION_STORE_URL || EXTENSION_STORE_URL, dashboardUrl: config.publicUrl }) }));

    function managerGuild(s, id) {
        const g = guildFor(s, id);
        if (!isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
        return g;
    }
    const needGiveaways = () => { if (!giveaways) throw new HttpError(503, "Giveaways are not set up on this bot. The owner needs to set KEY_ENCRYPTION_SECRET."); };
    /** One plain line for a giveaway's list: what became of the prizes (claimed, waiting, no winner) and whether waiting winners were reached. */
    const outcomeOf = (x, keys) => {
        if (x.status === "active" || x.status === "scheduled" || x.status === "cancelled") return null;
        const n = st => keys.filter(k => k.status === st).length;
        const claimed = n("delivered") + n("confirmed"), waiting = n("assigned"), open = n("available"), problem = n("problem");
        const lost = keys.filter(k => k.status === "assigned" && k.notify_state === "none").length;
        const bits = [];
        if (claimed) bits.push(`${claimed} claimed`);
        if (waiting) bits.push(`${waiting} waiting on a winner${lost ? ` (${lost} couldn't be reached)` : ""}`);
        if (open) bits.push(`${open} with no winner`);
        if (problem) bits.push(`${problem} with a problem`);
        return bits.join(", ") || null;
    };
    /** Prizes still waiting for their winner to press Claim, with the winner's name and time left, for the dashboard and the admin panel. */
    const pendingClaimsFor = async (guildId = null) => {
        const guildNames = new Map((guildList?.() ?? []).map(g => [g.id, g.name]));
        const rows = db.pendingClaims({ guildId, limit: 100 });
        return await Promise.all(rows.map(async k => {
            const winner = db.getMeta?.("staffname:" + k.winner_id) || await remember("uname:" + k.winner_id, 6 * 3_600_000, async () => (await rest?.userName?.(k.winner_id)) ?? null).catch(() => null);
            return { key_id: k.id, giveaway_id: k.giveaway_id, title: k.title, prize: k.label, winner_id: k.winner_id, winner: winner ? String(winner).slice(0, 60) : null, server: guildNames.get(k.guild_id) ?? null,
                global: Boolean(k.is_global), deadline: k.deadline, left_ms: Math.max(0, (k.deadline ?? now()) - now()), reminders: k.remind_stage, redraws: k.redraws, reached: k.notify_state ?? null };
        }));
    };
    function giveawayOf(g, id) {
        const x = db.getGiveaway(Number(id));
        if (!x || x.guild_id !== g.id) throw new HttpError(404, "I can't find that giveaway.");
        return x;
    }

    const needTickets = () => { if (!tickets) throw new HttpError(503, "Support tickets are not available."); };
    const settingsView = scope => { const x = db.getTicketSettings(scope); return { channel_id: x.channel_id, staff_role_id: x.staff_role_id, canned: db.listCanned(scope) }; };
    /** The ticket's owner, the bot owner, or a manager of the ticket's server may open it. `staff` says which side they are on. */
    function ticketAccess(s, id) {
        const t = db.getTicket(Number(id));
        if (!t) throw new HttpError(404, "I can't find that ticket.");
        const staff = isOwner(s) || Boolean(t.guild_id && s.guilds.some(g => g.id === t.guild_id && isManager(g)));
        if (t.user_id !== s.userId && !staff) throw new HttpError(404, "I can't find that ticket.");
        return { t, staff };
    }

    function guildFor(s, id) {
        const g = s.guilds.find(x => x.id === id);
        if (!g) throw new HttpError(403, "You are not in that server.");
        return g;
    }

    const cd = community ? createCommunityDash({ db, rest, community, membersIntent, rt, ai: { available: Boolean(config.aiAvailable), phrase: Boolean(config.aiPhrase), vault: config.aiKeyVault ?? null, lite: config.aiLite !== false, listModels: config.aiListModels ?? null, isMain: g => Boolean(config.mainGuild?.isMain(g)), checkKey: config.aiCheckKey ?? null }, botId: config.clientId, publicUrl: config.publicUrl, ...(emojigg ? { emojigg, fetchImpl: emojigg.fetchImpl ?? globalThis.fetch } : {}) }) : null;
    /** Community actions: the same Discord permissions as the commands. Errors from the helper become normal dashboard errors. */
    const comm = async fn => {
        if (!cd) throw new HttpError(503, "Community features are not available on this bot.");
        try { return await fn(); } catch (e) { if (e instanceof CommunityError) throw new HttpError(e.status, e.message); throw e; }
    };
    const md = moderation ? createModDash({ db, rest, mod: moderation }) : null;
    /** Moderation from the dashboard needs the same Discord permission the command does, on top of seeing the server. */
    const modGuild = (s, id, need) => {
        const g = guildFor(s, id);
        if (!hasGuildPerm(g, need)) throw new HttpError(403, `You need the ${MOD_PERMS[need].text} permission there.`);
        return g;
    };
    const modr = async fn => {
        if (!md) throw new HttpError(503, "Moderation is not available on this bot.");
        try { return await fn(); } catch (e) { if (e instanceof ModDashError) throw new HttpError(e.status, e.message); throw e; }
    };
    const botIn = g => { if (botGuilds && !botGuilds(g.id)) throw new HttpError(400, "The bot is not in that server yet. Invite it first."); };
    const num = v => (v === null || v === undefined || v === "" ? null : Number(v));
    const userRow = s => db.ensureUser(s.userId);
    /** A pasted profile if there is one, else the Steam account the person signed in with. */
    const profileOrLinked = async (s, pasted) => {
        const text = String(pasted ?? "").trim();
        if (text) return text;
        const link = db.getSteamLink(s.userId);
        if (!link) throw new HttpError(400, "Sign in through Steam first.");
        return link.steamid;
    };

    function publicSettings(u) {
        return { region: u.region, stores: u.stores, delivery: u.delivery, paused: Boolean(u.paused), guild_id: u.guild_id, steam_id: u.steam_id, ...prefsView(u) };
    }

    function serversFor(s, u) {
        return s.guilds
            .map(g => ({
                id: g.id, name: g.name, icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null,
                manageable: isManager(g), bot: botGuilds ? Boolean(botGuilds(g.id)) : null, freeFeed: Boolean(db.getGuild(g.id)?.free_feed), hotMin: db.getGuild(g.id)?.hot_min ?? 0, saleFeed: Boolean(db.getGuild(g.id)?.sale_feed), alertChannel: db.getGuild(g.id)?.channel_id ?? null,
                groupMin: db.getGuild(g.id)?.group_min ?? 0, weeklyDigest: Boolean(db.getGuild(g.id)?.weekly_digest)
            }))
            .sort((a, b) => Number(b.manageable) - Number(a.manageable) || a.name.localeCompare(b.name));
    }

    const PAGES = [["value", "Value Checker"], ["wishlist", "Wishlist"], ["library", "Library"], ["steam", "Steam"], ["deals", "Deals"], ["alerts", "Alerts"], ["servers", "Servers"], ["giveaways", "Giveaways"], ["support", "Support"], ["notifications", "Notifications"], ["mydata", "My Data"], ["help", "Help"], ["status", "Status"], ["changelog", "What's new"]];
    /** The first-run checklist on the dashboard home. */
    function setupSteps(s, u) {
        return [
            { id: "wishlist", text: "Add games to your wishlist", done: db.countItems(s.userId) > 0, href: "#/wishlist" },
            { id: "alerts", text: "Pick how you want alerts (DM or a server channel)", done: u.delivery === "channel" || u.quiet_start != null || Boolean(u.digest) || db.listAlerts(s.userId, 1).length > 0, href: "#/alerts" },
            { id: "free", text: "Turn on free game alerts", done: Boolean(u.free), href: "#/alerts" },
            { id: "library", text: "Add games you own to the library", done: db.countLibrary(s.userId) > 0, href: "#/library" },
            { id: "steam", text: "Link your public Steam profile for hours, recap and taste (optional)", done: Boolean(db.getSteamLink(s.userId)), href: "#/steam", optional: true },
            { id: "challenge", text: "Set a monthly backlog challenge (optional)", done: db.challengeRows(s.userId).some(r => r.month === monthKey(Date.now())), href: "#/library", optional: true },
            { id: "friend", text: "Add a friend's birthday for gift reminders (optional)", done: db.countFriends(s.userId) > 0, href: "#/friends", optional: true },
            { id: "server", text: "Add the bot to a server", done: s.guilds.some(g => (botGuilds ? botGuilds(g.id) : false)), href: "#/servers" }
        ];
    }

    // ---------- API ----------
    const routes = {
        // The extension asks this (no sign-in, nothing sent about the person) to remind its users to update.
        "GET /api/extension/latest": async () => ({ latest: process.env.EXTENSION_LATEST || EXTENSION_LATEST, url: process.env.EXTENSION_STORE_URL || EXTENSION_STORE_URL }),
        // The public Steam ID finder page. No sign-in, so it is rate limited by address; answers are only what the profile already shows.
        "GET /api/steamid": async (req, _b, url) => {
            if (!idFinderLimit.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little and try again in a minute.");
            const q = String(url.searchParams.get("q") ?? "").trim().slice(0, 200);
            if (!q) throw new HttpError(400, "Paste a profile link or name first.");
            const steamid = await resolveProfile(q, steamFetch);
            const card = await profileCard(steamid);
            return { steamid, card: card ? { name: card.name, avatar: card.avatar } : null };
        },
        "GET /api/config": async () => ({
            notice: rt && rt.get("notice_text") ? { text: rt.get("notice_text"), level: rt.get("notice_level") } : null,
            regions: REGIONS, alertTypes: ALERT_TYPES, fanaticalUrl: FANATICAL_GRABBER_URL, tipUrl: SUPPORT_PAGE_URL,
            siteUrl: origin, musicUrl: musicOrigin ? musicOrigin + "/" : origin + "/music",
            help: HELP, about: ABOUT, extension: { latest: process.env.EXTENSION_LATEST || EXTENSION_LATEST },
            privacy: PRIVACY.split("\n").filter(l => !/github\.com/i.test(l)).join("\n"), maxUploadChars: MAX_UPLOAD_CHARS,
            // View Channel + Send Messages + Embed Links, the least the bot needs to post alerts
            userInstallUrl: config.clientId
                ? `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(config.clientId)}&integration_type=1&scope=applications.commands`
                : null,
            inviteUrl: config.clientId
                ? botInviteUrl(config.clientId)
                : null,
            supportUrl: config.mainGuild?.inviteUrl() ?? null
        }),

        "GET /api/topgg": async (req) => {
            const u = session(req);
            if (!topgg?.enabled) return { enabled: false };
            const st = await topgg.status(u.id);
            return { enabled: true, voted: st.voted, nextAt: st.nextAt, votes: st.votes, xp: VOTE_XP, url: `https://top.gg/bot/${encodeURIComponent(config.clientId ?? "")}/vote` };
        },
        "GET /api/me": async (req) => {
            const s = session(req);
            const panel = isOwner(s) ? null : db.getAdminAccess(s.userId);
            const panelInfo = panel ? { kind: panel.kind, edit: panel.edit, areas: PANEL_AREAS.map(a => a.id) } : null;
            if (s.subAdmin) return { user: { id: s.userId, username: s.username, avatar: null }, settings: {}, games: 0, servers: [], isOwner: false, panel: panelInfo, adminOnly: true, steamOnly: false, unread: 0, bugsNew: 0, steam: { linked: false }, setup: [] };
            const u = userRow(s);
            return {
                user: { id: s.userId, username: s.username, avatar: s.avatar },
                settings: publicSettings(u),
                games: db.countItems(s.userId),
                servers: serversFor(s, u),
                isOwner: isOwner(s),
                indieDev: isOwner(s) || isIndieDev(s.userId),
                panel: panelInfo,
                musicUrl: musicOrigin ? musicOrigin + "/" : origin + "/music",
                adminUrl: isOwner(s) || panel ? (adminOrigin ? adminOrigin + "/" : origin + "/admin") : null,
                steamOnly: Boolean(s.steamOnly),
                adminOnly: Boolean(s.adminOnly),
                giveaways: Boolean(giveaways),
                library: db.countLibrary(s.userId),
                unread: db.unreadNotifications(s.userId),
                bugsNew: isOwner(s) ? db.countNewBugs(Number(db.getMeta("bugs_seen") ?? 0)) : 0,
                news: u.seen_version === LATEST ? null : LATEST,
                newsTitle: CHANGELOG[0]?.title ?? null,
                tour: !u.welcomed,
                steam: (l => l ? { linked: true, verified: Boolean(l.verified), synced: Boolean(l.synced_at) } : { linked: false })(db.getSteamLink(s.userId)),
                setup: setupSteps(s, u)
            };
        },

        "POST /api/tour/done": async (req) => { const s = session(req); userRow(s); db.updateUser(s.userId, { welcomed: 1 }); return { ok: true }; },

        "GET /api/notifications": async (req) => {
            const s = session(req); userRow(s);
            return { items: db.listNotifications(s.userId, 80).map(({ extra, ...n }) => {
                let items = null;
                try { items = JSON.parse(extra ?? "null")?.items ?? null; } catch { /* old or damaged row */ }
                return items ? { ...n, items } : n;
            }), unread: db.unreadNotifications(s.userId) };
        },
        "POST /api/notifications/read": async (req) => { const s = session(req); userRow(s); db.readNotifications(s.userId); return { unread: 0 }; },

        "GET /api/commands": async () => remember("commandguide", 3600_000, () => ({ hubs: commandGuide(hubCommands) })),

        "GET /api/changelog": async (req) => {
            const s = session(req); const u = userRow(s);
            db.updateUser(s.userId, { seen_version: LATEST });
            return { entries: CHANGELOG, wasNew: u.seen_version !== LATEST };
        },
        "POST /api/changelog/seen": async (req) => { const s = session(req); userRow(s); db.updateUser(s.userId, { seen_version: LATEST }); return { ok: true }; },

        "POST /api/wishlist/snooze": async (req, body) => {
            const s = session(req);
            const item = db.listItems(s.userId).find(i => i.itad_id === body.itad_id);
            if (!item) throw new HttpError(404, "That game is not on your list.");
            // days 1-90 pauses alerts for that long, 0 turns them back on, and muted keeps this game quiet until it is switched back on.
            const days = Math.min(90, Math.max(0, Math.trunc(Number(body.days ?? 7)) || 0));
            const until = body.muted ? now() + MUTE_DAYS * 86400_000 : days ? now() + days * 86400_000 : null;
            db.snoozeItem(item.id, until);
            return { snoozed_until: until, muted: Boolean(body.muted) };
        },

        // One box that finds your games, library, tickets, pages and (for managers) giveaways.
        "GET /api/search": async (req, _b, url) => {
            const s = session(req); userRow(s);
            const q = String(url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 60);
            if (q.length < 2) return { results: [] };
            const hit = t => String(t).toLowerCase().includes(q);
            const out = [];
            for (const i of db.listItems(s.userId)) if (hit(i.title)) out.push({ kind: "Wishlist", title: i.title, href: "#/wishlist" });
            for (const l of db.listLibrary(s.userId)) if (hit(l.title)) out.push({ kind: "Library", title: l.title, href: "#/library" });
            for (const t of db.listTickets({ userId: s.userId, limit: 50 })) if (hit(t.subject) || `#${t.id}` === q) out.push({ kind: "Ticket", title: `#${t.id} ${t.subject}`, href: `#/support/${t.id}` });
            for (const g of s.guilds) if (hit(g.name)) out.push({ kind: "Server", title: g.name, href: `#/servers/${g.id}` });
            for (const [id, name] of PAGES) if (hit(name)) out.push({ kind: "Page", title: name, href: "#/" + id });
            return { results: out.slice(0, 25) };
        },

        "POST /api/value": async (req, body) => {
            const s = session(req);
            cooldown(s.userId, "value");
            try {
                return await runValue({
                    itad,
                    typed: String(body.titles ?? "").slice(0, 20_000),
                    upload: body.file && typeof body.file === "object" ? { name: String(body.file.name ?? ""), text: String(body.file.text ?? "") } : null,
                    paid: num(body.paid),
                    region: REGIONS.some(r => r.value === body.region) ? body.region : "US",
                    stores: body.stores === "major" ? "major" : "all",
                    sort: String(body.sort ?? "input")
                });
            } catch (err) {
                lastRun.delete(`value:${s.userId}`);
                throw err;
            }
        },

        "GET /api/wishlist": async (req) => {
            const s = session(req);
            const u = userRow(s);
            const { rows, currency } = await viewRows(db, itad, u);
            return { rows, currency, sync: { available: Boolean(u.steam_id), on: u.wish_sync !== 0, at: u.wish_synced_at ?? null } };
        },
        // Keep the Steam wishlist current by itself (only after one import).
        "POST /api/wishlist/sync": async (req, body) => {
            const s = session(req); userRow(s);
            db.updateUser(s.userId, { wish_sync: body.on === false ? 0 : 1 });
            return { on: body.on !== false };
        },

        "POST /api/wishlist/import": async (req, body) => {
            const s = session(req);
            const undo = cooldown(s.userId, "import");
            userRow(s);
            try {
                const r = await importWishlist(await profileOrLinked(s, body.profile), itad);
                return applySteamImport(db, s.userId, r);
            } catch (err) {
                undo();
                throw err;
            }
        },

        "POST /api/wishlist/add": async (req, body) => {
            const s = session(req);
            cooldown(s.userId, "add");
            userRow(s);
            return addGameByTitle(db, itad, s.userId, body.title, body.type, num(body.value), { source: body.watch ? "watch" : "manual" });
        },

        "POST /api/wishlist/remove": async (req, body) => {
            const s = session(req);
            const item = db.listItems(s.userId).find(i => i.itad_id === body.itad_id);
            if (!item) throw new HttpError(404, "That game is not on your list.");
            db.removeItem(s.userId, item.itad_id);
            return { removed: item.title };
        },

        "POST /api/wishlist/cleanup": async (req) => {
            const s = session(req);
            const owned = db.ownedWishlist(s.userId);
            db.removeOwnedWishlist(s.userId);
            return { removed: owned.length, titles: owned.slice(0, 30).map(x => x.title) };
        },

        "POST /api/wishlist/priority": async (req, body) => {
            const s = session(req);
            if (!db.setPriority(s.userId, String(body.itad_id), body.starred !== false)) throw new HttpError(404, "That game is not on your list.");
            return { starred: body.starred !== false };
        },

        "POST /api/wishlist/alert": async (req, body) => {
            const s = session(req);
            let trig;
            try { trig = parseTrigger(body.type, num(body.value)); } catch (e) { throw new HttpError(400, e.message); }
            const label = describeTrigger({ trigger_type: trig.type, trigger_value: trig.value });
            if (body.itad_id) {
                const item = db.listItems(s.userId).find(i => i.itad_id === body.itad_id);
                if (!item) throw new HttpError(404, "That game is not on your list.");
                db.setTrigger(s.userId, trig.type, trig.value, item.itad_id);
                return { updated: 1, label };
            }
            return { updated: db.setTrigger(s.userId, trig.type, trig.value), label };
        },

        "POST /api/settings": async (req, body) => {
            const s = session(req);
            const u = userRow(s);
            const patch = {};
            if (body.region !== undefined) {
                if (!REGIONS.some(r => r.value === body.region)) throw new HttpError(400, "Unknown region.");
                patch.region = body.region;
            }
            if (body.stores !== undefined) {
                if (!["major", "all"].includes(body.stores)) throw new HttpError(400, "Unknown store setting.");
                patch.stores = body.stores;
            }
            if (body.paused !== undefined) patch.paused = body.paused ? 1 : 0;
            if (body.guild_id !== undefined) {
                if (body.guild_id !== null && !s.guilds.some(g => g.id === body.guild_id)) throw new HttpError(400, "You are not in that server.");
                patch.guild_id = body.guild_id;
            }
            const nextGuild = patch.guild_id !== undefined ? patch.guild_id : u.guild_id;
            const nextDelivery = body.delivery ?? u.delivery;
            if (!["dm", "channel"].includes(nextDelivery)) throw new HttpError(400, "Unknown delivery mode.");
            if (nextDelivery === "channel" && !db.getGuild(nextGuild)) {
                throw new HttpError(400, "Pick a server that has an alert channel first. A server admin can set one on the Servers page.");
            }
            patch.delivery = nextDelivery;
            const prefInput = Object.fromEntries(["quiet_start", "quiet_end", "tz", "digest", "digest_day", "bundles", "share", "free", "free_dlc", "dlc", "refund", "milestones", "yearly", "nudge", "achv", "nowplaying", "playtest", "playtest_skip", "news", "min_discount", "max_price", "lows_only", "muted", "lang"].filter(k => body[k] !== undefined).map(k => [k, body[k]]));
            Object.assign(patch, prefsPatch(prefInput, u));
            db.updateUser(s.userId, patch);
            return { settings: publicSettings(db.getUser(s.userId)) };
        },


        // ----- game codes (SHiFT and the like) -----
        "GET /api/codes": async (req, _b, url) => {
            session(req);
            const game = url.searchParams.get("game") || null;
            const wanted = game ? expandGames([game]) : null; // the Borderlands entry stands for all six
            if (wanted && !wanted.every(k => codeGames().some(g => g.key === k))) throw new HttpError(400, "Unknown game.");
            const status = url.searchParams.get("status") === "expired" ? "expired" : "active";
            const at = now();
            db.expireDue(at); // anything that ended since the last poll should not show as working
            return { games: codeGames(), families: codeFamilies(), status, codes: db.listCodes({ status, game: wanted, limit: 100 }).map(c => codeView(c, at)), counts: db.codeCounts() };
        },
        "GET /api/bundlefeed": async (req, _b, url) => {
            session(req);
            const store = url.searchParams.get("store") || null;
            if (store && !BUNDLE_STORES[store]) throw new HttpError(400, "Unknown store.");
            const status = url.searchParams.get("status") === "expired" ? "expired" : "active";
            db.expireDueBundles(now()); // anything that ended since the last poll should not show as live
            return { status, stores: Object.entries(BUNDLE_STORES).map(([key, v]) => ({ key, name: v.name })), bundles: db.listFeedBundles({ status, stores: store ? [store] : null, limit: 100 }).map(bundleFeedView), counts: db.bundleFeedCounts() };
        },
        "GET /api/servers/bundles": async (req, _b, url) => {
            const s = session(req);
            const g = s.guilds.find(x => x.id === url.searchParams.get("guild"));
            if (!g || !isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            let channels, roles = [];
            try { channels = await rest.listChannels(g.id); roles = await Promise.resolve(rest.listRoles?.(g.id) ?? []).catch(() => []); }
            catch (err) {
                if (err instanceof DiscordApiError && [403, 404].includes(err.status)) throw new HttpError(400, "The bot is not in that server yet. Invite it first.");
                throw err;
            }
            const settings = db.getBundleFeedSettings(g.id);
            return { settings, channels, roles, stores: Object.entries(BUNDLE_STORES).map(([key, v]) => ({ key, name: v.name })), latest: db.listFeedBundles({ status: "active", stores: settings.stores, limit: 6, adult: settings.adult }).map(bundleFeedView) };
        },
        "POST /api/servers/bundles": async (req, body) => {
            const s = session(req);
            const g = s.guilds.find(x => x.id === body.guild_id);
            if (!g || !isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            const patch = {};
            if (body.channel_id !== undefined) {
                if (body.channel_id) {
                    let channels;
                    try { channels = await rest.listChannels(g.id); }
                    catch (err) {
                        if (err instanceof DiscordApiError && [403, 404].includes(err.status)) throw new HttpError(400, "The bot is not in that server yet. Invite it first.");
                        throw err;
                    }
                    const channel = channels.find(c => c.id === body.channel_id);
                    if (!channel) throw new HttpError(400, "Pick a text channel from the list.");
                    if (channel.id !== db.getBundleFeedSettings(g.id).channel_id) {
                        try { await rest.sendMessage(channel.id, { content: `Game bundles will be posted in this channel (set from the dashboard by <@${s.userId}>).`, allowed_mentions: { parse: [] } }); }
                        catch { throw new HttpError(400, `I cannot post in #${channel.name}. Give the bot View Channel, Send Messages and Embed Links there, then try again.`); }
                    }
                }
                patch.channel_id = body.channel_id || null;
            }
            if (body.role_id !== undefined) {
                if (body.role_id) {
                    const roles = await Promise.resolve(rest.listRoles?.(g.id) ?? []).catch(() => []);
                    if (!roles.some(r => r.id === body.role_id)) throw new HttpError(400, "Pick a role from the list.");
                }
                patch.role_id = body.role_id || null;
            }
            if (body.stores !== undefined) patch.stores = body.stores;
            if (body.adult !== undefined) patch.adult = body.adult;
            let settings;
            try { settings = applyBundleFeedSettings(db, g.id, patch); } catch (err) { throw new HttpError(400, err.message); }
            if (patch.channel_id) bundleFeed?.poll?.().catch(() => {}); // post what is current right away
            return { settings };
        },
        "POST /api/admin/bundles/poll": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!bundleFeed?.poll) throw new HttpError(400, "The bundle poll is not running on this bot.");
            const r = await bundleFeed.poll({ deep: true });
            return { result: r ?? { skipped: true } };
        },
        "GET /api/servers/codes": async (req, _b, url) => {
            const s = session(req);
            const g = s.guilds.find(x => x.id === url.searchParams.get("guild"));
            if (!g || !isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            let channels, roles = [];
            try { channels = await rest.listChannels(g.id); roles = await Promise.resolve(rest.listRoles?.(g.id) ?? []).catch(() => []); }
            catch (err) {
                if (err instanceof DiscordApiError && [403, 404].includes(err.status)) throw new HttpError(400, "The bot is not in that server yet. Invite it first.");
                throw err;
            }
            return { settings: db.getCodeSettings(g.id), channels, roles, games: codeGames(), families: codeFamilies() };
        },
        "POST /api/servers/codes": async (req, body) => {
            const s = session(req);
            const g = s.guilds.find(x => x.id === body.guild_id);
            if (!g || !isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            const patch = {};
            if (body.channel_id !== undefined) {
                if (body.channel_id) {
                    let channels;
                    try { channels = await rest.listChannels(g.id); }
                    catch (err) {
                        if (err instanceof DiscordApiError && [403, 404].includes(err.status)) throw new HttpError(400, "The bot is not in that server yet. Invite it first.");
                        throw err;
                    }
                    const channel = channels.find(c => c.id === body.channel_id);
                    if (!channel) throw new HttpError(400, "Pick a text channel from the list.");
                    if (channel.id !== db.getCodeSettings(g.id).channel_id) {
                        try { await rest.sendMessage(channel.id, { content: `Game codes will be posted in this channel (set from the dashboard by <@${s.userId}>).`, allowed_mentions: { parse: [] } }); }
                        catch { throw new HttpError(400, `I cannot post in #${channel.name}. Give the bot View Channel, Send Messages and Embed Links there, then try again.`); }
                    }
                }
                patch.channel_id = body.channel_id || null;
            }
            if (body.role_id !== undefined) {
                if (body.role_id) {
                    const roles = await Promise.resolve(rest.listRoles?.(g.id) ?? []).catch(() => []);
                    if (!roles.some(r => r.id === body.role_id)) throw new HttpError(400, "Pick a role from the list.");
                }
                patch.role_id = body.role_id || null;
            }
            if (body.games !== undefined) patch.games = body.games;
            let settings;
            try { settings = applyCodeSettings(db, g.id, patch); } catch (err) { throw new HttpError(400, err.message); }
            if (patch.channel_id) codes?.poll?.().catch(() => {}); // post what is current right away
            return { settings };
        },
        "POST /api/codes/retire": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            const c = db.getCode(Number(body.id));
            if (!c) throw new HttpError(404, "No such code.");
            db.setCodeStatus(c.id, "expired");
            codes?.poll?.().catch(() => {}); // edits the posts to show it ended
            return { id: c.id, status: "expired" };
        },
        "POST /api/admin/codes/poll": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!codes?.poll) throw new HttpError(400, "The code poll is not running on this bot.");
            const r = await codes.poll();
            return { result: r ?? { skipped: true } };
        },


        // ----- music (SoundCloud in voice channels) -----
        "GET /api/music": async (req, _b, url) => {
            const s = session(req);
            if (!music) throw new HttpError(503, "Music isn't available on this bot right now.");
            const gid = url.searchParams.get("guild");
            if (!gid) {
                // the servers this person is in where the bot is too
                return { guilds: s.guilds.filter(g => !isHidden(g.id) && botGuilds?.(g.id)).map(g => ({ id: g.id, name: g.name, icon: g.icon, manager: isManager(g), active: music.status(g.id).active })) };
            }
            const g = musicMember(s, gid);
            await musicGuild?.(gid)?.warm?.(s.userId);
            const { autodj_playlist: _skip, last_radio: lastRadio, ...settings } = db.getMusicSettings(gid);
            const subs = db.listSubmissions(gid);
            const names = Object.fromEntries(await Promise.all([...new Set(subs.slice(0, 50).map(r => r.user_id))].map(async id => [id, (await remember("name:" + g.id + ":" + id, 10 * 60_000, () => rest.memberName(g.id, id)).catch(() => null)) || "Member " + id.slice(-4)])));
            const out = {
                guild: { id: g.id, name: g.name }, settings, status: music.status(gid), access: { ...music.access(gid, s.userId), isBotOwner: isOwner(s), canStream: await mayStream(s, g) }, playlists: db.listPlaylists(s.userId).map(p => ({ name: p.name, count: p.tracks.length })),
                autodj: { playlist: db.getAutoPlaylist(gid).slice(0, 100), count: db.getAutoPlaylist(gid).length, lastStation: (() => { try { return lastRadio ? JSON.parse(lastRadio).title ?? null : null; } catch { return null; } })() },
                submissions: subs.slice(0, 50).map(r => ({ id: r.id, userId: r.user_id, name: names[r.user_id], title: r.title, artist: r.artist, url: r.url, thumb: r.thumb, duration: r.duration, mine: r.user_id === s.userId }))
            };
            if (isManager(g)) { const c = await remember("choices:" + gid, 60_000, () => guildChoices(gid)); out.channels = c.channels; out.roles = c.roles; out.voiceChannels = await remember("voice:" + gid, 60_000, () => Promise.resolve(rest.listVoiceChannels?.(gid) ?? [])).catch(() => []); }
            return out;
        },
        // ----- the chat beside the player: in memory, one room per server, plain text only -----
        "GET /api/music/chat": async (req, _b, url) => {
            const s = session(req);
            const g = musicMember(s, url.searchParams.get("guild"));
            return chat.poll(g.id, { id: s.userId, name: s.username, avatar: s.avatar }, Number(url.searchParams.get("since")) || 0);
        },
        "POST /api/music/chat": async (req, body) => {
            const s = session(req);
            const g = musicMember(s, body.guild_id);
            const who = { id: s.userId, name: s.username, avatar: s.avatar };
            const r = body.react ? chat.react(g.id, who, String(body.react)) : chat.say(g.id, who, body.text);
            if (r.error) throw new HttpError(r.wait ? 429 : 400, r.error);
            return { message: r.msg };
        },
        "POST /api/music/chat/delete": async (req, body) => {
            const s = session(req);
            const g = musicMember(s, body.guild_id);
            const a = music.access(g.id, s.userId), mod = Boolean(a.dj || a.isManager || isOwner(s));
            if (body.clear) { if (!mod) throw new HttpError(403, "Only DJs, moderators and managers can clear the chat."); chat.clear(g.id); return { ok: true }; }
            if (!chat.remove(g.id, body.id, { by: s.userId, mod })) throw new HttpError(403, "You can only remove your own messages.");
            return { ok: true };
        },
        // ----- supporter passes -----
        "GET /api/supporter": async (req) => {
            const s = session(req), until = supporterUntil(db, s.userId);
            return { enabled: Boolean(square?.enabled), plans: PLANS, until: until > now() ? until : null, boost: SUPPORTER_XP_BOOST, founder: isFounder(db, s.userId), wall: wallName(db, s.userId), alert_color: alertColorHex(db, s.userId), founding_left: Math.max(0, FOUNDERS_MAX - foundersTaken(db)) };
        },
        "GET /api/public/supporters": async () => ({ wall: supporters ? supporters.wall() : [] }),
        "POST /api/supporter/wall": async (req, body) => {
            const s = session(req);
            if (!supporters) throw new HttpError(404, "Not found.");
            if (!isSupporter(db, s.userId, now()) && !isFounder(db, s.userId)) throw new HttpError(403, "The wall is for supporters.");
            return { wall: supporters.setWall(s.userId, body.on === false ? "" : body.name) };
        },
        "POST /api/supporter/alertcolor": async (req, body) => {
            const s = session(req);
            if (!supporters) throw new HttpError(404, "Not found.");
            if (!isSupporter(db, s.userId, now()) && !isFounder(db, s.userId)) throw new HttpError(403, "Alert colors are a supporter perk.");
            try { return { alert_color: supporters.setAlertColor(s.userId, body.color) }; } catch (e) { throw new HttpError(400, e.message); }
        },
        "POST /api/supporter/checkout": async (req, body) => {
            const s = session(req);
            if (!square?.enabled) throw new HttpError(404, "Supporter passes aren't switched on yet.");
            if (!checkoutLimit.hit("u" + s.userId).ok) throw new HttpError(429, "Slow down a little.");
            let target = s.userId, giftFrom = null;
            const to = String(body.gift_to ?? "").trim().replace(/^@/, "").toLowerCase();
            if (to) {
                const hit = /^\d{5,25}$/.test(to) ? db.getUser(to) : db.getProfileBySlug(to);
                if (!hit) throw new HttpError(404, "I couldn't find anyone by that page name or ID. They need to have used the bot or turned on their profile page.");
                if (hit.discord_id === s.userId) throw new HttpError(400, "That's you. Use the normal buttons to buy a pass for yourself.");
                target = hit.discord_id; giftFrom = s.userId;
            }
            try { return { url: await square.checkout({ userId: target, planId: String(body.plan ?? ""), redirectUrl: `${origin}/#/tip?thanks=${giftFrom ? "gift" : "1"}`, giftFrom }) }; }
            catch (e) { log(`[square] ${e.message}`); throw new HttpError(400, /Pick one|Sign in|switched on/.test(e.message) ? e.message : "Couldn't open the checkout page. Try again in a minute."); }
        },
        "GET /api/admin/supporters": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            return { enabled: Boolean(square?.enabled), active: supporters ? supporters.list() : [], everyone: supporters ? supporters.everyone() : [], payments: readEvents(db, "adminlog:square", 20), recent: supporters ? supporters.recent() : [], revenue: supporters ? supporters.revenue() : null, home: supporters ? await supporters.homeStatus() : null, plans: PLANS };
        },
        // Full edit of one supporter: pass end date, add or take away days, end it, founding mark, wall name, resend the role.
        "POST /api/admin/supporters/edit": async (req, body) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            if (!supporters) throw new HttpError(404, "Not found.");
            const id = String(body.id ?? "").trim();
            if (!/^\d{5,25}$/.test(id)) throw new HttpError(400, "That doesn't look like a Discord ID.");
            switch (body.action) {
                case "set_until": {
                    const ms = endOfDayEastern(body.date);
                    if (ms === null) throw new HttpError(400, "Pick a date.");
                    if (ms - Date.now() > 3660 * 86_400_000) throw new HttpError(400, "That's more than ten years out.");
                    return await supporters.setUntil(id, ms);
                }
                case "add_days": {
                    const d = Math.round(Number(body.days));
                    if (!Number.isFinite(d) || d === 0 || Math.abs(d) > 3660) throw new HttpError(400, "Pick a number of days between -3660 and 3660.");
                    return await supporters.addDays(id, d);
                }
                case "remove": return await supporters.remove(id);
                case "founder": return { founder: supporters.setFounder(id, body.on !== false) };
                case "wall": return { wall: supporters.setWall(id, body.name) };
                case "resync": return { role: (await supporters.setUntil(id, supporterUntil(db, id) || 0, "Role re-sent")).role };
                default: throw new HttpError(400, "Unknown action.");
            }
        },
        "GET /api/admin/supporters.csv": async (req, _b, url) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
            const rows = (supporters ? supporters.everyone() : []).map(r => [r.id, r.active ? "active" : "ended", r.until ? new Date(r.until).toISOString() : "", r.founder ? "yes" : "", r.wall].map(q).join(","));
            return { csv: ["discord_id,status,pass_ends,founder,wall_name", ...rows].join("\n") };
        },
        // One glance at what needs the owner: new reports, failing jobs, a full disk, a payment or role problem.
        "GET /api/admin/attention": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            const items = [];
            const add = (level, text, href) => items.push({ level, text, href });
            const newBugs = db.countNewBugs(Number(db.getMeta("bugs_seen") ?? 0));
            if (newBugs) add("warn", `${newBugs} new bug report${newBugs === 1 ? "" : "s"}`, "#/bugs");
            const prof = db.listProfileReports();
            if (prof.length) add("warn", `${prof.length} reported profile${prof.length === 1 ? "" : "s"} to look at`, "#/profiles");
            const gifts = db.listGiftReports?.() ?? [];
            if (gifts.length) add("warn", `${gifts.length} reported gift mark${gifts.length === 1 ? "" : "s"}`, "#/gifts");
            const posts = db.listReports?.() ?? [];
            if (posts.length) add("warn", `${posts.length} reported post${posts.length === 1 ? "" : "s"}`, "#/social");
            try {
                const waiting = db.pendingClaims({ limit: 200 });
                if (waiting.length) {
                    const soon = waiting.filter(k => (k.deadline ?? Infinity) - now() < 6 * 3600_000);
                    add(soon.length ? "warn" : "info", `${waiting.length} giveaway prize${waiting.length === 1 ? " is" : "s are"} waiting for the winner to claim${soon.length ? `, ${soon.length} with under 6 hours left` : ""}`, "#/giveaway");
                }
            } catch { /* the giveaway tables may not exist on an old copy */ }
            const failing = ops ? Object.entries(ops.snapshot()?.jobs ?? {}).filter(([, j]) => j.lastError) : [];
            if (failing.length) add("bad", `${failing.length} background job${failing.length === 1 ? " is" : "s are"} failing: ${failing.slice(0, 3).map(([n]) => n).join(", ")}`, "#/system");
            try { const st = storage ? await storage() : null; if (st?.volume?.pct >= 80) add(st.volume.pct >= 90 ? "bad" : "warn", `The disk is ${st.volume.pct}% full`, "#/system"); } catch { /* skip */ }
            if (supporters) { try { const h = await supporters.homeStatus(); if (!h.ok) add("warn", "The Supporter role can't be given right now", "#/supporters"); } catch { /* skip */ } }
            if (health && !health()) add("bad", "The bot isn't connected to Discord", "#/system");
            return { items };
        },
        "POST /api/admin/supporters/resync": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            if (!supporters) throw new HttpError(404, "Not found.");
            return await supporters.resync();
        },
        "POST /api/admin/supporters/grant": async (req, body) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            const id = String(body.user_id ?? "").trim();
            if (!/^\d{5,25}$/.test(id)) throw new HttpError(400, "Paste the person's Discord ID (digits only).");
            const days = Number(body.days);
            if (!supporters || !Number.isFinite(days) || days < 1 || days > 3660) throw new HttpError(400, "Pick between 1 and 3660 days.");
            const r = await supporters.grant(id, days, "manual:" + randomUUID(), "Owner");
            return { until: r.until, role: r.role };
        },
        // ----- overlay studio: goal bars, server stats and timers, each with its own link and look -----
        "GET /api/overlays": async (req) => {
            const s = session(req);
            const guilds = (await Promise.all(s.guilds.filter(g => botGuilds?.(g.id)).map(async g => (await mayStream(s, g)) ? { id: g.id, name: g.name } : null))).filter(Boolean);
            return { overlays: db.listOvs(s.userId).map(o => ({ token: o.token, kind: o.kind, name: o.name, guild_id: o.guild_id, value: o.value, config: o.config, url: `${origin}/ov?token=${o.token}`, seen: ovSeen.has(o.token) ? now() - ovSeen.get(o.token) : null })), kinds: OVERLAY_KINDS, fonts: OVERLAY_FONTS, guilds };
        },
        "POST /api/overlays": async (req, body) => {
            const s = session(req), action = String(body.action ?? "");
            const guildId = body.guild_id ? String((await streamAccess(s, body.guild_id)).id) : null;
            const wants = (kind, cfg) => kind === "stats" || kind === "alerts" || kind === "board" || kind === "playing" || kind === "poll" || (kind === "goal" && ["members", "boosts"].includes(cfg?.source));
            try {
                if (action === "create") {
                    if (!OVERLAY_KINDS.includes(body.kind)) throw new HttpError(400, "Pick an overlay type.");
                    if (wants(body.kind, body.config) && !guildId) throw new HttpError(400, "Pick a server for this overlay.");
                    return { token: db.createOv(s.userId, body.kind, { name: body.name, guildId, config: body.config, max: isSupporter(db, s.userId, now()) ? MAX_SUPPORTER_OVERLAYS : undefined }) };
                }
                const mine = db.ovById(s.userId, String(body.token ?? ""));
                if (!mine) throw new HttpError(404, "That overlay doesn't exist any more.");
                if (action === "save") {
                    const cfg = body.config ?? mine.config;
                    if (wants(mine.kind, cfg) && !(guildId ?? mine.guild_id)) throw new HttpError(400, "Pick a server for this overlay.");
                    db.updateOv(s.userId, mine.token, { name: body.name, guildId: body.guild_id === undefined ? undefined : guildId, config: body.config ? { ...body.config, pollId: body.config.pollId ?? mine.config.pollId } : body.config, value: body.value });
                    return { ok: true };
                }
                if (action === "bump") { db.updateOv(s.userId, mine.token, { value: Math.max(0, Number(mine.value) + Math.max(-1_000_000, Math.min(1_000_000, Number(body.by) || 0))) }); return { value: db.ovById(s.userId, mine.token).value }; }
                if (action === "test") {
                    if (mine.kind !== "alerts") throw new HttpError(400, "Only an alerts overlay has test alerts.");
                    const list = ovTest.get(mine.token) ?? []; list.push({ seq: nextSeq(), type: ["join", "boost"][list.length % 2], count: 1281 + list.length, by: 1, name: "Test Member", avatar: null, at: now(), test: true });
                    ovTest.set(mine.token, list.slice(-5));
                    return { ok: true, seen: ovSeen.has(mine.token) ? now() - ovSeen.get(mine.token) : null };
                }
                if (action === "poll") {
                    if (mine.kind !== "poll" || !mine.guild_id) throw new HttpError(400, "Pick a server for this poll first.");
                    const question = String(body.question ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
                    const options = (Array.isArray(body.options) ? body.options : []).map(x => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, 60)).filter(Boolean).slice(0, 5);
                    const minutes = [1, 2, 5, 10, 30, 60].includes(Number(body.minutes)) ? Number(body.minutes) : 5;
                    if (!question) throw new HttpError(400, "Write the question first.");
                    if (options.length < 2) throw new HttpError(400, "Give at least two options.");
                    const channels = await rest.listChannels(mine.guild_id).catch(() => { throw new HttpError(400, "The bot can't see that server right now."); });
                    if (!channels.some(c => String(c.id) === String(body.channel_id))) throw new HttpError(400, "Pick a channel to post the poll in.");
                    const state = { question, options: options.map(title => ({ title })), votes: {}, chat: true, until: now() + minutes * 60_000 };
                    let sent; try { sent = await rest.sendMessage(String(body.channel_id), { embeds: [pollEmbed(state, now())], components: pollButtons(state.options), allowed_mentions: { parse: [] } }); } catch { throw new HttpError(400, "I couldn't post there. Check that the bot can send messages in that channel."); }
                    if (!sent?.id) throw new HttpError(400, "I couldn't post there.");
                    db.setMeta(`poll:${sent.id}`, JSON.stringify(state));
                    db.setMeta(`pollch:${String(body.channel_id)}`, String(sent.id));
                    try { db.prunePolls(); } catch { /* old votes can wait */ }
                    db.updateOv(s.userId, mine.token, { config: { ...mine.config, pollId: String(sent.id) } });
                    ovPolls.set(mine.token, { channel: String(body.channel_id), id: String(sent.id) });
                    return { ok: true, pollId: String(sent.id) };
                }
                if (action === "endpoll") {
                    const st = mine.config.pollId ? JSON.parse(db.getMeta(`poll:${mine.config.pollId}`) || "null") : null;
                    if (st) { st.until = now() - 1; db.setMeta(`poll:${mine.config.pollId}`, JSON.stringify(st)); const at = ovPolls.get(mine.token); if (at && at.id === mine.config.pollId) { try { await rest.editMessage?.(at.channel, at.id, { embeds: [pollEmbed(st, now())], components: pollButtons(st.options, false) }); } catch { /* the next click closes it anyway */ } } }
                    return { ok: true };
                }
                if (action === "reset") return { token: db.resetOvToken(s.userId, mine.token) };
                if (action === "delete") { db.removeOv(s.userId, mine.token); return { ok: true }; }
            } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, e.message || "That didn't work."); }
            throw new HttpError(400, "Unknown action.");
        },
        "GET /api/overlays/channels": async (req, _b, url) => {
            const s = session(req);
            await streamAccess(s, String(url.searchParams.get("guild") ?? ""));
            try { return { channels: await rest.listChannels(String(url.searchParams.get("guild"))) }; } catch { throw new HttpError(400, "The bot can't see that server right now."); }
        },
        // What the OBS page asks for every few seconds. Only the chosen look and the numbers on screen, nothing about the owner.
        "GET /api/ov/data": async (req, _b, url) => {
            if (!overlayLimit.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little.");
            const o = db.ovByToken(String(url.searchParams.get("token") ?? ""));
            if (!o) throw new HttpError(404, "This overlay link isn't valid. Make a new one on the Overlay studio page.");
            ovSeen.set(o.token, now());
            const p = await overlayPayload(o);
            if (o.kind === "alerts") {
                const since = url.searchParams.has("since") ? Number(url.searchParams.get("since")) : NaN;
                const f = feedFor(o.guild_id, p.g), mine = ovTest.get(o.token) ?? [];
                const all = [...f.ev, ...mine].sort((a, b) => a.seq - b.seq);
                const events = Number.isFinite(since) && since >= 0 ? all.filter(e => e.seq > since && (e.type !== "join" || o.config.showJoins) && (e.type !== "boost" || o.config.showBoosts)).slice(-8).map(({ seq, type, count, by, name, avatar }) => ({ seq, type, count: count ?? (type === "join" ? p.g?.members : p.g?.boosts) ?? null, by, ...(o.config.showNames && name ? { name, avatar } : {}) })) : [];
                ovTest.set(o.token, mine.filter(e => now() - e.at < 60_000));
                return { kind: o.kind, name: o.name, config: o.config, data: { seq: currentSeq(), events }, now: now() };
            }
            if (o.kind === "scene") {
                const kids = await Promise.all(o.config.items.map(t => db.ovByToken(t)).filter(k => k && k.user_id === o.user_id && SCENE_KINDS.includes(k.kind)).map(async k => { const q = await overlayPayload(k); return { kind: q.kind, name: q.name, config: q.config, data: q.data }; }));
                return { kind: o.kind, name: o.name, config: o.config, data: { children: kids }, now: now() };
            }
            return { kind: o.kind, name: o.name, config: o.config, data: p.data, now: now() };
        },
        // The OBS overlay link for a server. Only people with Manage Server can see or change it.
        "GET /api/music/overlay": async (req, _b, url) => {
            const s = session(req), g = await streamAccess(s, url.searchParams.get("guild"));
            const o = db.getOverlay(g.id, s.userId);
            return { on: Boolean(o), token: o?.token ?? null, base: musicOrigin ? musicOrigin + "/overlay" : origin + "/overlay" };
        },
        "POST /api/music/overlay": async (req, body) => {
            const s = session(req), g = await streamAccess(s, body.guild_id);
            if (body.action === "remove") { db.removeOverlay(g.id, s.userId); return { on: false, token: null }; }
            if (body.action !== "create" && body.action !== "reset") throw new HttpError(400, "Unknown action.");
            return { on: true, token: db.resetOverlay(g.id, s.userId, isOwner(s) ? "owner" : isManager(g) ? "manager" : "role") };
        },
        // ----- going live: the streamer role, the live channel and the opt-in ping -----
        "GET /api/streams": async (req, _b, url) => {
            const s = session(req); const g = musicMember(s, url.searchParams.get("guild"));
            const c = db.getCommunity(g.id), mgr = isManager(g) || isOwner(s), roleIds = mgr ? [] : await rolesIn(g.id, s.userId);
            const out = {
                guild: { id: g.id, name: g.name }, me: s.userId,
                settings: { streamer_role_id: c.streamer_role_id, live_channel: c.live_channel, ping_stream: c.ping_stream, auto: c.stream_auto !== 0 },
                live: db.listStreamLive(g.id).map(r => ({ userId: r.user_id, title: r.title, url: r.url, game: r.game, since: r.started, mine: r.user_id === s.userId })),
                can: { go: canStreamIn(c, { roleIds, isManager: isManager(g), isBotOwner: isOwner(s) }), manage: mgr },
                optedIn: streams ? await streams.optedIn(g.id, s.userId) : null,
                links: db.getStreamLinks(g.id, s.userId).map(l => ({ platform: l.platform, handle: l.handle, url: channelUrl(l.platform, l.handle) })),
                link: (l => (l ? { platform: l.platform, handle: l.handle, url: channelUrl(l.platform, l.handle) } : null))(db.getStreamLink(g.id, s.userId)),
                watch: watchable(process.env),
                chatReplies: Boolean(twitchReply), stepKinds: Object.entries(STEP_KINDS).map(([id, k]) => ({ id, label: k.label, hint: k.hint }))
            };
            if (mgr) { const ch = await remember("choices:" + g.id, 60_000, () => guildChoices(g.id)); out.channels = ch.channels; out.roles = ch.roles; }
            return out;
        },
        "POST /api/streams/live": async (req, body) => {
            const s = session(req); const g = await streamAccess(s, body.guild_id);
            if (!streams) throw new HttpError(503, "Streams aren't available on this bot right now.");
            cooldown(s.userId, "streamlive");
            const me = (await remember("mname:" + g.id + ":" + s.userId, 10 * 60_000, () => rest.memberName(g.id, s.userId)).catch(() => null)) || s.username || "Someone";
            return musicCall(() => streams.goLive(g.id, { id: s.userId, name: me, avatarUrl: null }, { title: body.title, url: body.url, game: body.game }));
        },
        // A giveaway for the viewers of this stream: one key, drawn when the stream ends.
        "POST /api/streams/giveaway": async (req, body) => {
            const s = session(req); const g = await streamAccess(s, body.guild_id);
            if (!streamGw.enabled()) throw new HttpError(503, "Giveaways aren't set up on this bot.");
            cooldown(s.userId, "streamgw");
            const me = (await remember("mname:" + g.id + ":" + s.userId, 10 * 60_000, () => rest.memberName(g.id, s.userId)).catch(() => null)) || s.username || "Someone";
            // The full form sends `keys` (a list of prizes) and every option; the short one sends a single `key`.
            if (body.keys === undefined) {
                const r = await musicCall(() => streamGw.start(g.id, { id: s.userId, name: me }, { game: body.game, key: body.key, minutes: body.minutes }));
                return { ok: true, channelId: r.channelId, endsAt: r.endsAt, endsWithStream: true, prizes: 1 };
            }
            const form = { ...body };
            if (!(isManager(g) || isOwner(s))) for (const k of ["require_role_id", "require_role_ids", "require_all", "bonus_role_id", "bonus_role_ids", "override_role_id", "override_role_ids", "ping_role_id", "vouch_channel_id"]) delete form[k]; // server rules are the managers' call
            const r = await musicCall(async () => {
                const { input } = giveawayInput(form, { defaults: { length: "1h", prize: "Prize" } });
                // Chat entry: viewers type !enter in the streamer's Twitch chat. Needs their Twitch channel linked here, and a Discord invite to point newcomers at.
                let chat = null;
                if (body.chat_enter) {
                    if (!db.getStreamLink(g.id, s.userId, "twitch")) throw new UserError("Link your Twitch channel first (the Your channel box above), so I know which chat to listen to.");
                    let invite = null;
                    if (String(body.chat_invite ?? "").trim()) { try { invite = parseSteps([{ kind: "join_discord", url: body.chat_invite }])[0].url; } catch (e) { if (e instanceof StepError) throw new UserError("The Discord link for chat must be an invite, like https://discord.gg/yourserver."); throw e; } }
                    chat = { invite };
                }
                return streamGw.start(g.id, { id: s.userId, name: me }, { input, endWithStream: body.end_with_stream !== false, chat });
            });
            return { ok: true, channelId: r.channelId, endsAt: r.endsAt, endsWithStream: r.endsWithStream, prizes: r.prizes, chat: r.chat, chatReplies: Boolean(twitchReply) };
        },
        // everyone linked in a server, with who is live right now (any member may look: it is only public channel names)
        "GET /api/streams/roster": async (req, _b, url) => {
            const s = session(req); const g = musicMember(s, url.searchParams.get("guild"));
            const live = new Map(db.listStreamLive(g.id).map(r => [r.user_id, r]));
            const watch = watchable(process.env);
            const people = (await Promise.all([...new Map(db.listStreamLinks(g.id).map(l => [l.user_id, l])).values()].map(async l => { // one card per person, however many channels they linked
                const m = await remember("smem:" + g.id + ":" + l.user_id, 10 * 60_000, () => rest.getMember(g.id, l.user_id)).catch(() => undefined);
                if (m === null) return null; // left the server
                const u = m?.user ?? {};
                const avatar = m?.avatar ? `https://cdn.discordapp.com/guilds/${g.id}/users/${l.user_id}/avatars/${m.avatar}.png?size=96` : u.avatar ? `https://cdn.discordapp.com/avatars/${l.user_id}/${u.avatar}.png?size=96` : null;
                const row = live.get(l.user_id);
                return { userId: l.user_id, name: m?.nick || u.global_name || u.username || "Streamer", avatar, platform: l.platform, handle: l.handle, url: channelUrl(l.platform, l.handle).replace(/\/live$/, ""), checked: Boolean(watch[l.platform]), mine: l.user_id === s.userId,
                    channels: db.getStreamLinks(g.id, l.user_id).map(x => ({ platform: x.platform, handle: x.handle, url: channelUrl(x.platform, x.handle).replace(/\/live$/, ""), checked: Boolean(watch[x.platform]) })),
                    live: row ? { title: row.title, game: row.game, url: row.url, since: row.started, also: row.also ?? [] } : null };
            }))).filter(Boolean);
            people.sort((a, b) => Number(Boolean(b.live)) - Number(Boolean(a.live)) || a.name.localeCompare(b.name));
            return { guild: { id: g.id, name: g.name }, people, liveChannel: db.getCommunity(g.id).live_channel ? true : false, now: now() };
        },
        "POST /api/streams/link": async (req, body) => {
            const s = session(req); const g = await streamAccess(s, body.guild_id);
            cooldown(s.userId, "streamlink");
            if (!db.getCommunity(g.id).live_channel) throw new HttpError(400, "This server has no live channel yet. A manager can pick one below.");
            let ch; try { ch = parseChannel(body.channel); } catch (e) { throw new HttpError(400, e.message); }
            db.setStreamLink(g.id, s.userId, { platform: ch.platform, handle: ch.handle, via: isOwner(s) ? "owner" : isManager(g) ? "manager" : "role", added: now() });
            return { link: { platform: ch.platform, handle: ch.handle, url: channelUrl(ch.platform, ch.handle) }, links: db.getStreamLinks(g.id, s.userId).map(l => ({ platform: l.platform, handle: l.handle, url: channelUrl(l.platform, l.handle) })), watch: watchable(process.env) };
        },
        "POST /api/streams/unlink": async (req, body) => {
            const s = session(req); const g = musicMember(s, body.guild_id);
            const site = ["twitch", "kick", "youtube"].includes(body.platform) ? body.platform : null;
            db.removeStreamLink(g.id, s.userId, site);
            return { ok: true, links: db.getStreamLinks(g.id, s.userId).map(l => ({ platform: l.platform, handle: l.handle, url: channelUrl(l.platform, l.handle) })) };
        },
        "POST /api/streams/end": async (req, body) => {
            const s = session(req); const g = musicMember(s, body.guild_id);
            if (!streams) throw new HttpError(503, "Streams aren't available on this bot right now.");
            const target = body.user_id && body.user_id !== s.userId ? String(body.user_id) : s.userId;
            if (target !== s.userId && !(isManager(g) || isOwner(s))) throw new HttpError(403, "Only managers can end someone else's stream.");
            const me = (await remember("mname:" + g.id + ":" + target, 10 * 60_000, () => rest.memberName(g.id, target)).catch(() => null)) || "Someone";
            await musicCall(() => streams.endLive(g.id, { id: target, name: me }));
            return { ok: true };
        },
        "POST /api/streams/ping": async (req, body) => {
            const s = session(req); const g = musicMember(s, body.guild_id);
            if (!streams) throw new HttpError(503, "Streams aren't available on this bot right now.");
            cooldown(s.userId, "streamping");
            const r = await musicCall(() => streams.setOptIn(g.id, s.userId, Boolean(body.on)));
            return { optedIn: r.on };
        },
        "POST /api/streams/settings": async (req, body) => {
            const s = session(req); const g = musicMember(s, body.guild_id);
            if (!(isManager(g) || isOwner(s))) throw new HttpError(403, "You need the Manage Server permission there.");
            const ch = await remember("choices:" + g.id, 60_000, () => guildChoices(g.id));
            const patch = {};
            const pick = (k, list) => { if (!(k in body)) return; const v = body[k] ? String(body[k]) : null; if (v && !list.some(x => x.id === v)) throw new HttpError(400, "That isn't in this server."); return v; };
            for (const [k, list] of [["streamer_role_id", ch.roles], ["live_channel", ch.channels], ["ping_stream", ch.roles]]) { const v = pick(k, list); if (v !== undefined) patch[k] = v; }
            if ("auto" in body) patch.stream_auto = body.auto ? 1 : 0;
            const c = db.setCommunity(g.id, patch);
            return { settings: { streamer_role_id: c.streamer_role_id, live_channel: c.live_channel, ping_stream: c.ping_stream, auto: c.stream_auto !== 0 } };
        },
        "GET /api/music/search": async (req, _b, url) => {
            const s = session(req);
            if (!music) throw new HttpError(503, "Music isn't available on this bot right now.");
            musicMember(s, url.searchParams.get("guild"));
            cooldown(s.userId, "musicsearch");
            return { results: await musicCall(() => music.search(url.searchParams.get("q"))) };
        },
        "POST /api/music/play": async (req, body) => {
            const s = session(req);
            if (!music) throw new HttpError(503, "Music isn't available on this bot right now.");
            const g = musicMember(s, body.guild_id);
            cooldown(s.userId, "musicplay");
            await musicGuild?.(g.id)?.warm?.(s.userId);
            const tracks = Array.isArray(body.tracks) && body.tracks.length ? body.tracks.slice(0, 1).map(t => ({ url: String(t.url ?? ""), title: String(t.title ?? "").slice(0, 150), artist: String(t.artist ?? "").slice(0, 80), duration: Number(t.duration) || null, thumb: typeof t.thumb === "string" && t.thumb.startsWith("https://") ? t.thumb : null })).filter(t => isSoundcloudUrl(t.url)) : null;
            const r = await musicCall(() => music.enqueue({ guildId: g.id, userId: s.userId, textChannelId: null, query: body.query, tracks: tracks?.length ? tracks : null, playNext: Boolean(body.next), shuffleAdded: Boolean(body.shuffle) }));
            if (r.title) chat.note(g.id, `${s.username} added ${r.kind === "playlist" ? `${r.added} songs from ${r.title}` : r.title}`);
            return { added: r.added, kind: r.kind, title: r.title, startedNow: r.startedNow, status: music.status(g.id) };
        },
        "POST /api/music/control": async (req, body) => {
            const s = session(req);
            if (!music) throw new HttpError(503, "Music isn't available on this bot right now.");
            const g = musicMember(s, body.guild_id);
            cooldown(s.userId, "music");
            await musicGuild?.(g.id)?.warm?.(s.userId);
            const id = g.id, u = s.userId, n = Number(body.n ?? body.value);
            const acts = {
                pause: () => music.pause(id, u), resume: () => music.resume(id, u), skip: () => music.skip(id, u), stop: () => music.stop(id, u), leave: () => music.leave(id, u),
                previous: () => music.previous(id, u), shuffle: () => music.shuffle(id, u), clear: () => music.clear(id, u), loop: () => music.setLoop(id, u, String(body.value)),
                volume: () => music.setVolume(id, u, n), seek: () => music.seek(id, u, n), skipto: () => music.skipTo(id, u, n), remove: () => music.remove(id, u, n), move: () => music.move(id, u, Number(body.from), Number(body.to))
            };
            if (!Object.hasOwn(acts, String(body.action))) throw new HttpError(400, "Unknown action.");
            const result = await musicCall(async () => acts[body.action]());
            return { result: result && typeof result === "object" && "skipped" in result ? { skipped: result.skipped, votes: result.votes, need: result.need } : null, status: music.status(id) };
        },
        "POST /api/music/playlists": async (req, body) => {
            const s = session(req);
            if (!music) throw new HttpError(503, "Music isn't available on this bot right now.");
            const g = musicMember(s, body.guild_id);
            const name = String(body.name ?? "").trim();
            if (body.action === "save") {
                const st = music.status(g.id); const tracks = [st.current, ...st.next].filter(Boolean);
                if (!tracks.length) throw new HttpError(400, "Nothing is playing or queued to save.");
                try { var saved = db.savePlaylist(s.userId, name, tracks); } catch (e) { throw new HttpError(400, e.message); }
                return { saved, playlists: db.listPlaylists(s.userId).map(p => ({ name: p.name, count: p.tracks.length })) };
            }
            if (body.action === "delete") {
                if (!db.deletePlaylist(s.userId, name)) throw new HttpError(404, "You don't have a playlist with that name.");
                return { playlists: db.listPlaylists(s.userId).map(p => ({ name: p.name, count: p.tracks.length })) };
            }
            if (body.action === "load") {
                const p = db.getPlaylist(s.userId, name);
                if (!p) throw new HttpError(404, "You don't have a playlist with that name.");
                cooldown(s.userId, "musicplay");
                await musicGuild?.(g.id)?.warm?.(s.userId);
                const r = await musicCall(() => music.enqueue({ guildId: g.id, userId: s.userId, textChannelId: null, tracks: p.tracks }));
                return { added: r.added, status: music.status(g.id) };
            }
            throw new HttpError(400, "Unknown action.");
        },
        "GET /api/music/stations": async (req, _b, url) => {
            const s = session(req);
            if (!music) throw new HttpError(503, "Music isn't available on this bot right now.");
            musicMember(s, url.searchParams.get("guild"));
            cooldown(s.userId, "musicstations");
            return { categories: CATEGORIES.map(([id, name]) => ({ id, name })), stations: stations ? (await stations.working()).map(t => ({ title: t.title, genre: t.genre, cat: t.cat ?? "", url: t.url, name: t.title })) : [] };
        },
        "POST /api/music/submit": async (req, body) => {
            const s = session(req);
            if (!music) throw new HttpError(503, "Music isn't available on this bot right now.");
            const g = musicMember(s, body.guild_id);
            cooldown(s.userId, "musicsubmit");
            await musicGuild?.(g.id)?.warm?.(s.userId);
            const tracks = Array.isArray(body.tracks) && body.tracks.length ? body.tracks.slice(0, 1).map(t => ({ url: String(t.url ?? ""), title: String(t.title ?? "").slice(0, 150), artist: String(t.artist ?? "").slice(0, 80), duration: Number(t.duration) > 0 ? Math.round(Number(t.duration)) : null, thumb: typeof t.thumb === "string" && t.thumb.startsWith("https://") ? t.thumb : null })).filter(t => isSoundcloudUrl(t.url)) : null;
            const r = await musicCall(() => music.submit(g.id, s.userId, { query: body.query, tracks: tracks?.length ? tracks : null }));
            return { added: r.added, title: r.title, pending: r.pending };
        },
        "POST /api/music/submission": async (req, body) => {
            const s = session(req);
            if (!music) throw new HttpError(503, "Music isn't available on this bot right now.");
            const g = musicMember(s, body.guild_id);
            await musicGuild?.(g.id)?.warm?.(s.userId);
            if (body.action === "clear") { const n = await musicCall(async () => music.clearSubmissions(g.id, s.userId)); return { cleared: n }; }
            await musicCall(async () => music.removeSubmission(g.id, s.userId, body.id));
            return { removed: true };
        },
        "POST /api/music/autodj": async (req, body) => {
            const s = session(req);
            if (!music) throw new HttpError(503, "Music isn't available on this bot right now.");
            const g = managedGuild(req, body.guild_id);
            cooldown(s.userId, "musicauto");
            const patch = {};
            const flag = k => { if (body[k] !== undefined) patch[k] = body[k] ? 1 : 0; };
            flag("autodj"); flag("autodj_submit"); flag("autodj_shuffle"); flag("radio");
            if (body.autodj_idle !== undefined) { const n = Math.round(Number(body.autodj_idle)); if (!(n >= 5 && n <= 600)) throw new HttpError(400, "Idle time must be between 5 and 600 seconds."); patch.autodj_idle = n; }
            if (body.autodj_channel_id !== undefined) {
                if (body.autodj_channel_id) { const vcs = await Promise.resolve(rest.listVoiceChannels?.(g.id) ?? []).catch(() => []); if (!vcs.some(c => c.id === body.autodj_channel_id)) throw new HttpError(400, "Pick a voice channel from the list."); }
                patch.autodj_channel_id = body.autodj_channel_id || null;
            }
            if (Object.keys(patch).length) db.setMusicSettings(g.id, patch);
            let note = null;
            if (body.clear_playlist) { music.clearAutoPlaylist(g.id); note = "Playlist removed."; }
            else if (body.playlist_url) { const r = await musicCall(() => music.setAutoPlaylist(g.id, { link: body.playlist_url })); note = `Playlist set: ${r.count} songs.`; }
            else if (body.saved_playlist) {
                const p = db.getPlaylist(s.userId, String(body.saved_playlist));
                if (!p) throw new HttpError(404, "You don't have a saved playlist with that name.");
                const r = await musicCall(() => music.setAutoPlaylist(g.id, { tracks: p.tracks, label: p.name })); note = `Playlist set from ${p.name}: ${r.count} songs.`;
            }
            if (db.getMusicSettings(g.id).autodj) music.autoJoin(g.id).catch(() => {});
            const { autodj_playlist: _skip, ...settings } = db.getMusicSettings(g.id);
            return { settings, note, count: db.getAutoPlaylist(g.id).length };
        },
        "GET /api/admin/traffic": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            const { pages, days } = db.trafficReport();
            const invites = inviteReport();
            const today = dayKey(), sum = (list, f) => list.reduce((n, x) => n + x[f], 0);
            const last = days.slice(-14), week = days.slice(-7);
            const top = pages.sort((a, b) => b.visits - a.visits || b.clicks - a.clicks).slice(0, 15).map(p => {
                const row = p.path === "b" ? db.getFeedBundle(p.id) : db.getDeal(p.id);
                return { ...p, title: row?.title ?? "(removed)", store: p.path === "b" ? row?.store ?? "" : row?.shop ?? "", kind: p.path === "b" ? "Bundle" : row?.kind === "free" ? "Free game" : "Deal", url: `${origin}/${p.path}/${p.id}` };
            });
            return { invites, today: days.find(d => d.day === today) ?? { day: today, visits: 0, clicks: 0, previews: 0 }, week: { visits: sum(week, "visits"), clicks: sum(week, "clicks"), previews: sum(week, "previews") }, total: { visits: sum(pages, "visits"), clicks: sum(pages, "clicks") }, days: last, top };
        },
        "GET /api/admin/xposter": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!xposter) throw new HttpError(503, "X posting isn't available on this bot.");
            return xposter.status();
        },
        "POST /api/admin/xposter": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!xposter) throw new HttpError(503, "X posting isn't available on this bot.");
            if (body.enabled && !xposter.configured()) throw new HttpError(400, "Add the four X keys in Fly first (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET).");
            try { return xposter.setSettings({ enabled: body.enabled, daily: body.daily, tags: body.tags, links: body.links, always: body.always, ingame: body.ingame, steamOnly: body.steamOnly }); } catch (e) { if (e.user) throw new HttpError(400, e.message); throw e; }
        },
        "GET /api/admin/xposter/bundles": async (req, _b, url) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!xposter) throw new HttpError(503, "X posting isn't available on this bot.");
            const link = url.searchParams.get("link") !== "0", tags = xposter.tags();
            return { bundles: db.listFeedBundles({ status: "active", limit: 8, adult: false }).map(bundleFeedView).map(b => ({ id: b.id, title: b.title, storeName: b.storeName, price: b.price, expiresAt: b.expiresAt, gameCount: b.gameCount, posted: xposter.bundlePosted(b.id), text: xposterText.bundleText({ ...b, url: `${origin}/b/${b.id}` }, { tags, link }), visits: Number(db.getMeta(`bundlevisit:${b.id}`)) || 0, clicks: Number(db.getMeta(`bundlego:${b.id}`)) || 0 })) };
        },
        "GET /api/referral": async (req) => {
            const s = session(req);
            if (!s) throw new HttpError(401, "Sign in first.");
            if (!referrals) throw new HttpError(404, "Not found.");
            return referrals.stats(s.userId);
        },
        "GET /api/admin/weekly": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!weekly) throw new HttpError(503, "The weekly deals post isn't available on this bot.");
            return await weekly.status();
        },
        "POST /api/admin/weekly": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!weekly) throw new HttpError(503, "The weekly deals post isn't available on this bot.");
            try { weekly.set({ on: body.on === undefined ? undefined : Boolean(body.on), channel: body.channel }); } catch (e) { if (e instanceof UserError) throw new HttpError(400, e.message); throw e; }
            return { ok: true, ...(await weekly.status()) };
        },
        "POST /api/admin/weekly/run": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!weekly) throw new HttpError(503, "The weekly deals post isn't available on this bot.");
            const r = await weekly.run({ force: true });
            if (r.skipped) throw new HttpError(400, r.skipped === "not enough good deals" ? "There aren't enough good deals to post right now." : "Nothing to post.");
            return { ok: true, ...r };
        },
        "GET /api/admin/xposter/free": async (req, _b, url) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!xposter) throw new HttpError(503, "X posting isn't available on this bot.");
            const link = url.searchParams.get("link") !== "0", tags = xposter.tags();
            let list = [];
            try { list = await itad.getGiveawayList(); } catch { /* shown as an empty list */ }
            const games = list.filter(g => g.type !== "dlc" && /^https:\/\//.test(g.url ?? "") && g.title).sort((a, b) => (a.expiry ?? Infinity) - (b.expiry ?? Infinity)).slice(0, 12);
            return { games: games.map(g => {
                const page = link ? db.upsertDeal({ key: `free:${g.id ?? g.url}`, kind: "free", title: g.title, shop: g.shop, url: g.url, image: freeArt(g), expiry: g.expiry }) : null;
                const text = xposterText.freeGameText({ ...g, url: page ? `${origin}/d/${page}` : g.url }, Date.now(), tags, { link });
                return { id: String(g.id), title: g.title, shop: g.shop, expiry: g.expiry, posted: xposter.freePosted(g.id), text, visits: page ? Number(db.getMeta(`dealvisit:${page}`)) || 0 : 0, clicks: page ? Number(db.getMeta(`dealgo:${page}`)) || 0 : 0 };
            }) };
        },
        "POST /api/admin/xposter/post": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!xposter) throw new HttpError(503, "X posting isn't available on this bot.");
            if (!xposter.configured()) throw new HttpError(400, "Add the four X keys in Fly first.");
            try {
                const text = String(body.text ?? ""), image = body.image ? String(body.image) : null;
                if (body.at && body.video) throw new HttpError(400, "The promo video can only be posted right now, not scheduled.");
                if (body.at) { const item = xposter.schedule({ text, at: Number(body.at), image }); return { ok: true, scheduled: item }; }
                const bundle = body.bundle_id ? db.getFeedBundle(body.bundle_id) : null; // the picture comes from our own record of the bundle, never an address sent from the page
                let free = null; // same for a free game: it's looked up in the bot's own list, and its picture comes from there
                if (body.free_id) free = (await itad.getGiveawayList().catch(() => [])).find(g => String(g.id) === String(body.free_id)) ?? null;
                return { ok: true, ...(await xposter.manual({ text, image, video: body.video === "promo", imageUrl: bundle?.image ?? (free ? freeArt(free) : null) ?? null, bundleId: bundle ? String(bundle.id) : null, freeId: free ? String(free.id) : null })) };
            } catch (e) { if (e.user || e.status) throw new HttpError(400, e.message); throw e; }
        },
        "POST /api/admin/xposter/unschedule": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!xposter) throw new HttpError(503, "X posting isn't available on this bot.");
            xposter.unschedule(String(body.key ?? "")); return { ok: true };
        },
        "POST /api/admin/xposter/delete": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!xposter) throw new HttpError(503, "X posting isn't available on this bot.");
            try { return await xposter.remove(String(body.id ?? "")); } catch (e) { if (e.user || e.status) throw new HttpError(400, e.message); throw e; }
        },
        "POST /api/admin/xposter/check": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!xposter) throw new HttpError(503, "X posting isn't available on this bot.");
            try { return { ok: true, ...(await xposter.check()) }; } catch (e) { throw new HttpError(400, e.message); }
        },
        "GET /api/admin/music": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!music) throw new HttpError(503, "Music isn't available on this bot right now.");
            const nameOf = id => guildList?.().find(x => x.id === id)?.name ?? null;
            return { sessions: music.sessions().filter(x => !isHidden(x.guildId)).map(x => ({ ...x, guildName: nameOf(x.guildId) ?? "Server " + x.guildId.slice(-4) })) };
        },
        "POST /api/admin/music": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!music) throw new HttpError(503, "Music isn't available on this bot right now.");
            if (isHidden(String(body.guild_id ?? ""))) throw new HttpError(404, "Unknown server.");
            await musicCall(async () => music.adminForce(String(body.guild_id ?? ""), String(body.action ?? "")));
            return { ok: true, sessions: music.sessions().filter(x => !isHidden(x.guildId)).length };
        },
        "POST /api/music/settings": async (req, body) => {
            const s = session(req);
            if (!music) throw new HttpError(503, "Music isn't available on this bot right now.");
            const g = managedGuild(req, body.guild_id);
            const patch = {};
            const int = (k, lo, hi, label) => { if (body[k] === undefined) return; const n = Math.round(Number(body[k])); if (!(n >= lo && n <= hi)) throw new HttpError(400, `${label} must be between ${lo} and ${hi}.`); patch[k] = n; };
            if (body.enabled !== undefined) patch.enabled = body.enabled ? 1 : 0;
            if (body.announce !== undefined) patch.announce = body.announce ? 1 : 0;
            if (body.vc_status !== undefined) patch.vc_status = body.vc_status ? 1 : 0;
            if (body.stay !== undefined) patch.stay = body.stay ? 1 : 0;
            if (body.radio !== undefined) patch.radio = body.radio ? 1 : 0;
            int("volume", 1, 100, "Starting volume"); int("max_queue", 5, 500, "Queue size"); int("max_minutes", 0, 600, "Song length limit"); int("leave_minutes", 1, 60, "Leave time");
            if (body.dj_role_id !== undefined || body.channel_id !== undefined) {
                const { channels, roles } = await guildChoices(g.id);
                if (body.dj_role_id !== undefined) { if (body.dj_role_id && !roles.some(r => r.id === body.dj_role_id)) throw new HttpError(400, "Pick a role from the list."); patch.dj_role_id = body.dj_role_id || null; }
                if (body.channel_id !== undefined) { if (body.channel_id && !channels.some(c => c.id === body.channel_id)) throw new HttpError(400, "Pick a text channel from the list."); patch.channel_id = body.channel_id || null; }
            }
            return { settings: Object.keys(patch).length ? db.setMusicSettings(g.id, patch) : db.getMusicSettings(g.id) };
        },

        // ----- promo drops (SteelSeries, NVIDIA and the like) -----
        "GET /api/servers/drops": async (req, _b, url) => {
            const g = managedGuild(req, url.searchParams.get("guild"));
            const { channels, roles } = await guildChoices(g.id);
            const at = now();
            db.expireDrops(at);
            return { settings: db.getDropSettings(g.id), channels, roles, drops: db.listDrops(g.id, { limit: 25 }).map(d => dropView(d, at)), news: db.listNews(8) };
        },
        "POST /api/servers/drops": async (req, body) => {
            const s = session(req);
            const g = managedGuild(req, body.guild_id);
            const patch = {};
            if (body.channel_id !== undefined) {
                if (body.channel_id) {
                    const { channels } = await guildChoices(g.id, false);
                    const channel = channels.find(c => c.id === body.channel_id);
                    if (!channel) throw new HttpError(400, "Pick a text channel from the list.");
                    if (channel.id !== db.getDropSettings(g.id).channel_id) {
                        try { await rest.sendMessage(channel.id, { content: `Promo drops will be posted in this channel (set from the dashboard by <@${s.userId}>).`, allowed_mentions: { parse: [] } }); }
                        catch { throw new HttpError(400, `I cannot post in #${channel.name}. Give the bot View Channel, Send Messages and Embed Links there, then try again.`); }
                    }
                }
                patch.channel_id = body.channel_id || null;
            }
            if (body.role_id !== undefined) {
                if (body.role_id) {
                    const { roles } = await guildChoices(g.id);
                    if (!roles.some(r => r.id === body.role_id)) throw new HttpError(400, "Pick a role from the list.");
                }
                patch.role_id = body.role_id || null;
            }
            if (body.news !== undefined) patch.news = Boolean(body.news);
            if (patch.news && !(patch.channel_id ?? db.getDropSettings(g.id).channel_id)) throw new HttpError(400, "Pick a channel first, then turn blog watching on.");
            const settings = applyDropSettings(db, g.id, patch);
            if (patch.channel_id) drops?.poll?.().catch(() => {});
            return { settings };
        },
        "POST /api/servers/drops/add": async (req, body) => {
            const s = session(req);
            const g = managedGuild(req, body.guild_id);
            let clean;
            try { clean = cleanDrop(body, now()); } catch (err) { throw new HttpError(400, err.message); }
            if (!db.getDropSettings(g.id).channel_id) throw new HttpError(400, "Pick a promo channel first, then add the drop.");
            const id = db.addDrop({ guildId: g.id, ...clean, createdBy: s.userId });
            drops?.poll?.().catch(() => {});
            return { id };
        },
        "POST /api/servers/drops/end": async (req, body) => {
            const g = managedGuild(req, body.guild_id);
            const d = db.getDrop(Number(body.id));
            if (!d || d.guild_id !== g.id) throw new HttpError(404, "No such drop in this server.");
            if (!db.endDrop(d.id)) throw new HttpError(400, "That one has already ended.");
            drops?.poll?.().catch(() => {});
            return { id: d.id, status: "ended" };
        },

        "GET /api/servers/channels": async (req, _b, url) => {
            const s = session(req);
            const g = s.guilds.find(x => x.id === url.searchParams.get("guild"));
            if (!g || !isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            try {
                return { channels: await rest.listChannels(g.id), current: db.getGuild(g.id)?.channel_id ?? null };
            } catch (err) {
                if (err instanceof DiscordApiError && [403, 404].includes(err.status)) throw new HttpError(400, "The bot is not in that server yet. Invite it first.");
                throw err;
            }
        },

        "POST /api/servers/channel": async (req, body) => {
            const s = session(req);
            const g = s.guilds.find(x => x.id === body.guild_id);
            if (!g || !isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            if (body.clear) return { cleared: db.clearGuildChannel(g.id) };

            let channels;
            try { channels = await rest.listChannels(g.id); }
            catch (err) {
                if (err instanceof DiscordApiError && [403, 404].includes(err.status)) throw new HttpError(400, "The bot is not in that server yet. Invite it first.");
                throw err;
            }
            const channel = channels.find(c => c.id === body.channel_id);
            if (!channel) throw new HttpError(400, "Pick a text channel from the list.");

            // Posting a message proves the bot can use the channel, and tells the server who changed it.
            try {
                await rest.sendMessage(channel.id, {
                    content: `Wishlist alert channel set from the dashboard by <@${s.userId}>. Members get sale alerts here when a DM cannot be delivered, or when they choose channel delivery.`,
                    allowed_mentions: { parse: [] }
                });
            } catch {
                throw new HttpError(400, `I cannot post in #${channel.name}. Give the bot View Channel, Send Messages and Embed Links there, then try again.`);
            }
            db.setGuildChannel(g.id, channel.id, s.userId);
            return { channel };
        },

        // ----- price history, bulk actions, alert history -----
        "GET /api/wishlist/history": async (req, _b, url) => {
            const s = session(req);
            const id = String(url.searchParams.get("itad_id") ?? "");
            const own = db.listItems(s.userId).find(i => i.itad_id === id) ?? db.listLibrary(s.userId).find(i => i.itad_id === id);
            if (!own) throw new HttpError(404, "That game is not on your wishlist or in your library.");
            cooldown(s.userId, "hist");
            const u = userRow(s);
            const all = await itad.getHistory(id, u.region);
            const step = Math.max(1, Math.ceil(all.length / MAX_HISTORY_POINTS));
            const points = all.filter((_, i) => i % step === 0 || i === all.length - 1).map(p => ({ t: p.t, price: p.price, shop: p.shop }));
            let advice = null;
            try {
                const prices = await itad.getPrices([id], u.region);
                const sum = summarize(prices.get(id), { majorOnly: u.stores === "major" });
                const nowPrice = sum.best?.price ?? all.at(-1)?.price;
                const cur = sum.currency || "USD";
                advice = buyOrWait(all, nowPrice, { sales: upcomingSales(Date.now()), past: salesBefore(), money: n => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(n); } catch { return String(n); } } });
            } catch { /* the chart works without it */ }
            return { title: own.title, points, advice };
        },

        "POST /api/wishlist/bulk": async (req, body) => {
            const s = session(req);
            const ids = Array.isArray(body.itad_ids) ? [...new Set(body.itad_ids.map(String))].slice(0, 200) : [];
            if (!ids.length) throw new HttpError(400, "Select at least one game.");
            const mine = new Set(db.listItems(s.userId).map(i => i.itad_id));
            const targets = ids.filter(id => mine.has(id));
            if (body.action === "remove") {
                for (const id of targets) db.removeItem(s.userId, id);
                return { removed: targets.length };
            }
            if (body.action === "alert") {
                let trig;
                try { trig = parseTrigger(body.type, num(body.value)); } catch (e) { throw new HttpError(400, e.message); }
                for (const id of targets) db.setTrigger(s.userId, trig.type, trig.value, id);
                return { updated: targets.length, label: describeTrigger({ trigger_type: trig.type, trigger_value: trig.value }) };
            }
            throw new HttpError(400, "Unknown action.");
        },

        // giveaway and code news the bot spotted, plus drops added in the member's own servers
        "GET /api/promos": async (req) => {
            const s = session(req);
            const at = now();
            db.expireDrops(at);
            const mine = s.guilds.filter(g => !botGuilds || botGuilds(g.id));
            const drops = mine.flatMap(g => db.listDrops(g.id, { status: "active", limit: 10 }).map(d => ({ ...dropView(d, at), server: g.name })));
            return { news: db.listNews(30).map(n => ({ id: n.id, source: n.source, kind: n.kind, title: n.title, url: n.url, summary: n.summary, seenAt: n.seen_at })), drops: drops.filter(d => d.status === "active") };
        },

        // game code and promo news alerts to your own DMs
        "GET /api/alerts/codes": async (req) => {
            const s = session(req); userRow(s);
            return { ...db.getAlertSubs(s.userId), allGames: codeGames(), families: codeFamilies() };
        },
        "POST /api/alerts/codes": async (req, body) => {
            const s = session(req); userRow(s);
            const patch = {};
            if (body.codes !== undefined) patch.codes = Boolean(body.codes);
            if (body.promos !== undefined) patch.promos = Boolean(body.promos);
            if (body.games !== undefined) {
                const keys = codeGames().map(g => g.key);
                const games = expandGames(Array.isArray(body.games) ? body.games.map(String) : []);
                if (games.some(g => !keys.includes(g))) throw new HttpError(400, "That is not a game I track codes for.");
                if (!games.length) throw new HttpError(400, "Keep at least one game ticked, or turn code alerts off.");
                patch.games = games.length === keys.length ? [] : games;
            }
            return { ...db.setAlertSubs(s.userId, patch), allGames: codeGames(), families: codeFamilies() };
        },

        // Sends one sample alert of a kind to the member's own DMs, so they can see how it looks.
        "POST /api/alerts/test": async (req, body) => {
            const s = session(req); userRow(s);
            const p = sampleAlert(String(body?.kind ?? ""), { currency: regionCurrency(userRow(s).region) });
            if (!p) throw new HttpError(400, `Pick one of: ${SAMPLE_KINDS.join(", ")}.`);
            if (!dm) throw new HttpError(503, "Sending messages is not set up here.");
            cooldown(s.userId, "sample");
            try { await dm(s.userId, p); } catch { throw new HttpError(409, "I couldn't send you a DM. Open your DMs for this server's members, then try again."); }
            return { ok: true };
        },
        "GET /api/alerts/history": async (req) => {
            const s = session(req);
            return { alerts: db.listAlerts(s.userId, 100).map(a => ({ at: a.at, kind: a.kind, title: a.title, price: a.price, regular: a.regular, shop: a.shop, via: a.via })) };
        },

        // ----- library -----
        "GET /api/library": async (req) => {
            const s = session(req);
            const u = userRow(s);
            const v = await libraryView(db, itad, u);
            const tags = db.getAppTags(v.rows.map(r => r.appid).filter(Boolean)); // Steam's public genres, for the card view's tags and filter
            for (const r of v.rows) r.genres = (tags.get(r.appid)?.genres ?? []).slice(0, 4);
            return v;
        },

        "POST /api/library/add": async (req, body) => {
            const s = session(req);
            cooldown(s.userId, "lib");
            userRow(s);
            const paid = num(body.paid);
            if (paid !== null && !(Number.isFinite(paid) && paid >= 0 && paid <= 10_000)) throw new HttpError(400, "Paid must be a number from 0 to 10,000.");
            const r = await importLibrary(db, itad, s.userId, [{ title: String(body.title ?? ""), paid }]);
            if (r.notFound.length) throw new HttpError(400, `I could not find a game called ${r.notFound[0]}.`);
            if (r.skippedForLimit) throw new HttpError(400, "Your library is full (1,500 games).");
            return r;
        },

        "POST /api/library/import": async (req, body) => {
            const s = session(req);
            cooldown(s.userId, "lib");
            userRow(s);
            let entries = [];
            if (body.file && typeof body.file === "object") {
                const name = String(body.file.name ?? "");
                if (!/\.(csv|json|txt|md)$/i.test(name)) throw new HttpError(400, "Unsupported file type. Use a .csv, .json, .txt or .md export.");
                const text = String(body.file.text ?? "");
                if (text.length > MAX_UPLOAD_CHARS) throw new HttpError(400, "That file is too large (200 KB max).");
                entries = parseUpload(text, name.toLowerCase());
            } else if (Array.isArray(body.entries)) {
                entries = body.entries.slice(0, 500).map(e => ({ title: String(e?.title ?? ""), paid: Number.isFinite(Number(e?.paid)) && e?.paid !== null && e?.paid !== "" ? Number(e.paid) : null }));
            }
            const clean = sanitize(entries, { max: 500 }).entries;
            if (!clean.length) throw new HttpError(400, "I need game titles, not keys.");
            return await importLibrary(db, itad, s.userId, clean);
        },

        "GET /api/redeem": async (req) => {
            const s = session(req);
            db.pruneRedeemJobs();
            return { job: db.pendingRedeemJob(s.userId) };
        },

        "GET /api/redeem/history": async (req) => {
            const s = session(req);
            const entries = db.redeemHistory(s.userId, 100);
            const count = st => entries.filter(e => e.status === st).length;
            return { entries, counts: { redeemed: count("redeemed"), owned: count("owned"), used: count("used"), invalid: count("invalid") } };
        },

        "POST /api/redeem/check": async (req, body) => {
            // Which pasted keys were already redeemed here, so the page can skip them instead of spending a Steam attempt.
            const s = session(req);
            const keys = extractKeys((Array.isArray(body.keys) ? body.keys : []).slice(0, 500).join("\n"));
            return { known: Object.fromEntries(db.knownRedeems(s.userId, keys)) };
        },

        "POST /api/redeem/log": async (req, body) => {
            // A batch run straight from the page: remember how the keys ended up (hashes only).
            const s = session(req);
            const results = (Array.isArray(body.results) ? body.results : []).slice(0, 500).map(r => ({ key: String(r?.key ?? ""), status: String(r?.status ?? ""), game: String(r?.game ?? "").slice(0, 100) }));
            return { logged: db.logRedeem(s.userId, results) };
        },

        "POST /api/redeem/history/clear": async (req) => {
            const s = session(req);
            return { cleared: db.clearRedeemHistory(s.userId) };
        },

        "POST /api/redeem/finish": async (req, body) => {
            // The page reports what the extension did with a batch that was queued by /games redeem. Results go back to the member's Discord DMs.
            const s = session(req);
            const job = db.pendingRedeemJob(s.userId);
            if (body.cancel) { db.cancelRedeemJob(s.userId); return { ok: true }; }
            if (!job || job.id !== Number(body.id)) throw new HttpError(404, "That batch is no longer waiting.");
            const mine = new Set(job.keys);
            const results = (Array.isArray(body.results) ? body.results : []).slice(0, 500)
                .map(r => ({ key: String(r?.key ?? "").toUpperCase(), status: String(r?.status ?? "error").slice(0, 20), game: String(r?.game ?? "").slice(0, 100), message: String(r?.message ?? "").slice(0, 120) }))
                .filter(r => mine.has(r.key));
            const count = (...st) => results.filter(r => st.includes(r.status)).length;
            const failed = results.filter(r => !["redeemed", "owned", "used"].includes(r.status));
            const left = job.keys.length - results.length;
            const summary = `${count("redeemed")} redeemed, ${count("owned", "used")} already owned or used, ${failed.length} failed${left > 0 ? `, ${left} not tried` : ""}`;
            const aborted = String(body.aborted ?? "").slice(0, 160);
            const lines = [`Your batch redeem finished: **${summary}.**`];
            if (aborted) lines.push(`⚠️ ${aborted}`);
            const done = results.filter(r => r.status === "redeemed");
            if (done.length) lines.push("", "**Redeemed**", ...done.slice(0, 25).map(r => `• ${r.game || "Unnamed product"} (\`${r.key.slice(0, 5)}-•••••-${r.key.slice(-5)}\`)`));
            if (failed.length) lines.push("", "**Failed** (still yours to retry)", ...failed.slice(0, 25).map(r => `• \`${r.key}\` ${r.message || r.status}`));
            if (left > 0) lines.push("", `**${left}** key${left === 1 ? "" : "s"} were not tried. Send them again with /games redeem.`);
            db.logRedeem(s.userId, results);
            if (!db.finishRedeemJob(s.userId, job.id, summary)) throw new HttpError(404, "That batch is no longer waiting.");
            const text = lines.join("\n").slice(0, 3900);
            try { db.addNotification(s.userId, { type: "redeem", title: "Batch redeem finished", body: summary, url: "#/redeem" }); } catch { /* the DM is what counts */ }
            let sent = false;
            if (dm) { try { await dm(s.userId, { embeds: [{ color: 0x57f287, title: "Batch redeem", description: text }] }); sent = true; } catch { /* DMs closed: it is in Notifications */ } }
            return { ok: true, summary, dm: sent };
        },

        // The key vault shows titles only: what the unredeemed games are worth right now. Keys never come here.
        "POST /api/vault/value": async (req, body) => {
            const s = session(req);
            cooldown(s.userId, "value");
            const u = userRow(s);
            const titles = [...new Set((Array.isArray(body.titles) ? body.titles : []).map(t => String(t ?? "").trim().slice(0, 150)).filter(Boolean))].slice(0, 150);
            if (!titles.length) throw new HttpError(400, "No titles.");
            const looked = (await itad.lookupTitles(titles)).filter(r => r.id);
            const prices = looked.length ? await itad.getPrices(looked.map(r => r.id), u.region) : new Map();
            let total = 0, currency = null;
            const rows = looked.map(r => {
                const sum = summarize(prices.get(r.id), { majorOnly: u.stores === "major" });
                currency ??= sum.currency;
                const price = sum.best?.price ?? sum.steam ?? null;
                if (price !== null) total += sum.msrp && sum.msrp > price ? sum.msrp : price;
                return { title: r.title, msrp: sum.msrp, price };
            });
            const nowTotal = rows.reduce((a, r) => a + (r.price ?? 0), 0);
            return { currency: currency ?? "USD", fullPrice: Math.round(total * 100) / 100, cheapestNow: Math.round(nowTotal * 100) / 100, matched: rows.length, unmatched: titles.length - rows.length };
        },

        // One page per game: prices, a year of history with the buy-now-or-wait verdict, bundles, free offers and server interest.
        "GET /api/game": async (req, _b, url) => {
            const s = session(req);
            const id = String(url.searchParams.get("id") ?? "");
            if (!/^[0-9a-f-]{20,40}$/i.test(id)) throw new HttpError(400, "That is not a game id.");
            cooldown(s.userId, "gamepage");
            const u = userRow(s);
            const info = await itad.getTitle(id);
            if (!info) throw new HttpError(404, "That game was not found.");
            const [prices, history, bundles, giveaways] = await Promise.all([
                itad.getPrices([id], u.region).catch(() => new Map()),
                itad.getHistory(id, u.region).catch(() => []),
                itad.getBundles([id], u.region).catch(() => new Map()),
                itad.getGiveaways().catch(() => new Map())
            ]);
            const sum = summarize(prices.get(id), { majorOnly: u.stores === "major" });
            const cur = sum.currency || "USD";
            const fmt = n => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(n); } catch { return String(n); } };
            const nowPrice = sum.best?.price ?? null;
            const step = Math.max(1, Math.ceil(history.length / MAX_HISTORY_POINTS));
            const watchers = u.guild_id ? db.sharedWatchedItems(u.guild_id).find(w => w.itad_id === id)?.watchers ?? 0 : 0;
            return {
                id, title: info.title, appid: info.appid ?? null, release: info.release ?? null, currency: cur,
                price: nowPrice, shop: sum.best?.shop ?? null, url: /^https:\/\//i.test(sum.best?.url ?? "") ? sum.best.url : null,
                steam: sum.steam, msrp: sum.msrp, atl: sum.atl, low1y: sum.low1y, low3m: sum.low3m,
                points: history.filter((_, i) => i % step === 0 || i === history.length - 1).map(p => ({ t: p.t, price: p.price })),
                advice: nowPrice !== null ? buyOrWait(history, nowPrice, { sales: upcomingSales(Date.now()), past: salesBefore(), money: fmt }) : null,
                bundles: (bundles.get(id) ?? []).slice(0, 5).map(b => ({ title: b.title, shop: b.shop, price: b.price, currency: b.currency, expiry: b.expiry, url: /^https:\/\//i.test(b.url ?? "") ? b.url : null })),
                free: (giveaways.get(id) ?? []).slice(0, 3).map(g => ({ title: g.title, shop: g.shop, expiry: g.expiry, url: /^https:\/\//i.test(g.url ?? "") ? g.url : null })),
                onWishlist: db.listItems(s.userId).some(g => g.itad_id === id), inLibrary: db.listLibrary(s.userId).some(g => g.itad_id === id),
                watchers
            };
        },

        "GET /api/friends": async (req) => { const s = session(req); userRow(s); syncFollowedFriends(db, s.userId, id => authorCard(id).name); return { friends: friendRows(db, s.userId) }; },
        "POST /api/friends/birthday": async (req, body) => { const s = session(req); userRow(s); if (!db.setFriendBirthday(s.userId, cleanFriendName(body.name), cleanBirthday(body.birthday))) throw new HttpError(404, "I can't find that friend."); return { ok: true }; },
        "POST /api/friends/add": async (req, body) => { const s = session(req); userRow(s); return saveFriend(db, s.userId, { name: body.name, birthday: body.birthday, page: body.page }); },
        "POST /api/friends/remove": async (req, body) => { const s = session(req); if (!db.removeFriend(s.userId, String(body.name ?? ""))) throw new HttpError(404, "No friend by that name."); return { removed: true }; },
        "GET /api/friends/deals": async (req, _b, url) => {
            const s = session(req);
            const f = db.getFriend(s.userId, String(url.searchParams.get("name") ?? ""));
            if (!f) throw new HttpError(404, "No friend by that name.");
            if (!f.slug) throw new HttpError(400, "Add their public page name first.");
            cooldown(s.userId, "deals");
            const deals = await friendDeals(db, itad, f.slug, 10);
            if (!deals) throw new HttpError(404, "That page is not public, or does not exist.");
            return { name: f.name, deals };
        },

        "GET /api/library/spend": async (req) => { const s = session(req); const u = userRow(s); return spendSummary(db.listLibrary(s.userId), { currency: regionCurrency(u.region) }); },
        "GET /api/library/news": async (req) => {
            const s = session(req); cooldown(s.userId, "libnews");
            const { known, posts } = await newsForUser(db, news ?? (news = createNews()), s.userId, { limit: 12 });
            return { known, posts: posts.map(p => ({ gid: p.gid, game: p.gameTitle, appid: p.appid, title: p.title, summary: p.summary, patch: p.patch, date: p.date, url: p.url, image: p.image })) };
        },
        "GET /api/library/bundles": async (req) => { const s = session(req); return await bundleView(db, itad, userRow(s)); },
        "POST /api/library/bundle": async (req, body) => {
            const s = session(req);
            cooldown(s.userId, "lib");
            userRow(s);
            try { return await addBundle(db, itad, s.userId, { name: body.name, paid: Number(body.paid), titles: body.titles }); }
            catch (e) { if (e instanceof UserError) throw new HttpError(400, e.message); throw e; }
        },
        "POST /api/library/bundle/remove": async (req, body) => {
            const s = session(req);
            if (!db.removeBundle(s.userId, Number(body.id))) throw new HttpError(404, "That bundle is not in your tracker.");
            return { ok: true };
        },
        "GET /api/library/badges": async (req) => { const s = session(req); userRow(s); return trophyCase(db, s.userId); },
        "GET /api/library/challenge": async (req) => { const s = session(req); return challengeView(db, s.userId); },
        "POST /api/library/challenge": async (req, body) => {
            const s = session(req);
            const goal = Number(body.goal);
            if (!Number.isInteger(goal) || goal < 0 || goal > MAX_GOAL) throw new HttpError(400, `Pick a goal from 0 to ${MAX_GOAL}.`);
            userRow(s);
            db.setChallenge(s.userId, monthKey(Date.now()), goal);
            return challengeView(db, s.userId);
        },

        "POST /api/library/status": async (req, body) => {
            const s = session(req);
            const lib = db.listLibrary(s.userId);
            if (Array.isArray(body.itad_ids)) {
                // Many games at once (the Library page's selection). Unknown ids are ignored.
                const mine = new Set(lib.map(i => i.itad_id));
                const ids = [...new Set(body.itad_ids.map(String))].filter(id => mine.has(id)).slice(0, 1500);
                if (!ids.length) throw new HttpError(400, "Select some games first.");
                let updated = 0;
                for (const id of ids) {
                    if (!db.setLibraryStatus(s.userId, id, String(body.status))) throw new HttpError(400, "Pick backlog, playing, played, finished or dropped.");
                    updated++;
                }
                return { updated, status: body.status };
            }
            const item = lib.find(i => i.itad_id === body.itad_id);
            if (!item) throw new HttpError(404, "That game is not in your library.");
            if (!db.setLibraryStatus(s.userId, item.itad_id, String(body.status))) throw new HttpError(400, "Pick backlog, playing, played, finished or dropped.");
            return { title: item.title, status: body.status };
        },

        "GET /api/grabber": async (req) => {
            const s = session(req);
            userRow(s);
            return { link: db.getGrabberLink(s.userId) };
        },

        // Makes (or replaces) the link code the FanaticalGrabber extension uses. The code is returned once and never stored readable.
        "POST /api/grabber/token": async (req, body) => {
            const s = session(req);
            cooldown(s.userId, "grabbertoken");
            userRow(s);
            if (body.action === "off") return { ok: true, removed: db.revokeGrabberToken(s.userId) };
            return { token: db.createGrabberToken(s.userId) };
        },

        "GET /api/steam": async (req) => {
            const s = session(req);
            const u = userRow(s);
            const link = db.getSteamLink(s.userId);
            if (!link) return { link: null };
            const view = await libraryView(db, itad, u, { snapshot: false });
            return { link, currency: view.currency, stats: playStats(view.rows.filter(r => r.appid)), card: await profileCard(link.steamid) };
        },

        // Look at anyone's PUBLIC Steam profile without linking or storing anything: their card and play stats.
        "GET /api/steam/lookup": async (req, _b, url) => {
            const s = session(req);
            userRow(s);
            const undo = cooldown(s.userId, "steamlookup");
            try {
                const steamid = await resolveProfile(String(url.searchParams.get("profile") ?? ""), steamFetch);
                const [card, games] = await Promise.all([profileCard(steamid), fetchOwnedGames(steamid, { apiKey: config.steamApiKey ?? null, fetchImpl: steamFetch })]);
                const played = games.filter(g => g.minutes > 0), barely = games.filter(g => g.minutes < 60);
                return { card: card ?? { steamid, name: "Steam user " + steamid, avatar: null, url: `https://steamcommunity.com/profiles/${steamid}` }, mine: db.getSteamLink(s.userId)?.steamid === steamid,
                    stats: { games: games.length, playedGames: played.length, totalMinutes: games.reduce((t, g) => t + g.minutes, 0), barely: barely.length,
                        mostPlayed: [...played].sort((a, b) => b.minutes - a.minutes).slice(0, 8).map(g => ({ appid: g.appid, title: g.name || "App " + g.appid, minutes: g.minutes })) } };
            } catch (err) { undo(); throw err; }
        },

        // What to play next from the Steam library. `skip` (comma-separated ids already offered) makes "pick another" fresh.
        // Library analytics: tiles, hours by genre, played vs backlog, most played. Genre tags are fetched a few at a time, so
        // `pending` says how many games are still waiting; the page asks again until it is 0.
        // Discord Linked Roles: show Steam on your Discord profile. The same as /me steam verify.
        "GET /api/steam/linkedroles": async (req) => {
            const s = session(req); userRow(s);
            const p = connectionPayload(db, s.userId);
            return { available: Boolean(config.clientId), verified: Boolean(p?.metadata.steam_verified), preview: p ? { name: p.platform_username, ...p.metadata } : null, url: "/auth/linked" };
        },
        "GET /api/steam/analytics": async (req) => {
            const s = session(req);
            const u = userRow(s);
            if (!db.getSteamLink(s.userId)) throw new HttpError(400, "Sign in through Steam first.");
            cooldown(s.userId, "analytics");
            const need = db.appsNeedingTags(s.userId, 25);
            if (need.length) await refreshTags({ db, appids: need, fetchImpl: steamFetch ?? globalThis.fetch, delayMs: 150 });
            const w = await libraryView(db, itad, u, { snapshot: false });
            return { ...libraryAnalytics(db, s.userId, w.rows), currency: w.currency ?? "USD", pending: db.appsNeedingTags(s.userId, 500).length };
        },

        // Deals picked for you: discounts ranked by taste and wishlist. `pending` = games still waiting for genres; the page asks again.
        "GET /api/foryou": async (req) => {
            const s = session(req);
            const u = userRow(s);
            cooldown(s.userId, "foryou");
            return await forYou({ db, itad, userId: s.userId, user: u, fetchImpl: steamFetch ?? globalThis.fetch });
        },

        "GET /api/steam/taste": async (req) => {
            const s = session(req);
            const u = userRow(s);
            if (!db.getSteamLink(s.userId)) throw new HttpError(400, "Link your Steam profile first.");
            cooldown(s.userId, "taste");
            const need = db.appsNeedingTags(s.userId, 10);
            if (need.length) await refreshTags({ db, appids: need, fetchImpl: steamFetch ?? globalThis.fetch, delayMs: 300 });
            const profile = tasteProfile(db, s.userId);
            let picks = [], currency = "USD";
            try { const w = await viewRows(db, itad, u); currency = w.currency ?? "USD"; picks = recommend(db, s.userId, w.rows, profile).map(p => ({ ...p, why: tasteWhy(p) })); } catch { /* optional */ }
            return { ...profile, picks, currency };
        },

        "GET /api/steam/recap": async (req, _body, url) => {
            const s = session(req);
            if (!db.getSteamLink(s.userId)) throw new HttpError(400, "Link your Steam profile first.");
            const year = Number(url.searchParams.get("year")) || new Date().getUTCFullYear();
            if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new HttpError(400, "Pick a year from 2020 on.");
            const all = db.playRecapAll(s.userId);
            const goalHours = db.getHourGoal(s.userId), thisYear = year === new Date(now()).getUTCFullYear();
            const rec = db.playRecap(s.userId, year);
            return { ...rec, goal: goalHours && thisYear ? goalProgress(goalHours, rec.totalMinutes, now()) : null, allTime: { totalMinutes: all.totalMinutes, games: all.games, activeDays: all.activeDays }, since: db.getSteamLink(s.userId).linked_at };
        },

        "POST /api/steam/goal": async (req, body) => {
            const s = session(req);
            if (!db.getSteamLink(s.userId)) throw new HttpError(400, "Link your Steam profile first.");
            const hours = Number(body.hours);
            if (!Number.isInteger(hours) || hours < 0 || hours > 5000) throw new HttpError(400, "Pick a whole number of hours from 1 to 5000 (0 clears it).");
            db.setHourGoal(s.userId, hours);
            return { ok: true };
        },

        "GET /api/steam/next": async (req, _body, url) => {
            const s = session(req);
            const u = userRow(s);
            if (!db.getSteamLink(s.userId)) throw new HttpError(400, "Link your Steam profile first.");
            const skip = String(url.searchParams.get("skip") ?? "").split(",").filter(x => /^[\w-]{1,64}$/.test(x)).slice(0, 200);
            const view = await libraryView(db, itad, u, { snapshot: false });
            return { next: steamNext(view.rows, { skip }), currency: view.currency };
        },

        "POST /api/steam/link": async (req, body) => {
            const s = session(req);
            const undo = cooldown(s.userId, "steam");
            userRow(s);
            try {
                const steamid = String(body.profile ?? "").trim() ? await resolveProfile(String(body.profile), steamFetch) : db.getSteamLink(s.userId)?.steamid ?? (() => { throw new HttpError(400, "Sign in through Steam first."); })();
                return await syncSteamLibrary({ db, itad, userId: s.userId, steamid, apiKey: config.steamApiKey ?? null, fetchImpl: steamFetch });
            } catch (err) { undo(); throw err; }
        },

        "POST /api/steam/sync": async (req) => {
            const s = session(req);
            const undo = cooldown(s.userId, "steam");
            userRow(s);
            const link = db.getSteamLink(s.userId);
            if (!link) { undo(); throw new HttpError(400, "Link your Steam profile first."); }
            try { return await syncSteamLibrary({ db, itad, userId: s.userId, steamid: link.steamid, apiKey: config.steamApiKey ?? null, fetchImpl: steamFetch }); }
            catch (err) { undo(); throw err; }
        },

        "POST /api/steam/unlink": async (req, body) => {
            const s = session(req);
            userRow(s);
            if (!db.removeSteamLink(s.userId)) throw new HttpError(400, "No Steam profile is linked.");
            let removed = 0;
            if (body.removeGames === true) for (const g of db.listLibrary(s.userId).filter(g => g.appid)) if (db.removeLibrary(s.userId, g.itad_id)) removed++;
            return { ok: true, removed };
        },

        "GET /api/library/next": async (req, _body, url) => {
            const s = session(req);
            const skip = String(url.searchParams.get("skip") ?? "").split(",").filter(x => /^[\w-]{1,64}$/.test(x)).slice(0, 500);
            const view = await libraryView(db, itad, userRow(s), { snapshot: false });
            const n = playNext(view.rows, { skip });
            return { next: n ? { pick: n.pick, others: n.others, why: n.why, remaining: n.remaining } : null, totals: view.totals, currency: view.currency };
        },

        "POST /api/library/remove": async (req, body) => {
            const s = session(req);
            const item = db.listLibrary(s.userId).find(i => i.itad_id === body.itad_id);
            if (!item) throw new HttpError(404, "That game is not in your library.");
            db.removeLibrary(s.userId, item.itad_id);
            return { removed: item.title };
        },

        // ----- shared server list, leaderboard, group alerts -----
        "GET /api/servers/list": async (req, _b, url) => {
            const s = session(req);
            const g = guildFor(s, url.searchParams.get("guild"));
            const u = userRow(s);
            return { ...(await serverListView(db, itad, g.id, u)), manager: isManager(g) };
        },

        "POST /api/servers/list/add": async (req, body) => {
            const s = session(req);
            const g = guildFor(s, body.guild_id);
            cooldown(s.userId, "add");
            userRow(s);
            return await addToServerList(db, itad, g.id, s.userId, body.title);
        },

        "POST /api/servers/list/vote": async (req, body) => {
            const s = session(req);
            const g = guildFor(s, body.guild_id);
            const game = db.listServerGames(g.id, s.userId).find(x => x.itad_id === body.itad_id);
            if (!game) throw new HttpError(404, "That game is not on the server list.");
            const voted = db.toggleVote(game.id, s.userId);
            return { voted, votes: game.votes + (voted ? 1 : -1) };
        },

        "POST /api/servers/list/remove": async (req, body) => {
            const s = session(req);
            const g = guildFor(s, body.guild_id);
            const game = db.listServerGames(g.id, s.userId).find(x => x.itad_id === body.itad_id);
            if (!game) throw new HttpError(404, "That game is not on the server list.");
            return removeFromServerList(db, g.id, s.userId, game.title, isManager(g));
        },

        "GET /api/servers/leaderboard": async (req, _b, url) => {
            const s = session(req);
            const g = guildFor(s, url.searchParams.get("guild"));
            const which = url.searchParams.get("board");
            const finished = which === "finished";
            const entries = finished ? finishedLeague(db, g.id, now()) : EXTRA_BOARDS[which] ? extraBoard(db, g.id, which, now()) : leaderboard(db, g.id);
            const t = now();
            const out = [];
            for (const e of entries) {
                const key = `${g.id}:${e.discord_id}`;
                let hit = names.get(key);
                if (!hit || hit.until < t) {
                    hit = { name: await rest.memberName(g.id, e.discord_id).catch(() => null), until: t + 10 * 60_000 };
                    names.set(key, hit);
                    if (names.size > 2000) names.delete(names.keys().next().value);
                }
                out.push({ name: hit.name ?? "A member", savedPct: e.savedPct, games: e.games, done: e.done, label: e.label, you: e.discord_id === s.userId });
            }
            return { entries: out, joined: Boolean(userRow(s).share) };
        },

        "POST /api/servers/group": async (req, body) => {
            const s = session(req);
            const g = guildFor(s, body.guild_id);
            if (!isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            if (!db.getGuild(g.id)) throw new HttpError(400, "Set an alert channel for that server first.");
            const n = Number(body.minimum);
            if (!Number.isInteger(n) || n < 0 || n === 1 || n > 20) throw new HttpError(400, "Use 2 to 20, or 0 to turn it off.");
            db.setGroupMin(g.id, n);
            return { groupMin: n };
        },

        "POST /api/servers/hot": async (req, body) => {
            const s = session(req);
            const g = guildFor(s, body.guild_id);
            if (!isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            if (!db.getGuild(g.id)) throw new HttpError(400, "Set an alert channel for that server first.");
            const n = Math.round(Number(body.minimum));
            if (!Number.isFinite(n) || n < 0 || n > 95 || (n !== 0 && n < 30)) throw new HttpError(400, "Pick 30 to 95, or 0 to turn it off.");
            db.setHotMin(g.id, n);
            return { hotMin: n };
        },
        "POST /api/servers/sales": async (req, body) => {
            const s = session(req);
            const g = guildFor(s, body.guild_id);
            if (!isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            if (!db.getGuild(g.id)) throw new HttpError(400, "Set an alert channel for that server first.");
            db.setSaleFeed(g.id, Boolean(body.enabled));
            return { saleFeed: Boolean(body.enabled) };
        },
        "POST /api/servers/feed": async (req, body) => {
            const s = session(req);
            const g = guildFor(s, body.guild_id);
            if (!isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            if (!db.getGuild(g.id)) throw new HttpError(400, "Set an alert channel for that server first.");
            db.setFreeFeed(g.id, Boolean(body.enabled));
            return { freeFeed: Boolean(body.enabled) };
        },

        "POST /api/servers/digest": async (req, body) => {
            const s = session(req);
            const g = guildFor(s, body.guild_id);
            if (!isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            if (!db.getGuild(g.id)) throw new HttpError(400, "Set an alert channel for that server first.");
            db.setWeeklyDigest(g.id, Boolean(body.enabled));
            return { weeklyDigest: Boolean(body.enabled) };
        },

        // The same checklist as /manage setup in Discord.
        "GET /api/servers/channelmap": async (req, _b, url) => {
            const g = managerGuild(session(req), url.searchParams.get("guild"));
            return { guild: g.id, channels: cd.channelMap(g.id), alert: db.getGuild(g.id)?.channel_id ?? null };
        },
        "POST /api/servers/channelmap": async (req, body) => {
            const g = managerGuild(session(req), String(body.guild_id));
            return comm(() => cd.setChannel(g.id, String(body.key), body.channel_id || null));
        },
        "GET /api/servers/setup": async (req, _b, url) => {
            const s = session(req);
            const g = managerGuild(s, url.searchParams.get("guild"));
            return { ...setupStatus(db, g.id), gameNightOn: db.gameNightOn(g.id), staffRole: db.getTicketSettings(g.id).staff_role_id, bot: botGuilds ? Boolean(botGuilds(g.id)) : null };
        },

        "POST /api/servers/gamenight": async (req, body) => {
            const g = managerGuild(session(req), String(body.guild_id));
            db.setGameNight(g.id, Boolean(body.enabled));
            return { gameNight: Boolean(body.enabled) };
        },
        // Game night on the dashboard: pick opted-in members of a server and see what they can play and buy together.
        "GET /api/gamenight/members": async (req, _b, url) => {
            const s = session(req); const g = guildFor(s, url.searchParams.get("guild"));
            const ids = db.sharingMembers(g.id).slice(0, 60);
            return { members: await Promise.all(ids.map(async id => ({ id, name: (await rest.memberName(g.id, id)) || "Member " + id.slice(-4) }))) };
        },
        // The streamer's deals overlay for OBS: their own private link, no server needed.
        "GET /api/streamcard": async (req) => {
            const s = session(req), o = db.getStreamCard(s.userId), u = userRow(s);
            return { on: Boolean(o), token: o?.token ?? null, kinds: o?.kinds ?? STREAMCARD_KINDS, base: origin + "/streamcard", chat: o ? chatCommandSets(k => `${origin}/api/streamcard/text?token=${o.token}&kind=${k}`) : null, slug: u.profile_slug ?? null, public: Boolean(u.profile_public) };
        },
        "POST /api/streamcard": async (req, body) => {
            const s = session(req); userRow(s);
            if (body.action === "remove") { db.removeStreamCard(s.userId); return { on: false, token: null }; }
            if (body.action === "save") { if (!db.getStreamCard(s.userId)) throw new HttpError(404, "Make your link first."); db.setStreamCardKinds(s.userId, Array.isArray(body.kinds) ? body.kinds : []); return { on: true, kinds: db.getStreamCard(s.userId).kinds }; }
            if (body.action !== "create" && body.action !== "reset") throw new HttpError(400, "Unknown action.");
            const had = db.getStreamCard(s.userId), token = db.resetStreamCard(s.userId);
            if (had && body.action === "reset") db.setStreamCardKinds(s.userId, had.kinds);
            return { on: true, token, kinds: db.getStreamCard(s.userId).kinds };
        },
        // What the overlay page asks for. No sign-in: the long random link is the key. Answers are kept five minutes so OBS can ask often.
        "GET /api/streamcard/data": async (req, _b, url) => {
            if (!overlayLimit.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little.");
            const o = db.streamCardByToken(String(url.searchParams.get("token") ?? ""));
            if (!o) throw new HttpError(404, "This overlay link isn't valid. Make a new one on the Streamer hub.");
            return await cardsFor(o, o.kinds);
        },
        // The giveaway overlay's numbers: the giveaways the streamer picked (or, with no pick, their latest stream giveaway), with winners once drawn.
        "GET /api/giveawayoverlay/data": async (req, _b, url) => {
            if (!overlayLimit.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little.");
            const o = db.streamCardByToken(String(url.searchParams.get("token") ?? ""));
            if (!o) throw new HttpError(404, "This overlay link isn't valid. Make a new one on the Streamer hub.");
            const HOLD = 10 * 60_000, picked = gwOverlayPicks(o.user_id);
            let rows = picked.map(id => db.getGiveaway(id)).filter(g => g && (g.status === "active" || g.status === "scheduled" || now() - (g.ended_at ?? g.ends_at) <= HOLD));
            if (!rows.length) { const l = streamGw.latest(o.user_id); rows = l ? [l] : []; }
            const card = async g => {
                const keys = db.listKeys(g.id), over = g.status !== "active" && g.status !== "scheduled";
                const winners = over ? await Promise.all(keys.filter(k => k.winner_id).map(async k => ({ prize: k.label, name: (await remember("mname:" + g.guild_id + ":" + k.winner_id, 10 * 60_000, () => rest.memberName(g.guild_id, k.winner_id)).catch(() => null)) || "A viewer" }))) : [];
                return { id: g.id, title: g.title, game: g.game_title ?? null, prizes: keys.map(k => k.label), entries: db.countEntries(g.id), endsAt: g.ends_at, startedAt: g.starts_at ?? g.created_at, status: over ? "ended" : g.status, steps: stepsOf(g).map(x => ({ label: x.label, kind: x.kind })), winners, chat: Boolean(streamGw.chatFor(g.id)) };
            };
            return { giveaways: await Promise.all(rows.slice(0, 6).map(card)), now: now() };
        },
        // Which giveaways in a server the streamer can put on screen, and which are picked now.
        "GET /api/giveawayoverlay/pick": async (req, _b, url) => {
            const s = session(req), g = await streamAccess(s, url.searchParams.get("guild"));
            const picked = new Set(gwOverlayPicks(s.userId));
            const rows = db.listGiveaways(g.id, { limit: 50 }).filter(x => x.status === "active" || x.status === "scheduled");
            return { giveaways: rows.map(x => ({ id: x.id, title: x.title, status: x.status, endsAt: x.ends_at, entries: db.countEntries(x.id), prizes: db.listKeys(x.id).length, mine: x.host_id === s.userId, picked: picked.has(x.id) })) };
        },
        "POST /api/giveawayoverlay/pick": async (req, body) => {
            const s = session(req), g = await streamAccess(s, body.guild_id);
            const want = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Number.isInteger))].slice(0, 6);
            for (const id of want) { const x = db.getGiveaway(id); if (!x || x.guild_id !== g.id || !["active", "scheduled"].includes(x.status)) throw new HttpError(400, "One of those giveaways isn't running in this server."); }
            const keep = gwOverlayPicks(s.userId).filter(id => db.getGiveaway(id)?.guild_id !== g.id);
            const all = [...keep, ...want].slice(-6);
            db.setMeta("gwov:" + s.userId, JSON.stringify(all));
            return { ok: true, ids: all };
        },
        // The viewer's Twitch account, as Discord shows it. It is read from their Discord connections (never typed in), so it can't be faked.
        "GET /api/twitchlink": async (req) => { const s = session(req), l = db.getTwitchLink(s.userId); return { linked: Boolean(l), login: l?.login ?? null }; },
        "POST /api/twitchlink": async (req, body) => {
            const s = session(req);
            if (body.action !== "remove") throw new HttpError(400, "Unknown action.");
            return { linked: false, removed: db.removeTwitchLink(s.userId) };
        },
        // Game club: the server's game of the month. Anyone in the server can look; Manage Server changes it.
        "GET /api/club": async (req, _b, url) => {
            const s = session(req), g = guildFor(s, String(url.searchParams.get("guild") ?? ""));
            const club = db.getClub(g.id), canManage = isManager(g) || isOwner(s);
            const channels = canManage ? (await rest.listChannels(g.id).catch(() => [])).filter(c => c.type === undefined || c.type === 0 || c.type === 5).map(c => ({ id: c.id, name: c.name })) : [];
            if (!club?.title) return { club: null, canManage, channels, channel: club?.channel_id ?? null };
            const prog = clubProgress(db, club);
            const owners = await Promise.all(prog.owners.map(async r => ({ ...r, name: (await rest.memberName(g.id, r.userId).catch(() => null)) || "Member " + String(r.userId).slice(-4) })));
            return { club: { title: club.title, appid: club.appid, month: club.month, channel: club.channel_id }, owners, sharing: prog.sharing, canManage, channels, channel: club.channel_id };
        },
        "POST /api/club": async (req, body) => {
            const s = session(req), g = guildFor(s, String(body.guild_id ?? ""));
            if (!(isManager(g) || isOwner(s))) throw new HttpError(403, "You need the Manage Server permission to change the game club.");
            if (body.action === "off") { db.removeClub(g.id); return { ok: true }; }
            if (body.action === "channel") { const id = String(body.channel_id ?? ""); if (id && !(await rest.listChannels(g.id).catch(() => [])).some(c => c.id === id)) throw new HttpError(400, "That channel is not in this server."); db.setClub(g.id, { channel_id: id || null }); return { ok: true }; }
            if (body.action === "pick") { try { setPick(db, g.id, body.title, s.userId, now()); } catch (e) { throw new HttpError(400, e.message); } return { ok: true }; }
            throw new HttpError(400, "Unknown action.");
        },
        "GET /api/santa": async (req, _b, url) => {
            const s = session(req), g = guildFor(s, String(url.searchParams.get("guild") ?? ""));
            const ev = db.getSanta(g.id), canManage = isManager(g) || isOwner(s);
            const channels = canManage ? (await rest.listChannels(g.id).catch(() => [])).filter(c => c.type === undefined || c.type === 0 || c.type === 5).map(c => ({ id: c.id, name: c.name })) : [];
            if (!ev) return { event: null, canManage, channels };
            const entries = db.santaEntries(ev.id);
            const people = await Promise.all(entries.map(async e => ({ userId: e.user_id, name: (await rest.memberName(g.id, e.user_id).catch(() => null)) || "Member " + String(e.user_id).slice(-4) })));
            const mine = db.santaEntry(ev.id, s.userId);
            return { event: { id: ev.id, title: ev.title, budget: ev.budget, currency: ev.currency, status: ev.status, channel: ev.channel_id }, people, joined: Boolean(mine), drawn: Boolean(mine?.giftee_id), canManage, channels };
        },
        "POST /api/santa": async (req, body) => {
            const s = session(req), g = guildFor(s, String(body.guild_id ?? ""));
            const manager = isManager(g) || isOwner(s);
            const nameOf = async id => (await rest.memberName(g.id, id).catch(() => null)) || `<@${id}>`;
            const fail = e => { if (e instanceof UserError) throw new HttpError(400, e.message); throw e; };
            try {
                switch (body.action) {
                    case "join": return { ok: true, joined: joinEvent(db, g.id, s.userId).joined };
                    case "leave": return { ok: true, left: leaveEvent(db, g.id, s.userId).left };
                    case "ideas": {
                        const dm_ = await myAssignment({ db, itad, guildId: g.id, userId: s.userId, nameOf, guildName: g.name });
                        return { ok: true, text: dm_.embeds[0].description, title: dm_.embeds[0].title };
                    }
                }
                if (!manager) throw new HttpError(403, "You need the Manage Server permission for that.");
                if (body.action === "create") {
                    const channelId = String(body.channel_id ?? "");
                    if (channelId && !(await rest.listChannels(g.id).catch(() => [])).some(c => c.id === channelId)) throw new HttpError(400, "That channel isn't in this server.");
                    const ev = createEvent(db, { guildId: g.id, channelId: channelId || null, title: body.title, budget: body.budget, region: userRow(s).region || "US", by: s.userId });
                    if (channelId) await rest.sendMessage(channelId, { embeds: [eventEmbed(ev, [], { guildName: g.name })], allowed_mentions: { parse: [] } }).catch(() => {});
                    return { ok: true };
                }
                if (body.action === "draw") {
                    if (!dm) throw new HttpError(400, "Sending messages isn't available here.");
                    const r = await drawEvent({ db, itad, sendDm: (id, p) => dm(id, p), nameOf, guildName: g.name, guildId: g.id });
                    return { ok: true, count: r.count, failed: r.failed.length };
                }
                if (body.action === "reveal") {
                    const { event, entries } = endEvent(db, g.id);
                    if (event.channel_id) await rest.sendMessage(event.channel_id, { embeds: [revealEmbed(event, entries)], allowed_mentions: { parse: [] } }).catch(() => {});
                    return { ok: true };
                }
            } catch (e) { fail(e); }
            throw new HttpError(400, "Unknown action.");
        },
        "GET /api/trivia": async (req, _b, url) => {
            const s = session(req), g = guildFor(s, String(url.searchParams.get("guild") ?? ""));
            const canManage = isManager(g) || isOwner(s);
            const channels = canManage ? (await rest.listChannels(g.id).catch(() => [])).filter(c => c.type === undefined || c.type === 0 || c.type === 5).map(c => ({ id: c.id, name: c.name })) : [];
            if (!trivia) return { enabled: false, canManage, channels, active: null, top: [] };
            const top = await Promise.all(trivia.top(g.id, 10).map(async r => ({ userId: r.user_id, name: (await rest.memberName(g.id, r.user_id).catch(() => null)) || "Member " + String(r.user_id).slice(-4), points: r.points, correct: r.correct, wins: r.wins })));
            return { enabled: true, canManage, channels, active: trivia.active(g.id), top, mine: db.triviaRank(g.id, s.userId) };
        },
        "POST /api/trivia": async (req, body) => {
            const s = session(req), g = guildFor(s, String(body.guild_id ?? ""));
            if (!(isManager(g) || isOwner(s))) throw new HttpError(403, "You need the Manage Server permission to run trivia.");
            if (!trivia) throw new HttpError(400, "Trivia isn't available right now.");
            try {
                if (body.action === "start") {
                    const channelId = String(body.channel_id ?? "");
                    if (!(await rest.listChannels(g.id).catch(() => [])).some(c => c.id === channelId)) throw new HttpError(400, "Pick a channel in this server.");
                    const r = await trivia.start({ guildId: g.id, channelId, rounds: body.rounds, by: s.userId });
                    return { ok: true, rounds: r.rounds };
                }
                if (body.action === "stop") { trivia.stop(g.id); return { ok: true }; }
            } catch (e) { if (e instanceof UserError) throw new HttpError(400, e.message); throw e; }
            throw new HttpError(400, "Unknown action.");
        },
        "GET /api/nowplaying": async (req, _b, url) => {
            // Same rules as /server nowplaying: members who turned it on (/alerts nowplaying) and share their library.
            const s = session(req);
            const g = guildFor(s, String(url.searchParams.get("guild") ?? ""));
            if (!nowPlaying?.enabled) return { enabled: false, games: [], watching: 0 };
            const r = await whoIsPlaying(db, nowPlaying, g.id);
            const games = await Promise.all(r.games.map(async x => ({ appid: x.appid, game: x.game, players: await Promise.all(x.players.map(async p => ({ userId: p.userId, name: (await rest.memberName(g.id, p.userId).catch(() => null)) || p.name || "Member " + String(p.userId).slice(-4) }))) })));
            return { enabled: true, games, watching: r.watching };
        },
        "GET /api/compare": async (req, _b, url) => {
            // Same rules as /server compare: a friend in one of your servers who turned on sharing (/alerts share).
            const s = session(req);
            const g = guildFor(s, String(url.searchParams.get("guild") ?? ""));
            const them = String(url.searchParams.get("user") ?? "");
            if (them === s.userId) throw new HttpError(400, "Pick someone else.");
            if (!db.sharingMembers(g.id).includes(them)) throw new HttpError(403, "That member has not opted in with /alerts share.");
            const r = compareLibraries(db, s.userId, them);
            const name = (await rest.memberName(g.id, them).catch(() => null)) || "Member " + them.slice(-4);
            return { name, ...r, shared: r.shared.slice(0, 300), onlyA: r.onlyA.slice(0, 300), onlyB: r.onlyB.slice(0, 300) };
        },
        "GET /api/lfg": async (req, _b, url) => {
            const s = session(req);
            const g = guildFor(s, String(url.searchParams.get("guild") ?? ""));
            const posts = db.listOpenLfg(g.id);
            const ids = [...new Set(posts.flatMap(p => [p.creator_id, ...db.lfgMembers(p.id)]))].slice(0, 40);
            const names = Object.fromEntries(await Promise.all(ids.map(async id => [id, (await rest.memberName(g.id, id).catch(() => null)) || "Member " + id.slice(-4)])));
            return { me: s.userId, manageable: isManager(g), posts: posts.map(p => {
                const members = db.lfgMembers(p.id);
                return { id: p.id, game: p.game, starts_at: p.starts_at, slots: p.slots, note: p.note, host: names[p.creator_id] ?? p.creator_id, members: members.map(m => names[m] ?? "Member " + m.slice(-4)),
                    joined: members.includes(s.userId), canClose: p.creator_id === s.userId || isManager(g), url: p.message_id ? `https://discord.com/channels/${p.guild_id}/${p.channel_id}/${p.message_id}` : null };
            }) };
        },

        "POST /api/lfg": async (req, body) => {
            const s = session(req);
            if (!lfg) throw new HttpError(503, "Looking for group is not available.");
            const g = managerGuild(s, String(body.guild_id));
            let channels;
            try { channels = await rest.listChannels(g.id); } catch { throw new HttpError(400, "The bot is not in that server yet. Invite it first."); }
            const channelId = String(body.channel_id ?? "");
            if (!channels.some(c => c.id === channelId)) throw new HttpError(400, "Pick one of the server's text channels.");
            const startsAt = Number(body.starts_at);
            const { post, eventError } = await lfg.create({ guildId: g.id, channelId, creatorId: s.userId, game: body.game, startsAt, slots: body.slots, note: body.note, event: body.event === true });
            return { id: post.id, eventError };
        },

        "POST /api/lfg/join": async (req, body) => {
            const s = session(req);
            if (!lfg) throw new HttpError(503, "Looking for group is not available.");
            const g = guildFor(s, String(body.guild_id));
            const p = db.getLfg(Number(body.id));
            if (!p || p.guild_id !== g.id) throw new HttpError(404, "I can't find that post.");
            return { result: (await lfg.join(p.id, s.userId)).result };
        },

        "POST /api/lfg/leave": async (req, body) => {
            const s = session(req);
            if (!lfg) throw new HttpError(503, "Looking for group is not available.");
            const g = guildFor(s, String(body.guild_id));
            const p = db.getLfg(Number(body.id));
            if (!p || p.guild_id !== g.id) throw new HttpError(404, "I can't find that post.");
            await lfg.leave(p.id, s.userId);
            return { ok: true };
        },

        "POST /api/lfg/close": async (req, body) => {
            const s = session(req);
            if (!lfg) throw new HttpError(503, "Looking for group is not available.");
            const g = guildFor(s, String(body.guild_id));
            const p = db.getLfg(Number(body.id));
            if (!p || p.guild_id !== g.id) throw new HttpError(404, "I can't find that post.");
            await lfg.close(p.id, s.userId, { canManage: isManager(g) });
            return { ok: true };
        },

        "GET /api/coop": async (req, _b, url) => {
            const s = session(req); const g = guildFor(s, String(url.searchParams.get("guild") ?? ""));
            const title = String(url.searchParams.get("game") ?? "").trim().slice(0, 100);
            if (!title) throw new HttpError(400, "Type a game name first.");
            const [hit] = await itad.lookupTitles([title]);
            if (!hit?.id) throw new HttpError(404, `I could not find a game called ${title}.`);
            const owners = await Promise.all(db.ownersOf(g.id, hit.id).map(async o => ({ name: (await rest.memberName(g.id, o.discord_id)) || "Member " + o.discord_id.slice(-4), hours: Math.round((o.minutes ?? 0) / 60) })));
            return { game: hit.approx ? hit.matched : title, owners };
        },
        "POST /api/gamenight": async (req, body) => {
            const s = session(req); const g = guildFor(s, String(body.guild_id));
            const allowed = new Set(db.sharingMembers(g.id));
            const ids = (Array.isArray(body.user_ids) ? body.user_ids : []).map(String).filter(id => allowed.has(id));
            const r = await gameNight({ db, itad, userIds: ids, region: userRow(s).region }).catch(e => { if (e.constructor?.name === "UserError") throw new HttpError(400, e.message); throw e; });
            const names = Object.fromEntries(await Promise.all(r.people.map(async id => [id, (await rest.memberName(g.id, id)) || "Member " + id.slice(-4)])));
            const n = id => names[id] ?? id;
            return { people: r.people.map(n), hidden: r.hidden, allOwn: r.allOwn.map(x => x.title), almost: r.almost.map(x => ({ title: x.title, missing: x.missing.map(n) })),
                buy: r.buy.map(b => ({ title: b.title, wanters: b.wanters.map(n), price: b.now?.price ?? null, currency: b.now?.currency ?? "USD", shop: b.now?.shop ?? null, discount: b.now?.discount ?? 0 })) };
        },

        "GET /api/servers/forums": async (req, _b, url) => {
            const s = session(req);
            const g = managerGuild(s, url.searchParams.get("guild"));
            try { return { forums: await rest.listForums(g.id) }; }
            catch (err) { if (err instanceof DiscordApiError && [403, 404].includes(err.status)) throw new HttpError(400, "The bot is not in that server yet. Invite it first."); throw err; }
        },

        "POST /api/servers/setup/auto": async (req, body) => {
            const s = session(req);
            const g = managerGuild(s, String(body.guild_id));
            if (botGuilds && !botGuilds(g.id)) throw new HttpError(400, "The bot is not in that server yet. Invite it first.");
            const roles = body.staff_role_id ? await rest.listRoles(g.id).catch(() => []) : [];
            const staffRoleId = body.staff_role_id && roles.some(r => r.id === body.staff_role_id) ? body.staff_role_id : null;
            try { return { ...(await autoSetup({ api: rest, db, guildId: g.id, botId: config.clientId, userId: s.userId, staffRoleId })), status: setupStatus(db, g.id) }; }
            catch (e) { if (e.userFacing) throw new HttpError(400, e.message); if (e instanceof DiscordApiError && e.status === 403) throw new HttpError(400, "I need the Manage Channels permission to create channels."); throw e; }
        },

        // ---- community: welcome, XP and levels, invites and referrals, emoji, one-click server build ----
        "GET /api/community": async (req, _b, url) => {
            const s = session(req); const g = guildFor(s, url.searchParams.get("guild"));
            return comm(async () => ({ bot: botGuilds ? Boolean(botGuilds(g.id)) : null, ...(await cd.overview(g.id, s.userId, isManager(g))) }));
        },
        "GET /api/community/rank": async (req, _b, url) => {
            const s = session(req); const g = guildFor(s, url.searchParams.get("guild"));
            return comm(async () => { const o = await cd.overview(g.id, s.userId, false); return o.me; });
        },
        "GET /api/community/leaderboard": async (req, _b, url) => {
            const s = session(req); const g = guildFor(s, url.searchParams.get("guild"));
            return comm(async () => ({ top: (await cd.overview(g.id, s.userId, false)).xpTop }));
        },
        "GET /api/community/invites": async (req, _b, url) => {
            const s = session(req); const g = guildFor(s, url.searchParams.get("guild"));
            return comm(async () => { const o = await cd.overview(g.id, s.userId, false); return { me: o.me.invites, top: o.inviteTop, rewards: o.rewards }; });
        },
        "POST /api/community/invite-link": async (req, body) => {
            const s = session(req); const g = guildFor(s, String(body.guild_id)); botIn(g);
            cooldown(s.userId, "clink");
            return comm(() => cd.inviteLink(g.id, s.userId));
        },
        "POST /api/community/setup": async (req, body) => {
            const s = session(req); const g = managerGuild(s, String(body.guild_id)); botIn(g);
            cooldown(s.userId, "csetup");
            return comm(() => cd.setup(g.id, s.userId));
        },
        "POST /api/community/verify": async (req, body) => {
            const s = session(req); const g = guildFor(s, String(body.guild_id)); botIn(g);
            return comm(() => cd.verify(g.id, s.userId));
        },
        "POST /api/community/verifyrole": async (req, body) => comm(() => cd.verifyRole(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/welcome": async (req, body) => comm(() => cd.welcome(managerGuild(session(req), String(body.guild_id)).id, body)),
        // What the picture card in the welcome message looks like, drawn for the manager asking and this server's name.
        "POST /api/community/welcome/preview": async (req, body) => {
            const s = session(req), g = managerGuild(s, String(body.guild_id));
            cooldown(s.userId, "cardimg");
            const live = (guildList ? guildList() : []).find(x => x.id === g.id);
            const png = await renderWelcomeCard({ name: s.username ?? "New member", server: live?.name ?? g.name ?? "Your server", count: Math.max(1, Number(live?.members) || 100) + 1 });
            return { image: "data:image/png;base64," + Buffer.from(png).toString("base64") };
        },
        "POST /api/community/support": async (req, body) => comm(() => cd.support(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/ai-models": async (req, body) => comm(() => cd.aiModels(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/places": async (req, body) => comm(() => cd.places(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/rules": async (req, body) => comm(() => cd.rules(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/announce": async (req, body) => {
            const s = session(req), g = managerGuild(s, String(body.guild_id));
            const undo = cooldown(s.userId, "announce");
            try { return await comm(() => cd.announce(g.id, body, s.userId)); } catch (e) { undo(); throw e; }
        },
        "POST /api/community/leaderboard": async (req, body) => {
            const s = session(req), g = managerGuild(s, String(body.guild_id));
            const undo = body.refresh ? cooldown(s.userId, "lbrefresh") : () => {};
            try { return await comm(() => cd.leaderboard(g.id, body)); } catch (e) { undo(); throw e; }
        },
        "POST /api/community/memes": async (req, body) => {
            const s = session(req), g = managerGuild(s, String(body.guild_id));
            const undo = body.now ? cooldown(s.userId, "memenow") : () => {};
            try { return await comm(() => cd.memesSettings(g.id, body)); } catch (e) { undo(); throw e; }
        },
        // Posts what is listed right now into the playtest channel (not only new ones). Server managers only, once a minute.
        "POST /api/community/playtests": async (req, body) => {
            const s = session(req), g = managerGuild(s, String(body.guild_id));
            if (!playtests) throw new HttpError(503, "Playtests are not set up on this bot.");
            const undo = cooldown(s.userId, "ptrefresh");
            try {
                const r = await comm(() => playtests.refresh(g.id, { limit: body.count }));
                if (!r.posted) { undo(); return { ok: true, posted: 0, found: r.found }; }
                return { ok: true, posted: r.posted, found: r.found };
            } catch (e) { undo(); if (e instanceof UserError) throw new HttpError(400, e.message); throw e; }
        },
        "POST /api/community/pings": async (req, body) => comm(() => cd.pings(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/guides": async (req, body) => { const s = session(req); return comm(() => cd.guides(managerGuild(s, String(body.guild_id)).id, body, s.userId ?? s.id ?? null)); },
        "POST /api/community/autorole": async (req, body) => comm(() => cd.autorole(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/xp": async (req, body) => comm(() => cd.xp(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/levelrole": async (req, body) => comm(() => cd.levelrole(managerGuild(session(req), String(body.guild_id)).id, body)),
        "POST /api/community/referral": async (req, body) => comm(() => cd.referral(managerGuild(session(req), String(body.guild_id)).id, body)),
        "GET /api/community/emoji": async (req, _b, url) => comm(() => cd.emojiList(managerGuild(session(req), url.searchParams.get("guild")).id)),
        "GET /api/community/xp": async (req, _b, url) => {
            const s = session(req); const g = guildFor(s, url.searchParams.get("guild"));
            return comm(async () => ({ bot: botGuilds ? Boolean(botGuilds(g.id)) : null, ...(await cd.xpPage(g.id, s.userId, isManager(g), url.searchParams.get("page"))) }));
        },
        "GET /api/mod": async (req, _b, url) => {
            const s = session(req); const g = modGuild(s, url.searchParams.get("guild"), "moderate"); botIn(g);
            return modr(() => md.overview(g.id, { manager: isManager(g), perms: Object.keys(MOD_PERMS).filter(k => hasGuildPerm(g, k)) }));
        },
        "GET /api/mod/cases": async (req, _b, url) => {
            const s = session(req); const g = modGuild(s, url.searchParams.get("guild"), "moderate");
            return modr(() => md.cases(g.id, url.searchParams.get("user"), url.searchParams.get("page")));
        },
        "POST /api/mod/action": async (req, body) => {
            const s = session(req); const action = String(body.action ?? "");
            if (!MOD_ACTION_PERM[action]) throw new HttpError(400, "Choose an action.");
            const g = modGuild(s, String(body.guild_id), MOD_ACTION_PERM[action]); botIn(g);
            const undo = cooldown(s.userId, "mod");
            try { return await modr(() => md.act(g.id, s.userId, action, body)); } catch (e) { undo(); throw e; }
        },
        "POST /api/mod/clearwarns": async (req, body) => {
            const s = session(req); const g = modGuild(s, String(body.guild_id), "moderate");
            return modr(() => md.clearWarns(g.id, body.user));
        },
        "POST /api/mod/log": async (req, body) => {
            const s = session(req); const g = modGuild(s, String(body.guild_id), "manageGuild"); botIn(g);
            return modr(() => md.setLog(g.id, body.channel_id));
        },
        "POST /api/community/emoji": async (req, body) => {
            const s = session(req); const g = managerGuild(s, String(body.guild_id)); botIn(g);
            const undo = cooldown(s.userId, "cemoji"); // a refused request does not use up the wait
            try {
                if (body.image_data) return await comm(() => cd.emojiUpload(g.id, body.name, body.image_data));
                return await comm(() => cd.emojiImport(g.id, String(body.text ?? "").slice(0, 5000)));
            } catch (e) { undo(); throw e; }
        },

        "GET /api/community/emoji-packs": async (req, _b, url) => {
            const s = session(req); managerGuild(s, url.searchParams.get("guild"));
            cooldown(s.userId, "cemojipacks");
            return comm(() => cd.emojiPacks(url.searchParams.get("sort") ?? "recent", Number(url.searchParams.get("page") ?? 1)));
        },
        "GET /api/community/emoji-pack": async (req, _b, url) => {
            const s = session(req); managerGuild(s, url.searchParams.get("guild"));
            cooldown(s.userId, "cemojipack");
            return comm(() => cd.emojiPack(url.searchParams.get("key")));
        },
        "POST /api/community/emoji-pack": async (req, body) => {
            const s = session(req); const g = managerGuild(s, String(body.guild_id)); botIn(g);
            const undo = cooldown(s.userId, "cemojipackimp");
            try { return await comm(() => cd.emojiPackImport(g.id, String(body.key ?? ""), body.ids)); } catch (e) { undo(); throw e; }
        },

        "GET /api/servers/stats": async (req, _b, url) => {
            const s = session(req);
            const g = guildFor(s, url.searchParams.get("guild"));
            return serverStats(db, g.id);
        },

        // ----- free games right now, grouped by platform -----
        // Live numbers for the About panel. Aggregate only, so it is open to everyone like the Help page.
        "GET /api/about": async () => {
            let freeNow = null; // a count only: shown on the home page as "N free offers live right now"
            try { freeNow = (await itad.getGiveawayList()).filter(g => /^https:\/\//i.test(g.url ?? "")).length; } catch { /* the page just leaves it out */ }
            return { about: botInfo ? botInfo() : null, creator: config.creator ?? null, freeNow };
        },

        // Public, like /bot about: aggregate health only, nothing about any person.
        "GET /api/status": async () => {
            if (!status) throw new HttpError(404, "Status is not available.");
            const info = botInfo ? botInfo() : null, mem = process.memoryUsage();
            return {
                ...status.snapshot(),
                telemetry: {
                    version: info?.version ?? null, node: process.version, discordjs: djsVersion, uptime: info?.uptime ?? null, pingMs: info?.pingMs ?? null,
                    heapMb: Math.round(mem.heapUsed / 1048576), rssMb: Math.round(mem.rss / 1048576), region: process.env.FLY_REGION ?? null
                },
                stats: info ? { servers: info.servers, members: info.members, gamesWatched: info.gamesWatched, alerts24h: info.alerts24h } : null
            };
        },

        "GET /api/profile": async (req) => { const s = session(req); const u = userRow(s); return { slug: u.profile_slug ?? null, public: Boolean(u.profile_public), claims: db.countGiftClaims(s.userId), giftsPaused: db.giftsPaused(s.userId) }; },
        "POST /api/profile": async (req, body) => {
            const s = session(req); userRow(s);
            const r = setProfile(db, s.userId, { enabled: Boolean(body.enabled), slug: body.slug });
            const cleared = body.resetClaims ? db.clearGiftClaims(s.userId) : 0;
            return { ...r, cleared, claims: db.countGiftClaims(s.userId) };
        },
        // Public on purpose (anyone with the link), but only for members who switched their page on.
        // ---------- full profiles ----------
        // The owner's editor: saved settings, the choices the editor offers, and a preview exactly as visitors would see it.
        "GET /api/profile/page": async (req) => {
            const s = session(req); const u = userRow(s);
            return await profileEditorPayload(u);
        },
        // The member's own birthday (month and day). Shared only when they tick the box, and then only as a reminder for people who have their page on their friends list.
        "POST /api/profile/birthday": async (req, body) => { const s = session(req); userRow(s); return saveOwnBirthday(db, s.userId, { birthday: body.birthday, share: body.share }); },
        "POST /api/profile/page": async (req, body) => {
            const s = session(req); const u = userRow(s);
            const { data } = db.getProfileData(s.userId);
            const next = cleanProfile(body ?? {}, data);
            if (next.theme && PROFILE_THEMES[next.theme]?.supporter && next.theme !== data.theme && !isSupporter(db, s.userId, now())) throw new HttpError(403, "That theme is for supporters. You can get a pass on the Chip in page.");
            if (next.style && PROFILE_STYLES[next.style]?.supporter && next.style !== data.style && !isSupporter(db, s.userId, now())) throw new HttpError(403, "That style is for supporters. You can get a pass on the Chip in page.");
            db.setProfileData(s.userId, next);
            return await profileEditorPayload(db.getUser(s.userId));
        },
        // The picture behind the page: upload one (a few are kept), copy the Steam background, switch between them, or delete one.
        "POST /api/profile/background": async (req, body) => {
            const s = session(req); const u = userRow(s);
            if (!bgLimit.hit(s.userId).ok) throw new HttpError(429, "Slow down a little.");
            const { data } = db.getProfileData(s.userId);
            const setActive = (bg) => db.setProfileData(s.userId, cleanProfile({ pagebg: bg }, data));
            const action = String(body.action ?? "");
            if (action === "upload") {
                let img; try { img = decodeUpload(body.data); } catch (e) { throw new HttpError(400, e.message); }
                if (db.countProfileBgs(s.userId) >= MAX_BG_STORED) throw new HttpError(400, `You can keep up to ${MAX_BG_STORED} pictures. Delete one first.`);
                setActive({ kind: "image", image: db.addProfileBg(s.userId, img.mime, img.buf, "upload") });
            } else if (action === "steam") {
                const link = db.getSteamLink(s.userId);
                if (!link) throw new HttpError(400, "Link your Steam account first (Steam page, or /steam link).");
                let img; try { img = await fetchSteamBackground(link.steamid, steamFetch); } catch (e) { throw new HttpError(502, e.message); }
                if (!img) throw new HttpError(404, "No background found on your Steam profile. Equip one there first, and make sure the profile is public.");
                if (img.video) { setActive({ kind: "video", video: img.video }); return await profileEditorPayload(db.getUser(s.userId)); }
                db.deleteSteamProfileBg(s.userId);
                if (db.countProfileBgs(s.userId) >= MAX_BG_STORED) throw new HttpError(400, `You can keep up to ${MAX_BG_STORED} pictures. Delete one first.`);
                setActive({ kind: "image", image: db.addProfileBg(s.userId, img.mime, img.buf, "steam") });
            } else if (action === "use") {
                const row = db.getProfileBg(Number(body.id));
                if (!row || row.discord_id !== s.userId) throw new HttpError(404, "That picture is not yours.");
                setActive({ kind: "image", image: row.id });
            } else if (action === "remove") {
                const row = db.getProfileBg(Number(body.id));
                if (!row || row.discord_id !== s.userId || !db.deleteProfileBg(s.userId, row.id)) throw new HttpError(404, "That picture is not yours.");
                if (data.pagebg?.image === row.id) setActive({ kind: "none", image: null });
            } else throw new HttpError(400, "Unknown action.");
            return await profileEditorPayload(db.getUser(s.userId));
        },
        // Preview unsaved changes. Nothing is stored.
        "POST /api/profile/preview": async (req, body) => {
            const s = session(req); const u = userRow(s);
            if (!u.profile_slug) throw new HttpError(400, "Choose a page name first.");
            const draft = withDefaults(cleanProfile(body ?? {}, {}));
            return { profile: await buildProfile({ db, itad, nowPlaying }, u, { owner: true, sameServer: true }, { draft }) };
        },
        // Public on purpose: anyone with the link sees what the owner chose to show, and only that.
        "GET /api/public/profile": async (req, _b, url) => {
            const owner = db.getProfileBySlug(String(url.searchParams.get("slug") ?? "").toLowerCase());
            if (!owner || !owner.profile_public || db.getProfileData(owner.discord_id).blocked) throw new HttpError(404, "That page does not exist or is private.");
            if (rt && !rt.get("profiles_enabled") && !(softSession(req)?.userId === owner.discord_id)) throw new HttpError(404, "Profile pages are switched off for now. Check back later.");
            const sess = softSession(req);
            const mine = Boolean(sess && sess.userId === owner.discord_id);
            const sameServer = Boolean(mine || (sess && owner.guild_id && !isHidden(owner.guild_id) && sess.guilds.some(g => g.id === owner.guild_id)));
            const profile = await buildProfile({ db, itad, nowPlaying }, owner, { owner: mine, sameServer }, { viewerId: sess?.userId ?? null });
            if (rt && !rt.get("profile_songs")) { if (profile.song && profile.owner) profile.songOff = true; profile.song = null; profile.enter = false; }
            const wl = profile.sections.find(x => x.key === "wishlist");
            const canMark = Boolean(sess && owner.guild_id && !isHidden(owner.guild_id) && isStaff(sess.guilds.find(x => x.id === owner.guild_id)));
            return { profile, canMark, signedIn: Boolean(sess), hasWishlist: Boolean(wl), social: { ...db.followCounts(owner.discord_id), me: mine, iFollow: Boolean(sess && !mine && db.isFollowing(sess.userId, owner.discord_id)), canFollow: Boolean(sess && !mine && !db.blockedEither(sess.userId, owner.discord_id)), blocked: Boolean(sess && !mine && db.blockedEither(sess.userId, owner.discord_id)) }, region: sess && !mine ? compareGiftRegions(db, sess.userId, owner.discord_id) : null };
        },
        "POST /api/public/profile/report": async (req, body) => {
            if (!giftLimit.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little.");
            const owner = db.getProfileBySlug(String(body.slug ?? "").toLowerCase());
            if (!owner || !owner.profile_public) throw new HttpError(404, "That page does not exist or is private.");
            const reason = String(body.reason ?? "").trim().slice(0, 300);
            if (reason.length < 3) throw new HttpError(400, "Say briefly what is wrong with it.");
            db.addProfileReport(owner.profile_slug, reason);
            if (config.ownerId) { try { db.addNotification(config.ownerId, { type: "report", title: "A profile was reported", body: `/u/${owner.profile_slug}: ${reason}` }); } catch { /* the list below still has it */ } }
            return { ok: true };
        },
        // ---- the bot owner's live settings and the AI companion ----
        "GET /api/admin/settings": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            if (!rt) throw new HttpError(503, "Live settings are not available here.");
            return rt.view();
        },
        "POST /api/admin/settings": async (req, body) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            if (!rt) throw new HttpError(503, "Live settings are not available here.");
            const changed = rt.set(body.patch);
            if (changed.length) db.logAudit({ actor: session(req).userId, action: "settings", target: null, detail: `changed ${changed.join(", ")}`.slice(0, 200) });
            return { ...rt.view(), changed };
        },
        "GET /api/admin/ai": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            if (!rt) throw new HttpError(503, "Live settings are not available here.");
            const names = new Map((guildList?.() ?? []).map(g => [g.id, g.name]));
            const view = rt.view();
            const rows = new Map();
            const row = id => { if (!rows.has(id)) rows.set(id, { id, name: names.get(id) ?? null }); return rows.get(id); };
            for (const c of db.allCommunity()) if (c.ai_on) Object.assign(row(c.guild_id), { on: true, channel: c.ai_channel ?? null });
            for (const c of db.allCommunity()) { if (c.ai_key) row(c.guild_id).ownKey = true; if (c.ai_plus) row(c.guild_id).plus = true; if (c.ai_plus_interest) row(c.guild_id).interested = true; }
            if (config.mainGuild?.id()) row(config.mainGuild.id()).main = true;
            for (const id of Object.keys(view.serverCaps)) row(id);
            for (const id of view.blockedServers) row(id);
            for (const m of db.listMetaPrefix("aiday:")) row(m.key.slice(6));
            const servers = [...rows.values()].map(r => ({ ...r, on: Boolean(r.on), ownKey: Boolean(r.ownKey), plus: Boolean(r.plus), interested: Boolean(r.interested), main: Boolean(r.main), used: aiUsedToday(db, r.id), cap: rt.serverCap(r.id), blocked: rt.isServerBlocked(r.id) })).sort((a, b) => b.used - a.used || String(a.name).localeCompare(String(b.name)));
            return { ...view, lite: config.aiLite !== false, available: Boolean(config.aiAvailable), phrase: Boolean(config.aiPhrase), stats: aiStats(db, 14), servers, lastError: db.getMeta("ai:lasterr") ?? null };
        },
        "POST /api/admin/ai/block": async (req, body) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            if (!rt) throw new HttpError(503, "Live settings are not available here.");
            const on = body.on !== false;
            if (body.kind === "user") rt.blockUser(body.id, on); else if (body.kind === "server") rt.blockServer(body.id, on); else throw new HttpError(400, "Block a user or a server.");
            return { ok: true };
        },
        "POST /api/admin/ai/server": async (req, body) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            if (!rt) throw new HttpError(503, "Live settings are not available here.");
            const id = String(body.id ?? "");
            if (body.cap !== undefined) rt.setServerCap(id, body.cap);
            if (body.resetToday) db.setMeta(`aiday:${id}`, "");
            if (body.turnOff) db.setCommunity(id, { ai_on: 0 });
            if (body.plus !== undefined) db.setCommunity(id, { ai_plus: body.plus ? 1 : 0 });
            return { ok: true };
        },
        "POST /api/admin/ai/models": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            if (!rt || !config.aiKey) throw new HttpError(400, "The bot has no AI key yet.");
            const provider = rt.get("ai_provider");
            const r = await listModels({ provider, apiKey: config.aiKey }).catch(() => ({ ok: false, status: 0, error: "could not be reached" }));
            if (!r.ok) throw new HttpError(400, `The service answered ${r.status || "with an error"}${r.error ? ` (${r.error})` : ""}.`);
            return { provider, models: r.models };
        },
        "POST /api/admin/ai/test": async (req, body) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            if (!ai) throw new HttpError(503, "The AI companion is not available here.");
            const q = String(body.question ?? "").trim().slice(0, 500);
            if (!q) throw new HttpError(400, "Type a question to try.");
            return await ai.test(q, session(req).userId);
        },

        "GET /api/admin/profiles": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            return { reports: db.listProfileReports().map(r => ({ ...r, hidden: Boolean(db.getProfileBySlug(r.slug) && db.getProfileData(db.getProfileBySlug(r.slug).discord_id).blocked) })) };
        },
        "POST /api/admin/profiles": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            const owner = db.getProfileBySlug(String(body.slug ?? "").toLowerCase());
            if (!owner) throw new HttpError(404, "No profile with that name.");
            if (body.action === "hide" && owner.discord_id === config.ownerId) throw new HttpError(400, "You can't hide your own page.");
            if (body.action === "dismiss") db.clearProfileReports(owner.profile_slug);
            else db.blockProfile(owner.discord_id, body.action === "hide");
            return { ok: true };
        },

        "GET /api/public/wishlist": async (req, _b, url) => {
            const page = await publicWishlist(db, itad, url.searchParams.get("slug"), softSession(req)?.userId ?? null);
            if (!page) throw new HttpError(404, "That page does not exist or is private.");
            // Staff of the member's server get the "Up for giveaway" button; everyone else just sees which games are marked.
            const s = softSession(req);
            const canMark = Boolean(s && page.guild_id && !isHidden(page.guild_id) && isStaff(s.guilds.find(x => x.id === page.guild_id)));
            const { guild_id: _g, ...rest } = page;
            // The color picked for their profile page also tints their wishlist page. Only the fixed theme colors can come out of this.
            const owner = db.getProfileBySlug(page.slug);
            const accent = owner ? PROFILE_THEMES[withDefaults(db.getProfileData(owner.discord_id).data).theme]?.accent ?? null : null;
            return { ...rest, canMark, accent, signedIn: Boolean(s), owner: Boolean(s && owner && s.userId === owner.discord_id), region: s && owner && s.userId !== owner.discord_id ? compareGiftRegions(db, s.userId, owner.discord_id) : null };
        },
        // Moderators and owners flag a wishlist game as "up for giveaway soon". It lives in the member's server, so only that server's staff can do it.
        "POST /api/wishlist/soon": async (req, body) => {
            const s = session(req);
            const owner = db.getProfileBySlug(String(body.slug ?? "").toLowerCase());
            if (!owner || !owner.profile_public || !owner.guild_id) throw new HttpError(404, "That page does not exist or is private.");
            const g = s.guilds.find(x => x.id === owner.guild_id);
            if (!isStaff(g) || isHidden(owner.guild_id)) throw new HttpError(403, "Only moderators and owners of this member's server can do that.");
            const id = String(body.id ?? "");
            const item = db.listItems(owner.discord_id).find(i => i.itad_id === id && i.source !== "watch");
            if (!item) throw new HttpError(404, "That game is not on this list.");
            if (body.on === false) { db.unmarkSoon(owner.guild_id, id); return { soon: false }; }
            const r = db.markSoon(owner.guild_id, { itad_id: id, title: item.title, art: artUrl(item) ?? null }, s.userId);
            if (r === "full") throw new HttpError(429, "You can mark up to 50 games as up for giveaway. Remove one first.");
            return { soon: true };
        },
        // What members see: games their servers' staff marked for future giveaways.
        "GET /api/giveaways/soon": async (req) => {
            const s = session(req);
            const names = new Map(s.guilds.map(g => [g.id, g.name]));
            return { games: db.listSoon([...names.keys()]).map(x => ({ ...x, server: names.get(x.guild_id) })) };
        },
        // Marking a gift needs a Discord sign-in, so a mark belongs to a real account that can be limited or blocked. The list's owner is never told who.
        "POST /api/public/gift": async (req, body) => {
            const s = session(req);
            if (!giftLimit.hit(clientIp(req)).ok || !giftLimit.hit("u" + s.userId).ok) throw new HttpError(429, "Slow down a little.");
            const owner = db.getProfileBySlug(String(body.slug ?? "").toLowerCase());
            if (!owner || !owner.profile_public) throw new HttpError(404, "That page does not exist or is private.");
            if (owner.discord_id === s.userId) throw new HttpError(400, "That is your own list. Someone else marks the gifts.");
            const id = String(body.id ?? "");
            const game = db.listItems(owner.discord_id).find(g => g.itad_id === id && g.source !== "watch");
            if (!game) throw new HttpError(404, "That game is not on this list.");
            if (body.claim === false) return { claim: db.unclaimGift(owner.discord_id, id, s.userId) ? null : "taken" };
            if (db.giftsPaused(owner.discord_id)) throw new HttpError(403, "Gift marks are switched off on this list right now.");
            if (s.userId !== config.ownerId) {
                if (db.isGiftBanned(s.userId)) throw new HttpError(403, "Gift marks are turned off for your account.");
                if (!accountOldEnough(s.userId, now())) throw new HttpError(403, "Your Discord account is too new to mark gifts yet. Try again in a few days.");
            }
            const r = db.claimGift(owner.discord_id, id, s.userId, s.username ?? "");
            if (r === "taken") throw new HttpError(409, "Someone else already said they are gifting this one.");
            if (r === "full") throw new HttpError(429, `You can mark up to ${MAX_CLAIMS_PER_LIST} games per list.`);
            if (r === "limit") throw new HttpError(429, `You can hold up to ${MAX_CLAIMS_TOTAL} gift marks at a time. Undo one first.`);
            return { claim: "mine", region: compareGiftRegions(db, s.userId, owner.discord_id) };
        },
        // The list's owner lets go of a mark (and can report it) or pauses marking. They still never learn who made it.
        "POST /api/profile/gifts": async (req, body) => {
            const s = session(req);
            const u = userRow(s);
            if (body.action === "pause") { db.setGiftsPaused(s.userId, Boolean(body.on)); return { paused: db.giftsPaused(s.userId) }; }
            if (body.action !== "release") throw new HttpError(400, "Unknown action.");
            const id = String(body.id ?? "");
            const game = db.listItems(s.userId).find(g => g.itad_id === id);
            const r = db.releaseGift(s.userId, id, { report: Boolean(body.report), slug: u.profile_slug ?? "", title: game?.title ?? "" });
            if (!r.released) throw new HttpError(404, "Nobody has marked that one.");
            return { released: true, reported: Boolean(body.report) };
        },
        // ---- the community feed
        "GET /api/social/feed": async (req, _b, url) => {
            const sess = softSession(req);
            if (!socialRead.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little.");
            const asked = url.searchParams.get("scope");
            const scope = asked === "servers" ? "servers" : ["following", "mine"].includes(asked) && sess ? asked : "everyone";
            const servers = directory();
            const guilds = scope === "servers" ? serverFilter(sess, url.searchParams.get("server")) : null;
            const author = url.searchParams.get("author") ? slugOwner(url.searchParams.get("author")).discord_id : null;
            const r = db.feed(sess?.userId ?? null, { scope, before: url.searchParams.get("before"), appid: Number(url.searchParams.get("game")) || null, author, limit: 20, guilds });
            const following = sess ? db.followCounts(sess.userId).following : 0;
            return { items: shapeItems(r.items, sess?.userId, servers), more: r.more, signedIn: Boolean(sess), following, reactions: REACTIONS, servers: servers.map(g => ({ id: g.id, name: g.name })) };
        },
        // The games a member can tag a post with: their own library, most played first.
        "GET /api/social/mygames": async (req) => {
            const s = session(req); userRow(s);
            return { games: db.listLibrary(s.userId).filter(g => g.appid).sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0)).slice(0, 300).map(g => ({ appid: g.appid, title: g.title })) };
        },
        // Every server the bot is in (that has not opted out), busiest first, so anyone can find a community to join.
        "GET /api/social/servers": async (req) => {
            const sess = softSession(req);
            if (!socialRead.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little.");
            const dir = directory(), stats = db.socialGuildStats(dir.map(g => g.id), now() - 7 * 86400_000);
            const list = dir.map(g => { const st = stats.get(g.id) ?? { people: 0, active: 0 }, gs = db.guildSocial(g.id); return { id: g.id, name: g.name, members: g.members, people: st.people, active: st.active, about: gs.about, invite: gs.invite || null }; })
                .sort((a, b) => b.active - a.active || b.people - a.people || (b.members ?? 0) - (a.members ?? 0) || a.name.localeCompare(b.name));
            const mine = sess ? (sess.guilds ?? []).filter(g => isManager(g) && (guildList?.() ?? []).some(x => x.id === g.id)).map(g => ({ id: g.id, name: g.name, ...db.guildSocial(g.id) })) : [];
            return { servers: list, manage: mine };
        },
        "GET /api/social/server": async (req, _b, url) => {
            const sess = softSession(req);
            const id = String(url.searchParams.get("id") ?? "");
            const g = directory().find(x => x.id === id);
            if (!g) throw new HttpError(404, "That server isn't in the community directory.");
            const st = db.socialGuildStats([id], now() - 7 * 86400_000).get(id) ?? { people: 0, active: 0 }, gs = db.guildSocial(id);
            return { server: { id, name: g.name, members: g.members, people: st.people, active: st.active, about: gs.about, invite: gs.invite || null }, people: peopleList(db.guildMembers(id, 24), sess?.userId ?? null) };
        },
        // A server's managers choose whether it is listed, what it says about itself and where people can join.
        "POST /api/social/server": async (req, body) => {
            const s = session(req);
            const g = s.guilds.find(x => x.id === String(body.guild ?? ""));
            if (!g || !isManager(g)) throw new HttpError(403, "Only people who manage that server can change this.");
            const r = db.setGuildSocial(g.id, { listed: body.listed === undefined ? undefined : Boolean(body.listed), about: body.about, invite: body.invite });
            if (r.error) throw new HttpError(400, r.error);
            return { settings: r };
        },
        "GET /api/social/item": async (req, _b, url) => {
            const sess = softSession(req);
            const t = db.thread(url.searchParams.get("id"), sess?.userId ?? null);
            if (!t) throw new HttpError(404, "That post is gone.");
            const servers = directory();
            return { item: shapeItems([t.item], sess?.userId, servers)[0], replies: shapeItems(t.replies, sess?.userId, servers), reactions: REACTIONS };
        },
        "POST /api/social/post": async (req, body) => {
            const s = session(req); userRow(s); mayPost(s);
            if (!socialWrite.hit("u" + s.userId).ok) throw new HttpError(429, "Slow down a little.");
            let appid = null, game = null;
            if (body.appid && !body.parent) {
                const g = db.listLibrary(s.userId).find(x => x.appid === Number(body.appid));
                if (!g) throw new HttpError(400, "Pick a game from your own library.");
                appid = g.appid; game = g.title;
            }
            let img = null;
            if (body.image) {
                if (body.parent) throw new HttpError(400, "Pictures go on posts, not replies.");
                try { img = decodeUpload(body.image); } catch (e) { throw new HttpError(400, e.message); }
            }
            const r = db.createPost(s.userId, { body: body.body, appid, game, parentId: body.parent ?? null, hasImage: Boolean(img) }, { staff: s.userId === config.ownerId });
            if (r.error) throw new HttpError(r.status ?? 400, r.error);
            if (img) db.addPostImage(r.id, s.userId, img.mime, img.buf);
            if (r.parentAuthor && r.parentAuthor !== s.userId) notifySocial(r.parentAuthor, { title: `${authorCard(s.userId).name} replied to your post`, body: String(body.body ?? "").trim().slice(0, 140), url: "/feed" });
            return { id: r.id };
        },
        "POST /api/social/react": async (req, body) => {
            const s = session(req); userRow(s);
            if (!socialWrite.hit("u" + s.userId).ok) throw new HttpError(429, "Slow down a little.");
            const emoji = body.emoji === null || body.emoji === undefined ? null : String(body.emoji);
            if (emoji !== null && !REACTIONS.includes(emoji)) throw new HttpError(400, "Pick one of the reactions.");
            const id = Number(body.id);
            const item = db.getItem(id);
            const visible = item && (item.hidden === 0 || item.discord_id === s.userId) && !db.blockedEither(s.userId, item.discord_id);
            if (!visible) throw new HttpError(404, "That post is gone.");
            const mine = db.react(id, s.userId, emoji);
            if (mine && item.discord_id !== s.userId && !reactSeen.has(`${s.userId}:${id}`)) {
                reactSeen.add(`${s.userId}:${id}`); if (reactSeen.size > 20000) reactSeen.clear();
                notifySocial(item.discord_id, { title: `${authorCard(s.userId).name} reacted ${mine} to your ${item.parent_id ? "reply" : "post"}`, body: String(item.body ?? "").slice(0, 100) || null, url: "/feed" });
            }
            return { mine };
        },
        "POST /api/social/delete": async (req, body) => {
            const s = session(req);
            const item = db.getItem(Number(body.id));
            if (!item) throw new HttpError(404, "That post is gone.");
            if (item.discord_id !== s.userId && !isOwner(s)) throw new HttpError(403, "That one is not yours.");
            db.deleteItem(item.id);
            return { deleted: true };
        },
        "POST /api/social/report": async (req, body) => {
            const s = session(req);
            if (!socialWrite.hit("u" + s.userId).ok) throw new HttpError(429, "Slow down a little.");
            const r = db.report(Number(body.id), s.userId, body.reason);
            if (!r) throw new HttpError(404, "Nothing to report there.");
            return { reported: true };
        },
        "POST /api/social/follow": async (req, body) => {
            const s = session(req); userRow(s);
            if (!socialWrite.hit("u" + s.userId).ok) throw new HttpError(429, "Slow down a little.");
            const o = slugOwner(body.slug);
            const r = db.follow(s.userId, o.discord_id, body.on !== false);
            if (r === "self") throw new HttpError(400, "That's you.");
            if (r === "blocked") throw new HttpError(403, "You can't follow this person.");
            if (r === "limit") throw new HttpError(429, "You are following as many people as you can. Unfollow someone first.");
            if (r === "new") friendFromFollow(db, s.userId, { name: authorCard(o.discord_id).name, slug: o.profile_slug ?? body.slug });
            if (r === "ok" && body.on === false) db.dropFollowedFriend(s.userId, String(o.profile_slug ?? body.slug).toLowerCase());
            if (r === "new") { const me = authorCard(s.userId); notifySocial(o.discord_id, { title: `${me.name} followed you`, url: me.slug ? "/u/" + me.slug : "/feed" }); }
            return { following: body.on !== false, ...db.followCounts(o.discord_id) };
        },
        "POST /api/social/block": async (req, body) => {
            const s = session(req);
            const o = db.getProfileBySlug(String(body.slug ?? "").toLowerCase());
            if (!o) throw new HttpError(404, "That page does not exist.");
            if (o.discord_id === s.userId) throw new HttpError(400, "That's you.");
            db.setBlock(s.userId, o.discord_id, body.on !== false);
            return { blocked: body.on !== false };
        },
        "GET /api/social/people": async (req) => {
            const s = session(req); userRow(s);
            return { ...db.followCounts(s.userId), followers: peopleList(db.listFollowers(s.userId), s.userId), following: peopleList(db.listFollowing(s.userId).filter(x => x.slug), s.userId),
                blocked: db.listBlocks(s.userId).map(b => ({ slug: b.slug, name: b.slug ?? "Someone" })).filter(b => b.slug), prefs: db.getPrefs(s.userId) };
        },
        // ---- guestbook
        "GET /api/public/guestbook": async (req, _b, url) => {
            const sess = softSession(req);
            if (!socialRead.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little.");
            const o = slugOwner(url.searchParams.get("slug"));
            const before = url.searchParams.get("before");
            const g = db.guestbookList(o.discord_id, sess?.userId ?? null, { before: before ? Number(before) : null, limit: 12 });
            const mine = Boolean(sess && sess.userId === o.discord_id);
            return { open: db.getPrefs(o.discord_id).guestbook, total: g.total, more: g.more, signedIn: Boolean(sess && !sess.steamOnly), owner: mine,
                items: g.items.map(e => ({ id: e.id, body: e.body, at: e.at, by: authorCard(e.author), mine: Boolean(sess && sess.userId === e.author), canDelete: mine || Boolean(sess && sess.userId === e.author) || Boolean(sess && isOwner(sess)) })) };
        },
        "POST /api/guestbook/post": async (req, body) => {
            const s = session(req); userRow(s); mayPost(s);
            if (!socialWrite.hit("u" + s.userId).ok) throw new HttpError(429, "Slow down a little.");
            const o = slugOwner(body.slug);
            const r = db.guestbookPost(o.discord_id, s.userId, body.body, { staff: s.userId === config.ownerId });
            if (r.error) throw new HttpError(r.status ?? 400, r.error);
            const me = authorCard(s.userId);
            notifySocial(o.discord_id, { title: `${me.name} signed your guestbook`, body: String(body.body ?? "").trim().slice(0, 140), url: o.profile_slug ? "/u/" + o.profile_slug : "/feed" });
            return { id: r.id };
        },
        "POST /api/guestbook/delete": async (req, body) => {
            const s = session(req);
            const e = db.guestbookEntry(Number(body.id));
            if (!e) throw new HttpError(404, "That note is gone.");
            if (e.author !== s.userId && e.owner !== s.userId && !isOwner(s)) throw new HttpError(403, "That one is not yours to remove.");
            db.guestbookDelete(e.id);
            return { deleted: true };
        },
        "POST /api/social/prefs": async (req, body) => {
            const s = session(req); userRow(s);
            return { prefs: db.setPrefs(s.userId, { events: body.events, digest: body.digest, notify: body.notify, dm: body.dm, guestbook: body.guestbook }) };
        },
        "GET /api/social/leaderboards": async (req, _b, url) => {
            if (!socialRead.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little.");
            const guilds = serverFilter(softSession(req), url.searchParams.get("server"));
            const b = db.leaderboards(guilds, { postsSince: now() - 7 * 86400_000, finishedSince: now() - 30 * 86400_000 });
            const shape = rows => rows.map(r => ({ by: authorCard(r.id), n: r.n })).filter(r => r.by.slug);
            return { boards: [
                { key: "active", title: "Most active this week", unit: "posts", rows: shape(b.active) },
                { key: "finished", title: "Most games finished this month", unit: "finished", rows: shape(b.finished) },
                { key: "rare", title: "Most rare achievements", unit: "rare", rows: shape(b.rare) }] };
        },
        "GET /api/social/discover": async (req, _b, url) => {
            const sess = softSession(req);
            if (!socialRead.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little.");
            const week = now() - 7 * 86400_000;
            const which = url.searchParams.get("server");
            const guilds = sess && which ? serverFilter(sess, which) : null;
            return {
                servers: directory().map(g => ({ id: g.id, name: g.name })),
                trending: db.trendingGames(week, 10, guilds).map(g => ({ appid: g.appid, game: g.game, people: g.people, posts: g.posts, finishes: g.finishes, art: steamArt(g.appid) })),
                rare: db.rareBoard(10, 2, guilds).map(r => ({ ...authorCard(r.discord_id), game: r.game, achievement: r.name, icon: r.icon, pct: r.pct })),
                similar: sess ? peopleList(db.similarPeople(sess.userId, 8), sess.userId) : []
            };
        },
        "GET /api/social/game": async (req, _b, url) => {
            const sess = softSession(req);
            const appid = Number(url.searchParams.get("appid"));
            if (!Number.isInteger(appid) || appid <= 0) throw new HttpError(400, "Which game?");
            return { appid, art: steamArt(appid), owners: db.ownerCount(appid), people: peopleList(db.gameOwners(appid, 12), sess?.userId ?? null) };
        },
        // Two libraries side by side. Only for members who chose to show their Steam stats, since this shows what they own.
        "GET /api/social/compare": async (req, _b, url) => {
            const s = session(req); userRow(s);
            const o = slugOwner(url.searchParams.get("slug"));
            if (o.discord_id === s.userId) throw new HttpError(400, "That's you.");
            const shows = (db.getProfileData(o.discord_id).data.sections ?? []).some(x => x.key === "steam" && x.vis === "public");
            if (!shows) throw new HttpError(403, "This member keeps their library to themselves.");
            return { them: authorCard(o.discord_id), ...db.compareLibraries(s.userId, o.discord_id) };
        },
        "GET /api/admin/social": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            return { reports: db.listReports().map(r => ({ ...r, by: authorCard(r.author_id) })), bans: db.listSocialBans().map(b => ({ ...b, by: authorCard(b.discord_id) })) };
        },
        "POST /api/admin/social": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do that.");
            const id = Number(body.id);
            if (body.action === "dismiss") db.dismissReports(id);
            else if (body.action === "delete") db.deleteItem(id);
            else if (body.action === "ban" || body.action === "unban") {
                const who = body.action === "ban" && id ? db.getItem(id)?.discord_id : String(body.user ?? "");
                if (!who) throw new HttpError(404, "Nobody to act on.");
                if (body.action === "ban") db.banPoster(who, body.reason); else db.unbanPoster(who);
            } else throw new HttpError(400, "Unknown action.");
            return { ok: true };
        },
        "GET /api/admin/gifts": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            return { reports: db.listGiftReports(), bans: db.listGiftBans() };
        },
        "POST /api/admin/gifts": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            const id = String(body.claimer ?? "");
            if (!/^[\w-]{1,40}$/.test(id)) throw new HttpError(400, "Pick an account first.");
            if (body.action === "ban") db.banGift(id, "Blocked by the bot owner");
            else if (body.action === "unban") db.unbanGift(id);
            else if (body.action === "dismiss") db.dismissGiftReports(id);
            else throw new HttpError(400, "Unknown action.");
            return { ok: true };
        },

        "GET /api/bundles": async (req, _b, url) => {
            const s = session(req);
            cooldown(s.userId, "bundles");
            const u = userRow(s);
            const title = String(url.searchParams.get("game") ?? "").trim().slice(0, 100);
            let gameIds;
            if (title) {
                const [hit] = await itad.lookupTitles([title]);
                if (!hit?.id) throw new HttpError(400, `I could not find a game called ${title}.`);
                gameIds = [hit.id];
            } else gameIds = db.listItems(s.userId).map(i => i.itad_id);
            return await bundleCheck({ db, itad, user: u, gameIds });
        },

        "GET /api/regions": async (req, _b, url) => {
            const s = session(req);
            cooldown(s.userId, "regions");
            const u = userRow(s);
            const title = String(url.searchParams.get("game") ?? "").trim().slice(0, 100);
            if (!title) throw new HttpError(400, "Type a game title.");
            const [hit] = await itad.lookupTitles([title]);
            if (!hit?.id) throw new HttpError(400, `I could not find a game called ${title}.`);
            const rows = await regionPrices({ itad, fx, itadId: hit.id, home: u.region, majorOnly: u.stores === "major" }).catch(e => { throw new HttpError(502, e.message); });
            return { game: hit.matched || title, rows };
        },

        "GET /api/calendar": async (req, _b, url) => {
            // One list for the member: wishlist release dates, Steam sales, events and group games from their servers.
            const s = session(req);
            const days = Math.min(365, Math.max(1, Math.round(Number(url.searchParams.get("days"))) || 60));
            const t = now();
            const mine = s.guilds.filter(g => !botGuilds || botGuilds(g.id));
            const wanted = String(url.searchParams.get("guild") ?? "");
            const guildIds = (wanted ? mine.filter(g => g.id === wanted) : mine).map(g => g.id);
            const kinds = String(url.searchParams.get("kinds") ?? "").split(",").filter(k => KINDS.includes(k));
            const entries = calendarEntries(db, s.userId, { from: t - 86400_000, to: t + days * 86400_000, guildIds, kinds: kinds.length ? kinds : KINDS });
            const names = Object.fromEntries(mine.map(g => [g.id, g.name]));
            const feed = db.getCalFeed(s.userId);
            return { now: t, servers: mine.map(g => ({ id: g.id, name: g.name, manageable: isManager(g) })),
                entries: entries.map(e => ({ ...e, server: e.guild_id ? names[e.guild_id] ?? null : null, canRemove: e.kind === "event" && isManager(mine.find(g => g.id === e.guild_id) ?? {}) })),
                feed: feed ? { created_at: feed.created_at, used_at: feed.used_at } : null };
        },

        "POST /api/calendar/events": async (req, body) => {
            const s = session(req);
            if (!calendar) throw new HttpError(503, "The calendar is not available.");
            const g = managerGuild(s, String(body.guild_id));
            let channelId = null;
            if (body.channel_id) {
                let channels;
                try { channels = await rest.listChannels(g.id); } catch { throw new HttpError(400, "The bot is not in that server yet. Invite it first."); }
                channelId = String(body.channel_id);
                if (!channels.some(c => c.id === channelId)) throw new HttpError(400, "Pick one of the server's text channels.");
            }
            const r = await calendar.create({ guildId: g.id, creatorId: s.userId, title: body.title, notes: body.notes, startsAt: Number(body.starts_at), channelId, remindMin: body.remind_min === undefined ? 60 : Number(body.remind_min) });
            return r;
        },

        "POST /api/calendar/events/delete": async (req, body) => {
            const s = session(req);
            if (!calendar) throw new HttpError(503, "The calendar is not available.");
            const g = managerGuild(s, String(body.guild_id));
            if (!calendar.remove(Number(body.id), g.id)) throw new HttpError(404, "I can't find that event.");
            return { ok: true };
        },

        "POST /api/calendar/feed": async (req, body) => {
            // An optional private link for Google, Apple or Outlook calendar. The link is shown once; only its hash is kept.
            const s = session(req);
            if (body.action === "off") return { off: db.revokeCalFeed(s.userId) };
            cooldown(s.userId, "grabbertoken");
            const mine = s.guilds.filter(g => !botGuilds || botGuilds(g.id)).map(g => g.id);
            const token = db.createCalFeed(s.userId, mine.slice(0, 20));
            return { url: `${origin}/calendar/feed/${token}.ics` };
        },

        "GET /api/saleprep": async (req, _b, url) => {
            const s = session(req);
            cooldown(s.userId, "saleprep");
            const budget = Number(url.searchParams.get("budget"));
            return await salePrep({ db, itad, user: userRow(s), budget: Number.isFinite(budget) && budget > 0 && budget <= 10_000 ? budget : null });
        },

        "GET /api/saleprep/recap": async (req, _b, url) => {
            const s = session(req);
            const days = Math.min(90, Math.max(1, Math.round(Number(url.searchParams.get("days"))) || 14));
            return saleRecap(db, s.userId, { days });
        },

        "GET /api/sales": async (req) => { session(req); return { sales: upcomingSales(Date.now(), { limit: 8 }), updated: SALES_UPDATED }; },

        "GET /api/free": async (req) => {
            const s = session(req);
            const showDlc = db.getUser(s.userId)?.free_dlc !== 0;
            const groups = new Map();
            for (const g of withOwnership(await enrichFree(await itad.getGiveawayList()), db, s.userId)) {
                if (!/^https:\/\//i.test(g.url ?? "")) continue;
                const dlc = isDlc(g);
                if (dlc && !showDlc) continue;
                if (!groups.has(g.shop)) groups.set(g.shop, []);
                groups.get(g.shop).push({ id: g.id, title: g.title, url: g.url, expiry: g.expiry, dlc, art: freeArt(g) ?? null, base: dlc && g.base ? g.base.name : null, baseOwned: dlc && g.base ? g.baseOwned ?? null : null });
            }
            return { showDlc, platforms: [...groups].map(([shop, games]) => ({ shop, games })) };
        },

        // Playtests, betas and demos from Steam news and Alpha Beta Gamer. The page asks again every few minutes by itself.
        "GET /api/playtests": async (req) => {
            const s = session(req);
            return playtestBoard({ db, news: news ?? (news = createNews()), abg: abg ?? (abg = createPlaytestSources()), userId: s.userId, now: now(), log });
        },

        // ----- giveaways (server managers) -----
        "GET /api/giveaways": async (req, _b, url) => {
            const s = session(req);
            const g = managerGuild(s, url.searchParams.get("guild"));
            const rows = db.listGiveaways(g.id, { limit: 50 }).map(x => {
                const keys = db.listKeys(x.id);
                return { id: x.id, title: x.title, status: x.status, starts_at: x.starts_at, ends_at: x.ends_at, channel_id: x.channel_id, entries: db.countEntries(x.id), prizes: keys.length, redeemed: keys.filter(k => k.status === "confirmed").length, outcome: outcomeOf(x, keys) };
            });
            return { giveaways: rows, pending: await pendingClaimsFor(g.id), settings: db.getGiveawaySettings(g.id), max: MAX_KEYS, stepKinds: Object.entries(STEP_KINDS).map(([id, k]) => ({ id, label: k.label, hint: k.hint })) };
        },

        "GET /api/giveaways/templates": async (req, _b, url) => {
            const s = session(req); needGiveaways();
            const g = managerGuild(s, url.searchParams.get("guild"));
            return { templates: db.listTemplates(g.id) };
        },
        "POST /api/giveaways/templates": async (req, body) => {
            const s = session(req); needGiveaways();
            const g = managerGuild(s, String(body.guild_id));
            if (body.remove) { db.removeTemplate(g.id, Number(body.remove)); return { templates: db.listTemplates(g.id) }; }
            const name = String(body.name ?? "").trim().slice(0, 40);
            if (!name) throw new HttpError(400, "Give the template a name.");
            if (db.listTemplates(g.id).length >= 25 && !db.listTemplates(g.id).some(t => t.name === name)) throw new HttpError(400, "You can keep up to 25 templates.");
            // Only plain form values are kept: strings, numbers and booleans, never anything that looks like a prize list.
            const data = {};
            for (const [k, v] of Object.entries(body.data ?? {}).slice(0, 40)) if (/^[a-zA-Z]{1,24}$/.test(k) && k !== "keys" && ["string", "number", "boolean"].includes(typeof v)) data[k] = typeof v === "string" ? v.slice(0, 1500) : v;
            db.saveTemplate(g.id, name, data);
            return { templates: db.listTemplates(g.id) };
        },
        // The signed-in member's own prizes: where each one stands and when to claim it. Keys are never included.
        "GET /api/claims": async (req) => {
            const s = session(req); userRow(s);
            return { prizes: db.prizesFor(s.userId).map(p => ({ ...p, link: p.message_id ? `https://discord.com/channels/${p.guild_id}/${p.channel_id}/${p.message_id}` : null })) };
        },

        "GET /api/giveaways/art": async (req, _b, url) => {
            session(req);
            const q = (url.searchParams.get("game") ?? "").trim().slice(0, 100);
            if (!q) return { image: null };
            const art = await autoImage(itad, q);
            return { image: art?.image ?? null };
        },

        "GET /api/giveaways/info": async (req, _b, url) => {
            const s = session(req);
            const g = managerGuild(s, url.searchParams.get("guild"));
            const x = giveawayOf(g, url.searchParams.get("id"));
            // names only, never key values
            return { id: x.id, title: x.title, status: x.status, entries: db.countEntries(x.id), keys: db.listKeys(x.id).map(k => ({ position: k.position, label: k.label, status: k.status, winner_id: k.winner_id })) };
        },

        "POST /api/giveaways/create": async (req, body) => {
            const s = session(req);
            const g = managerGuild(s, body.guild_id);
            needGiveaways();
            const undo = cooldown(s.userId, "add");
            try {
            const channels = await rest.listChannels(g.id).catch(err => {
                if (err instanceof DiscordApiError && [403, 404].includes(err.status)) throw new HttpError(400, "The bot is not in that server yet. Invite it first.");
                throw err;
            });
            if (!channels.some(c => c.id === body.channel_id)) throw new HttpError(400, "Pick a text channel from the list.");
            const { input, duplicates } = giveawayInput(body, { channelIds: channels.map(c => c.id) });
            const r = await giveaways.create({ ...input, guild_id: g.id, channel_id: body.channel_id, host_id: s.userId });
            return { ...r, duplicates };
            } catch (err) { undo(); throw err; }
        },

        "POST /api/giveaways/end": async (req, body) => { const g = managerGuild(session(req), body.guild_id); needGiveaways(); const x = giveawayOf(g, body.id); const r = await giveaways.end(x.id); return { winners: r.winners.length, unused: r.unused }; },
        "POST /api/giveaways/cancel": async (req, body) => { const g = managerGuild(session(req), body.guild_id); needGiveaways(); const x = giveawayOf(g, body.id); return await giveaways.cancel(x.id); },
        "POST /api/giveaways/reroll": async (req, body) => { const g = managerGuild(session(req), body.guild_id); needGiveaways(); const x = giveawayOf(g, body.id); const r = await giveaways.reroll(x.id, { userId: body.user_id || null }); return { winners: r.winners.length }; },
        "POST /api/giveaways/rules": async (req, body) => {
            const g = managerGuild(session(req), body.guild_id); needGiveaways();
            const x = giveawayOf(g, body.id);
            const patch = { clear: body.clear === true, require_role_ids: roleIds(body.require_role_ids), override_role_ids: roleIds(body.override_role_ids), bonus_role_ids: roleIds(body.bonus_role_ids) };
            if (body.require_all !== undefined) patch.require_all = body.require_all === true || body.require_all === "all";
            if (body.bonus_entries !== undefined) patch.bonus_entries = Number(body.bonus_entries);
            if (body.steam_verified !== undefined) patch.require_steam = body.steam_verified === true;
            await giveaways.updateRules(x.id, patch);
            return { ok: true };
        },
        "POST /api/giveaways/remind": async (req, body) => {
            const g = managerGuild(session(req), body.guild_id); needGiveaways();
            const k = db.getKey(Number(body.key_id)), x = k && db.getGiveaway(k.giveaway_id);
            if (!x || x.guild_id !== g.id) throw new HttpError(404, "That prize isn't in this server.");
            try { await giveaways.remind(k.id); } catch (e) { if (e instanceof UserError) throw new HttpError(400, e.message); throw e; }
            return { ok: true };
        },
        "POST /api/giveaways/replace": async (req, body) => {
            const g = managerGuild(session(req), body.guild_id); needGiveaways();
            const x = giveawayOf(g, body.id);
            return await giveaways.replaceKey(x.id, String(body.user_id ?? ""), body.key);
        },

        "POST /api/giveaways/setup": async (req, body) => {
            const g = managerGuild(session(req), body.guild_id);
            const ids = new Set([...(await rest.listChannels(g.id).catch(() => [])).map(c => c.id)]);
            const patch = {};
            if (body.vouch_channel_id !== undefined) {
                if (body.vouch_channel_id && !ids.has(body.vouch_channel_id)) throw new HttpError(400, "Pick a text channel from the list.");
                patch.vouch_channel_id = body.vouch_channel_id || null;
            }
            if (body.manager_role_id !== undefined) {
                const roles = body.manager_role_id ? await rest.listRoles(g.id).catch(() => []) : [];
                if (body.manager_role_id && !roles.some(r => r.id === body.manager_role_id)) throw new HttpError(400, "Pick a role from the list.");
                patch.manager_role_id = body.manager_role_id || null;
            }
            if (body.giveaway_channel_id !== undefined) {
                if (body.giveaway_channel_id && !ids.has(body.giveaway_channel_id)) throw new HttpError(400, "Pick a text channel from the list.");
                patch.giveaway_channel_id = body.giveaway_channel_id || null;
            }
            return { settings: db.setGiveawaySettings(g.id, patch) };
        },

        "GET /api/servers/roles": async (req, _b, url) => {
            const g = managerGuild(session(req), url.searchParams.get("guild"));
            try { return { roles: await rest.listRoles(g.id) }; }
            catch (err) {
                if (err instanceof DiscordApiError && [403, 404].includes(err.status)) throw new HttpError(400, "The bot is not in that server yet. Invite it first.");
                throw err;
            }
        },

        // ----- owner -----
        // A trail of what the owner did in the admin panel. Only short, harmless fields are kept: never prize keys or message text.
        "GET /api/admin/audit": async (req, _b, url) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const before = Number(url.searchParams.get("before")) || null;
            const rows = db.listAudit({ limit: 50, before, q: url.searchParams.get("q") ?? "" });
            return { rows, more: rows.length === 50 };
        },
        // How the bot itself is doing right now: process, memory, sign-ins and the event loop.
        "GET /api/admin/votes": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            return topgg ? topgg.adminStats() : { enabled: false };
        },
        "GET /api/admin/errors": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            return { groups: logs ? groupErrors(logs.recent({ level: "error", limit: 400 })) : [], available: Boolean(logs) };
        },
        // ---------- indie showcase and developer tools ----------
        "GET /api/indie/tools": async () => ({ cats: INDIE_CATS, tools: INDIE_TOOLS }),
        "GET /api/indie/calendar": async () => ({ sales: SALES.map(e => ({ name: e.name, kind: e.kind, start: e.start, end: e.end, note: e.note ?? null })), updated: SALES_UPDATED }),
        // One Steam game's public details, or a name search. No sign-in (the tools use it), so it is limited by address.
        "GET /api/fortnite/shop": async req => { if (!fortniteLimit.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little and try again in a minute."); return fortniteCall(() => fnSvc.shop()); },
        "GET /api/fortnite/news": async req => { if (!fortniteLimit.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little and try again in a minute."); return fortniteCall(() => fnSvc.news()); },
        "GET /api/fortnite/map": async req => { if (!fortniteLimit.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little and try again in a minute."); return fortniteCall(() => fnSvc.map()); },
        "GET /api/fortnite/new": async req => { if (!fortniteLimit.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little and try again in a minute."); return fortniteCall(() => fnSvc.fresh()); },
        "GET /api/fortnite/status": async () => ({ ...(await fnSvc.status()), stats: Boolean(fnSvc.hasStats), creatorCode: fnSvc.creatorCode || "" }),
        "GET /api/fortnite/creator": async (req, _b, url) => { if (!fortniteLimit.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little and try again in a minute."); return fortniteCall(() => fnSvc.creator(url.searchParams.get("code"))); },
        "GET /api/fortnite/search": async (req, _b, url) => { if (!fortniteLimit.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little and try again in a minute."); return { items: await fortniteCall(() => fnSvc.search(url.searchParams.get("q"))) }; },
        "GET /api/fortnite/stats": async (req, _b, url) => { if (!fortniteLimit.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little and try again in a minute."); return fortniteCall(() => fnSvc.stats(url.searchParams.get("name"), url.searchParams.get("platform") || "epic")); },
        "GET /api/indie/lookup": async (req, _b, url) => {
            if (!indieLookupLimit.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little and try again in a minute.");
            const q = String(url.searchParams.get("q") ?? "").trim().slice(0, 200);
            if (!q) throw new HttpError(400, "Paste a Steam store link or type a game's name.");
            const id = parseApp(q);
            try {
                if (id) return { game: await indieApi.lookup(id, { withReviews: true }) };
                return { results: await indieApi.search(q) };
            } catch (e) { if (e instanceof UserError) throw new HttpError(400, e.message); throw e; }
        },
        "GET /api/indie": async (req, _b, url) => {
            const sp = url.searchParams, genre = sp.get("genre") || null, q = (sp.get("q") || "").trim() || null, sort = ["new", "popular", "az"].includes(sp.get("sort")) ? sp.get("sort") : "new";
            const page = Math.max(0, Math.floor(Number(sp.get("page")) || 0)), per = 24;
            const { games, total } = db.indieList({ genre, q, sort, limit: per, offset: page * per });
            const plain = !genre && !q && page === 0;
            return { open: db.getMeta("indie:open") !== "0", games: games.map(indiePublic), total, page, per, genres: db.indieGenres(), featured: plain ? db.indieFeatured(3).map(indiePublic) : [], news: plain ? db.indieNewsFeed(5).map(u => ({ id: u.id, gameId: u.game_id, game: u.game_title, studio: u.studio, image: u.image, kind: u.kind, title: u.title, created: u.created })) : [] };
        },
        "GET /api/indie/game": async (req, _b, url) => {
            const g = db.indieGet(url.searchParams.get("id")), sess = softSession(req);
            const mine = Boolean(g && sess && sess.userId === g.owner_id), staff = Boolean(sess && isOwner(sess));
            if (!g || (g.status !== "approved" && !mine && !staff)) throw new HttpError(404, "That game isn't in the showcase.");
            if (g.status === "approved" && !CRAWLER.test(String(req.headers["user-agent"] ?? ""))) db.indieBump(g.id, "views");
            return { game: { ...indiePublic(g), status: mine || staff ? g.status : undefined, note: mine ? g.note : undefined, liked: db.indieLiked(g.id, sess?.userId), mine, keysOpen: Boolean(g.keys_open), followers: db.indieFollowCount(g.id), following: { game: db.indieIsFollowing(sess?.userId, "game", g.id), studio: db.indieIsFollowing(sess?.userId, "studio", g.owner_id) }, keyRequest: sess ? db.indieKeyRequestOf(g.id, sess.userId)?.status ?? null : null, updates: db.indieUpdates(g.id, 8).map(u => ({ id: u.id, kind: u.kind, title: u.title, body: u.body, link: u.link, created: u.created })), studioGames: db.indieByOwner(g.owner_id).filter(x => x.status === "approved" && x.id !== g.id).slice(0, 4).map(indiePublic) }, more: db.indieList({ limit: 4, sort: "popular" }).games.filter(x => x.id !== g.id).slice(0, 3).map(indiePublic) };
        },
        "GET /api/indie/mine": async (req) => {
            const s = session(req);
            return { games: db.indieByOwner(s.userId).map(g => ({ ...indiePublic(g), status: g.status, note: g.note, views: g.views, clicks: g.clicks, keysOpen: Boolean(g.keys_open), followers: db.indieFollowCount(g.id), pendingKeys: db.indieKeyRequests(g.id).filter(k => k.status === "pending").length })), limits: { pending: MAX_PENDING_PER_USER, total: MAX_GAMES_PER_USER } };
        },
        "POST /api/indie/submit": async (req, body) => {
            const s = session(req);
            if (db.getMeta("indie:open") === "0" && s.userId !== config.ownerId) throw new HttpError(400, "Submissions are paused for a bit. Check back soon.");
            if (!indieWriteLimit.hit(s.userId).ok) throw new HttpError(429, "That's a lot of submissions at once. Try again in a few minutes.");
            const appid = parseApp(body.url);
            if (!appid) throw new HttpError(400, "Paste your game's Steam store link, like https://store.steampowered.com/app/123456/Your_Game/");
            if (body.team !== true) throw new HttpError(400, "Tick the box to confirm you're part of the team that makes this game.");
            const pitch = String(body.pitch ?? "").replace(/\s+/g, " ").trim();
            if (pitch.length < 20 || pitch.length > 400) throw new HttpError(400, "Write a pitch between 20 and 400 characters: what makes your game worth a look?");
            if (db.indieByApp(appid)) throw new HttpError(400, "That game is already in the showcase, or waiting to be looked at.");
            if (db.indieCountOwner(s.userId) >= MAX_GAMES_PER_USER) throw new HttpError(400, `You can have up to ${MAX_GAMES_PER_USER} games here.`);
            if (db.indieCountOwner(s.userId, "pending") >= MAX_PENDING_PER_USER) throw new HttpError(400, `You already have ${MAX_PENDING_PER_USER} games waiting to be looked at. They'll be reviewed soon.`);
            let g;
            try { g = await indieApi.lookup(appid); } catch (e) { if (e instanceof UserError) throw new HttpError(400, e.message); throw e; }
            if (g.type !== "game") throw new HttpError(400, "Only games can go in the showcase, not DLC, demos or soundtracks. Use the main game's page.");
            const id = db.indieAdd({ appid, ownerId: s.userId, title: g.title, studio: g.studio, blurb: g.blurb, pitch, genres: g.genres, image: g.image, price: g.price, release: g.release, links: cleanLinks(body.links) });
            const auto = s.userId === config.ownerId;
            if (auto) db.indieDecide(id, "approved");
            else if (config.ownerId) { try { db.addNotification(config.ownerId, { type: "indie", title: "New indie submission", body: g.title, url: "/admin#/indie" }); } catch { /* the queue still shows it */ } }
            return { id, status: auto ? "approved" : "pending", title: g.title };
        },
        "POST /api/indie/edit": async (req, body) => {
            const s = session(req), g = db.indieGet(body.id);
            if (!g || g.owner_id !== s.userId) throw new HttpError(404, "That game isn't yours.");
            const pitch = String(body.pitch ?? "").replace(/\s+/g, " ").trim();
            if (pitch.length < 20 || pitch.length > 400) throw new HttpError(400, "Write a pitch between 20 and 400 characters.");
            db.indieEdit(g.id, { pitch, links: cleanLinks(body.links) });
            return { ok: true };
        },
        // Pull the latest price, release date, picture and description from the game's Steam page.
        "POST /api/indie/sync": async (req, body) => {
            const s = session(req), g = db.indieGet(body.id);
            if (!g || g.owner_id !== s.userId) throw new HttpError(404, "That game isn't yours.");
            if (!indieSyncLimit.hit(`${s.userId}:${g.id}`).ok) throw new HttpError(429, "Give it a minute before syncing again.");
            let fresh; try { fresh = await indieApi.lookup(g.appid, { fresh: true }); } catch (e) { if (e instanceof UserError) throw new HttpError(400, e.message); throw e; }
            if (fresh.type !== "game") throw new HttpError(400, "Steam no longer lists that as a game.");
            db.indieRefresh(g.id, fresh);
            return { game: indiePublic(db.indieGet(g.id)) };
        },
        "POST /api/indie/withdraw": async (req, body) => {
            const s = session(req), g = db.indieGet(body.id);
            if (!g || g.owner_id !== s.userId) throw new HttpError(404, "That game isn't yours.");
            db.indieRemove(g.id);
            await syncIndieDev(s.userId);
            return { ok: true };
        },
        "POST /api/indie/like": async (req, body) => {
            const s = session(req);
            if (!socialWrite.hit(s.userId).ok) throw new HttpError(429, "Slow down a little.");
            const g = db.indieGet(body.id);
            if (!g || g.status !== "approved") throw new HttpError(404, "That game isn't in the showcase.");
            const liked = db.indieToggleLike(g.id, s.userId);
            return { liked, likes: db.indieGet(g.id).likes };
        },
        "POST /api/indie/click": async (req, body) => {
            if (!socialWrite.hit(clientIp(req)).ok) return { ok: true };
            if (!CRAWLER.test(String(req.headers["user-agent"] ?? ""))) db.indieBump(Number(body.id) || 0, "clicks");
            return { ok: true };
        },
        "GET /api/indie/news": async () => ({ news: db.indieNewsFeed(12).map(u => ({ id: u.id, gameId: u.game_id, game: u.game_title, studio: u.studio, image: u.image, kind: u.kind, title: u.title, created: u.created })) }),
        "GET /api/indie/foryou": async (req) => {
            const s = softSession(req);
            if (!s) return { signedIn: false, picks: [] };
            const r = picksFor(db, s.userId, { limit: 6 });
            return { signedIn: true, reason: r.reason, picks: r.picks.map(p => ({ ...indiePublic(p.game), because: p.because })) };
        },
        // Follow a game, or the studio behind it. Followers hear about news and get a message.
        "POST /api/indie/follow": async (req, body) => {
            const s = session(req);
            if (!socialWrite.hit(s.userId).ok) throw new HttpError(429, "Slow down a little.");
            const g = db.indieGet(body.id);
            if (!g || g.status !== "approved") throw new HttpError(404, "That game isn't in the showcase.");
            const kind = body.kind === "studio" ? "studio" : "game";
            if (kind === "studio" && g.owner_id === s.userId) throw new HttpError(400, "That's your own studio.");
            const on = db.indieToggleFollow(s.userId, kind, kind === "studio" ? g.owner_id : g.id);
            return { following: on, kind, followers: db.indieFollowCount(g.id) };
        },
        "GET /api/indie/following": async (req) => {
            const s = session(req), games = [], seen = new Set();
            for (const f of db.indieFollowing(s.userId)) {
                const found = f.kind === "game" ? [db.indieGet(f.target)] : db.indieByOwner(f.target);
                for (const g of found) if (g && g.status === "approved" && !seen.has(g.id)) { seen.add(g.id); games.push({ ...indiePublic(g), via: f.kind }); }
            }
            return { games: games.slice(0, 40) };
        },
        // Developer news on a game's page. Owner only, and only once the game is public.
        "POST /api/indie/update": async (req, body) => {
            const s = session(req), g = db.indieGet(body.id);
            if (!g || g.owner_id !== s.userId) throw new HttpError(404, "That game isn't yours.");
            if (g.status !== "approved") throw new HttpError(400, "You can post news once your game is in the showcase.");
            if (!indieUpdateLimit.hit(`${s.userId}:${g.id}`).ok) throw new HttpError(429, "That's plenty of news for one hour. Try again later.");
            const title = String(body.title ?? "").replace(/\s+/g, " ").trim(), text = String(body.body ?? "").replace(/[ \t]+/g, " ").trim();
            if (title.length < 3 || title.length > 100) throw new HttpError(400, "Give the update a short headline, 3 to 100 characters.");
            if (text.length > 500) throw new HttpError(400, "Keep the details to 500 characters. Link out for the long version.");
            let link = null;
            if (String(body.link ?? "").trim()) { try { const u = new URL(String(body.link).trim()); if (u.protocol !== "https:" || String(body.link).length > 300) throw new Error(); link = u.href; } catch { throw new HttpError(400, "The link needs to be a full https:// address."); } }
            const id = db.indieAddUpdate({ gameId: g.id, kind: body.kind, title, body: text || null, link });
            const u = db.indieUpdate(id);
            indieHerald.publish(g, u).catch(() => {});
            return { id, update: { id, kind: u.kind, title: u.title, body: u.body, link: u.link, created: u.created } };
        },
        "POST /api/indie/update/delete": async (req, body) => {
            const s = session(req), u = db.indieUpdate(body.id), g = u && db.indieGet(u.game_id);
            if (!u || !g || (g.owner_id !== s.userId && !isOwner(s))) throw new HttpError(404, "That update isn't yours.");
            db.indieDeleteUpdate(u.id);
            return { ok: true };
        },
        // Review keys: the developer opens requests, creators and players ask, the developer says yes or no. Keys themselves are sent by the developer.
        "POST /api/indie/keys/open": async (req, body) => {
            const s = session(req), g = db.indieGet(body.id);
            if (!g || g.owner_id !== s.userId) throw new HttpError(404, "That game isn't yours.");
            db.indieSetKeysOpen(g.id, Boolean(body.open));
            return { open: Boolean(body.open) };
        },
        "POST /api/indie/keys/request": async (req, body) => {
            const s = session(req), g = db.indieGet(body.id);
            if (!g || g.status !== "approved" || !g.keys_open) throw new HttpError(404, "This game isn't taking review key requests right now.");
            if (g.owner_id === s.userId) throw new HttpError(400, "That's your own game.");
            if (!indieKeyLimit.hit(s.userId).ok) throw new HttpError(429, "That's a lot of requests. Try again in a while.");
            const name = String(body.name ?? "").trim(), channel = String(body.channel ?? "").trim(), note = String(body.note ?? "").trim();
            if (name.length < 2 || name.length > 60) throw new HttpError(400, "Tell them who you are: a channel name, outlet or handle.");
            if (channel.length < 4 || channel.length > 300) throw new HttpError(400, "Add a link to your channel, site or profile so they can check it.");
            if (!db.indieKeyRequest({ gameId: g.id, userId: s.userId, name, channel, note })) throw new HttpError(400, "You've already asked for a key for this game.");
            try { db.addNotification(g.owner_id, { type: "indie", title: `${name} asked for a key for ${g.title}`, body: "Open your games to say yes or no.", url: "/indie/mine" }); } catch { /* it is in their list either way */ }
            return { ok: true };
        },
        "GET /api/indie/keys": async (req, _b, url) => {
            const s = session(req), g = db.indieGet(url.searchParams.get("id"));
            if (!g || g.owner_id !== s.userId) throw new HttpError(404, "That game isn't yours.");
            return { open: Boolean(g.keys_open), requests: db.indieKeyRequests(g.id).map(k => ({ id: k.id, name: k.name, channel: k.channel, note: k.note, status: k.status, created: k.created })) };
        },
        "POST /api/indie/keys/decide": async (req, body) => {
            const s = session(req), k = db.indieKeyRequestGet(body.id), g = k && db.indieGet(k.game_id);
            if (!k || !g || g.owner_id !== s.userId) throw new HttpError(404, "That request isn't for your game.");
            await decideKeyRequest(g, k, Boolean(body.approve), null);
            return { ok: true };
        },
        // Verified badge: put a one-time code in the game's Steam page text, then check. Only the page's owner can do that.
        "POST /api/indie/verify/start": async (req, body) => {
            const s = session(req), g = db.indieGet(body.id);
            if (!g || g.owner_id !== s.userId) throw new HttpError(404, "That game isn't yours.");
            if (g.verified) return { verified: true };
            const code = g.verify_code || `svc-verify-${randomBytes(5).toString("hex").slice(0, 8)}`;
            if (!g.verify_code) db.indieSetVerifyCode(g.id, code);
            return { verified: false, code };
        },
        "POST /api/indie/verify/check": async (req, body) => {
            const s = session(req), g = db.indieGet(body.id);
            if (!g || g.owner_id !== s.userId) throw new HttpError(404, "That game isn't yours.");
            if (g.verified) return { verified: true };
            if (!g.verify_code) throw new HttpError(400, "Start verification first to get your code.");
            if (!indieVerifyLimit.hit(s.userId).ok) throw new HttpError(429, "Give it a minute before checking again.");
            let found; try { found = await indieApi.hasVerifyCode(g.appid, g.verify_code); } catch (e) { if (e instanceof UserError) throw new HttpError(400, e.message); throw e; }
            if (!found) return { verified: false, code: g.verify_code, message: "I can't see the code on your Steam page yet. Steam can take a few minutes to show edits, so wait a bit and check again." };
            db.indieSetVerified(g.id, true);
            return { verified: true };
        },
        "POST /api/indie/report": async (req, body) => {
            const s = session(req), g = db.indieGet(body.id);
            if (!g || g.status !== "approved") throw new HttpError(404, "That game isn't in the showcase.");
            if (!indieReportLimit.hit(s.userId).ok) throw new HttpError(429, "You've sent a few reports already. We'll look at those first.");
            const reason = String(body.reason ?? "").replace(/\s+/g, " ").trim();
            if (reason.length < 5) throw new HttpError(400, "Tell us briefly what's wrong.");
            const fresh = db.indieReport({ gameId: g.id, reporter: s.userId, reason });
            if (fresh && config.ownerId) { try { db.addNotification(config.ownerId, { type: "indie", title: `Report on ${g.title}`, body: reason.slice(0, 150), url: "/admin#/indie" }); } catch { /* the queue shows it */ } }
            return { ok: true, already: !fresh };
        },
        // Numbers for the developer: the last two weeks of views and clicks, review growth, followers.
        "GET /api/indie/stats": async (req, _b, url) => {
            const s = session(req), g = db.indieGet(url.searchParams.get("id"));
            if (!g || g.owner_id !== s.userId) throw new HttpError(404, "That game isn't yours.");
            return { days: db.indieDays(g.id, 14), reviews: db.indieReviewHistory(g.id, 60), views: g.views, clicks: g.clicks, likes: g.likes, followers: db.indieFollowCount(g.id), updates7: db.indieUpdatesSince(g.id, now() - 7 * 86_400_000), release: g.release };
        },
        // ---------- the indie dev panel: for developers with an approved game ----------
        "GET /api/indie/dev": async (req) => {
            const s = devSession(req);
            const games = db.indieByOwner(s.userId).map(g => ({ id: g.id, title: g.title, image: g.image, status: g.status, studio: g.studio, verified: Boolean(g.verified), keysOpen: Boolean(g.keys_open), views: g.views, clicks: g.clicks, likes: g.likes, followers: db.indieFollowCount(g.id), requests: db.indieKeyCounts(g.id), pool: db.indieKeyPool(g.id), days: db.indieDays(g.id, 14), updates: db.indieUpdates(g.id, 3).map(u => ({ id: u.id, title: u.title, created: u.created })) }));
            return { games, pending: games.reduce((n, g) => n + g.requests.pending, 0), site: origin };
        },
        "GET /api/indie/dev/requests": async (req, _b, url) => {
            const s = devSession(req), q = url.searchParams;
            const game = Number(q.get("game")) || null;
            if (game && db.indieGet(game)?.owner_id !== s.userId) throw new HttpError(404, "That game isn't yours.");
            return { requests: db.indieKeyInbox(s.userId, { game, status: q.get("status"), q: q.get("q"), limit: 300 }).map(k => ({ id: k.id, gameId: k.game_id, game: k.game_title, name: k.name, channel: k.channel, note: k.note, status: k.status, created: k.created, decided: k.decided, reply: k.reply, keySent: Boolean(k.key_sent) })) };
        },
        "POST /api/indie/dev/decide": async (req, body) => {
            const s = devSession(req);
            const ids = [...new Set((Array.isArray(body.ids) ? body.ids : [body.id]).map(Number).filter(Boolean))].slice(0, 50);
            if (!ids.length) throw new HttpError(400, "Pick at least one request.");
            const note = String(body.note ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || null, out = [];
            for (const id of ids) {
                const k = db.indieKeyRequestGet(id), g = k && db.indieGet(k.game_id);
                if (!k || !g || g.owner_id !== s.userId) { out.push({ id, skipped: "not yours" }); continue; }
                out.push(await decideKeyRequest(g, k, Boolean(body.approve), note));
            }
            return { results: out, approved: out.filter(r => r.status === "approved").length, declined: out.filter(r => r.status === "declined").length, sent: out.filter(r => r.sent).length, noKeys: out.filter(r => r.status === "approved" && !r.sent).length };
        },
        "GET /api/indie/dev/keys": async (req, _b, url) => {
            const s = devSession(req), g = db.indieGet(url.searchParams.get("id"));
            if (!g || g.owner_id !== s.userId) throw new HttpError(404, "That game isn't yours.");
            return { pool: db.indieKeyPool(g.id), keys: db.indieKeyList(g.id).map(k => ({ id: k.id, key: k.key, sentTo: k.sent_to ? true : false, sentAt: k.sent_at })) };
        },
        "POST /api/indie/dev/keys/add": async (req, body) => {
            const s = devSession(req), g = db.indieGet(body.id);
            if (!g || g.owner_id !== s.userId) throw new HttpError(404, "That game isn't yours.");
            const lines = String(body.keys ?? "").split(/[\r\n,;]+/).map(x => x.trim()).filter(Boolean).slice(0, 500);
            if (!lines.length) throw new HttpError(400, "Paste one key per line.");
            const r = db.indieKeysAdd(g.id, lines);
            return { ...r, pool: db.indieKeyPool(g.id) };
        },
        "POST /api/indie/dev/keys/remove": async (req, body) => {
            const s = devSession(req), g = db.indieGet(body.game);
            if (!g || g.owner_id !== s.userId) throw new HttpError(404, "That game isn't yours.");
            if (body.all) db.indieKeyClear(g.id); else db.indieKeyRemove(g.id, body.id);
            return { pool: db.indieKeyPool(g.id) };
        },
        "GET /api/admin/indie": async (req, _b, url) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            const status = ["pending", "approved", "rejected"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "pending";
            const { games } = db.indieList({ status, limit: 60, sort: "new" });
            return { open: db.getMeta("indie:open") !== "0", counts: db.indieCounts(), totals: db.indieTotals(), games: games.map(g => ({ ...indiePublic(g), status: g.status, note: g.note, owner: g.owner_id, views: g.views, clicks: g.clicks, created: g.created, reports: db.indieReportsFor(g.id) })), reports: db.indieReports("open").length };
        },
        "POST /api/admin/indie/open": async (req, body) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            db.setMeta("indie:open", body.open ? "1" : "0");
            return { open: Boolean(body.open) };
        },
        "POST /api/admin/indie/review": async (req, body) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            if (body.action === "syncall") { const n = await indieApi.syncDue(db, { limit: 30 }); return { ok: true, synced: n, counts: db.indieCounts() }; }
            const g = db.indieGet(body.id);
            if (!g) throw new HttpError(404, "That game is gone.");
            const note = String(body.note ?? "").trim().slice(0, 300) || null, tell = (title, text) => { try { db.addNotification(g.owner_id, { type: "indie", title, body: text, url: "/indie/mine" }); } catch { /* best effort */ } };
            switch (body.action) {
                case "approve": db.indieDecide(g.id, "approved", note); tell(`${g.title} is live in the indie showcase`, "People can find it now. Share the page anywhere you like."); break;
                case "reject": db.indieDecide(g.id, "rejected", note); tell(`${g.title} wasn't accepted yet`, note || "You can edit your pitch and send it back in."); break;
                case "remove": db.indieRemove(g.id); break;
                case "xpost": {
                    if (!xposter) throw new HttpError(503, "X posting isn't available on this bot.");
                    if (g.status !== "approved") throw new HttpError(400, "Approve the game first.");
                    try { await xposter.manual({ text: indieSpotlightText(g, `${origin}/indie/game/${g.id}`), kind: "auto" }); } catch (e) { throw new HttpError(400, e.message); }
                    break;
                }
                case "verify": db.indieSetVerified(g.id, true); tell(`${g.title} is now verified`, "Your game page shows the verified mark."); break;
                case "unverify": db.indieSetVerified(g.id, false); break;
                case "feature": db.indieFeature(g.id, true); break;
                case "unfeature": db.indieFeature(g.id, false); break;
                case "refresh": { try { const fresh = await indieApi.lookup(g.appid); db.indieRefresh(g.id, fresh); } catch (e) { throw new HttpError(400, e.message); } break; }
                default: throw new HttpError(400, "Unknown action.");
            }
            if (["approve", "reject", "remove"].includes(body.action)) await syncIndieDev(g.owner_id, body.action === "approve" ? g : null);
            return { ok: true, counts: db.indieCounts() };
        },
        "GET /api/admin/indie/reports": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            return { reports: db.indieReports("open").map(r => ({ id: r.id, gameId: r.game_id, title: r.title, appid: r.appid, image: r.image, reason: r.reason, reporter: r.reporter, created: r.created })) };
        },
        "POST /api/admin/indie/report": async (req, body) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            const g = db.indieGet(body.gameId);
            if (!g) throw new HttpError(404, "That game is gone.");
            db.indieResolveReports(g.id, body.action === "remove" ? "actioned" : "closed");
            if (body.action === "remove") { db.indieDecide(g.id, "rejected", "Taken down after a report."); try { db.addNotification(g.owner_id, { type: "indie", title: `${g.title} was taken down`, body: "It was reported and a person looked at it. Edit and resubmit if you think that's a mistake.", url: "/indie/mine" }); } catch { /* best effort */ } }
            return { ok: true };
        },
        "GET /api/admin/indie/spotlight": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            if (!spotlight) throw new HttpError(503, "The weekly spotlight isn't available.");
            return spotlight.status();
        },
        "POST /api/admin/indie/spotlight": async (req, body) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            if (!spotlight) throw new HttpError(503, "The weekly spotlight isn't available.");
            if (body.run) { const r = await spotlight.run({ force: true, gameId: body.gameId || null }); return { ran: r, ...spotlight.status() }; }
            try { return spotlight.set({ on: body.on, channel: body.channel }); } catch (e) { if (e instanceof UserError) throw new HttpError(400, e.message); throw e; }
        },
        "GET /api/admin/problems": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            return { list: readEvents(db, "adminlog:problems", 40) };
        },
        "POST /api/admin/problems/clear": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            db.setMeta("adminlog:problems", "[]");
            return { ok: true };
        },
        "GET /api/admin/xposter/next": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            if (!xposter) throw new HttpError(503, "X posting isn't available on this bot.");
            let list = [];
            try { list = await enrichFree(await itad.getGiveawayList()); } catch { /* shown as nothing queued */ }
            return xposter.peek(list);
        },
        "GET /api/admin/datarequests": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            const list = readEvents(db, "adminlog:datareq", 100), since = now() - 30 * 86400_000;
            return { list, month: { export: list.filter(r => r.kind === "export" && r.at > since).length, delete: list.filter(r => r.kind === "delete" && r.at > since).length } };
        },
        "GET /api/admin/serverevents": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            return { list: readEvents(db, "adminlog:servers", 30) };
        },
        "GET /api/admin/commandwatch": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            return commandWatch ? commandWatch.report() : { threshold: 0, rows: [] };
        },
        "GET /api/admin/offsite": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can see this.");
            if (!offsite?.enabled) return { enabled: false };
            let list = [], error = null;
            try { list = (await offsite.list()).slice(-14).reverse(); } catch (e) { error = e.message; }
            let last = null; try { last = JSON.parse(db.getMeta("offsite:last") || "null"); } catch { /* none yet */ }
            return { enabled: true, list, last, error };
        },
        "POST /api/admin/offsite/verify": async (req) => {
            if (!isOwner(session(req))) throw new HttpError(403, "Only the bot owner can do this.");
            if (!offsite?.enabled) throw new HttpError(400, "Offsite backups aren't set up.");
            try { return await offsite.verify(); } catch (e) { throw new HttpError(400, e.message || "The check failed."); }
        },
        "GET /api/admin/storage": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            return storage ? await storage() : { volume: null, dbMb: 0, walMb: 0, backupsMb: 0, backupCount: 0, tables: [] };
        },
        "GET /api/admin/system": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const mem = process.memoryUsage(), heap = v8.getHeapStatistics();
            const lag = await new Promise(r => { const t0 = process.hrtime.bigint(); setImmediate(() => r(Number(process.hrtime.bigint() - t0) / 1e6)); });
            const t = now();
            let live = 0; for (const v of sessions.values()) if (v.expires > t) live++;
            return {
                process: { uptimeS: Math.round(process.uptime()), rssMb: Math.round(mem.rss / 1048576), heapMb: Math.round(mem.heapUsed / 1048576), heapLimitMb: Math.round(heap.heap_size_limit / 1048576), node: process.version, platform: process.platform, lagMs: Math.round(lag * 10) / 10 },
                sessions: { signedIn: live, steamOnly: [...sessions.values()].filter(v => v.expires > t && v.steamOnly).length },
                bot: botInfo ? botInfo() : null,
                errors: ops ? (ops.snapshot()?.errors ?? []).slice(0, 10) : [],
                jobs: ops ? Object.entries(ops.snapshot()?.jobs ?? {}).map(([name, j]) => ({ name, ...j })) : [],
                admin: { host: adminHost, sharedCookie: Boolean(cookieDomain) },
                // which release and machine answered, so a deploy that didn't take is easy to spot
                deploy: { release: String(process.env.FLY_IMAGE_REF ?? "").split(":").pop().slice(0, 40) || null, machine: process.env.FLY_MACHINE_ID ?? null, region: process.env.FLY_REGION ?? null, startedAt: Date.now() - Math.round(process.uptime()) * 1000 }
            };
        },
        // The owner's own username and password, a second way into this panel. Changing anything needs the current password again.
        "GET /api/admin/account": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const r = db.getAdminLogin(config.ownerId);
            return { exists: Boolean(r), username: r?.username ?? null, created: r?.created ?? null, lastLogin: r?.last_login ?? null, totp: Boolean(r?.totp_on), pendingTotp: Boolean(r?.totp_secret && !r?.totp_on), viaPassword: Boolean(s.adminOnly) };
        },
        "POST /api/admin/account/save": async (req, b) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            const prev = db.getAdminLogin(config.ownerId);
            if (prev) verifyCurrent(prev, b.current);
            const username = String(b.username ?? "").trim().toLowerCase();
            if (!USERNAME_RE.test(username)) throw new HttpError(400, "The username needs 3 to 32 letters, numbers, dots, dashes or underscores, starting with a letter or number.");
            const bad = passwordProblem(b.password, username);
            if (bad) throw new HttpError(400, bad);
            db.saveAdminLogin(config.ownerId, username, String(b.password));
            const mine = cookies(req)[COOKIE];
            for (const [k, v] of sessions) if (v.adminOnly && !v.subAdmin && k !== mine) sessions.delete(k); // other password sessions end when the password changes
            return { ok: true, username };
        },
        "POST /api/admin/account/remove": async (req, b) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            const prev = db.getAdminLogin(config.ownerId);
            if (!prev) return { ok: true };
            verifyCurrent(prev, b.current);
            db.removeAdminLogin(config.ownerId);
            for (const [k, v] of sessions) if (v.adminOnly && !v.subAdmin) sessions.delete(k);
            return { ok: true };
        },
        "POST /api/admin/account/totp/start": async (req, b) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            const prev = db.getAdminLogin(config.ownerId);
            if (!prev) throw new HttpError(400, "Make a username and password first.");
            verifyCurrent(prev, b.current);
            const secret = newTotpSecret();
            db.setAdminTotp(config.ownerId, secret, false);
            return { secret, uri: totpUri(secret, prev.username) };
        },
        "POST /api/admin/account/totp/enable": async (req, b) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            const r = db.getAdminLogin(config.ownerId);
            if (!r?.totp_secret) throw new HttpError(400, "Start the setup first.");
            const step = matchTotp(r.totp_secret, b.code, now(), r.totp_step);
            if (!step) throw new HttpError(400, "That code is not right. Check the clock on your phone and try the next one.");
            db.setAdminTotp(config.ownerId, r.totp_secret, true);
            db.useAdminTotpStep(config.ownerId, step);
            return { ok: true };
        },
        "POST /api/admin/account/totp/disable": async (req, b) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            const r = db.getAdminLogin(config.ownerId);
            if (!r) return { ok: true };
            verifyCurrent(r, b.current);
            db.setAdminTotp(config.ownerId, null, false);
            return { ok: true };
        },
        // Extra panel logins the owner hands out. They open this admin panel and nothing else, and they never touch bot commands.
        "GET /api/admin/admins": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            return { admins: db.listAdminAccess(), areas: PANEL_AREAS.map(a => ({ id: a.id, label: a.label })) };
        },
        "POST /api/admin/admins/add": async (req, b) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (db.listAdminAccess().length >= 25) throw new HttpError(400, "That's plenty of admin users. Remove one before adding another.");
            const edit = cleanEdit(b.edit);
            if (b.kind === "discord") {
                const id = String(b.discordId ?? "").trim();
                if (!/^\d{17,20}$/.test(id)) throw new HttpError(400, "A Discord ID is 17 to 20 digits. Turn on Developer Mode in Discord, right-click the person and choose Copy User ID.");
                if (id === config.ownerId) throw new HttpError(400, "That's you. You already have full access.");
                if (db.getAdminAccess(id)) throw new HttpError(409, "That person is already an admin user.");
                db.setAdminAccess(id, "discord", String(b.label ?? "").trim().slice(0, 40), edit);
                try { db.logAudit({ actor: config.ownerId, action: "admin-user-add", target: id, detail: "discord" }); } catch { /* best effort */ }
                return { ok: true, id };
            }
            const username = String(b.username ?? "").trim().toLowerCase();
            if (!USERNAME_RE.test(username)) throw new HttpError(400, "The username needs 3 to 32 letters, numbers, dots, dashes or underscores, starting with a letter or number.");
            const bad = passwordProblem(b.password, username);
            if (bad) throw new HttpError(400, bad);
            if (db.getAdminLoginByName(username)) throw new HttpError(409, "Someone already has that username.");
            const id = "adm-" + randomBytes(6).toString("hex");
            db.saveAdminLogin(id, username, String(b.password));
            db.setAdminAccess(id, "password", username, edit);
            try { db.logAudit({ actor: config.ownerId, action: "admin-user-add", target: username, detail: id }); } catch { /* best effort */ }
            return { ok: true, id };
        },
        // What one admin user may change.
        "POST /api/admin/admins/access": async (req, b) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!db.getAdminAccess(b.id)) throw new HttpError(404, "That admin user isn't there anymore.");
            db.setAdminAccessEdit(b.id, cleanEdit(b.edit));
            try { db.logAudit({ actor: config.ownerId, action: "admin-user-access", target: String(b.id), detail: JSON.stringify(cleanEdit(b.edit)) }); } catch { /* best effort */ }
            return { ok: true };
        },
        "POST /api/admin/admins/reset": async (req, b) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            const row = /^adm-[0-9a-f]{12}$/.test(String(b.id)) && db.getAdminAccess(b.id) ? db.getAdminLogin(b.id) : null;
            if (!row) throw new HttpError(404, "That admin user isn't there anymore, or signs in with Discord.");
            const bad = passwordProblem(b.password, row.username);
            if (bad) throw new HttpError(400, bad);
            db.saveAdminLogin(row.owner_id, row.username, String(b.password));
            for (const [k, v] of sessions) if (v.userId === row.owner_id) sessions.delete(k);
            try { db.logAudit({ actor: config.ownerId, action: "admin-user-reset", target: row.username, detail: row.owner_id }); } catch { /* best effort */ }
            return { ok: true };
        },
        "POST /api/admin/admins/remove": async (req, b) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            const id = String(b.id ?? "");
            if (!id || id === config.ownerId || !db.getAdminAccess(id)) return { ok: true };
            db.removeAdminAccess(id);
            for (const [k, v] of sessions) if (v.userId === id && v.subAdmin) sessions.delete(k);
            try { db.logAudit({ actor: config.ownerId, action: "admin-user-remove", target: id, detail: "" }); } catch { /* best effort */ }
            return { ok: true };
        },
        // ---- the staff chat: the owner and the people let into the panel ----
        "GET /api/admin/chat/state": async (req) => {
            const s = chatSession(req); const me = chatMe(s); chatSeen(me);
            const people = chatPeople();
            const dms = db.staffDmRooms(me.key);
            const rooms = [...db.staffChannels().map(c => c.id), ...dms], unread = db.staffUnread(me.key, rooms);
            const latest = {}; for (const c of Object.keys(unread)) { const m = db.lastStaffMsg(c); if (m) latest[c] = { id: m.id, name: m.name, body: String(m.body).slice(0, 140) || "Sent a picture or clip" }; }
            return { me, channels: db.staffChannels(), people, unread, mentions: db.staffMentions(me.key, me.name, rooms), latest, dmRooms: dms };
        },
        "GET /api/admin/chat/messages": async (req, _b, url) => {
            const s = chatSession(req); const me = chatMe(s); chatSeen(me);
            const channel = chatChannel(me, String(url.searchParams.get("channel") ?? ""));
            const after = Math.max(0, Number(url.searchParams.get("after")) || 0);
            const messages = db.staffMessages(channel, after);
            if (messages.length) db.markStaffRead(me.key, channel, messages[messages.length - 1].id);
            const t = Date.now(), typing = [...(chatTyping.get(channel) ?? new Map())].filter(([k, at]) => k !== me.key && t - at < 5000).map(([k]) => chatPeople().find(p => p.key === k)?.name ?? "Someone");
            return { messages, typing, people: chatPeople().map(p => ({ key: p.key, online: p.online })) };
        },
        "POST /api/admin/chat/send": async (req, b) => {
            const s = chatSession(req); const me = chatMe(s);
            if (!chatLimit.hit(me.key).ok) throw new HttpError(429, "Slow down a little.");
            const channel = chatChannel(me, String(b.channel ?? ""));
            const body = String(b.body ?? "").replace(/\r/g, "").trim();
            const media = b.media ? db.getStaffMedia(String(b.media)) : null;
            if (b.media && (!media || media.owner !== me.key || media.msg)) throw new HttpError(400, "That picture didn't upload. Try attaching it again.");
            if (!body && !media) throw new HttpError(400, "Type something first.");
            const reply = b.reply && db.getStaffMsg(b.reply)?.channel === channel ? Number(b.reply) : null;
            const id = db.sendStaff(channel, me.key, me.name, body, reply, media?.id ?? null);
            db.markStaffRead(me.key, channel, id); chatSeen(me);
            return { ok: true, id };
        },
        // How the desktop looks for each person signed in: the look and the wallpaper. Everyone on the panel may change their own.
        "GET /api/admin/prefs": async (req) => {
            const s = chatSession(req); const me = chatMe(s);
            let p = {}; try { p = JSON.parse(db.getMeta("admprefs:" + me.key) || "{}"); } catch { /* fresh */ }
            return { prefs: cleanLook(p), walls: WALLS.map(w => ({ id: w.id, name: w.name, css: w.css })) };
        },
        "POST /api/admin/prefs": async (req, b) => {
            const s = chatSession(req); const me = chatMe(s);
            const p = cleanLook(b);
            db.setMeta("admprefs:" + me.key, JSON.stringify(p));
            return { ok: true, prefs: p };
        },
        // ----- radio: SoundCloud links the staff add, played from one shared list -----
        "GET /api/admin/radio": async (req) => {
            const s = chatSession(req); const me = chatMe(s);
            return { tracks: db.radioList().map(t => ({ id: t.id, title: t.title, author: t.author, art: t.art, embed: t.embed, url: t.url, by: t.by_name, mine: t.by_key === me.key, at: t.at })), owner: me.owner, max: RADIO_MAX };
        },
        "POST /api/admin/radio/add": async (req, b) => {
            const s = chatSession(req); const me = chatMe(s);
            if (!chatLimit.hit(me.key).ok) throw new HttpError(429, "Slow down a little.");
            let u; try { u = new URL(String(b.url ?? "").trim()); } catch { throw new HttpError(400, "That doesn't look like a link."); }
            if (u.protocol !== "https:" || !/^(www\.|m\.)?soundcloud\.com$|^on\.soundcloud\.com$/.test(u.hostname)) throw new HttpError(400, "Paste a SoundCloud link, like https://soundcloud.com/artist/track.");
            if (db.radioCount() >= RADIO_MAX) throw new HttpError(400, `The radio holds ${RADIO_MAX} tracks. Remove a few first.`);
            let info;
            try {
                const r = await (config.soundcloudFetch ?? globalThis.fetch)(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(u.toString())}`, { signal: AbortSignal.timeout(10_000) });
                if (!r.ok) throw new Error(String(r.status));
                info = await r.json();
            } catch { throw new HttpError(400, "SoundCloud didn't know that link. Check it's a public track or set."); }
            const src = /src="(https:\/\/w\.soundcloud\.com\/player\/\?[^"]+)"/.exec(String(info.html ?? ""))?.[1]?.replace(/&amp;/g, "&");
            let embed = null; try { embed = new URL(src).searchParams.get("url"); } catch { /* handled below */ }
            if (!embed || !/^https:\/\/api\.soundcloud\.com\/(tracks|playlists)\/\d+$/.test(embed)) throw new HttpError(400, "I couldn't play that one. Try another link.");
            if (db.radioHas(embed)) throw new HttpError(409, "That one is already on the radio.");
            const art = /^https:\/\/[a-z0-9.-]*sndcdn\.com\//.test(String(info.thumbnail_url ?? "")) ? info.thumbnail_url : null;
            const id = db.radioAdd({ url: u.toString().slice(0, 300), embed, title: String(info.title ?? "Untitled").replace(/\s+by\s+.+$/i, ""), author: info.author_name ?? "", art, by_key: me.key, by_name: me.name });
            return { ok: true, id };
        },
        "POST /api/admin/radio/remove": async (req, b) => {
            const s = chatSession(req); const me = chatMe(s);
            const t = db.radioGet(b.id);
            if (!t) return { ok: true };
            if (t.by_key !== me.key && !me.owner) throw new HttpError(403, "You can only remove tracks you added.");
            db.radioRemove(t.id);
            return { ok: true };
        },
        "POST /api/admin/chat/typing": async (req, b) => {
            const s = chatSession(req); const me = chatMe(s);
            const channel = chatChannel(me, String(b.channel ?? ""));
            if (!chatTyping.has(channel)) chatTyping.set(channel, new Map());
            chatTyping.get(channel).set(me.key, Date.now());
            return { ok: true };
        },
        "POST /api/admin/chat/edit": async (req, b) => {
            const s = chatSession(req); const me = chatMe(s);
            const m = db.getStaffMsg(b.id);
            if (!m) throw new HttpError(404, "That message is gone.");
            if (m.author !== me.key) throw new HttpError(403, "You can only edit your own messages.");
            const body = String(b.body ?? "").replace(/\r/g, "").trim();
            if (!body) throw new HttpError(400, "A message can't be empty. Delete it instead.");
            db.editStaffMsg(m.id, body);
            return { ok: true };
        },
        "POST /api/admin/chat/react": async (req, b) => {
            const s = chatSession(req); const me = chatMe(s);
            const m = db.getStaffMsg(b.id), emoji = String(b.emoji ?? "");
            if (!m) throw new HttpError(404, "That message is gone.");
            if (!["👍", "❤️", "😂", "🎉", "👀", "✅", "🙏", "🔥"].includes(emoji)) throw new HttpError(400, "Pick one of the listed reactions.");
            chatChannel(me, m.channel);
            db.toggleStaffReact(m.id, me.key, emoji);
            return { ok: true };
        },
        "GET /api/admin/chat/requests": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const list = db.listRequests(s.userId, { sort: "new" }).map(r => ({ id: r.id, title: r.title, body: String(r.body ?? "").slice(0, 1500), status: r.status, note: r.note, user_name: r.user_name, votes: r.votes, created_at: r.created_at }));
            return { requests: list, statuses: REQUEST_STATUSES, open: list.filter(r => r.status === "open").length };
        },
        "POST /api/admin/chat/delete": async (req, b) => {
            const s = chatSession(req); const me = chatMe(s);
            const m = db.getStaffMsg(b.id);
            if (!m) return { ok: true };
            if (m.author !== me.key && !me.owner) throw new HttpError(403, "You can only delete your own messages.");
            dropFiles(db.staffMediaOfMsg(m.id));
            db.deleteStaffMsg(m.id);
            return { ok: true };
        },
        "POST /api/admin/chat/channel": async (req, b) => {
            const s = chatSession(req); const me = chatMe(s);
            if (!me.owner) throw new HttpError(403, "Only the owner can add channels.");
            if (db.staffChannels().length >= 12) throw new HttpError(400, "That's enough channels for now.");
            const id = db.addStaffChannel(b.name);
            if (!id) throw new HttpError(400, "Pick a different name. Use letters, numbers and dashes, and not one that already exists.");
            return { ok: true, id };
        },
        "POST /api/admin/chat/channel/delete": async (req, b) => {
            const s = chatSession(req); const me = chatMe(s);
            if (!me.owner) throw new HttpError(403, "Only the owner can remove channels.");
            if (["general", "support"].includes(String(b.id))) throw new HttpError(400, "That one stays.");
            dropFiles(db.staffMediaOfChannel(String(b.id)));
            db.removeStaffChannel(String(b.id));
            return { ok: true };
        },
        // A panel user changing their own password.
        "POST /api/admin/self/password": async (req, b) => {
            const s = session(req);
            if (!s.viaSub) throw new HttpError(403, "This is for admin users. The owner changes the password on the Account page.");
            const row = db.getAdminLogin(s.viaSub);
            if (!row) throw new HttpError(400, "You sign in with Discord, so there is no password to change.");
            const t = now();
            if (row.locked_until > t) throw new HttpError(429, "Too many wrong passwords. Try again later.");
            if (!checkPassword(String(b.current ?? ""), row.salt, row.hash)) { db.failAdminLogin(row.owner_id, t); throw new HttpError(403, "That is not your current password."); }
            const bad = passwordProblem(b.password, row.username);
            if (bad) throw new HttpError(400, bad);
            db.saveAdminLogin(row.owner_id, row.username, String(b.password));
            const mine = cookies(req)[COOKIE];
            for (const [k, v] of sessions) if (v.userId === row.owner_id && k !== mine) sessions.delete(k);
            return { ok: true };
        },
        // Names for Discord IDs shown on admin pages, so a number is easy to put a face to. Unknown IDs just come back without a name.
        "GET /api/admin/names": async (req, _b, url) => {
            const s = session(req);
            if (!isOwner(s) && !s.subAdmin) throw new HttpError(403, "Only admins can look names up.");
            const ids = [...new Set(String(url.searchParams.get("ids") ?? "").split(",").filter(x => /^\d{15,22}$/.test(x)))].slice(0, 40);
            const names = {};
            await Promise.all(ids.map(async id => {
                const n = db.getMeta?.("staffname:" + id) || await remember("uname:" + id, 6 * 3_600_000, async () => (await rest?.userName?.(id)) ?? null).catch(() => null);
                if (n) names[id] = String(n).slice(0, 60);
            }));
            return { names };
        },
        "GET /api/admin/stats": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            return { stats: db.stats(), health: ops ? ops.snapshot() : null };
        },

        // How often each command is run from a panel's Run button (counts only), so you can see which panels people use.
        "GET /api/admin/panels": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const rows = db.listMetaPrefix("pnuse:").map(r => ({ command: "/" + r.key.slice(6), runs: Number(r.value) })).sort((a, b) => b.runs - a.runs).slice(0, 100);
            return { rows, total: rows.reduce((t, r) => t + r.runs, 0) };
        },

        "GET /api/admin/insights": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const ins = db.adminInsights(), info = botInfo ? botInfo() : null, mem = process.memoryUsage();
            const live = (guildList ? guildList() : []).filter(g => !isHidden(g.id));
            const byId = new Map(live.map(g => [g.id, g]));
            // Every server the bot is in, with what has been set up there. Servers that never set anything are still listed.
            const rows = new Map(ins.servers.filter(r => !isHidden(r.id)).map(r => [r.id, r]));
            const blocked = new Map(db.blockedGuilds().map(b => [b.id, b]));
            const servers = [...new Set([...live.map(g => g.id), ...rows.keys(), ...blocked.keys()])].map(id => ({ blocked: blocked.has(id) ? blocked.get(id).reason || "blocked" : null, id, name: byId.get(id)?.name ?? null, members: byId.get(id)?.members ?? null, tracked: rows.get(id)?.members ?? 0, channel: rows.has(id), freeFeed: Boolean(rows.get(id)?.free_feed), groupMin: rows.get(id)?.group_min ?? 0, digest: Boolean(rows.get(id)?.weekly_digest), inServer: guildList ? byId.has(id) : null }))
                .sort((a, b) => (b.members ?? 0) - (a.members ?? 0) || b.tracked - a.tracked);
            const fun = db.funnelStats(Date.now() - 30 * 86400_000);
            return { ...ins, funnel: { joined: fun.joined, started: fun.started, setup: fun.setup, recent: fun.recent.map(r => ({ id: r.id, name: byId.get(r.id)?.name ?? null, join: r.join, start: r.start ?? null, setup: r.setup ?? null })) }, servers, bot: { version: info?.version ?? null, uptime: info?.uptime ?? null, pingMs: info?.pingMs ?? null, servers: info?.servers ?? null, rssMb: Math.round(mem.rss / 1048576), node: process.version } };
        },
        // What the community features are being used for, across every server (counts only, never messages).
        "GET /api/admin/community": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const live = new Map((guildList?.() ?? []).filter(g => !isHidden(g.id)).map(g => [g.id, g]));
            const c = db.adminCommunity();
            return { ...c, membersIntent: membersIntent(), servers: c.servers.map(r => ({ ...r, name: live.get(r.id)?.name ?? null, members: live.get(r.id)?.members ?? null })) };
        },
        "GET /api/admin/user": async (req, _b, url) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const id = String(url.searchParams.get("id") ?? "").trim();
            if (!/^\d{5,25}$/.test(id)) throw new HttpError(400, "Paste a Discord user ID (numbers only).");
            const u = db.adminUser(id);
            if (!u) throw new HttpError(404, "Nobody with that ID has used the bot.");
            return u;
        },
        "POST /api/admin/user": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const id = String(body.id ?? "").trim();
            if (!/^\d{5,25}$/.test(id) || !db.getUser(id)) throw new HttpError(404, "Nobody with that ID has used the bot.");
            if (body.action === "reset_dm") db.updateUser(id, { dm_failures: 0 });
            else if (body.action === "pause") db.updateUser(id, { paused: 1 });
            else if (body.action === "resume") db.updateUser(id, { paused: 0 });
            else throw new HttpError(400, "Unknown action.");
            log(`Bot owner ran "${body.action}" on member ${id}`);
            return db.adminUser(id);
        },
        "GET /api/admin/server-members": async (req, _b, url) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const gid = String(url.searchParams.get("guild") ?? "");
            if (!/^\d{5,25}$/.test(gid) || isHidden(gid)) throw new HttpError(404, "Unknown server.");
            const days = Math.min(365, Math.max(0, Number(url.searchParams.get("days") ?? 30) || 0));
            const members = db.serverMembers(gid, { activeDays: days, limit: 200 });
            // Names are a nice-to-have; ask Discord for the first batch and carry on without them if it won't say.
            await Promise.all(members.slice(0, 60).map(async m => {
                try { const r = await rest.getMember?.(gid, m.id); const u = r?.user ?? r; m.name = r?.nick || u?.global_name || u?.username || null; if (u?.username) m.username = u.username; } catch { /* left the server, or Discord is busy */ }
            }));
            return { members, days };
        },
        "GET /api/admin/bans": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            return { bans: db.listBans() };
        },
        "POST /api/admin/ban": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            const id = String(body.id ?? "").replace(/\D/g, "");
            if (!/^\d{5,25}$/.test(id)) throw new HttpError(400, "Paste a Discord user ID (numbers only).");
            if (id === config.ownerId) throw new HttpError(400, "You can't restrict yourself.");
            if (body.ban === false) { db.unbanUser(id); log(`Bot owner lifted the restriction on ${id}`); return { banned: false, id }; }
            db.banUser(id, String(body.reason ?? ""), s.userId);
            for (const [k, v] of sessions) if (v.userId === id) sessions.delete(k); // signed out right away
            log(`Bot owner restricted ${id}`);
            return { banned: true, id };
        },
        "POST /api/admin/clear-dm-failures": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const n = db.clearAllDmFailures();
            log(`Bot owner cleared the DM failure count for ${n} member${n === 1 ? "" : "s"}`);
            return { cleared: n };
        },

        "GET /api/admin/broadcast": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const b = broadcaster();
            return { counts: b.counts(), current: b.current(), history: db.listBroadcasts(8), maxBody: MAX_BODY, canSend: Boolean(dm) };
        },
        "POST /api/admin/broadcast": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            if (!dm) throw new HttpError(400, "Sending is not available here.");
            const audience = String(body.audience ?? "");
            // Test sends go only to the owner. Anything bigger needs the word SEND typed, so it cannot go out by accident.
            if (audience !== "me" && body.confirm !== "SEND") throw new HttpError(400, "Type SEND to confirm.");
            const undo = audience !== "me" ? cooldown(s.userId, "broadcast") : () => {};
            try {
                const r = broadcaster().start({ title: body.title, body: body.body, audience, promo: body.kind === "promo", preset: body.kind === "preset" ? String(body.preset ?? "") : null, mention: ["everyone", "here"].includes(body.mention) ? body.mention : "none" });
                log(`Bot owner started broadcast #${r.id} to ${audience} (${r.total} recipient${r.total === 1 ? "" : "s"})`);
                return { ...r, current: broadcaster().current() };
            } catch (e) { undo(); if (e instanceof UserError) throw new HttpError(400, e.message); throw e; }
        },

        "POST /api/admin/server/leave": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            const id = String(body.id ?? "");
            if (!/^\d{5,25}$/.test(id)) throw new HttpError(400, "Pick a server first.");
            const block = Boolean(body.block);
            if (block) db.blockGuild(id, String(body.reason ?? ""));
            let left = false;
            if (leaveGuild) { try { left = await leaveGuild(id); } catch (e) { if (!block) throw new HttpError(400, e.message || "Could not leave that server."); } }
            log(`Bot owner ${block ? "blocked" : "left"} server ${id}`);
            return { left: Boolean(left), blocked: block };
        },

        "POST /api/admin/server/unblock": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            return { unblocked: db.unblockGuild(String(body.id ?? "")) };
        },

        "POST /api/admin/server/invite": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!guildInvite) throw new HttpError(400, "Invites aren't available here.");
            const id = String(body.id ?? "");
            if (!/^\d{5,25}$/.test(id)) throw new HttpError(400, "Pick a server first.");
            try { const url = await guildInvite(id); log(`Bot owner made a one-use invite for server ${id}`); return { url }; }
            catch (e) { throw new HttpError(400, e.message || "Could not make an invite."); }
        },

        "GET /api/admin/bugs": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const seen = Number(db.getMeta("bugs_seen") ?? 0);
            const bugs = db.listBugs({ limit: 100 }).map(t => ({ id: t.id, subject: t.subject, status: t.status, user_id: t.user_id, user_name: t.user_name, created_at: t.created_at, updated_at: t.updated_at, text: String(t.first).slice(0, 600), replies: t.replies, isNew: t.created_at > seen && ["open", "waiting"].includes(t.status) }));
            return { bugs, newCount: bugs.filter(b => b.isNew).length, open: bugs.filter(b => ["open", "waiting"].includes(b.status)).length };
        },
        // Support tickets and bug reports inside the staff chat. Panel users act as the owner here, same as the rest of /api/admin.
        "GET /api/admin/chat/tickets": async (req, _b, url) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            needTickets();
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const status = ["active", "resolved", "closed"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "active";
            const seen = Number(db.getMeta("bugs_seen") ?? 0);
            const list = db.listTickets({ all: true, status, limit: 60 }).map(t => ({ id: t.id, subject: t.subject, status: t.status, user_name: t.user_name, updated_at: t.updated_at, created_at: t.created_at,
                bug: String(t.tags ?? "").split(",").includes("bug"), assigned: Boolean(t.assignee_id), isNew: t.created_at > seen && ["open", "waiting"].includes(t.status) }));
            return { tickets: list, open: db.listTickets({ all: true, status: "active", limit: 200 }).length };
        },
        "GET /api/admin/chat/ticket": async (req, _b, url) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            needTickets();
            const { t } = ticketAccess(s, url.searchParams.get("id"));
            return { ticket: { id: t.id, subject: t.subject, status: t.status, user_id: t.user_id, user_name: t.user_name, assignee_id: t.assignee_id, tags: t.tags, created_at: t.created_at },
                messages: db.listTicketMessages(t.id), canned: db.listCanned(t.guild_id ?? "*"), errors: logs && String(t.tags ?? "").includes("bug") ? logs.recent({ level: "error", limit: 8 }) : [] };
        },
        "POST /api/admin/tickets/reply": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            needTickets();
            const { t } = ticketAccess(s, body.id);
            await tickets.reply(t.id, { authorId: s.userId, role: t.user_id === s.userId ? "user" : "staff", body: body.body });
            return { ok: true };
        },
        "POST /api/admin/tickets/status": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            needTickets();
            const { t } = ticketAccess(s, body.id);
            if (body.status === "resolved") await tickets.resolve(t.id, { by: s.userId, note: body.note ? String(body.note).slice(0, 500) : null });
            else if (body.status === "closed") await tickets.close(t.id, { by: s.userId });
            else throw new HttpError(400, "Unknown status.");
            return { ok: true };
        },
        "POST /api/admin/bugs/seen": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            db.setMeta("bugs_seen", Date.now()); // same clock the ticket store stamps with
            return { ok: true };
        },

        // ----- network-wide giveaways: one giveaway shown in every server's giveaway channel and in DMs -----
        "GET /api/admin/giveaways": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const names = new Map((guildList?.() ?? []).map(g => [g.id, g.name]));
            const dest = db.giveawayDestinations().map(d => ({ id: d.guild_id, name: names.get(d.guild_id) ?? d.guild_id, channel_id: d.channel_id }));
            const list = db.listGlobalGiveaways(15).map(g => ({ id: g.id, title: g.title, host: g.host_name ?? null, steps: g.steps ? JSON.parse(g.steps).length : 0, status: g.status, ends_at: g.ends_at, entries: db.countEntries(g.id), prizes: db.listKeys(g.id).length, outcome: outcomeOf(g, db.listKeys(g.id)),
                channels: db.listMirrors(g.id).filter(m => m.kind === "channel").length + 1, dms: db.listMirrors(g.id).filter(m => m.kind === "dm").length, spread: giveaways?.spreadStatus(g.id) ?? null }));
            const reached = new Set(dest.map(d => d.id));
            const skipped = (guildList?.() ?? []).filter(g => !reached.has(g.id)).map(g => g.name).slice(0, 30);
            return { available: Boolean(giveaways), pending: await pendingClaimsFor(null), destinations: dest, skipped, dm: db.broadcastTargets().users.length, list, ownerName: config.creator?.name ?? "You", stepKinds: Object.entries(STEP_KINDS).map(([id, k]) => ({ id, label: k.label, hint: k.hint })) };
        },
        "POST /api/admin/giveaways/remind": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!giveaways) throw new HttpError(503, "Giveaways are not set up on this bot.");
            try { await giveaways.remind(Number(body.key_id)); } catch (e) { if (e instanceof UserError) throw new HttpError(400, e.message); throw e; }
            return { ok: true };
        },
        "POST /api/admin/giveaways/create": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            needGiveaways();
            if (String(body.confirm ?? "").trim().toUpperCase() !== "SEND") throw new HttpError(400, "Type SEND to confirm.");
            const audience = ["channels", "dm", "both"].includes(body.audience) ? body.audience : "both";
            const dest = db.giveawayDestinations();
            if (!dest.length) throw new HttpError(400, "No server has a giveaway or alert channel yet. Set one first.");
            const home = dest.find(d => d.guild_id === body.home) ?? dest[0];
            const undo = cooldown(s.userId, "broadcast");
            try {
                const text = v => (v === null || v === undefined || v === "" ? null : String(v));
                const { keys, duplicates } = parseKeys(String(body.keys ?? "").slice(0, 20_000), text(body.game) ?? text(body.title) ?? "Prize");
                let host, steps;
                try { host = parseHost(body.host, config.creator?.name ?? "the bot owner"); steps = parseSteps(body.steps); }
                catch (e) { if (e instanceof StepError) throw new HttpError(400, e.message); throw e; }
                const r = await giveaways.create({
                    guild_id: home.guild_id, channel_id: home.channel_id, host_id: s.userId, title: body.title, duration_ms: parseDuration(text(body.length) ?? "24h"),
                    game_title: text(body.game), description: text(body.description), image_url: parseImageUrl(body.image, "image"), thumbnail_url: parseImageUrl(body.thumbnail, "thumbnail"),
                    color: parseColor(body.color), button_label: text(body.button_label),
                    claim_hours: Number(body.claim_hours) || undefined, keys, auto_image: true, is_global: true, host, steps, require_steam: Boolean(body.steam_verified)
                });
                const targets = db.broadcastTargets();
                const sent = await giveaways.spread(r.id, {
                    channelIds: audience === "dm" ? [] : dest.map(d => d.channel_id), labels: new Map(dest.map(d => [d.channel_id, (guildList?.() ?? []).find(g => g.id === d.guild_id)?.name ?? d.guild_id])),
                    dmUsers: audience === "channels" ? [] : targets.users, delayMs: config.broadcastDelayMs ?? 1100
                });
                log(`Bot owner started global giveaway #${r.id}`);
                return { id: r.id, prizes: r.prizes, ends_at: r.ends_at, total: sent.total, duplicates };
            } catch (err) { undo(); throw err; }
        },
        "POST /api/admin/giveaways/end": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            needGiveaways();
            const g = db.getGiveaway(Number(body.id));
            if (!g || !g.is_global) throw new HttpError(404, "That is not a network-wide giveaway.");
            const r = await giveaways.end(g.id);
            return { winners: r.winners.length };
        },

        "GET /api/admin/logs": async (req, _b, url) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can see this.");
            const level = ["error", "warn", "activity", "all"].includes(url.searchParams.get("level")) ? url.searchParams.get("level") : "error";
            return { lines: logs ? logs.recent({ level, limit: 200 }) : [], available: Boolean(logs) };
        },

        "POST /api/admin/logs/clear": async (req) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            if (!logs?.clear) throw new HttpError(503, "Logging is not turned on.");
            const cleared = logs.clear();
            log(`Bot owner cleared the logs (${cleared} lines)`);
            return { cleared };
        },

        // ----- support tickets (same thread as the Discord side) -----
        "GET /api/tickets": async (req, _b, url) => {
            const s = session(req); needTickets();
            const q = String(url.searchParams.get("q") ?? "").slice(0, 60), status = url.searchParams.get("status") || null;
            const mine = db.listTickets({ userId: s.userId, limit: 50 });
            const mgd = s.guilds.filter(isManager);
            const staff = isOwner(s) || mgd.length > 0;
            const inbox = staff ? db.listTickets({ all: isOwner(s), guildIds: mgd.map(g => g.id), status, q, limit: 100 }) : [];
            const cut = t => ({ id: t.id, subject: t.subject, status: t.status, assignee_id: t.assignee_id, tags: t.tags, user_id: t.user_id, user_name: t.user_name, guild_id: t.guild_id, updated_at: t.updated_at, created_at: t.created_at, rating: t.rating });
            return { mine: mine.map(cut), inbox: inbox.map(cut), staff, owner: isOwner(s),
                guilds: mgd.map(g => ({ id: g.id, name: g.name, ...settingsView(g.id) })), ownerSettings: isOwner(s) ? settingsView("*") : null };
        },
        "GET /api/tickets/one": async (req, _b, url) => {
            const s = session(req); needTickets();
            const { t, staff } = ticketAccess(s, url.searchParams.get("id"));
            const out = { ticket: t, messages: db.listTicketMessages(t.id), staff, canned: staff ? db.listCanned(t.guild_id ?? "*") : [] };
            // Recent errors help the owner debug a problem report. Staff of other servers never see them.
            if (isOwner(s) && logs) out.errors = logs.recent({ level: "error", limit: 15 });
            return out;
        },
        // ----- feature requests: members suggest and vote, the owner sets the status -----
        "GET /api/requests": async (req, _b, url) => {
            const s = session(req);
            const status = url.searchParams.get("status");
            return { requests: db.listRequests(s.userId, { status: REQUEST_STATUSES[status] ? status : null, sort: url.searchParams.get("sort") === "new" ? "new" : "votes" }),
                statuses: REQUEST_STATUSES, counts: db.requestCounts(), max: MAX_OPEN_PER_USER, isOwner: isOwner(s) };
        },
        "POST /api/requests": async (req, body) => {
            const s = session(req);
            const { title, body: text } = cleanRequest({ title: body.title, body: body.body });
            if (db.openCountFor(s.userId) >= MAX_OPEN_PER_USER) throw new HttpError(429, limitMessage());
            const undo = cooldown(s.userId, "request");
            let id;
            try { id = db.addRequest({ userId: s.userId, userName: s.username ?? null, title, body: text }); } catch (e) { undo(); throw e; }
            publishRequest({ db, api: rest, id, base: config.publicUrl }).catch(() => {}); // into each server's feature-requests forum, in the background
            return { id };
        },
        "POST /api/requests/vote": async (req, body) => {
            const s = session(req); cooldown(s.userId, "requestvote");
            const r = db.getRequest(Number(body.id));
            if (!r) throw new HttpError(404, "I can't find that request.");
            return { voted: db.toggleRequestVote(r.id, s.userId) };
        },
        // The bot owner moves a request along (in development, shipped, rejected…) with an optional note. The requester gets a DM.
        "POST /api/admin/requests/status": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do that.");
            const r = db.getRequest(Number(body.id));
            if (!r) throw new HttpError(404, "I can't find that request.");
            const status = String(body.status ?? "");
            if (!REQUEST_STATUSES[status]) throw new HttpError(400, "Pick a valid status.");
            const note = String(body.note ?? "").trim().slice(0, REQ_NOTE);
            db.setRequestStatus(r.id, status, note);
            refreshRequest({ db, api: rest, id: r.id, base: config.publicUrl }).catch(() => {}); // move the tag in each forum
            let notified = false;
            if (body.notify !== false && status !== r.status && r.user_id !== s.userId) {
                try {
                    await dm(r.user_id, ideaStatusEmbed({ title: r.title, status, label: REQUEST_STATUSES[status], note, url: config.publicUrl ? `${config.publicUrl}/#/requests` : null }));
                    notified = true;
                } catch { /* DMs closed: the status is still saved and visible on the page */ }
            }
            return { ok: true, notified };
        },
        "POST /api/admin/requests/delete": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do that.");
            const id = Number(body.id);
            await removeRequestPosts({ db, api: rest, id }).catch(() => {});
            return { removed: db.deleteRequest(id) };
        },

        "POST /api/tickets": async (req, body) => {
            const s = session(req); needTickets();
            const gid = body.guild_id && s.guilds.some(g => g.id === body.guild_id) ? body.guild_id : null;
            return tickets.open({ userId: s.userId, userName: s.username ?? null, guildId: gid, subject: body.subject, body: body.body, kind: body.kind === "bug" ? "bug" : "help" });
        },
        "POST /api/tickets/reply": async (req, body) => {
            const s = session(req); needTickets();
            const { t, staff } = ticketAccess(s, body.id);
            const asStaff = staff && t.user_id !== s.userId;
            await tickets.reply(t.id, { authorId: s.userId, role: asStaff ? "staff" : "user", body: body.body });
            return { ok: true };
        },
        "POST /api/tickets/status": async (req, body) => {
            const s = session(req); needTickets();
            const { t, staff } = ticketAccess(s, body.id);
            if (!staff && body.status !== "closed") throw new HttpError(403, "Only support staff can do that.");
            if (body.status === "resolved") await tickets.resolve(t.id, { by: s.userId, note: body.note ? String(body.note).slice(0, 500) : null });
            else if (body.status === "closed") await tickets.close(t.id, { by: s.userId });
            else throw new HttpError(400, "Unknown status.");
            return { ok: true };
        },
        "POST /api/tickets/assign": async (req, body) => {
            const s = session(req); needTickets();
            const { t, staff } = ticketAccess(s, body.id);
            if (!staff) throw new HttpError(403, "Only support staff can do that.");
            await tickets.assign(t.id, body.assignee === null ? null : s.userId);
            return { ok: true };
        },
        "POST /api/tickets/tags": async (req, body) => {
            const s = session(req); needTickets();
            const { t, staff } = ticketAccess(s, body.id);
            if (!staff) throw new HttpError(403, "Only support staff can do that.");
            await tickets.setTags(t.id, body.tags);
            return { ok: true };
        },
        "POST /api/tickets/rate": async (req, body) => { const s = session(req); needTickets(); return { rating: tickets.rate(Number(body.id), s.userId, body.rating) }; },
        "GET /api/tickets/transcript": async (req, _b, url) => {
            const s = session(req); needTickets();
            const { t } = ticketAccess(s, url.searchParams.get("id"));
            return { name: `ticket-${t.id}.txt`, text: tickets.transcript(t.id) };
        },
        "POST /api/tickets/setup": async (req, body) => {
            const s = session(req); needTickets();
            const scope = body.guild_id === "*" ? "*" : managerGuild(s, String(body.guild_id)).id;
            if (scope === "*" && !isOwner(s)) throw new HttpError(403, "Only the bot owner can set this.");
            const id = v => (/^\d{15,25}$/.test(String(v ?? "").trim()) ? String(v).trim() : null);
            if (body.channel_id && !id(body.channel_id)) throw new HttpError(400, "That does not look like a channel ID. Enable Developer Mode, right-click the channel, Copy Channel ID.");
            db.setTicketSettings(scope, { channelId: id(body.channel_id), staffRoleId: id(body.staff_role_id) });
            return settingsView(scope);
        },
        "POST /api/tickets/canned": async (req, body) => {
            const s = session(req); needTickets();
            const scope = body.guild_id === "*" ? "*" : managerGuild(s, String(body.guild_id)).id;
            if (scope === "*" && !isOwner(s)) throw new HttpError(403, "Only the bot owner can edit these.");
            if (body.remove) db.removeCanned(scope, Number(body.remove));
            else {
                const title = String(body.title ?? "").trim().slice(0, 60), text = String(body.body ?? "").trim().slice(0, 1500);
                if (!title || !text) throw new HttpError(400, "Give the reply a title and some text.");
                db.addCanned(scope, title, text);
            }
            return { canned: db.listCanned(scope) };
        },

        "POST /api/mydata/delete": async (req, body) => {
            const s = session(req);
            if (body.confirm !== "DELETE") throw new HttpError(400, "Type DELETE to confirm.");
            const deleted = db.deleteUser(s.userId);
            pushEvent(db, "adminlog:datareq", { kind: "delete", via: "Dashboard", at: now() }, 100);
            return { deleted };
        }
    };

    // ---------- auth ----------
    async function login(req, res) {
        sweep();
        // Sent here from the admin panel: after signing in, go back there.
        const next = new URL(req.url, origin).searchParams.get("next");
        if (next === "admin" || next === "music" || next === "indie") setCookie(res, NEXT_COOKIE, next, 600);
        const state = randomBytes(24).toString("hex");
        states.set(state, now() + 10 * 60_000);
        setCookie(res, STATE_COOKIE, state, 600);
        send(res, 302, "", { Location: rest.authorizeUrl(state) });
    }

    // Linked Roles: the same Discord sign-in, plus permission to show Steam on the member's Discord profile.
    const linkedStates = new Set();
    async function linkedStart(req, res) {
        sweep();
        const state = randomBytes(24).toString("hex");
        states.set(state, now() + 10 * 60_000);
        linkedStates.add(state);
        setCookie(res, STATE_COOKIE, state, 600);
        send(res, 302, "", { Location: rest.authorizeUrl(state, { linkedRoles: true }) });
    }

    // Twitch link: the same Discord sign-in, plus permission to read which Twitch account is in their Discord connections.
    const twitchStates = new Set();
    async function twitchStart(req, res) {
        sweep();
        const state = randomBytes(24).toString("hex");
        states.set(state, now() + 10 * 60_000);
        twitchStates.add(state);
        setCookie(res, STATE_COOKIE, state, 600);
        send(res, 302, "", { Location: rest.authorizeUrl(state, { connections: true }) });
    }

    async function callback(req, res, url) {
        const state = url.searchParams.get("state");
        const linked = linkedStates.delete(state);
        const twitch = twitchStates.delete(state);
        const code = url.searchParams.get("code");
        const ok = state && states.has(state) && states.get(state) > now() && cookies(req)[STATE_COOKIE] === state;
        states.delete(state);
        setCookie(res, STATE_COOKIE, "", 0);
        // Signed in with Steam first, and Discord would not finish silently (not signed in to Discord here, or it was declined):
        // keep the Steam session so nothing is lost, and the page offers the Discord half.
        const kt = cookies(req)[STEAM_KNOWN_COOKIE], known = steamKnown.get(kt);
        if (kt) { steamKnown.delete(kt); setCookie(res, STEAM_KNOWN_COOKIE, "", 0); }
        if (ok && !code && known && known.exp > now()) {
            startSession(res, { userId: known.user.discord_id, username: known.user.uname || "Steam player", avatar: known.user.avatar || null, guilds: [], steamOnly: true });
            return send(res, 302, "", { Location: "/#/steam" });
        }
        if (!ok || !code) return send(res, 302, "", { Location: "/?error=login" });

        let who;
        try { who = await rest.login(code, linked ? { withToken: true } : twitch ? { withConnections: true } : undefined); }
        catch (err) { log(`Discord sign-in failed (${err.status ?? err.name})`, "warn"); return send(res, 302, "", { Location: "/?error=login" }); }

        const name = who.user.global_name || who.user.username;
        const avatar = who.user.avatar ? `https://cdn.discordapp.com/avatars/${who.user.id}/${who.user.avatar}.png?size=64` : null;
        if (who.user.id !== config.ownerId && db.isBanned(who.user.id)) return send(res, 302, "", { Location: "/?error=restricted" });
        startSession(res, {
            userId: who.user.id, username: name, avatar,
            guilds: (who.guilds ?? []).map(g => ({ id: g.id, name: g.name, icon: g.icon, owner: Boolean(g.owner), permissions: String(g.permissions ?? "0") }))
        });
        const wasNew = !db.getUser(who.user.id);
        db.ensureUser(who.user.id);
        const refCode = cookies(req)[REF_COOKIE];
        if (refCode) { setCookie(res, REF_COOKIE, "", 0); referrals?.onSignup({ userId: who.user.id, code: refCode, wasNew }).catch(() => {}); }
        if (twitch) {
            const tw = (who.connections ?? []).filter(c => c.type === "twitch" && c.id && c.name).sort((a, b) => Number(Boolean(b.verified)) - Number(Boolean(a.verified)))[0];
            if (!tw) return send(res, 302, "", { Location: "/#/steam?twitch=none" });
            db.setTwitchLink(who.user.id, { twitchId: tw.id, login: String(tw.name).toLowerCase() });
            db.bumpUsage("twitch_linked");
            return send(res, 302, "", { Location: "/#/steam?twitch=1" });
        }
        // Came here from "Sign in through Steam" and had no account yet: attach the proven Steam account now.
        const pend = steamPending.get(cookies(req)[STEAM_PENDING_COOKIE]);
        steamPending.delete(cookies(req)[STEAM_PENDING_COOKIE]);
        setCookie(res, STEAM_PENDING_COOKIE, "", 0);
        if (pend && pend.exp > now()) {
            db.setSteamLink(who.user.id, pend.steamid, { verified: true });
            db.setSteamWho(who.user.id, name, avatar);
            if (!linked) return send(res, 302, "", { Location: "/#/steam?linked=1" });
        }
        if (db.getSteamLink(who.user.id)?.verified) db.setSteamWho(who.user.id, name, avatar); // keep the Steam sign-in's name and picture fresh
        if (linked) {
            if (!db.getSteamLink(who.user.id)?.verified) { // prove the Steam account first, then this flow comes straight back
                setCookie(res, NEXT_COOKIE, "linked", 600);
                return send(res, 302, "", { Location: "/auth/steam" });
            }
            try { await rest.setRoleConnection(who.accessToken, connectionPayload(db, who.user.id)); db.bumpUsage("linked_roles_connected"); }
            catch (err) { log(`Could not link Discord roles for a Steam sign-in (${err.status ?? err.name})`, "warn"); return send(res, 302, "", { Location: "/#/steam?roles=failed" }); }
            return send(res, 302, "", { Location: "/#/steam?roles=1" });
        }
        if (cookies(req)[NEXT_COOKIE] === "admin") { setCookie(res, NEXT_COOKIE, "", 0); return send(res, 302, "", { Location: adminHome }); }
        if (cookies(req)[NEXT_COOKIE] === "indie") { setCookie(res, NEXT_COOKIE, "", 0); return send(res, 302, "", { Location: "/indie/submit" }); }
        if (cookies(req)[NEXT_COOKIE] === "music") { setCookie(res, NEXT_COOKIE, "", 0); return send(res, 302, "", { Location: musicHome }); }
        send(res, 302, "", { Location: "/#/mypage" });
    }

    function startSession(res, data, ttl = SESSION_MS) {
        if (sessions.size >= MAX_SESSIONS) sweep();
        if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
        const id = randomBytes(32).toString("hex");
        if (data.userId && !data.adminOnly && Array.isArray(data.guilds) && data.guilds.length) { try { db.rememberGuilds(data.userId, data.guilds.map(g => g.id)); } catch { /* the server chip is a nicety */ } }
        sessions.set(id, { ...data, expires: now() + ttl });
        setCookie(res, COOKIE, id, ttl / 1000);
    }

    // ---- Sign in through Steam (OpenID). Steam proves the account; a Discord account is what the bot's alerts attach to. ----
    async function steamLogin(req, res) {
        sweep();
        const state = randomBytes(24).toString("hex");
        states.set("steam:" + state, now() + 10 * 60_000);
        setCookie(res, STEAM_STATE_COOKIE, state, 600);
        send(res, 302, "", { Location: steamLoginUrl(`${origin}/auth/steam/return?state=${state}`, origin) });
    }

    async function steamReturn(req, res, url) {
        const state = url.searchParams.get("state") ?? "";
        const ok = state && states.get("steam:" + state) > now() && cookies(req)[STEAM_STATE_COOKIE] === state;
        states.delete("steam:" + state);
        setCookie(res, STEAM_STATE_COOKIE, "", 0);
        if (!ok) return send(res, 302, "", { Location: "/?error=steam" });
        let steamid;
        try { steamid = await verifySteamLogin(url.searchParams, `${origin}/auth/steam/return?state=${state}`, steamFetch); }
        catch { return send(res, 302, "", { Location: "/?error=steam" }); }

        const s = sessions.get(cookies(req)[COOKIE]);
        if (s && s.expires > now()) { // already signed in with Discord: this proves the Steam account is theirs
            db.ensureUser(s.userId);
            db.setSteamLink(s.userId, steamid, { verified: true });
            db.setSteamWho(s.userId, s.username, s.avatar);
            if (cookies(req)[NEXT_COOKIE] === "linked") { setCookie(res, NEXT_COOKIE, "", 0); return send(res, 302, "", { Location: "/auth/linked" }); } // back to finish connecting Linked Roles
            return send(res, 302, "", { Location: "/#/steam?linked=1" });
        }
        const known = db.findVerifiedSteamUser(steamid);
        if (known) { // Steam proved who this is. Finish with Discord (it says yes without asking if they have signed in before) so servers, giveaways and admin work too.
            const kt = randomBytes(24).toString("hex");
            steamKnown.set(kt, { user: known, exp: now() + 10 * 60_000 });
            setCookie(res, STEAM_KNOWN_COOKIE, kt, 600);
            return send(res, 302, "", { Location: "/auth/login" });
        }
        const token = randomBytes(24).toString("hex");
        steamPending.set(token, { steamid, exp: now() + 15 * 60_000 });
        setCookie(res, STEAM_PENDING_COOKIE, token, 900);
        send(res, 302, "", { Location: "/auth/login" }); // one Discord sign-in connects it, once
    }

    function logout(req, res) {
        sessions.delete(cookies(req)[COOKIE]);
        setCookie(res, COOKIE, "", 0);
        json(res, 200, { ok: true });
    }

    // ---------- static ----------
    const zcache = new Map(); // `${file}:${encoding}:${etag}` -> the compressed page code, made once
    // Pages point at their scripts, styles and pictures as /app.js?v=<fingerprint of the file>. The address changes only when the
    // file does, so browsers can keep each one for a year, and a new deploy still reaches everyone on their next page load.
    async function versionAssets(buf) {
        const html = buf.toString("utf8"), want = new Set();
        for (const m of html.matchAll(/(?:src|href)="(\/[A-Za-z0-9_\-\/.]+\.(?:js|css|png|webp|svg))"/g)) if (FILES[m[1]]) want.add(m[1]);
        const stamp = new Map();
        for (const path of want) {
            const file = FILES[path][0];
            if (file.endsWith(".html")) continue;
            const data = await loadFile(file);
            if (data) stamp.set(path, createHash("sha1").update(data).digest("hex").slice(0, 10));
        }
        return Buffer.from(html.replace(/((?:src|href)=")(\/[A-Za-z0-9_\-\/.]+\.(?:js|css|png|webp|svg))(")/g, (all, a, path, z) => stamp.has(path) ? `${a}${path}?v=${stamp.get(path)}${z}` : all));
    }
    async function loadFile(file) {
        let body = cache.get(file);
        // The sale-dates page counts days, so it is rebuilt every hour instead of once.
        if (body && file.startsWith("seo/") && seoIsLive(file.slice(4, -5)) && Date.now() - (cache.get(file + ":at") ?? 0) > 3600_000) body = null;
        if (!body) {
            if (file.startsWith("seo/")) { cache.set(file + ":at", Date.now()); const slug = file.slice(4, -5); let deals = null; if (slug === "steam-deals-this-week") { try { deals = withPictures(await fillArt(pickDeals(await itad.getDealsPool({ country: "US", pages: 6 }), 45), { max: 45 }), 20); } catch { /* the page says the list is loading */ } } const html = renderSeoPage(slug, { origin, invite: config.clientId ? `${origin}/invite` : null, deals }); if (!html) return null; body = Buffer.from(html); cache.set(file, body); cache.set(file + ":etag", `W/"${createHash("sha1").update(body).digest("hex").slice(0, 16)}"`); return body; }
            try { body = await readFile(join(PUBLIC_DIR, file)); } catch { return null; }
            // The page's share-preview tags need the real public address, so it is filled in once here.
            if (file === "index.html" || file === "grabber.html" || file === "ai.html") body = Buffer.from(body.toString("utf8").replaceAll("__ORIGIN__", origin));
            if (file.endsWith(".html")) body = await versionAssets(body);
            cache.set(file, body);
            cache.set(file + ":etag", `W/"${createHash("sha1").update(body).digest("hex").slice(0, 16)}"`);
        }
        return body;
    }
    const escHtml = t => String(t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    // The page for a profile that anyone may see, or null. Share previews and the share picture both start here.
    function publicOwner(slug) {
        const owner = db.getProfileBySlug(slug);
        if (!owner || !owner.profile_public || db.getProfileData(owner.discord_id).blocked || (rt && !rt.get("profiles_enabled"))) return null;
        return owner;
    }
    // /u/name serves the same app with that person's name, bio and picture in the share preview, then the app opens #/u/name.
    async function serveProfileShell(res, slug) {
        const body = await loadFile("index.html");
        if (!body) return send(res, 404, "Not found", { "Content-Type": "text/plain" });
        const owner = publicOwner(slug);
        let html = body.toString("utf8");
        if (owner) {
            const cfg = withDefaults(db.getProfileData(owner.discord_id).data);
            const name = cfg.name || owner.profile_slug;
            const title = `${name} on Steam Value Checker`;
            // when they show their library's worth publicly, the preview leads with it
            const vs = (cfg.sections ?? []).find(x => x.key === "value" && x.vis === "public"), snap = vs ? db.listSnapshots(owner.discord_id, 1)[0] : null;
            const lead = snap && snap.games > 0 && snap.msrp > 0 ? `${name}'s game library is worth $${Math.round(snap.msrp).toLocaleString("en-US")} across ${Number(snap.games).toLocaleString("en-US")} games. ` : "";
            const desc = (lead + (cfg.bio || `${name}'s game profile: favorite games, wishlist and more.`)).replace(/\s+/g, " ").slice(0, 200);
            const url = `${origin}/u/${owner.profile_slug}`;
            const img = `${url}/og.png?v=${createHash("sha1").update(JSON.stringify(db.getProfileData(owner.discord_id).data) + (snap?.msrp ?? "")).digest("hex").slice(0, 8)}`;
            const set = (re, v) => { html = html.replace(re, `$1${escHtml(v).replace(/\$/g, "$$$$")}"`); };
            set(/(<meta property="og:title" content=")[^"]*"/, title);
            set(/(<meta property="og:description" content=")[^"]*"/, desc);
            set(/(<meta property="og:url" content=")[^"]*"/, url);
            set(/(<link rel="canonical" href=")[^"]*"/, url);
            set(/(<meta property="og:image" content=")[^"]*"/, img);
            set(/(<meta property="og:image:alt" content=")[^"]*"/, `${name}'s profile on Steam Value Checker`);
            set(/(<meta name="twitter:title" content=")[^"]*"/, title);
            set(/(<meta name="twitter:description" content=")[^"]*"/, desc);
            set(/(<meta name="twitter:image" content=")[^"]*"/, img);
            set(/(<meta name="twitter:image:alt" content=")[^"]*"/, `${name}'s profile on Steam Value Checker`);
            set(/(<meta name="description" content=")[^"]*"/, desc);
            const ld = { "@context": "https://schema.org", "@type": "ProfilePage", name: title, url, image: img.replace(/\?.*/, ""), description: desc, mainEntity: { "@type": "Person", name, url, image: img.replace(/\?.*/, "") } };
            html = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, () => `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`);
            html = html.replace(/<meta property="og:image:type" content="[^"]*">/, '<meta property="og:image:type" content="image/png">')
                .replace(/<meta property="og:type" content="website">/, '<meta property="og:type" content="profile">')
                .replace(/<title>[^<]*<\/title>/, () => `<title>${escHtml(title)}</title>`);
        }
        return send(res, 200, html, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    }
    // The app's public pages each get their own title, description, picture and questions (see pageseo.js), so search results and link cards
    // say what the page is for instead of repeating the home page. A single ticket (/support/12) is private and kept out of search.
    async function servePageShell(res, key, ticket, extra = null) {
        const seo = extra?.seo ?? PAGE_SEO[key], body = await loadFile("index.html");
        if (!seo || !body) return send(res, 404, "Not found", { "Content-Type": "text/plain" });
        let html = body.toString("utf8");
        const { title, desc } = seo, faq = seo.faq ?? [], url = extra?.url ?? `${origin}/${key}`, img = extra?.img ?? `${origin}/page-${key}.jpg?v=1`;
        const set = (re, v) => { html = html.replace(re, `$1${escHtml(v).replace(/\$/g, "$$$$")}"`); };
        set(/(<meta property="og:title" content=")[^"]*"/, title); set(/(<meta name="twitter:title" content=")[^"]*"/, title);
        set(/(<meta property="og:description" content=")[^"]*"/, desc); set(/(<meta name="twitter:description" content=")[^"]*"/, desc); set(/(<meta name="description" content=")[^"]*"/, desc);
        set(/(<meta property="og:url" content=")[^"]*"/, url); set(/(<link rel="canonical" href=")[^"]*"/, url);
        set(/(<meta property="og:image" content=")[^"]*"/, img); set(/(<meta name="twitter:image" content=")[^"]*"/, img);
        set(/(<meta property="og:image:alt" content=")[^"]*"/, seo.alt); set(/(<meta name="twitter:image:alt" content=")[^"]*"/, seo.alt);
        const ld = [{ "@context": "https://schema.org", "@type": key === "support" ? "ContactPage" : key === "about" ? "AboutPage" : "WebPage", name: title, url, description: desc, isPartOf: { "@type": "WebSite", name: "Steam Value Checker", url: origin }, primaryImageOfPage: img.replace(/\?.*/, "") },
            { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Steam Value Checker", item: origin + "/" }, { "@type": "ListItem", position: 2, name: title.split(/ [|:] /)[0], item: url }] },
            ...(extra?.ld ?? []),
            ...(faq.length ? [{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) }] : [])];
        html = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/, () => ld.map(x => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, "\\u003c")}</script>`).join("\n"))
            .replace(/<meta property="og:image:type" content="[^"]*">/, '<meta property="og:image:type" content="image/jpeg">')
            .replace(/<title>[^<]*<\/title>/, () => `<title>${escHtml(title)}</title>`)
            .replace(/<meta name="robots" content="[^"]*">/, ticket || seo.noindex ? '<meta name="robots" content="noindex,nofollow">' : '<meta name="robots" content="index,follow,max-image-preview:large">');
        // the same answers as plain text, for anything that doesn't run the page's scripts
        html = html.replace("</body>", () => `<noscript><main><h1>${escHtml(title.split(/ [|:] /)[0])}</h1><p>${escHtml(desc)}</p>${extra?.html ?? ""}${faq.map(([q, a]) => `<h2>${escHtml(q)}</h2><p>${escHtml(a)}</p>`).join("")}</main></noscript>\n</body>`);
        return send(res, 200, html, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    }
    // ---------- the page a bundle post on X links to ----------
    const bundlePics = new Map(); // id -> { at, buf, type }
    /** Where "add the bot" clicks came from over the last 30 days, and how many servers it joined in that time. */
    const inviteReport = () => {
        const cut = new Date(now() - 30 * 86400_000).toISOString().slice(0, 10), by = new Map(); let clicks = 0, joins = 0;
        for (const r of db.listMetaPrefix("invc:")) { const [, day, src] = r.key.split(":"); if (day < cut) continue; const n = Number(r.value) || 0; by.set(src, (by.get(src) ?? 0) + n); clicks += n; }
        for (const r of db.listMetaPrefix("invj:")) if (r.key.slice(5) >= cut) joins += Number(r.value) || 0;
        return { clicks, joins, sources: [...by].map(([source, n]) => ({ source, clicks: n })).sort((a, b) => b.clicks - a.clicks) };
    };
    const bump = key => { try { db.setMeta(key, String((Number(db.getMeta(key)) || 0) + 1)); } catch { /* a missed count isn't worth failing the page */ } };
    const dayKey = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()); // YYYY-MM-DD, Eastern
    const CRAWLER = /bot|crawl|spider|preview|discord|twitter|x\.com|facebook|slack|telegram|whatsapp|linkedin|embed|curl|python|node|go-http|headless/i;
    /** Link-preview robots fetch the page when a post goes up; they're counted as previews (reach), not as visits (people). */
    const countHit = (kind, id, req, part) => {
        const day = dayKey();
        if (part === "go") { bump(`${kind === "b" ? "bundlego" : "dealgo"}:${id}`); bump(`landday:${day}:g`); return; }
        if (CRAWLER.test(String(req.headers?.["user-agent"] ?? ""))) { bump(`landday:${day}:p`); return; }
        bump(`${kind === "b" ? "bundlevisit" : "dealvisit"}:${id}`); bump(`landday:${day}:v`);
    };
    /** What anyone may see of a showcase game: no owner id, no queue notes. */
    // ---- verified indie developers: the role in your servers, the welcome message, and the dev panel they unlock ----
    const isIndieDev = userId => Boolean(userId) && db.indieApprovedOwned(userId) > 0;
    const devSession = req => {
        const s = session(req);
        if (!isOwner(s) && !isIndieDev(s.userId)) throw new HttpError(403, "The dev panel is for verified indie developers. It unlocks when a game of yours is approved in the indie showcase.");
        return s;
    };
    /** Gives the Verified IndieDev role (or takes it back when no approved game is left) in every server that set one, and welcomes new devs once. */
    async function syncIndieDev(userId, game = null) {
        const has = isIndieDev(userId);
        for (const g of db.indieDevGuilds?.() ?? []) {
            try { await (has ? rest?.addRole?.(g.guild_id, userId, g.indie_dev_role) : rest?.removeRole?.(g.guild_id, userId, g.indie_dev_role)); } catch { /* not in that server, or the role is above mine: nothing to do */ }
        }
        if (!has || db.getMeta(`indiedev:welcomed:${userId}`)) return;
        db.setMeta(`indiedev:welcomed:${userId}`, "1");
        const page = `${origin}/devpanel`;
        try { db.addNotification(userId, { type: "indie", title: "You're a verified indie dev", body: "The dev panel is open: manage key requests, hand out keys, and post news to your followers.", url: "/devpanel" }); } catch { /* the DM below still goes */ }
        if (dm) Promise.resolve(dm(userId, { embeds: [{ color: 0xff8a4c, title: "You're a verified indie dev ✅", description: [`${game ? `**${game.title}** is live in the indie showcase, and you now` : "You now"} have the **Verified IndieDev** role in our servers and access to the **indie dev panel**.`, "In the panel you can:", "• approve or decline review key requests, one by one or in bulk", "• load a pool of keys that go out automatically when you approve", "• see views, clicks, likes and followers for each game", "• post news to everyone following you", `**Open it:** ${page}`].join("\n"), footer: { text: "Steam Value Checker · indie showcase" } }], components: [{ type: 1, components: [{ type: 2, style: 5, label: "Open the dev panel", url: page }] }] })).catch(() => {});
    }
    /** One key request answered: approve (and send a key from the pool if there is one) or decline. Returns what happened. */
    async function decideKeyRequest(g, k, approve, note) {
        const sentAlready = db.indieKeyInbox(g.owner_id, { game: g.id, limit: 500 }).find(x => x.id === k.id)?.key_sent;
        if (sentAlready) return { id: k.id, skipped: "a key was already sent" };
        db.indieKeyDecide(k.id, approve ? "approved" : "declined", note);
        const tell = (title, text) => { try { db.addNotification(k.user_id, { type: "indie", title, body: text, url: `/indie/game/${g.id}` }); } catch { /* best effort */ } };
        if (!approve) { tell(`${g.title}: no key this time`, note || "The developer passed on this one. Thanks for asking."); return { id: k.id, status: "declined" }; }
        const key = db.indieKeyTake(g.id, k.user_id, k.id);
        if (!key) { tell(`${g.title}: your key request was approved`, note || "The developer will send your key using the contact you gave."); return { id: k.id, status: "approved", sent: false }; }
        let dmOk = false;
        if (dm) { try { await dm(k.user_id, { embeds: [{ color: 0x57f287, title: `Your key for ${g.title}`, description: `**${key}**\n\n${note ? note + "\n\n" : ""}Redeem it on the platform the developer listed. Thanks for covering the game!`, footer: { text: `From ${g.studio || "the developer"} via Steam Value Checker` } }] }); dmOk = true; } catch { /* closed DMs: the key goes in the inbox instead */ } }
        tell(`${g.title}: your key is here`, dmOk ? "We sent it to you in a Discord message." : `Your key: ${key}${note ? ". " + note : ""}`);
        return { id: k.id, status: "approved", sent: true, dm: dmOk };
    }
    const indiePublic = g => ({ id: g.id, appid: g.appid, title: g.title, studio: g.studio, blurb: g.blurb, pitch: g.pitch, genres: g.genres, image: g.image, price: g.price, release: g.release, links: g.links, featured: g.featured, verified: Boolean(g.verified), likes: g.likes, steamUrl: `https://store.steampowered.com/app/${g.appid}/` });
    const bundleFor = id => { const b = db.getFeedBundle(id); return b && !b.adult ? b : null; };
    /** One handler for both kinds of page. `kind` is "b" (a bundle from the feed) or "d" (a free game or other deal). */
    async function serveLanding(res, kind, id, part, req) {
        const gone = status => send(res, status, renderBundleGone({ origin }), { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "X-Robots-Tag": "noindex" });
        const row = kind === "b" ? bundleFor(id) : db.getDeal(id);
        if (!row) return gone(404);
        const dest = kind === "b" ? bundleDestination(row.url) : dealDestination(row.url);
        const ended = kind === "b" ? Boolean(row.expires_at && row.expires_at <= Date.now()) || row.status === "expired" : Boolean(row.expiry && row.expiry <= Date.now());
        if (part === "go") {
            const pick = kind === "d" ? Number(new URL(req.url, "http://x").searchParams.get("i")) : NaN;
            const own = Number.isInteger(pick) && pick >= 0 ? dealDestination(splitGame(row.games?.[pick] ?? "").link) : null;
            const target = own ?? dest;
            if (!target) return gone(404);
            countHit(kind, id, req, "go");
            return send(res, 302, "", { Location: target, "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
        }
        const src = safePictureUrl(row.image), picKey = kind + id;
        if (part === "img") {
            if (!src) return send(res, 404, "Not found", { "Content-Type": "text/plain" });
            let hit = bundlePics.get(picKey);
            if (!hit || Date.now() - hit.at > 6 * 3_600_000) {
                try {
                    const r = await imageFetch(src, { headers: { Accept: "image/*" }, signal: AbortSignal.timeout(10_000) });
                    const type = String(r.headers?.get?.("content-type") ?? "").split(";")[0].trim().toLowerCase();
                    const buf = r.ok && /^image\/(png|jpe?g|webp|gif)$/.test(type) ? Buffer.from(await r.arrayBuffer()) : null;
                    if (!buf || !buf.length || buf.length > 4_000_000) return send(res, 404, "Not found", { "Content-Type": "text/plain" });
                    hit = { at: Date.now(), buf, type };
                } catch { return send(res, 404, "Not found", { "Content-Type": "text/plain" }); }
                bundlePics.set(picKey, hit);
                if (bundlePics.size > 80) bundlePics.delete(bundlePics.keys().next().value);
            }
            return send(res, 200, hit.buf, { "Content-Type": hit.type, "Cache-Control": "public, max-age=3600" });
        }
        countHit(kind, id, req, "page");
        const opts = { origin, hasPicture: Boolean(src), inviteUrl: config.clientId ? `${origin}/invite?src=${kind === "b" ? "bundle-page" : "deal-page"}` : null, supportUrl: config.mainGuild?.inviteUrl?.() ?? null };
        void ended; // the page works the ended state out itself
        return send(res, 200, kind === "b" ? renderBundleLanding(row, opts) : renderDealLanding(row, opts), { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "X-Robots-Tag": "noindex" });
    }
    const shareCache = new Map(); // slug -> { at, png }
    async function serveProfileShare(res, slug) {
        const owner = publicOwner(slug);
        if (!owner) return send(res, 404, "Not found", { "Content-Type": "text/plain" });
        let hit = shareCache.get(slug);
        if (!hit || Date.now() - hit.at > 600_000) {
            const profile = await buildProfile({ db, itad, nowPlaying }, owner, { owner: false, sameServer: false });
            hit = { at: Date.now(), png: await renderProfileShare({ profile }) };
            shareCache.set(slug, hit);
            if (shareCache.size > 200) shareCache.delete(shareCache.keys().next().value);
        }
        return send(res, 200, hit.png, { "Content-Type": "image/png", "Cache-Control": "public, max-age=600" });
    }
    async function serveFile(res, path, extra = {}) {
        const [file, type] = FILES[path];
        const body = await loadFile(file);
        if (!body) return send(res, 404, "Not found", { "Content-Type": "text/plain" });
        const etag = cache.get(file + ":etag");
        const text = /\.(js|css|html)$/.test(file);
        const pinned = !/\.html$/.test(file) && res.req?.url?.split("?")[1] === `v=${createHash("sha1").update(body).digest("hex").slice(0, 10)}`; // only when the fingerprint is this file's own // asked for by its fingerprint: this address never changes meaning
        const headers = { "Content-Type": type, "Cache-Control": pinned ? "public, max-age=31536000, immutable" : text ? "no-cache" : "public, max-age=3600", ETag: etag, ...extra };
        if (res.req?.headers?.["if-none-match"] === etag) return send(res, 304, "", { ETag: etag, "Cache-Control": headers["Cache-Control"] });
        const enc = COMPRESSIBLE.test(type) ? encodingOf(res.req) : null;
        if (enc) {
            let z = zcache.get(`${file}:${enc}:${etag}`);
            if (!z) zcache.set(`${file}:${enc}:${etag}`, z = squeeze(body, enc, 9));
            return send(res, 200, z, { ...headers, "Content-Encoding": enc, Vary: "Accept-Encoding" });
        }
        send(res, 200, body, headers);
    }

    // ---------- server ----------
    function toHttp(err) {
        if (err instanceof HttpError) return err;
        if (err instanceof ValueError || err instanceof WishlistError || err instanceof UserError) return new HttpError(400, err.message);
        if (err instanceof SteamError) return new HttpError(err.code === "rate_limited" || err.code === "network" ? 503 : 400, err.message);
        if (err instanceof ItadError) return new HttpError(503, err.message);
        log(`Dashboard request failed with an unexpected error: ${err.name}: ${err.message}`, "error"); // never log request bodies
        return new HttpError(500, "Something went wrong. Try again in a moment.");
    }

    // Visit counter for the FanaticalGrabber web page (GitHub Pages). Public, tiny, totals only, and only that site may call it.
    const VISIT_SITES = { fanaticalgrabber: ["https://jacob-lucado.github.io", origin], dashboard: [origin] }; // the first is where the counter answers by default; the grabber page lives on the old GitHub address and on this site
    const seenVisitors = new Map(); // ip -> time, in memory only, so one address counts as a new visitor once a day
    const visitLimit = createLimiter({ windowMs: 3600_000, max: 40, now });
    const presentBySite = new Map(); // site -> (random per-tab id -> last seen). In memory only; nothing about a person is kept.
    const presentFor = site => { let m = presentBySite.get(site); if (!m) presentBySite.set(site, m = new Map()); return m; };
    const pingLimit = createLimiter({ windowMs: 60_000, max: 12, now });
    const ONLINE_MS = 75_000;
    const online = site => { const present = presentFor(site), t = now(); for (const [k, at] of present) if (t - at > ONLINE_MS) present.delete(k); return present.size; };
    const markPresent = (site, id) => { const present = presentFor(site); if (/^[a-z0-9]{8,32}$/i.test(id ?? "") && (present.size < 5000 || present.has(id))) present.set(id, now()); };
    // Read-only numbers and the changelog for the LucadoServices shop site on GitHub Pages. Counts only, nothing about any person.
    const SHOP_ORIGINS = ["https://jacob-lucado.github.io"];
    function siteFeed(req, res) {
        const allowed = SHOP_ORIGINS.includes(req.headers.origin) ? req.headers.origin : SHOP_ORIGINS[0];
        const cors = { "Access-Control-Allow-Origin": allowed, "Vary": "Origin", "Cross-Origin-Resource-Policy": "cross-origin" };
        if (req.method === "OPTIONS") return send(res, 204, "", { ...cors, "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" });
        if (req.method !== "GET") throw new HttpError(405, "Not allowed.");
        const info = botInfo ? botInfo() : null;
        return json(res, 200, {
            stats: info ? { servers: info.servers ?? null, gamesWatched: info.gamesWatched ?? null, alerts24h: info.alerts24h ?? null } : null,
            changelog: CHANGELOG.slice(0, 12).map(e => ({ version: e.version, date: e.date, title: e.title, items: e.items }))
        }, { ...cors, "Cache-Control": "public, max-age=300" });
    }
    function visits(req, res, url) {
        const [site, action] = url.pathname.slice("/api/visits/".length).split("/");
        const sites = VISIT_SITES[site];
        if (!sites || (action && action !== "ping")) throw new HttpError(404, "Not found.");
        const allowed = sites.includes(req.headers.origin) ? req.headers.origin : sites[0];
        const cors = { "Access-Control-Allow-Origin": allowed, "Vary": "Origin", "Cross-Origin-Resource-Policy": "cross-origin" };
        const counts = () => ({ ...db.siteCounts(site), online: online(site) });
        if (req.method === "OPTIONS") return send(res, 204, "", { ...cors, "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Max-Age": "86400" });
        if (req.method === "GET") return json(res, 200, counts(), { ...cors, "Cache-Control": "public, max-age=10" });
        if (req.method !== "POST") throw new HttpError(405, "Not allowed.");
        const ip = clientIp(req);
        if (req.headers.origin !== allowed) return json(res, 200, counts(), cors); // ignore other origins quietly
        const id = url.searchParams.get("id");
        if (action === "ping") {
            if (pingLimit.hit(ip).ok) markPresent(site, id);
            return json(res, 200, counts(), cors);
        }
        if (!visitLimit.hit(ip).ok) return json(res, 200, counts(), cors);
        markPresent(site, id);
        const t = now();
        for (const [k, at] of seenVisitors) if (t - at > 86400_000) seenVisitors.delete(k);
        const fresh = url.searchParams.get("new") === "1" && !seenVisitors.has(ip);
        if (fresh) seenVisitors.set(ip, t);
        return json(res, 200, { ...db.siteHit(site, fresh), online: online(site) }, cors);
    }

    const server = http.createServer(async (req, res) => {
        try {
            // Link checkers (Discord's developer portal among them) ask with HEAD first. Answer it like a GET; Node drops the body.
            if (req.method === "HEAD") req.method = "GET";
            const url = new URL(req.url, origin);
            const key = `${req.method} ${url.pathname}`;
            if (url.pathname.startsWith("/api/visits/")) return visits(req, res, url);
            if (url.pathname === "/api/public/site") return siteFeed(req, res);
            // For Fly and uptime monitors. Plain /healthz says the process and database are fine. Adding ?strict=1 also needs the Discord connection up.
            if (req.method === "GET" && url.pathname === "/healthz") {
                let dbOk = true;
                try { db.getMeta("health:probe"); } catch { dbOk = false; }
                const discord = health ? Boolean(health()) : null;
                const ok = dbOk && (url.searchParams.get("strict") !== "1" || discord !== false);
                return send(res, ok ? 200 : 503, JSON.stringify({ ok, database: dbOk, discord }), { "Content-Type": "application/json", "Cache-Control": "no-store" });
            }

            if (req.method === "GET" && /^\/(terms|privacy|licenses)(\.html)?$/.test(url.pathname)) {
                const kind = url.pathname.slice(1).replace(/\.html$/, "");
                const page = url.pathname.endsWith(".html") ? legalFramePage(kind, origin) : legalPage(kind, origin); // .html shows the PDF, the plain path the same text as a web page
                if (page) return send(res, 200, page, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" });
            }
            if (req.method === "GET" && (url.pathname === "/admin" || (url.pathname === "/" && onAdminHost(req)))) return await serveFile(res, "/admin", { "Cache-Control": "no-store" });
            if (req.method === "GET" && url.pathname === "/overlay") return await serveFile(res, "/overlay", { "Cache-Control": "no-store" });
            if (req.method === "GET" && (url.pathname === "/music" || (url.pathname === "/" && onMusicHost(req)))) return await serveFile(res, "/music", { "Cache-Control": "no-store" });
            const artMatch = req.method === "GET" ? /^\/art\/(header|hero|portrait|bundle)\/(\d{1,10})\.jpg$/.exec(url.pathname) : null;
            if (artMatch) {
                if (!artLimit.hit(clientIp(req)).ok) return send(res, 429, "Slow down a little.", { "Content-Type": "text/plain" });
                const [, kind, id] = artMatch;
                const got = kind === "bundle" ? await resolveUrlArt(`bundle-${id}`, db.getFeedBundle?.(Number(id))?.image, { fetchImpl: artFetch }) : ART_KINDS.includes(kind) ? await resolveArt(id, kind, { fetchImpl: artFetch }) : null;
                if (!got) return send(res, 404, "No picture.", { "Content-Type": "text/plain", "Cache-Control": "public, max-age=600" });
                return send(res, 200, got.buf, { "Content-Type": got.type, "Cache-Control": "public, max-age=604800" });
            }
            const bgMatch = req.method === "GET" ? /^\/pbg\/(\d{1,12})$/.exec(url.pathname) : null;
            if (bgMatch) {
                if (!artLimit.hit(clientIp(req)).ok) return send(res, 429, "Slow down a little.", { "Content-Type": "text/plain" });
                const row = db.getProfileBg(Number(bgMatch[1])), owner = row ? db.getUser(row.discord_id) : null;
                const mine = Boolean(owner && softSession(req)?.userId === owner.discord_id);
                // Only pages that are public (and not hidden by moderation) show their picture to strangers.
                if (!row || !owner || !(mine || (owner.profile_public && !db.getProfileData(owner.discord_id).blocked))) return send(res, 404, "No picture.", { "Content-Type": "text/plain" });
                return send(res, 200, row.data, { "Content-Type": row.mime, "X-Content-Type-Options": "nosniff", "Cache-Control": mine ? "private, max-age=3600" : "public, max-age=86400" });
            }
            const fimg = req.method === "GET" ? /^\/fimg\/(\d{1,12})$/.exec(url.pathname) : null;
            if (fimg) {
                if (!artLimit.hit(clientIp(req)).ok) return send(res, 429, "Slow down a little.", { "Content-Type": "text/plain" });
                const row = db.getPostImage(Number(fimg[1])), sess = softSession(req);
                const seeable = row && !db.isSocialBanned(row.author) && (row.hidden === 0 || (sess && (sess.userId === row.author || isOwner(sess))));
                if (!seeable) return send(res, 404, "No picture.", { "Content-Type": "text/plain" });
                return send(res, 200, row.data, { "Content-Type": row.mime, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": row.hidden ? "private, no-store" : "public, max-age=86400" });
            }
            if (req.method === "GET" && /^\/u\/[a-z0-9_-]{3,24}\/og\.png$/i.test(url.pathname)) {
                if (!shareLimit.hit(clientIp(req)).ok) return send(res, 429, "Slow down a little.", { "Content-Type": "text/plain" });
                return await serveProfileShare(res, url.pathname.split("/")[2].toLowerCase());
            }
            if (req.method === "GET" && /^\/u\/[a-z0-9_-]{3,24}\/badge\.svg$/i.test(url.pathname)) {
                if (!shareLimit.hit(clientIp(req)).ok) return send(res, 429, "Slow down a little.", { "Content-Type": "text/plain" });
                const slug = url.pathname.split("/")[2].toLowerCase(), owner = publicOwner(slug);
                // Only when the member has turned the Library value section on for everyone; otherwise it looks like any missing page.
                const v = owner && (await buildProfile({ db, itad, nowPlaying }, owner, { owner: false, sameServer: false })).sections?.find(s => s.key === "value");
                if (!v) return send(res, 404, "Not found", { "Content-Type": "text/plain" });
                const name = withDefaults(db.getProfileData(owner.discord_id).data).name || owner.profile_slug;
                return send(res, 200, valueBadgeSvg({ name, ...v }), { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" });
            }
            // Public price page for one game, by Steam app id. Rendered on the server so search engines and link previews can read it.
            if (req.method === "GET" && url.pathname === "/winter-sale") {
                const ev = SALES.find(x => /winter/i.test(x.name) && x.end > Date.now()) ?? SALES.find(x => x.kind === "sale" && x.end > Date.now());
                const origin = new URL(config.publicUrl).origin;
                const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
                const days = ev ? Math.ceil((ev.start - Date.now()) / 86400_000) : 0;
                const when = ev ? new Date(ev.start).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
                const head = !ev ? "Check Steam for the next big sale" : days > 0 ? `${esc(ev.name)} starts in ${days} day${days === 1 ? "" : "s"}` : `${esc(ev.name)} is on now`;
                const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Steam Winter Sale prep | Steam Value Checker</title><meta name="description" content="Get ready for the Steam Winter Sale: build a wishlist budget, see which games are at their lowest price, and get alerts when they drop."><link rel="canonical" href="${origin}/winter-sale"><meta property="og:title" content="${head}"><meta property="og:description" content="Plan your Steam sale budget and get alerted at the lowest price."><style>body{margin:0;background:#0f1722;color:#e6edf5;font:16px/1.55 system-ui,sans-serif}main{max-width:640px;margin:0 auto;padding:48px 20px}h1{font-size:2rem;margin:0 0 8px}.big{font-size:3.4rem;font-weight:800;color:#66c0f4;margin:24px 0 4px}p{color:#aab8c8}li{margin:8px 0;color:#c7d2de}a.b{display:inline-block;margin:20px 12px 0 0;padding:12px 20px;border-radius:8px;background:#66c0f4;color:#0f1722;font-weight:700;text-decoration:none}a.g{background:#243246;color:#e6edf5}</style></head><body><main><h1>${head}</h1>${ev && days > 0 ? `<div class="big">${days}</div><p>days until ${esc(when)}</p>` : ""}<p>Do this before it starts and you will not impulse-buy at a fake discount.</p><ol><li>Wishlist everything you actually want.</li><li>Set a budget, and let the bot pick the best use of it.</li><li>Get a ping only when a game hits its real lowest price, not just a big percentage.</li></ol><a class="b" href="${origin}/invite?src=winter-sale">Add the bot</a><a class="b g" href="${origin}/">Open the dashboard</a></main></body></html>`;
                return send(res, 200, html, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=1800", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
            }
            if (req.method === "GET" && /^\/game\/\d{1,9}(-[a-z0-9-]{0,80})?$/.test(url.pathname)) {
                if (!shareLimit.hit(clientIp(req)).ok) return send(res, 429, "Slow down a little.", { "Content-Type": "text/plain" });
                const appid = url.pathname.split("/")[2].split("-")[0];
                const page = await publicGamePage(appid);
                if (!page) return send(res, 404, "That game was not found.", { "Content-Type": "text/plain; charset=utf-8" });
                if (url.pathname !== page.path) return send(res, 301, "", { Location: page.path });
                return send(res, 200, page.html, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=1800", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https: data: 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
            }
            if (req.method === "GET" && /^\/indie\/game\/\d{1,9}\/badge\.svg$/.test(url.pathname)) {
                if (!shareLimit.hit(clientIp(req)).ok) return send(res, 429, "Slow down a little.", { "Content-Type": "text/plain" });
                const g = db.indieGet(url.pathname.split("/")[3]);
                if (!g || g.status !== "approved") return send(res, 404, "Not found", { "Content-Type": "text/plain" });
                return send(res, 200, indieBadgeSvg({ title: g.title, verified: Boolean(g.verified), likes: g.likes, dark: url.searchParams.get("theme") !== "light" }), { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" });
            }
            if (req.method === "GET" && /^\/[bd]\/\d{1,9}(\/(img|go))?$/.test(url.pathname)) { const [, kind, id, , part] = /^\/([bd])\/(\d+)(\/(img|go))?$/.exec(url.pathname); return await serveLanding(res, kind, Number(id), part, req); }
            if (req.method === "GET" && /^\/u\/[a-z0-9_-]{3,24}$/i.test(url.pathname)) return await serveProfileShell(res, url.pathname.slice(3).toLowerCase());
            if (req.method === "GET" && referrals && /^\/r\/[a-z0-9]{8}$/.test(url.pathname)) { // an invite link: remember who sent them, then show the site
                if (referrals.ownerOf(url.pathname.slice(3))) setCookie(res, REF_COOKIE, url.pathname.slice(3), 30 * 86400);
                return send(res, 302, "", { Location: "/" });
            }
            { if (req.method === "GET" && url.pathname === "/fortnite" && !onAdminHost(req) && !onMusicHost(req)) {
                // Its own title and answers, and today's shop written out as plain text with the creator code up front, for search and link cards.
                const code = fnSvc.creatorCode || "", buy = code ? `https://www.fortnite.com/item-shop?creator-code=${encodeURIComponent(code)}` : "https://www.fortnite.com/item-shop";
                let items = [];
                try { items = (await fnSvc.shop()).sections.flatMap(sec => sec.entries).filter(e => e.price > 0).slice(0, 10); } catch { /* the page still stands without the list */ }
                const seo = { ...PAGE_SEO.fortnite, desc: code ? PAGE_SEO.fortnite.desc.replace("LUCADO", code) : PAGE_SEO.fortnite.desc.replace(" Support the creator with code LUCADO when you buy.", "") };
                const html = `<p>Buying in the Fortnite item shop? Enter creator code <strong>${escHtml(code || "LUCADO")}</strong> first, or use these links: it costs you nothing extra.</p>`
                    + (items.length ? `<h2>In the Fortnite item shop now</h2><ul>${items.map(e => `<li>${escHtml(e.name)}: ${Number(e.price).toLocaleString("en-US")} V-Bucks (<a href="${escHtml(buy)}">buy with code ${escHtml(code || "LUCADO")}</a>)</li>`).join("")}</ul>` : "");
                const ld = items.length ? [{ "@context": "https://schema.org", "@type": "ItemList", name: "Fortnite item shop today", itemListElement: items.map((e, i) => ({ "@type": "ListItem", position: i + 1, item: { "@type": "Product", name: e.name, ...(e.art ? { image: e.art } : {}), offers: { "@type": "Offer", price: String(e.price), priceCurrency: "VBUCKS", url: buy } } })) }] : [];
                return await servePageShell(res, "fortnite", false, { seo, html, ld });
            } }
            { const m = req.method === "GET" && /^\/(support|help|about|status|tip|feed|discover|communities)(\/\d{1,9})?$/.exec(url.pathname); if (m && (!m[2] || m[1] === "support") && !onAdminHost(req) && !onMusicHost(req)) return await servePageShell(res, m[1], Boolean(m[2])); }
            { const m = req.method === "GET" && /^\/indie(\/[a-z0-9\/-]*)?$/.exec(url.pathname); if (m && !onAdminHost(req) && !onMusicHost(req)) {
                const path = url.pathname.replace(/\/+$/, ""), gm = /^\/indie\/game\/(\d{1,9})$/.exec(path), game = gm ? db.indieGet(gm[1]) : null;
                const seo = indieSeo(path, game && game.status === "approved" ? game : null);
                if (seo) return await servePageShell(res, "indie", false, { seo, url: `${origin}${path}`, img: seo.image ?? `${origin}/page-${seo.slug}.jpg?v=1` });
                return await servePageShell(res, "indie", true, { seo: indieSeo("/indie/mine"), url: `${origin}${path}`, img: `${origin}/page-indie.jpg?v=1` }); // unknown or not public yet: the app shows the right message and search skips it
            } }
            if (req.method === "GET" && FILES[url.pathname]) return await serveFile(res, url.pathname);
            if (req.method === "GET" && url.pathname === `/${indexNowKey(origin)}.txt`) return send(res, 200, indexNowKey(origin), { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" });
            if (req.method === "GET" && url.pathname === "/invite") {
                // One address for "add the bot", so each page that offers it can say where the click came from. Link-preview robots aren't counted.
                if (!config.clientId) throw new HttpError(404, "Not found.");
                const src = String(url.searchParams.get("src") ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32) || "direct";
                if (!CRAWLER.test(String(req.headers?.["user-agent"] ?? ""))) bump(`invc:${dayKey()}:${src}`);
                return send(res, 302, "", { Location: botInviteUrl(config.clientId), "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
            }
            if (req.method === "GET" && url.pathname === "/robots.txt") {
                return send(res, 200, `# Public pages are open. The sign-in and data endpoints are not for crawlers.\nUser-agent: *\nAllow: /\nAllow: /grabber\nAllow: /ai\nAllow: /support\nAllow: /help\nAllow: /about\nAllow: /status\nAllow: /tip\nAllow: /feed\nAllow: /discover\nAllow: /communities\nAllow: /licenses.html\nAllow: /indie\nAllow: /winter-sale\nDisallow: /indie/submit\nDisallow: /indie/mine\n${seoSlugs().map(x => `Allow: /${x}\n`).join("")}Allow: /terms.html\nAllow: /privacy.html\nAllow: /.well-known/security.txt\nDisallow: /api/\nDisallow: /auth/\nDisallow: /admin\nDisallow: /music\nDisallow: /overlay\nDisallow: /invite\n\nSitemap: ${origin}/sitemap.xml\n`, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" });
            }
            if (req.method === "GET" && url.pathname === "/.well-known/security.txt") {
                const expires = new Date(now() + 365 * 86400_000).toISOString();
                return send(res, 200, `Contact: https://x.com/twit_user69\nExpires: ${expires}\nPreferred-Languages: en\nCanonical: ${origin}/.well-known/security.txt\nPolicy: ${origin}/privacy.html\n`, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" });
            }
            if (req.method === "GET" && url.pathname === "/sitemap.xml") {
                // Public pages only. The date is when the file behind each page last changed, so crawlers know what to revisit.
                const PAGES = [["/", "index.html", "weekly", "1.0"], ["/grabber", "grabber.html", "monthly", "0.8"], ["/ai", "ai.html", "monthly", "0.8"], ...Object.keys(PAGE_SEO).map(k => [`/${k}`, `page-${k}.jpg`, "monthly", k === "support" || k === "help" ? "0.6" : k === "fortnite" ? "0.7" : "0.5"]), ["/indie", "page-indie.jpg", "daily", "0.7"], ["/winter-sale", "index.html", "weekly", "0.7"], ["/indie/tools", "page-indie-tools.jpg", "monthly", "0.7"], ...INDIE_TOOLS.map(t => [`/indie/tools/${t.id}`, "page-indie-tools.jpg", "monthly", "0.6"]), ...db.indieList({ limit: 60, sort: "new" }).games.map(g => [`/indie/game/${g.id}`, "page-indie.jpg", "weekly", "0.5"]), ...seoSlugs().map(slug => [`/${slug}`, `seo/${slug}.html`, slug === "steam-deals-this-week" ? "daily" : "monthly", "0.7"]), ["/terms.html", "terms.pdf", "yearly", "0.3"], ["/privacy.html", "privacy.pdf", "yearly", "0.3"], ["/licenses.html", "licenses.pdf", "yearly", "0.2"]];
                const day = f => { try { return statSync(f.startsWith("seo/") ? SEO_SRC : join(PUBLIC_DIR, f)).mtime.toISOString().slice(0, 10); } catch { return null; } };
                const rows = PAGES.map(([p, f, freq, prio]) => `<url><loc>${origin}${p}</loc>${day(f) ? `<lastmod>${day(f)}</lastmod>` : ""}<changefreq>${freq}</changefreq><priority>${prio}</priority></url>`).join("\n");
                let games = ""; try { games = db.popularApps(400).map(g => `<url><loc>${origin}/game/${g.appid}-${slugify(g.title)}</loc><changefreq>daily</changefreq><priority>0.6</priority></url>`).join("\n"); } catch { /* the static pages are enough */ }
                return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows}\n${games}\n</urlset>\n`, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" });
            }
            if (url.pathname.startsWith("/auth/")) {
                const r = authLimit.hit(clientIp(req));
                if (!r.ok) throw new HttpError(429, `Too many requests. Try again in ${r.retryAfterS}s.`);
            } else if (url.pathname.startsWith("/api/")) {
                const sid = cookies(req)[COOKIE];
                const r = sessions.get(sid)?.userId === config.ownerId && config.ownerId ? { ok: true } : apiLimit.hit(sessions.has(sid) ? `s:${sid}` : `ip:${clientIp(req)}`);
                if (!r.ok) throw new HttpError(429, `Too many requests. Try again in ${r.retryAfterS}s.`);
            }
            if (key === "GET /auth/login" && onMusicHost(req)) return send(res, 302, "", { Location: `${origin}/auth/login?next=music` });
            if (key === "GET /auth/login" && onAdminHost(req)) return send(res, 302, "", { Location: `${origin}/auth/login?next=admin` }); // sign-in happens on the main address
            if (key === "GET /auth/login") return await login(req, res);
            if (key === "GET /auth/callback") return await callback(req, res, url);
            if (key === "GET /auth/twitch") return await twitchStart(req, res);
            if (key === "GET /auth/linked") return await linkedStart(req, res);
            if (key === "GET /auth/steam") return await steamLogin(req, res);
            if (key === "GET /auth/steam/return") return await steamReturn(req, res, url);
            if (key === "POST /auth/logout") { checkWrite(req); return logout(req, res); }

            // The same pictures /me steam value and the recap post in Discord. Saved straight from the website with a download name.
            if (key === "GET /api/steam/value.png" || key === "GET /api/steam/recap.png") {
                const s = session(req); userRow(s);
                const undo = cooldown(s.userId, "cardimg");
                try {
                    const png = key === "GET /api/steam/recap.png" ? await renderRecap({ db, userId: s.userId, name: s.username, fetchImpl: steamFetch, now: now() })
                        : await renderSteamValue({ db, itad, userId: s.userId, fetchImpl: steamFetch });
                    if (!png) throw new HttpError(404, "Link your Steam profile and sync first, so there is something to draw.");
                    return send(res, 200, Buffer.from(png), { "Content-Type": "image/png", "Cache-Control": "no-store", "Content-Disposition": `inline; filename="${key.includes("card") ? "my-game-profile" : key.includes("recap") ? "my-year-in-games" : "steam-account-value"}.png"` });
                } catch (err) { undo(); throw err; }
            }

            if (key === "GET /api/mydata/download") {
                const s = session(req);
                const data = exportJson(db, s.userId);
                if (!data) throw new HttpError(404, "Nothing is stored about you.");
                pushEvent(db, "adminlog:datareq", { kind: "export", via: "Dashboard", at: now() }, 100);
                return send(res, 200, data, {
                    "Content-Type": "application/json; charset=utf-8",
                    "Content-Disposition": 'attachment; filename="my-steam-value-checker-data.json"',
                    "Cache-Control": "no-store"
                });
            }

            if (key === "GET /api/admin/backup") {
                const s = session(req);
                if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can download backups.");
                let names = [];
                try { names = readdirSync(config.backupDir ?? "").filter(n => /^steamvaluechecker-\d{4}-\d{2}-\d{2}\.db$/.test(n)).sort(); } catch { /* none yet */ }
                if (!names.length) throw new HttpError(404, "There is no backup yet.");
                const name = names[names.length - 1];
                return send(res, 200, readFileSync(joinPath(config.backupDir, name)), {
                    "Content-Type": "application/vnd.sqlite3", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store"
                });
            }

            if (key === "POST /api/admin/chat/upload") {
                const s = chatSession(req); const me = chatMe(s);
                if (req.headers["x-requested-with"] !== "dashboard" || (req.headers.origin && req.headers.origin !== origin && req.headers.origin !== adminOrigin)) throw new HttpError(403, "Request blocked.");
                if (!mediaLimit.hit(me.key).ok) throw new HttpError(429, "Slow down a little.");
                const chunks = []; let size = 0;
                for await (const c of req) { size += c.length; if (size > MEDIA_MAX.video) throw new HttpError(413, "That file is too big. Pictures can be 10 MB and clips 30 MB."); chunks.push(c); }
                const buf = Buffer.concat(chunks), kind = sniffMedia(buf);
                if (!kind) throw new HttpError(400, "That isn't a picture or clip I can show. Use PNG, JPG, GIF, WebP, MP4, MOV or WebM.");
                if (buf.length > MEDIA_MAX[kind.kind]) throw new HttpError(413, "That picture is over 10 MB.");
                dropFiles(db.strayStaffMedia(now() - 3_600_000));
                mkdirSync(mediaDir, { recursive: true });
                const id = randomBytes(12).toString("hex");
                writeFileSync(mediaPath({ id, ext: kind.ext }), buf);
                db.addStaffMedia(id, me.key, kind.kind, kind.mime, kind.ext, buf.length);
                return json(res, 200, { id, kind: kind.kind });
            }
            if (key === "GET /api/admin/chat/media") {
                const s = chatSession(req); const me = chatMe(s);
                const m = db.getStaffMedia(url.searchParams.get("id") ?? "");
                if (!m) throw new HttpError(404, "That file isn't there anymore.");
                if (m.msg) { const msg = db.getStaffMsg(m.msg); if (!msg) throw new HttpError(404, "That file isn't there anymore."); chatChannel(me, msg.channel); }
                else if (m.owner !== me.key) throw new HttpError(404, "That file isn't there anymore.");
                let total; try { total = statSync(mediaPath(m)).size; } catch { throw new HttpError(404, "That file isn't there anymore."); }
                const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
                let start = 0, end = total - 1, code = 200;
                if (range && (range[1] || range[2])) { if (range[1]) { start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), total - 1) : total - 1; } else { start = Math.max(0, total - Number(range[2])); } code = 206; }
                if (start > end || start >= total) { res.writeHead(416, { "Content-Range": `bytes */${total}` }); return res.end(); }
                res.writeHead(code, { "Content-Type": m.mime, "Content-Length": end - start + 1, "Accept-Ranges": "bytes", ...(code === 206 ? { "Content-Range": `bytes ${start}-${end}/${total}` } : {}),
                    "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=86400", "Content-Disposition": "inline", "Content-Security-Policy": "sandbox; default-src 'none'" });
                return createReadStream(mediaPath(m), { start, end }).pipe(res);
            }

            const icsMatch = req.method === "GET" ? /^\/calendar\/feed\/(svcc_[A-Za-z0-9_-]{43})\.ics$/.exec(url.pathname) : null;
            if (icsMatch) {
                // A private calendar link: the secret in the address is the only credential, so it is never cached or indexed.
                const f = db.calFeedForToken(icsMatch[1]);
                if (!f) throw new HttpError(404, "Not found.");
                db.noteCalFeedUse(f.discord_id);
                const t = now();
                const body = toIcs(calendarEntries(db, f.discord_id, { from: t - 7 * 86400_000, to: t + 400 * 86400_000, guildIds: f.guild_ids }), { now: t });
                return send(res, 200, body, { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" });
            }

            if (key === "POST /api/grabber/import") {
                // Called by the FanaticalGrabber extension with a link code instead of a dashboard session. Adds titles only.
                const m = /^Bearer (\S+)$/.exec(String(req.headers.authorization ?? ""));
                const uid = m ? db.grabberUserForToken(m[1]) : null;
                if (!uid) throw new HttpError(401, "That link code is not valid. Make a new one with /me library grabber.");
                if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(400, "Bad request.");
                cooldown(uid, "grabber");
                const body = await readJson(req, 60_000);
                const entries = (Array.isArray(body.entries) ? body.entries : []).slice(0, 500).map(e => ({ title: String(e?.title ?? ""), paid: e?.paid === null || e?.paid === "" || !Number.isFinite(Number(e?.paid)) ? null : Number(e.paid) }));
                const clean = sanitize(entries, { max: 500 }).entries;
                if (!clean.length) throw new HttpError(400, "I need game titles, not keys.");
                db.ensureUser(uid);
                if (body.mode === "gifted") {
                    // Games given to you: recorded at retail, marked gifted, left out of spend and savings.
                    const r = await fillGifted(db, itad, db.getUser(uid), clean.map(e => e.title));
                    db.noteGrabberUse(uid);
                    return json(res, 200, { mode: "gifted", filled: r.filled, updated: r.filled, added: r.added, notFound: r.missing.length, missing: r.missing.slice(0, 50), noRetail: r.noRetail.slice(0, 50), noRetailCount: r.noRetail.length });
                }
                if (body.mode === "retail") {
                    // Steam key activations: no price paid is known, so use the retail price, only where nothing is recorded yet.
                    const r = await fillRetail(db, itad, db.getUser(uid), clean.map(e => e.title));
                    db.noteGrabberUse(uid);
                    return json(res, 200, { mode: "retail", filled: r.filled, updated: r.filled, alreadyPriced: r.alreadyPriced, notFound: r.missing.length, missing: r.missing.slice(0, 50), noRetail: r.noRetail.slice(0, 50), noRetailCount: r.noRetail.length });
                }
                if (body.mode === "prices") {
                    // Steam purchase history: fill in prices for games already in the library (a Steam sync's games), add nothing new.
                    const r = await fillPrices(db, itad, uid, clean.filter(e => e.paid !== null));
                    db.noteGrabberUse(uid);
                    return json(res, 200, { mode: r.mode, added: r.added, updated: r.filled, filled: r.filled, notFound: r.missing.length, missing: r.missing.slice(0, 50), unpriced: r.unpriced.length, unpricedTitles: r.unpriced.slice(0, 50) });
                }
                const r = await importLibrary(db, itad, uid, clean);
                db.noteGrabberUse(uid);
                return json(res, 200, { added: r.added, updated: r.updated, notFound: r.notFound.length, skippedForLimit: r.skippedForLimit });
            }

            if (key === "POST /api/grabber/prices") {
                // The extension's bundle and cart helpers: current prices for up to 60 Steam apps, by link code. Only app numbers are sent.
                const m = /^Bearer (\S+)$/.exec(String(req.headers.authorization ?? ""));
                const uid = m ? db.grabberUserForToken(m[1]) : null;
                if (!uid) throw new HttpError(401, "That link code is not valid. Make a new one with /me library grabber.");
                if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(400, "Bad request.");
                cooldown(uid, "grabberprices");
                const body = await readJson(req, 5_000);
                const appids = [...new Set((Array.isArray(body.appids) ? body.appids : []).map(Number).filter(n => Number.isInteger(n) && n > 0 && n < 1e9))].slice(0, 60);
                if (!appids.length) throw new HttpError(400, "No app numbers.");
                const user = db.getUser(uid);
                const ids = await itad.lookupShopIds(STEAM_SHOP_ID, appids.map(a => `app/${a}`));
                const found = appids.map(a => [a, ids.get(`app/${a}`)]).filter(([, id]) => id);
                const prices = found.length ? await itad.getPrices(found.map(([, id]) => id), grabberRegion(user, body.cc)) : new Map();
                const items = found.map(([appid, id]) => {
                    const sum = summarize(prices.get(id), { majorOnly: user?.stores === "major" });
                    return { appid, steam: sum.steam, msrp: sum.msrp, best: sum.best ? { price: sum.best.price, shop: sum.best.shop } : null, atl: sum.atl, currency: sum.currency };
                });
                return json(res, 200, { items });
            }

            if (key === "POST /api/grabber/wishlist" || key === "POST /api/grabber/spotlight" || key === "GET /api/grabber/badge") {
                // Extension helpers with the member's link code: add to the wishlist, spotlight a game on the stream overlay, and the toolbar badge.
                const m = /^Bearer (\S+)$/.exec(String(req.headers.authorization ?? ""));
                const uid = m ? db.grabberUserForToken(m[1]) : null;
                if (!uid) throw new HttpError(401, "That link code is not valid. Make a new one with /me library grabber.");
                if (key === "GET /api/grabber/badge") { cooldown(uid, "grabberbadge"); return json(res, 200, await badgeFor({ db, itad, abg: abg ?? null, userId: uid, now: now(), fetchImpl: steamFetch })); }
                if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(400, "Bad request.");
                cooldown(uid, "grabberact");
                const body = await readJson(req, 2_000);
                const appid = Number(body.appid), name = String(body.name ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
                if (!Number.isInteger(appid) || appid <= 0 || appid > 1e9 || !name) throw new HttpError(400, "Bad request.");
                const id = (await itad.lookupShopIds(STEAM_SHOP_ID, [`app/${appid}`])).get(`app/${appid}`);
                if (!id) throw new HttpError(404, "I could not match that game to price data.");
                const user = db.ensureUser(uid) && db.getUser(uid);
                if (key === "POST /api/grabber/wishlist") {
                    const r = db.addItems(uid, [{ itad_id: id, title: name }], { source: "extension" });
                    if (r.skippedForLimit) throw new HttpError(400, "Your list is full (200 games). Remove one first.");
                    db.setAppId(uid, id, appid);
                    return json(res, 200, { added: !r.existing, existing: Boolean(r.existing), public: Boolean(user.profile_public && user.profile_slug) });
                }
                if (!db.getStreamCard(uid)) return json(res, 200, { status: "no_overlay" });
                const sum = summarize((await itad.getPrices([id], grabberRegion(user, body.cc))).get(id), { majorOnly: user?.stores === "major" });
                const price = sum.best?.price ?? sum.steam;
                if (price == null) return json(res, 200, { status: "no_price" });
                const until = setSpotlight(db, uid, { appid, title: name, price, regular: sum.msrp, discount: sum.msrp ? Math.max(0, Math.round((1 - price / sum.msrp) * 100)) : 0, currency: sum.currency, shop: sum.best?.shop ?? "Steam" }, now());
                return json(res, 200, { status: "ok", until });
            }

            if (key === "POST /api/grabber/sync" || key === "GET /api/grabber/gifts" || key === "POST /api/grabber/gifts") {
                // Extension helpers with the member's link code: add owned Steam games to the library, and the spare-copy board for their server.
                const m = /^Bearer (\S+)$/.exec(String(req.headers.authorization ?? ""));
                const uid = m ? db.grabberUserForToken(m[1]) : null;
                if (!uid) throw new HttpError(401, "That link code is not valid. Make a new one with /me library grabber.");
                db.ensureUser(uid);
                if (key === "POST /api/grabber/sync") {
                    if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(400, "Bad request.");
                    cooldown(uid, "grabbersync");
                    const body = await readJson(req, 80_000);
                    const appids = (Array.isArray(body.appids) ? body.appids : []).map(Number).slice(0, 5000);
                    if (!appids.length) throw new HttpError(400, "No app numbers.");
                    return json(res, 200, await syncFromApps({ db, itad, userId: uid, appids }));
                }
                const gid = db.getUser(uid)?.guild_id;
                if (!gid) return json(res, 200, { gifts: [], noServer: true });
                cooldown(uid, "grabbergifts");
                if (key === "GET /api/grabber/gifts") return json(res, 200, { gifts: await giftRows(gid, uid) });
                if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(400, "Bad request.");
                const body = await readJson(req, 2_000);
                const r = body.action === "claim" ? claimGift(db, gid, uid, String(body.id ?? "")) : body.action === "withdraw" ? withdrawGift(db, gid, uid, String(body.id ?? "")) : offerGift(db, gid, uid, body.title);
                if (r.error) throw new HttpError(400, r.error);
                return json(res, 200, { gifts: await giftRows(gid, uid) });
            }

            if (key === "POST /api/grabber/compare") {
                // The extension's cross-store card, used on other shops' pages: prices for games found by title, in every store we track.
                const m = /^Bearer (\S+)$/.exec(String(req.headers.authorization ?? ""));
                const uid = m ? db.grabberUserForToken(m[1]) : null;
                if (!uid) throw new HttpError(401, "That link code is not valid. Make a new one with /me library grabber.");
                if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(400, "Bad request.");
                cooldown(uid, "grabbercompare");
                const body = await readJson(req, 8_000);
                const titles = [...new Set((Array.isArray(body.titles) ? body.titles : []).map(t => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 120)).filter(Boolean))].slice(0, 30);
                if (!titles.length) throw new HttpError(400, "No titles.");
                const user = db.getUser(uid), cc = grabberRegion(user, body.cc);
                const resolved = await itad.lookupTitles(titles);
                const ids = resolved.filter(r => r.id).map(r => r.id);
                const prices = ids.length ? await itad.getPrices(ids, cc) : new Map();
                const owned = new Set(db.listLibrary(uid).map(g => g.itad_id)), wished = new Set(db.listItems(uid).map(g => g.itad_id));
                const items = resolved.map(r => {
                    if (!r.id) return { title: r.title, found: false };
                    const entry = prices.get(r.id), sum = summarize(entry, { majorOnly: user?.stores === "major" });
                    const shops = (Array.isArray(entry?.deals) ? entry.deals : []).filter(d => Number.isFinite(d?.price?.amount)).sort((a, b) => a.price.amount - b.price.amount).slice(0, 6)
                        .map(d => ({ shop: String(d.shop?.name ?? "?"), price: d.price.amount, cut: d.cut ?? 0, url: /^https:\/\//.test(d.url ?? "") ? d.url : null }));
                    return { title: r.title, matched: r.matched ?? r.title, approx: Boolean(r.approx), found: true, id: r.id, currency: sum.currency, msrp: sum.msrp, steam: sum.steam, best: sum.best ? { price: sum.best.price, shop: sum.best.shop } : null, atl: sum.atl, low1y: sum.low1y, shops, owned: owned.has(r.id), wishlisted: wished.has(r.id) };
                });
                // Other regions, for a single game only. This is just for comparing; each store decides who can buy where.
                let regions = [];
                const want = [...new Set((Array.isArray(body.regions) ? body.regions : []).map(c => String(c).toUpperCase()).filter(c => /^[A-Z]{2}$/.test(c) && c !== cc))].slice(0, 4);
                if (items.length === 1 && items[0].found && want.length) {
                    regions = (await Promise.all(want.map(async c => { try { const e = (await itad.getPrices([items[0].id], grabberRegion(null, c))).get(items[0].id); const sm = summarize(e); return sm.best ? { cc: c, price: sm.best.price, shop: sm.best.shop, currency: sm.currency } : null; } catch { return null; } }))).filter(Boolean);
                }
                return json(res, 200, { cc, items, regions });
            }

            if (key === "GET /api/grabber/game") {
                // Called by the extension on a Steam store page, with the member's link code. Returns prices and whether they own or wishlisted it.
                const m = /^Bearer (\S+)$/.exec(String(req.headers.authorization ?? ""));
                const uid = m ? db.grabberUserForToken(m[1]) : null;
                if (!uid) throw new HttpError(401, "That link code is not valid. Make a new one with /me library grabber.");
                const appid = Number(url.searchParams.get("appid"));
                if (!Number.isInteger(appid) || appid <= 0 || appid > 1e9) throw new HttpError(400, "Bad app id.");
                cooldown(uid, "grabbergame");
                const user = db.getUser(uid);
                const map = await itad.lookupShopIds(STEAM_SHOP_ID, [`app/${appid}`]);
                const id = map.get(`app/${appid}`);
                if (!id) return json(res, 200, { found: false });
                const prices = await itad.getPrices([id], grabberRegion(user, url.searchParams.get("cc")));
                const sum = summarize(prices.get(id), { majorOnly: user?.stores === "major" });
                return json(res, 200, {
                    found: true, currency: sum.currency, msrp: sum.msrp, steam: sum.steam, cut: sum.cut,
                    best: sum.best ? { price: sum.best.price, shop: sum.best.shop } : null, atl: sum.atl, low1y: sum.low1y,
                    owned: db.listLibrary(uid).some(g => g.itad_id === id),
                    wishlisted: db.listItems(uid).some(g => g.itad_id === id),
                    playtest: await playtestFor({ abg, appid, name: String(url.searchParams.get("name") ?? "").slice(0, 100), now: now() }),
                    social: await socialFor({ db, nowPlaying, userId: uid, appid }),
                    overlay: Boolean(db.getStreamCard(uid))
                });
            }

            if (key === "POST /api/admin/login") { checkWrite(req); return json(res, 200, adminPasswordLogin(req, res, await readJson(req, 5_000))); }
            if (key === "GET /api/music/viz") return vizStream(req, res, url);
            if (key === "GET /api/overlay/stream") return overlayStream(req, res, url);
            if (key === "POST /api/square/webhook") return await squareWebhook(req, res);
            if (key === "GET /api/streamcard/text") return await streamCardText(req, res, url);
            const handler = routes[key];
            // Dashboard pages have clean addresses (/wishlist, /servers/123). Opening one directly, or reloading it, gets the app.
            if (!handler && req.method === "GET" && !/^\/(api|auth)\//.test(url.pathname) && !/\.[a-z0-9]+$/i.test(url.pathname) && String(req.headers.accept ?? "").includes("text/html")
                && !onAdminHost(req) && !onMusicHost(req)) return await serveFile(res, "/");
            if (!handler) throw new HttpError(404, "Not found.");
            let body = {};
            if (req.method === "POST") {
                checkWrite(req);
                body = await readJson(req, key === "POST /api/value" ? MAX_UPLOAD_CHARS * 2 + 50_000 : key === "POST /api/giveaways/create" ? 60_000 : key === "POST /api/admin/xposter/post" ? 7_200_000 : key === "POST /api/profile/background" || key === "POST /api/social/post" ? 1_700_000 : key === "POST /api/community/emoji" ? 400_000 : 20_000);
            }
            const out = await handler(req, body, url);
            if (req.method === "POST" && url.pathname.startsWith("/api/admin/")) auditAdmin(req, url.pathname, body);
            json(res, 200, out);
        } catch (err) {
            const e = toHttp(err);
            json(res, e.status, e.restricted ? { error: e.message, restricted: true } : { error: e.message });
        }
    });

    return {
        server,
        listen: (port = config.port, host = config.host) => new Promise(resolve => server.listen(port, host, () => resolve(server.address()))),
        close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); }),
        _sessions: sessions
    };
}

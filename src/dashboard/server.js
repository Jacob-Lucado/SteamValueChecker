// Web dashboard: everything the slash commands do, in a browser. Uses Node's http module only.
// Login is Discord OAuth2 (identify + guilds). Sessions live in memory, so a restart logs everyone out.

import { roleIds } from "../gwroles.js";
import { pushEvent } from "../adminlog.js";
import http from "node:http";
import { CHANGELOG, LATEST } from "../changelog.js";
import { randomBytes, createHash } from "node:crypto";
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
import * as xposterText from "../xposter.js";
import { renderBundleLanding, renderDealLanding, renderBundleGone, bundleDestination, dealDestination, safePictureUrl, splitGame } from "../bundlelanding.js";
import { resolveArt, resolveUrlArt, ART_KINDS } from "../art.js";
import { compareGiftRegions } from "../giftregion.js";
import { PAGE_PRESETS, MAX_BG_STORED } from "../profilebg.js";
import { viewRows, exportJson, WishlistError } from "../wishlist.js";
import { SteamError, STEAM_SHOP_ID } from "../steam.js";
import { ItadError } from "../itad.js";
import { DiscordApiError } from "./discord.js";
import { createCommunityDash, CommunityError } from "./communitydash.js";
import { createModDash, ModDashError } from "./moddash.js";
import { HttpError } from "./http.js";
import { createOverlayRoutes } from "./overlayroutes.js";
import { createAdminRoutes } from "./adminroutes.js";
import { createMiscRoutes } from "./miscroutes.js";
import { createModRoutes } from "./modroutes.js";
import { createRedeemRoutes } from "./redeemroutes.js";
import { createPlayRoutes } from "./playroutes.js";
import { createProfileRoutes } from "./profileroutes.js";
import { createAdminExtraRoutes } from "./adminextraroutes.js";
import { createFortniteRoutes } from "./fortniteroutes.js";
import { createWishlistRoutes } from "./wishlistroutes.js";
import { createLibraryRoutes } from "./libraryroutes.js";
import { createTicketRoutes } from "./ticketroutes.js";
import { createMusicRoutes } from "./musicroutes.js";
import { createStreamRoutes } from "./streamroutes.js";
import { createServerRoutes } from "./serverroutes.js";
import { createSocialRoutes } from "./socialroutes.js";
import { createIndieRoutes } from "./indieroutes.js";
import { createCommunityRoutes } from "./communityroutes.js";
import { createGiveawayRoutes } from "./giveawayroutes.js";
import { botInviteUrl } from "../community.js";
import { listModels } from "../aiproviders.js";
import { connectionPayload } from "../linkedroles.js";
import { HELP, ABOUT, PRIVACY } from "../text.js";
import { valueBadgeSvg } from "../valuebadge.js";



import { isSupporter } from "../supporters.js";
import { buildProfile, withDefaults, PROFILE_THEMES, PROFILE_STYLES, BG_STYLES, LAYOUTS, SECTIONS, LINK_KIND_NAMES } from "../profilepage.js";
import { enrichFree, withOwnership } from "../freeinfo.js";
import { forYou } from "../foryou.js";
import { steamLoginUrl, verifySteamLogin } from "../steamopenid.js";
import { UserError } from "../errors.js";
import { createIndie } from "../indie.js";
import { createFortnite } from "../fortnite.js";
import { INDIE_TOOLS, indieSeo } from "../indiemeta.js";
import { createIndieNews } from "../indienews.js";
import { indieBadgeSvg } from "../indiebadge.js";
import { createStreams, canStreamIn } from "../streamlive.js";
import { sanitize } from "../parse.js";
import { prefsView } from "../prefs.js";
import { renderSteamValue, renderRecap, renderProfileShare } from "../cardimg.js";
import { createBroadcaster } from "../broadcast.js";
import { grabberPromo } from "../promo.js";
import { noticePreset } from "../noticepresets.js";
import { createNews } from "../news.js";
import { playtestBoard } from "../playboard.js";
import { streamCardData, streamCardLine, STREAMCARD_KINDS } from "../streamcard.js";
import { createStreamGiveaways } from "../streamgiveaway.js";
import { playtestFor, socialFor, setSpotlight, getSpotlight, badgeFor, syncFromApps, listGifts, offerGift, claimGift, withdrawGift } from "../extapi.js";
import { createPlaytestSources } from "../playsources.js";
import { fillGifted, fillPrices, fillRetail, importLibrary } from "../library.js";
import { regionPrices } from "../regions.js";
import { calendarEntries, toIcs } from "../calendar.js";
import { createLimiter } from "../ratelimit.js";
import { publicWishlist } from "../profile.js";
import { steamArt } from "../render.js";
import { summarize } from "../report.js";
import { buyOrWait } from "../advice.js";
import { renderGamePage, slugify } from "../gamepage.js";
import { grabberRegion } from "../spend.js";
import { monthKey } from "../challenge.js";
import { MAX_CLAIMS_PER_LIST, MAX_CLAIMS_TOTAL, accountOldEnough } from "../giftstore.js";
import { upcomingSales, salesBefore, SALES_UPDATED, SALES } from "../salescal.js";
import { fetchProfileCard } from "../steamlib.js";
import { isDlc } from "../freemenu.js";
import { freeArt } from "../render.js";
import { isHidden } from "../hidden.js";
import { legalPage, legalFramePage } from "../legal.js";
import { createMusicChat } from "../musicchat.js";
import { dmChannel, isDm, dmParts } from "../staffchat.js";
import { PANEL_AREAS, mayChange } from "../paneluser.js";
import { checkPassword, burnTime, matchTotp } from "../adminlogin.js";

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
    "/studio.js": ["studio.js", "text/javascript; charset=utf-8"],
    "/rendervalueui.js": ["rendervalueui.js", "text/javascript; charset=utf-8"],
    "/wishcardui.js": ["wishcardui.js", "text/javascript; charset=utf-8"],
    "/feedcardui.js": ["feedcardui.js", "text/javascript; charset=utf-8"],
    "/streamcardpanelui.js": ["streamcardpanelui.js", "text/javascript; charset=utf-8"],
    "/giveawayoverlaypanelui.js": ["giveawayoverlaypanelui.js", "text/javascript; charset=utf-8"],
    "/profilerenderui.js": ["profilerenderui.js", "text/javascript; charset=utf-8"],
    "/profilesongui.js": ["profilesongui.js", "text/javascript; charset=utf-8"],
    "/tourui.js": ["tourui.js", "text/javascript; charset=utf-8"],
    "/landingui.js": ["landingui.js", "text/javascript; charset=utf-8"],
    "/serverdetailui.js": ["serverdetailui.js", "text/javascript; charset=utf-8"],
    "/streamerhubui.js": ["streamerhubui.js", "text/javascript; charset=utf-8"],
    "/streamersui.js": ["streamersui.js", "text/javascript; charset=utf-8"],
    "/connectui.js": ["connectui.js", "text/javascript; charset=utf-8"],
    "/freeui.js": ["freeui.js", "text/javascript; charset=utf-8"],
    "/gameui.js": ["gameui.js", "text/javascript; charset=utf-8"],
    "/publicprofileui.js": ["publicprofileui.js", "text/javascript; charset=utf-8"],
    "/requestsui.js": ["requestsui.js", "text/javascript; charset=utf-8"],
    "/mydataui.js": ["mydataui.js", "text/javascript; charset=utf-8"],
    "/helpui.js": ["helpui.js", "text/javascript; charset=utf-8"],
    "/aboutui.js": ["aboutui.js", "text/javascript; charset=utf-8"],
    "/statusui.js": ["statusui.js", "text/javascript; charset=utf-8"],
    "/notificationsui.js": ["notificationsui.js", "text/javascript; charset=utf-8"],
    "/compareui.js": ["compareui.js", "text/javascript; charset=utf-8"],
    "/gamenightui.js": ["gamenightui.js", "text/javascript; charset=utf-8"],
    "/nowplayingui.js": ["nowplayingui.js", "text/javascript; charset=utf-8"],
    "/santaui.js": ["santaui.js", "text/javascript; charset=utf-8"],
    "/clubui.js": ["clubui.js", "text/javascript; charset=utf-8"],
    "/foryouui.js": ["foryouui.js", "text/javascript; charset=utf-8"],
    "/valueui.js": ["valueui.js", "text/javascript; charset=utf-8"],
    "/bundlesui.js": ["bundlesui.js", "text/javascript; charset=utf-8"],
    "/setupui.js": ["setupui.js", "text/javascript; charset=utf-8"],
    "/mypageui.js": ["mypageui.js", "text/javascript; charset=utf-8"],
    "/codesui.js": ["codesui.js", "text/javascript; charset=utf-8"],
    "/playtestsui.js": ["playtestsui.js", "text/javascript; charset=utf-8"],
    "/discoverui.js": ["discoverui.js", "text/javascript; charset=utf-8"],
    "/communitiesui.js": ["communitiesui.js", "text/javascript; charset=utf-8"],
    "/xpui.js": ["xpui.js", "text/javascript; charset=utf-8"],
    "/triviaui.js": ["triviaui.js", "text/javascript; charset=utf-8"],
    "/peopleui.js": ["peopleui.js", "text/javascript; charset=utf-8"],
    "/feedui.js": ["feedui.js", "text/javascript; charset=utf-8"],
    "/lfgui.js": ["lfgui.js", "text/javascript; charset=utf-8"],
    "/calendarui.js": ["calendarui.js", "text/javascript; charset=utf-8"],
    "/friendsui.js": ["friendsui.js", "text/javascript; charset=utf-8"],
    "/tipui.js": ["tipui.js", "text/javascript; charset=utf-8"],
    "/changelogui.js": ["changelogui.js", "text/javascript; charset=utf-8"],
    "/supportui.js": ["supportui.js", "text/javascript; charset=utf-8"],
    "/profileeditorui.js": ["profileeditorui.js", "text/javascript; charset=utf-8"],
    "/alertsui.js": ["alertsui.js", "text/javascript; charset=utf-8"],
    "/wishlistui.js": ["wishlistui.js", "text/javascript; charset=utf-8"],
    "/serversui.js": ["serversui.js", "text/javascript; charset=utf-8"],
    "/musicui.js": ["musicui.js", "text/javascript; charset=utf-8"],
    "/redeemui.js": ["redeemui.js", "text/javascript; charset=utf-8"],
    "/steamui.js": ["steamui.js", "text/javascript; charset=utf-8"],
    "/libraryui.js": ["libraryui.js", "text/javascript; charset=utf-8"],
    "/giveaways.js": ["giveaways.js", "text/javascript; charset=utf-8"],
    "/deals.js": ["deals.js", "text/javascript; charset=utf-8"],
    "/warroom.js": ["warroom.js", "text/javascript; charset=utf-8"],
    "/mod.js": ["mod.js", "text/javascript; charset=utf-8"],
    "/streams.js": ["streams.js", "text/javascript; charset=utf-8"],
    "/community.js": ["community.js", "text/javascript; charset=utf-8"],
    "/adminui.js": ["adminui.js", "text/javascript; charset=utf-8"],
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

const MOD_PERMS = { moderate: { bit: 1n << 40n, text: "Moderate Members" }, kick: { bit: 1n << 1n, text: "Kick Members" }, ban: { bit: 1n << 2n, text: "Ban Members" }, manageMessages: { bit: 1n << 13n, text: "Manage Messages" }, manageChannels: { bit: 1n << 4n, text: "Manage Channels" }, manageGuild: { bit: MANAGE_GUILD, text: "Manage Server" } };
const MOD_ACTION_PERM = { warn: "moderate", timeout: "moderate", untimeout: "moderate", kick: "kick", ban: "ban", unban: "ban", purge: "manageMessages", note: "moderate", slowmode: "manageChannels", lock: "manageChannels", unlock: "manageChannels" };
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

export function createDashboard({ referrals = null, weekly = null, indieSvc = null, fortniteSvc = null, indieNews = null, spotlight = null, storage = null, topgg = null, twitchReply = false, trivia = null, emojigg = null, news = null, abg = null, nowPlaying = null, playtests = null, db, itad, rest, music = null, musicGuild = null, stations = null, codes = null, bundleFeed = null, xposter = null, imageFetch = globalThis.fetch, drops = null, ops = null, giveaways = null, tickets = null, logs = null, botInfo = null, status = null, djsVersion = null, botGuilds = null, guildList = null, guildInvite = null, leaveGuild = null, commandWatch = null, offsite = null, health = null, square = null, supporters = null, lfg = null, calendar = null, community = null, moderation = null, automod = null, membersIntent = () => true, rt = null, ai = null, broadcaster: sharedBroadcaster = null, dm = null, fx = null, steamFetch = globalThis.fetch, config, now = () => Date.now(), log = () => {} }) {
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
    const md = moderation ? createModDash({ db, rest, mod: moderation, automod }) : null;
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
    const overlayRoutes = createOverlayRoutes({ db, rest, itad, now, remember, session, streamAccess, mayStream, clientIp, overlayLimit, origin, botGuilds, guildList, nowPlaying });
    const CRAWLER = /bot|crawl|spider|preview|discord|twitter|x\.com|facebook|slack|telegram|whatsapp|linkedin|embed|curl|python|node|go-http|headless/i;
    const devSession = req => {
        const s = session(req);
        if (!isOwner(s) && !isIndieDev(s.userId)) throw new HttpError(403, "The dev panel is for verified indie developers. It unlocks when a game of yours is approved in the indie showcase.");
        return s;
    };
    // what the public indie pages and the admin review queue both show of a game
    const indiePublic = g => ({ id: g.id, appid: g.appid, title: g.title, studio: g.studio, blurb: g.blurb, pitch: g.pitch, genres: g.genres, image: g.image, price: g.price, release: g.release, links: g.links, featured: g.featured, verified: Boolean(g.verified), likes: g.likes, steamUrl: `https://store.steampowered.com/app/${g.appid}/` });
    const adminRoutes = createAdminRoutes({ indiePublic, COOKIE, RADIO_MAX, WALLS, adminHost, botInfo, broadcaster, chatChannel, chatLimit, chatMe, chatPeople, chatSeen, chatSession, chatTyping, cleanLook, commandWatch, community, config, cookieDomain, cookies, cooldown, db, dm, dropFiles, giveaways, guildInvite, guildList, health, indieApi, isOwner, itad, leaveGuild, log, logs, membersIntent, needGiveaways, needTickets, now, offsite, ops, origin, outcomeOf, pendingClaimsFor, remember, rest, session, sessions, spotlight, storage, syncIndieDev, ticketAccess, tickets, verifyCurrent, weekly, xposter });
    const giveawayRoutes = createGiveawayRoutes({ cooldown, db, giveawayOf, giveaways, itad, managerGuild, needGiveaways, outcomeOf, pendingClaimsFor, rest, session });
    const communityRoutes = createCommunityRoutes({ botGuilds, botIn, cd, comm, cooldown, guildFor, guildList, isManager, managerGuild, playtests, session });
    const indieRoutes = createIndieRoutes({ CRAWLER, adminRoutes, clientIp, config, db, decideKeyRequest, devSession, indieApi, indieHerald, indieKeyLimit, indieLookupLimit, indiePublic, indieReportLimit, indieSyncLimit, indieUpdateLimit, indieVerifyLimit, indieWriteLimit, isOwner, now, origin, session, socialWrite, softSession, syncIndieDev });
    const socialRoutes = createSocialRoutes({ authorCard, clientIp, config, db, directory, guildList, isManager, isOwner, mayPost, notifySocial, now, peopleList, reactSeen, serverFilter, session, shapeItems, slugOwner, socialRead, socialWrite, softSession, userRow });
    const serverRoutes = createServerRoutes({ botGuilds, bundleFeed, cd, codes, comm, communityRoutes, config, cooldown, db, drops, guildChoices, guildFor, isManager, itad, managedGuild, managerGuild, names, now, rest, session, userRow });
    const streamRoutes = createStreamRoutes({ cardsFor, clientIp, cooldown, db, guildChoices, gwOverlayPicks, isManager, isOwner, musicCall, musicMember, now, origin, overlayLimit, remember, rest, rolesIn, session, streamAccess, streamGw, streams, twitchReply, userRow });
    const musicRoutes = createMusicRoutes({ botGuilds, chat, cooldown, db, guildChoices, isManager, isOwner, managedGuild, mayStream, music, musicCall, musicGuild, musicMember, musicOrigin, origin, remember, rest, session, stations, streamAccess, streamRoutes });
    // news and the playtest sources are built the first time they're needed
    const getNews = () => news ?? (news = createNews());
    const getAbg = () => abg ?? (abg = createPlaytestSources());
    const ticketRoutes = createTicketRoutes({ db, isManager, isOwner, logs, managerGuild, needTickets, session, settingsView, ticketAccess, tickets });
    const libraryRoutes = createLibraryRoutes({ cooldown, db, getNews, itad, num, session, userRow });
    const wishlistRoutes = createWishlistRoutes({ MAX_HISTORY_POINTS, MUTE_DAYS, clientIp, config, cooldown, db, dm, giveawayRoutes, idFinderLimit, isStaff, itad, libraryRoutes, now, num, profileCard, profileOrLinked, session, steamFetch, userRow });
    const fortniteRoutes = createFortniteRoutes({ clientIp, fnSvc, fortniteCall, fortniteLimit, ticketRoutes });
    /** Where "add the bot" clicks came from over the last 30 days, and how many servers it joined in that time. */
    const inviteReport = () => {
        const cut = new Date(now() - 30 * 86400_000).toISOString().slice(0, 10), by = new Map(); let clicks = 0, joins = 0;
        for (const r of db.listMetaPrefix("invc:")) { const [, day, src] = r.key.split(":"); if (day < cut) continue; const n = Number(r.value) || 0; by.set(src, (by.get(src) ?? 0) + n); clicks += n; }
        for (const r of db.listMetaPrefix("invj:")) if (r.key.slice(5) >= cut) joins += Number(r.value) || 0;
        return { clicks, joins, sources: [...by].map(([source, n]) => ({ source, clicks: n })).sort((a, b) => b.clicks - a.clicks) };
    };
    const dayKey = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()); // YYYY-MM-DD, Eastern

    const adminExtraRoutes = createAdminExtraRoutes({ ai, authorCard, bundleFeed, codes, config, dayKey, db, dm, guildList, health, inviteReport, isOwner, itad, logs, music, musicCall, now, ops, origin, rest, rt, session, square, storage, supporters, topgg, weekly, xposter });
    const profileRoutes = createProfileRoutes({ authorCard, bgLimit, config, cooldown, db, guildFor, isManager, isOwner, itad, mayPost, notifySocial, now, nowPlaying, profileEditorPayload, rest, session, slugOwner, socialRoutes, socialWrite, steamFetch, userRow });
    const playRoutes = createPlayRoutes({ botGuilds, calendar, cooldown, db, dm, guildFor, isManager, isOwner, itad, lfg, managerGuild, now, nowPlaying, origin, rest, session, trivia, userRow });
    const redeemRoutes = createRedeemRoutes({ adminExtraRoutes, botGuilds, codes, cooldown, db, dm, fortniteRoutes, indieRoutes, isOwner, itad, musicRoutes, now, overlayRoutes, serverRoutes, session, userRow, wishlistRoutes });
    const modRoutes = createModRoutes({ MOD_ACTION_PERM, MOD_PERMS, botIn, cooldown, hasGuildPerm, isManager, md, modGuild, modr, session });
    const miscRoutes = createMiscRoutes({ PAGES, checkoutLimit, config, cooldown, db, isOwner, log, now, origin, publicSettings, referrals, remember, rest, session, square, supporters, topgg, userRow });
    const routes = {
        ...overlayRoutes,
        ...adminRoutes,
        ...giveawayRoutes,
        ...communityRoutes,
        ...indieRoutes,
        ...socialRoutes,
        ...serverRoutes,
        ...streamRoutes,
        ...musicRoutes,
        ...ticketRoutes,
        ...libraryRoutes,
        ...wishlistRoutes,
        ...fortniteRoutes,
        ...adminExtraRoutes,
        ...redeemRoutes,
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

        ...miscRoutes,
        "GET /api/me": async (req, _b, url) => {
            // The page asks with ?soft=1 on load. Signed out is then an ordinary answer instead of a 401, so visitors' consoles stay clean.
            if (url.searchParams.get("soft") === "1" && !softSession(req) && !sessions.get(cookies(req)[COOKIE])) return { user: null, signedOut: true };
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










        "GET /api/public/supporters": async () => ({ wall: supporters ? supporters.wall() : [] }),


















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

        ...profileRoutes,








        // Deals picked for you: discounts ranked by taste and wishlist. `pending` = games still waiting for genres; the page asks again.
        "GET /api/foryou": async (req) => {
            const s = session(req);
            const u = userRow(s);
            cooldown(s.userId, "foryou");
            return await forYou({ db, itad, userId: s.userId, user: u, fetchImpl: steamFetch ?? globalThis.fetch });
        },



















        ...playRoutes,







        ...modRoutes,



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
            return playtestBoard({ db, news: getNews(), abg: getAbg(), userId: s.userId, now: now(), log });
        },


        // The signed-in member's own prizes: where each one stands and when to claim it. Keys are never included.
        "GET /api/claims": async (req) => {
            const s = session(req); userRow(s);
            return { prizes: db.prizesFor(s.userId).map(p => ({ ...p, link: p.message_id ? `https://discord.com/channels/${p.guild_id}/${p.channel_id}/${p.message_id}` : null })) };
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
    // The generated landing pages. The deals page takes a while to build (it fetches prices and art), so once it exists a stale copy
    // is served while a fresh one builds in the background, and it is built once shortly after start so the first visitor never waits.
    const seoBuilding = new Set();
    async function buildSeo(file) {
        let body; cache.set(file + ":at", Date.now()); const slug = file.slice(4, -5); let deals = null; if (slug === "steam-deals-this-week") { try { deals = withPictures(await fillArt(pickDeals(await itad.getDealsPool({ country: "US", pages: 6 }), 45), { max: 45 }), 20); } catch { /* the page says the list is loading */ } } const html = renderSeoPage(slug, { origin, invite: config.clientId ? `${origin}/invite` : null, deals }); if (!html) return null; body = Buffer.from(html); cache.set(file, body); cache.set(file + ":etag", `W/"${createHash("sha1").update(body).digest("hex").slice(0, 16)}"`); return body;
    }
    function refreshSeo(file) {
        if (seoBuilding.has(file)) return;
        seoBuilding.add(file);
        buildSeo(file).catch(() => {}).finally(() => seoBuilding.delete(file));
    }
    setTimeout(() => refreshSeo("seo/steam-deals-this-week.html"), 20_000).unref?.();
    async function loadFile(file) {
        let body = cache.get(file);
        // The sale-dates page counts days, so it is rebuilt every hour instead of once.
        if (body && file.startsWith("seo/") && seoIsLive(file.slice(4, -5)) && Date.now() - (cache.get(file + ":at") ?? 0) > 3600_000) { refreshSeo(file); return body; }
        if (!body) {
            if (file.startsWith("seo/")) return buildSeo(file);
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
    const bump = key => { try { db.setMeta(key, String((Number(db.getMeta(key)) || 0) + 1)); } catch { /* a missed count isn't worth failing the page */ } };
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

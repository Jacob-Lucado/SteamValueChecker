// How-to guides the bot answers by itself, no AI needed. Someone asks "how do I get Steam Verified" and the bot replies with a
// card: short intro, a picture of the numbered steps with the exact commands, and buttons that go straight there.
// Matching is strict on purpose: the message has to sound like a how-to question AND name the topic, so normal chat is left alone.
import { renderSteps } from "./aipics.js";
import { dashLink } from "./dashlink.js";

const dash = (page, label) => ({ kind: "dash", page, label });
const COLOR = { steam: 0x66c0f4, alerts: 0xff9800, social: 0x5865f2, help: 0x57f287 };

export const GUIDES = [
    { id: "verify", title: "Get the Steam Verified role", color: COLOR.steam, topic: /steam.{0,25}verif|verif\w*.{0,25}steam|\bsteam verified\b/, loose: /\bget (the )?verified\b|\bverified role\b|\bhow.{0,12}verify\b/, needsRole: true,
        intro: "Prove your Steam account is yours and get the **Steam Verified** role. It takes about a minute and I never see your Steam password.",
        steps: [
            { text: "Press the Verify button in the verify channel, or type this anywhere in the server.", cmd: "/me steam verify" },
            { text: "Press Verify with Steam. You land on Steam's own sign-in page." },
            { text: "Sign in on Steam, then come back to Discord." },
            { text: "Press the button again, or run the command once more. The role lands on you right away.", cmd: "/me steam verify" },
            { text: "Optional: use the same Verify with Steam button to show your Steam on your Discord profile (Linked Roles)." }
        ],
        tips: ["No role handed out? A server manager has to set one first: `/manage community setup` or `/manage community verifyrole`.", "My role has to sit above Steam Verified in Server Settings, Roles."], buttons: [{ kind: "verify", label: "Verify with Steam" }] },

    { id: "wishlist-import", title: "Import your Steam wishlist", color: COLOR.alerts, topic: /(import|sync|bring|load|copy|transfer).{0,25}(my )?(steam )?wish ?list|steam wish ?list|wish ?list.{0,20}(import|sync|from steam)/, loose: null,
        intro: "Bring your whole Steam wishlist over so I can watch every game on it for sales.",
        steps: [
            { text: "Make sure your Steam wishlist is public (Steam, Profile, Edit Profile, Privacy Settings)." },
            { text: "Sign in through Steam once, from the dashboard or with:", cmd: "/me steam link" },
            { text: "Import it.", cmd: "/me wishlist import" },
            { text: "Check it, and set when you want to be alerted.", cmd: "/me wishlist view" }
        ],
        tips: ["Run the import again any time. New games are added and ones you removed on Steam are dropped."], buttons: [dash("wishlist", "Open my wishlist")] },

    { id: "wishlist-add", title: "Add a game and get sale alerts", color: COLOR.alerts, topic: /(add|track|watch|follow|alert|notify|tell).{0,25}(game|title|it)?.{0,25}(wish ?list|sale|discount|price|goes? on sale|drops?)|price (alert|drop)|(sale|discount|deal) (alerts?|notifications?)|notify me.{0,20}sale/, loose: null,
        intro: "Add a game to your wishlist and I message you the moment it hits the price you care about.",
        steps: [
            { text: "Add the game. Start typing its name and pick it from the list.", cmd: "/me wishlist add" },
            { text: "Choose when to alert you: any sale, a percentage off, a price or lower, or an all-time low." },
            { text: "Change a game's alert later.", cmd: "/me wishlist alert" },
            { text: "Star the ones you can't miss so they come through even in quiet hours.", cmd: "/me wishlist priority" }
        ],
        tips: ["Pick where alerts arrive (DM or the server channel) with `/alerts delivery`."], buttons: [dash("wishlist", "Open my wishlist")] },

    { id: "link-steam", title: "Link your Steam account", color: COLOR.steam, topic: /(link|connect|sign ?in|log ?in|add|sync|import).{0,25}(my )?steam( account| library| games?| profile)?\b|steam.{0,15}(link|connect|sync)/, loose: null,
        intro: "Linking Steam fills your library, hours played, achievements and taste picks automatically, and keeps them fresh.",
        steps: [
            { text: "Run the link command.", cmd: "/me steam link" },
            { text: "Press the button and sign in on Steam's own page. I only get your public ID." },
            { text: "Your games import on their own. To refresh later:", cmd: "/me steam sync" },
            { text: "See what it found.", cmd: "/me steam view" }
        ],
        tips: ["Hours or achievements missing? Set your Steam **Game details** to Public in Steam's privacy settings, then sync again.", "Prefer not to sign in? Run `/me steam link` with a profile link instead."], buttons: [dash("steam", "Open Steam in the dashboard")] },

    { id: "free-games", title: "Never miss a free game", color: COLOR.alerts, topic: /free games?|freebies?|giveaways? (alerts?|notif)|(epic|gog|steam|prime).{0,15}free|get.{0,10}free.{0,10}(games?|stuff)/, loose: null,
        intro: "I watch Epic, Steam, GOG and more for free-to-claim games and tell you before they expire.",
        steps: [
            { text: "See what is free right now.", cmd: "/games freegames" },
            { text: "Turn on free game alerts so I message you when new ones appear.", cmd: "/alerts freegames enabled:true" },
            { text: "Server managers can post them to a channel for everyone.", cmd: "/manage alertchannel set" }
        ],
        tips: ["Add `dlc:false` if you only want full games."], buttons: [dash("free", "Open free games")] },

    { id: "alerts-delivery", title: "Choose where your alerts arrive", color: COLOR.alerts, topic: /(alerts?|notifications?|dms?|messages?).{0,25}(where|channel|dm|direct|stop|change|move|send)|(stop|change|move|send).{0,20}(alerts?|notifications?|dms?)|bot (dm|dms|messages) me/, loose: null,
        intro: "Alerts can come by DM, or in the server's alert channel where you get mentioned.",
        steps: [
            { text: "Pick DM or channel.", cmd: "/alerts delivery" },
            { text: "Set quiet hours so nothing pings you at night.", cmd: "/alerts quiethours" },
            { text: "Only hear about big drops.", cmd: "/alerts mindiscount" },
            { text: "Pause everything for a while, then switch back on.", cmd: "/alerts pause" }
        ],
        tips: ["Closed DMs fall back to the server channel automatically.", "`/alerts status` shows every setting in one place."], buttons: [dash("alerts", "Open alert settings")] },

    { id: "library-import", title: "Add your games and what you paid", color: COLOR.steam, topic: /(add|import|upload|track|put).{0,25}(my )?(game )?(library|collection|games|keys|fanatical|humble|bundles?)|fanatical.{0,20}(keys?|extension|grabber|import)|grabber/, loose: null,
        intro: "Fill your library to see what it is worth, what you saved and what is still in your backlog.",
        steps: [
            { text: "Steam players: link Steam and everything imports.", cmd: "/me steam link" },
            { text: "Fanatical keys: install the FanaticalGrabber extension and get a link code.", cmd: "/me library grabber" },
            { text: "Have a list? Upload a .csv, .json or .txt export.", cmd: "/me library import" },
            { text: "Add one game and what you paid.", cmd: "/me library add" },
            { text: "See the value and savings.", cmd: "/me library view" }
        ],
        tips: ["A Paid column in your file is used for savings. Games without it still count toward value."], buttons: [dash("library", "Open my library")] },

    { id: "profile-page", title: "Make your public profile page", color: COLOR.social, topic: /(profile|page).{0,15}(page|card|link|public|setup|set up|make|create|customi[sz]e)|(make|create|set ?up|customi[sz]e|edit).{0,20}(my )?(profile|page)|profile ?card|public page/, loose: null,
        intro: "Your own page with your favorites, wishlist, achievements and more, on a link you can share anywhere.",
        steps: [
            { text: "Turn it on and pick your link name.", cmd: "/me publicpage enabled:true" },
            { text: "Set your bio and display name.", cmd: "/me profile bio" },
            { text: "Pick a look: theme, accent color, background, layout.", cmd: "/me profile look" },
            { text: "Choose which sections people see in the dashboard editor." },
            { text: "Want it as a picture to post? Draw it as a card.", cmd: "/me profilecard" }
        ],
        tips: ["Every section can be public, server-only or hidden."], buttons: [dash("profile", "Edit my profile")] },

    { id: "dashboard", title: "Open the dashboard", color: COLOR.help, topic: /dash ?board|web ?(site|page|app)|control panel|website/, loose: null,
        intro: "Everything the bot does, with buttons and charts: library, wishlist, deals, servers, community and settings.",
        steps: [
            { text: "Run the command and press the button, or use the link below.", cmd: "/dashboard" },
            { text: "Sign in with Discord. Add Steam if you want your games and hours." },
            { text: "Pick a page from the menu. Everything you can do in Discord works there too." }
        ],
        tips: ["`/dashboard page:library` opens a page directly."], buttons: [dash(null, "Open the dashboard")] },

    { id: "region", title: "Change your region and currency", color: COLOR.alerts, topic: /(change|set|switch|wrong|different).{0,25}(region|currency|country)|(region|currency|country).{0,25}(change|wrong|set|switch)|prices? in (my )?(currency|dollars|euros|pounds)/, loose: null,
        intro: "Prices follow your region. Set it once and every price, alert and total uses it.",
        steps: [
            { text: "Pick your region for store prices.", cmd: "/alerts region" },
            { text: "Choose which currency totals show in.", cmd: "/me currency" },
            { text: "Choose all stores or only the major ones.", cmd: "/alerts stores" }
        ],
        tips: ["Curious what a game costs elsewhere? `/games regions` compares countries."], buttons: [dash("alerts", "Open settings")] },

    { id: "support", title: "Get help or report a problem", color: COLOR.help, topic: /(report|found|got|have).{0,15}(a )?(bug|problem|issue)|(bug|issue|problem).{0,15}(report|with the bot)|(contact|reach|talk to).{0,15}(support|staff|mods?|owner|dev)|(open|make|create).{0,10}ticket|suggest.{0,12}(feature|idea)|feature request/, loose: null,
        intro: "Something broken or a feature you want? Here is the quickest way to reach a human.",
        steps: [
            { text: "Found a bug? Send it straight to the developer.", cmd: "/bot bug" },
            { text: "Need a person in this server? Open a support ticket.", cmd: "/bot support open" },
            { text: "Got an idea? Request it and vote on others.", cmd: "/bot feature request" },
            { text: "Stuck on a command? The full list is here.", cmd: "/help" }
        ],
        tips: [], buttons: [] },

    { id: "delete-data", title: "Export or delete your data", color: COLOR.help, topic: /(delete|remove|erase|wipe|export|download|clear).{0,25}(my )?(data|account|info|everything)|\bgdpr\b|what (data|info).{0,20}(store|have|keep)/, loose: null,
        intro: "You can see or delete everything I store about you, any time.",
        steps: [
            { text: "Download a copy of everything.", cmd: "/me mydata export" },
            { text: "Delete it all for good. This cannot be undone.", cmd: "/me mydata delete" },
            { text: "Read exactly what is kept and why.", cmd: "/bot privacy" }
        ],
        tips: [], buttons: [] },

    { id: "music", title: "Play music in voice", color: COLOR.social, topic: /(play|queue|request).{0,20}(music|songs?|a song|youtube|spotify|tunes)|music (bot|commands?)|how.{0,15}(use|play).{0,10}(the )?music/, loose: null,
        intro: "Join a voice channel and I'll play anything from a name or a link, with a queue and controls.",
        steps: [
            { text: "Join a voice channel.", },
            { text: "Play a song by name or link.", cmd: "/play song" },
            { text: "Use the buttons on the player, or the commands to skip, pause and loop.", cmd: "/music queue" },
            { text: "Save the queue to use again later.", cmd: "/music saveplaylist" }
        ],
        tips: ["`/play next` puts a song at the front of the queue."], buttons: [] },

    { id: "lfg", title: "Find people to play with", color: COLOR.social, topic: /(find|looking for|need|get|make|post).{0,20}(a )?(group|party|team|squad|players?|teammates?|people to play)|\blfg\b|play together|game ?night/, loose: null,
        intro: "Post a game and a time. Others join with one press, and everyone gets a reminder.",
        steps: [
            { text: "Post what you want to play and when.", cmd: "/server lfg post" },
            { text: "Members press Join on the post. I count the slots." },
            { text: "See what is open.", cmd: "/server lfg list" },
            { text: "Close it when you are done.", cmd: "/server lfg close" }
        ],
        tips: ["Add `event:true` to also create a Discord event."], buttons: [] },

    { id: "rank", title: "Check your level and rank", color: COLOR.social, topic: /(my |check|see|view|what'?s my).{0,15}(level|rank|xp)|how.{0,15}(level up|get xp|earn xp|rank up)|leaderboard/, loose: null,
        intro: "Chat and take part to earn XP in this server and climb the levels.",
        steps: [
            { text: "Check your level.", cmd: "/server rank" },
            { text: "See the level rewards.", cmd: "/server levels" },
            { text: "See who is on top.", cmd: "/server leaderboard" }
        ],
        tips: [], buttons: [dash("xp", "Open levels")] }
];

const HOWTO = /\b(how|where|what'?s the (way|process|best way)|can (i|you|someone|anyone)|could (i|you)|is there (a|any) way|anyone know|does anyone know|help( me)?( with| to)?|i (want|wanna|need|have) to|trying to|looking (for|to)|guide|tutorial|steps?( to| for)?|instructions?|explain)\b|\?\s*$/i;

/** The guide a message is asking for, or null. `hasVerifiedRole` lets a plain "how do I get verified" count when the server really has that role. */
export function matchGuide(text, { hasVerifiedRole = false } = {}) {
    const t = String(text ?? "").toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
    if (t.length < 10 || t.length > 280 || t.startsWith("/") || /^https?:\/\/\S+$/.test(t)) return null;
    if (!HOWTO.test(t)) return null;
    for (const g of GUIDES) {
        if (g.topic.test(t) || (g.loose && g.needsRole && hasVerifiedRole && g.loose.test(t))) return g;
    }
    return null;
}

/** A guide a server's managers wrote: matches when the message sounds like a question and contains one of its phrases. `loose` skips the question check (the AI already decided it is one). */
export function matchServerGuide(text, list, { loose = false } = {}) {
    const t = String(text ?? "").toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ").trim();
    if (t.length < 6 || t.length > 280 || t.startsWith("/")) return null;
    if (!loose && !HOWTO.test(t)) return null;
    const words = new Set(t.split(/[^\p{L}\p{N}']+/u).filter(Boolean));
    let best = null, bestScore = 0;
    for (const g of list ?? []) {
        for (const k of g.keywords ?? []) {
            const parts = k.split(" ");
            const score = t.includes(k) ? parts.length + 2 : loose && parts.length > 1 && parts.filter(p => p.length > 2 && words.has(p)).length >= Math.max(2, Math.ceil(parts.length * 0.6)) ? parts.length : 0;
            if (score > bestScore) { best = g; bestScore = score; }
        }
    }
    return best;
}

export function serverGuidePayload(g, { botName = "Steam Value Checker" } = {}) {
    return { embeds: [{ color: 0x5865f2, title: String(g.title).slice(0, 250), description: String(g.body).slice(0, 3800), footer: { text: `Server guide · ${botName}` } }] };
}

export const guideById = id => GUIDES.find(g => g.id === id) ?? null;
/** Best guess for a free-text topic (used by the AI's how_to tool). */
export function findGuide(topic) {
    const t = String(topic ?? "").toLowerCase();
    const byId = GUIDES.find(g => g.id === t.trim() || g.title.toLowerCase() === t.trim());
    if (byId) return byId;
    return GUIDES.find(g => g.topic.test(t) || (g.loose && g.loose.test(t))) ?? GUIDES.map(g => ({ g, n: g.title.toLowerCase().split(/\W+/).filter(w => w.length > 3 && t.includes(w)).length })).sort((a, b) => b.n - a.n).find(x => x.n > 0)?.g ?? null;
}

const GUIDE_PREFIX = "gd:";
export const GUIDE_BUTTON = GUIDE_PREFIX;

/** The buttons for a guide, plus one that opens the list of all guides. */
function rowFor(g, { publicUrl }) {
    const out = [];
    for (const b of g.buttons ?? []) {
        if (b.kind === "verify" && publicUrl) out.push({ type: 2, style: 5, label: b.label, url: `${String(publicUrl).replace(/\/+$/, "")}/auth/linked` });
        if (b.kind === "dash") { const url = dashLink(publicUrl, b.page); if (url) out.push({ type: 2, style: 5, label: b.label.slice(0, 80), url }); }
    }
    out.push({ type: 2, style: 2, label: "More guides", custom_id: `${GUIDE_PREFIX}list` });
    return [{ type: 1, components: out.slice(0, 5) }];
}

/** The message for one guide: an embed with the steps as a picture, and buttons. Falls back to text steps if the picture fails. */
export async function guidePayload(g, { publicUrl = null, botName = "Steam Value Checker" } = {}) {
    const name = `guide-${g.id}.png`;
    let file = null;
    try { file = { attachment: renderSteps({ title: g.title, sub: "Step by step", steps: g.steps, accent: "#" + g.color.toString(16).padStart(6, "0"), foot: botName }), name }; } catch { /* text steps below */ }
    const textSteps = g.steps.map((s, n) => `**${n + 1}.** ${s.text}${s.cmd ? ` \`${s.cmd}\`` : ""}`).join("\n");
    const embed = { color: g.color, title: g.title, description: file ? g.intro : `${g.intro}\n\n${textSteps}`, ...(file ? { image: { url: `attachment://${name}` } } : {}),
        fields: g.tips?.length ? [{ name: "Good to know", value: g.tips.map(t => `• ${t}`).join("\n").slice(0, 1000) }] : undefined, footer: { text: `${botName} guide · type /help for everything I can do` } };
    return { embeds: [embed], components: rowFor(g, { publicUrl }), ...(file ? { files: [file] } : {}) };
}

/** The list of all guides as a menu. */
export function guideMenu() {
    return { content: "**What do you need help with?** Pick a guide:", flags: 64, components: [{ type: 1, components: [{ type: 3, custom_id: `${GUIDE_PREFIX}pick`, placeholder: "Choose a guide", options: GUIDES.map(g => ({ label: g.title.slice(0, 100), value: g.id })) }] }] };
}

export async function handleGuideInteraction(i, { publicUrl = null } = {}) {
    if (i.isButton() && i.customId === `${GUIDE_PREFIX}list`) return i.reply(guideMenu()).catch(() => {});
    if (i.isStringSelectMenu() && i.customId === `${GUIDE_PREFIX}pick`) {
        const g = guideById(i.values?.[0]);
        if (!g) return i.update({ content: "That guide is gone.", components: [] }).catch(() => {});
        await i.deferUpdate().catch(() => {});
        const p = await guidePayload(g, { publicUrl });
        return i.followUp({ ...p, flags: 64 }).catch(() => {});
    }
}

/** Keeps the bot from repeating itself: one guide per channel every few minutes, one per person a minute, and a cap per server per hour. */
export function createGuideThrottle({ now = () => Date.now(), perChannelMs = 5 * 60_000, perUserMs = 60_000, perGuildHour = 20 } = {}) {
    const ch = new Map(), us = new Map(), gu = new Map();
    return {
        allow({ guildId, channelId, userId, guideId }) {
            const t = now();
            if (t - (us.get(userId) ?? 0) < perUserMs) return false;
            if (t - (ch.get(`${channelId}:${guideId}`) ?? 0) < perChannelMs) return false;
            const g = (gu.get(guildId) ?? []).filter(x => t - x < 3600_000);
            if (g.length >= perGuildHour) return false;
            g.push(t); gu.set(guildId, g); ch.set(`${channelId}:${guideId}`, t); us.set(userId, t);
            if (ch.size > 5000) for (const [k, v] of ch) if (t - v > perChannelMs) ch.delete(k);
            if (us.size > 5000) for (const [k, v] of us) if (t - v > perUserMs) us.delete(k);
            return true;
        }
    };
}

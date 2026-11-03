// Community features that do not need discord.js, so the dashboard and the tests can share them:
// the server template and its builder, welcome messages, invite attribution, XP and emoji import.
import { levelFromXp, xpForNext } from "./communitystore.js";

export { levelFromXp, xpForNext };

import { refreshLeaderboard } from "./leaderboard.js";
import { forumTags, backfillForum } from "./requestsync.js";
import { safeFetchImage, isEmojiGgCdn } from "./emojisource.js";
import { HONEYPOT_NAME, HONEYPOT_TOPIC, honeypotPayload } from "./honeypot.js";
const B = n => 1n << BigInt(n);
export const PERM = { createInvite: B(0), kick: B(1), ban: B(2), viewChannel: B(10), sendMessages: B(11), manageMessages: B(13), addReactions: B(6), connect: B(20),
    speak: B(21), muteMembers: B(22), deafenMembers: B(23), moveMembers: B(24), manageNicknames: B(27), viewAuditLog: B(7), createThreads: B(35), createPrivateThreads: B(36), moderate: B(40) };
const str = n => String(n);

/** Permission number for the invite link: what the existing features need plus roles, invites, emojis and events. */
export const BOT_PERMISSIONS = String(B(0) | B(4) | B(5) | B(10) | B(11) | B(14) | B(15) | B(16) | B(18) | B(28) | B(30) | B(33) | B(6) | B(1) | B(2) | B(13) | B(40) | B(17) | B(38) | B(7) | B(22) | B(23) | B(24) | B(27) | B(20) | B(21)); // Connect and Speak are for music; the five before them are what the Moderator role is made with: a bot can only hand out permissions it holds itself

/** The welcome post for the music command channel: what the music side supports and every command, grouped. */
export function musicIntroPayload() {
    return {
        embeds: [{
            color: 0xff5500, title: "🎵 Music is here", description: "Drop into a **Music** voice channel, then run the commands below in this channel. The bot plays **SoundCloud** and keeps a live now-playing card with buttons right here, so everyone can see what's on and what's next.",
            fields: [
                { name: "▶️ Play", value: "`/play` a SoundCloud link, a **playlist link** (up to 100 songs), or just words to search.\n`/music search` shows the top results to pick from.\nAdd `next` to jump the queue or `shuffle` to mix a playlist." },
                { name: "🎛️ Control", value: "`/music pause` · `resume` · `skip` (others vote) · `skipto` · `previous` · `seek` · `stop` · `leave`\n`/music volume` · `loop` (song or whole queue) · `shuffle`" },
                { name: "📜 Queue", value: "`/music nowplaying` · `queue` · `remove` · `move` · `clear`" },
                { name: "💾 Your playlists", value: "`/music saveplaylist` saves what's queued to your account, `loadplaylist` brings it back in any server, plus `playlists` and `deleteplaylist`." },
                { name: "📻 Live radio & Auto DJ", value: "`/music live` lists radio stations on the air right now, or paste any stream link into `/play`.\nWith the **Auto DJ** on, the bot keeps playing a playlist when nobody has queued anything, and anyone can send requests with `/music autodj submit` (no voice channel needed).\nManagers can also make the bot **stay** in its last voice channel: it waits there when everyone leaves, then goes back to the last live station (or the Auto DJ) as soon as someone joins." },
                { name: "🛠️ Managers", value: "`/music settings` sets a DJ role, starting volume, queue and song length limits, and where the now-playing card goes. It all lives on the dashboard's **Music** page too, along with a full player." },
                { name: "✨ Good to know", value: "The now-playing card updates live and has buttons for pause, skip, loop, shuffle, volume and queue. Premium-only SoundCloud tracks can't be played. The bot leaves a few minutes after the queue ends or everyone leaves." }
            ],
            footer: { text: "Powered by SoundCloud" }
        }],
        allowed_mentions: { parse: [] }
    };
}

/** The link that adds the bot to a server: the bot and slash-command scopes with every permission the features need. */
export const botInviteUrl = clientId => `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&scope=bot%20applications.commands&permissions=${BOT_PERMISSIONS}`;

/** The shape of a typical gaming community. Names are the lookup keys, so running setup twice never duplicates anything. */
export const TEMPLATE = {
    roles: [
        { key: "mod", name: "Moderator", color: 0x3498db, hoist: true, mentionable: true, permissions: [PERM.kick, PERM.ban, PERM.manageMessages, PERM.moderate, PERM.moveMembers, PERM.muteMembers, PERM.deafenMembers, PERM.manageNicknames, PERM.viewAuditLog] },
        { key: "member", name: "Member", color: 0x2ecc71 },
        { key: "verified", name: "Steam Verified", color: 0x66c0f4 },
        { key: "streamer", name: "Streamer", color: 0x9146ff, hoist: true },
        { key: "regular", name: "Regular", color: 0x1abc9c, level: 5 },
        { key: "veteran", name: "Veteran", color: 0x9b59b6, level: 15 },
        { key: "legend", name: "Legend", color: 0xf1c40f, level: 30 }
    ],
    selfRoles: [
        { name: "PC", emoji: "🖥️" }, { name: "PlayStation", emoji: "🎮" }, { name: "Xbox", emoji: "🟩" }, { name: "Nintendo", emoji: "🔴" },
        { name: "Deal pings", emoji: "💸" }, { name: "Free game pings", emoji: "🎁" }, { name: "Giveaway pings", emoji: "🎉" }, { name: "LFG pings", emoji: "🤝" },
        { name: "Game code pings", emoji: "🔑" }, { name: "Promo drop pings", emoji: "🎟️" }, { name: "Stream pings", emoji: "📺" }, { name: "Playtest pings", emoji: "🧪" }
    ],
    categories: [
        { name: "📢 INFORMATION", channels: [
            { key: "welcome", name: "welcome", topic: "Say hi to new members", readonly: true },
            { key: "rules", name: "rules", topic: "Read these first", readonly: true },
            { key: "announcements", name: "announcements", topic: "News from the staff", readonly: true },
            { key: "roles", name: "roles", topic: "Pick your platforms and pings", readonly: true },
            { key: "verify", name: "verify", topic: "Prove your Steam account and get the Steam Verified role", readonly: true },
            { key: "honeypot", name: HONEYPOT_NAME, topic: HONEYPOT_TOPIC }] },
        { name: "💬 COMMUNITY", channels: [
            { key: "general", name: "general", topic: "Talk about anything" },
            { key: "introductions", name: "introductions", topic: "Tell us who you are and what you play" },
            { key: "leaderboard", name: "leaderboard", topic: "Top members by XP. Updates itself every few hours", readonly: true },
            { key: "memes", name: "memes", topic: "Gaming memes" },
            { key: "clips", name: "clips-and-screenshots", topic: "Your best moments" },
            { key: "offtopic", name: "off-topic", topic: "Everything that is not games" },
            { key: "botcmd", name: "bot-commands", topic: "Run /server rank, /server levels, /server invites and the rest here" }] },
        { name: "🎮 GAMING", channels: [
            { key: "lfg", name: "looking-for-group", topic: "Find people to play with. Try /server lfg post" },
            { key: "gamechat", name: "game-chat", topic: "What are you playing?" },
            { key: "gamenight", name: "game-night", topic: "Plan the next session together" },
            { key: "wishlists", name: "wishlists-and-deals", topic: "Share wishlists and sales. Try /me wishlist import" }] },
        { name: "📺 STREAMS", channels: [
            { key: "live", name: "stream-live", topic: "Streamers post here when they go live. Pick the Stream pings role in #roles to get pinged. Streamers: /server stream live", readonly: true }] },
        { name: "💸 DEALS & GIVEAWAYS", channels: [
            { key: "deals", name: "deal-alerts", topic: "Sales and free games from Steam Value Checker", readonly: true },
            { key: "drops", name: "promo-drops", topic: "Key giveaways from SteelSeries, NVIDIA and others, posted once each and marked when they end", readonly: true },
            { key: "playtests", name: "playtests", topic: "Free playtests, betas and demos, posted once each. Pick the Playtest pings role in #roles to get pinged", readonly: true },
            { key: "codes", name: "game-codes", topic: "Limited-time game codes (SHiFT and more), posted once each and marked when they end", readonly: true },
            { key: "giveaways", name: "giveaways", topic: "Game key giveaways", readonly: true },
            { key: "vouches", name: "vouches", topic: "Winners confirm their keys worked", readonly: true }] },
        { name: "🆘 SUPPORT", channels: [
            { key: "help", name: "get-help", topic: "Need a hand? Open a private ticket with the moderators", readonly: true },
            { key: "bugs", name: "report-a-bug", topic: "Found a problem with the bot? Report it straight to the developer", readonly: true },
            { key: "requests", name: "feature-requests", topic: "Ideas for the bot, with their status. Suggest and vote on the dashboard", forum: true }] },
        { name: "🔊 VOICE", voice: [{ key: "lobby", name: "Lobby" }, { key: "v1", name: "Gaming 1" }, { key: "v2", name: "Gaming 2" }, { key: "v3", name: "Gaming 3" }, { key: "chill", name: "Chill" }, { key: "afk", name: "AFK" }] },
        { name: "🎵 MUSIC", channels: [
            { key: "musiccmd", name: "music-commands", topic: "Run /play and the other music commands here. Join a Music voice channel first. SoundCloud songs and playlists" }],
            voice: [{ key: "music1", name: "Music 1" }, { key: "music2", name: "Music 2" }] },
        { name: "🛠️ STAFF", staff: true, channels: [
            { key: "staffchat", name: "staff-chat", topic: "Moderators only" },
            { key: "modlog", name: "mod-log", topic: "Every warning, timeout, kick, ban and message cleanup" },
            { key: "memberlog", name: "member-log", topic: "Joins, leaves and who invited whom" },
            { key: "tickets", name: "support-tickets", topic: "Member help tickets" },
            { key: "botlogs", name: "bot-logs", topic: "Bot notices" }] }
    ],
    rules: [
        "**1. Be decent to people.** No harassment, hate speech, slurs or personal attacks. You can disagree without being cruel.",
        "**2. Keep it clean.** No NSFW, gore or shock content anywhere. Put spoilers behind spoiler tags.",
        "**3. No spam or self-promo.** No flooding, mass pings, random ads, or invite links unless a mod says it's fine.",
        "**4. No cheating, cracked games or key trading.** Giveaway keys only come from the bot. Don't buy, sell or swap keys here.",
        "**5. Use the right channel.** Memes go in #memes, group requests in #looking-for-group, and bot commands in #bot-commands.",
        "**6. Look after your privacy.** Never share passwords, Steam logins or anyone else's personal info.",
        "**7. Follow Discord's Terms and Community Guidelines.** You need to be 13 or older.",
        "**8. Listen to the mods.** Their call is final. If you think they got one wrong, open a ticket in #get-help."
    ]
};

/** The post in #rules: the server's rules (or the standard set) with the bot's logo and banner. `base` is the dashboard address the images are served from. */
export function rulesPayload({ server = "the server", base = null, rules = null, helpChannel = null } = {}) {
    const list = (rules && String(rules).trim()) || TEMPLATE.rules.join("\n\n");
    const root = base ? String(base).replace(/\/$/, "") : null;
    return {
        embeds: [{
            color: 0xed4245, title: `${server} · Server Rules`,
            description: `Read these before you jump in.\n\n${list}`.slice(0, 4000),
            fields: [
                { name: "⚠️ What happens if you break them", value: "Warning → timeout → kick → ban. Serious breaks can skip straight to a ban.", inline: false },
                { name: "🆘 Need help?", value: `Open a ticket in ${helpChannel ? `<#${helpChannel}>` : "#get-help"}`, inline: true },
                { name: "✅ Next step", value: "Press **Verify** in the verify channel and pick your roles.", inline: true }
            ],
            footer: { text: "By staying here you agree to these rules · Steam Value Checker", ...(root ? { icon_url: `${root}/logo.png` } : {}) },
            ...(root ? { thumbnail: { url: `${root}/logo.png` }, image: { url: `${root}/banner.png` } } : {})
        }]
    };
}

/** Posts in #get-help and #report-a-bug: one button each that opens the form. */
export const helpPanel = () => ({
    embeds: [{ color: 0x57f287, title: "Need help?", description: "Press the button to open a **private ticket**. Only you and the mods can see it, and replies land in your DMs.\n\nUse it for giveaway key problems, reporting a member, or any question about the server." }],
    components: [{ type: 1, components: [{ type: 2, style: 3, label: "Open a ticket", emoji: { name: "🎫" }, custom_id: "tk_open:0" }] }]
});
export const bugPanel = () => ({
    embeds: [{ color: 0xfaa61a, title: "Found a bug?", description: "Press the button and tell me what went wrong with the bot. It goes straight to the developer (that's me). `/bot bug` works anywhere too." }],
    components: [{ type: 1, components: [{ type: 2, style: 4, label: "Report a bug", emoji: { name: "🐞" }, custom_id: "tk_bug" }] }]
});

export const VERIFY_ID = "sv_verify";
/** The post in #verify: one button that checks the member's Steam sign-in and gives the role. */
export function verifyPanel(roleId) {
    return {
        embeds: [{ color: 0x66c0f4, title: "Verify your Steam account", description: [`Prove your Steam account and get the <@&${roleId}> role.`, "",
            "1. Press **Verify with Steam**. You sign in on Steam's own page. The bot never sees your password.", "2. Come back and press the button again if it asks you to.", "",
            "You can also connect it to your Discord profile (Linked Roles), so servers can see your Steam on your profile."].join("\n") }],
        components: [{ type: 1, components: [{ type: 2, style: 1, label: "Verify with Steam", custom_id: VERIFY_ID }] }]
    };
}

const sleepDefault = ms => new Promise(r => setTimeout(r, ms));

/** A server the bot has only just been added to: nothing but Discord's default channels, no custom roles, few members. */
export function isFreshGuild({ channels = [], roles = [], memberCount = 0 }) {
    const real = channels.filter(c => c.type !== 4);
    const defaultNames = new Set(["general", "General"]);
    const onlyDefaults = real.length <= 2 && real.every(c => (c.type === 0 || c.type === 2) && defaultNames.has(c.name));
    const custom = roles.filter(r => r.id !== r.guild_id && !r.managed && r.name !== "@everyone");
    return onlyDefaults && custom.length === 0 && memberCount <= 10;
}

function say(api, channelId, payload) { return api.sendMessage(channelId, { allowed_mentions: { parse: [] }, ...payload }).catch(() => null); }

/** Buttons for the self-assign roles panel. Up to 25 roles. */
export function rolePanel(selfRoles) {
    const rows = [];
    for (let i = 0; i < selfRoles.length && rows.length < 5; i += 5) {
        rows.push({ type: 1, components: selfRoles.slice(i, i + 5).map(r => ({ type: 2, style: 2, label: r.label.slice(0, 80), ...(r.emoji ? { emoji: { name: r.emoji } } : {}), custom_id: `rr:${r.role_id}` })) });
    }
    return {
        embeds: [{ color: 0x5865f2, title: "Pick your roles", description: "Press a button to get a role. Press it again to take it off.\n\n" + selfRoles.map(r => `${r.emoji ?? "•"} **${r.label}**`).join("\n") }],
        components: rows
    };
}

/**
 * Builds the whole community: roles, categories, channels, the welcome and rules posts, the role panel, and connects the bot's own features
 * (alerts, free-games feed, support tickets, vouches, game night, welcome, XP). Safe to run again: anything that exists by name is reused.
 * `api` is the Discord REST helper (dashboard/discord.js). A 403 means a missing permission and is reported as a user-facing error.
 * With fresh = true the default #general and General voice channel are moved into the new layout and the empty default categories are removed.
 */
export async function communitySetup({ api, db, guildId, botId, userId = null, fresh = false, baseUrl = null, sleep = sleepDefault, pace = 300 }) {
    const created = { roles: [], channels: [], categories: [] }, notes = [];
    const wait = () => sleep(pace);
    const guard = async (fn, step = "do that") => {
        try { return await fn(); }
        catch (e) {
            if (e?.status === 403) throw Object.assign(new Error(`I could not ${step}. Discord said: ${e.detail ?? "forbidden"}. I need the Manage Channels and Manage Roles permissions, and my role has to sit above the roles I manage. Fix that in Server Settings, or use the invite link from the dashboard, then run this again.`), { userFacing: true });
            throw e;
        }
    };
    // Say exactly which permission is missing before anything is built, rather than failing half way.
    if (botId) {
        try {
            const [me, roles] = await Promise.all([api.getMember(guildId, botId), api.allRoles(guildId)]);
            if (me) {
                const mine = roles.filter(r => r.id === guildId || (me.roles ?? []).includes(r.id));
                const have = mine.reduce((a, r) => a | BigInt(r.permissions ?? 0), 0n);
                if (!(have & B(3))) { // Administrator covers everything
                    const need = [[B(4), "Manage Channels"], [B(28), "Manage Roles"]].filter(([bit]) => !(have & bit)).map(([, n]) => n);
                    if (need.length) throw Object.assign(new Error(`My role in this server is missing: ${need.join(" and ")}. I can see my roles here: ${mine.map(r => r.name).join(", ") || "none"}. Give the permission to my role in Server Settings → Roles (the one with the bot tag), then run this again.`), { userFacing: true });
                }
            }
        } catch (e) { if (e?.userFacing) throw e; /* could not check: carry on and let the real calls say */ }
    }
    const existingChannels = await guard(() => api.allChannels(guildId), "read this server's channels");
    const existingRoles = await guard(() => api.allRoles(guildId), "read this server's roles");
    // Running setup again on a server that was already built only adds what is new in the template. Channels and roles that exist, were renamed,
    // moved or deleted, and every setting the owner changed, are left exactly as they are, and nothing is posted a second time.
    const prev = db.getCommunity(guildId);
    if (prev.setup_at) return await communityUpdate({ api, db, guildId, botId, userId, baseUrl, prev, existingChannels, existingRoles, guard, wait, notes, created });
    const roleByName = n => existingRoles.find(r => r.name.toLowerCase() === n.toLowerCase() && !r.managed);
    const everyone = existingRoles.find(r => r.id === guildId)?.id ?? guildId;

    // ---- roles ----
    const roleIds = {};
    for (const r of TEMPLATE.roles) {
        let ex = roleByName(r.name);
        if (!ex) {
            const make = permissions => api.createRole(guildId, { name: r.name, color: r.color, hoist: Boolean(r.hoist), mentionable: Boolean(r.mentionable), permissions });
            const perms = str((r.permissions ?? []).reduce((a, b) => a | b, 0n));
            // Discord refuses a role that grants permissions the bot does not hold itself. Make the role without them rather than stopping.
            try { ex = await make(perms); }
            catch (e) {
                if (e?.status !== 403 || perms === "0") await guard(() => Promise.reject(e), `create the ${r.name} role`); // turns a 403 into the friendly message, rethrows anything else
                ex = await guard(() => make("0"), `create the ${r.name} role`);
                notes.push(`The ${r.name} role was made without its permissions, because my own role does not hold them. Add the permissions to it by hand, or re-invite me with the dashboard link and run setup again.`);
            }
            created.roles.push(r.name); await wait();
        }
        roleIds[r.key] = ex.id;
    }
    const selfRoles = [];
    for (const r of TEMPLATE.selfRoles) {
        let ex = roleByName(r.name);
        if (!ex) { ex = await guard(() => api.createRole(guildId, { name: r.name, mentionable: true, permissions: "0" }), `create the ${r.name} role`); created.roles.push(r.name); await wait(); }
        selfRoles.push({ role_id: ex.id, label: r.name, emoji: r.emoji });
    }

    // ---- channels ----
    const overwrites = (kind) => {
        const bot = { id: botId, type: 1, allow: str(PERM.viewChannel | PERM.sendMessages | PERM.manageMessages | PERM.createInvite | B(14)), deny: "0" };
        const mod = { id: roleIds.mod, type: 0, allow: str(PERM.viewChannel | PERM.sendMessages | PERM.manageMessages), deny: "0" };
        if (kind === "forum") return [{ id: everyone, type: 0, allow: "0", deny: str(PERM.createThreads) }, bot, mod]; // members read and reply; the bot makes the posts
        if (kind === "readonly") return [{ id: everyone, type: 0, allow: "0", deny: str(PERM.sendMessages | PERM.createThreads | PERM.createPrivateThreads) }, bot, mod];
        if (kind === "staff") return [{ id: everyone, type: 0, allow: "0", deny: str(PERM.viewChannel) }, bot, mod, ...(userId ? [{ id: userId, type: 1, allow: str(PERM.viewChannel | PERM.sendMessages), deny: "0" }] : [])];
        return [];
    };
    const chIds = {};
    const find = (name, type, parent) => existingChannels.find(c => c.type === type && c.name.toLowerCase() === name.toLowerCase() && (parent === undefined || c.parent_id === parent));
    const defaultText = fresh ? existingChannels.find(c => c.type === 0 && c.name === "general") : null;
    const defaultVoice = fresh ? existingChannels.find(c => c.type === 2 && c.name === "General") : null;
    const defaultCats = fresh ? existingChannels.filter(c => c.type === 4 && ["Text Channels", "Voice Channels"].includes(c.name)) : [];

    for (const cat of TEMPLATE.categories) {
        let catCh = existingChannels.find(c => c.type === 4 && c.name.toLowerCase() === cat.name.toLowerCase());
        if (!catCh) {
            catCh = await guard(() => api.createChannel(guildId, { name: cat.name, type: 4, ...(cat.staff ? { permission_overwrites: overwrites("staff") } : {}) }), `create the ${cat.name} category`);
            created.categories.push(cat.name); await wait();
        }
        for (const c of cat.channels ?? []) {
            let ex;
            if (c.key === "general" && defaultText) { // the default #general becomes ours
                ex = await guard(() => api.editChannel(defaultText.id, { parent_id: catCh.id, topic: c.topic }), `move #${defaultText.name ?? "general"}`); await wait();
            } else ex = c.forum ? (find(c.name, 15, catCh.id) ?? find(c.name, 15)) : (find(c.name, 0, catCh.id) ?? find(c.name, 0));
            if (!ex && c.forum) {
                // A forum channel: each feature request is a post, tagged with its status. If the server cannot have forums (not a Community server) it is skipped.
                ex = await api.createChannel(guildId, { name: c.name, type: 15, parent_id: catCh.id, topic: c.topic, available_tags: forumTags(), default_reaction_emoji: { emoji_name: "👍" }, permission_overwrites: overwrites("forum") })
                    .catch(e => { if (e?.status === 403) throw e; notes.push("Could not create the #feature-requests forum (forums need the server's Community features turned on)."); return null; });
                if (ex) { created.channels.push(c.name); await wait(); }
            }
            if (c.forum) { if (ex) chIds[c.key] = ex.id; continue; }
            if (!ex) {
                ex = await guard(() => api.createChannel(guildId, { name: c.name, type: 0, parent_id: catCh.id, topic: c.topic, permission_overwrites: overwrites(cat.staff ? "staff" : c.readonly ? "readonly" : "open") }), `create #${c.name}`);
                created.channels.push(c.name); await wait();
            }
            chIds[c.key] = ex.id;
        }
        for (const v of cat.voice ?? []) {
            let ex;
            if (v.key === "lobby" && defaultVoice) { ex = await guard(() => api.editChannel(defaultVoice.id, { name: v.name, parent_id: catCh.id }), `move the ${v.name} voice channel`); await wait(); }
            else ex = find(v.name, 2, catCh.id) ?? find(v.name, 2);
            if (!ex) { ex = await guard(() => api.createChannel(guildId, { name: v.name, type: 2, parent_id: catCh.id }), `create the ${v.name} voice channel`); created.channels.push(v.name); await wait(); }
            chIds[v.key] = ex.id;
        }
    }
    // The default categories are only removed in a fresh server, and only once nothing is left inside them.
    for (const dc of defaultCats) {
        const stillUsed = existingChannels.some(c => c.parent_id === dc.id && c.id !== defaultText?.id && c.id !== defaultVoice?.id);
        if (!stillUsed) await api.deleteChannel(dc.id).catch(() => {});
    }

    // ---- connect the bot's own features ----
    db.setGuildChannel(guildId, chIds.deals, userId ?? botId); db.setFreeFeed(guildId, true);
    db.setGameNight(guildId, true);
    db.setWeeklyDigest?.(guildId, true); db.setSaleFeed?.(guildId, true); // the Friday round-up and "a Steam sale just started" posts
    if (!db.getGiveawaySettings(guildId).manager_role_id) db.setGiveawaySettings(guildId, { manager_role_id: roleIds.mod }); // moderators can run giveaways
    db.setTicketSettings(guildId, { channelId: chIds.tickets, staffRoleId: roleIds.mod });
    if (chIds.musiccmd && !db.getMusicSettings(guildId).channel_id) db.setMusicSettings(guildId, { channel_id: chIds.musiccmd }); // now-playing messages land in #music
    if (chIds.music1 && created.channels.includes("Music 1") ) db.setMusicSettings(guildId, { stay: 1, home_channel_id: chIds.music1 }); // the bot waits in Music 1 and wakes when someone joins
    db.setGiveawaySettings(guildId, { vouch_channel_id: chIds.vouches, giveaway_channel_id: db.getGiveawaySettings(guildId).giveaway_channel_id ?? chIds.giveaways });
    const pingOf = n => selfRoles.find(r => r.label === n)?.role_id ?? null;
    db.setCommunity(guildId, { ping_deals: pingOf("Deal pings"), ping_free: pingOf("Free game pings"), ping_giveaway: pingOf("Giveaway pings"), ping_lfg: pingOf("LFG pings"), ping_codes: pingOf("Game code pings"), ping_playtest: pingOf("Playtest pings"), playtest_channel: chIds.playtests ?? null, playtest_all: chIds.playtests ? 1 : 0, ping_promos: pingOf("Promo drop pings"), ping_stream: pingOf("Stream pings"), streamer_role_id: roleIds.streamer, live_channel: chIds.live ?? null });
    db.setCommunity(guildId, { verified_role_id: roleIds.verified, welcome_channel: chIds.welcome, log_channel: chIds.memberlog, mod_log_channel: chIds.modlog, announce_channel: chIds.announcements, lb_channel: chIds.leaderboard, meme_channel: chIds.memes ?? db.getCommunity(guildId).meme_channel, honeypot_channel: chIds.honeypot ?? db.getCommunity(guildId).honeypot_channel ?? null, requests_channel: chIds.requests ?? db.getCommunity(guildId).requests_channel ?? null, rules_channel: chIds.rules, autorole_id: roleIds.member, member_role_id: roleIds.member, mod_role_id: roleIds.mod, welcome_on: 1, welcome_dm: 1, xp_on: 1, setup_at: Date.now() });
    for (const r of TEMPLATE.roles.filter(x => x.level)) db.setLevelRole(guildId, r.level, roleIds[r.key]);
    for (const r of selfRoles) db.addSelfRole(guildId, r.role_id, r.label);
    db.setReward(guildId, 5, roleIds.regular); // a first referral reward, change or remove it any time

    // ---- the posts ----
    const guild = await api.getGuild(guildId).catch(() => null);
    const gname = guild?.name ?? "the server";
    const rp = rulesPayload({ server: gname, base: baseUrl, rules: db.getCommunity(guildId).rules_text, helpChannel: chIds.help });
    await say(api, chIds.rules, rp);
    await say(api, chIds.help, helpPanel());
    await say(api, chIds.honeypot, honeypotPayload());
    if (chIds.requests) await backfillForum({ db, api, guildId, base: baseUrl }).catch(() => notes.push("Could not fill #feature-requests (check my permissions there)."));
    await say(api, chIds.bugs, bugPanel());
    await say(api, chIds.announcements, { embeds: [{ color: 0x4d8cff, title: "Announcements", description: "News from the staff lands here. Server managers can post announcements from the dashboard.\n\nMessages marked **Official message from the bot developer** come from the person who runs Steam Value Checker, for things like planned downtime." }] });
    await say(api, chIds.roles, rolePanel(selfRoles));
    await say(api, chIds.verify, verifyPanel(roleIds.verified));
    await say(api, chIds.welcome, { embeds: [{ color: 0x57f287, title: `Welcome to ${gname}`, description: `New here? Start with <#${chIds.rules}>, pick your roles in <#${chIds.roles}>, then say hi in <#${chIds.introductions}>.\n\nNew members are greeted in this channel.` }] });
    await refreshLeaderboard({ db, api, guildId, base: baseUrl }).catch(() => notes.push("Could not post the leaderboard (check my permissions in #leaderboard)."));
    await say(api, chIds.botcmd, { content: "Try **/rank** for your level, **/levels** for the leaderboard, **/invites link** to get your own invite link and **/wishlist import** for sale alerts. Right-click a member and open Apps to compare libraries or find games to play together." });
    await say(api, chIds.deals, { content: "Sale alerts and free games land here. Members: use `/me wishlist import` to get your own alerts." });
    if (chIds.playtests) await say(api, chIds.playtests, PLAYTEST_INTRO);
    await say(api, chIds.codes, { content: "New limited-time game codes (Borderlands SHiFT, Genshin, Star Rail, Zenless) are posted here once each. When one ends, its post is greyed out. Managers can pick which games and a role to ping with `/games codes`, or on the dashboard." });
    await say(api, chIds.drops, { content: "Promo drops (key giveaways from SteelSeries, NVIDIA and others) are posted here once each, and greyed out when they end. Managers add one with `/server promos add` or on the dashboard, and can turn on news watching with `/server promos news`." });
    await say(api, chIds.tickets, { content: "Member tickets from `/bot support open` appear here with Reply, Assign me and Resolve buttons." });
    await say(api, chIds.modlog, { content: "Every moderator action is logged here as a numbered case: `/mod warn`, `timeout`, `kick`, `ban`, `unban` and `purge`. Use `/mod cases` to look back." });
    if (chIds.live) await say(api, chIds.live, { content: "When a streamer goes live they use `/server stream live` (or the dashboard's Streams page) and it shows up here. Pick the **Stream pings** role in the roles channel to get pinged." });
    await say(api, chIds.botlogs, { content: `Setup finished. Created ${created.channels.length} channels and ${created.roles.length} roles. Connected: alerts and free games in <#${chIds.deals}>, giveaways in <#${chIds.giveaways}>, tickets in <#${chIds.tickets}> (members open them in <#${chIds.help}>), bug reports in <#${chIds.bugs}>, announcements in <#${chIds.announcements}>, ${chIds.playtests ? `playtests and demos in <#${chIds.playtests}> (with the Playtest pings role), ` : ""}XP leaderboard in <#${chIds.leaderboard}> (refreshes every 5 hours), music in <#${chIds.musiccmd}> (join a Music voice channel and use /play), moderation log in <#${chIds.modlog}>, member log in <#${chIds.memberlog}>. Bot notices land here.` });
    await say(api, chIds.memberlog, { content: "Joins, leaves and which invite each member used are logged here." });

    // ---- server settings (all best effort: a missing permission only skips that part) ----
    if (chIds.afk) await api.editGuild(guildId, { afk_channel_id: chIds.afk, afk_timeout: 900 }).catch(() => notes.push("Could not set the AFK channel (needs Manage Server)."));
    await api.editGuild(guildId, { system_channel_flags: 1 }).catch(() => {}); // stop Discord's own join message, the bot greets instead

    if (chIds.musiccmd && created.channels.includes("music-commands")) await say(api, chIds.musiccmd, musicIntroPayload()); // only in a channel made just now
    if (chIds.codes && !db.getCodeSettings(guildId).channel_id) db.setCodeSettings(guildId, { channel_id: chIds.codes });
    if (chIds.drops && !db.getDropSettings(guildId).channel_id) db.setDropSettings(guildId, { channel_id: chIds.drops });
    db.setCommunity(guildId, { setup_keys: JSON.stringify(Object.keys(chIds)) });
    db.bumpUsage?.(fresh ? "setup_auto" : "setup_manual");
    db.bumpUsage?.("channels_created", created.channels.length);
    return { created, channels: chIds, roles: roleIds, notes };
}

/** Channels added to the template after the first release. A server built before this list existed has every other channel already. */
export const ADDED_LATER = new Set(["requests", "honeypot", "codes", "drops", "musiccmd", "music1", "music2", "live", "playtests"]);
const PLAYTEST_INTRO = { content: "Free playtests, betas and demos are posted here once each, found from Steam announcements and the Alpha Beta Gamer site. Pick the **Playtest pings** role in the roles channel to get pinged. Managers can change the channel, the role, or limit it to games members watch on the dashboard." };
const channelKeys = () => TEMPLATE.categories.flatMap(c => [...(c.channels ?? []), ...(c.voice ?? [])].map(x => x.key));

/** What a second run does: create only the template channels this server has never been given. */
async function communityUpdate({ api, db, guildId, botId, userId, baseUrl, prev, existingChannels, existingRoles, guard, wait, notes, created }) {
    let built;
    try { built = new Set(JSON.parse(prev.setup_keys ?? "null") ?? []); } catch { built = new Set(); }
    if (!prev.setup_keys) for (const k of channelKeys()) if (!ADDED_LATER.has(k)) built.add(k); // built before keys were recorded
    const everyone = existingRoles.find(r => r.id === guildId)?.id ?? guildId;
    const modRole = (prev.mod_role_id && existingRoles.some(r => r.id === prev.mod_role_id) ? prev.mod_role_id : null) ?? existingRoles.find(r => r.name.toLowerCase() === "moderator" && !r.managed)?.id ?? null;
    const bot = { id: botId, type: 1, allow: str(PERM.viewChannel | PERM.sendMessages | PERM.manageMessages | PERM.createInvite | B(14)), deny: "0" };
    const mod = modRole ? [{ id: modRole, type: 0, allow: str(PERM.viewChannel | PERM.sendMessages | PERM.manageMessages), deny: "0" }] : [];
    const overwrites = kind => kind === "forum" ? [{ id: everyone, type: 0, allow: "0", deny: str(PERM.createThreads) }, bot, ...mod]
        : kind === "readonly" ? [{ id: everyone, type: 0, allow: "0", deny: str(PERM.sendMessages | PERM.createThreads | PERM.createPrivateThreads) }, bot, ...mod] : [];
    const chIds = {}, chCats = {};
    for (const cat of TEMPLATE.categories) {
        for (const c of cat.channels ?? []) {
            if (built.has(c.key)) continue;
            const type = c.forum ? 15 : 0;
            let ex = existingChannels.find(x => x.type === type && x.name.toLowerCase() === c.name.toLowerCase());
            if (!ex) {
                let catCh = existingChannels.find(x => x.type === 4 && x.name.toLowerCase() === cat.name.toLowerCase());
                if (!catCh) { catCh = await guard(() => api.createChannel(guildId, { name: cat.name, type: 4, ...(cat.staff ? { permission_overwrites: [{ id: everyone, type: 0, allow: "0", deny: str(PERM.viewChannel) }, bot, ...mod] } : {}) }), `create the ${cat.name} category`); created.categories.push(cat.name); existingChannels.push({ ...catCh, type: 4, name: cat.name }); await wait(); }
                const body = c.forum
                    ? { name: c.name, type: 15, parent_id: catCh.id, topic: c.topic, available_tags: forumTags(), default_reaction_emoji: { emoji_name: "👍" }, permission_overwrites: overwrites("forum") }
                    : { name: c.name, type: 0, parent_id: catCh.id, topic: c.topic, ...(c.readonly && c.key === "live" ? { permission_overwrites: overwrites("readonly") } : {}) };
                ex = await api.createChannel(guildId, body).catch(e => {
                    if (e?.status === 403) throw Object.assign(new Error(`I could not create #${c.name}. I need the Manage Channels permission.`), { userFacing: true });
                    notes.push(c.forum ? "Could not create the #feature-requests forum (forums need the server's Community features turned on)." : `Could not create #${c.name}.`); return null;
                });
                if (!ex) continue;
                created.channels.push(c.name); await wait();
            }
            chIds[c.key] = ex.id;
        }
    }
    // voice channels that were added later (the music rooms): created under their category, matched by name so nothing is doubled
    for (const cat of TEMPLATE.categories) {
        for (const v of cat.voice ?? []) {
            if (built.has(v.key) || !ADDED_LATER.has(v.key)) continue;
            let ex = existingChannels.find(x => x.type === 2 && x.name.toLowerCase() === v.name.toLowerCase());
            if (!ex) {
                const catCh = existingChannels.find(x => x.type === 4 && x.name.toLowerCase() === cat.name.toLowerCase()) ?? chCats[cat.name];
                const parent = catCh ?? await guard(() => api.createChannel(guildId, { name: cat.name, type: 4 }), `create the ${cat.name} category`);
                if (parent) chCats[cat.name] = parent;
                ex = await guard(() => api.createChannel(guildId, { name: v.name, type: 2, parent_id: parent?.id }), `create the ${v.name} voice channel`);
                if (!ex) continue;
                created.channels.push(v.name); await wait();
            }
            chIds[v.key] = ex.id;
        }
    }
    // connect only what is new, and only where nothing is chosen yet
    if (chIds.honeypot) {
        if (!db.getCommunity(guildId).honeypot_channel) db.setCommunity(guildId, { honeypot_channel: chIds.honeypot });
        if (created.channels.includes(HONEYPOT_NAME)) await say(api, chIds.honeypot, honeypotPayload()); // only in a channel made just now
    }
    if (chIds.musiccmd && !db.getMusicSettings(guildId).channel_id) db.setMusicSettings(guildId, { channel_id: chIds.musiccmd });
    if (chIds.music1 && created.channels.includes("Music 1") ) db.setMusicSettings(guildId, { stay: 1, home_channel_id: chIds.music1 }); // the bot waits in Music 1 and wakes when someone joins
    if (chIds.musiccmd && created.channels.includes("music-commands")) await say(api, chIds.musiccmd, musicIntroPayload());
    if (chIds.codes && !db.getCodeSettings(guildId).channel_id) db.setCodeSettings(guildId, { channel_id: chIds.codes });
    if (chIds.codes && created.channels.includes("game-codes")) await say(api, chIds.codes, { content: "New limited-time game codes (Borderlands SHiFT, Genshin, Star Rail, Zenless) are posted here once each. When one ends, its post is greyed out. Managers can pick which games and a role to ping with `/games codes`, or on the dashboard." });
    if (chIds.drops && !db.getDropSettings(guildId).channel_id) db.setDropSettings(guildId, { channel_id: chIds.drops });
    if (chIds.drops && created.channels.includes("promo-drops")) await say(api, chIds.drops, { content: "Promo drops (key giveaways from SteelSeries, NVIDIA and others) are posted here once each, and greyed out when they end. Managers add one with `/server promos add` or on the dashboard, and can turn on news watching with `/server promos news`." });
    if (chIds.requests && !db.getCommunity(guildId).requests_channel) db.setCommunity(guildId, { requests_channel: chIds.requests });
    if (chIds.requests) await backfillForum({ db, api, guildId, base: baseUrl }).catch(() => notes.push("Could not fill #feature-requests (check my permissions there)."));
    // the streamer role, for servers that were set up before it existed
    if (!prev.streamer_role_id) {
        let sr = existingRoles.find(x => x.name.toLowerCase() === "streamer" && !x.managed);
        if (!sr) {
            const def = TEMPLATE.roles.find(x => x.key === "streamer");
            sr = await api.createRole(guildId, { name: def.name, color: def.color, hoist: true, mentionable: false, permissions: "0" }).catch(() => { notes.push("Could not create the Streamer role (I need Manage Roles)."); return null; });
            if (sr) { created.roles.push(def.name); await wait(); }
        }
        if (sr) db.setCommunity(guildId, { streamer_role_id: sr.id });
    }
    if (chIds.playtests && !db.getCommunity(guildId).playtest_channel) db.setCommunity(guildId, { playtest_channel: chIds.playtests, ...(created.channels.includes("playtests") ? { playtest_all: 1 } : {}) });
    if (chIds.playtests && created.channels.includes("playtests")) await say(api, chIds.playtests, PLAYTEST_INTRO);
    if (chIds.live && !db.getCommunity(guildId).live_channel) db.setCommunity(guildId, { live_channel: chIds.live });
    if (chIds.live && created.channels.includes("stream-live")) await say(api, chIds.live, { content: "When a streamer goes live they use `/server stream live` (or the dashboard's Streams page) and it shows up here. Pick the **Stream pings** role in the roles channel to get pinged." });
    // the opt-in ping roles for codes and promos (and streams), for servers that were set up before they existed
    const newPings = TEMPLATE.selfRoles.filter(r => ["Game code pings", "Promo drop pings", "Stream pings", "Playtest pings"].includes(r.name));
    const madeRoles = [];
    for (const r of newPings) {
        let ex = existingRoles.find(x => x.name.toLowerCase() === r.name.toLowerCase() && !x.managed);
        if (!ex) {
            ex = await api.createRole(guildId, { name: r.name, mentionable: true, permissions: "0" }).catch(() => { notes.push(`Could not create the ${r.name} role (I need Manage Roles).`); return null; });
            if (!ex) continue;
            created.roles.push(r.name); madeRoles.push(r); await wait();
        }
        db.addSelfRole(guildId, ex.id, r.name);
        const col = r.name === "Game code pings" ? "ping_codes" : r.name === "Stream pings" ? "ping_stream" : r.name === "Playtest pings" ? "ping_playtest" : "ping_promos";
        if (!db.getCommunity(guildId)[col]) db.setCommunity(guildId, { [col]: ex.id });
    }
    if (madeRoles.length) {
        const rolesCh = existingChannels.find(x => x.type === 0 && x.name.toLowerCase() === "roles");
        if (rolesCh) await say(api, rolesCh.id, rolePanel(db.listSelfRoles(guildId).map(r => ({ role_id: r.role_id, label: r.label, emoji: TEMPLATE.selfRoles.find(x => x.name === r.label)?.emoji })))).catch(() => {});
    }
    db.setCommunity(guildId, { setup_keys: JSON.stringify([...new Set([...built, ...Object.keys(chIds)])]) });
    db.bumpUsage?.("setup_update");
    if (!created.channels.length && !notes.length) notes.push("Everything in the template is already there. I did not change anything.");
    return { created, channels: chIds, roles: {}, notes, updated: true };
}

// ---------- welcome messages ----------
/** The private message a new member gets: what the bot does for them and where the dashboard is. */
export function welcomeDmPayload({ server, dashboardUrl = null }) {
    const embed = {
        color: 0x4d8cff, title: `Welcome to ${server} 👋`,
        description: "I'm **Steam Value Checker**. I handle the game deals and a few other things around here. Here's what I can do for you:",
        fields: [
            { name: "💸 Sale alerts", value: "Run `/me wishlist import` and I'll message you when something on your Steam wishlist drops in price. `/games value` prices any list of games." },
            { name: "🎁 Free games", value: "`/games freegames` shows what you can grab for free right now on Steam, Epic, GOG and more." },
            { name: "🎮 Your library", value: "Sign in with Steam on the dashboard to see what your library is worth, your hours, and what to play next." },
            { name: "🏆 In this server", value: "You earn XP and levels by chatting and hanging out in voice (`/server rank`, `/server levels`). Grab your own invite link with `/server invites link`, and verify your Steam account in #verify for the Steam Verified role." },
            { name: "🧪 Playtests and demos", value: "Free playtests, betas and demos are posted in the playtests channel. Pick the **Playtest pings** role in the roles channel to get pinged, or run `/alerts playtests` to get them by DM for your wishlist games (or every one)." },
            { name: "🤝 Play together", value: "Turn on `/alerts share` and the server can see which games you own. Then right-click a member and open Apps for **Compare libraries**, **Play together** or **Gift ideas**, or right-click a game title in chat for **Who owns this?**" },
            { name: "🎵 Music", value: "Join a Music voice channel and run `/play` with a SoundCloud song or playlist link in #music-commands. `/music` has the rest: queue, skip, loop and saved playlists." },
            { name: "🔔 Control it", value: "`/alerts` lets you set quiet hours and pick how I notify you. `/help` lists every command, and `/me mydata delete` wipes your data whenever you want." }
        ],
        footer: { text: "You're getting this because you joined a server that uses me. I don't read replies here." }
    };
    const components = dashboardUrl ? [{ type: 1, components: [{ type: 2, style: 5, label: "Open the dashboard", url: dashboardUrl }] }] : [];
    return { embeds: [embed], components, allowed_mentions: { parse: [] } };
}

export const DEFAULT_WELCOME = "Welcome to **{server}**, {user}! You are member #{count}. Check out the rules and pick your roles, then say hi!";
export const WELCOME_FIELDS = ["{user}", "{username}", "{server}", "{count}", "{inviter}"];

export function renderWelcome(template, { userId, username, server, count, inviterId = null }) {
    const t = String(template || DEFAULT_WELCOME).slice(0, 1000);
    return t.replaceAll("{user}", `<@${userId}>`).replaceAll("{username}", String(username).replace(/[@`*_~|>]/g, "")).replaceAll("{server}", String(server).replace(/[@`]/g, ""))
        .replaceAll("{count}", String(count)).replaceAll("{inviter}", inviterId ? `<@${inviterId}>` : "someone");
}

export function welcomePayload({ settings, userId, username, avatarUrl, server, count, inviterId, card = false }) {
    const text = renderWelcome(settings.welcome_msg, { userId, username, server, count, inviterId });
    return {
        embeds: [{ color: 0x57f287, title: `Welcome, ${String(username).slice(0, 60)}!`, description: text, ...(card ? { image: { url: "attachment://welcome.png" } } : avatarUrl ? { thumbnail: { url: avatarUrl } } : {}), footer: { text: `Member #${count}` },
            ...(inviterId ? { fields: [{ name: "Invited by", value: `<@${inviterId}>`, inline: true }] } : {}) }],
        allowed_mentions: { parse: [], users: [userId, ...(inviterId ? [inviterId] : [])] }
    };
}

// ---------- invites ----------
/**
 * Which invite did a new member use? `before` is the cached Map(code -> { uses, maxUses, inviterId }), `after` the invites now
 * ([{ code, uses, maxUses, inviterId }]). Returns the invite whose use count went up, or one that vanished on its last use.
 * null when it cannot be told (two joins at once, a vanity URL).
 */
export function findUsedInvite(before, after) {
    const up = after.filter(i => i.uses > (before.get(i.code)?.uses ?? 0));
    if (up.length === 1) return up[0];
    if (up.length > 1) return null;
    const gone = [...before.entries()].filter(([code]) => !after.some(i => i.code === code));
    if (gone.length === 1) { const [code, m] = gone[0]; if (m.maxUses && m.uses + 1 >= m.maxUses) return { code, inviterId: m.inviterId, uses: m.uses + 1, maxUses: m.maxUses }; }
    return null;
}

// ---------- XP ----------
export const XP_COOLDOWN_MS = 60_000;
export const VOICE_XP = 5;
/** XP for one chat message: 15 to 25, times the server's multiplier. */
export const messageXp = (mult = 1, rng = Math.random) => Math.max(1, Math.round((15 + Math.floor(rng() * 11)) * Math.min(5, Math.max(0.1, mult))));

/** Which level roles a member should have at this level. */
export const rolesForLevel = (levelRoles, level) => levelRoles.filter(r => r.level <= level);

/** A 10-step progress bar for XP inside a level. */
export function bar(into, need, width = 12) {
    const filled = Math.max(0, Math.min(width, Math.round((into / need) * width)));
    return "▰".repeat(filled) + "▱".repeat(width - filled);
}

// ---------- emoji import ----------
const EMOJI_RE = /<(a?):([A-Za-z0-9_]{2,32}):(\d{15,25})>/g;
const CDN_RE = /https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/emojis\/(\d{15,25})\.(png|gif|webp|jpg|jpeg)(?:\?[^\s<>]*)?/gi;
// Any other https picture link: ends in an image extension, with an optional query.
const IMG_LINK_RE = /https:\/\/[^\s<>"'|]+?\.(png|gif|webp|jpe?g)(?:\?[^\s<>"'|]*)?(?=[\s<>"'|]|$)/gi;
export const EMOJI_MAX_BYTES = 256 * 1024;
export const EMOJI_BATCH = 20;

const cleanName = raw => String(raw).replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+|_+$/g, "").slice(0, 32).padEnd(2, "_");

/**
 * Pulls emoji out of pasted text: `<:name:id>`, `<a:name:id>`, Discord emoji links, or a link to any picture on the web.
 * Returns [{ name, id?, animated, url }]. A Discord link counts as animated when it ends in .gif or says animated=true
 * (Discord's "Copy link" gives `.webp?animated=true` for those), and then the GIF is fetched so the movement is kept.
 */
export function parseEmojis(text) {
    const out = [], seen = new Set();
    const add = (name, id, animated) => { if (seen.has(id)) return; seen.add(id); out.push({ name: cleanName(name), id, animated, url: `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "png"}?size=128` }); };
    const s = String(text ?? "");
    for (const m of s.matchAll(EMOJI_RE)) add(m[2], m[3], m[1] === "a");
    const taken = [];
    for (const m of s.matchAll(CDN_RE)) { taken.push(m[0]); add(`emoji_${m[1].slice(-6)}`, m[1], m[2].toLowerCase() === "gif" || /[?&]animated=true\b/i.test(m[0])); }
    for (const m of s.matchAll(IMG_LINK_RE)) {
        if (taken.includes(m[0])) continue;
        let u; try { u = new URL(m[0]); } catch { continue; }
        const file = decodeURIComponent(u.pathname.split("/").pop() ?? "").replace(/\.[^.]+$/, "").replace(/^\d+-/, "");
        const key = u.origin + u.pathname;
        if (seen.has(key)) continue; seen.add(key);
        out.push({ name: cleanName(file || "emoji"), animated: m[1].toLowerCase() === "gif", url: u.toString() });
    }
    return out.slice(0, EMOJI_BATCH);
}

/** Discord's own CDN and emoji.gg's are fetched directly; anything else goes through the guarded downloader. */
export const isDiscordCdn = url => { try { const u = new URL(url); return u.protocol === "https:" && ["cdn.discordapp.com", "media.discordapp.net"].includes(u.hostname); } catch { return false; } };
const isTrusted = url => isDiscordCdn(url) || isEmojiGgCdn(url);

async function download(url, { fetchImpl, safeFetch }) {
    if (!isTrusted(url)) return safeFetch(url, { maxBytes: EMOJI_MAX_BYTES + 1 });
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = String(res.headers?.get?.("content-type") ?? "image/png").split(";")[0].trim();
    if (!/^image\/(png|gif|jpeg|webp)$/.test(type)) throw new Error("not an image");
    const buf = Buffer.from(await res.arrayBuffer());
    return { buf, type };
}

/**
 * Copies emoji into a server. `items` are { name, url } (from parseEmojis, a pack, or one attached image). Stops asking for a kind
 * (still or animated) once Discord says that kind is full, and stops altogether without the permission.
 * `only` can be "static" or "animated". Returns { added: [names], failed: [{ name, why }], full: { static, animated } }.
 */
export async function importEmojis({ api, guildId, items, fetchImpl = globalThis.fetch, safeFetch = safeFetchImage, sleep = sleepDefault, limit = EMOJI_BATCH, only = null, skipExisting = false }) {
    const added = [], failed = [], full = { static: false, animated: false };
    const taken = new Set((await api.listEmojis(guildId).catch(() => [])).map(e => e.name.toLowerCase()));
    // A pack can be imported in several goes: what the server already has by that name is left alone, so the next go carries on.
    const todo = items.filter(it => !((only === "static" && it.animated) || (only === "animated" && !it.animated)) && !(skipExisting && taken.has(cleanName(it.name).toLowerCase())));
    const skipped = items.length - todo.length;
    for (const it of todo.slice(0, limit)) {
        const kind = it.animated ? "animated" : "static";
        let name = cleanName(it.name);
        if (full[kind]) { failed.push({ name, why: `this server has no free ${kind} emoji slots` }); continue; }
        if (taken.has(name.toLowerCase())) { let n = 2; while (taken.has(`${name.slice(0, 29)}_${n}`.toLowerCase())) n++; name = `${name.slice(0, 29)}_${n}`; }
        try {
            let img = await download(it.url, { fetchImpl, safeFetch });
            if (img.buf.length > EMOJI_MAX_BYTES && /size=\d+/.test(it.url)) img = await download(it.url.replace(/size=\d+/, "size=64"), { fetchImpl, safeFetch });
            if (img.buf.length > EMOJI_MAX_BYTES) throw new Error("larger than 256 KB");
            await api.createEmoji(guildId, { name, image: `data:${img.type};base64,${img.buf.toString("base64")}` });
            taken.add(name.toLowerCase()); added.push(name); await sleep(400);
        } catch (e) {
            const slots = e?.status === 400 && /maximum number of (animated )?emojis/i.test(String(e?.message ?? e?.detail ?? ""));
            if (slots) full[/animated/i.test(String(e?.message ?? e?.detail ?? "")) ? "animated" : kind] = true;
            const why = e?.status === 403 ? "I need the Manage Expressions permission" : e?.status === 400 ? (slots ? `this server has no free ${kind} emoji slots` : "Discord refused it (the name or the picture isn't allowed)") : e?.message ?? "failed";
            failed.push({ name, why });
            if (e?.status === 403) break;
        }
    }
    return { added, failed, full, skipped, remaining: Math.max(0, todo.length - limit) };
}

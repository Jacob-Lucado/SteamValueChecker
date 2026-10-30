// Community features that do not need discord.js, so the dashboard and the tests can share them:
// the server template and its builder, welcome messages, invite attribution, XP and emoji import.
import { levelFromXp, xpForNext } from "./communitystore.js";

export { levelFromXp, xpForNext };

const B = n => 1n << BigInt(n);
export const PERM = { createInvite: B(0), kick: B(1), ban: B(2), viewChannel: B(10), sendMessages: B(11), manageMessages: B(13), addReactions: B(6), connect: B(20),
    speak: B(21), muteMembers: B(22), deafenMembers: B(23), moveMembers: B(24), manageNicknames: B(27), viewAuditLog: B(7), createThreads: B(35), createPrivateThreads: B(36), moderate: B(40) };
const str = n => String(n);

/** Permission number for the invite link: what the existing features need plus roles, invites, emojis and events. */
export const BOT_PERMISSIONS = String(B(0) | B(4) | B(5) | B(10) | B(11) | B(14) | B(15) | B(16) | B(18) | B(28) | B(30) | B(33) | B(6) | B(1) | B(2) | B(13) | B(40));

/** The shape of a typical gaming community. Names are the lookup keys, so running setup twice never duplicates anything. */
export const TEMPLATE = {
    roles: [
        { key: "mod", name: "Moderator", color: 0x3498db, hoist: true, mentionable: true, permissions: [PERM.kick, PERM.ban, PERM.manageMessages, PERM.moderate, PERM.moveMembers, PERM.muteMembers, PERM.deafenMembers, PERM.manageNicknames, PERM.viewAuditLog] },
        { key: "member", name: "Member", color: 0x2ecc71 },
        { key: "verified", name: "Steam Verified", color: 0x66c0f4 },
        { key: "regular", name: "Regular", color: 0x1abc9c, level: 5 },
        { key: "veteran", name: "Veteran", color: 0x9b59b6, level: 15 },
        { key: "legend", name: "Legend", color: 0xf1c40f, level: 30 }
    ],
    selfRoles: [
        { name: "PC", emoji: "🖥️" }, { name: "PlayStation", emoji: "🎮" }, { name: "Xbox", emoji: "🟩" }, { name: "Nintendo", emoji: "🔴" },
        { name: "Deal pings", emoji: "💸" }, { name: "Free game pings", emoji: "🎁" }, { name: "Giveaway pings", emoji: "🎉" }, { name: "LFG pings", emoji: "🤝" }
    ],
    categories: [
        { name: "📢 INFORMATION", channels: [
            { key: "welcome", name: "welcome", topic: "Say hi to new members", readonly: true },
            { key: "rules", name: "rules", topic: "Read these first", readonly: true },
            { key: "announcements", name: "announcements", topic: "News from the staff", readonly: true },
            { key: "roles", name: "roles", topic: "Pick your platforms and pings", readonly: true },
            { key: "verify", name: "verify", topic: "Prove your Steam account and get the Steam Verified role", readonly: true }] },
        { name: "💬 COMMUNITY", channels: [
            { key: "general", name: "general", topic: "Talk about anything" },
            { key: "introductions", name: "introductions", topic: "Tell us who you are and what you play" },
            { key: "memes", name: "memes", topic: "Gaming memes" },
            { key: "clips", name: "clips-and-screenshots", topic: "Your best moments" },
            { key: "offtopic", name: "off-topic", topic: "Everything that is not games" },
            { key: "botcmd", name: "bot-commands", topic: "Run /rank, /levels, /invites and the rest here" }] },
        { name: "🎮 GAMING", channels: [
            { key: "lfg", name: "looking-for-group", topic: "Find people to play with. Try /lfg post" },
            { key: "gamechat", name: "game-chat", topic: "What are you playing?" },
            { key: "gamenight", name: "game-night", topic: "Plan the next session together" },
            { key: "wishlists", name: "wishlists-and-deals", topic: "Share wishlists and sales. Try /wishlist import" }] },
        { name: "💸 DEALS & GIVEAWAYS", channels: [
            { key: "deals", name: "deal-alerts", topic: "Sales and free games from Steam Value Checker", readonly: true },
            { key: "giveaways", name: "giveaways", topic: "Game key giveaways", readonly: true },
            { key: "vouches", name: "vouches", topic: "Winners confirm their keys worked", readonly: true }] },
        { name: "🔊 VOICE", voice: [{ key: "lobby", name: "Lobby" }, { key: "v1", name: "Gaming 1" }, { key: "v2", name: "Gaming 2" }, { key: "v3", name: "Gaming 3" }, { key: "chill", name: "Chill" }, { key: "afk", name: "AFK" }] },
        { name: "🛠️ STAFF", staff: true, channels: [
            { key: "staffchat", name: "staff-chat", topic: "Moderators only" },
            { key: "modlog", name: "mod-log", topic: "Every warning, timeout, kick, ban and message cleanup" },
            { key: "memberlog", name: "member-log", topic: "Joins, leaves and who invited whom" },
            { key: "tickets", name: "support-tickets", topic: "Member help tickets" },
            { key: "botlogs", name: "bot-logs", topic: "Bot notices" }] }
    ],
    rules: [
        "**1. Be kind.** No harassment, hate or personal attacks.",
        "**2. Keep it clean.** No NSFW, gore or spam.",
        "**3. No cheating, cracked games or key trading.** Giveaway keys are given out by the bot only.",
        "**4. Use the right channel.** Memes in #memes, group requests in #looking-for-group.",
        "**5. Listen to the moderators.** If something is wrong, tell a moderator."
    ]
};

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
export async function communitySetup({ api, db, guildId, botId, userId = null, fresh = false, sleep = sleepDefault, pace = 300 }) {
    const created = { roles: [], channels: [], categories: [] }, notes = [];
    const wait = () => sleep(pace);
    const guard = async fn => {
        try { return await fn(); }
        catch (e) {
            if (e?.status === 403) throw Object.assign(new Error("I need the Manage Channels and Manage Roles permissions. Give them to my role in Server Settings (or use the invite link from the dashboard, which asks for them), then run this again."), { userFacing: true });
            throw e;
        }
    };
    const existingChannels = await guard(() => api.allChannels(guildId));
    const existingRoles = await guard(() => api.allRoles(guildId));
    const roleByName = n => existingRoles.find(r => r.name.toLowerCase() === n.toLowerCase() && !r.managed);
    const everyone = existingRoles.find(r => r.id === guildId)?.id ?? guildId;

    // ---- roles ----
    const roleIds = {};
    for (const r of TEMPLATE.roles) {
        let ex = roleByName(r.name);
        if (!ex) {
            ex = await guard(() => api.createRole(guildId, { name: r.name, color: r.color, hoist: Boolean(r.hoist), mentionable: Boolean(r.mentionable), permissions: str((r.permissions ?? []).reduce((a, b) => a | b, 0n)) }));
            created.roles.push(r.name); await wait();
        }
        roleIds[r.key] = ex.id;
    }
    const selfRoles = [];
    for (const r of TEMPLATE.selfRoles) {
        let ex = roleByName(r.name);
        if (!ex) { ex = await guard(() => api.createRole(guildId, { name: r.name, mentionable: true, permissions: "0" })); created.roles.push(r.name); await wait(); }
        selfRoles.push({ role_id: ex.id, label: r.name, emoji: r.emoji });
    }

    // ---- channels ----
    const overwrites = (kind) => {
        const bot = { id: botId, type: 1, allow: str(PERM.viewChannel | PERM.sendMessages | PERM.manageMessages | PERM.createInvite | B(14)), deny: "0" };
        const mod = { id: roleIds.mod, type: 0, allow: str(PERM.viewChannel | PERM.sendMessages | PERM.manageMessages), deny: "0" };
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
            catCh = await guard(() => api.createChannel(guildId, { name: cat.name, type: 4, ...(cat.staff ? { permission_overwrites: overwrites("staff") } : {}) }));
            created.categories.push(cat.name); await wait();
        }
        for (const c of cat.channels ?? []) {
            let ex;
            if (c.key === "general" && defaultText) { // the default #general becomes ours
                ex = await guard(() => api.editChannel(defaultText.id, { parent_id: catCh.id, topic: c.topic })); await wait();
            } else ex = find(c.name, 0, catCh.id) ?? find(c.name, 0);
            if (!ex) {
                ex = await guard(() => api.createChannel(guildId, { name: c.name, type: 0, parent_id: catCh.id, topic: c.topic, permission_overwrites: overwrites(cat.staff ? "staff" : c.readonly ? "readonly" : "open") }));
                created.channels.push(c.name); await wait();
            }
            chIds[c.key] = ex.id;
        }
        for (const v of cat.voice ?? []) {
            let ex;
            if (v.key === "lobby" && defaultVoice) { ex = await guard(() => api.editChannel(defaultVoice.id, { name: v.name, parent_id: catCh.id })); await wait(); }
            else ex = find(v.name, 2, catCh.id) ?? find(v.name, 2);
            if (!ex) { ex = await guard(() => api.createChannel(guildId, { name: v.name, type: 2, parent_id: catCh.id })); created.channels.push(v.name); await wait(); }
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
    db.setTicketSettings(guildId, { channelId: chIds.tickets, staffRoleId: roleIds.mod });
    db.setGiveawaySettings(guildId, { vouch_channel_id: chIds.vouches, giveaway_channel_id: db.getGiveawaySettings(guildId).giveaway_channel_id ?? chIds.giveaways });
    db.setCommunity(guildId, { verified_role_id: roleIds.verified, welcome_channel: chIds.welcome, log_channel: chIds.memberlog, mod_log_channel: chIds.modlog, autorole_id: roleIds.member, member_role_id: roleIds.member, mod_role_id: roleIds.mod, welcome_on: 1, welcome_dm: 1, xp_on: 1, setup_at: Date.now() });
    for (const r of TEMPLATE.roles.filter(x => x.level)) db.setLevelRole(guildId, r.level, roleIds[r.key]);
    for (const r of selfRoles) db.addSelfRole(guildId, r.role_id, r.label);
    db.setReward(guildId, 5, roleIds.regular); // a first referral reward, change or remove it any time

    // ---- the posts ----
    const guild = await api.getGuild(guildId).catch(() => null);
    const gname = guild?.name ?? "the server";
    await say(api, chIds.rules, { embeds: [{ color: 0xed4245, title: `${gname} rules`, description: TEMPLATE.rules.join("\n\n") }] });
    await say(api, chIds.roles, rolePanel(selfRoles));
    await say(api, chIds.verify, verifyPanel(roleIds.verified));
    await say(api, chIds.welcome, { embeds: [{ color: 0x57f287, title: `Welcome to ${gname}`, description: `New here? Start with <#${chIds.rules}>, pick your roles in <#${chIds.roles}>, then say hi in <#${chIds.introductions}>.\n\nNew members are greeted in this channel.` }] });
    await say(api, chIds.botcmd, { content: "Try **/rank** for your level, **/levels** for the leaderboard, **/invites link** to get your own invite link and **/wishlist import** for sale alerts." });
    await say(api, chIds.deals, { content: "Sale alerts and free games land here. Members: use `/wishlist import` to get your own alerts." });
    await say(api, chIds.tickets, { content: "Member tickets from `/support open` appear here with Reply, Assign me and Resolve buttons." });
    await say(api, chIds.modlog, { content: "Every moderator action is logged here as a numbered case: `/mod warn`, `timeout`, `kick`, `ban`, `unban` and `purge`. Use `/mod cases` to look back." });
    await say(api, chIds.memberlog, { content: "Joins, leaves and which invite each member used are logged here." });

    // ---- server settings (all best effort: a missing permission only skips that part) ----
    if (chIds.afk) await api.editGuild(guildId, { afk_channel_id: chIds.afk, afk_timeout: 900 }).catch(() => notes.push("Could not set the AFK channel (needs Manage Server)."));
    await api.editGuild(guildId, { system_channel_flags: 1 }).catch(() => {}); // stop Discord's own join message, the bot greets instead

    db.bumpUsage?.(fresh ? "setup_auto" : "setup_manual");
    db.bumpUsage?.("channels_created", created.channels.length);
    return { created, channels: chIds, roles: roleIds, notes };
}

// ---------- welcome messages ----------
/** The private message a new member gets: what the bot does for them and where the dashboard is. */
export function welcomeDmPayload({ server, dashboardUrl = null }) {
    const embed = {
        color: 0x4d8cff, title: `Welcome to ${server}!`,
        description: "I'm **Steam Value Checker**, the bot that looks after games, deals and the community here. Here is what I can do for you:",
        fields: [
            { name: "💸 Sale alerts", value: "`/wishlist import` your Steam wishlist and I message you when a game drops in price. `/value` prices any list of games." },
            { name: "🎁 Free games", value: "`/freegames` shows what is free to claim right now on Steam, Epic, GOG and more." },
            { name: "🎮 Your library", value: "Sign in through Steam on the dashboard to see your library value, hours and what to play next." },
            { name: "🏆 In this server", value: "Earn XP and levels by chatting and talking in voice (`/rank`, `/levels`), get your own invite link (`/invites link`), and prove your Steam account in #verify for the Steam Verified role." },
            { name: "🔔 Control it", value: "`/alerts` sets quiet hours and how you get notified. `/help` lists every command. `/mydata delete` removes your data any time." }
        ],
        footer: { text: "You got this message because you joined a server that uses the bot. Replies here are not read." }
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

export function welcomePayload({ settings, userId, username, avatarUrl, server, count, inviterId }) {
    const text = renderWelcome(settings.welcome_msg, { userId, username, server, count, inviterId });
    return {
        embeds: [{ color: 0x57f287, title: `Welcome, ${String(username).slice(0, 60)}!`, description: text, ...(avatarUrl ? { thumbnail: { url: avatarUrl } } : {}), footer: { text: `Member #${count}` },
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
const CDN_RE = /https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/emojis\/(\d{15,25})\.(png|gif|webp|jpg|jpeg)(?:\?[^\s]*)?/gi;
export const EMOJI_MAX_BYTES = 256 * 1024;
export const EMOJI_BATCH = 20;

/** Pulls custom emoji out of pasted text: `<:name:id>`, `<a:name:id>` or a Discord CDN emoji link. Returns [{ name, id, animated, url }]. */
export function parseEmojis(text) {
    const out = [], seen = new Set();
    const add = (name, id, animated) => { if (seen.has(id)) return; seen.add(id); out.push({ name: name.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 32).padEnd(2, "_"), id, animated, url: `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "png"}?size=128` }); };
    const s = String(text ?? "");
    for (const m of s.matchAll(EMOJI_RE)) add(m[2], m[3], m[1] === "a");
    for (const m of s.matchAll(CDN_RE)) add(`emoji_${m[1].slice(-6)}`, m[1], m[2].toLowerCase() === "gif");
    return out.slice(0, EMOJI_BATCH);
}

/** Only Discord's own CDN may be fetched, so this cannot be pointed at anything else. */
export const isDiscordCdn = url => { try { const u = new URL(url); return u.protocol === "https:" && ["cdn.discordapp.com", "media.discordapp.net"].includes(u.hostname); } catch { return false; } };

async function download(url, fetchImpl) {
    if (!isDiscordCdn(url)) throw new Error("not a Discord link");
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = String(res.headers?.get?.("content-type") ?? "image/png").split(";")[0].trim();
    if (!/^image\/(png|gif|jpeg|webp)$/.test(type)) throw new Error("not an image");
    const buf = Buffer.from(await res.arrayBuffer());
    return { buf, type };
}

/**
 * Copies emoji into a server. `items` are { name, url } (from parseEmojis, or one attached image). Stops at the server's emoji limit.
 * Returns { added: [names], failed: [{ name, why }] }. Too-big images are re-fetched smaller when the source allows it.
 */
export async function importEmojis({ api, guildId, items, fetchImpl = globalThis.fetch, sleep = sleepDefault }) {
    const added = [], failed = [];
    const taken = new Set((await api.listEmojis(guildId).catch(() => [])).map(e => e.name.toLowerCase()));
    for (const it of items.slice(0, EMOJI_BATCH)) {
        let name = it.name.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 32).padEnd(2, "_");
        if (taken.has(name.toLowerCase())) { let n = 2; while (taken.has(`${name.slice(0, 29)}_${n}`.toLowerCase())) n++; name = `${name.slice(0, 29)}_${n}`; }
        try {
            let img = await download(it.url, fetchImpl);
            if (img.buf.length > EMOJI_MAX_BYTES && /size=\d+/.test(it.url)) img = await download(it.url.replace(/size=\d+/, "size=64"), fetchImpl);
            if (img.buf.length > EMOJI_MAX_BYTES) throw new Error("larger than 256 KB");
            await api.createEmoji(guildId, { name, image: `data:${img.type};base64,${img.buf.toString("base64")}` });
            taken.add(name.toLowerCase()); added.push(name); await sleep(400);
        } catch (e) {
            const why = e?.status === 403 ? "I need the Manage Expressions permission" : e?.status === 400 ? "Discord refused it (the emoji slots may be full)" : e?.message ?? "failed";
            failed.push({ name, why });
            if (e?.status === 403) break;
        }
    }
    return { added, failed };
}

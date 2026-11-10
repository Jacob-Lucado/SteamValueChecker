// What the dashboard's Community page does. server.js checks who may do it (member or Manage Server) and calls these.
import { xpForNext } from "../communitystore.js";
import { buildAnnouncement } from "../announce.js";
import { UserError } from "../errors.js";
import { backfillForum } from "../requestsync.js";
import { postHoneypotNotice, HONEYPOT_TOPIC } from "../honeypot.js";
import { aiLimits, aiUsedToday } from "../aichat.js";
import { checkKeyShape, providerList, PROVIDERS, listModels } from "../aiproviders.js";
import { refreshLeaderboard, LB_MIN_HOURS, LB_MAX_HOURS } from "../leaderboard.js";
import { communitySetup, rulesPayload, TEMPLATE, isFreshGuild, parseEmojis, importEmojis, EMOJI_MAX_BYTES, WELCOME_FIELDS, DEFAULT_WELCOME } from "../community.js";
import { createMemes, postMeme, MEME_HOURS } from "../memes.js";
import { DiscordApiError } from "./discord.js";
import { createEmojiGg, PACK_KEY_RE } from "../emojisource.js";

export class CommunityError extends Error { constructor(status, message) { super(message); this.status = status; } }

export const FULL_SOURCES = ["playtester", "itch", "gamerpower", "steamdemo"];

export function createCommunityDash({ db, rest, community, membersIntent = () => true, ai = { available: false, phrase: false }, rt = null, botId, publicUrl = null, fetchImpl = globalThis.fetch, emojigg = createEmojiGg({ fetchImpl }) }) {
    const memeSource = createMemes({ fetchImpl });
    const fail = (status, m) => { throw new CommunityError(status, m); };
    const nameOf = async (gid, id) => (await rest.memberName(gid, id).catch(() => null)) ?? "Member";
    const named = (gid, rows) => Promise.all(rows.map(async r => ({ ...r, name: await nameOf(gid, r.user_id) })));

    async function channelOk(gid, id) {
        if (!id) return null;
        const list = await rest.listChannels(gid).catch(() => fail(400, "The bot is not in that server yet. Invite it first."));
        if (!list.some(c => c.id === id)) fail(400, "I can't see that channel.");
        return id;
    }
    async function roleOk(gid, id) {
        if (!id) return null;
        const list = await rest.listRoles(gid).catch(() => fail(400, "The bot is not in that server yet. Invite it first."));
        if (!list.some(r => r.id === id)) fail(400, "I can't find that role.");
        return id;
    }
    const int = (v, lo, hi, what) => { const n = Number(v); if (!Number.isInteger(n) || n < lo || n > hi) fail(400, `${what} must be a whole number from ${lo} to ${hi}.`); return n; };

    /** Everything the page shows. Managers also get the settings. */
    async function overview(gid, userId, manager) {
        const me = community.rankOf(gid, userId), inv = community.inviteSummary(gid, userId);
        const out = {
            membersIntent: membersIntent(), manager, ai: { available: ai.available || Boolean(db.getCommunity(gid).ai_key), lite: ai.lite !== false, phrase: ai.phrase, canStoreKey: Boolean(ai.vault), keySet: Boolean(db.getCommunity(gid).ai_key), keyProvider: db.getCommunity(gid).ai_provider || "anthropic", keyModel: db.getCommunity(gid).ai_model ?? "", providers: providerList(), keyLast4: db.getCommunity(gid).ai_key_last4 ?? null, keyBad: Boolean(db.getMeta(`aikeybad:${gid}`)), botKey: ai.available, main: Boolean(ai.isMain?.(gid)), plus: Boolean(db.getCommunity(gid).ai_plus), plusInterest: Boolean(db.getCommunity(gid).ai_plus_interest), plusVisible: rt ? rt.get("ai_plus_visible") : true, plusCap: rt ? rt.get("ai_plus_cap") : 2000, ...(rt ? aiLimits(rt, gid, { main: Boolean(ai.isMain?.(gid)), plus: Boolean(db.getCommunity(gid).ai_plus), ownKey: Boolean(db.getCommunity(gid).ai_key) }) : { enabled: true, dailyCap: 300, cooldownSec: 15, maxQuestion: 700, maxReply: 1900, history: 6 }), usedToday: aiUsedToday(db, gid) },
            me: { ...me, invites: inv },
            xpTop: await named(gid, db.xpTop(gid, 10)), inviteTop: await named(gid, db.inviteTop(gid, 10)),
            rewards: db.listRewards(gid), levelRoles: db.listLevelRoles(gid),
            verify: { available: Boolean(db.getCommunity(gid).verified_role_id), steamVerified: Boolean(db.getSteamLink(userId)?.verified) }
        };
        if (manager) {
            const c = db.getCommunity(gid);
            const { ai_key, ...safe } = c; // the encrypted key never leaves the server
            out.settings = { ...safe, welcome_msg: c.welcome_msg ?? "", defaultWelcome: DEFAULT_WELCOME, fields: WELCOME_FIELDS };
            out.selfRoles = db.listSelfRoles(gid);
            out.built = Boolean(c.setup_at);
            const tk = db.getTicketSettings(gid);
            out.support = { ticket_channel: tk.channel_id, staff_role_id: tk.staff_role_id };
            out.announcements = db.listAnnouncements(gid, 8);
            out.serverGuides = db.listServerGuides(gid);
            out.growth = db.growth(gid, 30);
            out.defaultRules = TEMPLATE.rules.join("\n\n");
        }
        return out;
    }

    const PAGE = 25;
    /** The full XP page: the board (paged), the member's own card, the server's numbers, level rewards and the level curve. */
    async function xpPage(gid, userId, manager, page = 1) {
        const totals = db.xpTotals(gid), pages = Math.max(1, Math.ceil(totals.members / PAGE));
        const p = Math.min(pages, Math.max(1, Math.trunc(Number(page)) || 1));
        const rows = db.xpPage(gid, PAGE, (p - 1) * PAGE).map((r, n) => ({ ...r, rank: (p - 1) * PAGE + n + 1 }));
        const roles = await rest.listRoles(gid).catch(() => []);
        const roleName = id => roles.find(r => r.id === id)?.name ?? "a role";
        const c = db.getCommunity(gid);
        let cum = 0;
        const curve = Array.from({ length: 20 }, (_, i) => { cum += xpForNext(i); return { level: i + 1, need: xpForNext(i), total: cum }; });
        const out = {
            enabled: Boolean(c.xp_on), multiplier: c.xp_mult, announce: c.levelup_mode, referralXp: c.referral_xp, totals, page: p, pages, perPage: PAGE,
            board: await named(gid, rows), me: community.rankOf(gid, userId),
            rewards: db.listLevelRoles(gid).map(r => ({ level: r.level, role_id: r.role_id, name: roleName(r.role_id) })), curve,
            how: { message: [Math.round(15 * c.xp_mult), Math.round(25 * c.xp_mult)], cooldownSeconds: 60, voicePerMinute: Math.round(5 * c.xp_mult), referral: c.referral_xp }
        };
        if (manager) { out.manager = true; out.settings = { xp_on: c.xp_on, xp_mult: c.xp_mult, levelup_mode: c.levelup_mode, levelup_channel: c.levelup_channel }; }
        return out;
    }

    async function setup(gid, userId) {
        try {
            const [channels, roles, guild] = await Promise.all([rest.allChannels(gid), rest.allRoles(gid), rest.getGuild(gid).catch(() => null)]);
            const fresh = isFreshGuild({ channels, roles: roles.map(r => ({ ...r, guild_id: gid })), memberCount: guild?.approximate_member_count ?? 0 });
            const r = await communitySetup({ api: rest, db, guildId: gid, botId, userId, fresh, baseUrl: publicUrl });
            db.bumpUsage("dash_setup");
            return { created: r.created, notes: r.notes, fresh };
        } catch (e) {
            if (e.userFacing) fail(400, e.message);
            if (e instanceof DiscordApiError && [403, 404].includes(e.status)) fail(400, e.status === 404 ? "The bot is not in that server yet. Invite it first." : "I need the Manage Channels and Manage Roles permissions.");
            throw e;
        }
    }

    async function welcome(gid, b) {
        const patch = {};
        if (b.enabled !== undefined) patch.welcome_on = b.enabled ? 1 : 0;
        if (b.channel_id !== undefined) patch.welcome_channel = await channelOk(gid, b.channel_id || null);
        if (b.message !== undefined) { const m = String(b.message ?? "").trim(); if (m.length > 1000) fail(400, "Keep the message under 1000 characters."); patch.welcome_msg = m || null; }
        if (b.dm !== undefined) patch.welcome_dm = b.dm ? 1 : 0;
        if (b.card !== undefined) patch.welcome_card = b.card ? 1 : 0;
        if (b.leave !== undefined) patch.leave_on = b.leave ? 1 : 0;
        if (b.log_channel_id !== undefined) patch.log_channel = await channelOk(gid, b.log_channel_id || null);
        return db.setCommunity(gid, patch);
    }
    /** "Verify me": gives the Steam Verified role if this person has proven their Steam account. */
    async function verify(gid, userId) {
        const r = await community.grantVerified(gid, userId).catch(() => fail(400, "I could not give the role. My role must be above Steam Verified in Server Settings, Roles."));
        if (r === "no_role") fail(400, "This server has no Steam Verified role yet. A manager can build it with Build my server.");
        if (r === "not_verified") fail(400, "Sign in through Steam first (the Connect Steam button, or the Steam page), then press Verify me again.");
        return { granted: true };
    }
    async function verifyRole(gid, b) { return db.setCommunity(gid, { verified_role_id: await roleOk(gid, b.role_id || null) }); }
    /** The opt-in roles the bot pings: free-game posts, deal posts, new giveaways and looking-for-group posts. Empty means nobody is pinged. */
    async function pings(gid, b) {
        const patch = {};
        for (const k of ["deals", "free", "giveaway", "lfg", "playtest", "squad", "indie"]) if (b[k] !== undefined) patch[`ping_${k}`] = await roleOk(gid, b[k] || null);
        if (b.playtest_all !== undefined) patch.playtest_all = b.playtest_all ? 1 : 0;
        if (b.playtest_full !== undefined) patch.playtest_full = [...new Set((Array.isArray(b.playtest_full) ? b.playtest_full : []).map(String).filter(k => FULL_SOURCES.includes(k)))].join(",") || null;
        if (b.indie_dev !== undefined) patch.indie_dev_role = await roleOk(gid, b.indie_dev || null);
        if (b.indie_channel !== undefined) patch.indie_channel = await channelOk(gid, b.indie_channel || null);
        if (b.squad_channel !== undefined) patch.squad_channel = await channelOk(gid, b.squad_channel || null);
        if (b.playtest_channel !== undefined) patch.playtest_channel = await channelOk(gid, b.playtest_channel || null);
        return db.setCommunity(gid, patch);
    }
    /** Support: where member tickets go and who answers them. */
    async function support(gid, b) {
        const channel = b.ticket_channel !== undefined ? await channelOk(gid, b.ticket_channel || null) : db.getTicketSettings(gid).channel_id;
        const role = b.staff_role_id !== undefined ? await roleOk(gid, b.staff_role_id || null) : db.getTicketSettings(gid).staff_role_id;
        db.setTicketSettings(gid, { channelId: channel, staffRoleId: role });
        return { ticket_channel: channel, staff_role_id: role };
    }
    /** Where announcements and the rules are posted. */
    async function places(gid, b) {
        const patch = {};
        if (b.announce_channel !== undefined) patch.announce_channel = await channelOk(gid, b.announce_channel || null);
        if (b.rules_channel !== undefined) patch.rules_channel = await channelOk(gid, b.rules_channel || null);
        if (b.requests_channel !== undefined) {
            const id = b.requests_channel || null;
            if (id && !(await rest.listForums(gid).catch(() => fail(400, "The bot is not in that server yet. Invite it first."))).some(c => c.id === id)) fail(400, "That is not a forum channel I can see.");
            if (id !== db.getCommunity(gid).requests_channel) db.dropForumPosts(gid); // a new forum starts clean
            patch.requests_channel = id;
        }
        if (b.ai_plus_interest !== undefined) patch.ai_plus_interest = b.ai_plus_interest ? 1 : 0;
        if (b.ai_key_clear) { patch.ai_key = null; patch.ai_key_last4 = null; patch.ai_provider = null; patch.ai_model = null; db.setMeta(`aikeybad:${gid}`, ""); }
        if (typeof b.ai_key === "string" && b.ai_key.trim()) {
            const k = b.ai_key.trim(), provider = String(b.ai_provider || "anthropic"), model = String(b.ai_model ?? "").trim() || null;
            if (!ai.vault) fail(400, "This bot can't store keys yet. The bot owner needs to set KEY_ENCRYPTION_SECRET first.");
            const bad = checkKeyShape(provider, k, model);
            if (bad) fail(400, bad);
            const check = ai.checkKey ? await ai.checkKey(k, { provider, model }) : { ok: true };
            if (!check.ok) fail(400, check.error);
            patch.ai_key = ai.vault.encrypt(k); patch.ai_key_last4 = k.slice(-4); patch.ai_provider = provider === "anthropic" ? null : provider; patch.ai_model = PROVIDERS[provider].defaultModel && !model ? null : model;
            db.setMeta(`aikeybad:${gid}`, "");
        } else if (b.ai_provider !== undefined || b.ai_model !== undefined) { // changing only the model or service of a saved key
            if (!db.getCommunity(gid).ai_key) fail(400, "Paste your key first.");
            const provider = String(b.ai_provider || db.getCommunity(gid).ai_provider || "anthropic");
            if (!PROVIDERS[provider]) fail(400, "Pick one of the AI services in the list.");
            if (provider !== (db.getCommunity(gid).ai_provider || "anthropic")) fail(400, "To switch service, paste a key for the new service.");
            const model = String(b.ai_model ?? "").trim() || null;
            if (!PROVIDERS[provider].defaultModel && !model) fail(400, "Type the model name to use.");
            if (model && !/^[\w./:@+-]{1,100}$/.test(model)) fail(400, "That model name has characters a model name does not use.");
            patch.ai_model = model;
        }
        if (b.ai_on !== undefined) {
            const hasKey = patch.ai_key !== undefined ? Boolean(patch.ai_key) : Boolean(db.getCommunity(gid).ai_key);
            if (b.ai_on && !ai.available && !hasKey && ai.lite === false) fail(400, "The AI companion isn't available on this bot yet. Add your own AI key here, or ask the bot owner to add one.");
            patch.ai_on = b.ai_on ? 1 : 0;
        };
        if (b.guides_on !== undefined) patch.guides_on = b.guides_on ? 1 : 0;
        if (b.ai_channel !== undefined) patch.ai_channel = await channelOk(gid, b.ai_channel || null);
        let trap = null;
        if (b.honeypot_channel !== undefined) {
            patch.honeypot_channel = await channelOk(gid, b.honeypot_channel || null);
            if (patch.honeypot_channel && patch.honeypot_channel !== db.getCommunity(gid).honeypot_channel) trap = patch.honeypot_channel;
        }
        const { ai_key: _k, ...row } = db.setCommunity(gid, patch);
        if (trap) { // a newly chosen trap channel gets the warning notice and description straight away
            await Promise.resolve(rest.editChannel?.(trap, { topic: HONEYPOT_TOPIC })).catch(() => {});
            await postHoneypotNotice({ db, api: rest, guildId: gid, channelId: trap });
        }
        if (patch.requests_channel) backfillForum({ db, api: rest, guildId: gid, base: publicUrl }).catch(() => {}); // fill the forum with recent requests
        return row;
    }
    /** The models a key can use, for the model picker. Uses the key typed in the box, or else the one this server already saved. */
    async function aiModels(gid, b) {
        const saved = db.getCommunity(gid);
        const typed = String(b.ai_key ?? "").trim();
        const provider = String(typed ? (b.ai_provider || "anthropic") : (saved.ai_provider || "anthropic"));
        if (!PROVIDERS[provider]) fail(400, "Pick one of the AI services in the list.");
        const apiKey = typed || (saved.ai_key && ai.vault ? ai.vault.decrypt(saved.ai_key) : null);
        if (!apiKey) fail(400, "Paste your key first, then load the models.");
        if (typed) { const bad = checkKeyShape(provider, typed, PROVIDERS[provider].defaultModel ?? "x"); if (bad) fail(400, bad); }
        const r = await (ai.listModels ?? (o => listModels({ ...o, fetchFn: fetchImpl })))({ provider, apiKey }).catch(() => ({ ok: false, status: 0, error: "could not be reached" }));
        if (!r.ok) fail(400, `${PROVIDERS[provider].label} answered ${r.status || "with an error"}${r.error ? ` (${r.error})` : ""}. Check the key.`);
        return { provider, models: r.models };
    }
    /** The #leaderboard board: where it lives, how often it refreshes, and an immediate refresh. */
    async function leaderboard(gid, b) {
        const patch = {};
        if (b.channel_id !== undefined) { patch.lb_channel = await channelOk(gid, b.channel_id || null); patch.lb_message_id = null; }
        if (b.hours !== undefined) patch.lb_hours = int(b.hours, LB_MIN_HOURS, LB_MAX_HOURS, "The refresh time");
        if (Object.keys(patch).length) db.setCommunity(gid, patch);
        let refreshed = false;
        if (b.refresh) {
            try { await refreshLeaderboard({ db, api: rest, guildId: gid, base: publicUrl }); refreshed = true; }
            catch (e) { if (e instanceof UserError) fail(400, e.message); throw e; }
        }
        const c = db.getCommunity(gid);
        return { refreshed, lb_channel: c.lb_channel, lb_hours: c.lb_hours, lb_at: c.lb_at };
    }
    /** Auto memes: the channel, how often, on or off, and a meme right now. */
    async function memesSettings(gid, b) {
        const patch = {};
        if (b.channel_id !== undefined) { patch.meme_channel = await channelOk(gid, b.channel_id || null); patch.meme_at = null; }
        if (b.hours !== undefined) { const n = Number(b.hours); if (!MEME_HOURS.includes(n)) fail(400, "Pick 1, 2, 3, 6, 12 or 24 hours."); patch.meme_hours = n; }
        if (b.enabled !== undefined) patch.meme_on = b.enabled ? 1 : 0;
        if (Object.keys(patch).length) db.setCommunity(gid, patch);
        let posted = false;
        if (b.now) {
            try { await postMeme({ db, api: rest, memes: memeSource, guildId: gid }); posted = true; }
            catch (e) { if (e instanceof UserError) fail(400, e.message); throw e; }
        }
        const c = db.getCommunity(gid);
        return { posted, meme_channel: c.meme_channel, meme_hours: c.meme_hours, meme_on: c.meme_on, meme_at: c.meme_at };
    }
    /** Saves the rules text (empty means the standard rules) and, when asked, posts them in the rules channel. */
    async function rules(gid, b) {
        const text = String(b.text ?? "").trim();
        if (text.length > 3000) fail(400, "Keep the rules under 3000 characters.");
        const c = db.setCommunity(gid, { rules_text: text || null });
        let posted = false;
        if (b.post) {
            if (!c.rules_channel) fail(400, "Choose the rules channel first.");
            const guild = await rest.getGuild(gid).catch(() => null);
            await rest.sendMessage(c.rules_channel, { allowed_mentions: { parse: [] }, ...rulesPayload({ server: guild?.name ?? "the server", base: publicUrl, rules: c.rules_text, helpChannel: (await rest.listChannels(gid).catch(() => [])).find(c => c.name === "get-help")?.id ?? null }) })
                .catch(() => fail(400, "I could not post there. Give me Send Messages and Embed Links in that channel."));
            posted = true;
        }
        return { posted, rules_text: c.rules_text };
    }
    /** Builds and posts a server announcement. Returns the new row. */
    async function announce(gid, b, userId) {
        const channel = await channelOk(gid, b.channel_id || db.getCommunity(gid).announce_channel) ?? fail(400, "Choose the channel to post in.");
        if (b.ping === "role") await roleOk(gid, b.role_id);
        const guild = await rest.getGuild(gid).catch(() => null);
        let built;
        try { built = buildAnnouncement(b, { serverName: guild?.name ?? "", serverIcon: guild?.icon ? `https://cdn.discordapp.com/icons/${gid}/${guild.icon}.png?size=256` : null }); }
        catch (e) { if (e instanceof UserError) fail(400, e.message); throw e; }
        const msg = await rest.sendMessage(channel, built.payload).catch(() => fail(400, "I could not post there. Give me View Channel, Send Messages and Embed Links in that channel."));
        const id = db.addAnnouncement(gid, userId, channel, msg?.id ?? null, built.title);
        db.bumpUsage("dash_announce");
        return { id, channel_id: channel, message_id: msg?.id ?? null, history: db.listAnnouncements(gid, 8) };
    }
    /** A server's own guides: members who ask a matching question get the answer, from the bot or the AI. */
    async function guides(gid, b, userId = null) {
        if (b.remove) return { removed: db.deleteServerGuide(gid, b.remove), guides: db.listServerGuides(gid) };
        const r = db.addServerGuide(gid, { title: b.title, keywords: b.keywords, body: b.body }, userId);
        if (r.error) fail(400, r.error);
        return { id: r.id, guides: db.listServerGuides(gid) };
    }
    async function autorole(gid, b) { return db.setCommunity(gid, { autorole_id: await roleOk(gid, b.role_id || null) }); }
    async function xp(gid, b) {
        const patch = {};
        if (b.enabled !== undefined) patch.xp_on = b.enabled ? 1 : 0;
        if (b.multiplier !== undefined) { const m = Number(b.multiplier); if (!(m >= 0.1 && m <= 5)) fail(400, "Speed must be between 0.1 and 5."); patch.xp_mult = m; }
        if (b.announce !== undefined) { if (!["same", "channel", "off"].includes(b.announce)) fail(400, "Choose same, channel or off."); patch.levelup_mode = b.announce; }
        if (b.channel_id !== undefined) patch.levelup_channel = await channelOk(gid, b.channel_id || null);
        if ((patch.levelup_mode ?? db.getCommunity(gid).levelup_mode) === "channel" && !(patch.levelup_channel ?? db.getCommunity(gid).levelup_channel)) fail(400, "Choose the channel for level-ups.");
        return db.setCommunity(gid, patch);
    }
    async function levelrole(gid, b) {
        const level = int(b.level, 1, 200, "Level");
        if (b.remove) return { removed: db.removeLevelRole(gid, level), levelRoles: db.listLevelRoles(gid) };
        db.setLevelRole(gid, level, await roleOk(gid, b.role_id) ?? fail(400, "Choose a role."));
        return { levelRoles: db.listLevelRoles(gid) };
    }
    async function referral(gid, b) {
        if (b.bonus !== undefined) db.setCommunity(gid, { referral_xp: int(b.bonus, 0, 1000, "The bonus") });
        if (b.count !== undefined && b.count !== "") {
            const count = int(b.count, 1, 1000, "The count");
            if (b.remove) db.removeReward(gid, count); else db.setReward(gid, count, await roleOk(gid, b.role_id) ?? fail(400, "Choose a role."));
        }
        return { referral_xp: db.getCommunity(gid).referral_xp, rewards: db.listRewards(gid) };
    }
    async function emojiList(gid) {
        const list = await rest.listEmojis(gid).catch(e => fail(e?.status === 404 ? 400 : 502, "I could not read this server's emoji."));
        return { emojis: list.map(e => ({ id: e.id, name: e.name, animated: Boolean(e.animated), url: `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? "gif" : "png"}?size=48` })) };
    }
    async function emojiImport(gid, text) {
        const items = parseEmojis(text);
        if (!items.length) fail(400, "Paste custom emoji (like <:name:123456789012345678>) or Discord emoji links.");
        const r = await importEmojis({ api: rest, guildId: gid, items, fetchImpl });
        db.bumpUsage("emoji_added", r.added.length); db.bumpUsage("dash_emoji");
        return r;
    }
    /** An image chosen on the dashboard, sent as a data URL. PNG, GIF, JPG or WebP, at most 256 KB, like Discord's own limit. */
    async function emojiUpload(gid, name, dataUrl) {
        const m = /^data:(image\/(?:png|gif|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ""));
        if (!m) fail(400, "Choose a PNG, GIF, JPG or WebP image.");
        if (Buffer.from(m[2], "base64").length > EMOJI_MAX_BYTES) fail(400, "That image is larger than 256 KB. Make it smaller (128x128 is plenty).");
        const clean = String(name ?? "").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 32);
        if (clean.length < 2) fail(400, "Give the emoji a name of at least 2 letters or numbers.");
        try { await rest.createEmoji(gid, { name: clean, image: dataUrl }); }
        catch (e) { fail(400, e?.status === 403 ? "I need the Manage Expressions permission." : "Discord refused it. The emoji slots may be full, or the name is taken."); }
        db.bumpUsage("emoji_added"); db.bumpUsage("dash_emoji_upload");
        return { added: [clean], failed: [] };
    }
    /** emoji.gg's pack list, newest or most popular first. */
    async function emojiPacks(sort, pageNo) {
        try { return { packs: await emojigg.packs({ sort, pageNo }) }; }
        catch (e) { fail(502, `I couldn't load emoji.gg right now. ${e.message}`); }
    }
    /** Every emoji in one pack, so the page can show them and let the owner untick the ones they don't want. */
    async function emojiPack(key) {
        if (!PACK_KEY_RE.test(String(key))) fail(400, "That isn't a pack.");
        try { return { emojis: await emojigg.pack(key) }; }
        catch (e) { fail(502, `I couldn't read that pack. ${e.message}`); }
    }
    /** Imports the chosen emoji (by id) from a pack. A few dozen per request keeps it under the wait limits. */
    async function emojiPackImport(gid, key, ids) {
        if (!PACK_KEY_RE.test(String(key))) fail(400, "That isn't a pack.");
        const want = new Set((Array.isArray(ids) ? ids : []).map(String));
        if (!want.size) fail(400, "Tick at least one emoji.");
        let all;
        try { all = await emojigg.pack(key); } catch (e) { fail(502, `I couldn't read that pack. ${e.message}`); }
        const items = all.filter(e => want.has(e.id)).map(e => ({ name: e.name, animated: e.animated, url: e.url }));
        if (!items.length) fail(400, "None of those are in that pack.");
        const r = await importEmojis({ api: rest, guildId: gid, items, fetchImpl, limit: 30, skipExisting: true });
        db.bumpUsage("emoji_added", r.added.length); db.bumpUsage("dash_emoji_pack");
        return r;
    }
    async function inviteLink(gid, userId) {
        try { return { link: await community.inviteLinkFor(gid, userId) }; }
        catch (e) { if (e.userFacing) fail(400, e.message); throw e; }
    }
    /**
     * Every channel the bot posts in, one entry each, with what it posts and what happens when it is left empty.
     * `group` and `key` drive the Setup page; `column` is where it is kept (the alert channel and the ticket, vouch and giveaway channels have their own rows on that page).
     */
    const CHANNELS = [
        { key: "announce", group: "Announcements and rules", label: "Announcements", help: "Bot news and server announcements you send from the dashboard.", fallback: "the alert channel", column: "announce_channel" },
        { key: "rules", group: "Announcements and rules", label: "Rules", help: "Where the rules post goes.", column: "rules_channel" },
        { key: "welcome", group: "Members", label: "Welcome", help: "Welcome messages and cards for new members.", column: "welcome_channel" },
        { key: "memberlog", group: "Members", label: "Member log", help: "Joins, leaves and name changes.", column: "log_channel" },
        { key: "modlog", group: "Members", label: "Moderation log", help: "Warnings, timeouts, bans and other moderation actions.", fallback: "the member log", column: "mod_log_channel" },
        { key: "levelup", group: "Members", label: "Level-up messages", help: "Where level-ups are announced, when announcing is on.", fallback: "the channel the member was chatting in", column: "levelup_channel" },
        { key: "leaderboard", group: "Members", label: "Leaderboard", help: "The live XP board, refreshed on its own.", column: "lb_channel", reset: { lb_message_id: null } },
        { key: "playtest", group: "Games and deals", label: "Playtests and demos", help: "Betas, demos, free weekends and sign-ups.", fallback: "the alert channel", column: "playtest_channel" },
        { key: "indie", group: "Games and deals", label: "Indie showcase", help: "New and featured indie games.", column: "indie_channel" },
        { key: "squad", group: "Games and deals", label: "Squad-ups", help: "A post when two or more members are in the same game.", column: "squad_channel" },
        { key: "live", group: "Community", label: "Live streams", help: "A post when a member of your server goes live.", column: "live_channel" },
        { key: "memes", group: "Community", label: "Memes", help: "The scheduled gaming memes.", column: "meme_channel", reset: { meme_at: null } },
        { key: "ai", group: "Community", label: "AI companion", help: "The channel the AI companion answers in.", column: "ai_channel" }
    ];
    function channelMap(gid) {
        const c = db.getCommunity(gid);
        return CHANNELS.map(({ column: _c, reset: _r, ...meta }) => ({ ...meta, value: c[_c] ?? null }));
    }
    async function setChannel(gid, key, id) {
        const def = CHANNELS.find(x => x.key === key) ?? fail(400, "I don't know that channel.");
        const value = await channelOk(gid, id || null);
        db.setCommunity(gid, { [def.column]: value, ...(def.reset ?? {}) });
        return { key, value };
    }
    return { channelMap, setChannel, overview, setup, welcome, guides, autorole, verify, verifyRole, pings, support, places, aiModels, rules, announce, leaderboard, memesSettings, xp, levelrole, referral, emojiList, emojiImport, emojiUpload, emojiPacks, emojiPack, emojiPackImport, inviteLink, xpPage };
}

// What the dashboard's Community page does. server.js checks who may do it (member or Manage Server) and calls these.
import { xpForNext } from "../communitystore.js";
import { communitySetup, isFreshGuild, parseEmojis, importEmojis, EMOJI_MAX_BYTES, WELCOME_FIELDS, DEFAULT_WELCOME } from "../community.js";
import { DiscordApiError } from "./discord.js";

export class CommunityError extends Error { constructor(status, message) { super(message); this.status = status; } }

export function createCommunityDash({ db, rest, community, membersIntent = () => true, botId, fetchImpl = globalThis.fetch }) {
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
            membersIntent: membersIntent(), manager,
            me: { ...me, invites: inv },
            xpTop: await named(gid, db.xpTop(gid, 10)), inviteTop: await named(gid, db.inviteTop(gid, 10)),
            rewards: db.listRewards(gid), levelRoles: db.listLevelRoles(gid),
            verify: { available: Boolean(db.getCommunity(gid).verified_role_id), steamVerified: Boolean(db.getSteamLink(userId)?.verified) }
        };
        if (manager) {
            const c = db.getCommunity(gid);
            out.settings = { ...c, welcome_msg: c.welcome_msg ?? "", defaultWelcome: DEFAULT_WELCOME, fields: WELCOME_FIELDS };
            out.selfRoles = db.listSelfRoles(gid);
            out.built = Boolean(c.setup_at);
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
            const r = await communitySetup({ api: rest, db, guildId: gid, botId, userId, fresh });
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
        for (const k of ["deals", "free", "giveaway", "lfg"]) if (b[k] !== undefined) patch[`ping_${k}`] = await roleOk(gid, b[k] || null);
        return db.setCommunity(gid, patch);
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
    async function inviteLink(gid, userId) {
        try { return { link: await community.inviteLinkFor(gid, userId) }; }
        catch (e) { if (e.userFacing) fail(400, e.message); throw e; }
    }
    return { overview, setup, welcome, autorole, verify, verifyRole, pings, xp, levelrole, referral, emojiList, emojiImport, emojiUpload, inviteLink, xpPage };
}

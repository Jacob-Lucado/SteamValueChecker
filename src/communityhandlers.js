// Slash commands for the community features: /community, /rank, /levels, /invites, /emoji, and the role-picker buttons.
// No discord.js import: everything the handlers need comes from the interaction object and the shared REST helper.
import { VERIFY_ID, communitySetup, isFreshGuild, parseEmojis, importEmojis, isDiscordCdn, WELCOME_FIELDS, welcomePayload } from "./community.js";
import { UserError } from "./errors.js";
import { isHidden } from "./hidden.js";
import { refreshLeaderboard } from "./leaderboard.js";
import { rankCardSvg, boardSvg, inviteCardSvg, toPng, artFor } from "./communitycards.js";

const EPHEMERAL = 64;
const BIT = { manageGuild: 1n << 5n, expressions: 1n << 30n };
const can = (i, bit) => Boolean(i.inGuild?.() && i.memberPermissions?.has(bit));
const mention = id => `<@${id}>`;
const LINKED_NOTE = "Optional: Discord can also require it for a role (Server Settings, Roles, the role, Links, then Steam Verified). That one step has to be done in Discord.";

export function createCommunityHandlers({ db, api, service, publicUrl = null, membersIntent = () => true, fetchImpl = globalThis.fetch }) {
    const eph = (i, content) => i.reply({ content, flags: EPHEMERAL, allowedMentions: { parse: [] } });
    const needManager = i => { if (!can(i, BIT.manageGuild)) { eph(i, "Run this in your server with the Manage Server permission."); return false; } return true; };

    // ---- picture cards: a drawing that fails never blocks the answer, the plain embed is the fallback ----
    const avatarUrl = u => u?.displayAvatarURL?.({ extension: "png", size: 256 }) ?? null;
    const reply = (i, payload) => (i.deferred || i.replied ? i.editReply(payload) : i.reply(payload));
    const picture = (svg, name, description) => ({ files: [{ attachment: Buffer.from(toPng(svg)), name, description }] });
    /** Name and picture for a member id: from the server first, then Discord. Never throws. */
    async function whois(i, id) {
        try {
            const m = i.guild?.members?.cache?.get(id) ?? await i.guild?.members?.fetch?.(id).catch(() => null);
            if (m) return { name: m.displayName ?? m.user?.globalName ?? m.user?.username, url: avatarUrl(m.user) };
            const u = await i.client?.users?.fetch?.(id).catch(() => null);
            if (u) return { name: u.globalName ?? u.username, url: avatarUrl(u) };
        } catch { /* fall through */ }
        return { name: "Unknown member", url: null };
    }
    async function board(i, { title, subtitle, list, big, small, accent, accent2 }) {
        const people = await Promise.all(list.map(r => whois(i, r.user_id)));
        const art = await artFor(people.map(p => p.url), fetchImpl);
        return boardSvg({ title, subtitle, accent, accent2, rows: list.map((r, n) => ({ name: people[n].name, art: art(people[n].url), big: big(r), small: small(r) })) });
    }

    // ---- /community ----
    async function community(i) {
        const sub = i.options.getSubcommand();
        if (!i.inGuild()) return eph(i, "Use this in a server.");
        if (!needManager(i)) return;
        const gid = i.guildId;
        if (sub === "setup") {
            await i.deferReply({ flags: EPHEMERAL });
            try {
                const [channels, roles, guild] = await Promise.all([api.allChannels(gid), api.allRoles(gid), api.getGuild(gid).catch(() => null)]);
                const fresh = isFreshGuild({ channels, roles: roles.map(r => ({ ...r, guild_id: gid })), memberCount: guild?.approximate_member_count ?? 0 });
                const r = await communitySetup({ api, db, guildId: gid, botId: i.client.user.id, userId: i.user.id, fresh, baseUrl: publicUrl });
                return i.editReply({ embeds: [setupSummary(r, publicUrl, gid, membersIntent())] });
            } catch (e) {
                return i.editReply({ content: e.userFacing ? e.message : "I could not finish the setup. Check my permissions (Manage Channels, Manage Roles) and try again; anything already built is kept." });
            }
        }
        if (sub === "status") return i.reply({ embeds: [statusEmbed(db, gid, publicUrl, membersIntent())], flags: EPHEMERAL });
        if (sub === "welcome") {
            const o = i.options, patch = {};
            const on = o.getBoolean("enabled"), ch = o.getChannel("channel"), msg = o.getString("message"), dmOn = o.getBoolean("dm"), leave = o.getBoolean("leave");
            if (on !== null) patch.welcome_on = on ? 1 : 0;
            if (ch) patch.welcome_channel = ch.id;
            if (msg !== null) patch.welcome_msg = msg.trim() || null;
            if (dmOn !== null) patch.welcome_dm = dmOn ? 1 : 0;
            if (leave !== null) patch.leave_on = leave ? 1 : 0;
            const c = Object.keys(patch).length ? db.setCommunity(gid, patch) : db.getCommunity(gid);
            if (o.getBoolean("test")) {
                const sample = welcomePayload({ settings: c, userId: i.user.id, username: i.user.username, avatarUrl: i.user.displayAvatarURL?.({ extension: "png", size: 128 }), server: i.guild?.name ?? "the server", count: (i.guild?.memberCount ?? 1), inviterId: null });
                return i.reply({ ...sample, content: "This is what a new member sees:", flags: EPHEMERAL });
            }
            const warn = membersIntent() ? "" : "\n⚠️ The bot cannot see new members yet: turn on **Server Members Intent** for the bot in the Discord Developer Portal.";
            return eph(i, `Welcome message is **${c.welcome_on ? "on" : "off"}**${c.welcome_channel ? ` in <#${c.welcome_channel}>` : " (no channel chosen yet)"}. Private welcome: ${c.welcome_dm ? "on" : "off"}. Leave notes: ${c.leave_on ? "on" : "off"}.\nFields you can use: ${WELCOME_FIELDS.map(f => `\`${f}\``).join(" ")}${warn}`);
        }
        if (sub === "verifyrole") {
            const role = i.options.getRole("role");
            if (i.options.getBoolean("clear")) { db.setCommunity(gid, { verified_role_id: null }); return eph(i, "Nobody will be given a Steam Verified role."); }
            if (!role) return eph(i, db.getCommunity(gid).verified_role_id ? `Members who prove their Steam account get <@&${db.getCommunity(gid).verified_role_id}>.` : "No Steam Verified role is set. Pick one with the role option, or run `/community setup`.");
            db.setCommunity(gid, { verified_role_id: role.id });
            return eph(i, `Members who prove their Steam account will get **${role.name}** (they press the button in #verify or use /steam verify). My role must be above it.\n${LINKED_NOTE}`);
        }
        if (sub === "autorole") {
            const role = i.options.getRole("role");
            if (i.options.getBoolean("clear")) { db.setCommunity(gid, { autorole_id: null }); return eph(i, "New members will not get a role automatically."); }
            if (!role) return eph(i, db.getCommunity(gid).autorole_id ? `New members get <@&${db.getCommunity(gid).autorole_id}>.` : "No automatic role is set. Pick one with the role option.");
            db.setCommunity(gid, { autorole_id: role.id });
            return eph(i, `New members will get **${role.name}**. My role must be above it in Server Settings, Roles.`);
        }
        if (sub === "xp") {
            const o = i.options, patch = {};
            const on = o.getBoolean("enabled"), mult = o.getNumber("multiplier"), mode = o.getString("announce"), ch = o.getChannel("channel");
            if (on !== null) patch.xp_on = on ? 1 : 0;
            if (mult !== null) patch.xp_mult = mult;
            if (ch) { patch.levelup_channel = ch.id; if (!mode) patch.levelup_mode = "channel"; }
            if (mode) patch.levelup_mode = mode;
            if (mode === "channel" && !ch && !db.getCommunity(gid).levelup_channel) return eph(i, "Pick the channel with the channel option too.");
            const c = Object.keys(patch).length ? db.setCommunity(gid, patch) : db.getCommunity(gid);
            return eph(i, `XP is **${c.xp_on ? "on" : "off"}**, speed ×${c.xp_mult}. Level-ups: ${c.levelup_mode === "off" ? "not announced" : c.levelup_mode === "channel" ? `in <#${c.levelup_channel}>` : "in the channel where members chat"}.`);
        }
        if (sub === "levelrole") {
            const level = i.options.getInteger("level"), role = i.options.getRole("role");
            if (i.options.getBoolean("remove")) return eph(i, db.removeLevelRole(gid, level) ? `Removed the level ${level} reward.` : `There was no reward for level ${level}.`);
            if (!role) { const all = db.listLevelRoles(gid); return eph(i, all.length ? all.map(r => `Level ${r.level}: <@&${r.role_id}>`).join("\n") : "No level rewards yet. Pick a role to add one."); }
            db.setLevelRole(gid, level, role.id);
            return eph(i, `Members who reach level **${level}** get **${role.name}**.`);
        }
        if (sub === "referral") {
            const bonus = i.options.getInteger("bonus"), count = i.options.getInteger("count"), role = i.options.getRole("role");
            if (bonus !== null) db.setCommunity(gid, { referral_xp: bonus });
            if (count !== null && i.options.getBoolean("remove")) return eph(i, db.removeReward(gid, count) ? `Removed the reward for ${count} invited members.` : "There was no reward at that count.");
            if (count !== null && role) db.setReward(gid, count, role.id);
            const c = db.getCommunity(gid), rewards = db.listRewards(gid);
            return eph(i, `Inviter bonus: **${c.referral_xp} XP** per new member.\n${rewards.length ? rewards.map(r => `${r.count} invited: <@&${r.role_id}>`).join("\n") : "No role rewards yet. Use count and role to add one."}`);
        }
    }

    // ---- /rank ----
    async function rank(i) {
        if (!i.inGuild()) return eph(i, "Use this in a server.");
        const user = i.options.getUser("member") ?? i.user;
        if (user.bot) return eph(i, "Bots do not earn XP.");
        const r = service.rankOf(i.guildId, user.id), c = db.getCommunity(i.guildId);
        const inv = db.inviteStats(i.guildId, user.id);
        const mm = i.guild?.members?.cache?.get(user.id);
        const embed = { color: 0x5865f2, author: { name: user.username, icon_url: user.displayAvatarURL?.({ extension: "png", size: 64 }) },
            title: `Level ${r.level}`, description: `${r.bar}\n**${r.into.toLocaleString()}** / ${r.need.toLocaleString()} XP to level ${r.level + 1}`,
            fields: [{ name: "Rank", value: r.rank ? `#${r.rank} of ${r.members}` : "Not ranked yet", inline: true }, { name: "Total XP", value: r.xp.toLocaleString(), inline: true }, { name: "Messages", value: r.messages.toLocaleString(), inline: true },
                { name: "Invited", value: `${inv.active} members`, inline: true }],
            footer: { text: c.xp_on ? "Chat and join voice to earn XP" : "XP is off in this server" } };
        try {
            await i.deferReply();
            const url = avatarUrl(user), art = await artFor([url], fetchImpl);
            const svg = rankCardSvg({ name: mm?.displayName ?? user.globalName ?? user.username, art: art(url), server: i.guild?.name, level: r.level, into: r.into, need: r.need, rank: r.rank, members: r.members, xp: r.xp, messages: r.messages, voice: r.voiceMinutes ?? 0, invited: inv.active });
            return await i.editReply({ ...picture(svg, "rank.png", `${user.username} is level ${r.level}`), content: c.xp_on ? "" : "XP is off in this server, so this card will not grow.", allowedMentions: { parse: [] } });
        } catch { return reply(i, { embeds: [embed], allowedMentions: { parse: [] } }); }
    }

    // ---- /leaderboardrefresh ----
    const lbLast = new Map();
    async function leaderboardRefresh(i) {
        if (!i.inGuild()) return eph(i, "Use this in a server.");
        if (!needManager(i)) return;
        const wait = 30_000 - (Date.now() - (lbLast.get(i.guildId) ?? 0));
        if (wait > 0) return eph(i, `The board was just refreshed. Try again in ${Math.ceil(wait / 1000)}s.`);
        lbLast.set(i.guildId, Date.now());
        await i.deferReply({ flags: EPHEMERAL });
        try { await refreshLeaderboard({ db, api, guildId: i.guildId, base: publicUrl }); return i.editReply({ content: `Updated the leaderboard in <#${db.getCommunity(i.guildId).lb_channel}>. It also refreshes on its own every ${db.getCommunity(i.guildId).lb_hours} hours.` }); }
        catch (e) { lbLast.delete(i.guildId); return i.editReply({ content: e instanceof UserError ? e.message : "I could not update it. Check my permissions in the leaderboard channel." }); }
    }

    // ---- /levels ----
    async function levels(i) {
        if (!i.inGuild()) return eph(i, "Use this in a server.");
        const top = db.xpTop(i.guildId, 10);
        const medal = n => ["🥇", "🥈", "🥉"][n] ?? `**${n + 1}.**`;
        const embed = { color: 0xfee75c, title: `${i.guild?.name ?? "Server"} leaderboard`, description: top.length ? top.map((r, n) => `${medal(n)} ${mention(r.user_id)} · level ${r.level} · ${r.xp.toLocaleString()} XP`).join("\n") : "Nobody has earned XP yet. Start chatting!",
            footer: { text: publicUrl ? "Full board on the dashboard" : undefined } };
        try {
            await i.deferReply();
            const svg = await board(i, { title: `${i.guild?.name ?? "Server"} leaderboard`, subtitle: "Top members by XP", list: top, big: r => `Level ${r.level}`, small: r => `${r.xp.toLocaleString()} XP` });
            return await i.editReply({ ...picture(svg, "leaderboard.png", `Top ${top.length} members by XP`), allowedMentions: { parse: [] } });
        } catch { return reply(i, { embeds: [embed], allowedMentions: { parse: [] } }); }
    }

    // ---- /invites ----
    async function invites(i) {
        if (!i.inGuild()) return eph(i, "Use this in a server.");
        const sub = i.options.getSubcommand();
        if (sub === "link") {
            await i.deferReply({ flags: EPHEMERAL });
            try { const link = await service.inviteLinkFor(i.guildId, i.user.id); return i.editReply({ content: `Your invite link: ${link}\nEveryone who joins with it counts for you (and earns you XP and rewards). It never expires.` }); }
            catch (e) { return i.editReply({ content: e.userFacing ? e.message : "I could not make a link right now." }); }
        }
        if (sub === "top") {
            const top = db.inviteTop(i.guildId, 10);
            const embed = { color: 0x57f287, title: "Top inviters", description: top.length ? top.map((r, n) => `**${n + 1}.** ${mention(r.user_id)} · ${r.active} here (${r.total} joined)`).join("\n") : "Nobody has invited anyone yet. Get your link with `/invites link`." };
            try {
                await i.deferReply();
                const svg = await board(i, { title: "Top inviters", subtitle: i.guild?.name ?? "", list: top, big: r => `${r.active} here`, small: r => `${r.total} joined in total`, accent: "#57f287", accent2: "#70a6d8", empty: "Nobody has invited anyone yet." });
                return await i.editReply({ ...picture(svg, "top-inviters.png", "Top inviters"), allowedMentions: { parse: [] } });
            } catch { return reply(i, { embeds: [embed], allowedMentions: { parse: [] } }); }
        }
        const user = i.options.getUser("member") ?? i.user;
        const s = service.inviteSummary(i.guildId, user.id);
        const rewards = s.rewards.map(r => `${s.active >= r.count ? "✅" : "⬜"} ${r.count} invited → <@&${r.role_id}>`).join("\n");
        const embed = { color: 0x57f287, title: `${user.username}'s invites`, description: `**${s.active}** members still here · ${s.total} joined in total · ${s.left} left`,
            fields: [...(rewards ? [{ name: "Rewards", value: rewards }] : []), ...(s.by ? [{ name: "Joined through", value: mention(s.by), inline: true }] : []), ...(user.id === i.user.id ? [{ name: "Your link", value: s.link ?? "Get one with `/invites link`" }] : [])] };
        try {
            await i.deferReply({ flags: EPHEMERAL });
            const url = avatarUrl(user), art = await artFor([url], fetchImpl), by = s.by ? await whois(i, s.by) : null;
            const roleName = id => i.guild?.roles?.cache?.get(id)?.name ?? "Reward role";
            const svg = inviteCardSvg({ name: i.guild?.members?.cache?.get(user.id)?.displayName ?? user.globalName ?? user.username, art: art(url), server: i.guild?.name, active: s.active, total: s.total, left: s.left, by: by?.name,
                rewards: s.rewards.map(r => ({ count: r.count, done: s.active >= r.count, role: roleName(r.role_id) })) });
            const link = user.id === i.user.id ? (s.link ? `Your link: ${s.link}` : "Get your link with `/invites link`.") : "";
            return await i.editReply({ ...picture(svg, "invites.png", `${user.username}'s invites`), content: link, allowedMentions: { parse: [] } });
        } catch { return reply(i, { embeds: [embed], flags: EPHEMERAL, allowedMentions: { parse: [] } }); }
    }

    // ---- /emoji ----
    async function emoji(i) {
        if (!i.inGuild()) return eph(i, "Use this in a server.");
        if (!can(i, BIT.expressions) && !can(i, BIT.manageGuild)) return eph(i, "You need the Manage Expressions permission for this.");
        const sub = i.options.getSubcommand();
        if (sub === "list") {
            const list = await api.listEmojis(i.guildId).catch(() => null);
            if (!list) return eph(i, "I could not read this server's emoji.");
            const stat = list.filter(e => !e.animated).length, anim = list.filter(e => e.animated).length;
            return eph(i, `This server has **${stat}** still and **${anim}** animated emoji.\n${list.slice(0, 40).map(e => `<${e.animated ? "a" : ""}:${e.name}:${e.id}>`).join(" ") || "None yet."}`);
        }
        await i.deferReply({ flags: EPHEMERAL });
        const items = parseEmojis(i.options.getString("emojis") ?? "");
        const file = i.options.getAttachment("image");
        if (file) {
            if (!isDiscordCdn(file.url)) return i.editReply({ content: "That attachment could not be read." });
            const nm = i.options.getString("name") ?? file.name.replace(/\.[^.]+$/, "");
            items.unshift({ name: nm, url: file.url });
        }
        if (!items.length) return i.editReply({ content: "Paste some custom emoji (for example from another server) or attach an image." });
        const r = await importEmojis({ api, guildId: i.guildId, items, fetchImpl });
        db.bumpUsage("emoji_added", r.added.length);
        return i.editReply({ content: [r.added.length ? `Added ${r.added.length}: ${r.added.map(n => `\`:${n}:\``).join(" ")}` : "Nothing was added.", ...r.failed.map(f => `• \`${f.name}\`: ${f.why}`)].join("\n").slice(0, 1900) });
    }

    // ---- role picker buttons (rr:<roleId>) ----
    async function roleButton(i) {
        const roleId = i.customId.slice(3);
        if (!i.inGuild() || !db.isSelfRole(i.guildId, roleId)) return eph(i, "That role is not available any more.");
        try {
            const has = i.member.roles?.cache?.has(roleId) ?? false;
            if (has) await api.removeRole(i.guildId, i.user.id, roleId); else await api.addRole(i.guildId, i.user.id, roleId);
            db.bumpUsage("role_picks");
            return eph(i, has ? `Removed <@&${roleId}>.` : `You now have <@&${roleId}>.`);
        } catch { return eph(i, "I could not change that role. My role needs to be above it in Server Settings, Roles."); }
    }

    // ---- Steam verification: /steam verify and the button in #verify ----
    async function verify(i) {
        if (!i.inGuild()) return eph(i, "Use this in a server.");
        const base = publicUrl ? `${publicUrl}/auth/linked` : null;
        const link = base ? [{ type: 1, components: [{ type: 2, style: 5, label: "Verify with Steam", url: base }] }] : [];
        let r;
        try { r = await service.grantVerified(i.guildId, i.user.id); }
        catch { return eph(i, "I could not give the role. My role must be above Steam Verified in Server Settings, Roles."); }
        if (r === "granted") return i.reply({ content: `You are verified ✅ and now have the Steam Verified role.${base ? `\nTip: press below to also show your Steam on your Discord profile (Linked Roles).` : ""}`, components: link, flags: EPHEMERAL });
        if (r === "no_role") return eph(i, "This server has no Steam Verified role yet. A manager can run `/community setup` or `/community verifyrole`.");
        if (!base) return eph(i, "Steam sign-in is not available on this bot right now.");
        return i.reply({ content: "Sign in through Steam first. It takes a few seconds on Steam's own page, and the bot never sees your password. Then press the button again here (or run `/steam verify`).", components: link, flags: EPHEMERAL });
    }

    async function handleCommand(i) {
        if (!isHidden(i.guildId)) db.bumpUsage(`cmd:${i.commandName}${i.options?.getSubcommand?.(false) ? "/" + i.options.getSubcommand(false) : ""}`);
        switch (i.commandName) {
            case "community": return community(i);
            case "rank": return rank(i);
            case "levels": return levels(i);
            case "leaderboardrefresh": return leaderboardRefresh(i);
            case "invites": return invites(i);
            case "emoji": return emoji(i);
            default: throw new UserError("Unknown command");
        }
    }
    return { handleCommand, roleButton, verify, verifyButtonId: VERIFY_ID };
}

export function setupSummary(r, publicUrl, guildId, membersIntent) {
    const list = a => (a.length ? a.join(", ") : "nothing new, it was already there");
    return { color: 0x57f287, title: "Your community is set up",
        description: [`**Categories:** ${list(r.created.categories)}`, `**Channels:** ${list(r.created.channels)}`, `**Roles:** ${list(r.created.roles)}`, "",
            "Welcome messages, XP and levels, invite tracking, the deal alerts, giveaways and support tickets are connected. Staff channels are only visible to the Moderator role and you.",
            "Next: give your staff the **Moderator** role, and keep my role above the roles I hand out.",
            ...(membersIntent ? [] : ["", "⚠️ Turn on **Server Members Intent** for the bot in the Discord Developer Portal so welcome messages and invite tracking can see new members."]),
            ...r.notes, publicUrl ? `\nFine-tune everything on the web: ${publicUrl}/#/community/${guildId}` : ""].join("\n").slice(0, 4000) };
}

export function statusEmbed(db, guildId, publicUrl, membersIntent) {
    const c = db.getCommunity(guildId), lr = db.listLevelRoles(guildId), rw = db.listRewards(guildId), sr = db.listSelfRoles(guildId);
    const ch = id => (id ? `<#${id}>` : "not set"), role = id => (id ? `<@&${id}>` : "not set");
    return { color: 0x5865f2, title: "Community settings",
        description: [`**Welcome:** ${c.welcome_on ? "on" : "off"} in ${ch(c.welcome_channel)} · private welcome ${c.welcome_dm ? "on" : "off"} · leave notes ${c.leave_on ? "on" : "off"}`,
            `**Auto role:** ${role(c.autorole_id)}`, `**Log channel:** ${ch(c.log_channel)}`,
            `**XP:** ${c.xp_on ? "on" : "off"} ×${c.xp_mult} · level-ups ${c.levelup_mode === "off" ? "off" : c.levelup_mode === "channel" ? `in ${ch(c.levelup_channel)}` : "where members chat"}`,
            `**Level roles:** ${lr.length ? lr.map(r => `${r.level} → ${role(r.role_id)}`).join(", ") : "none"}`,
            `**Referrals:** ${c.referral_xp} XP each${rw.length ? ` · ${rw.map(r => `${r.count} → ${role(r.role_id)}`).join(", ")}` : ""}`,
            `**Role picker:** ${sr.length} roles`,
            "", c.setup_at ? "Built with `/community setup`." : "Not built yet: `/community setup` creates the standard channels and roles.",
            ...(membersIntent ? [] : ["⚠️ Server Members Intent is off, so welcome messages and invite tracking are paused."]),
            publicUrl ? `Web page: ${publicUrl}/#/community/${guildId}` : ""].join("\n").slice(0, 4000) };
}

// Server tools for community managers: role menus, the starboard, polls, suggestions and custom commands.
// Everything talks to Discord through `api` (the bot's REST helper) and keeps its state in the database, so it survives restarts.

import { reportProblem } from "./guildproblems.js";

const GOLD = 0xffac33, BLURPLE = 0x5865f2, GREEN = 0x57f287, RED = 0xed4245, AMBER = 0xfee75c, GRAY = 0x99aab5;
const clip = (s, n) => (String(s ?? "").length > n ? String(s).slice(0, n - 1) + "…" : String(s ?? ""));
export const NO_PINGS = { parse: [], replied_user: false };

// ---------------------------------------------------------------- emoji
/** A button/reaction emoji from what a person typed: a custom <:name:id> or the first unicode emoji. Null when there is none. */
export function parseEmoji(text) {
    const t = String(text ?? "").trim();
    if (!t) return null;
    const c = /^<(a?):(\w{2,32}):(\d{15,25})>$/.exec(t);
    if (c) return { name: c[2], id: c[3], animated: c[1] === "a" };
    const u = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(t)][0]?.segment;
    return u && /\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]️?⃣/u.test(u) ? { name: u } : null;
}
export const emojiText = e => (e?.id ? `<${e.animated ? "a" : ""}:${e.name}:${e.id}>` : e?.name ?? "");
/** The path form the reaction endpoints want: the unicode itself, or name:id. */
const reactionPath = e => (e.id ? `${e.name}:${e.id}` : e.name);

// ---------------------------------------------------------------- role menus
const DANGEROUS = 0x8n | 0x10n | 0x20n | 0x2n | 0x4n | 0x2000n | 0x20000n | 0x10000000n | 0x20000000n | (1n << 40n);
/** A role a member may pick for themselves: not managed, not @everyone, and nothing that moderates or manages the server. */
export function roleIsSafe(role, guildId) {
    if (!role || role.managed || role.id === guildId) return false;
    try { return (BigInt(role.permissions ?? "0") & DANGEROUS) === 0n; } catch { return false; }
}

export function menuPayload(menu, items) {
    const buttons = items.map(it => {
        const e = parseEmoji(it.emoji);
        return { type: 2, style: 2, label: clip(it.label, 80), custom_id: `rm:${menu.id}:${it.role_id}`, ...(e ? { emoji: e } : {}) };
    });
    const rows = [];
    for (let i = 0; i < buttons.length && rows.length < 5; i += 5) rows.push({ type: 1, components: buttons.slice(i, i + 5) });
    const lines = items.length ? items.map(it => `${it.emoji ? parseEmoji(it.emoji) ? emojiText(parseEmoji(it.emoji)) + " " : "" : ""}<@&${it.role_id}>`) : [];
    return {
        embeds: [{
            color: BLURPLE, title: clip(menu.title, 200),
            description: clip([menu.description || (menu.mode === "single" ? "Press a button to pick your role. Picking another one swaps it." : "Press a button to get a role. Press it again to drop it."), "", ...(lines.length ? lines : ["*No roles yet. A manager is still setting this up.*"])].join("\n"), 4000),
            footer: { text: menu.mode === "single" ? "Pick one" : "Pick as many as you like" }
        }],
        components: rows, allowed_mentions: NO_PINGS
    };
}

export function createRoleMenus({ db, api }) {
    async function render(menuId) {
        const menu = db.getRoleMenu(menuId);
        if (!menu) return null;
        const payload = menuPayload(menu, db.roleMenuItems(menuId));
        if (menu.message_id) {
            try { await api.editMessage(menu.channel_id, menu.message_id, payload); return menu; }
            catch (e) { if (e?.status !== 404) throw e; }
        }
        const sent = await api.sendMessage(menu.channel_id, payload);
        db.setRoleMenuMessage(menuId, sent.id);
        return db.getRoleMenu(menuId);
    }
    async function create({ guildId, channelId, title, description, mode }) {
        if (db.countRoleMenus(guildId) >= 10) throw new Error("A server can have up to 10 role menus. Delete one first.");
        const id = db.createRoleMenu({ guild_id: guildId, channel_id: channelId, title: clip(title, 200), description: description ? clip(description, 1500) : null, mode });
        try { await render(id); } catch (e) { db.deleteRoleMenu(id, guildId); throw e; }
        return db.getRoleMenu(id);
    }
    async function addRole({ guildId, menuId, roleId, label, emoji }) {
        const menu = db.getRoleMenu(menuId);
        if (!menu || menu.guild_id !== guildId) throw new Error("That role menu is not in this server.");
        const items = db.roleMenuItems(menuId);
        if (items.length >= 25 && !items.some(x => x.role_id === roleId)) throw new Error("A menu holds up to 25 roles.");
        const role = (await api.allRoles(guildId)).find(r => r.id === roleId);
        if (!role) throw new Error("That role does not exist in this server.");
        if (!roleIsSafe(role, guildId)) throw new Error("Members can't pick that role themselves: it is managed by an app, or it can moderate or manage the server. Pick a plain role.");
        const e = emoji ? parseEmoji(emoji) : null;
        if (emoji && !e) throw new Error("That doesn't look like an emoji. Use a normal emoji or a custom one from this server.");
        db.addRoleMenuItem(menuId, roleId, clip(label || role.name, 80), e ? emojiText(e) : null);
        await render(menuId);
        return db.roleMenuItems(menuId);
    }
    async function removeRole({ guildId, menuId, roleId }) {
        const menu = db.getRoleMenu(menuId);
        if (!menu || menu.guild_id !== guildId) throw new Error("That role menu is not in this server.");
        if (!db.removeRoleMenuItem(menuId, roleId)) throw new Error("That role is not on the menu.");
        await render(menuId);
    }
    async function remove({ guildId, menuId }) {
        const menu = db.getRoleMenu(menuId);
        if (!menu || menu.guild_id !== guildId) throw new Error("That role menu is not in this server.");
        db.deleteRoleMenu(menuId, guildId);
        if (menu.message_id) await api.deleteMessage(menu.channel_id, menu.message_id).catch(() => {});
    }
    /** A member pressed a button: give or take the role. Returns the sentence to show them. */
    async function press(i) {
        const [, menuId, roleId] = i.customId.split(":");
        const menu = db.getRoleMenu(Number(menuId)), item = menu && db.roleMenuItems(menu.id).find(x => x.role_id === roleId);
        if (!menu || !item || menu.guild_id !== i.guildId) return "That role is not on the menu any more.";
        const has = i.member?.roles?.cache?.has?.(roleId) ?? false;
        try {
            if (has) { await api.removeRole(i.guildId, i.user.id, roleId); return `Removed <@&${roleId}>.`; }
            if (menu.mode === "single") for (const other of db.roleMenuItems(menu.id)) if (other.role_id !== roleId && i.member?.roles?.cache?.has?.(other.role_id)) await api.removeRole(i.guildId, i.user.id, other.role_id).catch(() => {});
            await api.addRole(i.guildId, i.user.id, roleId);
            db.bumpUsage?.("role_picks");
            return `You now have <@&${roleId}>.`;
        } catch (err) {
            reportProblem(db, i.guildId, `rolemenu:${menu.id}`, `give the ${item.label} role from a role menu`, err);
            return "I could not change that role. My role needs to sit above it in Server Settings, Roles.";
        }
    }
    return { create, addRole, removeRole, remove, render, press };
}

// ---------------------------------------------------------------- starboard
export const STAR_DEFAULTS = Object.freeze({ on: false, channel: null, threshold: 3, emoji: "⭐", selfStar: false });
export function cleanStarboard(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const e = parseEmoji(r.emoji ?? STAR_DEFAULTS.emoji) ?? { name: "⭐" };
    return { on: Boolean(r.on), channel: /^\d{15,25}$/.test(String(r.channel ?? "")) ? String(r.channel) : null, threshold: Math.min(25, Math.max(1, Math.trunc(Number(r.threshold)) || STAR_DEFAULTS.threshold)), emoji: emojiText(e), selfStar: Boolean(r.selfStar) };
}
export const getStarboard = (db, guildId) => cleanStarboard(db.getToolSetting("starboard", guildId));

const avatarOf = u => (u?.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u?.id ?? "0") >> 22n) % 6n)}.png`);
export function starPayload(msg, count, cfg, guildId) {
    const url = `https://discord.com/channels/${guildId}/${msg.channel_id}/${msg.id}`;
    const img = (msg.attachments ?? []).find(a => /^image\//.test(a.content_type ?? "") || /\.(png|jpe?g|gif|webp)$/i.test(a.filename ?? ""));
    const extra = (msg.attachments ?? []).filter(a => a !== img).length;
    const text = [msg.content, extra ? `*+${extra} more attachment${extra === 1 ? "" : "s"}*` : ""].filter(Boolean).join("\n");
    const e = parseEmoji(cfg.emoji);
    return {
        content: `${e ? emojiText(e) : "⭐"} **${count}** · <#${msg.channel_id}>`,
        embeds: [{ color: GOLD, author: { name: clip(msg.author?.global_name || msg.author?.username || "Someone", 80), icon_url: avatarOf(msg.author) }, description: clip(text, 3500) || undefined, ...(img ? { image: { url: img.url } } : {}), fields: [{ name: "​", value: `[Jump to the message](${url})` }], timestamp: msg.timestamp }],
        allowed_mentions: NO_PINGS
    };
}

export function createStarboard({ db, api, now = () => Date.now() }) {
    const busy = new Map();
    /** A reaction was added or removed (the gateway's raw `d`). Updates the starboard post when the count crosses the line. */
    async function onReaction(d) {
        const gid = d?.guild_id;
        if (!gid || !d.channel_id || !d.message_id) return false;
        const cfg = getStarboard(db, gid);
        if (!cfg.on || !cfg.channel || d.channel_id === cfg.channel) return false;
        const want = parseEmoji(cfg.emoji);
        if (!want || (want.id ? d.emoji?.id !== want.id : d.emoji?.name !== want.name || d.emoji?.id)) return false;
        const key = `${gid}:${d.message_id}`;
        if (busy.has(key)) { busy.set(key, true); return false; } // another update is running; it re-checks when it ends
        busy.set(key, false);
        try {
            do {
                busy.set(key, false);
                const msg = await api.getMessage(d.channel_id, d.message_id).catch(() => null);
                if (!msg || msg.author?.bot) return false;
                const ch = await api.getChannel(d.channel_id).catch(() => null);
                if (ch?.nsfw) return false;
                let count = (msg.reactions ?? []).find(r => (want.id ? r.emoji?.id === want.id : r.emoji?.name === want.name && !r.emoji?.id))?.count ?? 0;
                if (!cfg.selfStar && count > 0) {
                    const who = await api.reactionUsers(d.channel_id, d.message_id, reactionPath(want)).catch(() => []);
                    if (Array.isArray(who) && who.some(u => u.id === msg.author?.id)) count -= 1;
                }
                const post = db.getStarPost(gid, d.message_id);
                if (count >= cfg.threshold) {
                    const payload = starPayload(msg, count, cfg, gid);
                    if (post) { await api.editMessage(post.board_channel, post.board_id, payload).catch(() => {}); db.saveStarPost({ ...post, stars: count }); }
                    else {
                        const sent = await api.sendMessage(cfg.channel, payload);
                        db.saveStarPost({ guild_id: gid, source_id: d.message_id, source_channel: d.channel_id, board_id: sent.id, board_channel: cfg.channel, author_id: msg.author?.id, stars: count });
                    }
                } else if (post) {
                    if (count <= 0) { await api.deleteMessage(post.board_channel, post.board_id).catch(() => {}); db.deleteStarPost(gid, d.message_id); }
                    else { await api.editMessage(post.board_channel, post.board_id, starPayload(msg, count, cfg, gid)).catch(() => {}); db.saveStarPost({ ...post, stars: count }); }
                }
            } while (busy.get(key) === true);
            return true;
        } catch (err) { reportProblem(db, gid, "starboard", "post to the starboard", err); return false; }
        finally { busy.delete(key); }
    }
    /** All reactions were cleared from a message: take its post down. */
    async function onCleared(d) {
        const post = d?.guild_id && db.getStarPost(d.guild_id, d.message_id);
        if (!post) return false;
        await api.deleteMessage(post.board_channel, post.board_id).catch(() => {});
        return db.deleteStarPost(d.guild_id, d.message_id);
    }
    return { onReaction, onCleared };
}

// ---------------------------------------------------------------- polls
export const parseOptions = text => [...new Set(String(text ?? "").split(/[|\n;]+/).map(s => s.trim()).filter(Boolean))].map(s => clip(s, 80)).slice(0, 10);

export function pollPayload(poll, votes, { final = false } = {}) {
    const counts = poll.options.map((_, i) => votes.filter(v => v.option === i).length);
    const voters = new Set(votes.map(v => v.user_id)).size, top = Math.max(0, ...counts);
    const lines = poll.options.map((o, i) => {
        const pct = voters ? Math.round(counts[i] / voters * 100) : 0, filled = voters ? Math.round(counts[i] / Math.max(1, voters) * 12) : 0;
        return `${final && counts[i] === top && top > 0 ? "🏆 " : ""}**${o}**\n\`${"█".repeat(filled)}${"░".repeat(12 - filled)}\` ${counts[i]} · ${pct}%`;
    });
    const ends = poll.ends_at && !final ? ` · ends <t:${Math.floor(poll.ends_at / 1000)}:R>` : "";
    const payload = {
        embeds: [{ color: final ? GRAY : BLURPLE, title: `📊 ${clip(poll.question, 240)}`, description: lines.join("\n\n"), footer: { text: `${voters} ${voters === 1 ? "vote" : "votes"} · ${poll.multi ? "pick as many as you like" : "pick one"}${final ? " · ended" : ""}` }, ...(ends ? { fields: [{ name: "​", value: ends.slice(3) }] } : {}) }],
        allowed_mentions: NO_PINGS
    };
    payload.components = final ? [] : [0, 5].filter(s => s < poll.options.length).map(s => ({ type: 1, components: poll.options.slice(s, s + 5).map((o, k) => ({ type: 2, style: 2, label: clip(o, 80), custom_id: `pl:${poll.id}:${s + k}` })) }));
    return payload;
}

export function createPolls({ db, api, now = () => Date.now() }) {
    async function create({ guildId, channelId, question, options, hours = 0, multi = false, by }) {
        if (options.length < 2) throw new Error("A poll needs at least two options. Separate them with | .");
        if (db.countOpenPolls(guildId) >= 10) throw new Error("This server already has 10 open polls. End one first.");
        const id = db.createPoll({ guild_id: guildId, channel_id: channelId, question: clip(question, 240), options, multi, ends_at: hours > 0 ? now() + hours * 3600_000 : null, created_by: by });
        const poll = db.getPoll(id);
        try { const sent = await api.sendMessage(channelId, pollPayload(poll, [])); db.setPollMessage(id, sent.id); }
        catch (e) { db.closePoll(id); throw e; }
        return db.getPoll(id);
    }
    async function end(id, guildId = null) {
        const poll = db.getPoll(id);
        if (!poll || (guildId && poll.guild_id !== guildId)) throw new Error("That poll is not in this server.");
        if (poll.closed) throw new Error("That poll has already ended.");
        db.closePoll(id);
        if (poll.message_id) await api.editMessage(poll.channel_id, poll.message_id, pollPayload(poll, db.pollVotes(id), { final: true })).catch(() => {});
        return poll;
    }
    async function vote(i) {
        const [, id, opt] = i.customId.split(":");
        const poll = db.getPoll(Number(id));
        if (!poll || poll.guild_id !== i.guildId) return i.reply({ content: "That poll is gone.", flags: 64 });
        if (poll.closed) return i.reply({ content: "This poll has ended.", flags: 64 });
        const n = Number(opt);
        if (!(n >= 0 && n < poll.options.length)) return i.reply({ content: "That option is not on this poll.", flags: 64 });
        db.castVote(poll.id, i.user.id, n, poll.multi);
        return i.update(pollPayload(poll, db.pollVotes(poll.id)));
    }
    /** Closes polls whose time is up. Called every minute. */
    async function tick() {
        for (const p of db.pollsDue(now())) await end(p.id).catch(err => reportProblem(db, p.guild_id, "poll", "close a poll", err));
    }
    return { create, end, vote, tick };
}

// ---------------------------------------------------------------- suggestions
export const SUGGEST_STATUS = { open: { label: "Open", color: BLURPLE, icon: "🗳️" }, considering: { label: "Considering", color: AMBER, icon: "🤔" }, approved: { label: "Approved", color: GREEN, icon: "✅" }, done: { label: "Done", color: GREEN, icon: "🎉" }, denied: { label: "Not planned", color: RED, icon: "❌" } };
export function cleanSuggest(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    return { channel: /^\d{15,25}$/.test(String(r.channel ?? "")) ? String(r.channel) : null, role: /^\d{15,25}$/.test(String(r.role ?? "")) ? String(r.role) : null };
}
export const getSuggestCfg = (db, guildId) => cleanSuggest(db.getToolSetting("suggest", guildId));

export function suggestionPayload(s, votes) {
    const st = SUGGEST_STATUS[s.status] ?? SUGGEST_STATUS.open;
    const open = s.status === "open" || s.status === "considering";
    return {
        embeds: [{ color: st.color, title: `${st.icon} Suggestion #${s.id}`, description: clip(s.text, 3800), fields: [{ name: "From", value: `<@${s.author_id}>`, inline: true }, { name: "Status", value: st.label, inline: true }, ...(s.note ? [{ name: "Answer", value: clip(s.note, 1000) }] : [])], timestamp: new Date(s.created_at).toISOString() }],
        components: open ? [{ type: 1, components: [{ type: 2, style: 3, label: String(votes.up), emoji: { name: "👍" }, custom_id: `sg:${s.id}:up` }, { type: 2, style: 4, label: String(votes.down), emoji: { name: "👎" }, custom_id: `sg:${s.id}:down` }] }] : [],
        allowed_mentions: NO_PINGS
    };
}

export function createSuggestions({ db, api, now = () => Date.now() }) {
    async function submit({ guildId, userId, text }) {
        const cfg = getSuggestCfg(db, guildId);
        if (!cfg.channel) throw new Error("This server has not set up suggestions yet. A manager can with `/manage suggestions setup`.");
        const t = String(text ?? "").trim();
        if (t.length < 10) throw new Error("Tell us a bit more: a suggestion needs at least 10 characters.");
        if (t.length > 1500) throw new Error("That is too long. Keep a suggestion under 1,500 characters.");
        if (now() - db.lastSuggestionAt(guildId, userId) < 60_000) throw new Error("Slow down a little. You can send one suggestion a minute.");
        const id = db.createSuggestion({ guild_id: guildId, channel_id: cfg.channel, author_id: userId, text: t });
        try { const sent = await api.sendMessage(cfg.channel, suggestionPayload(db.getSuggestion(id), { up: 0, down: 0 })); db.setSuggestionMessage(id, sent.id); }
        catch (e) { db.decideSuggestion(id, guildId, "denied", "Could not be posted.", null); reportProblem(db, guildId, "suggest", "post a suggestion", e); throw new Error("I could not post it in the suggestions channel. A manager needs to give me permission to write there."); }
        return db.getSuggestion(id);
    }
    async function decide({ guildId, id, status, note, by }) {
        if (!SUGGEST_STATUS[status]) throw new Error("Pick a status: open, considering, approved, done or denied.");
        const s = db.getSuggestion(id);
        if (!s || s.guild_id !== guildId) throw new Error("There is no suggestion with that number in this server.");
        db.decideSuggestion(id, guildId, status, note ? clip(note, 1000) : null, by);
        const now2 = db.getSuggestion(id);
        if (now2.message_id && now2.channel_id) await api.editMessage(now2.channel_id, now2.message_id, suggestionPayload(now2, db.suggestionVotes(id))).catch(() => {});
        return now2;
    }
    async function vote(i) {
        const [, id, dir] = i.customId.split(":");
        const s = db.getSuggestion(Number(id));
        if (!s || s.guild_id !== i.guildId) return i.reply({ content: "That suggestion is gone.", flags: 64 });
        if (s.status !== "open" && s.status !== "considering") return i.reply({ content: "Voting on this one has closed.", flags: 64 });
        const votes = db.voteSuggestion(s.id, i.user.id, dir === "up" ? 1 : -1);
        return i.update(suggestionPayload(s, votes));
    }
    return { submit, decide, vote };
}

// ---------------------------------------------------------------- custom commands
export const TAG_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const cleanTagName = n => String(n ?? "").trim().toLowerCase().replace(/^[!/]+/, "");
export function saveTagChecked(db, guildId, rawName, response, by) {
    const name = cleanTagName(rawName), text = String(response ?? "").trim();
    if (!TAG_NAME.test(name)) throw new Error("A command name is 1 to 32 letters, numbers, dashes or underscores.");
    if (!text) throw new Error("Write what the command should say.");
    if (text.length > 1800) throw new Error("Keep the answer under 1,800 characters.");
    if (!db.getTag(guildId, name) && db.countTags(guildId) >= 100) throw new Error("A server can have up to 100 custom commands.");
    db.saveTag(guildId, name, text, by);
    return name;
}

// Mirrors feature requests into each server's #feature-requests forum: one post per request, with a tag for its status.
// Everything is best effort: a server where the forum was deleted or the bot lost access is skipped, never an error for the member.
import { REQUEST_STATUSES } from "./requeststore.js";
import { isHidden } from "./hidden.js";

const sleepDefault = ms => new Promise(r => setTimeout(r, ms));
const COLOR = { open: 0x5865f2, planned: 0x3498db, in_development: 0xf1c40f, shipped: 0x57f287, rejected: 0xed4245, duplicate: 0x95a5a6, on_hold: 0xe67e22 };

/** The tags a new forum starts with, one per status. */
export const forumTags = () => Object.values(REQUEST_STATUSES).map(name => ({ name }));

export function requestEmbed(r, { base = null, votes = 0 } = {}) {
    return { color: COLOR[r.status] ?? 0x5865f2, title: String(r.title).slice(0, 250),
        description: [r.body || "", r.note ? `**From the developer:** ${r.note}` : ""].filter(Boolean).join("\n\n").slice(0, 3500) || "No details given.",
        fields: [{ name: "Status", value: REQUEST_STATUSES[r.status] ?? r.status, inline: true }, { name: "Votes", value: String(votes), inline: true }, { name: "Suggested by", value: r.user_name || "A member", inline: true }],
        footer: { text: base ? `Vote or suggest your own on the dashboard: ${base.replace(/^https?:\/\//, "")}/#/requests` : "Vote or suggest your own on the dashboard" } };
}

/** name -> tag id for a forum, adding any status tag that is missing. */
export async function tagMap(api, channelId) {
    const ch = await api.getChannel(channelId);
    let tags = ch.available_tags ?? [];
    const missing = Object.values(REQUEST_STATUSES).filter(n => !tags.some(t => t.name === n));
    if (missing.length && tags.length + missing.length <= 20) {
        const r = await api.editChannel(channelId, { available_tags: [...tags.map(t => ({ id: t.id, name: t.name, moderated: t.moderated, emoji_id: t.emoji_id, emoji_name: t.emoji_name })), ...missing.map(name => ({ name }))] }).catch(() => null);
        if (r?.available_tags) tags = r.available_tags;
    }
    return Object.fromEntries(Object.entries(REQUEST_STATUSES).map(([k, n]) => [k, tags.find(t => t.name === n)?.id ?? null]));
}

const votesOf = (db, id) => db.requestVotes(id);

/** Posts a request in every forum that does not have it yet (or only in `guildId`). Returns how many posts were made. */
export async function publishRequest({ db, api, id, base = null, guildId = null, sleep = sleepDefault, pace = 400 }) {
    const r = db.getRequest(id);
    if (!r) return 0;
    const have = new Set(db.requestPosts(id).map(p => p.guild_id));
    let made = 0;
    for (const f of db.requestForums()) {
        if (isHidden(f.guild_id) || have.has(f.guild_id) || (guildId && f.guild_id !== guildId)) continue;
        try {
            const tags = await tagMap(api, f.channel_id);
            const post = await api.createForumPost(f.channel_id, { name: String(r.title).slice(0, 100), applied_tags: tags[r.status] ? [tags[r.status]] : [],
                message: { embeds: [requestEmbed(r, { base, votes: votesOf(db, id) })], allowed_mentions: { parse: [] } } });
            db.addRequestPost(id, f.guild_id, post.id); made++;
        } catch { /* forum gone or no access: skip this server */ }
        await sleep(pace);
    }
    return made;
}

/** After a status or note change: move the tag and rewrite the first message in every server. */
export async function refreshRequest({ db, api, id, base = null, sleep = sleepDefault, pace = 400 }) {
    const r = db.getRequest(id);
    if (!r) return 0;
    let n = 0;
    for (const p of db.requestPosts(id)) {
        const f = db.requestForums().find(x => x.guild_id === p.guild_id);
        if (!f || isHidden(p.guild_id)) continue;
        try {
            const tags = await tagMap(api, f.channel_id);
            await api.editChannel(p.thread_id, { applied_tags: tags[r.status] ? [tags[r.status]] : [], archived: false });
            await api.editMessage(p.thread_id, p.thread_id, { embeds: [requestEmbed(r, { base, votes: votesOf(db, id) })] });
            n++;
        } catch (e) { if (e?.status === 404) db.dropRequestPost(id, p.guild_id); }
        await sleep(pace);
    }
    return n;
}

/** Removes a request's posts everywhere (the owner deleted it). Call before the request row is deleted. */
export async function removeRequestPosts({ db, api, id, sleep = sleepDefault, pace = 400 }) {
    for (const p of db.requestPosts(id)) { await api.deleteChannel(p.thread_id).catch(() => {}); await sleep(pace); }
}

/** A forum that was just set up gets the most recent requests so it is not empty. */
export async function backfillForum({ db, api, guildId, base = null, limit = 15, sleep = sleepDefault, pace = 400 }) {
    let n = 0;
    for (const r of db.recentRequests(limit).reverse()) n += await publishRequest({ db, api, id: r.id, base, guildId, sleep, pace });
    return n;
}

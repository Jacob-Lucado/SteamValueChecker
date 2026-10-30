// Messages for giveaways: plain Discord API objects, so they can be tested without Discord and sent by the bot or the dashboard.
// Prize keys appear only in the private DM or reply sent to the winner (keyMessage). Nothing else here ever receives one.

const COLOR = 0xff9800;
const GREEN = 0x57f287;
const GREY = 0x8b95a5;
const RED = 0xed4245;
import { isVideoLink } from "./gwparse.js";
import { crossServerParts, stepRows } from "./gwpartner.js";
const GALLERY_URL = "https://store.steampowered.com/";
const safeUrl = u => (typeof u === "string" && /^https:\/\//i.test(u) ? u : undefined);
const ts = (ms, f = "R") => `<t:${Math.floor(ms / 1000)}:${f}>`;
const role = id => `<@&${id}>`;

export const ID = { enter: "gw_enter", claim: "gw_claim", confirm: "gw_confirm", problem: "gw_problem", keysModal: "gw_keys", replaceModal: "gw_replace" };

export const messageLink = g => (g.message_id ? `https://discord.com/channels/${g.guild_id}/${g.channel_id}/${g.message_id}` : null);

/** "Hades x2, Celeste" for the prize list, in the order the host listed them. */
export function prizeSummary(keys) {
    const order = [];
    const count = new Map();
    for (const k of keys) { if (!count.has(k.label)) order.push(k.label); count.set(k.label, (count.get(k.label) ?? 0) + 1); }
    return order.map((label, i) => `${i + 1}. **${label}**${count.get(label) > 1 ? ` ×${count.get(label)}` : ""}`);
}

function requirements(g) {
    const r = [];
    if (g.require_boost) r.push("Server boosters only");
    if (g.require_role_id) r.push(`Must have ${role(g.require_role_id)}`);
    if (g.min_account_days) r.push(`Discord account at least ${g.min_account_days} days old`);
    if (g.min_member_days) r.push(`In this server at least ${g.min_member_days} days`);
    if (g.bonus_role_id && g.bonus_entries > 1) r.push(`${role(g.bonus_role_id)} get ${g.bonus_entries} entries`);
    return r;
}

/** The giveaway post. state: "active" | "ended" | "cancelled". */
export function giveawayPayload(g, keys, entryCount, state = g.status) {
    const lines = prizeSummary(keys);
    const cross = g.is_global && g.host_name ? crossServerParts(g) : null; // a cross-server giveaway says so and who hosts it
    const shown = lines.slice(0, 15);
    if (lines.length > shown.length) shown.push(`…and ${lines.length - shown.length} more`);
    const fields = [
        { name: keys.length === 1 ? "Prize" : `Prizes (${keys.length})`, value: shown.join("\n").slice(0, 1000) || "-" },
        { name: state === "active" ? "Ends" : "Ended", value: state === "active" ? `${ts(g.ends_at)} (${ts(g.ends_at, "f")})` : ts(g.ended_at ?? g.ends_at), inline: true },
        { name: "Hosted by", value: cross ? cross.hostLine : g.host_id === "deleted" ? "-" : `<@${g.host_id}>`, inline: true },
        { name: "Entries", value: String(entryCount), inline: true }
    ];
    const req = requirements(g);
    if (req.length) fields.push({ name: "Requirements", value: req.join("\n").slice(0, 1000) });
    if (cross?.howToEnter && state === "active") fields.push({ name: "How to enter", value: `${cross.howToEnter}\n\n${cross.stepsNote}`.slice(0, 1020) });

    // A video can't sit inside an embed, so its link goes in the message text where Discord plays it.
    const video = safeUrl(g.image_url) && isVideoLink(g.image_url);
    const embed = {
        color: state === "cancelled" ? GREY : (g.color ?? COLOR),
        title: state === "cancelled" ? `${g.title} (cancelled)` : g.title,
        description: g.description ?? undefined,
        fields,
        image: safeUrl(g.image_url) && !video ? { url: g.image_url } : undefined,
        thumbnail: safeUrl(g.thumbnail_url) && !isVideoLink(g.thumbnail_url) ? { url: g.thumbnail_url } : undefined,
        author: cross?.author,
        footer: state === "active" ? { text: cross ? `${cross.footerNote}  •  Press the button to enter. Press it again to leave.` : "Press the button to enter. Press it again to leave." } : cross ? { text: cross.footerNote } : undefined
    };
    const enter = {
        type: 2, style: 3, custom_id: `${ID.enter}:${g.id}`, disabled: state !== "active",
        label: state === "active" ? (g.button_label || "Enter giveaway") : state === "cancelled" ? "Cancelled" : "Ended"
    };
    // Embeds that share a url are shown by Discord as one picture gallery, so extra prize art rides in extra embeds.
    const extra = [];
    try { extra.push(...JSON.parse(g.gallery || "[]").filter(u => safeUrl(u) && !isVideoLink(u)).slice(0, 3)); } catch { /* ignore a bad value */ }
    const embeds = [embed];
    if (extra.length && embed.image) {
        embed.url = GALLERY_URL;
        for (const u of extra) embeds.push({ url: GALLERY_URL, image: { url: u } });
    }
    const payload = { embeds, components: [{ type: 1, components: [enter] }, ...(cross && state === "active" ? stepRows(cross.buttons) : [])] };
    const ping = state === "active" && g.ping_role_id ? role(g.ping_role_id) : null;
    const content = [ping, video ? g.image_url : null].filter(Boolean).join("\n");
    if (content) payload.content = content;
    if (ping) payload.allowedMentions = { roles: [g.ping_role_id] };
    return payload;
}

const ICON = { assigned: "⏳", delivered: "📨", confirmed: "✅", problem: "⚠️", available: "➖", expired: "⌛", returned: "➖" };
const STATUS = { assigned: "waiting to claim", delivered: "key sent", confirmed: "redeemed", problem: "reported a problem", available: "no winner", expired: "expired", returned: "no winner" };

/** The winners message, kept up to date as people claim and confirm. */
export function winnersPayload(g, keys) {
    const mentions = [];
    const lines = keys.map(k => {
        if (k.winner_id) mentions.push(k.winner_id);
        return `${ICON[k.status] ?? "•"} **${k.label}** → ${k.winner_id ? `<@${k.winner_id}>` : "no winner"} (${STATUS[k.status] ?? k.status})`;
    });
    const waiting = keys.some(k => ["assigned", "delivered", "problem"].includes(k.status) && k.winner_id);
    const embed = {
        color: GREEN, title: `Winners: ${g.title}`,
        author: g.is_global && g.host_name ? { name: `🌐 Cross-server giveaway · hosted by ${g.host_name}` } : undefined,
        description: lines.join("\n").slice(0, 4000),
        footer: { text: `Winners have ${g.claim_hours} hours to press Claim key` }
    };
    const payload = {
        content: mentions.length ? `🎉 Congratulations ${[...new Set(mentions)].slice(0, 30).map(id => `<@${id}>`).join(" ")}! Press **Claim key** below.` : undefined,
        embeds: [embed], allowedMentions: { users: [...new Set(mentions)].slice(0, 30) },
        components: waiting ? [{ type: 1, components: [{ type: 2, style: 3, label: "Claim key", custom_id: `${ID.claim}:${g.id}` }] }] : []
    };
    return payload;
}

/** The private message that carries the key. */
export function keyMessage(g, label, plain, { fallback = false } = {}) {
    return {
        content: fallback ? "Your DMs are closed, Here's your prize:" : undefined,
        embeds: [{
            color: GREEN, title: `Your prize: ${label}`,
            description: `From **${g.title}**\n\n\`\`\`\n${plain}\n\`\`\``,
            footer: { text: "Keep this private. After you redeem it you will be asked to confirm. You can press Claim key again if you lose this message." }
        }]
    };
}

/** "Did it work?" prompt, sent to the winner by DM or, if DMs are closed, in the giveaway channel. */
export function confirmPayload(g, key, { reminder = false } = {}) {
    return {
        embeds: [{
            color: COLOR, title: reminder ? "Reminder: did your key work?" : "Did your key work?",
            description: `You won **${key.label}** in **${g.title}**. Once you have redeemed it, let us know. Confirming also posts a short thank-you in the server's vouches channel.`
        }],
        components: [{ type: 1, components: [
            { type: 2, style: 3, label: "Yes, it redeemed", custom_id: `${ID.confirm}:${key.id}` },
            { type: 2, style: 4, label: "It didn't work", custom_id: `${ID.problem}:${key.id}` }
        ] }]
    };
}

/** Posted in the vouches channel. */
export function vouchPayload(g, key, winnerId) {
    const link = messageLink(g);
    return {
        embeds: [{
            color: GREEN, title: "✅ Verified",
            description: `<@${winnerId}> confirmed that their **${key.label}** key redeemed successfully.`,
            fields: [
                { name: "Giveaway", value: link ? `[${g.title}](${link})` : g.title, inline: true },
                { name: "Hosted by", value: g.host_id === "deleted" ? "-" : `<@${g.host_id}>`, inline: true }
            ],
            timestamp: new Date().toISOString()
        }],
        allowedMentions: { parse: [] }
    };
}

/** For the host: where each prize is. Never shows key values. */
export function infoPayload(g, keys, entryCount) {
    const lines = keys.map(k => `${ICON[k.status] ?? "•"} **${k.position}. ${k.label}** ${k.winner_id ? `→ <@${k.winner_id}> ` : ""}(${STATUS[k.status] ?? k.status})`);
    return {
        embeds: [{
            color: g.color ?? COLOR, title: g.title,
            description: lines.join("\n").slice(0, 4000) || "No prizes.",
            fields: [
                { name: "Status", value: g.status, inline: true }, { name: "Entries", value: String(entryCount), inline: true },
                { name: g.status === "active" ? "Ends" : "Ended", value: ts(g.ended_at ?? g.ends_at), inline: true }
            ],
            footer: { text: "Prize keys are never shown here" }
        }],
        allowedMentions: { parse: [] }
    };
}

/** Sent to the host with prizes nobody won (or that were cancelled). */
export function leftoverMessage(g, rows, why) {
    const text = rows.map(r => `${r.label} | ${r.plain}`).join("\n");
    return {
        embeds: [{
            color: COLOR, title: `Unused prizes from "${g.title}"`,
            description: `${why}\n\n\`\`\`\n${text.slice(0, 3500)}\n\`\`\`\nThe bot has deleted its copy.`
        }]
    };
}

export const hostNote = (g, text) => ({ embeds: [{ color: COLOR, title: g.title, description: text.slice(0, 3900), url: safeUrl(messageLink(g)) }] });
export const redColor = RED;

// Messages for giveaways: plain Discord API objects, so they can be tested without Discord and sent by the bot or the dashboard.
// Prize keys appear only in the private DM or reply sent to the winner (keyMessage). Nothing else here ever receives one.

const COLOR = 0xff9800;
const GREEN = 0x57f287;
const GREY = 0x8b95a5;
const RED = 0xed4245;
import { isVideoLink } from "./gwparse.js";
import { crossServerParts, stepRows } from "./gwpartner.js";
import { kindInfo, isCode, theme } from "./prizes.js";
const GALLERY_URL = "https://store.steampowered.com/";
const safeUrl = u => (typeof u === "string" && /^https:\/\//i.test(u) ? u : undefined);
const ts = (ms, f = "R") => `<t:${Math.floor(ms / 1000)}:${f}>`;
const role = id => `<@&${id}>`;

export const ID = { enter: "gw_enter", claim: "gw_claim", confirm: "gw_confirm", problem: "gw_problem", keysModal: "gw_keys", replaceModal: "gw_replace" };

export const messageLink = g => (g.message_id ? `https://discord.com/channels/${g.guild_id}/${g.channel_id}/${g.message_id}` : null);

/** "🎮 **Hades** ×2" for the prize list, in the order the host listed them. Each prize type has its own icon. */
export function prizeSummary(keys) {
    const order = [];
    const count = new Map();
    const id = k => `${k.kind ?? "key"}\u0000${k.label}`;
    for (const k of keys) { if (!count.has(id(k))) order.push(k); count.set(id(k), (count.get(id(k)) ?? 0) + 1); }
    return order.map(k => `${kindInfo(k.kind).icon} **${k.label}**${count.get(id(k)) > 1 ? ` ×${count.get(id(k))}` : ""}`);
}

function requirements(g) {
    const r = [];
    if (g.require_boost) r.push("🚀 Server boosters only");
    if (g.require_role_id) r.push(`🎭 Must have ${role(g.require_role_id)}`);
    if (g.min_account_days) r.push(`🗓️ Discord account at least ${g.min_account_days} days old`);
    if (g.min_member_days) r.push(`⏳ In this server at least ${g.min_member_days} days`);
    if (g.bonus_role_id && g.bonus_entries > 1) r.push(`✨ ${role(g.bonus_role_id)} get ${g.bonus_entries} entries`);
    return r;
}

/** Who won what, for the finished giveaway post. */
function winnerLines(keys) {
    const won = keys.filter(k => k.winner_id && ["assigned", "delivered", "problem", "confirmed"].includes(k.status));
    return won.map(k => `${kindInfo(k.kind).icon} **${k.label}** → <@${k.winner_id}>${k.status === "confirmed" ? " ✅" : ""}`);
}

/** The giveaway post. state: "active" | "ended" | "cancelled". */
export function giveawayPayload(g, keys, entryCount, state = g.status) {
    const lines = prizeSummary(keys);
    const cross = g.is_global && g.host_name ? crossServerParts(g) : null; // a cross-server giveaway says so and who hosts it
    const th = theme(keys);
    const winners = state === "ended" ? winnerLines(keys) : [];
    const shown = lines.slice(0, 12);
    if (lines.length > shown.length) shown.push(`…and ${lines.length - shown.length} more`);

    // The prizes sit in a quote block under the host's own text, so the top of the post is the first thing people read.
    const prizeBlock = shown.map(l => `> ${l}`).join("\n");
    const description = [
        g.description ?? null,
        `**🏆 ${keys.length === 1 ? "PRIZE" : `PRIZES (${keys.length})`}**\n${prizeBlock}`.slice(0, 2600)
    ].filter(Boolean).join("\n\n");

    const fields = state === "active"
        ? [
            { name: "⏰ Ends", value: `${ts(g.ends_at)}\n${ts(g.ends_at, "f")}`, inline: true },
            { name: "👑 Hosted by", value: cross ? cross.hostLine : g.host_id === "deleted" ? "-" : `<@${g.host_id}>`, inline: true },
            { name: "🎟️ Entries", value: `**${entryCount}**`, inline: true }
        ]
        : [
            { name: "⏰ Ended", value: ts(g.ended_at ?? g.ends_at), inline: true },
            { name: "👑 Hosted by", value: cross ? cross.hostLine : g.host_id === "deleted" ? "-" : `<@${g.host_id}>`, inline: true },
            { name: "🎟️ Entries", value: `**${entryCount}**`, inline: true }
        ];
    if (state === "ended") fields.push({ name: winners.length ? (winners.length === 1 ? "🎉 Winner" : `🎉 Winners (${winners.length})`) : "😔 No winner", value: (winners.join("\n") || "Nobody entered, so nobody won.").slice(0, 1000) });
    const req = requirements(g);
    if (req.length && state === "active") fields.push({ name: "📋 To enter", value: req.join("\n").slice(0, 1000) });
    if (cross?.howToEnter && state === "active") fields.push({ name: "How to enter", value: `${cross.howToEnter}\n\n${cross.stepsNote}`.slice(0, 1020) });

    // A video can't sit inside an embed, so its link goes in the message text where Discord plays it.
    const video = safeUrl(g.image_url) && isVideoLink(g.image_url);
    const headline = state === "cancelled" ? "🚫 CANCELLED" : state === "ended" ? (winners.length ? "🏁 GIVEAWAY ENDED" : "🏁 GIVEAWAY ENDED · NO WINNER") : `${th.icon} ${th.name}`;
    const embed = {
        color: state === "cancelled" ? GREY : state === "ended" ? (winners.length ? GREEN : GREY) : (g.color ?? th.color),
        author: cross?.author ?? { name: headline },
        title: state === "cancelled" ? `${g.title} (cancelled)` : g.title,
        description,
        fields,
        image: safeUrl(g.image_url) && !video ? { url: g.image_url } : undefined,
        thumbnail: safeUrl(g.thumbnail_url) && !isVideoLink(g.thumbnail_url) ? { url: g.thumbnail_url } : undefined,
        footer: { text: state === "active"
            ? (cross ? `${cross.footerNote}  •  Press the button to enter, press it again to leave` : `Giveaway #${g.id}  •  Press the button to enter, press it again to leave`)
            : (cross ? cross.footerNote : `Giveaway #${g.id}`) },
        timestamp: state === "active" && g.ends_at ? new Date(g.ends_at).toISOString() : undefined
    };
    const enter = {
        type: 2, style: 3, custom_id: `${ID.enter}:${g.id}`, disabled: state !== "active",
        label: state === "active" ? (g.button_label || "Enter giveaway") : state === "cancelled" ? "Cancelled" : "Ended",
        emoji: { name: state === "active" ? "🎉" : state === "cancelled" ? "🚫" : "🏁" }
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

/** Status wording that fits the prize: a code is "sent" and "redeemed", money is "on its way" and "received". */
const statusText = k => (isCode(k.kind) ? STATUS[k.status] : ({ delivered: "host will send it", confirmed: "received" }[k.status] ?? STATUS[k.status])) ?? k.status;
const ICON = { assigned: "⏳", delivered: "📨", confirmed: "✅", problem: "⚠️", available: "➖", expired: "⌛", returned: "➖" };
const STATUS = { assigned: "waiting to claim", delivered: "key sent", confirmed: "redeemed", problem: "reported a problem", available: "no winner", expired: "expired", returned: "no winner" };

/** The winners message, kept up to date as people claim and confirm. */
export function winnersPayload(g, keys) {
    const mentions = [];
    const lines = keys.map(k => {
        if (k.winner_id) mentions.push(k.winner_id);
        return `${ICON[k.status] ?? "•"} ${kindInfo(k.kind).icon} **${k.label}** → ${k.winner_id ? `<@${k.winner_id}>` : "no winner"} · *${statusText(k)}*`;
    });
    const waiting = keys.some(k => ["assigned", "delivered", "problem"].includes(k.status) && k.winner_id);
    const embed = {
        color: GREEN, title: `🏆 Winners: ${g.title}`,
        author: g.is_global && g.host_name ? { name: `🌐 Cross-server giveaway · hosted by ${g.host_name}` } : { name: "🎉 CONGRATULATIONS" },
        description: lines.join("\n").slice(0, 4000),
        thumbnail: safeUrl(g.thumbnail_url) && !isVideoLink(g.thumbnail_url) ? { url: g.thumbnail_url } : undefined,
        footer: { text: `${g.is_global ? "" : `Giveaway #${g.id}  •  `}Winners have ${g.claim_hours} hours to press Claim prize` }
    };
    const payload = {
        content: mentions.length ? `🎉 Congratulations ${[...new Set(mentions)].slice(0, 30).map(id => `<@${id}>`).join(" ")}! Press **Claim prize** below.` : undefined,
        embeds: [embed], allowedMentions: { users: [...new Set(mentions)].slice(0, 30) },
        components: waiting ? [{ type: 1, components: [{ type: 2, style: 3, label: "Claim prize", emoji: { name: "🎁" }, custom_id: `${ID.claim}:${g.id}` }] }] : []
    };
    return payload;
}

/** The private message that carries the key, or tells the winner what happens next for a prize the host sends themselves. */
export function keyMessage(g, label, plain, { fallback = false, kind = "key" } = {}) {
    const info = kindInfo(kind);
    const host = g.host_id && g.host_id !== "deleted" ? `<@${g.host_id}>` : "the host";
    const manual = !isCode(kind);
    return {
        content: fallback ? "Your DMs are closed, so here's your prize:" : undefined,
        embeds: [{
            color: GREEN, title: `${info.icon} Your prize: ${label}`,
            description: manual
                ? `From **${g.title}**\n\n${host} will send this to you directly, so keep an eye on your DMs and make sure you can receive messages from them.${plain && plain !== "-" ? `\n\n**Note from the host:**\n${plain}` : ""}`
                : `From **${g.title}**\n\n\`\`\`\n${plain}\n\`\`\`${kind === "nitro" ? "\nOpen the link while signed in to Discord to claim your Nitro." : ""}`,
            footer: { text: manual ? "When it arrives you will be asked to confirm. You can press Claim prize again to see this message." : "Keep this private. After you redeem it you will be asked to confirm. You can press Claim prize again if you lose this message." }
        }]
    };
}

/** "Did it work?" prompt, sent to the winner by DM or, if DMs are closed, in the giveaway channel. */
export function confirmPayload(g, key, { reminder = false } = {}) {
    return {
        embeds: [{
            color: COLOR, title: isCode(key.kind) ? (reminder ? "Reminder: did your key work?" : "Did your key work?") : (reminder ? "Reminder: did your prize arrive?" : "Did your prize arrive?"),
            description: `You won **${key.label}** in **${g.title}**. ${isCode(key.kind) ? "Once you have redeemed it" : "Once you have received it"}, let us know. Confirming also posts a short thank-you in the server's vouches channel.`
        }],
        components: [{ type: 1, components: [
            { type: 2, style: 3, label: isCode(key.kind) ? "Yes, it redeemed" : "Yes, I got it", custom_id: `${ID.confirm}:${key.id}` },
            { type: 2, style: 4, label: isCode(key.kind) ? "It didn't work" : "Not yet", custom_id: `${ID.problem}:${key.id}` }
        ] }]
    };
}

/** Posted in the vouches channel. */
export function vouchPayload(g, key, winnerId) {
    const link = messageLink(g);
    return {
        embeds: [{
            color: GREEN, title: "✅ Verified",
            description: `<@${winnerId}> confirmed that their ${kindInfo(key.kind).icon} **${key.label}** ${isCode(key.kind) ? "key redeemed successfully" : "prize arrived"}.`,
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
    const text = rows.map(r => (isCode(r.kind) ? `${r.label} | ${r.plain}` : `${r.label} | (nothing to send back, you pay this one yourself)`)).join("\n");
    return {
        embeds: [{
            color: COLOR, title: `Unused prizes from "${g.title}"`,
            description: `${why}\n\n\`\`\`\n${text.slice(0, 3500)}\n\`\`\`\nThe bot has deleted its copy.`
        }]
    };
}

export const hostNote = (g, text) => ({ embeds: [{ color: COLOR, title: g.title, description: text.slice(0, 3900), url: safeUrl(messageLink(g)) }] });
export const redColor = RED;

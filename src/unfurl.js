// Link replies: when someone pastes a Steam store link in a server that turned this on, the bot answers with the game's price,
// its lows and a buy-or-wait verdict. It never edits or deletes the original message.

import { EmbedBuilder } from "discord.js";
import { loadGameData } from "./gamedata.js";
import { slugify } from "./gamepage.js";
import { money } from "./render.js";
import { reportProblem } from "./guildproblems.js";

const STORE_LINK = /https?:\/\/(?:www\.)?store\.steampowered\.com\/app\/(\d{1,9})(?![\d])/gi;
const COLORS = { buy: 0x57f287, lean_buy: 0x8fe3a8, lean_wait: 0xffab1f, wait: 0xf0883e };
const VERDICT = { buy: "🟢", lean_buy: "🟢", lean_wait: "🟠", wait: "🟠" };

/** The Steam app ids in a message, in order, no repeats, at most `max`. */
export function storeAppids(text, max = 2) {
    const out = [];
    for (const m of String(text ?? "").matchAll(STORE_LINK)) { const id = Number(m[1]); if (id > 0 && !out.includes(id)) out.push(id); if (out.length >= max) break; }
    return out;
}

/** The reply card for one game's data. */
export function unfurlEmbed(d, { origin = null } = {}) {
    const cur = d.currency || "USD";
    const off = Number.isFinite(d.price) && Number.isFinite(d.msrp) && d.msrp > d.price ? Math.round((1 - d.price / d.msrp) * 100) : 0;
    const e = new EmbedBuilder().setColor(COLORS[d.advice?.verdict] ?? 0xff9800).setTitle(String(d.title).slice(0, 200)).setThumbnail(d.image);
    if (origin) e.setURL(`${origin}/game/${d.appid}-${slugify(d.title)}`);
    const lines = [];
    if (Number.isFinite(d.price)) lines.push(`**${money(d.price, cur)}**${d.shop ? ` at ${d.shop}` : ""}${off ? ` · **${off}% off**` : ""}`);
    else lines.push("No current price found.");
    const facts = [];
    if (Number.isFinite(d.msrp)) facts.push(`Regular ${money(d.msrp, cur)}`);
    if (Number.isFinite(d.low1y)) facts.push(`12-month low ${money(d.low1y, cur)}`);
    if (Number.isFinite(d.atl)) facts.push(`All-time low ${money(d.atl, cur)}`);
    if (facts.length) lines.push(facts.join("  ·  "));
    e.setDescription(lines.join("\n"));
    if (d.advice) e.addFields({ name: `${VERDICT[d.advice.verdict] ?? ""} ${d.advice.label}`.trim(), value: String(d.advice.reasons?.[0] ?? "Based on a year of price history.").slice(0, 300) });
    e.setFooter({ text: "Steam Value Checker" });
    return e;
}

/**
 * `handle(message)` replies to a message that holds store links. It is quiet when the server has it off, when the bot can't write there,
 * and when the same game was answered in that server in the last ten minutes. One reply per message, at most two games.
 */
export function createUnfurl({ db, itad, origin = null, now = () => Date.now(), load = loadGameData }) {
    const recent = new Map(), lastByChannel = new Map();
    const prune = t => { if (recent.size > 500) for (const [k, at] of recent) if (t - at > 600_000) recent.delete(k); if (lastByChannel.size > 500) lastByChannel.clear(); };
    async function handle(m) {
        if (!m.guildId || !m.content || m.author?.bot || m.webhookId) return false;
        const ids = storeAppids(m.content);
        if (!ids.length || !db.getCommunity(m.guildId).unfurl_on) return false;
        const t = now(); prune(t);
        if (t - (lastByChannel.get(m.channelId) ?? 0) < 8000) return false;
        const fresh = ids.filter(id => t - (recent.get(`${m.guildId}:${id}`) ?? 0) > 600_000);
        if (!fresh.length) return false;
        const me = m.guild?.members?.me, perms = me ? m.channel.permissionsFor(me) : null;
        if (perms && !perms.has(["ViewChannel", "SendMessages", "EmbedLinks"])) return false;
        lastByChannel.set(m.channelId, t);
        const data = (await Promise.all(fresh.map(id => load(itad, id)))).filter(Boolean);
        if (!data.length) return false;
        for (const id of fresh) recent.set(`${m.guildId}:${id}`, t);
        try {
            await m.reply({ embeds: data.map(d => unfurlEmbed(d, { origin })), allowedMentions: { parse: [], repliedUser: false } });
            return true;
        } catch (err) { reportProblem(db, m.guildId, "unfurl", "reply to a Steam store link", err, t); return false; }
    }
    return { handle };
}

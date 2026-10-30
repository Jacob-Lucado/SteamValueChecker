// Server announcements: a manager designs an embed on the dashboard and the bot posts it in the server's #announcements channel.
import { UserError } from "./errors.js";

export const LIMITS = { title: 256, body: 4000, author: 100, footer: 200, fieldName: 100, fieldValue: 500, fields: 5, button: 40 };
export const PINGS = ["none", "everyone", "here", "role"];
const COLORS = { blue: 0x4d8cff, green: 0x57f287, red: 0xed4245, orange: 0xfaa61a, purple: 0x9b59b6, gold: 0xf1c40f };

const clip = (v, n) => String(v ?? "").trim().slice(0, n);
function url(v, what) {
    const s = clip(v, 500);
    if (!s) return null;
    let u; try { u = new URL(s); } catch { throw new UserError(`${what} must be a full link starting with https://`); }
    if (u.protocol !== "https:") throw new UserError(`${what} must be a full link starting with https://`);
    return u.toString();
}
function color(v) {
    if (v === undefined || v === null || v === "") return COLORS.blue;
    if (COLORS[v]) return COLORS[v];
    const m = /^#?([0-9a-f]{6})$/i.exec(String(v).trim());
    if (!m) throw new UserError("Pick a colour like #4d8cff.");
    return parseInt(m[1], 16);
}

/** Checks the form and returns what to send: { payload, title }. `serverIcon` is used when the manager asks for the server icon. */
export function buildAnnouncement(input, { serverName = "", serverIcon = null } = {}) {
    const title = clip(input.title, LIMITS.title), body = clip(input.body, LIMITS.body);
    if (!title && !body && !input.image) throw new UserError("Write a title or a message first.");
    const ping = input.ping ?? "none";
    if (!PINGS.includes(ping)) throw new UserError("Pick who to ping.");
    if (ping === "role" && !input.role_id) throw new UserError("Choose the role to ping.");
    const embed = { color: color(input.color) };
    if (title) embed.title = title;
    if (body) embed.description = body;
    const link = url(input.link_url, "The title link");
    if (link && title) embed.url = link;
    const image = url(input.image, "The image"), thumb = input.thumbnail === "server" ? serverIcon : url(input.thumbnail, "The small image");
    if (image) embed.image = { url: image };
    if (thumb) embed.thumbnail = { url: thumb };
    const author = clip(input.author, LIMITS.author);
    if (author) embed.author = { name: author, ...(url(input.author_icon, "The author icon") ? { icon_url: url(input.author_icon, "The author icon") } : {}) };
    const footer = clip(input.footer, LIMITS.footer);
    if (footer) embed.footer = { text: footer };
    if (input.timestamp) embed.timestamp = new Date().toISOString();
    const fields = (Array.isArray(input.fields) ? input.fields : []).slice(0, LIMITS.fields).map(f => ({ name: clip(f?.name, LIMITS.fieldName), value: clip(f?.value, LIMITS.fieldValue), inline: Boolean(f?.inline) })).filter(f => f.name && f.value);
    if (fields.length) embed.fields = fields;
    const components = [];
    const bLabel = clip(input.button_label, LIMITS.button), bUrl = url(input.button_url, "The button link");
    if (bLabel || bUrl) {
        if (!bLabel || !bUrl) throw new UserError("A button needs both its text and its link.");
        components.push({ type: 1, components: [{ type: 2, style: 5, label: bLabel, url: bUrl }] });
    }
    const content = ping === "everyone" ? "@everyone" : ping === "here" ? "@here" : ping === "role" ? `<@&${input.role_id}>` : undefined;
    const allowed = ping === "everyone" || ping === "here" ? { parse: ["everyone"] } : ping === "role" ? { roles: [String(input.role_id)] } : { parse: [] };
    return { title: title || body.slice(0, 60) || "Announcement", payload: { ...(content ? { content } : {}), embeds: [embed], ...(components.length ? { components } : {}), allowed_mentions: allowed }, serverName };
}

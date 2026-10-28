// Extra copy of an alert to your phone through a webhook. Only a few well-known hosts are allowed, so a saved link can never be used
// to make the bot call an address inside its own network. Redirects are not followed and every request has a short timeout.
import { UserError } from "./errors.js";

const HOSTS = [
    { host: "ntfy.sh", kind: "ntfy", ok: p => /^\/[A-Za-z0-9_-]{4,64}$/.test(p) },
    { host: "discord.com", kind: "discord", ok: p => /^\/api\/webhooks\/\d{5,25}\/[\w-]{20,120}$/.test(p) },
    { host: "discordapp.com", kind: "discord", ok: p => /^\/api\/webhooks\/\d{5,25}\/[\w-]{20,120}$/.test(p) },
    { host: "hooks.slack.com", kind: "slack", ok: p => /^\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Za-z0-9]+$/.test(p) }
];

/** Returns { url, host, kind } or throws a UserError. */
export function parsePushUrl(input) {
    let u;
    try { u = new URL(String(input ?? "").trim()); } catch { throw new UserError("That is not a link."); }
    const rule = HOSTS.find(h => h.host === u.hostname.toLowerCase());
    if (u.protocol !== "https:" || !rule || u.port || u.username || u.password || u.search || u.hash || !rule.ok(u.pathname)) {
        throw new UserError("Use an ntfy.sh topic link (https://ntfy.sh/your-topic), a Discord webhook or a Slack incoming webhook.");
    }
    return { url: `https://${rule.host}${u.pathname}`, host: rule.host, kind: rule.kind };
}

const clip = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const plain = s => String(s ?? "").replace(/<@!?\d+>|<t:\d+(?::\w)?>/g, "").replace(/[*_`~]/g, "");

export function pushText(payload) {
    const e = payload?.embeds?.[0];
    return { title: clip(plain(e?.title ?? payload?.content ?? "Steam Value Checker"), 100), body: clip(plain(e?.description ?? ""), 500), link: e?.url && /^https:\/\//.test(e.url) ? e.url : null };
}

/** Sends one notification. Returns true on success. Never throws. */
export async function sendPush(saved, payload, { fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
    let target;
    try { target = parsePushUrl(saved); } catch { return false; }
    const t = pushText(payload);
    const text = [t.title, t.body, t.link].filter(Boolean).join("\n");
    const init = { method: "POST", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) };
    if (target.kind === "ntfy") { init.body = [t.body, t.link].filter(Boolean).join("\n") || t.title; init.headers = { Title: t.title.replace(/[^\x20-\x7e]/g, "?"), "Content-Type": "text/plain; charset=utf-8" }; }
    else if (target.kind === "discord") { init.body = JSON.stringify({ content: clip(text, 1900), allowed_mentions: { parse: [] } }); init.headers = { "Content-Type": "application/json" }; }
    else { init.body = JSON.stringify({ text: clip(text, 3000) }); init.headers = { "Content-Type": "application/json" }; }
    try { const res = await fetchImpl(target.url, init); return res.status >= 200 && res.status < 300; } catch { return false; }
}

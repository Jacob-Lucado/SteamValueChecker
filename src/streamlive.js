// "I'm live": a streamer announces a stream in the server's live channel. Members who opted in (they hold the stream pings role) are pinged.
import { UserError } from "./errors.js";

export const PING_COOLDOWN_MS = 30 * 60_000; // going live again within half an hour edits the post instead of pinging everyone twice
const HOSTS = ["twitch.tv", "youtube.com", "youtu.be", "kick.com", "tiktok.com", "facebook.com", "fb.watch", "trovo.live", "rumble.com", "x.com", "twitter.com"];
const clip = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

/** The stream link, only if it is a normal https link to a known streaming site. */
export function cleanStreamUrl(raw) {
    let u;
    try { u = new URL(String(raw ?? "").trim()); } catch { throw new UserError("That doesn't look like a link. Paste your stream address, like https://twitch.tv/yourname."); }
    if (u.protocol !== "https:" || u.username || u.password) throw new UserError("The stream link has to start with https://.");
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (!HOSTS.some(h => host === h || host.endsWith("." + h))) throw new UserError("I only post links to streaming sites: Twitch, YouTube, Kick, TikTok, Facebook, Trovo, Rumble or X.");
    return u.toString();
}

const siteName = url => { const h = new URL(url).hostname.replace(/^www\./, ""); return /twitch/.test(h) ? "Twitch" : /youtu/.test(h) ? "YouTube" : /kick/.test(h) ? "Kick" : /tiktok/.test(h) ? "TikTok" : /facebook|fb\.watch/.test(h) ? "Facebook" : /trovo/.test(h) ? "Trovo" : /rumble/.test(h) ? "Rumble" : "X"; };
const ago = ms => { const m = Math.max(1, Math.round(ms / 60_000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

export function livePayload({ userId, name, avatarUrl = null, title, url, game = null, pingRole = null, ping = false }) {
    return {
        content: ping && pingRole ? `<@&${pingRole}>` : undefined,
        embeds: [{ color: 0x9146ff, author: { name: `${name} is live`, ...(avatarUrl ? { icon_url: avatarUrl } : {}) }, title: clip(title, 120) || "Live now", url,
            description: `<@${userId}> just went live on **${siteName(url)}**${game ? ` playing **${clip(game, 60)}**` : ""}. Come hang out!`, footer: { text: "🔴 Live now" }, timestamp: new Date().toISOString() }],
        components: [{ type: 1, components: [{ type: 2, style: 5, label: "Watch the stream", url }] }],
        allowed_mentions: { parse: [], roles: ping && pingRole ? [pingRole] : [], users: [userId] }
    };
}

export const endedPayload = ({ userId, name, title, url, ms }) => ({
    content: "",
    embeds: [{ color: 0x6b7280, author: { name: `${name} was live` }, title: clip(title, 120) || "Stream", url, description: `<@${userId}> streamed for ${ago(ms)}. Thanks for watching!`, footer: { text: "Stream ended" } }],
    components: [], allowed_mentions: { parse: [] }
});

export function createStreams({ db, api, now = () => Date.now() }) {
    const settings = guildId => db.getCommunity(guildId);

    /** `who` is { id, name, avatarUrl }. Returns { posted, pinged }. */
    async function goLive(guildId, who, { title, url, game = null, auto = false }) {
        const c = settings(guildId);
        if (!c.live_channel) throw new UserError("This server has no stream channel yet. A manager can pick one with `/server stream setup` or on the dashboard's Streams page.");
        const link = cleanStreamUrl(url);
        const t = clip(title, 120) || "Live now", g = clip(game, 60) || null;
        const existing = db.getStreamLive(guildId, who.id);
        const quiet = existing || now() - db.lastStreamPing(guildId, who.id) < PING_COOLDOWN_MS;
        const ping = Boolean(c.ping_stream) && !quiet;
        const payload = livePayload({ userId: who.id, name: who.name, avatarUrl: who.avatarUrl, title: t, url: link, game: g, pingRole: c.ping_stream, ping });
        let messageId = existing?.message_id ?? null;
        if (messageId) { try { await api.editMessage(existing.channel_id, messageId, payload); } catch { messageId = null; } }
        if (!messageId) {
            let m;
            try { m = await api.sendMessage(c.live_channel, payload); }
            catch (e) { if (e?.status === 403 || e?.status === 404) throw new UserError("I can't post in the stream channel. Give me View Channel, Send Messages and Embed Links there."); throw e; }
            messageId = m?.id ?? null;
        }
        db.setStreamLive(guildId, who.id, { title: t, url: link, game: g, started: existing?.started ?? now(), channelId: c.live_channel, messageId, auto });
        if (ping) db.markStreamPing(guildId, who.id, now());
        return { posted: true, pinged: ping, edited: Boolean(existing), channelId: c.live_channel };
    }

    async function endLive(guildId, who) {
        const row = db.endStreamLive(guildId, who.id);
        if (!row) throw new UserError("You aren't marked as live. Use `/server stream live` when you start.");
        if (row.message_id) await api.editMessage(row.channel_id, row.message_id, endedPayload({ userId: who.id, name: who.name, title: row.title, url: row.url, ms: now() - row.started })).catch(() => {});
        return row;
    }

    /** Opt in or out of the go-live ping by holding the stream pings role. */
    async function setOptIn(guildId, userId, on) {
        const role = settings(guildId).ping_stream;
        if (!role) throw new UserError("Stream pings aren't set up in this server yet. A manager can do that with `/server stream setup`.");
        try { await (on ? api.addRole(guildId, userId, role) : api.removeRole(guildId, userId, role)); }
        catch (e) { if (e?.status === 403) throw new UserError("I can't give that role. Its place in the role list has to be below mine, and I need Manage Roles."); throw e; }
        return { on: Boolean(on), role };
    }
    const optedIn = async (guildId, userId) => { const role = settings(guildId).ping_stream; if (!role) return null; let m = null; try { m = await api.getMember?.(guildId, userId); } catch { /* unknown */ } return m ? (m.roles ?? []).includes(role) : null; };

    return { goLive, endLive, setOptIn, optedIn };
}

/** Streamers (the streamer role), moderators, anyone with Manage Server, and the bot's owner. `roleIds` are the person's roles there. */
export function canStreamIn(c, { roleIds = [], isManager = false, isBotOwner = false } = {}) {
    return Boolean(isBotOwner || isManager || (c.mod_role_id && roleIds.includes(c.mod_role_id)) || (c.streamer_role_id && roleIds.includes(c.streamer_role_id)));
}

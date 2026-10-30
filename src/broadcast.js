// Owner announcements, for things like "the bot will be down for an update". Goes out as DMs and/or posts in each server's alert channel.
// Slow on purpose (about a DM a second, so Discord does not rate limit the bot) and only one runs at a time.
import { UserError } from "./errors.js";

export const AUDIENCES = ["me", "dm", "channels", "both"];
export const MAX_BODY = 1500, MAX_TITLE = 100;

export const broadcastSchema = `
CREATE TABLE IF NOT EXISTS broadcasts (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    at       INTEGER NOT NULL,
    title    TEXT NOT NULL,
    body     TEXT NOT NULL,
    audience TEXT NOT NULL,
    total    INTEGER NOT NULL DEFAULT 0,
    sent     INTEGER NOT NULL DEFAULT 0,
    failed   INTEGER NOT NULL DEFAULT 0,
    done     INTEGER NOT NULL DEFAULT 0
);`;

export function broadcastStore({ run, all, get, now }) {
    const startBroadcast = (title, body, audience, total) => Number(run("INSERT INTO broadcasts (at, title, body, audience, total) VALUES (?,?,?,?,?)", now(), title, body, audience, total).lastInsertRowid);
    const progressBroadcast = (id, sent, failed, done) => run("UPDATE broadcasts SET sent = ?, failed = ?, done = ? WHERE id = ?", sent, failed, done ? 1 : 0, id);
    const listBroadcasts = (limit = 8) => all("SELECT id, at, title, body, audience, total, sent, failed, done FROM broadcasts ORDER BY id DESC LIMIT ?", limit);
    /** Members who can be DMed (not ones whose DMs keep failing) and servers with an alert channel. */
    const broadcastTargets = ({ promo = false } = {}) => ({
        // Promotions skip anyone who pressed "No more promos".
        users: all(`SELECT discord_id FROM users WHERE dm_failures < 3${promo ? " AND promo_off = 0" : ""}`).map(r => r.discord_id),
        // Each server's #announcements channel, or its alert channel if it has none.
        channels: all(`SELECT COALESCE(c.announce_channel, g.channel_id) AS ch FROM guilds g LEFT JOIN community c ON c.guild_id = g.guild_id
            UNION SELECT c.announce_channel FROM community c WHERE c.announce_channel IS NOT NULL`).map(r => r.ch).filter(Boolean)
    });
    /** Which server each target channel belongs to, so a channel post can be addressed to that server. */
    const broadcastChannelGuilds = () => new Map(all(`SELECT COALESCE(c.announce_channel, g.channel_id) AS ch, g.guild_id AS gid FROM guilds g LEFT JOIN community c ON c.guild_id = g.guild_id
        UNION SELECT c.announce_channel, c.guild_id FROM community c WHERE c.announce_channel IS NOT NULL`).filter(r => r.ch).map(r => [r.ch, r.gid]));
    return { startBroadcast, progressBroadcast, listBroadcasts, broadcastTargets, broadcastChannelGuilds };
}

/** The notice as one server sees it: addressed to that server, with its icon beside the message. */
export const noticeEmbed = (title, body, base = null, guild = null) => ({ color: 0xfaa61a,
    author: { name: guild?.name ? `📣 For ${guild.name}, from the Steam Value Checker developer` : "📣 Official message from the Steam Value Checker developer" },
    title: title || "Steam Value Checker notice", description: body,
    footer: { text: guild?.name ? `Sent to ${guild.name} by the bot's owner/developer. It is not from this server's staff. Questions? Use the Support page on the dashboard.`
        : "Sent by the bot's owner/developer to every server using Steam Value Checker. It is not from this server's staff. Questions? Use the Support page on the dashboard." },
    ...(base ? { image: { url: `${base}/banner.png` }, thumbnail: { url: guild?.icon || `${base}/creator.png` } } : {}) });

export function createBroadcaster({ publicUrl = null, db, sendDm, sendChannel, ownerId, promoPayload = null, guildInfo = null, delayMs = 1100, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
    let running = null;

    function counts() {
        const t = db.broadcastTargets(), p = db.broadcastTargets({ promo: true });
        return { dm: t.users.length, channels: [...new Set(t.channels)].length, promoDm: p.users.length };
    }

    function clean(title, body) {
        const t = String(title ?? "").trim().slice(0, MAX_TITLE), b = String(body ?? "").trim();
        if (!b) throw new UserError("Write the message first.");
        if (b.length > MAX_BODY) throw new UserError(`Keep it under ${MAX_BODY} characters.`);
        return { t, b };
    }

    /** Starts sending and returns right away; progress is in status(). */
    function start({ title, body, audience, promo = false }) {
        if (!AUDIENCES.includes(audience)) throw new UserError("Pick who gets it.");
        if (running) throw new UserError("A broadcast is still going out. Wait for it to finish.");
        if (promo && !promoPayload) throw new UserError("The advertisement is not available here.");
        const { t, b } = promo ? { t: "FanaticalGrabber advertisement", b: "(advertisement)" } : clean(title, body);
        const base = publicUrl ? String(publicUrl).replace(/\/$/, "") : null;
        const payload = promo ? promoPayload() : { embeds: [noticeEmbed(t, b, base)], allowed_mentions: { parse: [] } };
        const chGuild = !promo && guildInfo ? db.broadcastChannelGuilds() : new Map();
        const payloadFor = cid => {
            const info = chGuild.has(cid) ? guildInfo(chGuild.get(cid)) : null;
            return info?.name ? { embeds: [noticeEmbed(t, b, base, info)], allowed_mentions: { parse: [] } } : payload;
        };
        const targets = db.broadcastTargets({ promo });
        const dmIds = audience === "me" ? [ownerId] : audience === "dm" || audience === "both" ? targets.users : [];
        const chIds = audience === "channels" || audience === "both" ? [...new Set(targets.channels)] : [];
        const total = dmIds.length + chIds.length;
        if (!total) throw new UserError("Nobody to send it to.");
        const id = db.startBroadcast(t || "Steam Value Checker notice", b, audience, total);
        const job = { id, total, sent: 0, failed: 0, done: false };
        running = job;
        (async () => {
            const step = async fn => { try { await fn(); job.sent++; } catch { job.failed++; } if ((job.sent + job.failed) % 10 === 0) db.progressBroadcast(id, job.sent, job.failed, false); await sleep(delayMs); };
            for (const uid of dmIds) await step(() => sendDm(uid, payload));
            for (const cid of chIds) await step(() => sendChannel(cid, payloadFor(cid)));
        })().catch(() => {}).finally(() => { job.done = true; db.progressBroadcast(id, job.sent, job.failed, true); running = null; });
        return { id, total };
    }

    return { counts, start, running: () => running, current: () => running && { id: running.id, total: running.total, sent: running.sent, failed: running.failed } };
}

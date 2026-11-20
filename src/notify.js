// Delivers alerts: DM first (default), then the server's alert channel as a fallback.
// Users who choose "channel" delivery skip the DM and are mentioned in the server channel instead.
// Discord is injected, so the logic can be tested without a connection.

export const MAX_DM_FAILURES_BEFORE_NOTE = 3;
/** A notification may open our own pages or a store page; the service worker only follows same-site paths, so others fall back to the alerts page. */
const safeUrl = u => { try { const x = new URL(u); return /(^|\.)steamvaluechecker\.com$/.test(x.hostname) ? x.pathname + x.search : "/alerts"; } catch { return String(u).startsWith("/") ? u : "/alerts"; } };

/**
 * `discord` needs: sendDm(userId, payload) and sendChannel(channelId, payload), both throwing on failure.
 * Returns { ok, via: "dm" | "channel" | null, reason? }.
 */
/** What Discord actually said, short enough for a log line or an owner DM: "50035 Invalid Form Body". */
export const describeError = e => [e?.code ?? e?.status ?? null, String(e?.rawError?.message ?? e?.message ?? e ?? "unknown").replace(/\s+/g, " ").slice(0, 100)].filter(x => x !== null).join(" ");

/** Answers that won't change by retrying: the channel is gone, the bot lost access, or the person can't be messaged. These are a setup problem on their side, not an outage. */
export const isPermanent = e => [10003, 10004, 10013, 50001, 50007, 50013, 50278].includes(Number(e?.code));

export function createNotifier({ db, discord, push = null }) {
    async function viaChannel(user, payload) {
        const guild = db.getGuild(user.guild_id);
        if (!guild) return { ok: false, via: null, reason: "no_channel" };
        try {
            await discord.sendChannel(guild.channel_id, {
                ...payload,
                content: `<@${user.discord_id}> ${payload.content ?? ""}`.trim(),
                allowedMentions: { users: [user.discord_id], parse: [] }
            });
            if (user.delivery === "channel" && user.dm_failures) db.updateUser(user.discord_id, { dm_failures: 0 });
            return { ok: true, via: "channel" };
        } catch (e) {
            return { ok: false, via: null, reason: "channel_failed", detail: describeError(e), permanent: isPermanent(e) };
        }
    }

    /** Keeps a copy in the person's notification center. Never allowed to break delivery. */
    function record(user, type, payload, meta = null) {
        try {
            const e = payload.embeds?.[0];
            const title = e?.title ?? (payload.content ? String(payload.content).slice(0, 120) : "Notification");
            const more = (payload.embeds?.length ?? 0) > 1 ? ` (+${payload.embeds.length - 1} more)` : "";
            db.addNotification(user.discord_id, { type, title: title + more, body: e?.description ?? null, url: e?.url ?? null, extra: meta });
        } catch { /* the inbox is a convenience */ }
    }

    /** `type` is alert, bundle, free or digest. A muted type goes only to the notification center, not to a DM or channel. */
    async function deliver(user, payload, type = "alert", meta = null) {
        if (db.isBanned?.(user.discord_id)) return { ok: false, via: null, reason: "restricted" };
        const muted = String(user.muted ?? "").split(",").includes(type);
        if (muted) { record(user, type, payload, meta); return { ok: true, via: "inbox" }; }
        // A browser the person turned notifications on in gets it there instead of a DM; if that fails the DM goes out as usual.
        if (push && db.countPushSubs?.(user.discord_id)) {
            try {
                const e = payload.embeds?.[0];
                const n = await push.send(user.discord_id, { title: e?.title ?? "Steam Value Checker", body: e?.description ?? payload.content ?? "", url: e?.url ? safeUrl(e.url) : "/alerts", tag: type });
                if (n > 0) { record(user, type, payload, meta); return { ok: true, via: "push" }; }
            } catch { /* fall back to the DM */ }
        }
        const r = await send(user, payload);
        if (r.ok) record(user, type, payload, meta);
        return r;
    }

    async function send(user, payload) {
        if (user.delivery === "channel") {
            // The server's alert channel is gone, was never set, or the bot lost access: the member still wants the alert, so it goes to their DMs instead of failing every hour.
            const r = await viaChannel(user, payload);
            if (r.ok) return r;
            try {
                await discord.sendDm(user.discord_id, payload);
                if (user.dm_failures) db.updateUser(user.discord_id, { dm_failures: 0 });
                return { ok: true, via: "dm" };
            } catch (e) {
                db.updateUser(user.discord_id, { dm_failures: (user.dm_failures ?? 0) + 1 });
                return { ok: false, via: null, reason: r.reason === "no_channel" ? "dm_failed_no_channel" : r.reason, detail: r.detail ?? `DM: ${describeError(e)}`, permanent: r.reason === "no_channel" || Boolean(r.permanent) };
            }
        }

        try {
            await discord.sendDm(user.discord_id, payload);
            if (user.dm_failures) db.updateUser(user.discord_id, { dm_failures: 0 });
            return { ok: true, via: "dm" };
        } catch (e) {
            db.updateUser(user.discord_id, { dm_failures: (user.dm_failures ?? 0) + 1 });
            const r = await viaChannel(user, payload);
            return r.ok ? r : { ok: false, via: null, reason: r.reason === "no_channel" ? "dm_failed_no_channel" : r.reason, detail: r.detail ?? `DM: ${describeError(e)}`, permanent: Boolean(r.permanent) };
        }
    }

    /** Posts to a server's alert channel without mentioning anyone. Returns true on success. */
    async function postGuild(guildId, payload, pingKind = null) {
        const guild = db.getGuild(guildId);
        if (!guild) return false;
        // Feeds can ping the server's own opt-in role (Free game pings, Deal pings). Nobody else is ever mentioned.
        const role = pingKind ? db.getCommunity?.(guildId)?.[`ping_${pingKind}`] : null;
        const out = role ? { ...payload, content: `<@&${role}>${payload.content ? " " + payload.content : ""}`, allowedMentions: { roles: [role] } } : { ...payload, allowedMentions: { parse: [] } };
        try {
            await discord.sendChannel(guild.channel_id, out);
            return true;
        } catch {
            return false;
        }
    }

    /** Posts to one channel (such as a voice channel's text chat) without mentioning anyone. */
    async function postChannel(channelId, payload, pingRole = null) {
        const out = pingRole ? { ...payload, content: `<@&${pingRole}>${payload.content ? " " + payload.content : ""}`, allowedMentions: { roles: [pingRole] } } : { ...payload, allowedMentions: { parse: [] } };
        try { await discord.sendChannel(channelId, out); return true; } catch { return false; }
    }

    return { deliver, postGuild, postChannel };
}

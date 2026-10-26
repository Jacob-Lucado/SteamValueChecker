// Delivers alerts: DM first (default), then the server's alert channel as a fallback.
// Users who choose "channel" delivery skip the DM and are mentioned in the server channel instead.
// Discord is injected, so the logic can be tested without a connection.

export const MAX_DM_FAILURES_BEFORE_NOTE = 3;

/**
 * `discord` needs: sendDm(userId, payload) and sendChannel(channelId, payload), both throwing on failure.
 * Returns { ok, via: "dm" | "channel" | null, reason? }.
 */
export function createNotifier({ db, discord }) {
    async function viaChannel(user, payload) {
        const guild = db.getGuild(user.guild_id);
        if (!guild) return { ok: false, via: null, reason: "no_channel" };
        try {
            await discord.sendChannel(guild.channel_id, {
                ...payload,
                content: `<@${user.discord_id}> ${payload.content ?? ""}`.trim(),
                allowedMentions: { users: [user.discord_id], parse: [] }
            });
            return { ok: true, via: "channel" };
        } catch {
            return { ok: false, via: null, reason: "channel_failed" };
        }
    }

    async function deliver(user, payload) {
        if (user.delivery === "channel") return viaChannel(user, payload);

        try {
            await discord.sendDm(user.discord_id, payload);
            if (user.dm_failures) db.updateUser(user.discord_id, { dm_failures: 0 });
            return { ok: true, via: "dm" };
        } catch {
            db.updateUser(user.discord_id, { dm_failures: (user.dm_failures ?? 0) + 1 });
            const r = await viaChannel(user, payload);
            return r.ok ? r : { ok: false, via: null, reason: r.reason === "no_channel" ? "dm_failed_no_channel" : r.reason };
        }
    }

    return { deliver };
}

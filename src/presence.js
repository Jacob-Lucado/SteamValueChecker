// The bot's Discord status: a line under its name that rotates through server and member counts, uptime and the owner's X link.
// Bots cannot use Discord's Rich Presence images or Ask to Join (those belong to games), but a custom status can say all of this.
const CUSTOM = 4; // Discord's "custom status" activity type
export const ROTATE_MS = 30_000;

const plural = (n, one, many) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
export function uptimeText(ms) {
    const m = Math.floor(ms / 60_000), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m % 60}m`;
    return `${Math.max(1, m)}m`;
}
const bare = url => String(url ?? "").replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");

/** The lines to rotate through. Anything unknown is left out rather than shown as 0. */
export function presenceLines({ servers, members, users, uptimeMs, supportUrl }) {
    const lines = [];
    if (Number.isFinite(servers)) lines.push(`🌐 In ${plural(servers, "server", "servers")}`);
    if (Number.isFinite(members) && members > 0) lines.push(`👥 ${plural(members, "member", "members")} across servers`);
    if (Number.isFinite(users) && users > 0) lines.push(`💸 Watching deals for ${plural(users, "player", "players")}`);
    if (Number.isFinite(uptimeMs)) lines.push(`⏱️ Online for ${uptimeText(uptimeMs)}`);
    lines.push("🎮 Try /help, /freegames and /value");
    if (supportUrl) lines.push(`🐦 Support: ${bare(supportUrl)}`);
    return lines.map(l => l.slice(0, 128));
}

/** Starts the rotation. Returns stop(). A failed update is skipped; the next one tries again. */
export function startPresence({ client, db, supportUrl, startedAt = Date.now(), now = () => Date.now(), every = ROTATE_MS, log = () => {} }) {
    let i = 0;
    const tick = () => {
        try {
            const guilds = client.guilds?.cache;
            const lines = presenceLines({
                servers: guilds?.size, members: guilds ? guilds.reduce((n, g) => n + (g.memberCount ?? 0), 0) : undefined,
                users: db?.stats?.().users, uptimeMs: now() - startedAt, supportUrl
            });
            const state = lines[i++ % lines.length];
            client.user?.setPresence({ status: "online", activities: [{ type: CUSTOM, name: "Custom Status", state }] });
        } catch (e) { log(`[presence] ${e.message}`); }
    };
    tick();
    const t = setInterval(tick, every); t.unref?.();
    return () => clearInterval(t);
}

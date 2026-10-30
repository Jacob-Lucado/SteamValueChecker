// The bot's Discord status: a line under its name that rotates through server and member counts, uptime and the owner's X link.
// Discord only lets a bot set an activity's type, name and (for streaming) link. The Rich Presence extras (big images, buttons,
// "Ask to Join", elapsed timers) are refused for bots. So the profile gets two lines that Discord does allow:
// a real activity ("Watching ...", the card under the name) and the custom status line with the rotating facts.
const WATCHING = 3, CUSTOM = 4; // Discord's activity types
const WATCHING_NAMES = n => [`${n ? n.toLocaleString("en-US") + " " : ""}game ${n === 1 ? "library" : "libraries"} for deals`, "Steam prices drop", "free games go live", "wishlists for sales"];
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
    let i = 0, users, usersAt = -Infinity;
    const tick = () => {
        try {
            const guilds = client.guilds?.cache;
            const lines = presenceLines({
                servers: guilds?.size, members: guilds ? guilds.reduce((n, g) => n + (g.memberCount ?? 0), 0) : undefined,
                users: (() => { if (now() - usersAt > 600_000) { usersAt = now(); try { users = db?.stats?.().users; } catch { /* keep the last number */ } } return users; })(), uptimeMs: now() - startedAt, supportUrl
            });
            const state = lines[i++ % lines.length];
            const names = WATCHING_NAMES(users);
            client.user?.setPresence({ status: "online", activities: [{ type: WATCHING, name: names[(i - 1) % names.length] }, { type: CUSTOM, name: "Custom Status", state }] });
        } catch (e) { log(`[presence] ${e.message}`); }
    };
    tick();
    const t = setInterval(tick, every); t.unref?.();
    return () => clearInterval(t);
}

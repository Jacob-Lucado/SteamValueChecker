// Numbers and wording for /about and the dashboard's About panel. Aggregate only: no names, IDs or keys.

const FALLBACK_ASSETS = "https://raw.githubusercontent.com/Jacob-Lucado/SteamValueChecker/main/public";

/** "3d 4h", "5h 12m", "42s": the two biggest units. */
export function formatDuration(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const parts = [[Math.floor(s / 86400), "d"], [Math.floor(s % 86400 / 3600), "h"], [Math.floor(s % 3600 / 60), "m"], [s % 60, "s"]];
    const shown = parts.filter(([n]) => n > 0).slice(0, 2).map(([n, u]) => `${n}${u}`);
    return shown.join(" ") || "0s";
}

/** Where Discord (or the dashboard) can fetch the logos: the dashboard's own address, else GitHub. */
export const assetBase = cfg => cfg.dashboard?.publicUrl ?? FALLBACK_ASSETS;

/**
 * Collects the live numbers. `client` is the discord.js client (or null on the dashboard-only path).
 * Missing pieces come back as null so the display can skip them.
 */
export function collectAbout({ client = null, db, cfg, startedAt, version = "1.0.0", now = () => Date.now() }) {
    const stats = db.stats();
    const totals = db.giveawayTotals?.() ?? { giveaways: 0, redeemed: 0 };
    const guilds = client?.guilds?.cache;
    const ping = client?.ws?.ping;
    const base = assetBase(cfg);
    return {
        startedAt,
        uptimeMs: now() - startedAt,
        uptime: formatDuration(now() - startedAt),
        servers: guilds ? guilds.size : null,
        members: guilds ? [...guilds.values()].reduce((n, g) => n + (g.memberCount ?? 0), 0) : null,
        pingMs: Number.isFinite(ping) && ping >= 0 ? Math.round(ping) : null,
        gamesWatched: stats.uniqueGames,
        membersWatching: stats.activeUsers,
        alerts24h: stats.alerts24h,
        giveaways: totals.giveaways,
        redeemed: totals.redeemed,
        version,
        node: process.version,
        creator: { ...cfg.creator, logo: `${base}/creator.png` },
        logo: `${base}/logo.png`,
        banner: `${base}/banner.png`,
        dashboardUrl: cfg.dashboard?.publicUrl ?? null,
        userInstallUrl: cfg.clientId ? `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(cfg.clientId)}&integration_type=1&scope=applications.commands` : null
    };
}

// A bare "example.com" is easy to type into a secret; read it as https so the bot still starts.
export function publicUrlOf(raw) {
    const v = String(raw).trim().replace(/\/+$/, "");
    return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

/** Where the admin panel lives: ADMIN_URL if set, else admin. in front of the public domain. Not on shared hosts like fly.dev, which cannot share a sign-in. */
export function adminUrlOf(publicUrl, raw) {
    if (raw) return publicUrlOf(raw);
    try {
        const u = new URL(publicUrl);
        if (u.protocol !== "https:" || u.hostname === "localhost" || /^[\d.]+$/.test(u.hostname) || !u.hostname.includes(".") || /\.fly\.dev$/i.test(u.hostname)) return null;
        return `https://admin.${u.hostname}`;
    } catch { return null; }
}

/** The music studio's own address: MUSIC_URL if set, else music. in front of the public domain (same rules as the admin panel). */
export const musicUrlOf = (publicUrl, raw) => (raw ? publicUrlOf(raw) : (adminUrlOf(publicUrl, null) ?? "").replace("://admin.", "://music.") || null);

// Reads settings from environment variables (loaded from .env by the entry points).
export function loadConfig(env = process.env, required = ["DISCORD_TOKEN", "CLIENT_ID", "ITAD_API_KEY"]) {
    const missing = required.filter(k => !env[k]);
    if (missing.length) {
        throw new Error(
            `Missing environment variables: ${missing.join(", ")}. ` +
            "Copy .env.example to .env and fill them in."
        );
    }
    return {
        token: env.DISCORD_TOKEN,
        clientId: env.CLIENT_ID,
        guildId: env.GUILD_ID || null,
        // 1 = register commands globally (needed for installs on a person's account) even if GUILD_ID is set
        globalCommands: env.GLOBAL_COMMANDS === "1" || Boolean(env.FLY_APP_NAME), // on Fly this is the live bot, so commands must be global (DMs, user installs)
        itadKey: env.ITAD_API_KEY,
        // Optional. A free Steam Web API key (steamcommunity.com/dev/apikey) makes library linking use Steam's official endpoint.
        steamApiKey: env.STEAM_API_KEY || null,
        dbPath: env.DATABASE_PATH || "data/steamvaluechecker.db",
        // Prices are cached for 30 minutes, so checking more often than that gains nothing.
        // The web dashboard starts only when these are set. DASHBOARD_URL is the public address, e.g. https://bot.example.com
        dashboard: env.DASHBOARD_URL && env.DISCORD_CLIENT_SECRET ? {
            publicUrl: publicUrlOf(env.DASHBOARD_URL),
            clientSecret: env.DISCORD_CLIENT_SECRET,
            adminUrl: adminUrlOf(publicUrlOf(env.DASHBOARD_URL), env.ADMIN_URL),
            musicUrl: musicUrlOf(publicUrlOf(env.DASHBOARD_URL), env.MUSIC_URL),
            // One sign-in for the main site and the admin panel: the session cookie is set for the whole domain.
            cookieDomain: env.COOKIE_DOMAIN || (adminUrlOf(publicUrlOf(env.DASHBOARD_URL), env.ADMIN_URL) || musicUrlOf(publicUrlOf(env.DASHBOARD_URL), env.MUSIC_URL) ? new URL(publicUrlOf(env.DASHBOARD_URL)).hostname : null),
            port: Number(env.DASHBOARD_PORT) || 3000,
            host: env.DASHBOARD_HOST || "127.0.0.1"
        } : null,
        ownerId: env.OWNER_DISCORD_ID || null,
        // Optional. The AI companion ("Hey AI ...") answers through the Anthropic API. Without a key the feature stays off.
        anthropicKey: env.ANTHROPIC_API_KEY || null,
        aiModel: env.AI_MODEL || "claude-haiku-5-5",
        // How many answers one server can get per day, to keep the bill predictable.
        aiDailyCap: Math.max(10, Number(env.AI_DAILY_CAP) || 300),
        // Shown on /bot about and the dashboard. Set CREATOR_NAME / CREATOR_X_URL to change them.
        creator: { name: env.CREATOR_NAME || "Jacob Lucado", url: env.CREATOR_X_URL || "https://x.com/twit_user69" },
        // Giveaways store prize keys, so they stay off until there is a secret to encrypt them with.
        keySecret: env.KEY_ENCRYPTION_SECRET || null,
        backupDir: env.BACKUP_DIR || "data/backups",
        backupKeep: Math.max(1, Number(env.BACKUP_KEEP) || 7),
        trustProxy: env.DASHBOARD_TRUST_PROXY === "1",
        checkEveryMinutes: Math.max(30, Number(env.CHECK_INTERVAL_MINUTES) || 60)
    };
}

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
        dbPath: env.DATABASE_PATH || "data/steamvaluechecker.db",
        // Prices are cached for 30 minutes, so checking more often than that gains nothing.
        // The web dashboard starts only when these are set. DASHBOARD_URL is the public address, e.g. https://bot.example.com
        dashboard: env.DASHBOARD_URL && env.DISCORD_CLIENT_SECRET ? {
            publicUrl: env.DASHBOARD_URL.replace(/\/+$/, ""),
            clientSecret: env.DISCORD_CLIENT_SECRET,
            port: Number(env.DASHBOARD_PORT) || 3000,
            host: env.DASHBOARD_HOST || "127.0.0.1"
        } : null,
        ownerId: env.OWNER_DISCORD_ID || null,
        // Shown on /about and the dashboard. Set CREATOR_NAME / CREATOR_X_URL to change them.
        creator: { name: env.CREATOR_NAME || "Jacob Lucado", url: env.CREATOR_X_URL || "https://x.com/twit_user69" },
        // Giveaways store prize keys, so they stay off until there is a secret to encrypt them with.
        keySecret: env.KEY_ENCRYPTION_SECRET || null,
        backupDir: env.BACKUP_DIR || "data/backups",
        backupKeep: Math.max(1, Number(env.BACKUP_KEEP) || 7),
        trustProxy: env.DASHBOARD_TRUST_PROXY === "1",
        checkEveryMinutes: Math.max(30, Number(env.CHECK_INTERVAL_MINUTES) || 60)
    };
}

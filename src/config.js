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
        itadKey: env.ITAD_API_KEY,
        dbPath: env.DATABASE_PATH || "data/steamvaluechecker.db",
        // Prices are cached for 30 minutes, so checking more often than that gains nothing.
        checkEveryMinutes: Math.max(30, Number(env.CHECK_INTERVAL_MINUTES) || 60)
    };
}

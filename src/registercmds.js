// Pushes the slash commands to Discord. Used by `npm run register` and, only when they changed, at bot startup.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";

export async function registerCommands(cfg, { onlyIfChanged = false, dbPath = cfg.dbPath } = {}) {
    // Commands that can be installed on a person's account must be global. GLOBAL_COMMANDS=1 registers globally
    // and clears the test server's own copies so nothing shows twice.
    const global = cfg.globalCommands || !cfg.guildId;
    const route = global ? Routes.applicationCommands(cfg.clientId) : Routes.applicationGuildCommands(cfg.clientId, cfg.guildId);
    const hash = createHash("sha256").update(JSON.stringify({ route, commands, clear: Boolean(global && cfg.guildId) })).digest("hex");
    const stamp = join(dirname(dbPath), "commands.hash");
    if (onlyIfChanged) {
        try { if (readFileSync(stamp, "utf8").trim() === hash) return { skipped: true, count: commands.length }; } catch { /* first run */ }
    }
    const rest = new REST({ version: "10" }).setToken(cfg.token);
    await rest.put(route, { body: commands });
    if (global && cfg.guildId) await rest.put(Routes.applicationGuildCommands(cfg.clientId, cfg.guildId), { body: [] }).catch(() => {});
    try { mkdirSync(dirname(stamp), { recursive: true }); writeFileSync(stamp, hash); } catch { /* not fatal: it just re-registers next start */ }
    return { skipped: false, count: commands.length, guild: !global };
}

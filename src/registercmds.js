// Pushes the slash commands to Discord. Used by `npm run register` and, only when they changed, at bot startup.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";

export async function registerCommands(cfg, { onlyIfChanged = false, dbPath = cfg.dbPath } = {}) {
    const route = cfg.guildId
        ? Routes.applicationGuildCommands(cfg.clientId, cfg.guildId)
        : Routes.applicationCommands(cfg.clientId);
    const hash = createHash("sha256").update(JSON.stringify({ route, commands })).digest("hex");
    const stamp = join(dirname(dbPath), "commands.hash");
    if (onlyIfChanged) {
        try { if (readFileSync(stamp, "utf8").trim() === hash) return { skipped: true, count: commands.length }; } catch { /* first run */ }
    }
    await new REST({ version: "10" }).setToken(cfg.token).put(route, { body: commands });
    try { mkdirSync(dirname(stamp), { recursive: true }); writeFileSync(stamp, hash); } catch { /* not fatal: it just re-registers next start */ }
    return { skipped: false, count: commands.length, guild: Boolean(cfg.guildId) };
}

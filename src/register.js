// Registers the slash commands with Discord. Run once after changing src/commands.js:  npm run register
import "dotenv/config";
import { REST, Routes } from "discord.js";
import { loadConfig } from "./config.js";
import { commands } from "./commands.js";

const cfg = loadConfig(process.env, ["DISCORD_TOKEN", "CLIENT_ID"]);
const rest = new REST({ version: "10" }).setToken(cfg.token);
const route = cfg.guildId
    ? Routes.applicationGuildCommands(cfg.clientId, cfg.guildId)
    : Routes.applicationCommands(cfg.clientId);

await rest.put(route, { body: commands });
console.log(
    `Registered ${commands.length} commands ` +
    (cfg.guildId ? "to the test server (instant)." : "globally (can take up to an hour to appear).")
);

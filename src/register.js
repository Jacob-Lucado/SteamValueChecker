// Registers the slash commands with Discord. The bot also does this by itself at startup when they change.
import "dotenv/config";
import { loadConfig } from "./config.js";
import { registerCommands } from "./registercmds.js";

const cfg = loadConfig(process.env, ["DISCORD_TOKEN", "CLIENT_ID"]);
const r = await registerCommands(cfg);
console.log(`Registered ${r.count} commands ` + (r.guild ? "to the test server (instant)." : "globally (can take up to an hour to appear)."));

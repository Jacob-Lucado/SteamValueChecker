// Servers the owner uses for testing. Nothing from them is counted, listed, logged or shown anywhere: no public numbers, no
// usage stats, no case or join history, no log lines. The bot itself still works in them as normal.
// Add more with the HIDDEN_GUILDS setting (comma-separated server ids).
const BUILT_IN = ["768505465809797130"];
let extra = [];
export function setHiddenGuilds(list = process.env.HIDDEN_GUILDS ?? "") {
    extra = String(list).split(/[,\s]+/).filter(s => /^\d{5,}$/.test(s));
}
setHiddenGuilds();
export const hiddenGuilds = () => new Set([...BUILT_IN, ...extra]);
export const isHidden = id => id != null && hiddenGuilds().has(String(id));
/** True when a line of text names a hidden server. Used to keep such lines out of the logs. */
export const mentionsHidden = text => { const s = String(text ?? ""); for (const id of hiddenGuilds()) if (s.includes(id)) return true; return false; };

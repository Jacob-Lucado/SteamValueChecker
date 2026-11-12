// The live feed for the Alerts overlay. When the bot can see members joining and boosting (the Server Members permission), the bot pushes
// each one here with the person's name; otherwise the dashboard falls back to noticing the member and boost counts go up.
const rings = new Map(); // guild id -> the last few events
let seq = 1, named = false;

export const nextSeq = () => ++seq;
export const currentSeq = () => seq;
/** Called once at start-up: true when the bot receives member joins and boosts, so the feed can name people. */
export const setNamedFeed = on => { named = Boolean(on); };
export const hasNamedFeed = () => named;

const clean = v => String(v ?? "").replace(/[\u0000-\u001f​-‏‪-‮]/g, " ").replace(/\s+/g, " ").trim().slice(0, 32);

/** type: "join" or "boost". `count` is the new total when known. */
export function pushOverlayEvent(guildId, { type, name = "", avatar = null, count = null }, now = Date.now()) {
    if (!guildId || !["join", "boost"].includes(type)) return;
    const list = (rings.get(String(guildId)) ?? []).filter(e => now - e.at < 10 * 60_000);
    list.push({ seq: nextSeq(), type, name: clean(name), avatar: /^https:\/\/cdn\.discordapp\.com\//.test(String(avatar ?? "")) ? String(avatar) : null, count, by: 1, at: now });
    rings.set(String(guildId), list.slice(-30));
}
export const overlayEventsFor = (guildId, now = Date.now()) => (rings.get(String(guildId)) ?? []).filter(e => now - e.at < 10 * 60_000);

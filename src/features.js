// Per-server switches for whole areas of the bot. A server that only wants prices and alerts can turn music,
// moderation and the rest off in one place; the area's commands then answer with a short "switched off" note and
// its automatic XP stops. Everything is on until a manager turns it off. Stored as one small list per server.
import { MessageFlags, PermissionFlagsBits } from "discord.js";

export const AREAS = [
    { id: "music", name: "Music", emoji: "🎵", about: "/music, /play and the music studio", commands: ["music", "play", "player"] },
    { id: "moderation", name: "Moderation", emoji: "🛡️", about: "/mod and the auto-moderator's commands", commands: ["mod"] },
    { id: "giveaways", name: "Giveaways", emoji: "🎁", about: "/server giveaway", commands: ["giveaway"] },
    { id: "levels", name: "Levels and XP", emoji: "⭐", about: "/server rank, /server levels and earning XP", commands: ["rank", "levels", "leaderboardrefresh"] },
    { id: "groups", name: "Game nights and looking for group", emoji: "🎮", about: "/server gamenight, coop and lfg", commands: ["gamenight", "coop", "lfg"] },
    { id: "streams", name: "Streams", emoji: "📺", about: "/server stream and go-live posts' commands", commands: ["stream"] },
    { id: "fun", name: "Memes, trivia and polls", emoji: "🎲", about: "/server memes, trivia, tags and suggestions", commands: ["memes", "trivia", "poll", "suggest", "tag", "tags", "suggestions", "santa"] },
    { id: "codes", name: "Game codes and promo drops", emoji: "🔑", about: "/games codes and /server promos", commands: ["codes", "promos"] }
];
const BY_ID = new Map(AREAS.map(a => [a.id, a]));
const BY_COMMAND = new Map(AREAS.flatMap(a => a.commands.map(c => [c, a])));
const key = guildId => `featoff:${guildId}`;

/** The ids of the areas a server has switched off. */
export function featuresOff(db, guildId) {
    if (!guildId) return [];
    try { const v = JSON.parse(db.getMeta(key(guildId)) ?? "[]"); return Array.isArray(v) ? v.filter(id => BY_ID.has(id)) : []; } catch { return []; }
}
export const featureOn = (db, guildId, id) => !featuresOff(db, guildId).includes(id);

/** Replaces the off list. Unknown ids are dropped. Returns the list as stored. */
export function setFeaturesOff(db, guildId, ids) {
    const off = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(id => BY_ID.has(id)))];
    db.setMeta(key(guildId), JSON.stringify(off));
    return off;
}
export function setFeature(db, guildId, id, on) {
    if (!BY_ID.has(id)) return null;
    const off = new Set(featuresOff(db, guildId));
    if (on) off.delete(id); else off.add(id);
    return setFeaturesOff(db, guildId, [...off]);
}

/** The area that blocks this command in this server, or null. `command` is the old-style name ("mod", "giveaway"). */
export const blockedArea = (db, guildId, command) => { const a = BY_COMMAND.get(command); return a && guildId && !featureOn(db, guildId, a.id) ? a : null; };

export const featureList = (db, guildId) => { const off = featuresOff(db, guildId); return AREAS.map(a => ({ id: a.id, name: a.name, emoji: a.emoji, about: a.about, on: !off.includes(a.id) })); };

// ---- /manage features: one private panel with a pick list ----
export const FEATURE_PICK = "feat_pick";

export function featuresPanel(db, guildId) {
    const list = featureList(db, guildId);
    return {
        embeds: [{
            color: 0x1b9aaa, title: "What this server uses",
            description: "Pick the areas you want **on**. Anything left out is switched off for this server: its commands answer with a short note instead of running.\nPrices, wishlists and alerts are always on.",
            fields: list.map(a => ({ name: `${a.on ? "🟢" : "⚪"} ${a.emoji} ${a.name}`, value: a.about, inline: true })),
            footer: { text: "The same switches are on the dashboard's Setup page." }
        }],
        components: [{ type: 1, components: [{
            type: 3, custom_id: FEATURE_PICK, placeholder: "Areas to keep on", min_values: 0, max_values: list.length,
            options: list.map(a => ({ label: a.name, value: a.id, description: a.about.slice(0, 100), emoji: { name: a.emoji }, default: a.on }))
        }] }]
    };
}

const canManage = i => i.inGuild() && Boolean(i.memberPermissions?.has(PermissionFlagsBits.ManageGuild));

export async function handleFeaturesCommand(i, db) {
    if (!canManage(i)) return i.reply({ content: "Run this in your server with the Manage Server permission.", flags: MessageFlags.Ephemeral });
    return i.reply({ ...featuresPanel(db, i.guildId), flags: MessageFlags.Ephemeral });
}

export async function handleFeaturesPick(i, db) {
    if (!canManage(i)) return i.reply({ content: "Only someone with Manage Server can change this.", flags: MessageFlags.Ephemeral });
    const keep = new Set(i.values);
    setFeaturesOff(db, i.guildId, AREAS.map(a => a.id).filter(id => !keep.has(id)));
    return i.update(featuresPanel(db, i.guildId));
}

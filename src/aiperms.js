import { PermissionFlagsBits as P } from "discord.js";

// What the bot needs in a channel to answer there. View Channel isn't listed: without it the message never reaches the bot.
const NEEDED = [
    ["SendMessages", "Send Messages", P.SendMessages],
    ["ReadMessageHistory", "Read Message History", P.ReadMessageHistory]
];

// Which of those the bot is missing in this channel. `perms` is a discord.js Permissions object (or null if unknown).
export function missingAiPerms(perms) {
    if (!perms) return [];
    return NEEDED.filter(([, , bit]) => !perms.has(bit)).map(([key, label]) => ({ key, label }));
}

// The words to say about them, depending on whether the bot can speak in the channel at all.
export function permsNotice(missing, channelId) {
    if (!missing.length) return null;
    const list = missing.map(x => `**${x.label}**`).join(" and ");
    const canSpeak = !missing.some(x => x.key === "SendMessages");
    return canSpeak
        ? { where: "channel", text: `I'd love to answer that, but I need ${list} in this channel first. A server admin can switch it on in the channel's permissions for my role.` }
        : { where: "dm", text: `You asked me something in <#${channelId}>, but I can't answer there: I'm missing ${list} in that channel. Ask a server admin to allow it for my role and I'll jump in.` };
}

// Say it once in a while, not on every question.
const told = new Map();
export function shouldTell(channelId, now = Date.now(), every = 3600_000) {
    const last = told.get(channelId) ?? 0;
    if (now - last < every) return false;
    told.set(channelId, now);
    if (told.size > 2000) for (const [k, t] of told) if (now - t > every) told.delete(k);
    return true;
}

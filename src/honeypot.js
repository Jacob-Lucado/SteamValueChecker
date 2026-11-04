// The trap channel: a visible channel that says, loudly, "do not type here". Spam and scam accounts that post in every channel they can see
// get banned the moment they write in it, with their last day of messages removed. Staff are never touched.

export const HONEYPOT_NAME = "do-not-type-here";
export const HONEYPOT_TOPIC = "⛔ TRAP CHANNEL: do NOT type here. Anyone who sends a message in this channel is banned automatically. It only exists to catch spam and scam bots.";

/** How many accounts this server's trap has banned. */
export const honeypotBans = (db, guildId) => Number(db.getMeta?.(`hpbans:${guildId}`) ?? 0) || 0;

/** The notice posted in the channel itself, with the running ban count. */
export function honeypotPayload(bans = 0) {
    return { embeds: [{ color: 0xed4245, title: "⛔  DO NOT TYPE IN THIS CHANNEL",
        description: `**This channel is a trap for spam and scam bots.**\n\nIf you send a message here, you get **banned automatically**. No warning, no second chances.\n\n🔨 **${bans.toLocaleString("en-US")}** ${bans === 1 ? "account" : "accounts"} banned here so far`,
        fields: [
            { name: "Real members", value: "There's nothing here for you, so just head to the other channels. Please don't test it, reply to this, or say hi. It really will ban you." },
            { name: "Bots and spammers", value: "The moment you post, you're banned and your messages from the last day are deleted." },
            { name: "Banned by mistake?", value: "Message a moderator and they'll look at it. They can undo it with `/mod unban`." }],
        footer: { text: "Steam Value Checker · spam trap" } }] };
}

/** Posts the notice (with the current count) and remembers its message so the count can be kept up to date. */
export async function postHoneypotNotice({ db, api, guildId, channelId }) {
    const m = await api.sendMessage(channelId, { embeds: honeypotPayload(honeypotBans(db, guildId)).embeds, allowed_mentions: { parse: [] } }).catch(() => null);
    if (m?.id) db.setMeta(`hpmsg:${guildId}`, m.id);
    return m ?? null;
}

/** Brings the count in the channel's notice up to date. If the notice was deleted, a new one is posted. */
export async function refreshHoneypotNotice({ db, api, guildId }) {
    const channelId = db.getCommunity(guildId).honeypot_channel;
    if (!channelId) return false;
    const id = db.getMeta(`hpmsg:${guildId}`);
    const payload = { embeds: honeypotPayload(honeypotBans(db, guildId)).embeds, allowed_mentions: { parse: [] } };
    if (id) { try { await api.editMessage(channelId, id, payload); return true; } catch { /* gone: post it again */ } }
    return Boolean(await postHoneypotNotice({ db, api, guildId, channelId }));
}

/**
 * Handles a message in the trap channel. `staff` is true for the server owner and anyone who can moderate.
 * Returns "banned", "ignored" (staff, a bot, or not the trap channel), "paused" (switched off by the bot owner; the message is removed) or "failed" (the ban was refused; the message is still removed).
 */
export async function honeypotHit({ db, moderation, guildId, channelId, userId, botId, isBot = false, staff = false, deleteMessage = async () => {}, log = () => {}, onBan = () => {}, settings = {} }) {
    const c = db.getCommunity(guildId);
    if (!c.honeypot_channel || c.honeypot_channel !== channelId) return "ignored";
    if (isBot || staff || userId === botId) return "ignored";
    if (settings.enabled === false) { await deleteMessage().catch(() => {}); return "paused"; }
    try {
        await moderation.ban({ guildId, actorId: botId, userId, reason: "Posted in the trap channel (spam or scam bot)", deleteDays: settings.deleteDays ?? 1 });
        db.bumpUsage?.("honeypot_bans");
        db.bumpMeta?.(`hpbans:${guildId}`);
        try { onBan(); } catch { /* the counter in the channel is a bonus */ }
        return "banned";
    } catch (e) {
        log(`could not ban ${userId}: ${e?.message}`);
        await deleteMessage().catch(() => {});
        db.bumpUsage?.("honeypot_failed");
        return "failed";
    }
}

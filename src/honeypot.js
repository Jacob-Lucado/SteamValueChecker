// The trap channel: a visible channel that says, loudly, "do not type here". Spam and scam accounts that post in every channel they can see
// get banned the moment they write in it, with their last day of messages removed. Staff are never touched.

export const HONEYPOT_NAME = "do-not-type-here";
export const HONEYPOT_TOPIC = "⛔ TRAP CHANNEL: do NOT type here. Anyone who sends a message in this channel is banned automatically. It only exists to catch spam and scam bots.";

/** The notice posted in the channel itself. */
export function honeypotPayload() {
    return { embeds: [{ color: 0xed4245, title: "⛔  DO NOT TYPE IN THIS CHANNEL",
        description: "**This is a trap for spam and scam bots.**\n\nAnyone who sends a message here is **banned automatically**, with no warning and no second chance.",
        fields: [
            { name: "Real members", value: "Nothing here is for you. Close this channel and head to the others. Please do not test it, reply to this message or say hi." },
            { name: "Bots and spammers", value: "Your account is banned and your messages from the last day are deleted as soon as you post." },
            { name: "Banned by mistake?", value: "Ask a moderator to review the case. They can lift it with `/mod unban`." }],
        footer: { text: "Steam Value Checker · spam trap" } }] };
}

/**
 * Handles a message in the trap channel. `staff` is true for the server owner and anyone who can moderate.
 * Returns "banned", "ignored" (staff, a bot, or not the trap channel) or "failed" (the ban was refused; the message is still removed).
 */
export async function honeypotHit({ db, moderation, guildId, channelId, userId, botId, isBot = false, staff = false, deleteMessage = async () => {}, log = () => {} }) {
    const c = db.getCommunity(guildId);
    if (!c.honeypot_channel || c.honeypot_channel !== channelId) return "ignored";
    if (isBot || staff || userId === botId) return "ignored";
    try {
        await moderation.ban({ guildId, actorId: botId, userId, reason: "Posted in the trap channel (spam or scam bot)", deleteDays: 1 });
        db.bumpUsage?.("honeypot_bans");
        return "banned";
    } catch (e) {
        log(`could not ban ${userId}: ${e?.message}`);
        await deleteMessage().catch(() => {});
        db.bumpUsage?.("honeypot_failed");
        return "failed";
    }
}

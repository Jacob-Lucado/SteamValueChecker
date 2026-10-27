// /redeem: queue Steam keys from Discord. The member's dashboard (Batch redeem page) picks them up, the FanaticalGrabber
// extension redeems them in their own logged-in browser, and the results come back here as a DM.
import { MessageFlags } from "discord.js";
import { UserError } from "./errors.js";
import { extractKeys } from "./redeemstore.js";
import { readUploadText } from "./upload.js";

export function createRedeemHandlers({ db, publicUrl }) {
    const link = publicUrl ? `${publicUrl.replace(/\/$/, "")}/#/redeem` : null;
    async function handle(i) {
        const reply = content => i.reply({ content, flags: MessageFlags.Ephemeral });
        db.ensureUser(i.user.id, i.guildId);
        if (i.options.getBoolean("cancel")) return reply(db.cancelRedeemJob(i.user.id) ? "Cancelled. Those keys are erased." : "No batch is waiting.");
        const file = i.options.getAttachment("file");
        const text = [i.options.getString("keys"), file ? await readUploadText(file) : null].filter(Boolean).join("\n");
        if (!text.trim()) {
            const w = db.pendingRedeemJob(i.user.id);
            return reply(w ? `A batch of **${w.total}** key${w.total === 1 ? " is" : "s are"} waiting. Open ${link ?? "the dashboard's Batch redeem page"} to run it, or \`/redeem cancel:true\` to drop it.` : "Give me some keys with `keys:` or `file:`, for example `/redeem keys:AAAAA-BBBBB-CCCCC`.");
        }
        const keys = extractKeys(text);
        if (!keys.length) throw new UserError("I could not find any Steam keys. They look like `AAAAA-BBBBB-CCCCC`.");
        db.createRedeemJob(i.user.id, keys);
        return reply([
            `Queued **${keys.length}** Steam key${keys.length === 1 ? "" : "s"}. Nothing is redeemed yet.`,
            `1. Log into Steam in your browser (store.steampowered.com).`,
            `2. Open ${link ?? "the dashboard's **Batch redeem** page"} with the FanaticalGrabber extension (2.3 or newer) installed, and press **Run**.`,
            `I will DM you the results. Keys are erased when it finishes, or after 24 hours. Redeeming cannot be undone.`
        ].join("\n"));
    }
    return { handle };
}

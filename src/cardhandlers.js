// /profilecard: your shareable profile card, posted as a picture. Same card as the My page on the website.
import { AttachmentBuilder, MessageFlags } from "discord.js";
import { renderProfileCard } from "./cardimg.js";
import { UserError } from "./errors.js";

const COOLDOWN_MS = 10_000;
const last = new Map();

export function createCardHandlers({ db, fetchImpl = fetch, publicUrl = null }) {
    async function handle(i) {
        const shared = i.options.getBoolean("public") === true;
        try {
            const w = COOLDOWN_MS - (Date.now() - (last.get(i.user.id) ?? 0));
            if (w > 0) throw new UserError(`Slow down a little. Try again in ${Math.ceil(w / 1000)}s.`);
            last.set(i.user.id, Date.now());
            await i.deferReply(shared ? {} : { flags: MessageFlags.Ephemeral });
            const png = await renderProfileCard({ db, userId: i.user.id, name: i.user.globalName ?? i.user.username, fetchImpl });
            const file = new AttachmentBuilder(Buffer.from(png), { name: "my-game-profile.png", description: `${i.user.globalName ?? i.user.username}'s game profile card` });
            const tip = publicUrl ? `Add your gaming names, colour and pictures on the dashboard: ${publicUrl}/#/mypage` : "Add your gaming names, colour and pictures on the dashboard's My page.";
            await i.editReply({ content: shared ? "" : tip, files: [file] });
        } catch (err) {
            const known = err instanceof UserError;
            if (!known) console.error(`[profilecard] ${err.name}: ${err.message}`);
            const content = known ? err.message : "Something went wrong drawing your card. Try again in a moment.";
            if (i.deferred || i.replied) await i.editReply({ content, files: [] }).catch(() => {});
            else await i.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    }
    return { handle };
}

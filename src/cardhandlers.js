// /me profilecard: your public profile page, drawn as a picture. It shows what anyone sees on the page, nothing private.
import { AttachmentBuilder, MessageFlags } from "discord.js";
import { renderProfileCard } from "./profilecard.js";
import { buildProfile } from "./profilepage.js";
import { UserError } from "./errors.js";

const COOLDOWN_MS = 10_000;
const last = new Map();

export function createCardHandlers({ db, itad = null, nowPlaying = null, fetchImpl = fetch, publicUrl = null, profilesOn = () => true }) {
    async function handle(i) {
        const shared = i.options.getBoolean("public") === true;
        try {
            const w = COOLDOWN_MS - (Date.now() - (last.get(i.user.id) ?? 0));
            if (w > 0) throw new UserError(`Slow down a little. Try again in ${Math.ceil(w / 1000)}s.`);
            const owner = db.getUser(i.user.id);
            const link = publicUrl ? `${publicUrl}/profile` : "the dashboard's My profile page";
            if (!profilesOn()) throw new UserError("Profile pages are switched off right now.");
            if (!owner?.profile_slug || !owner.profile_public) throw new UserError(`The card is your profile page as a picture, so turn your page on first. Choose a name, switch it on and design it at ${link}.`);
            if (db.getProfileData(i.user.id).blocked) throw new UserError("Your profile page is not available right now.");
            if (last.size > 5000) { const cut = Date.now() - COOLDOWN_MS; for (const [k, t] of last) if (t < cut) last.delete(k); }
            last.set(i.user.id, Date.now());
            await i.deferReply(shared ? {} : { flags: MessageFlags.Ephemeral });
            const profile = await buildProfile({ db, itad, nowPlaying }, owner, { owner: false, sameServer: false });
            const png = await renderProfileCard({ profile, fetchImpl });
            const file = new AttachmentBuilder(Buffer.from(png), { name: "my-profile.png", description: `${profile.name}'s profile page` });
            const url = publicUrl ? `${publicUrl}/u/${owner.profile_slug}` : null;
            await i.editReply({ content: shared ? (url ?? "") : (url ? `Your page: ${url}` : ""), files: [file] });
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

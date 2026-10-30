// Discord side of feature requests: /feature request, list and vote.
import { MessageFlags } from "discord.js";
import { UserError } from "./errors.js";
import { submitRequest, requestListEmbed } from "./requests.js";
import { REQUEST_STATUSES } from "./requeststore.js";

export const FR = { modal: "fr_new" };
const eph = (i, content) => i.reply({ content, flags: MessageFlags.Ephemeral });
const field = (id, label, style, max, placeholder = "", required = true) => ({ type: 1, components: [{ type: 4, custom_id: id, label, style, required, max_length: max, placeholder }] });

export function createRequestHandlers({ db, publish = null, publicUrl = null }) {
    async function failed(i, err) {
        if (!(err instanceof UserError)) console.error(`[feature] ${err.name}: ${err.message}`);
        const content = err instanceof UserError ? err.message : "Something went wrong. Try again in a moment.";
        if (i.deferred || i.replied) await i.editReply({ content, embeds: [], components: [] }).catch(() => {}); else await eph(i, content).catch(() => {});
    }

    async function handleCommand(i) {
        try {
            const sub = i.options.getSubcommand();
            if (sub === "request") {
                return await i.showModal({ custom_id: FR.modal, title: "Suggest a feature", components: [
                    field("title", "Your idea in a few words", 1, 100, "e.g. Dark mode for profile cards"), field("body", "More detail (optional)", 2, 1000, "What problem does it solve?", false)] });
            }
            if (sub === "list") {
                const status = i.options.getString("status");
                const rows = db.listRequests(i.user.id, { status: REQUEST_STATUSES[status] ? status : null }).slice(0, 12);
                return await i.reply({ flags: MessageFlags.Ephemeral, embeds: [requestListEmbed(rows, { status: REQUEST_STATUSES[status] ? status : null, base: publicUrl })] });
            }
            if (sub === "vote") {
                const r = db.getRequest(i.options.getInteger("id", true));
                if (!r) throw new UserError("I can't find a request with that number. Use `/feature list` to see them.");
                const voted = db.toggleRequestVote(r.id, i.user.id);
                return await eph(i, voted ? `Voted for **${r.title}**.` : `Took back your vote for **${r.title}**.`);
            }
        } catch (err) { await failed(i, err); }
    }

    async function handleModal(i) {
        try {
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            const id = submitRequest({ db, userId: i.user.id, userName: i.user.username, title: i.fields.getTextInputValue("title"), body: i.fields.getTextInputValue("body"), publish });
            return void await i.editReply(`Thanks! Your idea is request **#${id}**. Others can vote with \`/feature vote id:${id}\`${publicUrl ? ` or on ${publicUrl}/#/requests` : ""}. You will get a DM when its status changes.`);
        } catch (err) { await failed(i, err); }
    }
    return { handleCommand, handleModal };
}

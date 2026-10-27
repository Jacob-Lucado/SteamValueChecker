// /bundle and /saleprep: Discord side. The analysis lives in bundle.js and saleprep.js, the embeds in dealrender.js.
import { MessageFlags } from "discord.js";
import { bundleCheck } from "./bundle.js";
import { salePrep, saleRecap } from "./saleprep.js";
import { bundleEmbeds, salePrepEmbed, recapEmbed } from "./dealrender.js";
import { regionPrices } from "./regions.js";
import { regionsEmbed } from "./render.js";
import { UserError } from "./errors.js";
import { ItadError } from "./itad.js";

export function createDealHandlers({ db, itad, fx = null }) {
    const eph = (i, content) => i.reply({ content, flags: MessageFlags.Ephemeral });
    async function failed(i, err) {
        const known = err instanceof UserError || err instanceof ItadError;
        if (!known) console.error(`[deals] ${err.name}: ${err.message}`);
        const content = known ? err.message : "Something went wrong. Try again in a moment.";
        if (i.deferred || i.replied) await i.editReply({ content, embeds: [] }).catch(() => {});
        else await eph(i, content).catch(() => {});
    }

    async function handleBundle(i) {
        const user = db.ensureUser(i.user.id, i.guildId);
        try {
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            const title = i.options.getString("game");
            let gameIds;
            if (title) {
                const [hit] = await itad.lookupTitles([title]);
                if (!hit?.id) throw new UserError(`I could not find a game called ${title}.`);
                gameIds = [hit.id];
            } else gameIds = db.listItems(i.user.id).map(x => x.itad_id);
            const res = await bundleCheck({ db, itad, user, gameIds });
            if (!res.bundles.length) return void await i.editReply(title ? "That game is not in an active bundle right now." : "None of your wishlist games are in an active bundle right now.");
            return void await i.editReply({ embeds: bundleEmbeds(res) });
        } catch (err) { await failed(i, err); }
    }

    async function handleRegions(i) {
        const user = db.ensureUser(i.user.id, i.guildId);
        try {
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            const title = i.options.getString("game", true);
            const [hit] = await itad.lookupTitles([title]);
            if (!hit?.id) throw new UserError(`I could not find a game called ${title}.`);
            const rows = await regionPrices({ itad, fx, itadId: hit.id, home: user.region, majorOnly: user.stores === "major" });
            if (!rows.length) throw new UserError("No shop has a price for that game in these regions.");
            return void await i.editReply({ embeds: [regionsEmbed(hit.matched || title, rows)] });
        } catch (err) { await failed(i, err); }
    }

    async function handleSalePrep(i) {
        const user = db.ensureUser(i.user.id, i.guildId);
        try {
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            if (i.options.getSubcommand() === "recap") return void await i.editReply({ embeds: [recapEmbed(saleRecap(db, i.user.id, { days: i.options.getInteger("days") ?? 14 }))] });
            const r = await salePrep({ db, itad, user, budget: i.options.getNumber("budget") });
            return void await i.editReply({ embeds: [salePrepEmbed(r)] });
        } catch (err) { await failed(i, err); }
    }
    return { handleRegions, handleBundle, handleSalePrep };
}

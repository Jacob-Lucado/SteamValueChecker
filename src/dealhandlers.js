// /games bundle and /games saleprep: Discord side. The analysis lives in bundle.js and saleprep.js, the embeds in dealrender.js.
import { MessageFlags } from "discord.js";
import { bundleCheck } from "./bundle.js";
import { salePrep, saleRecap } from "./saleprep.js";
import { bundleEmbeds, salePrepEmbed, recapEmbed } from "./dealrender.js";
import { consolePrices } from "./consoleprices.js";
import { consolesEmbed, consolesButtons } from "./consolerender.js";
import { summarize } from "./report.js";
import { regionPrices } from "./regions.js";
import { regionsEmbed } from "./render.js";
import { UserError } from "./errors.js";
import { ItadError } from "./itad.js";

export function createDealHandlers({ db, itad, fx = null, fetchFn = globalThis.fetch }) {
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
    async function handleConsoles(i) {
        const user = db.ensureUser(i.user.id, i.guildId);
        try {
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            const title = i.options.getString("game", true).trim();
            const [data, pc] = await Promise.all([
                consolePrices({ title, country: user.region || "US", fetchFn }),
                (async () => {
                    try {
                        const [hit] = await itad.lookupTitles([title]);
                        if (!hit?.id) return null;
                        const entry = (await itad.getPrices([hit.id], user.region || "US")).get(hit.id);
                        const s = entry ? summarize(entry, { majorOnly: user.stores === "major" }) : null;
                        return s?.best ? { price: s.best.price, currency: s.best.currency ?? null, shop: s.best.shop, discount: s.msrp ? Math.max(0, 1 - s.best.price / s.msrp) : 0 } : null;
                    } catch { return null; }
                })()
            ]);
            if (!data.xbox && !data.nintendo && !data.xboxError && !data.nintendoError) throw new UserError(`I couldn't find ${title} on Xbox or the Nintendo eShop. It might be PC-only, or try the exact title.`);
            return void await i.editReply({ embeds: [consolesEmbed({ title, data, pc, region: user.region || "US" })], components: consolesButtons(data) });
        } catch (err) { await failed(i, err); }
    }
    return { handleRegions, handleBundle, handleSalePrep, handleConsoles };
}

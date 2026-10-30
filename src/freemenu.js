// The /freegames message: one game per page with big artwork, category buttons (Games / DLC / All), a store menu and
// page buttons. All the state is in the custom ids, so there is nothing to store and it keeps working after a restart.
import { freeGamesPayload, shopIcon } from "./render.js";

const TITLE_DLC = /\b(dlc|soundtrack|add-?on|season pass)\b/i;
/** ITAD says what a listing is; the title is a backup for stores that don't. */
export const isDlc = g => g?.type === "dlc" || TITLE_DLC.test(g?.title ?? "");
export const shopSlug = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20) || "other";

const CATS = [["games", "🎮", "Games"], ["dlc", "🧩", "DLC"], ["all", "📋", "All"]];
const CAT_NAME = { games: "Games", dlc: "DLC and add-ons", all: "Everything" };

export function freeMenu(list, { cat = "games", store = "all", page = 0, showDlc = true } = {}) {
    const valid = list.filter(g => /^https:\/\//i.test(g.url ?? ""));
    if (!showDlc || !CAT_NAME[cat]) cat = "games";
    const count = c => valid.filter(g => c === "all" || (c === "dlc") === isDlc(g)).length;
    const inCat = valid.filter(g => cat === "all" || (cat === "dlc") === isDlc(g));
    const shops = [...new Map(inCat.map(g => [shopSlug(g.shop), g.shop])).entries()].slice(0, 24);
    if (!shops.some(([slug]) => slug === store)) store = "all";
    const rows = inCat.filter(g => store === "all" || shopSlug(g.shop) === store).sort((a, b) => (a.expiry ?? Infinity) - (b.expiry ?? Infinity));
    const pages = Math.max(1, rows.length);
    page = Math.min(Math.max(0, Math.trunc(page) || 0), pages - 1);
    const g = rows[page];

    let embed;
    if (g) {
        embed = { ...freeGamesPayload(g.shop, [g]).embeds[0] };
        const next = rows.slice(page + 1, page + 4).map(x => `${isDlc(x) ? "🧩" : "🎮"} ${x.title}`.slice(0, 60));
        if (next.length) embed.fields = [...embed.fields, { name: "Up next", value: next.join("\n"), inline: false }];
        embed.footer = { text: `${page + 1} of ${rows.length}  •  ${CAT_NAME[cat]}  •  Data by IsThereAnyDeal` };
    } else {
        embed = { color: 0x57f287, title: "Nothing free here right now", description: cat === "dlc" ? "No free DLC at the moment." : "No free games at the moment. Turn on `/alerts freegames` to be told when one appears." };
    }

    const components = [];
    if (showDlc) {
        components.push({ type: 1, components: CATS.map(([id, icon, label]) => ({ type: 2, style: id === cat ? 1 : 2, label: `${icon} ${label} (${count(id)})`, custom_id: `fg:${id}:all:0:tab` })) }); // the :tab suffix keeps these ids different from Prev/Next, which can point at the same place
    }
    if (shops.length > 1 || store !== "all") {
        components.push({ type: 1, components: [{
            type: 3, custom_id: `fgs:${cat}`, placeholder: "Filter by store",
            options: [{ label: `All stores (${inCat.length})`, value: "all", default: store === "all" },
                ...shops.map(([slug, name]) => ({ label: `${name}`.slice(0, 100), value: slug, emoji: { name: shopIcon(name) }, default: store === slug }))]
        }] });
    }
    const nav = [
        { type: 2, style: 2, label: "◀ Prev", custom_id: `fg:${cat}:${store}:${page - 1}`, disabled: page === 0 },
        { type: 2, style: 2, label: `${rows.length ? page + 1 : 0} / ${rows.length}`, custom_id: "fg_page", disabled: true },
        { type: 2, style: 2, label: "Next ▶", custom_id: `fg:${cat}:${store}:${page + 1}`, disabled: page >= rows.length - 1 }
    ];
    if (g) nav.push({ type: 2, style: 5, label: "Claim this one", url: g.url });
    components.push({ type: 1, components: nav });
    return { content: rows.length ? `**${rows.length}** free ${rows.length === 1 ? "offer" : "offers"} right now` : "", embeds: [embed], components };
}

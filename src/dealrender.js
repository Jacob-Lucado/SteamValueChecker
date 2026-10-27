// Embeds for /bundle and /saleprep. No Discord library needed, so they are easy to test.
import { money } from "./render.js";

const safeUrl = u => (typeof u === "string" && /^https:\/\//i.test(u) ? u : undefined);
const COLORS = { great: 0x57f287, good: 0x57f287, wait: 0xfee75c, info: 0x9b59b6 };
const trim = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const stamp = ms => `<t:${Math.floor(ms / 1000)}:R>`;

export function bundleEmbeds(res) {
    return res.bundles.map(b => {
        const cur = b.currency ?? res.currency;
        const tiers = b.tiers.map(t => {
            const bits = [`**${money(t.price, cur)}**: ${t.games} games`];
            if (t.owned) bits.push(`${t.owned} you own`);
            if (t.worth > 0) bits.push(`worth ${money(t.worth, cur)} at today's prices (${t.saves >= 0 ? "saves" : "costs"} ${money(Math.abs(t.saves), cur)})`);
            if (t.wanted.length) bits.push(`on your wishlist: ${trim(t.wanted.slice(0, 4).join(", "), 120)}`);
            return "• " + bits.join(", ");
        }).join("\n");
        return {
            color: COLORS[b.verdict.level] ?? COLORS.info, title: trim(b.title, 240), url: safeUrl(b.url),
            description: `${b.shop ? `${b.shop}` : "Bundle"}${b.expiry ? `, ends ${stamp(b.expiry)}` : ""}\n**${b.verdict.text}**`,
            fields: [{ name: "Tiers", value: trim(tiers, 1000) }],
            footer: { text: "Assumes each tier includes the cheaper ones and leaves out games you own. Prices change; check the store before you buy." }
        };
    });
}

export function salePrepEmbed(r) {
    const cur = r.currency;
    const list = (rows, f, n = 8) => rows.slice(0, n).map(f).join("\n") + (rows.length > n ? `\n…and ${rows.length - n} more` : "");
    const fields = [];
    if (r.buyNow.length) fields.push({ name: `Buy now (${r.buyNow.length})`, value: trim(list(r.buyNow, x => `• **${x.title}** ${money(x.price, cur)}${x.discount > 0 ? ` (-${Math.round(x.discount * 100)}%)` : ""}: ${x.verdict}`), 1000) });
    if (r.wait.length) fields.push({ name: `Wait for a bigger drop (${r.wait.length})`, value: trim(list(r.wait, x => `• **${x.title}** ${money(x.price, cur)}, has been ${money(x.atl, cur)}`), 1000) });
    if (r.plan) fields.push({ name: `With ${money(r.budget, cur)}`, value: r.plan.picks.length ? trim(list(r.plan.picks, x => `• ${x.title} ${money(x.price, cur)}`) + `\n**${money(r.plan.spent, cur)}** spent, ${money(r.plan.left, cur)} left`, 1000) : "Nothing on the buy-now list fits that budget." });
    const when = r.sale ? (r.sale.live ? `**${r.sale.name}** is on now until <t:${Math.floor(r.sale.end / 1000)}:f>.` : `Next: **${r.sale.name}** starts <t:${Math.floor(r.sale.start / 1000)}:R>.`) : "No Steam sale is on the calendar yet.";
    return {
        color: 0x1b9aaa, title: "Sale prep", description: `${when}\nLooked at **${r.watching}** wishlist games.${fields.length ? "" : "\nNothing at or near a low right now, and nothing far above its low."}`,
        fields, footer: { text: "Buy now means at or near the game's all-time, 1-year or 3-month low. Only the cheapest store price counts." }
    };
}

export function recapEmbed(r) {
    if (!r.alerts) return { color: 0x1b9aaa, title: "Sale recap", description: `No sale alerts in the last ${r.days} days.` };
    return {
        color: 0x1b9aaa, title: "Sale recap",
        description: `In the last **${r.days}** days your alerts caught **${r.games}** games. At the alert prices they total **${r.spend.toFixed(2)}**${r.saved > 0 ? `, **${r.saved.toFixed(2)}** under their regular prices` : ""}.`,
        fields: r.top.length ? [{ name: "Biggest drops", value: trim(r.top.map(a => `• **${a.title}** ${a.price.toFixed(2)}${a.regular ? ` (was ${a.regular.toFixed(2)})` : ""}${a.shop ? ` at ${a.shop}` : ""}`).join("\n"), 1000) }] : [],
        footer: { text: "Prices are in the currency of each alert." }
    };
}


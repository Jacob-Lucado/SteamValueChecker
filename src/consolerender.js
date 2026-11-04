// The /games consoles card: one game's price on Xbox and Nintendo, next to the cheapest on PC.
const money = (n, c) => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency: c || "USD" }).format(n); } catch { return `${Number(n).toFixed(2)} ${c ?? ""}`.trim(); } };
const stamp = ms => `<t:${Math.floor(ms / 1000)}:R>`;

function line(r, err) {
    if (err) return "Couldn't reach this store just now.";
    if (!r) return "Not found here.";
    if (r.price == null) return "Found it, but couldn't get a price for your country. Use the button to check the store.";
    const off = r.regular > r.price ? Math.round((1 - r.price / r.regular) * 100) : 0;
    return off
        ? `**${money(r.price, r.currency)}** ~~${money(r.regular, r.currency)}~~ · **${off}% off**${r.endsAt ? `\nSale ends ${stamp(r.endsAt)}` : ""}`
        : `**${money(r.price, r.currency)}** · full price`;
}

export function consolesEmbed({ title, data, pc = null, region = "US" }) {
    const fields = [
        { name: "🎮 Xbox", value: line(data.xbox, data.xboxError), inline: true },
        { name: "🔴 Nintendo Switch", value: line(data.nintendo, data.nintendoError), inline: true },
        { name: "🔵 PlayStation", value: `No open price feed, so [search the PlayStation Store](${data.playstation}).`, inline: true }
    ];
    if (pc?.price != null) fields.push({ name: "🖥️ Cheapest on PC", value: `**${money(pc.price, pc.currency)}**${pc.shop ? ` at ${pc.shop}` : ""}${pc.discount > 0 ? ` · ${Math.round(pc.discount * 100)}% off` : ""}`, inline: false });
    const prices = [data.xbox, data.nintendo].filter(r => r?.price != null);
    let verdict = "";
    if (pc?.price != null && prices.length) {
        const lowest = prices.reduce((a, b) => (a.price <= b.price ? a : b));
        if (lowest.currency === pc.currency) verdict = lowest.price < pc.price ? `Cheapest of these: **${lowest.store}**.` : `PC is the cheapest of these.`;
    }
    return {
        color: 0x5865f2,
        title: `${data.xbox?.title ?? data.nintendo?.title ?? title}: console prices`,
        description: `${verdict}${verdict ? "\n" : ""}Store prices for **${region}**, read live from each store.`.trim(),
        fields,
        footer: { text: "Xbox and Nintendo prices come straight from their stores  •  PC prices by IsThereAnyDeal" }
    };
}

export function consolesButtons(data) {
    const row = [];
    if (data.xbox?.url) row.push({ type: 2, style: 5, label: "Xbox Store", url: data.xbox.url });
    if (data.nintendo?.url) row.push({ type: 2, style: 5, label: "Nintendo eShop", url: data.nintendo.url });
    row.push({ type: 2, style: 5, label: "PlayStation Store", url: data.playstation });
    return [{ type: 1, components: row }];
}

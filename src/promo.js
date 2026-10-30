// The FanaticalGrabber advertisement the bot owner can send. Opt-out is one button on the message itself.
export const PROMO_OFF_ID = "promo_off";

export function grabberPromo({ base = null, url = "https://jacob-lucado.github.io/FanaticalGrabber/", dashboardUrl = null }) {
    const root = base ? String(base).replace(/\/$/, "") : null;
    const img = n => (root ? { image: { url: `${root}/grabber-ad-${n}.png` } } : {});
    const page = url; // the same url on every embed makes Discord show them as one gallery
    const embeds = [
        { color: 0xff9800, url: page, author: { name: "📣 A message from the Steam Value Checker developer" }, title: "🔑 Meet FanaticalGrabber", ...img("hero"),
            description: "Got Fanatical bundles full of Steam keys? **FanaticalGrabber** is a free Chrome extension from the maker of Steam Value Checker. It reveals every key in one click, exports them, and redeems them on Steam in bulk.",
            fields: [
                { name: "🔓 Reveal & export", value: "Reveal all keys at once, then export to **TXT, CSV, JSON, Markdown, HTML or XLSX**, or copy them.", inline: false },
                { name: "🎟️ Batch redeem on Steam", value: "Redeem a whole list on your own account, one by one. Already-used keys are remembered and skipped. Keys never leave your browser except to Steam.", inline: false },
                { name: "🛒 Cart & bundle check", value: "See if a bundle is really worth it, and get warned at the Steam cart about games you already own or cheaper prices elsewhere.", inline: false }
            ] },
        { color: 0xff9800, url: page, ...img("cart"),
            fields: [
                { name: "💰 Fill in what you paid", value: "One click on your Steam purchase history fills the price you paid into your Steam Value Checker library. Key activations and gifts get their retail price.", inline: false },
                { name: "🔗 One-click connect", value: "Press **Connect the extension** on the dashboard's Library page. No codes to paste.", inline: false },
                { name: "🏷️ Price overlay", value: "On Steam game pages, see your price, the all-time low and whether you own or wishlisted it.", inline: false }
            ] },
        { color: 0xff9800, url: page, ...img("paid"), footer: { text: "Free · no account needed to use it · keys are never sent to any server. You can turn these messages off with the button below." } }
    ];
    const buttons = [{ type: 2, style: 5, label: "Get FanaticalGrabber", url: page }];
    if (dashboardUrl) buttons.push({ type: 2, style: 5, label: "Open the dashboard", url: dashboardUrl });
    buttons.push({ type: 2, style: 2, label: "No more promos", custom_id: PROMO_OFF_ID });
    return { embeds, components: [{ type: 1, components: buttons }], allowed_mentions: { parse: [] } };
}

// The FanaticalGrabber advertisement the bot owner can send. Opt-out is one button on the message itself.
export const PROMO_OFF_ID = "promo_off";

export function grabberPromo({ base = null, url = "https://jacob-lucado.github.io/FanaticalGrabber/", dashboardUrl = null }) {
    const root = base ? String(base).replace(/\/$/, "") : null;
    const img = n => (root ? { image: { url: `${root}/grabber-ad-${n}.png` } } : {});
    const page = url; // the same url on every embed makes Discord show them as one gallery
    const embeds = [
        { color: 0xff9800, url: page, author: { name: "A message from the Steam Value Checker developer" }, title: "Meet FanaticalGrabber", ...img("hero"),
            description: "Ever bought a Fanatical bundle and dreaded clicking Reveal on every single key? I made **FanaticalGrabber** for exactly that. It's a free Chrome extension that reveals all your keys at once, exports them, and can redeem them on Steam in bulk.",
            fields: [
                { name: "🔓 Reveal & export", value: "Reveal everything in one go, then export to **TXT, CSV, JSON, Markdown, HTML or XLSX**, or just copy it.", inline: false },
                { name: "🎟️ Batch redeem on Steam", value: "Redeem a whole list on your own account, one key at a time. It remembers keys you've already used and skips them. Your keys only ever go to Steam.", inline: false },
                { name: "🛒 Cart & bundle check", value: "Find out if a bundle is actually worth it, and get a heads-up at the Steam cart if you already own something or it's cheaper elsewhere.", inline: false }
            ] },
        { color: 0xff9800, url: page, ...img("cart"),
            fields: [
                { name: "💰 Fill in what you paid", value: "One click on your Steam purchase history and it fills in what you paid for each game in your Steam Value Checker library. Key activations and gifts get their retail price.", inline: false },
                { name: "🔗 One-click connect", value: "Hit **Connect the extension** on the dashboard's Library page. No codes to copy and paste.", inline: false },
                { name: "🏷️ Price overlay", value: "On a Steam game page you can see what you paid, the all-time low, and whether you already own it or have it wishlisted.", inline: false }
            ] },
        { color: 0xff9800, url: page, ...img("paid"), footer: { text: "Free, no account needed, and your keys never go to a server. Don't want these messages? Use the button below to turn them off." } }
    ];
    const buttons = [{ type: 2, style: 5, label: "Get FanaticalGrabber", url: page }];
    if (dashboardUrl) buttons.push({ type: 2, style: 5, label: "Open the dashboard", url: dashboardUrl });
    buttons.push({ type: 2, style: 2, label: "No more promos", custom_id: PROMO_OFF_ID });
    return { embeds, components: [{ type: 1, components: buttons }], allowed_mentions: { parse: [] } };
}

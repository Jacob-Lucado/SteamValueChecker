// /dashboard and /dash: the link to the dashboard, optionally straight to one page.
export const DASH_PAGES = ["library", "steam", "value", "wishlist", "foryou", "free", "servers", "community", "xp", "mod", "alerts", "help"];

/** The address to open, or null when the dashboard is switched off. Only known page names are used. */
export function dashLink(publicUrl, page = null) {
    if (!publicUrl) return null;
    const base = String(publicUrl).replace(/\/+$/, "");
    return DASH_PAGES.includes(page) ? `${base}/#/${page}` : base;
}

export function dashPayload(publicUrl, page = null) {
    const url = dashLink(publicUrl, page);
    if (!url) return { content: "The dashboard is not turned on for this bot.", flags: 64 };
    return {
        flags: 64,
        embeds: [{ color: 0x4d8cff, title: "Steam Value Checker dashboard", description: "Your library, wishlist, deals, servers, community and moderation in one place. Sign in with Discord (and Steam) and everything is ready.", url }],
        components: [{ type: 1, components: [{ type: 2, style: 5, label: "Open the dashboard", url }] }]
    };
}

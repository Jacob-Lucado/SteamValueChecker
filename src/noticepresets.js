// Ready-made announcements the owner can send in one click, styled like the FanaticalGrabber advertisement.
export const NOTICE_PRESETS = {
    restart: {
        label: "Restarting for an update", icon: "🔄", color: 0xfaa61a,
        title: "Restarting for an update",
        description: "I'm restarting the bot to roll out an update, so it'll be offline for a minute or two.\n\nNothing gets lost. Your wishlist, alerts and settings are all saved, and anything that comes up while I'm away is sent once I'm back.",
        fields: [
            { name: "⏱️ How long", value: "Usually a couple of minutes.", inline: true },
            { name: "💾 Your data", value: "Safe, nothing is reset.", inline: true },
            { name: "🔔 Missed alerts", value: "They catch up as soon as I'm back online.", inline: false }
        ],
        footer: "If it's still down after a while, tell me through Support on the dashboard."
    },
    dev: {
        label: "Still in development", icon: "🛠️", color: 0x5865f2,
        title: "Still in active development",
        description: "Steam Value Checker is a solo project and I'm adding to it all the time, so a heads-up: **things are still being built.**\n\nThat means new features land often, you might hit the odd bug, and the bot can go down at random while I push fixes.",
        fields: [
            { name: "⚡ Random downtime", value: "Expect short outages now and then. They're almost always updates.", inline: false },
            { name: "🐞 Found a bug?", value: "Tell me through Support on the dashboard. Every report gets read.", inline: false },
            { name: "✨ What's next", value: "More features, and more polish on the ones already here.", inline: false }
        ],
        footer: "Thanks for being patient while it gets better."
    },
    thanks: {
        label: "Thank you", icon: "💛", color: 0x57f287,
        title: "Thank you for using Steam Value Checker",
        description: "I just wanted to say thanks. I built this because I love a good deal, and it means a lot that you're using it.\n\nEvery wishlist, bug report and bit of feedback helps shape what comes next. Enjoy the games, and may your next one be 80% off.",
        fields: [],
        footer: "Made with care by Jacob Lucado"
    }
};

export const NOTICE_PRESET_IDS = Object.keys(NOTICE_PRESETS);

export function noticePreset(id, { base = null, dashboardUrl = null, creator = null } = {}) {
    const p = NOTICE_PRESETS[id];
    if (!p) return null;
    const root = base ? String(base).replace(/\/$/, "") : null;
    const embed = {
        color: p.color, author: { name: "📣 A message from the Steam Value Checker developer" },
        title: `${p.icon} ${p.title}`, description: p.description,
        ...(p.fields.length ? { fields: p.fields } : {}),
        footer: { text: p.footer },
        ...(root ? { image: { url: `${root}/notice-${id}.png` } } : {})
    };
    if (creator?.url) embed.url = creator.url;
    const buttons = [];
    if (dashboardUrl) buttons.push({ type: 2, style: 5, label: "Open the dashboard", url: dashboardUrl });
    if (creator?.url) buttons.push({ type: 2, style: 5, label: "Follow on X", url: creator.url });
    return { embeds: [embed], ...(buttons.length ? { components: [{ type: 1, components: buttons }] } : {}), allowed_mentions: { parse: [] } };
}

// A read-only "start here" channel the bot makes for itself when it joins a server, showing how to get set up.
// Everything Discord-facing is injected, so the logic can be tested without a connection.

const VIEW = 1024n, SEND = 2048n, EMBED = 16384n, HISTORY = 65536n;
export const START_CHANNEL = "steam-value-checker";

export function startEmbed({ guildName, url = null, ready = false }) {
    const steps = ready
        ? ["Your server was set up automatically, so the channels are already in place.", "Members can run `/me wishlist import` to bring in their Steam wishlist.", "Use `/games value` to see what a Steam library is worth.", "Open the dashboard to fine-tune channels, roles and alerts."]
        : ["A server manager runs **`/manage setup`** and presses **Create the channels for me**. That makes the alert and giveaway channels.", "Want the full gaming layout (welcome, XP, invites, giveaways)? Run **`/manage community setup`**.", "Members run **`/me wishlist import`** to bring in their Steam wishlist and get deal alerts.", "Anyone can try **`/games value`** to see what a Steam library is worth. **`/help`** lists everything."];
    return {
        color: 0xff9800,
        title: `Welcome to ${guildName ? `${guildName}'s` : "your"} Steam Value Checker corner`,
        description: "Deal alerts, free game drops, giveaways and library values, all in one bot. Here's how to get going:",
        fields: [{ name: "Getting set up", value: steps.map((s, i) => `**${i + 1}.** ${s}`).join("\n") }, { name: "Good to know", value: "You can delete this channel once you're set up. The bot won't make it again." }],
        ...(url ? { footer: { text: "Dashboard: " + url.replace(/^https?:\/\//, "") } } : {})
    };
}

/** Makes (or finds) the channel and posts the guide once. Never throws; returns { channelId } or { skipped }. */
export async function createStartChannel({ api, discord, db, guild, everyoneId = guild.id, botId, url = null, ready = false }) {
    const key = `startch:${guild.id}`;
    if (db.getMeta(key)) return { skipped: "already made" };
    db.setMeta(key, "1"); // set first, so a second join event can't make two
    try {
        const ch = await api.createChannel(guild.id, {
            name: START_CHANNEL, type: 0, topic: "How to get Steam Value Checker set up. Read-only.",
            permission_overwrites: [
                { id: everyoneId, type: 0, allow: String(VIEW | HISTORY), deny: String(SEND) },
                { id: botId, type: 1, allow: String(VIEW | SEND | EMBED | HISTORY) }
            ]
        });
        const payload = { embeds: [startEmbed({ guildName: guild.name, url, ready })] };
        if (url) payload.components = [{ type: 1, components: [{ type: 2, style: 5, label: "Open the dashboard", url: `${url}/#/setup/${guild.id}` }] }];
        db.setMeta(`startch_id:${guild.id}`, ch.id); // global giveaways are posted here too
        await discord.sendChannel(ch.id, payload);
        return { channelId: ch.id };
    } catch (e) {
        return { skipped: String(e?.message ?? e).slice(0, 100) }; // no Manage Channels permission is the usual reason
    }
}

// "Can the bot reach me?": a member whose DMs are closed gets nothing from the bot, and until now nobody told them. After
// three refused DMs we say so wherever they look at their alert settings, with the fix and what happens to their alerts meanwhile.

export const DM_FAIL_LIMIT = 3;

/** True when direct messages are how alerts are meant to arrive and Discord keeps refusing them. */
export const dmBlocked = u => u?.delivery !== "channel" && (u?.dm_failures ?? 0) >= DM_FAIL_LIMIT;

/** Plain words for the member (or null when there is nothing wrong). `guild` is the server row with the alert channel, if any. */
export function reachNotice(u, guild = null) {
    if (!dmBlocked(u)) return null;
    return {
        title: "Your alerts aren't reaching you",
        what: `Discord refused my last ${u.dm_failures} direct messages to you, so your DMs look closed.`,
        meanwhile: guild?.channel_id ? `Until that's fixed, your alerts are posted in <#${guild.channel_id}> instead, where everyone who can see the channel sees them.` : "Until that's fixed, your alerts can't be delivered at all, because no server alert channel is set to fall back on.",
        fix: "In Discord, open Settings, then Content & Social, and allow direct messages from server members (or turn on Direct Messages in the server's Privacy Settings). I'll try again within a day, or use the test button on the dashboard's Alerts page to check right now. You can also switch delivery to the server channel."
    };
}

export const reachLine = (u, guild) => { const n = reachNotice(u, guild); return n ? `⚠️ **${n.title}.** ${n.what} ${n.meanwhile}\n${n.fix}` : null; };

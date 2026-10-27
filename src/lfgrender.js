// Look and feel of a looking-for-group post. Plain objects, no Discord library needed.
export const LFG_JOIN = "lfg_join", LFG_LEAVE = "lfg_leave", LFG_CLOSE = "lfg_close";

export function lfgEmbed(post, members) {
    const ts = Math.floor(post.starts_at / 1000);
    const full = members.length >= post.slots;
    const closed = post.status !== "open";
    return {
        color: closed ? 0x747f8d : full ? 0xfee75c : 0x57f287,
        title: `${closed ? "Closed: " : full ? "Full: " : "Looking for group: "}${post.game}`.slice(0, 250),
        description: post.note || undefined,
        fields: [
            { name: "Host", value: `<@${post.creator_id}>`, inline: true },
            { name: "When", value: `<t:${ts}:F>\n<t:${ts}:R>`, inline: true },
            { name: `Players (${members.length}/${post.slots})`, value: members.length ? members.map(m => `<@${m}>`).join("\n") : "Nobody yet", inline: true }
        ],
        footer: { text: `Join with the button. The post closes by itself a few hours after the start.` }
    };
}

export function lfgComponents(post, members) {
    if (post.status !== "open") return [];
    const full = members.length >= post.slots;
    return [{ type: 1, components: [
        { type: 2, style: 3, label: "Join", custom_id: `${LFG_JOIN}:${post.id}`, disabled: full },
        { type: 2, style: 2, label: "Leave", custom_id: `${LFG_LEAVE}:${post.id}` },
        { type: 2, style: 4, label: "Close", custom_id: `${LFG_CLOSE}:${post.id}` }
    ] }];
}

export const lfgPayload = (post, members) => ({ embeds: [lfgEmbed(post, members)], components: lfgComponents(post, members), allowedMentions: { parse: [] } });

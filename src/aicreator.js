// "Who made you?" gets the same answer every time, with or without an AI key, so it never costs a call or gets made up.
const ASKS = [
    /\bwho\s+(?:made|created|built|developed|coded|programmed|designed|owns|runs|wrote|is\s+behind|'?s\s+behind)\s+(?:you|this|the\s+bot|u)\b/i,
    /\bwho(?:'s|\s+is)\s+(?:your|the)\s+(?:creator|developer|dev|maker|owner|author|builder)\b/i,
    /\bwho\s+(?:are\s+)?(?:your|ur)\s+(?:creator|developer|dev|maker|owner|author)\b/i,
    /\bwho\s+(?:made|created|built)\s+(?:steam\s*value\s*checker|svc)\b/i,
    /\b(?:your|the\s+bot'?s?)\s+(?:creator|developer|maker)\b.*\?/i
];

export function asksCreator(question) {
    return ASKS.some(r => r.test(String(question ?? "")));
}

// Color matches the rest of the bot's embeds.
export function creatorEmbed({ creator, logo = null, color = 0xff9800, bot = "Steam Value Checker" }) {
    const e = {
        color,
        title: `Made by ${creator.name}`,
        url: creator.url,
        description: `I'm **${bot}**, built by **${creator.name}**: a solo project for people who hunt for good game deals. If you like what I do, say hi on X.`,
        fields: [{ name: "On X", value: `[${creator.name} on X](${creator.url})`, inline: true }],
        footer: { text: bot }
    };
    if (logo) e.thumbnail = { url: logo };
    return e;
}

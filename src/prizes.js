// What a giveaway can give away. A "code" prize (game key, Discord Nitro link, gift card code) is stored encrypted and handed to
// the winner by the Claim button. A "manual" prize (money, anything else) has no secret: the host pays or sends it themselves,
// so the bot only tells the winner who to expect it from and asks them to confirm when it arrives.
export const KINDS = {
    key:      { icon: "🎮", name: "Game key",       code: true,  color: 0xff9800, word: "key" },
    nitro:    { icon: "💎", name: "Discord Nitro",  code: true,  color: 0x5865f2, word: "Nitro link" },
    giftcard: { icon: "🎁", name: "Gift card",      code: true,  color: 0xeb459e, word: "gift card code" },
    money:    { icon: "💰", name: "Money",          code: false, color: 0x2ecc71, word: "payment" },
    other:    { icon: "🏅", name: "Other prize",    code: false, color: 0xfee75c, word: "prize" }
};
export const KIND_IDS = Object.keys(KINDS);
export const kindOf = k => (KINDS[k] ? k : "key");
export const kindInfo = k => KINDS[kindOf(k)];
export const isCode = k => kindInfo(k).code;

/** One colour and one headline for the whole giveaway, from what is being given away. */
export function theme(keys) {
    const kinds = [...new Set(keys.map(k => kindOf(k.kind)))];
    if (kinds.length === 1) return { color: KINDS[kinds[0]].color, icon: KINDS[kinds[0]].icon, name: kinds[0] === "key" ? "GIVEAWAY" : KINDS[kinds[0]].name.toUpperCase() + " GIVEAWAY" };
    return { color: 0xff9800, icon: "🎉", name: "GIVEAWAY" };
}

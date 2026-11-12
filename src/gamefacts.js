// The extra facts shown beside a price: players right now, time to finish and the critics' score. One place gathers
// them so alerts, the check card, the game page and link replies all show the same thing. Everything here is optional:
// until the bot starts and calls configureFacts() it answers null, and a failed lookup just leaves a line off.
import { playersLine } from "./players.js";
import { timeLine, criticLine, perHour } from "./igdb.js";

let sources = null;
export const configureFacts = s => { sources = s; };

/** { players, hours, critic } for a Steam app, or null. Never throws. */
export async function gameFacts(appid) {
    if (!sources || !Number.isInteger(appid) || appid <= 0) return null;
    const [players, igdb] = await Promise.all([
        sources.players?.current(appid).catch(() => null) ?? null,
        sources.igdb?.facts(appid).catch(() => null) ?? null
    ]);
    if (players == null && !igdb) return null;
    return { players: players ?? null, hours: igdb?.hours ?? null, critic: igdb?.critic ?? null };
}

/** Ready-made lines for a card, in a steady order. `money` formats the per-hour cost. */
export function factLines(facts, { price = null, money = null } = {}) {
    if (!facts) return [];
    const cost = perHour(facts, price);
    const time = timeLine(facts);
    return [
        criticLine(facts),
        time ? time + (cost !== null && money ? `, about ${money(cost)} an hour at this price` : "") : null,
        playersLine(facts.players)
    ].filter(Boolean);
}

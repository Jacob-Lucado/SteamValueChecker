// The extra facts shown beside a price: players right now, time to finish and the critics' score. One place gathers
// them so alerts, the check card, the game page and link replies all show the same thing. Everything here is optional:
// until the bot starts and calls configureFacts() it answers null, and a failed lookup just leaves a line off.
import { playersLine } from "./players.js";
import { timeLine, criticLine, perHour } from "./igdb.js";
import { earlyAccessLine, controllerLine, vrLine, modesLine } from "./storemeta.js";

let sources = null;
export const configureFacts = s => { sources = s; };

/** { players, hours, critic } for a Steam app, or null. Never throws. */
export async function gameFacts(appid) {
    if (!sources || !Number.isInteger(appid) || appid <= 0) return null;
    const [players, igdb, store] = await Promise.all([
        sources.players?.current(appid).catch(() => null) ?? null,
        sources.igdb?.facts(appid).catch(() => null) ?? null,
        sources.store?.meta(appid).catch(() => null) ?? null
    ]);
    if (players == null && !igdb && !store?.earlyAccess && !store?.controller && !store?.vr && !modesLine(store)) return null;
    return { players: players ?? null, hours: igdb?.hours ?? null, critic: igdb?.critic ?? null, store: store ?? null };
}

/** Ready-made lines for a card, in a steady order. `money` formats the per-hour cost. */
export function factLines(facts, { price = null, money = null } = {}) {
    if (!facts) return [];
    const cost = perHour(facts, price);
    const time = timeLine(facts);
    return [
        criticLine(facts),
        time ? time + (cost !== null && money ? `, about ${money(cost)} an hour at this price` : "") : null,
        playersLine(facts.players),
        earlyAccessLine(facts.store),
        modesLine(facts.store),
        controllerLine(facts.store),
        vrLine(facts.store)
    ].filter(Boolean);
}

/** The same facts with the lines a person switched off taken out. `hide` is a list of keys from FACT_OPTIONS. */
export function withoutHidden(facts, hide = []) {
    if (!facts || !hide.length) return facts;
    const h = new Set(hide), f = { ...facts };
    if (h.has("players")) f.players = null;
    if (h.has("critic")) f.critic = null;
    if (h.has("time")) f.hours = null;
    if (f.store) {
        f.store = { ...f.store };
        if (h.has("early")) f.store.earlyAccess = false;
        if (h.has("controller")) f.store.controller = null;
        if (h.has("vr")) f.store.vr = null;
        if (h.has("modes")) f.store.modes = null;
    }
    return f;
}

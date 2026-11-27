// Buy pacts: "let's all get this when it's $X". Someone starts one for a game and a price, others join with a button, and when the
// price is reached the whole group is pinged at once. The Discord calls go through `discord` (post, edit), so the rules are testable.
import { UserError } from "./errors.js";
import { summarize } from "./report.js";
import { money } from "./render.js";

export const PACT_JOIN = "pact_join", PACT_LEAVE = "pact_leave", PACT_CANCEL = "pact_cancel";
const MAX_OPEN_PER_PERSON = 3, LIFETIME_MS = 45 * 86400_000, EPS = 0.005;

export function pactEmbed(p, members, now = null) {
    const open = p.status === "open", need = p.min_players, ready = members.length >= need;
    const head = open ? "Buy pact" : p.status === "done" ? "Pact reached" : p.status === "expired" ? "Pact expired" : "Pact cancelled";
    return {
        color: p.status === "done" ? 0x57f287 : open ? (ready ? 0xfee75c : 0x4da3ff) : 0x747f8d,
        title: `🤝 ${head}: ${p.title}`.slice(0, 250),
        description: open
            ? `Everyone who joins gets pinged together the moment this is **${money(p.target, p.currency)}** or less.`
            : p.status === "done" ? `It hit **${money(p.done_price, p.currency)}**${p.done_shop ? ` at ${p.done_shop}` : ""}, under the ${money(p.target, p.currency)} target.`
            : p.status === "expired" ? "The price never reached the target in 45 days." : "The host cancelled this pact.",
        fields: [
            { name: "Target price", value: money(p.target, p.currency), inline: true },
            { name: "Host", value: `<@${p.creator_id}>`, inline: true },
            { name: `In (${members.length}, ${need} needed)`, value: members.length ? members.map(m => `<@${m}>`).join("\n") : "Nobody yet", inline: true },
            ...(open && p.expires_at ? [{ name: "Watching until", value: `<t:${Math.floor(p.expires_at / 1000)}:D>`, inline: true }] : [])
        ],
        footer: { text: open ? `Prices in ${p.currency}, checked against the major stores. Join or leave with the buttons.` : "Steam Value Checker · buy pacts" }
    };
}

export function pactComponents(p) {
    if (p.status !== "open") return [];
    return [{ type: 1, components: [
        { type: 2, style: 3, label: "I'm in", custom_id: `${PACT_JOIN}:${p.id}` },
        { type: 2, style: 2, label: "Leave", custom_id: `${PACT_LEAVE}:${p.id}` },
        { type: 2, style: 4, label: "Cancel", custom_id: `${PACT_CANCEL}:${p.id}` }
    ] }];
}

export const pactPayload = (p, members) => ({ embeds: [pactEmbed(p, members)], components: pactComponents(p), allowedMentions: { parse: [] } });

export function hitEmbed(p, best, members) {
    return {
        color: 0x57f287,
        author: { name: "🤝 Your buy pact just hit its price" },
        title: `${p.title} is ${money(best.price, p.currency)}`,
        url: best.url ?? undefined,
        description: `That is under the ${money(p.target, p.currency)} you agreed on, at **${best.shop}**. ${members.length} of you are in, so now is the time.`,
        footer: { text: "Steam Value Checker · buy pacts · prices can change, so check before you pay" }
    };
}

export function createPactService({ db, itad, discord, now = () => Date.now(), log = () => {} }) {
    const refresh = async p => {
        if (!p.message_id) return;
        try { await discord.edit(p.channel_id, p.message_id, pactPayload(p, db.pactMembers(p.id))); }
        catch (err) { log(`could not update pact ${p.id}: ${err.message}`); }
    };

    async function create({ guildId, channelId, creatorId, title, target, minPlayers = 2, country = "US" }) {
        title = String(title ?? "").trim().slice(0, 100);
        if (!title) throw new UserError("Say which game.");
        target = Math.round(Number(target) * 100) / 100;
        if (!(target > 0 && target <= 1000)) throw new UserError("The price has to be more than 0 and at most 1,000.");
        minPlayers = Math.round(Number(minPlayers ?? 2));
        if (!(minPlayers >= 2 && minPlayers <= 20)) throw new UserError("A pact needs between 2 and 20 players, counting you.");
        if (db.countOpenPactsBy(guildId, creatorId) >= MAX_OPEN_PER_PERSON) throw new UserError(`You already have ${MAX_OPEN_PER_PERSON} open pacts here. Cancel one first.`);
        const [hit] = await itad.lookupTitles([title]);
        if (!hit?.id) throw new UserError(`I could not find a game called ${title}. Check the spelling or try the full title.`);
        const name = hit.approx ? hit.matched : title;
        const entry = (await itad.getPrices([hit.id], country)).get(hit.id);
        const s = summarize(entry, { majorOnly: true });
        if (!s.hasPrices || !s.currency) throw new UserError(`I couldn't find prices for ${name} right now. Try again in a bit.`);
        if (s.best && s.best.price <= target + EPS) throw new UserError(`${name} is already ${money(s.best.price, s.currency)} at ${s.best.shop}, which is at or under ${money(target, s.currency)}. Just buy it.`);
        const pact = db.createPact({ guild_id: guildId, channel_id: channelId, creator_id: creatorId, itad_id: hit.id, title: name, target, currency: s.currency, country, min_players: minPlayers, expires_at: now() + LIFETIME_MS });
        const msg = await discord.post(channelId, pactPayload(pact, db.pactMembers(pact.id)));
        db.setPactMessage(pact.id, msg.id);
        return { pact: db.getPact(pact.id), now: s.best, approx: Boolean(hit.approx) && !hit.exact };
    }

    async function join(id, userId) {
        const p = db.getPact(id);
        if (!p || p.status !== "open") throw new UserError("That pact is over.");
        const r = db.joinPact(id, userId);
        if (r === "joined") await refresh(p);
        return { result: r, pact: p };
    }
    async function leave(id, userId) {
        const p = db.getPact(id);
        if (!p || p.status !== "open") throw new UserError("That pact is over.");
        if (!db.leavePact(id, userId)) throw new UserError("You are not in that pact.");
        await refresh(p);
        return p;
    }
    async function cancel(id, userId, { canManage = false } = {}) {
        const p = db.getPact(id);
        if (!p) throw new UserError("I can't find that pact.");
        if (p.creator_id !== userId && !canManage) throw new UserError("Only the person who started it, or a server manager, can cancel it.");
        if (!db.closePact(id, "cancelled")) throw new UserError("That pact is already over.");
        await refresh({ ...p, status: "cancelled" });
        return p;
    }

    /** Checks every open pact against the current price. One price lookup per game and country, however many pacts want it. */
    async function tick() {
        const at = now(), stats = { checked: 0, reached: 0, expired: 0, nudged: 0 };
        const open = db.openPacts();
        const live = [];
        for (const p of open) {
            if (p.expires_at <= at) {
                if (db.closePact(p.id, "expired")) { stats.expired++; await refresh({ ...p, status: "expired" }); }
            } else live.push(p);
        }
        const byCountry = new Map();
        for (const p of live) { if (!byCountry.has(p.country)) byCountry.set(p.country, new Set()); byCountry.get(p.country).add(p.itad_id); }
        const prices = new Map();
        for (const [country, ids] of byCountry) {
            try { for (const [id, entry] of await itad.getPrices([...ids], country)) prices.set(`${country}:${id}`, entry); }
            catch (err) { log(`price check failed for ${country}: ${err.message}`); }
        }
        for (const p of live) {
            const entry = prices.get(`${p.country}:${p.itad_id}`);
            if (!entry) continue;
            stats.checked++;
            const best = summarize(entry, { majorOnly: true }).best;
            if (!best || best.price > p.target + EPS) continue;
            const members = db.pactMembers(p.id);
            if (members.length >= p.min_players) {
                if (!db.closePact(p.id, "done", { price: best.price, shop: best.shop })) continue;
                stats.reached++;
                const done = { ...p, status: "done", done_price: best.price, done_shop: best.shop };
                try { await discord.post(p.channel_id, { content: members.map(m => `<@${m}>`).join(" "), embeds: [hitEmbed(p, best, members)], allowedMentions: { users: members } }); }
                catch (err) { log(`could not announce pact ${p.id}: ${err.message}`); }
                await refresh(done);
            } else if (!p.nudged) {
                db.markPactNudged(p.id);
                stats.nudged++;
                try { await discord.post(p.channel_id, { content: `<@${p.creator_id}> **${p.title}** just hit ${money(best.price, p.currency)} at ${best.shop}, but only ${members.length} of the ${p.min_players} players are in. Get friends to join the pact and it will go off.`, allowedMentions: { users: [p.creator_id] } }); }
                catch (err) { log(`could not nudge pact ${p.id}: ${err.message}`); }
            }
        }
        return stats;
    }
    return { create, join, leave, cancel, tick };
}

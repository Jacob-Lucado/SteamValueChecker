// The wishlist a server shares, with votes. Logic only: no Discord or HTTP code in here.
import { summarize } from "./report.js";
import { current, dealVerdict } from "./alerts.js";
import { UserError } from "./errors.js";

export function findServerGame(list, query) {
    const q = String(query ?? "").trim().toLowerCase();
    if (!q) return { none: true };
    const exact = list.filter(g => g.title.toLowerCase() === q);
    if (exact.length === 1) return { game: exact[0] };
    const partial = list.filter(g => g.title.toLowerCase().includes(q));
    if (partial.length === 1) return { game: partial[0] };
    if (partial.length > 1) return { ambiguous: partial.slice(0, 5).map(g => g.title) };
    return { none: true };
}

function pick(db, guildId, viewerId, query) {
    const found = findServerGame(db.listServerGames(guildId, viewerId), query);
    if (found.ambiguous) throw new UserError(`More than one match: ${found.ambiguous.map(t => `**${t}**`).join(", ")}. Be more specific.`);
    if (!found.game) throw new UserError("That game is not on the server list.");
    return found.game;
}

export async function addToServerList(db, itad, guildId, userId, rawTitle) {
    const title = String(rawTitle ?? "").trim().slice(0, 100);
    if (!title) throw new UserError("Type a game title.");
    const [hit] = await itad.lookupTitles([title]);
    if (!hit?.id) throw new UserError(`I could not find a game called ${title}.`);
    const name = hit.approx ? hit.matched : title;
    const res = db.addServerGame(guildId, { itad_id: hit.id, title: name }, userId);
    if (res.existing) throw new UserError(`${name} is already on the server list. Vote for it instead.`);
    if (res.full) throw new UserError("The server list is full (100 games). Remove one first.");
    return { name, approx: hit.approx };
}

/** Toggles the member's vote. Returns { title, voted, votes }. */
export function vote(db, guildId, userId, query) {
    const g = pick(db, guildId, userId, query);
    const voted = db.toggleVote(g.id, userId);
    return { title: g.title, voted, votes: g.votes + (voted ? 1 : -1) };
}

/** The person who added a game, or someone who can manage the server, may remove it. */
export function removeFromServerList(db, guildId, userId, query, canManage) {
    const g = pick(db, guildId, userId, query);
    if (g.added_by !== userId && !canManage) throw new UserError("Only the person who added it, or someone with Manage Server, can remove a game.");
    db.removeServerGame(g.id);
    return { title: g.title };
}

/** The list with votes and current prices (in the viewer's region). Most votes first. */
export async function serverListView(db, itad, guildId, user) {
    const list = db.listServerGames(guildId, user.discord_id);
    const prices = list.length ? await itad.getPrices(list.map(g => g.itad_id), user.region) : new Map();
    const rows = list.map(g => {
        const s = summarize(prices.get(g.itad_id), { majorOnly: user.stores === "major" });
        const now = current(s);
        return {
            id: g.id, itad_id: g.itad_id, title: g.title, votes: g.votes, voted: g.voted, added_by: g.added_by,
            best: s.best, regular: now.regular, discount: now.discount, atl: now.atl, currency: s.currency, verdict: dealVerdict(now)
        };
    });
    return { rows, currency: rows.find(r => r.currency)?.currency ?? "USD" };
}

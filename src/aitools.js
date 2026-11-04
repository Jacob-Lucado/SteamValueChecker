// What the AI companion can actually do. Each tool is a thin wrapper over the same code the slash commands use, so its answers come
// from real prices and the asker's own lists instead of guesses. Everything here reads, except adding a game to the asker's own
// wishlist when they ask for that. A tool only ever sees the person who asked, never another member's lists.
import { runValue } from "./value.js";
import { viewRows, addGameByTitle } from "./wishlist.js";
import { libraryView, playNext, leaderboard } from "./library.js";
import { money } from "./render.js";

const MAX_TITLES = 6;
const clip = (s, n = 80) => String(s ?? "").slice(0, n);
const arr = v => (Array.isArray(v) ? v : []);

export const TOOL_DEFS = [
    {
        name: "check_prices",
        description: "Look up live prices for up to 6 games: the full (MSRP) price, the Steam price now, the cheapest current price and store, and the all-time low. Use it for any question about what a game costs or whether it is on sale.",
        input_schema: { type: "object", properties: { titles: { type: "array", items: { type: "string" }, maxItems: MAX_TITLES, description: "Game titles" } }, required: ["titles"] }
    },
    {
        name: "free_games",
        description: "List the games that are free to claim right now on stores like Epic, Steam and GOG, with when each offer ends.",
        input_schema: { type: "object", properties: {} }
    },
    {
        name: "my_wishlist",
        description: "The asker's own wishlist in this bot with current prices, games on sale first. Use it for 'what's on sale from my wishlist'.",
        input_schema: { type: "object", properties: {} }
    },
    {
        name: "my_library",
        description: "A summary of the asker's own game library in this bot: how many games, what they paid, what it is worth, and their backlog. Also suggests what to play next from their backlog.",
        input_schema: { type: "object", properties: {} }
    },
    {
        name: "add_to_wishlist",
        description: "Add a game to the asker's own wishlist so the bot alerts them when it goes on sale. Only call this when the asker clearly asked to add or track that game.",
        input_schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] }
    },
    {
        name: "server_leaderboard",
        description: "This server's savings leaderboard: members who chose to share their stats, ranked by how much of the full price they saved.",
        input_schema: { type: "object", properties: {} }
    }
];

/** { defs, run(name, input, { userId, guildId }) } -> a JSON-able result. Errors come back as { error } so the AI can explain them. */
export function createAiTools({ db, itad, nameOf = id => null }) {
    const userOf = id => db.getUser?.(id) ?? { discord_id: id, region: "US", stores: "all" };
    const region = id => userOf(id)?.region || "US";

    const tools = {
        async check_prices({ titles }, { userId }) {
            const list = arr(titles).map(t => clip(t, 80)).filter(Boolean).slice(0, MAX_TITLES);
            if (!list.length) return { error: "No titles given." };
            const r = await runValue({ itad, typed: list.join("\n"), region: region(userId), stores: userOf(userId)?.stores === "major" ? "major" : "all" });
            const cur = r.totals.currency;
            return {
                currency: cur,
                games: r.rows.map(g => !g.found ? { asked: g.title, found: false } : {
                    asked: g.title, matched: g.matched, closeMatchOnly: g.approx || undefined,
                    fullPrice: g.msrp !== null ? money(g.msrp, cur) : null, steamNow: g.steam !== null ? money(g.steam, cur) : null, steamDiscountPct: g.cut || 0,
                    cheapestNow: g.best ? `${money(g.best.price, cur)} at ${g.best.shop}` : null, allTimeLow: g.atl !== null ? money(g.atl, cur) : null
                })
            };
        },

        async free_games() {
            const list = arr(await itad.getGiveawayList()).filter(g => g.type !== "dlc").slice(0, 12);
            return { count: list.length, games: list.map(g => ({ title: g.title, store: g.shop, endsAt: g.expiry ? new Date(g.expiry).toISOString().slice(0, 10) : "no end date announced" })) };
        },

        async my_wishlist(_i, { userId }) {
            const u = userOf(userId);
            const { rows, currency } = await viewRows(db, itad, u);
            if (!rows.length) return { empty: true, note: "Their wishlist is empty. They can import from Steam with /me wishlist import or add games with /me wishlist add." };
            const mine = rows.filter(r => !r.owned);
            return { currency, total: rows.length, onSale: mine.filter(r => r.discount > 0).length,
                games: mine.slice(0, 12).map(r => ({ title: r.title, bestNow: r.best ? `${money(r.best.price, currency)} at ${r.best.shop}` : null, discountPct: r.discount || 0, allTimeLow: r.atl !== null ? money(r.atl, currency) : null, alert: r.alert })) };
        },

        async my_library(_i, { userId }) {
            const u = userOf(userId);
            const v = await libraryView(db, itad, u, { snapshot: false });
            if (!v.rows.length) return { empty: true, note: "Their library is empty. It fills from a Steam sign-in or /me library import." };
            const t = v.totals, cur = v.currency, next = playNext(v.rows);
            return { currency: cur, games: t.games, paid: money(t.paid, cur), worthAtFullPrice: money(t.msrp, cur), backlogGames: t.backlogGames, playing: t.playing, finished: t.finished,
                playNextSuggestion: next ? { title: next.pick.title, why: next.why } : null };
        },

        async add_to_wishlist({ title }, { userId }) {
            try {
                const out = await addGameByTitle(db, itad, userId, title, null, null, { source: "ai" });
                return { added: out.name, alert: out.trigger };
            } catch (e) { return { error: e.message }; }
        },

        async server_leaderboard(_i, { guildId }) {
            if (!guildId) return { error: "Only works inside a server." };
            const rows = leaderboard(db, guildId, { limit: 5 });
            if (!rows.length) return { empty: true, note: "Nobody here shares their stats yet. Members opt in from /me library." };
            return { top: rows.map((r, n) => ({ rank: n + 1, member: nameOf(r.discord_id) ?? "a member", savedPct: Math.round(r.savedPct), games: r.games })) };
        }
    };

    return {
        defs: TOOL_DEFS,
        async run(name, input, ctx) {
            const fn = tools[name];
            if (!fn) return { error: "Unknown tool." };
            try { return await fn(input ?? {}, ctx); } catch (e) { return { error: String(e?.message ?? "That lookup failed.").slice(0, 200) }; }
        }
    };
}

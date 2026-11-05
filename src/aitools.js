// What the AI companion can actually do. Each tool is a thin wrapper over the same code the slash commands use, so its answers come
// from real prices and the asker's own lists instead of guesses. Everything here reads, except adding a game to the asker's own
// wishlist when they ask for that. A tool only ever sees the person who asked, never another member's lists.
import { runValue } from "./value.js";
import { viewRows, addGameByTitle } from "./wishlist.js";
import { libraryView, playNext, leaderboard } from "./library.js";
import { money, itadArt, artUrl, safeUrl } from "./render.js";
import { steamArt } from "./art.js";
import { pickCard } from "./aicards.js";

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
        name: "game_info",
        description: "Facts about one game from its Steam store page: what it is, genres, release date, review score, price, and its picture. Use it when someone asks what a game is, whether it is any good, or wants to see it. A card with the picture and a store button is shown under your answer.",
        input_schema: { type: "object", properties: { title: { type: "string", description: "Game title" } }, required: ["title"] }
    },
    {
        name: "server_leaderboard",
        description: "This server's savings leaderboard: members who chose to share their stats, ranked by how much of the full price they saved.",
        input_schema: { type: "object", properties: {} }
    }
];

/** { defs, run(name, input, { userId, guildId }) } -> a JSON-able result. Errors come back as { error } so the AI can explain them. */
export function createAiTools({ db, itad, nameOf = id => null, fetchImpl = globalThis.fetch }) {
    const userOf = id => db.getUser?.(id) ?? { discord_id: id, region: "US", stores: "all" };
    const region = id => userOf(id)?.region || "US";

    const tools = {
        async check_prices({ titles }, ctx) {
            const { userId } = ctx;
            const list = arr(titles).map(t => clip(t, 80)).filter(Boolean).slice(0, MAX_TITLES);
            if (!list.length) return { error: "No titles given." };
            const r = await runValue({ itad, typed: list.join("\n"), region: region(userId), stores: userOf(userId)?.stores === "major" ? "major" : "all" });
            const cur = r.totals.currency;
            for (const g of r.rows.filter(x => x.found).slice(0, 3)) {
                const store = safeUrl(g.best?.url) ?? (g.slug ? `https://isthereanydeal.com/game/${encodeURIComponent(g.slug)}/info/` : undefined);
                ctx.cards?.push({ title: g.matched, url: store, linkLabel: g.best ? `Buy at ${String(g.best.shop).slice(0, 30)}` : "See prices", image: g.id ? itadArt(g.id) : undefined, wish: g.matched,
                    fields: [{ name: "Full price", value: g.msrp !== null ? money(g.msrp, cur) : null }, { name: "Steam now", value: g.steam !== null ? `${money(g.steam, cur)}${g.cut ? ` (-${g.cut}%)` : ""}` : null },
                        { name: "Cheapest now", value: g.best ? `${money(g.best.price, cur)} at ${g.best.shop}` : null }, { name: "All-time low", value: g.atl !== null ? money(g.atl, cur) : null }] });
            }
            return {
                currency: cur,
                games: r.rows.map(g => !g.found ? { asked: g.title, found: false } : {
                    asked: g.title, matched: g.matched, closeMatchOnly: g.approx || undefined,
                    fullPrice: g.msrp !== null ? money(g.msrp, cur) : null, steamNow: g.steam !== null ? money(g.steam, cur) : null, steamDiscountPct: g.cut || 0,
                    cheapestNow: g.best ? `${money(g.best.price, cur)} at ${g.best.shop}` : null, allTimeLow: g.atl !== null ? money(g.atl, cur) : null
                })
            };
        },

        async free_games(_i, ctx) {
            const list = arr(await itad.getGiveawayList()).filter(g => g.type !== "dlc").slice(0, 12);
            for (const g of list.slice(0, 3)) ctx?.cards?.push({ title: g.title, url: safeUrl(g.url), linkLabel: `Claim on ${String(g.shop).slice(0, 30)}`, image: g.id ? itadArt(g.id) : undefined, fields: [{ name: "Store", value: g.shop }, { name: "Ends", value: g.expiry ? new Date(g.expiry).toISOString().slice(0, 10) : "No end date announced" }] });
            return { count: list.length, games: list.map(g => ({ title: g.title, store: g.shop, endsAt: g.expiry ? new Date(g.expiry).toISOString().slice(0, 10) : "no end date announced" })) };
        },

        async my_wishlist(_i, ctx) {
            const { userId } = ctx;
            const u = userOf(userId);
            const { rows, currency } = await viewRows(db, itad, u);
            if (!rows.length) return { empty: true, note: "Their wishlist is empty. They can import from Steam with /me wishlist import or add games with /me wishlist add." };
            const mine = rows.filter(r => !r.owned);
            for (const r of mine.filter(x => x.discount > 0).slice(0, 3)) ctx?.cards?.push({ title: r.title, url: safeUrl(r.best?.url) ?? (Number.isInteger(r.appid) ? `https://store.steampowered.com/app/${r.appid}/` : undefined), linkLabel: r.best ? `Buy at ${String(r.best.shop).slice(0, 30)}` : "Store page", image: artUrl(r),
                fields: [{ name: "Now", value: r.best ? `${money(r.best.price, currency)} at ${r.best.shop}` : null }, { name: "Discount", value: `-${r.discount}%` }, { name: "All-time low", value: r.atl != null ? money(r.atl, currency) : null }] });
            return { currency, total: rows.length, onSale: mine.filter(r => r.discount > 0).length,
                games: mine.slice(0, 12).map(r => ({ title: r.title, bestNow: r.best ? `${money(r.best.price, currency)} at ${r.best.shop}` : null, discountPct: r.discount || 0, allTimeLow: r.atl !== null ? money(r.atl, currency) : null, alert: r.alert })) };
        },

        async my_library(_i, ctx) {
            const { userId } = ctx;
            const u = userOf(userId);
            const v = await libraryView(db, itad, u, { snapshot: false });
            if (!v.rows.length) return { empty: true, note: "Their library is empty. It fills from a Steam sign-in or /me library import." };
            const t = v.totals, cur = v.currency, next = playNext(v.rows);
            if (next) ctx?.cards?.push(pickCard(next));
            return { currency: cur, games: t.games, paid: money(t.paid, cur), worthAtFullPrice: money(t.msrp, cur), backlogGames: t.backlogGames, playing: t.playing, finished: t.finished,
                playNextSuggestion: next ? { title: next.pick.title, why: next.why } : null };
        },

        async game_info({ title }, ctx) {
            const q = clip(title, 80).trim();
            if (!q) return { error: "No title given." };
            const get = async url => { const r = await fetchImpl(url, { headers: { "Accept-Language": "en" }, signal: AbortSignal.timeout(7000) }); if (!r.ok) throw new Error(`Steam answered ${r.status}`); return r.json(); };
            const found = await get(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=english&cc=us`);
            const hit = (found?.items ?? []).find(x => x.type === "app") ?? found?.items?.[0];
            if (!hit?.id) return { found: false, note: "Steam has no game by that name. Try the full title." };
            const d = (await get(`https://store.steampowered.com/api/appdetails?appids=${hit.id}&l=english&cc=us`))?.[hit.id]?.data;
            if (!d) return { found: false, note: "Steam would not give details for that one." };
            const page = `https://store.steampowered.com/app/${hit.id}/`;
            const genres = arr(d.genres).map(x => x.description).slice(0, 4).join(", ");
            const price = d.is_free ? "Free to play" : d.price_overview?.final_formatted ? `${d.price_overview.final_formatted}${d.price_overview.discount_percent ? ` (-${d.price_overview.discount_percent}%)` : ""}` : null;
            const blurb = String(d.short_description ?? "").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#?\w+;/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
            ctx?.cards?.push({ title: d.name, url: page, linkLabel: "Steam page", image: safeUrl(d.header_image) ?? steamArt(hit.id), description: blurb, wish: d.name,
                fields: [{ name: "Genres", value: genres }, { name: "Released", value: d.release_date?.coming_soon ? "Coming soon" : d.release_date?.date }, { name: "Price", value: price }, { name: "Metacritic", value: d.metacritic?.score ? String(d.metacritic.score) : null }] });
            return { name: d.name, about: blurb, genres, released: d.release_date?.date ?? null, comingSoon: Boolean(d.release_date?.coming_soon), priceNow: price, metacritic: d.metacritic?.score ?? null, developers: arr(d.developers).slice(0, 2), steamPage: page };
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

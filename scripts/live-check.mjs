// Asks the real services the bot depends on for one well-known game and checks the answers still have the shape the bot
// reads. The test suite only talks to fakes, so this is what notices when IsThereAnyDeal or Steam changes a response.
// Run by .github/workflows/live-check.yml every night; by hand: ITAD_API_KEY=... node scripts/live-check.mjs
// Optional: TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET to check IGDB too, and LIVE_STEAM_PROFILE, a public Steam profile (link, custom name or SteamID64) with a wishlist, to try an import.
import { createItad } from "../src/itad.js";
import { summarize } from "../src/report.js";
import { importWishlist } from "../src/steam.js";
import { steamReviews } from "../src/reviews.js";
import { protonTier } from "../src/proton.js";
import { createPlayers } from "../src/players.js";
import { createIgdb } from "../src/igdb.js";

const APP = 1145360, NAME = "Hades"; // on sale often, on every store, unlikely to go away

export async function liveCheck({ itad, igdb = null, fetchImpl = globalThis.fetch, steamProfile = "", log = console.log } = {}) {
    const results = [];
    const step = async (name, fn) => {
        try { const note = await fn(); results.push({ name, ok: true, note }); log(`ok    ${name}${note ? `: ${note}` : ""}`); }
        catch (e) { results.push({ name, ok: false, note: e?.message ?? String(e) }); log(`FAIL  ${name}: ${e?.message ?? e}`); }
    };
    const need = (cond, what) => { if (!cond) throw new Error(what); };

    let id = null;
    await step("price site: find a game by title", async () => {
        const [hit] = await itad.lookupTitles([NAME]);
        need(hit?.id, "no id came back for a title lookup");
        id = hit.id; return hit.matched;
    });
    await step("price site: find a game by its Steam link", async () => {
        const [hit] = await itad.lookupTitles([`https://store.steampowered.com/app/${APP}/`]);
        need(hit?.id, "no id came back for a Steam app");
        need(!id || hit.id === id, "the Steam app and the title point at different games");
        id ??= hit.id; return hit.matched;
    });
    await step("price site: current prices", async () => {
        need(id, "skipped, no game id");
        const s = summarize((await itad.getPrices([id], "US")).get(id));
        need(s.hasPrices && Number.isFinite(s.best?.price), "no usable price in the answer");
        need(Number.isFinite(s.msrp), "no regular price in the answer");
        return `${s.best.price} ${s.currency} at ${s.best.shop}, all-time low ${s.atl ?? "missing"}`;
    });
    await step("price site: a year of price history", async () => {
        need(id, "skipped, no game id");
        const pts = await itad.getHistory(id, "US");
        need(pts.length > 3, `only ${pts.length} points`);
        return `${pts.length} points`;
    });
    await step("price site: free games list", async () => {
        const list = await itad.getGiveawayList();
        need(Array.isArray(list), "not a list");
        return `${list.length} listed`;
    });
    await step("price site: hot deals", async () => {
        const list = await itad.getHotDeals({ minCut: 50, limit: 10 });
        need(Array.isArray(list) && list.length, "no deals came back");
        need(list[0].title && Number.isFinite(list[0].price ?? list[0].now?.price ?? list[0].cut), "a deal has no title or numbers");
        return `${list.length} deals`;
    });
    await step("Steam: review summary", async () => {
        const r = await steamReviews(APP, { fetchFn: fetchImpl });
        if (!r) {
            // The bot's own lookup stays quiet when it fails, so ask Steam again here and say what actually came back.
            let why = "no answer";
            try {
                const t0 = Date.now(), res = await fetchImpl(`https://store.steampowered.com/appreviews/${APP}?json=1&language=all&purchase_type=all&num_per_page=0`, { signal: AbortSignal.timeout(20000) });
                const text = await res.text();
                why = `HTTP ${res.status} after ${Date.now() - t0} ms: ${text.slice(0, 300).replace(/\s+/g, " ")}`;
            } catch (err) { why = `${err.name}: ${err.message}`; }
            need(false, `no review summary (${why})`);
        }
        need(r.total > 1000 && r.pct > 0, "the review summary has no numbers");
        return `${r.pct}% of ${r.total}`;
    });
    await step("Steam: players right now", async () => {
        const n = await createPlayers({ fetchImpl }).current(APP);
        need(Number.isInteger(n) && n >= 0, "no player count");
        return String(n);
    });
    await step("ProtonDB: rating", async () => {
        const tier = await protonTier(APP, { fetchFn: fetchImpl });
        need(tier, "no rating");
        return tier;
    });
    if (igdb?.enabled) await step("IGDB: hours to finish and critics' score", async () => {
        const f = await igdb.facts(APP);
        need(f, "nothing came back");
        need(f.critic || f.hours?.main, "neither a score nor hours");
        return `${f.critic ? f.critic.score + "/100" : "no score"}, ${f.hours?.main ?? "?"} hours`;
    });
    if (steamProfile) await step("Steam: wishlist import", async () => {
        const r = await importWishlist(steamProfile, itad, { fetchImpl, max: 10 });
        need(r.games?.length, "the wishlist came back empty");
        return `${r.games.length} of ${r.total} games read`;
    });
    return { ok: results.every(r => r.ok), results };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    if (!process.env.ITAD_API_KEY) { console.error("Set ITAD_API_KEY first (the same key the bot uses)."); process.exit(2); }
    const out = await liveCheck({ itad: createItad({ apiKey: process.env.ITAD_API_KEY }), igdb: createIgdb({ clientId: process.env.TWITCH_CLIENT_ID, clientSecret: process.env.TWITCH_CLIENT_SECRET, log: m => console.log(`      igdb: ${m}`) }), steamProfile: process.env.LIVE_STEAM_PROFILE ?? "" });
    const bad = out.results.filter(r => !r.ok);
    console.log(bad.length ? `\n${bad.length} of ${out.results.length} checks failed.` : `\nAll ${out.results.length} checks passed.`);
    process.exit(bad.length ? 1 : 0);
}

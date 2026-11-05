// The rest of what the AI companion can do: the same lookups and settings the slash commands and dashboard offer, so "what are my
// rarest achievements" or "pause my alerts" gets a real answer instead of a pointer to a command. Every tool works on the person who
// asked and nobody else. Reads come first; the few writes only change that person's own lists and settings, and only when they asked.
import { libraryView, serverStats, importLibrary } from "./library.js";
import { playStats, fmtHours, steamNext } from "./steamlib.js";
import { spendSummary, regionCurrency } from "./spend.js";
import { trophyCase } from "./badges.js";
import { challengeView, monthKey, MAX_GOAL } from "./challenge.js";
import { forYou } from "./foryou.js";
import { calendarEntries } from "./calendar.js";
import { upcomingSales, saleUrl } from "./salescal.js";
import { salePrep } from "./saleprep.js";
import { newsForUser } from "./news.js";
import { bundleCheck } from "./bundle.js";
import { regionPrices } from "./regions.js";
import { friendRows } from "./friends.js";
import { findItem } from "./wishlist.js";
import { prefsView, describeQuiet, describeDigest } from "./prefs.js";
import { levelFromXp } from "./communitystore.js";
import { REGIONS } from "./constants.js";
import { money, itadArt, safeUrl } from "./render.js";
import { steamArt } from "./art.js";
import { dashLink } from "./dashlink.js";
import { renderPanel } from "./aipics.js";

const clip = (s, n = 80) => String(s ?? "").slice(0, n);
const arr = v => (Array.isArray(v) ? v : []);
const day = ms => new Date(ms).toISOString().slice(0, 10);
const STATUS = ["backlog", "playing", "played", "finished", "dropped"];
/**
 * A card that opens the matching dashboard page. With a `panel` it is a picture of the numbers (bars, icons, big figures)
 * instead of a plain text card; if drawing fails it falls back to the text card. Only added when the dashboard is on.
 */
export async function dashCard(dashUrl, ctx, page, { title, description, fields = [], panel = null, fetchImpl = globalThis.fetch }) {
    const url = dashLink(dashUrl, page);
    if (!ctx?.cards) return;
    if (panel) {
        try {
            const data = await renderPanel({ title, ...panel }, { fetchImpl });
            ctx.cards.push({ title, url, linkLabel: url ? "Open in the dashboard" : undefined, file: { name: `${page}-${Date.now().toString(36)}.png`, data } });
            return;
        } catch { /* fall through to the plain card */ }
    }
    if (url) ctx.cards.push({ title, url, linkLabel: "Open in the dashboard", description, fields });
}
const none = { type: "object", properties: {} };
const title = { type: "object", properties: { title: { type: "string", description: "Game title" } }, required: ["title"] };

export const MORE_DEFS = [
    { name: "my_achievements", description: "The asker's rarest Steam achievements (with how few players have them), how many they have unlocked and across how many games. Use it for anything about achievements or trophies earned in games.", input_schema: none },
    { name: "my_steam", description: "The asker's Steam stats from their linked account: most played games, hours, what they never played, this year's hours and their hours goal. Use it for playtime and 'what do I play most' questions.", input_schema: none },
    { name: "my_spending", description: "What the asker has spent on games: total, this year, month by month, best and worst value per hour, and bought-but-unplayed.", input_schema: none },
    { name: "my_badges", description: "The asker's trophy case: badges earned from their library and challenge streak, and what the next tier needs.", input_schema: none },
    { name: "my_challenge", description: "The asker's monthly backlog challenge: goal, games finished this month, streak and history.", input_schema: none },
    { name: "deals_for_you", description: "Current discounts picked for the asker, ranked by how well they fit their taste and wishlist. Use it for 'what should I buy', 'any good deals for me'.", input_schema: none },
    { name: "my_settings", description: "The asker's alert settings in this bot: paused or on, delivery, region, stores, quiet hours, digest, minimum discount, and which alert types are switched on.", input_schema: none },
    { name: "update_settings", description: "Change the asker's own alert settings. Only call this when they clearly asked. Set only the fields they asked to change.",
        input_schema: { type: "object", properties: { paused: { type: "boolean", description: "true pauses all alerts, false resumes them" }, region: { type: "string", description: "Two-letter region code, e.g. US, GB, DE" }, stores: { type: "string", enum: ["all", "major"] }, min_discount: { type: "integer", minimum: 0, maximum: 95, description: "Only alert for discounts at least this big" } } } },
    { name: "upcoming", description: "What is coming up for the asker: wishlist release dates, Steam sales, and this server's events and group games. Defaults to the next 14 days.", input_schema: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 90 } } } },
    { name: "sale_plan", description: "The asker's sale plan: which wishlist games are worth buying now, which to wait on, the next big Steam sale, and what fits a budget.", input_schema: { type: "object", properties: { budget: { type: "number", description: "Optional spending budget" } } } },
    { name: "game_news", description: "The latest patch notes and announcements for the asker's games and wishlist.", input_schema: none },
    { name: "bundles_for", description: "Current bundles that contain a game, or any game on the asker's wishlist if no title is given, with what is already owned.", input_schema: { type: "object", properties: { title: { type: "string" } } } },
    { name: "regional_prices", description: "What one game costs in different countries (converted to USD), cheapest first.", input_schema: title },
    { name: "my_friends", description: "The friends the asker keeps birthday reminders for and how many days until each birthday.", input_schema: none },
    { name: "server_activity", description: "This server's activity: the asker's level and rank, open group-up (LFG) posts, upcoming events, and totals for the members who share stats.", input_schema: none },
    { name: "remove_from_wishlist", description: "Remove a game from the asker's wishlist. Only when they asked.", input_schema: title },
    { name: "star_wishlist_game", description: "Mark a wishlist game as a priority (listed first, alerts come through quiet hours) or take the star off. Only when they asked.", input_schema: { type: "object", properties: { title: { type: "string" }, starred: { type: "boolean" } }, required: ["title"] } },
    { name: "add_to_library", description: "Add a game the asker owns to their library, with what they paid if they said. Only when they asked.", input_schema: { type: "object", properties: { title: { type: "string" }, paid: { type: "number", description: "What they paid, if they said" } }, required: ["title"] } },
    { name: "set_game_status", description: "Mark a game in the asker's library as backlog, playing, played, finished or dropped. Only when they asked.", input_schema: { type: "object", properties: { title: { type: "string" }, status: { type: "string", enum: STATUS } }, required: ["title", "status"] } },
    { name: "remove_from_library", description: "Remove a game from the asker's library. Only when they clearly asked.", input_schema: title },
    { name: "set_goals", description: "Set the asker's monthly 'games to finish' goal and/or their yearly hours-played goal. 0 clears a goal. Only when they asked.", input_schema: { type: "object", properties: { games_this_month: { type: "integer", minimum: 0, maximum: MAX_GOAL }, hours_this_year: { type: "integer", minimum: 0, maximum: 5000 } } } }
];

export function createMoreTools({ db, itad, news = null, fx = null, nameOf = () => null, dashUrl = null, fetchImpl = globalThis.fetch }) {
    const userOf = id => db.getUser?.(id) ?? { discord_id: id, region: "US", stores: "all" };
    const regionOf = id => userOf(id)?.region || "US";
    const cur = c => c ?? "USD";
    const needSteam = id => { const l = db.getSteamLink?.(id); return l ? null : { linked: false, note: "Their Steam account is not linked. They can link it with /me steam link or from the dashboard, and then this fills in." }; };
    const lookup = (rows, q) => { const f = findItem(rows, q); return f.item ? { item: f.item } : { error: f.ambiguous ? `More than one match: ${f.ambiguous.join(", ")}. Which one?` : "That game isn't there." }; };

    return {
        async my_achievements(_i, ctx) {
            const { userId } = ctx;
            const miss = needSteam(userId); if (miss) return miss;
            const a = db.achievementShowcase(userId, 8);
            if (!a.done && !a.top.length) return { empty: true, note: "No achievement data yet. It fills in after a Steam sync, and only for games whose achievements are public." };
            await dashCard(dashUrl, ctx, "steam", { fetchImpl, title: "Your rarest achievements", panel: { sub: "Unlocked on your Steam account", tiles: [{ label: "Unlocked", value: a.done.toLocaleString("en-US") }, { label: "Games", value: String(a.games) }, { label: "Rare unlocks", value: String(a.rare) }], rows: a.top.slice(0, 6).map(x => ({ label: x.name, sub: x.game, icon: [x.icon, x.appid ? steamArt(x.appid) : null], value: `${x.pct}%` })), foot: "Share of all players who unlocked it" }, description: "Rarest unlocks and progress per game, in your dashboard.", fields: [{ name: "Unlocked", value: String(a.done) }, { name: "Games", value: String(a.games) }, { name: "Rarest", value: a.top[0] ? `${a.top[0].name} (${a.top[0].pct}%)` : null }] });
            return { unlocked: a.done, gamesWithAchievements: a.games, rareUnlocks: a.rare, rarest: a.top.map(x => ({ game: x.game, achievement: x.name, ownedByPercentOfPlayers: x.pct })) };
        },

        async my_steam(_i, { userId, cards }) {
            const miss = needSteam(userId); if (miss) return miss;
            const v = await libraryView(db, itad, userOf(userId), { snapshot: false });
            const rows = v.rows.filter(r => r.appid);
            if (!rows.length) return { empty: true, note: "No Steam games synced yet. /me steam sync pulls them in." };
            const s = playStats(rows), year = new Date().getUTCFullYear(), recap = db.playRecap(userId, year), goal = db.getHourGoal(userId);
            const next = steamNext(rows);
            await dashCard(dashUrl, { cards }, "steam", { fetchImpl, title: "Your Steam library", panel: { sub: `${s.playedGames} played, ${s.unplayedCount} barely touched`, tiles: [{ label: "Games", value: String(s.games) }, { label: "Hours played", value: Math.round(s.totalMinutes / 60).toLocaleString("en-US") }, { label: "Unplayed", value: String(s.unplayedCount) }], rows: s.mostPlayed.slice(0, 5).map(g => ({ label: g.title, sub: g.status, value: fmtHours(g.minutes), pct: s.mostPlayed[0].minutes ? g.minutes / s.mostPlayed[0].minutes * 100 : 0 })), foot: "Most played games" }, description: "Hours, unplayed games and what it is all worth, in your dashboard.", fields: [{ name: "Games", value: String(s.games) }, { name: "Hours", value: String(Math.round(s.totalMinutes / 60)) }, { name: "Unplayed", value: String(s.unplayedCount) }] });
            return { games: s.games, played: s.playedGames, totalHours: Math.round(s.totalMinutes / 6) / 10, neverPlayedOrUnder1h: s.unplayedCount,
                mostPlayed: s.mostPlayed.map(r => ({ title: r.title, hours: fmtHours(r.minutes), status: r.status })),
                thisYear: { year, hoursTracked: Math.round(recap.totalMinutes / 6) / 10, games: recap.games, top: recap.top.map(t => ({ title: t.title, hours: fmtHours(t.minutes) })) },
                hoursGoal: goal ? { goal, trackedSoFar: Math.round(recap.totalMinutes / 60) } : null,
                playNext: next ? { title: next.pick.title, why: next.why } : null };
        },

        async my_spending(_i, ctx) {
            const { userId } = ctx;
            const lib = db.listLibrary(userId);
            if (!lib.length) return { empty: true, note: "Their library is empty." };
            const u = userOf(userId), c = regionCurrency(u.region), s = spendSummary(lib, { currency: c });
            if (!s.games) return { empty: true, note: "None of their games have a price paid on record, so there is nothing to total. Adding what they paid fills this in." };
            await dashCard(dashUrl, ctx, "library", { fetchImpl, title: "Your spending", panel: { sub: `${s.games} games with a price paid`, tiles: [{ label: "Total spent", value: money(s.total, c) }, { label: "This year", value: money(s.year.total, c) }, { label: "Average", value: money(s.avg, c) }], rows: s.months.slice(-6).map(m => ({ label: m.month, sub: `${m.games} game${m.games === 1 ? "" : "s"}`, value: money(m.total, c), pct: Math.max(...s.months.map(x => x.total)) ? m.total / Math.max(...s.months.map(x => x.total)) * 100 : 0 })), foot: "Last six months" }, description: "Month by month, cost per hour and bought-but-unplayed, in your dashboard.", fields: [{ name: "Total", value: money(s.total, c) }, { name: "This year", value: money(s.year.total, c) }, { name: "Unplayed", value: `${s.unplayed.count} games` }] });
            return { currency: c, total: s.total, games: s.games, averagePerGame: s.avg, thisYear: s.year, lastMonths: s.months.slice(-6), bestValue: s.bestValue, worstValue: s.worstValue, boughtButUnplayed: s.unplayed };
        },

        async my_badges(_i, ctx) {
            const t = trophyCase(db, ctx.userId);
            await dashCard(dashUrl, ctx, "library", { fetchImpl, title: "Your trophy case", panel: { sub: `${t.earned} of ${t.total} badges earned`, tiles: [{ label: "Earned", value: String(t.earned) }, { label: "Total", value: String(t.total) }], rows: t.badges.filter(b => b.tier).slice(0, 6).map(b => ({ label: b.name, sub: b.unit, value: b.tier })) }, description: "Every badge and what the next tier needs.", fields: [{ name: "Earned", value: `${t.earned} of ${t.total}` }] });
            return { earned: t.earned, total: t.total, badges: t.badges.map(b => ({ name: b.name, tier: b.tier, progress: `${b.value}${b.unit ? ` ${b.unit}` : ""}`, nextTierAt: b.next })) };
        },

        async my_challenge(_i, ctx) {
            const c = challengeView(db, ctx.userId);
            await dashCard(dashUrl, ctx, "library", { fetchImpl, title: "Monthly challenge", panel: { sub: c.month, tiles: [{ label: "Finished", value: `${c.done}${c.goal ? ` / ${c.goal}` : ""}` }, { label: "Streak", value: `${c.streak} mo` }, { label: "Days left", value: String(c.daysLeft) }], rows: c.titles.slice(0, 5).map(x => ({ label: typeof x === "string" ? x : x.title, value: "Finished" })) }, fields: [{ name: "This month", value: `${c.done}${c.goal ? ` of ${c.goal}` : ""} finished` }, { name: "Streak", value: `${c.streak} month${c.streak === 1 ? "" : "s"}` }] });
            return { month: c.month, goal: c.goal || null, finishedThisMonth: c.done, finishedTitles: c.titles, daysLeft: c.daysLeft, streakMonths: c.streak, bestStreak: c.best, recent: c.history };
        },

        async deals_for_you(_i, { userId, cards }) {
            const r = await forYou({ db, itad, userId, user: userOf(userId), fetchImpl: globalThis.fetch });
            const top = r.deals.slice(0, 5);
            if (!top.length) return { empty: true, note: "No deals matched right now." };
            for (const d of top.slice(0, 3)) cards?.push({ title: d.title, url: safeUrl(d.url), linkLabel: `Buy at ${clip(d.shop, 30)}`, image: d.appid ? steamArt(d.appid) : itadArt(d.id), wish: d.wishlist ? undefined : d.title,
                fields: [{ name: "Price", value: `${money(d.price, cur(d.currency))} (-${d.cut}%)` }, { name: "Was", value: money(d.regular, cur(d.currency)) }, { name: "Fits you", value: d.match ? `${d.match}%` : null }, { name: "Note", value: d.atl ? "All-time low" : d.wishlist ? "On your wishlist" : null }] });
            return { personalised: r.personalised, yourTopGenres: r.genres, deals: top.map(d => ({ title: d.title, price: money(d.price, cur(d.currency)), discountPct: d.cut, shop: d.shop, matchPct: d.match, atAllTimeLow: d.atl, onYourWishlist: d.wishlist })) };
        },

        async my_settings(_i, ctx) {
            const { userId } = ctx;
            const u = userOf(userId), p = prefsView(u);
            await dashCard(dashUrl, ctx, "alerts", { title: "Your alert settings", description: "Change any of them in your dashboard.", fields: [{ name: "Alerts", value: u.paused ? "Paused" : "On" }, { name: "Region", value: u.region }, { name: "Watching", value: `${db.countItems(userId)} games` }] });
            return { alerts: u.paused ? "paused" : "on", delivery: u.delivery, region: u.region, stores: u.stores, gamesWatched: db.countItems(userId), quietHours: describeQuiet(u), weeklyDigest: describeDigest(u),
                minDiscountPct: p.min_discount, newsAlerts: ["off", "patch notes only", "every announcement"][p.news] ?? "off", freeGameAlerts: p.free, bundleAlerts: p.bundles, achievementAlerts: p.achv, language: p.lang };
        },

        async update_settings(input, { userId }) {
            const patch = {}, done = [];
            if (typeof input.paused === "boolean") { patch.paused = input.paused ? 1 : 0; done.push(input.paused ? "alerts paused" : "alerts resumed"); }
            if (input.region) { const r = String(input.region).toUpperCase(); if (!REGIONS.some(x => x.value === r)) return { error: `I don't know the region ${clip(input.region, 8)}. Use a two-letter code like US, GB or DE.` }; patch.region = r; done.push(`region ${r}`); }
            if (input.stores) { if (!["all", "major"].includes(input.stores)) return { error: "Stores must be all or major." }; patch.stores = input.stores; done.push(`stores: ${input.stores}`); }
            if (Number.isInteger(input.min_discount)) { patch.min_discount = Math.max(0, Math.min(95, input.min_discount)); done.push(`minimum discount ${patch.min_discount}%`); }
            if (!done.length) return { error: "Nothing to change." };
            db.updateUser(userId, patch);
            return { changed: done };
        },

        async upcoming({ days }, { userId, guildId }) {
            const d = Math.max(1, Math.min(90, Number(days) || 14)), now = Date.now();
            const list = calendarEntries(db, userId, { from: now, to: now + d * 86400_000, guildIds: guildId ? [guildId] : [] });
            if (!list.length) return { empty: true, days: d, note: "Nothing coming up in that window." };
            return { days: d, entries: list.slice(0, 15).map(e => ({ kind: e.kind, title: e.title, date: day(e.start), time: e.allDay ? null : new Date(e.start).toISOString().slice(11, 16) + " UTC", notes: clip(e.notes, 120) || null })) };
        },

        async sale_plan({ budget }, { userId, cards }) {
            const r = await salePrep({ db, itad, user: userOf(userId), budget: Number(budget) > 0 ? Number(budget) : null });
            const c = cur(r.currency);
            for (const g of r.buyNow.slice(0, 3)) cards?.push({ title: g.title, linkLabel: "See prices", url: `https://isthereanydeal.com/search/?q=${encodeURIComponent(g.title)}`, image: itadArt(g.itad_id), fields: [{ name: "Now", value: `${money(g.price, c)} at ${g.shop}` }, { name: "Discount", value: g.discount ? `-${g.discount}%` : null }, { name: "Verdict", value: g.verdict }] });
            return { watching: r.watching, nextSale: r.sale ? { name: r.sale.name, starts: day(r.sale.start), ends: day(r.sale.end) } : null,
                buyNow: r.buyNow.slice(0, 8).map(g => ({ title: g.title, price: money(g.price, c), discountPct: g.discount, shop: g.shop, verdict: g.verdict })),
                waitForABetterPrice: r.wait.slice(0, 6).map(g => ({ title: g.title, price: money(g.price, c), allTimeLow: g.atl !== null ? money(g.atl, c) : null })),
                budgetPlan: r.plan ? { budget: money(r.budget, c), picks: r.plan.picks.slice(0, 8).map(g => g.title), spent: money(r.plan.spent, c), left: money(r.plan.left, c) } : null };
        },

        async game_news(_i, { userId, cards }) {
            if (!news) return { error: "News isn't available right now." };
            const r = await newsForUser(db, news, userId, { limit: 5 });
            if (!r.known) return { empty: true, note: "None of their games have a Steam link yet, so there is no news to find. Linking Steam fixes that." };
            if (!r.posts.length) return { empty: true, note: "No recent news for their games." };
            for (const p of r.posts.slice(0, 2)) cards?.push({ title: `${p.gameTitle}: ${clip(p.title, 150)}`, url: safeUrl(p.url), linkLabel: "Read the post", description: clip(p.text ?? p.summary ?? "", 280), image: safeUrl(p.image), footer: p.date ? day(p.date) : undefined });
            return { posts: r.posts.map(p => ({ game: p.gameTitle, title: clip(p.title, 150), date: p.date ? day(p.date) : null, url: safeUrl(p.url) })) };
        },

        async bundles_for({ title }, { userId }) {
            const u = userOf(userId);
            let ids;
            if (title) { const [hit] = await itad.lookupTitles([clip(title, 80)]); if (!hit?.id) return { found: false, note: "I couldn't find that game." }; ids = [hit.id]; }
            else ids = db.listItems(userId).map(i => i.itad_id);
            const r = await bundleCheck({ db, itad, user: u, gameIds: ids });
            if (!r.bundles.length) return { empty: true, note: title ? "No live bundle has that game right now." : "No live bundle has anything from their wishlist right now." };
            return { currency: r.currency, bundles: r.bundles.slice(0, 4).map(b => ({ name: b.title ?? b.name, store: b.shop ?? b.store ?? null, ends: b.expiry ? day(b.expiry) : null, url: safeUrl(b.url), verdict: b.verdict?.text, bestTier: b.best ? { price: money(b.best.price, r.currency), games: b.best.games, newToYou: b.best.newToYou, worth: money(b.best.worth, r.currency), wantedGames: b.best.wanted.slice(0, 5) } : null })) };
        },

        async regional_prices({ title }, { userId }) {
            const [hit] = await itad.lookupTitles([clip(title, 80)]);
            if (!hit?.id) return { found: false, note: "I couldn't find that game." };
            const u = userOf(userId);
            const rows = await regionPrices({ itad, fx, itadId: hit.id, home: u.region || "US", majorOnly: u.stores === "major" });
            if (!rows.length) return { empty: true, note: "No regional prices found." };
            return { game: hit.matched ?? hit.title, cheapestFirst: rows.slice(0, 8).map(r => ({ region: r.name, price: money(r.price, r.currency), approxUsd: r.usd !== null ? money(r.usd, "USD") : null, shop: r.shop, yourRegion: r.home })), note: "Buying outside your own region can break on some stores. Gift and key rules differ." };
        },

        async my_friends(_i, { userId }) {
            const f = friendRows(db, userId);
            if (!f.length) return { empty: true, note: "They haven't added anyone. /friend add keeps a birthday and finds gift deals." };
            return { friends: f.slice(0, 12).map(x => ({ name: x.name, birthday: x.birthday ?? null, daysUntil: x.daysToBirthday })) };
        },

        async server_activity(_i, ctx) {
            const { userId, guildId } = ctx;
            if (!guildId) return { error: "Only works inside a server." };
            const xp = db.getXp?.(guildId, userId), lv = xp ? levelFromXp(xp.xp ?? 0) : null;
            const st = serverStats(db, guildId), now = Date.now();
            const lfg = db.listOpenLfg(guildId).slice(0, 5).map(p => ({ game: p.game, when: day(p.starts_at) + " " + new Date(p.starts_at).toISOString().slice(11, 16) + " UTC", slots: p.slots }));
            const events = db.listCalEvents(guildId, now, now + 14 * 86400_000).slice(0, 5).map(e => ({ title: e.title, when: day(e.starts_at) }));
            await dashCard(dashUrl, ctx, "xp", { title: "Your server level", description: "Levels, rank and the leaderboard in your dashboard.", fields: lv ? [{ name: "Level", value: String(lv.level) }, { name: "Rank", value: String(db.xpRank?.(guildId, userId) ?? "") }] : [] });
            return { you: lv ? { level: lv.level, xpIntoLevel: lv.into, xpNeeded: lv.need, rank: db.xpRank?.(guildId, userId) ?? null } : null, openGroupPosts: lfg, upcomingEvents: events,
                membersSharingStats: st.members ?? st.sharing ?? undefined, gamesAcrossThem: st.games, savedAcrossThem: st.saved ? Math.round(st.saved) : 0, topSavers: st.top.map((t, n) => ({ rank: n + 1, member: nameOf(t.discord_id) ?? "a member", savedPct: Math.round(t.savedPct) })) };
        },

        async remove_from_wishlist({ title }, { userId }) {
            const f = lookup(db.listItems(userId), title); if (f.error) return f;
            db.removeItem(userId, f.item.itad_id);
            return { removed: f.item.title };
        },

        async star_wishlist_game({ title, starred }, { userId }) {
            const f = lookup(db.listItems(userId), title); if (f.error) return f;
            const on = starred !== false;
            db.setPriority(userId, f.item.itad_id, on);
            return { game: f.item.title, starred: on };
        },

        async add_to_library({ title, paid }, { userId }) {
            const r = await importLibrary(db, itad, userId, [{ title: clip(title, 100), paid: Number.isFinite(paid) && paid >= 0 ? paid : null }]);
            if (r.notFound.length) return { error: `I couldn't find a game called ${clip(title, 60)}.` };
            if (r.skippedForLimit) return { error: "Their library is full (1,500 games)." };
            return { ok: true, updatedExisting: Boolean(r.updated), paid: Number.isFinite(paid) ? paid : null };
        },

        async set_game_status({ title, status }, { userId }) {
            if (!STATUS.includes(status)) return { error: `Status must be one of ${STATUS.join(", ")}.` };
            const f = lookup(db.listLibrary(userId), title); if (f.error) return f;
            db.setLibraryStatus(userId, f.item.itad_id, status);
            return { game: f.item.title, status };
        },

        async remove_from_library({ title }, { userId }) {
            const f = lookup(db.listLibrary(userId), title); if (f.error) return f;
            db.removeLibrary(userId, f.item.itad_id);
            return { removed: f.item.title };
        },

        async set_goals({ games_this_month, hours_this_year }, { userId }) {
            const done = [];
            if (Number.isInteger(games_this_month)) { const g = Math.max(0, Math.min(MAX_GOAL, games_this_month)); db.setChallenge(userId, monthKey(Date.now()), g); done.push(g ? `finish ${g} games this month` : "monthly goal cleared"); }
            if (Number.isInteger(hours_this_year)) { const h = Math.max(0, Math.min(5000, hours_this_year)); db.setHourGoal(userId, h); done.push(h ? `${h} hours this year` : "hours goal cleared"); }
            return done.length ? { set: done } : { error: "Nothing to set." };
        }
    };
}

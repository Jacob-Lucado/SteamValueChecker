// More for the AI companion: should-I-buy verdicts with a price graph, game comparisons, backlog plans, play-together picks,
// group posts and events by chat, a setup checklist for managers, notes the member asked it to keep, and the guides a server's
// managers wrote. Same rule as the other tools: they act for the person who asked, never for anyone else, and only when asked.
import { summarize } from "./report.js";
import { current } from "./alerts.js";
import { buyOrWait } from "./advice.js";
import { renderHistoryChart } from "./historychart.js";
import { steamReviews } from "./reviews.js";
import { upcomingSales, salesBefore } from "./salescal.js";
import { libraryView } from "./library.js";
import { playTogether } from "./compare.js";
import { parseWhen } from "./lfg.js";
import { validTimezone, DEFAULT_TZ } from "./timeutil.js";
import { renderPanel } from "./aipics.js";
import { money, itadArt, safeUrl } from "./render.js";
import { steamArt } from "./art.js";
import { dashLink } from "./dashlink.js";
import { matchServerGuide } from "./guides.js";
import { MAX_NOTES, NOTE_LEN } from "./aistore.js";
import { addGameByTitle, findItem } from "./wishlist.js";

const clip = (s, n = 80) => String(s ?? "").slice(0, n);
const arr = v => (Array.isArray(v) ? v : []);
const title = { type: "object", properties: { title: { type: "string", description: "Game title" } }, required: ["title"] };

const ABILITIES = [
    ["Prices and deals", "Check any game's price across stores, compare two games, say whether to buy now or wait, with a price graph"],
    ["Your wishlist", "Add or remove games, set a price or percent-off alert, show what's on it"],
    ["Your library", "Library worth, spending, play time, rare achievements, badges, what to play next, a plan for the time you have"],
    ["Free games and sales", "What's free right now, the next big Steam sale, deals picked for you, news for your games"],
    ["Friends and groups", "Games you and a friend both own, post a looking-for-group call, add server events (managers)"],
    ["Guides", "Step-by-step help with pictures: Steam verified, linking Steam, wishlist import, and this server's own guides"],
    ["Server help", "Rules, roles and channels from your server's guides; a setup checklist for managers"],
    ["Remembers you", "Keeps a few short notes about what you like, and forgets them any time you say so"]
];
const ABILITIES_PANEL = { title: "What I can do", sub: "Just ask me in plain words. Say Hey AI first, or mention me.", rows: ABILITIES.map(([label, sub]) => ({ label, sub })) };
const ABILITIES_TEXT = ABILITIES.map(([n, s]) => `${n}: ${s}`);
export { ABILITIES_TEXT };

export const EXTRA_DEFS = [
    { name: "buy_verdict", description: "Should the asker buy a game now or wait? Looks at a year of price history, how often it hit its low, upcoming Steam sales and Steam reviews, and shows a price-history graph. Use it for 'is X worth buying', 'is it a good price', 'should I wait for a sale'.", input_schema: title },
    { name: "compare_games", description: "Compare two games side by side: price now, discount, Steam review score, genres and release year, as a picture, with which is the better deal. Use it for 'X or Y?', 'X vs Y'.", input_schema: { type: "object", properties: { first: { type: "string" }, second: { type: "string" } }, required: ["first", "second"] } },
    { name: "plan_backlog", description: "Plan what the asker should play from their own library given the time they have. There is no game-length data, so it prefers games they already started, then untouched ones, and says so. Optionally filter by a genre or tag word like 'co-op' or 'roguelike'.", input_schema: { type: "object", properties: { hours: { type: "number", description: "Hours they have to play" }, genre: { type: "string" } } } },
    { name: "play_together", description: "Games the asker and a friend both own that are co-op or multiplayer, least played together first. The friend must be @mentioned in the question and have opted in to sharing in this server; if not, the tool says so.", input_schema: { type: "object", properties: {} } },
    { name: "post_lfg", description: "Post a looking-for-group call in this channel: a game, a time and how many players. Only when the asker clearly asks to organise a group.", input_schema: { type: "object", properties: { game: { type: "string" }, when: { type: "string", description: "e.g. 8pm, tomorrow 19:30, in 2 hours" }, slots: { type: "integer", minimum: 2, maximum: 20, description: "Players including the asker (default 4)" }, note: { type: "string" }, event: { type: "boolean", description: "Also create a Discord event" } }, required: ["game", "when"] } },
    { name: "add_server_event", description: "Add an event to this server's calendar and announce it here. Only for server managers, and only when they ask.", input_schema: { type: "object", properties: { title: { type: "string" }, when: { type: "string", description: "e.g. friday 9pm" }, notes: { type: "string" } }, required: ["title", "when"] } },
    { name: "server_setup", description: "Which of this server's bot features are set up and which are missing, with the command that fixes each. Only for server managers; use it for 'what's left to set up' or 'is my server configured'.", input_schema: { type: "object", properties: {} } },
    { name: "remember", description: "Keep a short note about the asker so later answers fit them, like a favourite genre, a budget or a platform. Only when they ask you to remember something, or clearly state a lasting preference about games. Never health, politics, money details, passwords or anything about other people.", input_schema: { type: "object", properties: { note: { type: "string", description: "One short fact in the third person, e.g. 'Likes co-op roguelikes'" } }, required: ["note"] } },
    { name: "forget", description: "Forget what you kept about the asker: one note by a word in it, or everything. Only when they ask.", input_schema: { type: "object", properties: { about: { type: "string", description: "A word from the note; leave empty to forget everything" } } } },
    { name: "my_notes", description: "What you currently remember about the asker.", input_schema: { type: "object", properties: {} } },
    { name: "set_price_alert", description: "Add a game to the asker's wishlist with a price target, so they're alerted when it drops to that price or below, or by a percentage off. Only when they clearly ask to be told at a price.", input_schema: { type: "object", properties: { title: { type: "string" }, price: { type: "number", description: "Alert at or under this price in their currency" }, percent: { type: "number", description: "Alert at this percent off or more (1-99)" } }, required: ["title"] } },
    { name: "what_can_you_do", description: "Show everything this assistant can do, as a picture. Use it when someone asks what you can do, what you can help with, or for help.", input_schema: { type: "object", properties: {} } },
    { name: "server_guide", description: "Look up this server's own guides (written by its managers) for a question about the server itself: its rules, roles, channels, events or how things work here. Try this first for anything about this particular server.", input_schema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] } }
];

export function createExtraTools({ db, itad, fetchImpl = globalThis.fetch, dashUrl = null, lfg = null, calendar = null }) {
    const userOf = id => db.getUser?.(id) ?? { discord_id: id, region: "US", stores: "all" };

    async function resolve(titleText, userId) {
        const user = userOf(userId);
        const [hit] = await itad.lookupTitles([clip(titleText, 80)]);
        if (!hit?.id) return null;
        const [prices, apps] = await Promise.all([itad.getPrices([hit.id], user.region), itad.steamAppIds?.([hit.id]).catch(() => new Map())]);
        const s = summarize(prices.get(hit.id), { majorOnly: user.stores === "major" });
        return { id: hit.id, name: hit.approx ? hit.matched : hit.title, approx: Boolean(hit.approx), appid: apps?.get?.(hit.id) ?? null, s, now: { ...current(s), currency: s.currency }, user };
    }
    const steamFacts = async appid => {
        if (!Number.isInteger(appid)) return null;
        try { const r = await fetchImpl(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english&cc=us`, { signal: AbortSignal.timeout(7000) }); if (!r.ok) return null; return (await r.json())?.[appid]?.data ?? null; } catch { return null; }
    };
    const pushFile = (ctx, card) => { ctx?.cards?.push(card); };

    return {
        async buy_verdict({ title: t }, ctx) {
            const g = await resolve(t, ctx.userId);
            if (!g) return { found: false, note: "I couldn't find that game." };
            if (g.now.price === null) return { found: true, game: g.name, note: "No current price found for it." };
            const cur = g.now.currency ?? "USD", m = n => money(n, cur);
            let history = null, advice = null, reviews = null;
            try { history = await itad.getHistory(g.id, g.user.region); advice = buyOrWait(history, g.now.price, { sales: upcomingSales(Date.now()), past: salesBefore(), money: m }); } catch { /* the verdict works without it */ }
            reviews = await steamReviews(g.appid, { fetchFn: fetchImpl }).catch(() => null);
            let chart = null;
            try { chart = history ? renderHistoryChart({ title: g.name, points: history, currency: cur, now: g.now.price }) : null; } catch { /* no graph then */ }
            const url = safeUrl(g.now.url) ?? (g.now.slug ? `https://isthereanydeal.com/game/${encodeURIComponent(g.now.slug)}/info/` : undefined);
            if (chart) pushFile(ctx, { title: g.name, url, linkLabel: g.now.shop ? `Buy at ${clip(g.now.shop, 30)}` : "See prices", file: { name: "price-history.png", data: chart }, wish: g.name, footer: advice ? `${advice.label}: ${clip(advice.reasons[0], 80)}` : undefined });
            else ctx?.cards?.push({ title: g.name, url, linkLabel: "See prices", image: g.appid ? steamArt(g.appid) : itadArt(g.id), wish: g.name, fields: [{ name: "Now", value: `${m(g.now.price)} at ${g.now.shop}` }, { name: "All-time low", value: g.now.atl != null ? m(g.now.atl) : null }] });
            return { game: g.name, closestMatchOnly: g.approx, priceNow: `${m(g.now.price)} at ${g.now.shop}`, discountPct: Math.round(g.now.discount * 100), fullPrice: g.now.regular != null ? m(g.now.regular) : null, allTimeLow: g.now.atl != null ? m(g.now.atl) : null,
                verdict: advice ? { call: advice.label, reasons: advice.reasons, low12Months: m(advice.low), usualPrice: m(advice.median), timesAtLow: advice.dips, bigSaleInDays: advice.saleIn } : { call: "Not enough price history to judge" },
                steamReviews: reviews ? `${reviews.desc}, ${reviews.pct}% of ${reviews.total.toLocaleString("en-US")}` : null };
        },

        async compare_games({ first, second }, ctx) {
            const [a, b] = await Promise.all([resolve(first, ctx.userId), resolve(second, ctx.userId)]);
            if (!a || !b) return { found: false, note: `I couldn't find ${!a ? clip(first, 40) : clip(second, 40)}.` };
            const [fa, fb, ra, rb] = await Promise.all([steamFacts(a.appid), steamFacts(b.appid), steamReviews(a.appid, { fetchFn: fetchImpl }).catch(() => null), steamReviews(b.appid, { fetchFn: fetchImpl }).catch(() => null)]);
            const row = (g, f, r) => ({ name: g.name, price: g.now.price, cur: g.now.currency ?? "USD", cut: Math.round(g.now.discount * 100), shop: g.now.shop, atl: g.now.atl, reviews: r, genres: arr(f?.genres).map(x => x.description).slice(0, 3).join(", "), year: String(f?.release_date?.date ?? "").match(/\d{4}/)?.[0] ?? null, appid: g.appid, id: g.id });
            const A = row(a, fa, ra), B = row(b, fb, rb);
            const cheaper = A.price !== null && B.price !== null && A.price !== B.price ? (A.price < B.price ? A : B) : null;
            const better = A.reviews && B.reviews && A.reviews.pct !== B.reviews.pct ? (A.reviews.pct > B.reviews.pct ? A : B) : null;
            const icon = x => [x.appid ? steamArt(x.appid) : null, itadArt(x.id)];
            try {
                const data = await renderPanel({ title: `${A.name} vs ${B.name}`, sub: "Price now, Steam reviews, genres",
                    tiles: [{ label: "Cheaper now", value: cheaper ? cheaper.name : "Same price" }, { label: "Better reviewed", value: better ? better.name : "Too close" }],
                    rows: [A, B].map(x => ({ label: x.name, sub: [x.genres, x.year, x.reviews ? `${x.reviews.desc} (${x.reviews.pct}%)` : null].filter(Boolean).join(" · ") || "No store details", icon: icon(x), value: x.price !== null ? `${money(x.price, x.cur)}${x.cut ? ` -${x.cut}%` : ""}` : "No price", pct: x.reviews?.pct })),
                    foot: "Bars show the share of positive Steam reviews" }, { fetchImpl });
                pushFile(ctx, { title: `${A.name} vs ${B.name}`, file: { name: "compare.png", data }, wish: [A, B].some(x => x.price !== null) ? undefined : undefined });
            } catch { /* the text answer still works */ }
            const out = x => ({ game: x.name, price: x.price !== null ? `${money(x.price, x.cur)} at ${x.shop}` : null, discountPct: x.cut, allTimeLow: x.atl != null ? money(x.atl, x.cur) : null, genres: x.genres || null, released: x.year, steamReviews: x.reviews ? `${x.reviews.desc}, ${x.reviews.pct}%` : null });
            return { first: out(A), second: out(B), cheaperNow: cheaper?.name ?? null, betterReviewed: better?.name ?? null };
        },

        async plan_backlog({ hours, genre }, ctx) {
            const v = await libraryView(db, itad, userOf(ctx.userId), { snapshot: false });
            if (!v.rows.length) return { empty: true, note: "Their library is empty. It fills from a Steam sign-in or /me library import." };
            let pool = v.rows.filter(r => !["finished", "dropped"].includes(r.status));
            const want = clip(genre, 30).toLowerCase().trim();
            let filtered = false;
            if (want) {
                const tags = db.getAppTags(pool.map(r => r.appid).filter(Number.isInteger));
                const hit = pool.filter(r => { const t = tags.get(r.appid); return t && [...t.genres, ...t.cats].some(x => x.toLowerCase().includes(want)); });
                if (hit.length) { pool = hit; filtered = true; }
            }
            const tier = r => (r.status === "playing" ? 0 : r.minutes >= 30 && r.minutes < 600 ? 1 : r.minutes < 30 ? 2 : 3);
            pool.sort((a, b) => tier(a) - tier(b) || (tier(a) === 1 ? b.minutes - a.minutes : (b.msrp ?? 0) - (a.msrp ?? 0)) || a.title.localeCompare(b.title));
            const h = Number(hours) > 0 ? Number(hours) : null;
            const count = h === null ? 3 : h <= 2 ? 1 : h <= 5 ? 2 : h <= 10 ? 3 : 4;
            const picks = pool.slice(0, count);
            if (!picks.length) return { empty: true, note: want ? `Nothing in their backlog matches "${want}".` : "Nothing left in their backlog." };
            const reason = r => (r.status === "playing" ? "You are playing this now" : r.minutes >= 30 && r.minutes < 600 ? `Started (${Math.round(r.minutes / 6) / 10} h in), easy to pick back up` : r.minutes < 30 ? "Owned and untouched" : `${Math.round(r.minutes / 60)} h in, not finished`);
            try {
                const data = await renderPanel({ title: "Your play plan", sub: [h ? `${h} hour${h === 1 ? "" : "s"} to spend` : "A few good picks", want && filtered ? `matching ${want}` : null].filter(Boolean).join(" · "),
                    tiles: [{ label: "Picks", value: String(picks.length) }, { label: "In your backlog", value: String(pool.length) }],
                    rows: picks.map((r, n) => ({ label: `${n + 1}. ${r.title}`, sub: reason(r), icon: [r.appid ? steamArt(r.appid) : null, r.itad_id ? itadArt(r.itad_id) : null], value: r.minutes ? `${Math.round(r.minutes / 6) / 10} h` : "New" })),
                    foot: "No game-length data, so this favours games you already started" }, { fetchImpl });
                pushFile(ctx, { title: "Your play plan", file: { name: "plan.png", data }, url: dashLink(dashUrl, "library") ?? undefined, linkLabel: "Open my library" });
            } catch { /* text answer still works */ }
            return { hoursAvailable: h, filteredByGenre: filtered ? want : null, genreNotFound: want && !filtered ? want : null, plan: picks.map(r => ({ title: r.title, why: reason(r), hoursPlayed: Math.round(r.minutes / 6) / 10 })), backlogSize: pool.length,
                caveat: "I don't have game lengths, so I can't promise any of these fit the time. Suggest setting a monthly goal if they want to commit." };
        },

        async play_together(_i, ctx) {
            const friend = arr(ctx.mentions)[0];
            if (!ctx.guildId) return { error: "Only works inside a server." };
            if (!friend) return { error: "Mention the friend in your message, like @name, so I know who you mean." };
            if (friend.id === ctx.userId) return { error: "That's you. Mention someone else." };
            if (!db.sharingMembers(ctx.guildId).includes(friend.id)) return { shared: false, note: `${friend.name} hasn't opted in to sharing in this server, so I can't look at their games. They can turn it on with /alerts share.` };
            if (!db.sharingMembers(ctx.guildId).includes(ctx.userId)) { db.ensureUser(ctx.userId, ctx.guildId); }
            const r = playTogether(db, ctx.userId, friend.id);
            if (!r.shared) return { shared: true, note: `You and ${friend.name} don't own any of the same games yet.` };
            if (!r.picks.length) return { shared: true, sameGames: r.shared, note: r.untagged ? `${r.untagged} shared games don't have co-op tags yet, so I can't say which are multiplayer.` : "None of your shared games are co-op or multiplayer." };
            try {
                const data = await renderPanel({ title: `You and ${friend.name}`, sub: `${r.shared} games in common, ${r.picks.length} you can play together`,
                    tiles: [{ label: "In common", value: String(r.shared) }, { label: "Co-op or multiplayer", value: String(r.picks.length) }],
                    rows: r.picks.slice(0, 5).map(x => ({ label: x.title, sub: x.coop ? "Co-op" : "Multiplayer", icon: [Number.isInteger(x.appid) ? steamArt(x.appid) : null], value: `${Math.round((x.minutes ?? 0) / 60)} h together` })), foot: "Least played together first" }, { fetchImpl });
                pushFile(ctx, { title: "Play together", file: { name: "together.png", data } });
            } catch { /* text answer still works */ }
            return { friend: friend.name, gamesInCommon: r.shared, picks: r.picks.slice(0, 6).map(x => ({ title: x.title, kind: x.coop ? "co-op" : "multiplayer", hoursPlayedBetweenYou: Math.round((x.minutes ?? 0) / 60) })), untaggedGames: r.untagged };
        },

        async post_lfg({ game, when, slots, note, event }, ctx) {
            if (!lfg) return { error: "Group posts aren't available right now." };
            if (!ctx.guildId || !ctx.channelId) return { error: "Only works inside a server channel." };
            const user = db.ensureUser(ctx.userId, ctx.guildId);
            const tz = validTimezone(user.tz) ? user.tz : DEFAULT_TZ;
            const startsAt = parseWhen(String(when ?? ""), { tz });
            const { post, eventError } = await lfg.create({ guildId: ctx.guildId, channelId: ctx.channelId, creatorId: ctx.userId, game, startsAt: startsAt ?? NaN, slots: Number.isInteger(slots) ? slots : 4, note, event: Boolean(event) });
            return { posted: post.game, slots: post.slots, startsAtUtc: new Date(post.starts_at).toISOString(), eventError: eventError ?? undefined, note: "The post is in this channel with a Join button." };
        },

        async add_server_event({ title: t, when, notes }, ctx) {
            if (!calendar) return { error: "Events aren't available right now." };
            if (!ctx.guildId) return { error: "Only works inside a server." };
            if (!ctx.canManage) return { error: "Only server managers can add events. Ask a manager, or use /server calendar add if you have the permission." };
            const user = db.ensureUser(ctx.userId, ctx.guildId);
            const startsAt = parseWhen(String(when ?? ""), { tz: validTimezone(user.tz) ? user.tz : DEFAULT_TZ });
            if (!Number.isFinite(startsAt)) return { error: "I couldn't read that time. Try 'friday 9pm' or 'tomorrow 19:30'." };
            const r = await calendar.create({ guildId: ctx.guildId, creatorId: ctx.userId, title: t, notes, startsAt, channelId: ctx.channelId ?? null });
            return { added: clip(t, 80), startsAtUtc: new Date(startsAt).toISOString(), announcedHere: r.announced };
        },

        async server_setup(_i, ctx) {
            if (!ctx.guildId) return { error: "Only works inside a server." };
            if (!ctx.canManage) return { error: "That's for server managers. Ask one to run /manage community status." };
            const c = db.getCommunity(ctx.guildId) ?? {}, on = Boolean, g = db.getGuild?.(ctx.guildId);
            const items = [
                ["Alert channel (deals and free games)", on(g?.channel_id), "/manage alertchannel set"],
                ["Steam Verified role", on(c.verified_role_id), "/manage community verifyrole"],
                ["Welcome message", c.welcome_on !== 0 && on(c.welcome_channel), "/manage community welcome"],
                ["Auto role for new members", on(c.autorole_id), "/manage community autorole"],
                ["Levels and XP", c.xp_on !== 0, "/manage community xp"],
                ["Mod log channel", on(c.mod_log_channel || c.log_channel), "/mod log"],
                ["Leaderboard channel", on(c.lb_channel), "/manage community setup"],
                ["How-to guides", c.guides_on !== 0, "/manage community ai guides:true"],
                ["AI companion", on(c.ai_on), "/manage community ai on:true"]
            ];
            return { done: items.filter(x => x[1]).map(x => x[0]), missing: items.filter(x => !x[1]).map(x => ({ feature: x[0], fixWith: x[2] })), tip: "/manage setup walks through the basics in one go." };
        },

        async remember({ note }, ctx) {
            const kept = db.addAiNote(ctx.userId, note);
            return kept ? { remembered: kept, note: `Up to ${MAX_NOTES} short notes are kept (${NOTE_LEN} characters each). They can say "forget everything" any time.` } : { error: "Nothing to remember." };
        },
        async forget({ about }, ctx) { return { forgotten: db.forgetAiNotes(ctx.userId, about || null) }; },
        async my_notes(_i, ctx) { const n = db.getAiNotes(ctx.userId); return n.length ? { notes: n.map(x => x.note) } : { empty: true, note: "I'm not remembering anything about them yet." }; },

        async set_price_alert({ title: t, price, percent }, ctx) {
            try {
                const type = Number.isFinite(price) ? "price" : Number.isFinite(percent) ? "percent" : null;
                const out = await addGameByTitle(db, itad, ctx.userId, t, type, type === "price" ? price : percent, { source: "ai" });
                return { added: out.name, alert: out.trigger };
            } catch (e) { return { error: e.message }; }
        },
        async what_can_you_do(_i, ctx) {
            const data = await renderPanel(ABILITIES_PANEL, { fetchImpl }).catch(() => null);
            if (data) ctx?.cards?.push({ title: "What I can do", file: { name: "abilities.png", data } });
            return { abilities: ABILITIES_TEXT, shownAsPicture: data ? "A picture of this list is already shown. Do not list them again: say one friendly line and invite them to ask." : undefined };
        },

        async server_guide({ question }, ctx) {
            if (!ctx.guildId) return { error: "Only works inside a server." };
            const list = db.listServerGuides(ctx.guildId);
            if (!list.length) return { found: false, note: "This server's managers haven't written any guides yet." };
            const g = matchServerGuide(question, list, { loose: true });
            return g ? { guide: g.title, answer: g.body } : { found: false, note: "No server guide matches that.", available: list.map(x => x.title) };
        }
    };
}

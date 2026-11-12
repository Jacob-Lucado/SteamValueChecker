// Wishlists, price alerts and Steam linking.
// server.js passes in the helpers it already has (ctx) and merges these routes into its table.
import { HttpError } from "./http.js";
import { SAMPLE_KINDS, sampleAlert } from "../samples.js";
import { addGameByTitle, applySteamImport, viewRows } from "../wishlist.js";
import { artUrl } from "../render.js";
import { buyOrWait } from "../advice.js";
import { codeFamilies, codeGames } from "../codes.js";
import { connectionPayload } from "../linkedroles.js";
import { describeTrigger, parseTrigger } from "../alerts.js";
import { expandGames } from "../codesource.js";
import { fetchOwnedGames, playStats, resolveProfile, steamNext, syncSteamLibrary } from "../steamlib.js";
import { goalProgress } from "../steamstore.js";
import { importWishlist } from "../steam.js";
import { isHidden } from "../hidden.js";
import { libraryAnalytics } from "../analytics.js";
import { libraryView } from "../library.js";
import { recommend, refreshTags, tasteProfile, tasteWhy } from "../taste.js";
import { regionCurrency } from "../spend.js";
import { salePrep, saleRecap } from "../saleprep.js";
import { salesBefore, upcomingSales } from "../salescal.js";
import { summarize } from "../report.js";

export function createWishlistRoutes(ctx) {
    const { MAX_HISTORY_POINTS, MUTE_DAYS, clientIp, config, cooldown, db, dm, idFinderLimit, isStaff, itad, now, num, profileCard, profileOrLinked, session, steamFetch, userRow } = ctx;
    return {
        // The public Steam ID finder page. No sign-in, so it is rate limited by address; answers are only what the profile already shows.
        "GET /api/steamid": async (req, _b, url) => {
            if (!idFinderLimit.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little and try again in a minute.");
            const q = String(url.searchParams.get("q") ?? "").trim().slice(0, 200);
            if (!q) throw new HttpError(400, "Paste a profile link or name first.");
            const steamid = await resolveProfile(q, steamFetch);
            const card = await profileCard(steamid);
            return { steamid, card: card ? { name: card.name, avatar: card.avatar } : null };
        },
        "POST /api/wishlist/snooze": async (req, body) => {
            const s = session(req);
            const item = db.listItems(s.userId).find(i => i.itad_id === body.itad_id);
            if (!item) throw new HttpError(404, "That game is not on your list.");
            // days 1-90 pauses alerts for that long, 0 turns them back on, and muted keeps this game quiet until it is switched back on.
            const days = Math.min(90, Math.max(0, Math.trunc(Number(body.days ?? 7)) || 0));
            const until = body.muted ? now() + MUTE_DAYS * 86400_000 : days ? now() + days * 86400_000 : null;
            db.snoozeItem(item.id, until);
            return { snoozed_until: until, muted: Boolean(body.muted) };
        },
        "GET /api/wishlist": async (req) => {
            const s = session(req);
            const u = userRow(s);
            const { rows, currency } = await viewRows(db, itad, u);
            return { rows, currency, sync: { available: Boolean(u.steam_id), on: u.wish_sync !== 0, at: u.wish_synced_at ?? null } };
        },
        // Keep the Steam wishlist current by itself (only after one import).
        "POST /api/wishlist/sync": async (req, body) => {
            const s = session(req); userRow(s);
            db.updateUser(s.userId, { wish_sync: body.on === false ? 0 : 1 });
            return { on: body.on !== false };
        },
        "POST /api/wishlist/import": async (req, body) => {
            const s = session(req);
            const undo = cooldown(s.userId, "import");
            userRow(s);
            try {
                const r = await importWishlist(await profileOrLinked(s, body.profile), itad);
                return applySteamImport(db, s.userId, r);
            } catch (err) {
                undo();
                throw err;
            }
        },
        "POST /api/wishlist/add": async (req, body) => {
            const s = session(req);
            cooldown(s.userId, "add");
            userRow(s);
            return addGameByTitle(db, itad, s.userId, body.title, body.type, num(body.value), { source: body.watch ? "watch" : "manual" });
        },
        "POST /api/wishlist/remove": async (req, body) => {
            const s = session(req);
            const item = db.listItems(s.userId).find(i => i.itad_id === body.itad_id);
            if (!item) throw new HttpError(404, "That game is not on your list.");
            db.removeItem(s.userId, item.itad_id);
            return { removed: item.title };
        },
        "POST /api/wishlist/cleanup": async (req) => {
            const s = session(req);
            const owned = db.ownedWishlist(s.userId);
            db.removeOwnedWishlist(s.userId);
            return { removed: owned.length, titles: owned.slice(0, 30).map(x => x.title) };
        },
        "POST /api/wishlist/priority": async (req, body) => {
            const s = session(req);
            if (!db.setPriority(s.userId, String(body.itad_id), body.starred !== false)) throw new HttpError(404, "That game is not on your list.");
            return { starred: body.starred !== false };
        },
        "POST /api/wishlist/alert": async (req, body) => {
            const s = session(req);
            let trig;
            try { trig = parseTrigger(body.type, num(body.value)); } catch (e) { throw new HttpError(400, e.message); }
            const label = describeTrigger({ trigger_type: trig.type, trigger_value: trig.value });
            if (body.itad_id) {
                const item = db.listItems(s.userId).find(i => i.itad_id === body.itad_id);
                if (!item) throw new HttpError(404, "That game is not on your list.");
                db.setTrigger(s.userId, trig.type, trig.value, item.itad_id);
                return { updated: 1, label };
            }
            return { updated: db.setTrigger(s.userId, trig.type, trig.value), label };
        },
        // ----- price history, bulk actions, alert history -----
        "GET /api/wishlist/history": async (req, _b, url) => {
            const s = session(req);
            const id = String(url.searchParams.get("itad_id") ?? "");
            const own = db.listItems(s.userId).find(i => i.itad_id === id) ?? db.listLibrary(s.userId).find(i => i.itad_id === id);
            if (!own) throw new HttpError(404, "That game is not on your wishlist or in your library.");
            cooldown(s.userId, "hist");
            const u = userRow(s);
            const all = await itad.getHistory(id, u.region);
            const step = Math.max(1, Math.ceil(all.length / MAX_HISTORY_POINTS));
            const points = all.filter((_, i) => i % step === 0 || i === all.length - 1).map(p => ({ t: p.t, price: p.price, shop: p.shop }));
            let advice = null;
            try {
                const prices = await itad.getPrices([id], u.region);
                const sum = summarize(prices.get(id), { majorOnly: u.stores === "major" });
                const nowPrice = sum.best?.price ?? all.at(-1)?.price;
                const cur = sum.currency || "USD";
                advice = buyOrWait(all, nowPrice, { sales: upcomingSales(Date.now()), past: salesBefore(), money: n => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(n); } catch { return String(n); } } });
            } catch { /* the chart works without it */ }
            return { title: own.title, points, advice };
        },
        "POST /api/wishlist/bulk": async (req, body) => {
            const s = session(req);
            const ids = Array.isArray(body.itad_ids) ? [...new Set(body.itad_ids.map(String))].slice(0, 200) : [];
            if (!ids.length) throw new HttpError(400, "Select at least one game.");
            const mine = new Set(db.listItems(s.userId).map(i => i.itad_id));
            const targets = ids.filter(id => mine.has(id));
            if (body.action === "remove") {
                for (const id of targets) db.removeItem(s.userId, id);
                return { removed: targets.length };
            }
            if (body.action === "alert") {
                let trig;
                try { trig = parseTrigger(body.type, num(body.value)); } catch (e) { throw new HttpError(400, e.message); }
                for (const id of targets) db.setTrigger(s.userId, trig.type, trig.value, id);
                return { updated: targets.length, label: describeTrigger({ trigger_type: trig.type, trigger_value: trig.value }) };
            }
            throw new HttpError(400, "Unknown action.");
        },
        // game code and promo news alerts to your own DMs
        "GET /api/alerts/codes": async (req) => {
            const s = session(req); userRow(s);
            return { ...db.getAlertSubs(s.userId), allGames: codeGames(), families: codeFamilies() };
        },
        "POST /api/alerts/codes": async (req, body) => {
            const s = session(req); userRow(s);
            const patch = {};
            if (body.codes !== undefined) patch.codes = Boolean(body.codes);
            if (body.promos !== undefined) patch.promos = Boolean(body.promos);
            if (body.games !== undefined) {
                const keys = codeGames().map(g => g.key);
                const games = expandGames(Array.isArray(body.games) ? body.games.map(String) : []);
                if (games.some(g => !keys.includes(g))) throw new HttpError(400, "That is not a game I track codes for.");
                if (!games.length) throw new HttpError(400, "Keep at least one game ticked, or turn code alerts off.");
                patch.games = games.length === keys.length ? [] : games;
            }
            return { ...db.setAlertSubs(s.userId, patch), allGames: codeGames(), families: codeFamilies() };
        },
        // Sends one sample alert of a kind to the member's own DMs, so they can see how it looks.
        "POST /api/alerts/test": async (req, body) => {
            const s = session(req); userRow(s);
            const p = sampleAlert(String(body?.kind ?? ""), { currency: regionCurrency(userRow(s).region) });
            if (!p) throw new HttpError(400, `Pick one of: ${SAMPLE_KINDS.join(", ")}.`);
            if (!dm) throw new HttpError(503, "Sending messages is not set up here.");
            cooldown(s.userId, "sample");
            try { await dm(s.userId, p); } catch { throw new HttpError(409, "I couldn't send you a DM. Open your DMs for this server's members, then try again."); }
            return { ok: true };
        },
        "GET /api/alerts/history": async (req) => {
            const s = session(req);
            return { alerts: db.listAlerts(s.userId, 100).map(a => ({ at: a.at, kind: a.kind, title: a.title, price: a.price, regular: a.regular, shop: a.shop, via: a.via })) };
        },
        "GET /api/steam": async (req) => {
            const s = session(req);
            const u = userRow(s);
            const link = db.getSteamLink(s.userId);
            if (!link) return { link: null };
            const view = await libraryView(db, itad, u, { snapshot: false });
            return { link, currency: view.currency, stats: playStats(view.rows.filter(r => r.appid)), card: await profileCard(link.steamid) };
        },
        // Look at anyone's PUBLIC Steam profile without linking or storing anything: their card and play stats.
        "GET /api/steam/lookup": async (req, _b, url) => {
            const s = session(req);
            userRow(s);
            const undo = cooldown(s.userId, "steamlookup");
            try {
                const steamid = await resolveProfile(String(url.searchParams.get("profile") ?? ""), steamFetch);
                const [card, games] = await Promise.all([profileCard(steamid), fetchOwnedGames(steamid, { apiKey: config.steamApiKey ?? null, fetchImpl: steamFetch })]);
                const played = games.filter(g => g.minutes > 0), barely = games.filter(g => g.minutes < 60);
                return { card: card ?? { steamid, name: "Steam user " + steamid, avatar: null, url: `https://steamcommunity.com/profiles/${steamid}` }, mine: db.getSteamLink(s.userId)?.steamid === steamid,
                    stats: { games: games.length, playedGames: played.length, totalMinutes: games.reduce((t, g) => t + g.minutes, 0), barely: barely.length,
                        mostPlayed: [...played].sort((a, b) => b.minutes - a.minutes).slice(0, 8).map(g => ({ appid: g.appid, title: g.name || "App " + g.appid, minutes: g.minutes })) } };
            } catch (err) { undo(); throw err; }
        },
        // What to play next from the Steam library. `skip` (comma-separated ids already offered) makes "pick another" fresh.
        // Library analytics: tiles, hours by genre, played vs backlog, most played. Genre tags are fetched a few at a time, so
        // `pending` says how many games are still waiting; the page asks again until it is 0.
        // Discord Linked Roles: show Steam on your Discord profile. The same as /me steam verify.
        "GET /api/steam/linkedroles": async (req) => {
            const s = session(req); userRow(s);
            const p = connectionPayload(db, s.userId);
            return { available: Boolean(config.clientId), verified: Boolean(p?.metadata.steam_verified), preview: p ? { name: p.platform_username, ...p.metadata } : null, url: "/auth/linked" };
        },
        "GET /api/steam/analytics": async (req) => {
            const s = session(req);
            const u = userRow(s);
            if (!db.getSteamLink(s.userId)) throw new HttpError(400, "Sign in through Steam first.");
            cooldown(s.userId, "analytics");
            const need = db.appsNeedingTags(s.userId, 25);
            if (need.length) await refreshTags({ db, appids: need, fetchImpl: steamFetch ?? globalThis.fetch, delayMs: 150 });
            const w = await libraryView(db, itad, u, { snapshot: false });
            return { ...libraryAnalytics(db, s.userId, w.rows), currency: w.currency ?? "USD", pending: db.appsNeedingTags(s.userId, 500).length };
        },
        "GET /api/steam/taste": async (req) => {
            const s = session(req);
            const u = userRow(s);
            if (!db.getSteamLink(s.userId)) throw new HttpError(400, "Link your Steam profile first.");
            cooldown(s.userId, "taste");
            const need = db.appsNeedingTags(s.userId, 10);
            if (need.length) await refreshTags({ db, appids: need, fetchImpl: steamFetch ?? globalThis.fetch, delayMs: 300 });
            const profile = tasteProfile(db, s.userId);
            let picks = [], currency = "USD";
            try { const w = await viewRows(db, itad, u); currency = w.currency ?? "USD"; picks = recommend(db, s.userId, w.rows, profile).map(p => ({ ...p, why: tasteWhy(p) })); } catch { /* optional */ }
            return { ...profile, picks, currency };
        },
        "GET /api/steam/recap": async (req, _body, url) => {
            const s = session(req);
            if (!db.getSteamLink(s.userId)) throw new HttpError(400, "Link your Steam profile first.");
            const year = Number(url.searchParams.get("year")) || new Date().getUTCFullYear();
            if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new HttpError(400, "Pick a year from 2020 on.");
            const all = db.playRecapAll(s.userId);
            const goalHours = db.getHourGoal(s.userId), thisYear = year === new Date(now()).getUTCFullYear();
            const rec = db.playRecap(s.userId, year);
            return { ...rec, goal: goalHours && thisYear ? goalProgress(goalHours, rec.totalMinutes, now()) : null, allTime: { totalMinutes: all.totalMinutes, games: all.games, activeDays: all.activeDays }, since: db.getSteamLink(s.userId).linked_at };
        },
        "POST /api/steam/goal": async (req, body) => {
            const s = session(req);
            if (!db.getSteamLink(s.userId)) throw new HttpError(400, "Link your Steam profile first.");
            const hours = Number(body.hours);
            if (!Number.isInteger(hours) || hours < 0 || hours > 5000) throw new HttpError(400, "Pick a whole number of hours from 1 to 5000 (0 clears it).");
            db.setHourGoal(s.userId, hours);
            return { ok: true };
        },
        "GET /api/steam/next": async (req, _body, url) => {
            const s = session(req);
            const u = userRow(s);
            if (!db.getSteamLink(s.userId)) throw new HttpError(400, "Link your Steam profile first.");
            const skip = String(url.searchParams.get("skip") ?? "").split(",").filter(x => /^[\w-]{1,64}$/.test(x)).slice(0, 200);
            const view = await libraryView(db, itad, u, { snapshot: false });
            return { next: steamNext(view.rows, { skip }), currency: view.currency };
        },
        "POST /api/steam/link": async (req, body) => {
            const s = session(req);
            const undo = cooldown(s.userId, "steam");
            userRow(s);
            try {
                const steamid = String(body.profile ?? "").trim() ? await resolveProfile(String(body.profile), steamFetch) : db.getSteamLink(s.userId)?.steamid ?? (() => { throw new HttpError(400, "Sign in through Steam first."); })();
                return await syncSteamLibrary({ db, itad, userId: s.userId, steamid, apiKey: config.steamApiKey ?? null, fetchImpl: steamFetch });
            } catch (err) { undo(); throw err; }
        },
        "POST /api/steam/sync": async (req) => {
            const s = session(req);
            const undo = cooldown(s.userId, "steam");
            userRow(s);
            const link = db.getSteamLink(s.userId);
            if (!link) { undo(); throw new HttpError(400, "Link your Steam profile first."); }
            try { return await syncSteamLibrary({ db, itad, userId: s.userId, steamid: link.steamid, apiKey: config.steamApiKey ?? null, fetchImpl: steamFetch }); }
            catch (err) { undo(); throw err; }
        },
        "POST /api/steam/unlink": async (req, body) => {
            const s = session(req);
            userRow(s);
            if (!db.removeSteamLink(s.userId)) throw new HttpError(400, "No Steam profile is linked.");
            let removed = 0;
            if (body.removeGames === true) for (const g of db.listLibrary(s.userId).filter(g => g.appid)) if (db.removeLibrary(s.userId, g.itad_id)) removed++;
            return { ok: true, removed };
        },
        // Moderators and owners flag a wishlist game as "up for giveaway soon". It lives in the member's server, so only that server's staff can do it.
        "POST /api/wishlist/soon": async (req, body) => {
            const s = session(req);
            const owner = db.getProfileBySlug(String(body.slug ?? "").toLowerCase());
            if (!owner || !owner.profile_public || !owner.guild_id) throw new HttpError(404, "That page does not exist or is private.");
            const g = s.guilds.find(x => x.id === owner.guild_id);
            if (!isStaff(g) || isHidden(owner.guild_id)) throw new HttpError(403, "Only moderators and owners of this member's server can do that.");
            const id = String(body.id ?? "");
            const item = db.listItems(owner.discord_id).find(i => i.itad_id === id && i.source !== "watch");
            if (!item) throw new HttpError(404, "That game is not on this list.");
            if (body.on === false) { db.unmarkSoon(owner.guild_id, id); return { soon: false }; }
            const r = db.markSoon(owner.guild_id, { itad_id: id, title: item.title, art: artUrl(item) ?? null }, s.userId);
            if (r === "full") throw new HttpError(429, "You can mark up to 50 games as up for giveaway. Remove one first.");
            return { soon: true };
        },
        "GET /api/saleprep": async (req, _b, url) => {
            const s = session(req);
            cooldown(s.userId, "saleprep");
            const budget = Number(url.searchParams.get("budget"));
            return await salePrep({ db, itad, user: userRow(s), budget: Number.isFinite(budget) && budget > 0 && budget <= 10_000 ? budget : null });
        },
        "GET /api/saleprep/recap": async (req, _b, url) => {
            const s = session(req);
            const days = Math.min(90, Math.max(1, Math.round(Number(url.searchParams.get("days"))) || 14));
            return saleRecap(db, s.userId, { days });
        },
    };
}

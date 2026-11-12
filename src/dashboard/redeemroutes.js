// Key redeeming, the extension bridge, codes, promos and bundles.
// server.js passes in the helpers it already has (ctx) and merges these routes into its table.
import { BUNDLE_STORES } from "../bundlefeedsource.js";
import { EXTENSION_LATEST, EXTENSION_STORE_URL } from "../constants.js";
import { HttpError } from "./http.js";
import { bundleCheck } from "../bundle.js";
import { bundleFeedView } from "../bundlefeed.js";
import { codeFamilies, codeGames, codeView } from "../codes.js";
import { dropView } from "../drops.js";
import { expandGames } from "../codesource.js";
import { extractKeys } from "../redeemstore.js";
import { summarize } from "../report.js";

export function createRedeemRoutes(ctx) {
    const { botGuilds, codes, cooldown, db, dm, isOwner, itad, now, session, userRow } = ctx;
    return {
        // The extension asks this (no sign-in, nothing sent about the person) to remind its users to update.
        "GET /api/extension/latest": async () => ({ latest: process.env.EXTENSION_LATEST || EXTENSION_LATEST, url: process.env.EXTENSION_STORE_URL || EXTENSION_STORE_URL }),
        // ----- game codes (SHiFT and the like) -----
        "GET /api/codes": async (req, _b, url) => {
            session(req);
            const game = url.searchParams.get("game") || null;
            const wanted = game ? expandGames([game]) : null; // the Borderlands entry stands for all six
            if (wanted && !wanted.every(k => codeGames().some(g => g.key === k))) throw new HttpError(400, "Unknown game.");
            const status = url.searchParams.get("status") === "expired" ? "expired" : "active";
            const at = now();
            db.expireDue(at); // anything that ended since the last poll should not show as working
            return { games: codeGames(), families: codeFamilies(), status, codes: db.listCodes({ status, game: wanted, limit: 100 }).map(c => codeView(c, at)), counts: db.codeCounts() };
        },
        "GET /api/bundlefeed": async (req, _b, url) => {
            session(req);
            const store = url.searchParams.get("store") || null;
            if (store && !BUNDLE_STORES[store]) throw new HttpError(400, "Unknown store.");
            const status = url.searchParams.get("status") === "expired" ? "expired" : "active";
            db.expireDueBundles(now()); // anything that ended since the last poll should not show as live
            return { status, stores: Object.entries(BUNDLE_STORES).map(([key, v]) => ({ key, name: v.name })), bundles: db.listFeedBundles({ status, stores: store ? [store] : null, limit: 100 }).map(bundleFeedView), counts: db.bundleFeedCounts() };
        },
        "POST /api/codes/retire": async (req, body) => {
            const s = session(req);
            if (!isOwner(s)) throw new HttpError(403, "Only the bot owner can do this.");
            const c = db.getCode(Number(body.id));
            if (!c) throw new HttpError(404, "No such code.");
            db.setCodeStatus(c.id, "expired");
            codes?.poll?.().catch(() => {}); // edits the posts to show it ended
            return { id: c.id, status: "expired" };
        },
        // giveaway and code news the bot spotted, plus drops added in the member's own servers
        "GET /api/promos": async (req) => {
            const s = session(req);
            const at = now();
            db.expireDrops(at);
            const mine = s.guilds.filter(g => !botGuilds || botGuilds(g.id));
            const drops = mine.flatMap(g => db.listDrops(g.id, { status: "active", limit: 10 }).map(d => ({ ...dropView(d, at), server: g.name })));
            return { news: db.listNews(30).map(n => ({ id: n.id, source: n.source, kind: n.kind, title: n.title, url: n.url, summary: n.summary, seenAt: n.seen_at })), drops: drops.filter(d => d.status === "active") };
        },
        "GET /api/redeem": async (req) => {
            const s = session(req);
            db.pruneRedeemJobs();
            return { job: db.pendingRedeemJob(s.userId) };
        },
        "GET /api/redeem/history": async (req) => {
            const s = session(req);
            const entries = db.redeemHistory(s.userId, 100);
            const count = st => entries.filter(e => e.status === st).length;
            return { entries, counts: { redeemed: count("redeemed"), owned: count("owned"), used: count("used"), invalid: count("invalid") } };
        },
        "POST /api/redeem/check": async (req, body) => {
            // Which pasted keys were already redeemed here, so the page can skip them instead of spending a Steam attempt.
            const s = session(req);
            const keys = extractKeys((Array.isArray(body.keys) ? body.keys : []).slice(0, 500).join("\n"));
            return { known: Object.fromEntries(db.knownRedeems(s.userId, keys)) };
        },
        "POST /api/redeem/log": async (req, body) => {
            // A batch run straight from the page: remember how the keys ended up (hashes only).
            const s = session(req);
            const results = (Array.isArray(body.results) ? body.results : []).slice(0, 500).map(r => ({ key: String(r?.key ?? ""), status: String(r?.status ?? ""), game: String(r?.game ?? "").slice(0, 100) }));
            return { logged: db.logRedeem(s.userId, results) };
        },
        "POST /api/redeem/history/clear": async (req) => {
            const s = session(req);
            return { cleared: db.clearRedeemHistory(s.userId) };
        },
        "POST /api/redeem/finish": async (req, body) => {
            // The page reports what the extension did with a batch that was queued by /games redeem. Results go back to the member's Discord DMs.
            const s = session(req);
            const job = db.pendingRedeemJob(s.userId);
            if (body.cancel) { db.cancelRedeemJob(s.userId); return { ok: true }; }
            if (!job || job.id !== Number(body.id)) throw new HttpError(404, "That batch is no longer waiting.");
            const mine = new Set(job.keys);
            const results = (Array.isArray(body.results) ? body.results : []).slice(0, 500)
                .map(r => ({ key: String(r?.key ?? "").toUpperCase(), status: String(r?.status ?? "error").slice(0, 20), game: String(r?.game ?? "").slice(0, 100), message: String(r?.message ?? "").slice(0, 120) }))
                .filter(r => mine.has(r.key));
            const count = (...st) => results.filter(r => st.includes(r.status)).length;
            const failed = results.filter(r => !["redeemed", "owned", "used"].includes(r.status));
            const left = job.keys.length - results.length;
            const summary = `${count("redeemed")} redeemed, ${count("owned", "used")} already owned or used, ${failed.length} failed${left > 0 ? `, ${left} not tried` : ""}`;
            const aborted = String(body.aborted ?? "").slice(0, 160);
            const lines = [`Your batch redeem finished: **${summary}.**`];
            if (aborted) lines.push(`⚠️ ${aborted}`);
            const done = results.filter(r => r.status === "redeemed");
            if (done.length) lines.push("", "**Redeemed**", ...done.slice(0, 25).map(r => `• ${r.game || "Unnamed product"} (\`${r.key.slice(0, 5)}-•••••-${r.key.slice(-5)}\`)`));
            if (failed.length) lines.push("", "**Failed** (still yours to retry)", ...failed.slice(0, 25).map(r => `• \`${r.key}\` ${r.message || r.status}`));
            if (left > 0) lines.push("", `**${left}** key${left === 1 ? "" : "s"} were not tried. Send them again with /games redeem.`);
            db.logRedeem(s.userId, results);
            if (!db.finishRedeemJob(s.userId, job.id, summary)) throw new HttpError(404, "That batch is no longer waiting.");
            const text = lines.join("\n").slice(0, 3900);
            try { db.addNotification(s.userId, { type: "redeem", title: "Batch redeem finished", body: summary, url: "#/redeem" }); } catch { /* the DM is what counts */ }
            let sent = false;
            if (dm) { try { await dm(s.userId, { embeds: [{ color: 0x57f287, title: "Batch redeem", description: text }] }); sent = true; } catch { /* DMs closed: it is in Notifications */ } }
            return { ok: true, summary, dm: sent };
        },
        // The key vault shows titles only: what the unredeemed games are worth right now. Keys never come here.
        "POST /api/vault/value": async (req, body) => {
            const s = session(req);
            cooldown(s.userId, "value");
            const u = userRow(s);
            const titles = [...new Set((Array.isArray(body.titles) ? body.titles : []).map(t => String(t ?? "").trim().slice(0, 150)).filter(Boolean))].slice(0, 150);
            if (!titles.length) throw new HttpError(400, "No titles.");
            const looked = (await itad.lookupTitles(titles)).filter(r => r.id);
            const prices = looked.length ? await itad.getPrices(looked.map(r => r.id), u.region) : new Map();
            let total = 0, currency = null;
            const rows = looked.map(r => {
                const sum = summarize(prices.get(r.id), { majorOnly: u.stores === "major" });
                currency ??= sum.currency;
                const price = sum.best?.price ?? sum.steam ?? null;
                if (price !== null) total += sum.msrp && sum.msrp > price ? sum.msrp : price;
                return { title: r.title, msrp: sum.msrp, price };
            });
            const nowTotal = rows.reduce((a, r) => a + (r.price ?? 0), 0);
            return { currency: currency ?? "USD", fullPrice: Math.round(total * 100) / 100, cheapestNow: Math.round(nowTotal * 100) / 100, matched: rows.length, unmatched: titles.length - rows.length };
        },
        "GET /api/grabber": async (req) => {
            const s = session(req);
            userRow(s);
            return { link: db.getGrabberLink(s.userId) };
        },
        // Makes (or replaces) the link code the FanaticalGrabber extension uses. The code is returned once and never stored readable.
        "POST /api/grabber/token": async (req, body) => {
            const s = session(req);
            cooldown(s.userId, "grabbertoken");
            userRow(s);
            if (body.action === "off") return { ok: true, removed: db.revokeGrabberToken(s.userId) };
            return { token: db.createGrabberToken(s.userId) };
        },
        "GET /api/bundles": async (req, _b, url) => {
            const s = session(req);
            cooldown(s.userId, "bundles");
            const u = userRow(s);
            const title = String(url.searchParams.get("game") ?? "").trim().slice(0, 100);
            let gameIds;
            if (title) {
                const [hit] = await itad.lookupTitles([title]);
                if (!hit?.id) throw new HttpError(400, `I could not find a game called ${title}.`);
                gameIds = [hit.id];
            } else gameIds = db.listItems(s.userId).map(i => i.itad_id);
            return await bundleCheck({ db, itad, user: u, gameIds });
        },
    };
}

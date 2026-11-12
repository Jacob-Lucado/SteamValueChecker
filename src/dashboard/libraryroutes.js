// The game library's API.
// server.js passes in the helpers it already has (ctx) and merges these routes into its table.
import { HttpError } from "./http.js";
import { MAX_GOAL, challengeView, monthKey } from "../challenge.js";
import { MAX_UPLOAD_CHARS } from "../value.js";
import { UserError } from "../errors.js";
import { addBundle, bundleView } from "../bundles.js";
import { importLibrary, libraryView, playNext } from "../library.js";
import { newsForUser } from "../news.js";
import { parseUpload, sanitize } from "../parse.js";
import { regionCurrency, spendSummary } from "../spend.js";
import { trophyCase } from "../badges.js";

export function createLibraryRoutes(ctx) {
    const { cooldown, db, getNews, itad, num, session, userRow } = ctx;
    return {
        // ----- library -----
        "GET /api/library": async (req) => {
            const s = session(req);
            const u = userRow(s);
            const v = await libraryView(db, itad, u);
            const tags = db.getAppTags(v.rows.map(r => r.appid).filter(Boolean)); // Steam's public genres, for the card view's tags and filter
            for (const r of v.rows) r.genres = (tags.get(r.appid)?.genres ?? []).slice(0, 4);
            return v;
        },
        "POST /api/library/add": async (req, body) => {
            const s = session(req);
            cooldown(s.userId, "lib");
            userRow(s);
            const paid = num(body.paid);
            if (paid !== null && !(Number.isFinite(paid) && paid >= 0 && paid <= 10_000)) throw new HttpError(400, "Paid must be a number from 0 to 10,000.");
            const r = await importLibrary(db, itad, s.userId, [{ title: String(body.title ?? ""), paid }]);
            if (r.notFound.length) throw new HttpError(400, `I could not find a game called ${r.notFound[0]}.`);
            if (r.skippedForLimit) throw new HttpError(400, "Your library is full (1,500 games).");
            return r;
        },
        "POST /api/library/import": async (req, body) => {
            const s = session(req);
            cooldown(s.userId, "lib");
            userRow(s);
            let entries = [];
            if (body.file && typeof body.file === "object") {
                const name = String(body.file.name ?? "");
                if (!/\.(csv|json|txt|md)$/i.test(name)) throw new HttpError(400, "Unsupported file type. Use a .csv, .json, .txt or .md export.");
                const text = String(body.file.text ?? "");
                if (text.length > MAX_UPLOAD_CHARS) throw new HttpError(400, "That file is too large (200 KB max).");
                entries = parseUpload(text, name.toLowerCase());
            } else if (Array.isArray(body.entries)) {
                entries = body.entries.slice(0, 500).map(e => ({ title: String(e?.title ?? ""), paid: Number.isFinite(Number(e?.paid)) && e?.paid !== null && e?.paid !== "" ? Number(e.paid) : null }));
            }
            const clean = sanitize(entries, { max: 500 }).entries;
            if (!clean.length) throw new HttpError(400, "I need game titles, not keys.");
            return await importLibrary(db, itad, s.userId, clean);
        },
        "GET /api/library/spend": async (req) => { const s = session(req); const u = userRow(s); return spendSummary(db.listLibrary(s.userId), { currency: regionCurrency(u.region) }); },
        "GET /api/library/news": async (req) => {
            const s = session(req); cooldown(s.userId, "libnews");
            const { known, posts } = await newsForUser(db, getNews(), s.userId, { limit: 12 });
            return { known, posts: posts.map(p => ({ gid: p.gid, game: p.gameTitle, appid: p.appid, title: p.title, summary: p.summary, patch: p.patch, date: p.date, url: p.url, image: p.image })) };
        },
        "GET /api/library/bundles": async (req) => { const s = session(req); return await bundleView(db, itad, userRow(s)); },
        "POST /api/library/bundle": async (req, body) => {
            const s = session(req);
            cooldown(s.userId, "lib");
            userRow(s);
            try { return await addBundle(db, itad, s.userId, { name: body.name, paid: Number(body.paid), titles: body.titles }); }
            catch (e) { if (e instanceof UserError) throw new HttpError(400, e.message); throw e; }
        },
        "POST /api/library/bundle/remove": async (req, body) => {
            const s = session(req);
            if (!db.removeBundle(s.userId, Number(body.id))) throw new HttpError(404, "That bundle is not in your tracker.");
            return { ok: true };
        },
        "GET /api/library/badges": async (req) => { const s = session(req); userRow(s); return trophyCase(db, s.userId); },
        "GET /api/library/challenge": async (req) => { const s = session(req); return challengeView(db, s.userId); },
        "POST /api/library/challenge": async (req, body) => {
            const s = session(req);
            const goal = Number(body.goal);
            if (!Number.isInteger(goal) || goal < 0 || goal > MAX_GOAL) throw new HttpError(400, `Pick a goal from 0 to ${MAX_GOAL}.`);
            userRow(s);
            db.setChallenge(s.userId, monthKey(Date.now()), goal);
            return challengeView(db, s.userId);
        },
        "POST /api/library/status": async (req, body) => {
            const s = session(req);
            const lib = db.listLibrary(s.userId);
            if (Array.isArray(body.itad_ids)) {
                // Many games at once (the Library page's selection). Unknown ids are ignored.
                const mine = new Set(lib.map(i => i.itad_id));
                const ids = [...new Set(body.itad_ids.map(String))].filter(id => mine.has(id)).slice(0, 1500);
                if (!ids.length) throw new HttpError(400, "Select some games first.");
                let updated = 0;
                for (const id of ids) {
                    if (!db.setLibraryStatus(s.userId, id, String(body.status))) throw new HttpError(400, "Pick backlog, playing, played, finished or dropped.");
                    updated++;
                }
                return { updated, status: body.status };
            }
            const item = lib.find(i => i.itad_id === body.itad_id);
            if (!item) throw new HttpError(404, "That game is not in your library.");
            if (!db.setLibraryStatus(s.userId, item.itad_id, String(body.status))) throw new HttpError(400, "Pick backlog, playing, played, finished or dropped.");
            return { title: item.title, status: body.status };
        },
        "GET /api/library/next": async (req, _body, url) => {
            const s = session(req);
            const skip = String(url.searchParams.get("skip") ?? "").split(",").filter(x => /^[\w-]{1,64}$/.test(x)).slice(0, 500);
            const view = await libraryView(db, itad, userRow(s), { snapshot: false });
            const n = playNext(view.rows, { skip });
            return { next: n ? { pick: n.pick, others: n.others, why: n.why, remaining: n.remaining } : null, totals: view.totals, currency: view.currency };
        },
        "POST /api/library/remove": async (req, body) => {
            const s = session(req);
            const item = db.listLibrary(s.userId).find(i => i.itad_id === body.itad_id);
            if (!item) throw new HttpError(404, "That game is not in your library.");
            db.removeLibrary(s.userId, item.itad_id);
            return { removed: item.title };
        },
    };
}

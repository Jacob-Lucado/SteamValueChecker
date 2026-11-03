// The dashboard's Playtests page: every playtest, beta, demo and free weekend the bot can see right now.
// Two sources, the same ones the alerts use: the Steam announcements of games on the member's wishlist or in their
// library, and the Alpha Beta Gamer site, which lists games Steam news never mentions.
import { classifyPost, PLAYTEST_KINDS } from "./playtests.js";
import { sameGame } from "./abgfeed.js";
import { safeUrl } from "./render.js";

const WINDOW_MS = 45 * 86400_000;
const ABG_LABEL = { signup: "Sign-up", playtest: "Playtest", demo: "Demo", alpha: "Alpha", beta: "Beta" };
const ABG_FILTER = { signup: "playtest", playtest: "playtest", demo: "demo", alpha: "beta", beta: "beta" };

/** What to show: [{ id, source, kind, label, game, title, url, date, image, summary, wishlist, owned }], newest first. */
export async function playtestBoard({ db, news = null, abg = null, userId, now = Date.now(), log = () => {} }) {
    const since = now - WINDOW_MS, items = [], sources = { steam: false, abg: false };
    const owned = new Set(db.listLibrary(userId).map(l => l.itad_id));
    const wish = db.listItems(userId).filter(i => i.source !== "watch");
    const wishNames = wish.map(i => i.title);
    const isWished = name => wishNames.some(n => sameGame(n, name));
    const lib = db.listLibrary(userId);
    const isOwned = (name, itad) => (itad && owned.has(itad)) || lib.some(l => sameGame(l.title, name));

    if (abg) {
        try {
            const wishApps = new Set(wish.map(i => i.appid).filter(Number.isInteger));
            for (const x of (await abg.latest()).filter(p => p.date >= since)) {
                if (x.wishlistOnly && !(isWished(x.game) || wishApps.has(x.appid))) continue; // the Steam demo list is only for wishlist games
                const kind = ABG_FILTER[x.kind] ?? "beta";
                items.push({ id: "abg:" + x.id, source: x.sourceName ?? "Alpha Beta Gamer", kind, label: x.label ?? ABG_LABEL[x.kind] ?? "Beta", game: x.game, title: x.type ? `${x.game} – ${x.type}` : x.game, url: safeUrl(x.url), date: x.date, image: safeUrl(x.image) ? x.image : null, summary: x.summary, wishlist: isWished(x.game) || wishApps.has(x.appid), owned: isOwned(x.game) });
            }
            sources.abg = true;
        } catch (err) { log(`playtest board: alpha beta gamer ${err.code ?? err.name}`); }
    }
    if (news) {
        const apps = new Map();
        for (const it of wish.filter(i => Number.isInteger(i.appid)).slice(0, 80)) apps.set(it.appid, { title: it.title, wishlist: true, owned: owned.has(it.itad_id) });
        for (const l of lib.filter(l => Number.isInteger(l.appid)).sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0)).slice(0, 40)) if (!apps.has(l.appid)) apps.set(l.appid, { title: l.title, wishlist: false, owned: true });
        if (apps.size) {
            try {
                const feed = await news.forApps([...apps.keys()]);
                for (const [appid, meta] of apps) for (const p of feed.get(appid) ?? []) {
                    const kind = classifyPost(p);
                    if (!kind || p.date < since || !safeUrl(p.url)) continue;
                    // A game already listed from the site with a post this close in time is the same announcement.
                    if (items.some(x => sameGame(x.game, meta.title) && Math.abs(x.date - p.date) < 5 * 86400_000 && x.kind === (kind === "weekend" ? "weekend" : kind))) continue;
                    items.push({ id: "steam:" + p.gid, source: "Steam news", kind, label: PLAYTEST_KINDS[kind].label, game: meta.title, title: p.title, url: safeUrl(p.url), date: p.date, image: safeUrl(p.image) ? p.image : `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`, summary: p.summary ?? "", wishlist: meta.wishlist, owned: meta.owned });
                }
                sources.steam = true;
            } catch (err) { log(`playtest board: steam news ${err.code ?? err.name}`); }
        }
    }
    items.sort((a, b) => b.date - a.date);
    return { items: items.slice(0, 120), sources, updated: now, watching: wish.length };
}

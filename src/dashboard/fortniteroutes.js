// Fortnite shop and stats.
// server.js passes in the helpers it already has (ctx) and merges these routes into its table.
import { HttpError } from "./http.js";

export function createFortniteRoutes(ctx) {
    const { clientIp, fnSvc, fortniteCall, fortniteLimit, ticketRoutes } = ctx;
    return {
        // One Steam game's public details, or a name search. No sign-in (the tools use it), so it is limited by address.
        "GET /api/fortnite/shop": async req => { if (!fortniteLimit.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little and try again in a minute."); return fortniteCall(() => fnSvc.shop()); },
        "GET /api/fortnite/news": async req => { if (!fortniteLimit.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little and try again in a minute."); return fortniteCall(() => fnSvc.news()); },
        "GET /api/fortnite/map": async req => { if (!fortniteLimit.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little and try again in a minute."); return fortniteCall(() => fnSvc.map()); },
        "GET /api/fortnite/new": async req => { if (!fortniteLimit.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little and try again in a minute."); return fortniteCall(() => fnSvc.fresh()); },
        "GET /api/fortnite/status": async () => ({ ...(await fnSvc.status()), stats: Boolean(fnSvc.hasStats), creatorCode: fnSvc.creatorCode || "" }),
        "GET /api/fortnite/creator": async (req, _b, url) => { if (!fortniteLimit.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little and try again in a minute."); return fortniteCall(() => fnSvc.creator(url.searchParams.get("code"))); },
        "GET /api/fortnite/search": async (req, _b, url) => { if (!fortniteLimit.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little and try again in a minute."); return { items: await fortniteCall(() => fnSvc.search(url.searchParams.get("q"))) }; },
        "GET /api/fortnite/stats": async (req, _b, url) => { if (!fortniteLimit.hit(clientIp(req)).ok) throw new HttpError(429, "Slow down a little and try again in a minute."); return fortniteCall(() => fnSvc.stats(url.searchParams.get("name"), url.searchParams.get("platform") || "epic")); },
        ...ticketRoutes,
    };
}

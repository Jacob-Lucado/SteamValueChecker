// The price facts for one Steam game, gathered the same way for the public game page and for the bot's link replies.

import { summarize } from "./report.js";
import { buyOrWait } from "./advice.js";
import { upcomingSales, salesBefore } from "./salescal.js";

const MAX_HISTORY_POINTS = 180;

/** Everything about one Steam app's price, or null when IsThereAnyDeal does not know it. Never throws. */
export async function loadGameData(itad, appid, { country = "US", now = Date.now() } = {}) {
    try {
        const id = (await itad.lookupShopIds(61, [`app/${appid}`])).get(`app/${appid}`);
        if (!id) return null;
        const info = await itad.getTitle(id);
        if (!info?.title) return null;
        const [prices, history] = await Promise.all([itad.getPrices([id], country).catch(() => new Map()), itad.getHistory(id, country).catch(() => [])]);
        const sum = summarize(prices.get(id), {});
        const cur = sum.currency || "USD", fmt = n => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(n); } catch { return String(n); } };
        const price = sum.best?.price ?? null, step = Math.max(1, Math.ceil(history.length / MAX_HISTORY_POINTS));
        return {
            title: info.title, appid, itadId: id, currency: cur, price, shop: sum.best?.shop ?? null, shopUrl: /^https:\/\//i.test(sum.best?.url ?? "") ? sum.best.url : null,
            msrp: sum.msrp, low1y: sum.low1y, atl: sum.atl, image: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`,
            points: history.filter((_, i) => i % step === 0 || i === history.length - 1).map(p => ({ t: p.t, price: p.price })),
            advice: price !== null ? buyOrWait(history, price, { now, sales: upcomingSales(now), past: salesBefore(), money: fmt }) : null
        };
    } catch { return null; }
}

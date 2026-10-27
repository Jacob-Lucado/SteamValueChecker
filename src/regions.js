// One game's cheapest price in several regions, converted to US dollars so they can be ranked.
import { summarize } from "./report.js";
import { REGIONS } from "./constants.js";

const POPULAR = ["US", "GB", "DE", "CA", "AU", "BR", "IN", "TR", "AR", "PL", "JP", "MX"];

/** Rows { region, name, currency, price, shop, url, usd, home }, cheapest first (unconverted ones last). */
export async function regionPrices({ itad, fx = null, itadId, home = "US", majorOnly = false }) {
    const codes = [...new Set([home, ...POPULAR])].filter(c => REGIONS.some(r => r.value === c)).slice(0, 12);
    const rows = [];
    let failed = 0;
    for (const code of codes) {
        try {
            const prices = await itad.getPrices([itadId], code);
            const s = summarize(prices.get(itadId), { majorOnly });
            if (!s.best || !s.currency) continue;
            const usd = fx ? await fx.toUsd(s.best.price, s.currency) : null;
            rows.push({ region: code, name: REGIONS.find(r => r.value === code).name, currency: s.currency, price: s.best.price, shop: s.best.shop, url: s.best.url, usd, home: code === home });
        } catch { failed++; }
    }
    if (!rows.length && failed) throw new Error("Prices are unavailable right now. Try again in a moment.");
    return rows.sort((a, b) => (a.usd ?? Infinity) - (b.usd ?? Infinity));
}

// Currency conversion for comparing prices across regions. Rates come from the free Frankfurter service (European Central Bank
// data) and are cached for 12 hours. Without rates, conversions return null and prices are shown in their own currency only.
export function createFx({ fetchImpl = globalThis.fetch, now = () => Date.now(), ttlMs = 12 * 3600_000 } = {}) {
    let cache = null;
    async function rates() {
        if (cache && now() - cache.t < ttlMs) return cache.rates;
        try {
            const res = await fetchImpl("https://api.frankfurter.dev/v1/latest?base=USD", { signal: AbortSignal.timeout(8000) });
            if (!res.ok) throw new Error("rates unavailable");
            const d = await res.json();
            if (d?.rates && typeof d.rates === "object") cache = { t: now(), rates: { ...d.rates, USD: 1 } };
        } catch { cache = cache ? { t: now() - ttlMs + 10 * 60_000, rates: cache.rates } : null; } // keep old rates, try again in 10 minutes
        return cache?.rates ?? null;
    }
    return { /** Amount in a currency -> US dollars, or null when the rate is unknown. */
        async toUsd(amount, currency) { const r = await rates(); const rate = Number(r?.[currency]); return rate > 0 && Number.isFinite(amount) ? amount / rate : null; } };
}

// Console store prices for one game, read from the public store feeds of Xbox and Nintendo. PlayStation has no open feed, so it gets a search link.
// Nothing here is stored: each lookup asks the store and shows the answer.

const UA = { "User-Agent": "SteamValueChecker/1.0 (+price lookup)", "Accept": "application/json" };
const j = async (url, fetchFn) => {
    const res = await fetchFn(url, { headers: UA, signal: AbortSignal.timeout?.(9000) });
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
    return res.json();
};
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/** Xbox: find the game, then read its price in this country. */
export async function xboxPrice(title, country = "US", fetchFn = globalThis.fetch) {
    const lang = "en-" + country;
    const found = await j(`https://www.microsoft.com/msstoreapiprod/api/autosuggest?market=${lang}&clientId=7F27B536-CF6B-4C65-8638-A0F8CBDFCA65&sources=DCatAll-Products&filter=+ClientType:StoreWeb&counts=6&query=${encodeURIComponent(title)}`, fetchFn);
    const hit = (found?.ResultSets ?? []).flatMap(r => r.Suggests ?? []).find(s => s.Source === "Game" && s.Metas?.some(m => m.Key === "BigCatalogId"));
    if (!hit) return null;
    const id = hit.Metas.find(m => m.Key === "BigCatalogId").Value;
    const cat = await j(`https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${encodeURIComponent(id)}&market=${country}&languages=en-US`, fetchFn);
    const p = cat?.Products?.[0];
    if (!p) return null;
    let best = null;
    for (const sku of p.DisplaySkuAvailabilities ?? []) for (const av of sku.Availabilities ?? []) {
        const price = av.OrderManagementData?.Price, list = num(price?.ListPrice), msrp = num(price?.MSRP);
        if (!(list > 0) || !(av.Actions ?? []).includes("Purchase")) continue;
        if (!best || list < best.price) best = { price: list, regular: msrp && msrp >= list ? msrp : list, currency: price.CurrencyCode ?? null, endsAt: av.Conditions?.EndDate ? Date.parse(av.Conditions.EndDate) : null };
    }
    const title_ = p.LocalizedProperties?.[0]?.ProductTitle ?? hit.Title;
    if (!best) return { store: "Xbox", title: title_, price: null, url: `https://www.xbox.com/games/store/-/${id}` };
    return { store: "Xbox", title: title_, ...best, url: `https://www.xbox.com/games/store/-/${id}` };
}

/** Nintendo eShop: Nintendo's search feed gives the game's id, its price feed gives the price in this country. */
export async function switchPrice(title, country = "US", fetchFn = globalThis.fetch) {
    const found = await j(`https://searching.nintendo-europe.com/en/select?q=${encodeURIComponent(title)}&fq=type:GAME&rows=5&wt=json`, fetchFn);
    const doc = (found?.response?.docs ?? []).find(d => d.nsuid_txt?.length);
    if (!doc) return null;
    const id = doc.nsuid_txt[0];
    const res = await j(`https://api.ec.nintendo.com/v1/price?country=${country}&lang=en&ids=${encodeURIComponent(id)}`, fetchFn);
    const p = res?.prices?.[0];
    const url = doc.url ? `https://www.nintendo.com${doc.url}` : null;
    // Nintendo's search feed knows the European ids. Where a country uses a different id set (the US, for one) the price comes back "not found",
    // so say so and point at the store's own search instead of guessing.
    if (!p || p.sales_status === "not_found" || !p.regular_price) return { store: "Nintendo eShop", title: doc.title, price: null, url: country === "US" ? `https://www.nintendo.com/us/search/#q=${encodeURIComponent(title)}&cat=gme` : url };
    const regular = num(p.regular_price.raw_value), sale = num(p.discount_price?.raw_value);
    return { store: "Nintendo eShop", title: doc.title, price: sale ?? regular, regular, currency: p.regular_price.currency ?? null, endsAt: p.discount_price?.end_datetime ? Date.parse(p.discount_price.end_datetime) : null, url };
}

export const playstationSearchUrl = title => `https://store.playstation.com/search/${encodeURIComponent(title)}`;

/** Both stores at once. One being down never hides the other. */
export async function consolePrices({ title, country = "US", fetchFn = globalThis.fetch }) {
    const [x, s] = await Promise.allSettled([xboxPrice(title, country, fetchFn), switchPrice(title, country, fetchFn)]);
    return {
        xbox: x.status === "fulfilled" ? x.value : null, xboxError: x.status === "rejected",
        nintendo: s.status === "fulfilled" ? s.value : null, nintendoError: s.status === "rejected",
        playstation: playstationSearchUrl(title)
    };
}

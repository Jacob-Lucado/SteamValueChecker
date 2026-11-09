// Every link the bot posts to a deal can go through a page on the site first: it shows the deal, counts the visit, then sends the person
// on to the store. This is the one place that decides it. Until index.js sets it up (and in tests), links just go straight to the store.
let cfg = null;

/** `make(deal)` returns the page address for a free game or bundle, or null. `base` is the site's address, for bundle-feed pages. */
export function configureDeals(next) { cfg = next; }

/** The address to put in a post for a deal: { key, kind, title, shop, url, image, price, games, blurb, expiry }. Falls back to the store's own link. */
export function dealUrl(deal) {
    try { return cfg?.make?.(deal) || deal.url; } catch { return deal.url; }
}
/** The page for a bundle from the feed, or null when there's no site address to put on it. */
export function bundlePageUrl(id) {
    return cfg?.base && id ? `${String(cfg.base).replace(/\/+$/, "")}/b/${id}` : null;
}

// ---- every outgoing message ----
// Anything the bot sends that points at a store (an embed's title link, a link button, a link written into the text) is sent through the site's
// page for it first. The page shows what was clicked, counts the visit, then forwards the person. Links to our own site, Discord and anything that
// isn't a storefront are left alone.
const STORE_HOST = /(^|\.)(store\.steampowered\.com|epicgames\.com|gog\.com|humblebundle\.com|fanatical\.com|indiegala\.com|greenmangaming\.com|itch\.io|luna\.amazon\.com|gaming\.amazon\.com|primegaming\.com|ubisoft\.com|ea\.com|origin\.com|battle\.net|xbox\.com|microsoft\.com|playstation\.com|nintendo\.com|g2a\.com|gamesplanet\.com|wingamestore\.com|voidu\.com|cdkeys\.com|eneba\.com|instant-gaming\.com|steamgifts\.com)$/i;
// IsThereAnyDeal's own redirect links are how most sale alerts reach a store, so they count as store links too (its info pages don't)
const isStore = u => { try { const x = new URL(u); return x.protocol === "https:" && (STORE_HOST.test(x.hostname) || x.hostname === "itad.link" || (/(^|\.)isthereanydeal\.com$/i.test(x.hostname) && /^\/(url|redirect|link)\b/.test(x.pathname))); } catch { return false; } };
const plain = t => String(t ?? "").replace(/<[^>]+>/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_~`>#|]/g, "").replace(/\s+/g, " ").trim();
const shopOf = u => { try { if (/itad\.link|isthereanydeal/i.test(new URL(u).hostname)) return null; const h = new URL(u).hostname.replace(/^(www|store)\./, ""); return h.includes("steampowered") ? "Steam" : h.includes("epicgames") ? "Epic Games" : h.includes("gog") ? "GOG" : h.includes("humble") ? "Humble" : h.includes("fanatical") ? "Fanatical" : h.includes("indiegala") ? "IndieGala" : h.includes("itch") ? "itch.io" : h.includes("amazon") || h.includes("primegaming") ? "Amazon Luna" : h.split(".")[0].replace(/^./, c => c.toUpperCase()); } catch { return null; } };
const steamPic = u => { const m = String(u).match(/store\.steampowered\.com\/(?:app|agecheck\/app)\/(\d{1,10})/); return m ? `https://cdn.akamai.steamstatic.com/steam/apps/${m[1]}/header.jpg` : null; };

function pageFor(url, { title, image, text, price, shop } = {}) {
    if (!cfg?.make || !isStore(url)) return url;
    const t = plain(title) || shopOf(url) || "Deal";
    const named = String(text ?? "").match(/\bat \*\*([^*\n]{2,40})\*\*/)?.[1]; // "$2.84 at **Fanatical**"
    return dealUrl({ key: `url:${url.slice(0, 190)}`, kind: "deal", title: t, shop: shop ?? shopOf(url) ?? named ?? null, url, image: image ?? steamPic(url), price: price ?? null, blurb: plain(text).slice(0, 280) || null });
}

/** Returns the payload with every store link swapped for its page on the site. Doesn't change the original. */
export function linkPayload(payload) {
    if (!cfg?.make || !payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
    let out = payload;
    const cache = new Map(); // one page per link, whatever the message
    const go = (url, info) => { if (!isStore(url)) return url; if (!cache.has(url)) cache.set(url, pageFor(url, info)); return cache.get(url); };
    if (Array.isArray(out.embeds) && out.embeds.length) {
        const embeds = out.embeds.map(e => typeof e?.toJSON === "function" ? e.toJSON() : e);
        const byUrl = new Map(); // so a button can show what its card shows
        for (const e of embeds) if (e?.url && isStore(e.url)) byUrl.set(e.url, { title: String(e.title ?? "").replace(/^\S*\s*/u, m => /\p{Extended_Pictographic}/u.test(m) ? "" : m) || e.title, image: e.image?.url ?? e.thumbnail?.url, text: e.description, price: e.fields?.find(f => /price/i.test(f.name))?.value && plain(e.fields.find(f => /price/i.test(f.name)).value) });
        const text = s => typeof s === "string" ? s.replace(/\[([^\]\n]{1,200})\]\((https:\/\/[^\s)]+)\)/g, (m, label, u) => isStore(u) ? `[${label}](${go(u, { title: label, text: label })})` : m) : s;
        out = { ...out, embeds: embeds.map(e => {
            if (!e || typeof e !== "object") return e;
            const o = { ...e };
            if (o.url && isStore(o.url)) o.url = go(o.url, byUrl.get(o.url));
            if (o.description) o.description = text(o.description);
            if (Array.isArray(o.fields)) o.fields = o.fields.map(f => ({ ...f, value: text(f.value) }));
            return o;
        }) };
        out.__info = byUrl;
    }
    const info = out.__info; if (info) { out = { ...out }; delete out.__info; }
    if (Array.isArray(out.components)) {
        const fix = c => {
            if (!c || typeof c !== "object") return c;
            const j = typeof c.toJSON === "function" ? c.toJSON() : c;
            if (Array.isArray(j.components)) return { ...j, components: j.components.map(fix) };
            if (j.type === 2 && j.style === 5 && j.url && isStore(j.url)) return { ...j, url: go(j.url, info?.get(j.url) ?? { title: String(j.label ?? "").replace(/^(Claim|Get it on|Open|See|View|Deal:)\s*/i, "") }) };
            return j;
        };
        out = { ...out, components: out.components.map(fix) };
    }
    if (typeof out.content === "string") out = { ...out, content: out.content.replace(/\[([^\]\n]{1,200})\]\((https:\/\/[^\s)]+)\)/g, (m, label, u) => isStore(u) ? `[${label}](${go(u, { title: label })})` : m) };
    return out;
}

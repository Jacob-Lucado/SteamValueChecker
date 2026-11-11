// Some Steam deals point at an edition or package, so there's no single game number to build a picture from.
// This looks those games up by title on Steam's store search and remembers the answer, so a picture shows up when Steam has one.
const EDITION = /\b(digital|deluxe|edition|ultimate|gold|complete|definitive|goty|game of the year|premium|collection|remastered|director'?s cut|standard)\b/gi;
const words = t => String(t).toLowerCase().replace(/&amp;/g, "&").replace(EDITION, " ").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
const same = (a, b) => { const x = words(a).slice(0, 3).join(" "), y = words(b).slice(0, 3).join(" "); return Boolean(x) && x === y; };

const known = new Map(); // title -> appid or null

/** Fills in `appid` for deals that lack one, when Steam's search finds the same game. Never throws. */
export async function fillArt(deals, { fetchImpl = globalThis.fetch, max = 12 } = {}) {
    const need = deals.filter(d => !d.appid && d.title).slice(0, max);
    for (let i = 0; i < need.length; i += 4) await Promise.all(need.slice(i, i + 4).map(async d => { // a few at a time, so Steam isn't hit all at once
        const key = d.title.toLowerCase();
        if (!known.has(key)) {
            let id = null;
            try {
                const res = await fetchImpl(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(d.title)}&l=english&cc=us`, { signal: AbortSignal.timeout(5000) });
                if (res.ok) { const hit = (await res.json())?.items?.find(i => i?.type === "app" && Number.isInteger(i.id) && same(i.name, d.title)); id = hit?.id ?? null; }
                known.set(key, id);
                if (known.size > 2000) known.delete(known.keys().next().value);
            } catch { return; } // not remembered, so it is tried again next hour
        }
        const id = known.get(key);
        if (id) d.appid = id;
    }));
    return deals;
}

/** The deals that have a picture, topped up with picture-less ones only when too few have one. */
export function withPictures(deals, n = 20, atLeast = 12) {
    const pics = deals.filter(d => d.appid);
    return (pics.length >= atLeast ? pics : [...pics, ...deals.filter(d => !d.appid)]).slice(0, n);
}
export const _forgetArt = () => known.clear();

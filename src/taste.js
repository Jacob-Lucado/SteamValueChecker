// Taste profile and recommendations. Genres and categories come from Steam's public store data (cached, shared by everyone);
// the profile is worked out on the fly from your library hours and never stored.

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Genres and categories for one app, or null when Steam has nothing (removed or region-locked pages). */
export async function fetchAppTags(appid, fetchImpl = globalThis.fetch) {
    const res = await fetchImpl(`https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appid)}&filters=genres,categories&l=english`, { headers: { "Accept-Language": "en" } });
    if (!res.ok) throw new Error(`Steam answered ${res.status}`);
    const data = (await res.json())?.[String(appid)];
    if (!data?.success) return null;
    const names = list => (Array.isArray(list) ? list : []).map(x => String(x?.description ?? "").trim()).filter(Boolean).slice(0, 12);
    return { genres: names(data.data?.genres), cats: names(data.data?.categories) };
}

/** Fetches tags for apps not yet known, a few at a time and politely. Stops at the first error (rate limits). Returns how many were stored. */
export async function refreshTags({ db, appids, fetchImpl = globalThis.fetch, delayMs = 1200 }) {
    let done = 0;
    for (const appid of appids) {
        try {
            const t = await fetchAppTags(appid, fetchImpl);
            db.saveAppTags(appid, t?.genres ?? [], t?.cats ?? []);
            done++;
        } catch { break; }
        if (delayMs) await sleep(delayMs);
    }
    return done;
}

const IGNORE = new Set(["Free To Play", "Early Access", "Free to Play"]);

/** Library games weighted by hours played (log scale, so one 2000 h game does not drown the rest). */
export function tasteProfile(db, userId) {
    const lib = db.listLibrary(userId).filter(g => g.appid);
    const tags = db.getAppTags(lib.map(g => g.appid));
    const weights = new Map(), cats = new Map();
    let total = 0, catTotal = 0, tagged = 0;
    for (const g of lib) {
        const t = tags.get(g.appid);
        if (!t || (!t.genres.length && !t.cats.length)) continue;
        tagged++;
        const w = Math.log1p((g.minutes ?? 0) / 60) + 0.3;
        for (const name of t.genres.filter(x => !IGNORE.has(x))) { weights.set(name, (weights.get(name) ?? 0) + w); total += w; }
        for (const name of t.cats) if (["Single-player", "Multi-player", "Co-op", "Online Co-Op", "PvP", "Online PvP"].includes(name)) { cats.set(name, (cats.get(name) ?? 0) + w); catTotal += w; }
    }
    const genres = [...weights].map(([name, v]) => ({ name, pct: total ? Math.round(v / total * 100) : 0, share: total ? v / total : 0 })).sort((a, b) => b.share - a.share).slice(0, 8);
    return { genres, tagged, games: lib.length, coop: cats.get("Co-op") || cats.get("Online Co-Op") ? Math.round(((cats.get("Co-op") ?? 0) + (cats.get("Online Co-Op") ?? 0)) / (catTotal || 1) * 100) : 0 };
}

/** Wishlist games you do not own, ranked by how well their genres fit the profile, with sales nudging the order. */
export function recommend(db, userId, rows, profile, limit = 5) {
    if (!profile.genres.length) return [];
    const share = new Map(profile.genres.map(g => [g.name, g.share]));
    const items = new Map(db.listItems(userId).filter(i => i.appid).map(i => [i.itad_id, i.appid]));
    const owned = new Set(db.listLibrary(userId).map(g => g.itad_id));
    const tags = db.getAppTags([...items.values()]);
    const out = [];
    for (const r of rows) {
        const appid = items.get(r.itad_id);
        const t = appid ? tags.get(appid) : null;
        if (!t || owned.has(r.itad_id)) continue;
        const matched = t.genres.filter(g => share.has(g)).sort((a, b) => share.get(b) - share.get(a));
        if (!matched.length) continue;
        const fit = matched.reduce((a, g) => a + share.get(g), 0) / Math.sqrt(t.genres.length);
        out.push({ itad_id: r.itad_id, title: r.title, price: r.best?.price ?? null, discount: r.discount ?? 0, matched: matched.slice(0, 2), score: fit * (1 + (r.discount ?? 0)) });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export const tasteWhy = r => `Fits your ${r.matched.join(" and ")} games${r.discount > 0 ? `, ${Math.round(r.discount * 100)}% off now` : ""}`;

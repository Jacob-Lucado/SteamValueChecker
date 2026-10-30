// Library analytics for a synced Steam library: where the hours go, played versus backlog, most played.
// Computed live from the member's own games and Steam's public genre tags; nothing extra is stored.
import { steamValue } from "./steamlib.js";

export function libraryAnalytics(db, userId, rows) {
    const lib = rows.filter(r => r.appid);
    const tags = db.getAppTags(lib.map(r => r.appid));
    const byGenre = new Map();
    let tagged = 0;
    for (const r of lib) {
        const t = tags.get(r.appid);
        if (!t || !t.genres.length) continue;
        tagged++;
        for (const g of new Set(t.genres)) {
            const e = byGenre.get(g) ?? { name: g, minutes: 0, games: 0 };
            e.minutes += r.minutes ?? 0; e.games++;
            byGenre.set(g, e);
        }
    }
    const genres = [...byGenre.values()].map(g => ({ name: g.name, hours: Math.round(g.minutes / 60), games: g.games })).sort((a, b) => b.hours - a.hours || b.games - a.games).slice(0, 10);
    const played = lib.filter(r => (r.minutes ?? 0) > 0).length;
    const v = steamValue(lib);
    return {
        games: lib.length,
        hours: Math.round(lib.reduce((t, r) => t + (r.minutes ?? 0), 0) / 60),
        value: v.games ? { msrp: v.msrp, cheapest: v.cheapest } : null,
        played, backlog: lib.length - played, playedPct: lib.length ? Math.round(played / lib.length * 100) : 0,
        genres, tagged, untagged: lib.length - tagged,
        mostPlayed: [...lib].sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0)).filter(r => (r.minutes ?? 0) > 0).slice(0, 6)
            .map(r => ({ title: r.title, appid: r.appid, itad_id: r.itad_id, hours: Math.round((r.minutes ?? 0) / 60) }))
    };
}

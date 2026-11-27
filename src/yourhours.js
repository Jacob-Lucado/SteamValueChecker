// Your hours: a forecast from your own library. Games with the same genres as the one on sale, how many of them you actually played,
// and what that makes the price per hour of your own playing. Other price trackers say whether a price is good; this says whether it is good for you.
const IGNORE = new Set(["Free To Play", "Free to Play", "Early Access"]);
const MIN_LIBRARY = 8, MIN_SIMILAR = 5, PLAYED_MIN = 60, CAP_HOURS = 100, SIMILAR = 0.6;

const median = list => { const s = [...list].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round1 = n => Math.round(n * 10) / 10;

/** tags: { genres } of the game on sale. Returns null until the library says something fair. */
export function yourHours(db, userId, tags, { price = null } = {}) {
    const genres = (tags?.genres ?? []).filter(g => !IGNORE.has(g));
    if (!genres.length) return null;
    const lib = db.listLibrary(userId).filter(g => g.appid);
    if (lib.length < MIN_LIBRARY) return null;
    const known = db.getAppTags(lib.map(g => g.appid));
    const similar = lib.filter(g => {
        const t = known.get(g.appid);
        if (!t?.genres?.length) return false;
        const shared = genres.filter(x => t.genres.includes(x)).length;
        return shared / genres.length >= SIMILAR;
    });
    if (similar.length < MIN_SIMILAR) return null;
    const mins = similar.map(g => g.minutes ?? 0);
    const playedHours = mins.filter(m => m >= PLAYED_MIN).map(m => m / 60);
    // The average counts the games you never touched, so a pile of unplayed ones pulls the forecast down, as it should.
    const expected = round1(mins.reduce((n, m) => n + Math.min(CAP_HOURS, m / 60), 0) / mins.length);
    const out = {
        n: similar.length, played: playedHours.length, playedPct: Math.round(playedHours.length / similar.length * 100),
        median: playedHours.length >= 3 ? round1(median(playedHours)) : null, expected,
        perHour: price != null && price > 0 && expected >= 1 ? Math.round(price / expected * 100) / 100 : null
    };
    out.risk = out.playedPct <= 40;
    return out;
}

/** One short paragraph for an alert or a row. `money` formats a price. */
export function hoursLine(f, money = n => n.toFixed(2)) {
    if (!f) return null;
    const parts = [`You own ${f.n} games like this and played ${f.played} of them`];
    if (f.median) parts[0] += ` (median ${f.median}h)`;
    const tail = f.expected >= 1 ? ` Expect about ${f.expected}h${f.perHour ? `, which is ${money(f.perHour)} an hour` : ""}.` : " You usually barely touch these.";
    return `${parts[0]}.${tail}${f.risk ? " ⚠️ Most of them sit unplayed." : ""}`;
}

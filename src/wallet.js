// Wallet planner: "I have $50 in Steam funds, what should I buy?" It picks the set of wishlist games that fits the budget
// and gets the most out of it (a knapsack over the cents), counting what the member said matters: priority games, big cuts,
// all-time lows and genres they actually play. Pure maths over the rows the wishlist page already builds.

export const MAX_BUDGET = 1000;
const MAX_CANDIDATES = 60;

const priceOf = r => Number(r?.best?.price);
const atlOf = r => { const a = r?.atl; const n = Number(a && typeof a === "object" ? a.price : a); return Number.isFinite(n) && n > 0 ? n : null; };

/**
 * How much a game is worth buying right now, as a plain number. Every game starts at 10; the rest is why it stands out.
 * `likes` is a Set of lowercase genres the member plays the most.
 */
export function wantScore(r, likes = new Set()) {
    let s = 10;
    if (r.priority) s += 8;
    s += Math.round((r.discount ?? 0) * 12);              // a 50% cut is worth 6
    const atl = atlOf(r), p = priceOf(r);
    if (atl && p <= atl * 1.001) s += 5;                  // the lowest it has ever been
    else if (r.low1y && p <= Number(r.low1y) * 1.001) s += 2;
    const fit = (r.genres ?? []).filter(g => likes.has(String(g).toLowerCase())).length;
    s += Math.min(6, fit * 2);
    return s;
}

/** Why a game made the cut, in a few short words. */
export function whyPicked(r, likes = new Set()) {
    const out = [];
    if (r.priority) out.push("on your priority list");
    const atl = atlOf(r), p = priceOf(r);
    if (atl && p <= atl * 1.001) out.push("lowest price ever");
    if ((r.discount ?? 0) >= 0.5) out.push(`${Math.round(r.discount * 100)}% off`);
    const fit = (r.genres ?? []).find(g => likes.has(String(g).toLowerCase()));
    if (fit) out.push(`you play a lot of ${fit.toLowerCase()}`);
    return out.slice(0, 3).join(", ") || "a good price for what it is";
}

/**
 * Picks from wishlist rows. Returns { picks, spent, left, saved, considered } where each pick is { ...row, price, score, why }.
 * Games already owned, without a price, or over budget are never considered. The result is the best total score that fits,
 * and among equal scores the one that spends less.
 */
export function planWallet(rows, budget, { likes = new Set(), include = null } = {}) {
    const cap = Math.min(MAX_BUDGET, Number(budget));
    if (!(cap > 0)) return { picks: [], spent: 0, left: 0, saved: 0, considered: 0 };
    const limit = Math.round(cap * 100);
    let cands = rows
        .filter(r => !r.owned && Number.isFinite(priceOf(r)) && priceOf(r) > 0 && Math.round(priceOf(r) * 100) <= limit && (!include || include(r)))
        .map(r => ({ r, cents: Math.round(priceOf(r) * 100), score: wantScore(r, likes) }));
    const considered = cands.length;
    cands = cands.sort((a, b) => b.score / b.cents - a.score / a.cents || a.cents - b.cents).slice(0, MAX_CANDIDATES);
    // best[c] = top score using at most c cents; keep[i][c] says whether item i was taken to reach it.
    const n = cands.length;
    const best = new Float64Array(limit + 1);
    const keep = cands.map(() => new Uint8Array(limit + 1));
    for (let i = 0; i < n; i++) {
        const { cents, score } = cands[i];
        for (let c = limit; c >= cents; c--) {
            const with_ = best[c - cents] + score;
            if (with_ > best[c] + 1e-9) { best[c] = with_; keep[i][c] = 1; }
        }
    }
    const picks = [];
    let c = limit;
    for (let i = n - 1; i >= 0; i--) {
        if (keep[i][c]) { picks.push(cands[i]); c -= cands[i].cents; }
    }
    picks.sort((a, b) => b.score - a.score || a.cents - b.cents || a.r.title.localeCompare(b.r.title));
    const spentCents = picks.reduce((t, p) => t + p.cents, 0);
    const saved = picks.reduce((t, p) => t + Math.max(0, (Number(p.r.regular) || priceOf(p.r)) - priceOf(p.r)), 0);
    return {
        picks: picks.map(p => ({ ...p.r, price: p.cents / 100, score: p.score, why: whyPicked(p.r, likes) })),
        spent: spentCents / 100, left: Math.round((limit - spentCents)) / 100, saved: Math.round(saved * 100) / 100, considered
    };
}

/** The genres a member plays most, from their library hours, for the "you play a lot of" bonus. */
export function likedGenres(profile, top = 4) {
    const list = Array.isArray(profile?.genres) ? profile.genres : [];
    return new Set(list.slice(0, top).map(g => String(g.name ?? g.genre ?? g[0] ?? g).toLowerCase()).filter(Boolean));
}

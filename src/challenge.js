// Monthly backlog challenge: pick how many games to finish this month, and keep a streak of months you hit the goal.
// A game counts when it is marked finished (by hand, or by Steam reaching 100% achievements) during that calendar month, in UTC.

export const MAX_GOAL = 20;
export const monthKey = ms => new Date(ms).toISOString().slice(0, 7);
const prevMonth = key => { const [y, m] = key.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };
const monthStart = key => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1);
const monthEnd = key => { const [y, m] = key.split("-").map(Number); return Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1); };

/** Streak of consecutive months with the goal met. The month in progress counts if met, and never breaks the streak while it is still open. */
export function streakOf(history, current) {
    const met = new Map(history.map(h => [h.month, h.done >= h.goal]));
    let streak = 0, key = current;
    if (met.get(key)) streak++;
    key = prevMonth(key);
    while (met.get(key)) { streak++; key = prevMonth(key); }
    let best = 0, run = 0, last = null;
    for (const h of [...history].sort((a, b) => a.month.localeCompare(b.month))) {
        const consecutive = run > 0 && prevMonth(h.month) === last;
        run = h.done >= h.goal ? (consecutive ? run + 1 : 1) : 0;
        best = Math.max(best, run);
        last = h.month;
    }
    return { streak, best };
}

export function challengeView(db, userId, nowMs = Date.now()) {
    const month = monthKey(nowMs);
    const rows = db.challengeRows(userId);
    const history = rows.map(r => ({ month: r.month, goal: r.goal, done: db.finishedBetween(userId, monthStart(r.month), monthEnd(r.month)).length }));
    const cur = history.find(h => h.month === month) ?? null;
    const titles = db.finishedBetween(userId, monthStart(month), monthEnd(month));
    const { streak, best } = streakOf(history, month);
    return {
        month, goal: cur?.goal ?? 0, done: titles.length, titles: titles.slice(0, 20),
        daysLeft: Math.max(0, Math.ceil((monthEnd(month) - nowMs) / 86400_000)),
        streak, best, history: history.sort((a, b) => b.month.localeCompare(a.month)).slice(0, 6)
    };
}

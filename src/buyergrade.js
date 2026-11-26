// Buyer grade: how close to the lowest price ever did you buy? Only games you recorded a price for count.
const MIN_GAMES = 5;

/** How good one purchase was. 100 means you matched the lowest price ever recorded (within a nickel on the dollar). */
export function gameScore(paid, atl) {
    const ratio = paid / atl;
    if (ratio <= 1.05) return 100;
    if (ratio <= 1.25) return 85;
    if (ratio <= 1.6) return 65;
    if (ratio <= 2.5) return 40;
    return 15;
}

export const gradeOf = score => (score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F");

const LINES = {
    A: "You buy like you can see the future.",
    B: "Solid. Most of your buys were close to the floor.",
    C: "Decent, but there was cheaper to be had.",
    D: "A lot of your games were bought well above their lowest price.",
    F: "Ouch. Let the alerts do the waiting for you."
};

/** rows from libraryView: { title, paid, gifted, atl }. Returns null until there are enough priced games to say anything fair. */
export function buyerGrade(rows) {
    const graded = rows.filter(r => !r.gifted && r.paid > 0 && r.atl > 0).map(r => ({ title: r.title, paid: r.paid, atl: r.atl, score: gameScore(r.paid, r.atl), over: Math.max(0, r.paid - r.atl) }));
    if (graded.length < MIN_GAMES) return { grade: null, graded: graded.length, need: MIN_GAMES };
    const score = Math.round(graded.reduce((n, g) => n + g.score, 0) / graded.length);
    const grade = gradeOf(score);
    const perfect = graded.filter(g => g.score === 100);
    return {
        grade, score, line: LINES[grade], graded: graded.length, perfect: perfect.length,
        lost: Math.round(graded.reduce((n, g) => n + g.over, 0) * 100) / 100,
        best: perfect.sort((a, b) => b.paid - a.paid).slice(0, 3),
        worst: graded.filter(g => g.over > 0).sort((a, b) => b.over - a.over).slice(0, 3)
    };
}

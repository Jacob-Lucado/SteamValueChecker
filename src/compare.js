// Compare two members' libraries: what they both own, and what only one of them has. Titles and hours only.

/** { shared: [{ title, aMinutes, bMinutes }], onlyA: [{ title, minutes }], onlyB: [...], a: {...totals}, b: {...totals} } */
export function compareLibraries(db, aId, bId) {
    const A = db.listLibrary(aId), B = db.listLibrary(bId);
    const mineB = new Map(B.map(x => [x.itad_id, x]));
    const shared = [], onlyA = [];
    for (const a of A) {
        const b = mineB.get(a.itad_id);
        if (b) { shared.push({ title: a.title, aMinutes: a.minutes ?? 0, bMinutes: b.minutes ?? 0 }); mineB.delete(a.itad_id); }
        else onlyA.push({ title: a.title, minutes: a.minutes ?? 0 });
    }
    const onlyB = [...mineB.values()].map(b => ({ title: b.title, minutes: b.minutes ?? 0 }));
    shared.sort((x, y) => (y.aMinutes + y.bMinutes) - (x.aMinutes + x.bMinutes) || x.title.localeCompare(y.title));
    const byName = (x, y) => x.title.localeCompare(y.title);
    onlyA.sort(byName); onlyB.sort(byName);
    const totals = list => ({ games: list.length, minutes: list.reduce((t, x) => t + (x.minutes ?? 0), 0), finished: list.filter(x => x.status === "finished").length });
    const union = A.length + B.length - shared.length;
    return { shared, onlyA, onlyB, a: totals(A), b: totals(B), overlapPct: union ? Math.round((shared.length / union) * 100) : 0 };
}

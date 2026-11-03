// Compare two members' libraries: what they both own, and what only one of them has. Titles and hours only.

/** { shared: [{ title, aMinutes, bMinutes }], onlyA: [{ title, minutes }], onlyB: [...], a: {...totals}, b: {...totals} } */
const TOGETHER = ["Co-op", "Online Co-Op", "Multi-player", "Online PvP", "PvP", "Shared/Split Screen Co-op", "Cross-Platform Multiplayer"];
/** Games both own that Steam tags as co-op or multiplayer, least played together first. Games without tags yet are counted, not guessed at. */
export function playTogether(db, aId, bId) {
    const B = new Map(db.listLibrary(bId).map(x => [x.itad_id, x]));
    const both = db.listLibrary(aId).filter(a => B.has(a.itad_id)).map(a => ({ title: a.title, appid: a.appid ?? B.get(a.itad_id).appid ?? null, minutes: (a.minutes ?? 0) + (B.get(a.itad_id).minutes ?? 0) }));
    const tags = db.getAppTags(both.map(g => g.appid).filter(Number.isInteger));
    const picks = [];
    let untagged = 0;
    for (const g of both) {
        const t = Number.isInteger(g.appid) ? tags.get(g.appid) : null;
        if (!t) { untagged++; continue; }
        if (t.cats.some(c => TOGETHER.includes(c))) picks.push({ ...g, coop: t.cats.some(c => /co-?op/i.test(c)) });
    }
    picks.sort((x, y) => Number(y.coop) - Number(x.coop) || x.minutes - y.minutes || x.title.localeCompare(y.title));
    return { picks, untagged, shared: both.length };
}

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

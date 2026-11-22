import test from "node:test";
import assert from "node:assert/strict";
import { playHabits, recapSummary } from "../src/steamstore.js";
import { recapEmbed, habitLines } from "../src/steamhandlers.js";

const NOW = Date.UTC(2026, 10, 20, 15, 0, 0);   // Friday Nov 20 2026
const m = o => new Map(Object.entries(o));

test("habits: favorite weekday, best streak, current streak and biggest day", () => {
    // Mon Nov 9 .. Wed Nov 11 in a row, a gap, then Thu Nov 19 and Fri Nov 20 (today).
    const h = playHabits(m({ "2026-11-09": 60, "2026-11-10": 120, "2026-11-11": 30, "2026-11-19": 45, "2026-11-20": 90 }), NOW);
    assert.equal(h.bestStreak, 3);
    assert.equal(h.currentStreak, 2);
    assert.equal(h.favoriteDay, "Tuesday");
    assert.deepEqual(h.bigDay, { day: "2026-11-10", minutes: 120 });
});

test("habits: a streak that ended two days ago is over, yesterday still counts, and a few days of data say nothing", () => {
    const base = { "2026-11-16": 30, "2026-11-17": 30, "2026-11-18": 30 };
    assert.equal(playHabits(m(base), NOW).currentStreak, 0, "last played Wednesday, it is Friday");
    assert.equal(playHabits(m({ ...base, "2026-11-19": 30 }), NOW).currentStreak, 4, "played yesterday");
    assert.equal(playHabits(m({ "2026-11-19": 30, "2026-11-20": 30 }), NOW), null);
});

test("habits: they ride along with the recap and show on the embed", () => {
    const rows = [["2026-11-09", 60], ["2026-11-10", 120], ["2026-11-11", 30]].map(([day, minutes]) => ({ day, title: "A", minutes }));
    const r = recapSummary(rows, 2026, NOW);
    assert.equal(r.habits.bestStreak, 3);
    const e = recapEmbed(r);
    const f = e.fields.find(x => x.name === "Your habits");
    assert.match(f.value, /Favorite day: \*\*Tuesday\*\*/);
    assert.match(f.value, /Biggest day: \*\*2.0 h\*\* on Nov 10/);
    assert.equal(recapSummary(rows.slice(0, 2), 2026, NOW).habits, null);
    assert.match(habitLines({ favoriteDay: "Friday", bestStreak: 1, currentStreak: 1, bigDay: { day: "2026-01-02", minutes: 90 } }), /1\*\* day in a row(?!.*right now)/);
});

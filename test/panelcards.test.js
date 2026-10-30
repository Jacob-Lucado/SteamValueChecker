import test from "node:test";
import assert from "node:assert/strict";
import { panelSvg, toPng, challengeSpec, spendSpec, trendSpec, compareSpec, badgesSpec, statusSpec, serverStatsSpec } from "../src/panelcards.js";

const png = spec => { const b = Buffer.from(toPng(panelSvg(spec))); assert.equal(b.subarray(1, 4).toString(), "PNG"); return b; };

test("every picture card draws, including the empty and awkward cases", () => {
    png(challengeSpec({ month: "2026-10", goal: 0, streak: 0, history: [], titles: [] }));
    png(challengeSpec({ month: "2026-10", goal: 3, done: 3, daysLeft: 0, streak: 1, best: 1, titles: ["A <b> & C"], history: [{ month: "2026-10", done: 3, goal: 3 }] }));
    png(spendSpec({ games: 0 }));
    png(spendSpec({ currency: "USD", games: 1, total: 9.99, avg: 9.99, year: { year: 2026, total: 9.99 }, months: [{ total: 0 }, { total: 0 }], bestValue: [], worstValue: [], unplayed: { count: 0, total: 0 } }));
    png(trendSpec({ last: { cheapest: 10, msrp: 20, games: 2 }, first: { days: 5, cheapest: 0, msrp: 0, games: 0, backlog: 0, finished: 0 } }, "USD"));
    png(compareSpec({ overlapPct: 0, a: { games: 1, minutes: 0 }, b: { games: 1, minutes: 0 }, shared: [], onlyA: [], onlyB: [] }, "You", "A very long friend display name"));
    png(badgesSpec({ earned: 0, total: 0, badges: [] }));
    png(statusSpec({ overall: "down", uptime: { pct90: null }, components: [{ name: "x", state: "down", detail: "<oops>" }] }, null));
    png(serverStatsSpec({ members: 0 }, "G"));
    png(serverStatsSpec({ members: 3, games: 5, saved: 0, alerts30d: 0, mostWanted: [], sharedList: [] }));
});

test("card text is escaped so a game or member name cannot break the picture", () => {
    const svg = panelSvg(challengeSpec({ month: "m", goal: 1, done: 0, daysLeft: 2, streak: 0, best: 0, titles: ["</svg><script>x</script>"], history: [] }));
    assert.ok(!svg.includes("<script>") && svg.includes("&lt;script&gt;"));
});

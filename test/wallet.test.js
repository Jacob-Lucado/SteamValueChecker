import test from "node:test";
import assert from "node:assert/strict";
import { planWallet, wantScore, likedGenres, whyPicked } from "../src/wallet.js";
import { backlogForecast, hoursPerGame, weeklyHours } from "../src/pace.js";

const row = (title, price, extra = {}) => ({ title, itad_id: title, owned: false, best: { price }, regular: price * 2, discount: 0.5, genres: [], ...extra });

test("wallet planner never goes over budget and skips owned or unpriced games", () => {
    const rows = [row("A", 20), row("B", 30), row("C", 25), row("Owned", 5, { owned: true }), { title: "NoPrice", owned: false, best: null }];
    const r = planWallet(rows, 50);
    assert.ok(r.spent <= 50);
    assert.ok(!r.picks.some(p => p.title === "Owned" || p.title === "NoPrice"));
    assert.equal(r.left, Math.round((50 - r.spent) * 100) / 100);
});

test("wallet planner finds the better combination, not just the greedy one", () => {
    // 3 cheap decent games beat one pricey one that eats the whole budget.
    const rows = [row("Big", 50, { discount: 0, priority: false }), row("S1", 17, { discount: 0.5 }), row("S2", 16, { discount: 0.5 }), row("S3", 16, { discount: 0.5 })];
    const r = planWallet(rows, 50);
    assert.deepEqual(r.picks.map(p => p.title).sort(), ["S1", "S2", "S3"]);
});

test("priority, all-time lows and liked genres raise the score", () => {
    const base = row("X", 10, { discount: 0 });
    const likes = likedGenres({ genres: [{ name: "RPG" }, { name: "Strategy" }] });
    assert.ok(wantScore({ ...base, priority: true }) > wantScore(base));
    assert.ok(wantScore({ ...base, atl: 10 }) > wantScore(base));
    assert.ok(wantScore({ ...base, genres: ["RPG"] }, likes) > wantScore(base, likes));
    assert.match(whyPicked({ ...base, atl: 10, genres: ["RPG"], priority: true }, likes), /priority.*lowest.*rpg/i);
});

test("wallet planner handles zero, tiny and huge budgets", () => {
    assert.deepEqual(planWallet([row("A", 5)], 0).picks, []);
    assert.deepEqual(planWallet([row("A", 5)], 2).picks, []);
    assert.equal(planWallet([row("A", 5)], 99999).picks.length, 1);
});

test("backlog forecast uses the member's own pace and says when there is no pace", () => {
    const now = Date.parse("2026-11-20T12:00:00Z");
    const rows = [
        ...Array.from({ length: 10 }, (_, i) => ({ itad_id: "b" + i, status: "backlog", minutes: 0 })),
        { itad_id: "f1", status: "finished", minutes: 600 }, { itad_id: "f2", status: "finished", minutes: 1200 }, { itad_id: "f3", status: "finished", minutes: 900 }
    ];
    assert.equal(hoursPerGame(rows).hours, 15);
    const log = [{ day: "2026-11-10", minutes: 480 }, { day: "2026-10-20", minutes: 480 }, { day: "2025-01-01", minutes: 99999 }];
    assert.equal(weeklyHours(log, now), 2);
    const f = backlogForecast(rows, log, now);
    assert.equal(f.games, 10);
    assert.equal(f.hoursNeeded, 150);
    assert.equal(f.weeks, 75);
    assert.match(f.label, /2 hours a week/);
    const none = backlogForecast(rows, [], now);
    assert.equal(none.date, null);
    assert.match(none.label, /150 hours/);
    assert.match(backlogForecast([], [], now).label, /empty/);
});

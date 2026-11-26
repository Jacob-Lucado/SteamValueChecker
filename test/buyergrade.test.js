import test from "node:test";
import assert from "node:assert/strict";
import { gameScore, gradeOf, buyerGrade } from "../src/buyergrade.js";

const row = (title, paid, atl, over = {}) => ({ title, paid, atl, gifted: false, ...over });

test("a purchase scores by how far it was from the lowest price ever", () => {
    assert.equal(gameScore(10, 10), 100); assert.equal(gameScore(10.4, 10), 100, "within five percent counts as the floor");
    assert.equal(gameScore(12, 10), 85); assert.equal(gameScore(15, 10), 65); assert.equal(gameScore(20, 10), 40); assert.equal(gameScore(60, 10), 15);
    assert.deepEqual(["A", "B", "C", "D", "F"], [95, 75, 60, 45, 20].map(gradeOf));
});

test("no grade until five priced games, and gifts, free games and unknown lows are left out", () => {
    const few = buyerGrade([row("a", 10, 10), row("b", 10, 10), row("c", 5, 0), row("d", 0, 5), row("e", 9, 3, { gifted: true })]);
    assert.equal(few.grade, null); assert.equal(few.graded, 2); assert.equal(few.need, 5);
});

test("the grade, the perfect buys and the money left on the table are worked out from the library", () => {
    const g = buyerGrade([row("a", 10, 10), row("b", 20, 20), row("c", 30, 30), row("d", 40, 20), row("e", 15, 5)]);
    assert.equal(g.score, Math.round((100 + 100 + 100 + 40 + 15) / 5)); assert.equal(g.grade, "B");
    assert.equal(g.perfect, 3); assert.equal(g.lost, 30); assert.equal(g.worst[0].title, "d"); assert.equal(g.best[0].title, "c");
    assert.ok(g.line.length > 10);
    assert.equal(buyerGrade([row("a", 50, 5), row("b", 50, 5), row("c", 50, 5), row("d", 50, 5), row("e", 50, 5)]).grade, "F");
});

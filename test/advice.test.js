import test from "node:test";
import assert from "node:assert/strict";
import { buyOrWait } from "../src/advice.js";

const NOW = Date.UTC(2026, 5, 1);
const D = 86400_000;
const pts = arr => arr.map(([daysAgo, price]) => ({ t: NOW - daysAgo * D, price }));

test("buy now or wait: needs enough history", () => {
    assert.equal(buyOrWait(pts([[10, 5], [5, 5]]), 5, { now: NOW }), null);
    assert.equal(buyOrWait(pts([[100, 20], [50, 10], [5, 20]]), NaN, { now: NOW }), null);
});

test("buy now when within 5% of the low", () => {
    const a = buyOrWait(pts([[300, 20], [200, 10], [100, 20], [5, 10]]), 10.3, { now: NOW });
    assert.equal(a.verdict, "buy");
    assert.match(a.reasons[0], /12-month low/);
    assert.equal(a.dips, 2);
});

test("wait when a Steam sale is about to start and it has dipped before", () => {
    const sales = [{ name: "Winter Sale", kind: "sale", start: NOW + 9 * D, end: NOW + 20 * D }];
    const a = buyOrWait(pts([[300, 20], [200, 10], [100, 20], [5, 18]]), 18, { now: NOW, sales });
    assert.equal(a.verdict, "wait");
    assert.equal(a.saleIn, 9);
    assert.match(a.reasons.join(" "), /Winter Sale starts in 9 days/);
    // a fest (not a sale) or one that is far off does not count
    assert.notEqual(buyOrWait(pts([[300, 20], [200, 10], [100, 20], [5, 18]]), 18, { now: NOW, sales: [{ ...sales[0], kind: "fest" }] }).saleIn, 9);
    assert.equal(buyOrWait(pts([[300, 20], [200, 10], [100, 20], [5, 18]]), 18, { now: NOW, sales: [{ ...sales[0], start: NOW + 40 * D }] }).saleIn, null);
});

test("leaning buy when cheaper than usual and near the low; wait when far above", () => {
    const hist = pts([[300, 20], [250, 20], [200, 20], [150, 20], [100, 10], [50, 20]]);
    assert.equal(buyOrWait(hist, 12, { now: NOW }).verdict, "lean_buy");
    assert.equal(buyOrWait(hist, 20, { now: NOW }).verdict, "wait");
    assert.equal(buyOrWait(pts([[300, 20], [100, 18], [50, 20]]), 20, { now: NOW }).verdict, "lean_wait", "mild gap and no repeat dips");
});

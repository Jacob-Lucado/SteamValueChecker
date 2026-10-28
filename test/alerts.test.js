import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, parseTrigger, describeTrigger } from "../src/alerts.js";
import { findItem, suggest } from "../src/wishlist.js";

const summary = (price, regular = 20, atl = 5) => ({ best: price === null ? null : { price, shop: "GOG", url: "https://x.example/d" }, msrp: regular, atl, currency: "USD" });
const item = (o = {}) => ({ trigger_type: "any", trigger_value: null, last_alert_price: null, ...o });

test("any sale: alerts on a discount, not at full price", () => {
    assert.equal(evaluate(item(), summary(15)).action, "alert");
    assert.equal(evaluate(item(), summary(20)).action, "none");
    assert.equal(evaluate(item(), summary(null)).action, "none");
});

test("percent, price and all-time-low triggers", () => {
    assert.equal(evaluate(item({ trigger_type: "percent", trigger_value: 50 }), summary(10)).action, "alert");
    assert.equal(evaluate(item({ trigger_type: "percent", trigger_value: 50 }), summary(12)).action, "none");
    assert.equal(evaluate(item({ trigger_type: "price", trigger_value: 8 }), summary(8)).action, "alert");
    assert.equal(evaluate(item({ trigger_type: "price", trigger_value: 8 }), summary(8.5)).action, "none");
    assert.equal(evaluate(item({ trigger_type: "atl" }), summary(5, 20, 5)).action, "alert");
    assert.equal(evaluate(item({ trigger_type: "atl" }), summary(6, 20, 5)).action, "none");
});

test("a price trigger works even when nothing is discounted", () => {
    assert.equal(evaluate(item({ trigger_type: "price", trigger_value: 25 }), summary(20)).action, "alert");
});

test("anti-spam: once per sale, again only on a further drop, and again after the sale ends", () => {
    const it = item({ last_alert_price: 15 });
    assert.equal(evaluate(it, summary(15)).action, "none"); // same sale, already told
    assert.equal(evaluate(it, summary(16)).action, "none"); // price crept up, still no repeat
    const lower = evaluate(it, summary(12));
    assert.equal(lower.action, "alert");
    assert.equal(lower.reason, "lower");
    assert.equal(evaluate(it, summary(20)).action, "reset"); // sale over: forget, so the next sale alerts
    assert.equal(evaluate(item(), summary(20)).action, "none");
});

test("trigger validation", () => {
    assert.deepEqual(parseTrigger(undefined, undefined), { type: "any", value: null });
    assert.deepEqual(parseTrigger("percent", 40), { type: "percent", value: 40 });
    assert.throws(() => parseTrigger("percent", 0), /1 to 99/);
    assert.throws(() => parseTrigger("percent", null), /1 to 99/);
    assert.throws(() => parseTrigger("price", null), /price/);
    assert.throws(() => parseTrigger("nope"), /Unknown/);
    assert.equal(describeTrigger({ trigger_type: "percent", trigger_value: 40 }), "40% off or more");
});

test("finding games by title", () => {
    const items = [{ title: "Hades" }, { title: "Hades II" }, { title: "Celeste" }];
    assert.equal(findItem(items, "hades").item.title, "Hades"); // exact beats partial
    assert.equal(findItem(items, "cel").item.title, "Celeste");
    assert.deepEqual(findItem(items, "had").ambiguous, ["Hades", "Hades II"]);
    assert.ok(findItem(items, "zzz").none);
    assert.deepEqual(suggest(items, "ades").map(s => s.value), ["Hades", "Hades II"]);
});

test("re-alerts need a real drop, not a few cents of exchange-rate noise", async () => {
    const { meaningfulDrop } = await import("../src/alerts.js");
    assert.equal(meaningfulDrop(10.57, 10.56), false, "one cent");
    assert.equal(meaningfulDrop(10.57, 10.4), false, "under 25 cents");
    assert.equal(meaningfulDrop(30, 29.5), false, "under 3%");
    assert.equal(meaningfulDrop(10.57, 9.5), true);
    assert.equal(meaningfulDrop(0.99, 0.5), true, "cheap games can still drop");
    assert.equal(meaningfulDrop(10, 10.5), false, "a rise is never a drop");
});

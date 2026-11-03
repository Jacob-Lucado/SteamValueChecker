import test from "node:test";
import assert from "node:assert/strict";
import { parseReviews, steamReviews, reviewLine } from "../src/reviews.js";
import { alertEmbed, checkEmbed } from "../src/render.js";

const body = (pos, neg, desc) => ({ success: 1, query_summary: { review_score_desc: desc, total_positive: pos, total_negative: neg, total_reviews: pos + neg } });

test("reviews: the score is read from Steam's summary, and too few reviews mean no score", () => {
    assert.deepEqual(parseReviews(body(940, 60, "Overwhelmingly Positive")), { desc: "Overwhelmingly Positive", pct: 94, total: 1000 });
    assert.equal(parseReviews(body(5, 2, "7 user reviews")), null);
    assert.equal(parseReviews(body(30, 5, "5 user reviews")), null, "a count instead of a rating");
    assert.equal(parseReviews({}), null); assert.equal(parseReviews(null), null);
});
test("reviews: fetched once per game for a while, and every failure is silent", async () => {
    let calls = 0, t = 0;
    const ok = async url => { calls++; assert.match(url, /appreviews\/4242\?json=1/); return { ok: true, json: async () => body(80, 20, "Very Positive") }; };
    const a = await steamReviews(4242, { fetchFn: ok, now: () => t }); const b = await steamReviews(4242, { fetchFn: ok, now: () => t + 1000 });
    assert.equal(a.pct, 80); assert.deepEqual(a, b); assert.equal(calls, 1);
    await steamReviews(4242, { fetchFn: ok, now: () => t + 7 * 3600_000 }); assert.equal(calls, 2, "refreshed after the cache expires");
    assert.equal(await steamReviews(9001, { fetchFn: async () => { throw new Error("down"); } }), null);
    assert.equal(await steamReviews(9002, { fetchFn: async () => ({ ok: false }) }), null);
    assert.equal(await steamReviews(null, { fetchFn: ok }), null); assert.equal(await steamReviews(-5, { fetchFn: ok }), null);
});
test("reviews: shown on the alert and on the check card, and left out when unknown", () => {
    const r = { desc: "Very Positive", pct: 88, total: 12345 };
    assert.match(reviewLine(r), /Very Positive.*88% of 12,345/); assert.equal(reviewLine(null), null);
    assert.match(reviewLine({ desc: "Mostly Negative", pct: 30, total: 50 }), /^👎/);
    const now = { price: 10, regular: 20, discount: 0.5, shop: "Steam", currency: "USD", atl: 5 };
    assert.match(alertEmbed({ title: "G" }, now, { trigger: "any", reviews: r }).description, /Very Positive/);
    assert.doesNotMatch(alertEmbed({ title: "G" }, now, { trigger: "any" }).description, /Steam: /);
    assert.ok(checkEmbed("G", { ...now, low3m: 6, low1y: 5 }, null, null, [], r).fields.some(f => f.name === "Steam reviews"));
    assert.ok(!checkEmbed("G", { ...now, low3m: 6, low1y: 5 }, null, null, []).fields.some(f => f.name === "Steam reviews"));
});

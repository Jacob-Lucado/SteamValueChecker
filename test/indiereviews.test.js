import { test } from "node:test";
import assert from "node:assert/strict";
import { createIndie } from "../src/indie.js";

const json = body => ({ ok: true, status: 200, json: async () => body });
const summary = { query_summary: { total_positive: 1800, total_negative: 911, total_reviews: 2711, review_score_desc: "Mostly Positive" } };

test("a throttled review request is retried, then the totals come through", async () => {
    let calls = 0;
    const svc = createIndie({ fetchImpl: async () => (++calls < 3 ? { ok: false, status: 429, json: async () => ({}) } : json(summary)) });
    const r = await svc.reviews(2682580);
    assert.equal(r.total, 2711); assert.equal(r.positive, 1800); assert.equal(calls, 3);
});

test("when Steam never answers, it says it failed instead of claiming there are no reviews", async () => {
    const svc = createIndie({ fetchImpl: async () => { throw new Error("offline"); } });
    const warn = console.warn; console.warn = () => {};
    try { assert.deepEqual(await svc.reviews(1), { failed: true }); } finally { console.warn = warn; }
});

test("a game with no reviews is null", async () => {
    const svc = createIndie({ fetchImpl: async () => json({ query_summary: { total_positive: 0, total_negative: 0, total_reviews: 0 } }) });
    assert.equal(await svc.reviews(5), null);
});

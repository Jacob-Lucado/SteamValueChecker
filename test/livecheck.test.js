import test from "node:test";
import assert from "node:assert/strict";
import { liveCheck } from "../scripts/live-check.mjs";

const deal = { shop: { id: 61, name: "Steam" }, price: { amount: 10, currency: "USD" }, regular: { amount: 25, currency: "USD" }, cut: 60 };
const itad = over => ({
    lookupTitles: async ([t]) => [{ title: t, id: "id-hades", approx: false, matched: "Hades" }],
    getPrices: async ids => new Map(ids.map(id => [id, { deals: [deal], historyLow: { all: { amount: 5 } } }])),
    getHistory: async () => Array.from({ length: 12 }, (_, n) => ({ t: n, price: 10 })),
    getGiveawayList: async () => [],
    getHotDeals: async () => [{ title: "X", price: 1, cut: 90 }],
    ...over
});
const fetchImpl = async url => {
    const u = String(url), ok = body => ({ ok: true, status: 200, json: async () => body });
    if (u.includes("appreviews")) return ok({ success: 1, query_summary: { review_score_desc: "Overwhelmingly Positive", total_positive: 9800, total_negative: 200, total_reviews: 10000 } });
    if (u.includes("GetNumberOfCurrentPlayers")) return ok({ response: { player_count: 1234 } });
    if (u.includes("protondb")) return ok({ tier: "platinum" });
    return { ok: false, status: 404, json: async () => ({}) };
};

test("live check: passes when every service answers in the expected shape", async () => {
    const out = await liveCheck({ itad: itad(), fetchImpl, log: () => {} });
    assert.deepEqual(out.results.filter(r => !r.ok), []);
    assert.equal(out.ok, true);
});

test("live check: a changed answer fails that step by name and the rest still run", async () => {
    const out = await liveCheck({ itad: itad({ getPrices: async ids => new Map(ids.map(id => [id, { offers: [] }])) }), fetchImpl, log: () => {} });
    assert.equal(out.ok, false);
    assert.deepEqual(out.results.filter(r => !r.ok).map(r => r.name), ["price site: current prices"]);
    assert.ok(out.results.length >= 8);
});

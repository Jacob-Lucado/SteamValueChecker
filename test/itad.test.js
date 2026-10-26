import test from "node:test";
import assert from "node:assert/strict";
import { createItad, similarity, normalize, ItadError } from "../src/itad.js";

const json = (body, status = 200, headers = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: k => headers[k.toLowerCase()] ?? null },
    json: async () => body
});

function fakeFetch(routes, log = []) {
    return async (url, init = {}) => {
        const u = new URL(url);
        log.push({ path: u.pathname, params: Object.fromEntries(u.searchParams), method: init.method, body: init.body ? JSON.parse(init.body) : null });
        const handler = routes[u.pathname];
        if (!handler) return json({}, 404);
        return handler(u, init);
    };
}

test("normalize and similarity", () => {
    assert.equal(normalize("Pokémon™: Red & Blue"), "pokemon red and blue");
    assert.equal(similarity("Hades", "hades"), 1);
    assert.ok(similarity("Hollow Knight", "Hollow Knight: Silksong") > 0.6);
    assert.ok(similarity("Hades", "Zebra Crossing Simulator") < 0.6);
});

test("exact lookup, fuzzy fallback and rejection of bad fuzzy matches", async () => {
    const log = [];
    const itad = createItad({
        apiKey: "SECRET",
        fetchImpl: fakeFetch({
            "/lookup/id/title/v1": () => json({ Hades: "id-hades", "Hollow Knight GOTY": null, "Qwertyuiop": null }),
            "/games/search/v1": u => {
                const t = u.searchParams.get("title");
                if (t === "Hollow Knight GOTY") return json([{ id: "id-hk", title: "Hollow Knight" }]);
                return json([{ id: "id-wrong", title: "Completely Different Thing" }]);
            }
        }, log)
    });
    const out = await itad.lookupTitles(["Hades", "Hollow Knight GOTY", "Qwertyuiop"]);
    assert.deepEqual(out.map(o => [o.title, o.id, o.approx]), [
        ["Hades", "id-hades", false],
        ["Hollow Knight GOTY", "id-hk", true],
        ["Qwertyuiop", null, false]
    ]);
    assert.equal(log[0].params.key, "SECRET");
    assert.deepEqual(log[0].body, ["Hades", "Hollow Knight GOTY", "Qwertyuiop"]);

    // second call is served from the cache
    const before = log.length;
    await itad.lookupTitles(["Hades"]);
    assert.equal(log.length, before);
});

test("prices: batches in 50s, passes the region, caches", async () => {
    const log = [];
    const itad = createItad({
        apiKey: "k",
        fetchImpl: fakeFetch({ "/games/prices/v3": (u, init) => json(JSON.parse(init.body).map(id => ({ id, deals: [] }))) }, log)
    });
    const ids = Array.from({ length: 120 }, (_, i) => `id${i}`);
    const map = await itad.getPrices(ids, "GB");
    assert.equal(map.size, 120);
    assert.equal(log.length, 3); // 50 + 50 + 20
    assert.equal(log[0].params.country, "GB");
    await itad.getPrices(ids, "GB");
    assert.equal(log.length, 3);
    await itad.getPrices(["id0"], "US"); // different region is a different cache entry
    assert.equal(log.length, 4);
});

test("cache entries expire", async () => {
    let t = 0;
    const log = [];
    const itad = createItad({
        apiKey: "k", now: () => t, ttlMs: 1000,
        fetchImpl: fakeFetch({ "/games/prices/v3": () => json([{ id: "a", deals: [] }]) }, log)
    });
    await itad.getPrices(["a"]);
    t = 500; await itad.getPrices(["a"]);
    assert.equal(log.length, 1);
    t = 2000; await itad.getPrices(["a"]);
    assert.equal(log.length, 2);
});

test("429 retries a few times then gives up with a friendly error", async () => {
    let calls = 0;
    const slept = [];
    const itad = createItad({
        apiKey: "k", minGapMs: 0, sleep: async ms => slept.push(ms),
        fetchImpl: async () => { calls++; return json({}, 429, { "retry-after": "3" }); }
    });
    await assert.rejects(() => itad.getPrices(["a"]), e => e instanceof ItadError && e.code === "rate_limited");
    assert.equal(calls, 5);
    assert.deepEqual(slept, [3000, 3000, 3000, 3000]);
});

test("auth and server errors are clear, and never leak the API key", async () => {
    for (const [status, code] of [[401, "auth"], [500, "http"]]) {
        const itad = createItad({ apiKey: "TOPSECRET", fetchImpl: async () => json({}, status) });
        await assert.rejects(() => itad.getPrices(["a"]), e => e.code === code && !e.message.includes("TOPSECRET"));
    }
    const down = createItad({ apiKey: "TOPSECRET", fetchImpl: async () => { throw new Error("connect ECONNREFUSED https://x?key=TOPSECRET"); } });
    await assert.rejects(() => down.getPrices(["a"]), e => e.code === "network" && !e.message.includes("TOPSECRET"));
});

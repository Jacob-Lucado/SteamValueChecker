import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { pingIndexNow, indexNowKey, siteUrls } from "../src/indexnow.js";

test("IndexNow: the key is stable, the page list covers the search pages, and it is only sent once per version", async () => {
    const origin = "https://example.test";
    assert.match(indexNowKey(origin), /^[0-9a-f]{32}$/);
    assert.equal(indexNowKey(origin), indexNowKey(origin));
    assert.notEqual(indexNowKey(origin), indexNowKey("https://other.test"));
    assert.ok(siteUrls(origin).includes(origin + "/ai") && siteUrls(origin).includes(origin + "/steam-library-value"));
    const db = openDb(":memory:");
    const calls = [];
    const fetchImpl = async (url, o) => { calls.push([url, JSON.parse(o.body)]); return { status: 202 }; };
    const quiet = () => {};
    assert.deepEqual(await pingIndexNow({ origin: "http://localhost:3000", db, fetchImpl, log: quiet }), { skipped: "not a public address" });
    assert.equal(calls.length, 0, "never from a local address");
    const r = await pingIndexNow({ origin, db, fetchImpl, log: quiet });
    assert.equal(r.status, 202);
    assert.equal(calls[0][1].host, "example.test");
    assert.equal(calls[0][1].keyLocation, `${origin}/${indexNowKey(origin)}.txt`);
    assert.ok(calls[0][1].urlList.length >= 8);
    assert.ok((await pingIndexNow({ origin, db, fetchImpl, log: quiet })).skipped, "not again for the same version");
    // A refusal is not remembered, so the next start tries again.
    const db2 = openDb(":memory:");
    assert.equal((await pingIndexNow({ origin, db: db2, fetchImpl: async () => ({ status: 429 }), log: quiet })).error, 429);
    assert.equal((await pingIndexNow({ origin, db: db2, fetchImpl, log: quiet })).status, 202);
});

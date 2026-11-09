import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createXPoster, oauthHeader, freeGameText, DEFAULT_DAILY } from "../src/xposter.js";

const ENV = { X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_SECRET: "ts" };
const game = (id, extra = {}) => ({ id, title: "Cool Game", shop: "Epic Games", url: "https://store.epicgames.com/x", type: "game", expiry: Date.UTC(2026, 10, 12, 15), ...extra });

test("the OAuth header is signed, repeatable and carries no secrets", () => {
    const keys = { apiKey: "k", apiSecret: "s", accessToken: "t", accessSecret: "ts" };
    const a = oauthHeader({ method: "POST", url: "https://api.x.com/2/tweets", keys, nonce: "n", timestamp: 1000 });
    assert.equal(a, oauthHeader({ method: "POST", url: "https://api.x.com/2/tweets", keys, nonce: "n", timestamp: 1000 }));
    assert.match(a, /^OAuth oauth_consumer_key="k", oauth_nonce="n", oauth_signature_method="HMAC-SHA1", oauth_timestamp="1000", oauth_token="t", oauth_version="1.0", oauth_signature="[^"]+"$/);
    assert.ok(!a.includes("ts") || !/oauth_token_secret/.test(a));
    assert.notEqual(a, oauthHeader({ method: "POST", url: "https://api.x.com/2/tweets", keys: { ...keys, accessSecret: "other" }, nonce: "n", timestamp: 1000 }), "the secret changes the signature");
});

test("the post text is plain, short and has no link", () => {
    const t = freeGameText(game("a"), Date.UTC(2026, 10, 9));
    assert.match(t, /Free right now: Cool Game on Epic Games/); assert.match(t, /Ends Nov 12/);
    assert.ok(!/https?:|\.com|www\./i.test(t), "a link would cost about 13 times more"); assert.ok(t.length < 280);
});

test("it does nothing until it is switched on and the keys are there", async () => {
    const db = openDb(":memory:"), sent = [];
    const off = createXPoster({ env: ENV, db, fetchImpl: async (u, o) => { sent.push(o); return { ok: true, json: async () => ({ data: { id: "1" } }) }; } });
    assert.deepEqual(await off.tick([game("a")]), { skipped: "off" });
    off.setSettings({ enabled: true });
    const nokeys = createXPoster({ env: {}, db, fetchImpl: async () => { throw new Error("no"); } });
    assert.deepEqual(await nokeys.tick([game("a")]), { skipped: "off" });
    assert.equal(sent.length, 0);
});

test("one game per run, spaced out, capped per day, never the same game twice", async () => {
    const db = openDb(":memory:"); let t = Date.UTC(2026, 10, 9, 15); const bodies = [];
    const x = createXPoster({ env: ENV, db, now: () => t, fetchImpl: async (u, o) => { bodies.push(JSON.parse(o.body).text); return { ok: true, json: async () => ({ data: { id: String(bodies.length) } }) }; } });
    x.setSettings({ enabled: true });
    const list = [game("a", { title: "Alpha" }), game("b", { title: "Beta", expiry: Date.UTC(2026, 10, 10) }), game("c", { title: "Gamma" }), game("d", { type: "dlc" })];
    assert.equal((await x.tick(list)).posted, "Beta", "the one ending soonest goes first");
    assert.deepEqual(await x.tick(list), { skipped: "gap" });
    t += 4 * 3_600_000; assert.equal((await x.tick(list)).posted, "Alpha");
    t += 4 * 3_600_000; assert.deepEqual(await x.tick(list), { skipped: "cap" }, `${DEFAULT_DAILY} a day by default`);
    t += 24 * 3_600_000; assert.equal((await x.tick(list)).posted, "Gamma");
    t += 4 * 3_600_000; assert.deepEqual(await x.tick(list), { skipped: "nothing" }, "the DLC and the already posted ones are left out");
    assert.equal(x.status().postedToday, 1);
});

test("a failed post is remembered, explained and not retried at a cost", async () => {
    const db = openDb(":memory:"); let calls = 0;
    const x = createXPoster({ env: ENV, db, fetchImpl: async () => { calls++; return { ok: false, status: 402, json: async () => ({ title: "CreditsDepleted" }) }; } });
    x.setSettings({ enabled: true });
    const r = await x.tick([game("a")]);
    assert.match(r.error, /out of credits/); assert.match(x.status().error.message, /credits/);
    assert.equal(calls, 1); await x.tick([game("a")]); assert.equal(calls, 1, "the same game isn't tried again");
    assert.throws(() => x.setSettings({ daily: 99 }), /between 1 and/);
    assert.equal(x.status().monthlyCost, 0.9);
});

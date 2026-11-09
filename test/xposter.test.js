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

test("spaces and quote marks pasted around the keys are ignored", async () => {
    const db = openDb(":memory:"); let header = "";
    const x = createXPoster({ env: { X_API_KEY: ' "k" ', X_API_SECRET: "s\n", X_ACCESS_TOKEN: "t ", X_ACCESS_SECRET: "'ts'" }, db, fetchImpl: async (u, o) => { header = o.headers.Authorization; return { ok: true, json: async () => ({ data: { username: "x" } }) }; } });
    await x.check();
    assert.match(header, /oauth_consumer_key="k"/); assert.match(header, /oauth_token="t"/);
});

test("manual posts: length rules, links cost more, pictures go first, history and spend are kept", async () => {
    const { xLength, hasLink } = await import("../src/xposter.js");
    assert.equal(xLength("hi 🎁 https://steamvaluechecker.com/x"), 29, "a link is 23 and an emoji is 2");
    assert.equal(hasLink("Link in bio."), false); assert.equal(hasLink("see steamvaluechecker.com"), true);
    const db = openDb(":memory:"); const calls = [];
    const x = createXPoster({ env: ENV, db, fetchImpl: async (u, o) => { calls.push([o.method, u, o.body ? JSON.parse(o.body) : null]); return { ok: true, json: async () => (u.includes("media") ? { data: { id: "m1" } } : { data: { id: "123456" } }) }; } });
    await assert.rejects(x.manual({ text: "  " }), /Write something/);
    await assert.rejects(x.manual({ text: "a".repeat(281) }), /281 characters/);
    const plain = await x.manual({ text: "Hello there" });
    assert.equal(plain.cost, 0.015);
    const withLink = await x.manual({ text: "Try it steamvaluechecker.com", image: Buffer.from("png").toString("base64") });
    assert.equal(withLink.cost, 0.2);
    assert.equal(calls[1][1].includes("media/upload"), true, "the picture is uploaded first");
    assert.deepEqual(calls[2][2].media, { media_ids: ["m1"] });
    const s = x.status();
    assert.equal(s.history.length, 2); assert.equal(s.history[0].media, true); assert.equal(s.monthSpend, 0.22); assert.equal(s.manualToday, 2);
    // a picture that X turns down means nothing is posted
    const bad = createXPoster({ env: ENV, db: openDb(":memory:"), fetchImpl: async u => (u.includes("media") ? { ok: false, status: 400, json: async () => ({ detail: "Bad image" }) } : { ok: true, json: async () => ({ data: { id: "9" } }) }) });
    await assert.rejects(bad.manual({ text: "hi", image: "AAAA" }), /Bad image/); assert.equal(bad.status().history.length, 0);
    await x.remove("123456"); assert.equal(calls.at(-1)[0], "DELETE"); assert.equal(x.status().history.length, 0);
    await assert.rejects(x.remove("abc"), /isn't a post id/);
});

test("scheduled posts go out once they're due, in order, and a failure isn't retried", async () => {
    const db = openDb(":memory:"); let t = Date.UTC(2026, 10, 9, 15), fail = false; const sent = [];
    const x = createXPoster({ env: ENV, db, now: () => t, fetchImpl: async (u, o) => { if (fail) return { ok: false, status: 402, json: async () => ({}) }; sent.push(JSON.parse(o.body).text); return { ok: true, json: async () => ({ data: { id: "55555" } }) }; } });
    assert.throws(() => x.schedule({ text: "late", at: t - 1000 }), /future/);
    const later = x.schedule({ text: "second", at: t + 3 * 3_600_000 }), first = x.schedule({ text: "first", at: t + 3_600_000 });
    assert.deepEqual(x.status().queue.map(q => q.text), ["first", "second"], "kept in time order");
    x.unschedule(later.key); assert.equal(x.status().queue.length, 1);
    assert.deepEqual(await x.flush(), { sent: 0 });
    t += 2 * 3_600_000; assert.deepEqual(await x.flush(), { sent: 1 }); assert.deepEqual(sent, ["first"]);
    assert.equal(x.status().history[0].kind, "scheduled"); assert.equal(x.status().queue.length, 0);
    x.schedule({ text: "broken", at: t + 120_000 }); t += 3 * 60_000; fail = true;
    assert.deepEqual(await x.flush(), { sent: 0 }); assert.match(x.status().error.message, /scheduled post didn't go out/);
    fail = false; assert.deepEqual(await x.flush(), { sent: 0 }, "it was taken off the list, so it isn't tried again");
});

test("hashtags: the store's own plus a rotating few, editable, and bundles skip the free ones", async () => {
    const { hashtagsFor, bundleText, cleanTags, TEMPLATES, xLength, DEFAULT_TAGS } = await import("../src/xposter.js");
    const t = hashtagsFor("Epic Games", "Cool Game"); assert.match(t, /^#EpicGames /); assert.ok(t.split(" ").length <= 4);
    assert.notEqual(hashtagsFor("Steam", "Alpha"), hashtagsFor("Steam", "Zebra Run"), "the set changes from game to game");
    assert.match(freeGameText(game("a"), Date.UTC(2026, 10, 9)), /#EpicGames/);
    for (const tp of TEMPLATES) assert.ok(xLength(tp.text) <= 280 && /#\w+/.test(tp.text), tp.name + " fits and has tags");
    const b = { title: "Big Indie Bundle", storeName: "Humble Bundle", price: "$12", gameCount: 9, games: ["A", "B", "C"], expiresAt: Date.UTC(2027, 0, 5), url: "https://www.humblebundle.com/x" };
    const plain = bundleText(b, { tags: DEFAULT_TAGS, now: Date.UTC(2026, 10, 9) });
    assert.match(plain, /#HumbleBundle/); assert.ok(!/#(FreeGames|Giveaway|Freebie)/i.test(plain), "a bundle isn't free"); assert.match(plain, /Link in bio/); assert.ok(!/https/.test(plain));
    assert.match(bundleText(b, { link: true, now: Date.UTC(2026, 10, 9) }), /https:\/\/www\.humblebundle\.com\/x/);
    assert.ok(xLength(bundleText({ ...b, title: "x".repeat(200), games: Array(3).fill("y".repeat(80)) })) <= 280);
    assert.deepEqual(cleanTags("pcgaming, #Steam  GameDeals"), ["#pcgaming", "#Steam", "#GameDeals"]); assert.throws(() => cleanTags("bad tag!"), /can't be a hashtag/);
    const db = openDb(":memory:"), x = createXPoster({ env: ENV, db });
    x.setSettings({ tags: "#Indie #Deals" }); assert.deepEqual(x.tags(), ["#Indie", "#Deals"]); assert.equal(x.status().tags, "#Indie #Deals");
    x.setSettings({ tags: "" }); assert.deepEqual(x.tags(), DEFAULT_TAGS, "empty goes back to the usual list");
});

test("a posted bundle is remembered so the button can say so", async () => {
    const db = openDb(":memory:"); const x = createXPoster({ env: ENV, db, fetchImpl: async () => ({ ok: true, json: async () => ({ data: { id: "777777" } }) }) });
    assert.equal(x.bundlePosted("humble:1"), false);
    await x.manual({ text: "bundle post", bundleId: "humble:1" });
    assert.equal(x.bundlePosted("humble:1"), true); assert.equal(x.status().history[0].kind, "bundle");
});

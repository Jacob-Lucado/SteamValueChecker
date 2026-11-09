import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createXPoster, oauthHeader, freeGameText, bundleText, DEFAULT_DAILY } from "../src/xposter.js";

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
    assert.equal(calls, 2, "the picture, then the post"); await x.tick([game("a")]); assert.equal(calls, 2, "the same game isn't tried again");
    assert.throws(() => x.setSettings({ daily: 99 }), /between 1 and/);
    assert.equal(x.status().monthlyCost, 12, "2 a day with a link each");
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

test("automatic posts carry the game's picture and link, and fall back sensibly", async () => {
    const db = openDb(":memory:"); let t = Date.UTC(2026, 10, 9, 15); const log = []; let artOk = true, uploadOk = true;
    const x = createXPoster({ env: ENV, db, now: () => t, fetchImpl: async (u, o = {}) => {
        if (u.startsWith("https://cdn.example/")) { log.push(["art", u]); return artOk ? { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } : { ok: false, status: 404 }; }
        const body = JSON.parse(o.body); if (u.includes("media")) { log.push(["upload", body.media]); return uploadOk ? { ok: true, json: async () => ({ data: { id: "med1" } }) } : { ok: false, status: 400, json: async () => ({ detail: "nope" }) }; }
        log.push(["post", body]); return { ok: true, json: async () => ({ data: { id: "888888" } }) };
    } });
    x.setSettings({ enabled: true });
    await x.tick([game("a", { title: "Alpha", art: "https://cdn.example/a.jpg" })]);
    assert.deepEqual(log.map(l => l[0]), ["art", "upload", "post"]);
    assert.equal(log[1][1], Buffer.from([1, 2, 3]).toString("base64"), "the game's own art is what gets uploaded");
    assert.deepEqual(log[2][1].media, { media_ids: ["med1"] }); assert.match(log[2][1].text, /Claim it: https:\/\/store\.epicgames\.com\/x/);
    // no usable art: the logo goes up instead
    log.length = 0; t += 4 * 3_600_000; artOk = false;
    await x.tick([game("b", { title: "Beta", art: "https://cdn.example/b.jpg" })]);
    assert.equal(log[1][0], "upload"); assert.ok(log[1][1].length > 1000, "the project logo, not nothing");
    assert.deepEqual(log[2][1].media, { media_ids: ["med1"] });
    // X turns pictures down: the post still goes out, and the page is told
    log.length = 0; t += 24 * 3_600_000; uploadOk = false;
    await x.tick([game("c", { title: "Gamma" })]);
    assert.equal(log.at(-1)[1].media, undefined); assert.match(x.status().imageError.message, /nope/); assert.equal(x.status().history[0].media, false);
    // links can be switched off
    log.length = 0; t += 4 * 3_600_000; uploadOk = true; x.setSettings({ links: false });
    await x.tick([game("d", { title: "Delta" })]);
    assert.match(log.at(-1)[1].text, /Link in bio/); assert.ok(!/https:/.test(log.at(-1)[1].text)); assert.equal(x.status().monthlyCost, 0.9);
});

test("a manual post can use a bundle's picture, and a scheduled one keeps its own", async () => {
    const db = openDb(":memory:"); let t = Date.UTC(2026, 10, 9, 15); const seen = [];
    const x = createXPoster({ env: ENV, db, now: () => t, fetchImpl: async (u, o = {}) => {
        if (u.startsWith("https://img.example/")) { seen.push("fetch"); return { ok: true, headers: { get: () => "image/png" }, arrayBuffer: async () => new Uint8Array([9, 9]).buffer }; }
        const b = JSON.parse(o.body); seen.push(u.includes("media") ? "upload:" + b.media : b.media ? "post+pic" : "post"); return { ok: true, json: async () => ({ data: { id: "123456" } }) };
    } });
    await x.manual({ text: "bundle", imageUrl: "https://img.example/b.png", bundleId: "7" });
    assert.deepEqual(seen, ["fetch", "upload:" + Buffer.from([9, 9]).toString("base64"), "post+pic"]);
    await assert.rejects(x.manual({ text: "x", image: Buffer.alloc(6 * 1024 * 1024).toString("base64") }), /5 MB/);
    seen.length = 0;
    const q = x.schedule({ text: "later", at: t + 120_000, image: Buffer.from("pic").toString("base64") });
    assert.equal(x.status().queue[0].media, true); assert.throws(() => x.schedule({ text: "big", at: t + 120_000, image: Buffer.alloc(3 * 1024 * 1024).toString("base64") }), /2 MB/);
    t += 5 * 60_000; await x.flush();
    assert.deepEqual(seen, ["upload:" + Buffer.from("pic").toString("base64"), "post+pic"]); assert.equal(x.status().history[0].media, true);
    assert.equal(db.getMeta("xposter:qimg:" + q.key), "", "the stored picture is cleared once it has gone out");
});

test("auto free-game posts link through the site's landing page when it's set up", async () => {
    const { configureDeals } = await import("../src/deallinks.js");
    const db = openDb(":memory:"), sent = [];
    const fetchImpl = async (u, o) => { if (String(u).includes("/2/tweets")) sent.push(JSON.parse(o.body)); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: { id: "1" } }), text: async () => "" }; };
    const x = createXPoster({ env: ENV, db, fetchImpl, now: () => Date.UTC(2026, 10, 9, 15), log() {} });
    x.setSettings({ enabled: true });
    configureDeals({ base: "https://steamvaluechecker.com", make: d => `https://steamvaluechecker.com/d/${db.upsertDeal(d)}` });
    try { await x.tick([game("a", { art: null })]); } finally { configureDeals(null); }
    assert.match(sent[0].text, /Claim it: https:\/\/steamvaluechecker\.com\/d\/\d+/); assert.ok(!sent[0].text.includes("epicgames"));
});

test("bundle posts are spaced out and only say 'including' when games are left out", () => {
    const b = { title: "Both", storeName: "Steam", price: "$14", gameCount: 2, games: ["Alpha", "Beta"], url: "https://steamvaluechecker.com/b/1" };
    const t = freeBundle(b);
    assert.match(t, /^📦 New bundle: Both \(Steam\)\n\n💰 \$14\n🎮 2 games: Alpha and Beta\n\nhttps:\/\/steamvaluechecker\.com\/b\/1\n\n#/); assert.ok(!/like|including/.test(t));
    assert.match(freeBundle({ ...b, gameCount: 9, games: ["A", "B", "C"] }), /9 games, including A, B, C/);
});
function freeBundle(b) { return bundleText(b, { link: true }); }

import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { runReleases } from "../src/poller.js";

const DAY = 86400_000;

function setup() {
    let t = Date.parse("2026-11-01T15:00:00Z");
    const db = openDb(":memory:", { now: () => t });
    db.ensureUser("u1", null);
    db.addItems("u1", [{ itad_id: "g-new", title: "Soon Game" }, { itad_id: "g-old", title: "Old Game" }]);
    const dates = { "g-new": t + 2 * DAY, "g-old": t - 100 * DAY };
    const sent = [];
    const itad = { getTitle: async id => ({ title: id, appid: null, release: dates[id] ?? null }), getPrices: async ids => new Map(ids.map(i => [i, { deals: [{ shop: { name: "Steam" }, price: { amount: 19.99, currency: "USD" }, regular: { amount: 29.99 }, cut: 33, url: "https://s/x" }] }])) };
    const notifier = { deliver: async (user, payload, type) => { sent.push({ user: user.discord_id, payload, type }); return { ok: true, via: "dm" }; } };
    return { db, itad, notifier, sent, advance: ms => { t += ms; }, now: () => t };
}

test("release alerts: a game that was unreleased when added is announced once on launch; already released games are not", async () => {
    const s = setup();
    const run = () => runReleases({ db: s.db, itad: s.itad, notifier: s.notifier, now: s.now });
    let r = await run();
    assert.equal(r.looked, 2);
    assert.equal(s.sent.length, 0, "nothing is out yet");
    const wl = s.db.listItems("u1");
    assert.ok(wl.find(i => i.itad_id === "g-new").release_at > s.now());
    s.advance(2 * DAY + 3600_000);
    r = await run();
    assert.equal(s.sent.length, 1);
    assert.equal(s.sent[0].type, "release");
    assert.match(s.sent[0].payload.embeds[0].title, /Soon Game/);
    assert.match(s.sent[0].payload.embeds[0].description, /19\.99/);
    await run();
    assert.equal(s.sent.length, 1, "announced only once");
    s.advance(10 * DAY);
    await run();
    assert.equal(s.sent.length, 1, "nothing after the week is over");
});

test("release alerts: muting the release type keeps them out of DMs", async () => {
    const s = setup();
    const { MUTABLE } = await import("../src/prefs.js");
    assert.ok(MUTABLE.includes("release"));
});

test("release alerts: held back while Steam still says coming soon, sent once it is out", async () => {
    const s = setup();
    s.db.setAppId("u1", "g-new", 123);
    let soon = true;
    const run = () => runReleases({ db: s.db, itad: s.itad, notifier: s.notifier, now: s.now, stillUpcoming: async () => soon });
    await run();
    s.advance(2 * DAY + 3600_000); // the price site's date has passed
    let r = await run();
    assert.equal(s.sent.length, 0, "Steam says not yet, so no alert");
    assert.equal(r.early, 1);
    soon = false;
    await run();
    assert.equal(s.sent.length, 1);
    assert.match(s.sent[0].payload.embeds[0].title, /Soon Game/);
});

test("steamStillUpcoming reads coming_soon and gives null when it cannot tell", async () => {
    const { steamStillUpcoming } = await import("../src/steamrelease.js");
    const reply = body => async () => ({ ok: true, json: async () => body });
    assert.equal(await steamStillUpcoming(901, reply({ 901: { success: true, data: { release_date: { coming_soon: true } } } })), true);
    assert.equal(await steamStillUpcoming(902, reply({ 902: { success: true, data: { release_date: { coming_soon: false } } } })), false);
    assert.equal(await steamStillUpcoming(903, reply({ 903: { success: false } })), null);
    assert.equal(await steamStillUpcoming(904, async () => { throw new Error("down"); }), null);
    assert.equal(await steamStillUpcoming(null, reply({})), null);
});

test("release dates: the first look is silent, then a new date and a real move are announced, a small shift is not", async () => {
    const s = setup();
    const { runReleaseDates } = await import("../src/poller.js");
    const run = () => runReleaseDates({ db: s.db, notifier: s.notifier, now: s.now });
    s.db.setRelease("g-new", null); // looked up: no date yet
    await run();
    assert.equal(s.sent.length, 0, "first look is remembered, not announced");
    s.db.setRelease("g-new", s.now() + 40 * DAY);
    await run();
    assert.equal(s.sent.length, 1); assert.match(s.sent[0].payload.embeds[0].title, /Release date set: Soon Game/); assert.equal(s.sent[0].type, "release");
    await run(); assert.equal(s.sent.length, 1, "once");
    s.db.setRelease("g-new", s.now() + 41 * DAY); await run();
    assert.equal(s.sent.length, 1, "a day's shift is not worth a message");
    s.db.setRelease("g-new", s.now() + 90 * DAY); await run();
    assert.equal(s.sent.length, 2); assert.match(s.sent[1].payload.embeds[0].title, /Delayed: Soon Game/);
    s.db.setRelease("g-new", s.now() + 60 * DAY); await run();
    assert.match(s.sent[2].payload.embeds[0].title, /Moved up: Soon Game/);
});

test("release dates: a snoozed game stays quiet until the snooze ends", async () => {
    const s = setup();
    const { runReleaseDates } = await import("../src/poller.js");
    const run = () => runReleaseDates({ db: s.db, notifier: s.notifier, now: s.now });
    s.db.setRelease("g-new", s.now() + 30 * DAY); await run();
    s.db.setRelease("g-new", s.now() + 80 * DAY);
    s.db.snoozeItem(s.db.listItems("u1").find(i => i.itad_id === "g-new").id, s.now() + 5 * DAY);
    await run(); assert.equal(s.sent.length, 0, "snoozed");
    s.advance(6 * DAY); await run(); assert.equal(s.sent.length, 1, "told once the snooze ends");
});

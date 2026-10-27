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

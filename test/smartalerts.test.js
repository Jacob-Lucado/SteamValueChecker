import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { runReviewDrops, runWinBack, runTimeCapsule, capsuleEmbed } from "../src/smartalerts.js";

const DAY = 86400_000;
function world(clock = { t: Date.now() }) {
    const db = openDb(":memory:", { now: () => clock.t });
    db.ensureUser("u1", null);
    db.updateUser("u1", { smart: 1 });
    const sent = [];
    const notifier = { deliver: async (user, payload, kind) => { sent.push({ user: user.discord_id, payload, kind }); return { ok: true, via: "dm" }; } };
    return { db, sent, notifier };
}

test("review drops: told once a month, only for wishlist games you don't own", async () => {
    const { db, sent, notifier } = world();
    db.addItems("u1", [{ itad_id: "a", title: "Bombed", appid: 1 }, { itad_id: "b", title: "Fine", appid: 2 }, { itad_id: "c", title: "Owned Bombed", appid: 3 }]);
    db.setAppId("u1", "a", 1); db.setAppId("u1", "b", 2); db.setAppId("u1", "c", 3);
    db.syncSteamGames("u1", [{ itad_id: "c", title: "Owned Bombed", appid: 3, minutes: 100, lastPlayed: null }]);
    const reviews = async appid => (appid === 2 ? { pct: 90, total: 900 } : { pct: 85, total: 5000, dip: { pct: 40, total: 300, drop: 45 } });
    const t = Date.parse("2026-11-20T15:00:00Z");
    const r1 = await runReviewDrops({ db, notifier, reviews, now: () => t });
    assert.equal(r1.delivered, 1);
    assert.equal(sent.length, 1);
    assert.match(sent[0].payload.embeds[0].title, /Bombed/);
    assert.equal(sent[0].kind, "smart");
    const r2 = await runReviewDrops({ db, notifier, reviews, now: () => t + 8 * DAY });
    assert.equal(r2.delivered, 0, "same month, already told");
});

test("review drops: nobody is checked when smart alerts are off", async () => {
    const { db, notifier } = world();
    db.updateUser("u1", { smart: 0 });
    db.addItems("u1", [{ itad_id: "a", title: "Bombed", appid: 1 }]); db.setAppId("u1", "a", 1);
    const r = await runReviewDrops({ db, notifier, reviews: async () => ({ dip: { pct: 1, total: 99, drop: 50 }, pct: 80 }), now: () => Date.now() });
    assert.equal(r.checked, 0);
});

test("win-back: a fresh patch for a game with hours and no recent play", async () => {
    const { db, sent, notifier } = world();
    const now = Date.parse("2026-11-20T15:00:00Z");
    db.syncSteamGames("u1", [
        { itad_id: "g1", title: "Left Alone", appid: 10, minutes: 1200, lastPlayed: Math.floor((now - 120 * DAY) / 1000) },
        { itad_id: "g2", title: "Still Playing", appid: 20, minutes: 1200, lastPlayed: Math.floor((now - 2 * DAY) / 1000) },
        { itad_id: "g3", title: "Barely Touched", appid: 30, minutes: 20, lastPlayed: null }
    ]);
    const posts = { 10: [{ gid: "p1", patch: true, date: now - DAY, title: "Update 1.2", url: "https://x" }], 20: [{ gid: "p2", patch: true, date: now - DAY, title: "Hotfix" }], 30: [{ gid: "p3", patch: true, date: now - DAY, title: "Patch" }] };
    const news = { forApps: async ids => new Map(ids.map(id => [id, posts[id] ?? []])) };
    const r = await runWinBack({ db, news, notifier, now: () => now });
    assert.equal(r.delivered, 1);
    assert.match(sent[0].payload.embeds[0].title, /Left Alone/);
    assert.match(sent[0].payload.embeds[0].description, /20 hours/);
    const again = await runWinBack({ db, news, notifier, now: () => now });
    assert.equal(again.delivered, 0, "each patch is told once");
});

test("time capsule: sends what was added a year ago, once a day, and nothing on empty days", async () => {
    const now = Date.parse("2026-11-20T15:00:00Z");
    const clock = { t: now - 365 * DAY };
    const { db, sent, notifier } = world(clock);
    db.addItems("u1", [{ itad_id: "w1", title: "Wished Long Ago", appid: 7 }]);
    clock.t = now - 200 * DAY;
    db.addItems("u1", [{ itad_id: "w2", title: "Wished Recently", appid: 8 }]);
    const r0 = await runTimeCapsule({ db, notifier, now: () => now });
    assert.equal(r0.delivered, 1);
    assert.match(sent[0].payload.embeds[0].description, /Wished Long Ago/);
    assert.doesNotMatch(sent[0].payload.embeds[0].description, /Recently/);
    assert.equal((await runTimeCapsule({ db, notifier, now: () => now })).delivered, 0, "once a day");
    const empty = await runTimeCapsule({ db, notifier, now: () => now + 30 * DAY });
    assert.equal(empty.delivered, 0, "nothing from a year before that day");
});

test("capsule card words each kind of entry", () => {
    const e = capsuleEmbed([
        { kind: "wish", title: "A", owned: true, minutes: 600, appid: 1 },
        { kind: "wish", title: "B", owned: false, minutes: 0 },
        { kind: "lib", title: "C", minutes: 0 },
        { kind: "lib", title: "D", minutes: 3000 }
    ], 2);
    assert.match(e.description, /A\*\*: you wishlisted it, and you own it now \(10 hours played\)/);
    assert.match(e.description, /B\*\*: you wishlisted it and it's still waiting/);
    assert.match(e.description, /C\*\*.*still untouched/);
    assert.match(e.description, /D\*\*.*50 hours since/);
    assert.match(e.description, /and 2 more/);
});

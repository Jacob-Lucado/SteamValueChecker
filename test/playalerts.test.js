import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { runRefundWarnings, runMilestones, refundEmbed, milestoneEmbed, highestMilestone } from "../src/playalerts.js";
import { prefsPatch } from "../src/prefs.js";

const DAY = 86400_000, T0 = Date.parse("2026-11-03T15:00:00Z");

function world() {
    let t = T0;
    const db = openDb(":memory:", { now: () => t });
    db.ensureUser("u1", null); db.updateUser("u1", { refund: 1, milestones: 1 });
    db.setSteamLink("u1", "76561190000000001", true);
    const sent = [];
    const notifier = { deliver: async (u, p, kind) => { sent.push({ p, kind }); return { ok: true, via: "dm" }; } };
    return { db, sent, notifier, at: v => { t = v; }, now: () => t };
}

test("refund: only a recent, barely played Steam game is warned about, once, two days before the window closes", async () => {
    const w = world();
    w.db.syncSteamGames("u1", [{ itad_id: "old", title: "Old Game", appid: 1, minutes: 10 }]); // first import
    w.at(T0 + DAY);
    w.db.syncSteamGames("u1", [{ itad_id: "old", title: "Old Game", appid: 1, minutes: 10 }, { itad_id: "new", title: "New Game", appid: 2, minutes: 30 }, { itad_id: "played", title: "Played", appid: 3, minutes: 500 }]);
    assert.equal((await runRefundWarnings({ db: w.db, notifier: w.notifier, now: w.now })).found, 0); // too early
    w.at(T0 + DAY + 12.5 * DAY);
    const s = await runRefundWarnings({ db: w.db, notifier: w.notifier, now: w.now });
    assert.equal(s.delivered, 1);
    assert.match(w.sent[0].p.embeds[0].title, /New Game/);
    assert.equal(w.sent[0].kind, "refund");
    assert.equal((await runRefundWarnings({ db: w.db, notifier: w.notifier, now: w.now })).found, 0); // not twice
    w.at(T0 + DAY + 15 * DAY);
    assert.equal((await runRefundWarnings({ db: w.db, notifier: w.notifier, now: w.now })).found, 0); // window over
});

test("refund: off by default and quiet hours defer", async () => {
    const w = world(); w.db.updateUser("u1", { refund: 0 });
    assert.equal((await runRefundWarnings({ db: w.db, notifier: w.notifier, now: w.now })).checked, 0);
    assert.match(refundEmbed({ title: "X", appid: 5, hoursLeft: 20, minutes: 40 }).title, /about a day/);
    assert.match(refundEmbed({ title: "X", appid: 5, hoursLeft: 40, minutes: 0 }).title, /2 days/);
});

test("milestones: first check is quiet, then a card per newly passed milestone, once", async () => {
    const w = world();
    w.db.syncSteamGames("u1", [{ itad_id: "a", title: "Alpha", appid: 1, minutes: 7000 }, { itad_id: "b", title: "Beta", appid: 2, minutes: 5000 }]);
    assert.equal((await runMilestones({ db: w.db, notifier: w.notifier, now: w.now })).found, 0);
    w.db.syncSteamGames("u1", [{ itad_id: "a", title: "Alpha", appid: 1, minutes: 7100 }, { itad_id: "b", title: "Beta", appid: 2, minutes: 6100 }]);
    const s = await runMilestones({ db: w.db, notifier: w.notifier, now: w.now });
    assert.equal(s.delivered, 1);
    assert.match(w.sent[0].p.embeds[0].title, /100 hours in Beta/);
    assert.equal((await runMilestones({ db: w.db, notifier: w.notifier, now: w.now })).found, 0);
});

test("milestones: helpers and prefs", () => {
    assert.equal(highestMilestone(99 * 60), null); assert.equal(highestMilestone(600 * 60), 500); assert.equal(highestMilestone(5000 * 60), 2000);
    assert.match(milestoneEmbed({ title: "G", appid: 1, hours: 100, minutes: 6100 }).description, /101 hours/);
    assert.deepEqual(prefsPatch({ refund: true, milestones: false }, {}), { refund: 1, milestones: 0 });
});

test("backlog pick: once a month, the biggest unplayed spend, nothing for an empty backlog", async () => {
    const { runBacklogNudge } = await import("../src/nudge.js");
    const w = world(); w.db.updateUser("u1", { nudge: 1 });
    w.db.upsertLibrary("u1", [{ itad_id: "a", title: "Cheap", paid: 5 }, { itad_id: "b", title: "Pricey", paid: 60 }]);
    const s = await runBacklogNudge({ db: w.db, notifier: w.notifier, now: w.now });
    assert.equal(s.delivered, 1); assert.match(w.sent.at(-1).p.embeds[0].title, /Pricey/); assert.equal(w.sent.at(-1).kind, "nudge");
    assert.equal((await runBacklogNudge({ db: w.db, notifier: w.notifier, now: w.now })).checked, 0);
    w.at(T0 + 40 * DAY);
    assert.equal((await runBacklogNudge({ db: w.db, notifier: w.notifier, now: w.now })).delivered, 1);
    assert.deepEqual(prefsPatch({ nudge: true }, {}), { nudge: 1 });
});

test("achievement heads-up: quiet first look, then once per nearly complete game that was played a lot", async () => {
    const { runAchievementNudges } = await import("../src/nudge.js");
    const w = world(); w.db.updateUser("u1", { achv: 1 });
    w.db.syncSteamGames("u1", [{ itad_id: "a", title: "Alpha", appid: 1, minutes: 900 }, { itad_id: "b", title: "Beta", appid: 2, minutes: 900 }, { itad_id: "c", title: "Short", appid: 3, minutes: 60 }]);
    w.db.setAchievements("u1", "a", { done: 40, total: 50 }); w.db.setAchievements("u1", "c", { done: 9, total: 10 });
    assert.equal((await runAchievementNudges({ db: w.db, notifier: w.notifier, now: w.now })).found, 0); // first look
    w.db.setAchievements("u1", "a", { done: 48, total: 50 }); w.db.setAchievements("u1", "b", { done: 29, total: 30 });
    const s = await runAchievementNudges({ db: w.db, notifier: w.notifier, now: w.now });
    assert.equal(s.delivered, 2);
    const titles = w.sent.at(-1).p.embeds.map(e => e.title).join("|");
    assert.match(titles, /One achievement left in Beta/); assert.match(titles, /2 achievements left in Alpha/); assert.doesNotMatch(titles, /Short/);
    assert.equal((await runAchievementNudges({ db: w.db, notifier: w.notifier, now: w.now })).found, 0);
    assert.deepEqual(prefsPatch({ achv: true }, {}), { achv: 1 });
});

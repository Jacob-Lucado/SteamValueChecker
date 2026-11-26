import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { toWins, winsSummary, winsFor, currencyOfRegion } from "../src/alertwins.js";

const DAY = 86400_000, T = Date.UTC(2026, 10, 1);
const row = (o = {}) => ({ itad_id: "a", title: "Hades", shop: "Steam", price: 10, regular: 25, at: T, paid: null, owned_at: T + DAY, ...o });

test("a sale alert followed by owning the game within two weeks counts, with the savings against the regular price", () => {
    const [w] = toWins([row()]);
    assert.equal(w.saved, 15); assert.equal(w.paid, 10); assert.equal(w.actual, false);
    assert.equal(toWins([row({ paid: 8 })])[0].saved, 17, "what you really paid wins when the library has it");
    assert.deepEqual(toWins([row({ owned_at: T + 15 * DAY })]), [], "too late to credit the alert");
    assert.deepEqual(toWins([row({ owned_at: T - DAY })]), [], "owned before the alert");
    assert.deepEqual(toWins([row({ regular: 0 })]), [], "no regular price, no claim");
    assert.deepEqual(toWins([row({ price: 30 })]), [], "no saving, no win");
});

test("one win per game, the biggest first, and the summary adds them up", () => {
    const wins = toWins([row(), row({ at: T + 2 * DAY, owned_at: T + 3 * DAY, price: 5 }), row({ itad_id: "b", title: "Celeste", price: 5, regular: 21, owned_at: T + 5 * DAY })]);
    assert.equal(wins.length, 2); assert.equal(wins[0].title, "Celeste", "biggest saving first"); assert.equal(wins[1].paid, 10, "the earliest alert for a game is the one credited");
    const s = winsSummary(wins); assert.equal(s.count, 2); assert.equal(s.saved, 31); assert.equal(s.best.title, "Celeste");
    assert.equal(winsSummary(wins, { since: T + 2 * DAY }).count, 1);
});

test("the database joins alerts to the library, only for sale alerts and only for that member", () => {
    const db = openDb(":memory:");
    db.ensureUser("u1"); db.ensureUser("u2");
    db.logAlert({ discord_id: "u1", itad_id: "a", title: "Hades", kind: "sale", price: 10, regular: 25, shop: "Steam", via: "dm" });
    db.logAlert({ discord_id: "u1", itad_id: "b", title: "Celeste", kind: "free", price: 0, regular: 20, via: "dm" });
    db.upsertLibrary("u1", [{ itad_id: "a", title: "Hades", paid: null }, { itad_id: "b", title: "Celeste", paid: null }]);
    const rows = db.alertWinRows("u1");
    assert.deepEqual(rows.map(r => r.itad_id), ["a"]);
    assert.equal(winsFor(db, "u1").length, 1); assert.equal(winsFor(db, "u2").length, 0);
    assert.equal(currencyOfRegion("GB"), "GBP"); assert.equal(currencyOfRegion(null), "USD");
});

test("the monthly recap goes out once, only to members with a win, and says what was saved", async () => {
    const { runAlertWins, winsEmbed } = await import("../src/alertwins.js");
    const db = openDb(":memory:");
    db.ensureUser("u1"); db.ensureUser("u2");
    db.logAlert({ discord_id: "u1", itad_id: "a", title: "Hades", kind: "sale", price: 10, regular: 25, shop: "Steam", via: "dm" });
    db.upsertLibrary("u1", [{ itad_id: "a", title: "Hades", paid: null }]);
    const sent = [];
    const notifier = { deliver: async (u, p) => { sent.push([u.discord_id, p]); return { ok: true, via: "dm" }; } };
    const r = await runAlertWins({ db, notifier });
    assert.equal(r.delivered, 1); assert.equal(sent[0][0], "u1");
    assert.match(sent[0][1].embeds[0].title, /\$15\.00/); assert.match(sent[0][1].embeds[0].description, /Hades/);
    assert.equal((await runAlertWins({ db, notifier })).delivered, 0, "not again this month");
    assert.match(winsEmbed({ count: 1, saved: 5, list: [{ title: "X", paid: 5, regular: 10 }] }, "EUR").embeds[0].title, /€5\.00/);
});

test("the share card draws the total and the best catches, and renders to a picture", async () => {
    const { winsCardSvg, toPng } = await import("../src/communitycards.js");
    const svg = winsCardSvg({ name: "Jacob", saved: 31, count: 2, currency: "USD", wins: [{ title: "Celeste", paid: 5, regular: 21 }, { title: "Hades <3 & co", paid: 10, regular: 25 }] });
    assert.match(svg, /\$31\.00/); assert.match(svg, /2 games/); assert.match(svg, /Hades &lt;3 &amp; co/); assert.match(svg, /JACOB'S ALERT WINS/);
    const png = toPng(svg);
    assert.equal(png.subarray(1, 4).toString(), "PNG");
});

test("wins are kept in the ledger after the alert log forgets them", () => {
    const db = openDb(":memory:");
    db.ensureUser("u1");
    db.logAlert({ discord_id: "u1", itad_id: "a", title: "Hades", kind: "sale", price: 10, regular: 25, shop: "Steam", via: "dm" });
    db.upsertLibrary("u1", [{ itad_id: "a", title: "Hades", paid: null }]);
    assert.equal(winsFor(db, "u1").length, 1);
    db.pruneAlertLog(-60_000); // everything is now older than the cutoff
    assert.equal(db.alertWinRows("u1").length, 0, "the alert log is empty");
    const [w] = winsFor(db, "u1");
    assert.equal(w.title, "Hades"); assert.equal(w.saved, 15, "but the win is still there");
});

test("a savings goal is validated, and progress counts this calendar year only", async () => {
    const { getGoal, setGoal, goalProgress } = await import("../src/alertwins.js");
    const db = openDb(":memory:"); db.ensureUser("u1");
    assert.equal(getGoal(db, "u1"), null);
    assert.equal(setGoal(db, "u1", "200.456"), 200.46); assert.equal(getGoal(db, "u1"), 200.46);
    assert.throws(() => setGoal(db, "u1", 0), RangeError); assert.throws(() => setGoal(db, "u1", 1e9), RangeError); assert.throws(() => setGoal(db, "u1", "abc"), RangeError);
    assert.equal(setGoal(db, "u1", null), null); assert.equal(getGoal(db, "u1"), null, "clearing removes it");
    const at = Date.UTC(2026, 10, 26);
    const wins = [{ saved: 30, ownedAt: Date.UTC(2026, 2, 1) }, { saved: 50, ownedAt: Date.UTC(2025, 11, 31) }, { saved: 10, ownedAt: Date.UTC(2026, 9, 1) }];
    assert.deepEqual(goalProgress(wins, 100, at), { goal: 100, saved: 40, pct: 40, left: 60, hit: false });
    assert.equal(goalProgress(wins, 40, at).hit, true); assert.equal(goalProgress(wins, 20, at).pct, 100);
    assert.equal(goalProgress(wins, null, at).goal, null);
});

test("the daily pass records wins, and tells a member once when they reach their goal", async () => {
    const { runAlertWins, setGoal } = await import("../src/alertwins.js");
    const db = openDb(":memory:"); db.ensureUser("u1");
    db.logAlert({ discord_id: "u1", itad_id: "a", title: "Hades", kind: "sale", price: 10, regular: 25, shop: "Steam", via: "dm" });
    db.upsertLibrary("u1", [{ itad_id: "a", title: "Hades", paid: null }]);
    setGoal(db, "u1", 10);
    const sent = [], notifier = { deliver: async (u, p) => { sent.push(p.embeds[0].title); return { ok: true }; } };
    const r = await runAlertWins({ db, notifier });
    assert.equal(r.goals, 1); assert.ok(sent.some(t => /hit your savings goal of \$10\.00/.test(t)));
    assert.equal(db.listWins("u1").length, 1, "recorded");
    db.setMeta("wins:sync", "");
    assert.equal((await runAlertWins({ db, notifier })).goals, 0, "the same goal is not announced twice");
});

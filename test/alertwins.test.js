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

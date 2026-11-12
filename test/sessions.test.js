import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { PAST_SALES, SALES, calendarRunningOut, salesBefore } from "../src/salescal.js";

test("sign-ins are kept in the database, by a hash, and expired ones are dropped", () => {
    let t = 1_000;
    const db = openDb(":memory:", { now: () => t });
    db.saveSession("h:abc", "u1", JSON.stringify({ userId: "u1", expires: 5_000 }), 5_000);
    db.saveSession("h:old", "u2", JSON.stringify({ userId: "u2", expires: 500 }), 500);
    assert.deepEqual(db.loadSessions().map(r => r.id), ["h:abc"]);
    db.saveSession("h:abc", "u1", JSON.stringify({ userId: "u1", expires: 9_000 }), 9_000);
    assert.equal(JSON.parse(db.loadSessions()[0].data).expires, 9_000);
    db.dropSession("h:abc");
    assert.equal(db.loadSessions().length, 0);
});

test("deleting a member's data also signs them out everywhere", () => {
    const db = openDb(":memory:");
    db.ensureUser("u1");
    db.saveSession("h:abc", "u1", "{}", Date.now() + 60_000);
    db.deleteUser("u1");
    assert.equal(db.loadSessions().length, 0);
});

test("sale calendar: the Autumn Sale sits in early October, and the calendar says when it runs dry", () => {
    const autumn = PAST_SALES.filter(s => /autumn/i.test(s.name)).map(s => new Date(s.start).toISOString().slice(0, 10));
    assert.deepEqual(autumn, ["2025-09-29", "2026-10-01"]);
    const nov = Date.parse("2026-11-12T00:00:00Z");
    assert.ok(salesBefore(nov).some(s => new Date(s.start).toISOString().startsWith("2026-10-01")));
    assert.equal(calendarRunningOut(nov), false);
    const last = Math.max(...SALES.map(s => s.start));
    assert.equal(calendarRunningOut(last - 30 * 86400_000), true);
});

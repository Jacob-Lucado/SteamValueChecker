import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { pushEvent, readEvents, groupErrors } from "../src/adminlog.js";

test("event lists keep the newest first and stop at the cap", () => {
    const db = openDb(":memory:");
    for (let i = 0; i < 5; i++) pushEvent(db, "k", { i }, 3);
    assert.deepEqual(readEvents(db, "k").map(e => e.i), [4, 3, 2]);
    assert.deepEqual(readEvents(db, "missing"), []);
    db.setMeta("bad", "{not json");
    assert.deepEqual(readEvents(db, "bad"), []);
});

test("errors group by where and what, ignoring ids and numbers", () => {
    const lines = [
        { at: 1, text: "[music] Lost connection to 1234567890123" },
        { at: 5, text: "[music] Lost connection to 9999999999999" },
        { at: 3, text: "[dashboard] Something else" },
        { at: 4, text: "plain crash text\nat stack" }
    ];
    const g = groupErrors(lines);
    assert.equal(g[0].where, "music");
    assert.equal(g[0].count, 2);
    assert.equal(g[0].last, 5);
    assert.ok(g.some(x => x.where === "other" && x.message === "plain crash text"));
});

import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { pushEvent } from "../src/adminlog.js";
import { easternWeek, runOwnerSummary, runReleaseNotes } from "../src/ownersummary.js";

const MON = Date.parse("2026-11-09T14:00:00Z"), TUE = Date.parse("2026-11-10T14:00:00Z");

test("owner summary: goes out once on Monday, counts the week's joins, leaves and votes", async () => {
    const db = openDb(":memory:"), sent = [];
    pushEvent(db, "adminlog:servers", { kind: "join", at: MON - 86_400_000 });
    pushEvent(db, "adminlog:servers", { kind: "join", at: MON - 2 * 86_400_000 });
    pushEvent(db, "adminlog:servers", { kind: "leave", at: MON - 3 * 86_400_000 });
    pushEvent(db, "adminlog:servers", { kind: "join", at: MON - 30 * 86_400_000 });
    pushEvent(db, "topgg:recent", { id: "1", at: MON - 3600_000 });
    const args = { db, ownerId: "o1", sendDm: async (id, p) => sent.push([id, p]), gather: async () => ({ servers: 9, errors: 3, diskPct: 40 }) };
    assert.equal((await runOwnerSummary({ ...args, now: () => TUE })).sent, false);
    assert.equal((await runOwnerSummary({ ...args, now: () => MON })).sent, true);
    assert.equal((await runOwnerSummary({ ...args, now: () => MON + 3600_000 })).sent, false);
    assert.equal(sent.length, 1);
    const f = sent[0][1].embeds[0].fields;
    assert.match(f[0].value, /\*\*9\*\*.*\+2 \/ -1/);
    assert.equal(f[1].value, "**1**");
});

test("owner summary: no owner, no message; a failing gather still sends", async () => {
    const db = openDb(":memory:"), sent = [];
    assert.equal((await runOwnerSummary({ db, ownerId: null, sendDm: async () => sent.push(1), now: () => MON })).sent, false);
    await runOwnerSummary({ db, ownerId: "o", sendDm: async () => sent.push(1), gather: async () => { throw new Error("x"); }, now: () => MON });
    assert.equal(sent.length, 1);
});

test("easternWeek: late Sunday night in Eastern is still Sunday", () => {
    assert.equal(easternWeek(Date.parse("2026-11-09T03:00:00Z")).weekday, "Sun");
});

test("release notes: first run only records, a new version posts once", async () => {
    const db = openDb(":memory:"), posts = [];
    const base = { db, channelId: "c1", sendChannel: async (c, p) => posts.push([c, p]) };
    const entry = { title: "New thing", date: "2026-11-09", items: ["One", "Two"] };
    assert.equal((await runReleaseNotes({ ...base, version: "1", entry })).recorded, true);
    assert.equal(posts.length, 0);
    assert.equal((await runReleaseNotes({ ...base, version: "2", entry })).posted, true);
    assert.equal((await runReleaseNotes({ ...base, version: "2", entry })).posted, false);
    assert.equal(posts.length, 1);
    assert.match(posts[0][1].embeds[0].description, /• One\n• Two/);
    assert.equal((await runReleaseNotes({ ...base, channelId: null, version: "3", entry })).posted, false);
});

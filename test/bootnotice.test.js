import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { runBootNotice, bootEmbed } from "../src/bootnotice.js";

test("boot notice: says update or restart, and holds close restarts to one message", async () => {
    const db = openDb(":memory:"), sent = [];
    const send = async (id, p) => sent.push(p.embeds[0]);
    const base = { db, ownerId: "o", sendDm: send, servers: 7 };
    assert.equal((await runBootNotice({ ...base, version: "1", now: () => 1_000_000 })).sent, true);
    assert.match(sent[0].description, /First start/);
    assert.equal((await runBootNotice({ ...base, version: "2", now: () => 1_100_000 })).sent, false, "ten minutes haven't passed");
    assert.equal((await runBootNotice({ ...base, version: "2", now: () => 2_000_000 })).sent, true);
    assert.match(sent[1].description, /Updated from 1/);
    await runBootNotice({ ...base, version: "2", errors: 3, topError: "[x] boom (3)", now: () => 9_000_000 });
    assert.match(sent[2].description, /Restarted/);
    assert.match(sent[2].title, /with errors/);
    assert.equal(sent[2].fields.at(-1).value, "[x] boom (3)");
});

test("boot notice: no owner, no message", async () => {
    assert.equal((await runBootNotice({ db: openDb(":memory:"), ownerId: null, sendDm: async () => { throw new Error("no"); }, version: "1" })).sent, false);
    assert.equal(bootEmbed({ version: "1", previous: "1", servers: null, errors: 0 }).fields[1].value, "**-**");
});

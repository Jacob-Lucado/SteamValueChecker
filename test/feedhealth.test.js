import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createFeedHealth, explain } from "../src/feedhealth.js";
import { runCodes } from "../src/codes.js";
import { listProblems } from "../src/guildproblems.js";

class ApiErr extends Error { constructor(status, detail) { super(`Discord returned HTTP ${status}.`); this.status = status; this.detail = detail; } }
const DAY = 86400_000;

function setup() {
    const db = openDb(":memory:");
    const clock = { t: Date.parse("2026-11-21T06:00:00Z") };
    const logs = [], dms = [];
    const health = createFeedHealth({ db, now: () => clock.t, log: m => logs.push(m),
        guildInfo: async () => ({ name: "Akatsuki", ownerId: "owner1", channelName: "free-codes" }),
        sendDm: async (id, p) => { dms.push({ id, p }); } });
    return { db, clock, logs, dms, health };
}

test("explain turns Discord's answers into plain words and decides if they are permanent", () => {
    const miss = explain(new ApiErr(403, "Missing Access (code 50001)"));
    assert.equal(miss.code, 50001); assert.equal(miss.permanent, true);
    assert.match(miss.why, /can't see that channel/);
    assert.match(miss.short, /403 50001 Missing Access/);
    assert.match(explain(new ApiErr(403, "Missing Permissions (code 50013)")).why, /Embed Links/);
    assert.match(explain({ code: 10003, message: "Unknown Channel" }).why, /deleted/);
    const slow = explain(new ApiErr(429, null)); assert.equal(slow.permanent, false);
    assert.equal(explain(new ApiErr(503, null)).permanent, false);
});

test("the log names the server and channel and the owner is told on the second permanent failure, once a week", async () => {
    const { health, logs, dms, clock, db } = setup();
    const err = new ApiErr(403, "Missing Access (code 50001)");
    const r1 = await health.report({ feature: "codes", guildId: "g1", channelId: "c1", err });
    assert.match(r1.line, /Game code posts failed in "Akatsuki" \(g1\), #free-codes c1: 403 50001 Missing Access\./);
    assert.match(r1.line, /Skipping it for 24 hours/);
    assert.match(r1.line, /Will message the owner if it keeps failing \(1\/2\)/);
    assert.equal(dms.length, 0);
    assert.equal(health.blocked("codes", "g1"), true, "backs off right away");
    clock.t += DAY + 1000;
    assert.equal(health.blocked("codes", "g1"), false, "and tries again tomorrow");
    const r2 = await health.report({ feature: "codes", guildId: "g1", channelId: "c1", err });
    assert.match(r2.line, /Owner \(owner1\) notified by DM/);
    assert.equal(dms.length, 1); assert.equal(dms[0].id, "owner1");
    const embed = dms[0].p.embeds[0];
    assert.match(embed.title, /Akatsuki/); assert.match(embed.description, /#free-codes/); assert.match(embed.description, /Missing Access/); assert.match(embed.description, /\/codes channel/);
    clock.t += DAY + 1000;
    const r3 = await health.report({ feature: "codes", guildId: "g1", channelId: "c1", err });
    assert.equal(dms.length, 1, "not again for a week");
    assert.match(r3.line, /Owner was told 1 day/);
    clock.t += 7 * DAY;
    await health.report({ feature: "codes", guildId: "g1", channelId: "c1", err });
    assert.equal(dms.length, 2, "a week later it asks again");
    assert.equal(health.list().length, 1);
    assert.ok(logs.length >= 4);
});

test("closed DMs are logged, and the owner is not hammered every cycle", async () => {
    const db = openDb(":memory:"); const clock = { t: Date.now() }; const logs = []; let tries = 0;
    const health = createFeedHealth({ db, now: () => clock.t, log: m => logs.push(m), guildInfo: async () => ({ name: "S", ownerId: "o", channelName: null }), sendDm: async () => { tries++; throw Object.assign(new Error("x"), { detail: "Cannot send messages to this user (code 50007)" }); } });
    const err = new ApiErr(403, "Missing Access (code 50001)");
    await health.report({ feature: "bundles", guildId: "g", channelId: "c", err });
    clock.t += DAY + 1; const r = await health.report({ feature: "bundles", guildId: "g", channelId: "c", err });
    assert.match(r.line, /couldn't be messaged/); assert.equal(tries, 1);
    clock.t += DAY + 1; await health.report({ feature: "bundles", guildId: "g", channelId: "c", err });
    assert.equal(tries, 1, "waits instead of retrying the DM tomorrow");
});

test("a transient failure doesn't back off and only reaches the owner after six in a row", async () => {
    const { health, dms } = setup();
    const err = new ApiErr(503, null);
    for (let n = 1; n <= 5; n++) { const r = await health.report({ feature: "deals", guildId: "g2", channelId: "c", err }); assert.equal(health.blocked("deals", "g2"), false); assert.equal(dms.length, 0, "try " + n); void r; }
    await health.report({ feature: "deals", guildId: "g2", channelId: "c", err });
    assert.equal(dms.length, 1);
});

test("a working post clears the failure and the server's problem list", async () => {
    const { health, db, logs } = setup();
    await health.report({ feature: "feed", guildId: "g3", channelId: "c", err: new ApiErr(403, "Missing Access (code 50001)") });
    assert.equal(listProblems(db, "g3").length, 1, "the server's dashboard shows it");
    assert.equal(health.ok("feed", "g3"), true);
    assert.equal(listProblems(db, "g3").length, 0);
    assert.equal(health.list().length, 0);
    assert.match(logs.at(-1), /work again in "Akatsuki"/);
    assert.equal(health.ok("feed", "g3"), false);
});

test("runCodes skips a backed-off server and reports through health with the real Discord answer", async () => {
    const db = openDb(":memory:");
    const clock = { t: Date.parse("2026-11-21T06:00:00Z") };
    const logs = [];
    const health = createFeedHealth({ db, now: () => clock.t, log: m => logs.push(m), guildInfo: async () => ({ name: "Akatsuki", ownerId: "o", channelName: "codes" }), sendDm: async () => {} });
    db.setCodeSettings("g1", { channel_id: "c1" });
    const attempts = [];
    const api = { sendMessage: async (c) => { attempts.push(c); throw new ApiErr(403, "Missing Access (code 50001)"); }, editMessage: async () => {} };
    const code = { key: "x:aaaaa", provider: "x", code: "AAAAA-BBBBB", game: "borderlands4", platform: null, reward: "a skin", note: null, expiresAt: null, sourceUrl: null };
    const run = () => runCodes({ db, api, health, now: () => clock.t, sleep: async () => {}, pace: 0, log: m => logs.push(m), fetchCodes: async () => [code] });
    await run();
    assert.equal(attempts.length, 1, "it tried once");
    assert.match(logs.join("\n"), /Akatsuki/);
    const before = attempts.length;
    await run();
    assert.equal(attempts.length, before, "blocked for a day, so no second attempt");
});

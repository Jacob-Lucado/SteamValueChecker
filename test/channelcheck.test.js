import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { configuredChannels, checkChannels, checkEmbed } from "../src/channelcheck.js";

test("channel check: lists only the channels a server picked, names what is wrong, and says how to fix it", async () => {
    const db = openDb(":memory:");
    db.setGuildChannel("g1", "c-alerts", "u1");
    db.setCodeSettings("g1", { channel_id: "c-codes" });
    db.setBundleFeedSettings("g1", { channel_id: "c-bundles" });
    assert.deepEqual(configuredChannels(db, "g1").map(c => c.feature), ["feed", "codes", "bundles"]);
    const seen = { "c-alerts": { exists: true, name: "alerts", missing: [] }, "c-codes": { exists: false }, "c-bundles": { exists: true, name: "deals", missing: ["Embed Links"] } };
    const res = await checkChannels({ db, guildId: "g1", inspect: async id => seen[id] });
    assert.equal(res.bad, 2);
    assert.equal(res.rows[0].ok, true);
    assert.match(res.rows[1].problem, /deleted or I can't see it/);
    assert.match(res.rows[1].fix, /\/codes channel/);
    assert.match(res.rows[2].problem, /Embed Links/);
    const e = checkEmbed(res);
    assert.match(e.title, /2 problems/);
    assert.match(e.description, /✅ \*\*Free game posts\*\*/);
});

test("channel check: a server with nothing set up, and a channel that cannot be looked at", async () => {
    const db = openDb(":memory:");
    assert.match(checkEmbed(await checkChannels({ db, guildId: "g9", inspect: async () => null })).description, /No post channels/);
    db.setDropSettings("g9", { channel_id: "c1" });
    const r = await checkChannels({ db, guildId: "g9", inspect: async () => { throw new Error("x"); } });
    assert.equal(r.rows[0].ok, false);
    assert.match(r.rows[0].problem, /couldn't look/);
});

test("channel audit: puts a blocked channel on the server's problem list, clears it once fixed, and runs once a day", async () => {
    const { runChannelAudit } = await import("../src/channelcheck.js");
    const { listProblems } = await import("../src/guildproblems.js");
    const db = openDb(":memory:");
    db.setCodeSettings("g1", { channel_id: "c1" });
    let state = { exists: true, name: "codes", missing: ["Embed Links"] }, t = 1_800_000_000_000;
    const lines = [], inspectFor = () => async () => state;
    const run = () => runChannelAudit({ db, guildIds: ["g1", "g2"], inspectFor, now: () => t, log: m => lines.push(m) });
    let r = await run();
    assert.equal(r.servers, 1, "g2 has nothing set up");
    assert.equal(r.problems, 1);
    assert.match(listProblems(db, "g1")[0].why, /missing: Embed Links/);
    assert.match(lines[0], /Channel check: Game code posts in server g1, channel c1/);
    assert.equal((await run()).skipped, true, "not again the same day");
    t += 21 * 3_600_000; state = { exists: true, name: "codes", missing: [] };
    r = await run();
    assert.equal(r.problems, 0);
    assert.deepEqual(listProblems(db, "g1").filter(p => p.key.startsWith("audit:")), []);
    t += 21 * 3_600_000; state = null;      // can't look right now: leave things as they are
    db.setMeta("gprob:g1", JSON.stringify([{ key: "audit:codes", what: "x", why: "y", at: 1, count: 1 }]));
    await run();
    assert.equal(listProblems(db, "g1").length, 1);
});

test("channel check: a channel that now passes is tried again right away instead of after the day's wait", async () => {
    const { releaseFixed, runChannelAudit } = await import("../src/channelcheck.js");
    const { createFeedHealth } = await import("../src/feedhealth.js");
    const db = openDb(":memory:");
    db.setCodeSettings("g1", { channel_id: "c1" }); db.setBundleFeedSettings("g1", { channel_id: "c2" });
    const t = 1_800_000_000_000, health = createFeedHealth({ db, now: () => t });
    await health.report({ feature: "codes", guildId: "g1", channelId: "c1", err: { status: 403, detail: "Missing Access (code 50001)" } });
    await health.report({ feature: "bundles", guildId: "g1", channelId: "c2", err: { status: 403, detail: "Missing Access (code 50001)" } });
    assert.ok(health.blocked("codes", "g1") && health.blocked("bundles", "g1"));
    // codes was fixed, bundles is still broken
    const inspect = async id => (id === "c1" ? { exists: true, name: "codes", missing: [] } : { exists: true, name: "deals", missing: ["Embed Links"] });
    const res = await checkChannels({ db, guildId: "g1", inspect });
    assert.deepEqual(releaseFixed(res, "g1", health), ["codes"]);
    assert.equal(health.blocked("codes", "g1"), false);
    assert.equal(health.blocked("bundles", "g1"), true);
    assert.match(checkEmbed(res, ["codes"]).footer.text, /tried again right away/);
    // the daily audit does the same on its own
    await health.report({ feature: "codes", guildId: "g1", channelId: "c1", err: { status: 403, detail: "Missing Access (code 50001)" } });
    await runChannelAudit({ db, guildIds: ["g1"], inspectFor: () => inspect, health, now: () => t });
    assert.equal(health.blocked("codes", "g1"), false);
});

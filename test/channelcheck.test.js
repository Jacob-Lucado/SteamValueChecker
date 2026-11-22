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

import { test } from "node:test";
import assert from "node:assert/strict";
import { createStartChannel, startEmbed } from "../src/startchannel.js";

const mk = (fail = false) => {
    const meta = new Map(), made = [], sent = [];
    return { made, sent,
        db: { getMeta: k => meta.get(k), setMeta: (k, v) => meta.set(k, v) },
        api: { createChannel: async (g, b) => { if (fail) throw new Error("Missing Permissions"); made.push(b); return { id: "ch1" }; } },
        discord: { sendChannel: async (id, p) => sent.push({ id, p }) } };
};

test("a start channel is made read-only for everyone and the guide is posted once", async () => {
    const t = mk(), guild = { id: "G", name: "Cool" };
    const r = await createStartChannel({ ...t, guild, botId: "B", url: "https://x.test" });
    assert.equal(r.channelId, "ch1");
    assert.equal(t.made[0].permission_overwrites[0].deny, "2048");
    assert.equal(t.sent.length, 1);
    assert.equal(t.db.getMeta("startch_id:G"), "ch1");
    assert.match(t.sent[0].p.embeds[0].fields[0].value, /manage setup/);
    assert.equal((await createStartChannel({ ...t, guild, botId: "B" })).skipped, "already made");
    assert.equal(t.made.length, 1);
});

test("missing permissions never throws, and a ready server gets the shorter guide", async () => {
    const t = mk(true);
    assert.match((await createStartChannel({ ...t, guild: { id: "G2" }, botId: "B" })).skipped, /Permissions/);
    assert.match(startEmbed({ guildName: "A", ready: true }).fields[0].value, /automatically/);
});

test("the start channel is also a global giveaway destination", async () => {
    const { openDb } = await import("../src/db.js");
    const db = openDb(":memory:");
    db.setMeta("startch_id:G9", "555");
    db.setGuildChannel("G9", "alerts1", "x");
    const d = db.giveawayDestinations().filter(x => x.guild_id === "G9").map(x => x.channel_id).sort();
    assert.deepEqual(d, ["555", "alerts1"]);
});

test("setup removes the start channel and stops it receiving giveaways", async () => {
    const { removeStartChannel } = await import("../src/startchannel.js");
    const t = mk(); const gone = [];
    await createStartChannel({ ...t, guild: { id: "G5", name: "X" }, botId: "B" });
    assert.match(t.sent[0].p.embeds[0].fields[0].value, /manage community setup/);
    assert.equal(await removeStartChannel({ api: { deleteChannel: async id => gone.push(id) }, db: t.db, guildId: "G5" }), true);
    assert.deepEqual(gone, ["ch1"]);
    assert.equal(t.db.getMeta("startch_id:G5"), "");
    assert.equal(await removeStartChannel({ api: { deleteChannel: async id => gone.push(id) }, db: t.db, guildId: "G5" }), false);
});

test("the setup funnel counts servers that joined, got the start channel and ran setup", async () => {
    const { openDb } = await import("../src/db.js");
    const db = openDb(":memory:");
    db.funnelMark("A", "join"); db.funnelMark("A", "start"); db.funnelMark("A", "setup");
    db.funnelMark("B", "join"); db.funnelMark("B", "start");
    db.funnelMark("C", "join");
    db.funnelMark("OLD", "setup"); // setup in a server that was never tracked joining is not counted
    const f = db.funnelStats(0);
    assert.deepEqual([f.joined, f.started, f.setup], [3, 2, 1]);
    db.funnelMark("A", "setup"); // a second mark never moves the first
    assert.equal(db.funnelStats(0).recent.length, 3);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createLogFeed, MODES } from "../src/logfeed.js";
import { createLogBuffer } from "../src/logbuffer.js";

const meta = () => { const m = new Map(); return { getMeta: k => m.get(k) ?? null, setMeta: (k, v) => m.set(k, v) }; };
const make = (over = {}) => {
    const sent = [];
    let t = 1_000_000;
    const feed = createLogFeed({ db: meta(), send: async m => { sent.push(m); }, now: () => t, timer: fn => ({ fn, unref() {} }), ...over });
    return { feed, sent, tick: ms => { t += ms; } };
};
const E = (level, text) => ({ at: 1_000_000, level, text });

test("problems mode sends errors, warnings and failure-sounding lines, not routine info", async () => {
    const { feed, sent } = make();
    feed.accept(E("info", "[luna] 12 Luna claims"));
    feed.accept(E("info", "[alerts] delivery failed (no_channel)"));
    feed.accept(E("warn", "[x] slow"));
    feed.accept(E("error", "[boom] it broke"));
    feed.accept(E("activity", "owner did a thing"));
    await feed.flush();
    assert.equal(sent.length, 1);
    assert.ok(sent[0].content.includes("delivery failed") && sent[0].content.includes("slow") && sent[0].content.includes("it broke"));
    assert.ok(!sent[0].content.includes("Luna") && !sent[0].content.includes("owner did"));
});

test("repeats fold into one line with a count, and off sends nothing", async () => {
    const { feed, sent } = make();
    for (let i = 0; i < 40; i++) feed.accept(E("info", `[alerts] delivery failed (no_channel) user ${100000 + i}`));
    await feed.flush();
    assert.equal(sent.length, 1);
    assert.match(sent[0].content, /×40/);
    feed.setSettings({ mode: "off" });
    feed.accept(E("error", "nope"));
    assert.equal(await feed.flush(), 0);
});

test("everything mode includes routine lines; messages stay under 2000 characters and are rate limited", async () => {
    const { feed, sent } = make({ perMinute: 2 });
    feed.setSettings({ mode: "all" });
    for (let i = 0; i < 300; i++) feed.accept(E("info", `unique-${"abcdefghij"[i % 10]}${"klmnopqrst"[Math.floor(i / 10) % 10]}${"uvwxyzabcd"[Math.floor(i / 100)]} ${"x".repeat(200)}`));
    await feed.flush();
    assert.equal(sent.length, 2, "capped at two messages a minute");
    assert.ok(sent.every(m => m.content.length < 2000));
    assert.match(sent[1].content, /more lines/);
});

test("the channel ID is checked, a dead channel falls back to DMs, and the status reports it", async () => {
    const sent = [];
    const feed = createLogFeed({ db: meta(), send: async m => { sent.push(m); if (m.channelId) throw new Error("Missing Access"); }, timer: fn => ({ fn, unref() {} }) });
    assert.throws(() => feed.setSettings({ channel: "abc" }), /17 to 20 digits/);
    feed.setSettings({ channel: "123456789012345678" });
    feed.accept(E("error", "bad"));
    await feed.flush();
    assert.deepEqual(sent.map(m => m.channelId), ["123456789012345678", null]);
    assert.match(sent[1].content, /couldn't post to your log channel/);
    assert.equal(feed.status().channel, "123456789012345678");
    assert.deepEqual(Object.keys(MODES), ["off", "problems", "all"]);
});

test("the log buffer hands each masked line to subscribers, and a failing subscriber doesn't break logging", () => {
    const buf = createLogBuffer({ secrets: ["supersecretvalue"] });
    const got = [];
    const stop = buf.subscribe(e => got.push(e));
    buf.subscribe(() => { throw new Error("listener bug"); });
    buf.add("error", ["token is supersecretvalue ok"]);
    assert.equal(got.length, 1);
    assert.ok(!got[0].text.includes("supersecretvalue"));
    stop();
    buf.add("error", ["again"]);
    assert.equal(got.length, 1);
});

test("server IDs in a line become server names, and lines from different servers stay separate", async () => {
    const names = { "111111111111111111": "Geometry Dash And Minecraft", "222222222222222222": "Game Junkies" };
    const { feed, sent } = make({ guildName: id => names[id] ?? null });
    for (let i = 0; i < 3; i++) feed.accept(E("info", "[alerts] delivery failed (no_channel) in server 111111111111111111"));
    feed.accept(E("info", "[alerts] delivery failed (no_channel) in server 222222222222222222"));
    feed.accept(E("info", "[alerts] delivery failed (no_channel) in server 333333333333333333"));
    await feed.flush();
    const c = sent[0].content;
    assert.match(c, /Geometry Dash And Minecraft \(111111111111111111\) ×3/);
    assert.match(c, /Game Junkies \(222222222222222222\)/);
    assert.match(c, /in server 333333333333333333/);
});

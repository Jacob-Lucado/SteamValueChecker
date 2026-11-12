import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { giveawayInput } from "../src/gwinput.js";
import { giveawayPayload } from "../src/gwrender.js";
import { createStreamGiveaways } from "../src/streamgiveaway.js";

const BASE = { id: 7, title: "Hades night", status: "active", host_id: "u1", host_name: "Mia", ends_at: Date.now() + 3600_000, channel_id: "c" };
const KEYS = [{ label: "Hades", kind: "key", status: "available" }];

test("giveaway input: one parser for every form, with entry steps checked", () => {
    const { input, duplicates } = giveawayInput({ keys: "Hades | AAAA-BBBB\nHades | AAAA-BBBB", length: "30m", color: "#9146ff", min_account_days: "7", boosters: true,
        steps: [{ kind: "follow_twitch", url: "https://twitch.tv/mia" }, { kind: "custom", url: "https://example.com/x", label: "Read the rules" }, {}] });
    assert.equal(duplicates, 1); assert.equal(input.keys.length, 1);
    assert.equal(input.duration_ms, 30 * 60_000); assert.equal(input.min_account_days, 7); assert.equal(input.require_boost, true);
    assert.deepEqual(input.steps.map(s => s.label), ["Follow on Twitch", "Read the rules"]);
    assert.throws(() => giveawayInput({ keys: "A | B", steps: [{ kind: "follow_twitch", url: "https://evil.example/x" }] }), /twitch\.tv/);
    assert.throws(() => giveawayInput({ keys: "A | B", steps: [{ kind: "visit", url: "http://insecure.example" }] }), /https/);
    assert.equal(giveawayInput({ keys: "A | B", vouch_channel_id: "zzz" }, { channelIds: ["c1"] }).input.vouch_channel_id, null, "only a channel from the server");
});

test("the giveaway post lists the required steps with link buttons, for a normal giveaway too", () => {
    const steps = JSON.stringify([{ kind: "follow_twitch", url: "https://twitch.tv/mia", label: "Follow Mia" }, { kind: "join_discord", url: "https://discord.gg/abc", label: "Join the Discord" }]);
    const p = giveawayPayload({ ...BASE, steps }, KEYS, 0, "active");
    const field = p.embeds[0].fields.find(f => /Required steps/.test(f.name));
    assert.match(field.value, /1\. .*Follow Mia/); assert.match(field.value, /3\. Press \*\*Enter giveaway\*\*/);
    const links = p.components.slice(1).flatMap(r => r.components);
    assert.deepEqual(links.map(b => b.label), ["Follow Mia", "Join the Discord"]);
    const plain = giveawayPayload({ ...BASE }, KEYS, 0, "active");
    assert.equal(plain.embeds[0].fields.some(f => /Required steps/.test(f.name)), false);
    assert.equal(plain.components.length, 1);
    assert.equal(giveawayPayload({ ...BASE, steps }, KEYS, 0, "ended").components.length, 1, "no step buttons once it's over");
});

test("stream giveaway: the full form keeps prizes, rules and steps, and can run past the end of the stream", async () => {
    const db = openDb(":memory:"), made = [];
    db.setCommunity("g", { live_channel: "live" });
    db.setStreamLive("g", "u1", { title: "t", url: "https://twitch.tv/mia", started: Date.now() });
    const sg = createStreamGiveaways({ db, giveaways: () => ({ create: async i => { made.push(i); return { id: made.length, prizes: i.keys.length }; }, end: async () => {} }) });
    const { input } = giveawayInput({ keys: "Hades | AAAA-BBBB\nnitro: Discord Nitro | https://discord.gift/abc", length: "2h", title: "Big night", min_account_days: 30,
        steps: [{ kind: "follow_twitch", url: "https://twitch.tv/mia" }] }, { defaults: { length: "1h" } });
    const r = await sg.start("g", { id: "u1", name: "Mia" }, { input, endWithStream: false });
    assert.equal(r.prizes, 2); assert.equal(r.endsWithStream, false);
    const m = made[0];
    assert.equal(m.channel_id, "live"); assert.equal(m.host_id, "u1"); assert.equal(m.title, "Big night"); assert.equal(m.min_account_days, 30);
    assert.equal(m.steps.length, 1); assert.equal(m.duration_ms, 120 * 60_000); assert.equal(m.rounds, 1);
    assert.equal(sg.active("g", "u1"), null, "not tied to the stream, so nothing to end with it");
    await assert.rejects(() => sg.start("g", { id: "u1", name: "Mia" }, { input: { ...input, keys: [], duration_ms: 3600_000 } }), /at least one prize/);
    await assert.rejects(() => sg.start("g", { id: "u1", name: "Mia" }, { input: { ...input, duration_ms: 99 * 3600_000 } }), /5 minutes and 12 hours/);
});

test("giveaway overlay: follows the streamer's latest stream giveaway and lets the winners show for a while", async () => {
    let clock = 1_000_000;
    const db = openDb(":memory:", { now: () => clock });
    db.setCommunity("g", { live_channel: "live" });
    db.setStreamLive("g", "u1", { title: "t", url: "https://twitch.tv/mia", started: clock });
    const create = async i => ({ id: db.createGiveaway({ guild_id: "g", channel_id: "live", host_id: "u1", title: i.title, ends_at: clock + 3600_000, status: "active" }, i.keys.map(k => ({ label: k.label, enc: "x" }))), prizes: i.keys.length });
    const sg = createStreamGiveaways({ db, giveaways: () => ({ create, end: async () => {} }), now: () => clock });
    assert.equal(sg.latest("u1"), null, "nothing running yet");
    const r = await sg.start("g", { id: "u1", name: "Mia" }, { game: "Hades", key: "AAAA-BBBB" });
    assert.equal(sg.latest("u1").id, r.id);
    assert.equal(sg.latest("u2"), null, "someone else's overlay never shows it");
    db.setGiveawayStatus(r.id, "ended");
    assert.equal(sg.latest("u1").id, r.id, "the winners stay up right after the draw");
    clock += 11 * 60_000;
    assert.equal(sg.latest("u1"), null, "then it clears");
});

test("the dashboard form's video is decoded and checked", async () => {
    const { videoFromBody } = await import("../src/gwmedia.js");
    assert.equal(videoFromBody({}), null);
    const v = videoFromBody({ video_b64: Buffer.from("hello").toString("base64"), video_type: "video/mp4", video_name: "a.mp4" });
    assert.deepEqual([v.buffer.toString(), v.type, v.name], ["hello", "video/mp4", "a.mp4"]);
    assert.throws(() => videoFromBody({ video_b64: "AAAA", video_type: "image/png" }), /MP4, WebM or MOV/);
    assert.throws(() => videoFromBody({ video_b64: "A".repeat(15 * 1024 * 1024), video_type: "video/mp4" }), /too big/);
    assert.ok(giveawayInput({ keys: "A | B", video_b64: "AAAA", video_type: "video/webm" }).input.video);
});

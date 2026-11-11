import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createStreams, canStreamIn, cleanStreamUrl, PING_COOLDOWN_MS } from "../src/streamlive.js";
import { TEMPLATE } from "../src/community.js";
import { UserError } from "../src/errors.js";

function fake() {
    const db = openDb(":memory:"); const sent = [], edits = [], roles = []; let t = 10_000_000_000;
    const api = { sendMessage: async (c, p) => { sent.push({ c, p }); return { id: "m" + sent.length }; }, editMessage: async (c, m, p) => { edits.push({ c, m, p }); }, addRole: async (g, u, r) => roles.push(["add", g, u, r]), removeRole: async (g, u, r) => roles.push(["remove", g, u, r]), getMember: async () => ({ roles: ["ping"] }) };
    db.setCommunity("g", { live_channel: "live", ping_stream: "ping", streamer_role_id: "sr", mod_role_id: "mod" });
    return { db, api, sent, edits, roles, streams: createStreams({ db, api, now: () => t }), tick: ms => { t += ms; } };
}

test("the template makes a Streamer role, a stream-live channel and a Stream pings role", () => {
    assert.ok(TEMPLATE.roles.some(r => r.key === "streamer"));
    assert.ok(TEMPLATE.categories.flatMap(c => c.channels ?? []).some(c => c.key === "live" && c.readonly));
    assert.ok(TEMPLATE.selfRoles.some(r => r.name === "Stream pings"));
});

test("only streamers, moderators, managers and the bot owner may stream", () => {
    const c = { streamer_role_id: "sr", mod_role_id: "mod" };
    assert.equal(canStreamIn(c, { roleIds: ["sr"] }), true);
    assert.equal(canStreamIn(c, { roleIds: ["mod"] }), true);
    assert.equal(canStreamIn(c, { isManager: true }), true);
    assert.equal(canStreamIn(c, { isBotOwner: true }), true);
    assert.equal(canStreamIn(c, { roleIds: ["other"] }), false);
    assert.equal(canStreamIn({}, { roleIds: ["sr"] }), false, "no streamer role set means no streamers");
});

test("stream links must be https links to a streaming site", () => {
    assert.match(cleanStreamUrl("https://www.twitch.tv/someone"), /twitch\.tv/);
    for (const bad of ["http://twitch.tv/a", "https://evil.example/twitch.tv", "javascript:alert(1)", "not a link", "https://user:pw@twitch.tv/a"]) assert.throws(() => cleanStreamUrl(bad), UserError, bad);
});

test("going live posts once with a ping, a repeat edits the post, and ending grays it out", async () => {
    const f = fake();
    const r = await f.streams.goLive("g", { id: "u1", name: "Jacob" }, { title: "Ranked grind", url: "https://twitch.tv/jacob", game: "Overwatch" });
    assert.deepEqual([r.posted, r.pinged, r.edited], [true, true, false]);
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].c, "live"); assert.equal(f.sent[0].p.content, "<@&ping>");
    assert.deepEqual(f.sent[0].p.allowed_mentions.roles, ["ping"]); assert.deepEqual(f.sent[0].p.allowed_mentions.parse, []);
    assert.equal(f.db.listStreamLive("g").length, 1);
    const again = await f.streams.goLive("g", { id: "u1", name: "Jacob" }, { title: "New title", url: "https://twitch.tv/jacob" });
    assert.deepEqual([again.pinged, again.edited], [false, true]); assert.equal(f.sent.length, 1); assert.equal(f.edits.length, 1);
    await f.streams.endLive("g", { id: "u1", name: "Jacob" });
    assert.equal(f.db.listStreamLive("g").length, 0); assert.match(f.edits.at(-1).p.embeds[0].footer.text, /ended/);
    f.tick(60_000); // ended and back within half an hour: new post, no second ping
    const quick = await f.streams.goLive("g", { id: "u1", name: "Jacob" }, { title: "Round 2", url: "https://twitch.tv/jacob" });
    assert.equal(quick.pinged, false); assert.equal(f.sent.length, 2); assert.equal(f.sent[1].p.content, undefined);
    await f.streams.endLive("g", { id: "u1", name: "Jacob" }); f.tick(PING_COOLDOWN_MS + 1);
    assert.equal((await f.streams.goLive("g", { id: "u1", name: "Jacob" }, { title: "Later", url: "https://twitch.tv/jacob" })).pinged, true);
    await assert.rejects(() => f.streams.endLive("g", { id: "nobody", name: "x" }), UserError);
});

test("no live channel means a plain explanation, and opting in gives or takes the ping role", async () => {
    const f = fake(); f.db.setCommunity("g2", {});
    await assert.rejects(() => f.streams.goLive("g2", { id: "u", name: "x" }, { title: "t", url: "https://twitch.tv/x" }), /no stream channel/);
    await assert.rejects(() => f.streams.setOptIn("g2", "u", true), /aren't set up/);
    assert.deepEqual(await f.streams.setOptIn("g", "u1", true), { on: true, role: "ping" });
    await f.streams.setOptIn("g", "u1", false);
    assert.deepEqual(f.roles, [["add", "g", "u1", "ping"], ["remove", "g", "u1", "ping"]]);
    assert.equal(await f.streams.optedIn("g", "u1"), true);
});

test("every person gets their own overlay link, and resetting yours leaves everyone else's alone", () => {
    const db = openDb(":memory:");
    const a = db.resetOverlay("g", "alice", "manager"), b = db.resetOverlay("g", "bob", "role"), other = db.resetOverlay("g2", "alice", "manager");
    assert.equal(new Set([a, b, other]).size, 3, "no shared tokens");
    assert.deepEqual({ ...db.overlayByToken(a) }, { guild_id: "g", user_id: "alice", via: "manager" });
    assert.deepEqual({ ...db.overlayByToken(b) }, { guild_id: "g", user_id: "bob", via: "role" });
    const a2 = db.resetOverlay("g", "alice", "manager");
    assert.equal(db.overlayByToken(a), null, "alice's old link is dead");
    assert.ok(db.overlayByToken(a2) && db.overlayByToken(b), "bob's still works");
    assert.equal(db.getOverlay("g", "bob").token, b); assert.equal(db.getOverlay("g", "carol"), null);
    db.removeOverlay("g", "bob");
    assert.equal(db.overlayByToken(b), null); assert.ok(db.overlayByToken(other));
    assert.deepEqual(db.listOverlays("g").map(r => r.user_id), ["alice"]);
});

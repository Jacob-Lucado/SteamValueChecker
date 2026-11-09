import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createStreams } from "../src/streamlive.js";
import { parseChannel, createCheckers, createStreamWatch, watchable, channelUrl } from "../src/streamwatch.js";

test("channel links are read into a site and a handle, and anything else is refused with a sentence", () => {
    assert.deepEqual(parseChannel("https://www.twitch.tv/Some_Streamer?sr=a"), { platform: "twitch", handle: "some_streamer" });
    assert.deepEqual(parseChannel("twitch.tv/abc123"), { platform: "twitch", handle: "abc123" });
    assert.deepEqual(parseChannel("https://kick.com/Streamy"), { platform: "kick", handle: "streamy" });
    assert.deepEqual(parseChannel("https://www.youtube.com/@CoolChannel"), { platform: "youtube", handle: "@coolchannel" });
    assert.deepEqual(parseChannel("https://youtube.com/channel/UCabcdefghijklmnopqrstuv"), { platform: "youtube", handle: "UCabcdefghijklmnopqrstuv" });
    for (const bad of ["", "https://twitch.tv/directory", "https://twitch.tv/", "http://twitch.tv/abc", "https://evil.example/twitch.tv/abc", "https://tiktok.com/@a", "not a link", "https://youtube.com/watch?v=abc"]) assert.throws(() => parseChannel(bad), /./, bad);
    assert.equal(channelUrl("twitch", "abc"), "https://twitch.tv/abc");
    assert.equal(channelUrl("youtube", "@x"), "https://www.youtube.com/@x/live");
});

test("only sites with app keys are checked automatically", () => {
    assert.deepEqual(watchable({}), { twitch: false, kick: false, youtube: true });
    assert.equal(watchable({ TWITCH_CLIENT_ID: "a", TWITCH_CLIENT_SECRET: "b" }).twitch, true);
});

test("the Twitch checker asks Helix for every handle at once and reads the live ones", async () => {
    const urls = [];
    const fetchImpl = async (url, o) => {
        urls.push(url);
        if (String(url).includes("id.twitch.tv")) return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
        assert.equal(o.headers.Authorization, "Bearer tok"); assert.equal(o.headers["Client-Id"], "cid");
        return { ok: true, json: async () => ({ data: [{ type: "live", user_login: "Alpha", title: "Speedruns", game_name: "Celeste" }] }) };
    };
    const c = createCheckers({ fetchImpl, env: { TWITCH_CLIENT_ID: "cid", TWITCH_CLIENT_SECRET: "sec" } });
    const out = await c.twitch(["alpha", "beta"]);
    assert.deepEqual([...out.keys()], ["alpha"]); assert.equal(out.get("alpha").game, "Celeste"); assert.equal(out.get("alpha").url, "https://twitch.tv/alpha");
    assert.match(urls[1], /user_login=alpha&user_login=beta/);
    await c.twitch(["alpha"]); assert.equal(urls.filter(u => u.includes("id.twitch.tv")).length, 1, "the app token is reused");
});

function rig({ live = new Map(), roles = ["sr"] } = {}) {
    const db = openDb(":memory:"); const sent = [], edits = []; let t = 10_000_000_000, down = false;
    const api = { sendMessage: async (c, p) => { sent.push({ c, p }); return { id: "m" + sent.length }; }, editMessage: async (c, m, p) => { edits.push({ c, m, p }); }, memberName: async () => "Streamer", getMember: async () => ({ roles }) };
    db.setCommunity("g", { live_channel: "live", ping_stream: "ping", streamer_role_id: "sr" });
    const streams = createStreams({ db, api, now: () => t });
    const state = { live };
    const checkers = { twitch: async () => { if (down) throw new Error("api down"); return state.live; }, kick: async () => { if (state.kickDown) throw new Error("kick down"); return state.kick ?? new Map(); } };
    const env = { TWITCH_CLIENT_ID: "a", TWITCH_CLIENT_SECRET: "b", KICK_CLIENT_ID: "c", KICK_CLIENT_SECRET: "d" };
    const logs = [];
    const watch = createStreamWatch({ db, streams, api, checkers, env, now: () => t, log: m => logs.push(m), access: async l => { const c = db.getCommunity(l.guild_id); const m = await api.getMember(); return l.via !== "role" || m.roles.includes(c.streamer_role_id); } });
    return { db, sent, edits, watch, state, logs, setDown: v => { down = v; }, setRoles: r => { roles.splice(0, roles.length, ...r); }, tick: ms => { t += ms; } };
}

test("a linked streamer who goes live is posted by the bot, with the ping once, and closed after two offline checks", async () => {
    const r = rig();
    r.db.setStreamLink("g", "u1", { platform: "twitch", handle: "alpha", via: "role", added: 1 });
    assert.deepEqual(await r.watch.tick(), { live: 0, ended: 0 }); assert.equal(r.sent.length, 0, "offline: nothing posted");
    r.state.live = new Map([["alpha", { title: "Speedruns", game: "Celeste", url: "https://twitch.tv/alpha" }]]);
    assert.equal((await r.watch.tick()).live, 1);
    assert.equal(r.sent.length, 1); assert.equal(r.sent[0].c, "live"); assert.equal(r.sent[0].p.content, "<@&ping>");
    assert.equal(r.db.getStreamLive("g", "u1").auto, 1);
    await r.watch.tick(); assert.equal(r.sent.length, 1, "same stream: no second post"); assert.equal(r.edits.length, 0);
    r.state.live = new Map([["alpha", { title: "Now playing Hades", game: "Hades", url: "https://twitch.tv/alpha" }]]);
    await r.watch.tick(); assert.equal(r.sent.length, 1); assert.equal(r.edits.length, 1, "a new title edits the same post, no new ping");
    r.state.live = new Map();
    assert.equal((await r.watch.tick()).ended, 0, "one offline check is only a blip"); assert.ok(r.db.getStreamLive("g", "u1"));
    r.state.live = new Map([["alpha", { title: "Now playing Hades", game: "Hades", url: "https://twitch.tv/alpha" }]]); await r.watch.tick();
    r.state.live = new Map(); await r.watch.tick();
    assert.equal((await r.watch.tick()).ended, 1, "two in a row closes it");
    assert.ok(!r.db.getStreamLive("g", "u1")); assert.match(r.edits.at(-1).p.embeds[0].author.name, /was live/);
});

test("when the site can't be reached nothing changes, a hand-made post isn't closed, and losing the role removes the link", async () => {
    const r = rig();
    r.db.setStreamLink("g", "u1", { platform: "twitch", handle: "alpha", via: "role", added: 1 });
    r.state.live = new Map([["alpha", { title: "T", game: "", url: "https://twitch.tv/alpha" }]]); await r.watch.tick();
    r.setDown(true); r.state.live = new Map();
    await r.watch.tick(); await r.watch.tick(); await r.watch.tick();
    assert.ok(r.db.getStreamLive("g", "u1"), "an outage doesn't end anyone's stream"); assert.ok(r.logs.some(l => /api down/.test(l)));
    r.setDown(false);
    // a post made by hand (not auto) is left alone when the checker says offline
    r.db.endStreamLive("g", "u1"); r.db.setStreamLive("g", "u1", { title: "By hand", url: "https://twitch.tv/alpha", started: 1, channelId: "live", messageId: "x", auto: false });
    await r.watch.tick(); await r.watch.tick(); await r.watch.tick();
    assert.ok(r.db.getStreamLive("g", "u1"), "manual post stays until they end it");
    // role lost: the next time they're live the link goes away instead of posting
    r.db.endStreamLive("g", "u1"); r.setRoles([]); r.state.live = new Map([["alpha", { title: "T", game: "", url: "https://twitch.tv/alpha" }]]);
    const before = r.sent.length; await r.watch.tick();
    assert.ok(!r.db.getStreamLink("g", "u1")); assert.equal(r.sent.length, before);
});

test("without Twitch keys the link is kept but nothing is checked", async () => {
    const r = rig(); const db = r.db;
    const w = createStreamWatch({ db, streams: createStreams({ db, api: { sendMessage: async () => ({ id: "1" }), editMessage: async () => {} } }), api: {}, checkers: { twitch: async () => { throw new Error("should not be called"); } }, env: {} });
    db.setStreamLink("g", "u9", { platform: "twitch", handle: "zed", via: "role", added: 1 });
    assert.deepEqual(await w.tick(), { live: 0, ended: 0 });
});

test("a manager can switch the automatic posts off for their server and back on", async () => {
    const r = rig({ live: new Map([["alpha", { title: "Speedruns", game: "Celeste", url: "https://twitch.tv/alpha" }]]) });
    r.db.setStreamLink("g", "u1", { platform: "twitch", handle: "alpha", via: "role", added: 1 });
    r.db.setCommunity("g", { stream_auto: 0 });
    assert.deepEqual(await r.watch.tick(), { live: 0, ended: 0 }); assert.equal(r.sent.length, 0, "off: nothing posted");
    assert.equal(r.db.getCommunity("g").stream_auto, 0);
    r.db.setCommunity("g", { stream_auto: 1 });
    assert.equal((await r.watch.tick()).live, 1); assert.equal(r.sent.length, 1);
});

test("a streamer with several channels gets one post, linking every site they are live on, and it only closes when all of them are offline", async () => {
    const r = rig();
    r.db.setStreamLink("g", "u1", { platform: "twitch", handle: "alpha", via: "role", added: 1 });
    r.db.setStreamLink("g", "u1", { platform: "kick", handle: "alpha_k", via: "role", added: 2 });
    assert.equal(r.db.getStreamLinks("g", "u1").length, 2); assert.equal(r.db.getStreamLink("g", "u1").platform, "twitch"); assert.equal(r.db.getStreamLink("g", "u1", "kick").handle, "alpha_k");
    r.state.kick = new Map([["alpha_k", { title: "Kick stream", game: "Celeste", url: "https://kick.com/alpha_k" }]]);
    assert.equal((await r.watch.tick()).live, 1, "live on Kick alone is enough");
    assert.equal(r.sent.length, 1); assert.equal(r.db.getStreamLive("g", "u1").url, "https://kick.com/alpha_k");
    r.state.live = new Map([["alpha", { title: "Twitch stream", game: "Celeste", url: "https://twitch.tv/alpha" }]]);
    await r.watch.tick();
    assert.equal(r.sent.length, 1, "going live on a second site edits the one post"); assert.equal(r.edits.length, 1);
    assert.equal(r.db.getStreamLive("g", "u1").url, "https://kick.com/alpha_k", "the post keeps the site it already showed");
    assert.deepEqual(r.db.getStreamLive("g", "u1").also, ["https://twitch.tv/alpha"]);
    const buttons = r.edits[0].p.components[0].components; assert.deepEqual(buttons.map(b => b.url), ["https://kick.com/alpha_k", "https://twitch.tv/alpha"]);
    assert.match(r.edits[0].p.embeds[0].description, /Kick.*Twitch/);
    r.state.kick = new Map(); await r.watch.tick();
    assert.ok(r.db.getStreamLive("g", "u1"), "still live on Twitch");
    assert.equal(r.db.getStreamLive("g", "u1").url, "https://twitch.tv/alpha", "the post moves to the site that is still live");
    r.state.live = new Map(); await r.watch.tick();
    assert.equal((await r.watch.tick()).ended, 1, "closed after two checks with every site offline");
    // a site that can't be checked right now never closes the post
    r.state.kick = new Map([["alpha_k", { title: "Again", game: "", url: "https://kick.com/alpha_k" }]]); await r.watch.tick();
    r.state.kick = new Map(); r.state.kickDown = true;
    await r.watch.tick(); await r.watch.tick(); await r.watch.tick();
    assert.ok(r.db.getStreamLive("g", "u1"), "Kick is down, so we can't say they stopped");
});

test("one channel per site: linking a second Twitch channel replaces the first, and unlinking can target one site", () => {
    const r = rig();
    r.db.setStreamLink("g", "u1", { platform: "twitch", handle: "one", via: "role", added: 1 });
    r.db.setStreamLink("g", "u1", { platform: "kick", handle: "k", via: "role", added: 2 });
    r.db.setStreamLink("g", "u1", { platform: "twitch", handle: "two", via: "role", added: 3 });
    assert.deepEqual(r.db.getStreamLinks("g", "u1").map(l => [l.platform, l.handle]), [["twitch", "two"], ["kick", "k"]]);
    assert.equal(r.db.removeStreamLink("g", "u1", "twitch"), true); assert.deepEqual(r.db.getStreamLinks("g", "u1").map(l => l.platform), ["kick"]);
    r.db.removeStreamLink("g", "u1"); assert.equal(r.db.getStreamLinks("g", "u1").length, 0);
});

test("an older database with one channel per streamer is rebuilt without losing anyone's link", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { mkdtempSync } = await import("node:fs"); const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
    const file = join(mkdtempSync(join(tmpdir(), "svc-mig-")), "old.db");
    const old = new DatabaseSync(file);
    old.exec("CREATE TABLE stream_link (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, platform TEXT NOT NULL, handle TEXT NOT NULL, via TEXT NOT NULL DEFAULT 'role', added INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id));");
    old.exec("INSERT INTO stream_link VALUES ('g','u1','twitch','alpha','role',5)"); old.close();
    const db = openDb(file);
    assert.deepEqual(db.getStreamLinks("g", "u1").map(l => [l.platform, l.handle, l.added]), [["twitch", "alpha", 5]]);
    db.setStreamLink("g", "u1", { platform: "youtube", handle: "@alpha", via: "role", added: 6 });
    assert.equal(db.getStreamLinks("g", "u1").length, 2, "the new key allows a second site");
});

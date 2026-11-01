import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { openDb } from "../src/db.js";
import { createQueue } from "../src/musicqueue.js";
import { isSoundcloudUrl, parseEntry, cleanQuery, createSource } from "../src/musicsource.js";
import { createMusic, isDj, fmtTime } from "../src/music.js";
import { parseTime, settingsSummary } from "../src/musichandlers.js";
import { nowPlayingEmbed, queueEmbed, addedEmbed, searchPayload, controls, progressBar } from "../src/musicrender.js";
import { UserError } from "../src/errors.js";

const T = (n, extra = {}) => ({ url: `https://soundcloud.com/a/t${n}`, title: `Track ${n}`, artist: "Artist", duration: 100 + n, thumb: null, ...extra });

// ---------- queue ----------
test("queue: add, start, advance, loop and previous", () => {
    const q = createQueue();
    assert.equal(q.add([T(1), T(2), T(3)]), 3);
    assert.equal(q.start().title, "Track 1");
    assert.equal(q.start(), null); // already playing
    assert.equal(q.advance().title, "Track 2");
    assert.equal(q.previous().title, "Track 1");
    assert.deepEqual(q.next.map(t => t.title), ["Track 2", "Track 3"]);
    q.setLoop("track");
    assert.equal(q.advance().title, "Track 1"); // looping the track
    assert.equal(q.advance({ force: true }).title, "Track 2"); // skip ignores track loop
    q.setLoop("queue"); q.advance(); // on 3
    assert.equal(q.advance().title, "Track 1"); // wrapped around
    assert.equal(q.setLoop("sideways"), false);
});

test("queue: limits, remove, move, skipTo, shuffle and clear", () => {
    const q = createQueue({ random: () => 0 });
    q.add([T(1), T(2), T(3), T(4), T(5)]); q.start();
    assert.equal(q.add([T(6), T(7)], { max: 6 }), 1); // room for one more
    assert.equal(q.remove(1).title, "Track 2");
    assert.equal(q.remove(99), null);
    assert.equal(q.move(1, 3).title, "Track 3");
    assert.deepEqual(q.next.map(t => t.title), ["Track 4", "Track 5", "Track 3", "Track 6"].slice(0, 4).map(x => x));
    assert.equal(q.skipTo(2).title, "Track 5");
    q.shuffle();
    assert.equal(q.current.title, "Track 5"); // the playing track never moves
    const waiting = q.next.length; assert.equal(q.clear(), waiting); assert.equal(waiting >= 1, true);
    q.add([T(9)], { first: true });
    assert.equal(q.next[0].title, "Track 9");
});

// ---------- source ----------
test("only SoundCloud links are accepted, and entries are cleaned", () => {
    assert.ok(isSoundcloudUrl("https://soundcloud.com/a/b"));
    assert.ok(isSoundcloudUrl("https://on.soundcloud.com/xyz"));
    assert.ok(isSoundcloudUrl("https://m.soundcloud.com/a"));
    for (const bad of ["http://soundcloud.com/a", "https://evilsoundcloud.com/a", "https://youtube.com/watch?v=1", "https://soundcloud.com.evil.test/a", "file:///etc/passwd", "lofi hip hop"]) assert.equal(isSoundcloudUrl(bad), false, bad);
    const t = parseEntry({ webpage_url: "https://soundcloud.com/a/b?si=123", title: "Song", uploader: "Band", duration: 200.4, thumbnail: "https://i1.sndcdn.com/x.jpg" });
    assert.deepEqual(t, { url: "https://soundcloud.com/a/b", title: "Song", artist: "Band", duration: 200, thumb: "https://i1.sndcdn.com/x.jpg" });
    assert.equal(parseEntry({ url: "https://youtube.com/x", title: "no" }), null);
    assert.equal(cleanQuery("a\nb\r\0c   ").length <= 120, true);
    assert.equal(cleanQuery("x".repeat(500)).length, 120);
});

test("source asks yt-dlp the right things and never lets a link argument look like a flag", async () => {
    const calls = [];
    const exec = async (cmd, args) => {
        calls.push(args);
        if (args.includes("-g")) return "https://cf-media.sndcdn.com/audio.mp3\n";
        if (args.some(a => a.startsWith("scsearch"))) return JSON.stringify({ entries: [{ url: "https://soundcloud.com/a/one", title: "One", duration: 10 }, { url: "https://example.com/no", title: "bad" }] });
        return JSON.stringify({ _type: "playlist", title: "Set", entries: [{ url: "https://soundcloud.com/a/one", title: "One" }, { url: "https://soundcloud.com/a/two", title: "Two" }] });
    };
    const spawned = [];
    const spawnImpl = (cmd, args) => { spawned.push([cmd, args]); const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.kill = () => {}; return p; };
    const src = createSource({ exec, spawnImpl });
    const found = await src.search("--exec evil", 3);
    assert.equal(found.length, 1);
    assert.ok(calls[0].some(a => a === "scsearch3:--exec evil"), "the query is one argument with a prefix, so it can't be a flag");
    const set = await src.resolve("https://soundcloud.com/a/sets/mix");
    assert.equal(set.kind, "playlist"); assert.equal(set.tracks.length, 2);
    assert.equal(calls[1][calls[1].indexOf("--") + 1], "https://soundcloud.com/a/sets/mix");
    await assert.rejects(() => src.resolve("https://evil.test/x"));
    const s = await src.stream(T(1), { seek: 42.9 });
    assert.deepEqual(spawned[0][1].slice(spawned[0][1].indexOf("-ss"), spawned[0][1].indexOf("-ss") + 2), ["-ss", "42"]);
    assert.ok(spawned[0][1].includes("https://cf-media.sndcdn.com/audio.mp3"));
    s.kill();
});

// ---------- small helpers ----------
test("time parsing and formatting", () => {
    assert.equal(parseTime("90"), 90); assert.equal(parseTime("1:30"), 90); assert.equal(parseTime("1:02:03"), 3723);
    assert.equal(parseTime("1m30s"), 90); assert.equal(parseTime("2h"), 7200); assert.ok(Number.isNaN(parseTime("soon")));
    assert.equal(fmtTime(75), "1:15"); assert.equal(fmtTime(3725), "1:02:05");
});

test("DJ role rules", () => {
    assert.equal(isDj({ dj_role_id: null }, { roleIds: [] }), true);
    assert.equal(isDj({ dj_role_id: "r1" }, { roleIds: [] }), false);
    assert.equal(isDj({ dj_role_id: "r1" }, { roleIds: ["r1"] }), true);
    assert.equal(isDj({ dj_role_id: "r1" }, { roleIds: [], isManager: true }), true);
});

// ---------- the player, with a stand-in for Discord's voice library ----------
function rig({ settings = {}, members = {}, tracks = null } = {}) {
    const db = openDb(":memory:");
    if (Object.keys(settings).length) db.setMusicSettings("g1", settings);
    const log = [], posts = [], edits = [];
    const players = [];
    const voice = {
        VoiceConnectionStatus: { Ready: "ready", Disconnected: "disconnected", Signalling: "signalling", Connecting: "connecting" },
        AudioPlayerStatus: { Idle: "idle" }, NoSubscriberBehavior: { Pause: "pause" }, StreamType: { Raw: "raw" },
        joinVoiceChannel: opts => { const c = new EventEmitter(); c.opts = opts; c.subscribe = () => {}; c.destroy = () => { c.destroyed = true; }; log.push(["join", opts.channelId]); return c; },
        entersState: async () => {},
        createAudioPlayer: () => { const p = new EventEmitter(); p.state = { status: "idle" }; p.play = r => { p.state.status = "playing"; p.resource = r; log.push(["play"]); }; p.stop = () => { p.state.status = "idle"; }; p.pause = () => { if (p.state.status === "paused") return false; p.state.status = "paused"; return true; }; p.unpause = () => { const was = p.state.status === "paused"; p.state.status = "playing"; return was; }; players.push(p); return p; },
        createAudioResource: (stream, o) => ({ stream, o, playbackDuration: 5000, volume: { v: null, setVolume(x) { this.v = x; } } })
    };
    const source = {
        search: async q => (q.includes("nothing") ? [] : [T(1, { title: `Result for ${q}` })]),
        resolve: async url => (url.includes("/sets/") ? { kind: "playlist", title: "My Set", tracks: [T(1), T(2), T(3)] } : { kind: "track", title: "One", tracks: [T(1)] }),
        stream: async (t, o) => { if (t.title === "Broken") throw new Error("no audio"); return { stream: {}, kill() { this.killed = true; }, seek: o?.seek ?? 0 }; }
    };
    const humans = { c1: 3 };
    const getGuild = gid => (gid === "g1" ? {
        id: "g1", voiceAdapterCreator: () => {}, memberInfo: u => members[u] ?? { roleIds: [], isManager: false },
        voiceChannelOf: u => (u === "nobody" ? null : { id: u === "other" ? "c2" : "c1", name: "Lounge", canJoin: u !== "noperm", canSpeak: true }),
        humansIn: id => humans[id] ?? 0, channelName: () => "Lounge"
    } : null);
    const api = { sendMessage: async (ch, p) => { posts.push([ch, p]); return { id: "m" + posts.length }; }, editMessage: async (ch, id, p) => { edits.push([ch, id, p]); } };
    const timers = [];
    const m = createMusic({ db, source, voice, getGuild, api, panel: (gid, st) => ({ embeds: [{ title: st.current?.title }] }), setTimer: (fn, ms) => { const t = { fn, ms, unref() {} }; timers.push(t); return t; }, clearTimer: t => { if (t) t.cleared = true; } });
    return { db, m, log, posts, edits, players, timers, humans };
}

test("playing: join, start the first track, queue the rest, post the now-playing panel", async () => {
    const r = rig();
    const a = await r.m.enqueue({ guildId: "g1", userId: "u1", textChannelId: "t1", query: "some song" });
    assert.equal(a.startedNow, true);
    assert.deepEqual(r.log.filter(x => x[0] === "join"), [["join", "c1"]]);
    assert.equal(r.m.status("g1").current.title, "Result for some song");
    assert.equal(r.m.status("g1").current.requestedBy, "u1");
    assert.equal(r.posts[0][0], "t1"); // announced where /play was used
    const b = await r.m.enqueue({ guildId: "g1", userId: "u2", textChannelId: "t1", query: "https://soundcloud.com/a/sets/mix" });
    assert.equal(b.startedNow, false); assert.equal(b.added, 3); assert.equal(b.position, 1);
    assert.equal(r.m.status("g1").total, 4);
    assert.equal(r.log.filter(x => x[0] === "join").length, 1, "joined once");
});

test("a track ending moves to the next, and the queue running out starts the leave timer", async () => {
    const r = rig();
    await r.m.enqueue({ guildId: "g1", userId: "u1", textChannelId: "t1", tracks: [T(1), T(2)] });
    r.players[0].emit("idle");
    await new Promise(x => setImmediate(x));
    assert.equal(r.m.status("g1").current.title, "Track 2");
    r.players[0].emit("idle");
    await new Promise(x => setImmediate(x));
    assert.equal(r.m.status("g1").current, null);
    const leave = r.timers.at(-1);
    assert.equal(leave.ms, 5 * 60_000);
    leave.fn();
    assert.equal(r.m.status("g1").active, false, "left after the idle time");
});

test("a track that can't be played is skipped, and three in a row stop the queue", async () => {
    const r = rig();
    await r.m.enqueue({ guildId: "g1", userId: "u1", textChannelId: "t1", tracks: [T(1, { title: "Broken" }), T(2), T(3)] });
    assert.equal(r.m.status("g1").current.title, "Track 2");
    const r2 = rig();
    await r2.m.enqueue({ guildId: "g1", userId: "u1", textChannelId: "t1", tracks: [T(1, { title: "Broken" }), T(2, { title: "Broken" }), T(3, { title: "Broken" }), T(4)] });
    assert.equal(r2.m.status("g1").current, null);
});

test("who may do what: voice channel, DJ role, vote skip", async () => {
    const r = rig({ settings: { dj_role_id: "dj" }, members: { dj1: { roleIds: ["dj"] }, boss: { roleIds: [], isManager: true } } });
    await assert.rejects(() => r.m.enqueue({ guildId: "g1", userId: "nobody", query: "x" }), /voice channel/);
    await assert.rejects(() => r.m.enqueue({ guildId: "g1", userId: "noperm", query: "x" }), /Connect and Speak/);
    await r.m.enqueue({ guildId: "g1", userId: "u1", textChannelId: "t1", tracks: [T(1), T(2), T(3)] });
    await assert.rejects(() => r.m.enqueue({ guildId: "g1", userId: "other", query: "x" }), /Join that channel|playing in/);
    assert.throws(() => r.m.setVolume("g1", "u2", 30), /role/);
    assert.equal(r.m.setVolume("g1", "dj1", 30), 30);
    assert.equal(r.players[0].resource.volume.v, 0.3);
    assert.throws(() => r.m.setVolume("g1", "boss", 0), /1 to 100/);
    // vote skip: three people in the channel, u2 didn't queue it and isn't a DJ, so they need 2 votes
    r.humans.c1 = 3;
    let s = await r.m.skip("g1", "u2");
    assert.equal(s.skipped, false); assert.equal(s.need, 2);
    s = await r.m.skip("g1", "u3");
    assert.equal(s.skipped, true);
    assert.equal(r.m.status("g1").current.title, "Track 2");
    // the person who queued it can skip straight away... but it's now someone else's, a DJ can force it
    assert.equal((await r.m.skip("g1", "dj1")).skipped, true);
});

test("queue controls: remove your own, DJ-only for others, loop, shuffle, seek, previous, stop, leave", async () => {
    const r = rig({ settings: { dj_role_id: "dj" }, members: { dj1: { roleIds: ["dj"] } } });
    await r.m.enqueue({ guildId: "g1", userId: "dj1", textChannelId: "t1", tracks: [T(1), T(2), T(3)] });
    await r.m.enqueue({ guildId: "g1", userId: "u2", textChannelId: "t1", tracks: [T(4)] });
    assert.equal(r.m.remove("g1", "u2", 3).title, "Track 4"); // their own
    assert.throws(() => r.m.remove("g1", "u2", 1), /role/);
    assert.equal(r.m.setLoop("g1", "dj1", "track"), "track");
    assert.equal(r.m.shuffle("g1", "dj1"), 2);
    await assert.rejects(() => r.m.seek("g1", "dj1", 9999), /only/);
    await r.m.seek("g1", "dj1", 30);
    assert.equal(r.m.status("g1").position, 35); // 30 seeked + 5 played in the stand-in
    assert.equal(r.m.clear("g1", "dj1"), 2);
    await assert.rejects(() => r.m.previous("g1", "dj1"), /nothing before/);
    r.m.pause("g1", "dj1"); assert.equal(r.m.status("g1").paused, true);
    assert.throws(() => r.m.pause("g1", "dj1"), /already/);
    r.m.resume("g1", "dj1");
    r.m.stop("g1", "dj1");
    assert.equal(r.m.status("g1").current, null);
    r.m.leave("g1", "dj1");
    assert.equal(r.m.status("g1").active, false);
});

test("limits: music off, queue full, track too long, nothing found, busy", async () => {
    const off = rig({ settings: { enabled: 0 } });
    await assert.rejects(() => off.m.enqueue({ guildId: "g1", userId: "u1", query: "x" }), /turned off/);
    const small = rig({ settings: { max_queue: 2 } });
    await small.m.enqueue({ guildId: "g1", userId: "u1", textChannelId: "t", tracks: [T(1), T(2), T(3)] });
    assert.equal(small.m.status("g1").total, 2);
    await assert.rejects(() => small.m.enqueue({ guildId: "g1", userId: "u1", tracks: [T(9)] }), /queue is full/);
    const long = rig({ settings: { max_minutes: 1 } });
    await assert.rejects(() => long.m.enqueue({ guildId: "g1", userId: "u1", tracks: [T(1, { duration: 600 })] }), /1-minute limit/);
    const none = rig();
    await assert.rejects(() => none.m.enqueue({ guildId: "g1", userId: "u1", query: "nothing here" }), /Nothing on SoundCloud/);
    await assert.rejects(() => none.m.enqueue({ guildId: "g1", userId: "u1", query: "   " }), /link or something/);
});

test("everyone leaving pauses and then leaves; someone returning resumes", async () => {
    const r = rig();
    await r.m.enqueue({ guildId: "g1", userId: "u1", textChannelId: "t", tracks: [T(1)] });
    r.humans.c1 = 0; r.m.onVoiceChange("g1");
    assert.equal(r.m.status("g1").paused, true);
    const t = r.timers.at(-1);
    r.humans.c1 = 1; r.m.onVoiceChange("g1");
    assert.equal(t.cleared, true); assert.equal(r.m.status("g1").paused, false);
    r.humans.c1 = 0; r.m.onVoiceChange("g1"); r.timers.at(-1).fn();
    assert.equal(r.m.status("g1").active, false);
});

// ---------- store and display ----------
test("settings default sensibly and playlists are per person with a cap", () => {
    const db = openDb(":memory:");
    assert.equal(db.getMusicSettings("g").volume, 50); assert.equal(db.getMusicSettings("g").dj_role_id, null);
    assert.equal(db.setMusicSettings("g", { volume: 70, dj_role_id: "r" }).volume, 70);
    assert.throws(() => db.setMusicSettings("g", { evil: 1 }));
    for (let i = 0; i < 10; i++) db.savePlaylist("u", "p" + i, [T(1)]);
    assert.throws(() => db.savePlaylist("u", "p11", [T(1)]), /10 playlists/);
    db.savePlaylist("u", "P0", [T(1), T(2)]); // same name, different case: replaces
    assert.equal(db.listPlaylists("u").length, 10);
    assert.equal(db.getPlaylist("u", "p0").tracks.length, 2);
    assert.equal(db.getPlaylist("other", "p0"), null);
    assert.equal(db.deletePlaylist("u", "p0"), true);
});

test("the now-playing post, queue and search menu are well formed", () => {
    const st = { active: true, playing: true, paused: false, current: { ...T(1), requestedBy: "5" }, position: 30, next: [T(2), T(3)], total: 3, loop: "queue", volume: 50, totalSeconds: 400 };
    const e = nowPlayingEmbed(st);
    assert.match(e.description, /<@5>/); assert.match(e.description, /0:30 \/ 1:41/); assert.equal(e.url, T(1).url);
    assert.equal(controls(st).length, 2);
    assert.ok(controls(st).every(r => r.components.every(c => c.custom_id.startsWith("mu:") && c.custom_id.length <= 100)));
    assert.equal(controls({ ...st, paused: true })[0].components[1].custom_id, "mu:resume");
    assert.match(queueEmbed(st).description, /\*\*1\.\*\*/);
    assert.match(queueEmbed({ ...st, next: [] }).description, /empty/);
    assert.match(addedEmbed({ kind: "track", title: "x", added: 1, first: T(1), position: 2, startedNow: false }).footer.text, /Position 2/);
    const sp = searchPayload([T(1), T(2)], "tok", "lofi");
    assert.equal(sp.components[0].components[0].options.length, 2); assert.equal(sp.components[0].components[0].custom_id, "mu_pick:tok");
    assert.equal(progressBar(50, 100).includes("🔘"), true);
    assert.match(settingsSummary({ enabled: 1, volume: 50, dj_role_id: "9", channel_id: null, max_queue: 100, max_minutes: 0, announce: 1, leave_minutes: 5, stay: 0 }), /<@&9>/);
});

test("playlist links: titles come from the link until the real ones are fetched, long ones are capped and can be shuffled", async () => {
    const { parseEntry, titleFromUrl } = await import("../src/musicsource.js");
    assert.equal(titleFromUrl("https://soundcloud.com/the-concept-band/world-on-fire-1"), "World on fire 1");
    assert.equal(parseEntry({ url: "https://soundcloud.com/a/gimme-twice-mastered" }).title, "Gimme twice mastered");
    const r = rig();
    const set = Array.from({ length: 6 }, (_, i) => ({ url: `https://soundcloud.com/a/song-${i}`, title: `Song ${i}`, artist: "", duration: null, thumb: null }));
    r.m = r.m; // same rig
    const details = [];
    // a source whose details() fills in the length, like yt-dlp does for one track
    const rig2 = rig();
    const q = await rig2.m.enqueue({ guildId: "g1", userId: "u1", textChannelId: "t", tracks: set });
    assert.equal(q.added, 6); assert.equal(q.kind, "playlist");
    const small = rig({ settings: { max_queue: 4 } });
    const q2 = await small.m.enqueue({ guildId: "g1", userId: "u1", textChannelId: "t", tracks: set });
    assert.equal(q2.added, 4); assert.equal(q2.trimmed, 2);
    const mix = rig();
    await mix.m.enqueue({ guildId: "g1", userId: "u1", textChannelId: "t", tracks: Array.from({ length: 30 }, (_, i) => T(i)), shuffleAdded: true });
    const order = [mix.m.status("g1").current, ...mix.m.status("g1").next].map(t => t.title);
    assert.equal(order.length, 30); assert.notDeepEqual(order, Array.from({ length: 30 }, (_, i) => `Track ${i}`));
});

test("short command replies become embeds, errors in red", async () => {
    const { fancy } = await import("../src/musicrender.js");
    const ok = fancy("⏸️ Paused by <@1>.");
    assert.equal(ok.content, undefined); assert.match(ok.embeds[0].description, /Paused by/);
    const bad = fancy({ content: "Nothing is playing." }, true);
    assert.equal(bad.embeds[0].color, 0xed4245); assert.match(bad.embeds[0].description, /Nothing is playing/);
    const keep = fancy({ embeds: [{ title: "x" }] });
    assert.equal(keep.embeds[0].title, "x");
});

test("community setup gives music its own category, command channel and intro", async () => {
    const { TEMPLATE, musicIntroPayload } = await import("../src/community.js");
    const cat = TEMPLATE.categories.find(c => /MUSIC/.test(c.name));
    assert.ok(cat && cat.channels.some(c => c.key === "music" && c.name === "music-commands") && cat.voice.length >= 1);
    assert.ok(!TEMPLATE.categories.filter(c => c !== cat).some(c => (c.channels ?? []).some(x => x.key === "music")));
    const e = musicIntroPayload().embeds[0];
    const text = JSON.stringify(e);
    for (const w of ["/play", "playlist", "saveplaylist", "settings", "skip", "loop", "SoundCloud"]) assert.ok(text.includes(w), w);
    assert.ok(text.length < 5500 && e.fields.every(f => f.value.length <= 1024));
});

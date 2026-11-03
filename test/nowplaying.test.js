import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { fetchPlayers, createNowPlaying, whoIsPlaying, nowPlayingEmbed, runSquadUps } from "../src/nowplaying.js";

const ids = { a: "76561190000000001", b: "76561190000000002", c: "76561190000000003" };
function feed(map, calls = []) {
    return async url => {
        calls.push(url);
        const want = new URL(url).searchParams.get("steamids").split(",");
        return { ok: true, status: 200, json: async () => ({ response: { players: want.map(id => ({ steamid: id, personaname: "P" + id.slice(-1), ...(map[id] ? { gameid: String(map[id][0]), gameextrainfo: map[id][1] } : {}) })) } }) };
    };
}
function world(map, extra = {}) {
    const db = openDb(":memory:");
    for (const [u, k] of [["u1", "a"], ["u2", "b"], ["u3", "c"]]) {
        db.ensureUser(u, "G"); db.updateUser(u, { share: 1, nowplaying: u === "u3" ? 0 : 1, guild_id: "G" }); db.setSteamLink(u, ids[k], true);
    }
    const calls = [], t = { now: 1_000_000 };
    const src = createNowPlaying({ apiKey: "K", fetchImpl: feed(map, calls), now: () => t.now });
    return { db, src, calls, t, ...extra };
}

test("now playing: only members who opted in are looked up, grouped by game", async () => {
    const w = world({ [ids.a]: [730, "Counter-Strike 2"], [ids.b]: [730, "Counter-Strike 2"], [ids.c]: [570, "Dota 2"] });
    const r = await whoIsPlaying(w.db, w.src, "G");
    assert.equal(r.watching, 2);
    assert.deepEqual(r.games.map(g => [g.game, g.players.map(p => p.userId)]), [["Counter-Strike 2", ["u1", "u2"]]]);
    assert.ok(!w.calls[0].includes(ids.c), "a member who did not opt in is never asked about");
    await whoIsPlaying(w.db, w.src, "G");
    assert.equal(w.calls.length, 1, "answers are remembered for a minute");
    w.t.now += 61_000; await whoIsPlaying(w.db, w.src, "G");
    assert.equal(w.calls.length, 2);
});

test("now playing: no key means off, and bad ids are ignored", async () => {
    assert.equal(createNowPlaying({}).enabled, false);
    assert.equal((await fetchPlayers(["x"], { apiKey: "K", fetchImpl: () => { throw new Error("no"); } })).size, 0);
    const w = world({});
    const r = await whoIsPlaying(w.db, createNowPlaying({}), "G");
    assert.deepEqual(r.games, []);
    const e = nowPlayingEmbed({ games: [], watching: 0 });
    assert.match(e.description, /alerts nowplaying/);
});

test("squad up: posts once per game per few hours, pings only the chosen role", async () => {
    const w = world({ [ids.a]: [730, "Counter-Strike 2"], [ids.b]: [730, "Counter-Strike 2"] });
    w.db.setCommunity("G", { squad_channel: "chan", ping_squad: "role1" });
    const posts = [], notifier = { postChannel: async (c, p, r) => { posts.push([c, p, r]); return true; } };
    let r = await runSquadUps({ db: w.db, src: w.src, notifier, now: () => w.t.now });
    assert.equal(r.posted, 1); assert.equal(posts[0][0], "chan"); assert.equal(posts[0][2], "role1");
    assert.match(posts[0][1].embeds[0].title, /2 members/);
    r = await runSquadUps({ db: w.db, src: w.src, notifier, now: () => w.t.now + 3600_000 });
    assert.equal(r.posted, 0, "not again within four hours");
    r = await runSquadUps({ db: w.db, src: w.src, notifier, now: () => w.t.now + 5 * 3600_000 });
    assert.equal(r.posted, 1);
});

test("squad up: one player alone is not a squad", async () => {
    const w = world({ [ids.a]: [730, "Counter-Strike 2"] });
    w.db.setCommunity("G", { squad_channel: "chan" });
    const r = await runSquadUps({ db: w.db, src: w.src, notifier: { postChannel: async () => assert.fail("no post") } });
    assert.equal(r.posted, 0);
});

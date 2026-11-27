import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createPledgeService, progressOf } from "../src/pledge.js";

const DAY = 86400_000;
function setup() {
    const db = openDb(":memory:");
    let t = 1_800_000_000_000;
    const posts = [], edits = [];
    const discord = { post: async (c, p) => { posts.push({ c, p }); return { id: "m" + posts.length }; }, edit: async (c, m, p) => { edits.push({ c, m, p }); } };
    const refreshed = [];
    const svc = createPledgeService({ db, discord, now: () => t, refresh: async u => { refreshed.push(u); } });
    db.ensureUser("p1"); db.ensureUser("a"); db.ensureUser("b");
    const set = minutes => db.syncSteamGames("p1", [{ itad_id: "hades", title: "Hades", appid: 1145360, minutes, lastPlayed: null }, { itad_id: "celeste", title: "Celeste", appid: 504230, minutes: 0, lastPlayed: null }], { track: false });
    set(600);
    return { db, svc, posts, edits, refreshed, set, advance: ms => { t += ms; } };
}

test("a pledge needs a library game and fair limits", async () => {
    const { svc, db } = setup();
    await assert.rejects(svc.create({ guildId: "g", channelId: "c", userId: "p1", title: "Nope", hours: 5 }), /couldn't find/);
    await assert.rejects(svc.create({ guildId: "g", channelId: "c", userId: "p1", title: "Hades", hours: 500 }), /between 1 and 200/);
    await assert.rejects(svc.create({ guildId: "g", channelId: "c", userId: "p1", title: "Hades", hours: 5, days: 1 }), /between 2 and 60/);
    await assert.rejects(svc.create({ guildId: "g", channelId: "c", userId: "a", title: "Hades", hours: 5 }), /Link your Steam/);
    const p = await svc.create({ guildId: "g", channelId: "c", userId: "p1", title: "hade", hours: 5 });
    assert.equal(p.title, "Hades"); assert.equal(p.base_minutes, 600);
    await assert.rejects(svc.create({ guildId: "g", channelId: "c", userId: "p1", title: "Hades", hours: 5 }), /already have an open pledge/);
    await svc.create({ guildId: "g", channelId: "c", userId: "p1", title: "Celeste", hours: 3 });
    await assert.rejects(svc.create({ guildId: "g", channelId: "c2", userId: "p1", title: "Celeste", hours: 3 }), /open pledges|open pledge/);
    assert.equal(db.countOpenPledgesBy("g", "p1"), 2);
});

test("voting: no self votes, switching sides, closed pledges refuse", async () => {
    const { svc, db } = setup();
    const p = await svc.create({ guildId: "g", channelId: "c", userId: "p1", title: "Hades", hours: 5 });
    await assert.rejects(svc.vote(p.id, "p1", "back"), /your own pledge/);
    assert.equal((await svc.vote(p.id, "a", "back")).result, "voted");
    assert.equal((await svc.vote(p.id, "a", "back")).result, "same");
    assert.equal((await svc.vote(p.id, "a", "doubt")).result, "switched");
    assert.deepEqual(db.pledgeVotes(p.id).map(v => v.side), ["doubt"]);
    await svc.cancel(p.id, "p1");
    await assert.rejects(svc.vote(p.id, "b", "back"), /settled/);
});

test("it is kept the moment the hours are in, with points for the pledger and right callers", async () => {
    const { svc, db, set, posts } = setup();
    const p = await svc.create({ guildId: "g", channelId: "c", userId: "p1", title: "Hades", hours: 5 });
    await svc.vote(p.id, "a", "back"); await svc.vote(p.id, "b", "doubt");
    set(600 + 200);
    assert.equal((await svc.tick()).kept, 0, "4 of 5 hours is not enough yet");
    set(600 + 300);
    assert.deepEqual(await svc.tick(), { kept: 1, failed: 0, checked: 1 });
    assert.equal(db.getPledge(p.id).status, "kept");
    assert.match(posts.at(-1).p.content, /<@p1> <@a>/); assert.doesNotMatch(posts.at(-1).p.content, /<@b>/);
    const board = db.pledgeBoard("g");
    assert.deepEqual(board.map(r => [r.user_id, r.points]), [["p1", 10], ["a", 3]]);
    assert.equal((await svc.tick()).checked, 0, "settled pledges are left alone");
});

test("a missed deadline refreshes playtime first, then fails and rewards the doubters", async () => {
    const { svc, db, refreshed, posts, advance } = setup();
    const p = await svc.create({ guildId: "g", channelId: "c", userId: "p1", title: "Hades", hours: 5, days: 7 });
    await svc.vote(p.id, "a", "back"); await svc.vote(p.id, "b", "doubt");
    advance(8 * DAY);
    assert.deepEqual(await svc.tick(), { kept: 0, failed: 1, checked: 1 });
    assert.deepEqual(refreshed, ["p1"]);
    assert.equal(db.getPledge(p.id).status, "failed");
    assert.match(posts.at(-1).p.embeds[0].title, /Pledge missed/);
    assert.deepEqual(db.pledgeBoard("g").map(r => [r.user_id, r.points]), [["b", 3], ["p1", 0]], "the wrong backer earns nothing and is not listed");
});

test("progress never goes negative, and forgetting someone cancels their open pledge", async () => {
    const { svc, db } = setup();
    assert.equal(progressOf({ base_minutes: 600 }, 500), 0);
    const p = await svc.create({ guildId: "g", channelId: "c", userId: "p1", title: "Hades", hours: 5 });
    db.deleteUser("p1");
    assert.equal(db.getPledge(p.id).status, "cancelled");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createTopgg, VOTE_XP } from "../src/topgg.js";
import { createCommunity } from "../src/communityservice.js";

const NOW = Date.parse("2026-11-05T12:00:00Z");
const vote = (id, at, weight = 1) => ({ user_id: "t" + id, platform_id: id, weight, created_at: at, expires_at: new Date(Date.parse(at) + 12 * 3600_000).toISOString() });

function rig(pages) {
    const db = openDb(":memory:", { now: () => NOW });
    const calls = [], rewards = [], notes = [];
    const fetchImpl = async (url, opts) => {
        calls.push({ url, auth: opts.headers.Authorization });
        const next = pages.shift();
        if (next === "boom") return { ok: false, status: 500, json: async () => ({}) };
        if (next === 404) return { ok: false, status: 404, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => next ?? { cursor: "c", data: [] } };
    };
    const tg = createTopgg({ token: "tok", db, now: () => NOW, fetchImpl, reward: async (u, xp) => { rewards.push([u, xp]); return 2; }, notify: async (u, v) => { notes.push([u, v]); } });
    return { db, tg, calls, rewards, notes };
}

test("topgg: each vote pays once, weekend votes pay double, and nothing is paid twice", async () => {
    const t = rig([
        { cursor: "c1", data: [vote("1111111111", "2026-11-05T10:00:00Z"), vote("2222222222", "2026-11-05T10:05:00Z", 2)] }, { cursor: "c1", data: [] },
        { cursor: "c2", data: [vote("1111111111", "2026-11-05T10:00:00Z")] }, { cursor: "c2", data: [] }
    ]);
    assert.equal((await t.tg.poll()).rewarded, 2);
    assert.deepEqual(t.rewards, [["1111111111", VOTE_XP], ["2222222222", VOTE_XP * 2]]);
    assert.equal(t.calls[0].auth, "Bearer tok");
    assert.match(t.calls[0].url, /votes\?startDate=/);
    assert.deepEqual([t.notes[0][1].servers, t.notes[0][1].total], [2, 1]);
    assert.equal((await t.tg.poll()).rewarded, 0, "the same vote is not paid again");
    assert.match(t.calls[2].url, /cursor=c1/, "the second check continues from the saved cursor");
});

test("topgg: a failure is quiet and the next check carries on", async () => {
    const t = rig(["boom", { cursor: "c", data: [vote("3333333333", "2026-11-05T11:00:00Z")] }, { cursor: "c", data: [] }]);
    assert.equal((await t.tg.poll()).rewarded, 0);
    assert.equal(t.tg.health().lastError, "http500");
    assert.equal((await t.tg.poll()).rewarded, 1);
    assert.equal(t.tg.health().lastError, null);
});

test("topgg: without a token nothing is called, and status reads the vote window", async () => {
    const off = createTopgg({ token: "", db: openDb(":memory:"), fetchImpl: async () => { throw new Error("no calls"); }, reward: async () => 0 });
    assert.deepEqual(await off.poll(), { rewarded: 0 });
    assert.equal((await off.status("1")).enabled, false);
    const t = rig([{ created_at: "2026-11-05T11:00:00Z", expires_at: "2026-11-05T23:00:00Z", weight: 1 }, 404]);
    assert.equal((await t.tg.status("1111111111")).voted, true);
    assert.equal((await t.tg.status("1111111111")).voted, false);
});

test("topgg: the bonus lands in every server where the voter already has XP and leveling is on", async () => {
    const db = openDb(":memory:", { now: () => NOW });
    for (const g of ["G1", "G2", "G3"]) db.addXp(g, "u1", 10);
    db.addXp("G1", "other", 10);
    db.setCommunity("G3", { xp_on: 0 });
    const community = createCommunity({ db, api: { addRole: async () => {} }, now: () => NOW });
    assert.equal(await community.grantBonusXp("u1", 250), 2);
    assert.equal(db.getXp("G1", "u1").xp, 260);
    assert.equal(db.getXp("G2", "u1").xp, 260);
    assert.equal(db.getXp("G3", "u1").xp, 10);
    assert.equal(db.getXp("G1", "other").xp, 10);
});

test("topgg: admin stats add up votes, xp and top voters", async () => {
    const t = rig([{ cursor: "c1", data: [vote("1111111111", "2026-11-05T10:00:00Z"), vote("1111111111", "2026-11-05T10:30:00Z"), vote("2222222222", "2026-11-05T10:05:00Z", 2)] }, { cursor: "c1", data: [] }]);
    await t.tg.poll();
    const s = t.tg.adminStats();
    assert.equal(s.votes, 3);
    assert.equal(s.voters, 2);
    assert.equal(s.xp, (VOTE_XP + VOTE_XP + VOTE_XP * 2) * 2); // the fake reward reports 2 servers
    assert.deepEqual(s.top[0], { id: "1111111111", votes: 2 });
    assert.equal(s.recent.length, 3);
    assert.equal(s.recent[0].id, "2222222222"); // newest first
});

import test from "node:test";
import assert from "node:assert/strict";
import { humanCount, warmMembers } from "../src/members.js";
import { collectAbout } from "../src/about.js";

const member = bot => ({ user: { bot } });
const cacheOf = list => ({ filter: f => { const r = list.filter(f); return { size: r.length }; } });
const guild = (memberCount, list = [], me = true) => ({ memberCount, members: { cache: cacheOf(list), me: me ? member(true) : null } });

test("bots are not counted: the cached bots come off, and the bot itself always does", () => {
    assert.equal(humanCount(guild(20, [member(true), member(true), member(false), member(false)])), 18);
    assert.equal(humanCount(guild(20, [])), 19, "nothing cached: at least the bot itself");
    assert.equal(humanCount(guild(20, [], false)), 20, "no way to know");
    assert.equal(humanCount({ memberCount: 7 }), 7); assert.equal(humanCount(null), 0); assert.equal(humanCount(guild(1, [member(true), member(true)])), 0, "never below zero");
});

test("the numbers the bot shows add up humans only", () => {
    const guilds = new Map([["a", guild(10, [member(true)])], ["b", guild(5, [member(true), member(true)])]]);
    const info = collectAbout({ client: { guilds: { cache: guilds }, ws: { ping: 1 } }, db: { stats: () => ({ uniqueGames: 0, activeUsers: 0 }) }, cfg: {}, startedAt: Date.now(), version: "1" });
    assert.equal(info.members, 12);
});

test("loading members goes smallest first, skips huge servers and survives a failure", async () => {
    const order = [];
    const g = (id, n, fail) => ({ id, memberCount: n, members: { fetch: async () => { order.push(id); if (fail) throw new Error("timed out"); } } });
    const logs = [];
    await warmMembers(new Map([["big", g("big", 20000)], ["b", g("b", 500, true)], ["a", g("a", 20)]]), { max: 10000, log: m => logs.push(m) });
    assert.deepEqual(order, ["a", "b"]); assert.match(logs[0], /could not load the members of b/);
});

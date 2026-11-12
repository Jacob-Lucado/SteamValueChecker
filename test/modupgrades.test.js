import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createModeration, ModError } from "../src/moderation.js";

const OWNER = "900000000000000001", MOD = "900000000000000002", USER = "900000000000000004", BOT = "900000000000000005";

function rig() {
    const db = openDb(":memory:");
    db.setCommunity("G", { mod_log_channel: "LOG" });
    let clock = 1_000_000_000_000, banned = new Set(); const calls = [], dms = [];
    const members = { [OWNER]: { roles: ["o"] }, [MOD]: { roles: ["m"] }, [USER]: { roles: [] }, [BOT]: { roles: ["b"] } };
    const api = {
        getGuild: async () => ({ name: "Test", owner_id: OWNER }),
        allRoles: async () => [{ id: "G", position: 0 }, { id: "m", position: 5 }, { id: "b", position: 9 }, { id: "o", position: 10 }],
        getMember: async (_g, id) => members[id] ?? null,
        banMember: async (_g, id) => { banned.add(id); calls.push({ t: "ban", id }); },
        unbanMember: async (_g, id) => { banned.delete(id); calls.push({ t: "unban", id }); },
        getBan: async (_g, id) => (banned.has(id) ? { reason: "spam" } : null),
        sendMessage: async (c, p) => calls.push({ t: "log", c, p })
    };
    const mod = createModeration({ db, api, now: () => clock, dm: async (id, p) => { dms.push({ id, p }); }, botId: () => BOT, appealUrl: "https://x.test" });
    return { db, mod, calls, dms, banned, tick: ms => { clock += ms; } };
}

test("a temporary ban lifts itself when its time is up", async () => {
    const r = rig();
    const out = await r.mod.ban({ guildId: "G", actorId: MOD, userId: USER, reason: "cool off", duration: "2h" });
    assert.equal(out.case.duration_s, 7200); assert.ok(r.banned.has(USER));
    assert.equal(await r.mod.liftDueBans(), 0); r.tick(3_600_000); assert.equal(await r.mod.liftDueBans(), 0);
    r.tick(3_700_000); assert.equal(await r.mod.liftDueBans(), 1);
    assert.ok(!r.banned.has(USER)); assert.equal(r.db.tempBans("G").length, 0);
    assert.equal(r.db.listCases("G")[0].action, "unban");
    assert.equal(await r.mod.liftDueBans(), 0);
});
test("a ban length that makes no sense is refused, and a permanent ban is not scheduled to lift", async () => {
    const r = rig();
    await assert.rejects(r.mod.ban({ guildId: "G", actorId: MOD, userId: USER, duration: "soon" }), e => e instanceof ModError && e.status === 400);
    await r.mod.ban({ guildId: "G", actorId: MOD, userId: USER, reason: "x" });
    assert.equal(r.db.tempBans("G").length, 0);
});
test("warnings stop counting after the server's expiry", async () => {
    const r = rig();
    await r.mod.warn({ guildId: "G", actorId: MOD, userId: USER, reason: "a" });
    assert.equal(r.db.warnCount("G", USER), 1);
    r.db.setCommunity("G", { warn_days: 7 });
    assert.equal(r.db.warnCount("G", USER, Date.now() + 3 * 86400_000), 1);
    assert.equal(r.db.warnCount("G", USER, Date.now() + 9 * 86400_000), 0);
});
test("moderator stats count people's actions and leave the bot's own out", async () => {
    const r = rig();
    await r.mod.warn({ guildId: "G", actorId: MOD, userId: USER, reason: "a" });
    await r.mod.ban({ guildId: "G", actorId: MOD, userId: USER, reason: "b" });
    await r.mod.auto({ guildId: "G", userId: USER, action: "warn", reason: "spam" });
    const s = r.mod.stats("G", 30);
    assert.equal(s.length, 1); assert.equal(s[0].mod_id, MOD); assert.equal(s[0].total, 2); assert.deepEqual(s[0].actions, { warn: 1, ban: 1 });
});
test("a banned person can appeal once and a moderator can accept it", async () => {
    const r = rig();
    await assert.rejects(r.mod.appeal({ guildId: "G", userId: USER, text: "please let me back in" }), e => e.status === 403);
    r.db.setCommunity("G", { appeals_on: 1 });
    await assert.rejects(r.mod.appeal({ guildId: "G", userId: USER, text: "please let me back in" }), e => e.status === 404);
    await r.mod.ban({ guildId: "G", actorId: MOD, userId: USER, reason: "spam" });
    assert.match(JSON.stringify(r.dms[0].p), /appeal\?guild=G/);
    await assert.rejects(r.mod.appeal({ guildId: "G", userId: USER, text: "short" }), e => e.status === 400);
    const { appeal } = await r.mod.appeal({ guildId: "G", userId: USER, text: "I am sorry, it will not happen again" });
    await assert.rejects(r.mod.appeal({ guildId: "G", userId: USER, text: "I am sorry, it will not happen again" }), e => e.status === 409);
    assert.ok(r.calls.some(c => c.t === "log" && /Ban appeal/.test(JSON.stringify(c.p))));
    const done = await r.mod.decideAppeal({ guildId: "G", actorId: MOD, id: appeal.id, accept: true, note: "welcome back" });
    assert.equal(done.appeal.status, "accepted"); assert.ok(!r.banned.has(USER));
    await assert.rejects(r.mod.decideAppeal({ guildId: "G", actorId: MOD, id: appeal.id, accept: false }), e => e.status === 409);
    assert.equal(r.db.listAppeals("G").length, 0);
});
test("a denied appeal leaves the ban in place", async () => {
    const r = rig(); r.db.setCommunity("G", { appeals_on: 1 });
    await r.mod.ban({ guildId: "G", actorId: MOD, userId: USER, reason: "spam" });
    const { appeal } = await r.mod.appeal({ guildId: "G", userId: USER, text: "pretty please let me back in" });
    await r.mod.decideAppeal({ guildId: "G", actorId: MOD, id: appeal.id, accept: false });
    assert.ok(r.banned.has(USER));
});

import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createModeration, parseDuration, fmtDuration, parseUserId, ModError } from "../src/moderation.js";
import { createModHandlers } from "../src/modhandlers.js";
import { communitySetup, BOT_PERMISSIONS } from "../src/community.js";
import { DiscordApiError } from "../src/dashboard/discord.js";

const OWNER = "900000000000000001", MOD = "900000000000000002", BOSS = "900000000000000003", USER = "900000000000000004", BOT = "900000000000000005", OUT = "900000000000000006";
const snow = ms => String((BigInt(ms - 1420070400000) << 22n) + 7n);

function rig({ log = "LOG", denyKick = false } = {}) {
    const db = openDb(":memory:");
    if (log) db.setCommunity("G", { mod_log_channel: log });
    const calls = [], dms = [];
    const members = { [OWNER]: { roles: ["r_owner"] }, [MOD]: { roles: ["r_mod"] }, [BOSS]: { roles: ["r_boss"] }, [USER]: { roles: [] }, [BOT]: { roles: ["r_bot"] } };
    const api = {
        getGuild: async () => ({ name: "Test", owner_id: OWNER }),
        allRoles: async () => [{ id: "G", position: 0 }, { id: "r_mod", position: 5 }, { id: "r_boss", position: 7 }, { id: "r_bot", position: 9 }, { id: "r_owner", position: 10 }],
        getMember: async (_g, id) => members[id] ?? null,
        timeoutMember: async (_g, id, until, reason) => calls.push({ t: "timeout", id, until, reason }),
        kickMember: async (_g, id) => { if (denyKick) throw new DiscordApiError(403, "no"); calls.push({ t: "kick", id }); },
        banMember: async (_g, id, o) => calls.push({ t: "ban", id, ...o }),
        unbanMember: async (_g, id) => { if (id === OUT) throw new DiscordApiError(404, "no"); calls.push({ t: "unban", id }); },
        getMessages: async () => [
            { id: snow(Date.now() - 1000), author: { id: USER } }, { id: snow(Date.now() - 2000), author: { id: MOD } },
            { id: snow(Date.now() - 3000), author: { id: USER } }, { id: snow(Date.now() - 20 * 86400_000), author: { id: USER } }],
        bulkDelete: async (_c, ids) => calls.push({ t: "bulk", n: ids.length }), deleteMessage: async () => calls.push({ t: "del1" }),
        sendMessage: async (c, p) => calls.push({ t: "log", c, p })
    };
    const mod = createModeration({ db, api, dm: async (id, p) => { dms.push({ id, p }); }, botId: () => BOT });
    return { db, api, mod, calls, dms };
}
const rejects = (p, status, re) => assert.rejects(p, e => e instanceof ModError && (!status || e.status === status) && (!re || re.test(e.message)));

test("durations and user ids are read the way people type them", () => {
    assert.equal(parseDuration("10m"), 600); assert.equal(parseDuration("2h"), 7200); assert.equal(parseDuration("3d"), 259200);
    assert.equal(parseDuration("30"), 1800); assert.equal(parseDuration("1w"), 604800); assert.equal(parseDuration("soon"), null);
    assert.equal(fmtDuration(5400), "1 hour 30 minutes");
    assert.equal(parseUserId("<@!123456789012345678>"), "123456789012345678"); assert.equal(parseUserId("nope"), null);
});

test("a warning becomes case 1, is logged, messaged to the member and counted", async () => {
    const { mod, calls, dms, db } = rig();
    const r = await mod.warn({ guildId: "G", actorId: MOD, userId: USER, reason: "  spamming \n links " });
    assert.equal(r.case.case_no, 1); assert.equal(r.case.reason, "spamming links"); assert.equal(r.warnings, 1);
    assert.equal(dms[0].id, USER); assert.match(dms[0].p.content, /warned in \*\*Test\*\*/);
    const log = calls.find(c => c.t === "log");
    assert.equal(log.c, "LOG"); assert.match(log.p.embeds[0].title, /Case #1/); assert.deepEqual(log.p.allowed_mentions, { parse: [] });
    assert.equal((await mod.warn({ guildId: "G", actorId: MOD, userId: USER })).case.case_no, 2);
    assert.equal(db.warnCount("G", USER), 2);
    assert.deepEqual(mod.clearWarnings({ guildId: "G", userId: USER }), { cleared: 2 });
    assert.equal(db.warnCount("G", USER), 0); assert.equal(db.countCases("G", USER), 2, "history stays");
    assert.ok(db.usageCounts().mod_warn);
});

test("nobody can act on themselves, the owner, the bot or someone above them", async () => {
    const { mod } = rig();
    await rejects(mod.warn({ guildId: "G", actorId: MOD, userId: MOD }), 400, /yourself/);
    await rejects(mod.kick({ guildId: "G", actorId: MOD, userId: OWNER }), 403, /owner/);
    await rejects(mod.ban({ guildId: "G", actorId: MOD, userId: BOT }), 400, /myself/);
    await rejects(mod.timeout({ guildId: "G", actorId: MOD, userId: BOSS, duration: "10m" }), 403, /at or above yours/);
    await rejects(mod.warn({ guildId: "G", actorId: MOD, userId: "abc" }), 400, /user ID/);
    await rejects(mod.warn({ guildId: "G", actorId: MOD, userId: OUT }), 404, /not in this server/);
    // the owner can act on anyone who is not the bot's equal or above
    await mod.warn({ guildId: "G", actorId: OWNER, userId: BOSS });
});

test("timeout length is checked and sent to Discord as a date; kick and ban message the member first", async () => {
    const { mod, calls, dms } = rig();
    await rejects(mod.timeout({ guildId: "G", actorId: MOD, userId: USER, duration: "40d" }), 400, /28 days/);
    await rejects(mod.timeout({ guildId: "G", actorId: MOD, userId: USER, duration: "banana" }), 400);
    const t = await mod.timeout({ guildId: "G", actorId: MOD, userId: USER, duration: "10m", reason: "calm down" });
    assert.equal(t.case.duration_s, 600);
    const sent = calls.find(c => c.t === "timeout");
    assert.ok(Math.abs(new Date(sent.until).getTime() - (Date.now() + 600_000)) < 5000);
    await mod.untimeout({ guildId: "G", actorId: MOD, userId: USER });
    assert.equal(calls.filter(c => c.t === "timeout").pop().until, null);
    await mod.kick({ guildId: "G", actorId: MOD, userId: USER, reason: "bye" });
    assert.ok(calls.some(c => c.t === "kick")); assert.ok(dms.some(d => /kicked/.test(d.p.content)));
    const b = await mod.ban({ guildId: "G", actorId: MOD, userId: USER, deleteDays: 99 });
    assert.equal(calls.find(c => c.t === "ban").deleteSeconds, 7 * 86400, "capped at 7 days");
    assert.equal(b.case.action, "ban");
    // banning someone who already left works, by ID
    await mod.ban({ guildId: "G", actorId: MOD, userId: OUT });
});

test("a refused Discord action says why, records nothing, and a missing mod log never blocks an action", async () => {
    const r = rig({ denyKick: true });
    await rejects(r.mod.kick({ guildId: "G", actorId: MOD, userId: USER }), 403, /permission/);
    assert.equal(r.db.countCases("G"), 0);
    const none = rig({ log: null });
    const ok = await none.mod.warn({ guildId: "G", actorId: MOD, userId: USER });
    assert.equal(ok.case.case_no, 1); assert.ok(!none.calls.some(c => c.t === "log"));
    // older servers keep logging to their old log channel until a mod log is chosen
    const old = rig({ log: null }); old.db.setCommunity("G", { log_channel: "OLD" });
    await old.mod.warn({ guildId: "G", actorId: MOD, userId: USER });
    assert.equal(old.calls.find(c => c.t === "log").c, "OLD");
});

test("unban, and purge only touches recent messages (optionally one person's)", async () => {
    const { mod, calls } = rig();
    await rejects(mod.unban({ guildId: "G", actorId: MOD, userId: OUT }), 404, /not banned/);
    assert.equal((await mod.unban({ guildId: "G", actorId: MOD, userId: USER })).case.action, "unban");
    const p = await mod.purge({ guildId: "G", actorId: MOD, channelId: "900000000000000099", amount: 50 });
    assert.equal(p.deleted, 3, "the 20 day old message is skipped");
    assert.equal(calls.find(c => c.t === "bulk").n, 3);
    const one = await mod.purge({ guildId: "G", actorId: MOD, channelId: "900000000000000099", amount: 50, userId: MOD });
    assert.equal(one.deleted, 1); assert.ok(calls.some(c => c.t === "del1"));
    await rejects(mod.purge({ guildId: "G", actorId: MOD, channelId: "900000000000000099", amount: 500 }), 400);
});

test("case history pages, filters by member and is removed with the member's data", async () => {
    const { mod, db } = rig();
    for (let i = 0; i < 12; i++) await mod.warn({ guildId: "G", actorId: MOD, userId: USER });
    const h = mod.history("G", { page: 2 });
    assert.equal(h.pages, 2); assert.equal(h.cases.length, 2); assert.equal(h.cases[0].case_no, 2);
    assert.equal(mod.history("G", { userId: USER }).warnings, 12);
    assert.equal(mod.history("G", { userId: "900000000000000099" }).total, 0);
    db.ensureUser(USER);
    assert.equal(db.exportUser(USER).community.moderation.length, 12);
    db.deleteUser(USER);
    assert.equal(db.countCases("G", USER), 0);
});

test("/mod commands check the Discord permission each one needs and report plainly", async () => {
    const { mod, db, calls } = rig();
    const ui = createModHandlers({ db, mod });
    const replies = [];
    const mk = (sub, opts = {}, perms = 0n) => ({
        inGuild: () => true, guildId: "G", user: { id: MOD, username: "mod" }, channelId: "900000000000000099", deferred: false, replied: false,
        memberPermissions: { has: bit => (perms & bit) === bit || (perms & 8n) === 8n },
        options: { getSubcommand: () => sub, getUser: n => (opts[n] ? { id: opts[n], username: "u" } : null), getString: n => opts[n] ?? null, getInteger: n => opts[n] ?? null, getChannel: () => null, getBoolean: () => null },
        reply: async x => { replies.push(x); }, deferReply: async () => { }, editReply: async x => { replies.push(x); }
    });
    await ui.handleCommand(mk("ban", { user: USER }, 1n << 40n)); // has Moderate Members only
    assert.match(replies.pop().content, /Ban Members permission/);
    await ui.handleCommand(mk("warn", { user: USER, reason: "x" }, 1n << 40n));
    assert.match(replies.pop().content, /Warned <@900000000000000004> \(case #1\)/);
    await ui.handleCommand(mk("timeout", { user: USER, duration: "10m" }, 1n << 40n));
    assert.match(replies.pop().content, /Timed out .* for 10 minutes/);
    await ui.handleCommand(mk("warn", { user: BOSS }, 1n << 40n));
    assert.match(replies.pop().content, /at or above yours/);
    await ui.handleCommand(mk("cases", {}, 1n << 40n));
    assert.match(replies.pop().embeds[0].description, /Timeout/);
    await ui.handleCommand(mk("log", { channel: null }, 0n));
    assert.match(replies.pop().content, /Manage Server/);
    assert.ok(db.usageCounts()["cmd:mod/warn"]);
});

test("setup makes #mod-log and #member-log, points giveaways at #giveaways, and the invite asks for the moderation permissions", async () => {
    const db = openDb(":memory:");
    let n = 1000; const chans = [], sent = [];
    const api = {
        allChannels: async () => chans, allRoles: async () => [{ id: "G", name: "@everyone" }], getGuild: async () => ({ name: "T", approximate_member_count: 1 }),
        createChannel: async (_g, b) => { const c = { id: String(++n), ...b }; chans.push(c); return c; }, editChannel: async () => ({}), deleteChannel: async () => { },
        createRole: async (_g, b) => ({ id: String(++n), ...b }), editGuild: async () => { }, sendMessage: async (id, p) => { sent.push({ id, p }); return { id: "m" }; }, addRole: async () => { }
    };
    const r = await communitySetup({ api, db, guildId: "G", botId: "b", userId: "o", sleep: async () => { }, pace: 0 });
    assert.ok(r.channels.modlog && r.channels.memberlog && r.channels.modlog !== r.channels.memberlog);
    const c = db.getCommunity("G");
    assert.equal(c.mod_log_channel, r.channels.modlog); assert.equal(c.log_channel, r.channels.memberlog);
    assert.equal(db.getGiveawaySettings("G").giveaway_channel_id, r.channels.giveaways);
    // an already chosen giveaway channel is left alone
    db.setGiveawaySettings("G", { giveaway_channel_id: "mine" });
    await communitySetup({ api, db, guildId: "G", botId: "b", userId: "o", sleep: async () => { }, pace: 0 });
    assert.equal(db.getGiveawaySettings("G").giveaway_channel_id, "mine");
    const bits = BigInt(BOT_PERMISSIONS);
    for (const b of [1n, 2n, 13n, 40n]) assert.ok(bits & (1n << b), `permission bit ${b}`);
});

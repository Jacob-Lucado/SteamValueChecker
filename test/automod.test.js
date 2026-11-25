import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createModeration, ModError } from "../src/moderation.js";
import { createAutomod, cleanAutomod, breaks, DEFAULTS } from "../src/automod.js";

const BOT = "900000000000000005", U1 = "900000000000000011", U2 = "900000000000000012";

function rig(settings = {}) {
    const db = openDb(":memory:"), calls = [], dms = [];
    let clock = 1_000_000;
    const api = {
        getGuild: async () => ({ name: "Test", owner_id: "900000000000000001" }),
        timeoutMember: async (_g, id, until) => calls.push({ t: "timeout", id, until }), kickMember: async (_g, id) => calls.push({ t: "kick", id }), banMember: async (_g, id) => calls.push({ t: "ban", id }),
        sendMessage: async (c, p) => calls.push({ t: "log", c, p }), editChannel: async (id, b) => calls.push({ t: "edit", id, b }),
        getChannel: async () => ({ permission_overwrites: [{ id: "G", type: 0, allow: "2048", deny: "0" }] }),
        setOverwrite: async (id, target, o) => calls.push({ t: "overwrite", id, target, ...o })
    };
    const mod = createModeration({ db, api, dm: async (id, p) => { dms.push(id); }, botId: () => BOT, now: () => clock });
    const am = createAutomod({ db, api, mod, botId: () => BOT, now: () => clock });
    am.save("G", settings);
    return { db, api, mod, am, calls, dms, tick: ms => { clock += ms; } };
}
const msg = (o = {}) => ({ guildId: "G", channelId: "900000000000000099", messageId: "m", authorId: U1, content: "hello", deleteMessage: async () => {}, ...o });

test("settings are cleaned into safe, complete values", () => {
    const c = cleanAutomod({ on: "true", rules: { spam: { on: 1, count: 9999, seconds: 0 }, words: { on: true, list: "Foo, BAR\nfoo" }, links: { on: true, allow: ["https://www.YouTube.com/x", "bad domain!"] } }, escalate: { warns: 3, action: "nuke" }, exemptRoles: ["12", "900000000000000001"] });
    assert.equal(c.on, true); assert.equal(c.rules.spam.count, 20); assert.equal(c.rules.spam.seconds, 2);
    assert.deepEqual(c.rules.words.list, ["foo", "bar"]); assert.deepEqual(c.rules.links.allow, ["youtube.com", "baddomain"]);
    assert.equal(c.escalate.action, "timeout"); assert.deepEqual(c.exemptRoles, ["900000000000000001"]);
    assert.equal(cleanAutomod(null).on, false); assert.equal(cleanAutomod({}).rules.mentions.max, DEFAULTS.rules.mentions.max);
});

test("each rule catches what it should and leaves normal chat alone", () => {
    const cfg = cleanAutomod({ rules: { mentions: { on: true, max: 3 }, invites: { on: true }, links: { on: true, allow: ["youtube.com"] }, words: { on: true, list: ["badword"] }, caps: { on: true } } });
    assert.equal(breaks(cfg, { content: "hi", mentionCount: 4 }), "mentions");
    assert.equal(breaks(cfg, { content: "join discord.gg/abc123 now" }), "invites");
    assert.equal(breaks(cfg, { content: "see https://evil.example/x" }), "links");
    assert.equal(breaks(cfg, { content: "see https://www.youtube.com/watch?v=1 and https://m.youtube.com/x" }), null);
    assert.equal(breaks(cfg, { content: "that is a BadWord!" }), "words");
    assert.equal(breaks(cfg, { content: "this badwordy thing is fine" }), null, "whole words only");
    assert.equal(breaks(cfg, { content: "STOP SHOUTING AT EVERYONE HERE" }), "caps");
    assert.equal(breaks(cfg, { content: "OK" }), null, "short messages are not shouting");
    assert.equal(breaks(cfg, { content: "Steam sale is on, GG everyone" }), null);
});

test("spam deletes, warns once per burst and escalates after enough warnings", async () => {
    const r = rig({ on: true, rules: { spam: { on: true, count: 3, seconds: 10 } }, escalate: { warns: 2, action: "kick" } });
    let deleted = 0;
    const send = () => r.am.onMessage(msg({ deleteMessage: async () => { deleted++; } }));
    assert.equal(await send(), null); r.tick(1000); assert.equal(await send(), null); r.tick(1000);
    assert.equal(await send(), "spam"); assert.equal(deleted, 1);
    assert.equal(r.db.warnCount("G", U1), 1);
    assert.ok(!r.calls.some(c => c.t === "kick"));
    r.tick(30_000); for (let i = 0; i < 2; i++) { await send(); r.tick(500); } assert.equal(await send(), "spam");
    assert.equal(r.db.warnCount("G", U1), 2); assert.ok(r.calls.some(c => c.t === "kick" && c.id === U1), "second warning kicks");
    assert.match(r.db.listCases("G", { limit: 5 })[0].reason, /^\[auto\]|warnings/);
});

test("staff, exempt roles and exempt channels are never touched; off means off", async () => {
    const r = rig({ on: true, rules: { invites: { on: true } }, exemptRoles: ["900000000000000077"], exemptChannels: ["900000000000000088"] });
    const bad = "discord.gg/spamspam";
    assert.equal(await r.am.onMessage(msg({ content: bad, staff: true })), null);
    assert.equal(await r.am.onMessage(msg({ content: bad, roles: ["900000000000000077"] })), null);
    assert.equal(await r.am.onMessage(msg({ content: bad, channelId: "900000000000000088" })), null);
    assert.equal(await r.am.onMessage(msg({ content: bad })), "invites");
    r.am.save("G", { on: false });
    assert.equal(await r.am.onMessage(msg({ content: bad })), null);
});

test("an automatic timeout replaces the warning when one is set", async () => {
    const r = rig({ on: true, rules: { words: { on: true, list: ["nope"] } }, action: { warn: false, timeoutMinutes: 10 } });
    assert.equal(await r.am.onMessage(msg({ content: "nope" })), "words");
    assert.ok(r.calls.some(c => c.t === "timeout" && c.id === U1)); assert.equal(r.db.warnCount("G", U1), 0);
});

test("the raid guard acts on a join flood and on brand-new accounts", async () => {
    const r = rig({ raid: { on: true, joins: 3, seconds: 20, action: "timeout", minutes: 30, minAccountDays: 7 } });
    const join = (id, created = null) => r.am.onJoin({ guildId: "G", userId: id, createdAtMs: created });
    assert.equal(await join(U1), null); r.tick(1000); assert.equal(await join(U2), null); r.tick(1000);
    assert.equal(await join("900000000000000013"), "raid");
    assert.equal(await join("900000000000000014"), "raid", "everyone in the flood window");
    assert.ok(r.calls.filter(c => c.t === "timeout").length >= 2);
    r.tick(11 * 60_000);
    assert.equal(await join("900000000000000015", 1_000_000 - 86400_000), "young");
    assert.equal(await join("900000000000000016", 1_000_000 - 30 * 86400_000), null);
    assert.equal(await r.am.onJoin({ guildId: "G", userId: "900000000000000017", bot: true }), null);
});

test("notes, slowmode and channel locks are logged as cases", async () => {
    const r = rig();
    const n = await r.mod.note({ guildId: "G", actorId: "900000000000000002", userId: U1, text: "  watch   this one " });
    assert.equal(n.case.action, "note"); assert.equal(n.case.reason, "watch this one"); assert.equal(r.dms.length, 0, "notes are never sent to the member");
    await assert.rejects(r.mod.note({ guildId: "G", actorId: "x", userId: U1, text: "" }), ModError);
    const s = await r.mod.slowmode({ guildId: "G", actorId: "900000000000000002", channelId: "900000000000000099", seconds: "30s" });
    assert.equal(s.seconds, 30); assert.deepEqual(r.calls.find(c => c.t === "edit").b, { rate_limit_per_user: 30 });
    assert.equal((await r.mod.slowmode({ guildId: "G", actorId: "x", channelId: "900000000000000099", seconds: "off" })).seconds, 0);
    await assert.rejects(r.mod.slowmode({ guildId: "G", actorId: "x", channelId: "900000000000000099", seconds: "7h" }), ModError);
    await r.mod.lock({ guildId: "G", actorId: "900000000000000002", channelId: "900000000000000099" });
    const locked = r.calls.find(c => c.t === "overwrite");
    assert.equal(locked.target, "G"); assert.ok(BigInt(locked.deny) & (1n << 11n), "send messages denied"); assert.equal(BigInt(locked.allow) & (1n << 11n), 0n, "and no longer allowed");
    await r.mod.lock({ guildId: "G", actorId: "900000000000000002", channelId: "900000000000000099", unlock: true });
    const open = r.calls.filter(c => c.t === "overwrite").at(-1);
    assert.equal(BigInt(open.deny) & (1n << 11n), 0n);
});

test("the dashboard reads and saves auto-mod settings and runs the new actions", async () => {
    const { createModDash } = await import("../src/dashboard/moddash.js");
    const r = rig();
    const rest = { listChannels: async () => [{ id: "900000000000000099", name: "general" }], allRoles: async () => [{ id: "G", name: "@everyone" }, { id: "900000000000000077", name: "Mods" }, { id: "900000000000000078", name: "bot", managed: true }], memberName: async () => "Someone" };
    const md = createModDash({ db: r.db, rest, mod: r.mod, automod: r.am });
    const saved = md.automodSave("G", { on: true, rules: { invites: { on: true } }, action: { warn: false, timeoutMinutes: 5 } });
    assert.equal(saved.settings.on, true); assert.equal(saved.settings.action.timeoutMinutes, 5);
    const got = await md.automodGet("G", { canEdit: true });
    assert.equal(got.settings.rules.invites.on, true); assert.deepEqual(got.roles, [{ id: "900000000000000077", name: "Mods" }]); assert.ok(got.rules.words);
    assert.throws(() => md.automodSave("G", null), e => e.status === 400);
    const n = await md.act("G", "900000000000000002", "note", { user: U1, reason: "hello" }); assert.equal(n.case.action, "note");
    const l = await md.act("G", "900000000000000002", "lock", { channel_id: "900000000000000099" }); assert.equal(l.case.action, "lock");
    const sm = await md.act("G", "900000000000000002", "slowmode", { channel_id: "900000000000000099", duration: "10s" }); assert.equal(sm.seconds, 10);
});

const SCAM = "Who need fresh and valid credit card 💳 with both visa and master cards available, once you link it know it's hitting instantly 🎯 ( These cards can be used for ATM Cashout or virtual apps for instant Cashout like Cashapp, Apple Pay PayPal, Venmo & Gpay ) HIGH QUALITY CCs 💳 30$ For One Card = balance 600$ Working on any Website, valid with no charge back. DM @BINERO LINKABLES V2 to purchase";

test("scam guard: a stolen-card sales post is deleted and the account banned, even with auto-mod otherwise off", async () => {
    const r = rig({});
    let deleted = false;
    const hit = await r.am.onMessage(msg({ content: SCAM, deleteMessage: async () => { deleted = true; } }));
    assert.equal(hit, "scam"); assert.ok(deleted);
    const ban = r.calls.find(c => c.t === "ban"); assert.ok(ban, "the account is banned"); assert.equal(ban.id, U1);
});

test("scam guard: ordinary chat, staff and servers that turned it off are left alone", async () => {
    const r = rig({});
    for (const content of ["I paid with my credit card on Steam, the sale price was great", "dm me your steam id for game night", "anyone know if a visa gift card works on GOG?"]) assert.equal(await r.am.onMessage(msg({ content })), null, content);
    assert.equal(await r.am.onMessage(msg({ content: SCAM, staff: true })), null, "staff are never touched");
    r.am.save("G", { scam: { on: false } });
    assert.equal(await r.am.onMessage(msg({ content: SCAM })), null);
    assert.equal(r.calls.filter(c => c.t === "ban").length, 0);
});

test("scam guard: the server can pick delete-only or kick", async () => {
    const r = rig({ scam: { action: "delete" } });
    assert.equal(await r.am.onMessage(msg({ content: SCAM })), "scam"); assert.equal(r.calls.filter(c => c.t === "ban" || c.t === "kick").length, 0);
    r.am.save("G", { scam: { action: "kick" } });
    await r.am.onMessage(msg({ content: SCAM })); assert.ok(r.calls.some(c => c.t === "kick"));
    assert.equal(cleanAutomod({ scam: { action: "nuke" } }).scam.action, "ban");
});

test("fake Steam and Discord links are removed with the scam action, real and honest sites are not", async () => {
    const r = rig({});
    assert.equal(await r.am.onMessage(msg({ content: "free skins here https://steamcomunity.com/gift/abc" })), "scam");
    assert.ok(r.calls.some(c => c.t === "ban"));
    for (const content of ["see https://store.steampowered.com/app/10 and https://steamdb.info/app/10", "https://discord.gg/abcdef join us", "deal at https://www.fanatical.com/en/bundle/x"]) assert.equal(await r.am.onMessage(msg({ content })), null, content);
    r.am.save("G", { phish: { on: false } });
    assert.equal(await r.am.onMessage(msg({ content: "https://steamcomunity.com/gift/abc" })), null);
});

test("new rules: crosspost, @everyone, emoji, lines, risky files and new-member links", async () => {
    const r = rig({ on: true, action: { warn: false }, rules: { crosspost: { on: true, channels: 3 }, everyone: { on: true }, emoji: { on: true, max: 5 }, lines: { on: true, max: 6 }, files: { on: true }, newlinks: { on: true, minutes: 10 } } });
    const ch = n => `90000000000000010${n}`;
    assert.equal(await r.am.onMessage(msg({ channelId: ch(1), content: "Check out my cool new thing right here" })), null);
    assert.equal(await r.am.onMessage(msg({ channelId: ch(2), content: "check out my cool new thing right here" })), null);
    assert.equal(await r.am.onMessage(msg({ channelId: ch(3), content: "Check out my cool new thing right here" })), "crosspost");
    assert.equal(await r.am.onMessage(msg({ authorId: U2, content: "hey @everyone look" })), "everyone");
    assert.equal(await r.am.onMessage(msg({ authorId: U2, content: "😀😀😀😀😀😀 wow" })), "emoji");
    assert.equal(await r.am.onMessage(msg({ authorId: U2, content: "a\nb\nc\nd\ne\nf\ng" })), "lines");
    assert.equal(await r.am.onMessage(msg({ authorId: U2, content: "run this", attachments: ["Setup.EXE"] })), "files");
    assert.equal(await r.am.onMessage(msg({ authorId: U2, content: "see https://example.com", joinedAt: 1_000_000 - 2 * 60_000 })), "newlinks");
    assert.equal(await r.am.onMessage(msg({ authorId: U2, content: "see https://example.com", joinedAt: 1_000_000 - 3 * 86400_000 })), null, "an older member's link is fine");
    assert.equal(await r.am.onMessage(msg({ authorId: U2, content: "here is a picture", attachments: ["cat.png"] })), null);
    assert.deepEqual(cleanAutomod({ rules: { files: { on: true, list: ".ZIP\nrar" } } }).rules.files.list, ["zip", "rar"]);
});

test("a scam ban is reported in the mod log with the removed text, mentions defused", async () => {
    const r = rig({});
    r.db.setCommunity("G", { mod_log_channel: "900000000000000051" });
    await r.am.onMessage(msg({ content: SCAM + " @everyone" }));
    const embeds = r.calls.filter(c => c.t === "log").flatMap(c => c.p.embeds ?? []);
    const e = embeds.find(x => /Scam guard/.test(x.title));
    assert.ok(e, "a scam guard report was posted"); assert.match(e.title, /banned/);
    assert.match(e.description, /hitting instantly/); assert.ok(!/@everyone/.test(e.description), "the text can't ping anyone");
    assert.match(JSON.stringify(e.fields), /mod unban/);
});

test("/mod automod can switch the scam and fake link guards and lists them", async () => {
    const r = rig({});
    const { createModHandlers } = await import("../src/modhandlers.js");
    const ui = createModHandlers({ db: r.db, mod: r.mod, automod: r.am });
    const replies = [];
    const mk = (opts = {}) => ({ inGuild: () => true, guildId: "G", user: { id: "900000000000000001", username: "m" }, channelId: "900000000000000099", memberPermissions: { has: () => true },
        options: { getSubcommand: () => "automod", getString: n => opts[n] ?? null, getBoolean: n => opts[n] ?? null, getUser: () => null, getInteger: () => null, getChannel: () => null },
        reply: async x => { replies.push(x); }, deferReply: async () => {}, editReply: async x => { replies.push(x); } });
    await ui.handleCommand(mk({ rule: "scam", enabled: false })); await ui.handleCommand(mk({ rule: "phish", enabled: false }));
    assert.equal(r.am.get("G").scam.on, false); assert.equal(r.am.get("G").phish.on, false); assert.equal(r.am.get("G").on, false, "the master switch isn't flipped by these");
    assert.match(replies.pop().embeds[0].description, /Scam guard:\*\* ⚫ off/);
    await ui.handleCommand(mk({ rule: "lines", enabled: true }));
    assert.equal(r.am.get("G").rules.lines.on, true); assert.equal(r.am.get("G").on, true);
});

test("an account caught scamming is removed as it joins another server", async () => {
    const r = rig({});
    await r.am.onMessage(msg({ content: SCAM, authorId: U2 }));
    r.calls.length = 0;
    assert.equal(await r.am.onJoin({ guildId: "H", userId: U2 }), "scammer");
    assert.ok(r.calls.some(c => c.t === "ban" && c.id === U2));
    r.calls.length = 0;
    assert.equal(await r.am.onJoin({ guildId: "H", userId: U1 }), null, "someone who never scammed joins normally");
    r.am.save("H", { scam: { action: "delete" } });
    assert.notEqual(await r.am.onJoin({ guildId: "H", userId: U2 }), "scammer", "delete-only servers don't ban on join");
    r.am.save("I", { scam: { on: false } });
    assert.equal(await r.am.onJoin({ guildId: "I", userId: U2 }), null, "and neither do servers with the guard off");
});

test("the dashboard's dry run says what the guards would do and changes nothing", async () => {
    const r = rig({});
    const t = r.am.test("G", SCAM);
    assert.equal(t.verdict, "scam"); assert.ok(t.hits.includes("linkables")); assert.equal(r.calls.length, 0);
    assert.equal(r.am.test("G", "good morning, the Steam sale starts today").verdict, null);
    assert.equal(r.am.test("G", "go to https://steamcomunity.com/gift/x").verdict, "phish");
    assert.equal(rig({ scam: { on: false } }).am.test("G", SCAM).verdict, null);
});

test("an edit is checked for scams but not for the ordinary rules", async () => {
    const r = rig({ on: true, rules: { lines: { on: true, max: 2 } } });
    assert.equal(await r.am.onMessage(msg({ content: "a\nb\nc\nd", edited: true })), null, "ordinary rules skip edits");
    assert.equal(await r.am.onMessage(msg({ content: SCAM, edited: true })), "scam");
    assert.ok(r.calls.some(c => c.t === "ban"));
});

test("the guard counts what it stops in each server", async () => {
    const r = rig({});
    assert.deepEqual(r.am.caught("G").n, 0);
    await r.am.onMessage(msg({ content: SCAM })); await r.am.onMessage(msg({ content: SCAM, authorId: U2 }));
    assert.equal(r.am.caught("G").n, 2); assert.equal(r.am.caught("H").n, 0);
});

test("a message from an account named like a scam service is removed, a plain name with the same text isn't", async () => {
    const r = rig({});
    assert.equal(await r.am.onMessage(msg({ content: "hey everyone, anyone around?", authorName: "BINERO LINKABLES V2" })), "scam");
    assert.ok(r.calls.some(c => c.t === "ban"));
    r.calls.length = 0;
    assert.equal(await r.am.onMessage(msg({ content: "hey everyone, anyone around?", authorName: "Jacob" })), null);
    assert.equal(r.calls.length, 0);
});

test("the guard keeps the last few catches with a short excerpt, newest first, capped at ten", async () => {
    const r = rig({});
    for (let i = 0; i < 12; i++) await r.am.onMessage(msg({ content: `@everyone #${i} ` + SCAM, authorId: `90000000000000${100 + i}` }));
    const c = r.am.caught("G"); assert.equal(c.n, 12); assert.equal(c.recent.length, 10);
    assert.match(c.recent[0].text, /#11/); assert.ok(!c.recent[0].text.includes("@everyone"), "mentions are defused"); assert.equal(c.recent[0].action, "ban");
    assert.ok(c.recent[0].text.length <= 300);
});

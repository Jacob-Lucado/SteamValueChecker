import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { parseTrigger, tidyHistory, createAiChat, aiUsedToday, aiStats } from "../src/aichat.js";
import { createRuntimeCfg } from "../src/runtimecfg.js";
import { createAiTools } from "../src/aitools.js";

const mk = (db, opts = {}) => { const rt = createRuntimeCfg(db); return { rt, ai: createAiChat({ db, rt, key: "k", ...opts }) }; };

const BOT = "999";

test("AI companion: finds the question after 'Hey AI' or a mention, and ignores everything else", () => {
    assert.deepEqual(parseTrigger("Hey AI what should I play next?", BOT), { question: "what should I play next?", via: "phrase" });
    assert.equal(parseTrigger("hey, ai: is Hades worth it", BOT).question, "is Hades worth it");
    assert.equal(parseTrigger("  OK AI   tell me a joke", BOT).question, "tell me a joke");
    assert.equal(parseTrigger("hi ai", BOT).question, "");
    assert.equal(parseTrigger(`<@${BOT}> best cheap co-op games?`, BOT).question, "best cheap co-op games?");
    assert.equal(parseTrigger(`<@!${BOT}> hey ai how are you`, BOT).question, "how are you");
    assert.equal(parseTrigger("they said hey ai in the middle", BOT), null, "only at the start");
    assert.equal(parseTrigger("hey airport", BOT), null);
    assert.equal(parseTrigger("<@123> hello", BOT), null, "someone else's mention");
    assert.equal(parseTrigger("hey ai what's up", BOT, { phrase: false }), null, "no phrase without the intent");
    assert.equal(parseTrigger(`<@${BOT}> hi`, BOT, { phrase: false }).question, "hi", "mentions always work");
    assert.equal(parseTrigger("hey ai " + "x".repeat(2000), BOT).question.length, 700);
});

test("AI companion: history starts with a person, alternates and skips empties", () => {
    const h = tidyHistory([{ role: "assistant", content: "stray" }, { role: "user", content: "a" }, { role: "user", content: "b" }, { role: "assistant", content: "  " }, { role: "assistant", content: "c" }, { role: "user", content: "d" }]);
    assert.deepEqual(h, [{ role: "user", content: "a\nb" }, { role: "assistant", content: "c" }, { role: "user", content: "d" }]);
});

function fakeFetch(reply = { status: 200, body: { content: [{ type: "text", text: "Try Hades. It's great." }] } }) {
    const calls = [];
    const fn = async (url, opts) => { calls.push({ url, opts, body: JSON.parse(opts.body) }); return { ok: reply.status < 300, status: reply.status, json: async () => reply.body }; };
    fn.calls = calls;
    return fn;
}

test("AI companion: asks the API with the key and model, and returns a clean answer", async () => {
    const db = openDb(":memory:"), fetchFn = fakeFetch({ status: 200, body: { content: [{ type: "text", text: "Hi @everyone and @here!" }] } });
    const ai = createAiChat({ db, rt: createRuntimeCfg(db), key: "k-123", fetchFn });
    const r = await ai.answer({ guildId: "G", userId: "u", name: "Jacob", question: "hello", history: [{ role: "assistant", content: "earlier" }] });
    assert.equal(r.ok, true);
    assert.ok(!/@everyone|@here/.test(r.text), "mass mentions are broken up");
    const c = fetchFn.calls[0];
    assert.equal(c.url, "https://api.anthropic.com/v1/messages");
    assert.equal(c.opts.headers["x-api-key"], "k-123");
    assert.equal(c.body.model, "claude-haiku-5-5");
    assert.ok(c.body.max_tokens <= 500);
    assert.match(c.body.system, /talking with Jacob/);
    assert.deepEqual(c.body.messages, [{ role: "user", content: "hello" }], "a leading assistant message is dropped");
});

test("AI companion: no key means off; a person waits between questions; a server has a daily limit", async () => {
    const db = openDb(":memory:");
    assert.equal((await createAiChat({ db, rt: createRuntimeCfg(db), key: null }).answer({ guildId: "G", userId: "u", question: "x" })).reason, "off");
    let t = Date.parse("2026-11-04T12:00:00Z");
    const fetchFn = fakeFetch();
    const { rt, ai } = mk(db, { fetchFn, now: () => t });
    rt.set({ ai_daily_cap: 3 });
    assert.equal((await ai.answer({ guildId: "G", userId: "a", question: "1" })).ok, true);
    assert.equal((await ai.answer({ guildId: "G", userId: "a", question: "again" })).reason, "cooldown");
    assert.equal(fetchFn.calls.length, 1, "a cooldown does not call the API or use up the day");
    assert.equal(aiUsedToday(db, "G", t), 1);
    assert.equal((await ai.answer({ guildId: "G", userId: "b", question: "2" })).ok, true);
    t += rt.get("ai_cooldown") * 1000 + 1;
    assert.equal((await ai.answer({ guildId: "G", userId: "a", question: "3" })).ok, true);
    t += rt.get("ai_cooldown") * 1000 + 1;
    assert.equal((await ai.answer({ guildId: "G", userId: "a", question: "4" })).reason, "cap");
    assert.equal((await ai.answer({ guildId: "H", userId: "a", question: "other server" })).ok, true, "limits are per server");
    t += 86_400_000;
    assert.equal(aiUsedToday(db, "G", t), 0, "a new day starts again");
    assert.equal((await ai.answer({ guildId: "G", userId: "a", question: "5" })).ok, true);
});

test("AI companion: API trouble gives a reason, not a crash", async () => {
    const db = openDb(":memory:");
    const ask = fetchFn => mk(db, { fetchFn }).ai.answer({ guildId: "G", userId: "u" + Math.random(), question: "x" });
    assert.equal((await ask(fakeFetch({ status: 429, body: {} }))).reason, "busy");
    assert.equal((await ask(fakeFetch({ status: 401, body: {} }))).reason, "error");
    assert.equal((await ask(fakeFetch({ status: 200, body: { content: [] } }))).reason, "error");
    assert.equal((await ask(async () => { throw new Error("offline"); })).reason, "error");
});

test("/manage community ai: needs a key to switch on, saves the channel, and the status shows it", async () => {
    const { createCommunityHandlers } = await import("../src/communityhandlers.js");
    const db = openDb(":memory:");
    const run = async (available, opts) => {
        const h = createCommunityHandlers({ db, api: {}, service: {}, aiAvailable: () => available, aiPhrase: () => true });
        const out = {};
        const i = { commandName: "community", inGuild: () => true, guildId: "G", memberPermissions: { has: () => true }, member: { permissions: { has: () => true } }, user: { id: "u" }, client: { user: { id: "bot" } },
            options: { getSubcommand: () => "ai", getBoolean: k => opts[k] ?? null, getChannel: k => opts[k] ?? null }, reply: async p => { out.reply = p; } };
        await h.handleCommand(i);
        return out.reply?.content ?? "";
    };
    assert.match(await run(false, { on: true }), /Coming soon.*prices, free games/s, "no key: it switches on in lite mode and says so");
    assert.equal(db.getCommunity("G").ai_on, 1);
    assert.doesNotMatch(await run(true, { on: true }), /Coming soon/);
    assert.match(await run(true, { on: true }), /on.*every channel/s);
    assert.equal(db.getCommunity("G").ai_on, 1);
    assert.match(await run(true, { channel: { id: "c9" } }), /only in <#c9>/);
    assert.equal(db.getCommunity("G").ai_channel, "c9");
    assert.match(await run(true, { anywhere: true }), /every channel/);
    assert.equal(db.getCommunity("G").ai_channel, null);
    assert.match(await run(true, { on: false }), /off/);
});

test("AI companion: owner settings apply at once (model, master switch, blocks, per-server limit, tone)", async () => {
    const db = openDb(":memory:"), fetchFn = fakeFetch(), t = Date.parse("2026-11-04T12:00:00Z");
    const { rt, ai } = mk(db, { fetchFn, now: () => t });
    rt.set({ ai_model: "claude-sonnet-5-5", ai_tone: "concise", ai_extra: "We love co-op.", ai_max_tokens: 200 });
    await ai.answer({ guildId: "G", userId: "a", question: "x" });
    const b = fetchFn.calls[0].body;
    assert.equal(b.model, "claude-sonnet-5-5"); assert.equal(b.max_tokens, 200);
    assert.match(b.system, /brief and direct/); assert.match(b.system, /We love co-op\./);
    rt.blockUser("11111"); assert.equal((await ai.answer({ guildId: "G", userId: "11111", question: "x" })).reason, "blocked");
    rt.blockServer("22222"); assert.equal((await ai.answer({ guildId: "22222", userId: "b", question: "x" })).reason, "blocked");
    rt.setServerCap("12345", 1); await ai.answer({ guildId: "12345", userId: "e", question: "x" }); assert.equal((await ai.answer({ guildId: "12345", userId: "c", question: "x" })).reason, "cap");
    rt.setServerCap("12345", null); rt.set({ ai_enabled: false });
    assert.equal((await ai.answer({ guildId: "G", userId: "d", question: "x" })).reason, "paused");
    assert.equal(aiStats(db, 1, t)[0].answers, 2);
});

test("runtime settings: defaults, validation (nothing saved on a bad value), blocks and server limits", () => {
    const db = openDb(":memory:"), rt = createRuntimeCfg(db);
    assert.equal(rt.get("ai_daily_cap"), 300); assert.equal(rt.get("trap_enabled"), true);
    assert.deepEqual(rt.set({ ai_cooldown: 30, notice_text: "  Maintenance\nat 9  " }), ["ai_cooldown", "notice_text"]);
    assert.equal(rt.get("notice_text"), "Maintenance at 9");
    assert.throws(() => rt.set({ ai_cooldown: 40, ai_daily_cap: 0 }), /whole number/);
    assert.equal(rt.get("ai_cooldown"), 30, "the valid half of a bad patch is not saved");
    assert.throws(() => rt.set({ ai_tone: "angry" }), /choices/);
    assert.throws(() => rt.set({ nope: 1 }), /no setting/);
    assert.deepEqual(rt.set({ ai_cooldown: 30 }), [], "an unchanged value reports nothing");
    assert.throws(() => rt.blockUser("abc"), /Discord ID/);
    rt.blockUser("12345678"); assert.equal(rt.isUserBlocked("12345678"), true); rt.blockUser("12345678", false); assert.equal(rt.isUserBlocked("12345678"), false);
    assert.throws(() => rt.setServerCap("12345678", 99999), /0 to 50000/);
    rt.setServerCap("12345678", 0); assert.equal(rt.serverCap("12345678"), 0);
    assert.equal(createRuntimeCfg(db, { ai_daily_cap: 77 }).get("ai_daily_cap"), 77, "env defaults apply until changed");
    assert.ok(rt.view().settings.every(x => x.label && x.help));
});

test("AI companion: uses tools for real data, loops until it has an answer, and reports tool use", async () => {
    const db = openDb(":memory:"), seen = [];
    const tools = { defs: [{ name: "free_games" }], run: async (name, input, ctx) => { seen.push([name, ctx]); return { count: 1, games: [{ title: "Hades" }] }; } };
    const replies = [
        { stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text: "Checking" }, { type: "tool_use", id: "t1", name: "free_games", input: {} }] },
        { stop_reason: "end_turn", usage: { input_tokens: 20, output_tokens: 8 }, content: [{ type: "text", text: "Hades is free!" }] }
    ];
    const bodies = [];
    const fetchFn = async (u, o) => { bodies.push(JSON.parse(o.body)); return { ok: true, status: 200, json: async () => replies.shift() }; };
    const { ai } = mk(db, { fetchFn, tools });
    const r = await ai.answer({ guildId: "G", userId: "u", question: "anything free?" });
    assert.deepEqual([r.ok, r.text], [true, "Hades is free!"]);
    assert.deepEqual(seen, [["free_games", { userId: "u", guildId: "G" }]]);
    assert.ok(bodies[0].tools && bodies[1].messages.at(-1).content[0].type === "tool_result");
    const st = aiStats(db, 1)[0];
    assert.deepEqual([st.answers, st.toolAnswers, st.toolCalls, st.inTok, st.outTok], [1, 1, 1, 30, 13]);
});

test("AI tools: prices, free games, wishlist, library and leaderboard come from the bot's own data; a failure is returned, not thrown", async () => {
    const db = openDb(":memory:");
    db.ensureUser("u1");
    const itad = {
        lookupTitles: async ts => ts.map(t => (t === "Nope" ? { title: t, id: null } : { title: t, id: "id-" + t, matched: t })),
        getPrices: async ids => new Map(ids.map(id => [id, { deals: [{ shop: { name: "Steam" }, price: { amount: 5, currency: "USD" }, regular: { amount: 20 }, cut: 75 }], historyLow: { all: { amount: 4, currency: "USD" } } }])),
        getGiveawayList: async () => [{ title: "Hades", shop: "Epic", expiry: Date.parse("2030-01-02"), type: "game" }, { title: "Pack", shop: "Epic", expiry: null, type: "dlc" }]
    };
    const t = createAiTools({ db, itad });
    const p = await t.run("check_prices", { titles: ["Celeste", "Nope"] }, { userId: "u1" });
    assert.equal(p.games[0].fullPrice, "$20.00"); assert.equal(p.games[0].cheapestNow, "$5.00 at Steam"); assert.equal(p.games[1].found, false);
    assert.deepEqual((await t.run("free_games", {}, {})).games.map(g => g.title), ["Hades"], "DLC left out");
    assert.equal((await t.run("my_wishlist", {}, { userId: "u1" })).empty, true);
    assert.equal((await t.run("my_library", {}, { userId: "u1" })).empty, true);
    assert.equal((await t.run("server_leaderboard", {}, { guildId: null })).error, "Only works inside a server.");
    const add = await t.run("add_to_wishlist", { title: "Celeste" }, { userId: "u1" });
    assert.equal(add.added, "Celeste");
    assert.match((await t.run("add_to_wishlist", { title: "Celeste" }, { userId: "u1" })).error, /already on your list/);
    assert.equal(db.listItems("u1").length, 1);
    assert.equal((await t.run("my_wishlist", {}, { userId: "u1" })).total, 1);
    assert.equal((await t.run("nonsense", {}, {})).error, "Unknown tool.");
    const bad = createAiTools({ db, itad: { ...itad, getGiveawayList: async () => { throw new Error("ITAD down"); } } });
    assert.equal((await bad.run("free_games", {}, {})).error, "ITAD down");
});

test("AI companion: a server's own key is used for its answers, skips the general daily limit, and a rejected key is reported", async () => {
    const db = openDb(":memory:"), keys = [], own = { 11111: "sk-ant-own-key" };
    const fetchFn = async (u, o) => { keys.push(o.headers["x-api-key"]); return o.headers["x-api-key"] === "sk-ant-own-key" && own.bad ? { ok: false, status: 401, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "ok" }] }) }; };
    let t = Date.parse("2026-11-04T12:00:00Z");
    const rt = createRuntimeCfg(db); rt.set({ ai_daily_cap: 1, ai_cooldown: 3 });
    const ai = createAiChat({ db, rt, key: "bot-key", keyFor: g => own[g] ?? null, fetchFn, now: () => t });
    assert.equal((await ai.answer({ guildId: "11111", userId: "a", question: "1" })).ok, true);
    t += 4000; assert.equal((await ai.answer({ guildId: "11111", userId: "a", question: "2" })).ok, true, "no general limit with an own key");
    assert.equal((await ai.answer({ guildId: "22222", userId: "b", question: "3" })).ok, true);
    t += 4000; assert.equal((await ai.answer({ guildId: "22222", userId: "b", question: "4" })).reason, "cap", "other servers still have the limit");
    assert.deepEqual(keys, ["sk-ant-own-key", "sk-ant-own-key", "bot-key"]);
    rt.setServerCap("11111", 2); t += 4000; assert.equal((await ai.answer({ guildId: "11111", userId: "a", question: "5" })).reason, "cap", "an owner-set limit still applies");
    rt.setServerCap("11111", null); own.bad = true; t += 4000;
    assert.equal((await ai.answer({ guildId: "11111", userId: "a", question: "6" })).reason, "badkey");
    assert.ok(db.getMeta("aikeybad:11111"));
    // no bot key at all: only servers with their own key can use it
    const solo = createAiChat({ db, rt, key: null, keyFor: g => own[g] ?? null, fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "ok" }] }) }), now: () => t + 99999 });
    own.bad = false;
    assert.equal((await solo.answer({ guildId: "22222", userId: "z", question: "x" })).reason, "off");
    assert.equal((await solo.answer({ guildId: "11111", userId: "z", question: "x" })).ok, true);
});

test("AI companion: checking a pasted key", async () => {
    const db = openDb(":memory:"), rt = createRuntimeCfg(db);
    const ask = status => createAiChat({ db, rt, key: null, fetchFn: async () => ({ ok: status < 300, status, json: async () => ({}) }) }).checkKey("sk-ant-x");
    assert.equal((await ask(200)).ok, true);
    assert.match((await ask(401)).error, /did not accept/);
    assert.match((await ask(400)).error, /credit/);
    assert.equal((await ask(529)).ok, true);
    assert.match((await createAiChat({ db, rt, key: null, fetchFn: async () => { throw new Error("x"); } }).checkKey("k")).error, /Could not reach/);
});

test("AI companion: the main server is never limited; AI Plus servers get the bigger limit; the limits view says so", async () => {
    const db = openDb(":memory:"), rt = createRuntimeCfg(db);
    rt.set({ ai_daily_cap: 1, ai_plus_cap: 3, ai_cooldown: 3 });
    let t = Date.parse("2026-11-04T12:00:00Z");
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "ok" }] }) });
    const ai = createAiChat({ db, rt, key: "k", fetchFn, now: () => t, isMain: g => g === "10001", isPlus: g => g === "30003" });
    const run = async g => { const out = []; for (let n = 0; n < 5; n++) { t += 4000; out.push((await ai.answer({ guildId: g, userId: "u", question: "x" })).ok); } return out.filter(Boolean).length; };
    assert.equal(await run("10001"), 5, "main server: no limit");
    assert.equal(await run("20002"), 1, "ordinary server: the daily limit");
    assert.equal(await run("30003"), 3, "AI Plus server: the Plus limit");
    const { aiLimits } = await import("../src/aichat.js");
    assert.deepEqual([aiLimits(rt, "10001", { main: true }).unlimited, aiLimits(rt, "20002").dailyCap, aiLimits(rt, "30003", { plus: true }).dailyCap], [true, 1, 3]);
    rt.setServerCap("30003", 2); assert.equal(aiLimits(rt, "30003", { plus: true }).dailyCap, 2, "a limit set for one server beats Plus");
});

test("main server: remembered once, detected only when the bot is in exactly one server, invite is validated and cached", async () => {
    const { createMainGuild } = await import("../src/mainguild.js");
    const db = openDb(":memory:"), guilds = new Map([["111111", {}]]);
    const client = { guilds: { cache: guilds } };
    const m = createMainGuild({ db, client });
    assert.equal(m.id(), null);
    assert.equal(m.detect(), "111111"); assert.equal(m.isMain("111111"), true);
    guilds.set("222222", {}); assert.equal(createMainGuild({ db, client }).id(), "111111", "joining more servers later changes nothing");
    const two = openDb(":memory:"); assert.equal(createMainGuild({ db: two, client }).detect(), null, "two servers and nothing chosen: no guess");
    assert.equal(createMainGuild({ db: two, client, configuredId: "222222" }).isMain("222222"), true);
    assert.equal(createMainGuild({ db, client, configuredInvite: "https://discord.gg/abc123" }).inviteUrl(), "https://discord.gg/abc123");
    assert.equal(createMainGuild({ db, client, configuredInvite: "https://evil.example/x" }).inviteUrl(), null, "only Discord invite links");
    db.setMeta("support:invite", "https://discord.gg/xyz"); assert.equal(m.inviteUrl(), "https://discord.gg/xyz");
});

test("lite mode: reads the common questions, and answers them from the bot's own data", async () => {
    const { intentOf, titleFrom, liteAnswer, LITE_HELP } = await import("../src/ailite.js");
    assert.equal(titleFrom("is Hades on sale?"), "Hades");
    assert.equal(titleFrom("how much is Celeste right now"), "Celeste");
    assert.equal(titleFrom("what's the price of Hollow Knight"), "Hollow Knight");
    assert.equal(titleFrom('is "Inside" cheap'), "Inside");
    assert.equal(titleFrom("tell me a joke"), null);
    for (const [q, k] of [["", "help"], ["hi", "help"], ["what's free right now?", "free"], ["any free games today", "free"], ["what's on my wishlist", "wishlist"], ["what should I play next", "library"], ["leaderboard please", "board"], ["is Hades on sale", "price"], ["write me a poem about owls", "unknown"]]) assert.equal(intentOf(q).kind, k, q);

    const db = openDb(":memory:"); db.ensureUser("u1");
    const itad = {
        lookupTitles: async ts => ts.map(t => (t === "Nope" ? { title: t, id: null } : { title: t, id: "id-" + t, matched: t })),
        getPrices: async ids => new Map(ids.map(id => [id, { deals: [{ shop: { name: "Steam" }, price: { amount: 5, currency: "USD" }, regular: { amount: 20 }, cut: 75 }], historyLow: { all: { amount: 4, currency: "USD" } } }])),
        getGiveawayList: async () => [{ title: "Hades", shop: "Epic", expiry: Date.parse("2030-01-02"), type: "game" }]
    };
    const tools = createAiTools({ db, itad });
    const ask = question => liteAnswer({ question, userId: "u1", guildId: null, tools });
    assert.match(await ask("is Celeste on sale?"), /Celeste[\s\S]*Full price: \$20\.00[\s\S]*Steam now: \$5\.00 \(-75%\)[\s\S]*All-time low: \$4\.00/);
    assert.match(await ask("is Nope on sale?"), /couldn't find a game called \*\*Nope\*\*/);
    assert.match(await ask("what's free?"), /Hades.*Epic/);
    assert.match(await ask("my wishlist?"), /wishlist is empty/);
    assert.equal(await ask("tell me a joke"), LITE_HELP);
    assert.match(LITE_HELP, /coming soon/);
});

test("lite mode: with no key the bot still answers (cooldown, switch and blocks apply), without calling any API", async () => {
    const db = openDb(":memory:"), rt = createRuntimeCfg(db);
    let t = Date.parse("2026-11-04T12:00:00Z"), calls = 0;
    const ai = createAiChat({ db, rt, key: null, lite: async ({ question }) => `lite: ${question}`, fetchFn: async () => { calls++; throw new Error("no network in lite mode"); }, now: () => t });
    const r = await ai.answer({ guildId: "11111", userId: "a", question: "free?" });
    assert.deepEqual([r.ok, r.lite, r.text], [true, true, "lite: free?"]);
    assert.equal((await ai.answer({ guildId: "11111", userId: "a", question: "again" })).reason, "cooldown");
    rt.blockUser("22222"); assert.equal((await ai.answer({ guildId: "11111", userId: "22222", question: "x" })).reason, "blocked");
    rt.set({ ai_enabled: false }); t += 60000; assert.equal((await ai.answer({ guildId: "11111", userId: "b", question: "x" })).reason, "paused");
    assert.equal(calls, 0); assert.equal(aiStats(db, 1, t)[0].liteAnswers, 1);
    assert.equal((await ai.test("what's free?")).model, "no AI key: the bot's own answers");
    assert.equal((await createAiChat({ db, rt, key: null }).answer({ guildId: "1", userId: "z", question: "x" })).reason, "off", "no key and no lite: off");
});

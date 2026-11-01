import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { cleanEntry, cleanReward, gameByName, gameArt, normalizeCode, parseExpiry, parseShiftFeed, fetchShiftCodes } from "../src/codesource.js";
import { codeEmbed, runCodes, applyCodeSettings } from "../src/codes.js";
import { createCodeHandlers } from "../src/codeshandlers.js";

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const raw = (over = {}) => ({ code: "J9R33-CCTTC-WRBJ5-TJJB3-9BT5T", type: "shift", game: "Borderlands 4", platform: "universal", reward: "3 Golden Keys", archived: "2026-11-01 10:43:50+00:00", expires: "Nov 3, 2026", expired: false, link: "https://example.com/bl4", ...over });

test("codes: a code is cleaned and checked before it is trusted", () => {
    assert.equal(normalizeCode("j9r33-ccttc-wrbj5-tjjb3-9bt5t"), "J9R33-CCTTC-WRBJ5-TJJB3-9BT5T");
    assert.equal(normalizeCode("j9r33 ccttc wrbj5 tjjb3 9bt5t"), "J9R33-CCTTC-WRBJ5-TJJB3-9BT5T");
    assert.equal(normalizeCode("TOO-SHORT"), null);
    assert.equal(normalizeCode(null), null);
    const c = cleanEntry(raw(), NOW);
    assert.equal(c.key, "shift:J9R33-CCTTC-WRBJ5-TJJB3-9BT5T");
    assert.equal(c.game, "bl4");
    assert.equal(c.platform, "All platforms");
    assert.equal(c.expiresAt, Date.UTC(2026, 10, 3, 23, 59, 59));
    assert.equal(cleanEntry(raw({ code: "nope" }), NOW), null, "a bad code is dropped");
    assert.equal(cleanEntry(raw({ game: "Some Other Game" }), NOW), null, "an unknown game is dropped");
    assert.equal(cleanEntry(raw({ expires: "Oct 1, 2026" }), NOW), null, "a code that already ended is dropped");
    assert.equal(cleanEntry(raw({ type: "other" }), NOW), null);
});

test("codes: end dates in the odd shapes the feed uses", () => {
    assert.equal(parseExpiry("Sept 29, 2026", NOW), Date.UTC(2026, 8, 29, 23, 59, 59));
    assert.equal(parseExpiry("Unknown", NOW), null);
    assert.equal(parseExpiry("ZRX33-K9Z33", NOW), null, "garbage in the date field means no date");
    assert.equal(parseExpiry("Dec 31, 2030", NOW), null, "a far-off placeholder means no end date");
    assert.equal(cleanEntry(raw({ expires: "Unknown" }), NOW).expiresAt, null);
});

test("codes: an old code with no end date is ignored, and one that ages out is retired", () => {
    assert.equal(cleanEntry(raw({ expires: "Unknown", archived: "2026-08-01 10:00:00+00:00" }), NOW), null, "months old with no end date");
    assert.ok(cleanEntry(raw({ expires: "Unknown", archived: "2026-10-25 10:00:00+00:00" }), NOW), "a week old is still trusted");
    const db = openDb(":memory:");
    const c = cleanEntry(raw({ expires: "Unknown", archived: "2026-10-25 10:00:00+00:00" }), NOW);
    db.upsertCode(c);
    assert.equal(db.expireDue(NOW).length, 0);
    assert.equal(db.expireDue(NOW + 30 * 86400_000).length, 1);
});

test("codes: glued reward text is split and a region note is kept apart", () => {
    assert.deepEqual(cleanReward("1 Golden Key2K Japan"), { reward: "1 Golden Key", note: "2K Japan" });
    assert.equal(cleanReward("Loveless CosmeticMint Chipset").reward, "Loveless Cosmetic, Mint Chipset");
    assert.equal(cleanReward("").reward, "Unknown reward");
});

test("codes: each game gets its own art, never another game's", () => {
    assert.equal(gameByName("Borderlands 4").key, "bl4");
    assert.equal(gameByName("Borderlands 3").key, "bl3");
    assert.equal(gameByName("Borderlands: Game of the Year Edition").key, "blgoty");
    assert.equal(gameByName("Borderlands The Pre-Sequel").key, "bltps");
    assert.equal(gameByName("Tiny Tina's Wonderlands").key, "wonderlands");
    assert.match(gameArt(gameByName("Borderlands 2")), /\/apps\/49520\//);
    assert.match(gameArt(gameByName("Borderlands 4")), /\/apps\/1285190\//);
    const embed = codeEmbed({ code: "J9R33-CCTTC-WRBJ5-TJJB3-9BT5T", game: "bl3", reward: "3 Golden Keys", platform: "Steam", expires_at: NOW + 86400_000 });
    assert.match(embed.embeds[0].image.url, /\/apps\/397540\//);
    assert.match(embed.embeds[0].author.name, /Borderlands 3/);
});

test("codes: the same code in the feed twice, or in a later poll, is one row", () => {
    const list = parseShiftFeed([{ codes: [raw(), raw({ code: "j9r33-ccttc-wrbj5-tjjb3-9bt5t" })] }], NOW);
    assert.equal(list.length, 1);
    const db = openDb(":memory:");
    assert.equal(db.upsertCode(list[0]).isNew, true);
    assert.equal(db.upsertCode(list[0]).isNew, false);
    assert.equal(db.listCodes().length, 1);
});

test("codes: fetching reports a bad feed instead of throwing something strange", async () => {
    await assert.rejects(fetchShiftCodes({ fetchImpl: async () => ({ ok: false, status: 500 }) }), /500/);
    await assert.rejects(fetchShiftCodes({ fetchImpl: async () => ({ ok: true, json: async () => { throw new Error("x"); } }) }), /not valid JSON/);
    await assert.rejects(fetchShiftCodes({ fetchImpl: async () => ({ ok: true, json: async () => [{ codes: [] }] }) }), /no usable codes/);
    const ok = await fetchShiftCodes({ now: NOW, fetchImpl: async () => ({ ok: true, json: async () => [{ codes: [raw()] }] }) });
    assert.equal(ok.length, 1);
});

function fakeApi() {
    const sent = [], edits = [];
    let n = 0;
    return { sent, edits, api: {
        sendMessage: async (channel, payload) => { sent.push({ channel, payload }); return { id: "m" + (++n) }; },
        editMessage: async (channel, id, payload) => { edits.push({ channel, id, payload }); return {}; }
    } };
}
const codeAt = (n, over = {}) => cleanEntry(raw({ code: `AAAA${n}-BBBBB-CCCCC-DDDDD-EEEEE`, ...over }), NOW);

test("codes: a code is posted once per server, however many polls run", async () => {
    const db = openDb(":memory:");
    db.setCodeSettings("g1", { channel_id: "c1" });
    const { api, sent } = fakeApi();
    const feed = async () => [codeAt(1), codeAt(2)];
    const base = { db, api, fetchCodes: feed, now: () => NOW, sleep: async () => {} };
    const r1 = await runCodes(base);
    assert.equal(r1.posted, 2);
    const r2 = await runCodes(base);
    const r3 = await runCodes(base);
    assert.equal(r2.posted + r3.posted, 0, "nothing is posted twice");
    assert.equal(sent.length, 2);
    // a new code later is the only new post
    const r4 = await runCodes({ ...base, fetchCodes: async () => [codeAt(1), codeAt(2), codeAt(3)] });
    assert.equal(r4.posted, 1);
    assert.equal(sent.length, 3);
    assert.match(sent[2].payload.embeds[0].description, /AAAA3-BBBBB/);
});

test("codes: a new server only gets the newest few, and a failed feed does not break the poll", async () => {
    const db = openDb(":memory:");
    db.setCodeSettings("g1", { channel_id: "c1" });
    const { api, sent } = fakeApi();
    const many = [1, 2, 3, 4, 5, 6].map(n => codeAt(n));
    await runCodes({ db, api, fetchCodes: async () => many, now: () => NOW, sleep: async () => {} });
    assert.equal(sent.length, 3, "the first run does not flood the channel");
    const r = await runCodes({ db, api, fetchCodes: async () => { throw new Error("down"); }, now: () => NOW, sleep: async () => {} });
    assert.equal(r.feedError, "down");
    assert.equal(sent.length, 3, "the other three were marked as seen, not posted later");
});

test("codes: the game filter, the ping role and servers without a channel", async () => {
    const db = openDb(":memory:");
    db.setCodeSettings("g1", { channel_id: "c1", games: ["bl3"], role_id: "r1" });
    db.setCodeSettings("g2", { channel_id: null });
    const { api, sent } = fakeApi();
    const feed = async () => [codeAt(1, { game: "Borderlands 3" }), codeAt(2, { game: "Borderlands 4" })];
    await runCodes({ db, api, fetchCodes: feed, now: () => NOW, sleep: async () => {} });
    assert.equal(sent.length, 1);
    assert.match(sent[0].payload.embeds[0].author.name, /Borderlands 3/);
    assert.equal(sent[0].payload.content, "<@&r1>");
    assert.deepEqual(sent[0].payload.allowed_mentions, { roles: ["r1"] });
});

test("codes: when a code ends its post is edited once, greyed out, with no buttons", async () => {
    const db = openDb(":memory:");
    db.setCodeSettings("g1", { channel_id: "c1" });
    const { api, edits } = fakeApi();
    let at = NOW;
    const feed = async () => [codeAt(1, { expires: "Nov 2, 2026" })];
    await runCodes({ db, api, fetchCodes: feed, now: () => at, sleep: async () => {} });
    at = Date.UTC(2026, 10, 4);
    const r = await runCodes({ db, api, fetchCodes: async () => [], now: () => at, sleep: async () => {} });
    assert.equal(r.expired, 1);
    assert.equal(edits.length, 1);
    assert.equal(edits[0].payload.components.length, 0);
    assert.match(edits[0].payload.embeds[0].title, /^Expired/);
    await runCodes({ db, api, fetchCodes: async () => [], now: () => at, sleep: async () => {} });
    assert.equal(edits.length, 1, "edited only once");
});

test("codes: a channel that vanished is skipped without stopping the other servers", async () => {
    const db = openDb(":memory:");
    db.setCodeSettings("g1", { channel_id: "gone" });
    db.setCodeSettings("g2", { channel_id: "ok" });
    const sent = [];
    const api = { sendMessage: async (c, p) => { if (c === "gone") { const e = new Error("nope"); e.status = 404; throw e; } sent.push(c); return { id: "m" }; }, editMessage: async () => ({}) };
    const r = await runCodes({ db, api, fetchCodes: async () => [codeAt(1)], now: () => NOW, sleep: async () => {} });
    assert.equal(r.failed, 1);
    assert.deepEqual(sent, ["ok"]);
    assert.ok(!db.codePost(1, "g1"), "it will be tried again next poll");
});

test("codes: settings are validated", () => {
    const db = openDb(":memory:");
    assert.throws(() => applyCodeSettings(db, "g1", { games: ["nope"] }), /not a game/);
    assert.deepEqual(applyCodeSettings(db, "g1", { games: ["bl4", "bl3", "wonderlands", "blgoty", "bltps", "bl2"] }).games, [], "every game selected means no filter");
    assert.deepEqual(applyCodeSettings(db, "g1", { games: ["bl2"], channel_id: "c9" }).games, ["bl2"]);
    assert.equal(db.getCodeSettings("g1").channel_id, "c9");
});

function interaction({ sub, options = {}, manager = true, guild = "g1" }) {
    const replies = [];
    return { replies, inGuild: () => Boolean(guild), guildId: guild, memberPermissions: { has: () => manager }, deferred: false, replied: false,
        options: { getSubcommand: () => sub, getString: k => options[k] ?? null, getBoolean: k => options[k] ?? null, getChannel: k => options[k] ?? null, getRole: k => options[k] ?? null },
        reply: async p => { replies.push(p); } };
}

test("codes: /codes latest lists working codes for anyone, settings need Manage Server", async () => {
    const db = openDb(":memory:");
    db.upsertCode(codeAt(1)); db.upsertCode(codeAt(2, { game: "Borderlands 3" }));
    const ui = createCodeHandlers({ db });
    const a = interaction({ sub: "latest", manager: false });
    await ui.handleCommand(a);
    assert.match(a.replies[0].embeds[0].description, /AAAA1-BBBBB/);
    assert.match(a.replies[0].embeds[0].description, /AAAA2-BBBBB/);
    const only = interaction({ sub: "latest", options: { game: "bl3" }, manager: false });
    await ui.handleCommand(only);
    assert.doesNotMatch(only.replies[0].embeds[0].description, /AAAA1-BBBBB/);
    const denied = interaction({ sub: "channel", manager: false, options: { channel: { id: "c1", send: async () => {} } } });
    await ui.handleCommand(denied);
    assert.match(denied.replies[0].content, /Manage Server/);
    assert.equal(db.getCodeSettings("g1").channel_id, null);
    const set = interaction({ sub: "channel", options: { channel: { id: "c1", send: async () => {} } } });
    await ui.handleCommand(set);
    assert.equal(db.getCodeSettings("g1").channel_id, "c1");
    const cantPost = interaction({ sub: "channel", options: { channel: { id: "c2", send: async () => { throw new Error("403"); } } } });
    await ui.handleCommand(cantPost);
    assert.match(cantPost.replies[0].content, /can't post/);
    assert.equal(db.getCodeSettings("g1").channel_id, "c1");
    await ui.handleCommand(interaction({ sub: "games", options: { game: "bl4", on: false } }));
    assert.ok(!db.getCodeSettings("g1").games.includes("bl4") && db.getCodeSettings("g1").games.length === 5);
    await ui.handleCommand(interaction({ sub: "ping", options: { role: { id: "r5" } } }));
    assert.equal(db.getCodeSettings("g1").role_id, "r5");
});

test("codes: community setup adds a game-codes channel and points the server at it", async () => {
    const { TEMPLATE, ADDED_LATER } = await import("../src/community.js");
    const chans = TEMPLATE.categories.flatMap(c => c.channels ?? []);
    assert.ok(chans.some(c => c.key === "codes" && c.name === "game-codes"));
    assert.ok(ADDED_LATER.has("codes"), "servers that already ran setup get it on the next run");
});

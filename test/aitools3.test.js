import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createAiTools } from "../src/aitools.js";
import { matchServerGuide, serverGuidePayload } from "../src/guides.js";

const DAY = 86400_000, NOW = Date.now();
const deal = (price, regular, shop = "Steam") => ({ shop: { name: shop }, price: { amount: price }, regular: { amount: regular }, url: "https://shop.test/x", cut: Math.round((1 - price / regular) * 100) });
const itad = {
    lookupTitles: async ts => ts.map(t => /^zzz/i.test(t) ? { title: t, id: null } : { title: t, id: "id-" + t.toLowerCase().replace(/\W+/g, ""), approx: false, matched: t }),
    getPrices: async ids => new Map(ids.map(id => [id, { deals: [deal(id.includes("cheap") ? 5 : 15, 30)], historyLow: { all: { amount: 5 } } }])),
    steamAppIds: async ids => new Map(ids.map((id, n) => [id, 1000 + n])),
    getHistory: async () => Array.from({ length: 360 }, (_, i) => ({ t: NOW - (360 - i) * DAY, price: 15 + (i % 5 === 0 ? -10 : 0), regular: 30, shop: "Steam" }))
};
const steam = async url => ({ ok: true, json: async () => url.includes("appreviews") ? { query_summary: { total_positive: 900, total_negative: 100, review_score_desc: "Very Positive" } } : { [new URL(url).searchParams.get("appids")]: { data: { name: "G", genres: [{ description: "Action" }], release_date: { date: "1 Jan, 2022" } } } } });
const mk = (extra = {}) => { const db = openDb(":memory:"); db.ensureUser("u1", "G"); db.ensureUser("u2", "G"); return { db, t: createAiTools({ db, itad, fetchImpl: steam, ...extra }) }; };
const ctx = (o = {}) => ({ userId: "u1", guildId: "G", channelId: "C", cards: [], mentions: [], canManage: false, ...o });

test("AI extras: buy verdict gives a call, reasons and a price-history graph", async () => {
    const { t } = mk();
    const c = ctx();
    const r = await t.run("buy_verdict", { title: "Hades" }, c);
    assert.equal(r.game, "Hades");
    assert.ok(r.verdict.call && r.verdict.reasons.length, JSON.stringify(r.verdict));
    assert.ok(c.cards[0].file.data.length > 2000 && c.cards[0].file.name === "price-history.png");
    assert.equal(c.cards[0].wish, "Hades");
    assert.match(r.shownAsPicture, /Do not list/);
    assert.equal((await t.run("buy_verdict", { title: "zzz nothing" }, ctx())).found, false);
});

test("AI extras: comparing two games names the cheaper and better reviewed, with a picture", async () => {
    const { t } = mk();
    const c = ctx();
    const r = await t.run("compare_games", { first: "Cheap Game", second: "Pricey Game" }, c);
    assert.equal(r.cheaperNow, "Cheap Game");
    assert.equal(r.first.steamReviews, "Very Positive, 90%");
    assert.ok(c.cards[0].file.data.length > 2000);
    assert.equal((await t.run("compare_games", { first: "A", second: "zzz" }, ctx())).found, false);
});

test("AI extras: the backlog plan favors started games, respects the hours, and filters by tag", async () => {
    const { db, t } = mk();
    db.upsertLibrary("u1", [{ itad_id: "a", title: "Started", paid: 1 }, { itad_id: "b", title: "Untouched", paid: 1 }, { itad_id: "c", title: "Done", paid: 1 }]);
    db.syncSteamGames("u1", [{ itad_id: "a", title: "Started", appid: 1, minutes: 300 }, { itad_id: "b", title: "Untouched", appid: 2, minutes: 0 }, { itad_id: "c", title: "Done", appid: 3, minutes: 900 }]);
    db.setLibraryStatus("u1", "c", "finished");
    db.saveAppTags(2, ["Roguelike"], ["Single-player"]);
    const c = ctx();
    const r = await t.run("plan_backlog", { hours: 2 }, c);
    assert.equal(r.plan.length, 1);
    assert.equal(r.plan[0].title, "Started");
    assert.match(r.caveat, /game lengths/);
    assert.ok(c.cards[0].file.data.length > 2000);
    const g = await t.run("plan_backlog", { hours: 10, genre: "roguelike" }, ctx());
    assert.deepEqual(g.plan.map(x => x.title), ["Untouched"]);
    assert.equal((await t.run("plan_backlog", { genre: "zzzz" }, ctx())).genreNotFound, "zzzz");
});

test("AI extras: play together needs a mentioned friend who opted in", async () => {
    const { db, t } = mk();
    assert.match((await t.run("play_together", {}, ctx())).error, /Mention/);
    const withFriend = ctx({ mentions: [{ id: "u2", name: "Sam" }] });
    assert.match((await t.run("play_together", {}, withFriend)).note, /hasn't opted in/);
    db.updateUser("u2", { share: 1, guild_id: "G" });
    db.upsertLibrary("u1", [{ itad_id: "a", title: "Co-op Game", paid: 1 }]); db.upsertLibrary("u2", [{ itad_id: "a", title: "Co-op Game", paid: 1 }]);
    db.syncSteamGames("u1", [{ itad_id: "a", title: "Co-op Game", appid: 7, minutes: 10 }]); db.syncSteamGames("u2", [{ itad_id: "a", title: "Co-op Game", appid: 7, minutes: 20 }]);
    db.saveAppTags(7, ["Action"], ["Co-op"]);
    const c = ctx({ mentions: [{ id: "u2", name: "Sam" }] });
    const r = await t.run("play_together", {}, c);
    assert.equal(r.picks[0].title, "Co-op Game");
    assert.equal(r.picks[0].kind, "co-op");
    assert.ok(c.cards[0].file);
    assert.match((await t.run("play_together", {}, ctx({ mentions: [{ id: "u1", name: "me" }] }))).error, /That's you/);
});

test("AI extras: group posts and events go through the real services, and events are for managers", async () => {
    const calls = [];
    const lfg = { create: async a => { calls.push(["lfg", a]); return { post: { game: a.game, slots: a.slots, starts_at: a.startsAt }, eventError: null }; } };
    const calendar = { create: async a => { calls.push(["cal", a]); return { id: 1, announced: true }; } };
    const { t } = mk({ lfg, calendar });
    const r = await t.run("post_lfg", { game: "Helldivers", when: "in 2 hours", slots: 4 }, ctx());
    assert.equal(r.posted, "Helldivers");
    assert.equal(calls[0][1].channelId, "C"); assert.equal(calls[0][1].creatorId, "u1");
    assert.ok(calls[0][1].startsAt > Date.now());
    assert.match((await t.run("add_server_event", { title: "Movie night", when: "friday 9pm" }, ctx())).error, /managers/);
    assert.equal(calls.length, 1, "nothing created for a non-manager");
    const e = await t.run("add_server_event", { title: "Movie night", when: "tomorrow 19:30" }, ctx({ canManage: true }));
    assert.equal(e.added, "Movie night");
    assert.equal(calls[1][1].guildId, "G");
    assert.match((await t.run("add_server_event", { title: "x", when: "gibberish words" }, ctx({ canManage: true }))).error, /read that time/);
    assert.ok((await t.run("post_lfg", { game: "x", when: "in 2 hours" }, { userId: "u1", cards: [] })).error, "needs a channel");
});

test("AI extras: the setup checklist is for managers and lists what is missing", async () => {
    const { db, t } = mk();
    assert.match((await t.run("server_setup", {}, ctx())).error, /managers/);
    db.setCommunity("G", { verified_role_id: "r1", xp_on: 1 });
    const r = await t.run("server_setup", {}, ctx({ canManage: true }));
    assert.ok(r.done.includes("Steam Verified role"));
    assert.ok(r.missing.some(m => m.feature === "Welcome message" && /welcome/.test(m.fixWith)));
});

test("AI extras: notes are kept short, capped, forgotten on request and wiped with the member's data", async () => {
    const { db, t } = mk();
    const c = ctx();
    assert.ok((await t.run("remember", { note: "Likes co-op roguelikes" }, c)).remembered);
    await t.run("remember", { note: "likes CO-OP roguelikes" }, c);
    assert.equal(db.getAiNotes("u1").length, 1, "no duplicates");
    for (let n = 0; n < 12; n++) await t.run("remember", { note: "Note number " + n + " " + "x".repeat(300) }, c);
    const notes = db.getAiNotes("u1");
    assert.equal(notes.length, 8);
    assert.ok(notes.every(x => x.note.length <= 140));
    assert.equal(db.getAiNotes("u2").length, 0, "per member");
    assert.deepEqual((await t.run("my_notes", {}, c)).notes.length, 8);
    assert.equal((await t.run("forget", { about: "number 11" }, c)).forgotten, 1);
    assert.ok(db.exportUser("u1").ai_notes.length === 7);
    db.deleteUser("u1");
    assert.equal(db.getAiNotes("u1").length, 0);
});

test("AI extras: the system prompt carries the member's notes and the new tools are offered", async () => {
    const { createAiChat } = await import("../src/aichat.js");
    const { createRuntimeCfg } = await import("../src/runtimecfg.js");
    const db = openDb(":memory:"); db.ensureUser("u1", "G"); db.addAiNote("u1", "Likes co-op roguelikes");
    const seen = [];
    const fetchFn = async (url, o) => { seen.push(JSON.parse(o.body)); return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "ok" }], usage: {} }) }; };
    const tools = createAiTools({ db, itad });
    const ai = createAiChat({ db, rt: createRuntimeCfg(db), key: "k", tools, fetchFn });
    await ai.answer({ guildId: "G", userId: "u1", question: "hi", scope: { channelId: "C" } });
    assert.match(seen[0].system, /Likes co-op roguelikes/);
    assert.ok(seen[0].tools.some(x => x.name === "buy_verdict") && seen[0].tools.some(x => x.name === "server_guide"));
});

test("server guides: stored per server, matched on phrases, and used by the AI tool", async () => {
    const { db, t } = mk();
    assert.match(db.addServerGuide("G", { title: "Raider role", keywords: "", body: "Ask in #raids." }).error, /phrase/);
    assert.match(db.addServerGuide("G", { title: "Raider role", keywords: "get raider role", body: "short" }).error, /answer/);
    const ok = db.addServerGuide("G", { title: "Raider role", keywords: "get raider role, how to join raids", body: "Press the Raider button in #roles and you're in." }, "u1");
    assert.ok(ok.id);
    db.addServerGuide("OTHER", { title: "Other", keywords: "get raider role", body: "Another server's answer here." });
    const list = db.listServerGuides("G");
    assert.equal(list.length, 1);
    assert.deepEqual(list[0].keywords, ["get raider role", "how to join raids"]);
    assert.equal(matchServerGuide("how do I get raider role?", list)?.title, "Raider role");
    assert.equal(matchServerGuide("I got raider role yesterday lol", list), null, "needs to be a question");
    assert.equal(matchServerGuide("raider role", list, { loose: true })?.title, "Raider role", "the AI already judged it a question");
    assert.match(serverGuidePayload(list[0]).embeds[0].description, /Raider button/);
    const r = await t.run("server_guide", { question: "how do i join raids" }, ctx());
    assert.match(r.answer, /Raider button/);
    assert.equal((await t.run("server_guide", { question: "what is the airspeed of a swallow" }, ctx({ guildId: "EMPTY" }))).found, false);
    assert.equal(db.deleteServerGuide("OTHER", ok.id), false, "another server cannot delete it");
    assert.equal(db.deleteServerGuide("G", ok.id), true);
    for (let n = 0; n < 25; n++) db.addServerGuide("G", { title: "g" + n, keywords: "phrase " + n, body: "An answer long enough." });
    assert.match(db.addServerGuide("G", { title: "one more", keywords: "phrase x", body: "An answer long enough." }).error, /25/);
    db.forgetCommunityGuild("G");
    assert.equal(db.listServerGuides("G").length, 0);
});

test("AI extras: every tool the model is offered exists and names are unique", async () => {
    const { t } = mk();
    assert.equal(new Set(t.defs.map(d => d.name)).size, t.defs.length);
    for (const d of t.defs) assert.notEqual((await t.run(d.name, { title: "x", status: "backlog", topic: "music", first: "a", second: "b", game: "g", when: "in 2 hours", note: "n", question: "q" }, ctx())).error, "Unknown tool.", d.name);
});

test("AI extras: price-target alerts and removing from the wishlist act on the asker's own list", async () => {
    const { db, t } = mk();
    const a = await t.run("set_price_alert", { title: "Hades", price: 10 }, ctx());
    assert.equal(a.added, "Hades"); assert.match(a.alert, /10/);
    assert.ok((await t.run("set_price_alert", { title: "Celeste", percent: 50 }, ctx())).added);
    assert.ok((await t.run("set_price_alert", { title: "X", percent: 500 }, ctx())).error, "bad percent refused");
    assert.equal(db.listItems("u2").length, 0);
    assert.equal((await t.run("remove_from_wishlist", { title: "celeste" }, ctx())).removed, "Celeste");
    assert.ok((await t.run("remove_from_wishlist", { title: "nope" }, ctx())).error);
    assert.equal(db.listItems("u1").length, 1);
});

test("AI extras: 'what can you do' shows a picture and works with no AI key", async () => {
    const { t } = mk();
    const c = ctx();
    const r = await t.run("what_can_you_do", {}, c);
    assert.ok(r.abilities.length >= 8);
    assert.ok(c.cards[0].file.data.length > 2000);
    const { liteAnswer, intentOf } = await import("../src/ailite.js");
    assert.equal(intentOf("hey what can you do?").kind, "abilities");
    assert.equal(intentOf("what all can you help with").kind, "abilities");
    const cards = [];
    assert.match(await liteAnswer({ question: "what can you do", userId: "u1", guildId: "G", tools: t, cards }), /Prices and deals/);
    assert.equal(cards.length, 1);
});

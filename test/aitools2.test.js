import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createAiTools } from "../src/aitools.js";
import { liteAnswer, intentOf } from "../src/ailite.js";

const itad = { lookupTitles: async ts => ts.map(t => ({ id: "id-" + t.toLowerCase(), title: t, matched: t })), getPrices: async () => new Map() };
const mk = () => { const db = openDb(":memory:"); db.ensureUser("u1", "G"); return { db, t: createAiTools({ db, itad }) }; };

test("AI tools: every tool the model is offered has an implementation", async () => {
    const { t } = mk();
    for (const d of t.defs) assert.notEqual((await t.run(d.name, d.input_schema.required ? { title: "x", status: "backlog" } : {}, { userId: "u1", guildId: "G", cards: [] })).error, "Unknown tool.", d.name);
    assert.equal(new Set(t.defs.map(d => d.name)).size, t.defs.length, "no duplicate names");
});

test("AI tools: achievements say plainly when Steam is not linked", async () => {
    const { t } = mk();
    const r = await t.run("my_achievements", {}, { userId: "u1" });
    assert.equal(r.linked, false);
    assert.match(r.note, /not linked/);
});

test("AI tools: settings, goals, library status and wishlist changes really change the data", async () => {
    const { db, t } = mk();
    const ctx = { userId: "u1", guildId: "G", cards: [] };
    assert.deepEqual((await t.run("update_settings", { paused: true, region: "gb", min_discount: 40 }, ctx)).changed.length, 3);
    const u = db.getUser("u1");
    assert.equal(u.paused, 1); assert.equal(u.region, "GB"); assert.equal(u.min_discount, 40);
    assert.ok((await t.run("update_settings", { region: "zz" }, ctx)).error);
    assert.equal((await t.run("my_settings", {}, ctx)).alerts, "paused");

    assert.equal((await t.run("add_to_library", { title: "Hades", paid: 12 }, ctx)).ok, true);
    assert.equal(db.listLibrary("u1")[0].paid, 12);
    assert.equal((await t.run("set_game_status", { title: "hades", status: "finished" }, ctx)).status, "finished");
    assert.equal(db.listLibrary("u1")[0].status, "finished");
    assert.ok((await t.run("set_game_status", { title: "nope", status: "playing" }, ctx)).error);
    assert.deepEqual((await t.run("set_goals", { games_this_month: 3, hours_this_year: 200 }, ctx)).set.length, 2);
    assert.equal(db.getHourGoal("u1"), 200);
    assert.equal((await t.run("my_challenge", {}, ctx)).goal, 3);
    assert.equal((await t.run("remove_from_library", { title: "Hades" }, ctx)).removed, "Hades");
    assert.equal(db.listLibrary("u1").length, 0);
});

test("AI tools: server activity needs a server", async () => {
    const { t } = mk();
    assert.ok((await t.run("server_activity", {}, { userId: "u1" })).error);
    const r = await t.run("server_activity", {}, { userId: "u1", guildId: "G" });
    assert.ok(!r.error, r.error);
});

test("AI lite: achievement questions are answered from the tool", async () => {
    const { t } = mk();
    assert.equal(intentOf("what's some of my rarest achievements").kind, "more");
    const text = await liteAnswer({ question: "what's some of my rarest achievements", userId: "u1", guildId: "G", tools: t, cards: [] });
    assert.match(text, /not linked/);
});

test("AI tools: linked Steam gives rare achievements, hours and a play-next card", async () => {
    const { db, t } = mk();
    db.setSteamLink("u1", "76561190000000001");
    db.syncSteamGames("u1", [{ itad_id: "a", title: "Hades", appid: 1145360, minutes: 3000 }, { itad_id: "b", title: "Celeste", appid: 504230, minutes: 0 }]);
    db.setRareAchievements("u1", 1145360, "Hades", [{ apiname: "X", name: "Escaped", icon: "https://i.test/x.jpg", pct: 1.2 }]);
    const cards = [], ctx = { userId: "u1", guildId: "G", cards };
    const a = await t.run("my_achievements", {}, ctx);
    assert.equal(a.rarest[0].achievement, "Escaped");
    assert.equal(a.rarest[0].ownedByPercentOfPlayers, 1.2);
    const s = await t.run("my_steam", {}, ctx);
    assert.equal(s.games, 2);
    assert.equal(s.mostPlayed[0].title, "Hades");
    assert.ok(cards[0].image.includes("504230") || cards[0].image.includes("1145360"));
    const lite = await liteAnswer({ question: "what are my rarest achievements", userId: "u1", guildId: "G", tools: t, cards: [] });
    assert.match(lite, /Escaped/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { STATS, pickRound, judge, questionLines, createHilo, hiloMessage, createHiloHandlers } from "../src/hilo.js";
import { factsFrom } from "../src/trivia.js";

const game = (appid, name, price, recs, meta) => ({ v: 2, appid, name, year: "2020", genres: ["Action"], price, recs, meta });
const FACTS = [game(1, "Cheap", 999, 50000, 80), game(2, "Pricey", 5999, 9000, 90), game(3, "Free", 0, 900000, null), game(4, "Mid", 2999, 200000, 70)];

test("facts keep price, review count and Metacritic from Steam's data", () => {
    const f = factsFrom(5, { name: "G", release_date: { date: "3 Mar, 2019" }, genres: [{ description: "RPG" }], short_description: "x".repeat(40), price_overview: { initial: 1999 }, recommendations: { total: 1234 }, metacritic: { score: 88 } });
    assert.equal(f.price, 1999); assert.equal(f.recs, 1234); assert.equal(f.meta, 88); assert.equal(f.v, 2);
    const free = factsFrom(6, { name: "F", is_free: true, release_date: { date: "2019" }, genres: [{ description: "RPG" }], short_description: "x".repeat(40) });
    assert.equal(free.price, 0); assert.equal(free.recs, null);
});

test("pickRound never pairs a game with itself or with a near tie, and skips games missing the stat", () => {
    for (let n = 0; n < 200; n++) {
        const r = pickRound(FACTS, { rand: Math.random });
        assert.ok(r); assert.notEqual(r.a.appid, r.b.appid);
        const S = STATS[r.stat];
        assert.notEqual(S.get(r.a), null); assert.notEqual(S.get(r.b), null);
        assert.equal(S.tooClose(S.get(r.a), S.get(r.b)), false);
    }
    assert.equal(pickRound([FACTS[0]], {}), null);
});

test("pickRound keeps the previous second game as the new first", () => {
    let kept = 0;
    for (let n = 0; n < 60; n++) { const r = pickRound(FACTS, { prev: FACTS[1] }); if (r.a.appid === 2) kept++; }
    assert.ok(kept > 30, `kept ${kept}/60`);
});

test("judge says higher or lower correctly", () => {
    const round = { stat: "price", a: FACTS[0], b: FACTS[1] };
    assert.equal(judge(round, "h").correct, true);
    assert.equal(judge(round, "l").correct, false);
    assert.equal(judge({ stat: "meta", a: FACTS[0], b: FACTS[2] }, "h"), null, "a missing value can't be judged");
    assert.match(questionLines(round), /Cheap.*\$9\.99.*Pricey/s);
});

test("the Discord message carries everything in its buttons and fits Discord's id limit", () => {
    const m = hiloMessage({ stat: "reviews", a: { appid: 1245620, name: "A" }, b: { appid: 2358720, name: "B" } }, { uid: "123456789012345678", streak: 12 });
    const ids = m.components[0].components.map(c => c.custom_id);
    for (const id of ids) assert.ok(id.length <= 100, id);
    assert.match(ids[0], /^hilo:123456789012345678:12:1245620:2358720:reviews:h$/);
});

test("scores keep the best streak per server, and a button press by someone else is refused", async () => {
    const db = openDb(":memory:");
    db.noteHilo("g", "u", 3); db.noteHilo("g", "u", 7); db.noteHilo("g", "u", 2, true);
    assert.equal(db.hiloBest("g", "u").best, 7); assert.equal(db.hiloBest("g", "u").games, 1);
    assert.deepEqual(db.hiloTop("g", 5).map(r => r.best), [7]);
    for (const f of FACTS) db.saveTriviaFacts(f.appid, f);
    const hilo = createHilo({ db, fetchImpl: async () => { throw new Error("no network"); }, pool: [1, 2, 3, 4] });
    const ui = createHiloHandlers({ hilo, db });
    const replies = [];
    await ui.handleButton({ customId: "hilo:other:0:1:2:price:h", user: { id: "me" }, reply: async x => replies.push(x) });
    assert.match(replies[0].content, /belongs to someone else/);
});

test("the dashboard round is signed: a forged or swapped token is refused, a real one scores", async () => {
    const db = openDb(":memory:");
    for (const f of FACTS) db.saveTriviaFacts(f.appid, f);
    const hilo = createHilo({ db, fetchImpl: async () => { throw new Error("no network"); }, pool: [1, 2, 3, 4] });
    const first = await hilo.webStep({ guildId: "g", userId: "u1" });
    assert.ok(first.token && first.round.a.value);
    assert.equal(first.round.b.value, undefined, "the answer is never sent");
    await assert.rejects(() => hilo.webStep({ guildId: "g", userId: "u1", token: first.token.slice(0, -2) + "xx", dir: "h" }), /expired/);
    await assert.rejects(() => hilo.webStep({ guildId: "g", userId: "someone-else", token: first.token, dir: "h" }), /expired/);
    const res = await hilo.webStep({ guildId: "g", userId: "u1", token: first.token, dir: "h" });
    assert.equal(typeof res.correct, "boolean");
    if (res.correct) { assert.equal(res.streak, 1); assert.ok(res.token); assert.equal(db.hiloBest("g", "u1").best, 1); }
    else assert.equal(db.hiloBest("g", "u1").games, 1);
});

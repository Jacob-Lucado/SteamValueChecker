import test from "node:test";
import assert from "node:assert/strict";
import { createPlayers, playersLine } from "../src/players.js";
import { createIgdb, timeLine, criticLine, perHour } from "../src/igdb.js";
import { configureFacts, gameFacts, factLines } from "../src/gamefacts.js";
import { alertEmbed, checkEmbed } from "../src/render.js";
import { openDb } from "../src/db.js";

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("player counts: read from Steam, remembered for ten minutes, and never throw", async () => {
    let t = 0, calls = 0;
    const p = createPlayers({ now: () => t, fetchImpl: async url => { calls++; assert.match(String(url), /GetNumberOfCurrentPlayers\/v1\/\?appid=620$/); return json({ response: { player_count: 4321, result: 1 } }); } });
    assert.equal(await p.current(620), 4321);
    assert.equal(await p.current(620), 4321);
    assert.equal(calls, 1);
    t = 11 * 60_000; await p.current(620); assert.equal(calls, 2);
    assert.equal(await createPlayers({ fetchImpl: async () => { throw new Error("down"); } }).current(620), null);
    assert.equal(await p.current(0), null);
    assert.equal(playersLine(4321), "👥 **4,321** playing on Steam right now");
    assert.equal(playersLine(3), null, "a handful of players says nothing");
});

function fakeIgdb({ oldNames = false, noTimes = false } = {}) {
    const seen = [];
    const fetchImpl = async (url, init) => {
        const u = String(url); seen.push(u.replace(/\?.*/, "") + (init?.body ? " " + init.body : ""));
        if (u.startsWith("https://id.twitch.tv/oauth2/token")) return json({ access_token: "tok", expires_in: 5000 });
        assert.equal(init.headers["Client-ID"], "cid"); assert.equal(init.headers.Authorization, "Bearer tok");
        if (u.endsWith("/external_games")) {
            if (oldNames && /external_game_source/.test(init.body)) return json({}, 400);
            return json(/uid = "1145360"/.test(init.body) ? [{ id: 1, game: 113112 }] : []);
        }
        if (u.endsWith("/games")) return json([{ id: 113112, aggregated_rating: 92.6, aggregated_rating_count: 21 }]);
        if (u.endsWith("/game_time_to_beats")) return json(noTimes ? [] : [{ id: 9, hastily: 16 * 3600, normally: 22 * 3600, completely: 95 * 3600 }]);
        return json([], 404);
    };
    return { fetchImpl, seen };
}

test("IGDB: hours to finish and the critics' score for a Steam app, kept in the database", async () => {
    const db = openDb(":memory:");
    const { fetchImpl, seen } = fakeIgdb();
    const igdb = createIgdb({ clientId: "cid", clientSecret: "sec", fetchImpl, db });
    const f = await igdb.facts(1145360);
    assert.deepEqual(f, { hours: { main: 22, rushed: 16, complete: 95 }, critic: { score: 93, count: 21 } });
    const n = seen.length;
    assert.deepEqual(await createIgdb({ clientId: "cid", clientSecret: "sec", fetchImpl, db }).facts(1145360), f, "a fresh start reads it back");
    assert.equal(seen.length, n, "without asking again");
    assert.equal(await igdb.facts(999), null, "a game IGDB doesn't know");
    assert.equal(timeLine(f), "⏱️ About **22 hours** to finish (95 to see everything)");
    assert.equal(criticLine(f), "📰 Critics: **93/100** from 21 reviews");
    assert.equal(perHour(f, 11), 0.5);
});

test("IGDB: older field names are tried when the current ones are refused, and it is off without keys", async () => {
    const { fetchImpl } = fakeIgdb({ oldNames: true, noTimes: true });
    const f = await createIgdb({ clientId: "cid", clientSecret: "sec", fetchImpl }).facts(1145360);
    assert.deepEqual(f, { hours: { main: null, rushed: null, complete: null }, critic: { score: 93, count: 21 } });
    assert.equal(timeLine(f), null);
    const off = createIgdb({ fetchImpl: async () => { throw new Error("must not be called"); } });
    assert.equal(off.enabled, false);
    assert.equal(await off.facts(1145360), null);
    const broken = createIgdb({ clientId: "cid", clientSecret: "sec", fetchImpl: async () => json({}, 500) });
    assert.equal(await broken.facts(1145360), null, "a failure is just no facts");
});

test("game facts: nothing until configured, then shown on the alert and check cards with a cost per hour", async () => {
    configureFacts(null);
    assert.equal(await gameFacts(620), null);
    configureFacts({ players: { current: async () => 5000 }, igdb: { facts: async () => ({ hours: { main: 20, rushed: null, complete: null }, critic: { score: 88, count: 40 } }) } });
    const facts = await gameFacts(620);
    configureFacts(null);
    assert.deepEqual(facts, { players: 5000, hours: { main: 20, rushed: null, complete: null }, critic: { score: 88, count: 40 } });
    const lines = factLines(facts, { price: 10, money: n => "$" + n.toFixed(2) });
    assert.deepEqual(lines, ["📰 Critics: **88/100** from 40 reviews", "⏱️ About **20 hours** to finish, about $0.50 an hour at this price", "👥 **5,000** playing on Steam right now"]);
    const now = { price: 10, regular: 20, discount: 0.5, currency: "USD", shop: "Steam", atl: 5, low1y: 8, low3m: 9, expiry: null };
    const alert = alertEmbed({ title: "Portal 2", itad_id: "x", appid: 620 }, now, { trigger: "any sale", facts });
    assert.match(alert.description, /Critics: \*\*88\/100\*\*/);
    assert.match(alert.description, /an hour at this price/);
    const check = checkEmbed("Portal 2", now, { level: "good", text: "ok" }, null, [], null, facts);
    assert.ok(check.fields.some(f => f.name === "About the game" && /playing on Steam/.test(f.value)));
    assert.ok(!alertEmbed({ title: "Portal 2", itad_id: "x" }, now, { trigger: "any sale" }).description.includes("Critics"), "no facts, no lines");
});

import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { longestStreak, archetype, wrappedData, wrappedSvg, renderWrapped, SLIDES } from "../src/wrapped.js";

const png = b => Buffer.from(b).subarray(0, 8).toString("hex") === "89504e470d0a1a0a";

// A member with a year of tracked hours: syncs on chosen days.
function rig() {
    let clock = Date.UTC(2026, 0, 5);
    const db = openDb(":memory:", { now: () => clock });
    db.ensureUser("u1", "g1");
    db.setSteamLink("u1", "76561198000000000");
    const g = (a, b, c) => [{ itad_id: "a", title: "Alpha", appid: 1, minutes: a }, { itad_id: "b", title: "Beta", appid: 2, minutes: b }, { itad_id: "c", title: "Gamma", appid: 3, minutes: c }];
    db.syncSteamGames("u1", g(10, 10, 10)); // the first sync only imports
    let a = 10, b = 10, c = 10;
    const play = (y, m, d, da, db_, dc) => { clock = Date.UTC(y, m, d, 12); a += da; b += db_; c += dc; db.syncSteamGames("u1", g(a, b, c)); };
    return { db, play, setClock: t => { clock = t; } };
}

test("the longest run of days in a row", () => {
    assert.equal(longestStreak([]), 0);
    assert.equal(longestStreak(["2026-03-01"]), 1);
    assert.equal(longestStreak(["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-05", "2026-03-06"]), 3);
    assert.equal(longestStreak(["2026-03-03", "2026-03-01", "2026-03-02", "2026-03-02"]), 3, "order and repeats do not matter");
    assert.equal(longestStreak(["2026-02-28", "2026-03-01"]), 2, "across a month end");
});

test("the player type follows the year's numbers, in priority order", () => {
    const base = { totalMinutes: 6000, top: [{ title: "Alpha", minutes: 1000 }], finished: [], activeDays: 30, games: 5, weekendShare: 0.2, added: 2, longestStreak: 3 };
    assert.equal(archetype({ ...base, totalMinutes: 0, top: [] }).name, "The Fresh Start");
    assert.equal(archetype({ ...base, finished: Array(6).fill("x") }).name, "The Completionist");
    assert.equal(archetype({ ...base, totalMinutes: 2000, top: [{ title: "Alpha", minutes: 1200 }] }).name, "The Marathoner");
    assert.equal(archetype({ ...base, activeDays: 230 }).name, "The Daily Grinder");
    assert.equal(archetype({ ...base, games: 40 }).name, "The Explorer");
    assert.equal(archetype({ ...base, weekendShare: 0.7 }).name, "The Weekend Warrior");
    assert.equal(archetype({ ...base, added: 20 }).name, "The Collector");
    assert.equal(archetype({ ...base, longestStreak: 20 }).name, "The Streak Keeper");
    assert.equal(archetype(base).name, "The Steady Player");
});

test("wrapped data sums the year from the tracked hours", () => {
    const { db, play } = rig();
    play(2026, 2, 10, 120, 0, 0);   // Tue 10 Mar: Alpha +2h
    play(2026, 2, 11, 60, 60, 0);   // Wed: Alpha +1h, Beta +1h
    play(2026, 2, 14, 0, 0, 240);   // Sat: Gamma +4h
    db.setLibraryStatus?.("u1", "a", "finished");
    const d = wrappedData({ db, userId: "u1", year: 2026, now: Date.UTC(2026, 5, 1) });
    assert.equal(d.hours, 8);
    assert.equal(d.games, 3);
    assert.equal(d.activeDays, 3);
    assert.equal(d.longestStreak, 2);
    assert.equal(d.busiest, 2);
    assert.equal(d.busiestName, "March");
    assert.equal(d.top[0].title, "Gamma");
    assert.equal(Math.round(d.weekendShare * 100), Math.round(240 / 480 * 100));
    assert.equal(d.partial, true);
    assert.equal(wrappedData({ db, userId: "u1", year: 2025 }), null, "nothing tracked that year");
    db.close();
});

test("each of the five pictures draws, and they come back as PNGs", async () => {
    const { db, play } = rig();
    play(2026, 2, 10, 120, 30, 600);
    for (let n = 1; n <= SLIDES; n++) {
        const svg = wrappedSvg(n, wrappedData({ db, userId: "u1", year: 2026, now: Date.UTC(2026, 11, 31) }), { name: "Test <Player> & co" });
        assert.match(svg, /^<svg /);
        assert.ok(!svg.includes("<Player>"), "names are escaped");
    }
    const out = await renderWrapped({ db, userId: "u1", year: 2026, name: "Tester", fetchImpl: async () => ({ ok: false, status: 404, text: async () => "", json: async () => ({}) }), now: Date.UTC(2026, 11, 31) });
    assert.equal(out.length, 5);
    assert.ok(out.every(png));
    assert.equal(await renderWrapped({ db, userId: "nobody", year: 2026 }), null, "Steam not linked");
    assert.equal(await renderWrapped({ db, userId: "u1", year: 2020 }), null, "nothing that year");
    db.close();
});

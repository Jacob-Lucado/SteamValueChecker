import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { buildServerWrapped, renderServerWrapped } from "../src/serverwrapped.js";

function seed(clockRef) {
    const db = openDb(":memory:", { now: () => clockRef.t });
    const lib = {
        a: [["a", "Hades II", 600], ["b", "Stardew Valley", 300], ["c", "Balatro", 120]],
        b: [["b", "Stardew Valley", 900], ["a", "Hades II", 60]],
        c: [["a", "Hades II", 1200], ["d", "Portal 2", 90]],
        d: [["b", "Stardew Valley", 500]]
    };
    for (const id of Object.keys(lib)) { db.ensureUser(id, "g1"); if (id !== "d") db.updateUser(id, { share: 1 }); }
    const games = (id, mult) => lib[id].map(([k, title, m], n) => ({ itad_id: k, title, appid: n + 1, minutes: m * mult }));
    clockRef.t = Date.UTC(2026, 2, 1); for (const id of Object.keys(lib)) db.syncSteamGames(id, games(id, 0.001)); // baseline
    clockRef.t = Date.UTC(2026, 5, 1); for (const id of Object.keys(lib)) db.syncSteamGames(id, games(id, 1));
    return db;
}

test("server wrapped adds up only members who share, this year", () => {
    const clock = { t: Date.UTC(2026, 2, 1) };
    const db = seed(clock);
    const w = buildServerWrapped(db, "g1", Date.UTC(2026, 10, 5));
    assert.equal(w.year, 2026); assert.equal(w.members, 3);              // "d" does not share
    assert.equal(w.top[0].title, "Hades II"); assert.equal(w.top[0].players, 3);
    assert.ok(!w.top.some(g => g.minutes > 3000));
    assert.equal(w.mvp[0].discord_id, "c");
    assert.equal(w.everyonesGame.title, "Hades II");
    assert.equal(buildServerWrapped(db, "empty", Date.UTC(2026, 10, 5)), null);
    assert.equal(buildServerWrapped(db, "g1", Date.UTC(2027, 1, 1)), null, "a new year starts empty");
    db.close();
});

test("server wrapped draws a picture", async () => {
    const clock = { t: Date.UTC(2026, 2, 1) };
    const db = seed(clock);
    const w = buildServerWrapped(db, "g1", Date.UTC(2026, 10, 5));
    const png = await renderServerWrapped(w, { guildName: "Game Junkies", nameOf: id => ({ a: "Jacob", b: "Kendall", c: "JJ" }[id] ?? "a member") });
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    if (process.env.WRAPPED_OUT) (await import("node:fs")).writeFileSync(process.env.WRAPPED_OUT, png);
    db.close();
});

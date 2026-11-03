import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { runYearInGames, yearlyOpen } from "../src/yearly.js";

const DEC = Date.parse("2026-12-27T12:00:00Z"), NOV = Date.parse("2026-11-20T12:00:00Z");

function world() {
    const db = openDb(":memory:", { now: () => DEC });
    for (const id of ["a", "b", "c"]) db.ensureUser(id, null);
    db.updateUser("a", { yearly: 1 }); db.updateUser("b", { yearly: 1 });
    const sent = [];
    const notifier = { deliver: async (u, p, kind) => { sent.push({ id: u.discord_id, p, kind }); return { ok: true, via: "dm" }; } };
    return { db, sent, notifier };
}

test("year in games: opens December 26, sends once to opted-in members with a card, skips members with nothing tracked", async () => {
    assert.equal(yearlyOpen(NOV), false); assert.equal(yearlyOpen(Date.parse("2026-12-25T23:00:00Z")), false); assert.equal(yearlyOpen(DEC), true);
    const w = world();
    const render = async id => (id === "a" ? Buffer.from("png") : null);
    assert.equal((await runYearInGames({ db: w.db, notifier: w.notifier, render, now: () => NOV })).checked, 0);
    const s = await runYearInGames({ db: w.db, notifier: w.notifier, render, now: () => DEC });
    assert.equal(s.delivered, 1); assert.equal(s.skipped, 1);
    assert.equal(w.sent[0].id, "a"); assert.equal(w.sent[0].kind, "yearly");
    assert.match(w.sent[0].p.embeds[0].title, /2026 in games/); assert.equal(w.sent[0].p.files[0].name, "year-in-games.png");
    const again = await runYearInGames({ db: w.db, notifier: w.notifier, render, now: () => DEC });
    assert.equal(again.checked, 0);
});

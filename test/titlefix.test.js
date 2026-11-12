import test from "node:test";
import assert from "node:assert/strict";
import { createItad, steamAppFrom } from "../src/itad.js";
import { openDb } from "../src/db.js";
import { lookupWithFixes, saveFix, forgetFix, FixError } from "../src/titlefix.js";
import { runValue } from "../src/value.js";

const json = body => ({ ok: true, status: 200, headers: new Map(), json: async () => body });

// A tiny IsThereAnyDeal: knows Hades by title and by Steam app 1145360, finds "Hadez" only as a loose search hit for something else.
function fakeItad() {
    const calls = [];
    const fetchImpl = async (url, init) => {
        const u = new URL(url), body = init?.body ? JSON.parse(init.body) : null;
        calls.push(u.pathname);
        if (u.pathname === "/lookup/id/title/v1") return json(Object.fromEntries(body.map(t => [t, t === "Hades" ? "id-hades" : null])));
        if (u.pathname === "/lookup/id/shop/61/v1") return json(Object.fromEntries(body.map(s => [s, s === "app/1145360" ? "id-hades" : null])));
        if (u.pathname === "/games/info/v2") return json({ title: "Hades", appid: 1145360 });
        if (u.pathname === "/games/search/v1") return json(u.searchParams.get("title") === "Hadez" ? [{ id: "id-hader", title: "Hader" }] : []);
        if (u.pathname === "/games/prices/v3") return json(body.map(id => ({ id, deals: [{ shop: { id: 61, name: "Steam" }, price: { amount: 10, currency: "USD" }, regular: { amount: 25, currency: "USD" }, cut: 60 }], historyLow: { all: { amount: 5 } } })));
        return json({});
    };
    return { itad: createItad({ apiKey: "k", fetchImpl, minGapMs: 0 }), calls };
}

test("a Steam link or app number is picked out of what was typed, a bare number is not", () => {
    assert.equal(steamAppFrom("https://store.steampowered.com/app/1145360/Hades/"), 1145360);
    assert.equal(steamAppFrom("store.steampowered.com/app/620?snr=1_7"), 620);
    assert.equal(steamAppFrom("app/220"), 220);
    assert.equal(steamAppFrom("appid: 440"), 440);
    assert.equal(steamAppFrom("2048"), null);
    assert.equal(steamAppFrom("Half-Life 2"), null);
});

test("value checker: a Steam store link is an exact match and shows the game's name", async () => {
    const { itad, calls } = fakeItad();
    const out = await runValue({ itad, typed: "https://store.steampowered.com/app/1145360/Hades/" });
    assert.equal(out.rows[0].title, "Hades");
    assert.equal(out.rows[0].found, true);
    assert.equal(out.rows[0].approx, false, "no ~ on a link");
    assert.ok(!calls.includes("/games/search/v1"), "nothing was guessed");
});

test("a saved correction is used the next time, only for that member, and can be forgotten", async () => {
    const { itad } = fakeItad();
    const db = openDb(":memory:");
    const before = await runValue({ itad, db, userId: "u1", typed: "Hadez" });
    assert.equal(before.rows[0].approx, true);
    assert.ok(before.notes.some(n => /fix it once/.test(n)));

    const saved = await saveFix({ itad, db, userId: "u1", typed: "Hadez", game: "https://store.steampowered.com/app/1145360" });
    assert.equal(saved.title, "Hades");
    const after = await runValue({ itad, db, userId: "u1", typed: "hadez;  Hades" });
    assert.deepEqual(after.rows.map(r => [r.title, r.id, r.approx]), [["Hades", "id-hades", false], ["Hades", "id-hades", false]]);

    const other = await lookupWithFixes({ itad, db, userId: "u2", titles: ["Hadez"] });
    assert.equal(other[0].id, "id-hader", "someone else's lookups are untouched");

    assert.equal(db.exportUser("u1").match_fixes.length, 1, "it is in the data export");
    assert.equal(forgetFix({ db, userId: "u1", typed: "HADEZ" }), true);
    assert.equal(db.listTitleFixes("u1").length, 0);
    await assert.rejects(saveFix({ itad, db, userId: "u1", typed: "Hadez", game: "zzzz nothing" }), FixError);
});

test("deleting a member's data removes their corrections", async () => {
    const { itad } = fakeItad();
    const db = openDb(":memory:");
    await saveFix({ itad, db, userId: "u1", typed: "Hadez", game: "Hades" });
    db.deleteUser("u1");
    assert.equal(db.listTitleFixes("u1").length, 0);
});

test("price cache: a big price check no longer pushes out title lookups", async () => {
    const { itad, calls } = fakeItad();
    await itad.lookupTitles(["Hades"]);
    await itad.getPrices(Array.from({ length: 3000 }, (_, n) => "g" + n));
    calls.length = 0;
    await itad.lookupTitles(["Hades"]);
    assert.deepEqual(calls, [], "still remembered");
});

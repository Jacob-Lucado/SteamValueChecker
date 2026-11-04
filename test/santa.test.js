import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { draw, createEvent, joinEvent, leaveEvent, drawEvent, myAssignment, endEvent, giftIdeas } from "../src/santa.js";
import { UserError } from "../src/errors.js";

const deal = (amount, regular, shop = "Steam") => ({ shop: { name: shop }, price: { amount, currency: "USD" }, regular: { amount: regular, currency: "USD" }, cut: 0, url: "https://deal.example/" + amount });
function world() {
    const db = openDb(":memory:");
    for (const u of ["1001", "1002", "1003", "1004"]) db.ensureUser(u, "g1");
    db.addItems("1002", [{ itad_id: "hades", title: "Hades" }, { itad_id: "pricey", title: "Pricey Game" }, { itad_id: "owned", title: "Owned" }]);
    db.upsertLibrary("1002", [{ itad_id: "owned", title: "Owned" }]);
    const prices = { hades: { deals: [deal(10, 25)] }, pricey: { deals: [deal(60, 60)] }, owned: { deals: [deal(5, 5)] } };
    const itad = { getPrices: async ids => new Map(ids.map(id => [id, prices[id] ?? { deals: [] }])) };
    const dms = [];
    return { db, itad, dms, sendDm: async (id, p) => { if (id === "1004") throw new Error("closed"); dms.push([id, p]); } };
}

test("santa: the draw is one loop, nobody gets themselves, and it needs enough people", () => {
    for (let n = 0; n < 50; n++) {
        const ids = ["a", "b", "c", "d", "e"], pairs = draw(ids);
        assert.equal(pairs.size, 5);
        for (const [s, g] of pairs) assert.notEqual(s, g);
        assert.deepEqual([...pairs.values()].sort(), ids);
    }
    assert.throws(() => draw(["a", "b"]), UserError);
});

test("santa: one event at a time, joining and leaving only while open, ideas stay inside the budget and skip owned games", async () => {
    const w = world();
    assert.throws(() => createEvent(w.db, { guildId: "g1", budget: 0, by: "1001" }), UserError);
    createEvent(w.db, { guildId: "g1", title: "Winter", budget: 20, by: "1001" });
    assert.throws(() => createEvent(w.db, { guildId: "g1", budget: 20, by: "1001" }), /already/);
    for (const u of ["1001", "1002", "1003", "1004"]) joinEvent(w.db, "g1", u);
    assert.equal(joinEvent(w.db, "g1", "1001").joined, false);
    assert.equal(leaveEvent(w.db, "g1", "1003").left, true); joinEvent(w.db, "g1", "1003");
    const ev = w.db.getSanta("g1");
    const { ideas, wishlist } = await giftIdeas({ db: w.db, itad: w.itad, giftee: "1002", event: ev });
    assert.deepEqual(ideas.map(i => i.title), ["Hades"]); assert.equal(wishlist, 2);
    assert.equal(Math.round(ideas[0].discount * 100), 60);
});

test("santa: drawing messages every Santa privately, reports closed DMs, and ideas still work for them", async () => {
    const w = world();
    createEvent(w.db, { guildId: "g1", budget: 20, by: "1001" });
    for (const u of ["1001", "1002", "1003", "1004"]) joinEvent(w.db, "g1", u);
    const r = await drawEvent({ db: w.db, itad: w.itad, sendDm: w.sendDm, nameOf: async id => "User " + id, guildName: "Game Junkies", guildId: "g1" });
    assert.equal(r.count, 4); assert.deepEqual(r.failed, ["1004"]); assert.equal(w.dms.length, 3);
    assert.equal(r.event.status, "drawn");
    assert.throws(() => leaveEvent(w.db, "g1", "1001"), /already drawn/);
    const santaOf1002 = w.db.santaFor(r.event.id, "1002");
    const dm = w.dms.find(([id]) => id === santaOf1002)?.[1];
    if (dm) { assert.match(dm.embeds[0].title, /User 1002/); assert.match(dm.embeds[0].description, /Hades/); }
    const mine = await myAssignment({ db: w.db, itad: w.itad, guildId: "g1", userId: "1004", nameOf: async id => "User " + id, guildName: "G" });
    assert.match(mine.embeds[0].title, /Secret Santa for/);
    const { event, entries } = endEvent(w.db, "g1");
    assert.equal(event.status, "ended"); assert.equal(entries.length, 4);
    createEvent(w.db, { guildId: "g1", budget: 15, by: "1001" }); // a new one can start once the last is finished
    assert.equal(w.db.getSanta("g1").budget, 15);
});

import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { goalProgress } from "../src/steamstore.js";
import { extraBoard } from "../src/library.js";
import { addBundle, bundleView, verdictFor } from "../src/bundles.js";
import { prefsPatch } from "../src/prefs.js";
import { runCycle } from "../src/poller.js";
import { createNotifier } from "../src/notify.js";
import { UserError } from "../src/errors.js";

const deal = (amount, regular) => ({ shop: { name: "GOG" }, price: { amount, currency: "USD" }, regular: { amount: regular, currency: "USD" }, cut: 0, url: "https://deal.example/x" });
const itadWith = prices => ({
    getPrices: async ids => new Map(ids.map(id => [id, prices[id] ?? { deals: [] }])),
    lookupTitles: async titles => titles.map(t => (/^zzz/i.test(t) ? { title: t, id: null } : { title: t, id: "id-" + t.toLowerCase().replace(/\W+/g, ""), approx: false, matched: t }))
});

test("hours goal: progress, pace and the weekly amount still needed", () => {
    const mid = Date.UTC(2026, 6, 2); // day 183 of 365
    const p = goalProgress(300, 90 * 60, mid);
    assert.equal(p.done, 90); assert.equal(p.pct, 30); assert.equal(p.reached, false);
    assert.ok(p.projected > 150 && p.projected < 220);
    assert.ok(p.perWeek > 5 && p.perWeek < 10);
    assert.equal(goalProgress(100, 150 * 60, mid).reached, true);
    assert.equal(goalProgress(100, 150 * 60, mid).perWeek, 0);
});

test("hours goal is stored per year and cleared with 0", () => {
    let clock = Date.UTC(2026, 5, 1);
    const db = openDb(":memory:", { now: () => clock });
    db.ensureUser("u1", "g1");
    assert.equal(db.getHourGoal("u1"), null);
    db.setHourGoal("u1", 250); assert.equal(db.getHourGoal("u1"), 250);
    clock = Date.UTC(2027, 0, 5); assert.equal(db.getHourGoal("u1"), null); // last year's goal is not this year's
    clock = Date.UTC(2026, 5, 1); db.setHourGoal("u1", 0); assert.equal(db.getHourGoal("u1"), null);
});

test("extra boards: hours this year and library size count only opted-in members of that server", () => {
    let clock = Date.UTC(2026, 2, 1);
    const db = openDb(":memory:", { now: () => clock });
    const g = (n, m) => [{ itad_id: "a", title: "Alpha", appid: 1, minutes: m }, ...Array.from({ length: n }, (_, i) => ({ itad_id: "x" + i, title: "X" + i, appid: 10 + i, minutes: 0 }))];
    for (const [id, share] of [["a", 1], ["b", 1], ["c", 0]]) { db.ensureUser(id, "g1"); db.updateUser(id, { share }); db.syncSteamGames(id, g(id === "a" ? 5 : 2, 60)); }
    clock = Date.UTC(2026, 3, 1);
    db.syncSteamGames("a", g(5, 360)); db.syncSteamGames("b", g(2, 120)); db.syncSteamGames("c", g(2, 6000));
    const hours = extraBoard(db, "g1", "hours", clock);
    assert.deepEqual(hours.map(e => e.discord_id), ["a", "b"]);
    assert.equal(hours[0].label, "5 hours");
    for (const id of ["a", "b"]) db.upsertSnapshot(id, { games: id === "a" ? 6 : 3, paid: 0, msrp: 0, msrp_paid: 0, cheapest: 0 });
    assert.deepEqual(extraBoard(db, "g1", "games").map(e => [e.discord_id, e.score]), [["a", 6], ["b", 3]]);
    assert.deepEqual(extraBoard(db, "g1", "nope"), []);
});

test("bundles: games join the library with the price split, value and verdict are worked out, and it can be removed", async () => {
    const db = openDb(":memory:");
    db.ensureUser("u1", "g1");
    const itad = itadWith({ "id-alpha": { deals: [deal(20, 40)] }, "id-beta": { deals: [deal(30, 60)] } });
    await assert.rejects(addBundle(db, itad, "u1", { name: "X", paid: 5, titles: "OnlyOne" }), UserError);
    await assert.rejects(addBundle(db, itad, "u1", { name: "X", paid: -1, titles: "Alpha, Beta" }), UserError);
    const r = await addBundle(db, itad, "u1", { name: "Spring", paid: 10, titles: "Alpha, Beta, zzzMissing" });
    assert.equal(r.matched, 2); assert.deepEqual(r.notFound, ["zzzMissing"]); assert.equal(r.newGames, 2);
    assert.deepEqual(db.listLibrary("u1").map(l => l.paid), [5, 5]);
    const v = await bundleView(db, itad, db.getUser("u1"));
    assert.equal(v.bundles.length, 1);
    assert.equal(v.bundles[0].msrp, 100); assert.equal(v.bundles[0].perGame, 5);
    assert.match(v.bundles[0].verdict.text, /90% under/);
    assert.equal(db.removeBundle("u1", v.bundles[0].id), true);
    assert.equal(db.listBundles("u1").length, 0);
    assert.equal(verdictFor(120, 100).tone, "bad");
    // exports and deleting the account include/clean it
    await addBundle(db, itad, "u1", { name: "Again", paid: 8, titles: "Alpha, Beta" });
    assert.equal(db.exportUser("u1").bundles.length, 1);
});

test("minimum discount: validated, and sale alerts below it are held back without being marked as sent", async () => {
    assert.throws(() => prefsPatch({ min_discount: 95 }, {}), UserError);
    assert.throws(() => prefsPatch({ min_discount: 2.5 }, {}), UserError);
    assert.deepEqual(prefsPatch({ min_discount: 40 }, {}), { min_discount: 40 });
    const db = openDb(":memory:");
    const sent = [];
    const notifier = createNotifier({ db, discord: { sendDm: async (id, p) => { sent.push(id); }, sendChannel: async () => {} } });
    db.ensureUser("u1", "g1"); db.addItems("u1", [{ itad_id: "id-g", title: "G" }]);
    db.updateUser("u1", { min_discount: 50 });
    const cycle = async amount => runCycle({ db, itad: itadWith({ "id-g": { deals: [{ ...deal(amount, 100), cut: 100 - amount }] } }), notifier, log: () => {} });
    await cycle(80); assert.equal(sent.length, 0);   // 20% off: below the minimum
    await cycle(40); assert.equal(sent.length, 1);   // 60% off: alerts, and the earlier hold did not mark it as sent
});

test("year-in-review picture is a real PNG, only when Steam is linked and hours are tracked", async () => {
    const { renderRecap } = await import("../src/cardimg.js");
    let clock = Date.UTC(2026, 2, 10);
    const db = openDb(":memory:", { now: () => clock });
    db.ensureUser("u1", "g1");
    const fetchImpl = async () => { throw new Error("offline"); };
    assert.equal(await renderRecap({ db, userId: "u1", fetchImpl, now: clock }), null);          // not linked
    db.setSteamLink("u1", "76561198000000000");
    assert.equal(await renderRecap({ db, userId: "u1", fetchImpl, now: clock }), null);          // nothing tracked
    const g = m => [{ itad_id: "a", title: "A very long game title that has to be shortened to fit", appid: 1, minutes: m }];
    db.syncSteamGames("u1", g(60)); clock = Date.UTC(2026, 2, 12); db.syncSteamGames("u1", g(900));
    db.setHourGoal("u1", 100);
    const png = await renderRecap({ db, userId: "u1", name: "Jacob", fetchImpl, now: clock });
    assert.deepEqual([...png.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    assert.ok(png.length > 5000);
});

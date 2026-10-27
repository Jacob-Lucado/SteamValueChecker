import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createItad } from "../src/itad.js";
import { analyzeBundle, bundleCheck } from "../src/bundle.js";
import { fitBudget, salePrep, saleRecap } from "../src/saleprep.js";
import { bundleEmbeds, salePrepEmbed } from "../src/dealrender.js";

const json = (body) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });
const FUTURE = new Date(Date.now() + 5 * 86400_000).toISOString();

const bundle = {
    id: "b1", title: "Big Bundle", shop: "Humble", url: "https://humble.example/b", expiry: Date.parse(FUTURE), currency: "USD",
    tiers: [
        { price: 1, games: [{ id: "a", title: "A" }, { id: "b", title: "B" }] },
        { price: 10, games: [{ id: "c", title: "C" }, { id: "d", title: "D" }] }
    ]
};
const prices = { a: 10, b: 10, c: 20, d: 20 };

test("bundle tiers are cumulative, skip owned games and compare to today's prices", () => {
    const r = analyzeBundle(bundle, { owned: new Set(["a"]), wanted: new Set(["d"]), price: id => prices[id] ?? null });
    assert.equal(r.tiers[0].games, 2); assert.equal(r.tiers[0].newToYou, 1); assert.equal(r.tiers[0].worth, 10); assert.equal(r.tiers[0].saves, 9);
    assert.equal(r.tiers[1].games, 4); assert.equal(r.tiers[1].owned, 1); assert.equal(r.tiers[1].worth, 50); assert.deepEqual(r.tiers[1].wanted, ["D"]);
    assert.equal(r.verdict.level, "great");
});

test("a bundle that costs more than the games is not called good value", () => {
    const r = analyzeBundle({ ...bundle, tiers: [{ price: 30, games: [{ id: "a", title: "A" }, { id: "b", title: "B" }] }] }, { price: id => prices[id] });
    assert.equal(r.verdict.level, "wait");
    assert.equal(analyzeBundle(bundle, {}).verdict.level, "info");
});

test("bundle details come from one ITAD call, with expired bundles dropped and tiers sorted", async () => {
    const itad = createItad({
        apiKey: "K",
        fetchImpl: async () => json({ bundles: [
            { id: 1, title: "Live", page: { name: "Fanatical" }, expiry: FUTURE, url: "https://x.example", tiers: [
                { price: { amount: 9, currency: "USD" }, games: [{ id: "g2", title: "Two" }] },
                { price: { amount: 3, currency: "USD" }, games: [{ id: "g1", title: "One" }] }] },
            { id: 2, title: "Old", expiry: "2000-01-01T00:00:00Z", tiers: [{ price: { amount: 1, currency: "USD" }, games: [{ id: "g1", title: "One" }] }] },
            { id: 3, title: "Unrelated", tiers: [{ price: { amount: 1, currency: "USD" }, games: [{ id: "zz", title: "Z" }] }] }
        ] })
    });
    const out = await itad.getBundleDetails(["g1"], "US");
    assert.equal(out.length, 1);
    assert.equal(out[0].title, "Live"); assert.deepEqual(out[0].tiers.map(t => t.price), [3, 9]); assert.deepEqual(out[0].matches, ["g1"]);
});

function rig(extra = {}) {
    const db = openDb(":memory:");
    db.ensureUser("u1", "g1");
    const itad = {
        getBundleDetails: async () => [bundle],
        getPrices: async ids => new Map(ids.map(id => [id, { deals: prices[id] ? [{ shop: { name: "Steam" }, price: { amount: prices[id], currency: "USD" }, regular: { amount: prices[id] * 2, currency: "USD" }, cut: 50 }] : [] }])),
        ...extra
    };
    return { db, itad, user: db.getUser("u1") };
}

test("bundleCheck needs something to look for and knows what you own", async () => {
    const { db, itad, user } = rig();
    await assert.rejects(bundleCheck({ db, itad, user, gameIds: [] }), /wishlist/);
    db.upsertLibrary("u1", [{ itad_id: "a", title: "A", paid: 1 }]);
    const r = await bundleCheck({ db, itad, user, gameIds: ["a"] });
    assert.equal(r.bundles[0].tiers[0].owned, 1);
    const [embed] = bundleEmbeds(r);
    assert.equal(embed.title, "Big Bundle");
    assert.match(embed.footer.text, /leaves out games you own/);
});

test("budget fitting picks the best saving per dollar first", () => {
    const rows = [{ title: "Cheap", price: 5, regular: 10 }, { title: "Big", price: 40, regular: 80 }, { title: "Great", price: 2, regular: 20 }];
    const f = fitBudget(rows, 8);
    assert.deepEqual(f.picks.map(r => r.title), ["Great", "Cheap"]);
    assert.equal(f.spent, 7); assert.equal(f.left, 1);
});

test("sale prep sorts the wishlist into buy now and wait", async () => {
    const { db, itad, user } = rig({
        getPrices: async ids => new Map(ids.map(id => [id, id === "low"
            ? { deals: [{ shop: { name: "Steam" }, price: { amount: 5, currency: "USD" }, regular: { amount: 20, currency: "USD" }, cut: 75 }], historyLow: { all: { amount: 5, currency: "USD" } } }
            : { deals: [{ shop: { name: "Steam" }, price: { amount: 30, currency: "USD" }, regular: { amount: 40, currency: "USD" }, cut: 25 }], historyLow: { all: { amount: 10, currency: "USD" } } }]))
    });
    db.addItems("u1", [{ itad_id: "low", title: "At Low" }, { itad_id: "high", title: "Pricey" }]);
    const r = await salePrep({ db, itad, user, budget: 6, now: Date.UTC(2026, 10, 1) });
    assert.deepEqual(r.buyNow.map(x => x.title), ["At Low"]);
    assert.deepEqual(r.wait.map(x => x.title), ["Pricey"]);
    assert.equal(r.plan.picks[0].title, "At Low");
    assert.equal(r.sale.name, "Steam Winter Sale");
    const e = salePrepEmbed(r);
    assert.match(e.description, /Winter Sale/);
    await assert.rejects(salePrep({ db: openDb(":memory:").constructor ? (() => { const d = openDb(":memory:"); d.ensureUser("x"); return d; })() : db, itad, user: { discord_id: "x", region: "US" } }), /wishlist is empty/);
});

test("sale recap counts the drops your alerts caught in the window", () => {
    const { db } = rig();
    const now = Date.now();
    db.logAlert({ discord_id: "u1", itad_id: "a", title: "A", price: 5, regular: 20, shop: "Steam" });
    db.logAlert({ discord_id: "u1", itad_id: "b", title: "B", price: 8, regular: null, shop: "GOG" });
    db.logAlert({ discord_id: "u1", itad_id: "c", title: "Bundle", kind: "bundle", price: 3 });
    const r = saleRecap(db, "u1", { days: 14, now: now + 1000 });
    assert.equal(r.games, 2); assert.equal(r.spend, 13); assert.equal(r.saved, 15);
    assert.equal(saleRecap(db, "u1", { days: 1, now: now + 3 * 86400_000 }).alerts, 0);
});

test("regions: ranks a game's cheapest price across regions in US dollars, and degrades without exchange rates", async () => {
    const { regionPrices } = await import("../src/regions.js");
    const { createFx } = await import("../src/fx.js");
    const entry = (amount, currency) => ({ deals: [{ shop: { name: "Steam" }, price: { amount, currency }, regular: { amount: amount * 2, currency }, cut: 50, url: "https://s" }] });
    const itad = { getPrices: async (ids, country) => new Map([[ids[0], country === "US" ? entry(20, "USD") : country === "TR" ? entry(300, "TRY") : country === "IN" ? entry(1000, "INR") : null]]) };
    const fx = createFx({ fetchImpl: async () => ({ ok: true, json: async () => ({ rates: { TRY: 30, INR: 80 } }) }) });
    const rows = await regionPrices({ itad, fx, itadId: "g", home: "US" });
    assert.deepEqual(rows.map(r => r.region), ["TR", "IN", "US"]);
    assert.equal(rows.find(r => r.region === "US").home, true);
    assert.equal(Math.round(rows.find(r => r.region === "TR").usd), 10);
    const noFx = await regionPrices({ itad, fx: createFx({ fetchImpl: async () => { throw new Error("offline"); } }), itadId: "g", home: "US" });
    assert.equal(noFx.length, 3); assert.ok(noFx.every(r => r.usd === null || r.currency === "USD"), "only dollars convert without rates");
});

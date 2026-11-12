import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { withPriceLog, KEEP_DAYS } from "../src/pricelog.js";

const DAY = 86400_000;
const entry = (amount, regular = 20) => ({ deals: [{ shop: { id: 61, name: "Steam" }, price: { amount, currency: "USD" }, regular: { amount: regular, currency: "USD" }, cut: 0 }] });

test("looked-up prices are noted once a day, keeping the day's lowest", async () => {
    let t = 100 * DAY, price = 10;
    const db = openDb(":memory:", { now: () => t });
    const itad = withPriceLog({ getPrices: async ids => new Map(ids.map(id => [id, id === "none" ? null : entry(price)])), getHistory: async () => [] }, db);
    await itad.getPrices(["a", "none"], "US");
    price = 7; await itad.getPrices(["a"], "US");
    price = 9; await itad.getPrices(["a"], "US");
    t += DAY; price = 12; await itad.getPrices(["a"], "US");
    await itad.getPrices(["a"], "GB");
    assert.deepEqual(db.loggedHistory("a", "US", 0).map(p => [p.t / DAY, p.price, p.regular, p.shop]), [[100, 7, 20, "Steam"], [101, 12, 20, "Steam"]]);
    assert.deepEqual(db.loggedLow("a", "US"), { price: 7, shop: "Steam", at: 100 * DAY, since: 100 * DAY });
    assert.equal(db.loggedLow("none", "US"), null);
    assert.equal(db.loggedHistory("a", "GB", 0).length, 1);
});

test("history falls back to the bot's own notes when the price site fails or has nothing", async () => {
    const t = 500 * DAY;
    const db = openDb(":memory:", { now: () => t });
    let mode = "fail";
    const itad = withPriceLog({
        getPrices: async ids => new Map(ids.map(id => [id, entry(5)])),
        getHistory: async () => { if (mode === "fail") throw new Error("down"); return mode === "empty" ? [] : [{ t: 1, price: 3, regular: 20, shop: "GOG" }]; }
    }, db);
    await assert.rejects(itad.getHistory("a", "US"), /down/, "nothing noted yet, so the failure shows");
    await itad.getPrices(["a"], "US");
    assert.equal((await itad.getHistory("a", "US"))[0].price, 5);
    mode = "empty"; assert.equal((await itad.getHistory("a", "US")).length, 1);
    mode = "ok"; assert.equal((await itad.getHistory("a", "US"))[0].shop, "GOG", "the price site's own history wins when it has one");
});

test("old price notes are pruned after two years", () => {
    let t = 1000 * DAY;
    const db = openDb(":memory:", { now: () => t });
    db.logPrices("US", [{ id: "a", price: 5 }]);
    t += (KEEP_DAYS + 1) * DAY;
    db.logPrices("US", [{ id: "a", price: 6 }]);
    assert.equal(db.prunePricePoints(), 1);
    assert.deepEqual(db.loggedHistory("a", "US", 0).map(p => p.price), [6]);
});

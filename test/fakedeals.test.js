import { test } from "node:test";
import assert from "node:assert/strict";
import { looksInflated, dropInflated } from "../src/fakedeals.js";

const deal = (o = {}) => ({ id: "x", title: "Game", appid: 1, regular: 99.99, price: 4.99, cut: 95, ...o });

test("a high price cut to a few dollars looks inflated; an honest sale does not", () => {
    assert.equal(looksInflated(deal()), true);
    assert.equal(looksInflated(deal({ regular: 59.99, price: 29.99, cut: 50 })), false);
    assert.equal(looksInflated(deal({ regular: 19.99, price: 1.99, cut: 90 })), false);
});

test("suspicious deals stay only when the game has real reviews", async () => {
    const reviews = async id => ({ 1: null, 2: { total: 20 }, 3: { total: 5000 } })[id] ?? null;
    const out = await dropInflated([deal({ appid: 1 }), deal({ appid: 2 }), deal({ appid: 3 }), deal({ appid: 4, regular: 20, price: 10, cut: 50 }), deal({ appid: null })], reviews);
    assert.deepEqual(out.map(d => d.appid), [3, 4]);
});

import { splitGame } from "../src/bundlelanding.js";
import { renderDealLanding } from "../src/bundlelanding.js";
test("the weekly roundup page links every deal", () => {
    assert.deepEqual(splitGame("A: -50%, $5 || https://store.steampowered.com/app/1"), { text: "A: -50%, $5", link: "https://store.steampowered.com/app/1" });
    const html = renderDealLanding({ id: 37, kind: "deal", title: "Best deals", shop: "Steam", url: "https://x.test/feed", price: "Up to 50% off", games: ["A: -50%, $5 || https://store.steampowered.com/app/1", "B: -60%, $6 || https://store.steampowered.com/app/2"], expiry: null }, { origin: "https://x.test" });
    assert.match(html, /href="\/d\/37\/go\?i=0"[^>]*>A: -50%, \$5</);
    assert.match(html, /href="\/d\/37\/go\?i=1"/);
    assert.doesNotMatch(html, /Taking you to/);
});

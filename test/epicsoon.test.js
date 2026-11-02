import test from "node:test";
import assert from "node:assert/strict";
import { parseEpicSoon, createEpicSoon, epicLink, EPIC_PAGE } from "../src/epicsoon.js";
import { runEpicSoon } from "../src/poller.js";
import { epicSoonPayload } from "../src/render.js";
import { openDb } from "../src/db.js";
import { createLuna } from "../src/luna.js";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const offer = (start, end, pct = 0) => ({ startDate: start, endDate: end, discountSetting: { discountType: "PERCENTAGE", discountPercentage: pct } });
const el = (id, title, up, extra = {}) => ({ id, title, productSlug: title.toLowerCase().replace(/\W+/g, "-") + "/home", keyImages: [{ type: "OfferImageWide", url: "https://cdn.example/" + id + ".jpg" }], price: { totalPrice: { originalPrice: 2499, currencyCode: "USD", currencyInfo: { decimals: 2 } } }, promotions: { promotionalOffers: [], upcomingPromotionalOffers: up }, ...extra });
const feed = { data: { Catalog: { searchStore: { elements: [
    el("a1", "Flotsam", [{ promotionalOffers: [offer("2026-11-05T16:00:00.000Z", "2026-11-12T16:00:00.000Z")] }]),
    el("b2", "Far Away", [{ promotionalOffers: [offer("2026-12-10T16:00:00.000Z", "2026-12-17T16:00:00.000Z")] }]),
    el("c3", "Just A Sale", [{ promotionalOffers: [offer("2026-11-04T16:00:00.000Z", "2026-11-11T16:00:00.000Z", 50)] }]),
    el("d4", "Already Live", []),
    el("e5", "Mystery", [{ promotionalOffers: [offer("2026-11-03T16:00:00.000Z", "2026-11-10T16:00:00.000Z")] }], { productSlug: null, urlSlug: "0123456789abcdef0123456789abcdef" })
] } } } };

test("only free offers starting within eight days are kept, soonest first, with a page and art", () => {
    const out = parseEpicSoon(feed, NOW);
    assert.deepEqual(out.map(g => g.title), ["Mystery", "Flotsam"]);
    assert.equal(out[1].url, "https://store.epicgames.com/en-US/p/flotsam"); assert.equal(out[1].art, "https://cdn.example/a1.jpg");
    assert.deepEqual(out[1].regular, { amount: 24.99, currency: "USD" });
    assert.equal(out[0].url, EPIC_PAGE, "no readable slug: the free games page");
    assert.deepEqual(parseEpicSoon(null, NOW), []);
    assert.equal(epicLink({ productSlug: "javascript:x" }), EPIC_PAGE);
});

test("the feed is cached, and a failure keeps the last answer and is reported", async () => {
    let t = NOW, calls = 0, fail = false;
    const soon = createEpicSoon({ now: () => t, ttlMs: 1000, retryMs: 5000, fetchImpl: async () => { calls++; if (fail) return { ok: false, status: 503 }; return { ok: true, json: async () => feed }; } });
    assert.equal((await soon.list()).length, 2); await soon.list(); assert.equal(calls, 1);
    fail = true; t += 2000;
    assert.equal((await soon.list()).length, 2, "stale answer kept"); assert.equal(soon.health().lastError, "http503");
    t += 1000; await soon.list(); assert.equal(calls, 2, "waits before asking again");
});

test("the card shows when it starts, and the message has a button", () => {
    const p = epicSoonPayload(parseEpicSoon(feed, NOW));
    assert.match(p.content, /2 free games on Epic/); assert.equal(p.embeds.length, 2); assert.match(p.embeds[1].description, /becomes free to keep on <t:/);
    assert.equal(p.embeds[1].image.url, "https://cdn.example/a1.jpg"); assert.equal(p.components[0].components[0].url, "https://store.epicgames.com/en-US/free-games");
    assert.equal(epicSoonPayload([]), null);
});

test("members with free alerts and servers with the feed hear about next week once", async () => {
    const db = openDb(":memory:"); const sent = [], posted = [];
    db.ensureUser("u1", "g1"); db.updateUser("u1", { free: 1 }); db.ensureUser("u2", "g1");
    db.setGuildChannel("g1", "chan", "admin"); db.setFreeFeed("g1", true);
    const notifier = { deliver: async (u, p) => { sent.push([u.discord_id, p]); return { ok: true, via: "dm" }; }, postGuild: async (g, p) => { posted.push([g, p]); return true; } };
    const soon = { list: async () => parseEpicSoon(feed, NOW) };
    const s1 = await runEpicSoon({ db, soon, notifier, now: () => NOW });
    assert.equal(s1.delivered, 2); assert.deepEqual(sent.map(x => x[0]), ["u1"]); assert.equal(s1.guilds, 1); assert.equal(posted.length, 1);
    const s2 = await runEpicSoon({ db, soon, notifier, now: () => NOW });
    assert.equal(s2.found, 0); assert.equal(sent.length, 1, "told once"); assert.equal(posted.length, 1);
    assert.equal((await runEpicSoon({ db, soon: { list: async () => { throw new Error("x"); } }, notifier })).delivered, 0);
});

test("Luna reports whether it can be read", async () => {
    let fail = true;
    const luna = createLuna({ now: () => NOW, fetchData: async () => { if (fail) throw Object.assign(new Error("x"), { code: "boom" }); return { games: { items: [] } }; } });
    await luna.list(); await new Promise(r => setImmediate(r));
    assert.equal(luna.health().lastError, "boom"); assert.equal(luna.health().lastOkAt, null);
    assert.equal(createLuna({ enabled: false }).health().enabled, false);
});

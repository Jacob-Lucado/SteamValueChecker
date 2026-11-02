import test from "node:test";
import assert from "node:assert/strict";
import { parseLunaClaims, claimLink, createLuna, withLuna, LUNA_SHOP } from "../src/luna.js";
import { freeGamesPayload } from "../src/render.js";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const item = (slug, title, start, end, extra = {}) => ({
    id: `amzn1.pg.item.${slug}`, isFGWP: true, category: "FULL_GAME", isTeaserCard: false,
    assets: { title, externalClaimLink: `https://gaming.amazon.com/${slug.slice(0, 4)}-epic/dp/amzn1.pg.item.${slug}?ref_=x`, shortformDescription: "A game.", cardMedia: { defaultMedia: { src1x: "https://m.media-amazon.com/a.jpg", src2x: "https://m.media-amazon.com/b.jpg" } } },
    offers: [{ startTime: start, endTime: end }], ...extra
});
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const data = { games: { items: [
    item(A, "Alpha", "2026-10-29T17:00:00Z", "2026-12-02T18:00:00Z"),
    item(B, "Ended", "2026-09-01T17:00:00Z", "2026-10-01T18:00:00Z"),
    item("33333333-3333-4333-8333-333333333333", "Not yet", "2026-12-01T17:00:00Z", "2026-12-30T18:00:00Z"),
    item("44444444-4444-4444-8444-444444444444", "Teaser", "2026-10-29T17:00:00Z", "2026-12-02T18:00:00Z", { isTeaserCard: true }),
    item("55555555-5555-4555-8555-555555555555", "Loot", "2026-10-29T17:00:00Z", "2026-12-02T18:00:00Z", { category: "IN_GAME_LOOT" }),
    item(A, "Alpha again", "2026-10-29T17:00:00Z", "2026-12-02T18:00:00Z")
] } };

test("only full games that are open for claiming now are kept, once each, in the free-game shape", () => {
    const out = parseLunaClaims(data, NOW);
    assert.equal(out.length, 1);
    assert.deepEqual({ id: out[0].id, title: out[0].title, shop: out[0].shop, type: out[0].type, store: out[0].store, expiry: out[0].expiry }, { id: `luna:amzn1.pg.item.${A}`, title: "Alpha", shop: LUNA_SHOP, type: "game", store: "Epic Games Store", expiry: Date.parse("2026-12-02T18:00:00Z") });
    assert.equal(out[0].url, `https://luna.amazon.com/claims/1111-epic/dp/amzn1.pg.item.${A}`);
    assert.equal(out[0].art, "https://m.media-amazon.com/b.jpg");
    assert.deepEqual(parseLunaClaims(null, NOW), []); assert.deepEqual(parseLunaClaims({ games: { items: "x" } }, NOW), []);
});

test("claim links must be https amazon pages; the store comes from the address", () => {
    assert.equal(claimLink("https://gaming.amazon.com/doom-gog/dp/amzn1.pg.item.b095156c-1207-49f0-801a-75ac03b74def?ref_=1").store, "GOG");
    assert.equal(claimLink("javascript:alert(1)").url, null);
    assert.equal(claimLink("http://luna.amazon.com/claims/x").url, null);
    assert.equal(claimLink("https://evil.example/x/dp/amzn1.pg.item.b095156c-1207-49f0-801a-75ac03b74def").url.startsWith("https://luna.amazon.com/claims/"), true);
    assert.equal(claimLink("https://luna.amazon.com/somewhere").url, "https://luna.amazon.com/somewhere");
    assert.equal(claimLink("https://evil.example/somewhere").url, null);
});

test("the list is cached, a failure keeps the last good one, and retries wait", async () => {
    let t = NOW, calls = 0, fail = false;
    const luna = createLuna({ now: () => t, fetchData: async () => { calls++; if (fail) throw new Error("down"); return data; }, ttlMs: 1000, retryMs: 5000 });
    assert.equal((await luna.list()).length, 1); assert.equal((await luna.list()).length, 1); assert.equal(calls, 1);
    fail = true; t += 2000;
    assert.equal((await luna.list()).length, 1, "stale list still shown"); await new Promise(r => setImmediate(r)); assert.equal(calls, 2);
    t += 1000; await luna.list(); await new Promise(r => setImmediate(r)); assert.equal(calls, 2, "no retry inside the wait");
    t += 6000; fail = false; await luna.list(); await new Promise(r => setImmediate(r)); assert.equal(calls, 3);
    assert.deepEqual(await createLuna({ enabled: false, fetchData: async () => { throw new Error("no"); } }).list(), []);
    assert.deepEqual(await createLuna({ now: () => NOW, fetchData: async () => { throw new Error("no"); } }).list(), [], "never worked: empty, no throw");
});

test("Luna joins the giveaway list and never breaks it", async () => {
    const base = { getGiveawayList: async () => [{ id: "1", title: "Epic one", shop: "Epic", url: "https://e.example/1" }] };
    withLuna(base, { list: async () => parseLunaClaims(data, NOW) });
    assert.deepEqual((await base.getGiveawayList()).map(g => g.shop), ["Epic", LUNA_SHOP]);
    const broken = withLuna({ getGiveawayList: async () => [{ id: "1" }] }, { list: async () => { throw new Error("x"); } });
    assert.equal((await broken.getGiveawayList()).length, 1);
});

test("a Luna alert shows the art, where it's delivered and the claim button", () => {
    const g = parseLunaClaims(data, NOW);
    const p = freeGamesPayload(LUNA_SHOP, g);
    const e = p.embeds[0];
    assert.equal(e.image.url, "https://m.media-amazon.com/b.jpg"); assert.match(e.description, /Amazon Luna/); assert.match(e.description, /Delivered through Epic Games Store/);
    assert.match(e.footer.text, /Data from Amazon Luna/); assert.equal(p.components[0].components[0].url, g[0].url);
});

import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { pagedPayload, renderPage, handlePager, tokenOf } from "../src/pager.js";
import { alertPayload, extrasPayload, freeGamesPayload } from "../src/render.js";

const cards = n => Array.from({ length: n }, (_, i) => ({ embed: { title: `Card ${i + 1}`, description: "x" }, label: `Card ${i + 1}`, rows: [{ type: 1, components: [{ type: 2, style: 5, label: `Open ${i + 1}`, url: "https://example.com/" + i }] }] }));

test("several cards become one message with page buttons, and a lone card stays as it is", () => {
    const db = openDb(":memory:");
    const one = pagedPayload(db, { pages: cards(1) });
    assert.equal(one.embeds.length, 1); assert.equal(one.components[0].components[0].label, "Open 1");
    const p = pagedPayload(db, { content: "3 things", pages: cards(3) });
    assert.equal(p.embeds.length, 1); assert.equal(p.content, "3 things");
    const [nav, jump, own] = p.components;
    assert.deepEqual(nav.components.map(c => c.label), ["◀ Previous", "1 / 3", "Next ▶"]);
    assert.equal(nav.components[0].disabled, true);
    assert.equal(jump.components[0].options.length, 3);
    assert.equal(own.components[0].label, "Open 1");
    assert.ok(p.components.length <= 5);
    const two = pagedPayload(db, { pages: cards(2) });
    assert.equal(two.components.length, 2, "no jump menu for two cards");
});

test("the buttons flip pages, show that card's own buttons, and say so when the list has expired", async () => {
    const db = openDb(":memory:");
    const p = pagedPayload(db, { pages: cards(4) });
    const token = tokenOf({ components: p.components.map(r => ({ components: r.components.map(c => ({ customId: c.custom_id })) })) });
    assert.ok(token);
    const seen = [];
    const i = (id, values) => ({ customId: id, values, isStringSelectMenu: () => Boolean(values), update: async v => { seen.push(v); } });
    await handlePager(i(`pg:${token}:2`), db);
    assert.equal(seen[0].embeds[0].title, "Card 3");
    assert.equal(seen[0].components[0].components[1].label, "3 / 4");
    assert.equal(seen[0].components.at(-1).components[0].label, "Open 3");
    await handlePager(i(`pg_jump:${token}`, ["3"]), db);
    assert.equal(seen[1].embeds[0].title, "Card 4"); assert.equal(seen[1].components[0].components[2].disabled, true);
    await handlePager(i("pg:nope:1"), db);
    assert.deepEqual(seen[2], { components: [] });
    assert.equal(renderPage(token, db.getPager(token), 99).embeds[0].title, "Card 4", "out of range pages are held to the last one");
});

test("free games, wishlist alerts and bundle alerts each page one game at a time", () => {
    const db = openDb(":memory:");
    const games = [1, 2, 3].map(n => ({ id: String(n), title: `Game ${n}`, url: `https://store.example/${n}`, shop: "Epic Game Store", gameIds: ["id" + n], expiry: Date.now() + 86400_000 }));
    const f = freeGamesPayload("Epic Game Store", games, { pager: db });
    assert.equal(f.embeds.length, 1); assert.ok(f.embeds[0].image, "full-size art now that there is one card");
    assert.match(f.components.at(-1).components[0].label, /Claim all \(3\)/);
    const now = { price: 5, regular: 10, discount: 0.5, shop: "GOG", atl: 4, currency: "USD", url: "https://deal.example/x" };
    const hits = [1, 2].map(n => ({ item: { id: n, title: `Wish ${n}`, appid: 10 + n }, now, reason: "sale" }));
    const a = alertPayload(hits, { trigger: () => "any sale", verdict: () => ({ level: "good" }), pager: db });
    assert.equal(a.embeds.length, 1);
    assert.ok(a.components.some(r => r.components.some(c => /^alert_snooze/.test(c.custom_id ?? ""))), "snooze stays on each page");
    const e = extrasPayload([{ kind: "bundle", item: { title: "A" }, bundle: { title: "B", url: "https://b.example", tiers: [] } }, { kind: "giveaway", item: { title: "C" }, giveaway: { title: "D", url: "https://g.example" } }], { pager: db });
    assert.equal(e.embeds.length, 1);
    assert.equal(alertPayload(hits, { trigger: () => "any sale", verdict: () => ({ level: "good" }) }).embeds.length, 2, "without a store it still stacks");
});

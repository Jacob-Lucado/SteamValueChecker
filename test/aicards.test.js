import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { cardsPayload, handleAiButton, pickCard, AI_PREFIX } from "../src/aicards.js";
import { createAiTools } from "../src/aitools.js";

test("AI cards: embeds with art, link buttons and working action buttons", () => {
    const db = openDb(":memory:");
    const p = cardsPayload([{ title: "Hades", url: "https://store.steampowered.com/app/1145360/", linkLabel: "Steam page", image: "https://x.test/a.jpg", wish: "Hades", fields: [{ name: "Price", value: "$12" }, { name: "Empty", value: null }] }], { db, userId: "u1" });
    assert.equal(p.embeds.length, 1);
    assert.equal(p.embeds[0].image.url, "https://x.test/a.jpg");
    assert.equal(p.embeds[0].fields.length, 1, "empty fields dropped");
    const row = p.components[0].components;
    assert.equal(row[0].url, "https://store.steampowered.com/app/1145360/");
    assert.ok(row.some(b => b.custom_id?.startsWith(AI_PREFIX + "wish:")));
    assert.deepEqual(cardsPayload([], { db, userId: "u1" }), {});
});

test("AI cards: only the asker can press, and a stranger is told so", async () => {
    const db = openDb(":memory:");
    const p = cardsPayload([{ title: "Hades", url: "https://s.test/", wish: "Hades" }], { db, userId: "u1" });
    const id = p.components[0].components.find(b => b.custom_id).custom_id;
    let said;
    await handleAiButton({ customId: id, user: { id: "u2" }, reply: async o => { said = o.content; } }, { db, itad: {} });
    assert.match(said, /person who asked/);
});

test("AI cards: game_info pushes a card from Steam's store data", async () => {
    const db = openDb(":memory:");
    const fetchImpl = async url => ({ ok: true, json: async () => url.includes("storesearch") ? { items: [{ id: 1145360, type: "app", name: "Hades" }] } : { 1145360: { data: { name: "Hades", short_description: "Rogue &amp; like.", header_image: "https://cdn.test/h.jpg", genres: [{ description: "Action" }], release_date: { date: "17 Sep, 2020" }, price_overview: { final_formatted: "$12.49", discount_percent: 50 }, developers: ["Supergiant"] } } } });
    const tools = createAiTools({ db, itad: {}, fetchImpl });
    const ctx = { userId: "u1", cards: [] };
    const r = await tools.run("game_info", { title: "hades" }, ctx);
    assert.equal(r.name, "Hades");
    assert.equal(ctx.cards[0].image, "https://cdn.test/h.jpg");
    assert.equal(ctx.cards[0].description, "Rogue & like.");
    assert.equal(ctx.cards[0].url, "https://store.steampowered.com/app/1145360/");
});

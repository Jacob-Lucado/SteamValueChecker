import test from "node:test";
import assert from "node:assert/strict";

test("coop embed splits owners into players and people who haven't started", async () => {
    const { coopEmbed } = await import("../src/render.js");
    const e = coopEmbed("Hades II", [{ discord_id: "1", minutes: 600 }, { discord_id: "2", minutes: 0 }, { discord_id: "3", minutes: 10 }]);
    assert.match(e.description, /3 members own it/);
    assert.equal(e.fields[0].name, "Already playing (1)");
    assert.equal(e.fields[1].name, "Own it, haven't started (2)");
    assert.match(coopEmbed("X", []).description, /Nobody/);
});

test("the biggest alert card, with every extra line switched on, stays inside Discord's embed limits", async () => {
    const { alertEmbed } = await import("../src/render.js");
    const { factLines } = await import("../src/gamefacts.js");
    const facts = {
        players: 123456, hours: { main: 20, rushed: 10, complete: 100 }, critic: { score: 88, count: 40 },
        deck: "playable",
        store: { earlyAccess: true, controller: "full", vr: "only", modes: { coop: true, online: true, local: true, pvp: true, multi: true, remote: true }, langs: ["english"], langNote: "🌐 No Spanish text. Available: English, French, German, Italian and 20 more" }
    };
    const e = alertEmbed({ title: "A".repeat(150), priority: true }, { price: 1, regular: 60, discount: 0.98, currency: "USD", shop: "Humble Store", atl: 1, url: "https://example.com" },
        { trigger: "any sale", verdict: { level: "great", text: "Best price ever" }, insight: { spark: "▁▂▃▄▅▆▇█".repeat(5), text: "x".repeat(300) }, proton: "gold", reviews: { score: 95, total: 100000, label: "Overwhelmingly Positive" }, match: { pct: 90, matched: ["Action", "RPG"] }, facts });
    const total = (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.text.length ?? 0) + e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
    assert.ok(e.title.length <= 256, "title");
    assert.ok(e.description.length <= 4096, "description");
    assert.ok(e.fields.every(f => f.value.length <= 1024 && f.name.length <= 256), "fields");
    assert.ok(total <= 6000, `whole embed ${total}`);
    assert.ok(factLines(facts).length > 0);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGamerPower, cleanTitle, createGamerPower, withGamerPower } from "../src/gamerpower.js";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const row = o => ({ id: 1, title: "Highway Driving (Epic Games) Giveaway", type: "Game", status: "Active", platforms: "PC, Epic Games Store", end_date: "2026-11-08 23:59:00", open_giveaway_url: "https://www.gamerpower.com/open/x", image: "https://img/x.jpg", description: "A racing game.", ...o });

test("gamerpower: titles lose the store and giveaway wording", () => {
    assert.equal(cleanTitle("Highway Driving (Epic Games) Giveaway"), "Highway Driving");
    assert.equal(cleanTitle("Dominion Synergy Gift Pack Key Giveaway"), "Dominion Synergy Gift Pack");
    assert.equal(cleanTitle("Sorry We're Closed (Epic Games) Giveaway"), "Sorry We're Closed");
    assert.equal(cleanTitle("Letter Quest Remastered Steam"), "Letter Quest Remastered");
});

test("gamerpower: keeps live PC games, drops DLC, phone and console offers and ended ones", () => {
    const list = parseGamerPower([
        row(), row({ id: 2, type: "DLC" }), row({ id: 3, platforms: "iOS" }), row({ id: 4, platforms: "Xbox One" }),
        row({ id: 5, end_date: "2026-11-03 10:00:00" }), row({ id: 6, status: "Expired" }), row({ id: 7, end_date: "N/A", platforms: "PC, Steam", title: "Some Game Giveaway" }), row({ id: 8, open_giveaway_url: "http://x" }), row({ id: 10, title: "Foo Playtest Steam", platforms: "PC, Steam" }), row({ id: 11, platforms: "PC, itch.io" })
    ], NOW);
    assert.deepEqual(list.map(g => [g.id, g.title, g.shop]), [["gp:1", "Highway Driving", "Epic Games Store"], ["gp:7", "Some Game", "Steam"], ["gp:11", "Highway Driving", "itch.io"]]);
    assert.equal(list[0].expiry, Date.parse("2026-11-08T23:59:00Z"));
    assert.equal(list[1].expiry, null);
});

test("gamerpower: caches, survives a failure and merges without repeating a game", async () => {
    let calls = 0, fail = false, t = NOW;
    const gp = createGamerPower({ now: () => t, fetchImpl: async () => { calls++; if (fail) throw new Error("down"); return { ok: true, json: async () => [row(), row({ id: 9, title: "Other (Epic Games) Giveaway" })] }; } });
    assert.equal((await gp.list()).length, 2); await gp.list(); assert.equal(calls, 1);
    fail = true; t += 31 * 60_000;
    assert.equal((await gp.list()).length, 2, "keeps the last good list");
    assert.ok(gp.health().lastErrorAt);
    const itad = withGamerPower({ getGiveawayList: async () => [{ id: "i1", title: "Highway Driving", shop: "Epic Game Store" }, { id: "i2", title: "Highway Driving", shop: "Epic Games Store" }] }, gp);
    const merged = await itad.getGiveawayList();
    assert.deepEqual(merged.map(g => g.id), ["i1", "gp:9"]);
});

test("the same game from two sources shows once, with the store name tidied", async () => {
    const { tidyFree, tidyTitle } = await import("../src/gamerpower.js");
    assert.equal(tidyTitle("Sorry We're Closed - FREE on Epic Games"), "Sorry We're Closed");
    assert.equal(tidyTitle("Letter Quest: Grimm's Journey Remastered - FREE on Fanatical"), "Letter Quest: Grimm's Journey Remastered");
    assert.equal(tidyTitle("Gladiator: Blades of Fury free on EGS"), "Gladiator: Blades of Fury");
    assert.equal(tidyTitle("Free Guy: The Game"), "Free Guy: The Game", "a title that starts with Free is left alone");
    const out = tidyFree([
        { id: "a", title: "Sorry We're Closed - FREE on Epic Games", shop: "Epic Game Store", type: "game" },
        { id: "b", title: "Sorry We're Closed", shop: "Epic Games Store", type: "game" },
        { id: "c", title: "Letter Quest: Grimm's Journey Remastered", shop: "Steam", type: "game" },
        { id: "d", title: "Letter Quest: Grimm's Journey Remastered - FREE on Fanatical", shop: "Fanatical", type: "game" },
        { id: "e", title: "Hades", shop: "Steam", type: "game" }, { id: "f", title: "Hades", shop: "Steam", type: "dlc" }
    ]);
    assert.deepEqual(out.map(g => g.id), ["a", "c", "e", "f"]);
    assert.equal(out[0].title, "Sorry We're Closed"); assert.equal(out[0].shop, "Epic Games Store");
});

test("gamerpower: covers Humble, EA, itch.io and Prime Gaming offers too", () => {
    const list = parseGamerPower([
        row({ id: 21, platforms: "PC, Humble Store", title: "Humble Pick Giveaway" }),
        row({ id: 22, platforms: "PC, EA app", title: "Ea Pick Giveaway" }),
        row({ id: 23, platforms: "PC, itch.io", title: "Itch Pick Giveaway" }),
        row({ id: 24, platforms: "PC, Prime Gaming", title: "Prime Pick Giveaway" }),
        row({ id: 25, platforms: "Android, Amazon", title: "Phone Pick Giveaway" }),
    ], NOW);
    assert.deepEqual(list.map(g => g.shop), ["Humble Store", "EA app", "itch.io", "Prime Gaming"]);
});

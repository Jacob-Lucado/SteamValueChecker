import test from "node:test";
import assert from "node:assert/strict";
import { yourHours, hoursLine } from "../src/yourhours.js";

const fake = (hoursList, genres = ["RPG", "Indie"]) => {
    const lib = hoursList.map((h, i) => ({ appid: i + 1, minutes: Math.round(h * 60) }));
    return { listLibrary: () => lib, getAppTags: ids => new Map(ids.map(id => [id, { genres }])) };
};

test("needs a real library and enough similar games before it says anything", () => {
    assert.equal(yourHours(fake([1, 2, 3]), "u", { genres: ["RPG"] }), null, "too small a library");
    assert.equal(yourHours(fake([0, 0, 5, 9, 1, 2, 3, 4, 8, 7]), "u", { genres: ["Racing"] }), null, "no genre in common means nothing to compare");
    assert.equal(yourHours(fake([1, 2, 3, 4, 5, 6, 7, 8]), "u", { genres: ["Free To Play"] }), null, "ignored genres do not count");
});

test("forecast counts unplayed games and prices an hour of your own time", () => {
    const f = yourHours(fake([0, 0, 0, 0, 0, 20, 30, 10]), "u", { genres: ["RPG"] }, { price: 30 });
    assert.equal(f.n, 8); assert.equal(f.played, 3); assert.equal(f.playedPct, 38); assert.equal(f.median, 20);
    assert.equal(f.expected, 7.5); assert.equal(f.perHour, 4); assert.equal(f.risk, true);
    assert.match(hoursLine(f, n => `$${n}`), /played 3 of them \(median 20h\)\. Expect about 7\.5h, which is \$4 an hour\. ⚠️/);
});

test("a game that only gets a few hours reads as barely touched", () => {
    const f = yourHours(fake([0, 0, 0, 0, 0, 0, 0, 1]), "u", { genres: ["RPG"] }, { price: 20 });
    assert.equal(f.perHour, null); assert.match(hoursLine(f), /barely touch/);
});

test("the alert embed carries the forecast as its own field", async () => {
    const { alertEmbed } = await import("../src/render.js");
    const e = alertEmbed({ title: "Hades", itad_id: "x", region: "US" }, { price: 10, regular: 20, currency: "USD", cut: 50, shop: "Steam", url: "https://store.steampowered.com/app/1/", atl: null }, { hours: "You own 8 games like this." });
    assert.ok((e.fields ?? e.data?.fields ?? []).some(f => f.name === "⏱️ Your hours" && /own 8/.test(f.value)));
});

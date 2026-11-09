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

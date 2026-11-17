import test from "node:test";
import assert from "node:assert/strict";
import { readTags, createStoreMeta, earlyAccessLine, controllerLine } from "../src/storemeta.js";
import { configureFacts, gameFacts, factLines, withoutHidden } from "../src/gamefacts.js";
import { vrLine } from "../src/storemeta.js";
import { prefsPatch, hiddenFacts } from "../src/prefs.js";

const steam = (genres, cats) => ({ ok: true, status: 200, json: async () => ({ 620: { success: true, data: { genres: genres.map(description => ({ description })), categories: cats.map(description => ({ description })) } } }) });

test("store meta: Early Access and controller support are read from Steam's tags", () => {
    assert.deepEqual(readTags({ genres: ["Action", "Early Access"], cats: ["Single-player", "Full controller support"] }), { earlyAccess: true, controller: "full", vr: null });
    assert.deepEqual(readTags({ genres: ["RPG"], cats: ["Partial Controller Support"] }), { earlyAccess: false, controller: "partial", vr: null });
    assert.deepEqual(readTags({ genres: [], cats: [] }), { earlyAccess: false, controller: null, vr: null });
    assert.equal(readTags(null), null);
});

test("store meta: asked once a week per game, and a failure is silent", async () => {
    let calls = 0, t = 0;
    const m = createStoreMeta({ now: () => t, fetchImpl: async url => { calls++; assert.match(String(url), /appids=620&filters=genres,categories/); return steam(["Early Access"], []); } });
    assert.equal((await m.meta(620)).earlyAccess, true);
    await m.meta(620); assert.equal(calls, 1);
    t = 8 * 86400_000; await m.meta(620); assert.equal(calls, 2);
    assert.equal(await createStoreMeta({ fetchImpl: async () => { throw new Error("down"); } }).meta(620), null);
    assert.equal(await m.meta(-1), null);
});

test("store meta: shows up in the card facts and stays out when there is nothing to say", async () => {
    assert.match(earlyAccessLine({ earlyAccess: true }), /Early Access/); assert.equal(earlyAccessLine({ earlyAccess: false }), null);
    assert.equal(controllerLine({ controller: "full" }), "🎮 Full controller support"); assert.equal(controllerLine(null), null);
    configureFacts({ store: createStoreMeta({ fetchImpl: async () => steam(["Early Access"], ["Full controller support"]) }) });
    const f = await gameFacts(620);
    const lines = factLines(f);
    assert.ok(lines.some(l => /Early Access/.test(l)) && lines.some(l => /Full controller/.test(l)));
    configureFacts({ store: createStoreMeta({ fetchImpl: async () => steam(["Action"], ["Single-player"]) }) });
    assert.equal(await gameFacts(620), null);
    configureFacts(null);
});

test("VR support is read from the store tags", () => {
    assert.equal(readTags({ genres: [], cats: ["VR Supported"] }).vr, "supported");
    assert.equal(readTags({ genres: [], cats: ["VR Only"] }).vr, "only");
    assert.equal(readTags({ genres: [], cats: ["Single-player"] }).vr, null);
    assert.match(vrLine({ vr: "only" }), /needs a VR headset/); assert.equal(vrLine({ vr: "supported" }), "🥽 VR supported"); assert.equal(vrLine(null), null);
});

test("each person can switch the extra lines off", () => {
    const facts = { players: 5000, hours: { main: 10 }, critic: { score: 80, count: 9 }, store: { earlyAccess: true, controller: "full", vr: "supported" } };
    assert.equal(factLines(facts).length, 6);
    assert.equal(withoutHidden(facts, []), facts);
    assert.equal(factLines(withoutHidden(facts, ["vr", "early", "controller"])).length, 3);
    assert.equal(factLines(withoutHidden(facts, ["players", "critic", "time", "early", "controller", "vr"])).length, 0);
    assert.equal(facts.store.vr, "supported", "the shared facts are left alone");
    assert.deepEqual(hiddenFacts({ hide_facts: "vr,bogus,early" }), ["vr", "early"]);
    assert.deepEqual(prefsPatch({ hide_facts: ["vr", "vr", "players"] }, {}), { hide_facts: "vr,players" });
    assert.throws(() => prefsPatch({ hide_facts: ["nope"] }, {}), /You can hide/);
});

test("co-op and multiplayer modes read from the store categories", async () => {
    const { readTags, modesLine } = await import("../src/storemeta.js");
    const m = readTags({ genres: [], cats: ["Single-player", "Multi-player", "Online Co-op", "Shared/Split Screen Co-op", "Online PvP", "Remote Play Together"] });
    assert.equal(modesLine(m), "👥 Co-op (online, local), PvP, Remote Play Together");
    assert.equal(modesLine(readTags({ genres: [], cats: ["Single-player"] })), null);
    assert.equal(modesLine(readTags({ genres: [], cats: ["Multi-player"] })), "👥 Multiplayer");
    assert.equal(modesLine(readTags({ genres: [], cats: [] })), null);
});

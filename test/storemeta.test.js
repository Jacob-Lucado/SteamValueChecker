import test from "node:test";
import assert from "node:assert/strict";
import { readTags, createStoreMeta, earlyAccessLine, controllerLine } from "../src/storemeta.js";
import { configureFacts, gameFacts, factLines } from "../src/gamefacts.js";

const steam = (genres, cats) => ({ ok: true, status: 200, json: async () => ({ 620: { success: true, data: { genres: genres.map(description => ({ description })), categories: cats.map(description => ({ description })) } } }) });

test("store meta: Early Access and controller support are read from Steam's tags", () => {
    assert.deepEqual(readTags({ genres: ["Action", "Early Access"], cats: ["Single-player", "Full controller support"] }), { earlyAccess: true, controller: "full" });
    assert.deepEqual(readTags({ genres: ["RPG"], cats: ["Partial Controller Support"] }), { earlyAccess: false, controller: "partial" });
    assert.deepEqual(readTags({ genres: [], cats: [] }), { earlyAccess: false, controller: null });
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

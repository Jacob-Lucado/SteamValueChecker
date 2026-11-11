import { test } from "node:test";
import assert from "node:assert/strict";
import { fillArt, _forgetArt } from "../src/dealart.js";

const reply = items => async () => ({ ok: true, json: async () => ({ items }) });

test("a game without a Steam number gets one when Steam's search finds the same game", async () => {
    _forgetArt();
    const deals = [{ title: "Vampire: The Masquerade - Swansong PRIMOGEN Edition" }, { title: "Some Pack" }, { title: "Has One", appid: 5 }];
    await fillArt(deals, { fetchImpl: reply([{ type: "app", id: 1089980, name: "Vampire: The Masquerade - Swansong" }]) });
    assert.equal(deals[0].appid, 1089980);
    assert.equal(deals[1].appid, undefined, "a different game is not taken");
    assert.equal(deals[2].appid, 5);
});

test("a failed or empty search leaves the deal alone and never throws", async () => {
    _forgetArt();
    const d = [{ title: "Whatever" }];
    await fillArt(d, { fetchImpl: async () => { throw new Error("down"); } });
    await fillArt(d, { fetchImpl: async () => ({ ok: false }) });
    await fillArt(d, { fetchImpl: reply([{ type: "sub", id: 9, name: "Whatever" }]) });
    assert.equal(d[0].appid, undefined);
});

test("answers are remembered so the same title isn't searched twice", async () => {
    _forgetArt();
    let calls = 0;
    const f = async () => { calls++; return { ok: true, json: async () => ({ items: [{ type: "app", id: 7, name: "Same Game" }] }) }; };
    await fillArt([{ title: "Same Game" }], { fetchImpl: f }); await fillArt([{ title: "Same Game" }], { fetchImpl: f });
    assert.equal(calls, 1);
});

import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { parseDlc, fetchDlcList, refreshDlc, runDlcSales, dlcEmbed } from "../src/dlc.js";
import { prefsPatch } from "../src/prefs.js";

const DAY = 86400_000;
const T0 = Date.parse("2026-11-03T15:00:00Z");

test("dlc: the add-on list is read from Steam's details, and a game with none or an unknown game is handled", async () => {
    assert.deepEqual(parseDlc({ 10: { success: true, data: { dlc: [11, "12", "x", -3] } } }, 10), [11, 12]);
    assert.deepEqual(parseDlc({ 10: { success: true, data: {} } }, 10), []);
    assert.equal(parseDlc({ 10: { success: false } }, 10), null); assert.equal(parseDlc(null, 10), null);
    const f = async url => { assert.match(url, /appdetails\?appids=10&filters=basic/); return { ok: true, json: async () => ({ 10: { success: true, data: { dlc: [11] } } }) }; };
    assert.deepEqual(await fetchDlcList(10, f), [11]);
    await assert.rejects(fetchDlcList(10, async () => ({ ok: false, status: 429 })), /429/);
});

function world({ minutes = 600, dlcOn = 1 } = {}) {
    let t = T0;
    const db = openDb(":memory:", { now: () => t });
    db.ensureUser("u1", null); db.updateUser("u1", { dlc: dlcOn });
    db.syncSteamGames("u1", [{ itad_id: "base", title: "Big Game", appid: 10, minutes }, { itad_id: "other", title: "Barely Played", appid: 20, minutes: 30 }]);
    const price = { "itad-11": [30, 10], "itad-12": [8, 8] }; // [regular, now]
    const sent = [];
    const itad = {
        lookupShopIds: async (shop, ids) => { assert.equal(shop, 61); return new Map(ids.map(i => [i, `itad-${i.split("/")[1]}`])); },
        getPrices: async ids => new Map(ids.map(id => { const [reg, now] = price[id]; return [id, { deals: [{ shop: { name: "Steam" }, price: { amount: now, currency: "USD" }, regular: { amount: reg }, cut: Math.round((1 - now / reg) * 100), url: "https://store.steampowered.com/app/" + id }], historyLow: { all: { amount: 5 } } }]; })),
        getTitle: async id => ({ title: id === "itad-11" ? "Big Game: Expansion" : "Big Game: Skins" })
    };
    const notifier = { deliver: async (user, payload, type) => { sent.push({ user: user.discord_id, payload, type }); return { ok: true, via: "dm" }; } };
    return { db, itad, notifier, sent, price, advance: ms => { t += ms; }, now: () => t, run: () => runDlcSales({ db, itad, notifier, now: () => t }) };
}

test("dlc: only played games are asked about, slowly, and never twice within two weeks", async () => {
    const w = world();
    const asked = [];
    const f = async url => { const id = Number(/appids=(\d+)/.exec(url)[1]); asked.push(id); return { ok: true, json: async () => ({ [id]: { success: true, data: { dlc: [11, 12] } } }) }; };
    assert.deepEqual(w.db.appsNeedingDlc(), [10], "the game with 30 minutes is not worth it");
    assert.equal(await refreshDlc({ db: w.db, appids: w.db.appsNeedingDlc(), fetchImpl: f, delayMs: 0 }), 1);
    assert.deepEqual(w.db.appsNeedingDlc(), []); assert.deepEqual(w.db.ownedWithDlc("u1"), [{ appid: 10, title: "Big Game", dlc: [11, 12] }]);
    w.advance(15 * DAY); assert.deepEqual(w.db.appsNeedingDlc(), [10], "refreshed after two weeks");
    assert.equal(await refreshDlc({ db: w.db, appids: [10], fetchImpl: async () => { throw new Error("offline"); }, delayMs: 0 }), 0, "a failure stops quietly");
    w.db.updateUser("u1", { dlc: 0 }); assert.deepEqual(w.db.appsNeedingDlc(), [], "nobody asked for it");
});

test("dlc: a quiet first look, then a message when an add-on goes on a big sale, once per price", async () => {
    const w = world();
    w.db.saveAppDlc(10, [11, 12]);
    await w.run();
    assert.equal(w.sent.length, 0, "the 67% off add-on already on sale is remembered, not announced");
    w.advance(DAY); await w.run(); assert.equal(w.sent.length, 0, "and stays quiet");
    w.price["itad-12"] = [8, 4]; // the cheap one halves: a new sale
    w.advance(DAY); const r = await w.run();
    assert.equal(w.sent.length, 1); assert.equal(w.sent[0].type, "dlc"); assert.equal(r.delivered, 1);
    const e = w.sent[0].payload.embeds[0];
    assert.match(e.title, /Big Game: Skins is 50% off/); assert.match(e.description, /DLC for \*\*Big Game\*\*/); assert.match(e.description, /\$4\.00/);
    assert.equal(w.sent[0].payload.components.length, 1);
    w.advance(DAY); await w.run(); assert.equal(w.sent.length, 1, "told once");
    w.price["itad-12"] = [8, 3]; w.advance(DAY); await w.run(); assert.equal(w.sent.length, 2, "a deeper price is news again");
    assert.equal(w.db.listAlerts("u1", 5)[0].kind, "dlc");
});

test("dlc: not checked more than every six hours, small sales are ignored, and the member's own minimum counts", async () => {
    const w = world();
    w.db.saveAppDlc(10, [11, 12]);
    await w.run(); // first look
    w.price["itad-12"] = [8, 6]; // 25% off: not big
    w.advance(DAY); await w.run(); assert.equal(w.sent.length, 0);
    w.price["itad-11"] = [30, 15]; // 50% off, new price
    w.advance(2 * 3600_000); await w.run(); assert.equal(w.sent.length, 0, "checked two hours ago");
    w.db.updateUser("u1", { min_discount: 60 });
    w.advance(DAY); await w.run(); assert.equal(w.sent.length, 0, "50% is under their 60% minimum");
    w.db.updateUser("u1", { min_discount: 0 });
    w.advance(DAY); await w.run(); assert.equal(w.sent.length, 1);
});

test("dlc: the switch is a setting, and it can be muted like any alert", () => {
    assert.equal(prefsPatch({ dlc: true }, {}).dlc, 1); assert.equal(prefsPatch({ dlc: false }, {}).dlc, 0);
    assert.equal(prefsPatch({ muted: ["dlc"] }, {}).muted, "dlc");
});

test("dlc: the card says which game it is for and what it costs", () => {
    const e = dlcEmbed({ title: "Expansion", base: "Big Game", appid: 11, now: { price: 5, regular: 20, discount: 0.75, shop: "Steam", currency: "USD", atl: 4, url: "https://x.test/", expiry: null } });
    assert.match(e.title, /75% off/); assert.match(e.description, /you save \$15\.00/); assert.match(e.thumbnail.url, /apps\/11\//); assert.ok(e.fields.some(f => f.name === "All-time low"));
});

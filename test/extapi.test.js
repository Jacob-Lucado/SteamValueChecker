import test from "node:test";
import assert from "node:assert/strict";


test("gift board: offer, duplicate, claim, own listing, withdraw", async () => {
    const { openDb } = await import("../src/db.js");
    const { offerGift, claimGift, withdrawGift, listGifts } = await import("../src/extapi.js");
    const db = openDb(":memory:");
    const a = offerGift(db, "g1", "u1", "  Hades  ");
    assert.equal(a.gift.title, "Hades");
    assert.ok(offerGift(db, "g1", "u1", "hades").error, "same game twice");
    assert.ok(offerGift(db, "g1", "u1", "").error);
    assert.ok(claimGift(db, "g1", "u1", a.gift.id).error, "can't claim your own");
    assert.equal(claimGift(db, "g1", "u2", a.gift.id).gift.claimedBy, "u2");
    assert.ok(claimGift(db, "g1", "u3", a.gift.id).error, "already claimed");
    assert.ok(withdrawGift(db, "g1", "u2", a.gift.id).error, "only the lister withdraws");
    assert.equal(withdrawGift(db, "g1", "u1", a.gift.id).ok, true);
    assert.equal(listGifts(db, "g1").length, 0);
    for (let i = 0; i < 10; i++) offerGift(db, "g1", "u1", "G" + i);
    assert.ok(offerGift(db, "g1", "u1", "One more").error, "ten at a time");
});

test("claimable freebies: new free-to-play launches count, old always-free games and weekends don't", async () => {
    const { openDb } = await import("../src/db.js");
    const { badgeFor } = await import("../src/extapi.js");
    const db = openDb(":memory:"); db.ensureUser("u1");
    const mk = (id, extra) => ({ id, title: "G" + id, shop: "Steam", url: `https://store.steampowered.com/app/${id}/`, type: "game", ...extra });
    const appdetails = async url => { const id = /appids=(\d+)/.exec(url)[1]; const r = { 1: { is_free: false }, 2: { is_free: true, release_date: { date: new Date(Date.now() - 5 * 86400_000).toDateString() } }, 3: { is_free: true, release_date: { date: "Jan 1, 2015" } } }[id]; return { ok: true, json: async () => ({ [id]: { success: true, data: { type: "game", ...r } } }) }; };
    const out = await badgeFor({ db, itad: { getGiveawayList: async () => [mk(1), mk(2), mk(3), mk(4, { weekend: true })] }, userId: "u1", fetchImpl: appdetails });
    assert.deepEqual(out.claimable.map(c => c.appid), [1, 2]);
});

test("claimable freebies: demos are left out, and DLC only shows when its base game is known and owned", async () => {
    const { openDb } = await import("../src/db.js");
    const { badgeFor } = await import("../src/extapi.js");
    const db = openDb(":memory:"); db.ensureUser("u1");
    const mk = (id, extra) => ({ id, title: "G" + id, shop: "Steam", url: `https://store.steampowered.com/app/${id}/`, type: "game", ...extra });
    const kinds = { 7001: { type: "game", is_free: false }, 7002: { type: "demo", is_free: true }, 7003: { type: "dlc", is_free: false, fullgame: { appid: 900, name: "Base A" } }, 7004: { type: "dlc", is_free: false, fullgame: { appid: 901, name: "Base B" } }, 7005: { type: "dlc", is_free: false } };
    const fetchImpl = async url => { const id = /appids=(\d+)/.exec(url)[1]; return { ok: true, json: async () => ({ [id]: { success: true, data: kinds[id] } }) }; };
    const run = () => badgeFor({ db, itad: { getGiveawayList: async () => [7001, 7002, 7003, 7004, 7005].map(i => mk(i)).concat([mk(7006, { title: "Cool Game Demo" })]) }, userId: "u1", fetchImpl });
    // Nothing synced yet: DLC with a known base passes through for the extension to check, DLC with no base is dropped.
    assert.deepEqual((await run()).claimable.map(c => c.appid).sort(), [7001, 7003, 7004]);
    // Once the library is synced and owns only base A, DLC for base B is dropped.
    const synced = { ...db, listLibrary: () => [{ appid: 900 }] };
    const out = (await badgeFor({ db: synced, itad: { getGiveawayList: async () => [7003, 7004].map(i => mk(i)) }, userId: "u1", fetchImpl })).claimable;
    assert.deepEqual(out.map(c => c.appid), [7003]);
    assert.equal(out[0].base.appid, 900);
});

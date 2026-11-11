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

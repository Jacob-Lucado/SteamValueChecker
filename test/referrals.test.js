import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createReferrals, accountCreatedAt, MAX_REFERRALS, DAYS_EACH } from "../src/referrals.js";

// Discord IDs carry their creation time: (ms since 2015 << 22). These are accounts made a year ago and yesterday.
const idAt = ms => String((BigInt(ms - 1420070400000) << 22n));
const NOW = Date.UTC(2026, 10, 9, 18), OLD = i => idAt(NOW - 400 * 86400_000 + i * 1000), FRESH = idAt(NOW - 86400_000);

function setup() {
    const db = openDb(":memory:"), grants = [], dms = [];
    const supporters = { grant: async (id, days, pid, via, cents, o) => { grants.push({ id, days, pid, via, cents, o }); return { until: NOW + days * 86400_000 }; } };
    const r = createReferrals({ db, supporters, dm: async (id, p) => dms.push([id, p]), publicUrl: "https://steamvaluechecker.com/", now: () => NOW });
    return { db, r, grants, dms };
}

test("each person gets one stable code and link", () => {
    const { r } = setup();
    const a = r.codeFor("u1"); assert.match(a, /^[a-z0-9]{8}$/); assert.equal(r.codeFor("u1"), a); assert.notEqual(r.codeFor("u2"), a);
    assert.equal(r.ownerOf(a), "u1"); assert.equal(r.ownerOf("nope"), null); assert.equal(r.ownerOf("../../x"), null);
    assert.equal(r.stats("u1").link, `https://steamvaluechecker.com/r/${a}`);
    assert.ok(accountCreatedAt(OLD(0)) < NOW - 300 * 86400_000);
});

test("a new, old-enough account earns the sender days, quietly, and a DM says so", async () => {
    const { r, grants, dms } = setup(), code = r.codeFor("u1");
    const res = await r.onSignup({ userId: OLD(1), code, wasNew: true });
    assert.equal(res.counted, true); assert.equal(grants.length, 1); assert.equal(grants[0].id, "u1"); assert.equal(grants[0].days, DAYS_EACH); assert.equal(grants[0].o.silent, true); assert.equal(grants[0].via, "Referral");
    assert.equal(dms[0][0], "u1"); assert.match(dms[0][1].embeds[0].title, /friend joined/); assert.equal(r.stats("u1").joined, 1); assert.equal(r.stats("u1").daysEarned, DAYS_EACH);
});

test("it doesn't count yourself, existing users, brand-new Discord accounts, bad codes or the same person twice", async () => {
    const { r, grants } = setup(), code = r.codeFor("u1");
    assert.equal((await r.onSignup({ userId: "u1", code, wasNew: true })).skipped, "self");
    assert.equal((await r.onSignup({ userId: OLD(2), code, wasNew: false })).skipped, "not new");
    assert.equal((await r.onSignup({ userId: FRESH, code, wasNew: true })).skipped, "account too new");
    assert.equal((await r.onSignup({ userId: OLD(3), code: "zzzzzzzz", wasNew: true })).skipped, "no such code");
    assert.equal((await r.onSignup({ userId: OLD(3), code, wasNew: true })).counted, true);
    assert.equal((await r.onSignup({ userId: OLD(3), code, wasNew: true })).skipped, "already counted");
    assert.equal(grants.length, 1);
});

test("it stops paying out after the limit", async () => {
    const { r, grants } = setup(), code = r.codeFor("u1");
    for (let i = 0; i < MAX_REFERRALS + 3; i++) await r.onSignup({ userId: OLD(10 + i), code, wasNew: true });
    assert.equal(grants.length, MAX_REFERRALS); const s = r.stats("u1"); assert.equal(s.counted, MAX_REFERRALS); assert.equal(s.full, true); assert.equal(s.daysEarned, MAX_REFERRALS * DAYS_EACH);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { openDb } from "../src/db.js";
import { createSquare, PLANS } from "../src/square.js";
import { createSupporters, isSupporter, xpBoost, supporterUntil, SUPPORTER_ROLE } from "../src/supporters.js";

const KEY = "sig-key-123", HOOK = "https://svc.example/api/square/webhook";
const sign = body => createHmac("sha256", KEY).update(HOOK + body).digest("base64");
const mk = fetch => createSquare({ accessToken: "tok", locationId: "L1", signatureKey: KEY, webhookUrl: HOOK, fetch });
const reply = (status, json) => async () => ({ ok: status < 300, status, json: async () => json });

test("square: the webhook signature must match exactly", () => {
    const sq = mk(null), body = '{"type":"payment.updated"}';
    assert.equal(sq.verify(body, sign(body)), true);
    assert.equal(sq.verify(body + " ", sign(body)), false, "body changed");
    assert.equal(sq.verify(body, sign(body).replace(/.$/, "A")), false);
    assert.equal(sq.verify(body, ""), false);
    assert.equal(createSquare({ webhookUrl: HOOK }).enabled, false, "off without credentials");
});

test("square: checkout carries the Discord ID and pass in the order and returns Square's page", async () => {
    let seen;
    const sq = mk(async (url, opts) => { seen = { url, opts, body: JSON.parse(opts.body) }; return { ok: true, status: 200, json: async () => ({ payment_link: { url: "https://square.link/u/abc" } }) }; });
    const url = await sq.checkout({ userId: "123456789012345678", planId: "m3", redirectUrl: "https://svc.example/#/tip?thanks=1" });
    assert.equal(url, "https://square.link/u/abc");
    assert.match(seen.url, /connect\.squareup\.com\/v2\/online-checkout\/payment-links$/);
    assert.equal(seen.opts.headers.Authorization, "Bearer tok");
    assert.equal(seen.body.order.reference_id, "svc:123456789012345678:m3");
    assert.equal(seen.body.order.line_items[0].base_price_money.amount, 800);
    assert.equal(seen.body.order.location_id, "L1");
    await assert.rejects(() => sq.checkout({ userId: "123456789012345678", planId: "nope", redirectUrl: "x" }), /Pick one/);
    await assert.rejects(() => sq.checkout({ userId: "abc", planId: "m1", redirectUrl: "x" }), /Sign in/);
    await assert.rejects(() => mk(reply(400, { errors: [{ detail: "bad" }] })).checkout({ userId: "123456789012345678", planId: "m1", redirectUrl: "x" }), /Square said no/);
});

test("square: only a completed, correctly paid pass counts, and the order is read back from Square", async () => {
    const ev = (over = {}) => ({ type: "payment.updated", data: { object: { payment: { id: "P1", status: "COMPLETED", order_id: "O1", amount_money: { amount: 300, currency: "USD" }, ...over } } } });
    const order = (over = {}) => ({ order: { id: "O1", location_id: "L1", reference_id: "svc:123456789012345678:m1", ...over } });
    const run = async (event, o) => mk(reply(200, o ?? order())).paidPass(event);
    assert.deepEqual(await run(ev()), { userId: "123456789012345678", plan: PLANS[0], paymentId: "P1" });
    assert.equal(await run(ev({ status: "APPROVED" })), null, "not finished");
    assert.equal(await run(ev({ amount_money: { amount: 100, currency: "USD" } })), null, "paid too little");
    assert.equal(await run(ev({ amount_money: { amount: 300, currency: "EUR" } })), null);
    assert.equal(await run(ev(), order({ location_id: "other" })), null, "someone else's account");
    assert.equal(await run(ev(), order({ reference_id: "something else" })), null, "not a supporter order");
    assert.equal(await run({ type: "order.created" }), null);
    assert.equal(await run(null), null);
});

test("supporters: passes stack, a payment counts once, and the role comes and goes", async () => {
    const db = openDb(":memory:"); let t = 1_000_000;
    const added = [], removed = [];
    const role = { id: "r1", name: SUPPORTER_ROLE, position: 1 };
    const member = { roles: { cache: { has: id => added.length > removed.length && id === "r1" }, }, };
    member.roles.add = async r => { added.push(r.id); }; member.roles.remove = async r => { removed.push(r.id); };
    const g = { members: { me: { permissions: { has: () => true }, roles: { highest: { position: 10 } } }, fetch: async () => member }, roles: { fetch: async () => [role].map(x => x) } };
    g.roles.fetch = async () => Object.assign([role], { find: f => [role].find(f) });
    const sent = [];
    const sup = createSupporters({ db, client: { guilds: { cache: { get: () => g } } }, mainGuild: { detect: () => "G" }, dm: async (id, p) => sent.push(p), now: () => t });
    const a = await sup.grant("u1", 30, "pay1");
    assert.equal(isSupporter(db, "u1", t), true); assert.equal(xpBoost(db, "u1", t), 1.25); assert.equal(xpBoost(db, "u2", t), 1);
    assert.equal((await sup.grant("u1", 30, "pay1")).duplicate, true, "same payment twice");
    assert.equal(supporterUntil(db, "u1"), a.until);
    const b = await sup.grant("u1", 30, "pay2");
    assert.equal(b.until - a.until, 30 * 86_400_000, "a second pass adds to the first");
    assert.equal(sent.length, 2); assert.deepEqual(added, ["r1"], "the role is only added once");
    assert.equal(sup.list().length, 1);
    t = b.until + 1;
    assert.equal(isSupporter(db, "u1", t), false);
    assert.equal(await sup.sweep(), 1); assert.deepEqual(removed, ["r1"]);
    assert.equal(sup.list().length, 0);
    db.ensureUser("u9", "Nine"); await sup.grant("u9", 5, "pay9"); db.deleteUser("u9");
    assert.equal(supporterUntil(db, "u9"), 0, "deleting someone's data ends their pass record");
});

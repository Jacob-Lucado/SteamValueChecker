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
    assert.deepEqual(await run(ev()), { userId: "123456789012345678", plan: PLANS[0], paymentId: "P1", giftFrom: null });
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

test("supporters: refunds take the days back, reminders go out once, revenue skips refunds and gifts", async () => {
    const db = openDb(":memory:"); let t = 5_000_000;
    const sent = [];
    const sup = createSupporters({ db, client: { guilds: { cache: { get: () => null } } }, mainGuild: { detect: () => null }, dm: async (id, p) => sent.push([id, p]), renewUrl: "https://x.test/#/tip", now: () => t });
    await sup.grant("u1", 30, "p1", "Square", 500);
    await sup.grant("u2", 90, "p2", "Square", 1200);
    await sup.grant("u3", 30, "gift", "Admin", 0);
    const rv = sup.revenue(); assert.deepEqual({ total: rv.total, count: rv.count, last30: rv.last30, count30: rv.count30, refunded: rv.refunded, refunds: rv.refunds }, { total: 1700, count: 2, last30: 1700, count30: 2, refunded: 0, refunds: 0 });
    const before = supporterUntil(db, "u1");
    await sup.refund("p1", 100);
    assert.equal(supporterUntil(db, "u1"), before, "a partial refund changes nothing");
    await sup.refund("p1", 500);
    assert.equal(isSupporter(db, "u1", t), false, "a full refund ends the pass");
    await sup.refund("p1", 500);
    assert.equal(sup.revenue().total, 1200); assert.equal(sup.revenue().refunded, 500);
    t = supporterUntil(db, "u3") - 2 * 86_400_000;
    const n = sent.length; await sup.remind(); await sup.remind();
    assert.equal(sent.length - n, 1, "one reminder, not one per sweep");
});

test("supporters: gifts thank both people, the first 50 paying supporters are founders, the wall is opt-in, and the last day gets its own nudge", async () => {
    const { isFounder, FOUNDERS_MAX } = await import("../src/supporters.js");
    const db = openDb(":memory:"); let t = 9_000_000;
    const sent = [];
    const sup = createSupporters({ db, client: { guilds: { cache: { get: () => null } } }, mainGuild: { detect: () => null }, dm: async (id, p) => sent.push([id, p.embeds[0].title, p.embeds[0].description]), now: () => t });
    const g = await sup.grant("200000001", 30, "g1", "Square gift", 300, { giftFrom: "100000009" });
    assert.equal(g.founding, true); assert.equal(isFounder(db, "200000001"), true);
    assert.ok(sent.some(([id, , d]) => id === "200000001" && /gifted you/.test(d)), "the friend is told who it's from");
    assert.ok(sent.some(([id, title]) => id === "100000009" && /gift/i.test(title)), "the buyer gets a receipt DM");
    await sup.grant("200000002", 30, "free", "Owner", 0);
    assert.equal(isFounder(db, "200000002"), false, "a free pass isn't a founding one");
    for (let i = 0; i < FOUNDERS_MAX; i++) await sup.grant("3000000" + String(i).padStart(2, "0"), 30, "f" + i, "Square", 300);
    assert.equal(db.listMetaPrefix("supporterfounder:").length, FOUNDERS_MAX, "never more than 50");
    assert.deepEqual(sup.wall(), []);
    assert.equal(sup.setWall("200000001", "  <b>Sam</b> @everyone "), "Sam everyone", "mentions and markup are stripped");
    assert.equal(sup.wall().length, 1);
    sup.setWall("200000001", ""); assert.equal(sup.wall().length, 0, "clearing the name leaves the wall");
    t = supporterUntil(db, "200000001") - 2 * 86_400_000; sent.length = 0;
    await sup.remind(); assert.equal(sent.filter(([id]) => id === "200000001").length, 1);
    t += 86_400_000 + 1000; await sup.remind(); await sup.remind();
    assert.equal(sent.filter(([id, title]) => id === "200000001" && /Last day/.test(title)).length, 1, "one more on the last day, not one per sweep");
});

test("supporters: when the role can't be given, it says why, and re-sending fixes it once the cause is gone", async () => {
    const db = openDb(":memory:"); let canManage = false; const added = [];
    const role = { id: "r1", name: SUPPORTER_ROLE, position: 1 };
    const member = { roles: { cache: { has: () => false }, add: async r => added.push(r.id), remove: async () => {} } };
    const roles = Object.assign([role], { find: f => [role].find(f) });
    const g = { name: "Home", members: { me: { permissions: { has: () => canManage }, roles: { highest: { position: 10 } } }, fetch: async () => member }, roles: { fetch: async () => roles } };
    const logs = [];
    const sup = createSupporters({ db, client: { guilds: { cache: { get: () => g } } }, mainGuild: { detect: () => "G" }, log: t => logs.push(t) });
    assert.equal((await sup.grant("u1", 30, "p1")).role, "no-permission");
    assert.ok(logs.some(l => /not given: no-permission/.test(l)), "it's logged, not silent");
    assert.equal((await sup.homeStatus()).why, "no-permission");
    canManage = true;
    assert.equal((await sup.homeStatus()).ok, true);
    assert.deepEqual(await sup.resync(), { ok: 1, problems: {} }); assert.deepEqual(added, ["r1"]);
    const none = createSupporters({ db, client: { guilds: { cache: { get: () => null } } }, mainGuild: { detect: () => null } });
    assert.equal((await none.homeStatus()).why, "no-home-server");
});

test("supporters: the alert colour is a supporter perk, validated, and gone with the pass", async () => {
    const { alertColor, alertColorHex } = await import("../src/supporters.js");
    const db = openDb(":memory:"); const t = 1_000_000;
    const sup = createSupporters({ db, now: () => t });
    await sup.grant("u1", 30, "pay_c1"); // a hand-out, so no founding mark
    assert.equal(alertColor(db, "u1", t), null);
    assert.equal(sup.setAlertColor("u1", "#FF8800"), "#ff8800");
    assert.equal(alertColor(db, "u1", t), 0xff8800);
    assert.throws(() => sup.setAlertColor("u1", "red"), /colour/);
    assert.equal(alertColor(db, "u1", t + 400 * 86_400_000), null);
    assert.equal(alertColor(db, "u2", t), null);
    assert.equal(sup.setAlertColor("u1", ""), null);
    assert.equal(alertColor(db, "u1", t), null);
    assert.equal(alertColorHex(db, "u1"), null);
    await sup.grant("u3", 30, "pay_c3", "square", 500); // a paying founder keeps the perk after the pass ends
    sup.setAlertColor("u3", "#00ff00");
    assert.equal(alertColor(db, "u3", t + 400 * 86_400_000), 0x00ff00);
});

test("supporters: sales are grouped by month in Eastern time and founding spots are counted", async () => {
    const { foundersTaken } = await import("../src/supporters.js");
    const db = openDb(":memory:"); let t = Date.UTC(2026, 10, 9, 15);
    const sup = createSupporters({ db, now: () => t });
    await sup.grant("u1", 30, "m1", "square", 300);
    t = Date.UTC(2026, 11, 1, 3); // still November 30th in Eastern time
    await sup.grant("u2", 90, "m2", "square", 800, { giftFrom: "u1" });
    t = Date.UTC(2026, 11, 15);
    await sup.grant("u3", 30, "m3", "square", 300);
    const r = sup.revenue();
    assert.deepEqual(r.months.map(m => [m.month, m.count, m.cents]), [["2026-12", 1, 300], ["2026-11", 2, 1100]]);
    assert.equal(r.gifts, 1); assert.equal(r.founders, 3); assert.equal(foundersTaken(db), 3); assert.equal(r.foundersMax, 50);
});

test("the thank-you DM lists the perks, links to the tip page and profile, and tells outsiders how to get the role", async () => {
    const db = openDb(":memory:"); const t = 1_000_000, sent = [];
    db.ensureUser("300000001"); db.setProfile("300000001", { slug: "sam", isPublic: true });
    const g = { members: { me: { permissions: { has: () => true }, roles: { highest: { position: 9 } } }, fetch: async () => null }, roles: { fetch: async () => [{ name: "Supporter", position: 1, id: "r1" }] } };
    const sup = createSupporters({ db, client: { guilds: { cache: { get: () => g } } }, mainGuild: { detect: () => "G", inviteUrl: () => "https://discord.gg/abc" }, dm: async (id, p) => sent.push(p), renewUrl: "https://x.test/#/tip", publicUrl: "https://x.test", now: () => t });
    await sup.grant("300000001", 30, "thx1", "Square", 300);
    const p = sent[0], e = p.embeds[0], text = JSON.stringify(e);
    assert.match(e.title, /founding supporter/i);
    assert.ok(e.fields.some(f => f.name === "What you get" && /Supporter role/.test(f.value)));
    assert.match(text, /https:\/\/x\.test\/#\/tip/); assert.match(text, /https:\/\/x\.test\/u\/sam/);
    assert.match(text, /Join the server/, "not in the server, so they're told how to get the role");
    const urls = p.components[0].components.map(c => c.url);
    assert.deepEqual(urls, ["https://x.test/#/tip", "https://x.test/u/sam", "https://discord.gg/abc"]);
    assert.ok(e.fields.every(f => f.value.length <= 1024) && text.length < 3000);
});

test("reminders, gift receipts, vote thanks, idea updates and mod notices are all proper embeds", async () => {
    const { supporterReminder, giftSentEmbed, voteThanksEmbed, ideaStatusEmbed, modNoticeEmbed } = await import("../src/render.js");
    const all = [
        supporterReminder({ until: 5_000_000, lastDay: true, founder: true, tipUrl: "https://x.test/#/tip" }),
        giftSentEmbed({ to: "42", until: 5_000_000, tipUrl: "https://x.test/#/tip" }),
        voteThanksEmbed({ got: "You just got **+50 XP**.", expiresAt: 9_000_000, total: 3, voteUrl: "https://top.gg/bot/1/vote" }),
        ideaStatusEmbed({ title: "Dark mode", status: "shipped", label: "Shipped", note: "Out now", url: "https://x.test/#/requests" }),
        modNoticeEmbed({ verb: "timed out", server: "Test", reason: "spam", extra: " for 10 minutes" })
    ];
    for (const p of all) {
        const e = p.embeds[0];
        assert.ok(e.title && e.description !== undefined || e.fields?.length, "has a title and body");
        assert.ok(e.fields?.length >= 2, "laid out in fields");
        assert.ok(e.fields.every(f => f.name && f.value && f.value.length <= 1024));
    }
    assert.equal(all[0].components[0].components[0].url, "https://x.test/#/tip");
    assert.match(all[4].embeds[0].title, /timed out in Test/);
});

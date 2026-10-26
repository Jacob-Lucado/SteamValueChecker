import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createNotifier } from "../src/notify.js";
import { runCycle, schedule } from "../src/poller.js";
import { alertEmbed } from "../src/render.js";

const deal = (amount, regular, shop = "GOG") => ({ shop: { name: shop }, price: { amount, currency: "USD" }, regular: { amount: regular, currency: "USD" }, cut: 0, url: "https://deal.example/x" });

function setup({ dmFails = false, channelFails = false, prices } = {}) {
    const db = openDb(":memory:");
    const sent = [];
    const discord = {
        sendDm: async (id, p) => { if (dmFails) throw new Error("Cannot send messages to this user"); sent.push({ via: "dm", id, p }); },
        sendChannel: async (id, p) => { if (channelFails) throw new Error("Missing Access"); sent.push({ via: "channel", id, p }); }
    };
    const calls = [];
    const itad = {
        getPrices: async (ids, region) => { calls.push({ ids: [...ids], region }); return new Map(ids.map(id => [id, prices[id] ?? { deals: [] }])); }
    };
    return { db, sent, calls, itad, notifier: createNotifier({ db, discord }) };
}

const on = (db, user, ids, guild = "g1") => { db.ensureUser(user, guild); db.addItems(user, ids.map(id => ({ itad_id: id, title: `Title ${id}` }))); };

test("DM is the default, and the alert is remembered so it is not repeated", async () => {
    const t = setup({ prices: { a: { deals: [deal(10, 20)] } } });
    on(t.db, "u1", ["a"]);
    const s1 = await runCycle(t);
    assert.deepEqual([s1.alerts, s1.delivered, s1.failed], [1, 1, 0]);
    assert.equal(t.sent[0].via, "dm");
    assert.equal(t.sent[0].p.embeds[0].title, "Title a is on sale");
    const s2 = await runCycle(t);
    assert.equal(s2.alerts, 0);
    assert.equal(t.sent.length, 1);
});

test("price lookups are shared between users and batched per region", async () => {
    const t = setup({ prices: { a: { deals: [deal(10, 20)] } } });
    on(t.db, "u1", ["a"]); on(t.db, "u2", ["a"]);
    await runCycle(t);
    assert.equal(t.calls.length, 1);
    assert.deepEqual(t.calls[0].ids, ["a"]);
    assert.equal(t.sent.length, 2);
});

test("a closed DM falls back to the server channel with a mention", async () => {
    const t = setup({ dmFails: true, prices: { a: { deals: [deal(10, 20)] } } });
    on(t.db, "u1", ["a"]);
    t.db.setGuildChannel("g1", "chan", "admin");
    const s = await runCycle(t);
    assert.equal(s.delivered, 1);
    assert.equal(t.sent[0].via, "channel");
    assert.equal(t.sent[0].id, "chan");
    assert.match(t.sent[0].p.content, /^<@u1>/);
    assert.deepEqual(t.sent[0].p.allowedMentions, { users: ["u1"], parse: [] });
    assert.equal(t.db.getUser("u1").dm_failures, 1);
});

test("a member who opts for channel delivery gets no DM at all", async () => {
    const t = setup({ prices: { a: { deals: [deal(10, 20)] } } });
    on(t.db, "u1", ["a"]);
    t.db.updateUser("u1", { delivery: "channel" });
    t.db.setGuildChannel("g1", "chan", "admin");
    await runCycle(t);
    assert.deepEqual(t.sent.map(x => x.via), ["channel"]);
});

test("failed delivery is not marked as alerted, so it retries next run", async () => {
    const t = setup({ dmFails: true, prices: { a: { deals: [deal(10, 20)] } } });
    on(t.db, "u1", ["a"]); // no alert channel set
    const s1 = await runCycle(t);
    assert.deepEqual([s1.delivered, s1.failed], [0, 1]);
    assert.equal(t.db.listItems("u1")[0].last_alert_price, null);
    // DMs open up later
    const t2 = { ...t, notifier: createNotifier({ db: t.db, discord: { sendDm: async (id, p) => t.sent.push({ via: "dm", id, p }), sendChannel: async () => {} } }) };
    const s2 = await runCycle(t2);
    assert.equal(s2.delivered, 1);
});

test("channel delivery with a broken channel fails cleanly", async () => {
    const t = setup({ dmFails: true, channelFails: true, prices: { a: { deals: [deal(10, 20)] } } });
    on(t.db, "u1", ["a"]);
    t.db.setGuildChannel("g1", "chan", "admin");
    const s = await runCycle(t);
    assert.equal(s.failed, 1);
});

test("paused users get nothing; a further drop alerts again; a finished sale resets", async () => {
    const prices = { a: { deals: [deal(10, 20)] } };
    const t = setup({ prices });
    on(t.db, "u1", ["a"]);
    t.db.updateUser("u1", { paused: 1 });
    assert.equal((await runCycle(t)).alerts, 0);
    t.db.updateUser("u1", { paused: 0 });
    await runCycle(t);
    prices.a = { deals: [deal(7, 20)] };
    assert.equal((await runCycle(t)).alerts, 1);
    assert.equal(t.sent.at(-1).p.embeds[0].title, "Title a: price dropped again");
    prices.a = { deals: [deal(20, 20)] };
    await runCycle(t);
    assert.equal(t.db.listItems("u1")[0].last_alert_price, null);
    prices.a = { deals: [deal(10, 20)] };
    assert.equal((await runCycle(t)).alerts, 1);
});

test("many alerts for one person are grouped into few messages", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `g${i}`);
    const prices = Object.fromEntries(ids.map(id => [id, { deals: [deal(10, 20)] }]));
    const t = setup({ prices });
    on(t.db, "u1", ids);
    await runCycle(t);
    assert.deepEqual(t.sent.map(x => x.p.embeds.length), [10, 2]);
});

test("a failed price lookup leaves alerts for the next run", async () => {
    const t = setup({});
    on(t.db, "u1", ["a"]);
    t.itad.getPrices = async () => { throw Object.assign(new Error("x"), { code: "network" }); };
    const s = await runCycle(t);
    assert.equal(s.alerts, 0);
});

test("alert embed only links to https urls", () => {
    const now = { price: 5, regular: 10, discount: 0.5, shop: "GOG", atl: 4, currency: "USD", url: "javascript:alert(1)" };
    assert.equal(alertEmbed({ title: "X" }, now, { trigger: "any sale" }).url, undefined);
    assert.equal(alertEmbed({ title: "X" }, { ...now, url: "https://ok.example" }, { trigger: "any sale" }).url, "https://ok.example");
});

test("the scheduler never overlaps runs", async () => {
    let ticks, running = 0, max = 0, runs = 0;
    const stop = schedule(async () => { runs++; running++; max = Math.max(max, running); await new Promise(r => setTimeout(r, 20)); running--; }, 1000, {
        setIntervalImpl: fn => { ticks = fn; return {}; }, clearIntervalImpl: () => {}
    });
    ticks(); ticks();
    await new Promise(r => setTimeout(r, 60));
    assert.equal(max, 1);
    assert.equal(runs, 1);
    stop();
});

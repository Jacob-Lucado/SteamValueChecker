import test from "node:test";
import assert from "node:assert/strict";
import { whyNoAlert, whyEmbed } from "../src/whynot.js";

const NOW = Date.UTC(2026, 10, 22, 18, 0, 0);
const sale = (price, regular, extra = {}) => ({ best: { price, shop: "Steam" }, msrp: regular, atl: { price: 10 }.price, ...extra });
const user = (o = {}) => ({ paused: 0, region: "US", stores: "all", min_discount: 0, max_price: 0, lows_only: 0, delivery: "dm", dm_failures: 0, quiet_start: null, quiet_end: null, tz: "UTC", muted: "", ...o });
const item = (o = {}) => ({ trigger_type: "percent", trigger_value: 50, last_alert_price: null, priority: 0, snooze_until: null, ...o });
const run = (o = {}) => whyNoAlert({ user: user(o.user), item: item(o.item), summary: "summary" in o ? o.summary : sale(30, 60), owned: o.owned, store: o.store, now: NOW });

test("why no alert: a sale that meets the trigger and nothing else in the way would alert", () => {
    const r = run();
    assert.equal(r.verdict, "would");
    assert.ok(r.checks.every(c => c.ok));
});

test("why no alert: each blocker is named with the numbers that matter", () => {
    assert.match(run({ owned: true }).headline, /You own it/);
    assert.match(run({ user: { paused: 1 } }).headline, /paused/);
    assert.match(run({ item: { snooze_until: NOW + 3600_000 } }).headline, /snoozed until/);
    assert.match(run({ summary: null }).headline, /can't find a current price/);
    assert.match(run({ summary: sale(60, 60) }).headline, /isn't on sale/);
    assert.match(run({ summary: sale(45, 60) }).headline, /50% off or more, and it's 25% off/);
    assert.match(run({ item: { trigger_type: "price", trigger_value: 20 } }).headline, /at or under 20\.00, and it's 30\.00/);
    assert.match(run({ user: { min_discount: 60 }, item: { trigger_type: "any" } }).headline, /at least 60% off/);
    assert.match(run({ user: { max_price: 20 }, item: { trigger_type: "any" } }).headline, /price ceiling of 20\.00/);
    assert.match(run({ item: { last_alert_price: 29.9 } }).headline, /already told you about it at 29\.90/);
    assert.match(run({ user: { delivery: "dm", dm_failures: 4 } }).headline, /refused my last 4 direct messages/);
});

test("why no alert: a starred game ignores your filters, and quiet hours and VR/Early Access are explained", () => {
    assert.equal(run({ user: { min_discount: 90, max_price: 5, lows_only: 1 }, item: { trigger_type: "any", priority: 1 } }).verdict, "would");
    assert.match(run({ user: { min_discount: 90 }, item: { trigger_type: "any" } }).headline, /Starring a game lets it through/);
    const quiet = run({ user: { quiet_start: 17 * 60, quiet_end: 20 * 60 } });
    assert.match(quiet.headline, /quiet hours/);
    assert.equal(run({ user: { quiet_start: 17 * 60, quiet_end: 20 * 60 }, item: { priority: 1 } }).verdict, "would");
    assert.match(run({ user: { hide_facts: "alertvr" }, store: { vr: "only" } }).headline, /VR-only/);
    assert.match(run({ user: { hide_facts: "alertearly" }, store: { earlyAccess: true } }).headline, /Early Access/);
    assert.equal(run({ store: { vr: "only" } }).verdict, "would", "only when the member asked to skip them");
});

test("why no alert: the embed puts the reason first and marks every check", () => {
    const e = whyEmbed("Hades", run({ owned: true }));
    assert.match(e.description, /^\*\*Not sent: You own it/);
    assert.match(e.description, /❌ You own it/);
    assert.match(e.description, /✅ Your alerts are on/);
    assert.equal(whyEmbed("Hades", run()).color, 0x57f287);
});

test("/alerts why: answers privately with the reason for a game on the wishlist, and for one that isn't", async () => {
    const { openDb } = await import("../src/db.js");
    const { createHandlers } = await import("../src/handlers.js");
    const db = openDb(":memory:"); db.ensureUser("w1", null); db.ensureUser("w2", null); db.addItems("w1", [{ itad_id: "g1", title: "Hades" }]);
    db.updateUser("w1", { paused: 1 });
    const itad = { getPrices: async ids => new Map(ids.map(id => [id, { deals: [{ shop: { name: "Steam" }, price: { amount: 10, currency: "USD" }, regular: { amount: 20 }, cut: 50, url: "https://store.steampowered.com/app/1/" }], historyLow: { all: { amount: 5 } } }])) };
    const call = async (game, id = "w1") => {
        const out = { replies: [] };
        const i = Object.assign(out, { user: { id }, guildId: null, options: { getSubcommand: () => "why", getString: () => game }, deferReply: async () => {}, editReply: async p => { out.replies.push(p); }, reply: async p => { out.replies.push(p); } });
        await createHandlers({ db, itad }).handleAlerts(i);
        return out.replies.at(-1);
    };
    const r = await call("Hades");
    assert.match(r.embeds[0].title, /Why no alert for Hades/);
    assert.match(r.embeds[0].description, /Not sent: Your alerts are paused/);
    assert.match((await call("Nope", "w2")).content ?? "", /not on your list/);
    db.ensureUser("w3", null); db.addItems("w3", [{ itad_id: "g1", title: "Hades" }]);
    const all = await call(null, "w3");
    assert.equal(all.embeds[0].title, "Your alerts, right now");
    assert.ok(all.embeds[0].fields.some(f => /Would alert/.test(f.name) && /Hades/.test(f.value)));
});

test("alerts overview: every game on the list is sorted into 'would alert' or the rule holding it back", async () => {
    const { whyEverything, overviewEmbed } = await import("../src/whynot.js");
    const { openDb } = await import("../src/db.js");
    const db = openDb(":memory:"); db.ensureUser("o1", null);
    db.addItems("o1", [{ itad_id: "a", title: "On Sale" }, { itad_id: "b", title: "Not On Sale" }, { itad_id: "c", title: "Shallow Cut" }, { itad_id: "d", title: "Owned Game" }]);
    db.updateItem?.("o1", "c", { trigger_type: "percent", trigger_value: 70 });
    db.syncSteamGames?.("o1", [{ itad_id: "d", title: "Owned Game", appid: 9, minutes: 10, lastPlayed: null }]);
    const deal = (p, r) => ({ deals: [{ shop: { name: "Steam" }, price: { amount: p, currency: "USD" }, regular: { amount: r }, cut: Math.round((1 - p / r) * 100), url: "https://s" }], historyLow: { all: { amount: 1 } } });
    const itad = { getPrices: async ids => new Map(ids.map(id => [id, id === "b" ? { deals: [deal(20, 20).deals[0]] } : deal(10, 20)])) };
    const user = db.getUser("o1");
    const o = await whyEverything({ db, itad, user, now: Date.UTC(2026, 10, 22, 18) });
    assert.equal(o.total, 4);
    const by = Object.fromEntries(o.blocked.map(g => [g.code, g.titles]));
    assert.deepEqual(by.nosale, ["Not On Sale"]);
    assert.deepEqual(by.owned, ["Owned Game"]);
    assert.ok(o.would.includes("On Sale"));
    const e = overviewEmbed(o);
    assert.match(e.description, /all 4 games/);
    assert.ok(e.fields.some(f => /Would alert on the next run/.test(f.name)));
    assert.ok(e.fields.some(f => /not on sale right now/.test(f.name) && /Not On Sale/.test(f.value)));
    assert.match(overviewEmbed(await whyEverything({ db, itad, user: { ...user, discord_id: "nobody" } })).description, /list is empty/);
});

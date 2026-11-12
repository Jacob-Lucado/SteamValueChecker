import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { storeAppids, unfurlEmbed, createUnfurl } from "../src/unfurl.js";

const game = (over = {}) => ({ title: "Hades II", appid: 1145350, currency: "USD", price: 20, shop: "Steam", msrp: 30, low1y: 18, atl: 15, image: "https://cdn.example/h.jpg", advice: { verdict: "lean_buy", label: "Leaning buy", reasons: ["It is close to its 12-month low."] }, ...over });

test("store links are found once each, in order, and capped", () => {
    assert.deepEqual(storeAppids("look https://store.steampowered.com/app/1145350/Hades_II/ and http://store.steampowered.com/app/70/"), [1145350, 70]);
    assert.deepEqual(storeAppids("https://store.steampowered.com/app/10 https://store.steampowered.com/app/10/x"), [10]);
    assert.deepEqual(storeAppids("a https://store.steampowered.com/app/1 https://store.steampowered.com/app/2 https://store.steampowered.com/app/3"), [1, 2]);
    assert.deepEqual(storeAppids("https://example.com/app/55 and steam://run/10 and nothing"), []);
    assert.deepEqual(storeAppids(null), []);
});

test("the reply card shows the price, the lows and the verdict", () => {
    const e = unfurlEmbed(game(), { origin: "https://svc.test" }).toJSON();
    assert.equal(e.title, "Hades II");
    assert.equal(e.url, "https://svc.test/game/1145350-hades-ii");
    assert.match(e.description, /\$20\.00\*\* at Steam · \*\*33% off\*\*/);
    assert.match(e.description, /Regular \$30\.00/);
    assert.match(e.description, /12-month low \$18\.00/);
    assert.match(e.description, /All-time low \$15\.00/);
    assert.match(e.fields[0].name, /Leaning buy/);
    assert.equal(e.thumbnail.url, "https://cdn.example/h.jpg");
    const none = unfurlEmbed(game({ price: null, advice: null, msrp: null, low1y: null, atl: null })).toJSON();
    assert.match(none.description, /No current price/);
    assert.equal(none.fields, undefined);
});

function setup({ on = true, perms = true, data = game() } = {}) {
    let t = 1_000_000;
    const db = openDb(":memory:");
    if (on) db.setCommunity("g1", { unfurl_on: 1 });
    const loads = [];
    const u = createUnfurl({ db, itad: {}, now: () => t, load: async (_i, id) => { loads.push(id); return data && { ...data, appid: id }; } });
    const replies = [];
    const msg = (content, over = {}) => ({ guildId: "g1", channelId: "c1", content, author: { bot: false }, guild: { members: { me: {} } }, channel: { permissionsFor: () => ({ has: () => perms }) }, reply: async p => { replies.push(p); }, ...over });
    return { db, u, loads, replies, msg, tick: ms => { t += ms; } };
}

test("it replies when the server turned it on, and says nothing otherwise", async () => {
    const link = "https://store.steampowered.com/app/10/x";
    const a = setup(); assert.equal(await a.u.handle(a.msg(link)), true); assert.equal(a.replies.length, 1);
    assert.equal(a.replies[0].embeds.length, 1);
    assert.deepEqual(a.replies[0].allowedMentions, { parse: [], repliedUser: false });
    const off = setup({ on: false }); assert.equal(await off.u.handle(off.msg(link)), false); assert.equal(off.loads.length, 0);
    const noLink = setup(); assert.equal(await noLink.u.handle(noLink.msg("just chatting")), false);
    const bot = setup(); assert.equal(await bot.u.handle(bot.msg(link, { author: { bot: true } })), false);
    const dm = setup(); assert.equal(await dm.u.handle(dm.msg(link, { guildId: null })), false);
    const mute = setup({ perms: false }); assert.equal(await mute.u.handle(mute.msg(link)), false); assert.equal(mute.loads.length, 0, "no lookup when it could not answer anyway");
    const unknown = setup({ data: null }); assert.equal(await unknown.u.handle(unknown.msg(link)), false); assert.equal(unknown.replies.length, 0);
});

test("it does not repeat itself: a channel cooldown and ten minutes per game", async () => {
    const r = setup(), a = "https://store.steampowered.com/app/10", b = "https://store.steampowered.com/app/20";
    assert.equal(await r.u.handle(r.msg(a)), true);
    r.tick(2000); assert.equal(await r.u.handle(r.msg(b)), false, "same channel within 8 seconds");
    r.tick(9000); assert.equal(await r.u.handle(r.msg(a)), false, "same game again within ten minutes");
    assert.equal(await r.u.handle(r.msg(b)), true);
    r.tick(601_000); assert.equal(await r.u.handle(r.msg(a)), true, "after ten minutes it answers again");
    assert.equal(r.replies.length, 3);
});

test("a failed reply is noted for the server instead of thrown", async () => {
    const r = setup();
    const m = r.msg("https://store.steampowered.com/app/10", { reply: async () => { throw Object.assign(new Error("Missing Permissions"), { code: 50013 }); } });
    assert.equal(await r.u.handle(m), false);
    assert.ok(r.db.getMeta(`gprob:g1`), "the problem is saved for the Needs your attention panel");
});

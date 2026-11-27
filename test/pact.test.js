import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createPactService, pactEmbed, pactComponents } from "../src/pact.js";

const entry = (price, shop = "Steam", cur = "USD") => ({ id: "g1", deals: [{ shop: { name: shop }, price: { amount: price, currency: cur }, regular: { amount: 40, currency: cur }, cut: 0, url: "https://store.example/g1" }], historyLow: { all: { amount: 10, currency: cur } } });

function rig({ price = 30 } = {}) {
    const db = openDb(":memory:");
    const state = { price, posts: [], edits: [], t: 1_800_000_000_000 };
    const itad = { lookupTitles: async ([t]) => [t === "Nope" ? {} : { id: "g1", matched: t, exact: true }], getPrices: async ids => new Map(ids.map(id => [id, entry(state.price)])) };
    const discord = { post: async (ch, payload) => { state.posts.push({ ch, payload }); return { id: "m" + state.posts.length }; }, edit: async (ch, id, payload) => { state.edits.push({ ch, id, payload }); } };
    const svc = createPactService({ db, itad, discord, now: () => state.t });
    for (const u of ["a", "b", "c"]) db.ensureUser(u, "g");
    return { db, state, svc };
}
const start = (r, over = {}) => r.svc.create({ guildId: "g", channelId: "c1", creatorId: "a", title: "Helldivers 2", target: 20, ...over });

test("starting a pact posts it with a join button, and the host is in", async () => {
    const r = rig();
    const { pact, now } = await start(r);
    assert.equal(pact.title, "Helldivers 2"); assert.equal(pact.currency, "USD"); assert.equal(now.price, 30);
    assert.deepEqual(r.db.pactMembers(pact.id), ["a"]);
    assert.equal(r.state.posts.length, 1); assert.equal(r.db.getPact(pact.id).message_id, "m1");
    assert.match(r.state.posts[0].payload.embeds[0].title, /Buy pact: Helldivers 2/);
    assert.equal(r.state.posts[0].payload.components[0].components[0].custom_id, `pact_join:${pact.id}`);
});

test("bad pacts are refused with a reason a person can act on", async () => {
    const r = rig();
    await assert.rejects(start(r, { target: 0 }), /more than 0/);
    await assert.rejects(start(r, { target: 5000 }), /at most 1,000/);
    await assert.rejects(start(r, { minPlayers: 1 }), /between 2 and 20/);
    await assert.rejects(start(r, { title: "Nope" }), /could not find a game/);
    await assert.rejects(start(r, { target: 35 }), /already \$30\.00 at Steam.*Just buy it/);
    for (let i = 0; i < 3; i++) await start(r);
    await assert.rejects(start(r), /3 open pacts/);
});

test("joining and leaving update the post, and only the host or a manager can cancel", async () => {
    const r = rig();
    const { pact } = await start(r);
    assert.equal((await r.svc.join(pact.id, "b")).result, "joined"); assert.equal((await r.svc.join(pact.id, "b")).result, "already");
    assert.equal(r.state.edits.length, 1); assert.match(r.state.edits[0].payload.embeds[0].fields[2].name, /In \(2, 2 needed\)/);
    await r.svc.leave(pact.id, "b"); await assert.rejects(r.svc.leave(pact.id, "b"), /not in that pact/);
    await assert.rejects(r.svc.cancel(pact.id, "b"), /Only the person who started it/);
    await r.svc.cancel(pact.id, "b", { canManage: true });
    assert.equal(r.db.getPact(pact.id).status, "cancelled");
    await assert.rejects(r.svc.join(pact.id, "c"), /over/);
    assert.deepEqual(pactComponents({ id: 1, status: "cancelled" }), []);
});

test("when the price reaches the target, everyone who joined is pinged once and the pact is done", async () => {
    const r = rig();
    const { pact } = await start(r);
    await r.svc.join(pact.id, "b");
    assert.equal((await r.svc.tick()).reached, 0, "still $30");
    r.state.price = 19.99;
    const s = await r.svc.tick();
    assert.equal(s.reached, 1);
    const ping = r.state.posts.at(-1).payload;
    assert.equal(ping.content, "<@a> <@b>"); assert.deepEqual(ping.allowedMentions.users, ["a", "b"]);
    assert.match(ping.embeds[0].title, /Helldivers 2 is \$19\.99/); assert.match(ping.embeds[0].description, /under the \$20\.00 you agreed on, at \*\*Steam\*\*/);
    assert.equal(r.db.getPact(pact.id).status, "done"); assert.equal(r.db.getPact(pact.id).done_price, 19.99);
    assert.match(r.state.edits.at(-1).payload.embeds[0].title, /Pact reached/);
    assert.equal((await r.svc.tick()).reached, 0, "never announced twice");
});

test("a price drop with too few players only nudges the host once, and goes off when enough join", async () => {
    const r = rig();
    const { pact } = await start(r, { minPlayers: 3 });
    r.state.price = 15;
    assert.equal((await r.svc.tick()).nudged, 1); assert.match(r.state.posts.at(-1).payload.content, /only 1 of the 3 players are in/);
    assert.equal((await r.svc.tick()).nudged, 0, "one nudge is enough");
    await r.svc.join(pact.id, "b"); await r.svc.join(pact.id, "c");
    assert.equal((await r.svc.tick()).reached, 1);
});

test("pacts that never reach the price expire after 45 days", async () => {
    const r = rig();
    const { pact } = await start(r);
    r.state.t += 46 * 86400_000;
    assert.equal((await r.svc.tick()).expired, 1);
    assert.equal(r.db.getPact(pact.id).status, "expired"); assert.match(r.state.edits.at(-1).payload.embeds[0].title, /Pact expired/);
});

test("deleting a member's data removes them from pacts and cancels the ones they started", async () => {
    const r = rig();
    const { pact } = await start(r);
    await r.svc.join(pact.id, "b");
    r.db.forgetPactUser("a");
    assert.deepEqual(r.db.pactMembers(pact.id), ["b"]); assert.equal(r.db.getPact(pact.id).status, "cancelled");
    assert.match(pactEmbed(r.db.getPact(pact.id), ["b"]).title, /cancelled/);
});

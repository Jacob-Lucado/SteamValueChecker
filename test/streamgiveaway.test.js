import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createStreams } from "../src/streamlive.js";
import { createStreamGiveaways } from "../src/streamgiveaway.js";
import { streamCardLine } from "../src/streamcard.js";

function world() {
    const db = openDb(":memory:"), made = [], ended = [], sent = [];
    db.setCommunity("g", { live_channel: "live", ping_stream: "ping" });
    const gw = { create: async i => { made.push(i); const id = db.createGiveaway({ guild_id: i.guild_id, channel_id: i.channel_id, host_id: i.host_id, title: i.title, duration_ms: i.duration_ms, status: "active", ends_at: Date.now() + i.duration_ms, claim_hours: 24, bonus_entries: 1 }, []); return { id }; }, end: async (id, o) => { ended.push([id, o]); db.setGiveawayStatus(id, "ended"); } };
    const sg = createStreamGiveaways({ db, giveaways: () => gw });
    const api = { sendMessage: async (c, p) => { sent.push(c); return { id: "m" + sent.length }; }, editMessage: async () => {} };
    const streams = createStreams({ db, api, onEnd: (g, u) => sg.onEnd(g, u) });
    return { db, sg, streams, made, ended };
}

test("stream giveaway: needs a live stream, one at a time, and a sensible key", async () => {
    const w = world(), who = { id: "u1", name: "Mia" };
    await assert.rejects(() => w.sg.start("g", who, { game: "Hades", key: "AAAA-BBBB" }), /Go live first/);
    await w.streams.goLive("g", who, { title: "Hi", url: "https://twitch.tv/mia" });
    await assert.rejects(() => w.sg.start("g", who, { game: "", key: "AAAA-BBBB" }), /which game/);
    await assert.rejects(() => w.sg.start("g", who, { game: "Hades", key: "x" }), /game key/);
    const r = await w.sg.start("g", who, { game: "Hades", key: "AAAA-BBBB", minutes: 9999 });
    assert.equal(r.channelId, "live"); assert.equal(w.made[0].duration_ms, 720 * 60_000, "capped at twelve hours");
    assert.equal(w.made[0].host_id, "u1"); assert.match(w.made[0].title, /Mia's stream giveaway: Hades/);
    await assert.rejects(() => w.sg.start("g", who, { game: "Hades", key: "CCCC-DDDD" }), /already have/);
});

test("stream giveaway: ending the stream draws the winner, and ending it again changes nothing", async () => {
    const w = world(), who = { id: "u1", name: "Mia" };
    await w.streams.goLive("g", who, { title: "Hi", url: "https://twitch.tv/mia" });
    const { id } = await w.sg.start("g", who, { game: "Hades", key: "AAAA-BBBB" });
    await w.streams.endLive("g", who);
    assert.deepEqual(w.ended, [[id, { by: "u1" }]]);
    await w.sg.onEnd("g", "u1");
    assert.equal(w.ended.length, 1);
    await w.streams.goLive("g", who, { title: "Again", url: "https://twitch.tv/mia" });
    await w.sg.start("g", who, { game: "Celeste", key: "EEEE-FFFF" }); // a new one is allowed once the last is over
    assert.equal(w.made.length, 2);
});

test("stream giveaway: a failing giveaway never stops a stream from ending", async () => {
    const db = openDb(":memory:"); db.setCommunity("g", { live_channel: "live" });
    const sg = createStreamGiveaways({ db, giveaways: () => ({ create: async () => ({ id: 1 }), end: async () => { throw new Error("boom"); } }) });
    db.setMeta("streamgw:g:u1", "1");
    await sg.onEnd("g", "u1");
});

test("chat lines: game, deal, free and gift read like a sentence and stay short", () => {
    const cards = [{ kind: "game", title: "Elden Ring", hours: 142.5 }, { kind: "deal", title: "Hades", price: 10, regular: 20, discount: 50, currency: "USD", shop: "GOG" }];
    assert.equal(streamCardLine(cards, "game"), "Playing Elden Ring (142.5h played)");
    assert.equal(streamCardLine(cards, "deal"), "Hades is 50% off: $10.00 (was $20.00) at GOG");
    assert.equal(streamCardLine([], "free"), "No free games right now.");
    assert.equal(streamCardLine([], "gift"), "I don't have a public wishlist page yet.");
    assert.ok(streamCardLine([{ kind: "deal", title: "x".repeat(900), price: 1, discount: 5 }], "deal").length <= 300);
});

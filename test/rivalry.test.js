import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { lastMonth, winner, pairUp, rivalryEmbed, runRivalries } from "../src/rivalry.js";
import { dealFromEmbed, storySvg, renderStory } from "../src/dealstory.js";
import { alertEmbed, contextWishlistEmbed, alertPayload, STORY_ID } from "../src/render.js";

const NOV1 = Date.UTC(2026, 10, 1, 15);

function seed(clock) {
    const db = openDb(":memory:", { now: () => clock.t });
    const guilds = { g1: ["a", "b", "c"], g2: ["d", "e", "f"], g3: ["g", "h", "i"] };
    for (const [g, ids] of Object.entries(guilds)) {
        db.setGuildChannel(g, "c-" + g, "owner");
        for (const id of ids) { db.ensureUser(id, g); db.updateUser(id, { share: 1 }); }
    }
    return db;
}

test("last month is worked out in UTC, across a year boundary too", () => {
    assert.equal(lastMonth(NOV1).key, "2026-10"); assert.equal(lastMonth(NOV1).label, "October 2026");
    assert.equal(lastMonth(Date.UTC(2027, 0, 2)).key, "2026-12");
});

test("the rivalry goes to the server that finished more per member, and hours settle ties", () => {
    assert.equal(winner({ perMember: 2, members: 3, hours: 1 }, { perMember: 1, members: 3, hours: 99 }), "a");
    assert.equal(winner({ perMember: 1, members: 4, hours: 10 }, { perMember: 1, members: 4, hours: 20 }), "b");
    assert.equal(winner({ perMember: 1, members: 4, hours: 10 }, { perMember: 1, members: 4, hours: 10 }), "tie");
});

test("servers are paired by size and the odd one out waits", () => {
    const rows = ["x", "y", "z"].map((id, i) => ({ id, name: id, t: { members: 10 - i * 4 } }));
    const pairs = pairUp(rows);
    assert.equal(pairs.length, 1); assert.deepEqual(pairs[0].map(r => r.id), ["x", "y"]);
});

test("rivalries post once a month, only for opted-in servers with enough sharing members, and share only totals", async () => {
    const clock = { t: NOV1 };
    const db = seed(clock);
    db.setWeeklyDigest("g1", true); db.setWeeklyDigest("g2", true);
    const posts = [];
    const notifier = { postGuild: async (g, p) => { posts.push([g, p]); return true; } };
    const names = { g1: "Alpha", g2: "Beta", g3: "Gamma" };
    const run = () => runRivalries({ db, notifier, guildName: id => names[id], now: () => NOV1 });
    const first = await run();
    assert.equal(first.posted, 2, "each server in the pair gets its own post");
    assert.deepEqual(posts.map(p => p[0]).sort(), ["g1", "g2"]);
    assert.match(posts[0][1].embeds[0].title, /Alpha vs Beta|Beta vs Alpha/);
    assert.equal((await run()).posted, 0, "not twice in the same month");
    assert.equal((await runRivalries({ db, notifier, now: () => Date.UTC(2026, 10, 20) })).posted, 0, "only in the first days of the month");
    db.close();
});

test("a rivalry post shows totals from the viewer's side", () => {
    const e = rivalryEmbed({ name: "Alpha", t: { finished: 6, hours: 120, members: 4 } }, { name: "Beta", t: { finished: 2, hours: 80, members: 4 } }, "a", "October 2026");
    assert.match(e.description, /Alpha\*\* took the month/); assert.equal(e.fields.length, 2);
});

test("the share-this-deal button is on a single alert and the picture reads the alert back", async () => {
    const item = { id: 7, title: "Hades II", appid: 1, priority: false };
    const now = { price: 7.49, regular: 29.99, discount: 0.75, shop: "Steam", currency: "USD", atl: 7.49 };
    const payload = alertPayload([{ item, now, reason: "drop" }], { trigger: () => "any", verdict: () => null });
    assert.ok(payload.components.flatMap(r => r.components).some(c => c.custom_id === `${STORY_ID}:7`));
    const deal = dealFromEmbed(JSON.parse(JSON.stringify(payload.embeds[0])));
    assert.deepEqual({ game: deal.game, price: deal.price, pct: deal.pct, shop: deal.shop }, { game: "Hades II", price: "$7.49", pct: 75, shop: "Steam" });
    assert.match(storySvg(deal), /-75%/);
    const png = await renderStory(deal, { fetchImpl: async () => { throw new Error("no network in tests"); } });
    assert.equal(Buffer.from(png).subarray(1, 4).toString(), "PNG");
    assert.equal(dealFromEmbed({ title: "Something else", description: "no price" }), null);
});

test("the wishlist card lists what you both want", () => {
    const page = { games: [{ id: "1", title: "Celeste", price: 4.99, currency: "USD", discount: 75 }, { id: "2", title: "Hades", price: null }] };
    const e = contextWishlistEmbed("Sam", page, null, [page.games[0]]);
    assert.match(e.fields[0].name, /both want/); assert.match(e.fields[0].value, /Celeste/);
    assert.deepEqual(contextWishlistEmbed("Sam", page, null).fields, [], "nothing extra when there's no overlap");
});

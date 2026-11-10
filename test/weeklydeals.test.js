import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { pickDeals, weeklyXText, weeklyEmbed, createWeekly, roundupLink } from "../src/weeklydeals.js";
import { configureDeals } from "../src/deallinks.js";
import { xLength } from "../src/xposter.js";

const deal = (title, cut, regular, extra = {}) => ({ id: title, title, cut, price: +(regular * (1 - cut / 100)).toFixed(2), regular, currency: "USD", url: "https://store.steampowered.com/app/1/", appid: 1, ...extra });
const pool = [deal("Cheap Thing", 90, 5), deal("Big Game", 75, 60), deal("Meh Sale", 20, 60), deal("Mid Game", 60, 30), deal("Big Game", 75, 60), deal("Another", 55, 40), deal("Fourth", 80, 25), deal("Fifth", 50, 50), deal("Sixth", 66, 45), deal("No Link", 80, 60, { url: null })];

test("picks the biggest real savings, once per game, skipping cheap games and small cuts", () => {
    const p = pickDeals(pool);
    assert.equal(p.length, 5); assert.deepEqual(p.map(d => d.title), ["Big Game", "Sixth", "Fifth", "Fourth", "Another"]);
    assert.ok(!p.some(d => ["Cheap Thing", "Meh Sale", "No Link"].includes(d.title)));
    assert.equal(new Set(p.map(d => d.title)).size, 5);
    for (let i = 1; i < p.length; i++) assert.ok(p[i - 1].regular - p[i - 1].price >= p[i].regular - p[i].price);
});

test("X text fits, drops picks from the end when it has to, and the embed lists every pick", () => {
    const p = pickDeals(pool), t = weeklyXText(p, "https://steamvaluechecker.com/d/9", ["#Steam", "#PCGaming"]);
    assert.ok(xLength(t) <= 280); assert.match(t, /^🔥 This week's best Steam deals\n\n/); assert.match(t, /\n\nhttps:\/\/steamvaluechecker\.com\/d\/9\n\n#/);
    const long = pickDeals(Array.from({ length: 8 }, (_, i) => deal("A really quite long game title number " + i, 70 + i, 80 + i)));
    assert.ok(xLength(weeklyXText(long, "https://steamvaluechecker.com/d/9", ["#Steam"])) <= 280);
    const e = weeklyEmbed(p, { link: "https://steamvaluechecker.com/d/9", inviteUrl: "https://discord.com/oauth2/authorize?x=1" });
    assert.equal(e.embeds[0].url, "https://steamvaluechecker.com/d/9"); for (const d of p) assert.ok(e.embeds[0].description.includes(d.title));
    assert.equal(e.components[0].components.length, 2);
});

test("runs once a week on Friday at noon Eastern, posts to X and Discord, and never twice", async () => {
    const db = openDb(":memory:"), xs = [], ds = [];
    const itad = { getDealsPool: async () => pool };
    const xposter = { configured: () => true, status: () => ({ enabled: true }), tags: () => ["#Steam"], manual: async a => { xs.push(a); return { id: "t1" }; } };
    let at = Date.UTC(2026, 10, 13, 15); // Friday Nov 13 2026, 10am Eastern: too early
    const w = createWeekly({ db, itad, xposter, base: "https://steamvaluechecker.com", postDiscord: async (c, p) => ds.push([c, p]), now: () => at });
    configureDeals({ base: "https://steamvaluechecker.com", make: d => `https://steamvaluechecker.com/d/${db.upsertDeal(d)}` });
    try {
        assert.equal((await w.run()).skipped, "not due");
        db.setMeta("weekly:channel", "123456789012345678");
        at = Date.UTC(2026, 10, 13, 18); // 1pm Eastern
        const r = await w.run(); assert.equal(r.x, "t1"); assert.equal(r.discord, true);
        assert.match(xs[0].text, /steamvaluechecker\.com\/d\/\d+/); assert.equal(ds[0][0], "123456789012345678");
        assert.equal((await w.run()).skipped, "not due", "once is enough");
        at = Date.UTC(2026, 10, 14, 18); assert.equal((await w.run()).skipped, "not due", "Saturday");
        at = Date.UTC(2026, 10, 20, 18); assert.equal((await w.run()).picks, 5, "next Friday works");
        const st = await w.status(); assert.equal(st.picks.length, 5); assert.ok(st.last.at);
        w.set({ on: false }); at = Date.UTC(2026, 10, 27, 18); assert.equal((await w.run()).skipped, "not due", "switched off");
        assert.throws(() => w.set({ channel: "abc" }), /channel ID/);
    } finally { configureDeals(null); }
    assert.ok(roundupLink([], { base: "x" }) === null);
});

test("a thin week doesn't post", async () => {
    const db = openDb(":memory:"), w = createWeekly({ db, itad: { getDealsPool: async () => [deal("One", 80, 40)] }, now: () => Date.UTC(2026, 10, 13, 18) });
    assert.equal((await w.run()).skipped, "not enough good deals");
});

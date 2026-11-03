import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openDb } from "../src/db.js";
import { parseAbgFeed, abgKind, sameGame, decodeEntities, createAbgFeed, ABG_FEED } from "../src/abgfeed.js";
import { runPlaytests, abgEmbed } from "../src/playtests.js";
import { prefsPatch } from "../src/prefs.js";

const xml = readFileSync(new URL("./fixtures/abg-feed.xml", import.meta.url), "utf8");
const T0 = Date.parse("2026-11-03T15:00:00Z");

test("alpha beta gamer feed: a real sample is read into game, kind, link, picture and a short excerpt", () => {
    const items = parseAbgFeed(xml);
    assert.deepEqual(items.map(i => [i.game, i.kind]), [["Rock Band Simulator", "demo"], ["Sip Or Die", "beta"], ["Dominot", "signup"]]);
    const first = items[0];
    assert.equal(first.url, "https://www.alphabetagamer.com/rock-band-simulator-beta-demo/");
    assert.match(first.image, /^https:\/\/www\.alphabetagamer\.com\/wp-content\/uploads\//);
    assert.match(first.summary, /^Rock Band Simulator is a first-person rock band life sim/);
    assert.ok(first.summary.length <= 300); assert.doesNotMatch(first.summary, /<|Read More|first appeared/);
    assert.ok(items[0].date > items[1].date, "newest first");
    assert.deepEqual(parseAbgFeed("<rss><channel><item><title>x</title></item></channel></rss>"), [], "an item without a link or date is skipped");
    assert.deepEqual(parseAbgFeed(""), []);
});

test("alpha beta gamer feed: the site's typos, entities and name matching", () => {
    assert.equal(abgKind("Beta Dem0"), "demo"); assert.equal(abgKind("Beeta Sign Up"), "signup"); assert.equal(abgKind("Alpha Demo"), "alpha"); assert.equal(abgKind("Playtest"), "playtest"); assert.equal(abgKind("Open Beta"), "beta");
    assert.equal(decodeEntities("Fae &amp; Fauna &#8211; Beta &#x2019;s"), "Fae & Fauna – Beta ’s");
    assert.ok(sameGame("Hades II", "hades ii")); assert.ok(sameGame("Rock Band Simulator", "Rock Band Simulator: Tour Edition"));
    assert.equal(sameGame("Hook", "Hooky"), false); assert.equal(sameGame("", "x"), false); assert.equal(sameGame("Dark Roll", "Dark Roll 2"), false);
});

test("alpha beta gamer feed: cached for half an hour, the old list survives an outage", async () => {
    let t = 0, calls = 0, fail = false;
    const f = async url => { calls++; assert.equal(url, ABG_FEED); if (fail) return { ok: false, status: 503 }; return { ok: true, text: async () => xml }; };
    const feed = createAbgFeed({ fetchImpl: f, now: () => t });
    assert.equal((await feed.latest()).length, 3); await feed.latest(); assert.equal(calls, 1);
    t = 31 * 60_000; fail = true;
    assert.equal((await feed.latest()).length, 3, "served from the last good copy"); assert.equal(calls, 2);
    await assert.rejects(createAbgFeed({ fetchImpl: f, now: () => t }).latest(), /503/);
});

function world(mode) {
    const db = openDb(":memory:", { now: () => T0 });
    db.ensureUser("u1", "G"); db.updateUser("u1", { playtest: mode, share: 1 });
    db.addItems("u1", [{ itad_id: "d", title: "Dominot" }]);
    db.setGuildChannel("G", "chan", "u1");
    const items = parseAbgFeed(xml).map(i => ({ ...i, date: T0 - 3600_000 }));
    let list = items;
    const abg = { latest: async () => list };
    const sent = [], posted = [];
    const notifier = { deliver: async (u, p, kind) => { sent.push({ p, kind }); return { ok: true, via: "dm" }; }, postGuild: async (g, p, kind) => { posted.push({ g, p, kind }); return true; } };
    const news = { forApps: async () => new Map() };
    return { db, abg, notifier, news, sent, posted, add: extra => { list = [{ ...extra, date: T0 - 1000 }, ...items]; } };
}
const fresh = { id: "new1", game: "Brand New Game", type: "Beta Demo", kind: "demo", url: "https://www.alphabetagamer.com/brand-new/", summary: "A game.", image: null };
const wish = { id: "new2", game: "Dominot", type: "Beta Demo", kind: "demo", url: "https://www.alphabetagamer.com/dominot-demo/", summary: "A wishlist game.", image: null };

test("playtests from the site: 'wishlist' mode only tells about wishlist games, after a quiet first look", async () => {
    const w = world(1);
    const run = () => runPlaytests({ db: w.db, news: w.news, abg: w.abg, notifier: w.notifier, now: () => T0 });
    assert.equal((await run()).found, 0, "first look is quiet");
    w.add(fresh); assert.equal((await run()).found, 0, "a game that is not on the wishlist is not sent");
    w.add(wish);
    const s = await run();
    assert.equal(s.delivered, 1); assert.match(w.sent[0].p.embeds[0].title, /Beta demo: Dominot/); assert.match(w.sent[0].p.embeds[0].footer.text, /Alpha Beta Gamer/);
    assert.equal(w.sent[0].p.components[0].components[0].url, "https://www.alphabetagamer.com/dominot-demo/");
    assert.equal((await run()).found, 0, "not twice");
});

test("playtests from the site: 'every playtest' mode sends new ones that are not on the wishlist, quietly at first", async () => {
    const w = world(2);
    const run = () => runPlaytests({ db: w.db, news: w.news, abg: w.abg, notifier: w.notifier, now: () => T0 });
    assert.equal((await run()).delivered, 0, "the 3 already listed are not dumped on a new subscriber");
    w.add(fresh);
    const s = await run();
    assert.equal(s.delivered, 1); assert.match(w.sent[0].p.embeds[0].title, /Brand New Game/);
    // moving from "wishlist" to "every" later is quiet too
    const v = world(1);
    const runV = () => runPlaytests({ db: v.db, news: v.news, abg: v.abg, notifier: v.notifier, now: () => T0 });
    await runV(); v.add(fresh); await runV(); v.db.updateUser("u1", { playtest: 2 });
    assert.equal((await runV()).delivered, 0, "what was already listed stays quiet after switching");
});

test("playtests from the site: a server posts only watched games, or every playtest when it asks for that, with the role", async () => {
    const w = world(0); w.db.setCommunity("G", { ping_playtest: "ROLE" });
    const run = () => runPlaytests({ db: w.db, news: w.news, abg: w.abg, notifier: w.notifier, now: () => T0 });
    w.db.setAppId("u1", "d", 5);
    await run(); // quiet first look
    w.add(fresh); await run(); assert.equal(w.posted.length, 0, "not watched, not posted");
    w.add(wish); await run();
    assert.equal(w.posted.length, 1); assert.match(w.posted[0].p.embeds[0].title, /Dominot/); assert.match(w.posted[0].p.embeds[0].footer.text, /1 member here has this on a wishlist/); assert.equal(w.posted[0].kind, "playtest");
    w.db.setCommunity("G", { playtest_all: 1 });
    w.add({ ...fresh, id: "new3", game: "Another Fresh One" });
    await run(); // switching on "every" is quiet for what was already there
    assert.equal(w.posted.length, 1);
    w.add({ ...fresh, id: "new4", game: "Even Fresher" }); await run();
    assert.equal(w.posted.length, 2); assert.match(w.posted[1].p.embeds[0].title, /Even Fresher/);
    assert.ok(!JSON.stringify(w.posted).includes("u1"), "no member is named");
});

test("playtests from the site: a site outage doesn't stop Steam announcements, and the mode is a number", async () => {
    const w = world(1); const abg = { latest: async () => { throw new Error("down"); } };
    await runPlaytests({ db: w.db, news: w.news, abg, notifier: w.notifier, now: () => T0 });
    assert.equal(abgEmbed({ game: "G", kind: "signup", url: "https://x.test/", date: T0, summary: "" }).title, "🧪 Beta sign-up: G");
    assert.deepEqual([prefsPatch({ playtest: 2 }, {}), prefsPatch({ playtest: true }, {}), prefsPatch({ playtest: 9 }, {}), prefsPatch({ playtest: "x" }, {})], [{ playtest: 2 }, { playtest: 1 }, { playtest: 2 }, { playtest: 0 }]);
});

test("playtests: a server with a playtest channel gets the posts there, with the role mentioned", async () => {
    const w = world(0);
    w.db.setCommunity("G", { ping_playtest: "ROLE", playtest_channel: "PT", playtest_all: 1 });
    const channelPosts = [];
    const notifier = { ...w.notifier, postChannel: async (c, p, role) => { channelPosts.push({ c, p, role }); return true; } };
    const run = () => runPlaytests({ db: w.db, news: w.news, abg: w.abg, notifier, now: () => T0 });
    await run(); w.add(fresh); await run();
    assert.equal(channelPosts.length, 1); assert.equal(channelPosts[0].c, "PT"); assert.equal(channelPosts[0].role, "ROLE");
    assert.equal(w.posted.length, 0, "not also sent to the alert channel");
    // a channel with no role still works, and needs no alert channel
    const v = world(0); v.db.setCommunity("G", { playtest_channel: "PT2", playtest_all: 1 });
    const cp = [];
    const n2 = { ...v.notifier, postChannel: async (c, p, role) => { cp.push({ c, role }); return true; } };
    const runV = () => runPlaytests({ db: v.db, news: v.news, abg: v.abg, notifier: n2, now: () => T0 });
    await runV(); v.add(fresh); await runV();
    assert.deepEqual(cp, [{ c: "PT2", role: null }]);
});

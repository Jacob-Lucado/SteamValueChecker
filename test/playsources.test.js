import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openDb } from "../src/db.js";
import { cleanGame, kindFromText, kindGroup, parseGamerPower, parseItch, parsePlaytester, parseSteamDemos, dedupeItems, gameKeys, createPlaytestSources } from "../src/playsources.js";
import { runPlaytests, refreshPlaytestChannel, abgEmbed } from "../src/playtests.js";
import { playtestBoard } from "../src/playboard.js";

const F = n => readFileSync(new URL("./fixtures/" + n, import.meta.url), "utf8");
const T0 = Date.parse("2026-11-03T15:00:00Z");

test("sources: a real GamerPower sample, itch.io feed and Steam demo list are read into one shape", () => {
    const gp = parseGamerPower(F("gamerpower-beta.json"), { now: T0 });
    assert.deepEqual(gp.map(x => [x.game, x.kind]), [["Fathom Reach", "playtest"], ["Scallywags", "playtest"], ["Chop Shop", "playtest"], ["DungeonLoot", "beta"], ["Zero King", "beta"]], "the mobile app listing is not a playtest");
    assert.ok(gp.every(x => x.id.startsWith("gp:") && /^https:\/\//.test(x.url) && x.sourceName === "GamerPower"));
    assert.equal(parseGamerPower(F("gamerpower-beta.json"), { now: Date.parse("2026-12-01T00:00:00Z") }).some(x => x.game === "Fathom Reach"), false, "an ended listing is dropped");
    const itch = parseItch(F("itch-playtest.xml"));
    assert.equal(itch.length, 8);
    assert.equal(itch[0].game, "Beacon: Duel"); assert.equal(itch[0].kind, "playtest"); assert.match(itch[0].url, /^https:\/\/.+\.itch\.io\//);
    assert.ok(itch.every((x, i) => i === 0 || itch[i - 1].date >= x.date), "newest first");
    const demos = parseSteamDemos(F("steam-demos.json"));
    assert.equal(demos.length, 8);
    assert.equal(demos[0].game, "Reperta"); assert.equal(demos[0].appid, 5493090, "the full game's id, not the demo's"); assert.equal(demos[0].wishlistOnly, true); assert.equal(demos[0].label, "Demo");
    assert.deepEqual([parseGamerPower("nope"), parseGamerPower("{}"), parseItch(""), parseSteamDemos("x"), parseSteamDemos({})], [[], [], [], [], []]);
});

test("sources: game names are cleaned of the kind of test", () => {
    assert.equal(cleanGame("Zero King (Beta) Steam Key Giveaway"), "Zero King");
    assert.equal(cleanGame("Chop Shop Playtest (Steam) Key Giveaway"), "Chop Shop");
    assert.equal(cleanGame("DungeonLoot: Open Beta Has Arrived!"), "DungeonLoot");
    assert.equal(cleanGame("STRANDED: The Ashen Relics (Playtest)"), "STRANDED: The Ashen Relics");
    assert.equal(cleanGame("Hades II"), "Hades II");
    assert.equal(cleanGame("Fae &amp; Fauna Demo"), "Fae & Fauna");
    assert.deepEqual(["Closed Playtest", "Free demo", "Alpha build", "Open Beta"].map(kindFromText), ["playtest", "demo", "alpha", "beta"]);
    assert.deepEqual(["demo", "weekend", "playtest", "signup", "alpha", "beta"].map(kindGroup), ["demo", "weekend", "test", "test", "test", "test"]);
});

const item = (source, game, kind, hoursAgo, extra = {}) => ({ id: `${source}:${game}:${kind}`, source, sourceName: source, game, kind, url: "https://x.test/" + game, date: T0 - hoursAgo * 3600_000, summary: "", image: null, ...extra });

test("duplicates: the same game and kind from two sources is posted once, with the better source kept", () => {
    const out = dedupeItems([
        item("itch", "Dominot", "playtest", 2), item("abg", "Dominot", "signup", 30), item("gamerpower", "Dominot: Playtest Edition", "playtest", 5),
        item("steamdemo", "Dominot", "demo", 1), item("abg", "Other Game", "demo", 4), item("itch", "Dominot", "playtest", 24 * 20)
    ]);
    const key = out.map(x => `${x.source}:${x.game}:${x.kind}`).sort();
    assert.deepEqual(key, ["abg:Dominot:signup", "abg:Other Game:demo", "itch:Dominot:playtest", "steamdemo:Dominot:demo"].sort(),
        "a playtest, sign-up and beta of one game collapse into one (Alpha Beta Gamer's), a demo is its own thing, and one three weeks apart is a new announcement");
    assert.equal(out.filter(x => x.game.startsWith("Dominot") && kindGroup(x.kind) === "test").length, 2, "the old one from three weeks earlier stays");
    assert.equal(dedupeItems([item("abg", "Dark Roll", "demo", 1), item("itch", "Dark Roll 2", "playtest", 1)]).length, 2, "a sequel is a different game");
});

test("sources: one failing source only costs itself, the lists are cached, and all failing is an error", async () => {
    let t = 0; const calls = {}; const down = new Set();
    const fetchImpl = async url => {
        const k = new URL(url).hostname; calls[k] = (calls[k] ?? 0) + 1;
        if (down.has(k)) return { ok: false, status: 503 };
        if (k === "www.gamerpower.com") return { ok: true, json: async () => JSON.parse(F("gamerpower-beta.json")) };
        if (k === "itch.io") return { ok: true, text: async () => F("itch-playtest.xml") };
        if (k === "store.steampowered.com") return { ok: true, json: async () => JSON.parse(F("steam-demos.json")) };
        if (k === "playtester.io") return { ok: true, text: async () => F("playtester.xml") };
        return { ok: true, text: async () => F("abg-feed.xml") };
    };
    const src = createPlaytestSources({ fetchImpl, now: () => t });
    const all = await src.latest();
    const by = s => all.filter(x => x.source === s).length;
    assert.ok(by("abg") && by("gamerpower") && by("itch") && by("steamdemo") && by("playtester"), "every source is in the merged list");
    assert.ok(all.every((x, i) => i === 0 || all[i - 1].date >= x.date), "newest first");
    await src.latest(); assert.equal(calls["itch.io"], 4, "remembered: one request per itch.io tag, once");
    t = 31 * 60_000; down.add("itch.io"); down.add("www.gamerpower.com");
    const partial = await src.latest();
    assert.ok(by("itch") && partial.some(x => x.source === "itch"), "the last good copy still serves while a site is down");
    const fresh = createPlaytestSources({ fetchImpl, now: () => t });
    down.add("store.steampowered.com"); down.add("www.alphabetagamer.com"); down.add("playtester.io");
    await assert.rejects(fresh.latest());
});

// ---------- through the alerts ----------
function world() {
    const db = openDb(":memory:", { now: () => T0 });
    db.ensureUser("u1", "G"); db.updateUser("u1", { playtest: 2, share: 1 });
    db.addItems("u1", [{ itad_id: "w", title: "Wished Game" }]); db.setAppId("u1", "w", 77);
    db.setGuildChannel("G", "chan", "u1");
    db.setCommunity("G", { ping_playtest: "ROLE", playtest_channel: "PT" });
    let list = [];
    const abg = { latest: async () => list };
    const sent = [], chan = [];
    const notifier = { deliver: async (u, p) => { sent.push(p.embeds.map(e => e.title)); return { ok: true, via: "dm" }; }, postChannel: async (c, p, r) => { chan.push({ r, title: p.embeds[0].title, footer: p.embeds[0].footer.text }); return true; }, postGuild: async () => true };
    const run = () => runPlaytests({ db, news: { forApps: async () => new Map() }, abg, notifier, now: () => T0 });
    return { db, run, sent, chan, notifier, set: l => { list = l; }, abg };
}

test("alerts: a source added later starts quiet, then a game another source already announced is not announced again", async () => {
    const w = world();
    const abgOld = item("abg", "Old Listing", "demo", 5);
    w.set([abgOld]); await w.run();                       // first look: quiet
    w.set([abgOld, item("abg", "Fresh One", "signup", 1)]); await w.run();
    assert.equal(w.sent.length, 1); assert.match(w.sent[0][0], /Fresh One/);
    // GamerPower and itch.io start listing things: the first look at them is quiet for people and for the server
    const gpAll = item("gamerpower", "Already Listed", "playtest", 10), itchAll = item("itch", "Also Listed", "playtest", 12);
    w.set([abgOld, gpAll, itchAll]); await w.run();
    assert.equal(w.sent.length, 1, "nothing dumped on people"); assert.equal(w.chan.length, 1, "nor on the server");
    // a new one from itch.io is announced, once
    w.set([item("itch", "Brand New", "playtest", 0.5), abgOld, gpAll, itchAll]); await w.run();
    assert.equal(w.sent.length, 2); assert.match(w.sent[1][0], /Brand New/); assert.equal(w.chan.length, 2); assert.match(w.chan[1].footer, /Found on itch/);
    // another source lists the same game a day later (different id, same game and kind): not announced again
    w.set([item("gamerpower", "Brand New", "beta", 0.1), item("itch", "Brand New", "playtest", 0.5), abgOld, gpAll, itchAll]); await w.run();
    assert.equal(w.sent.length, 2, "no second DM for the same game"); assert.equal(w.chan.length, 2, "and no second post in the channel");
    // but a demo of that game is its own announcement
    w.set([item("abg", "Brand New", "demo", 0.01), item("gamerpower", "Brand New", "beta", 0.1), abgOld, gpAll, itchAll]); await w.run();
    assert.equal(w.chan.length, 3);
});

test("alerts: Steam's new demos only count for wishlist games, matched by the game's Steam id", async () => {
    const w = world();
    const other = item("steamdemo", "Random Demo Game", "demo", 3, { appid: 5, wishlistOnly: true, label: "Demo" });
    w.set([other]); await w.run();   // quiet first look
    const mine = item("steamdemo", "Wished Game", "demo", 1, { appid: 77, wishlistOnly: true, label: "Demo", id: "steamdemo:9" });
    w.set([other, mine, item("steamdemo", "Another Random", "demo", 1, { appid: 6, wishlistOnly: true, id: "steamdemo:10" })]); await w.run();
    assert.equal(w.sent.length, 1); assert.match(w.sent[0][0], /Demo: Wished Game/);
    assert.equal(w.chan.length, 1, "the server gets it too, because a member who shares their library there has the game on a wishlist");
    assert.match(w.chan[0].title, /Wished Game/);
});

test("refresh and the dashboard page: the merged list works the same, Steam demos only for wishlist games", async () => {
    const w = world();
    const list = [item("abg", "Listed A", "demo", 3), item("itch", "Listed B", "playtest", 5), item("steamdemo", "Not Wished", "demo", 1, { appid: 3, wishlistOnly: true }), item("steamdemo", "Wished Game", "demo", 2, { appid: 77, wishlistOnly: true, label: "Demo" })];
    w.set(list);
    const r = await refreshPlaytestChannel({ db: w.db, news: null, abg: w.abg, notifier: w.notifier, guildId: "G", now: () => T0 });
    assert.equal(r.found, 3, "the two plain listings and the demo of a game a sharing member has wishlisted, but not the other demo");
    const board = await playtestBoard({ db: w.db, news: null, abg: w.abg, userId: "u1", now: T0 });
    assert.deepEqual(board.items.map(x => x.game).sort(), ["Listed A", "Listed B", "Wished Game"]);
    assert.equal(board.items.find(x => x.game === "Wished Game").wishlist, true);
    assert.equal(board.items.find(x => x.game === "Wished Game").label, "Demo");
    assert.equal(board.items.find(x => x.game === "Listed B").source, "itch");
});

test("embed: names the source it came from and can carry its own label", () => {
    const e = abgEmbed({ game: "G", kind: "demo", label: "Demo", sourceName: "the Steam store", url: "https://x.test/", date: T0, summary: "" });
    assert.equal(e.title, "🎮 Demo: G"); assert.match(e.footer.text, /Found on the Steam store/);
    assert.match(abgEmbed({ game: "G", kind: "signup", url: "https://x.test/", date: T0, summary: "" }).footer.text, /Found on Alpha Beta Gamer/);
    const a = gameKeys({ game: "Brand New: Demo", kind: "demo" }, T0), b = gameKeys({ game: "Brand New", kind: "demo" }, T0);
    assert.equal(a.mark, b.mark, "the same game under the same key");
});

test("itch.io: beta, alpha and demo tags are read too, and demos only count for wishlisted games", async () => {
    const urls = [];
    const fetchImpl = async url => { urls.push(String(url)); const u = new URL(url); if (u.hostname === "itch.io") return { ok: true, text: async () => F("itch-playtest.xml") }; return { ok: false, status: 503, text: async () => "", json: async () => ({}) }; };
    const items = await createPlaytestSources({ fetchImpl, now: () => T0 }).latest();
    assert.deepEqual(urls.filter(u => u.includes("itch.io")).map(u => /tag-(\w+)\.xml/.exec(u)[1]).sort(), ["alpha", "beta", "demo", "playtest"]);
    assert.ok(items.some(x => x.source === "itch" && x.kind === "playtest"));
    assert.ok(items.filter(x => x.kind === "demo").every(x => x.wishlistOnly === true));
});

test("Playtester: its feed is read into the shared shape, and demos only count for wishlisted games", () => {
    const items = parsePlaytester(F("playtester.xml"));
    assert.equal(items.length, 12);
    const zoom = items.find(x => x.game.startsWith("I got the ZOOMIES"));
    assert.equal(zoom.kind, "beta"); assert.equal(zoom.sourceName, "Playtester"); assert.equal(zoom.url, "https://playtester.io/i-got-the-zoomies");
    assert.match(zoom.image, /^https:\/\/cdn\.playtester\.io\/thumbnails\//); assert.ok(!zoom.wishlistOnly);
    const demo = items.find(x => x.game === "Space Girl");
    assert.equal(demo.kind, "demo"); assert.equal(demo.wishlistOnly, true); assert.equal(demo.label, "Demo");
    assert.ok(items.every((x, i) => i === 0 || items[i - 1].date >= x.date), "newest first");
    assert.deepEqual(parsePlaytester("nope"), []);
});

test("a server can choose a source to post in full: its demos, even for games nobody watches, with a quiet start", async () => {
    const w = world();
    const demo = (name, daysAgo) => ({ ...item("playtester", name, "demo", daysAgo), wishlistOnly: true, label: "Demo" });
    w.set([item("abg", "Anchor", "signup", 5)]); await w.run();                       // first look: quiet
    w.set([item("abg", "Anchor", "signup", 5), demo("Unwatched Demo", 0.3)]); await w.run();
    assert.equal(w.chan.length, 0, "a demo nobody watches isn't posted by default");
    w.db.setCommunity("G", { playtest_full: "playtester" });
    w.set([item("abg", "Anchor", "signup", 5), demo("Unwatched Demo", 0.3)]); await w.run();
    assert.equal(w.chan.length, 0, "switching it on starts quiet: today's backlog isn't dumped");
    w.set([item("abg", "Anchor", "signup", 5), demo("Unwatched Demo", 0.3), demo("Brand New Demo", 0.05)]); await w.run();
    assert.equal(w.chan.length, 1); assert.match(w.chan[0].title, /Brand New Demo/);
    assert.equal(w.sent.length, 0, "members' own alerts keep the wishlist-only rule");
});

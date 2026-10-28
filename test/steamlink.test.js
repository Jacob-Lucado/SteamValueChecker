import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { parseGamesXml, parseGamesPage, parseOwnedJson, fetchOwnedGames, syncSteamLibrary, playStats, steamValue, steamNext, fetchAchievements, syncAchievements, fmtHours } from "../src/steamlib.js";
import { SteamError } from "../src/steam.js";

const XML = `<gamesList><steamID64>76561198000000000</steamID64><games>
<game><appID>10</appID><name><![CDATA[Counter &amp; Strike]]></name><hoursOnRecord>1,234.5</hoursOnRecord></game>
<game><appID>20</appID><name><![CDATA[Quiet Game]]></name></game>
<game><appID>x</appID><name>Broken</name></game></games></gamesList>`;

const res = (body, { status = 200, json = false } = {}) => ({ ok: status < 400, status, text: async () => (json ? JSON.stringify(body) : body), json: async () => (json ? body : JSON.parse(body)) });

test("the community XML list is parsed, including commas in hours and CDATA names", () => {
    const g = parseGamesXml(XML);
    assert.equal(g.length, 2);
    assert.deepEqual(g[0], { appid: 10, name: "Counter & Strike", minutes: 74070, lastPlayed: null });
    assert.equal(g[1].minutes, 0);
});

test("the Web API response is parsed defensively", () => {
    assert.equal(parseOwnedJson({ response: {} }), null);
    const g = parseOwnedJson({ response: { games: [{ appid: 5, name: " A ", playtime_forever: 90, rtime_last_played: 1700000000 }, { appid: "no" }] } });
    assert.deepEqual(g, [{ appid: 5, name: "A", minutes: 90, lastPlayed: 1700000000 }]);
});

test("a private profile gives a clear message, with or without an API key", async () => {
    await assert.rejects(fetchOwnedGames("76561198000000000", { fetchImpl: async () => res("<gamesList></gamesList>") }), e => e instanceof SteamError && e.code === "private");
    await assert.rejects(fetchOwnedGames("76561198000000000", { apiKey: "k", fetchImpl: async () => res({ response: {} }, { json: true }) }), e => e.code === "private");
    await assert.rejects(fetchOwnedGames("76561198000000000", { apiKey: "bad", fetchImpl: async () => res({}, { status: 403, json: true }) }), e => e.code === "config");
});

test("the API key is sent only when one is configured, and only to Steam", async () => {
    const urls = [];
    const f = async u => { urls.push(String(u)); return res(XML); };
    await fetchOwnedGames("76561198000000000", { fetchImpl: f });
    assert.match(urls[0], /^https:\/\/steamcommunity\.com\/profiles\/76561198000000000\/games/);
    assert.ok(!urls[0].includes("key="));
});

function rig() {
    const db = openDb(":memory:");
    db.ensureUser("u1", "g1");
    const itad = { lookupShopIds: async (_s, ids) => new Map(ids.map(i => [i, i === "app/20" ? null : "id-" + i.slice(4)])) };
    return { db, itad };
}

test("syncing fills the library with playtime, keeps what you paid and the status you chose", async () => {
    const { db, itad } = rig();
    db.upsertLibrary("u1", [{ itad_id: "id-10", title: "Counter & Strike", paid: 5 }]);
    db.setLibraryStatus("u1", "id-10", "finished");
    const r = await syncSteamLibrary({ db, itad, userId: "u1", steamid: "76561198000000000", fetchImpl: async () => res(XML) });
    assert.equal(r.owned, 2); assert.equal(r.matched, 1); assert.equal(r.unmatched, 1); assert.equal(r.updated, 1);
    const lib = db.listLibrary("u1");
    assert.equal(lib[0].paid, 5); assert.equal(lib[0].status, "finished"); assert.equal(lib[0].minutes, 74070); assert.equal(lib[0].appid, 10);
    assert.equal(db.getSteamLink("u1").steamid, "76561198000000000");
    assert.equal(db.getSteamLink("u1").games, 2);
});

test("new Steam games start as backlog, played (an hour or more), or playing (an hour or more in the last two weeks)", async () => {
    const { db, itad } = rig();
    await syncSteamLibrary({ db, itad, userId: "u1", steamid: "76561198000000000", fetchImpl: async () => res(XML) });
    assert.equal(db.listLibrary("u1")[0].status, "played", "no recent play on record");
    const recent = Math.floor(Date.now() / 1000) - 86400;
    const fresh = rig();
    fresh.db.syncSteamGames("u1", [{ itad_id: "r", title: "Recent", appid: 5, minutes: 300, lastPlayed: recent }, { itad_id: "q", title: "Quick", appid: 6, minutes: 20, lastPlayed: recent }]);
    const st = Object.fromEntries(fresh.db.listLibrary("u1").map(g => [g.title, g.status]));
    assert.deepEqual(st, { Recent: "playing", Quick: "backlog" });
});

test("a one-time cleanup turns old auto-marked Playing games into Played, then leaves your choices alone", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { DatabaseSync } = await import("node:sqlite");
    const path = join(mkdtempSync(join(tmpdir(), "svc-mig-")), "t.db");
    const a = openDb(path);
    a.ensureUser("u1", "g1");
    a.syncSteamGames("u1", [{ itad_id: "old", title: "Old", appid: 1, minutes: 500, lastPlayed: 1 }, { itad_id: "new", title: "New", appid: 2, minutes: 500, lastPlayed: Math.floor(Date.now() / 1000) }]);
    a.setLibraryStatus("u1", "old", "playing"); // what the old version did
    a.close();
    const raw = new DatabaseSync(path); raw.exec("DELETE FROM status_meta WHERE key = 'migrated:steam-played'"); raw.close(); // as if upgrading
    const b = openDb(path);
    const st = () => Object.fromEntries(b.listLibrary("u1").map(g => [g.title, g.status]));
    assert.deepEqual(st(), { Old: "played", New: "playing" });
    b.setLibraryStatus("u1", "old", "playing"); // your own choice later
    b.close();
    const c = openDb(path);
    assert.equal(c.listLibrary("u1").find(g => g.title === "Old").status, "playing", "never runs twice");
    c.close();
});

test("unlinking and deleting remove the link", async () => {
    const { db, itad } = rig();
    await syncSteamLibrary({ db, itad, userId: "u1", steamid: "76561198000000000", fetchImpl: async () => res(XML) });
    assert.ok(db.exportUser("u1").steam_link);
    assert.equal(db.removeSteamLink("u1"), true);
    assert.equal(db.getSteamLink("u1"), null);
    db.setSteamLink("u1", "76561198000000000");
    db.deleteUser("u1");
    assert.equal(db.getSteamLink("u1"), null);
});

test("library stats: games, hours, unplayed and total value", () => {
    const rows = [
        { title: "A", minutes: 600, paid: 10, best: { price: 5 }, msrp: 20 },
        { title: "B", minutes: 120, paid: null, best: { price: 6 }, msrp: 30 },
        { title: "C", minutes: 30, paid: 60, best: { price: 40 }, msrp: 60 },
        { title: "D", minutes: 0, paid: null, best: { price: 9 }, msrp: 40 }
    ];
    const s = playStats(rows);
    assert.equal(s.games, 4); assert.equal(s.playedGames, 3); assert.equal(s.totalMinutes, 750);
    assert.deepEqual([s.value.msrp, s.value.cheapest], [150, 60]);
    assert.equal(s.mostPlayed[0].title, "A");
    assert.equal(s.unplayedCount, 2); assert.equal(s.unplayedMsrp, 100); assert.equal(s.unplayedTop[0].title, "C");
    assert.ok(!("perHour" in s), "no cost-per-hour any more");
    assert.equal(fmtHours(45), "45 min"); assert.equal(fmtHours(90), "1.5 h"); assert.equal(fmtHours(6000), "100 h");
});

test("what to play next: playing first, then started-and-dropped, then the most valuable unplayed; another never repeats", () => {
    const g = (title, minutes, msrp, status = "backlog") => ({ itad_id: "id-" + title, title, appid: 1, minutes, msrp, status });
    const first = () => 0;
    const rows = [g("Never", 0, 60), g("Cheap", 0, 5), g("Started", 120, 30), g("Done", 900, 20, "finished"), g("Now", 300, 10, "playing"), g("Quit", 40, 15, "dropped")];
    let n = steamNext(rows, { rand: first });
    assert.equal(n.pick.title, "Now"); assert.match(n.why, /playing/);
    n = steamNext(rows.filter(r => r.title !== "Now"), { rand: first });
    assert.equal(n.pick.title, "Started"); assert.match(n.why, /never went back/);
    n = steamNext(rows.filter(r => !["Now", "Started"].includes(r.title)), { rand: first });
    assert.equal(n.pick.title, "Never", "the most valuable unplayed game comes first");
    assert.equal(n.others[0].title, "Cheap");
    const skip = [];
    const seen = [];
    for (let i = 0; i < 6; i++) { const x = steamNext(rows, { rand: first, skip }); if (!x) break; seen.push(x.pick.title); skip.push(x.pick.itad_id); }
    assert.deepEqual(seen, ["Now", "Started", "Never", "Cheap"], "finished and dropped games are never suggested, and nothing repeats");
    assert.equal(steamNext([g("Done", 5, 5, "finished")]), null);
});

const json = { rgGames: [{ appid: 10, name: "Counter & \"Strike\"", hours_forever: "1,234.5", last_played: 1700000000 }, { appid: 20, name: "Quiet", playtime_forever: 90 }, { appid: 0, name: "bad" }] };
const PAGE = `<html><template id="gameslist_config" data-profile-gameslist="${JSON.stringify(json).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></template></html>`;

test("reads the games page Steam serves for public profiles, and falls back to the XML list", async () => {
    const g = parseGamesPage(PAGE);
    assert.deepEqual(g.map(x => [x.appid, x.name, x.minutes, x.lastPlayed]), [[10, 'Counter & "Strike"', 74070, 1700000000], [20, "Quiet", 90, null]]);
    assert.deepEqual(parseGamesPage("<html>nothing</html>"), []);
    const urls = [];
    const page = await fetchOwnedGames("76561198000000000", { fetchImpl: async u => { urls.push(String(u)); return res(PAGE); } });
    assert.equal(page.length, 2); assert.equal(urls.length, 1, "stops at the first source that has games");
    const viaXml = await fetchOwnedGames("76561198000000000", { fetchImpl: async u => res(String(u).includes("xml=1") ? XML : "<html></html>") });
    assert.equal(viaXml[0].appid, 10);
});

test("a sync reports what the synced games are worth, and a price lookup problem does not undo it", async () => {
    const { db, itad } = rig();
    const priced = { ...itad, getPrices: async ids => new Map(ids.map(id => [id, { deals: [{ shop: { name: "GOG" }, price: { amount: 10, currency: "USD" }, regular: { amount: 20, currency: "USD" }, cut: 50, url: "https://x.example" }], historyLow: { all: { amount: 5 } } }])) };
    const r = await syncSteamLibrary({ db, itad: priced, userId: "u1", steamid: "76561198000000000", fetchImpl: async () => res(XML) });
    assert.equal(r.value.games, 1); assert.equal(r.value.msrp, 20); assert.equal(r.value.cheapest, 10);
    const broken = rig();
    const r2 = await syncSteamLibrary({ db: broken.db, itad: broken.itad, userId: "u1", steamid: "76561198000000000", fetchImpl: async () => res(XML) });
    assert.equal(r2.value, null); assert.equal(r2.owned, 2);
    const v = steamValue([{ title: "A", msrp: 20, best: { price: 10 }, atl: 4, ach_done: 3, ach_total: 10 }, { title: "B", msrp: null, best: null, ach_done: 5, ach_total: 5 }, { title: "C", msrp: 1, ach_done: null, ach_total: null }], "EUR");
    assert.deepEqual([v.achDone, v.achTotal, v.achGames], [8, 15, 2]);
    assert.deepEqual([v.games, v.priced, v.msrp, v.cheapest, v.atl, v.currency, v.top.map(t => t.title)], [3, 2, 21, 10, 4, "EUR", ["A", "C"]]);
});

test("achievements: 100% marks a game Finished once, never overrides your choice, and skips recently checked games", async () => {
    const { db } = rig();
    db.syncSteamGames("u1", [
        { itad_id: "full", title: "Full", appid: 1, minutes: 600, lastPlayed: null },
        { itad_id: "part", title: "Part", appid: 2, minutes: 500, lastPlayed: null },
        { itad_id: "none", title: "None", appid: 3, minutes: 400, lastPlayed: null },
        { itad_id: "drop", title: "Dropped", appid: 4, minutes: 300, lastPlayed: null },
        { itad_id: "idle", title: "Idle", appid: 5, minutes: 5, lastPlayed: null }
    ]);
    db.setLibraryStatus("u1", "drop", "dropped");
    const urls = [];
    const api = { 1: { playerstats: { achievements: [{ achieved: 1 }, { achieved: 1 }] } }, 2: { playerstats: { achievements: [{ achieved: 1 }, { achieved: 0 }, { achieved: 0 }] } }, 3: { playerstats: { success: false, error: "Requested app has no stats" } }, 4: { playerstats: { achievements: [{ achieved: 1 }] } } };
    const f = async u => { urls.push(String(u)); const id = Number(String(u).match(/appid=(\d+)/)[1]); return res(api[id] ?? {}, { json: true, status: api[id] ? 200 : 400 }); };
    const r = await syncAchievements({ db, userId: "u1", steamid: "76561198000000000", apiKey: "k", fetchImpl: f });
    assert.deepEqual([r.checked, r.newlyFinished], [4, 1]);
    assert.ok(!urls.some(u => u.includes("appid=5")), "barely played games are not looked up");
    const st = Object.fromEntries(db.listLibrary("u1").map(g => [g.title, [g.status, g.ach_done, g.ach_total]]));
    assert.deepEqual(st.Full, ["finished", 2, 2]); assert.deepEqual(st.Part, ["played", 1, 3]); assert.deepEqual(st.None, ["played", 0, 0]); assert.equal(st.Dropped[0], "dropped");
    urls.length = 0;
    const again = await syncAchievements({ db, userId: "u1", steamid: "76561198000000000", apiKey: "k", fetchImpl: f });
    assert.equal(urls.length, 0, "checked within a week: nothing to do"); assert.equal(again.checked, 0);
    db.setLibraryStatus("u1", "full", "played");
    await syncAchievements({ db, userId: "u1", steamid: "76561198000000000", apiKey: "k", fetchImpl: f, now: Date.now() + 8 * 86400_000 });
    assert.equal(db.listLibrary("u1").find(g => g.title === "Full").status, "played", "a status you chose is not undone by a later check");
    assert.equal(await fetchAchievements("76561198000000000", 9, { apiKey: "k", fetchImpl: async () => res({}, { status: 403, json: true }) }), null);
    await assert.rejects(fetchAchievements("76561198000000000", 9, { apiKey: "k", fetchImpl: async () => res({}, { status: 429, json: true }) }), e => e.code === "rate_limited");
});

test("library trend: needs two days, then reports the change", async () => {
    const { trendSummary } = await import("../src/library.js");
    assert.equal(trendSummary([{ day: "2026-10-01", games: 3, msrp: 10, cheapest: 5, backlog: 3, finished: 0 }]), null);
    const tr = trendSummary([
        { day: "2026-09-01", games: 2, msrp: 10, cheapest: 6, backlog: null, finished: null },
        { day: "2026-10-01", games: 3, msrp: 20, cheapest: 10, backlog: 3, finished: 0 },
        { day: "2026-10-31", games: 5, msrp: 50, cheapest: 25, backlog: 2, finished: 3 }]);
    assert.equal(tr.first.msrp, 40); assert.equal(tr.first.backlog, null, "old snapshots had no counts");
    assert.equal(tr.month.days, 30); assert.equal(tr.month.backlog, -1); assert.equal(tr.month.finished, 3);
});

test("playtime recap: hours gained between syncs are logged per day and summed by month and game", async () => {
    const { recapSummary } = await import("../src/steamstore.js");
    let clock = Date.UTC(2026, 2, 10);
    const db = openDb(":memory:", { now: () => clock });
    db.ensureUser("u1", "g1");
    const g = minutes => [{ itad_id: "a", title: "Alpha", appid: 1, minutes }, { itad_id: "b", title: "Beta", appid: 2, minutes: 30 }];
    db.syncSteamGames("u1", g(60));            // first sync is a baseline, nothing is logged
    assert.equal(db.playtimeLog("u1").length, 0);
    clock = Date.UTC(2026, 2, 12); db.syncSteamGames("u1", g(180));   // +120 in March
    clock = Date.UTC(2026, 4, 1); db.syncSteamGames("u1", g(240));    // +60 in May
    db.syncSteamGames("u1", g(240));           // nothing new, nothing logged
    const r = db.playRecap("u1", 2026);
    assert.equal(r.totalMinutes, 180); assert.equal(r.months[2], 120); assert.equal(r.months[4], 60);
    assert.equal(r.busiestMonth, 2); assert.equal(r.activeDays, 2); assert.deepEqual(r.top, [{ title: "Alpha", minutes: 180 }]);
    assert.equal(db.playRecap("u1", 2025).totalMinutes, 0);
    assert.equal(recapSummary([], 2026).busiestMonth, null);
    assert.equal(db.exportUser("u1").playtime_log.length, 2);
    db.deleteUser("u1");
    db.close();
});

test("backlog challenge: finished games count in their month, and the streak survives an open month", async () => {
    const { streakOf, challengeView, monthKey } = await import("../src/challenge.js");
    assert.equal(monthKey(Date.UTC(2026, 0, 31, 23)), "2026-01");
    // streak: Nov and Dec met, Jan (open) not yet met -> still 2; a gap resets
    assert.deepEqual(streakOf([{ month: "2025-11", goal: 2, done: 2 }, { month: "2025-12", goal: 1, done: 3 }, { month: "2026-01", goal: 2, done: 0 }], "2026-01"), { streak: 2, best: 2 });
    assert.equal(streakOf([{ month: "2025-10", goal: 1, done: 1 }, { month: "2025-12", goal: 1, done: 1 }], "2026-01").streak, 1, "a skipped month breaks it");
    assert.equal(streakOf([{ month: "2026-01", goal: 2, done: 2 }, { month: "2025-12", goal: 1, done: 1 }], "2026-01").streak, 2, "the open month counts when met");

    let clock = Date.UTC(2025, 11, 5);
    const db = openDb(":memory:", { now: () => clock });
    db.ensureUser("u1", "g1");
    db.upsertLibrary("u1", ["A", "B", "C"].map((t, n) => ({ itad_id: "id" + n, title: t, paid: null })));
    db.setChallenge("u1", "2025-12", 2);
    db.setLibraryStatus("u1", "id0", "finished");
    clock = Date.UTC(2025, 11, 20); db.setLibraryStatus("u1", "id1", "finished");
    db.setLibraryStatus("u1", "id1", "finished"); // setting it again does not move the date
    clock = Date.UTC(2026, 0, 3); db.setChallenge("u1", "2026-01", 1); db.setLibraryStatus("u1", "id2", "finished");
    const jan = challengeView(db, "u1", Date.UTC(2026, 0, 10));
    assert.deepEqual([jan.goal, jan.done, jan.streak], [1, 1, 2]);
    const dec = challengeView(db, "u1", Date.UTC(2025, 11, 25));
    assert.deepEqual([dec.goal, dec.done, dec.titles], [2, 2, ["A", "B"]]);
    assert.equal(dec.daysLeft, 7);
    db.setChallenge("u1", "2026-01", 0);
    assert.equal(challengeView(db, "u1", Date.UTC(2026, 0, 10)).goal, 0, "0 clears the goal");
    db.deleteUser("u1"); db.close();
});

test("spend tracker: totals, year, months, cost per hour and bought-but-unplayed", async () => {
    const { spendSummary, regionCurrency } = await import("../src/spend.js");
    assert.equal(regionCurrency("GB"), "GBP"); assert.equal(regionCurrency("??"), "USD");
    const NOW = Date.UTC(2026, 5, 15);
    const g = (title, paid, month, minutes = 0, status = "backlog") => ({ title, paid, added_at: Date.UTC(2026, month - 1, 10), minutes, status });
    const sp = spendSummary([g("A", 20, 6, 600), g("B", 10, 6, 60), g("C", 30, 1), g("D", null, 6, 100), g("E", 8, 6, 0, "finished"), { ...g("Old", 50, 3), added_at: Date.UTC(2024, 2, 1) }], { now: NOW, currency: "USD" });
    assert.equal(sp.total, 118); assert.equal(sp.games, 5); assert.equal(sp.year.total, 68);
    assert.equal(sp.months.length, 12); assert.equal(sp.months.at(-1).month, "2026-06"); assert.equal(sp.months.at(-1).total, 38);
    assert.deepEqual(sp.bestValue.map(x => x.title), ["A", "B"]); assert.equal(sp.bestValue[0].perHour, 2);
    assert.deepEqual(sp.worstValue.map(x => x.title), ["B", "A"]);
    assert.deepEqual(sp.unplayed, { count: 2, total: 80 }, "C and Old are unplayed; the finished one is not counted");
    assert.equal(spendSummary([], { now: NOW }).games, 0);
});

test("taste: genres are fetched politely, weighted by hours, and wishlist games are ranked by fit", async () => {
    const { fetchAppTags, refreshTags, tasteProfile, recommend } = await import("../src/taste.js");
    const store = { 1: ["RPG", "Indie"], 2: ["RPG"], 3: ["Racing"], 4: ["RPG", "Strategy"], 5: ["Racing"] };
    const calls = [];
    const fetchImpl = async url => { const id = new URL(url).searchParams.get("appids"); calls.push(id); return { ok: true, json: async () => ({ [id]: store[id] ? { success: true, data: { genres: store[id].map(description => ({ description })), categories: [{ description: "Single-player" }] } } : { success: false } }) }; };
    assert.deepEqual(await fetchAppTags(2, fetchImpl), { genres: ["RPG"], cats: ["Single-player"] });
    assert.equal(await fetchAppTags(99, fetchImpl), null);

    const db = openDb(":memory:");
    db.ensureUser("u1", "g1");
    db.upsertLibrary("u1", [1, 2, 3].map(n => ({ itad_id: "id" + n, title: "G" + n, paid: null })));
    db.syncSteamGames("u1", [{ itad_id: "id1", title: "G1", appid: 1, minutes: 6000 }, { itad_id: "id2", title: "G2", appid: 2, minutes: 600 }, { itad_id: "id3", title: "G3", appid: 3, minutes: 60 }]);
    db.addItems("u1", [{ itad_id: "w4", title: "Wish RPG", appid: 4 }, { itad_id: "w5", title: "Wish Racer", appid: 5 }]);
    assert.deepEqual(db.appsNeedingTags("u1", 10).slice(0, 3), [1, 2, 3], "most played first");
    assert.equal(await refreshTags({ db, appids: db.appsNeedingTags("u1", 10), fetchImpl, delayMs: 0 }), 5);
    assert.deepEqual(db.appsNeedingTags("u1", 10), [], "nothing left to fetch");
    const profile = tasteProfile(db, "u1");
    assert.equal(profile.genres[0].name, "RPG"); assert.ok(profile.genres[0].pct > profile.genres.find(g => g.name === "Racing").pct);
    const rows = [{ itad_id: "w4", title: "Wish RPG", best: { price: 10 }, discount: 0.5 }, { itad_id: "w5", title: "Wish Racer", best: { price: 10 }, discount: 0.5 }];
    const picks = recommend(db, "u1", rows, profile);
    assert.equal(picks[0].title, "Wish RPG"); assert.deepEqual(picks[0].matched, ["RPG"]);
    // a failing fetch stops the run quietly
    assert.equal(await refreshTags({ db, appids: [7, 8], fetchImpl: async () => ({ ok: false, status: 429 }), delayMs: 0 }), 0);
    db.close();
});

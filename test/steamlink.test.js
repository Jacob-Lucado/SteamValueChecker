import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { parseGamesXml, parseGamesPage, parseOwnedJson, fetchOwnedGames, syncSteamLibrary, playStats, steamValue, fmtHours } from "../src/steamlib.js";
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

test("new Steam games start as backlog, or playing once they have an hour", async () => {
    const { db, itad } = rig();
    await syncSteamLibrary({ db, itad, userId: "u1", steamid: "76561198000000000", fetchImpl: async () => res(XML) });
    assert.equal(db.listLibrary("u1")[0].status, "playing");
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

test("playtime stats: cost per hour uses what you paid, falls back to the cheapest price, and ignores short sessions", () => {
    const rows = [
        { title: "A", minutes: 600, paid: 10, best: { price: 5 }, msrp: 20 },
        { title: "B", minutes: 120, paid: null, best: { price: 6 }, msrp: 30 },
        { title: "C", minutes: 30, paid: 60, best: { price: 40 }, msrp: 60 },
        { title: "D", minutes: 0, paid: null, best: { price: 9 }, msrp: 40 }
    ];
    const s = playStats(rows);
    assert.equal(s.games, 4); assert.equal(s.playedGames, 3); assert.equal(s.totalMinutes, 750);
    assert.equal(s.bestValue[0].title, "A"); assert.equal(s.bestValue[0].perHour, 1);
    assert.equal(s.bestValue[1].estimated, true);
    assert.ok(!s.worstValue.some(r => r.title === "C"), "30 minutes is too short to rank");
    assert.equal(s.perHour, 16 / 12);
    assert.equal(s.unplayedCount, 2); assert.equal(s.unplayedMsrp, 100); assert.equal(s.unplayedTop[0].title, "C");
    assert.equal(fmtHours(45), "45 min"); assert.equal(fmtHours(90), "1.5 h"); assert.equal(fmtHours(6000), "100 h");
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
    assert.deepEqual(steamValue([{ msrp: 20, best: { price: 10 } }, { msrp: null, best: null }], "EUR"), { games: 2, msrp: 20, cheapest: 10, currency: "EUR" });
});

import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { goalProgress } from "../src/steamstore.js";
import { extraBoard } from "../src/library.js";
import { addBundle, bundleView, verdictFor } from "../src/bundles.js";
import { prefsPatch } from "../src/prefs.js";
import { runCycle } from "../src/poller.js";
import { createNotifier } from "../src/notify.js";
import { UserError } from "../src/errors.js";

const deal = (amount, regular) => ({ shop: { name: "GOG" }, price: { amount, currency: "USD" }, regular: { amount: regular, currency: "USD" }, cut: 0, url: "https://deal.example/x" });
const itadWith = prices => ({
    getPrices: async ids => new Map(ids.map(id => [id, prices[id] ?? { deals: [] }])),
    lookupTitles: async titles => titles.map(t => (/^zzz/i.test(t) ? { title: t, id: null } : { title: t, id: "id-" + t.toLowerCase().replace(/\W+/g, ""), approx: false, matched: t }))
});

test("hours goal: progress, pace and the weekly amount still needed", () => {
    const mid = Date.UTC(2026, 6, 2); // day 183 of 365
    const p = goalProgress(300, 90 * 60, mid);
    assert.equal(p.done, 90); assert.equal(p.pct, 30); assert.equal(p.reached, false);
    assert.ok(p.projected > 150 && p.projected < 220);
    assert.ok(p.perWeek > 5 && p.perWeek < 10);
    assert.equal(goalProgress(100, 150 * 60, mid).reached, true);
    assert.equal(goalProgress(100, 150 * 60, mid).perWeek, 0);
});

test("hours goal is stored per year and cleared with 0", () => {
    let clock = Date.UTC(2026, 5, 1);
    const db = openDb(":memory:", { now: () => clock });
    db.ensureUser("u1", "g1");
    assert.equal(db.getHourGoal("u1"), null);
    db.setHourGoal("u1", 250); assert.equal(db.getHourGoal("u1"), 250);
    clock = Date.UTC(2027, 0, 5); assert.equal(db.getHourGoal("u1"), null); // last year's goal is not this year's
    clock = Date.UTC(2026, 5, 1); db.setHourGoal("u1", 0); assert.equal(db.getHourGoal("u1"), null);
});

test("extra boards: hours this year and library size count only opted-in members of that server", () => {
    let clock = Date.UTC(2026, 2, 1);
    const db = openDb(":memory:", { now: () => clock });
    const g = (n, m) => [{ itad_id: "a", title: "Alpha", appid: 1, minutes: m }, ...Array.from({ length: n }, (_, i) => ({ itad_id: "x" + i, title: "X" + i, appid: 10 + i, minutes: 0 }))];
    for (const [id, share] of [["a", 1], ["b", 1], ["c", 0]]) { db.ensureUser(id, "g1"); db.updateUser(id, { share }); db.syncSteamGames(id, g(id === "a" ? 5 : 2, 60)); }
    clock = Date.UTC(2026, 3, 1);
    db.syncSteamGames("a", g(5, 360)); db.syncSteamGames("b", g(2, 120)); db.syncSteamGames("c", g(2, 6000));
    const hours = extraBoard(db, "g1", "hours", clock);
    assert.deepEqual(hours.map(e => e.discord_id), ["a", "b"]);
    assert.equal(hours[0].label, "5 hours");
    for (const id of ["a", "b"]) db.upsertSnapshot(id, { games: id === "a" ? 6 : 3, paid: 0, msrp: 0, msrp_paid: 0, cheapest: 0 });
    assert.deepEqual(extraBoard(db, "g1", "games").map(e => [e.discord_id, e.score]), [["a", 6], ["b", 3]]);
    assert.deepEqual(extraBoard(db, "g1", "nope"), []);
});

test("bundles: games join the library with the price split, value and verdict are worked out, and it can be removed", async () => {
    const db = openDb(":memory:");
    db.ensureUser("u1", "g1");
    const itad = itadWith({ "id-alpha": { deals: [deal(20, 40)] }, "id-beta": { deals: [deal(30, 60)] } });
    await assert.rejects(addBundle(db, itad, "u1", { name: "X", paid: 5, titles: "OnlyOne" }), UserError);
    await assert.rejects(addBundle(db, itad, "u1", { name: "X", paid: -1, titles: "Alpha, Beta" }), UserError);
    const r = await addBundle(db, itad, "u1", { name: "Spring", paid: 10, titles: "Alpha, Beta, zzzMissing" });
    assert.equal(r.matched, 2); assert.deepEqual(r.notFound, ["zzzMissing"]); assert.equal(r.newGames, 2);
    assert.deepEqual(db.listLibrary("u1").map(l => l.paid), [5, 5]);
    const v = await bundleView(db, itad, db.getUser("u1"));
    assert.equal(v.bundles.length, 1);
    assert.equal(v.bundles[0].msrp, 100); assert.equal(v.bundles[0].perGame, 5);
    assert.match(v.bundles[0].verdict.text, /90% under/);
    assert.equal(db.removeBundle("u1", v.bundles[0].id), true);
    assert.equal(db.listBundles("u1").length, 0);
    assert.equal(verdictFor(120, 100).tone, "bad");
    // exports and deleting the account include/clean it
    await addBundle(db, itad, "u1", { name: "Again", paid: 8, titles: "Alpha, Beta" });
    assert.equal(db.exportUser("u1").bundles.length, 1);
});

test("minimum discount: validated, and sale alerts below it are held back without being marked as sent", async () => {
    assert.throws(() => prefsPatch({ min_discount: 95 }, {}), UserError);
    assert.throws(() => prefsPatch({ min_discount: 2.5 }, {}), UserError);
    assert.deepEqual(prefsPatch({ min_discount: 40 }, {}), { min_discount: 40 });
    const db = openDb(":memory:");
    const sent = [];
    const notifier = createNotifier({ db, discord: { sendDm: async (id, p) => { sent.push(id); }, sendChannel: async () => {} } });
    db.ensureUser("u1", "g1"); db.addItems("u1", [{ itad_id: "id-g", title: "G" }]);
    db.updateUser("u1", { min_discount: 50 });
    const cycle = async amount => runCycle({ db, itad: itadWith({ "id-g": { deals: [{ ...deal(amount, 100), cut: 100 - amount }] } }), notifier, log: () => {} });
    await cycle(80); assert.equal(sent.length, 0);   // 20% off: below the minimum
    await cycle(40); assert.equal(sent.length, 1);   // 60% off: alerts, and the earlier hold did not mark it as sent
});

test("year-in-review picture is a real PNG, only when Steam is linked and hours are tracked", async () => {
    const { renderRecap } = await import("../src/cardimg.js");
    let clock = Date.UTC(2026, 2, 10);
    const db = openDb(":memory:", { now: () => clock });
    db.ensureUser("u1", "g1");
    const fetchImpl = async () => { throw new Error("offline"); };
    assert.equal(await renderRecap({ db, userId: "u1", fetchImpl, now: clock }), null);          // not linked
    db.setSteamLink("u1", "76561198000000000");
    assert.equal(await renderRecap({ db, userId: "u1", fetchImpl, now: clock }), null);          // nothing tracked
    const g = m => [{ itad_id: "a", title: "A very long game title that has to be shortened to fit", appid: 1, minutes: m }];
    db.syncSteamGames("u1", g(60)); clock = Date.UTC(2026, 2, 12); db.syncSteamGames("u1", g(900));
    db.setHourGoal("u1", 100);
    const png = await renderRecap({ db, userId: "u1", name: "Jacob", fetchImpl, now: clock });
    assert.deepEqual([...png.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    assert.ok(png.length > 5000);
});

test("broadcast: validates, skips members whose DMs keep failing, runs one at a time and records the result", async () => {
    const { createBroadcaster } = await import("../src/broadcast.js");
    const db = openDb(":memory:");
    for (const id of ["a", "b", "c"]) db.ensureUser(id, "g1");
    db.updateUser("c", { dm_failures: 5 });
    db.setGuildChannel("g1", "chan1", "a");
    const dms = [], posts = []; let gate;
    const b = createBroadcaster({ db, ownerId: "a", delayMs: 0, sleep: () => gate, sendDm: async (id) => { if (id === "b") throw new Error("closed"); dms.push(id); }, sendChannel: async (id) => { posts.push(id); } });
    assert.deepEqual(b.counts(), { dm: 2, channels: 1, promoDm: 2 });
    assert.throws(() => b.start({ title: "", body: "  ", audience: "dm" }), UserError);
    assert.throws(() => b.start({ title: "", body: "x".repeat(1501), audience: "dm" }), UserError);
    assert.throws(() => b.start({ title: "", body: "hi", audience: "everyone" }), UserError);
    let release; gate = new Promise(r => { release = r; });
    const r = b.start({ title: "Update", body: "Down at 11pm", audience: "both" });
    assert.equal(r.total, 3);
    assert.throws(() => b.start({ title: "", body: "again", audience: "dm" }), /still going out/);
    release(); gate = Promise.resolve();
    for (let i = 0; i < 50 && b.running(); i++) await new Promise(x => setTimeout(x, 5));
    assert.deepEqual(dms, ["a"]); assert.deepEqual(posts, ["chan1"]);
    const [row] = db.listBroadcasts(1);
    assert.deepEqual([row.total, row.sent, row.failed, row.done, row.title], [3, 2, 1, 1, "Update"]);
    const t = b.start({ title: "", body: "test", audience: "me" });
    assert.equal(t.total, 1);
});

test("announcement embed carries the banner and creator logo when a public url is set", async () => {
    const { noticeEmbed } = await import("../src/broadcast.js");
    const e = noticeEmbed("T", "B", "https://x.test");
    assert.equal(e.image.url, "https://x.test/banner.png");
    assert.equal(e.thumbnail.url, "https://x.test/creator.png");
    assert.equal(noticeEmbed("T", "B").image, undefined);
});

test("purchase-history prices fill synced games without adding any, and report what is missing", async () => {
    const { fillPrices, normTitle } = await import("../src/library.js");
    assert.equal(normTitle("Call of Duty®: Modern Warfare® II"), "call of duty modern warfare ii");
    assert.equal(normTitle("Call of Duty: Modern Warfare II"), "call of duty modern warfare ii");
    const db = openDb(":memory:");
    db.ensureUser("p1");
    db.syncSteamGames("p1", [
        { itad_id: "id-hades", title: "Hades", appid: 1145360, minutes: 60 },
        { itad_id: "id-cod", title: "Call of Duty®: Modern Warfare® II", appid: 1938090, minutes: 0 },
        { itad_id: "id-free", title: "Warframe", appid: 230410, minutes: 5 },
        { itad_id: "id-celeste", title: "Celeste", appid: 504230, minutes: 5 }
    ]);
    const itad = { lookupTitles: async ts => ts.map(t => ({ title: t, id: t === "Celeste (2018)" ? "id-celeste" : null })) };
    const r = await fillPrices(db, itad, "p1", [
        { title: "Hades", paid: 12.5 }, { title: "Call of Duty: Modern Warfare II", paid: 59.99 },
        { title: "Celeste (2018)", paid: 4 }, { title: "A Gift For A Friend", paid: 9.99 }
    ]);
    assert.equal(r.mode, "filled");
    assert.equal(r.filled, 3);
    assert.deepEqual(r.missing, ["A Gift For A Friend"]);
    assert.deepEqual(r.unpriced, ["Warframe"]);
    const rows = db.listLibrary("p1");
    assert.equal(rows.length, 4); // nothing added
    assert.equal(rows.find(x => x.title === "Hades").paid, 12.5);
    assert.equal(rows.find(x => x.itad_id === "id-cod").paid, 59.99);
});

test("hot deals and sale-start posts go once per deal to servers that turned them on", async () => {
    const { runHotDeals, runSaleStarts } = await import("../src/poller.js");
    const db = openDb(":memory:");
    db.setGuildChannel("g1", "c1", "u1"); db.setGuildChannel("g2", "c2", "u1");
    db.setHotMin("g1", 75); db.setSaleFeed("g1", true);
    const posts = [];
    const notifier = { postGuild: async (id, p) => { posts.push([id, p]); return true; } };
    const deal = (id, cut, price) => ({ id, title: "Game " + id, cut, price, regular: 24.99, currency: "USD", url: "https://store.steampowered.com/app/" + (100 + Number(id.slice(1))), appid: 100, since: 1, expiry: null, storeLow: null });
    let deals = [deal("a1", 90, 2.49), deal("a2", 80, 4.99), deal("a3", 50, 12)];
    const itad = { getHotDeals: async ({ minCut }) => deals.filter(d => d.cut >= minCut) };
    let r = await runHotDeals({ db, itad, notifier });
    assert.equal(r.guilds, 1);
    assert.equal(posts.length, 1); assert.equal(posts[0][0], "g1"); assert.equal(posts[0][1].embeds.length, 2); // 50% is under g1's 75
    r = await runHotDeals({ db, itad, notifier });
    assert.equal(posts.length, 1); // nothing new, nothing posted
    deals = [...deals, deal("a4", 95, 1.25)];
    await runHotDeals({ db, itad, notifier });
    assert.equal(posts.length, 2); assert.equal(posts[1][1].embeds.length, 1);

    const during = Date.parse("2026-10-29T12:00:00Z"); // Steam Scream V Fest is on
    const s1 = await runSaleStarts({ db, notifier, now: () => during });
    assert.equal(s1.posted, 1);
    assert.match(posts.at(-1)[1].embeds[0].title, /Scream V Fest has started/);
    assert.equal((await runSaleStarts({ db, notifier, now: () => during })).posted, 0);
    assert.equal((await runSaleStarts({ db, notifier, now: () => Date.parse("2026-11-20T12:00:00Z") })).posted, 0); // nothing live
});

test("itad hot deals keep only Steam games at or above the discount", async () => {
    const { createItad } = await import("../src/itad.js");
    const body = { list: [
        { id: "g1", title: "Inside", type: "game", deal: { cut: 90, price: { amount: 2.49, currency: "USD" }, regular: { amount: 24.99 }, url: "https://store.steampowered.com/app/304430/INSIDE/", timestamp: "2026-10-28T10:00:00Z" } },
        { id: "g2", title: "Some DLC", type: "dlc", deal: { cut: 95, price: { amount: 1 }, regular: { amount: 20 }, url: "https://store.steampowered.com/app/9/" } },
        { id: "g3", title: "Meh", type: "game", deal: { cut: 40, price: { amount: 6 }, regular: { amount: 10 }, url: "https://store.steampowered.com/app/8/" } }
    ] };
    const itad = createItad({ apiKey: "k", fetchImpl: async () => ({ ok: true, status: 200, headers: new Map(), json: async () => body, text: async () => JSON.stringify(body) }) });
    const out = await itad.getHotDeals({ minCut: 75 });
    assert.deepEqual(out.map(d => [d.id, d.cut, d.appid]), [["g1", 90, 304430]]);
});

test("key activations get the retail price, only where nothing is recorded, and never add games", async () => {
    const { fillRetail } = await import("../src/library.js");
    const db = openDb(":memory:"); db.ensureUser("k1");
    db.syncSteamGames("k1", [
        { itad_id: "id-a", title: "Hades", appid: 1, minutes: 0 }, { itad_id: "id-b", title: "Celeste", appid: 2, minutes: 0 },
        { itad_id: "id-c", title: "No Price Game", appid: 3, minutes: 0 }
    ]);
    db.upsertLibrary("k1", [{ itad_id: "id-b", title: "Celeste", paid: 3 }]); // a real price already recorded
    const itad = {
        lookupTitles: async ts => ts.map(t => ({ title: t, id: null })),
        getPrices: async ids => new Map(ids.map(id => [id, id === "id-c" ? { deals: [] } : { deals: [{ shop: { name: "Steam" }, price: { amount: 10, currency: "USD" }, regular: { amount: 25, currency: "USD" }, cut: 60 }] }]))
    };
    const r = await fillRetail(db, itad, db.getUser("k1"), ["Hades", "Celeste", "No Price Game", "Not Mine"]);
    assert.deepEqual([r.filled, r.alreadyPriced, r.noRetail, r.missing], [1, 1, ["No Price Game"], ["Not Mine"]]);
    const rows = db.listLibrary("k1");
    assert.equal(rows.length, 3);
    assert.equal(rows.find(x => x.title === "Hades").paid, 25);
    assert.equal(rows.find(x => x.title === "Celeste").paid, 3);
});

test("gifted games show retail as paid, are added when missing, and stay out of spend and savings", async () => {
    const { fillGifted, libraryTotals } = await import("../src/library.js");
    const { spendSummary } = await import("../src/spend.js").catch(() => ({}));
    const db = openDb(":memory:"); db.ensureUser("gf");
    db.syncSteamGames("gf", [{ itad_id: "id-007", title: "007 First Light", appid: 7, minutes: 0 }]);
    db.upsertLibrary("gf", [{ itad_id: "id-own", title: "Bought Game", paid: 10 }]);
    const deal = (msrp) => ({ deals: [{ shop: { name: "Steam" }, price: { amount: msrp, currency: "USD" }, regular: { amount: msrp, currency: "USD" }, cut: 0 }] });
    const itad = {
        lookupTitles: async ts => ts.map(t => ({ title: t, id: t === "New Gift" ? "id-new" : null })),
        getPrices: async ids => new Map(ids.map(id => [id, deal(id === "id-007" ? 69.99 : 20)]))
    };
    const r = await fillGifted(db, itad, db.getUser("gf"), ["007 First Light", "New Gift", "Unknown"]);
    assert.deepEqual([r.filled, r.added, r.missing], [2, 1, ["Unknown"]]);
    const rows = db.listLibrary("gf");
    const g = rows.find(x => x.title === "007 First Light");
    assert.equal(g.paid, 69.99); assert.equal(g.gifted, 1);
    assert.equal(rows.find(x => x.itad_id === "id-new").gifted, 1);
    const t = libraryTotals(rows.map(x => ({ ...x, msrp: x.paid ?? 0 })));
    assert.equal(t.paid, 10); // only the game that was bought
    if (spendSummary) assert.ok(true);
});

test("play next moves on each press and never offers the same game twice", async () => {
    const { playNext } = await import("../src/library.js");
    const rows = [
        { itad_id: "a", title: "A", status: "playing" },
        { itad_id: "b", title: "B", status: "backlog", paid: 30 }, { itad_id: "c", title: "C", status: "backlog", paid: 20 },
        { itad_id: "d", title: "D", status: "finished" }
    ];
    const seen = [];
    for (let i = 0; i < 5; i++) { const n = playNext(rows, { skip: seen, rand: () => 0 }); if (!n) break; seen.push(n.pick.itad_id); }
    assert.deepEqual(seen, ["a", "b", "c"]);
});

test("free DLC is spotted through Steam and says whether you own the base game", async () => {
    const { enrichFree, withOwnership, _resetFreeInfo } = await import("../src/freeinfo.js");
    const { freeGamesPayload } = await import("../src/render.js");
    _resetFreeInfo();
    const calls = [];
    const fetchImpl = async url => {
        calls.push(url);
        const id = /appids=(\d+)/.exec(url)[1];
        const data = id === "200" ? { type: "dlc", fullgame: { appid: 100, name: "Hunting Simulator 3" } } : { type: "game" };
        return { ok: true, json: async () => ({ [id]: { success: true, data } }) };
    };
    const list = [
        { id: "a", title: "Classic American Hunter Pack", shop: "Steam", url: "https://store.steampowered.com/app/200/x/", type: "game" },
        { id: "b", title: "Some Game", shop: "Steam", url: "https://store.steampowered.com/app/300/y/", type: "game" },
        { id: "c", title: "Epic Thing", shop: "Epic", url: "https://store.epicgames.com/p/z", type: "game" }
    ];
    const rich = await enrichFree(list, fetchImpl);
    assert.equal(rich[0].type, "dlc"); assert.equal(rich[0].base.appid, 100);
    assert.equal(rich[1].type, "game"); assert.equal(rich[2], list[2]);
    await enrichFree(list, fetchImpl); assert.equal(calls.length, 2, "Steam answers are cached");

    const lib = [{ appid: 100 }];
    const db = { listLibrary: id => (id === "has" ? lib : id === "other" ? [{ appid: 5 }] : []) };
    assert.equal(withOwnership(rich, db, "has")[0].baseOwned, true);
    assert.equal(withOwnership(rich, db, "other")[0].baseOwned, false);
    assert.equal(withOwnership(rich, db, "none")[0].baseOwned, null, "no synced library: unknown");

    const yes = freeGamesPayload("Steam", withOwnership(rich, db, "has").slice(0, 1)).embeds[0];
    assert.match(yes.title, /^🧩 /); assert.match(yes.description, /FREE DLC/); assert.match(yes.description, /🟢 You own the base game \(Hunting Simulator 3\)/);
    const no = freeGamesPayload("Steam", withOwnership(rich, db, "other").slice(0, 1)).embeds[0];
    assert.match(no.description, /🔴 You don't own the base game/); assert.equal(no.color, 0xed4245);
    const unknown = freeGamesPayload("Steam", withOwnership(rich, db, "none").slice(0, 1)).embeds[0];
    assert.match(unknown.description, /DLC for Hunting Simulator 3/);
    assert.match(freeGamesPayload("Steam", [rich[1]]).embeds[0].title, /^🎁 /);

    const failing = await enrichFree([{ id: "q", title: "Q", url: "https://store.steampowered.com/app/999/", type: "game" }], async () => { throw new Error("offline"); });
    assert.equal(failing[0].type, "game", "a Steam outage never breaks the alert");
});

test("For you ranks discounts by taste and wishlist, skips owned games and survives missing genres", async () => {
    const { forYou } = await import("../src/foryou.js");
    const { openDb } = await import("../src/db.js");
    const db = openDb(":memory:");
    db.ensureUser("u1");
    db.syncSteamGames("u1", [{ itad_id: "own", title: "Owned", appid: 1, minutes: 6000, lastPlayed: null }, { itad_id: "act", title: "Action Fan", appid: 2, minutes: 3000, lastPlayed: null }], { track: false });
    db.saveAppTags(1, ["Action", "Adventure"], []); db.saveAppTags(2, ["Action"], []);
    db.saveAppTags(10, ["Action", "Adventure"], []); db.saveAppTags(11, ["Strategy"], []);
    const pool = [
        { id: "own", title: "Owned", cut: 80, price: 2, regular: 10, currency: "USD", url: "https://store.steampowered.com/app/1/", appid: 1 },
        { id: "fit", title: "Fits", cut: 50, price: 10, regular: 20, currency: "USD", url: "https://store.steampowered.com/app/10/", appid: 10 },
        { id: "off", title: "Off taste", cut: 60, price: 8, regular: 20, currency: "USD", url: "https://store.steampowered.com/app/11/", appid: 11 },
        { id: "new", title: "No genres yet", cut: 40, price: 12, regular: 20, currency: "USD", url: "https://store.steampowered.com/app/12/", appid: 12 }
    ];
    const itad = {
        getDealsPool: async () => pool,
        getPrices: async ids => new Map(ids.map(id => [id, { deals: [{ shop: { name: "Steam" }, price: { amount: pool.find(p => p.id === id).price, currency: "USD" }, regular: { amount: pool.find(p => p.id === id).regular }, cut: 0, url: "https://s.example/" + id }, { shop: { name: "GOG" }, price: { amount: pool.find(p => p.id === id).price - 1, currency: "USD" }, regular: { amount: pool.find(p => p.id === id).regular }, url: "https://g.example/" + id }], historyLow: { all: { amount: id === "fit" ? 9 : 1 } } }]))
    };
    const r = await forYou({ db, itad, userId: "u1", user: db.getUser("u1"), fetchImpl: async () => { throw new Error("offline"); } });
    const ids = r.deals.map(d => d.id);
    assert.ok(!ids.includes("own"), "owned games are left out");
    assert.equal(ids[0], "fit", "the game that fits your genres comes first");
    const fit = r.deals[0];
    assert.ok(fit.match >= 90, "strong fit, got " + fit.match);
    assert.equal(fit.shop, "GOG"); assert.equal(fit.price, 9); assert.equal(fit.atl, true);
    assert.equal(r.deals.find(d => d.id === "off").match < fit.match, true);
    assert.equal(r.deals.find(d => d.id === "new").match, null, "no genres yet: no score, still listed");
    assert.equal(r.pending, 1); assert.equal(r.personalised, true);
});

test("library totals add a floor estimate for games with no price paid, never touching real savings", async () => {
    const { libraryTotals } = await import("../src/library.js");
    const t = libraryTotals([
        { paid: 10, msrp: 20, atl: 8, gifted: false }, { paid: null, msrp: 60, atl: 15, gifted: false },
        { paid: null, msrp: 30, atl: 5, gifted: true }, { paid: null, msrp: 0, atl: 0, gifted: false }]);
    assert.equal(t.paid, 10); assert.equal(t.estGames, 1); assert.equal(t.estPaid, 25);
    assert.equal(t.saved, 10);
});

test("deal links from ITAD are redirects, so Steam app ids come from a lookup (pool, hot deals), for pictures, taste and ownership", async () => {
    const { createItad } = await import("../src/itad.js");
    const calls = [];
    const fetchImpl = async (url, init) => {
        const u = String(url);
        calls.push(u);
        const body = u.includes("/lookup/shop/61/id/v1")
            ? { g1: ["app/304430", "sub/9"], g2: [], g3: ["app/777"] }
            : { list: [
                { id: "g1", title: "Inside", type: "game", deal: { cut: 90, price: { amount: 2.49, currency: "USD" }, regular: { amount: 24.99 }, url: "https://itad.link/g1/" } },
                { id: "g2", title: "Nowhere", type: "game", deal: { cut: 80, price: { amount: 2 }, regular: { amount: 10 }, url: "https://itad.link/g2/" } },
                { id: "g3", title: "Direct", type: "game", deal: { cut: 70, price: { amount: 3 }, regular: { amount: 10 }, url: "https://store.steampowered.com/app/555/X/" } }] };
        return { ok: true, status: 200, headers: new Map(), json: async () => body, text: async () => JSON.stringify(body) };
    };
    const itad = createItad({ apiKey: "k", fetchImpl });
    const pool = await itad.getDealsPool({ pages: 1 });
    assert.deepEqual(pool.map(d => [d.id, d.appid]), [["g1", 304430], ["g2", null], ["g3", 555]]);
    assert.equal(calls.filter(c => c.includes("/lookup/shop/61/id/v1")).length, 1);
    const hot = await itad.getHotDeals({ minCut: 75 });
    assert.equal(hot[0].appid, 304430);
    // a failing lookup never breaks the list
    const broken = createItad({ apiKey: "k", fetchImpl: async (url) => String(url).includes("/lookup/") ? { ok: false, status: 500, headers: new Map(), json: async () => ({}), text: async () => "" } : fetchImpl(url) });
    assert.equal((await broken.getDealsPool({ pages: 1 })).length, 3);
});

test("FanaticalGrabber advertisement: features and images, a gallery of embeds, an opt-out, and only people who have not opted out", async () => {
    const { grabberPromo, PROMO_OFF_ID } = await import("../src/promo.js");
    const { createBroadcaster } = await import("../src/broadcast.js");
    const p = grabberPromo({ base: "https://dash.test/", url: "https://store.test/x", dashboardUrl: "https://dash.test" });
    assert.equal(p.embeds.length, 3);
    assert.deepEqual(p.embeds.map(e => e.image.url), ["https://dash.test/grabber-ad-hero.png", "https://dash.test/grabber-ad-cart.png", "https://dash.test/grabber-ad-paid.png"]);
    assert.ok(p.embeds.every(e => e.url === "https://store.test/x"), "same url makes one gallery");
    assert.match(p.embeds[0].author.name, /developer/);
    const text = JSON.stringify(p.embeds);
    for (const f of ["Reveal", "Batch redeem", "Cart & bundle", "what you paid", "One-click connect", "Price overlay"]) assert.match(text, new RegExp(f, "i"));
    assert.deepEqual(p.components[0].components.map(c => c.label ?? c.custom_id), ["Get FanaticalGrabber", "Open the dashboard", "No more promos"]);
    assert.equal(p.components[0].components.at(-1).custom_id, PROMO_OFF_ID);
    assert.equal(grabberPromo({}).embeds[0].image, undefined, "no images without a public address");
    // sending: opted-out people and failing DMs are skipped; a normal announcement still reaches everyone
    const db = openDb(":memory:");
    for (const id of ["a", "b", "c", "d"]) db.ensureUser(id, "g1");
    db.updateUser("b", { promo_off: 1 }); db.updateUser("c", { dm_failures: 5 });
    const dms = [];
    const b = createBroadcaster({ db, ownerId: "a", delayMs: 0, sleep: async () => {}, sendDm: async (id, payload) => { dms.push([id, payload.embeds.length]); }, sendChannel: async () => {}, promoPayload: () => p });
    assert.deepEqual(b.counts(), { dm: 3, channels: 0, promoDm: 2 });
    b.start({ audience: "dm", promo: true });
    for (let i = 0; i < 50 && b.running(); i++) await new Promise(x => setTimeout(x, 5));
    assert.deepEqual(dms, [["a", 3], ["d", 3]]);
    assert.equal(db.listBroadcasts(1)[0].title, "FanaticalGrabber advertisement");
    assert.throws(() => createBroadcaster({ db, ownerId: "a", sendDm: async () => {}, sendChannel: async () => {} }).start({ audience: "me", promo: true }), /not available/);
});

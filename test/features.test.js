import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { createNotifier } from "../src/notify.js";
import { freeGamesPayload } from "../src/render.js";
import { runCycle, runExtras, runDigests, runSnapshots, runFreeGames } from "../src/poller.js";
import { validTimezone, localParts, parseClock, formatClock, isQuiet, digestDue } from "../src/timeutil.js";
import { prefsPatch } from "../src/prefs.js";
import { dealVerdict } from "../src/alerts.js";
import { importLibrary, libraryView, libraryTotals, leaderboard } from "../src/library.js";
import { addToServerList, vote, removeFromServerList, serverListView } from "../src/serverlist.js";
import { createLimiter } from "../src/ratelimit.js";
import { runBackup } from "../src/backup.js";
import { createOps } from "../src/ops.js";
import { createItad } from "../src/itad.js";
import { UserError } from "../src/errors.js";

const deal = (amount, regular, shop = "GOG") => ({ shop: { name: shop }, price: { amount, currency: "USD" }, regular: { amount: regular, currency: "USD" }, cut: 0, url: "https://deal.example/x" });
const HOUR = 3600_000;

function rig({ prices = {}, bundles = new Map(), giveaways = new Map(), freeList = [] } = {}) {
    const db = openDb(":memory:");
    const sent = [], posts = [];
    const discord = {
        sendDm: async (id, p) => { sent.push({ via: "dm", id, p }); },
        sendChannel: async (id, p) => { posts.push({ id, p }); }
    };
    const itad = {
        getPrices: async ids => new Map(ids.map(id => [id, prices[id] ?? { deals: [] }])),
        lookupTitles: async titles => titles.map(t => (/^zzz/i.test(t) ? { title: t, id: null } : { title: t, id: "id-" + t.toLowerCase().replace(/\W+/g, ""), approx: false, matched: t })),
        getBundles: async ids => new Map(ids.map(id => [id, bundles.get(id) ?? []])),
        getGiveaways: async () => giveaways,
        getGiveawayList: async () => freeList
    };
    return { db, sent, posts, itad, notifier: createNotifier({ db, discord }) };
}
const watch = (db, user, ids, guild = "g1") => { db.ensureUser(user, guild); db.addItems(user, ids.map(id => ({ itad_id: id, title: `Title ${id}` }))); };

// ---------- time ----------
test("clock parsing and quiet hours across midnight", () => {
    assert.equal(parseClock("22:30"), 1350);
    assert.equal(parseClock("10pm"), 1320);
    assert.equal(parseClock("12am"), 0);
    assert.equal(parseClock("25:00"), null);
    assert.equal(parseClock("soon"), null);
    assert.equal(formatClock(1350), "22:30");
    assert.ok(validTimezone("America/New_York"));
    assert.ok(!validTimezone("Mars/Base"));
    const user = { quiet_start: 22 * 60, quiet_end: 7 * 60, tz: "UTC" };
    const at = h => Date.UTC(2026, 0, 5, h, 0);
    assert.equal(isQuiet(user, at(23)), true);
    assert.equal(isQuiet(user, at(3)), true);
    assert.equal(isQuiet(user, at(12)), false);
    assert.equal(isQuiet({ ...user, quiet_start: null }, at(23)), false);
    // the same moment is a different local hour in another zone
    assert.equal(localParts(at(12), "Asia/Tokyo").minutes, 21 * 60);
});

test("weekly digest is due once, on the chosen day, from 9:00 local time", () => {
    const monday = h => Date.UTC(2026, 0, 5, h, 0); // 2026-01-05 is a Monday
    const user = { digest: 1, digest_day: 1, tz: "UTC", last_digest_at: null };
    assert.equal(digestDue(user, monday(8)), false);
    assert.equal(digestDue(user, monday(9)), true);
    assert.equal(digestDue({ ...user, last_digest_at: monday(9) }, monday(15)), false);
    assert.equal(digestDue({ ...user, digest_day: 2 }, monday(10)), false);
    assert.equal(digestDue({ ...user, digest: 0 }, monday(10)), false);
});

test("settings input is validated the same way everywhere", () => {
    const u = { quiet_start: null, quiet_end: null };
    assert.deepEqual(prefsPatch({ quiet_start: "22:00", quiet_end: "7am", tz: "Europe/London" }, u), { quiet_start: 1320, quiet_end: 420, tz: "Europe/London" });
    assert.deepEqual(prefsPatch({ quiet_start: null, quiet_end: null }, { quiet_start: 1, quiet_end: 2 }), { quiet_start: null, quiet_end: null });
    assert.throws(() => prefsPatch({ quiet_start: "22:00" }, u), UserError);
    assert.throws(() => prefsPatch({ quiet_start: "22:00", quiet_end: "22:00" }, u), UserError);
    assert.throws(() => prefsPatch({ quiet_start: "later", quiet_end: "7am" }, u), UserError);
    assert.throws(() => prefsPatch({ tz: "Nowhere/Land" }, u), UserError);
    assert.throws(() => prefsPatch({ digest_day: 9 }, u), UserError);
    assert.deepEqual(prefsPatch({ digest: true, digest_day: 5, bundles: false, share: true }, u), { digest: 1, digest_day: 5, bundles: 0, share: 1 });
});

test("deal verdicts", () => {
    const base = { price: 10, atl: 10, low1y: 10, low3m: 10, discount: 0.5 };
    assert.equal(dealVerdict(base).level, "great");
    assert.equal(dealVerdict({ ...base, atl: 5, low1y: 10 }).level, "good");
    assert.equal(dealVerdict({ ...base, atl: 5, low1y: 6, low3m: 6 }).level, "wait");
    assert.equal(dealVerdict({ price: null }), null);
});

// ---------- database ----------
test("alert history, library, server list and stats; deleting a user clears all of it", () => {
    const { db } = rig();
    db.ensureUser("u1", "g1");
    db.logAlert({ discord_id: "u1", title: "A", kind: "sale", price: 5, via: "dm" });
    assert.equal(db.listAlerts("u1").length, 1);
    assert.equal(db.hasSeen("u1", "k"), false);
    db.markSeen("u1", "k");
    assert.equal(db.hasSeen("u1", "k"), true);

    assert.deepEqual(db.upsertLibrary("u1", [{ itad_id: "a", title: "A", paid: 5 }, { itad_id: "b", title: "B", paid: null }]), { added: 2, updated: 0, skippedForLimit: 0 });
    assert.equal(db.upsertLibrary("u1", [{ itad_id: "a", title: "A", paid: 7 }]).updated, 1);
    assert.equal(db.listLibrary("u1").find(x => x.itad_id === "a").paid, 7);

    const added = db.addServerGame("g1", { itad_id: "a", title: "A" }, "u1");
    assert.ok(added.added);
    assert.ok(db.addServerGame("g1", { itad_id: "a", title: "A" }, "u1").existing);
    const [row] = db.listServerGames("g1", "u1");
    assert.equal(row.votes, 1);
    assert.equal(row.voted, true);
    assert.equal(db.toggleVote(row.id, "u2"), true);
    assert.equal(db.listServerGames("g1", "u3")[0].votes, 2);
    assert.equal(db.listServerGames("g1", "u3")[0].voted, false);

    db.upsertSnapshot("u1", { games: 2, paid: 7, msrp: 40, cheapest: 20 });
    assert.equal(db.listSnapshots("u1").length, 1);
    assert.equal(db.stats().libraryGames, 2);
    assert.ok("exportUser" in db && db.exportUser("u1").library.length === 2);

    db.deleteUser("u1");
    assert.equal(db.listAlerts("u1").length, 0);
    assert.equal(db.listLibrary("u1").length, 0);
    assert.equal(db.listSnapshots("u1").length, 0);
    assert.equal(db.listServerGames("g1", "x").length, 0);
});

// ---------- library ----------
test("library totals count savings only for games with a price paid", async () => {
    const t = rig({ prices: { "id-hades": { deals: [deal(12, 25)], historyLow: { all: { amount: 10 } } }, "id-celeste": { deals: [deal(8, 20)], historyLow: { all: { amount: 5 } } } } });
    t.db.ensureUser("u1", "g1");
    const r = await importLibrary(t.db, t.itad, "u1", [{ title: "Hades", paid: 10 }, { title: "Celeste", paid: null }, { title: "zzz nope", paid: 1 }]);
    assert.equal(r.added, 2);
    assert.deepEqual(r.notFound, ["zzz nope"]);
    const view = await libraryView(t.db, t.itad, t.db.getUser("u1"));
    assert.equal(view.totals.games, 2);
    assert.equal(view.totals.paidGames, 1);
    assert.equal(view.totals.paid, 10);
    assert.equal(view.totals.saved, view.rows.find(x => x.title === "Hades").msrp - 10);
    assert.equal(view.snapshots.length, 1);
    assert.equal(libraryTotals([]).saved, 0);
});

test("the leaderboard only shows members who opted in, ranked by percent saved", () => {
    const { db } = rig();
    for (const [id, share, paid, msrp] of [["a", 1, 10, 100], ["b", 1, 50, 100], ["c", 0, 1, 100]]) {
        db.ensureUser(id, "g1"); db.updateUser(id, { share });
        db.upsertSnapshot(id, { games: 3, paid, msrp, msrp_paid: msrp, cheapest: 50 });
    }
    const board = leaderboard(db, "g1");
    assert.deepEqual(board.map(e => e.discord_id), ["a", "b"]);
    assert.equal(Math.round(board[0].savedPct), 90);
    assert.deepEqual(leaderboard(db, "other"), []);
});

// ---------- server list ----------
test("server list: add, vote toggle, and who may remove", async () => {
    const t = rig({ prices: { "id-hades": { deals: [deal(12, 25)] } } });
    t.db.ensureUser("u1", "g1"); t.db.ensureUser("u2", "g1");
    await addToServerList(t.db, t.itad, "g1", "u1", "Hades");
    await assert.rejects(() => addToServerList(t.db, t.itad, "g1", "u2", "Hades"), UserError);
    await assert.rejects(() => addToServerList(t.db, t.itad, "g1", "u2", "zzz nope"), UserError);
    assert.deepEqual(vote(t.db, "g1", "u2", "hades"), { title: "Hades", voted: true, votes: 2 });
    assert.equal(vote(t.db, "g1", "u2", "hades").voted, false);
    const view = await serverListView(t.db, t.itad, "g1", t.db.getUser("u2"));
    assert.equal(view.rows[0].votes, 1);
    assert.throws(() => removeFromServerList(t.db, "g1", "u2", "hades", false), UserError);
    assert.deepEqual(removeFromServerList(t.db, "g1", "u2", "hades", true), { title: "Hades" });
    assert.throws(() => vote(t.db, "g1", "u1", "hades"), UserError);
});

// ---------- poller ----------
test("quiet hours hold an alert, then it is sent after and not lost", async () => {
    const t = rig({ prices: { a: { deals: [deal(10, 20)] } } });
    watch(t.db, "u1", ["a"]);
    t.db.updateUser("u1", { quiet_start: 22 * 60, quiet_end: 7 * 60, tz: "UTC" });
    const night = () => Date.UTC(2026, 0, 5, 23, 0);
    const s1 = await runCycle({ ...t, now: night });
    assert.deepEqual([s1.alerts, s1.deferred, s1.delivered], [1, 1, 0]);
    assert.equal(t.sent.length, 0);
    const s2 = await runCycle({ ...t, now: () => Date.UTC(2026, 0, 6, 8, 0) });
    assert.equal(s2.delivered, 1);
    assert.equal(t.db.listAlerts("u1")[0].kind, "sale");
});

test("group alert: posts once when enough opted-in members watch the same game", async () => {
    const t = rig({ prices: { a: { deals: [deal(10, 20)] } } });
    t.db.setGuildChannel("g1", "chan", "admin");
    t.db.setGroupMin("g1", 2);
    for (const id of ["u1", "u2", "u3"]) watch(t.db, id, ["a"]);
    t.db.updateUser("u1", { share: 1 }); t.db.updateUser("u2", { share: 1 }); // u3 did not opt in
    const s = await runCycle(t);
    assert.equal(s.groupPosts, 1);
    const post = t.posts.find(p => p.p.embeds[0].title.includes("members are watching"));
    assert.match(post.p.embeds[0].title, /^2 members/);
    assert.deepEqual(post.p.allowedMentions, { parse: [] });
    // a second cycle with no change does not repeat it
    t.db.setTrigger("u1", "any", null); t.db.setTrigger("u2", "any", null);
    const s2 = await runCycle(t);
    assert.equal(s2.groupPosts, 0);
});

test("group alert does not fire below the minimum", async () => {
    const t = rig({ prices: { a: { deals: [deal(10, 20)] } } });
    t.db.setGuildChannel("g1", "chan", "admin"); t.db.setGroupMin("g1", 3);
    watch(t.db, "u1", ["a"]); watch(t.db, "u2", ["a"]);
    t.db.updateUser("u1", { share: 1 }); t.db.updateUser("u2", { share: 1 });
    assert.equal((await runCycle(t)).groupPosts, 0);
});

test("bundles and giveaways: announced once per member, and respect the opt-out", async () => {
    const bundle = { id: "b1", title: "Humble Bundle", shop: "Humble", url: "https://x.example/b", expiry: null, price: 12, currency: "USD" };
    const t = rig({ bundles: new Map([["a", [bundle]]]), giveaways: new Map([["c", [{ id: "g1", title: "Free!", shop: "Epic", url: "https://x.example/g", expiry: null }]]]) });
    watch(t.db, "u1", ["a", "c"]); watch(t.db, "u2", ["a"]);
    t.db.updateUser("u2", { bundles: 0 });
    const s1 = await runExtras(t);
    assert.deepEqual([s1.found, s1.delivered], [2, 2]);
    assert.equal(t.sent.every(m => m.id === "u1"), true);
    assert.deepEqual(t.db.listAlerts("u1").map(a => a.kind).sort(), ["bundle", "giveaway"]);
    const s2 = await runExtras(t);
    assert.equal(s2.found, 0);
});

test("weekly digest is sent once, and snapshots are made once a day", async () => {
    const t = rig({ prices: { a: { deals: [deal(10, 20)] } } });
    watch(t.db, "u1", ["a"]);
    t.db.updateUser("u1", { digest: 1, digest_day: 1, tz: "UTC" });
    const monday = () => Date.UTC(2026, 0, 5, 10, 0);
    assert.equal((await runDigests({ ...t, now: monday })).sent, 1);
    assert.equal((await runDigests({ ...t, now: monday })).due, 0);
    assert.equal(t.sent[0].p.embeds[0].title, "Your weekly wishlist digest");

    t.db.upsertLibrary("u1", [{ itad_id: "a", title: "A", paid: 5 }]);
    assert.equal(await runSnapshots(t), 1);
    assert.equal(await runSnapshots(t), 0);
});

// ---------- small modules ----------
test("rate limiter allows up to max per window, then resets", () => {
    let now = 0;
    const l = createLimiter({ windowMs: 1000, max: 2, now: () => now });
    assert.ok(l.hit("k").ok); assert.ok(l.hit("k").ok);
    const blocked = l.hit("k");
    assert.equal(blocked.ok, false);
    assert.ok(blocked.retryAfterS >= 1);
    assert.ok(l.hit("other").ok);
    now = 1001;
    assert.ok(l.hit("k").ok);
});

test("backups: one per day, oldest removed beyond the limit", () => {
    const db = openDb(":memory:");
    db.ensureUser("u1");
    const dir = mkdtempSync(join(tmpdir(), "svc-backup-"));
    let day = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 4; i++) { runBackup({ db, dir, keep: 3, now: () => day }); day += 86400_000; }
    assert.equal(readdirSync(dir).length, 3);
    assert.equal(runBackup({ db, dir, keep: 3, now: () => day - 86400_000 }).skipped, true);
    const copy = readdirSync(dir).sort().pop();
    assert.ok(existsSync(join(dir, copy)));
    // the copy is a real database with the data in it
    const restored = openDb(join(dir, copy));
    assert.ok(restored.getUser("u1"));
    restored.close();
});

test("owner alerts are throttled, and failures are tracked", async () => {
    let now = 0;
    const messages = [];
    const ops = createOps({ now: () => now, sendOwner: async m => { messages.push(m); }, throttleMs: 1000 });
    for (let i = 0; i < 3; i++) await ops.cycleDone({ priceErrors: 1, lastErrorCode: "network" });
    assert.equal(messages.length, 1);
    await ops.cycleDone({ priceErrors: 1, lastErrorCode: "network" });
    assert.equal(messages.length, 1); // throttled
    now = 2000;
    await ops.cycleDone({ priceErrors: 1, lastErrorCode: "network" });
    assert.equal(messages.length, 2);
    await ops.cycleDone({ priceErrors: 0, alerts: 0 });
    assert.equal(ops.snapshot().priceFailStreak, 0);
    await ops.backupDone(null, new Error("disk full"));
    assert.equal(ops.snapshot().backup.ok, false);
    assert.ok(!JSON.stringify(messages).includes("key="));
});

// ---------- ITAD client: new endpoints ----------
test("ITAD client reads bundles, giveaways and history defensively", async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
        const u = new URL(url);
        calls.push(u.pathname);
        const json = body => ({ ok: true, status: 200, headers: new Map(), json: async () => body });
        if (u.pathname === "/games/overview/v2") {
            return json({ prices: [], bundles: [
                { id: 1, title: "Old", expiry: "2000-01-01T00:00:00Z", tiers: [{ price: { amount: 5, currency: "USD" }, games: [{ id: "a" }] }] },
                { id: 2, title: "Good", expiry: "2999-01-01T00:00:00Z", page: { name: "Humble" }, url: "https://b.example", tiers: [
                    { price: { amount: 18, currency: "USD" }, games: [{ id: "a" }] }, { price: { amount: 10, currency: "USD" }, games: [{ id: "a" }, { id: "zzz" }] }] }
            ] });
        }
        if (u.pathname === "/giveaways/v1") return json([{ id: 9, title: "Free", expiry: "2999-01-01T00:00:00Z", shop: { name: "Epic" }, games: [{ id: "a" }] }, { id: 10, expiry: "2000-01-01T00:00:00Z", games: [{ id: "b" }] }]);
        if (u.pathname === "/games/history/v2") return json([{ timestamp: "2026-01-02T00:00:00Z", shop: { name: "GOG" }, deal: { price: { amount: 9 }, regular: { amount: 20 } } }, { timestamp: "bad", deal: { price: { amount: 1 } } }, { timestamp: "2026-01-01T00:00:00Z", shop: { name: "GOG" }, deal: { price: { amount: 10 } } }]);
        throw new Error("unexpected " + u.pathname);
    };
    const itad = createItad({ apiKey: "KEY", fetchImpl, now: () => Date.UTC(2026, 5, 1) });
    const b = await itad.getBundles(["a", "q"], "US");
    assert.equal(b.get("a").length, 1);
    assert.equal(b.get("a")[0].price, 10); // the cheapest tier that includes the game
    assert.deepEqual(b.get("q"), []);
    await itad.getBundles(["a"], "US");
    assert.equal(calls.filter(p => p === "/games/overview/v2").length, 1); // cached
    const g = await itad.getGiveaways();
    assert.deepEqual([...g.keys()], ["a"]); // the expired one is dropped
    const hist = await itad.getHistory("a", "US");
    assert.deepEqual(hist.map(p => p.price), [10, 9]); // sorted, bad row dropped
});

const free = (id, title, shop, url = "https://store.example/" + id) => ({ id, title, shop, url, expiry: null, gameIds: [] });

test("free games: one message per platform, Claim all for several, once per member, opt-in only", async () => {
    const t = rig({ freeList: [free("1", "Alpha", "Epic Game Store"), free("2", "Beta", "Epic Game Store"), free("3", "Gamma", "Steam"), free("4", "Bad", "GOG", "javascript:alert(1)")] });
    t.db.ensureUser("u1", "g1"); t.db.ensureUser("u2", "g1");
    t.db.updateUser("u1", { free: 1 });
    const s1 = await runFreeGames(t);
    assert.equal(t.sent.length, 2); // Epic and Steam, each one message; u2 did not opt in
    assert.ok(t.sent.every(m => m.id === "u1"));
    const epic = t.sent.find(m => /Epic/.test(m.p.content)).p;
    assert.equal(epic.embeds.length, 2);
    assert.equal(epic.components[0].components[0].label, "Claim all (2)");
    assert.equal(epic.components[0].components[0].custom_id, "free_claim_all");
    const steam = t.sent.find(m => /Steam/.test(m.p.content)).p;
    assert.deepEqual([steam.components[0].components[0].label, steam.components[0].components[0].style], ["Claim game", 5]);
    assert.equal(s1.delivered, 3);
    assert.equal((await runFreeGames(t)).found, 0); // already told
    assert.deepEqual(t.db.listAlerts("u1").map(a => a.kind), ["free", "free", "free"]);
});

test("free games: a reminder goes out once when an announced giveaway is about to end", async () => {
    const T0 = Date.UTC(2026, 0, 5, 12);
    const g = { ...free("1", "Alpha", "Steam"), expiry: T0 + 20 * 3600_000 };
    const far = { ...free("2", "Beta", "Steam"), expiry: T0 + 5 * 86400_000 };
    const t = rig({ freeList: [g, far] });
    t.db.ensureUser("u1", "g1"); t.db.updateUser("u1", { free: 1 });
    const at = ms => ({ ...t, now: () => ms });
    // it is announced as soon as it is first seen (here already inside the last day, so the announcement is the first message)
    await runFreeGames(at(T0));
    const first = t.sent.length;
    const r1 = await runFreeGames(at(T0 + 1000));
    assert.equal(r1.reminded, 1, "only the giveaway ending within a day");
    assert.equal(t.sent.length, first + 1);
    assert.match(t.sent.at(-1).p.content, /Last chance/);
    assert.equal((await runFreeGames(at(T0 + 2000))).reminded, undefined, "never twice");
    // after it ends it is not reminded
    const t2 = rig({ freeList: [{ ...g, expiry: T0 - 1 }] });
    t2.db.ensureUser("u1", "g1"); t2.db.updateUser("u1", { free: 1 }); t2.db.markSeen("u1", "free:1");
    assert.equal((await runFreeGames({ ...t2, now: () => T0 })).reminded, undefined);
});

test("free games respect quiet hours and are sent afterwards", async () => {
    const t = rig({ freeList: [free("1", "Alpha", "Steam")] });
    t.db.ensureUser("u1", "g1");
    t.db.updateUser("u1", { free: 1, quiet_start: 22 * 60, quiet_end: 7 * 60, tz: "UTC" });
    assert.equal((await runFreeGames({ ...t, now: () => Date.UTC(2026, 0, 5, 23) })).deferred, 1);
    assert.equal(t.sent.length, 0);
    assert.equal((await runFreeGames({ ...t, now: () => Date.UTC(2026, 0, 6, 9) })).delivered, 1);
});

test("free game messages only link https pages", () => {
    assert.equal(freeGamesPayload("GOG", [free("4", "Bad", "GOG", "http://x.example")]), null);
    assert.equal(freeGamesPayload("GOG", []), null);
});

test("the free games setting is validated like the others", () => {
    assert.deepEqual(prefsPatch({ free: true }, {}), { free: 1 });
    assert.deepEqual(prefsPatch({ free: false }, {}), { free: 0 });
});

test("every slash command has a dashboard counterpart", async () => {
    const { readFileSync } = await import("node:fs");
    const server = readFileSync(new URL("../src/dashboard/server.js", import.meta.url), "utf8");
    const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
    // command or command/subcommand -> a dashboard route (or page) that does the same job
    const MAP = {
        value: "POST /api/value", "wishlist/import": "POST /api/wishlist/import", "wishlist/add": "POST /api/wishlist/add",
        "wishlist/remove": "POST /api/wishlist/remove", "wishlist/view": "GET /api/wishlist", "wishlist/check": "GET /api/wishlist/history",
        "wishlist/alert": "POST /api/wishlist/alert", "wishlist/cleanup": "POST /api/wishlist/cleanup", "wishlist/priority": "POST /api/wishlist/priority",
        "currency": "POST /api/settings", redeem: "POST /api/redeem/finish", "calendar/view": "GET /api/calendar", "calendar/add": "POST /api/calendar/events", "calendar/remove": "POST /api/calendar/events/delete", "calendar/feed": "POST /api/calendar/feed", regions: "GET /api/regions", compare: "GET /api/compare", "redeem/history": "GET /api/redeem/history", "alerts/status": "GET /api/me", "alerts/history": "GET /api/alerts/history",
        "alerts/delivery": "POST /api/settings", "alerts/pause": "POST /api/settings", "alerts/resume": "POST /api/settings", "alerts/region": "POST /api/settings",
        "alerts/stores": "POST /api/settings", "alerts/quiethours": "POST /api/settings", "alerts/digest": "POST /api/settings", "alerts/bundles": "POST /api/settings",
        "alerts/freegames": "POST /api/settings", "alerts/mute": "POST /api/settings", "alerts/language": "POST /api/settings", changelog: "GET /api/changelog", "alerts/share": "POST /api/settings", "alerts/mindiscount": "POST /api/settings", "library/bundle": "POST /api/library/bundle", "library/bundles": "GET /api/library/bundles", "steam/goal": "POST /api/steam/goal",
        "alertchannel/set": "POST /api/servers/channel", "alertchannel/clear": "POST /api/servers/channel", "alertchannel/show": "GET /api/servers/channels",
        "alertchannel/group": "POST /api/servers/group", "alertchannel/feed": "POST /api/servers/feed", "alertchannel/hot": "POST /api/servers/hot", "alertchannel/sales": "POST /api/servers/sales", "alertchannel/digest": "POST /api/servers/digest", "serverstats": "GET /api/servers/stats",
        "library/add": "POST /api/library/add", "library/badges": "GET /api/library/badges", "library/trend": "GET /api/library", "library/import": "POST /api/library/import", "library/view": "GET /api/library", "library/grabber": "POST /api/grabber/token", "library/remove": "POST /api/library/remove", "library/challenge": "POST /api/library/challenge", "library/spend": "GET /api/library/spend", "library/status": "POST /api/library/status", "library/backlog": "GET /api/library/next",
        "serverlist/add": "POST /api/servers/list/add", "serverlist/view": "GET /api/servers/list", "serverlist/vote": "POST /api/servers/list/vote", "serverlist/remove": "POST /api/servers/list/remove",
        leaderboard: "GET /api/servers/leaderboard",
        "giveaway/create": "POST /api/giveaways/create", "giveaway/list": "GET /api/giveaways", "giveaway/info": "GET /api/giveaways/info", "giveaway/end": "POST /api/giveaways/end",
        "giveaway/cancel": "POST /api/giveaways/cancel", "giveaway/reroll": "POST /api/giveaways/reroll", "giveaway/replace": "POST /api/giveaways/replace", "giveaway/setup": "POST /api/giveaways/setup",
        "freegames": "GET /api/free", "sales": "GET /api/sales", "status": "GET /api/status", "publicpage": "POST /api/profile", "friend/add": "POST /api/friends/add", "friend/list": "GET /api/friends", "friend/remove": "POST /api/friends/remove", "friend/deals": "GET /api/friends/deals", "watch": "POST /api/wishlist/add", "mydata/export": "GET /api/mydata/download", "mydata/delete": "POST /api/mydata/delete",
        "steam/link": "POST /api/steam/link", "steam/sync": "POST /api/steam/sync", "steam/recap": "GET /api/steam/recap", "steam/taste": "GET /api/steam/taste", "steam/view": "GET /api/steam", "steam/next": "GET /api/steam/next", "steam/foryou": "GET /api/foryou", "steam/verify": "GET /api/steam/linkedroles", "community/verifyrole": "POST /api/community/verifyrole", "steam/value": "GET /api/steam/value.png", "profilecard": "GET /api/profile/card.png", "steam/unlink": "POST /api/steam/unlink",
        "lfg/post": "POST /api/lfg", "lfg/list": "GET /api/lfg", "lfg/close": "POST /api/lfg/close",
        "bundle": "GET /api/bundles", "saleprep/plan": "GET /api/saleprep", "saleprep/recap": "GET /api/saleprep/recap",
        "setup": "GET /api/servers/setup", "gamenight": "POST /api/gamenight", "bug": "POST /api/tickets", "support/open": "POST /api/tickets", "support/mine": "GET /api/tickets", "support/setup": "POST /api/tickets/setup",
        "community/setup": "POST /api/community/setup", "community/status": "GET /api/community", "community/welcome": "POST /api/community/welcome", "community/autorole": "POST /api/community/autorole", "community/xp": "POST /api/community/xp", "community/levelrole": "POST /api/community/levelrole", "community/referral": "POST /api/community/referral",
        rank: "GET /api/community/rank", levels: "GET /api/community/leaderboard", "invites/me": "GET /api/community/invites", "invites/top": "GET /api/community/invites", "invites/link": "POST /api/community/invite-link", "emoji/import": "POST /api/community/emoji", "emoji/list": "GET /api/community/emoji",
        "mod/warn": "POST /api/mod/action", "mod/timeout": "POST /api/mod/action", "mod/untimeout": "POST /api/mod/action", "mod/kick": "POST /api/mod/action", "mod/ban": "POST /api/mod/action", "mod/unban": "POST /api/mod/action", "mod/purge": "POST /api/mod/action",
        "mod/warnings": "GET /api/mod/cases", "mod/cases": "GET /api/mod/cases", "mod/clearwarns": "POST /api/mod/clearwarns", "mod/log": "POST /api/mod/log",
        leaderboardrefresh: "POST /api/community/leaderboard", grabberad: "POST /api/admin/broadcast",
        dashboard: "GET /api/me", dash: "GET /api/me",
        help: "cfg.help", about: "GET /api/about", privacy: "cfg.privacy"
    };
    // Read command names from the source so this runs without discord.js installed.
    const src = readFileSync(new URL("../src/commands.js", import.meta.url), "utf8");
    const names = [];
    let top = null;
    for (const line of src.split("\n")) {
        const t = line.match(/^    \.setName\("([a-z]+)"\)$/);
        if (t) { top = t[1]; names.push(top); continue; }
        const s = line.match(/addSubcommand\(s => s\.setName\("([a-z]+)"\)/);
        if (s) { const i = names.lastIndexOf(top); if (i >= 0 && names[i] === top) names.splice(i, 1); names.push(`${top}/${s[1]}`); }
    }
    assert.ok(names.length > 40, "found " + names.length + " commands");
    for (const n of names) {
        const target = MAP[n];
        assert.ok(target, `no dashboard mapping for /${n.replace("/", " ")}`);
        if (target.startsWith("cfg.")) assert.ok(app.includes("state." + target), target);
        else assert.ok(server.includes(`"${target}"`) || server.includes(`key === "${target}"`), `dashboard route missing: ${target}`);
    }
});

test("wishlist import keeps partial progress when ITAD rate limits, and does not prune", async () => {
    const { importWishlist } = await import("../src/steam.js");
    const { ItadError } = await import("../src/itad.js");
    const fetchImpl = async url => ({ ok: true, status: 200, json: async () => ({ response: { items: [{ appid: 1 }, { appid: 2 }, { appid: 3 }] } }) });
    let calls = 0;
    const itad = {
        lookupShopIds: async (_s, ids) => new Map(ids.map(i => [i, "id-" + i])),
        getTitle: async id => { if (++calls > 2) throw new ItadError("rate_limited", "slow"); return { title: "Game " + id }; }
    };
    const r = await importWishlist("76561198000000000", itad, { fetchImpl });
    assert.equal(r.rateLimited, true);
    assert.equal(r.complete, false);
    assert.ok(r.games.length >= 1 && r.games.length < 3);
});

test("sale alerts carry game art, a verdict color and buttons", async () => {
    const { alertPayload, STOP_ID } = await import("../src/render.js");
    const now = { price: 9.87, regular: 24.99, discount: 0.61, shop: "Fanatical", url: "https://shop.example/deal", atl: 9.83, currency: "USD", slug: "wanderstop" };
    const hit = { item: { id: 7, title: "Wanderstop", itad_id: "abc", appid: 1823510 }, now, reason: "new" };
    const one = alertPayload([hit], { trigger: () => "any sale", verdict: () => ({ level: "good", text: "At its 1-year low" }) });
    assert.equal(one.embeds[0].image.url, "https://cdn.akamai.steamstatic.com/steam/apps/1823510/header.jpg");
    assert.equal(one.embeds[0].title, "Wanderstop is 61% off");
    const labels = one.components[0].components.map(c => c.label);
    assert.deepEqual(labels, ["View deal at Fanatical", "Steam page", "Price history", "Stop watching"]);
    assert.equal(one.components[0].components[3].custom_id, `${STOP_ID}:7`);
    assert.equal(one.components[0].components[2].url, "https://isthereanydeal.com/game/wanderstop/info/");

    // several in one message: a small thumbnail and one row each
    const many = alertPayload([hit, { ...hit, item: { ...hit.item, id: 8, appid: null, itad_id: "xyz" } }], { trigger: () => "any sale", verdict: () => null });
    assert.equal(many.components.length, 2);
    assert.equal(many.embeds[0].image, undefined);
    assert.ok(many.embeds[1].thumbnail.url.includes("assets.isthereanydeal.com/xyz/"));
    // no deal link -> no broken button
    const bare = alertPayload([{ ...hit, now: { ...now, url: null, slug: null }, item: { id: 9, title: "X", itad_id: "q" } }], { trigger: () => "any sale", verdict: () => null });
    assert.deepEqual(bare.components[0].components.map(c => c.label), ["Stop watching"]);
});

test("steam import remembers the Steam id, and a later import fills it in for older games", async () => {
    const dir = mkdtempSync(join(tmpdir(), "svc-"));
    const db = openDb(join(dir, "t.db"));
    db.ensureUser("u1", "g1");
    db.addItems("u1", [{ itad_id: "a", title: "A" }], { source: "steam" });
    assert.equal(db.listItems("u1")[0].appid, null);
    db.setAppId("u1", "a", 123);
    assert.equal(db.listItems("u1")[0].appid, 123);
    db.setAppId("u1", "a", 999); // never overwrites
    assert.equal(db.listItems("u1")[0].appid, 123);
    assert.equal(db.getItemById(db.listItems("u1")[0].id).title, "A");
});

test("about: duration format, live numbers and the embed", async () => {
    const { formatDuration, collectAbout } = await import("../src/about.js");
    const { aboutPayload } = await import("../src/render.js");
    assert.equal(formatDuration(0), "0s");
    assert.equal(formatDuration(42_000), "42s");
    assert.equal(formatDuration((3 * 86400 + 4 * 3600 + 5 * 60) * 1000), "3d 4h");
    assert.equal(formatDuration((5 * 3600 + 12 * 60 + 9) * 1000), "5h 12m");

    const db = openDb(join(mkdtempSync(join(tmpdir(), "svc-")), "t.db"));
    const client = { ws: { ping: 41.6 }, guilds: { cache: new Map([["1", { memberCount: 100 }], ["2", { memberCount: 50 }]]) } };
    const cfg = { dashboard: { publicUrl: "https://bot.example" }, creator: { name: "Jacob Lucado", url: "https://x.com/twit_user69" } };
    const info = collectAbout({ client, db, cfg, startedAt: 1_000, version: "2.0.0", now: () => 61_000 });
    assert.equal(info.servers, 2);
    assert.equal(info.members, 150);
    assert.equal(info.pingMs, 42);
    assert.equal(info.uptime, "1m");
    assert.equal(info.creator.logo, "https://bot.example/creator.png");
    assert.equal(info.giveaways, 0);

    const p = aboutPayload(info, { about: "Hello", fanaticalUrl: "https://github.com/x/y" });
    const e = p.embeds[0];
    assert.equal(e.author.name, "Created by Jacob Lucado");
    assert.equal(e.author.url, "https://x.com/twit_user69");
    assert.equal(e.author.icon_url, "https://bot.example/creator.png");
    assert.ok(e.fields.some(f => f.name.includes("Servers") && f.value === "**2**"));
    assert.deepEqual(p.components[0].components.map(c => c.label), ["Created by Jacob Lucado", "Dashboard", "FanaticalGrabber"]);
    // without a Discord client (nothing connected yet) the numbers are blank, not wrong
    assert.equal(collectAbout({ client: null, db, cfg, startedAt: 0 }).servers, null);
});

test("commands: personal ones can be installed on an account, server ones stay in servers", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/commands.js", import.meta.url), "utf8");
    const block = src.slice(src.indexOf("export const commands"));
    const personal = block.match(/\.\.\.\[([^\]]*)\]\.map\(everywhere\)/)?.[1].split(",").map(s => s.trim());
    const server = block.match(/\.\.\.\[([^\]]*)\]\.map\(serverOnly\)/)?.[1].split(",").map(s => s.trim());
    assert.deepEqual(personal.sort(), ["about", "alerts", "bug", "bundle", "changelog", "currency", "dashCmd(\"dash\")", "dashCmd(\"dashboard\")", "freegames", "friendCmd", "grabberAd", "help", "library", "mydata", "privacy", "profilecard", "publicpage", "redeem", "regions", "saleprep", "sales", "status", "steam", "support", "value", "watch", "wishlist"]);
    assert.deepEqual(server.sort(), ["alertchannel", "community", "compare", "emojiCmd", "gamenight", "giveaway", "invitesCmd", "lbRefresh", "levels", "lfgCmd", "modCmd", "rank", "setup"]);
    const dmToo = block.match(/\.\.\.\[([^\]]*)\]\.map\(serverOrDm\)/)?.[1].split(",").map(s => s.trim());
    assert.deepEqual(dmToo.sort(), ["calendarCmd", "leaderboard", "serverlist", "serverstats"]);
    assert.match(src, /const serverOnly = b => b[\s\S]*?setContexts\(InteractionContextType\.Guild\);/, "server-only commands stay out of DMs");
    assert.match(src, /UserInstall/);
    assert.match(src, /BotDM/);
});

test("the user-install link and global registration", async () => {
    const { collectAbout } = await import("../src/about.js");
    const db = openDb(join(mkdtempSync(join(tmpdir(), "svc-")), "t.db"));
    const info = collectAbout({ client: null, db, cfg: { clientId: "123", creator: { name: "J", url: null } }, startedAt: 0 });
    assert.equal(info.userInstallUrl, "https://discord.com/oauth2/authorize?client_id=123&integration_type=1&scope=applications.commands");
    const { loadConfig } = await import("../src/config.js");
    const env = { DISCORD_TOKEN: "t", CLIENT_ID: "1", ITAD_API_KEY: "k" };
    assert.equal(loadConfig({ ...env }).globalCommands, false);
    assert.equal(loadConfig({ ...env, GLOBAL_COMMANDS: "1" }).globalCommands, true);
});

test("giveaway artwork: Steam search first, cached, ITAD fallback; title comes from prizes", async () => {
    const { autoImage, titleFromKeys, steamHeader } = await import("../src/giveaway.js");
    let calls = 0;
    const fetchFn = async () => { calls++; return { ok: true, json: async () => ({ items: [{ type: "app", id: 1145360, name: "Hades" }, { type: "app", id: 1, name: "Hades II" }] }) }; };
    const a = await autoImage(null, "Hades", { fetchFn });
    assert.equal(a.image, steamHeader(1145360));
    await autoImage(null, "hades", { fetchFn });
    assert.equal(calls, 1);
    const itad = { lookupTitles: async () => [{ id: "x" }], getTitle: async () => ({ appid: 99 }) };
    const b = await autoImage(itad, "Zzz Unknown", { fetchFn: async () => ({ ok: false }) });
    assert.equal(b.image, steamHeader(99));
    assert.equal(titleFromKeys([{ label: "Hades" }]), "Hades");
    assert.equal(titleFromKeys([{ label: "Hades" }, { label: "Celeste" }, { label: "Hades" }]), "Hades + 1 more");
});

test("multi-game giveaway embeds share a url so Discord shows a gallery", async () => {
    const { giveawayPayload } = await import("../src/gwrender.js");
    const g = { id: 1, title: "T", host_id: "1", ends_at: Date.now() + 1e6, image_url: "https://a.example/1.jpg", gallery: JSON.stringify(["https://a.example/2.jpg", "https://a.example/3.jpg"]) };
    const p = giveawayPayload(g, [{ label: "A", status: "available" }, { label: "B", status: "available" }], 0, "active");
    assert.equal(p.embeds.length, 3);
    assert.ok(p.embeds.every(e => e.url === p.embeds[0].url));
    assert.equal(p.embeds[2].image.url, "https://a.example/3.jpg");
    assert.equal(giveawayPayload({ ...g, gallery: null }, [], 0, "active").embeds.length, 1);
});

test("free games cards carry store art, expiry and a claim button", async () => {
    const { freeGamesPayload, freeArt } = await import("../src/render.js");
    assert.match(freeArt({ url: "https://store.steampowered.com/app/123/X/" }), /apps\/123\/header\.jpg$/);
    assert.match(freeArt({ url: "https://x.example/y", gameIds: ["abc"] }), /isthereanydeal\.com\/abc\/banner400\.jpg$/);
    assert.equal(freeArt({ url: "https://x.example/y" }), undefined);
    const p = freeGamesPayload("Steam", [{ title: "A", url: "https://store.steampowered.com/app/5/A/", expiry: Date.now() + 1e6 }, { title: "B", url: "https://x.example/b" }]);
    assert.ok(p.embeds[0].image.url.includes("/apps/5/"));
    assert.equal(p.embeds[1].image, undefined);
    assert.equal(p.components[0].components[0].label, "Claim all (2)");
    const many = freeGamesPayload("Steam", Array.from({ length: 5 }, (_, i) => ({ title: "G" + i, url: `https://store.steampowered.com/app/${i + 1}/` })));
    assert.ok(many.embeds[0].thumbnail && !many.embeds[0].image);
});

test("/freegames menu: pages, DLC split, store filter, DLC can be hidden", async () => {
    const { freeMenu, isDlc } = await import("../src/freemenu.js");
    const mk = (id, title, shop, type = "game") => ({ id, title, shop, type, url: "https://s.example/" + id, expiry: null, gameIds: [] });
    const list = [mk("1", "Alpha", "Steam"), mk("2", "Beta", "Epic Game Store"), mk("3", "Alpha Pack", "Steam", "dlc"), mk("4", "Gamma Soundtrack", "GOG")];
    assert.ok(isDlc(list[2]) && isDlc(list[3]) && !isDlc(list[0]));
    const m = freeMenu(list, { cat: "games" });
    assert.equal(m.embeds[0].title.includes("Alpha") || m.embeds[0].title.includes("Beta"), true);
    assert.match(m.components[0].components[0].label, /Games \(2\)/);
    assert.match(m.components[0].components[1].label, /DLC \(2\)/);
    assert.equal(m.components.at(-1).components[0].disabled, true); // no previous page
    const dlc = freeMenu(list, { cat: "dlc" });
    assert.match(dlc.embeds[0].title, /🧩/);
    const steamOnly = freeMenu(list, { cat: "all", store: "steam" });
    assert.match(steamOnly.content, /\*\*2\*\*/);
    const hidden = freeMenu(list, { cat: "dlc", showDlc: false });
    assert.match(hidden.content, /\*\*2\*\*/); // forced back to games
    assert.equal(hidden.components.some(r => r.components[0].custom_id?.startsWith("fg:dlc")), false);
    assert.ok(freeMenu(list, { cat: "games", page: 99 }).embeds[0].footer.text.startsWith("2 of 2"));
    assert.match(freeMenu([], {}).embeds[0].title, /Nothing/);
    for (const row of m.components) for (const c of row.components) if (c.custom_id) assert.ok(c.custom_id.length <= 100);
    // Discord rejects a message whose component ids repeat (Prev on page 2 used to match the tab for page 1)
    for (const opts of [{ cat: "games", page: 1 }, { cat: "games", page: 0 }, { cat: "all", page: 1 }, { cat: "dlc", page: 1 }, { cat: "all", store: "steam", page: 1 }]) {
        const ids = freeMenu(list, opts).components.flatMap(r => r.components.map(c => c.custom_id)).filter(Boolean);
        assert.equal(new Set(ids).size, ids.length, "duplicate ids for " + JSON.stringify(opts));
    }
});

test("free DLC preference is saved and validated", async () => {
    assert.deepEqual(prefsPatch({ free_dlc: false }, {}), { free_dlc: 0 });
});

test("price insight: sparkline plus a buy-now or wait nudge", async () => {
    const { priceInsight } = await import("../src/insight.js");
    const now = Date.parse("2026-10-26T00:00:00Z"), D = 86400_000;
    const pts = [[300, 40], [200, 20], [120, 40], [60, 30], [20, 40]].map(([d, price]) => ({ t: now - d * D, price }));
    pts.push({ t: now - 250 * D, price: 40 });
    pts.sort((a, b) => a.t - b.t);
    const great = priceInsight(pts, 20, { now });
    assert.equal(great.spark.length, 12);
    assert.equal(great.level, "great");
    assert.equal(priceInsight(pts, 40, { now }).level, "wait");
    assert.match(priceInsight(pts, 40, { now }).text, /in (Mar|Apr|May|Jan|Feb|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/);
    assert.equal(priceInsight([{ t: now, price: 1 }], 1, { now }), null);
});

test("sales calendar lists what is on or coming, soonest first", async () => {
    const { upcomingSales, salesEmbed } = await import("../src/salescal.js");
    const now = Date.parse("2026-10-26T20:00:00Z");
    const ev = upcomingSales(now, { limit: 3 });
    assert.equal(ev[0].live, true);
    assert.ok(ev[1].start > ev[0].start);
    assert.deepEqual(upcomingSales(now, { salesOnly: true }).map(e => e.kind), ["sale", "sale", "sale"]);
    assert.match(salesEmbed(ev, { now }).description, /ON NOW/);
    assert.equal(upcomingSales(Date.parse("2030-01-01")).length, 0);
});

test("a /watch is removed after its alert and pruned after a month", () => {
    const t = rig({});
    t.db.ensureUser("w1", "g");
    t.db.addItems("w1", [{ itad_id: "x", title: "X" }], { source: "watch" });
    t.db.addItems("w1", [{ itad_id: "y", title: "Y" }]);
    assert.equal(t.db.removeWatch("w1", "y"), 0); // wishlist games are never removed this way
    assert.equal(t.db.removeWatch("w1", "x"), 1);
    assert.equal(t.db.listItems("w1").length, 1);
});

test("backlog: status, unplayed spend and what to play next", async () => {
    const { backlogStats, playNext } = await import("../src/library.js");
    const rows = [{ title: "A", paid: 10, status: "backlog" }, { title: "B", paid: 30, status: "backlog" }, { title: "C", paid: null, status: "finished" }, { title: "D", paid: 5, status: "backlog" }];
    const s = backlogStats(rows);
    assert.equal(s.backlogGames, 3); assert.equal(s.backlogPaid, 45); assert.equal(s.finished, 1);
    assert.equal(playNext(rows, { rand: () => 0 }).pick.title, "B");
    assert.equal(playNext([...rows, { title: "P", paid: 1, status: "playing" }]).pick.title, "P");
    assert.equal(playNext([{ title: "x", status: "finished" }]), null);
    const t = rig({});
    t.db.ensureUser("b1", "g");
    t.db.upsertLibrary("b1", [{ itad_id: "i1", title: "Hades", paid: 5 }]);
    assert.equal(t.db.listLibrary("b1")[0].status, "backlog");
    assert.equal(t.db.setLibraryStatus("b1", "i1", "playing"), true);
    assert.equal(t.db.setLibraryStatus("b1", "i1", "nonsense"), false);
    assert.equal(t.db.listLibrary("b1")[0].status, "playing");
});

test("ProtonDB badge: cached lookup, silent on failure, shown on the alert", async () => {
    const { protonTier, protonLabel } = await import("../src/proton.js");
    let calls = 0;
    const ok = async () => { calls++; return { ok: true, json: async () => ({ tier: "Platinum" }) }; };
    assert.equal(await protonTier(424242, { fetchFn: ok }), "platinum");
    assert.equal(await protonTier(424242, { fetchFn: ok }), "platinum");
    assert.equal(calls, 1);
    assert.equal(await protonTier(777, { fetchFn: async () => { throw new Error("net"); } }), null);
    assert.equal(await protonTier(null, { fetchFn: ok }), null);
    assert.match(protonLabel("gold"), /Gold/);
    const { alertEmbed } = await import("../src/render.js");
    const e = alertEmbed({ title: "G" }, { price: 5, regular: 10, discount: 0.5, currency: "USD", atl: null }, { trigger: "any", proton: "platinum" });
    assert.match(e.description, /Platinum/);
});

test("public wishlist page: off by default, unique names, shows only games and prices", async () => {
    const { setProfile, publicWishlist, cleanSlug } = await import("../src/profile.js");
    const t = rig({});
    t.db.ensureUser("p1", "g"); t.db.ensureUser("p2", "g");
    t.db.addItems("p1", [{ itad_id: "a", title: "Hades", appid: 1145360 }]);
    t.db.addItems("p1", [{ itad_id: "w", title: "Secret Watch" }], { source: "watch" });
    const itad = { getPrices: async () => new Map() };
    assert.equal(await publicWishlist(t.db, itad, "jacob"), null);
    assert.throws(() => setProfile(t.db, "p1", { enabled: true }), /page name/);
    assert.throws(() => cleanSlug("a!"), /3 to 24/);
    assert.deepEqual(setProfile(t.db, "p1", { enabled: true, slug: "Jacob" }), { slug: "jacob", public: true });
    assert.throws(() => setProfile(t.db, "p2", { enabled: true, slug: "jacob" }), /taken/);
    const page = await publicWishlist(t.db, itad, "JACOB");
    assert.deepEqual(page.games.map(g => g.title), ["Hades"]);
    assert.equal(JSON.stringify(page).includes("p1"), false);
    setProfile(t.db, "p1", { enabled: false });
    assert.equal(await publicWishlist(t.db, itad, "jacob"), null);
});

test("weekly server digest: Fridays only, once a week, cheap shared games and free games, never a member's name", async () => {
    const { runServerDigests } = await import("../src/poller.js");
    const { digestIsDue } = await import("../src/serverdigest.js");
    const FRI = Date.UTC(2026, 0, 9, 18), THU = Date.UTC(2026, 0, 8, 18);
    assert.equal(digestIsDue(null, FRI), true); assert.equal(digestIsDue(null, THU), false);
    assert.equal(digestIsDue(null, Date.UTC(2026, 0, 9, 12)), false, "not before 17:00 UTC");
    assert.equal(digestIsDue(FRI - 3600_000, FRI), false, "not twice in a week");
    const t = rig({});
    t.db.setGuildChannel("g1", "c1", "u1"); t.db.setWeeklyDigest("g1", true);
    t.db.ensureUser("s1", "g1"); t.db.updateUser("s1", { share: 1 });
    t.db.ensureUser("s2", "g1");
    t.db.addItems("s1", [{ itad_id: "a", title: "Hades" }]);
    t.db.addItems("s2", [{ itad_id: "b", title: "Private Game" }]);
    const deal = (price, regular) => ({ deals: [{ price: { amount: price, currency: "USD" }, regular: { amount: regular }, cut: Math.round((1 - price / regular) * 100), shop: { name: "Steam" }, url: "https://x.example/" }] });
    const itad = { getPrices: async ids => new Map(ids.map(id => [id, deal(5, 20)])), getGiveawayList: async () => [free("1", "Alpha", "Steam")] };
    const posts = [];
    const notifier = { postGuild: async (g, p) => { posts.push(p); return true; } };
    assert.equal((await runServerDigests({ db: t.db, itad, notifier, now: () => THU })).due, 0);
    const r = await runServerDigests({ db: t.db, itad, notifier, now: () => FRI, names: () => "Test Server" });
    assert.equal(r.posted, 1);
    const text = JSON.stringify(posts[0]);
    assert.match(text, /Hades/); assert.match(text, /Alpha/);
    assert.equal(text.includes("Private Game"), false, "only games of members who chose to share");
    assert.equal(text.includes("s1"), false);
    assert.equal((await runServerDigests({ db: t.db, itad, notifier, now: () => FRI + 60_000 })).due, 0, "once a week");
});

test("server free feed posts games once per server, never DLC; stats are counts only", async () => {
    const { runGuildFeeds } = await import("../src/poller.js");
    const { serverStats } = await import("../src/library.js");
    const { serverStatsEmbed } = await import("../src/render.js");
    const t = rig({});
    t.db.setGuildChannel("g1", "c1", "u1");
    t.db.setFreeFeed("g1", true);
    const posts = [];
    const notifier = { postGuild: async (gid, p) => { posts.push([gid, p]); return true; } };
    const itad = { getGiveawayList: async () => [free("1", "Alpha", "Steam"), { ...free("2", "Beta Pack", "Steam"), type: "dlc" }] };
    let r = await runGuildFeeds({ db: t.db, itad, notifier });
    assert.equal(r.posted, 1);
    assert.equal(posts[0][1].embeds.length, 1);
    r = await runGuildFeeds({ db: t.db, itad, notifier });
    assert.equal(r.posted, 0);
    t.db.ensureUser("s1", "g1"); t.db.updateUser("s1", { share: 1 });
    t.db.addItems("s1", [{ itad_id: "a", title: "Hades" }]);
    const st = serverStats(t.db, "g1");
    assert.equal(st.members, 1);
    assert.deepEqual(st.mostWanted.map(x => [x.title, x.watchers]), [["Hades", 1]]);
    assert.equal(JSON.stringify(st).includes("s1"), false);
    assert.match(serverStatsEmbed(st).fields.find(f => f.name === "Most wanted").value, /Hades/);
    assert.match(serverStatsEmbed(serverStats(t.db, "nobody")).description, /opted in/);
});

test("help mentions the newer commands and stays within what the bot can send", async () => {
    const { HELP } = await import("../src/text.js");
    assert.ok(HELP.length <= 4096, `help is ${HELP.length} characters (Discord embeds hold 4096)`);
    const { commands } = await import("../src/commands.js");
    for (const c of commands) {
        const j = c.toJSON ? c.toJSON() : c;
        assert.ok(HELP.includes("`/" + j.name + "`"), "help is missing /" + j.name);
        for (const o of (j.options ?? []).filter(o => o.type === 1 || o.type === 2)) assert.ok(HELP.includes("`" + o.name + "`") || HELP.includes(o.name), `help is missing /${j.name} ${o.name}`);
    }
});

test("the currency list fits a Discord choice menu (25 max) with unique codes", async () => {
    const { REGIONS } = await import("../src/constants.js");
    assert.ok(REGIONS.length <= 25, `${REGIONS.length} regions`);
    assert.equal(new Set(REGIONS.map(r => r.value)).size, REGIONS.length);
    assert.ok(REGIONS.some(r => r.value === "IN"));
});

test("slash command text fits Discord's limits (discord.js throws at startup otherwise, and the stub does not catch it)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/commands.js", import.meta.url), "utf8");
    for (const m of src.matchAll(/setDescription\("((?:[^"\\]|\\.)*)"\)/g)) assert.ok(m[1].length <= 100, `description is ${m[1].length} characters: ${m[1]}`);
    for (const m of src.matchAll(/setName\("([^"]*)"\)/g)) if (!/^\w[\w-]*$/.test(m[1]) || /[A-Z]/.test(m[1]) || m[1].length > 32) assert.fail(`bad command or option name: ${m[1]}`);
    for (const m of src.matchAll(/\{ name: "((?:[^"\\]|\\.)*)", value: "/g)) assert.ok(m[1].length <= 100, `choice name too long: ${m[1]}`);
});

test("friends: birthday maths, limits and a once-a-year reminder", async () => {
    const { daysUntilBirthday } = await import("../src/friendstore.js");
    const { runFriendReminders, saveFriend, cleanBirthday } = await import("../src/friends.js");
    const day = (m, d, y = 2026) => Date.UTC(y, m - 1, d, 12);
    assert.equal(daysUntilBirthday("03-27", day(3, 20)), 7);
    assert.equal(daysUntilBirthday("03-27", day(3, 27)), 0);
    assert.equal(daysUntilBirthday("03-27", day(3, 28)), 364);
    assert.throws(() => cleanBirthday("13-40"));
    const db = openDb(":memory:");
    db.ensureUser("u1", null);
    assert.equal(saveFriend(db, "u1", { name: "Sam", birthday: "03-27" }).added, true);
    assert.equal(saveFriend(db, "u1", { name: "sam", birthday: "03-28" }).updated, true);
    assert.equal(db.listFriends("u1").length, 1);
    saveFriend(db, "u1", { name: "Sam", birthday: "03-27" });
    const sent = [];
    const notifier = { deliver: async (u, p, type) => { sent.push(type); return { ok: true }; } };
    const itad = {};
    assert.equal((await runFriendReminders({ db, itad, notifier, now: () => day(3, 10) })).sent, 0, "too early");
    assert.equal((await runFriendReminders({ db, itad, notifier, now: () => day(3, 21) })).sent, 1);
    assert.equal((await runFriendReminders({ db, itad, notifier, now: () => day(3, 22) })).sent, 0, "only once a year");
    assert.deepEqual(sent, ["friend"]);
    assert.equal((await runFriendReminders({ db, itad, notifier, now: () => day(3, 21, 2027) })).sent, 1, "again next year");
    for (let n = 0; n < 25; n++) { try { saveFriend(db, "u1", { name: "F" + n }); } catch { /* full */ } }
    assert.equal(db.listFriends("u1").length, 20);
    db.deleteUser("u1");
    assert.equal(db.listFriends("u1").length, 0);
});

test("backlog league ranks opted-in members by games finished this month; badges climb tiers", async () => {
    const { finishedLeague } = await import("../src/library.js");
    const { badgeList } = await import("../src/badges.js");
    const db = openDb(":memory:");
    for (const [id, share] of [["a", 1], ["b", 1], ["c", 0]]) { db.ensureUser(id, "g1"); db.updateUser(id, { share }); }
    for (const [id, n] of [["a", 2], ["b", 1], ["c", 5]]) for (let k = 0; k < n; k++) { db.upsertLibrary(id, [{ itad_id: `x${k}`, title: `Game ${k}`, paid: 10 }]); db.setLibraryStatus(id, `x${k}`, "finished"); }
    const board = finishedLeague(db, "g1");
    assert.deepEqual(board.map(e => [e.discord_id, e.done]), [["a", 2], ["b", 1]], "c did not opt in");
    assert.deepEqual(finishedLeague(db, "g1", Date.now() + 40 * 86400_000), [], "a new month starts empty");
    const lib = Array.from({ length: 12 }, (_, n) => ({ title: "G" + n, paid: 10, status: n < 3 ? "finished" : "played", minutes: n === 0 ? 6000 : 0 }));
    const b = Object.fromEntries(badgeList(lib, { best: 3 }).map(x => [x.id, x]));
    assert.equal(b.collector.tier, "Bronze"); assert.equal(b.collector.next, 50);
    assert.equal(b.finisher.tier, "Bronze"); assert.equal(b.streak.tier, "Silver");
    assert.equal(b.marathon.tier, "Silver"); assert.equal(b.value.tier, "Bronze");
    assert.equal(b.clean.tier, "Gold");
});

test("quick start tip: short, mentions the first steps and the dashboard only when there is one", async () => {
    const { quickStart } = await import("../src/text.js");
    const a = quickStart("https://x.example"), b = quickStart();
    assert.match(a.description, /wishlist import/); assert.match(a.description, /x\.example\/#\/mypage/);
    assert.doesNotMatch(b.description, /https?:/);
    assert.ok(a.description.length < 700);
    const db = openDb(":memory:");
    db.ensureUser("u9", null);
    assert.equal(db.getUser("u9").tipped, 0);
    db.updateUser("u9", { tipped: 1 });
    assert.equal(db.getUser("u9").tipped, 1);
});

test("bot status rotates through servers, members, uptime and the support link, and skips what it does not know", async () => {
    const { presenceLines, uptimeText, startPresence } = await import("../src/presence.js");
    const lines = presenceLines({ servers: 3, members: 1200, users: 1, uptimeMs: 90 * 3600_000, supportUrl: "https://x.com/twit_user69" });
    assert.deepEqual(lines.slice(0, 4), ["🌐 In 3 servers", "👥 1,200 members across servers", "💸 Watching deals for 1 player", "⏱️ Online for 3d 18h"]);
    assert.ok(lines.at(-1).endsWith("x.com/twit_user69") && !lines.at(-1).includes("https://"));
    assert.ok(lines.every(l => l.length <= 128));
    assert.ok(!presenceLines({ servers: undefined, members: 0, users: 0, uptimeMs: 5000 }).some(l => /member|player|server/.test(l)));
    assert.equal(uptimeText(30_000), "1m"); assert.equal(uptimeText(75 * 60_000), "1h 15m");
    const sent = [];
    const client = { guilds: { cache: { size: 2, reduce: (f, a) => [{ memberCount: 5 }, { memberCount: 7 }].reduce(f, a) } }, user: { setPresence: p => sent.push(p.activities.find(a => a.type === 4).state) } };
    const stop = startPresence({ client, db: { stats: () => ({ users: 9 }) }, supportUrl: "https://x.com/a", every: 5 });
    await new Promise(r => setTimeout(r, 40)); stop();
    assert.equal(sent[0], "🌐 In 2 servers"); assert.ok(sent.includes("👥 12 members across servers") && sent.length >= 3);
});

test("/dashboard and /dash give the dashboard link, to a known page only", async () => {
    const { dashLink, dashPayload } = await import("../src/dashlink.js");
    assert.equal(dashLink("https://x.example/", null), "https://x.example");
    assert.equal(dashLink("https://x.example", "library"), "https://x.example/#/library");
    assert.equal(dashLink("https://x.example", "../evil"), "https://x.example", "unknown pages are ignored");
    assert.equal(dashLink(null), null);
    const p = dashPayload("https://x.example", "xp");
    assert.equal(p.flags, 64); assert.equal(p.components[0].components[0].url, "https://x.example/#/xp");
    assert.match(dashPayload(null).content, /not turned on/);
    const { commands } = await import("../src/commands.js");
    const names = commands.map(c => c.name);
    assert.ok(names.includes("dashboard") && names.includes("dash"));
    assert.ok(commands.find(c => c.name === "dash").options[0].choices.every(c => /^[a-z]+$/.test(c.value)));
});

test("dashboard files are sent compressed, with a validator so repeat visits are a 304, and plain when the browser asks for it", async () => {
    const { createDashboard } = await import("../src/dashboard/server.js");
    const http = await import("node:http");
    const { gunzipSync, brotliDecompressSync } = await import("node:zlib");
    const d = createDashboard({ db: openDb(":memory:"), itad: {}, rest: {}, config: { publicUrl: "http://x.example", port: 0, host: "127.0.0.1", clientId: "1", ownerId: "u" } });
    const a = await d.listen(0, "127.0.0.1");
    const raw = (path, h = {}) => new Promise(r => http.get({ host: "127.0.0.1", port: a.port, path, headers: h }, res => { const c = []; res.on("data", x => c.push(x)); res.on("end", () => r({ res, body: Buffer.concat(c) })); }));
    try {
        const plain = await raw("/app.js", { "Accept-Encoding": "identity" });
        const br = await raw("/app.js", { "Accept-Encoding": "br, gzip" });
        const gz = await raw("/app.js", { "Accept-Encoding": "gzip" });
        assert.equal(br.res.headers["content-encoding"], "br"); assert.equal(gz.res.headers["content-encoding"], "gzip");
        assert.ok(!plain.res.headers["content-encoding"]);
        assert.ok(br.body.length < plain.body.length / 3, `br ${br.body.length} vs ${plain.body.length}`);
        assert.ok(brotliDecompressSync(br.body).equals(plain.body) && gunzipSync(gz.body).equals(plain.body), "same bytes after decompressing");
        assert.match(br.res.headers.vary, /Accept-Encoding/);
        const again = await raw("/app.js", { "Accept-Encoding": "br", "If-None-Match": br.res.headers.etag });
        assert.equal(again.res.statusCode, 304); assert.equal(again.body.length, 0);
        const png = await raw("/logo.png", { "Accept-Encoding": "br" });
        assert.ok(!png.res.headers["content-encoding"], "images are not compressed again");
    } finally { await d.close(); }
});

test("presence sends a Watching activity as well as the custom status", async () => {
    const { startPresence } = await import("../src/presence.js");
    const sent = [];
    const client = { guilds: { cache: { size: 1, reduce: () => 3 } }, user: { setPresence: p => sent.push(p) } };
    const stop = startPresence({ client, db: { stats: () => ({ users: 12 }) }, every: 1e9 });
    stop();
    const acts = sent[0].activities;
    assert.equal(acts[0].type, 3);
    assert.match(acts[0].name, /12 game libraries/);
    assert.equal(acts[1].type, 4);
});

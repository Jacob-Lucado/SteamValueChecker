import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { createNotifier } from "../src/notify.js";
import { runCycle, runExtras, runDigests, runSnapshots } from "../src/poller.js";
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

function rig({ prices = {}, bundles = new Map(), giveaways = new Map() } = {}) {
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
        getGiveaways: async () => giveaways
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

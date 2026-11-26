import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { normTitle, matchesIn, bundleMatchEmbed, runBundleMatch, matchesForUser } from "../src/bundlematch.js";

const mk = (n, games, over = {}) => ({ key: `humble:b${n}`, store: "humble", title: "Bundle " + n, url: `https://example.com/b${n}`, image: null, games, gameCount: games.length, price: "$12", expiresAt: Date.now() + 5 * 86400_000, seenAt: Date.now(), ...over });
function rig() {
    const db = openDb(":memory:");
    const sent = [];
    const notifier = { deliver: async (user, payload, type) => { sent.push({ id: user.discord_id, payload, type }); return { ok: true, via: "dm" }; } };
    return { db, sent, notifier };
}

test("titles meet across trademark signs, punctuation and edition words", () => {
    assert.equal(normTitle("The Witcher® 3: Wild Hunt – Complete Edition"), normTitle("Witcher 3 Wild Hunt"));
    assert.equal(normTitle("Hades™"), "hades");
    assert.equal(normTitle("DOOM Eternal: Deluxe Edition"), "doom eternal");
    assert.deepEqual(matchesIn(["Hades", "Hollow Knight"], [{ itad_id: "a", title: "hades" }, { itad_id: "b", title: "Celeste" }]).map(m => m.title), ["Hades"]);
    assert.deepEqual(matchesIn(["Up"], [{ itad_id: "a", title: "Up" }]), [], "too-short titles never match");
});

test("the message lists the matches and links to the bundle", () => {
    const b = { id: 7, url: "https://example.com/big", store: "humble", title: "Big Bundle", price: "$12", games: ["A", "B", "C"], game_count: 3, expires_at: Date.now() + 86400_000 };
    const e = bundleMatchEmbed(b, [{ title: "A" }, { title: "B" }]);
    assert.match(e.embeds[0].title, /2 games from your wishlist/); assert.match(e.embeds[0].description, /\*\*A\*\*/);
    assert.equal(e.components[0].components[0].url, "https://example.com/big", "falls back to the store when there is no site address");
    assert.match(bundleMatchEmbed(b, [{ title: "A" }]).embeds[0].title, /Hades|A$/);
});

test("people are told once, only when a fresh bundle has their game, and never more than three a day", async () => {
    const { db, sent, notifier } = rig();
    db.ensureUser("u1"); db.ensureUser("u2"); db.ensureUser("u3");
    db.addItems("u1", [{ itad_id: "h", title: "Hades™" }]);
    db.addItems("u2", [{ itad_id: "c", title: "Celeste" }]);
    db.upsertFeedBundle(mk(1, ["Hades", "Hollow Knight"]));
    const r = await runBundleMatch({ db, notifier });
    assert.equal(r.sent, 1); assert.deepEqual(sent.map(s => s.id), ["u1"]); assert.equal(sent[0].type, "bundle");
    assert.equal((await runBundleMatch({ db, notifier })).sent, 0, "a second pass does not repeat it");
    for (let i = 2; i <= 6; i++) { db.addItems("u1", [{ itad_id: "x" + i, title: "Game " + i }]); db.upsertFeedBundle(mk(i, ["Game " + i])); }
    await runBundleMatch({ db, notifier });
    assert.equal(sent.filter(s => s.id === "u1").length, 3, "the daily cap holds");
});

test("old, ended and adult bundles are skipped, and a failed send is logged and not repeated", async () => {
    const { db, sent, notifier } = rig();
    db.ensureUser("u1"); db.addItems("u1", [{ itad_id: "h", title: "Hades" }]);
    db.upsertFeedBundle(mk(1, ["Hades"], { adult: true }));
    assert.equal((await runBundleMatch({ db, notifier })).sent, 0);
    const logs = [];
    const bad = { deliver: async () => ({ ok: false, reason: "dm_failed" }) };
    db.upsertFeedBundle(mk(2, ["Hades"]));
    const r = await runBundleMatch({ db, notifier: bad, log: m => logs.push(m) });
    assert.equal(r.failed, 1); assert.equal(logs.length, 1);
    assert.equal((await runBundleMatch({ db, notifier })).sent, 0, "recorded first, so no double message");
    const later = await runBundleMatch({ db, notifier, now: () => Date.now() + 3 * 86400_000 });
    assert.equal(later.bundles, 0, "after 48 hours a bundle is no longer news");
    assert.equal(sent.length, 0);
});

test("the dashboard helper maps bundle ids to the member's matching titles", () => {
    const { db } = rig();
    db.ensureUser("u1"); db.addItems("u1", [{ itad_id: "h", title: "Hades" }]);
    const id = db.upsertFeedBundle(mk(1, ["Hades", "X Game"])).id;
    const found = db.listFeedBundles({ status: "active" });
    assert.deepEqual(matchesForUser(db, "u1", found), { [id]: ["Hades"] });
    assert.deepEqual(matchesForUser(db, "nobody", found), {});
});

test("a server's bundle post says how many members are watching a game in it, without naming anyone", async () => {
    const { runBundleFeed, bundleFeedEmbed } = await import("../src/bundlefeed.js");
    const { db } = rig();
    db.ensureUser("u1"); db.ensureUser("u2"); db.ensureUser("u3");
    for (const [id, g] of [["u1", "g1"], ["u2", "g1"], ["u3", "g2"]]) db.setUser?.(id, { guild_id: g }) ?? db.updateUser?.(id, { guild_id: g });
    db.addItems("u1", [{ itad_id: "h", title: "Hades" }]); db.addItems("u2", [{ itad_id: "h", title: "Hades" }]); db.addItems("u3", [{ itad_id: "h", title: "Hades" }]);
    const { watchersIn } = await import("../src/bundlematch.js");
    assert.equal(watchersIn(db, "g1", { games: ["Hades"] }), 2);
    assert.equal(watchersIn(db, "g2", { games: ["Hades"] }), 1);
    assert.equal(watchersIn(db, "g1", { games: ["Celeste"] }), 0);
    const e = bundleFeedEmbed({ store: "humble", title: "B", games: ["Hades"], game_count: 1, url: "https://x.example" }, { watchers: 2 });
    assert.ok(e.embeds[0].fields.some(f => f.name === "On wishlists here" && /2 members/.test(f.value)));
    assert.ok(!bundleFeedEmbed({ store: "humble", title: "B", games: [], url: "https://x.example" }).embeds[0].fields.some(f => f.name === "On wishlists here"));
});

test("bundles say how many of their games you already own", async () => {
    const { ownedForUser } = await import("../src/bundlematch.js");
    const { db, sent, notifier } = rig();
    db.ensureUser("u1");
    db.addItems("u1", [{ itad_id: "h", title: "Hades" }]);
    db.upsertLibrary("u1", [{ itad_id: "c", title: "Celeste", paid: null }, { itad_id: "t", title: "Tunic™", paid: null }]);
    const id = db.upsertFeedBundle(mk(1, ["Hades", "Celeste", "Tunic", "Other"])).id;
    assert.deepEqual(ownedForUser(db, "u1", db.listFeedBundles({ status: "active" })), { [id]: ["Celeste", "Tunic"] });
    assert.deepEqual(ownedForUser(db, "nobody", db.listFeedBundles({ status: "active" })), {});
    await runBundleMatch({ db, notifier });
    assert.match(sent[0].payload.embeds[0].fields[0].value, /4 games, 2 already in your library/);
});

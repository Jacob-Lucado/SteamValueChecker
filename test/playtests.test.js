import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { classifyPost, runPlaytests, playtestEmbed } from "../src/playtests.js";
import { prefsPatch } from "../src/prefs.js";

const T0 = Date.parse("2026-11-03T15:00:00Z");
const post = (gid, title, extra = {}) => ({ gid, appid: 10, title, date: T0 - 3600_000, summary: "Sign up now.", patch: false, url: `https://store.steampowered.com/news/app/10/view/${gid}`, image: null, ...extra });

test("playtests: the post titles that count, and the ones that don't", () => {
    const k = t => classifyPost(post("x", t));
    assert.equal(k("Closed Playtest signups are open"), "playtest");
    assert.equal(k("Play-test this weekend"), "playtest");
    assert.equal(k("Free Weekend starts now!"), "weekend");
    assert.equal(k("Free to play this weekend"), "weekend");
    assert.equal(k("Play the demo during Next Fest"), "demo");
    assert.equal(k("Open Beta is live"), "beta");
    assert.equal(k("Patch notes 1.2 (beta branch)"), null);
    assert.equal(k("Hotfix for the demo crash"), null);
    assert.equal(k("Version 1.0 is out"), null);
    assert.equal(classifyPost(post("x", "Beta changes", { patch: true })), null);
});

function world() {
    const db = openDb(":memory:", { now: () => T0 });
    db.ensureUser("u1", "G"); db.updateUser("u1", { playtest: 1, share: 1 });
    db.ensureUser("u2", "G"); db.updateUser("u2", { share: 1 });
    db.addItems("u1", [{ itad_id: "a", title: "Wish Game" }, { itad_id: "own", title: "Owned Game" }]);
    db.addItems("u2", [{ itad_id: "a", title: "Wish Game" }]);
    db.setAppId("u1", "a", 10); db.setAppId("u1", "own", 20); db.setAppId("u2", "a", 10);
    db.syncSteamGames("u1", [{ itad_id: "own", title: "Owned Game", appid: 20, minutes: 5 }]);
    db.setGuildChannel("G", "chan", "u1");
    db.setCommunity("G", { ping_playtest: "ROLE" });
    let feed = new Map([[10, [post("g1", "Welcome")]], [20, [post("g9", "Demo available")]]]);
    const news = { forApps: async ids => { world.asked = ids; return feed; } };
    const sent = [], posted = [];
    const notifier = { deliver: async (u, p, kind) => { sent.push({ u: u.discord_id, p, kind }); return { ok: true, via: "dm" }; }, postGuild: async (g, p, kind) => { posted.push({ g, p, kind }); return true; } };
    return { db, news, notifier, sent, posted, setFeed: f => { feed = f; } };
}

test("playtests: quiet first look, then a DM for a wishlist game the member doesn't own, and one role-pinged post for the server", async () => {
    const w = world();
    assert.equal((await runPlaytests({ db: w.db, news: w.news, notifier: w.notifier, now: () => T0 })).found, 0); // first look is quiet for both
    w.setFeed(new Map([[10, [post("g1", "Welcome"), post("g2", "Playtest signups are open")]], [20, [post("g9", "Demo available")]]]));
    const s = await runPlaytests({ db: w.db, news: w.news, notifier: w.notifier, now: () => T0 });
    assert.equal(s.delivered, 1); assert.equal(s.posted, 1);
    assert.equal(w.sent[0].u, "u1"); assert.equal(w.sent[0].kind, "playtest"); assert.match(w.sent[0].p.embeds[0].title, /Playtest: Wish Game/);
    assert.equal(w.sent.some(x => /Owned Game/.test(JSON.stringify(x.p))), false, "a game they own is skipped");
    assert.equal(w.posted[0].g, "G"); assert.equal(w.posted[0].kind, "playtest"); assert.match(w.posted[0].p.embeds[0].footer.text, /2 members here are watching/);
    assert.ok(!JSON.stringify(w.posted[0].p).includes("u1"), "no member is named in the server post");
    const again = await runPlaytests({ db: w.db, news: w.news, notifier: w.notifier, now: () => T0 });
    assert.equal(again.found, 0);
});

test("playtests: off by default, old posts ignored, prefs", async () => {
    const w = world(); w.db.updateUser("u1", { playtest: 0 }); w.db.setCommunity("G", { ping_playtest: null });
    assert.equal((await runPlaytests({ db: w.db, news: w.news, notifier: w.notifier, now: () => T0 })).checked, 0);
    assert.equal(playtestEmbed(post("g", "Demo"), "demo", { watchers: 1 }).footer.text.includes("watching"), false);
    assert.deepEqual(prefsPatch({ playtest: true }, {}), { playtest: 1 });
});

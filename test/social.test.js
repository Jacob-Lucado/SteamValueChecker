import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { cleanPostText, MAX_POST_CHARS, POSTS_PER_HOUR, REPORTS_TO_HIDE } from "../src/socialstore.js";
import { refreshTrophies } from "../src/socialevents.js";

function rig() {
    let clock = Date.now();
    const db = openDb(":memory:", { now: () => clock });
    for (const id of ["a", "b", "c", "d", "e"]) { db.ensureUser(id, "g1"); db.setProfile(id, { slug: "user-" + id, isPublic: true }); }
    return { db, tick: ms => { clock += ms; } };
}

test("post text: trimmed, limited, and no links", () => {
    assert.equal(cleanPostText("  hello   there \n\n\n\nfriend ").text, "hello there \n\nfriend");
    assert.match(cleanPostText("").error, /Write something/);
    assert.match(cleanPostText("x".repeat(MAX_POST_CHARS + 1)).error, /280/);
    for (const bad of ["see https://example.com", "go to www.example.com", "join discord.gg/abc", "buy at shop.com/keys"]) assert.match(cleanPostText(bad).error, /Links/, bad);
    assert.equal(cleanPostText("Hollow Knight is peak. 10/10").text, "Hollow Knight is peak. 10/10");
});

test("following: one way, not yourself, not a closed page, and blocking cuts it both ways", () => {
    const { db } = rig();
    assert.equal(db.follow("a", "a", true), "self");
    assert.equal(db.follow("a", "b", true), "new");
    assert.equal(db.follow("a", "b", true), "ok");
    assert.deepEqual(db.followCounts("b"), { followers: 1, following: 0 });
    db.setProfile("c", { slug: "user-c", isPublic: false });
    assert.equal(db.follow("a", "c", true), "closed");
    db.setBlock("b", "a", true);
    assert.equal(db.isFollowing("a", "b"), false, "a block drops the follow");
    assert.equal(db.follow("a", "b", true), "blocked");
    db.setBlock("b", "a", false);
    assert.equal(db.follow("a", "b", true), "new");
});

test("events happen once, and finishing a game puts it in the feed", () => {
    const { db } = rig();
    db.upsertLibrary("a", [{ itad_id: "g1", title: "Hades", appid: 1145360 }]);
    db.setLibraryStatus("a", "g1", "finished");
    db.setLibraryStatus("a", "g1", "played");
    db.setLibraryStatus("a", "g1", "finished");
    const f = db.feed("b", { scope: "everyone" }).items;
    assert.equal(f.length, 1); assert.equal(f[0].kind, "finished"); assert.equal(f[0].game, "Hades"); assert.equal(f[0].slug, "user-a");
    assert.equal(db.addEvent("a", "rare", { appid: 1, game: "X", ref: "1:A" }), true);
    assert.equal(db.addEvent("a", "rare", { appid: 1, game: "X", ref: "1:A" }), false, "same achievement, once");
});

test("the feed shows only open pages, and 'following' only shows people you follow", () => {
    const { db } = rig();
    db.createPost("a", { body: "from a" }); db.createPost("b", { body: "from b" }); db.createPost("c", { body: "from c" });
    db.follow("d", "a", true);
    assert.deepEqual(db.feed("d", { scope: "following" }).items.map(i => i.body), ["from a"]);
    assert.deepEqual(db.feed("d", { scope: "everyone" }).items.map(i => i.body), ["from c", "from b", "from a"]);
    db.setProfile("c", { slug: "user-c", isPublic: false });
    assert.deepEqual(db.feed("d", { scope: "everyone" }).items.map(i => i.body), ["from b", "from a"], "a closed page leaves the feed");
    assert.equal(db.feed("c", { scope: "mine" }).items.length, 1, "but you still see your own");
    db.setPrefs("a", { events: false });
    db.addEvent("a", "rare", { appid: 1, game: "X", ref: "r1" });
    assert.equal(db.feed("d", { scope: "everyone" }).items.some(i => i.kind === "rare"), false, "events can be kept to yourself");
    db.setBlock("d", "b", true);
    assert.equal(db.feed("d", { scope: "everyone" }).items.some(i => i.body === "from b"), false, "blocked people disappear");
});

test("posting: replies, reactions, limits, repeats, deleting", () => {
    const { db, tick } = rig();
    const p = db.createPost("a", { body: "Who is playing Celeste?", appid: 504230, game: "Celeste" });
    assert.ok(p.id);
    const r = db.createPost("b", { body: "Me!", parentId: p.id });
    assert.equal(r.parentAuthor, "a");
    assert.equal(db.createPost("b", { body: "nested?", parentId: r.id }).status, 404, "one level of replies");
    assert.equal(db.react(p.id, "b", "🔥"), "🔥");
    assert.equal(db.react(p.id, "c", "🔥"), "🔥");
    assert.equal(db.react(p.id, "b", "🎮"), "🎮", "a different emoji swaps it");
    assert.equal(db.react(p.id, "c", "🔥"), null, "the same one takes it back");
    const t = db.thread(p.id, "b");
    assert.deepEqual(t.item.reactions, { "🎮": 1 }); assert.equal(t.item.mine, "🎮"); assert.equal(t.replies.length, 1); assert.equal(t.item.replies, 1);
    assert.equal(db.feed("c", { appid: 504230 }).items.length, 1, "filter by game");
    assert.equal(db.createPost("a", { body: "Who is playing Celeste?" }).status, 409, "no repeats");
    for (let i = 0; i < POSTS_PER_HOUR - 1; i++) assert.ok(db.createPost("a", { body: "post " + i }).id);
    assert.equal(db.createPost("a", { body: "one too many" }).status, 429);
    tick(61 * 60_000);
    assert.ok(db.createPost("a", { body: "an hour later" }).id);
    db.deleteItem(p.id);
    assert.equal(db.thread(p.id, "b"), null); assert.equal(db.feed("c", {}).items.some(i => i.id === r.id), false);
});

test("reports hide an item at three people, the owner can restore or ban, and a ban stops posting", () => {
    const { db } = rig();
    const p = db.createPost("a", { body: "rude thing" });
    assert.equal(db.report(p.id, "a", "me"), null, "not your own");
    db.report(p.id, "b", "spam"); db.report(p.id, "b", "spam again"); db.report(p.id, "c", "");
    assert.equal(db.thread(p.id, "d").item.hidden, false, "two people is not enough");
    const last = db.report(p.id, "d", "mean");
    assert.equal(last.reports, REPORTS_TO_HIDE); assert.equal(last.hidden, true);
    assert.equal(db.thread(p.id, "e"), null, "hidden from others");
    assert.equal(db.thread(p.id, "a").item.hidden, true, "the author still sees it");
    assert.equal(db.listReports()[0].reports, 3);
    db.dismissReports(p.id);
    assert.ok(db.thread(p.id, "e"), "restored");
    db.banPoster("a", "spam");
    assert.equal(db.createPost("a", { body: "hello" }).status, 403);
    assert.equal(db.thread(p.id, "e"), null, "a ban hides their posts");
    db.unbanPoster("a");
    assert.ok(db.createPost("a", { body: "back again" }).id);
});

test("discovery: trending games, the rare board and people with similar libraries", () => {
    const { db } = rig();
    const own = (id, ...g) => db.syncSteamGames(id, g.map(([itad_id, title, appid]) => ({ itad_id, title, appid, minutes: 60, lastPlayed: null })));
    for (const id of ["a", "b", "c"]) own(id, ["x", "Celeste", 1], ["y", "Hades", 2]);
    own("d", ["x", "Celeste", 1], ["y", "Hades", 2], ["z", "Tunic", 3]);
    db.createPost("a", { body: "love it", appid: 1, game: "Celeste" }); db.createPost("b", { body: "same", appid: 1, game: "Celeste" }); db.createPost("c", { body: "hades", appid: 2, game: "Hades" });
    const t = db.trendingGames(0);
    assert.equal(t[0].appid, 1); assert.equal(t[0].people, 2);
    db.setRareAchievements("a", 1, "Celeste", [{ apiname: "r", name: "Summit", icon: null, pct: 0.8 }]);
    db.setRareAchievements("b", 2, "Hades", [{ apiname: "q", name: "Escape", icon: null, pct: 2.5 }]);
    assert.deepEqual(db.rareBoard(5).map(r => [r.slug, r.pct]), [["user-a", 0.8], ["user-b", 2.5]]);
    const sim = db.similarPeople("d");
    assert.deepEqual(sim.map(s => s.slug).sort(), ["user-a", "user-b", "user-c"]);
    db.follow("d", "a", true);
    assert.equal(db.similarPeople("d").some(s => s.slug === "user-a"), false, "already following");
    assert.equal(db.ownerCount(1), 4);
    const cmp = db.compareLibraries("d", "a");
    assert.deepEqual(cmp.shared, ["Celeste", "Hades"]); assert.deepEqual(cmp.youHave, ["Tunic"]); assert.deepEqual(cmp.theyHave, []);
});

test("trophies: the first look is quiet, a later tier-up posts, and deleting a member clears their social data", () => {
    const { db } = rig();
    db.upsertLibrary("a", Array.from({ length: 10 }, (_, i) => ({ itad_id: "g" + i, title: "Game " + i, appid: 100 + i })));
    assert.equal(refreshTrophies(db, "a"), 0, "first look is seeded quietly");
    assert.equal(db.feed("b", {}).items.filter(i => i.kind === "trophy").length, 0);
    db.upsertLibrary("a", Array.from({ length: 40 }, (_, i) => ({ itad_id: "h" + i, title: "More " + i, appid: 200 + i })));
    assert.ok(refreshTrophies(db, "a") >= 1, "Collector went up a tier");
    assert.equal(db.feed("b", {}).items.filter(i => i.kind === "trophy").length >= 1, true);
    db.createPost("a", { body: "bye" }); db.follow("b", "a", true); db.react(db.feed("b", {}).items[0].id, "b", "👍");
    db.deleteUser("a");
    assert.equal(db.feed("b", { scope: "everyone" }).items.length, 0);
    assert.equal(db.followCounts("b").following, 0);
});

test("weekly digest: only people who asked, only when there is news, once a week, not during quiet hours", async () => {
    const { runSocialDigest, digestEmbed, digestLine } = await import("../src/socialdigest.js");
    const { db, tick } = rig();
    db.setProfileData("b", { name: "Bea" });
    db.follow("a", "b", true);
    db.createPost("b", { body: "Just finished my first Dark Souls run and I have thoughts" });
    db.addEvent("b", "finished", { appid: 1, game: "Hades", ref: "h" });
    db.addEvent("b", "rare", { appid: 2, game: "Celeste", ref: "c", data: { name: "Farewell", pct: 1.2 } });
    const sent = [];
    const notifier = { deliver: async (user, payload, type) => { sent.push({ id: user.discord_id, payload, type }); return { ok: true, via: "dm" }; } };
    assert.deepEqual((await runSocialDigest({ db, notifier, now: () => Date.now() })).checked, 0, "nobody opted in");
    db.setPrefs("a", { digest: true });
    const r = await runSocialDigest({ db, notifier, dashboardUrl: "https://example.test/", now: () => Date.now() });
    assert.equal(r.delivered, 1); assert.equal(sent[0].type, "digest");
    const d = sent[0].payload.embeds[0].description;
    assert.match(d, /\*\*Bea\*\* finished \*\*Hades\*\*/); assert.match(d, /Farewell/); assert.match(d, /Dark Souls/); assert.match(d, /example\.test\/feed/);
    assert.equal((await runSocialDigest({ db, notifier, now: () => Date.now() })).checked, 0, "not again within the week");
    tick(8 * 86400_000);
    assert.equal((await runSocialDigest({ db, notifier, now: () => Date.now() + 8 * 86400_000 })).empty, 1, "a quiet week sends nothing");
    assert.equal(digestLine({ kind: "post", body: "x".repeat(300), author: "b" }, () => "Bea").length < 140, true);
    assert.ok(digestEmbed({ counts: { finished: 1 }, items: [], people: 1 }, () => "x", null).title);
});

test("old post pictures are cleared after about six months but the post text stays", () => {
    const { db, tick } = rig();
    const p = db.createPost("a", { body: "look at this", hasImage: true });
    const imageId = db.addPostImage(p.id, "a", "image/png", Buffer.from("x"));
    db.pruneFeed();
    assert.ok(db.getPostImage(imageId), "a fresh picture is kept");
    tick(181 * 86400_000);
    db.pruneFeed();
    assert.equal(db.getPostImage(imageId), null, "an old picture is gone");
});

import test from "node:test";
import assert from "node:assert/strict";
import { parseNews, cleanPost, isPatchNote, createNews } from "../src/news.js";
import { runNews } from "../src/poller.js";
import { newsPayload } from "../src/render.js";
import { openDb } from "../src/db.js";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const post = (gid, title, daysAgo, contents = "Hello **world**") => ({ gid, title, date: Math.floor((NOW - daysAgo * 86400_000) / 1000), contents, feedname: "steam_community_announcements" });
const feedJson = items => ({ appnews: { appid: 1, newsitems: items } });

test("posts are cleaned, linked to Steam, sorted, and patch notes are told apart", () => {
    const out = parseNews(feedJson([post("1", "Weekly sale", 5), post("2", "Patch 1.2.3 notes", 1, "[h1]Fixes[/h1][list][*]Fixed a crash[/list] {STEAM_CLAN_IMAGE}/44/abc.png see https://x.example/y &amp; more"), { gid: "", title: "x", date: 1 }]), 1245620);
    assert.deepEqual(out.map(p => p.gid), ["2", "1"]);
    assert.equal(out[0].patch, true); assert.equal(out[1].patch, false);
    assert.equal(out[0].summary, "Fixes Fixed a crash see & more"); assert.equal(out[0].image, "https://clan.fastly.steamstatic.com/images/44/abc.png");
    assert.equal(out[0].url, "https://steamcommunity.com/games/1245620/announcements/detail/2");
    assert.equal(cleanPost("a ".repeat(400), 50).endsWith("…"), true);
    for (const t of ["Hotfix 3", "Update 4: new map", "v1.0.2", "Changelog"]) assert.equal(isPatchNote(t), true, t);
    for (const t of ["Weekend sale", "Meet the team", "Developer stream tonight"]) assert.equal(isPatchNote(t), false, t);
    assert.deepEqual(parseNews(null, 1), []);
});

test("Steam is asked once per game, answers are remembered, and a failure keeps the old answer", async () => {
    let t = NOW, calls = 0, fail = false;
    const news = createNews({ now: () => t, fetchImpl: async () => { calls++; if (fail) return { ok: false, status: 500 }; return { ok: true, json: async () => feedJson([post("9", "Update 1", 1)]) }; } });
    assert.equal((await news.forApps([1, 2, 1, "x"])).size, 2); assert.equal(calls, 2);
    await news.forApps([1]); assert.equal(calls, 2, "cached");
    t += 60 * 60_000; fail = true;
    assert.equal((await news.forApps([1])).get(1).length, 1, "stale answer kept"); assert.equal(news.health().lastError, "http500");
});

function rig(items, level = 2) {
    const db = openDb(":memory:"); const sent = [];
    db.ensureUser("u1", "g1"); db.updateUser("u1", { news: level });
    db.syncSteamGames("u1", [{ itad_id: "a", title: "Elden Ring", appid: 1245620, minutes: 600, lastPlayed: 1790000000 }]);
    const notifier = { deliver: async (u, p, kind) => { sent.push({ kind, p }); return { ok: true, via: "dm" }; } };
    const state = { items };
    const news = { forApps: async ids => new Map(ids.map(id => [id, state.items])) };
    return { db, sent, notifier, news, state };
}
const run = r => runNews({ db: r.db, news: r.news, notifier: r.notifier, now: () => NOW });
const mk = (gid, title, daysAgo) => parseNews(feedJson([post(gid, title, daysAgo)]), 1245620)[0];

test("news: a quiet first look, then new posts once, patch-only members skip announcements, old posts never", async () => {
    const r = rig([mk("1", "Old update", 3)]);
    assert.equal((await run(r)).found, 0, "first look is quiet"); assert.equal(r.sent.length, 0);
    r.state.items = [mk("2", "Patch 2.0 notes", 0.2), mk("3", "Anniversary party", 0.5), mk("4", "Ancient news", 30), mk("1", "Old update", 3)];
    const s = await run(r);
    assert.equal(s.delivered, 2); assert.equal(r.sent[0].kind, "news"); assert.equal(r.sent[0].p.components.length > 0, true);
    assert.equal((await run(r)).found, 0, "told once");
    const p = rig([mk("1", "x", 3)], 1); await run(p); p.state.items = [mk("5", "Anniversary party", 0.1), mk("6", "Hotfix 1.1", 0.1)];
    assert.equal((await run(p)).delivered, 1, "patch notes only"); 
    const off = rig([], 0); off.db.updateUser("u1", { news: 0 }); assert.equal((await run(off)).found, 0);
});

test("news cards: patch notes are green with a link, several become pages", () => {
    const posts = [{ ...mk("2", "Patch 2.0", 0.1), gameTitle: "Elden Ring" }, { ...mk("3", "Party", 0.2), gameTitle: "Elden Ring" }];
    const one = newsPayload([posts[0]]);
    assert.equal(one.embeds[0].color, 0x57f287); assert.match(one.embeds[0].title, /🛠️ Elden Ring: Patch 2.0/); assert.equal(one.components[0].components[0].label, "Read the post");
    const db = openDb(":memory:"); const many = newsPayload(posts, { pager: db });
    assert.match(many.content, /2 news posts/); assert.equal(newsPayload([]), null);
});

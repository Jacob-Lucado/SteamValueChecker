import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { parseNewsFeed, fetchNews, cleanDrop, dropEmbed, newsEmbed, runDrops, applyDropSettings, NEWS_FEEDS } from "../src/drops.js";
import { createDropHandlers } from "../src/dropshandlers.js";

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const rss = items => `<?xml version="1.0"?><rss><channel><title>x</title>${items.map(([t, l, d]) => `<item><title><![CDATA[${t}]]></title><link>${l}</link><description><![CDATA[${d ?? ""}]]></description></item>`).join("")}</channel></rss>`;
const NV = { key: "nvidia", name: "NVIDIA" };
const DBD = { key: "dbd", name: "Dead by Daylight", kind: "game" };

function fakeApi() {
    const sent = [], edits = [];
    let n = 0;
    return { sent, edits, api: {
        sendMessage: async (channel, payload) => { sent.push({ channel, payload }); return { id: "m" + (++n) }; },
        editMessage: async (channel, id, payload) => { edits.push({ channel, id, payload }); return {}; }
    } };
}

test("promos: only blog posts that sound like a giveaway are kept", () => {
    const xml = rss([
        ["GFN Thursday: Five new games arrive", "https://blogs.nvidia.com/a/", "Weekly roundup of games."],
        ["Claim your free month of GeForce NOW", "https://blogs.nvidia.com/b/", "Redeem the code below."],
        ["SteelSeries is giving away 3 keys", "https://steelseries.com/blog/c", ""],
        ["Broken item", "http://insecure.example/d", "giveaway"]
    ]);
    const got = parseNewsFeed(xml, NV);
    assert.deepEqual(got.map(g => g.url), ["https://blogs.nvidia.com/b/", "https://steelseries.com/blog/c"]);
    assert.equal(got[0].key, "nvidia:https://blogs.nvidia.com/b/");
    assert.deepEqual(parseNewsFeed("not xml at all", NV), []);
    assert.deepEqual(parseNewsFeed(null, NV), []);
});

test("promos: game news from Steam is read the same way, with the code and giveaway wording", () => {
    const xml = rss([["10.3.0 | Terrifier PTB Patch Notes", "https://steamstore-a.akamaihd.net/news/externalpost/a/1", "Patch notes and fixes."],
        ["Bloodpoint redeem code for the anniversary", "https://steamstore-a.akamaihd.net/news/externalpost/a/2", ""],
        ["Custom Alienware Laptop Sweepstakes", "https://steamstore-a.akamaihd.net/news/externalpost/a/3", ""]]);
    const got = parseNewsFeed(xml, DBD);
    assert.deepEqual(got.map(g => g.url.slice(-1)), ["2", "3"]);
    assert.equal(got[0].kind, "game");
    assert.match(newsEmbed(got[0]).embeds[0].author.name, /Dead by Daylight news/);
    assert.ok(NEWS_FEEDS.some(f => f.key === "dbd" && f.url.includes("/381210/")));
});

test("promos: one blog being down does not hide the other, both down is an error", async () => {
    const good = rss([["Giveaway time", "https://steelseries.com/blog/g", ""]]);
    const fetchImpl = async url => (url.includes("nvidia") || url.includes("steampowered") ? { ok: false, status: 503 } : { ok: true, text: async () => good });
    const r = await fetchNews({ fetchImpl });
    assert.equal(r.items.length, 1); assert.equal(r.errors.length, NEWS_FEEDS.length - 1);
    await assert.rejects(fetchNews({ fetchImpl: async () => ({ ok: false, status: 500 }) }), /NVIDIA.*SteelSeries.*Dead by Daylight/);
    assert.ok(NEWS_FEEDS.every(f => f.url.startsWith("https://")));
});

test("promos: what a manager types is checked", () => {
    const ok = cleanDrop({ title: "  SteelSeries key ", code: "ABCD-1234", url: "https://example.com/x", days: 3, source: "SteelSeries" }, NOW);
    assert.equal(ok.title, "SteelSeries key"); assert.equal(ok.expiresAt, NOW + 3 * 86400_000);
    assert.equal(cleanDrop({ title: "Link only", url: "https://example.com" }, NOW).code, null);
    assert.throws(() => cleanDrop({ title: "", code: "X" }), /title/);
    assert.throws(() => cleanDrop({ title: "x" }), /code, a link/);
    assert.throws(() => cleanDrop({ title: "x", code: "has space" }), /code looks wrong/);
    assert.throws(() => cleanDrop({ title: "x", code: "a`b" }), /code looks wrong/);
    assert.throws(() => cleanDrop({ title: "x", url: "http://example.com" }), /https/);
    assert.throws(() => cleanDrop({ title: "x", url: "javascript:alert(1)" }), /https/);
    assert.throws(() => cleanDrop({ title: "x", code: "A", days: 0 }), /between 1 and 365/);
    assert.throws(() => cleanDrop({ title: "x", code: "A", days: 999 }), /between 1 and 365/);
});

test("promos: the post shows the code and link, and grays out when it ends", () => {
    const d = { id: 1, title: "Game On key", source: "SteelSeries", code: "ABCD-1234", url: "https://example.com", note: "One per account", expires_at: NOW + 86400_000 };
    const live = dropEmbed(d);
    assert.match(live.embeds[0].description, /ABCD-1234/);
    assert.equal(live.components[0].components[0].url, "https://example.com");
    assert.ok(live.embeds[0].fields.some(f => f.name === "Good to know"));
    const over = dropEmbed(d, { ended: true });
    assert.match(over.embeds[0].title, /^Ended:/); assert.match(over.embeds[0].description, /~~ABCD-1234~~/); assert.deepEqual(over.components, []);
    assert.equal(newsEmbed({ source: "NVIDIA", title: "t", url: "https://blogs.nvidia.com/x/", summary: "s" }).components[0].components[0].url, "https://blogs.nvidia.com/x/");
});

test("promos: a drop is posted once, pings the role, and is edited when it ends", async () => {
    const db = openDb(":memory:");
    const { api, sent, edits } = fakeApi();
    const run = () => runDrops({ db, api, now: () => NOW, sleep: async () => {}, getNews: async () => ({ items: [], errors: [] }) });
    db.setDropSettings("g1", { channel_id: "c1", role_id: "r1" });
    const id = db.addDrop({ guildId: "g1", title: "Key", code: "ABCD", expiresAt: NOW + 86400_000 });
    db.addDrop({ guildId: "g2", title: "Other server", code: "ZZZZ" });
    await run(); await run(); await run();
    assert.equal(sent.length, 1, "once, however many polls");
    assert.equal(sent[0].channel, "c1"); assert.match(sent[0].payload.content, /<@&r1>/);
    assert.equal(edits.length, 0);
    assert.ok(db.endDrop(id));
    const r = await run(); await run();
    assert.equal(edits.length, 1, "edited once"); assert.match(edits[0].payload.embeds[0].title, /^Ended/);
    assert.equal(r.failed, 0);
    // a drop whose date passes ends on its own
    const id2 = db.addDrop({ guildId: "g1", title: "Short", code: "SHORT1", expiresAt: NOW + 1000 });
    await run();
    const later = await runDrops({ db, api, now: () => NOW + 5000, sleep: async () => {}, getNews: async () => ({ items: [], errors: [] }) });
    assert.equal(later.ended, 1); assert.equal(db.getDrop(id2).status, "ended");
});

test("promos: a failed post is tried again, and a server with no channel gets nothing", async () => {
    const db = openDb(":memory:");
    let fail = true; const sent = [];
    const api = { sendMessage: async (c, p) => { if (fail) throw Object.assign(new Error("no"), { status: 403 }); sent.push(p); return { id: "m1" }; }, editMessage: async () => ({}) };
    db.setDropSettings("g1", { channel_id: "c1" });
    db.addDrop({ guildId: "g1", title: "K", code: "ABCD" });
    db.addDrop({ guildId: "g3", title: "No channel", code: "NOPE1" });
    const run = () => runDrops({ db, api, now: () => NOW, sleep: async () => {}, getNews: async () => ({ items: [], errors: [] }) });
    assert.equal((await run()).failed, 1);
    fail = false; await run(); await run();
    assert.equal(sent.length, 1);
});

test("promos: blog posts are only sent to servers that opted in, only new ones, and only once", async () => {
    const db = openDb(":memory:");
    const { api, sent } = fakeApi();
    const item = n => ({ key: `nvidia:https://blogs.nvidia.com/${n}/`, source: "NVIDIA", title: `Giveaway ${n}`, url: `https://blogs.nvidia.com/${n}/`, summary: "" });
    let items = [item(1), item(2)];
    const run = () => runDrops({ db, api, now: () => NOW, sleep: async () => {}, getNews: async () => ({ items, errors: [] }) });
    db.setDropSettings("g1", { channel_id: "c1", news: false });
    db.setDropSettings("g2", { channel_id: "c2", news: true });
    await run();
    assert.equal(sent.length, 0, "the first time on, old posts are marked seen, not posted");
    items = [item(1), item(2), item(3)];
    await run(); await run();
    assert.equal(sent.length, 1); assert.equal(sent[0].channel, "c2"); assert.match(sent[0].payload.embeds[0].title, /Giveaway 3/);
    // a feed that fails keeps everything else working
    const r = await runDrops({ db, api, now: () => NOW, sleep: async () => {}, getNews: async () => { throw new Error("down"); } });
    assert.match(r.feedError, /down/);
    // nobody opted in: the blogs are not even read
    const db2 = openDb(":memory:"); let read = 0;
    db2.setDropSettings("g1", { channel_id: "c1" });
    await runDrops({ db: db2, api, getNews: async () => { read++; return { items: [], errors: [] }; }, sleep: async () => {} });
    assert.equal(read, 0);
});

test("promos: settings", () => {
    const db = openDb(":memory:");
    assert.deepEqual(db.getDropSettings("g1"), { guild_id: "g1", channel_id: null, role_id: null, news: false });
    const s = applyDropSettings(db, "g1", { channel_id: "c1", role_id: "r1", news: true });
    assert.equal(s.channel_id, "c1"); assert.equal(s.news, true);
    assert.equal(applyDropSettings(db, "g1", { news: false }).news, false);
});

// ---------- the slash command ----------
function ix({ sub, opts = {}, manage = true, guild = "g1" }) {
    const out = { replies: [] };
    return Object.assign(out, {
        inGuild: () => Boolean(guild), guildId: guild, user: { id: "u1" }, replied: false, deferred: false,
        memberPermissions: { has: () => manage },
        options: { getSubcommand: () => sub, getString: n => opts[n] ?? null, getInteger: n => opts[n] ?? null, getBoolean: n => opts[n] ?? null, getChannel: n => opts[n] ?? null, getRole: n => opts[n] ?? null },
        reply: async p => { out.replies.push(p); }
    });
}
const text = i => i.replies.map(r => r.content ?? r.embeds?.[0]?.description ?? "").join("\n");

test("promos: /promos add needs Manage Server, a channel and a code or link", async () => {
    const db = openDb(":memory:"); let ran = 0;
    const ui = createDropHandlers({ db, runNow: async () => { ran++; } });
    let i = ix({ sub: "add", opts: { title: "Key", code: "ABCD" }, manage: false }); await ui.handleCommand(i);
    assert.match(text(i), /Manage Server/);
    i = ix({ sub: "add", opts: { title: "Key", code: "ABCD" } }); await ui.handleCommand(i);
    assert.match(text(i), /Pick a channel first/);
    db.setDropSettings("g1", { channel_id: "c1" });
    i = ix({ sub: "add", opts: { title: "Key" } }); await ui.handleCommand(i);
    assert.match(text(i), /code, a link/);
    i = ix({ sub: "add", opts: { title: "Key", code: "ABCD", days: 2 } }); await ui.handleCommand(i);
    assert.match(text(i), /Added as #1/); assert.equal(ran, 1);
    // anyone can list; ending is for managers and only in the same server
    i = ix({ sub: "list", manage: false }); await ui.handleCommand(i);
    assert.match(text(i), /Key/);
    i = ix({ sub: "end", opts: { id: 1 }, manage: false }); await ui.handleCommand(i);
    assert.match(text(i), /Manage Server/);
    i = ix({ sub: "end", opts: { id: 1 }, guild: "g2" }); await ui.handleCommand(i);
    assert.match(text(i), /don't have a drop/);
    i = ix({ sub: "end", opts: { id: 1 } }); await ui.handleCommand(i);
    assert.match(text(i), /Ended #1/);
    i = ix({ sub: "end", opts: { id: 1 } }); await ui.handleCommand(i);
    assert.match(text(i), /already ended/);
    i = ix({ sub: "list", guild: null }); await ui.handleCommand(i);
    assert.match(text(i), /in servers/);
});

test("promos: /promos news needs a channel first", async () => {
    const db = openDb(":memory:");
    const ui = createDropHandlers({ db });
    let i = ix({ sub: "news", opts: { on: true } }); await ui.handleCommand(i);
    assert.match(text(i), /Pick a channel first/);
    db.setDropSettings("g1", { channel_id: "c1" });
    i = ix({ sub: "news", opts: { on: true } }); await ui.handleCommand(i);
    assert.equal(db.getDropSettings("g1").news, true);
    i = ix({ sub: "news", opts: { on: false } }); await ui.handleCommand(i);
    assert.equal(db.getDropSettings("g1").news, false);
});

test("promos: community setup includes a promo-drops channel that only adds to existing servers", async () => {
    const { TEMPLATE, ADDED_LATER } = await import("../src/community.js");
    const ch = TEMPLATE.categories.flatMap(c => c.channels ?? []).find(c => c.key === "drops");
    assert.equal(ch?.name, "promo-drops"); assert.equal(ch.readonly, true);
    assert.ok(ADDED_LATER.has("drops"));
});

// ---------- alerts to a member's own DMs ----------
import { sendCodeAlerts, sendNewsAlerts } from "../src/dropalerts.js";
import { cleanEntry } from "../src/codesource.js";
import { runCodes } from "../src/codes.js";

const shiftCode = (n, game = "Borderlands 4", at = Date.now()) => cleanEntry({ code: `AAAA${n}-BBBBB-CCCCC-DDDDD-EEEEE`, type: "shift", game, platform: "universal", reward: "3 Golden Keys", expires: "Dec 5, 2026", archived: "2026-11-01 11:00:00+00:00" }, at);
function fakeNotifier({ ok = true } = {}) {
    const sent = [];
    return { sent, deliver: async (user, payload, type) => { sent.push({ id: user.discord_id, payload, type }); return ok ? { ok: true, via: "dm" } : { ok: false, reason: "dm_failed_no_channel" }; } };
}
function dbWithUser(id = "u1") {
    const db = openDb(":memory:");
    db.ensureUser(id);
    return db;
}

test("alerts: a member gets new codes once, only for the games they picked, and nothing from before they opted in", async () => {
    const db = dbWithUser();
    db.upsertCode(shiftCode(1)); // already there before they opt in
    await new Promise(r => setTimeout(r, 5));
    db.setAlertSubs("u1", { codes: true, games: ["bl4"] });
    const n = fakeNotifier();
    assert.equal((await sendCodeAlerts({ db, notifier: n, now: () => Date.now() })).delivered, 0);
    await new Promise(r => setTimeout(r, 5));
    db.upsertCode(shiftCode(2)); db.upsertCode(shiftCode(3, "Borderlands 2"));
    const run = () => sendCodeAlerts({ db, notifier: n, now: () => Date.now() });
    assert.equal((await run()).delivered, 1);
    await run(); await run();
    assert.equal(n.sent.length, 1, "once");
    assert.equal(n.sent[0].type, "codes"); assert.match(n.sent[0].payload.embeds[0].description, /AAAA2/);
    assert.equal(n.sent[0].payload.allowed_mentions, undefined);
    // turning it off stops everything
    db.setAlertSubs("u1", { codes: false });
    db.upsertCode(shiftCode(4));
    await run();
    assert.equal(n.sent.length, 1);
});

test("alerts: paused members, failed deliveries and codes that already ended are handled", async () => {
    const db = dbWithUser();
    db.setAlertSubs("u1", { codes: true });
    await new Promise(r => setTimeout(r, 5));
    db.upsertCode(shiftCode(1));
    const bad = fakeNotifier({ ok: false });
    const r = await sendCodeAlerts({ db, notifier: bad, now: () => Date.now() });
    assert.equal(r.failed, 1);
    const good = fakeNotifier();
    assert.equal((await sendCodeAlerts({ db, notifier: good, now: () => Date.now() })).delivered, 1, "a failed one is retried next time");
    db.updateUser("u1", { paused: 1 });
    db.upsertCode(shiftCode(2));
    assert.equal((await sendCodeAlerts({ db, notifier: good, now: () => Date.now() })).delivered, 0, "paused means nothing is sent");
    db.updateUser("u1", { paused: 0 });
    const expired = shiftCode(9); db.upsertCode(expired); db.setCodeStatus(db.codeByKey(expired.key).id, "expired");
    assert.equal(db.alertSubscribers("codes").length, 1);
    await sendCodeAlerts({ db, notifier: good, now: () => Date.now() });
    assert.ok(!good.sent.some(s => /AAAA9/.test(s.payload.embeds[0].description)), "an ended code is never sent");
});

test("alerts: promo news goes to members who asked, once, from when they turned it on", async () => {
    const db = dbWithUser();
    db.upsertNews({ key: "k0", source: "NVIDIA", kind: "blog", title: "Old giveaway", url: "https://blogs.nvidia.com/o/" });
    await new Promise(r => setTimeout(r, 5));
    db.setAlertSubs("u1", { promos: true });
    await new Promise(r => setTimeout(r, 5));
    db.upsertNews({ key: "k1", source: "Dead by Daylight", kind: "game", title: "Bloodpoint code", url: "https://steamstore-a.akamaihd.net/n/1" });
    const n = fakeNotifier();
    const run = () => sendNewsAlerts({ db, notifier: n });
    await run(); await run();
    assert.equal(n.sent.length, 1); assert.equal(n.sent[0].type, "promo"); assert.match(n.sent[0].payload.embeds[0].title, /Bloodpoint/);
});

test("alerts: the poll sends member alerts and reads the blogs even when no server asked for news", async () => {
    const db = dbWithUser();
    const { api } = fakeApi(); const n = fakeNotifier();
    db.setAlertSubs("u1", { promos: true });
    let read = 0;
    const item = { key: "x1", source: "SteelSeries", kind: "blog", title: "Key Giveaway", url: "https://steelseries.com/blog/k", summary: "" };
    await new Promise(r => setTimeout(r, 5));
    await runDrops({ db, api, notifier: n, sleep: async () => {}, getNews: async () => { read++; return { items: [item], errors: [] }; } });
    assert.equal(read, 1); assert.equal(n.sent.length, 1);
    db.setAlertSubs("u1", { codes: true });
    await new Promise(r => setTimeout(r, 5));
    const code = shiftCode(7); 
    await runCodes({ db, api, notifier: n, fetchCodes: async () => [code], now: () => Date.now(), sleep: async () => {} });
    assert.equal(n.sent.filter(s => s.type === "codes").length, 1);
});

test("alerts: codes can be muted, and the settings are on the dashboard and command", async () => {
    const { MUTABLE } = await import("../src/prefs.js");
    assert.ok(MUTABLE.includes("codes") && MUTABLE.includes("promo"));
    const { commands } = await import("../src/commands.js");
    const al = commands.find(c => c.name === "alerts");
    assert.ok(al.options.some(o => o.name === "codes") && al.options.some(o => o.name === "promos"));
});

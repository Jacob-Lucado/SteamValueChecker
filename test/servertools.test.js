import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { parseEmoji, emojiText, roleIsSafe, menuPayload, createRoleMenus, cleanStarboard, createStarboard, starPayload, parseOptions, pollPayload, createPolls, createSuggestions, suggestionPayload, saveTagChecked, cleanTagName } from "../src/servertools.js";

const G = "123456789012345678", CH = "223456789012345678", BOARD = "323456789012345678", ME = "423456789012345678";
function rig(over = {}) {
    let t = 1_000_000_000_000, n = 100;
    const db = openDb(":memory:", { now: () => t });
    const calls = [];
    const roles = [{ id: "111111111111111111", name: "Red", permissions: "0", managed: false }, { id: "222222222222222222", name: "Blue", permissions: "0" }, { id: "333333333333333333", name: "Mod", permissions: String(0x2n) }, { id: "444444444444444444", name: "Bot", permissions: "0", managed: true }, { id: G, name: "@everyone", permissions: "0" }];
    const api = {
        sendMessage: async (c, p) => { calls.push(["send", c, p]); return { id: String(++n) }; },
        editMessage: async (c, m, p) => { calls.push(["edit", c, m, p]); return {}; },
        deleteMessage: async (c, m) => { calls.push(["delete", c, m]); },
        allRoles: async () => roles, addRole: async (g, u, r) => { calls.push(["addRole", u, r]); }, removeRole: async (g, u, r) => { calls.push(["removeRole", u, r]); },
        getMessage: async () => over.message ?? { id: "m1", channel_id: CH, author: { id: "999999999999999999", username: "Ann" }, content: "hello", reactions: [{ emoji: { name: "⭐" }, count: 3 }], attachments: [], timestamp: new Date(t).toISOString() },
        getChannel: async () => ({ nsfw: Boolean(over.nsfw) }), reactionUsers: async () => over.who ?? [],
        ...over.api
    };
    return { db, api, calls, roles, tick: ms => { t += ms; }, now: () => t };
}

test("emoji: custom and unicode parse, junk does not", () => {
    assert.deepEqual(parseEmoji("<:pog:123456789012345678>"), { name: "pog", id: "123456789012345678", animated: false });
    assert.equal(emojiText(parseEmoji("<a:wave:123456789012345678>")), "<a:wave:123456789012345678>");
    assert.deepEqual(parseEmoji("🎮 games"), { name: "🎮" });
    assert.deepEqual(parseEmoji("⭐"), { name: "⭐" });
    assert.equal(parseEmoji("hello"), null);
    assert.equal(parseEmoji(""), null);
});

test("only plain roles can be handed out", () => {
    assert.equal(roleIsSafe({ id: "1", permissions: "0" }, G), true);
    assert.equal(roleIsSafe({ id: "1", permissions: String(0x8n) }, G), false, "administrator");
    assert.equal(roleIsSafe({ id: "1", permissions: String(1n << 40n) }, G), false, "moderate members");
    assert.equal(roleIsSafe({ id: "1", permissions: "0", managed: true }, G), false);
    assert.equal(roleIsSafe({ id: G, permissions: "0" }, G), false, "@everyone");
    assert.equal(roleIsSafe({ id: "1", permissions: "garbage" }, G), false);
});

test("a role menu: buttons in rows of five, add, press, single choice, remove", async () => {
    const r = rig(), menus = createRoleMenus({ db: r.db, api: r.api });
    const menu = await menus.create({ guildId: G, channelId: CH, title: "Pick", mode: "single" });
    assert.equal(r.calls[0][0], "send");
    assert.match(r.calls[0][2].embeds[0].description, /No roles yet/);
    await menus.addRole({ guildId: G, menuId: menu.id, roleId: "111111111111111111", label: "", emoji: "🔴" });
    await menus.addRole({ guildId: G, menuId: menu.id, roleId: "222222222222222222" });
    await assert.rejects(menus.addRole({ guildId: G, menuId: menu.id, roleId: "333333333333333333" }), /moderate or manage/);
    await assert.rejects(menus.addRole({ guildId: G, menuId: menu.id, roleId: "444444444444444444" }), /managed by an app/);
    await assert.rejects(menus.addRole({ guildId: G, menuId: menu.id, roleId: "999" }), /does not exist/);
    const last = r.calls.filter(c => c[0] === "edit").at(-1)[3];
    assert.equal(last.components[0].components.length, 2);
    assert.equal(last.components[0].components[0].custom_id, `rm:${menu.id}:111111111111111111`);
    assert.deepEqual(last.components[0].components[0].emoji, { name: "🔴" });
    const press = (roleId, has) => menus.press({ customId: `rm:${menu.id}:${roleId}`, guildId: G, user: { id: "u1" }, member: { roles: { cache: { has: id => has.includes(id) } } } });
    assert.match(await press("111111111111111111", []), /now have/);
    assert.deepEqual(r.calls.filter(c => c[0] === "addRole").map(c => c[2]), ["111111111111111111"]);
    r.calls.length = 0;
    await press("222222222222222222", ["111111111111111111"]);
    assert.deepEqual(r.calls.map(c => c[0] + ":" + c[2]), ["removeRole:111111111111111111", "addRole:222222222222222222"], "single choice swaps the old role out");
    assert.match(await press("222222222222222222", ["222222222222222222"]), /Removed/);
    assert.match(await press("999999999999999999", []), /not on the menu/);
    await menus.removeRole({ guildId: G, menuId: menu.id, roleId: "111111111111111111" });
    assert.equal(r.db.roleMenuItems(menu.id).length, 1);
    await menus.remove({ guildId: G, menuId: menu.id });
    assert.equal(r.db.getRoleMenu(menu.id), null);
    const big = menuPayload({ id: 1, title: "t", mode: "toggle" }, Array.from({ length: 12 }, (_, i) => ({ role_id: String(i), label: "R" + i })));
    assert.deepEqual(big.components.map(c => c.components.length), [5, 5, 2]);
});

test("the starboard posts at the threshold, updates the count, ignores self-stars, and cleans up", async () => {
    const r = rig({ who: [{ id: "999999999999999999" }] });          // the author starred their own post too
    const sb = createStarboard({ db: r.db, api: r.api });
    const d = { guild_id: G, channel_id: CH, message_id: "m1", emoji: { name: "⭐" } };
    assert.equal(await sb.onReaction(d), false, "off by default");
    r.db.setToolSetting("starboard", G, cleanStarboard({ on: true, channel: BOARD, threshold: 3 }));
    await sb.onReaction(d);                                          // 3 stars, one is the author's: 2 < 3
    assert.equal(r.calls.filter(c => c[0] === "send").length, 0);
    const r2 = rig({ who: [] });
    const sb2 = createStarboard({ db: r2.db, api: r2.api });
    r2.db.setToolSetting("starboard", G, cleanStarboard({ on: true, channel: BOARD, threshold: 3 }));
    await sb2.onReaction(d);
    const sent = r2.calls.find(c => c[0] === "send");
    assert.equal(sent[1], BOARD);
    assert.match(sent[2].content, /⭐ \*\*3\*\*/);
    assert.equal(sent[2].embeds[0].author.name, "Ann");
    assert.equal(r2.db.getStarPost(G, "m1").stars, 3);
    await sb2.onReaction(d);                                         // same count: an edit, not a second post
    assert.equal(r2.calls.filter(c => c[0] === "send").length, 1);
    assert.equal(r2.calls.filter(c => c[0] === "edit").length, 1);
    await sb2.onReaction({ ...d, channel_id: BOARD });               // reactions on the board itself are ignored
    await sb2.onReaction({ ...d, emoji: { name: "👍" } });
    assert.equal(r2.calls.filter(c => c[0] === "edit").length, 1);
    await sb2.onCleared({ guild_id: G, message_id: "m1" });
    assert.equal(r2.db.getStarPost(G, "m1"), null);
    assert.equal(r2.calls.at(-1)[0], "delete");
    // NSFW channels and bot authors never reach the board.
    const nsfw = rig({ nsfw: true }); nsfw.db.setToolSetting("starboard", G, cleanStarboard({ on: true, channel: BOARD, threshold: 1 }));
    await createStarboard({ db: nsfw.db, api: nsfw.api }).onReaction(d); assert.equal(nsfw.calls.filter(c => c[0] === "send").length, 0);
    const bot = rig({ message: { id: "m1", channel_id: CH, author: { id: "9", bot: true }, reactions: [{ emoji: { name: "⭐" }, count: 9 }] } }); bot.db.setToolSetting("starboard", G, cleanStarboard({ on: true, channel: BOARD, threshold: 1 }));
    await createStarboard({ db: bot.db, api: bot.api }).onReaction(d); assert.equal(bot.calls.filter(c => c[0] === "send").length, 0);
    assert.deepEqual(cleanStarboard({ on: 1, channel: "nope", threshold: 99, emoji: "xx" }), { on: true, channel: null, threshold: 25, emoji: "⭐", selfStar: false });
    const p = starPayload({ id: "m", channel_id: CH, author: { id: "1", username: "A" }, content: "x", attachments: [{ url: "https://cdn/x.png", filename: "x.png", content_type: "image/png" }, { url: "u2", filename: "a.zip" }], timestamp: new Date().toISOString() }, 5, cleanStarboard({}), G);
    assert.equal(p.embeds[0].image.url, "https://cdn/x.png");
    assert.match(p.embeds[0].description, /\+1 more attachment/);
});

test("polls: options, single and multiple choice, results, ending and the timer", async () => {
    assert.deepEqual(parseOptions("a | b\n b ; c |  "), ["a", "b", "c"]);
    const r = rig(), polls = createPolls({ db: r.db, api: r.api, now: r.now });
    await assert.rejects(polls.create({ guildId: G, channelId: CH, question: "q", options: ["only"] }), /at least two/);
    const p = await polls.create({ guildId: G, channelId: CH, question: "Best?", options: ["Hades", "Celeste", "Tunic"], hours: 1 });
    assert.equal(r.calls[0][2].components[0].components.length, 3);
    const reply = [], i = (n, u) => ({ customId: `pl:${p.id}:${n}`, guildId: G, user: { id: u }, update: async x => reply.push(x), reply: async x => reply.push(x) });
    await polls.vote(i(0, "a")); await polls.vote(i(0, "b")); await polls.vote(i(1, "c"));
    await polls.vote(i(2, "a"));                                      // single choice: moves a's vote
    assert.deepEqual(r.db.pollVotes(p.id).map(v => v.user_id + v.option).sort(), ["b0", "c1", "a2"].sort());
    assert.match(reply.at(-1).embeds[0].description, /33%/);
    await polls.vote(i(2, "a"));                                      // pressing the same option takes it back
    assert.equal(r.db.pollVotes(p.id).length, 2);
    const m = await polls.create({ guildId: G, channelId: CH, question: "Many?", options: ["x", "y"], multi: true });
    r.db.castVote(m.id, "a", 0, true); r.db.castVote(m.id, "a", 1, true);
    assert.equal(r.db.pollVotes(m.id).length, 2, "multiple choice keeps both");
    r.tick(3600_001); await polls.tick();
    assert.equal(r.db.getPoll(p.id).closed, 1, "the timed poll ended by itself");
    assert.equal(r.db.getPoll(m.id).closed, 0, "the open-ended one did not");
    const last = r.calls.filter(c => c[0] === "edit").at(-1);
    assert.deepEqual(last[3].components, []);
    assert.match(last[3].embeds[0].description, /🏆/);
    await polls.vote(i(0, "z")); assert.match(reply.at(-1).content, /ended/);
    await assert.rejects(polls.end(p.id, G), /already ended/);
    await assert.rejects(polls.end(m.id, "other"), /not in this server/);
    for (let k = 0; k < 9; k++) await polls.create({ guildId: G, channelId: CH, question: "q" + k, options: ["a", "b"] });
    await assert.rejects(polls.create({ guildId: G, channelId: CH, question: "too many", options: ["a", "b"] }), /10 open polls/);
    assert.equal(pollPayload({ id: 1, question: "q", options: Array.from({ length: 10 }, (_, k) => "o" + k), multi: 0 }, []).components.length, 2);
});

test("suggestions: setup needed, a minute between ideas, votes toggle, decisions update the post", async () => {
    const r = rig(), s = createSuggestions({ db: r.db, api: r.api, now: r.now });
    await assert.rejects(s.submit({ guildId: G, userId: "u1", text: "A good long idea" }), /not set up/);
    r.db.setToolSetting("suggest", G, { channel: BOARD });
    await assert.rejects(s.submit({ guildId: G, userId: "u1", text: "short" }), /at least 10/);
    const one = await s.submit({ guildId: G, userId: "u1", text: "Add a movie night channel please" });
    assert.equal(one.id, 1); assert.equal(r.calls.at(-1)[1], BOARD);
    await assert.rejects(s.submit({ guildId: G, userId: "u1", text: "Another fine idea for you" }), /one suggestion a minute/);
    r.tick(61_000); assert.equal((await s.submit({ guildId: G, userId: "u1", text: "Another fine idea for you" })).id, 2);
    const out = [], press = (dir, u) => s.vote({ customId: `sg:1:${dir}`, guildId: G, user: { id: u }, update: async x => out.push(x), reply: async x => out.push(x) });
    await press("up", "a"); await press("up", "b"); await press("down", "b"); await press("up", "a");
    assert.deepEqual(r.db.suggestionVotes(1), { up: 0, down: 1 }, "a's second up-vote took it back, b switched to down");
    const done = await s.decide({ guildId: G, id: 1, status: "approved", note: "Coming in December", by: "mod" });
    assert.equal(done.status, "approved");
    const edit = r.calls.filter(c => c[0] === "edit").at(-1)[3];
    assert.deepEqual(edit.components, [], "no voting once decided");
    assert.match(JSON.stringify(edit.embeds[0].fields), /Coming in December/);
    await press("up", "c"); assert.match(out.at(-1).content, /closed/);
    await assert.rejects(s.decide({ guildId: G, id: 1, status: "maybe" }), /Pick a status/);
    await assert.rejects(s.decide({ guildId: "other", id: 1, status: "done" }), /no suggestion/);
    assert.equal(suggestionPayload({ id: 5, status: "open", text: "x", author_id: "1", created_at: 0 }, { up: 2, down: 1 }).components[0].components[0].label, "2");
});

test("custom commands: names are cleaned, limited and replaced", () => {
    const { db } = rig();
    assert.equal(cleanTagName(" !Rules "), "rules");
    assert.equal(saveTagChecked(db, G, "/Rules", "Be kind.", "u1"), "rules");
    saveTagChecked(db, G, "rules", "Be very kind.", "u1");
    assert.equal(db.getTag(G, "rules").response, "Be very kind.");
    assert.throws(() => saveTagChecked(db, G, "bad name", "x"), /1 to 32/);
    assert.throws(() => saveTagChecked(db, G, "ok", "  "), /Write what/);
    assert.throws(() => saveTagChecked(db, G, "ok", "x".repeat(1801)), /1,800/);
    for (let i = 0; i < 99; i++) saveTagChecked(db, G, "t" + i, "x");
    assert.throws(() => saveTagChecked(db, G, "one-too-many", "x"), /up to 100/);
    saveTagChecked(db, G, "t5", "edited");   // changing an existing one is still fine at the limit
    db.bumpTag(G, "t5"); assert.equal(db.getTag(G, "t5").uses, 1);
    assert.equal(db.deleteTag(G, "t5"), true);
    db.forgetToolsGuild(G); assert.equal(db.countTags(G), 0);
});

import { setupPlan } from "../src/community.js";
import { renderStats } from "../src/statspage.js";
import { saleOutlook } from "../src/gamepage.js";
import { runMilestones } from "../src/playalerts.js";

test("setup preview lists only what is missing", async () => {
    const api = { allChannels: async () => [{ name: "general" }, { name: "rules" }], allRoles: async () => [{ name: "Member" }, { name: "PC" }] };
    const p = await setupPlan({ api, guildId: "G" });
    assert.ok(!p.missingRoles.includes("Member") && !p.missingRoles.includes("PC") && p.missingRoles.includes("Moderator"));
    const info = p.missingChannels.find(c => /INFORMATION/.test(c.category));
    assert.ok(info && !info.missing.includes("rules") && info.missing.includes("welcome"));
    assert.ok(!p.missingChannels.some(c => c.missing.includes("general")));
});
test("the stats page escapes names and the weekly board needs three players", () => {
    const html = renderStats({ servers: 12, stats: { users: 100, uniqueGames: 5, wishlistGames: 9, alertsWeek: 3 }, board: [{ name: "<b>Evil</b>", hours: 40, players: 3 }], origin: "https://x.test" });
    assert.match(html, /&lt;b&gt;Evil/); assert.ok(!html.includes("<b>Evil"));
    assert.match(renderStats({ servers: 1, stats: {}, board: [], origin: "https://x.test" }), /Not enough listed servers/);
});
test("the sale outlook only speaks when the price is above its low and a sale is near", () => {
    const now = Date.UTC(2026, 10, 12);
    assert.equal(saleOutlook({ price: 10, low1y: 9.9, currency: "USD" }, now), null);
    const o = saleOutlook({ price: 20, low1y: 10, currency: "USD" }, now);
    assert.ok(o === null || /starts in \d+ day/.test(o));
    assert.equal(saleOutlook({ price: null, low1y: 5 }, now), null);
});
test("a milestone shout names the member without pinging and shows no private numbers", async () => {
    const { milestoneShout } = await import("../src/playalerts.js");
    const m = milestoneShout({ userId: "123", title: "Hades", appid: 1145360, hours: 500 });
    assert.deepEqual(m.allowed_mentions, { parse: [] });
    assert.match(m.embeds[0].description, /<@123> just passed \*\*500 hours\*\* in \*\*Hades\*\*/);
});

test("a milestone is announced in opted-in servers, not on the first run", async () => {
    const { runMilestones } = await import("../src/playalerts.js");
    const seen = new Set(), posts = [], dms = []; let minutes = 100;
    const db = { milestoneUsers: () => [{ discord_id: "7" }], playedGames: () => [{ itad_id: "i", title: "Hades", appid: 1145360, minutes }], hasSeen: (_u, k) => seen.has(k), markSeen: (_u, k) => seen.add(k), logAlert: () => {}, milestoneTargets: () => [{ guild_id: "G", milestone_channel: "C1" }] };
    const notifier = { deliver: async (_u, p) => { dms.push(p); return { ok: true }; }, postChannel: async (c, p) => { posts.push({ c, p }); } };
    await runMilestones({ db, notifier });
    assert.equal(posts.length, 0, "the first run only records what is already passed");
    minutes = 6100; // just past 100 hours
    await runMilestones({ db, notifier });
    assert.equal(posts.length, 1); assert.equal(posts[0].c, "C1"); assert.match(posts[0].p.embeds[0].description, /<@7>/);
    await runMilestones({ db, notifier });
    assert.equal(posts.length, 1, "told once");
});

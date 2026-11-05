import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { GUIDES, matchGuide, findGuide, guidePayload, guideMenu, handleGuideInteraction, createGuideThrottle } from "../src/guides.js";
import { createAiTools } from "../src/aitools.js";

test("guides: how-to questions find their guide", () => {
    const yes = [["how do I get steam verified?", "verify"], ["How to get the Steam Verified role", "verify"], ["where do i verify my steam account", "verify"], ["how do i import my steam wishlist", "wishlist-import"],
        ["how do I add a game to my wishlist and get alerts when it goes on sale", "wishlist-add"], ["where can I find free games?", "free-games"], ["how can I link my steam", "link-steam"],
        ["how do I stop the bot dms", "alerts-delivery"], ["how do i make a profile page", "profile-page"], ["how do I report a bug", "support"], ["how do i delete my data", "delete-data"], ["how do I check my level", "rank"]];
    for (const [q, id] of yes) assert.equal(matchGuide(q, { hasVerifiedRole: true })?.id, id, q);
});

test("guides: ordinary chat is left alone", () => {
    for (const q of ["I linked my steam yesterday lol", "free games are great", "the dashboard looks cool", "what a bug that was haha", "my wishlist is huge", "who wants to play tonight", "lol steam verified people only", "/me steam verify", "https://store.steampowered.com/app/1/", "how", ""]) assert.equal(matchGuide(q, { hasVerifiedRole: true }), null, q);
    assert.equal(matchGuide("how do I get verified?", { hasVerifiedRole: false }), null, "a bare 'verified' needs the server to have the role");
    assert.equal(matchGuide("how do I get verified?", { hasVerifiedRole: true })?.id, "verify");
    assert.equal(matchGuide("how do I get steam verified? " + "x".repeat(300)), null, "long messages are ignored");
});

test("guides: every guide has steps, a picture and a sensible button row", async () => {
    for (const g of GUIDES) {
        assert.ok(g.steps.length >= 3, g.id);
        const p = await guidePayload(g, { publicUrl: "https://dash.test" });
        assert.equal(p.embeds[0].image.url, `attachment://guide-${g.id}.png`);
        assert.ok(p.files[0].attachment.length > 2000, g.id);
        const row = p.components[0].components;
        assert.equal(row.at(-1).custom_id, "gd:list");
        assert.ok(row.length <= 5);
        assert.ok(p.embeds[0].description.length < 600 && (p.embeds[0].fields?.[0]?.value.length ?? 0) < 1024);
    }
    const v = await guidePayload(GUIDES[0], { publicUrl: "https://dash.test/" });
    assert.equal(v.components[0].components[0].url, "https://dash.test/auth/linked");
    assert.equal((await guidePayload(GUIDES[0], { publicUrl: null })).components[0].components.length, 1, "no dashboard, only the list button");
});

test("guides: the list menu opens a guide for the person who picked", async () => {
    const m = guideMenu();
    assert.equal(m.components[0].components[0].options.length, GUIDES.length);
    assert.ok(GUIDES.length <= 25);
    let sent;
    const i = { isButton: () => false, isStringSelectMenu: () => true, customId: "gd:pick", values: ["verify"], deferUpdate: async () => {}, followUp: async o => { sent = o; } };
    await handleGuideInteraction(i, { publicUrl: "https://dash.test" });
    assert.equal(sent.flags, 64);
    assert.match(sent.embeds[0].title, /Steam Verified/);
});

test("guides: one reply per person, channel and guide, with a cap per server", () => {
    let t = 1_000_000; const th = createGuideThrottle({ now: () => t, perGuildHour: 3 });
    const a = { guildId: "G", channelId: "C", userId: "u1", guideId: "verify" };
    assert.equal(th.allow(a), true);
    assert.equal(th.allow({ ...a, userId: "u2" }), false, "same guide, same channel, within minutes");
    assert.equal(th.allow({ ...a, guideId: "region" }), false, "same person within a minute");
    t += 61_000;
    assert.equal(th.allow({ ...a, guideId: "region" }), true);
    t += 61_000; assert.equal(th.allow({ ...a, userId: "u3", channelId: "D" }), true);
    t += 61_000; assert.equal(th.allow({ ...a, userId: "u4", channelId: "E" }), false, "server cap");
    t += 3600_000; assert.equal(th.allow({ ...a, userId: "u5", channelId: "F" }), true);
});

test("guides: the AI's how_to tool gives the same steps and a picture", async () => {
    const db = openDb(":memory:"); db.ensureUser("u1", "G");
    const t = createAiTools({ db, itad: {} });
    const cards = [];
    const r = await t.run("how_to", { topic: "get steam verified" }, { userId: "u1", cards });
    assert.equal(r.guide, "Get the Steam Verified role");
    assert.match(r.steps[0], /\/me steam verify/);
    assert.ok(cards[0].file.data.length > 2000);
    assert.match(r.shownAsPicture, /Do not list them again/);
    assert.equal(findGuide("music")?.id, "music");
    assert.equal((await t.run("how_to", { topic: "quantum physics" }, { userId: "u1", cards: [] })).found, false);
});

test("guides: the setting is on by default and a manager can switch it off", () => {
    const db = openDb(":memory:");
    assert.notEqual(db.getCommunity("G").guides_on, 0);
    db.setCommunity("G", { guides_on: 0 });
    assert.equal(db.getCommunity("G").guides_on, 0);
});

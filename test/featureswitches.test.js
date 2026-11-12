import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { AREAS, blockedArea, featureList, featureOn, featuresOff, featuresPanel, handleFeaturesPick, setFeature, setFeaturesOff } from "../src/features.js";
import { commands } from "../src/commands.js";
import { tickMemes } from "../src/memes.js";

test("feature switches: everything is on until a manager turns an area off, per server", () => {
    const db = openDb(":memory:");
    assert.deepEqual(featuresOff(db, "g1"), []);
    assert.equal(blockedArea(db, "g1", "music"), null);
    assert.deepEqual(setFeature(db, "g1", "music", false), ["music"]);
    assert.equal(blockedArea(db, "g1", "play").id, "music");
    assert.equal(blockedArea(db, "g1", "player").id, "music");
    assert.equal(blockedArea(db, "g1", "value"), null, "prices are never switched off");
    assert.equal(blockedArea(db, "g2", "music"), null, "another server is not touched");
    assert.equal(featureOn(db, "g1", "moderation"), true);
    assert.deepEqual(setFeature(db, "g1", "music", true), []);
    assert.equal(setFeature(db, "g1", "nope", false), null);
    assert.deepEqual(setFeaturesOff(db, "g1", ["mod", "moderation", "moderation", 7]), ["moderation"], "unknown ids are dropped");
    assert.deepEqual(featureList(db, "g1").filter(a => !a.on).map(a => a.id), ["moderation"]);
    db.close?.();
});

test("feature switches: every command an area names is a real command, and none is listed twice", () => {
    const real = new Set();
    for (const c of commands) { real.add(c.name); for (const o of c.options ?? []) if (o.type === 1 || o.type === 2) real.add(o.name); }
    const seen = new Set();
    for (const a of AREAS) for (const c of a.commands) {
        assert.ok(real.has(c), `${a.id} names /${c}, which doesn't exist`);
        assert.ok(!seen.has(c), `/${c} is in two areas`);
        seen.add(c);
    }
});

test("feature switches: the panel fits Discord's limits and the pick list saves what was left out as off", async () => {
    const db = openDb(":memory:");
    const p = featuresPanel(db, "g1");
    assert.ok(p.embeds[0].fields.length <= 25);
    const menu = p.components[0].components[0];
    assert.ok(menu.options.length <= 25 && menu.options.every(o => o.label.length <= 100 && o.description.length <= 100));
    const manager = { inGuild: () => true, guildId: "g1", memberPermissions: { has: () => true }, values: ["music", "levels"] };
    let shown; await handleFeaturesPick({ ...manager, update: async x => { shown = x; } }, db);
    assert.deepEqual(featuresOff(db, "g1").sort(), AREAS.map(a => a.id).filter(id => !["music", "levels"].includes(id)).sort());
    assert.equal(shown.components[0].components[0].options.find(o => o.value === "music").default, true);
    let said; await handleFeaturesPick({ ...manager, memberPermissions: { has: () => false }, values: [], reply: async x => { said = x; } }, db);
    assert.match(said.content, /Manage Server/);
    assert.equal(featureOn(db, "g1", "music"), true, "someone without the permission changes nothing");
    db.close?.();
});

test("feature switches: automatic memes stop while the fun area is off", async () => {
    const posted = [];
    const row = { guild_id: "g1", meme_on: 1, meme_hours: 1, meme_at: 0, meme_channel: "c1" };
    const meta = new Map();
    const db = { allCommunity: () => [row], getMeta: k => meta.get(k), setMeta: (k, v) => meta.set(k, v), setCommunity: () => {}, memeSeen: () => false, markMeme: () => {}, seenMemes: () => new Set() };
    const api = { send: async (...a) => { posted.push(a); return { id: "m" }; }, sendMessage: async (...a) => { posted.push(a); return { id: "m" }; } };
    setFeature(db, "g1", "fun", false);
    let asked = 0;
    await tickMemes({ db, api, memes: { next: async () => { asked++; return null; }, pick: async () => { asked++; return null; } }, sleep: async () => {} });
    assert.equal(asked, 0, "no meme was even looked for");
    assert.equal(posted.length, 0);
});

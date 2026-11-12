import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { cleanConfig, overlayData, MAX_OVERLAYS } from "../src/overlays.js";

test("overlay settings: unknown fields are dropped and bad values fall back to safe ones", () => {
    const c = cleanConfig("goal", { accent: "red", text: "#FFFFFF", target: -5, bgOpacity: 900, font: "Comic Sans", radius: "x", label: "  Big\n goal ", evil: "<script>", source: "everything", scale: 99 });
    assert.equal(c.accent, "#5865f2"); assert.equal(c.text, "#ffffff"); assert.equal(c.target, 1); assert.equal(c.bgOpacity, 100);
    assert.equal(c.font, "Inter"); assert.equal(c.radius, 16); assert.equal(c.label, "Big goal"); assert.equal(c.source, "manual"); assert.equal(c.scale, 3);
    assert.equal(c.evil, undefined);
    assert.equal(c.doneText, "Goal reached!");
    assert.equal(cleanConfig("goal", { doneText: "  We did it  " }).doneText, "We did it");
    assert.equal(cleanConfig("timer", { mode: "sideways" }).mode, "countdown");
    assert.equal(cleanConfig("stats", {}).showMembers, true);
});

test("overlay numbers: the goal bar, stats and timer", () => {
    const base = { kind: "goal", value: 25, config: cleanConfig("goal", { target: 100 }) };
    assert.deepEqual(overlayData(base, null), { current: 25, target: 100, pct: 25 });
    assert.equal(overlayData({ ...base, value: 500 }, null).pct, 100, "never past full");
    const members = { ...base, config: cleanConfig("goal", { target: 200, source: "members" }) };
    assert.equal(overlayData(members, { members: 150, boosts: 2 }).pct, 75);
    assert.equal(overlayData(members, null).current, 0, "no server numbers yet");
    assert.deepEqual(overlayData({ kind: "stats", config: cleanConfig("stats", {}) }, { members: 9, boosts: 3 }), { members: 9, boosts: 3 });
    const t = { kind: "timer", config: cleanConfig("timer", { mode: "countdown", at: 10_000 }) };
    assert.deepEqual(overlayData(t, null, 4_000), { at: 10_000, mode: "countdown", remainingMs: 6_000, done: false, set: true });
    assert.equal(overlayData(t, null, 12_000).done, true);
    assert.equal(overlayData({ kind: "timer", config: cleanConfig("timer", { mode: "countup", at: 1_000 }) }, null, 4_000).remainingMs, 3_000);
});

test("overlay store: private per person, a new link kills the old one, and a cap", () => {
    const db = openDb(":memory:");
    const tok = db.createOv("a", "goal", { name: "Subs", config: { target: 50 } });
    assert.match(tok, /^svcx_[A-Za-z0-9_-]{32}$/);
    assert.equal(db.ovById("b", tok), null, "someone else can't open it");
    assert.equal(db.ovByToken(tok).config.target, 50);
    assert.equal(db.updateOv("b", tok, { name: "Hijack" }), false);
    db.updateOv("a", tok, { value: 12, name: "Renamed" });
    assert.equal(db.ovByToken(tok).value, 12);
    const next = db.resetOvToken("a", tok);
    assert.notEqual(next, tok); assert.equal(db.ovByToken(tok), null); assert.ok(db.ovByToken(next));
    assert.equal(db.ovByToken("nonsense"), null);
    for (let i = 1; i < MAX_OVERLAYS; i++) db.createOv("a", "timer");
    assert.throws(() => db.createOv("a", "timer"), /up to 12/);
    db.createOv("a", "timer", { max: 24 });
    assert.throws(() => db.createOv("a", "bogus"), /Unknown/);
    db.removeUserOvs("a"); assert.equal(db.listOvs("a").length, 0);
});

test("deleting a person's data removes their overlays", () => {
    const db = openDb(":memory:"); db.ensureUser("a", "A");
    db.createOv("a", "goal");
    db.deleteUser("a");
    assert.equal(db.listOvs("a").length, 0);
});

test("overlay settings for alerts, sale and scene stay inside their limits", async () => {
    const { cleanConfig, SCENE_MAX_ITEMS } = await import("../src/overlays.js");
    const a = cleanConfig("alerts", { hold: 99, refresh: 1, position: "sideways", joinText: "  Hi\n{count} " });
    assert.equal(a.hold, 20); assert.equal(a.refresh, 5); assert.equal(a.position, "top"); assert.equal(a.joinText, "Hi {count}");
    const tok = n => "svcx_" + String(n).padStart(32, "a");
    const s = cleanConfig("scene", { seconds: 1, transition: "spin", items: [...Array.from({ length: 12 }, (_, i) => tok(i)), tok(0), "nope"] });
    assert.equal(s.seconds, 4); assert.equal(s.transition, "fade"); assert.equal(s.items.length, SCENE_MAX_ITEMS);
    assert.equal(new Set(s.items).size, s.items.length);
    assert.equal(cleanConfig("sale", {}).includeFests, false);
});

test("overlay themes: only known themes are kept", async () => {
    const { cleanConfig } = await import("../src/overlays.js");
    assert.equal(cleanConfig("goal", { theme: "neon" }).theme, "neon");
    assert.equal(cleanConfig("goal", { theme: "<script>" }).theme, "classic");
    assert.equal(cleanConfig("goal", {}).theme, "classic");
});

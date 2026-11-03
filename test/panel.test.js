import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createPanels } from "../src/panel.js";
import { alertPanel } from "../src/alertpanel.js";

function fake(db, customId, extra = {}) {
    const out = {};
    return Object.assign({ customId, user: { id: "u1" }, guildId: null, out,
        reply: async o => { out.reply = o; }, update: async o => { out.update = o; }, showModal: async m => { out.modal = m; } }, extra);
}
const setup = () => { const db = openDb(":memory:"); db.ensureUser("u1", null); const p = createPanels({ db }); p.register("alerts", alertPanel({ db })); return { db, p }; };

test("alerts panel opens, toggles extras, and switches pages", async () => {
    const { db, p } = setup();
    const o = fake(db, "x"); await p.open(o, "alerts");
    assert.match(o.out.reply.embeds[0].title, /What you get/);
    assert.equal(o.out.reply.components.length, 4);
    const t = fake(db, "pn:alerts:toggles", { values: ["free", "codes", "share"] }); await p.handle(t);
    const u = db.getUser("u1");
    assert.equal(u.free, 1); assert.equal(u.share, 1); assert.equal(u.bundles, 0); assert.equal(db.getAlertSubs("u1").codes, true);
    const n = fake(db, "pn:alerts:news", { values: ["1"] }); await p.handle(n);
    assert.equal(db.getUser("u1").news, 1);
    const g = fake(db, "pn:alerts:go:timing"); await p.handle(g);
    assert.match(g.out.update.embeds[0].title, /When/);
});

test("alerts panel: quiet hours modal, digest, pause, bad input stays on the panel", async () => {
    const { db, p } = setup();
    const q = fake(db, "pn:alerts:quiet"); await p.handle(q); assert.ok(q.out.modal);
    const fields = { start: "10pm", end: "7am", tz: "America/New_York" };
    const m = fake(db, "pn:alerts:quietm", { fields: { getTextInputValue: k => fields[k] ?? "" } }); await p.handle(m);
    const u = db.getUser("u1"); assert.equal(u.tz, "America/New_York"); assert.notEqual(u.quiet_start, null);
    await p.handle(fake(db, "pn:alerts:digest", { values: ["5"] }));
    assert.equal(db.getUser("u1").digest, 1); assert.equal(db.getUser("u1").digest_day, 5);
    await p.handle(fake(db, "pn:alerts:pause:types"));
    assert.equal(db.getUser("u1").paused, 1);
    const bad = fake(db, "pn:alerts:quietm", { fields: { getTextInputValue: k => ({ start: "nope", end: "7am" })[k] ?? "" } }); await p.handle(bad);
    assert.match(bad.out.update.embeds[0].description, /could not read/);
    const c = fake(db, "pn:alerts:delivery", { values: ["channel"] }); await p.handle(c);
    assert.match(c.out.update.embeds[0].description, /no alert channel/);
});

test("every alerts page serializes within Discord limits", async () => {
    const { db, p } = setup();
    for (const [page] of [["types"], ["delivery"], ["timing"]]) {
        const o = fake(db, "x"); await p.open(o, "alerts", page);
        const v = o.out.reply;
        assert.ok(v.components.length <= 5);
        for (const r of v.components) r.toJSON();
        assert.ok(v.embeds[0].description.length < 4000);
    }
});

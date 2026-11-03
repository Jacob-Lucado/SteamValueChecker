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

test("hub menus read the real command list and can run commands that need no input", async () => {
    const { hubCommands } = await import("../src/commands.js");
    const { hubPanel, catalog, needsInput } = await import("../src/hubpanel.js");
    const db = openDb(":memory:"); db.ensureUser("u1", null);
    const p = createPanels({ db });
    const ran = [];
    for (const json of hubCommands.filter(c => ["games", "me", "server", "manage", "bot", "mod"].includes(c.name))) {
        assert.ok(json.options.some(o => o.name === "menu"), `${json.name} has a menu`);
        assert.ok(json.options.length <= 25);
        p.register(`hub-${json.name}`, hubPanel({ json, runner: async (i, hub, path) => { ran.push([hub, ...path]); } }));
        const o = fake(db, "x"); await p.open(o, `hub-${json.name}`);
        for (const r of o.out.reply.components) r.toJSON();
        const areas = catalog(json);
        assert.ok(areas.length >= 1);
        for (let a = 0; a < areas.length; a++) {
            const sel = fake(db, `pn:hub-${json.name}:area`, { values: [String(a)] }); await p.handle(sel);
            for (const r of sel.out.update.components) r.toJSON();
            assert.ok(sel.out.update.embeds[0].description.length <= 4000);
            for (let c = 0; c < areas[a].items.length; c++) {
                const cm = fake(db, `pn:hub-${json.name}:cmd:${a}`, { values: [String(c)] }); await p.handle(cm);
                for (const r of cm.out.update.components) r.toJSON();
            }
        }
    }
    const json = hubCommands.find(c => c.name === "bot");
    const area = catalog(json)[0], idx = area.items.findIndex(x => !needsInput(x));
    p.register("hub-bot", hubPanel({ json, runner: async (i, hub, path) => { ran.push([hub, ...path]); } }));
    const run = fake(db, "pn:hub-bot:run:a0.c" + idx); await p.handle(run);
    assert.deepEqual(ran.at(-1), ["bot", area.items[idx].path[0]]);
    assert.equal(run.out.update, undefined);
    const need = area.items.findIndex(x => needsInput(x));
    if (need >= 0) { const bad = fake(db, "pn:hub-bot:run:a0.c" + need); await p.handle(bad); assert.match(bad.out.update.embeds[0].description, /chat box/); }
});

test("a replayed command routes like a typed one", async () => {
    const { replayAsCommand } = await import("../src/hubpanel.js");
    const { legacyRoute } = await import("../src/commands.js");
    let seen;
    const real = { user: { id: "u1" }, isButton: () => true, reply: async c => { seen.replied = c; }, guildId: "g" };
    await replayAsCommand(real, "me", ["wishlist", "view"], async (px) => {
        seen = { chat: px.isChatInputCommand(), button: px.isButton(), route: legacyRoute(px.commandName, px.options.getSubcommandGroup(false), px.options.getSubcommand(false)), name: px.options.getString("x"), user: px.user.id };
        await px.reply("hi");
    });
    assert.deepEqual(seen.route, { command: "wishlist", sub: "view" });
    assert.equal(seen.chat, true); assert.equal(seen.button, false); assert.equal(seen.name, null); assert.equal(seen.replied, "hi");
    await assert.rejects(replayAsCommand(real, "bot", ["status"], async px => px.options.getString("x", true)), /needs details/);
});

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
    assert.equal(o.out.reply.components.length, 5);
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
    const skip = fake(db, "pn:alerts:ptskip:types", { values: ["itch", "bogus"] }); await p.handle(skip);
    assert.equal(db.getUser("u1")?.playtest_skip ?? db.getUser(skip.user?.id ?? "u1")?.playtest_skip, "itch", "the site picks are saved, unknown ones dropped");
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
    for (const json of hubCommands.filter(c => ["games", "me", "server", "manage", "bot", "mod", "music"].includes(c.name))) {
        assert.ok(json.name === "music" || json.options.some(o => o.name === "menu"), `${json.name} has a menu`);
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
    if (need >= 0) { const bad = fake(db, "pn:hub-bot:run:a0.c" + need); await p.handle(bad); assert.match(bad.out.update.embeds[0].description, /Still needed/); }
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
    await assert.rejects(replayAsCommand(real, "bot", ["status"], async px => px.options.getString("x", true)), /is needed/);
});

test("every subcommand in every hub can be filled in and run from its panel", async () => {
    const { hubCommands } = await import("../src/commands.js");
    const { hubPanel, catalog } = await import("../src/hubpanel.js");
    const db = openDb(":memory:"); db.ensureUser("u1", null);
    const p = createPanels({ db });
    const ran = [];
    const one = id => ({ first: () => ({ id }), size: 1 });
    let count = 0;
    for (const json of hubCommands.filter(c => ["games", "me", "server", "manage", "bot", "mod", "music"].includes(c.name))) {
        p.register(`hub-${json.name}`, hubPanel({ json, runner: async (i, hub, path, vals) => { ran.push({ hub, path, vals }); } }));
        const areas = catalog(json);
        for (let a = 0; a < areas.length; a++) for (let c = 0; c < areas[a].items.length; c++) {
            const item = areas[a].items[c]; count++;
            const pick = fake(db, `pn:hub-${json.name}:cmd:${a}`, { values: [String(c)] }); await p.handle(pick);
            for (const r of pick.out.update.components) { assert.ok(r.toJSON().components.length >= 1); }
            for (let k = 0; k < item.opts.length; k++) {
                const o = item.opts[k];
                if (o.type === 11) continue;
                const sel = fake(db, `pn:hub-${json.name}:opt:${a}.${c}`, { values: [String(k)] }); await p.handle(sel);
                const text = [3, 4, 10].includes(o.type) && !o.choices?.length;
                if (text) {
                    assert.ok(sel.out.modal, `${o.name} opens a form`); sel.out.modal.toJSON();
                    const v = o.type === 3 ? "x".repeat(Math.max(o.min_length ?? 1, 1)) : String(o.min_value ?? 1);
                    await p.handle(fake(db, `pn:hub-${json.name}:fm:a${a}.c${c}.o${k}`, { fields: { getTextInputValue: () => v } }));
                } else {
                    const comps = sel.out.update.components.map(r => r.toJSON());
                    assert.equal(comps.length, 3, `${json.name} ${item.path.join(" ")} ${o.name}`);
                    const values = o.type === 5 ? ["1"] : o.choices?.length ? [String(o.choices[0].value)] : ["7"];
                    await p.handle(fake(db, `pn:hub-${json.name}:set:${a}.${c}.${k}`, { values, users: one("7"), channels: one("7"), roles: one("7"), members: one("7") }));
                }
            }
            const before = ran.length;
            const run = fake(db, `pn:hub-${json.name}:run:a${a}.c${c}`); await p.handle(run); if (ran.length === before && process.env.DBG) console.log(item.path.join(" "), run.out.update?.embeds[0].description);
            const miss = item.opts.some(o => o.required && o.type === 11);
            if (!miss) { assert.equal(ran.length, before + 1, `${json.name} ${item.path.join(" ")} ran`); assert.deepEqual(ran.at(-1).path, item.path); }
        }
    }
    assert.ok(count > 100, "covered " + count);
    const done = ran.find(r => r.path.join(" ") === "stream giveaway");
    assert.ok(done && done.vals.game && done.vals.key, "values reach the command");
});

test("hub command trees are valid for Discord (no subcommand nested inside a subcommand)", async () => {
    const { hubCommands } = await import("../src/commands.js");
    for (const c of hubCommands) {
        assert.ok(c.options.length <= 25, c.name);
        for (const o of c.options ?? []) {
            if (o.type === 1) assert.ok(!(o.options ?? []).some(x => x.type === 1 || x.type === 2), `/${c.name} ${o.name} is a subcommand holding subcommands`);
            if (o.type === 2) { assert.ok((o.options ?? []).length <= 25 && (o.options ?? []).every(x => x.type === 1), `/${c.name} ${o.name} group`); }
        }
    }
});

test("alerts panel More page: mute, code games, history; area status lines never throw", async () => {
    const { p, db } = setup();
    const o = fake(db, "x"); await p.open(o, "alerts", "more");
    for (const r of o.out.reply.components) r.toJSON();
    await p.handle(fake(db, "pn:alerts:mute", { values: ["news", "dlc"] }));
    assert.equal(db.getUser("u1").muted, "news,dlc");
    await p.handle(fake(db, "pn:alerts:codegames", { values: ["genshin"] }));
    assert.deepEqual(db.getAlertSubs("u1").games, ["genshin"]);
    const h = fake(db, "pn:alerts:history"); await p.handle(h);
    assert.ok(h.out.reply.embeds[0].title);
    const { areaGlance } = await import("../src/panelglance.js");
    const g = areaGlance(db), ctx = { user: db.getUser("u1"), i: { guildId: "g1" } };
    for (const k of ["me/wishlist", "me/library", "me/steam", "me/friend", "server/giveaway", "server/serverlist", "server/lfg", "server/calendar", "server/invites", "server/stream", "server/club", "server/main", "manage/community", "manage/alertchannel", "bot/support", "mod/main", "server/promos"]) {
        const [hub, area] = k.split("/"); const lines = g(ctx, hub, area);
        assert.ok(Array.isArray(lines) && lines.length >= 1, k);
    }
});

test("area status shows real rows, not only counts", async () => {
    const { areaGlance } = await import("../src/panelglance.js");
    const { p, db } = setup();
    db.addItems("u1", [{ itad_id: "a", title: "Hades" }, { itad_id: "b", title: "Celeste" }]);
    db.createLfg({ guild_id: "g1", channel_id: "c", creator_id: "u1", game: "Deep Rock", starts_at: Date.now() + 3600_000, slots: 4 });
    db.setStreamLive("g1", "u1", { title: "T", url: "https://x.example", game: "Hades", started: Date.now() });
    const g = areaGlance(db), ctx = { user: db.getUser("u1"), i: { guildId: "g1" } };
    const w = g(ctx, "me", "wishlist").join("\n");
    assert.match(g(ctx, "server", "lfg").join("\n"), /• Deep Rock <t:/);
    assert.match(g(ctx, "server", "stream").join("\n"), /<@u1> playing Hades/);
    assert.match(w, /\*\*2\*\* games/); assert.match(w, /• Celeste/); assert.match(w, /• Hades/);
});

test("wishlist, library and streaming panels work end to end", async () => {
    const { wishlistPanel, libraryPanel, streamPanel } = await import("../src/bespoke.js");
    const { p, db } = setup();
    const calls = [];
    const replay = async (i, hub, path, vals) => { calls.push({ hub, path: path.join(" "), vals }); };
    p.register("hub-me", { pages: [["", "x"]], render: () => ({ embeds: [{ title: "hub" }], components: [] }), handle: async () => ({ page: "" }) });
    p.register("wl", { ...wishlistPanel({ db, replay }), back: { id: "hub-me", page: "a1" } });
    p.register("lib", { ...libraryPanel({ db }), back: { id: "hub-me", page: "a2" } });
    p.register("strm", { ...streamPanel({ db, replay }), back: { id: "hub-me", page: "a3" } });
    db.addItems("u1", Array.from({ length: 9 }, (_, n) => ({ itad_id: `i${n}`, title: `Game ${n}` })));
    const ok = v => { for (const r of v.components) r.toJSON(); return v; };

    const go = fake(db, "pn:wl:go:"); await p.handle(go); ok(go.out.update);
    assert.match(go.out.update.embeds[0].description, /9 games/);
    const nx = fake(db, "pn:wl:go:l1"); await p.handle(nx); assert.match(nx.out.update.embeds[0].description, /Game 8|Game 7/);
    const id = db.listItems("u1")[0].id;
    const pick = fake(db, "pn:wl:pick", { values: [String(id)] }); await p.handle(pick); ok(pick.out.update);
    await p.handle(fake(db, `pn:wl:star:${id}`)); assert.equal(db.listItems("u1")[0].priority, 1);
    await p.handle(fake(db, `pn:wl:check:${id}`));
    assert.deepEqual(calls.at(-1), { hub: "me", path: "wishlist check", vals: { game: { v: db.listItems("u1")[0].title } } });
    const r1 = fake(db, `pn:wl:rule:${id}`, { values: ["percent"] }); await p.handle(r1); r1.out.modal.toJSON();
    await p.handle(fake(db, `pn:wl:rulem:${id}:percent`, { fields: { getTextInputValue: () => "60" } }));
    assert.equal(calls.at(-1).vals.value.v, 60);
    await p.handle(fake(db, `pn:wl:rule:${id}`, { values: ["atl"] })); assert.equal(calls.at(-1).vals.type.v, "atl");
    const bad = fake(db, `pn:wl:rulem:${id}:price`, { fields: { getTextInputValue: () => "abc" } }); await p.handle(bad);
    assert.match(bad.out.update.embeds[0].description, /number/);
    await p.handle(fake(db, "pn:wl:addm", { fields: { getTextInputValue: () => "Hades II" } })); assert.equal(calls.at(-1).vals.title.v, "Hades II");
    await p.handle(fake(db, `pn:wl:rm:${id}`)); assert.equal(db.countItems("u1"), 8);
    const menu = fake(db, "pn:wl:menu"); await p.handle(menu); assert.equal(menu.out.update.embeds[0].title, "hub");

    db.upsertLibrary("u1", [{ itad_id: "x", title: "Celeste" }, { itad_id: "y", title: "Hades" }]);
    const lib = fake(db, "pn:lib:go:"); await p.handle(lib); ok(lib.out.update);
    const row = db.listLibrary("u1")[0];
    const lp = fake(db, "pn:lib:pick:all.0", { values: [String(row.id)] }); await p.handle(lp); assert.equal(lp.out.update.components.length, 4); ok(lp.out.update);
    await p.handle(fake(db, `pn:lib:status:all.0.${row.id}`, { values: ["finished"] })); assert.equal(db.listLibrary("u1")[0].status, "finished");
    const lf = fake(db, "pn:lib:filter", { values: ["finished"] }); await p.handle(lf); assert.match(lf.out.update.embeds[0].description, /Finished \*\*1\*\*/);

    const st = fake(db, "pn:strm:go:", { guildId: "g1" }); await p.handle(st); ok(st.out.update);
    const lm = fake(db, "pn:strm:livem", { fields: { getTextInputValue: k => ({ link: "https://twitch.tv/x", title: "", game: "Hades" })[k] ?? "" } }); await p.handle(lm);
    assert.deepEqual(calls.at(-1), { hub: "server", path: "stream live", vals: { link: { v: "https://twitch.tv/x" }, game: { v: "Hades" } } });
    const pm = fake(db, "pn:strm:pingm", { fields: { getTextInputValue: () => "maybe" } }); await p.handle(pm); assert.match(pm.out.update.embeds[0].description, /yes or no/);
    await p.handle(fake(db, "pn:strm:pingm", { fields: { getTextInputValue: () => "yes" } })); assert.equal(calls.at(-1).vals.enabled.v, true);
});

test("hub panels reopen where you left off and refresh themselves while open", async () => {
    const { hubCommands } = await import("../src/commands.js");
    const { hubPanel, catalog } = await import("../src/hubpanel.js");
    const db = openDb(":memory:"); db.ensureUser("u1", null);
    const p = createPanels({ db, tickMs: 3_600_000 });
    const json = hubCommands.find(c => c.name === "server");
    let n = 0;
    p.register("hub-server", hubPanel({ json, areaGlance: () => [`count ${++n}`] }));
    const areas = catalog(json); const idx = areas.findIndex(a => a.key === "stream");
    const o = fake(db, "x", { fetchReply: async () => ({ id: "m1" }), editReply: async v => { o.out.edited = v; } });
    await p.open(o, "hub-server");
    const nav = fake(db, "pn:hub-server:area", { values: [String(idx)], message: { id: "m1" } }); await p.handle(nav);
    const cmd = fake(db, "pn:hub-server:cmd:" + idx, { values: ["0"], message: { id: "m1" } }); await p.handle(cmd);
    const again = fake(db, "x", { fetchReply: async () => ({ id: "m2" }), editReply: async v => { again.out.edited = v; } }); await p.open(again, "hub-server");
    assert.match(again.out.reply.embeds[0].title, /stream/, "back in the stream area, not on a half-filled form");
    assert.doesNotMatch(again.out.reply.embeds[0].title, /live|link/);
    await new Promise(r => setImmediate(r));
    await p.handle(fake(db, "pn:hub-server:go:", { message: { id: "m2" } }));
    await p.handle(fake(db, "pn:hub-server:area", { values: [String(idx)], message: { id: "m2" } }));
    await p.tick(Date.now() + 1000);
    assert.match(again.out.edited.embeds[0].description, /count \d+/);
    await p.tick(Date.now() + 11 * 60_000);
    assert.equal(p.liveCount(), 0, "stops after ten minutes");
    p.stop();
});

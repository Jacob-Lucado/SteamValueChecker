import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createNotifier } from "../src/notify.js";
import { prefsPatch, prefsView } from "../src/prefs.js";
import { alertPayload, SNOOZE_ID, BELOW_ID } from "../src/render.js";
import { tr } from "../src/i18n.js";
import { CHANGELOG, LATEST, changelogEmbed } from "../src/changelog.js";

const embed = { title: "Hades is 60% off", description: "**$9.99** at Fanatical", url: "https://example.com/deal" };

test("notification center: delivered alerts are copied; a muted kind is kept but not sent", async () => {
    const db = openDb(":memory:");
    db.ensureUser("u1");
    const sent = [];
    const n = createNotifier({ db, discord: { sendDm: async (id, p) => { sent.push(p); }, sendChannel: async () => {} } });
    let user = db.getUser("u1");
    assert.equal((await n.deliver(user, { embeds: [embed] }, "alert")).via, "dm");
    assert.equal(sent.length, 1);
    db.updateUser("u1", { muted: "free" });
    user = db.getUser("u1");
    assert.equal((await n.deliver(user, { embeds: [{ title: "Free game" }] }, "free")).via, "inbox");
    assert.equal(sent.length, 1, "muted kinds are not sent");
    const list = db.listNotifications("u1");
    assert.deepEqual(list.map(x => x.type).sort(), ["alert", "free"]);
    assert.equal(db.unreadNotifications("u1"), 2);
    db.readNotifications("u1");
    assert.equal(db.unreadNotifications("u1"), 0);
    db.deleteUser("u1");
    assert.equal(db.listNotifications("u1").length, 0);
});

test("a failed delivery is not recorded as a notification", async () => {
    const db = openDb(":memory:");
    db.ensureUser("u2");
    const n = createNotifier({ db, discord: { sendDm: async () => { throw new Error("closed"); }, sendChannel: async () => {} } });
    const r = await n.deliver(db.getUser("u2"), { embeds: [embed] }, "alert");
    assert.equal(r.ok, false);
    assert.equal(db.listNotifications("u2").length, 0);
});

test("snoozed games are left out of the alert run until the snooze ends", () => {
    const db = openDb(":memory:");
    db.ensureUser("u3");
    db.addItems("u3", [{ itad_id: "a", title: "A" }, { itad_id: "b", title: "B" }], "manual");
    const [a] = db.listItems("u3");
    assert.equal(db.activeItems().length, 2);
    db.snoozeItem(a.id, Date.now() + 86400_000);
    assert.deepEqual(db.activeItems().map(i => i.itad_id), ["b"]);
    db.snoozeItem(a.id, Date.now() - 1000);
    assert.equal(db.activeItems().length, 2);
});

test("settings: mute and language are validated", () => {
    assert.deepEqual(prefsPatch({ muted: ["free", "digest", "free"] }, {}), { muted: "free,digest" });
    assert.throws(() => prefsPatch({ muted: ["spam"] }, {}), /can mute/);
    assert.deepEqual(prefsPatch({ lang: "es" }, {}), { lang: "es" });
    assert.throws(() => prefsPatch({ lang: "xx" }, {}), /Pick/);
    assert.deepEqual(prefsView({ muted: "free,digest", lang: "fr" }).muted, ["free", "digest"]);
});

test("alert buttons: snooze and price buttons appear on a single alert, in the user's language", () => {
    const hit = { item: { id: 7, title: "Hades", appid: 1145360 }, now: { price: 9.99, regular: 24.99, currency: "USD", shop: "Fanatical", url: "https://example.com", slug: "hades" }, reason: "sale" };
    const payload = alertPayload([hit], { trigger: () => "any sale", verdict: () => null, lang: "es" });
    const ids = payload.components.flatMap(r => r.components).map(c => c.custom_id).filter(Boolean);
    assert.ok(ids.includes(`${SNOOZE_ID}:7`) && ids.includes(`${BELOW_ID}:7`));
    assert.ok(payload.components.flatMap(r => r.components).some(c => c.label === "Dejar de seguir"));
    assert.equal(tr("fr", "Nope"), "Nope");
});

test("giveaway templates are per server and prizes for a winner never include keys", () => {
    const db = openDb(":memory:");
    db.saveTemplate("g1", "Weekly", { length: "7d", boosters: true });
    db.saveTemplate("g1", "Weekly", { length: "3d" });
    db.saveTemplate("g2", "Other", {});
    assert.deepEqual(db.listTemplates("g1").map(t => [t.name, t.data.length]), [["Weekly", "3d"]]);
    assert.equal(db.removeTemplate("g2", db.listTemplates("g1")[0].id), false);
    assert.deepEqual(db.prizesFor("nobody"), []);
});

test("changelog has a newest version and renders", () => {
    assert.equal(LATEST, CHANGELOG[0].version);
    assert.match(changelogEmbed().description, new RegExp(CHANGELOG[0].title.slice(0, 12)));
    assert.match(changelogEmbed(3).description, new RegExp(CHANGELOG[1].title.slice(0, 12)));
    assert.ok(changelogEmbed(99).description.length <= 4000);
});

test("setup checklist: tracks channels from every part of the bot and renders the panel", async () => {
    const { setupStatus, setupEmbed, setupComponents, SU } = await import("../src/setup.js");
    const db = openDb(":memory:");
    let st = setupStatus(db, "g1");
    assert.equal(st.complete, false);
    db.setGuildChannel("g1", "111", "u1");
    db.setTicketSettings("g1", { channelId: "222", staffRoleId: null });
    db.setGiveawaySettings("g1", { vouch_channel_id: "333" });
    db.setFreeFeed("g1", true);
    db.setGameNight("g1", true);
    db.setWeeklyDigest("g1", true);
    st = setupStatus(db, "g1");
    assert.equal(st.complete, true);
    assert.ok(st.steps.every(x => x.done));
    const e = setupEmbed(st, "https://x.test", "g1");
    assert.match(e.description, /<#111>/);
    assert.match(e.description, /x\.test\/#\/setup\/g1/);
    const ids = setupComponents(st).flatMap(r => r.components).map(c => c.custom_id);
    assert.deepEqual(ids, [SU.alert, SU.support, SU.vouch, SU.auto, SU.gn, SU.feed, SU.digest, SU.refresh]);
});

test("auto setup: creates the category and channels, keeps support private, skips what exists, explains a missing permission", async () => {
    const { autoSetup, setupStatus } = await import("../src/setup.js");
    const db = openDb(":memory:");
    const made = []; let n = 0;
    const api = { createChannel: async (g, body) => { made.push(body); return { id: String(++n) + "00000000000000000" }; }, sendMessage: async () => ({}) };
    const r = await autoSetup({ api, db, guildId: "g1", botId: "bot", userId: "owner", staffRoleId: "role" });
    assert.deepEqual(made.map(m => m.name), ["Steam Value Checker", "deal-alerts", "support-tickets", "vouches"]);
    const support = made.find(m => m.name === "support-tickets");
    assert.ok(support.permission_overwrites.some(o => o.id === "g1" && BigInt(o.deny) & 1024n), "hidden from everyone");
    assert.ok(support.permission_overwrites.some(o => o.id === "role") && support.permission_overwrites.some(o => o.id === "owner"));
    assert.equal(made[1].parent_id, "100000000000000000");
    assert.equal(setupStatus(db, "g1").complete, true);
    assert.equal(db.getGuild("g1").free_feed, 1);
    assert.equal(r.created.length, 3);
    made.length = 0;
    assert.match((await autoSetup({ api, db, guildId: "g1", botId: "bot", userId: "owner" })).note, /already/);
    assert.equal(made.length, 0);
    const denied = { createChannel: async () => { throw Object.assign(new Error("x"), { status: 403 }); }, sendMessage: async () => ({}) };
    await assert.rejects(autoSetup({ api: denied, db: openDb(":memory:"), guildId: "g2", botId: "b", userId: "u" }), /Manage Channels/);
});

test("game night: shared games, almost-shared games and a group buy, only for opted-in members", async () => {
    const { gameNight, gameNightEmbed, pickGame, voiceGroups } = await import("../src/gamenight.js");
    const db = openDb(":memory:");
    for (const id of ["a", "b", "c", "d"]) db.ensureUser(id, "g1");
    for (const id of ["a", "b", "c"]) db.updateUser(id, { share: 1 });
    // library rows through the same call the library import uses
    const addLib = (id, g) => db.upsertLibrary(id, [{ itad_id: g, title: g.toUpperCase(), paid: null }]);
    for (const id of ["a", "b", "c"]) addLib(id, "hades");
    addLib("a", "celeste"); addLib("b", "celeste");
    db.addItems("a", [{ itad_id: "hollow", title: "HOLLOW" }], "manual");
    db.addItems("b", [{ itad_id: "hollow", title: "HOLLOW" }], "manual");
    const itad = { getPrices: async ids => new Map(ids.map(i => [i, { price: 4.99 }])) };
    const r = await gameNight({ db, itad, userIds: ["a", "b", "c", "d"] });
    assert.equal(r.hidden, 1);
    assert.deepEqual(r.allOwn.map(g => g.title), ["HADES"]);
    assert.deepEqual(r.almost.map(g => [g.title, g.missing]), [["CELESTE", ["c"]]]);
    assert.deepEqual(r.buy.map(b => [b.title, b.wanters.sort()]), [["HOLLOW", ["a", "b"]]]);
    assert.equal(pickGame(r, () => 0).title, "HADES");
    assert.match(gameNightEmbed(r).fields.map(f => f.name).join("|"), /Worth buying together/);
    await assert.rejects(gameNight({ db, itad, userIds: ["a", "d"] }), /at least 2/);

    // voice nudge: two opted-in members in one channel both have the same alert, and the server switched it on
    db.setGameNight("g1", true);
    db.setWeeklyDigest("g1", true);
    const hit = id => ({ item: { discord_id: id, share: 1, itad_id: "hollow", title: "HOLLOW" }, now: { price: 4.99, currency: "USD", discount: 0.5, shop: "Fanatical" } });
    const groups = voiceGroups({ db, eligible: [hit("a"), hit("b"), hit("c")], voiceMap: () => new Map([["vc1", ["a", "b", "x"]], ["vc2", ["c"]]]) });
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].users.sort(), ["a", "b"]);
    db.setGameNight("g1", false);
    assert.equal(voiceGroups({ db, eligible: [hit("a"), hit("b")], voiceMap: () => new Map([["vc1", ["a", "b"]]]) }).length, 0);
});

test("game night says who has no games on record, and points them to /steam link", async () => {
    const { gameNight, gameNightEmbed } = await import("../src/gamenight.js");
    const db = openDb(":memory:");
    for (const id of ["a", "b", "c"]) { db.ensureUser(id, "g1"); db.updateUser(id, { share: 1 }); }
    for (const id of ["a", "b"]) db.upsertLibrary(id, [{ itad_id: "hades", title: "HADES", paid: null }]);
    const r = await gameNight({ db, itad: { getPrices: async () => new Map() }, userIds: ["a", "b", "c"] });
    assert.deepEqual(r.empty, ["c"]);
    const field = gameNightEmbed(r).fields.find(f => f.name === "No games on record");
    assert.match(field.value, /<@c>/);
    assert.match(field.value, /\/steam link/);
});

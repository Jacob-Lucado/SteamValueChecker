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
    assert.match(changelogEmbed().description, /Support tickets/);
});

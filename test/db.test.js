import test from "node:test";
import assert from "node:assert/strict";
import { openDb, MAX_ITEMS_PER_USER } from "../src/db.js";

const game = (n, extra = {}) => ({ itad_id: `id${n}`, title: `Game ${n}`, ...extra });

test("users, items, duplicates and the per-user limit", () => {
    const db = openDb(":memory:");
    db.ensureUser("u1", "g1");
    assert.deepEqual(db.addItems("u1", [game(1), game(2)]), { added: 2, existing: 0, skippedForLimit: 0 });
    assert.deepEqual(db.addItems("u1", [game(2), game(3)]), { added: 1, existing: 1, skippedForLimit: 0 });
    assert.equal(db.countItems("u1"), 3);

    const many = Array.from({ length: MAX_ITEMS_PER_USER }, (_, i) => game(1000 + i));
    const r = db.addItems("u1", many);
    assert.equal(r.added, MAX_ITEMS_PER_USER - 3);
    assert.equal(r.skippedForLimit, 3);
    assert.equal(db.countItems("u1"), MAX_ITEMS_PER_USER);
});

test("settings can only change known columns", () => {
    const db = openDb(":memory:");
    db.ensureUser("u1");
    db.updateUser("u1", { delivery: "channel", paused: 1 });
    assert.equal(db.getUser("u1").delivery, "channel");
    assert.throws(() => db.updateUser("u1", { "discord_id = 'x' --": 1 }), /Cannot set/);
    assert.equal(db.getUser("u1").discord_id, "u1");
});

test("the last server a member used becomes their alert server", () => {
    const db = openDb(":memory:");
    db.ensureUser("u1", "g1");
    db.ensureUser("u1", "g2");
    db.ensureUser("u1"); // a command in DMs keeps the last server
    assert.equal(db.getUser("u1").guild_id, "g2");
});

test("triggers: set for one game or all, and reset the alert memory", () => {
    const db = openDb(":memory:");
    db.ensureUser("u1");
    db.addItems("u1", [game(1), game(2)]);
    const [a] = db.listItems("u1");
    db.markAlerted(a.id, 5);
    assert.equal(db.setTrigger("u1", "percent", 50, "id1"), 1);
    const after = db.listItems("u1").find(i => i.itad_id === "id1");
    assert.equal(after.trigger_type, "percent");
    assert.equal(after.last_alert_price, null);
    assert.equal(db.setTrigger("u1", "atl", null), 2);
});

test("steam sync removes only steam-sourced games that left the wishlist", () => {
    const db = openDb(":memory:");
    db.ensureUser("u1");
    db.addItems("u1", [game(1), game(2)], { source: "steam" });
    db.addItems("u1", [game(3)], { source: "manual" });
    assert.equal(db.removeSteamNotIn("u1", ["id1"]), 1);
    assert.deepEqual(db.listItems("u1").map(i => i.itad_id).sort(), ["id1", "id3"]);
});

test("paused users are not polled; guild channel set, replaced, cleared", () => {
    const db = openDb(":memory:");
    db.ensureUser("a"); db.ensureUser("b");
    db.addItems("a", [game(1)]); db.addItems("b", [game(2)]);
    db.updateUser("b", { paused: 1 });
    assert.deepEqual(db.activeItems().map(i => i.discord_id), ["a"]);

    db.setGuildChannel("g", "c1", "admin");
    db.setGuildChannel("g", "c2", "admin");
    assert.equal(db.getGuild("g").channel_id, "c2");
    assert.equal(db.clearGuildChannel("g"), true);
    assert.equal(db.getGuild("g"), undefined);
});

test("export and delete remove everything about a user", () => {
    const db = openDb(":memory:");
    db.ensureUser("u1");
    db.updateUser("u1", { steam_id: "76561198000000000" });
    db.addItems("u1", [game(1)]);
    const out = db.exportUser("u1");
    assert.equal(out.items.length, 1);
    assert.equal(db.deleteUser("u1"), true);
    assert.equal(db.getUser("u1"), undefined);
    assert.equal(db.countItems("u1"), 0);
    assert.equal(db.exportUser("u1"), null);
});

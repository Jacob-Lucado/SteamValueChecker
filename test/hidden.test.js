import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createLogBuffer } from "../src/logbuffer.js";
import { isHidden, mentionsHidden, setHiddenGuilds } from "../src/hidden.js";
import { collectAbout } from "../src/about.js";

const HID = "768505465809797130", OTHER = "900000000000000001";

test("the test server is hidden by default and more can be added", () => {
    assert.ok(isHidden(HID) && !isHidden(OTHER));
    setHiddenGuilds("111111111, 222222222"); assert.ok(isHidden("222222222") && isHidden(HID)); setHiddenGuilds("");
    assert.ok(!isHidden("222222222"));
});

test("nothing is recorded for the hidden server, and other servers are unaffected", () => {
    const db = openDb(":memory:");
    assert.deepEqual(db.addXp(HID, "u", 50, { message: true }), { before: 0, after: 0, xp: 0 });
    assert.equal(db.getXp(HID, "u"), undefined);
    assert.ok(db.addXp(OTHER, "u", 50, { message: true }).xp > 0);
    assert.equal(db.addCase(HID, { userId: "u", action: "warn" }).case_no, 0);
    assert.equal(db.countCases(HID), 0);
    assert.equal(db.addCase(OTHER, { userId: "u", action: "warn" }).case_no, 1);
    assert.equal(db.recordJoin(HID, "u", null, null), 0);
    assert.equal(db.addAnnouncement(HID, "u", "c", "m", "t"), 0);
    db.guildMarkSeen(HID, "k"); assert.equal(db.guildHasSeen(HID, "k"), false);
});

test("purge removes what older versions stored for the hidden server and nothing else", () => {
    const file = join(mkdtempSync(join(tmpdir(), "hid-")), "a.db");
    const db = openDb(file);
    const raw = new DatabaseSync(file);
    for (const g of [HID, OTHER]) {
        raw.prepare("INSERT INTO member_xp (guild_id, user_id, xp, level, last_at) VALUES (?,?,?,?,?)").run(g, "u", 10, 0, 1);
        raw.prepare("INSERT INTO mod_cases (guild_id, case_no, user_id, mod_id, action, created_at) VALUES (?,?,?,?,?,?)").run(g, 1, "u", "m", "warn", 1);
        raw.prepare("INSERT INTO invite_joins (guild_id, user_id, joined_at) VALUES (?,?,?)").run(g, "u", 1);
    }
    assert.equal(db.purgeHiddenGuilds(), 3);
    assert.equal(db.getXp(HID, "u"), undefined); assert.ok(db.getXp(OTHER, "u")); assert.equal(db.countCases(OTHER), 1);
    assert.equal(db.purgeHiddenGuilds(), 0);
});

test("the hidden server is left out of the public numbers", () => {
    const mk = id => ({ id, memberCount: 10 });
    const client = { guilds: { cache: new Map([[HID, mk(HID)], [OTHER, mk(OTHER)]]) } };
    const about = collectAbout({ client, db: openDb(":memory:"), cfg: {}, startedAt: 0, now: () => 1000 });
    assert.equal(about.servers, 1); assert.equal(about.members, 10);
});

test("log lines that name the hidden server are dropped, including ones saved earlier, and never printed", () => {
    const logs = createLogBuffer();
    logs.add("error", [`[mod] failed in guild ${HID}`]); logs.add("error", ["[mod] failed in another server"]);
    assert.deepEqual(logs.recent({ level: "error" }).map(l => l.text), ["[mod] failed in another server"]);
    const printed = []; const fake = { log() {}, info() {}, warn() {}, error: (...a) => printed.push(a.join(" ")) };
    logs.capture(fake); fake.error(`boom ${HID}`); fake.error("fine");
    assert.deepEqual(printed, ["fine"]);
    assert.ok(mentionsHidden(`x ${HID} y`));
});

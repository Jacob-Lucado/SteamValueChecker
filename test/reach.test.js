import test from "node:test";
import assert from "node:assert/strict";
import { dmBlocked, reachNotice, reachLine } from "../src/reach.js";
import { alertPanel } from "../src/alertpanel.js";
import { openDb } from "../src/db.js";

test("reach: only a member who gets DMs and keeps failing them is told, and the text says where alerts go meanwhile", () => {
    assert.equal(dmBlocked({ delivery: "dm", dm_failures: 2 }), false);
    assert.equal(dmBlocked({ delivery: "dm", dm_failures: 3 }), true);
    assert.equal(dmBlocked({ delivery: "channel", dm_failures: 9 }), false, "channel delivery doesn't use DMs");
    assert.equal(reachNotice({ delivery: "dm", dm_failures: 0 }), null);
    const withChannel = reachNotice({ delivery: "dm", dm_failures: 4 }, { channel_id: "c1" });
    assert.match(withChannel.what, /last 4 direct messages/);
    assert.match(withChannel.meanwhile, /<#c1>/);
    assert.match(reachNotice({ delivery: "dm", dm_failures: 4 }).meanwhile, /can't be delivered at all/);
    assert.match(reachLine({ delivery: "dm", dm_failures: 3 }), /Content & Social/);
    assert.equal(reachLine({ delivery: "dm", dm_failures: 0 }), null);
});

test("reach: the Where page of /alerts shows the warning for a blocked member and nothing for everyone else", () => {
    const db = openDb(":memory:");
    db.ensureUser("u1", "g1"); db.ensureUser("u2", "g1");
    db.updateUser("u1", { dm_failures: 5 });
    const panel = alertPanel({ db });
    const text = id => panel.render({ db, user: { discord_id: id } }, "delivery").embeds[0].description;
    assert.match(text("u1"), /aren't reaching you/);
    assert.doesNotMatch(text("u2"), /aren't reaching you/);
});

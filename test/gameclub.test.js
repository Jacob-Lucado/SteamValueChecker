import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { clubProgress, clubEmbed, runGameClubs, setPick, monthOf } from "../src/gameclub.js";

const T = Date.parse("2026-11-10T12:00:00Z");
function world() {
    const db = openDb(":memory:");
    for (const [u, min, st] of [["u1", 3000, "finished"], ["u2", 600, "playing"], ["u3", 0, "backlog"], ["u4", 90, "playing"]]) {
        db.ensureUser(u, "G"); db.updateUser(u, { share: u !== "u4" ? 1 : 0, guild_id: "G" });
        db.syncSteamGames(u, [{ itad_id: "id-ER", title: "Elden Ring", appid: 1245620, minutes: min, lastPlayed: 1 }]);
        if (st === "finished") db.setLibraryStatus(u, "id-ER", "finished");
    }
    return db;
}

test("game club: the pick borrows a Steam id from a member's library, and progress counts only sharing members", () => {
    const db = world();
    const club = setPick(db, "G", "elden ring", "mod", T);
    assert.equal(club.appid, 1245620); assert.equal(club.month, "2026-11");
    const p = clubProgress(db, club);
    assert.deepEqual(p.owners.map(r => [r.userId, r.finished, r.started]), [["u1", true, true], ["u2", false, true], ["u3", false, false]], "u4 does not share");
    assert.equal(p.sharing, 3);
    const e = clubEmbed(club, p);
    assert.deepEqual(e.fields.map(f => f.name.split(" ")[1]), ["Finished", "Playing", "Own"]);
    assert.throws(() => setPick(db, "G", "  ", "mod"), /which game/);
});

test("game club: one card a week in the club channel with no pings, and a note when the month is over", async () => {
    const db = world(); setPick(db, "G", "Elden Ring", "mod", T); db.setClub("G", { channel_id: "chan" });
    const posts = [], notifier = { postChannel: async (c, p, r) => { posts.push([c, p, r]); return true; } };
    assert.equal((await runGameClubs({ db, notifier, now: () => T })).posted, 1);
    assert.equal(posts[0][2], null); assert.deepEqual(posts[0][1].allowedMentions, { parse: [] });
    assert.equal((await runGameClubs({ db, notifier, now: () => T + 3 * 86400_000 })).posted, 0, "not again within a week");
    assert.equal((await runGameClubs({ db, notifier, now: () => T + 8 * 86400_000 })).posted, 1);
    const next = Date.parse("2026-12-02T00:00:00Z");
    assert.equal(monthOf(next), "2026-12");
    assert.equal((await runGameClubs({ db, notifier, now: () => next })).posted, 1);
    assert.match(posts.at(-1)[1].embeds[0].title, /2026-11 is over/);
    assert.equal((await runGameClubs({ db, notifier, now: () => next + 86400_000 })).posted, 0, "the month-over note is posted once");
});

test("game club: no channel means no posts", async () => {
    const db = world(); setPick(db, "G", "Elden Ring", "mod", T);
    assert.equal((await runGameClubs({ db, notifier: { postChannel: async () => assert.fail("no") }, now: () => T })).clubs, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { addFamily, removeFamily, familyView, familyEmbed, ownedWithFamily, runFamilySync, MAX_FAMILY } from "../src/family.js";
import { commands } from "../src/commands.js";

const ID = n => "7656119800000000" + n;
// A tiny Steam: each profile's public games page, and its profile name.
function fakeSteam(libs, { privateIds = [] } = {}) {
    const calls = [];
    const fetchImpl = async url => {
        const u = String(url); calls.push(u);
        const id = /profiles\/(\d{17})/.exec(u)?.[1];
        const text = async () => {
            if (/\?xml=1$/.test(u)) return `<profile><steamID><![CDATA[Player ${id.slice(-1)}]]></steamID></profile>`;
            if (privateIds.includes(id)) return "<gamesList></gamesList>";
            return `<gamesList><games>${(libs[id] ?? []).map(a => `<game><appID>${a}</appID><name><![CDATA[Game ${a}]]></name><hoursOnRecord>1.0</hoursOnRecord></game>`).join("")}</games></gamesList>`;
        };
        return { ok: true, status: 200, headers: new Map(), text, json: async () => ({}) };
    };
    return { fetchImpl, calls };
}
function seeded() {
    const db = openDb(":memory:");
    db.ensureUser("u1", "g1");
    return db;
}

test("steam family: adding a profile keeps their games, and a wishlist game they own stops alerting", async () => {
    const db = seeded();
    const { fetchImpl } = fakeSteam({ [ID(1)]: [620, 400] });
    db.addItems("u1", [{ itad_id: "id-portal2", title: "Portal 2", appid: 620 }, { itad_id: "id-hades", title: "Hades", appid: 1145360 }]);
    assert.deepEqual(db.activeItems().map(i => i.title).sort(), ["Hades", "Portal 2"]);
    const r = await addFamily({ db, userId: "u1", input: ID(1), fetchImpl });
    assert.deepEqual([r.games, r.covered, r.name], [2, 1, "Player 1"]);
    assert.deepEqual(db.activeItems().map(i => i.title), ["Hades"], "Portal 2 is in the family, so it isn't checked for alerts");
    const view = familyView(db, "u1");
    assert.deepEqual(view.covered, [{ title: "Portal 2", appid: 620, owner: "Player 1" }]);
    const e = familyEmbed(view);
    assert.match(e.description, /Player 1/); assert.match(e.fields[0].value, /Portal 2/);
    await removeFamily({ db, userId: "u1", input: "player 1", fetchImpl });
    assert.deepEqual(db.activeItems().map(i => i.title).sort(), ["Hades", "Portal 2"], "removing them brings the alert back");
    assert.equal(familyView(db, "u1").members.length, 0);
});

test("steam family: a private profile and a sixth person are turned away with a plain reason", async () => {
    const db = seeded();
    const libs = Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [ID(n), [n]]));
    const { fetchImpl } = fakeSteam(libs, { privateIds: [ID(9)] });
    await assert.rejects(addFamily({ db, userId: "u1", input: ID(9), fetchImpl }), /public|private/i);
    assert.equal(db.listFamily("u1").length, 0, "nothing is saved for a profile that couldn't be read");
    for (let n = 1; n <= MAX_FAMILY; n++) await addFamily({ db, userId: "u1", input: ID(n), fetchImpl });
    await assert.rejects(addFamily({ db, userId: "u1", input: ID(6), fetchImpl }), /Remove one first/);
    await addFamily({ db, userId: "u1", input: ID(2), fetchImpl }); // adding someone already listed just refreshes them
    assert.equal(db.listFamily("u1").length, MAX_FAMILY);
    await assert.rejects(removeFamily({ db, userId: "u1", input: ID(6), fetchImpl }), /isn't in your family/);
});

test("steam family: bundle checks count the family's games as owned", async () => {
    const db = seeded();
    const { fetchImpl } = fakeSteam({ [ID(1)]: [620] });
    await addFamily({ db, userId: "u1", input: ID(1), fetchImpl });
    const itad = { steamAppIds: async ids => new Map(ids.map(id => [id, id === "id-portal2" ? 620 : id === "id-hades" ? 1145360 : null])) };
    const owned = await ownedWithFamily({ db, itad, userId: "u1", gameIds: ["id-portal2", "id-hades", "id-x"] });
    assert.deepEqual([...owned], ["id-portal2"]);
    const none = await ownedWithFamily({ db, itad: { steamAppIds: async () => { throw new Error("down"); } }, userId: "u1", gameIds: ["id-portal2"] });
    assert.equal(none.size, 0, "a failed lookup only loses the family part");
});

test("steam family: the daily refresh picks up new games, and data export and delete cover the list", async () => {
    const db = seeded();
    const libs = { [ID(1)]: [620] };
    const { fetchImpl } = fakeSteam(libs);
    await addFamily({ db, userId: "u1", input: ID(1), fetchImpl });
    libs[ID(1)] = [620, 400, 500];
    assert.deepEqual(await runFamilySync({ db, fetchImpl, now: Date.now() }), { synced: 0, failed: 0 }, "fresh lists are left alone");
    assert.deepEqual(await runFamilySync({ db, fetchImpl, now: Date.now() + 2 * 86400_000 }), { synced: 1, failed: 0 });
    assert.equal(db.familyAppIds("u1").size, 3);
    assert.equal(db.listFamily("u1")[0].name, "Player 1", "the name is kept across refreshes");
    assert.equal(db.exportUser("u1").steam_family.length, 1);
    db.deleteUser("u1");
    assert.equal(db.familyAppIds("u1").size, 0);
    assert.equal(db.listFamily("u1").length, 0);
});

test("steam family: the command exists with add and remove, inside Discord's limits", () => {
    const fam = commands.find(c => c.name === "steam").options.find(o => o.name === "family");
    assert.deepEqual(fam.options.map(o => o.name), ["add", "remove"]);
    assert.ok(fam.description.length <= 100 && fam.options.every(o => o.description.length <= 100));
});

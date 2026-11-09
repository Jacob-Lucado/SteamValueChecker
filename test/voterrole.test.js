import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createVoterRole, VOTER_ROLE } from "../src/voterrole.js";

function rig({ inGuild = true, perm = true } = {}) {
    let t = Date.UTC(2026, 10, 5, 12);
    const db = openDb(":memory:", { now: () => t });
    const held = new Set(), made = [];
    const role = { id: "r1", name: VOTER_ROLE, position: 1 };
    let exists = false;
    const member = { roles: { cache: { has: id => held.has(id) }, add: async r => { held.add(r.id); }, remove: async r => { held.delete(r.id); } } };
    const guild = {
        members: { me: { permissions: { has: () => perm }, roles: { highest: { position: 10 } } }, fetch: async () => { if (!inGuild) throw new Error("Unknown Member"); return member; } },
        roles: { fetch: async () => ({ find: fn => (exists ? [role] : []).find(fn) }), create: async o => { made.push(o); exists = true; return role; } }
    };
    const client = { guilds: { cache: new Map([["home", guild]]) } };
    const vr = createVoterRole({ db, client, mainGuild: { detect: () => "home" }, now: () => t });
    return { vr, db, held, made, advance: ms => { t += ms; }, now: () => t };
}

test("a voter gets the role in the home server and loses it when the vote runs out", async () => {
    const r = rig();
    assert.equal(await r.vr.grant("u1", r.now() + 3600_000), "given");
    assert.equal(r.made[0].name, "Top Voter");
    assert.ok(r.held.has("r1"));
    assert.equal(await r.vr.sweep(), 0, "still valid");
    r.advance(2 * 3600_000);
    assert.equal(await r.vr.sweep(), 1);
    assert.ok(!r.held.has("r1"));
    assert.equal(await r.vr.sweep(), 0, "nothing left to do");
});

test("people outside the home server, or a bot without permission, are skipped quietly", async () => {
    assert.equal(await rig({ inGuild: false }).vr.grant("u1"), "not-a-member");
    assert.equal(await rig({ perm: false }).vr.grant("u1"), "no-permission");
});

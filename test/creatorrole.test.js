import test from "node:test";
import assert from "node:assert/strict";
import { ensureCreatorRole, CREATOR_ROLE } from "../src/creatorrole.js";

function fakeGuild({ perm = true, member = true, existing = null, botPos = 10, rolePos = 1 } = {}) {
    const made = [], added = [];
    const hasRole = new Set();
    const role = existing ? { id: "r1", name: CREATOR_ROLE, position: rolePos } : null;
    return {
        made, added, name: "G",
        members: {
            me: { permissions: { has: () => perm }, roles: { highest: { position: botPos } } },
            fetch: async () => { if (!member) throw new Error("Unknown Member"); return { roles: { cache: { has: id => hasRole.has(id) }, add: async (r, why) => { added.push(r.name); } } }; }
        },
        roles: {
            fetch: async () => ({ find: fn => [role].filter(Boolean).find(fn) }),
            create: async o => { made.push(o); return { id: "new", name: o.name, position: 1 }; }
        }
    };
}

test("owner gets a hoisted Bot Creator role", async () => {
    const g = fakeGuild();
    assert.equal(await ensureCreatorRole(g, "u1"), "given");
    assert.equal(g.made[0].name, "Bot Creator");
    assert.equal(g.made[0].hoist, true);
    assert.deepEqual(g.added, ["Bot Creator"]);
});
test("an existing role is reused, not duplicated", async () => {
    const g = fakeGuild({ existing: true });
    assert.equal(await ensureCreatorRole(g, "u1"), "given");
    assert.equal(g.made.length, 0);
});
test("does nothing without permission, membership or an owner", async () => {
    assert.equal(await ensureCreatorRole(fakeGuild({ perm: false }), "u1"), "no-permission");
    assert.equal(await ensureCreatorRole(fakeGuild({ member: false }), "u1"), "not-a-member");
    assert.equal(await ensureCreatorRole(fakeGuild(), null), "skipped");
});
test("a role above the bot's own is left alone", async () => {
    assert.equal(await ensureCreatorRole(fakeGuild({ existing: true, rolePos: 20 }), "u1"), "role-too-high");
});

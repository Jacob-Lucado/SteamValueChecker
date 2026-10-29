import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createTicketService } from "../src/tickets.js";

function setup() {
    let n = 0, t = Date.parse("2026-10-26T12:00:00Z");
    const db = openDb(":memory:", { now: () => t }); // one fake clock for the store and the service, so the test does not depend on today's date
    const posts = [], edits = [], dms = [];
    const discord = {
        post: async (c, p) => { posts.push([c, p]); return { id: String(++n) }; },
        edit: async (c, m, p) => { edits.push([c, m, p]); },
        dm: async (u, p) => { dms.push([u, p]); }
    };
    const svc = createTicketService({ db, discord, ownerId: "owner", publicUrl: "https://x.test", now: () => t });
    return { db, svc, posts, edits, dms, advance: ms => { t += ms; } };
}

test("tickets: no support channel means the ticket is saved but nobody is pinged; a channel gets a staff message", async () => {
    const { db, svc, posts } = setup();
    const a = await svc.open({ userId: "u1", guildId: "g1", subject: "Help", body: "It broke" });
    assert.equal(a.queued, false);
    assert.equal(db.getTicket(a.id).guild_id, null);
    db.setTicketSettings("*", { channelId: "100", staffRoleId: null });
    const b = await svc.open({ userId: "u1", guildId: "g1", subject: "Again", body: "Still broken" });
    assert.equal(b.queued, true);
    assert.equal(posts.length, 1);
    assert.equal(posts[0][0], "100");
});

test("tickets: staff reply DMs the user and waits; user reply reopens; resolve asks for a rating", async () => {
    const { db, svc, dms } = setup();
    const { id } = await svc.open({ userId: "u1", subject: "Q", body: "hi" });
    await svc.reply(id, { authorId: "staff1", role: "staff", body: "Try this" });
    assert.equal(db.getTicket(id).status, "waiting");
    assert.equal(db.getTicket(id).assignee_id, "staff1");
    assert.ok(dms.some(([u]) => u === "u1"));
    await svc.reply(id, { authorId: "u1", role: "user", body: "thanks, still stuck" });
    assert.equal(db.getTicket(id).status, "open");
    await svc.resolve(id, { by: "staff1", note: "fixed" });
    assert.equal(db.getTicket(id).status, "resolved");
    assert.equal(svc.rate(id, "u1", 5), 5);
    assert.throws(() => svc.rate(id, "someone", 5), /not for you/);
    assert.throws(() => svc.rate(id, "u1", 9), /1 to 5/);
    assert.match(svc.transcript(id), /Try this/);
});

test("tickets: limits, auto-resolve and auto-close, and deleting a user removes their tickets", async () => {
    const { db, svc, advance } = setup();
    for (let i = 0; i < 5; i++) await svc.open({ userId: "u2", subject: "s" + i, body: "b" });
    await assert.rejects(svc.open({ userId: "u2", subject: "x", body: "y" }), /5 open/);
    const { id } = await svc.open({ userId: "u3", subject: "w", body: "b" });
    await svc.reply(id, { authorId: "s", role: "staff", body: "?" });
    advance(8 * 86400_000);
    assert.equal((await svc.tick()).resolved, 1);
    advance(4 * 86400_000);
    await svc.tick();
    assert.equal(db.getTicket(id).status, "closed");
    db.deleteUser("u2");
    assert.equal(db.listTickets({ userId: "u2" }).length, 0);
});

test("tickets: tags are cleaned and the data export includes your tickets", async () => {
    const { db, svc } = setup();
    db.ensureUser("u4");
    const { id } = await svc.open({ userId: "u4", subject: "t", body: "b" });
    await svc.setTags(id, ["Key Problem", "<b>x</b>", "key problem"]);
    assert.deepEqual(db.getTicket(id).tags, ["key problem", "bxb"]);
    assert.equal(db.exportUser("u4").support_tickets[0].messages[0].body, "b");
});

test("bug tickets skip server routing, are tagged, and show up in the bug list", async () => {
    const { db, svc } = setup();
    db.setTicketSettings("*", { channelId: "100", staffRoleId: null });
    const a = await svc.open({ userId: "u1", guildId: "g1", subject: "Crash", body: "It crashed", kind: "bug" });
    assert.equal(db.getTicket(a.id).guild_id, null);
    assert.equal(db.countNewBugs(0), 1);
    const bugs = db.listBugs({ limit: 10 });
    assert.equal(bugs.length, 1);
    assert.equal(bugs[0].id, a.id);
    await svc.open({ userId: "u1", guildId: "g1", subject: "Question", body: "How?" });
    assert.equal(db.listBugs({ limit: 10 }).length, 1);
});

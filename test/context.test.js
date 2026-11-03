import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createHandlers } from "../src/handlers.js";
import { contextCommands, hubCommands, CONTEXT_COMPARE, CONTEXT_WISHLIST } from "../src/commands.js";

const itad = { getPrices: async ids => new Map(ids.map(id => [id, { deals: [{ shop: { name: "GOG" }, price: { amount: 6, currency: "USD" }, regular: { amount: 20 }, cut: 70, url: "https://gog.test/x" }] }])) };
const fake = (commandName, target, { user = "me", guildId = "g1" } = {}) => {
    const out = [];
    return { out, commandName, targetUser: target, user: { id: user }, guildId, deferReply: async () => {}, reply: async p => { out.push(p); }, editReply: async p => { out.push(p); } };
};

test("right-click commands: two user commands, server only, named for what they do, kept apart from the slash commands", () => {
    assert.deepEqual(contextCommands.map(c => [c.name, c.type]), [[CONTEXT_COMPARE, 2], [CONTEXT_WISHLIST, 2]]);
    assert.ok(contextCommands.every(c => c.description === undefined || c.description === ""));
    assert.ok(!hubCommands.some(c => c.type === 2), "they are registered separately");
});

test("right-click compare: needs both to have opted in, never works on a bot or on yourself", async () => {
    const db = openDb(":memory:");
    for (const id of ["me", "pal"]) { db.ensureUser(id, "g1"); db.updateUser(id, { share: 1 }); db.upsertLibrary(id, [{ itad_id: id === "me" ? "a" : "b", title: id, paid: 5 }, { itad_id: "c", title: "Shared", paid: 5 }]); }
    const h = createHandlers({ db, itad });
    const self = fake(CONTEXT_COMPARE, { id: "me", username: "me" }); await h.handleContextMenu(self);
    assert.match(self.out[0].content, /That is you/);
    const bot = fake(CONTEXT_COMPARE, { id: "bot1", username: "bot", bot: true }); await h.handleContextMenu(bot);
    assert.match(bot.out[0].content, /Bots don't/);
    db.updateUser("pal", { share: 0 });
    const closed = fake(CONTEXT_COMPARE, { id: "pal", username: "Pal" }); await h.handleContextMenu(closed);
    assert.match(closed.out[0].content, /has not opted in/);
    db.updateUser("pal", { share: 1 });
    const ok = fake(CONTEXT_COMPARE, { id: "pal", username: "Pal", displayName: "Pal" }); await h.handleContextMenu(ok);
    assert.equal(ok.out.length, 1); assert.ok(ok.out[0].files?.length || ok.out[0].embeds?.length, "a card"); assert.equal(ok.out[0].flags !== undefined, true, "only the caller sees it");
    const dm = fake(CONTEXT_COMPARE, { id: "pal", username: "Pal" }, { guildId: null }); await h.handleContextMenu(dm);
    assert.match(dm.out[0].content, /in a server/);
});

test("right-click wishlist: shows a shared wishlist, says so when there isn't one, and never leaks a private one", async () => {
    const db = openDb(":memory:");
    db.ensureUser("me", "g1"); db.ensureUser("pal", "g1");
    db.addItems("pal", [{ itad_id: "w1", title: "Hades II" }, { itad_id: "w2", title: "Silksong" }]);
    const h = createHandlers({ db, itad, publicUrl: "https://svc.test" });
    const none = fake(CONTEXT_WISHLIST, { id: "pal", username: "Pal", displayName: "Pal" }); await h.handleContextMenu(none);
    assert.match(none.out[0].content, /hasn't shared a wishlist/);
    db.setProfile("pal", { slug: "pal", isPublic: true });
    const shown = fake(CONTEXT_WISHLIST, { id: "pal", username: "Pal", displayName: "Pal" }); await h.handleContextMenu(shown);
    const e = shown.out.at(-1).embeds[0];
    assert.match(e.title, /Pal's wishlist/); assert.match(e.description, /Hades II/); assert.match(e.description, /70% off/); assert.equal(e.url, "https://svc.test/#/u/pal");
    db.setProfile("pal", { slug: "pal", isPublic: false });
    const priv = fake(CONTEXT_WISHLIST, { id: "pal", username: "Pal", displayName: "Pal" }); await h.handleContextMenu(priv);
    assert.match(priv.out[0].content, /hasn't shared a wishlist/);
    assert.equal(shown.out.length, 1, "one reply");
});

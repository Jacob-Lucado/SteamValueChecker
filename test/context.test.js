import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createHandlers, gameTitleFromText } from "../src/handlers.js";
import { contextCommands, hubCommands, CONTEXT_COMPARE, CONTEXT_WISHLIST, CONTEXT_GIFTS, CONTEXT_TOGETHER, CONTEXT_PRICE, CONTEXT_ADD } from "../src/commands.js";

const itad = { getPrices: async ids => new Map(ids.map(id => [id, { deals: [{ shop: { name: "GOG" }, price: { amount: 6, currency: "USD" }, regular: { amount: 20 }, cut: 70, url: "https://gog.test/x" }] }])) };
const fake = (commandName, target, { user = "me", guildId = "g1" } = {}) => {
    const out = [];
    return { out, commandName, targetUser: target, user: { id: user }, guildId, deferReply: async () => {}, reply: async p => { out.push(p); }, editReply: async p => { out.push(p); } };
};

test("right-click commands: four user and two message commands, named for what they do, kept apart from the slash commands", () => {
    assert.deepEqual(contextCommands.map(c => [c.name, c.type]), [[CONTEXT_COMPARE, 2], [CONTEXT_WISHLIST, 2], [CONTEXT_GIFTS, 2], [CONTEXT_TOGETHER, 2], [CONTEXT_PRICE, 3], [CONTEXT_ADD, 3]]);
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

test("right-click message menus: the text is read as a title, then priced or added", async () => {
    assert.equal(gameTitleFromText("**Hades II**\nsecond line"), "Hades II");
    assert.equal(gameTitleFromText("<@123> https://x.test/a"), null); assert.equal(gameTitleFromText(""), null); assert.equal(gameTitleFromText(undefined), null);
    const db = openDb(":memory:");
    const it = { ...itad, lookupTitles: async ts => ts.map(t => (t === "Nope" ? { title: t, id: null } : { title: t, id: "g-" + t, approx: false })) };
    const h = createHandlers({ db, itad: it });
    const msg = (cmd, content) => ({ ...fake(cmd, null, { user: "me" }), targetMessage: { content } });
    const empty = msg(CONTEXT_PRICE, "   "); await h.handleMessageContext(empty);
    assert.match(empty.out[0].content, /no game title/);
    const price = msg(CONTEXT_PRICE, "Hades II"); await h.handleMessageContext(price);
    assert.match(price.out.at(-1).embeds[0].title ?? "", /Hades II/);
    const add = msg(CONTEXT_ADD, "Hades II"); await h.handleMessageContext(add);
    assert.match(add.out.at(-1), /Added \*\*Hades II\*\*/);
    assert.equal(db.listItems("me").length, 1);
    const again = msg(CONTEXT_ADD, "Hades II"); await h.handleMessageContext(again);
    assert.match(String(again.out.at(-1).content ?? again.out.at(-1)), /already on your list/);
});

test("right-click gift ideas: only sale games nobody claimed", async () => {
    const { giftIdeasEmbed } = await import("../src/render.js");
    const page = { slug: "pal", games: [{ title: "A", price: 5, currency: "USD", shop: "GOG", discount: 50, claim: null }, { title: "B", price: 5, currency: "USD", discount: 50, claim: "x" }, { title: "C", price: 9, currency: "USD", discount: 0, claim: null }] };
    const e = giftIdeasEmbed("Pal", page);
    assert.match(e.description, /\*\*A\*\*/); assert.doesNotMatch(e.description, /\*\*B\*\*|\*\*C\*\*/);
    assert.match(giftIdeasEmbed("Pal", { games: [] }).description, /Nothing/);
});

test("right-click play together: shared co-op or multiplayer games, counting untagged ones honestly", async () => {
    const db = openDb(":memory:");
    for (const id of ["me", "pal"]) { db.ensureUser(id, "g1"); db.updateUser(id, { share: 1 }); }
    const g = [{ itad_id: "a", title: "Co Game", appid: 1, minutes: 30 }, { itad_id: "b", title: "Solo Game", appid: 2, minutes: 900 }, { itad_id: "c", title: "Mystery", appid: 3, minutes: 5 }];
    db.syncSteamGames("me", g); db.syncSteamGames("pal", g);
    db.saveAppTags(1, ["Action"], ["Co-op", "Single-player"]); db.saveAppTags(2, ["RPG"], ["Single-player"]);
    const h = createHandlers({ db, itad });
    const c = fake(CONTEXT_TOGETHER, { id: "pal", username: "Pal", displayName: "Pal" }); await h.handleContextMenu(c);
    const e = c.out[0].embeds[0];
    assert.match(e.description, /Co Game/); assert.doesNotMatch(e.description, /Solo Game/);
    assert.match(e.footer.text, /1 shared games not tagged/);
    const self = fake(CONTEXT_TOGETHER, { id: "me", username: "me" }); await h.handleContextMenu(self);
    assert.match(self.out[0].content, /That is you/);
});

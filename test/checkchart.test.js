import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createHandlers } from "../src/handlers.js";

const DAY = 86400_000;
function fakeItad(history) {
    return {
        getPrices: async ids => new Map(ids.map(id => [id, { deals: [{ shop: { name: "Steam" }, price: { amount: 19.99, currency: "USD" }, regular: { amount: 29.99 }, cut: 33, url: "https://store.steampowered.com/app/1/" }], historyLow: { all: { amount: 7.49 }, y1: { amount: 7.49 }, m3: { amount: 19.99 } } }])),
        getHistory: async () => history, getSubs: async () => new Map()
    };
}
function interaction(game, id = "u1") {
    const out = { replies: [] };
    return Object.assign(out, {
        user: { id }, guildId: null, options: { getSubcommand: () => "check", getString: () => game },
        deferReply: async () => {}, editReply: async p => { out.replies.push(p); }, reply: async p => { out.replies.push(p); }
    });
}

test("/me wishlist check: the deal card comes with a price history picture when there is history to draw", async () => {
    const db = openDb(":memory:"); db.ensureUser("u1", null); db.addItems("u1", [{ itad_id: "g1", title: "Hades" }]);
    const now = Date.now();
    const history = [[-300, 29.99], [-120, 7.49], [-40, 29.99]].map(([d, price]) => ({ t: now + d * DAY, price }));
    const i = interaction("Hades");
    await createHandlers({ db, itad: fakeItad(history) }).handleWishlist(i);
    const r = i.replies.at(-1);
    assert.equal(r.embeds.length, 1); assert.equal(r.files.length, 1); assert.equal(r.files[0].name, "price-history.png");
    assert.equal(r.embeds[0].image.url, "attachment://price-history.png"); assert.equal(Buffer.from(r.files[0].attachment).subarray(1, 4).toString(), "PNG");
});

test("/me wishlist check: no history, no picture, and the card still comes", async () => {
    const db = openDb(":memory:"); db.ensureUser("u2", null); db.addItems("u2", [{ itad_id: "g1", title: "Hades" }]);
    const i = interaction("Hades", "u2"); // another member: the command has a short cooldown per person
    await createHandlers({ db, itad: fakeItad([]) }).handleWishlist(i);
    const r = i.replies.at(-1);
    assert.equal(r.embeds.length, 1); assert.deepEqual(r.files, []); assert.equal(r.embeds[0].image, undefined);
});

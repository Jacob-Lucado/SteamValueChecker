import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createHandlers } from "../src/handlers.js";

function ix(opts = {}) {
    const out = [];
    const get = (k, req) => { const v = opts[k] ?? null; return v; };
    return { out, i: { user: { id: "u1", username: "jacob", globalName: "Jacob" }, member: { displayName: "Jacob" }, guildId: "G", options: { getBoolean: k => opts[k] ?? null, getString: k => opts[k] ?? null }, reply: async p => out.push(p) } };
}

test("/me publicpage share: nothing to change shows the link privately, share:true posts a card for everyone", async () => {
    const db = openDb(":memory:"); db.ensureUser("u1", "G");
    const h = createHandlers({ db, itad: {}, publicUrl: "https://svc.test" });
    let t = ix(); await h.handlePublicPage(t.i);
    assert.match(t.out[0].content, /page is off/); assert.equal(t.out[0].flags, 64);
    t = ix({ enabled: true, name: "jacobm" }); await h.handlePublicPage(t.i);
    assert.match(t.out[0].content, /https:\/\/svc\.test\/u\/jacobm/);
    db.addItems("u1", [{ itad_id: "a", title: "Hades II" }, { itad_id: "b", title: "Celeste" }]);
    t = ix(); await h.handlePublicPage(t.i);
    assert.equal(t.out[0].flags, 64); assert.match(t.out[0].content, /Your page: https:\/\/svc\.test\/u\/jacobm/);
    t = ix({ share: true }); await h.handlePublicPage(t.i);
    const p = t.out[0];
    assert.equal(p.flags, undefined, "public, not ephemeral");
    assert.equal(p.embeds[0].title, "🎁 Jacob's wishlist"); assert.equal(p.embeds[0].url, "https://svc.test/u/jacobm");
    assert.match(p.embeds[0].description, /2 games.*Hades II/s); assert.equal(p.components[0].components[0].url, "https://svc.test/u/jacobm");
    assert.deepEqual(p.allowedMentions, { parse: [] });
    // share together with turning it on, and sharing while it is off
    db.setProfile("u1", { slug: "jacobm", isPublic: false });
    t = ix({ share: true }); await h.handlePublicPage(t.i); assert.match(t.out[0].content, /page is off/);
    t = ix({ share: true, enabled: true }); await h.handlePublicPage(t.i); assert.ok(t.out[0].embeds, "turned on and shared in one go");
    t = ix({ enabled: false }); await h.handlePublicPage(t.i); assert.match(t.out[0].content, /page is off/);
});

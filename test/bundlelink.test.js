import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { bundleLinkKey, bundleFromLink, bundleLookup } from "../src/bundle.js";
import { UserError } from "../src/errors.js";

const price = amount => ({ deals: [{ shop: { id: 61, name: "Steam" }, price: { amount, currency: "USD" }, regular: { amount, currency: "USD" }, cut: 0 }] });

function setup({ tiers = null } = {}) {
    const db = openDb(":memory:");
    const user = db.ensureUser("u1");
    db.upsertFeedBundle({ key: "fanatical:killer", store: "fanatical", title: "Killer Bundle 30", url: "https://www.fanatical.com/en/bundle/killer-bundle-30", image: null, games: ["Alpha", "Beta", "Gamma"], gameCount: 3, price: "$4.99", kind: "fixed", expiresAt: null, seenAt: Date.now() });
    const itad = {
        lookupTitles: async titles => titles.map(t => ({ title: t, id: /^zzz/.test(t) ? null : "id-" + t.toLowerCase(), approx: false, matched: t })),
        getPrices: async ids => new Map(ids.map(id => [id, price(10)])),
        getBundleDetails: async () => (tiers ? [{ id: "b1", title: "Killer Bundle 30", shop: "Fanatical", url: "https://itad.link/x", expiry: null, currency: "USD", matches: ["id-alpha"],
            tiers: [{ price: 1, currency: "USD", games: [{ id: "id-alpha", title: "Alpha" }] }, { price: 4.99, currency: "USD", games: [{ id: "id-beta", title: "Beta" }, { id: "id-gamma", title: "Gamma" }] }] }] : [])
    };
    return { db, user, itad };
}

test("bundle links compare the same whatever the language folder, www, query or trailing slash", () => {
    assert.equal(bundleLinkKey("https://www.fanatical.com/en/bundle/killer-bundle-30"), bundleLinkKey("https://fanatical.com/de/bundle/killer-bundle-30/?ref=x"));
    assert.equal(bundleLinkKey("not a link"), null);
    assert.equal(bundleLinkKey("javascript:alert(1)"), null);
});

test("bundle check from a link: judged as one tier at the store's price, skipping games you own", async () => {
    const { db, user, itad } = setup();
    db.upsertLibrary("u1", [{ itad_id: "id-alpha", title: "Alpha", paid: null }]);
    const out = await bundleFromLink({ db, itad, user, link: "https://www.fanatical.com/de/bundle/killer-bundle-30?x=1" });
    const [b] = out.bundles;
    assert.equal(b.title, "Killer Bundle 30");
    assert.deepEqual([b.tiers[0].price, b.tiers[0].games, b.tiers[0].owned, b.tiers[0].worth], [4.99, 3, 1, 20]);
    assert.equal(b.verdict.level, "great");
});

test("bundle check from a link: the price site's tiers are used when it knows the bundle", async () => {
    const { db, user, itad } = setup({ tiers: true });
    const out = await bundleLookup({ db, itad, user, query: "https://www.fanatical.com/en/bundle/killer-bundle-30" });
    assert.equal(out.from, "link");
    assert.equal(out.bundles.length, 1);
    assert.deepEqual(out.bundles[0].tiers.map(t => t.price), [1, 4.99]);
});

test("bundle check: an unknown link says so, a Steam game link is treated as a game, empty means the wishlist", async () => {
    const { db, user, itad } = setup();
    await assert.rejects(bundleLookup({ db, itad, user, query: "https://example.com/bundle/nope" }), UserError);
    assert.equal((await bundleLookup({ db, itad, user, query: "https://store.steampowered.com/app/220/" })).from, "game");
    await assert.rejects(bundleLookup({ db, itad, user, query: "" }), UserError, "an empty wishlist has nothing to look for");
});

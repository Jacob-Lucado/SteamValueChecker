import test from "node:test";
import assert from "node:assert/strict";
import { parseProfileInput, resolveVanity, fetchWishlistAppIds, importWishlist, SteamError } from "../src/steam.js";

const res = (body, status = 200) => ({
    ok: status >= 200 && status < 300, status,
    json: async () => body, text: async () => (typeof body === "string" ? body : JSON.stringify(body))
});

test("profile input forms", () => {
    assert.deepEqual(parseProfileInput("76561198000000000"), { steamid: "76561198000000000" });
    assert.deepEqual(parseProfileInput("https://steamcommunity.com/profiles/76561198000000000/wishlist"), { steamid: "76561198000000000" });
    assert.deepEqual(parseProfileInput("https://steamcommunity.com/id/some_name/"), { vanity: "some_name" });
    assert.deepEqual(parseProfileInput("some_name"), { vanity: "some_name" });
    assert.equal(parseProfileInput("https://evil.example/id/x"), null);
    assert.equal(parseProfileInput("a b"), null);
    assert.equal(parseProfileInput(""), null);
});

test("vanity names resolve through the public profile XML", async () => {
    const f = async url => {
        assert.match(String(url), /steamcommunity\.com\/id\/some_name\/\?xml=1/);
        return res("<profile><steamID64>76561198000000000</steamID64></profile>");
    };
    assert.equal(await resolveVanity("some_name", f), "76561198000000000");
    await assert.rejects(() => resolveVanity("x", async () => res("<response><error>not found</error></response>")), e => e.code === "not_found");
});

test("wishlist ids: parsed, deduplicated, and empty/private is explained", async () => {
    const ok = async () => res({ response: { items: [{ appid: 220 }, { appid: 440 }, { appid: 220 }, { appid: "bad" }] } });
    assert.deepEqual(await fetchWishlistAppIds("76561198000000000", ok), [220, 440]);
    await assert.rejects(() => fetchWishlistAppIds("1", async () => res({ response: {} })), e => e.code === "empty" && /Public/.test(e.message));
    await assert.rejects(() => fetchWishlistAppIds("1", async () => res({}, 403)), e => e.code === "private");
    await assert.rejects(() => fetchWishlistAppIds("1", async () => res({}, 429)), e => e.code === "rate_limited");
    await assert.rejects(() => fetchWishlistAppIds("1", async () => { throw new Error("boom"); }), e => e instanceof SteamError && e.code === "network");
});

test("import maps app ids to ITAD games and reports what was left out", async () => {
    const f = async () => res({ response: { items: [{ appid: 220 }, { appid: 440 }, { appid: 999 }] } });
    const itad = {
        lookupShopIds: async (shop, ids) => {
            assert.equal(shop, 61);
            assert.deepEqual(ids, ["app/220", "app/440", "app/999"]);
            return new Map([["app/220", "i220"], ["app/440", "i440"], ["app/999", null]]);
        },
        getTitle: async id => ({ i220: { title: "Half-Life 2" }, i440: { title: "Team Fortress 2" } })[id] ?? null
    };
    const r = await importWishlist("76561198000000000", itad, { fetchImpl: f });
    assert.deepEqual(r.games, [{ itad_id: "i220", title: "Half-Life 2" }, { itad_id: "i440", title: "Team Fortress 2" }]);
    assert.equal(r.unmatched, 1);
    assert.equal(r.truncated, false);
    assert.equal(r.complete, false); // one game could not be matched, so the bot will not prune anything
});

test("import is capped and says so", async () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ appid: i + 1 }));
    const itad = {
        lookupShopIds: async (_s, ids) => new Map(ids.map(x => [x, `i-${x}`])),
        getTitle: async id => ({ title: id })
    };
    const r = await importWishlist("76561198000000000", itad, { fetchImpl: async () => res({ response: { items } }), max: 3 });
    assert.equal(r.games.length, 3);
    assert.equal(r.truncated, true);
    assert.equal(r.complete, false);
});

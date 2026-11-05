import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { parseHumbleList, parseHumbleDetail, parseFanatical, parseIndieGala, parseSteamBundles, fetchAllBundles } from "../src/bundlefeedsource.js";
import { bundleFeedEmbed, runBundleFeed, applyBundleFeedSettings, describeStores } from "../src/bundlefeed.js";
import { TEMPLATE, ADDED_LATER } from "../src/community.js";

const NOW = Date.UTC(2026, 10, 4, 12);
const json = o => `<script id="x" type="application/json">${JSON.stringify(o)}</script>`;
const HUMBLE_LIST = `<html>${json({}).replace('id="x"', 'id="landingPage-json-data"').replace("{}", JSON.stringify({ data: { games: { mosaic: [{ products: [
    { machine_name: "frightfest_bundle", tile_name: "Humble FrightFest Bundle", product_url: "/games/frightfest", high_res_tile_image: "https://hb.imgix.net/a.png", "end_date|datetime": "2026-11-18T18:00:00" },
    { machine_name: "book_bundle", tile_name: "A book bundle", product_url: "/books/stuff" }] }] } } }))}</html>`;
const HUMBLE_DETAIL = `<html>${json({}).replace('id="x"', 'id="webpack-bundle-data"').replace("{}", JSON.stringify({ bundleData: {
    tier_item_data: { a: { human_name: "Alan Wake" }, b: { human_name: "Dead Space" } }, tier_pricing_data: { "1": { "price|money": { amount: 1 } }, "2": { "price|money": { amount: 12 } } } } }))}</html>`;
const STEAM = { results_html: `<a href="https://store.steampowered.com/bundle/4242/Big_Pack/?snr=1" class="search_result_row"><img src="https://shared.akamai.steamstatic.com/b.jpg"><span class="title">Big Pack &amp; More</span>
<div class="discount_pct">-35%</div><div class="discount_final_price">$19.49</div></a><a href="https://store.steampowered.com/app/1/x" class="search_result_row"><span class="title">Not a bundle</span></a>` };

test("humble: the list and a bundle's own page give title, end time, games and tier prices", () => {
    const l = parseHumbleList(HUMBLE_LIST, NOW);
    assert.equal(l.length, 1, "books are not game bundles");
    assert.equal(l[0].key, "humble:frightfest_bundle"); assert.equal(l[0].url, "https://www.humblebundle.com/games/frightfest"); assert.equal(l[0].expiresAt, Date.UTC(2026, 10, 18, 18));
    assert.deepEqual(parseHumbleDetail(HUMBLE_DETAIL), { games: ["Alan Wake", "Dead Space"], price: "$1 / $12" });
    assert.deepEqual(parseHumbleDetail("<p>nope</p>"), { games: [], price: null });
});

test("fanatical, indiegala and steam listings are read into clean records, and junk is skipped", () => {
    const f = parseFanatical({ hits: [{ slug: "resident-evil-bundle", name: "Build Your Own Resident Evil Bundle", cover_image: "x.jpg", display_type: "pick-and-mix", available_valid_until: "2026-11-18T10:00:00Z", games_count: 15 }, { name: "no slug" }] }, NOW);
    assert.equal(f.length, 1); assert.equal(f[0].url, "https://www.fanatical.com/en/bundle/resident-evil-bundle"); assert.equal(f[0].gameCount, 15); assert.equal(f[0].price, "Pick and mix"); assert.match(f[0].image, /^https:\/\/cdn\.fanatical\.com/);
    const i = parseIndieGala(`<a href="/bundle/pixel-traditions-4"><img src="https://img.ig.com/p.jpg" alt="Pixel Traditions Bundle 4"></a><a href="/bundle/pixel-traditions-4">again</a>`, NOW);
    assert.equal(i.length, 1); assert.equal(i[0].title, "Pixel Traditions Bundle 4"); assert.equal(i[0].key, "indiegala:pixel-traditions-4");
    const s = parseSteamBundles(STEAM, NOW);
    assert.equal(s.length, 1); assert.equal(s[0].title, "Big Pack & More"); assert.equal(s[0].price, "$19.49 (35% off)"); assert.equal(s[0].url, "https://store.steampowered.com/bundle/4242/");
});

test("one store being down never hides the others, and the error is reported", async () => {
    const fetchImpl = async url => url.includes("humblebundle.com/bundles") ? { ok: true, text: async () => HUMBLE_LIST } : url.includes("humblebundle.com/games") ? { ok: true, text: async () => HUMBLE_DETAIL }
        : url.includes("steampowered") ? { ok: true, json: async () => STEAM } : { ok: false, status: 503 };
    const r = await fetchAllBundles({ fetchImpl, now: NOW });
    assert.deepEqual(r.complete.sort(), ["humble", "steam"]); assert.equal(r.errors.length, 2);
    assert.deepEqual(r.bundles.find(b => b.store === "humble").games, ["Alan Wake", "Dead Space"]);
    await assert.rejects(fetchAllBundles({ fetchImpl: async () => ({ ok: false, status: 500 }) }), /answered 500/);
});

test("the post: store, price, games, relative end time, and buttons; ended posts go grey without buttons", () => {
    const b = { store: "fanatical", title: "Build Your Own Resident Evil Bundle", url: "https://www.fanatical.com/en/bundle/x", game_count: 15, price: "Pick and mix", games: ["A", "B", "C", "D", "E", "F", "G", "H", "I"], expires_at: NOW + 86400_000, image: "https://i/x.jpg" };
    const p = bundleFeedEmbed(b), e = p.embeds[0];
    assert.match(e.author.name, /Fanatical · new bundle/); assert.equal(e.title, b.title); assert.match(e.description, /15 games/);
    assert.match(e.fields.find(f => f.name === "Featured games").value, /• H\n\*and 7 more\*/); assert.match(e.fields.at(-1).value, /<t:\d+:R>/);
    assert.equal(p.components[0].components.length, 2); assert.equal(e.image.url, b.image);
    const ended = bundleFeedEmbed(b, { expired: true });
    assert.equal(ended.components.length, 0); assert.match(ended.embeds[0].title, /^Ended:/); assert.equal(ended.embeds[0].color, 0x6b7280);
});

function fakeApi() { const sent = [], edits = []; return { sent, edits, sendMessage: async (ch, p) => { sent.push({ ch, p }); return { id: "m" + sent.length }; }, editMessage: async (ch, id, p) => { edits.push({ ch, id, p }); } }; }
const rec = (n, over = {}) => ({ key: `humble:b${n}`, store: "humble", title: "Bundle " + n, url: "https://www.humblebundle.com/games/b" + n, image: null, games: [], gameCount: 5, price: "$1", expiresAt: null, seenAt: NOW, ...over });

test("posting: once per bundle per server, first run is capped, store filters apply, and a bundle that drops off the page is greyed out", async () => {
    const db = openDb(":memory:", { now: () => NOW });
    db.setBundleFeedSettings("g1", { channel_id: "c1" });
    db.setBundleFeedSettings("g2", { channel_id: "c2", stores: ["steam"] });
    const api = fakeApi();
    let list = [1, 2, 3, 4, 5].map(n => rec(n));
    const run = () => runBundleFeed({ db, api, fetchBundles: async () => ({ bundles: list, complete: ["humble"], errors: [] }), now: () => NOW, sleep: async () => {}, pace: 0 });
    let r = await run();
    assert.equal(r.added, 5); assert.equal(api.sent.filter(s => s.ch === "c1").length, 3, "a server's first poll posts only the newest few"); assert.equal(api.sent.filter(s => s.ch === "c2").length, 0, "a Steam-only server gets no Humble bundles");
    r = await run();
    assert.equal(r.posted, 0, "nothing is posted twice, and the rest of the first run stays 'seen'");
    list = [rec(1), rec(2), rec(3), rec(4)]; list.push(rec(9));
    r = await run();
    assert.equal(r.expired, 1, "bundle 5 is no longer listed, so it has ended"); assert.equal(r.posted, 1);
    assert.equal(api.edits.length, 1, "bundle 5 was one of the three posted, so its post is greyed out"); assert.match(api.edits[0].p.embeds[0].title, /^Ended: Bundle 5/);
    list = [rec(1), rec(2), rec(4), rec(9)];
    r = await run();
    assert.equal(api.edits.length, 2); assert.match(api.edits[1].p.embeds[0].title, /^Ended: Bundle 3/);
});

test("a dated bundle ends on its date, and a total read failure still lets the clean-up run", async () => {
    let t = NOW;
    const db = openDb(":memory:", { now: () => t });
    db.setBundleFeedSettings("g1", { channel_id: "c1" });
    const api = fakeApi();
    await runBundleFeed({ db, api, fetchBundles: async () => [rec(1, { expiresAt: NOW + 1000 })], now: () => t, sleep: async () => {}, pace: 0 });
    t = NOW + 5000;
    const r = await runBundleFeed({ db, api, fetchBundles: async () => { throw new Error("all stores down"); }, now: () => t, sleep: async () => {}, pace: 0 });
    assert.equal(r.feedError, "all stores down"); assert.equal(r.expired, 1); assert.equal(api.edits.length, 1);
});

test("settings are validated, and picking every store means no filter", () => {
    const db = openDb(":memory:");
    assert.throws(() => applyBundleFeedSettings(db, "g1", { stores: ["gog"] }), /not a store/);
    assert.deepEqual(applyBundleFeedSettings(db, "g1", { stores: ["humble", "fanatical", "indiegala", "steam"] }).stores, []);
    assert.deepEqual(applyBundleFeedSettings(db, "g1", { stores: ["steam"], channel_id: "c1", role_id: "r1" }), { guild_id: "g1", channel_id: "c1", role_id: "r1", stores: ["steam"] });
    assert.equal(describeStores(["steam", "humble"]), "Steam, Humble Bundle"); assert.equal(describeStores([]), "every store");
});

test("community setup makes a bundles-feed channel and a Bundle pings role, and older servers get them on the next run", () => {
    const chans = TEMPLATE.categories.flatMap(c => c.channels ?? []);
    assert.ok(chans.some(c => c.key === "bundles" && c.name === "bundles-feed" && c.readonly));
    assert.ok(TEMPLATE.selfRoles.some(r => r.name === "Bundle pings")); assert.ok(ADDED_LATER.has("bundles"));
});

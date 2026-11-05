import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureArt, steamArt, resolveArt, resolveUrlArt } from "../src/art.js";

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(400, 1)]);
const img = body => ({ ok: true, status: 200, headers: new Headers({ "content-type": "image/jpeg" }), arrayBuffer: async () => body });

test("art addresses point at our own copy once the site address is known", () => {
    configureArt({ base: null, dir: null });
    assert.match(steamArt(10), /^https:\/\/cdn\.akamai\.steamstatic\.com\/steam\/apps\/10\/header\.jpg$/);
    configureArt({ base: "https://svc.example/", dir: null });
    assert.equal(steamArt(10), "https://svc.example/art/header/10.jpg");
    assert.equal(steamArt(10, "hero"), "https://svc.example/art/hero/10.jpg");
    assert.match(steamArt("x y"), /steamstatic/);
});

test("a game whose art is not on the old path is found through the store record, then kept on disk and in memory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "art-"));
    configureArt({ base: "https://svc.example", dir });
    const asked = [];
    const fetchImpl = async url => {
        asked.push(url);
        if (url.includes("appdetails")) return { ok: true, json: async () => ({ 777001: { data: { header_image: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/777001/abc123/header.jpg?t=1" } } }) };
        return url.includes("abc123") ? img(JPG) : { ok: false, status: 404, headers: new Headers() };
    };
    const a = await resolveArt(777001, "header", { fetchImpl });
    assert.equal(a.type, "image/jpeg"); assert.equal(a.buf.length, JPG.length);
    const before = asked.length;
    await resolveArt(777001, "header", { fetchImpl });
    assert.equal(asked.length, before, "second ask is answered from the saved copy");
    assert.equal(readdirSync(dir).length, 1);
    assert.equal(await resolveArt("12; drop", "header", { fetchImpl }), null);
    assert.equal(await resolveArt(5, "nope", { fetchImpl }), null);
});

test("a game with no art is remembered as missing for a while instead of being asked about every visit", async () => {
    configureArt({ base: null, dir: null });
    let n = 0; const fetchImpl = async () => { n++; return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) }; };
    assert.equal(await resolveArt(888002, "header", { fetchImpl }), null);
    const first = n;
    assert.equal(await resolveArt(888002, "header", { fetchImpl }), null);
    assert.equal(n, first);
});

test("store pictures are only taken from known store hosts, over https", async () => {
    configureArt({ base: null, dir: null });
    const fetchImpl = async () => img(JPG);
    assert.ok(await resolveUrlArt("bundle-1", "https://www.indiegalacdn.com/c.jpg", { fetchImpl }));
    assert.equal(await resolveUrlArt("bundle-2", "https://evil.example/c.jpg", { fetchImpl }), null);
    assert.equal(await resolveUrlArt("bundle-3", "http://hb.imgix.net/c.jpg", { fetchImpl }), null);
    assert.equal(await resolveUrlArt("../x", "https://hb.imgix.net/c.jpg", { fetchImpl }), null);
});

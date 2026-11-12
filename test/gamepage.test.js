import { test } from "node:test";
import assert from "node:assert/strict";
import { renderGamePage, renderWidget, chartSvg, slugify } from "../src/gamepage.js";
import { deckStatus } from "../src/proton.js";

const base = { title: "Hollow <Depths>", appid: "123", itadId: "abc-id", currency: "USD", price: 7.49, shop: "Steam", shopUrl: "https://store.example/x", msrp: 29.99, low1y: 6.99, atl: 5.99,
    image: "https://cdn.example/h.jpg", points: [{ t: 1, price: 30 }, { t: 2, price: 20 }, { t: 3, price: 7.49 }],
    advice: { verdict: "lean_buy", label: "Leaning buy", reasons: ["Cheaper than usual."] } };

test("slugs are lowercase words joined by dashes", () => {
    assert.equal(slugify("Hollow Depths: Gold Edition!"), "hollow-depths-gold-edition");
    assert.equal(slugify("!!!"), "game");
});

test("the page carries the price, verdict, chart and structured data, with the title escaped", () => {
    const html = renderGamePage(base, { origin: "https://svc.test" });
    assert.match(html, /<title>Hollow &lt;Depths&gt; price history/);
    assert.match(html, /\$7\.49/);
    assert.match(html, /-75%/);
    assert.match(html, /Leaning buy/);
    assert.match(html, /<svg viewBox/);
    assert.match(html, /rel="canonical" href="https:\/\/svc\.test\/game\/123-hollow-depths"/);
    assert.match(html, /"@type":"Product"/);
    assert.ok(!html.includes("<Depths>"));
    assert.match(html, /\/#\/g\/abc-id/);
});

test("a game with no price still renders and the chart needs two points", () => {
    const html = renderGamePage({ ...base, price: null, shop: null, shopUrl: null, advice: null, points: [] }, { origin: "https://svc.test" });
    assert.match(html, /No price right now/);
    assert.ok(!html.includes("<svg"));
    assert.equal(chartSvg([{ t: 1, price: 1 }]), "");
});

test("Steam Deck and ProtonDB badges show only when known", () => {
    const html = renderGamePage({ ...base, compat: { deck: "verified", proton: "platinum" } }, { origin: "https://svc.test" });
    assert.match(html, /Steam Deck Verified/); assert.match(html, /ProtonDB: Platinum/);
    assert.ok(!renderGamePage({ ...base, compat: { deck: null, proton: null } }, { origin: "https://svc.test" }).includes("class=\"compat\""));
    assert.ok(!renderGamePage({ ...base, compat: { deck: "<script>", proton: "x" } }, { origin: "https://svc.test" }).includes("<div class=\"compat\">"));
});
test("the embed snippet is on the page and the widget is a small escaped card", () => {
    const page = renderGamePage(base, { origin: "https://svc.test" });
    assert.match(page, /&lt;iframe src=&quot;https:\/\/svc\.test\/widget\/123&quot;/);
    const w = renderWidget(base, { origin: "https://svc.test", theme: "transparent" });
    assert.match(w, /\$7\.49/); assert.match(w, /-75%/); assert.match(w, /Hollow &lt;Depths&gt;/); assert.match(w, /background:transparent/);
    assert.ok(!w.includes("<Depths>")); assert.match(w, /http-equiv="refresh"/);
});
test("Deck status reads Valve's answer and stays quiet on failure", async () => {
    const ok = n => async () => ({ ok: true, json: async () => ({ results: { resolved_category: n } }) });
    assert.equal(await deckStatus(111, { fetchFn: ok(3) }), "verified");
    assert.equal(await deckStatus(112, { fetchFn: ok(2) }), "playable");
    assert.equal(await deckStatus(113, { fetchFn: ok(0) }), null);
    assert.equal(await deckStatus(114, { fetchFn: async () => { throw new Error("down"); } }), null);
    assert.equal(await deckStatus("x"), null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderGamePage, chartSvg, slugify } from "../src/gamepage.js";

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

import test from "node:test";
import assert from "node:assert/strict";
import { historySvg, renderHistoryChart } from "../src/historychart.js";

const DAY = 86400_000, T = Date.parse("2026-11-01T00:00:00Z");
const pts = [[-300, 29.99], [-200, 14.99], [-120, 29.99], [-60, 7.49], [-20, 29.99], [-3, 19.99]].map(([d, price]) => ({ t: T + d * DAY, price }));

test("history chart: a step line with the lowest and current price named, and a real picture out", () => {
    const svg = historySvg({ title: "Hades & <Friends>", points: pts, currency: "USD", now: 19.99, at: T });
    assert.match(svg, /lowest \$7\.49/); assert.match(svg, /now \$19\.99/); assert.match(svg, /Hades &amp; &lt;Friends&gt;/, "the title is escaped");
    assert.ok(svg.includes(" H") && svg.includes(" V"), "steps, not slopes");
    const png = renderHistoryChart({ title: "Hades", points: pts, now: 19.99, at: T });
    assert.equal(png.subarray(1, 4).toString(), "PNG");
});
test("history chart: too little history draws nothing instead of a broken picture", () => {
    assert.equal(historySvg({ title: "x", points: [pts[0]] }), null);
    assert.equal(historySvg({ title: "x", points: [] }), null);
    assert.equal(renderHistoryChart({ title: "x", points: null }), null);
});

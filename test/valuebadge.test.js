import test from "node:test";
import assert from "node:assert/strict";
import { valueBadgeSvg } from "../src/valuebadge.js";

test("value badge: shows the numbers and escapes the name", () => {
    const svg = valueBadgeSvg({ name: `<b>"Jake"</b>`, games: 1234, worth: 4800.6, paid: 900, saved: 1100 });
    assert.match(svg, /^<svg /);
    assert.match(svg, /\$4,801/); assert.match(svg, /\$900/); assert.match(svg, /\$1,100/); assert.match(svg, /1,234 games/);
    assert.ok(!svg.includes("<b>"), "the name can't add markup");
});

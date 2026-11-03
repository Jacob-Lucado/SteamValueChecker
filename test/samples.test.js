import test from "node:test";
import assert from "node:assert/strict";
import { sampleAlert, SAMPLE_KINDS } from "../src/samples.js";

test("every sample kind builds a message that says it is a sample and has something to show", () => {
    for (const kind of SAMPLE_KINDS) {
        const p = sampleAlert(kind);
        assert.ok(p, kind); assert.match(p.content, /Sample alert/); assert.ok(p.embeds.length >= 1, kind);
        for (const e of p.embeds) assert.ok(e.title && e.title.length <= 256, kind);
    }
    assert.equal(sampleAlert("nope"), null);
});

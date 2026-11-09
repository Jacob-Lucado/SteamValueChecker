import test from "node:test";
import assert from "node:assert/strict";
import { createCommandWatch, HEAVY_PER_HOUR } from "../src/cmdwatch.js";

test("busiest users are ranked, flagged past the hourly limit and forgotten after a day", () => {
    let t = Date.UTC(2026, 10, 5, 12);
    const w = createCommandWatch({ now: () => t });
    for (let i = 0; i < HEAVY_PER_HOUR; i++) w.note("loud", "play");
    w.note("loud", "me wishlist"); w.note("quiet", "vote");
    const r = w.report();
    assert.equal(r.rows[0].id, "loud");
    assert.equal(r.rows[0].heavy, true);
    assert.match(r.rows[0].top, /play ×60/);
    assert.equal(r.rows[1].heavy, false);
    t += 2 * 3600_000;
    const later = w.report();
    assert.equal(later.rows[0].hour, 0);
    assert.equal(later.rows[0].day, HEAVY_PER_HOUR + 1, "still counted in the day total");
    t += 25 * 3600_000; w.note("new", "x");
    assert.deepEqual(w.report().rows.map(x => x.id), ["new"]);
});

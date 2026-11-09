import test from "node:test";
import assert from "node:assert/strict";
import { createOps } from "../src/ops.js";
import { runWatchdog, SPIKE_PER_HOUR } from "../src/watchdog.js";

const rig = () => { const sent = []; const ops = createOps({ sendOwner: async m => { sent.push(m); } }); return { ops, sent }; };

test("a nearly full disk and an error burst each DM the owner once", async () => {
    const { ops, sent } = rig();
    const now = Date.UTC(2026, 10, 8, 12);
    const lines = Array.from({ length: SPIKE_PER_HOUR }, (_, i) => ({ at: now - i * 1000, text: "[music] Lost connection to 1234567890123" }));
    const deps = { ops, now: () => now, storage: async () => ({ volume: { pct: 91, usedMb: 1820, totalMb: 2000 } }), logs: { recent: () => lines } };
    const r = await runWatchdog(deps);
    assert.deepEqual(r.alerted, ["disk", "errors"]);
    assert.match(sent[0], /91% full/);
    assert.match(sent[1], /music: Lost connection to #/);
    assert.deepEqual((await runWatchdog(deps)).alerted, [], "held back for a few hours");
});

test("a healthy disk and a quiet log say nothing", async () => {
    const { ops, sent } = rig();
    const now = Date.UTC(2026, 10, 8, 12);
    const r = await runWatchdog({ ops, now: () => now, storage: async () => ({ volume: { pct: 40 } }), logs: { recent: () => [{ at: now - 7200_000, text: "old" }] } });
    assert.deepEqual(r.alerted, []); assert.equal(sent.length, 0); assert.equal(r.errorsLastHour, 0);
    await runWatchdog({ ops, now: () => now, storage: async () => { throw new Error("no statfs"); }, logs: null });
});

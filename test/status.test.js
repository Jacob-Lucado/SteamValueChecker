import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createStatusMonitor } from "../src/status.js";

const MIN = 60_000;
test("status monitor: tallies uptime, logs changes, counts offline gaps as downtime", async () => {
    const db = openDb(":memory:");
    let t = Date.parse("2026-10-26T12:00:00Z"), gw = "operational", pr = "operational";
    const probes = {
        gateway: { name: "Gateway", desc: "d", critical: true, check: () => ({ state: gw }) },
        prices: { name: "Prices", desc: "d", critical: false, check: () => ({ state: pr, detail: pr === "degraded" ? "rate limited" : null }) }
    };
    const m = createStatusMonitor({ db, probes, now: () => t });
    await m.tick();
    assert.equal(m.snapshot().overall, "operational");
    t += MIN; pr = "degraded"; await m.tick();
    assert.equal(m.snapshot().overall, "degraded");
    t += MIN; gw = "down"; await m.tick();
    assert.equal(m.snapshot().overall, "down");
    assert.deepEqual(m.snapshot().incidents.map(e => [e.component, e.state]).reverse(), [["prices", "degraded"], ["gateway", "down"]]);
    t += MIN; gw = "operational"; await m.tick();
    // the process was off for 10 minutes
    t += 10 * MIN; await m.tick();
    const snap = m.snapshot();
    assert.ok(snap.incidents.some(e => e.component === "bot" && /Offline/.test(e.note)));
    const today = snap.uptime.days.at(-1);
    assert.ok(today.pct < 100 && today.pct > 0);
    assert.equal(snap.uptime.days.length, 90);
    assert.equal(snap.uptime.days[0].pct, null);
    assert.ok(snap.uptime.pct90 > 0);
});

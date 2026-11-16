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

test("owner is told once when something stays broken, and once when it recovers", async () => {
    const db = openDb(":memory:");
    let t = Date.parse("2026-10-26T12:00:00Z"), state = "operational";
    const told = [];
    const m = createStatusMonitor({ db, now: () => t, notify: x => told.push(x), alertAfterTicks: 3,
        probes: { prices: { name: "Price data", desc: "d", critical: false, check: () => ({ state, detail: state === "down" ? "rate_limited" : null }) } } });
    await m.tick();
    state = "down";
    for (let n = 0; n < 5; n++) { t += MIN; await m.tick(); }
    assert.equal(told.length, 1);
    assert.match(told[0], /Price data has been down for 3 minutes: rate_limited/);
    state = "operational"; t += MIN; await m.tick();
    assert.equal(told.length, 2);
    assert.match(told[1], /back to normal/);
    t += 20 * MIN; await m.tick(); // the process was off
    assert.match(told[2], /offline for about/);
});

test("a service that is only degraded doesn't ping the owner for short blips, and isn't repeated for hours", async () => {
    const db = openDb(":memory:");
    let t = Date.parse("2026-10-26T12:00:00Z"), state = "operational";
    const told = [];
    const m = createStatusMonitor({ db, now: () => t, notify: x => told.push(x),
        probes: { prices: { name: "Price data", desc: "d", critical: false, check: () => ({ state, detail: state === "degraded" ? "rate_limited" : null }) } } });
    await m.tick();
    state = "degraded";
    for (let n = 0; n < 10; n++) { t += MIN; await m.tick(); }       // a ten minute blip: nothing
    state = "operational"; t += MIN; await m.tick();
    assert.deepEqual(told, []);
    state = "degraded";
    for (let n = 0; n < 20; n++) { t += MIN; await m.tick(); }       // twenty minutes in a row: one warning
    assert.equal(told.length, 1);
    state = "operational"; t += MIN; await m.tick();
    assert.equal(told.length, 2);                                      // and the recovery
    state = "degraded";
    for (let n = 0; n < 30; n++) { t += MIN; await m.tick(); }       // again within hours: quiet
    state = "operational"; t += MIN; await m.tick();
    assert.equal(told.length, 2);
    for (let n = 0; n < 7 * 60; n++) { t += MIN; await m.tick(); }       // hours of quiet
    state = "degraded";                                                  // much later it can speak up again
    for (let n = 0; n < 20; n++) { t += MIN; await m.tick(); }
    assert.equal(told.length, 3);
});

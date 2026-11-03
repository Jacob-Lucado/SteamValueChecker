import test from "node:test";
import assert from "node:assert/strict";
import { createOps } from "../src/ops.js";

test("jobs: a good run is recorded with its counts, a failure is kept and does not throw", async () => {
    let t = 1000; const ops = createOps({ now: () => t });
    assert.deepEqual(await ops.job("news", async () => { t += 250; return { found: 3, delivered: 2, secret: "x" }; }), { found: 3, delivered: 2, secret: "x" });
    assert.equal(await ops.job("free games", async () => { throw Object.assign(new Error("boom"), { code: "ETIMEDOUT" }); }), undefined);
    const jobs = ops.snapshot().jobs;
    assert.equal(jobs.news.ms, 250); assert.deepEqual(jobs.news.detail, { found: 3, delivered: 2 }); assert.equal(jobs.news.lastError, null);
    assert.equal(jobs["free games"].failures, 1); assert.equal(jobs["free games"].lastError, "ETIMEDOUT"); assert.equal(jobs["free games"].lastOk, null);
    assert.equal(ops.snapshot().errors[0].where, "free games");
    await ops.job("free games", async () => ({}));
    assert.equal(ops.snapshot().jobs["free games"].lastError, null, "a later good run clears the error");
});
test("jobs: the price check and the backup show up too", async () => {
    const ops = createOps({ now: () => 5 });
    await ops.cycleDone({ checked: 4, alerts: 1, delivered: 1, failed: 0, priceErrors: 0 });
    await ops.backupDone({ file: "x" });
    const j = ops.snapshot().jobs; assert.equal(j["price check"].detail.checked, 4); assert.equal(j.backup.runs, 1);
});

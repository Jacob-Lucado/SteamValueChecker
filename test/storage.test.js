import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storageReport } from "../src/storage.js";

test("storage report sizes the database, backups and volume", async () => {
    const dir = mkdtempSync(join(tmpdir(), "svc-st-"));
    writeFileSync(join(dir, "a.db"), Buffer.alloc(2 * 1048576));
    writeFileSync(join(dir, "b1.db"), Buffer.alloc(1048576));
    const r = await storageReport({ dbPath: join(dir, "a.db"), backupDir: dir, db: { tableSizes: () => [{ name: "users", bytes: 3145728 }] } });
    assert.equal(r.dbMb, 2);
    assert.equal(r.walMb, 0);
    assert.equal(r.tables[0].mb, 3);
    assert.ok(r.volume.totalMb > 0 && r.volume.pct >= 0 && r.volume.pct <= 100);
    const none = await storageReport({ dbPath: join(dir, "nope.db"), backupDir: join(dir, "zz") });
    assert.equal(none.dbMb, 0); assert.deepEqual(none.tables, []);
});

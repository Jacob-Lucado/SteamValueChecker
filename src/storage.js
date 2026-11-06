// How full the disk is and what is using it, for the admin System page. Reads sizes only; it never changes or deletes anything.
import { statfs, stat, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";

const MB = 1048576;
const size = async f => { try { return (await stat(f)).size; } catch { return 0; } };
const mb = n => Math.round(n / MB * 10) / 10;

export async function storageReport({ dbPath, backupDir, db }) {
    const out = { volume: null, dbMb: 0, walMb: 0, backupsMb: 0, backupCount: 0, tables: [] };
    try {
        const s = await statfs(dirname(dbPath)), total = s.blocks * s.bsize, free = s.bavail * s.bsize;
        out.volume = { totalMb: mb(total), usedMb: mb(total - free), freeMb: mb(free), pct: total ? Math.round((total - free) / total * 100) : 0 };
    } catch { /* an unusual host: the other numbers still show */ }
    out.dbMb = mb(await size(dbPath));
    out.walMb = mb(await size(dbPath + "-wal"));
    try {
        const names = await readdir(backupDir);
        let sum = 0;
        for (const n of names) { const z = await size(join(backupDir, n)); if (z) { sum += z; out.backupCount++; } }
        out.backupsMb = mb(sum);
    } catch { /* no backup folder yet */ }
    out.tables = (db?.tableSizes?.(9) ?? []).filter(t => t.name !== "sqlite_schema").slice(0, 8).map(t => ({ name: t.name, mb: mb(t.bytes) }));
    return out;
}

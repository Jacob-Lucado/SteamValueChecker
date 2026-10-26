// Daily copy of the SQLite database. Backups hold the same personal data as the database, so treat them the same way.
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const NAME = /^steamvaluechecker-\d{4}-\d{2}-\d{2}\.db$/;

/** Writes today's backup if there is not one yet, then deletes the oldest beyond `keep`. */
export function runBackup({ db, dir, keep = 7, now = () => Date.now() }) {
    const day = new Date(now()).toISOString().slice(0, 10);
    const file = join(dir, `steamvaluechecker-${day}.db`);
    if (existsSync(file)) return { skipped: true, file };
    db.backupTo(file);
    const old = readdirSync(dir).filter(n => NAME.test(n)).sort();
    const removed = [];
    while (old.length > Math.max(1, keep)) {
        const n = old.shift();
        try { unlinkSync(join(dir, n)); removed.push(n); } catch { /* leave it for the next run */ }
    }
    return { skipped: false, file, removed: removed.length };
}

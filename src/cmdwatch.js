// Who is running the most commands, so the owner can spot someone hammering the bot. Counts live in memory (hourly buckets for
// the last day) and start fresh on a restart. It records who and which command, never what was typed.
const HOUR = 3600_000, KEEP_HOURS = 24;
export const HEAVY_PER_HOUR = 60;

export function createCommandWatch({ now = () => Date.now() } = {}) {
    const buckets = new Map(); // hour number -> Map(userId -> Map(command -> count))
    const hourOf = t => Math.floor(t / HOUR);

    function note(userId, command) {
        if (!userId) return;
        const hr = hourOf(now());
        let users = buckets.get(hr);
        if (!users) {
            users = new Map(); buckets.set(hr, users);
            for (const k of buckets.keys()) if (k <= hr - KEEP_HOURS) buckets.delete(k);
        }
        let cmds = users.get(userId);
        if (!cmds) { cmds = new Map(); users.set(userId, cmds); }
        cmds.set(command, (cmds.get(command) ?? 0) + 1);
    }

    function report({ limit = 10 } = {}) {
        const hr = hourOf(now()), perUser = new Map();
        for (const [h, users] of buckets) {
            if (h <= hr - KEEP_HOURS) continue;
            for (const [id, cmds] of users) {
                const u = perUser.get(id) ?? { id, hour: 0, day: 0, cmds: new Map() };
                for (const [c, n] of cmds) { u.day += n; if (h === hr) u.hour += n; u.cmds.set(c, (u.cmds.get(c) ?? 0) + n); }
                perUser.set(id, u);
            }
        }
        const rows = [...perUser.values()].map(u => ({ id: u.id, hour: u.hour, day: u.day, top: [...u.cmds].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${c} ×${n}`).join(", "), heavy: u.hour >= HEAVY_PER_HOUR }));
        return { threshold: HEAVY_PER_HOUR, rows: rows.sort((a, b) => b.hour - a.hour || b.day - a.day).slice(0, limit) };
    }

    return { note, report };
}

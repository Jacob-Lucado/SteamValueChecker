// Small capped lists the admin pages show (server joins, data requests, recent votes). Kept in status_meta as JSON,
// newest first. They hold counts and times, never message text, and deleting a person's data doesn't need to touch them.
export function pushEvent(db, key, entry, max = 100) {
    let list = readEvents(db, key);
    list.unshift(entry);
    if (list.length > max) list = list.slice(0, max);
    db.setMeta(key, JSON.stringify(list));
}

/** Remembers something that failed quietly (a DM that couldn't send, an X post that errored) so the admin Problems panel can show it. */
export function recordProblem(db, where, message) {
    try { pushEvent(db, "adminlog:problems", { where, message: String(message ?? "").slice(0, 200), at: Date.now() }, 60); } catch { /* never let bookkeeping break the thing being logged */ }
}

export function readEvents(db, key, limit = 100) {
    try {
        const v = JSON.parse(db.getMeta(key) || "[]");
        return Array.isArray(v) ? v.slice(0, limit) : [];
    } catch { return []; }
}

/** Boils log lines down to "this kind of error, this many times, last seen then" so one noisy problem doesn't bury the rest. */
export function groupErrors(lines, max = 12) {
    const groups = new Map();
    for (const l of lines) {
        const text = String(l.text ?? "").split("\n")[0];
        const tag = /^\[([^\]]{1,40})\]/.exec(text)?.[1] ?? "other";
        const rest = text.replace(/^\[[^\]]*\]\s*/, "").replace(/\b\d{5,}\b/g, "#").replace(/0x[0-9a-f]+/gi, "#").slice(0, 90);
        const key = tag + "|" + rest;
        const g = groups.get(key) ?? { where: tag, message: rest || text.slice(0, 90), count: 0, first: l.at, last: l.at };
        g.count++; g.first = Math.min(g.first, l.at); g.last = Math.max(g.last, l.at);
        groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => b.count - a.count || b.last - a.last).slice(0, max);
}

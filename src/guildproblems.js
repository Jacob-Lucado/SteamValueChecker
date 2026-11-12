// Things the bot tried to do in a server and couldn't (usually a missing permission or a role set above the bot's own).
// They are kept per server, a few at a time, and shown on the dashboard's Community page so a server owner finds out why something is quiet.
const MAX = 12, THROTTLE_MS = 60_000;
const recent = new Map(); // `${guildId}:${key}` -> last time it was written, so a busy server doesn't write on every failure

/** A plain-English reason for a Discord error. */
export function whyFailed(err) {
    const s = Number(err?.status ?? err?.code ?? 0);
    if (s === 403 || s === 50013 || s === 50001) return "I'm missing a permission there, or my role sits below the one involved. Move my role up in Server Settings, Roles.";
    if (s === 404 || s === 10003 || s === 10011) return "That channel or role no longer exists. Pick a new one in the settings.";
    if (s === 429) return "Discord asked me to slow down.";
    return String(err?.message ?? "Discord didn't accept it.").slice(0, 160);
}

const read = (db, guildId) => { try { const v = JSON.parse(db.getMeta(`gprob:${guildId}`) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };

/** Notes one failure. `key` groups repeats ("autorole"), `what` is what the bot was doing ("give new members the auto role"). Never throws. */
export function reportProblem(db, guildId, key, what, err = null, now = Date.now()) {
    try {
        if (!guildId || !db?.setMeta) return;
        const id = `${guildId}:${key}`, was = recent.get(id) ?? 0;
        if (now - was < THROTTLE_MS) return;
        recent.set(id, now);
        if (recent.size > 5000) recent.clear();
        const list = read(db, guildId), hit = list.find(p => p.key === key);
        const entry = { key, what: String(what).slice(0, 120), why: whyFailed(err), at: now, count: (hit?.count ?? 0) + 1 };
        db.setMeta(`gprob:${guildId}`, JSON.stringify([entry, ...list.filter(p => p.key !== key)].slice(0, MAX)));
    } catch { /* keeping notes must never get in the way */ }
}
/** A .catch() handler that notes the failure and carries on. */
export const noteFailure = (db, guildId, key, what) => err => { reportProblem(db, guildId, key, what, err); };

export const listProblems = (db, guildId) => read(db, guildId);
export function clearProblems(db, guildId, key = null) {
    const list = read(db, guildId), keep = key ? list.filter(p => p.key !== key) : [];
    if (keep.length) db.setMeta(`gprob:${guildId}`, JSON.stringify(keep)); else db.setMeta(`gprob:${guildId}`, "[]");
    for (const k of [...recent.keys()]) if (k.startsWith(`${guildId}:`) && (!key || k === `${guildId}:${key}`)) recent.delete(k);
    return keep.length;
}

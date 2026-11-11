// Keeps track of how the bot is doing and tells the owner when something keeps failing.
// The owner message goes out at most once per kind of problem every few hours, so a long outage is one DM, not hundreds.

export const THROTTLE_MS = 6 * 3600_000;
export const FAILURES_BEFORE_ALERT = 3;

export function createOps({ now = () => Date.now(), sendOwner = async () => {}, throttleMs = THROTTLE_MS } = {}) {
    const state = { startedAt: now(), cycle: null, maintenance: null, backup: null, errors: [], priceFailStreak: 0, jobs: {} };
    const lastSent = new Map();

    async function incident(key, message) {
        if (now() - (lastSent.get(key) ?? -Infinity) < throttleMs) return false;
        lastSent.set(key, now());
        try { await sendOwner(message); } catch { /* the owner may have DMs closed; the admin page still shows it */ }
        return true;
    }

    function error(where, err) {
        state.errors.unshift({ at: now(), where, message: String(err?.code ?? err?.message ?? err).slice(0, 200) });
        state.errors.length = Math.min(state.errors.length, 20);
    }

    // The numbers worth showing from a job's result: counts only, never anything about a person.
    const DETAIL = ["checked", "found", "alerts", "delivered", "failed", "deferred", "early", "skipped"];
    const detailOf = r => {
        if (!r || typeof r !== "object") return null;
        const d = {};
        for (const k of DETAIL) if (Number.isFinite(r[k])) d[k] = r[k];
        if (r.error) d.error = String(r.error).slice(0, 80);
        return Object.keys(d).length ? d : null;
    };

    return {
        incident,
        error,

        /** Runs one background job, remembers when it ran, how long it took and whether it failed. A failure is logged here, so callers just use the result. */
        async job(name, fn) {
            const t0 = now(), j = state.jobs[name] ?? (state.jobs[name] = { runs: 0, failures: 0, lastRun: null, lastOk: null, ms: null, lastError: null, detail: null });
            try {
                const r = await fn();
                j.runs++; j.lastRun = j.lastOk = now(); j.ms = now() - t0; j.lastError = r && r.error ? String(r.error).slice(0, 120) : null; j.detail = detailOf(r);
                return r;
            } catch (err) {
                j.runs++; j.failures++; j.lastRun = now(); j.ms = now() - t0; j.lastError = String(err?.code ?? err?.message ?? err).slice(0, 120);
                error(name, err);
                return undefined;
            }
        },

        /** Call with the result of each price check. */
        async cycleDone(stats) {
            state.cycle = { at: now(), ...stats };
            const j = state.jobs["price check"] ?? (state.jobs["price check"] = { runs: 0, failures: 0, lastRun: null, lastOk: null, ms: null, lastError: null, detail: null });
            j.runs++; j.lastRun = now(); j.detail = detailOf(stats);
            if (stats.priceErrors > 0) { j.failures++; j.lastError = String(stats.lastErrorCode ?? "price lookup failed"); } else { j.lastOk = now(); j.lastError = null; }
            if (stats.lastErrorCode === "auth") {
                error("prices", "auth");
                await incident("itad-auth", "Steam Value Checker: IsThereAnyDeal rejected the API key. Check ITAD_API_KEY. No price alerts can be sent until it is fixed.");
            }
            if (stats.priceErrors > 0) {
                state.priceFailStreak++;
                error("prices", stats.lastErrorCode ?? "price lookup failed");
                if (state.priceFailStreak >= FAILURES_BEFORE_ALERT) {
                    await incident("prices", `Steam Value Checker: price checks have failed ${state.priceFailStreak} times in a row (last error: ${stats.lastErrorCode ?? "unknown"}).`);
                }
            } else state.priceFailStreak = 0;
            if (stats.delivered === 0 && stats.failed - (stats.unreachable ?? 0) >= 5) {
                error("delivery", `${stats.failed - (stats.unreachable ?? 0)} alerts not delivered`);
                await incident("delivery", `Steam Value Checker: ${stats.failed - (stats.unreachable ?? 0)} alerts could not be delivered in the last check and none got through. The bot may have lost permission to post, or Discord may be having trouble.`);
            }
        },

        async cycleThrew(err) {
            const j = state.jobs["price check"] ?? (state.jobs["price check"] = { runs: 0, failures: 0, lastRun: null, lastOk: null, ms: null, lastError: null, detail: null });
            j.runs++; j.failures++; j.lastRun = now(); j.lastError = String(err?.message ?? err).slice(0, 120);
            state.priceFailStreak++;
            error("cycle", err);
            if (state.priceFailStreak >= FAILURES_BEFORE_ALERT) {
                await incident("cycle", `Steam Value Checker: the alert check crashed ${state.priceFailStreak} times in a row (${err?.name ?? "error"}: ${String(err?.message ?? "").slice(0, 150)}).`);
            }
        },

        maintenanceDone(info) { state.maintenance = { at: now(), ...info }; },

        async backupDone(result, err) {
            const j = state.jobs["backup"] ?? (state.jobs["backup"] = { runs: 0, failures: 0, lastRun: null, lastOk: null, ms: null, lastError: null, detail: null });
            j.runs++; j.lastRun = now();
            if (err) j.failures++, j.lastError = String(err.message ?? err).slice(0, 120); else j.lastOk = now(), j.lastError = null;
            if (err) {
                state.backup = { at: now(), ok: false, error: String(err.message ?? err).slice(0, 200) };
                error("backup", err);
                await incident("backup", `Steam Value Checker: the daily database backup failed (${state.backup.error}).`);
            } else state.backup = { at: now(), ok: true, ...result };
        },

        snapshot: () => JSON.parse(JSON.stringify(state))
    };
}

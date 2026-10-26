// Keeps track of how the bot is doing and tells the owner when something keeps failing.
// The owner message goes out at most once per kind of problem every few hours, so a long outage is one DM, not hundreds.

export const THROTTLE_MS = 6 * 3600_000;
export const FAILURES_BEFORE_ALERT = 3;

export function createOps({ now = () => Date.now(), sendOwner = async () => {}, throttleMs = THROTTLE_MS } = {}) {
    const state = { startedAt: now(), cycle: null, maintenance: null, backup: null, errors: [], priceFailStreak: 0 };
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

    return {
        incident,
        error,

        /** Call with the result of each price check. */
        async cycleDone(stats) {
            state.cycle = { at: now(), ...stats };
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
            if (stats.delivered === 0 && stats.failed >= 5) {
                error("delivery", `${stats.failed} alerts not delivered`);
                await incident("delivery", `Steam Value Checker: ${stats.failed} alerts could not be delivered in the last check and none got through. Members may have DMs closed with no alert channel set, or the bot lost permission to post.`);
            }
        },

        async cycleThrew(err) {
            state.priceFailStreak++;
            error("cycle", err);
            if (state.priceFailStreak >= FAILURES_BEFORE_ALERT) {
                await incident("cycle", `Steam Value Checker: the alert check crashed ${state.priceFailStreak} times in a row (${err?.name ?? "error"}: ${String(err?.message ?? "").slice(0, 150)}).`);
            }
        },

        maintenanceDone(info) { state.maintenance = { at: now(), ...info }; },

        async backupDone(result, err) {
            if (err) {
                state.backup = { at: now(), ok: false, error: String(err.message ?? err).slice(0, 200) };
                error("backup", err);
                await incident("backup", `Steam Value Checker: the daily database backup failed (${state.backup.error}).`);
            } else state.backup = { at: now(), ok: true, ...result };
        },

        snapshot: () => JSON.parse(JSON.stringify(state))
    };
}

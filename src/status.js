// Status page data: live component checks, a 90 day uptime history, and a log of what changed.
// Every minute the monitor runs its probes, adds one minute to today's tally and logs any state change. If the bot was
// not running (a restart, a crash, a deploy) the gap since the last run is counted as downtime, so the history is honest.

const DAY_MS = 86400_000;
const dayKey = ms => new Date(ms).toISOString().slice(0, 10);
const RANK = { operational: 0, degraded: 1, down: 2 };

/** probes: { id: { name, desc, critical, check: () => { state, detail } | Promise } } */
export function createStatusMonitor({ db, probes, now = () => Date.now(), intervalMs = 60_000, log = () => {}, notify = null, alertAfterTicks = 3 }) {
    let current = new Map(); // id -> { state, detail }
    const trouble = new Map(); // id -> { since, ticks, told } while a component is not operational
    let checkedAt = null;
    let timer = null;

    async function runProbes() {
        const out = new Map();
        for (const [id, p] of Object.entries(probes)) {
            try { const r = await p.check(); out.set(id, { state: r.state, detail: r.detail ?? null }); }
            catch (err) { out.set(id, { state: "down", detail: err?.message?.slice(0, 120) ?? "check failed" }); }
        }
        return out;
    }

    const tell = text => { try { Promise.resolve(notify?.(text)).catch(() => {}); } catch { /* a failed notice must never stop monitoring */ } };

    async function tick() {
        const t = now();
        // Time the monitor was not running counts as down.
        const last = Number(db.getMeta("last_run")) || null;
        if (last && t - last > intervalMs * 2.5) {
            const missing = Math.min(Math.round((t - last) / intervalMs) - 1, 1440 * 3);
            const perDay = new Map();
            for (let n = 1; n <= missing; n++) { const k = dayKey(last + n * intervalMs); perDay.set(k, (perDay.get(k) ?? 0) + 1); }
            for (const [k, mins] of perDay) db.uptimeAdd(k, 0, mins);
            db.addStatusEvent(t, "bot", "down", `Offline for about ${missing} minute${missing === 1 ? "" : "s"}`);
            if (missing >= 5) tell(`The bot was offline for about ${missing} minutes and is back up now.`);
        }
        const next = await runProbes();
        for (const [id, r] of next) {
            const before = current.get(id)?.state;
            if (before !== undefined && before !== r.state) db.addStatusEvent(t, id, r.state, r.detail);
        }
        // Tell the owner once when something has stayed broken for a few checks in a row, and once when it recovers.
        for (const [id, r] of next) {
            const tr = trouble.get(id);
            if (r.state === "operational") {
                if (tr?.told) tell(`✅ ${probes[id].name} is back to normal after about ${Math.max(1, Math.round((t - tr.since) / 60_000))} minutes.`);
                trouble.delete(id);
            } else {
                const cur = tr ?? { since: t, ticks: 0, told: false };
                cur.ticks++;
                if (!cur.told && cur.ticks >= alertAfterTicks) { cur.told = true; tell(`⚠️ ${probes[id].name} has been ${r.state === "down" ? "down" : "degraded"} for ${cur.ticks} minutes${r.detail ? `: ${r.detail}` : ""}.`); }
                trouble.set(id, cur);
            }
        }
        current = next;
        checkedAt = t;
        const up = [...next].every(([id, r]) => !probes[id].critical || r.state !== "down");
        db.uptimeAdd(dayKey(t), up ? 1 : 0, 1);
        db.setMeta("last_run", t);
    }

    function overall() {
        const worst = Math.max(0, ...[...current.values()].map(r => RANK[r.state] ?? 0));
        const critDown = Object.entries(probes).some(([id, p]) => p.critical && current.get(id)?.state === "down");
        return critDown ? "down" : worst >= 1 ? "degraded" : "operational";
    }

    function history(days = 90) {
        const t = now();
        const rows = new Map(db.uptimeDays(dayKey(t - (days - 1) * DAY_MS)).map(r => [r.day, r]));
        const out = [];
        for (let n = days - 1; n >= 0; n--) {
            const k = dayKey(t - n * DAY_MS), r = rows.get(k);
            out.push({ day: k, pct: r && r.total ? Math.round((r.up / r.total) * 10000) / 100 : null });
        }
        const pct = list => {
            const have = list.filter(d => d.pct !== null);
            if (!have.length) return null;
            const weights = new Map(rows);
            let up = 0, total = 0;
            for (const d of have) { const r = weights.get(d.day); up += r.up; total += r.total; }
            return total ? Math.round((up / total) * 10000) / 100 : null;
        };
        return { days: out, pct90: pct(out), pct30: pct(out.slice(-30)) };
    }

    function snapshot() {
        return {
            overall: overall(), checkedAt,
            components: Object.entries(probes).map(([id, p]) => ({ id, name: p.name, desc: p.desc, state: current.get(id)?.state ?? "unknown", detail: current.get(id)?.detail ?? null })),
            uptime: history(), incidents: db.statusEvents(15)
        };
    }

    return {
        start: async () => { try { await tick(); } catch (err) { log(`status check failed: ${err.message}`); } timer = setInterval(() => tick().catch(err => log(`status check failed: ${err.message}`)), intervalMs); timer.unref?.(); },
        stop: () => clearInterval(timer), tick, snapshot
    };
}

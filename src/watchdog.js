// Hourly look at things that go wrong slowly: a disk filling up, or a burst of errors. A problem DMs the owner through ops.incident,
// which already holds each kind back to one message every few hours.
import { groupErrors } from "./adminlog.js";

export const DISK_WARN_PCT = 80;
export const SPIKE_PER_HOUR = 25;

export async function runWatchdog({ ops, storage, logs, now = () => Date.now() }) {
    const out = { disk: null, errorsLastHour: null, alerted: [] };
    try {
        const v = (await storage())?.volume;
        if (v) {
            out.disk = v.pct;
            if (v.pct >= DISK_WARN_PCT) {
                const sent = await ops.incident("disk", `Steam Value Checker: the data disk is ${v.pct}% full (${v.usedMb} MB of ${v.totalMb} MB). Add space soon: Fly dashboard, Volumes, svc_data, Extend.`);
                if (sent) out.alerted.push("disk");
            }
        }
    } catch { /* no disk numbers on this host */ }
    try {
        const since = now() - 3600_000;
        const recent = (logs?.recent({ level: "error", limit: 500 }) ?? []).filter(l => l.at >= since);
        out.errorsLastHour = recent.length;
        if (recent.length >= SPIKE_PER_HOUR) {
            const top = groupErrors(recent, 3).map(g => `${g.where}: ${g.message} (${g.count})`).join("; ");
            const sent = await ops.incident("error-spike", `Steam Value Checker: ${recent.length} errors in the last hour. Most common: ${top}.`);
            if (sent) out.alerted.push("errors");
        }
    } catch { /* the log is optional */ }
    return out;
}

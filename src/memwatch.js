// Memory warnings for the Admin log. The machine has 1 GB, so a warning only means something near the top of that, and one is enough:
// after a warning we stay quiet until memory has grown another tenth or half an hour has passed, instead of repeating every minute.
export const WARN_MB = 700, QUIET_MS = 30 * 60_000, GROWTH = 1.1;

export function memoryWatch({ warnMb = WARN_MB, quietMs = QUIET_MS } = {}) {
    let last = null; // { mb, at } of the previous warning
    return function check(rssBytes, now = Date.now()) {
        const mb = Math.round(rssBytes / 1048576);
        if (mb < warnMb) { last = null; return null; }
        if (last && now - last.at < quietMs && mb < last.mb * GROWTH) return null;
        last = { mb, at: now };
        return mb;
    };
}

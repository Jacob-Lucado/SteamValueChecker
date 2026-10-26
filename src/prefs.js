// Validation for the newer personal settings (quiet hours, digest, bundle alerts, sharing).
// Used by both the Discord commands and the dashboard, so the rules are the same in both.
import { UserError } from "./errors.js";
import { LANGS } from "./i18n.js";
import { parseClock, formatClock, validTimezone, WEEKDAYS } from "./timeutil.js";

/**
 * Turns input into a database patch. Input keys (all optional):
 * quiet_start, quiet_end ("22:00", "10pm", or null/"" to clear), tz, digest, digest_day, bundles, share.
 */
export function prefsPatch(input, user) {
    const patch = {};
    const has = k => input[k] !== undefined;

    if (has("quiet_start") || has("quiet_end")) {
        const clearing = (input.quiet_start === null || input.quiet_start === "") && (input.quiet_end === null || input.quiet_end === "");
        if (clearing) {
            patch.quiet_start = null;
            patch.quiet_end = null;
        } else {
            const read = (v, name) => {
                if (v === undefined) return undefined;
                const m = parseClock(v);
                if (m === null) throw new UserError(`I could not read the ${name} time. Use something like 22:00 or 10pm.`);
                return m;
            };
            const start = read(input.quiet_start, "start") ?? user.quiet_start;
            const end = read(input.quiet_end, "end") ?? user.quiet_end;
            if (start === null || start === undefined || end === null || end === undefined) throw new UserError("Give both a start and an end time.");
            if (start === end) throw new UserError("Start and end can't be the same time.");
            patch.quiet_start = start;
            patch.quiet_end = end;
        }
    }
    if (has("tz")) {
        const tz = String(input.tz ?? "").trim();
        if (!validTimezone(tz)) throw new UserError("I don't know that time zone. Use a name like America/New_York or Europe/London.");
        patch.tz = tz;
    }
    if (has("digest")) patch.digest = input.digest ? 1 : 0;
    if (has("digest_day")) {
        const d = Number(input.digest_day);
        if (!Number.isInteger(d) || d < 0 || d > 6) throw new UserError("Pick a day of the week.");
        patch.digest_day = d;
    }
    if (has("bundles")) patch.bundles = input.bundles ? 1 : 0;
    if (has("share")) patch.share = input.share ? 1 : 0;
    if (has("free")) patch.free = input.free ? 1 : 0;
    if (has("free_dlc")) patch.free_dlc = input.free_dlc ? 1 : 0;
    if (has("muted")) {
        const list = (Array.isArray(input.muted) ? input.muted : String(input.muted ?? "").split(",")).map(x => String(x).trim()).filter(Boolean);
        if (list.some(x => !MUTABLE.includes(x))) throw new UserError(`You can mute: ${MUTABLE.join(", ")}.`);
        patch.muted = [...new Set(list)].join(",");
    }
    if (has("lang")) {
        if (!LANGS[input.lang]) throw new UserError("Pick English, Spanish (es) or French (fr).");
        patch.lang = input.lang;
    }
    return patch;
}

export const MUTABLE = ["alert", "bundle", "free", "digest"];

/** The new settings in a form that is safe to send to the browser. */
export function prefsView(u) {
    return {
        quiet_start: formatClock(u.quiet_start), quiet_end: formatClock(u.quiet_end), tz: u.tz ?? "UTC",
        digest: Boolean(u.digest), digest_day: u.digest_day ?? 1, bundles: u.bundles !== 0, share: Boolean(u.share), free: Boolean(u.free), free_dlc: u.free_dlc !== 0,
        muted: String(u.muted ?? "").split(",").filter(Boolean), lang: u.lang ?? "en"
    };
}

export const describeQuiet = u =>
    u.quiet_start === null || u.quiet_start === undefined ? "Off" : `${formatClock(u.quiet_start)} to ${formatClock(u.quiet_end)} (${u.tz})`;
export const describeDigest = u => (u.digest ? `Weekly, ${WEEKDAYS[u.digest_day ?? 1]}s` : "Off");

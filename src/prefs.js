// Validation for the newer personal settings (quiet hours, digest, bundle alerts, sharing).
// Used by both the Discord commands and the dashboard, so the rules are the same in both.
import { UserError } from "./errors.js";
import { LANGS } from "./i18n.js";
import { parseClock, formatClock, validTimezone, WEEKDAYS, DEFAULT_TZ } from "./timeutil.js";

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
    if (has("min_discount")) {
        const d = Number(input.min_discount);
        if (!Number.isInteger(d) || d < 0 || d > 90) throw new UserError("Pick a minimum discount from 0 to 90 percent (0 means any discount).");
        patch.min_discount = d;
    }
    if (has("max_price")) {
        const d = Number(input.max_price);
        if (!Number.isFinite(d) || d < 0 || d > 1000) throw new UserError("Pick a price ceiling from 0 to 1000 (0 means no limit).");
        patch.max_price = Math.round(d * 100) / 100;
    }
    if (has("lows_only")) patch.lows_only = input.lows_only ? 1 : 0;
    if (has("bundles")) patch.bundles = input.bundles ? 1 : 0;
    if (has("share")) patch.share = input.share ? 1 : 0;
    if (has("free")) patch.free = input.free ? 1 : 0;
    if (has("free_dlc")) patch.free_dlc = input.free_dlc ? 1 : 0;
    if (has("dlc")) patch.dlc = input.dlc ? 1 : 0;
    if (has("playtest")) patch.playtest = input.playtest === true ? 1 : Math.min(2, Math.max(0, Math.trunc(Number(input.playtest)) || 0));
    if (has("achv")) patch.achv = input.achv ? 1 : 0;
    if (has("nowplaying")) patch.nowplaying = input.nowplaying ? 1 : 0;
    if (has("nudge")) patch.nudge = input.nudge ? 1 : 0;
    if (has("yearly")) patch.yearly = input.yearly ? 1 : 0;
    if (has("refund")) patch.refund = input.refund ? 1 : 0;
    if (has("milestones")) patch.milestones = input.milestones ? 1 : 0;
    if (has("news")) patch.news = [0, 1, 2].includes(Number(input.news)) ? Number(input.news) : 0;
    if (has("muted")) {
        const list = (Array.isArray(input.muted) ? input.muted : String(input.muted ?? "").split(",")).map(x => String(x).trim()).filter(Boolean);
        if (list.some(x => !MUTABLE.includes(x))) throw new UserError(`You can mute: ${MUTABLE.join(", ")}.`);
        patch.muted = [...new Set(list)].join(",");
    }
    if (has("lang")) {
        if (!LANGS[input.lang]) throw new UserError("Pick one of the languages in the list.");
        patch.lang = input.lang;
    }
    return patch;
}

export const MUTABLE = ["alert", "bundle", "free", "news", "dlc", "refund", "milestones", "yearly", "nudge", "achv", "playtest", "digest", "release", "friend", "codes", "promo"];

/** The new settings in a form that is safe to send to the browser. */
export function prefsView(u) {
    return {
        quiet_start: formatClock(u.quiet_start), quiet_end: formatClock(u.quiet_end), tz: u.tz ?? DEFAULT_TZ,
        digest: Boolean(u.digest), digest_day: u.digest_day ?? 1, bundles: u.bundles !== 0, share: Boolean(u.share), free: Boolean(u.free), free_dlc: u.free_dlc !== 0, news: u.news ?? 0, playtest: u.playtest ?? 0, achv: Boolean(u.achv), nowplaying: Boolean(u.nowplaying), nudge: Boolean(u.nudge), yearly: Boolean(u.yearly), refund: Boolean(u.refund), milestones: Boolean(u.milestones), dlc: Boolean(u.dlc),
        min_discount: u.min_discount ?? 0, max_price: u.max_price ?? 0, lows_only: Boolean(u.lows_only), muted: String(u.muted ?? "").split(",").filter(Boolean), lang: u.lang ?? "en"
    };
}

export const describeQuiet = u =>
    u.quiet_start === null || u.quiet_start === undefined ? "Off" : `${formatClock(u.quiet_start)} to ${formatClock(u.quiet_end)} (${u.tz})`;
export const describeDigest = u => (u.digest ? `Weekly, ${WEEKDAYS[u.digest_day ?? 1]}s` : "Off");

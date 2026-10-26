// Input parsing for giveaways: prize keys, durations, colors, image links.
import { UserError } from "./errors.js";
import { MAX_KEYS } from "./gwstore.js";

const MAX_KEY_LENGTH = 200;
const MAX_LABEL_LENGTH = 80;

/**
 * One prize per line: `Label | KEY` or just `KEY` (then the giveaway's game name is the label).
 * Blank lines and exact duplicates are skipped. Returns { keys: [{ label, key }], duplicates }.
 */
export function parseKeys(text, defaultLabel) {
    const keys = [];
    const seen = new Set();
    let duplicates = 0;
    for (const raw of String(text ?? "").split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const bar = line.lastIndexOf("|");
        const label = (bar >= 0 ? line.slice(0, bar) : "").trim() || defaultLabel || "Prize";
        const key = (bar >= 0 ? line.slice(bar + 1) : line).trim();
        if (!key) continue;
        if (key.length > MAX_KEY_LENGTH) throw new UserError(`One key is longer than ${MAX_KEY_LENGTH} characters. Put one prize per line as \`Name | KEY\`.`);
        if (/\s/.test(key)) throw new UserError("A key contains a space. Put one prize per line as `Name | KEY`.");
        if (seen.has(key)) { duplicates++; continue; }
        seen.add(key);
        keys.push({ label: label.slice(0, MAX_LABEL_LENGTH), key });
        if (keys.length > MAX_KEYS) throw new UserError(`A giveaway can hold up to ${MAX_KEYS} prizes. Split it into two giveaways.`);
    }
    if (!keys.length) throw new UserError("Add at least one prize key, one per line (`Name | KEY`).");
    return { keys, duplicates };
}

/** "90m", "2h", "3d", "1w", "1d12h" -> milliseconds, between 5 minutes and 30 days. */
export function parseDuration(text, { min = 5 * 60_000 } = {}) {
    const s = String(text ?? "").trim().toLowerCase().replace(/\s+/g, "");
    const re = /(\d+)(w|d|h|m)/g;
    const unit = { w: 7 * 86400_000, d: 86400_000, h: 3600_000, m: 60_000 };
    let total = 0, used = 0, m;
    while ((m = re.exec(s))) { total += Number(m[1]) * unit[m[2]]; used += m[0].length; }
    if (!total || used !== s.length) throw new UserError("I could not read that length. Use something like 90m, 2h, 3d, 1w or 1d12h.");
    if (total < min) throw new UserError("A giveaway must run for at least 5 minutes.");
    if (total > 30 * 86400_000) throw new UserError("A giveaway can run for 30 days at most.");
    return total;
}

/** "#5865F2", "5865f2" -> number, or null for empty. */
export function parseColor(text) {
    const s = String(text ?? "").trim().replace(/^#/, "");
    if (!s) return null;
    if (!/^[0-9a-f]{6}$/i.test(s)) throw new UserError("Colors are six hex digits, like #5865F2.");
    return parseInt(s, 16);
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|mkv|avi|ogv)$/i;
const VIDEO_HOSTS = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|streamable\.com|medal\.tv|clips\.twitch\.tv|twitch\.tv|tenor\.com|giphy\.com|imgur\.com|gfycat\.com|redgifs\.com)$/i;

/**
 * True for links Discord plays as video rather than shows as an embed picture: video files, YouTube, Vimeo, Twitch
 * clips, Streamable, Medal and GIF-site pages (Tenor, Giphy). Direct .gif files are pictures and animate in the embed.
 */
export function isVideoLink(url) {
    try {
        const u = new URL(url);
        if (VIDEO_EXT.test(u.pathname)) return true;
        if (/\.(png|jpe?g|gif|webp|avif)$/i.test(u.pathname)) return false;
        return /(^|\.)(i\.imgur\.com|media\.discordapp\.net|cdn\.discordapp\.com|images-ext-\d\.discordapp\.net)$/i.test(u.hostname) ? false : VIDEO_HOSTS.test(u.hostname);
    } catch { return false; }
}

/** Image or video links must be https. They are shown by Discord; the bot never downloads them. */
export function parseImageUrl(text, what = "image") {
    const s = String(text ?? "").trim();
    if (!s) return null;
    let u;
    try { u = new URL(s); } catch { throw new UserError(`That ${what} link is not a valid address.`); }
    if (u.protocol !== "https:" || s.length > 500) throw new UserError(`The ${what} link must be an https address under 500 characters.`);
    if (what === "thumbnail" && isVideoLink(u.toString())) throw new UserError("The small image must be a picture or GIF. Put a video in the large image slot.");
    return u.toString();
}

export const clampInt = (v, min, max, fallback) => {
    if (v === null || v === undefined || v === "") return fallback;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new UserError(`Use a whole number from ${min} to ${max}.`);
    return n;
};

export const cleanText = (v, max) => {
    const s = String(v ?? "").trim();
    return s ? s.slice(0, max) : null;
};

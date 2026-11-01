// Where limited-time game codes come from, and how a raw entry becomes something we can trust.
// The feed is a community list on GitHub (scraped from mentalmars.com), so every field is checked before it is stored.

export const SHIFT_SOURCE = "https://raw.githubusercontent.com/ugoogalizer/autoshift-codes/main/shiftcodes.json";
export const SHIFT_REDEEM_URL = "https://shift.gearboxsoftware.com/rewards";

/**
 * The games a SHiFT code can belong to. The art comes from the game's own Steam page, so a code can never show another game's cover.
 * `match` is tested against the name the feed uses.
 */
export const SHIFT_GAMES = [
    { key: "bl4", title: "Borderlands 4", appid: 1285190, match: /borderlands\s*4/i },
    { key: "bl3", title: "Borderlands 3", appid: 397540, match: /borderlands\s*3/i },
    { key: "wonderlands", title: "Tiny Tina's Wonderlands", appid: 749580, match: /wonderlands/i },
    { key: "blgoty", title: "Borderlands: Game of the Year", appid: 729040, match: /game of the year|goty/i },
    { key: "bltps", title: "Borderlands: The Pre-Sequel", appid: 261640, match: /pre-?sequel/i },
    { key: "bl2", title: "Borderlands 2", appid: 49520, match: /borderlands\s*2/i }
];

export const gameByKey = key => SHIFT_GAMES.find(g => g.key === key) ?? null;
export const gameByName = name => SHIFT_GAMES.find(g => g.match.test(String(name ?? ""))) ?? null;
export const gameArt = game => (game ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/header.jpg` : null);

/** A code with no end date is only trusted while it is fresh. Older ones in the list are almost always dead, so they are ignored. */
export const UNDATED_MAX_AGE_MS = 21 * 86400_000;

const CODE_RE = /^[A-Z0-9]{5}(-[A-Z0-9]{5}){4}$/;
/** "j9r33 ccttc..." or lowercase with stray spaces -> J9R33-CCTTC-... (null when it is not a real SHiFT code). */
export function normalizeCode(raw) {
    const flat = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (flat.length !== 25) return null;
    const code = flat.match(/.{5}/g).join("-");
    return CODE_RE.test(code) ? code : null;
}

const PLATFORMS = { universal: "All platforms", steam: "Steam", epic: "Epic", xbox: "Xbox", playstation: "PlayStation", nintendo: "Switch", stadia: "Stadia" };
export const platformLabel = p => PLATFORMS[String(p ?? "").trim().toLowerCase()] ?? (String(p ?? "").trim() || "All platforms");

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
/**
 * "Nov 3, 2026", "Sept 29, 2026" -> the end of that day (UTC) in ms. "Unknown", garbage, or a placeholder far in the
 * future (the list uses 2030 and later for codes with no end date) -> null, which means "no end date listed".
 */
export function parseExpiry(raw, now = Date.now()) {
    const m = String(raw ?? "").trim().match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
    if (!m) return null;
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon === undefined) return null;
    const ms = Date.UTC(Number(m[3]), mon, Number(m[2]), 23, 59, 59);
    if (!Number.isFinite(ms)) return null;
    if (ms > now + 3 * 365 * 86400_000) return null;
    return ms;
}

/** "1 Golden Key2K Japan" -> { reward: "1 Golden Key", note: "2K Japan" }; the feed glues a region note onto some rewards. */
export function cleanReward(raw) {
    let text = String(raw ?? "").replace(/\s+/g, " ").trim();
    let note = null;
    const jp = text.match(/^(.*?[a-z])(2K Japan.*)$/);
    if (jp) { text = jp[1].trim(); note = jp[2].trim(); }
    text = text.replace(/([a-z])([A-Z0-9])/g, "$1, $2").slice(0, 120);
    return { reward: text || "Unknown reward", note };
}

/**
 * One raw entry -> a clean record, or null when it cannot be trusted (bad code, unknown game, already ended).
 * Ended codes are dropped here so they never get posted.
 */
export function cleanEntry(raw, now = Date.now()) {
    if (!raw || typeof raw !== "object") return null;
    if (String(raw.type ?? "shift").toLowerCase() !== "shift") return null;
    const code = normalizeCode(raw.code);
    const game = gameByName(raw.game);
    if (!code || !game) return null;
    const expiresAt = parseExpiry(raw.expires, now);
    if (raw.expired === true || (expiresAt !== null && expiresAt < now)) return null;
    const { reward, note } = cleanReward(raw.reward);
    const seen = Date.parse(raw.archived);
    if (expiresAt === null && Number.isFinite(seen) && seen < now - UNDATED_MAX_AGE_MS) return null;
    const link = typeof raw.link === "string" && /^https:\/\//.test(raw.link) ? raw.link : null;
    return { provider: "shift", key: `shift:${code}`, code, game: game.key, platform: platformLabel(raw.platform), reward, note, expiresAt, sourceUrl: link, seenAt: Number.isFinite(seen) ? seen : now };
}

/** The whole feed -> clean records. Duplicate codes inside the feed collapse to one (the first, which is the newest). */
export function parseShiftFeed(json, now = Date.now()) {
    const lists = Array.isArray(json) ? json : [json];
    const out = new Map();
    for (const block of lists) for (const raw of block?.codes ?? []) {
        const c = cleanEntry(raw, now);
        if (c && !out.has(c.key)) out.set(c.key, c);
    }
    return [...out.values()];
}

export class CodeFeedError extends Error {}

/** Downloads and parses the feed. Throws CodeFeedError so one bad fetch never takes the whole poll cycle down. */
export async function fetchShiftCodes({ fetchImpl = globalThis.fetch, now = Date.now(), url = SHIFT_SOURCE, timeoutMs = 20_000 } = {}) {
    let res;
    try { res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": "SteamValueChecker (Discord bot)" } }); }
    catch (err) { throw new CodeFeedError(`could not reach the code list (${err.name})`); }
    if (!res.ok) throw new CodeFeedError(`the code list answered ${res.status}`);
    let json;
    try { json = await res.json(); } catch { throw new CodeFeedError("the code list was not valid JSON"); }
    const codes = parseShiftFeed(json, now);
    if (!codes.length) throw new CodeFeedError("the code list had no usable codes");
    return codes;
}

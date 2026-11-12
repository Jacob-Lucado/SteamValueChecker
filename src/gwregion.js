// Region locks for giveaways. A prize key can be tied to a region, so a host can list where winners must be.
// Entrants are checked against the country on their Steam profile when they have proved their account, and otherwise
// against the price region they set for the bot (which is only their word for it).
import { UserError } from "./errors.js";

const EU = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];
export const GROUPS = {
    EU,
    EUROPE: [...EU, "GB", "NO", "CH", "IS", "LI", "AL", "BA", "ME", "MK", "RS", "UA", "MD", "BY", "XK"],
    NA: ["US", "CA", "MX"],
    LATAM: ["MX", "BR", "AR", "CL", "CO", "PE", "UY", "PY", "BO", "EC", "VE", "CR", "PA", "GT", "HN", "SV", "NI", "DO", "CU"],
    OCEANIA: ["AU", "NZ"],
    ASIA: ["JP", "KR", "CN", "HK", "TW", "SG", "MY", "TH", "VN", "PH", "ID", "IN", "PK", "BD", "LK", "NP", "AE", "SA", "IL", "TR", "QA", "KW"]
};
const ALIAS = { UK: "GB", USA: "US", AMERICA: "US", WORLD: "ALL", WORLDWIDE: "ALL", GLOBAL: "ALL", ANY: "ALL", EVERYWHERE: "ALL" };

/**
 * "US, CA, EU" -> "US,CA,EU" (what is stored). Blank or "worldwide" means no lock (null).
 * Country codes are two letters; EU, EUROPE, NA, LATAM, OCEANIA and ASIA stand for several countries.
 */
export function parseRegions(text) {
    const tokens = String(text ?? "").toUpperCase().split(/[\s,;/]+/).map(t => t.trim()).filter(Boolean);
    if (!tokens.length) return null;
    const out = [];
    for (let t of tokens) {
        t = ALIAS[t] ?? t;
        if (t === "ALL") return null;
        if (!GROUPS[t] && !/^[A-Z]{2}$/.test(t)) throw new UserError(`"${t}" isn't a region. Use two-letter country codes like US, CA or DE, or a group: ${Object.keys(GROUPS).join(", ")}.`);
        if (!out.includes(t)) out.push(t);
    }
    if (out.length > 40) throw new UserError("That's a lot of regions. Use a group like EU or EUROPE, or list up to 40.");
    return out.join(",");
}

/** Every country code a stored list allows. */
export function allowedCountries(stored) {
    const set = new Set();
    for (const t of String(stored ?? "").split(",").filter(Boolean)) for (const c of GROUPS[t] ?? [t]) set.add(c);
    return set;
}

/** How the list reads on the giveaway post. */
export const describeRegions = stored => String(stored ?? "").split(",").filter(Boolean).join(", ");

/**
 * Is this person in a region the giveaway allows?
 * `steam` is their Steam link ({ verified, country } or null), `userRegion` the price region they set, `strict` means
 * only a country verified through Steam counts. Returns { ok, region, source } or { ok: false, reason }.
 */
export function regionCheck(stored, { steam, userRegion, strict = false }) {
    const allowed = allowedCountries(stored);
    const list = describeRegions(stored);
    const verified = Boolean(steam?.verified);
    let region = verified && steam?.country ? String(steam.country).toUpperCase() : null, source = "steam";
    if (!region) {
        if (strict) {
            if (!verified) return { ok: false, reason: `This giveaway is only for players in **${list}**, checked through Steam. Sign in through Steam on the dashboard (or use \`/me steam verify\`), then press Enter again.` };
            return { ok: false, reason: `This giveaway is only for players in **${list}**, and your Steam profile doesn't show a country. Set your location on your Steam profile (and make it public), sync your library with \`/me steam sync\`, then press Enter again.` };
        }
        region = String(userRegion ?? "").toUpperCase() || null; source = "self";
    }
    if (!region) return { ok: false, reason: `This giveaway is only for players in **${list}**. Set your region with \`/me region\` (or verify with Steam) and try again.` };
    // Euro-area price regions and the UK/GB spelling should still match what the host meant.
    const norm = region === "UK" ? "GB" : region;
    if (allowed.has(norm)) return { ok: true, region: norm, source };
    return { ok: false, reason: `This giveaway is only for players in **${list}**. ${source === "steam" ? `Your Steam profile says ${norm}.` : `Your region is set to ${norm}. If that's wrong, change it with \`/me region\` or verify with Steam.`}` };
}

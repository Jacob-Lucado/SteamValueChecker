// The /value pipeline without any Discord code, shared by the dashboard.
import { parseUpload, parseTyped, sanitize } from "./parse.js";
import { buildRows, sortRows, totals, resolvePaid, savingsReport } from "./report.js";
import { toCsv } from "./render.js";

export const MAX_TITLES = 100;
export const MAX_UPLOAD_CHARS = 200_000;
export const SORTS = ["input", "name", "msrp", "cheapest"];

export class ValueError extends Error {}

/** typed: titles text; upload: { name, text } from a FanaticalGrabber export. Returns plain JSON-able data. */
export async function runValue({ itad, typed = "", upload = null, paid = null, region = "US", stores = "all", sort = "input" }) {
    const entries = [];
    if (upload) {
        if (!/\.(csv|json|txt|md)$/i.test(upload.name ?? "")) throw new ValueError("Unsupported file type. Use a .csv, .json, .txt or .md export.");
        if (String(upload.text ?? "").length > MAX_UPLOAD_CHARS) throw new ValueError("That file is too large (200 KB max).");
        entries.push(...parseUpload(String(upload.text ?? ""), upload.name.toLowerCase()));
    }
    entries.push(...parseTyped(typed));

    const clean = sanitize(entries, { max: MAX_TITLES });
    if (!clean.entries.length) {
        throw new ValueError("I need game titles, not keys. Type titles or upload the CSV/JSON/TXT export from FanaticalGrabber.");
    }
    if (paid != null && !(Number.isFinite(paid) && paid >= 0 && paid <= 1_000_000)) throw new ValueError("Paid must be a number from 0 to 1,000,000.");
    if (!SORTS.includes(sort)) sort = "input";
    const majorOnly = stores === "major";

    const resolved = await itad.lookupTitles(clean.entries.map(e => e.title));
    const ids = [...new Set(resolved.filter(r => r.id).map(r => r.id))];
    const prices = ids.length ? await itad.getPrices(ids, region) : new Map();
    const paidByTitle = new Map(clean.entries.filter(e => e.paid !== null).map(e => [e.title, e.paid]));
    const rows = sortRows(buildRows(resolved, prices, paidByTitle, { majorOnly }), sort);
    const t = totals(rows);
    const savings = savingsReport(resolvePaid(paid, rows), t, rows);

    const notes = [];
    if (clean.sawKeys) notes.push("Anything that looked like a key was ignored. Please do not post keys.");
    if (clean.truncated) notes.push(`Only the first ${MAX_TITLES} of ${clean.total} titles were checked.`);
    if (savings && t.found < t.count) notes.push(`The comparison covers the ${t.found} games that were found, but "paid" covers everything you entered.`);

    return { rows, totals: t, savings, notes, region, majorOnly, csv: toCsv(rows, t.currency) };
}

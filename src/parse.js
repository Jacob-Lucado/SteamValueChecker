// Turns user input (typed titles or an uploaded FanaticalGrabber export) into a clean list of
// { title, paid } entries. Anything that looks like a game key is discarded here, so keys never
// reach the price lookup, the logs or the reply.

const KEY_GLOBAL = /\b[A-Z0-9]{4,6}(?:-[A-Z0-9]{4,6}){2,4}\b/gi;
const TITLE_HEAD = /^(game|games|title|name)$/i;
const PAID_HEAD = /^(paid|price paid|cost|amount paid|price)$/i;
const EXPORT_HEADER = /^(FanaticalGrabber|Fanatical Key Export|Export Date|Games Exported|Created By|Follow|©|Version)/i;

export const MAX_TITLE_LENGTH = 120;

/** True when the text contains something shaped like a product key (needs a digit, so "Half-Life-Alyx" is safe). */
export function containsKey(text) {
    const matches = String(text).match(KEY_GLOBAL) ?? [];
    return matches.some(m => /\d/.test(m));
}

/** "$12.50", "12,50", "1.234,56", "1,234" -> number. Returns null when there is no usable amount. */
export function parseMoney(value) {
    if (value == null) return null;
    if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
    let s = String(value).replace(/[^\d.,-]/g, "");
    if (!/\d/.test(s)) return null;
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) {
        s = /,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    } else {
        s = s.replace(/,/g, "");
    }
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Splits one CSV line, honouring quotes and doubled quotes. */
export function splitCsvLine(line) {
    const out = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quoted) {
            if (ch === '"') {
                if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
            } else cur += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ",") { out.push(cur); cur = ""; }
        else cur += ch;
    }
    out.push(cur);
    return out.map(s => s.trim());
}

function fromJson(text) {
    let data;
    try { data = JSON.parse(text); } catch { return null; }
    const list = Array.isArray(data) ? data : data?.keys ?? data?.games ?? data?.items ?? [];
    if (!Array.isArray(list)) return [];
    return list
        .map(x => typeof x === "string"
            ? { title: x, paid: null }
            : { title: x?.game ?? x?.title ?? x?.name, paid: parseMoney(x?.paid ?? x?.price_paid ?? x?.cost) })
        .filter(e => typeof e.title === "string" && e.title.trim());
}

function fromCsv(lines) {
    const head = splitCsvLine(lines[0]);
    const titleCol = head.findIndex(h => TITLE_HEAD.test(h));
    if (titleCol < 0) return null;
    const paidCol = head.findIndex(h => PAID_HEAD.test(h));
    return lines.slice(1)
        .map(line => {
            const cells = splitCsvLine(line);
            return { title: cells[titleCol], paid: paidCol >= 0 ? parseMoney(cells[paidCol]) : null };
        })
        .filter(e => e.title);
}

function splitMarkdownRow(line) {
    return line.replace(/^\|/, "").replace(/\|$/, "")
        .split(/(?<!\\)\|/)
        .map(c => c.replace(/\\\|/g, "|").trim());
}

function fromMarkdown(lines) {
    const rows = lines.filter(l => l.startsWith("|")).map(splitMarkdownRow);
    if (rows.length < 2) return null;
    const titleCol = rows[0].findIndex(h => TITLE_HEAD.test(h));
    if (titleCol < 0) return null;
    const paidCol = rows[0].findIndex(h => PAID_HEAD.test(h));
    return rows.slice(1)
        .filter(r => !r.every(c => /^:?-{2,}:?$/.test(c)))
        .map(r => ({ title: r[titleCol], paid: paidCol >= 0 ? parseMoney(r[paidCol]) : null }))
        .filter(e => e.title);
}

function fromText(lines) {
    // The TXT export wraps the list between two long "=====" lines. Use only that part when present.
    const seps = lines.map((l, i) => (/^={10,}$/.test(l) ? i : -1)).filter(i => i >= 0);
    const body = seps.length >= 2 ? lines.slice(seps[0] + 1, seps[1]) : lines;
    return body
        .map(l => l.split("|")[0].trim()) // "Title | KEY" -> "Title"; the key part is never read
        .filter(l => l && !/^=+$/.test(l) && !EXPORT_HEADER.test(l))
        .map(title => ({ title, paid: null }));
}

/** Parses an uploaded file (.csv, .json, .txt, .md) into [{ title, paid }]. */
export function parseUpload(text, filename = "") {
    text = String(text).replace(/^﻿/, "");
    const name = filename.toLowerCase();
    const head = text.trimStart();

    if (name.endsWith(".json") || head.startsWith("{") || head.startsWith("[")) {
        const json = fromJson(text);
        if (json) return json;
    }

    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return [];

    if (lines.filter(l => l.startsWith("|")).length >= 2) {
        const md = fromMarkdown(lines);
        if (md) return md;
    }
    if (name.endsWith(".csv") || (lines[0].includes(",") && splitCsvLine(lines[0]).some(h => TITLE_HEAD.test(h)))) {
        const csv = fromCsv(lines);
        if (csv) return csv;
    }
    return fromText(lines);
}

/** Typed input: titles separated by ";" or new lines. */
export function parseTyped(text) {
    return String(text ?? "")
        .split(/[;\n]/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(title => ({ title, paid: null }));
}

/**
 * Cleans a list of entries: removes anything key-shaped, trims, de-duplicates (case-insensitive)
 * and caps the count. Reports what it dropped so the bot can tell the user.
 */
export function sanitize(entries, { max = 100 } = {}) {
    let sawKeys = false;
    const seen = new Set();
    const clean = [];
    for (const e of entries) {
        const title = String(e.title ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_LENGTH);
        if (!title) continue;
        if (containsKey(title)) { sawKeys = true; continue; }
        const id = title.toLowerCase();
        if (seen.has(id)) continue;
        seen.add(id);
        clean.push({ title, paid: e.paid ?? null });
    }
    return { entries: clean.slice(0, max), sawKeys, truncated: clean.length > max, total: clean.length };
}

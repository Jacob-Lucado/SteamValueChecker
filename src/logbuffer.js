// Keeps the bot's recent log lines so the owner can read them on the dashboard's Admin page.
// Everything is held in memory; warnings and errors (including crashes) are also written to a small file next to the
// database, so they are still there after the bot restarts. Secrets are masked before a line is stored.
import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const LEVELS = { log: "info", info: "info", warn: "warn", error: "error" };

export function createLogBuffer({ file = null, secrets = [], max = 400, maxFile = 300, now = () => Date.now() } = {}) {
    const masks = secrets.map(s => String(s ?? "")).filter(s => s.length >= 6);
    const mask = text => masks.reduce((t, s) => t.split(s).join("[hidden]"), text)
        .replace(/([?&]key=)[^&\s"']+/gi, "$1[hidden]")
        .replace(/\b[MNO][A-Za-z\d_-]{23,}\.[\w-]{6}\.[\w-]{27,}\b/g, "[hidden]");

    let lines = [];
    if (file) {
        try {
            lines = readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)).slice(-maxFile);
            lines.forEach(l => { l.earlier = true; });
        } catch { /* no file yet */ }
    }
    let fileCount = lines.length;

    function add(level, args) {
        const text = mask(args.map(a => (typeof a === "string" ? a : a instanceof Error ? (a.stack ?? a.message) : safeJson(a))).join(" ")).slice(0, 4000);
        if (/ExperimentalWarning: SQLite/.test(text)) return null; // harmless Node notice, not worth an admin entry
        const entry = { at: now(), level, text };
        lines.push(entry);
        if (lines.length > max + maxFile) lines = lines.slice(-max - maxFile);
        if (file && level !== "info") persist(entry);
        return entry;
    }

    function persist(entry) {
        try {
            mkdirSync(dirname(file), { recursive: true });
            if (fileCount >= maxFile * 2) {
                const keep = lines.filter(l => l.level !== "info").slice(-maxFile);
                writeFileSync(file, keep.map(l => JSON.stringify({ at: l.at, level: l.level, text: l.text })).join("\n") + "\n");
                fileCount = keep.length;
            } else {
                appendFileSync(file, JSON.stringify(entry) + "\n");
                fileCount++;
            }
        } catch { /* logging must never break the bot */ }
    }

    /** Copies console output into the buffer. The original output (Fly's log) is untouched. */
    function capture(target = console) {
        for (const [method, level] of Object.entries(LEVELS)) {
            const original = target[method].bind(target);
            target[method] = (...args) => { try { add(level, args); } catch { /* ignore */ } original(...args); };
        }
    }

    /** level: "error" = errors and crashes only, "warn" = warnings too, anything else = everything. Newest first. */
    function recent({ level = "error", limit = 200 } = {}) {
        const keep = level === "error" ? ["error"] : level === "warn" ? ["error", "warn"] : ["error", "warn", "info"];
        return lines.filter(l => keep.includes(l.level)).slice(-limit).reverse();
    }

    return { add, capture, recent };
}

function safeJson(v) { try { return typeof v === "object" ? JSON.stringify(v) : String(v); } catch { return String(v); } }

// The Terms of Service and Privacy Policy as ordinary web pages on the bot's own site (/terms.html and /privacy.html; the plain /terms and /privacy work too),
// so the links in the Discord developer portal and in the bot don't depend on where the code is kept.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = name => { try { return readFileSync(root + name, "utf8"); } catch { return ""; } };

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = s => esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

/** The small slice of Markdown these two documents use: headings, paragraphs, lists, bold, code and https links. */
export function mdToHtml(md) {
    const out = []; let list = null;
    const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
    for (const raw of String(md).split("\n")) {
        const line = raw.trimEnd();
        let m;
        if (!line.trim()) { close(); continue; }
        if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) { close(); out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`); continue; }
        if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) { if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inline(m[1])}</li>`); continue; }
        if ((m = /^\s*\d+\.\s+(.*)$/.exec(line))) { if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; } out.push(`<li>${inline(m[1])}</li>`); continue; }
        close(); out.push(`<p>${inline(line)}</p>`);
    }
    close();
    return out.join("\n");
}

const DOCS = { terms: { title: "Terms of Service", file: "TERMS.md" }, privacy: { title: "Privacy Policy", file: "PRIVACY.md" } };

export function legalPage(kind, origin) {
    const d = DOCS[kind]; if (!d) return null;
    const body = mdToHtml(read(d.file).split("\n").filter(l => !/github\.com/i.test(l)).join("\n"));
    if (!body) return null;
    const other = kind === "terms" ? ["privacy", "Privacy Policy"] : ["terms", "Terms of Service"];
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${d.title} · Steam Value Checker</title>
<meta name="robots" content="index,follow">
<link rel="canonical" href="${esc(origin)}/${kind}.html">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="stylesheet" href="/style.css">
<script src="/theme.js"></script>
</head>
<body>
<main class="legal">
<p><a href="/">← Steam Value Checker</a></p>
<div class="panel">
${body}
</div>
<p class="muted small"><a href="/${other[0]}">${other[1]}</a></p>
</main>
</body>
</html>
`;
}

/** A self-contained, print-ready version of one document: the source for the PDF (scripts/legal-pdf.mjs). */
export function legalPrintHtml(kind) {
    const d = DOCS[kind]; if (!d) return null;
    const body = mdToHtml(read(d.file).split("\n").filter(l => !/github\.com/i.test(l)).join("\n"));
    if (!body) return null;
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${d.title} - Steam Value Checker</title>
<style>
body { font: 11pt/1.55 Georgia, "Times New Roman", serif; color: #111; margin: 0; }
h2 { font: 700 20pt/1.2 Helvetica, Arial, sans-serif; margin: 0 0 6pt; }
h3, h4 { font: 700 13pt/1.3 Helvetica, Arial, sans-serif; margin: 16pt 0 4pt; }
p, li { margin: 0 0 7pt; }
ul, ol { padding-left: 20pt; margin: 0 0 8pt; }
code { font: 10pt Menlo, Consolas, monospace; background: #f1f1f1; padding: 0 2pt; }
a { color: #1a4fa0; text-decoration: none; }
</style></head><body>
${body}
</body></html>
`;
}

/** The page behind /terms.html and /privacy.html: the PDF in a frame, with plain links for anything that cannot show a PDF. */
export function legalFramePage(kind, origin) {
    const d = DOCS[kind]; if (!d || !read(d.file)) return null;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${d.title} · Steam Value Checker</title>
<meta name="robots" content="index,follow">
<link rel="canonical" href="${esc(origin)}/${kind}.html">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="stylesheet" href="/style.css">
<script src="/theme.js"></script>
</head>
<body class="legal-frame">
<main class="legal wide">
<p><a href="/">← Steam Value Checker</a></p>
<iframe class="legal-pdf" src="/${kind}.pdf" title="${d.title}"></iframe>
<p class="muted small">Can't see the document? <a href="/${kind}.pdf">Open the PDF</a> or <a href="/${kind}">read it as a web page</a>.</p>
</main>
</body>
</html>
`;
}

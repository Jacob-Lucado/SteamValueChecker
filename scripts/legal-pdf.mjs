// Makes public/terms.pdf, public/privacy.pdf and public/licenses.pdf from TERMS.md, PRIVACY.md and LICENSES.md (make that one with scripts/licenses-md.mjs).
// Run it after editing either file:  node scripts/legal-pdf.mjs   (needs Playwright with Chromium installed)
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { legalPrintHtml } from "../src/legal.js";

let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); }
catch { console.error("Playwright is not installed. Run: npm i --no-save playwright && npx playwright install chromium"); process.exit(1); }

const out = name => fileURLToPath(new URL(`../public/${name}.pdf`, import.meta.url));
const browser = await chromium.launch();
try {
    for (const kind of ["terms", "privacy", "licenses"]) {
        const page = await browser.newPage();
        await page.setContent(legalPrintHtml(kind), { waitUntil: "load" });
        const pdf = await page.pdf({ format: "Letter", margin: { top: "0.9in", bottom: "0.9in", left: "1in", right: "1in" }, printBackground: true });
        writeFileSync(out(kind), pdf);
        console.log(`wrote public/${kind}.pdf (${pdf.length} bytes)`);
        await page.close();
    }
} finally { await browser.close(); }

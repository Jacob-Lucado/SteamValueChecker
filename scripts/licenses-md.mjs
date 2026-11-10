// Rewrites LICENSES.md from the installed production dependencies.
// Run it after dependencies change (npm install --omit=dev first), then node scripts/legal-pdf.mjs to remake the PDF.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { licensesMarkdown } from "../src/licenses.js";

const root = fileURLToPath(new URL("../", import.meta.url));
writeFileSync(root + "LICENSES.md", licensesMarkdown(root));
console.log("wrote LICENSES.md");

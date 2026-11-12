// Finds a Chromium for the browser tests. Set CHROMIUM_PATH to point at one; without any, the tests that need it skip themselves.
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

export async function launchBrowser() {
    const exe = [process.env.CHROMIUM_PATH, process.env.LUNA_CHROMIUM, "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].filter(Boolean);
    for (const p of exe) {
        try { await access(p); } catch { continue; }
        try { return await createRequire(import.meta.url)("playwright-core").chromium.launch({ executablePath: p }); } catch { /* try the next one */ }
    }
    // the browser that `npx playwright-core install chromium` downloads (what CI does)
    try { return await createRequire(import.meta.url)("playwright-core").chromium.launch(); } catch { /* none installed */ }
    // a full Playwright install somewhere on the machine brings its own browser
    const roots = ["/usr/lib/node_modules/"];
    try { roots.push(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() + "/"); } catch { /* no npm on the path */ }
    for (const r of roots) { try { return await createRequire(r)("playwright").chromium.launch(); } catch { /* next */ } }
    return null;
}

// Draws every overlay kind in every theme in a real browser (the sample mode of /ov) and fails on any script error or empty card.
// It needs a Chromium: set CHROMIUM_PATH, or have chromium installed. Without one the test is skipped, so CI stays green.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, access } from "node:fs/promises";
import { join, extname } from "node:path";
import { createRequire } from "node:module";
import { OVERLAY_KINDS, OVERLAY_THEMES, cleanConfig } from "../src/overlays.js";

const PUBLIC = new URL("../public/", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

async function launch() {
    const exe = [process.env.CHROMIUM_PATH, process.env.LUNA_CHROMIUM, "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].filter(Boolean);
    for (const p of exe) { try { await access(p); } catch { continue; } try { const { chromium } = createRequire(import.meta.url)("playwright-core"); return await chromium.launch({ executablePath: p }); } catch { /* try the next one */ } }
    try { return await createRequire("/usr/lib/node_modules/")("playwright").chromium.launch(); } catch { return null; }
}

test("every overlay draws in every theme without errors", { timeout: 180_000 }, async t => {
    const browser = await launch();
    if (!browser) return t.skip("no Chromium here");
    const server = createServer(async (req, res) => {
        const u = new URL(req.url, "http://x"); const file = u.pathname === "/ov" ? "ov.html" : u.pathname.slice(1);
        try { const body = await readFile(join(PUBLIC, file)); res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" }); res.end(body); } catch { res.writeHead(404); res.end(); }
    });
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await (await browser.newContext({ viewport: { width: 900, height: 400 } })).newPage();
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    try {
        for (const kind of OVERLAY_KINDS) for (const theme of OVERLAY_THEMES) {
            const c = cleanConfig(kind, { theme, target: 100, label: "Test" });
            await page.goto(`${base}/ov?demo=1&k=${kind}&c=${encodeURIComponent(JSON.stringify(c))}&v=${encodeURIComponent(JSON.stringify(kind === "scene" ? { children: [{ kind: "goal", config: cleanConfig("goal", { theme }), data: { current: 5, target: 100, pct: 5 } }] } : { current: 60 }))}`);
            await page.waitForSelector(".card", { timeout: 5000 }).catch(() => {});
            const text = await page.evaluate(() => (document.querySelector(".card")?.textContent ?? "").trim());
            assert.ok(text.length > 0, `${kind} in ${theme} drew nothing`);
            if (theme !== "classic") assert.ok(await page.evaluate(th => Boolean(document.querySelector(".card.t-" + th) || document.querySelector(".ov.scene")), theme), `${kind} did not take the ${theme} theme`);
        }
        assert.deepEqual(errors, []);
    } finally { await browser.close(); server.close(); }
});

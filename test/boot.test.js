import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// index.js isn't imported by any other test, so a mistake in its start-up order (a value used before it exists)
// would only show up on the server. This starts it for a few seconds with made-up credentials and looks for that kind of crash.
test("the bot gets through start-up without a code error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "svc-boot-"));
    const env = { ...process.env, DISCORD_TOKEN: "a.b.c", CLIENT_ID: "123456789012345678", ITAD_API_KEY: "k", DATABASE_PATH: join(dir, "s.db"), KEY_SECRET: "test-secret-at-least-16-chars", DASHBOARD_URL: "", DISCORD_CLIENT_SECRET: "" };
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/index.js"], { env, cwd: new URL("..", import.meta.url) });
    let out = "", exited = null;
    child.stdout.on("data", d => out += d); child.stderr.on("data", d => out += d);
    child.on("exit", code => { exited = code; });
    await new Promise(r => setTimeout(r, 6000));
    child.kill("SIGKILL");
    assert.doesNotMatch(out, /ReferenceError|TypeError|SyntaxError|Cannot access/, out.slice(0, 800));
    assert.match(out, /Bot started/);
});

// Same idea with the dashboard switched on: it has to come up and answer, including the health address Fly and monitors call.
test("the dashboard starts with the bot and answers /healthz and its public pages", async () => {
    const dir = mkdtempSync(join(tmpdir(), "svc-boot-"));
    const port = 34000 + Math.floor(Math.random() * 1000);
    const env = { ...process.env, DISCORD_TOKEN: "a.b.c", CLIENT_ID: "123456789012345678", ITAD_API_KEY: "k", DATABASE_PATH: join(dir, "s.db"), KEY_SECRET: "test-secret-at-least-16-chars",
        DASHBOARD_URL: `http://127.0.0.1:${port}`, DISCORD_CLIENT_SECRET: "s", DASHBOARD_PORT: String(port), DASHBOARD_HOST: "127.0.0.1" };
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/index.js"], { env, cwd: new URL("..", import.meta.url) });
    let out = "";
    child.stdout.on("data", d => out += d); child.stderr.on("data", d => out += d);
    try {
        let res = null;
        for (let i = 0; i < 40 && !res; i++) { try { res = await fetch(`http://127.0.0.1:${port}/healthz`); } catch { await new Promise(r => setTimeout(r, 250)); } }
        assert.ok(res, "the dashboard never opened its port: " + out.slice(0, 600));
        assert.equal(res.status, 200);
        const h = await res.json();
        assert.equal(h.ok, true); assert.equal(h.database, true); assert.equal(h.discord, false, "no Discord connection with a made-up token");
        assert.equal((await fetch(`http://127.0.0.1:${port}/healthz?strict=1`)).status, 503, "strict mode needs Discord");
        for (const path of ["/", "/api/config", "/api/status", "/api/public/site", "/u/nobody"]) {
            const r = await fetch(`http://127.0.0.1:${port}${path}`);
            assert.ok(r.status < 500 || path === "/u/nobody" && r.status === 404, `${path} gave ${r.status}`);
        }
        assert.doesNotMatch(out, /ReferenceError|TypeError|SyntaxError|Cannot access/, out.slice(0, 800));
    } finally { child.kill("SIGKILL"); }
});

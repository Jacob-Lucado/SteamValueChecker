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

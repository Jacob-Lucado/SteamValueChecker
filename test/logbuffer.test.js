import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogBuffer } from "../src/logbuffer.js";

test("log buffer filters by level, newest first, and hides secrets", () => {
    const logs = createLogBuffer({ secrets: ["SUPERSECRETTOKEN"] });
    logs.add("info", ["started"]);
    logs.add("warn", ["slow"]);
    logs.add("error", ["boom with SUPERSECRETTOKEN and https://x/y?key=abc123&z=1"]);
    const errors = logs.recent({ level: "error" });
    assert.equal(errors.length, 1);
    assert.ok(!errors[0].text.includes("SUPERSECRETTOKEN") && !errors[0].text.includes("abc123"));
    assert.equal(logs.recent({ level: "all" })[0].level, "error");
    assert.equal(logs.recent({ level: "all" }).length, 3);
});

test("errors survive a restart but plain info lines do not", () => {
    const file = join(mkdtempSync(join(tmpdir(), "svc-")), "errors.jsonl");
    const a = createLogBuffer({ file });
    a.add("info", ["hello"]);
    a.add("error", [new Error("kaboom")]);
    const b = createLogBuffer({ file });
    const all = b.recent({ level: "all" });
    assert.equal(all.length, 1);
    assert.match(all[0].text, /kaboom/);
    assert.equal(all[0].earlier, true);
    assert.ok(readFileSync(file, "utf8").includes("kaboom"));
});

test("capture copies console output and still prints it", () => {
    const logs = createLogBuffer();
    const printed = [];
    const fake = { log: (...a) => printed.push(a.join(" ")), info() {}, warn() {}, error: (...a) => printed.push(a.join(" ")) };
    logs.capture(fake);
    fake.error("[crash] bad");
    assert.deepEqual(printed, ["[crash] bad"]);
    assert.equal(logs.recent({ level: "error" })[0].text, "[crash] bad");
});

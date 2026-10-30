import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

test("node experimental and trace-warning lines are not kept", () => {
    const logs = createLogBuffer({});
    logs.add("warn", ["(node:1) ExperimentalWarning: SQLite is an experimental feature"]);
    logs.add("warn", ["(Use `node --trace-warnings ...` to show where the warning was created)"]);
    logs.add("warn", ["real problem"]);
    assert.equal(logs.recent({ level: "all" }).length, 1);
});

test("owner actions and restarts are activity, not errors; old saved lines are sorted out", () => {
    const file = join(mkdtempSync(join(tmpdir(), "svc-")), "errors.jsonl");
    const a = createLogBuffer({ file });
    a.add("info", ["[activity] [dashboard] Bot owner started broadcast #2"]);
    a.add("error", ["[crash] boom"]);
    assert.deepEqual(a.recent({ level: "error" }).map(l => l.text), ["[crash] boom"]);
    assert.equal(a.recent({ level: "activity" })[0].level, "activity");
    assert.ok(!a.recent({ level: "activity" })[0].text.startsWith("[activity]"));
    const old = createLogBuffer({ file: join(mkdtempSync(join(tmpdir(), "svc-")), "o.jsonl") });
    assert.equal(old.recent({ level: "all" }).length, 0);
    const f2 = join(mkdtempSync(join(tmpdir(), "svc-")), "o.jsonl");
    writeFileSync(f2, [
        { at: 1, level: "error", text: "[exit] code 0, rss 1 MB, heap 1 MB" },
        { at: 2, level: "error", text: "[shutdown] received SIGINT (the host stopped the bot, e.g. a deploy or restart), rss 1 MB" },
        { at: 3, level: "error", text: "[dashboard] owner 123 started broadcast #2 to me (1 targets)" },
        { at: 4, level: "error", text: "[crash] real" }].map(x => JSON.stringify(x)).join("\n"));
    const b = createLogBuffer({ file: f2 });
    assert.deepEqual(b.recent({ level: "error" }).map(l => l.text), ["[crash] real"]);
    assert.equal(b.recent({ level: "activity" }).length, 2);
});

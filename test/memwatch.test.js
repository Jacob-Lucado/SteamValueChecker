import test from "node:test";
import assert from "node:assert/strict";
import { memoryWatch } from "../src/memwatch.js";

const MB = 1048576, MIN = 60_000;

test("normal memory never warns, and a warning is not repeated every minute", () => {
    const check = memoryWatch({ warnMb: 700 });
    assert.equal(check(385 * MB, 0), null, "385 MB on a 1 GB machine is fine");
    assert.equal(check(720 * MB, MIN), 720, "first time over the line");
    for (let i = 2; i < 30; i++) assert.equal(check(722 * MB, i * MIN), null, "quiet while it stays about the same");
    assert.equal(check(722 * MB, 31 * MIN), 722, "a reminder after half an hour");
});

test("it speaks up again when memory keeps growing, and starts over after a dip", () => {
    const check = memoryWatch({ warnMb: 700 });
    assert.equal(check(720 * MB, 0), 720);
    assert.equal(check(800 * MB, MIN), 800, "another ten percent up");
    assert.equal(check(805 * MB, 2 * MIN), null);
    assert.equal(check(400 * MB, 3 * MIN), null, "back to normal");
    assert.equal(check(710 * MB, 4 * MIN), 710, "a new climb is a new warning");
});

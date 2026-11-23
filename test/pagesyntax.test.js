import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { Script } from "node:vm";

// Every script the dashboard serves has to parse. A missing parenthesis in a page nobody opens in the browser tests
// (like the Admin page) would otherwise ship and leave that page blank.
test("every dashboard script parses", () => {
    const dir = new URL("../public/", import.meta.url);
    const bad = [];
    for (const f of readdirSync(dir).filter(n => n.endsWith(".js"))) {
        try { new Script(readFileSync(new URL(f, dir), "utf8"), { filename: f }); } catch (e) { bad.push(`${f}: ${e.message}`); }
    }
    assert.deepEqual(bad, []);
});

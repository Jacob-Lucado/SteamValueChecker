import test from "node:test";
import assert from "node:assert/strict";
import { affiliateUrl, isAffiliated } from "../src/affiliate.js";

test("affiliateUrl: only Fanatical links change, and only when it's on", () => {
    const f = "https://www.fanatical.com/en/bundle/indie-pack?x=1&y=2";
    assert.equal(affiliateUrl(f, { on: false, tag: "bundle-1" }), f);
    const u = new URL(affiliateUrl(f, { on: true, tag: "bundle-1" }));
    assert.equal(u.hostname, "www.awin1.com"); assert.equal(u.pathname, "/cread.php");
    assert.equal(u.searchParams.get("awinmid"), "118821"); assert.equal(u.searchParams.get("awinaffid"), "3164574");
    assert.equal(u.searchParams.get("clickref"), "bundle-1"); assert.equal(u.searchParams.get("ued"), f, "the whole address survives, query and all");
    for (const other of ["https://www.humblebundle.com/games/x", "https://fanatical.com.evil.example/a", "http://www.fanatical.com/a", "not a url", ""]) assert.equal(affiliateUrl(other, { on: true }), other);
    assert.ok(!new URL(affiliateUrl(f, { on: true, tag: "a b&c=d" })).searchParams.has("c"), "a tag can't add parameters");
    assert.ok(isAffiliated(f, true)); assert.ok(!isAffiliated(f, false));
});

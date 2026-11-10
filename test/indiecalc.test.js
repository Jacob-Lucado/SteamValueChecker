import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
await import("../public/indiecalc.js");
const C = globalThis.IndieCalc;

test("Valve's cut steps down at $10M and $50M", () => {
    assert.equal(C.valveCut(1000), 300);
    assert.equal(C.valveCut(10_000_000), 3_000_000);
    assert.equal(C.valveCut(20_000_000), 3_000_000 + 2_500_000);
    assert.equal(C.valveCut(60_000_000), 3_000_000 + 10_000_000 + 2_000_000);
});

test("the fee calculator takes VAT out first, then refunds, then Valve's cut, then income tax", () => {
    const r = C.fees({ price: 20, copies: 100, vat: 25, refunds: 10, incomeTax: 0 });
    assert.equal(r.sold, 2000); assert.equal(r.vat, 400); assert.equal(r.refunded, 160);
    assert.equal(r.valve, 432); // 30% of 1440
    assert.equal(r.keep, 1008);
    assert.equal(C.fees({ price: 10, copies: 10, incomeTax: 20 }).keep, 56); // 100 -> 70 -> 56
    assert.equal(C.fees({ price: 10, copies: 0 }).perCopy, 0);
});

test("review labels follow Steam's breakpoints and the next label is found", () => {
    assert.equal(C.reviewLabel(0, 0).label, "No user reviews");
    assert.match(C.reviewLabel(3, 1).label, /4 user reviews/);
    assert.equal(C.reviewLabel(470, 20).label, "Very Positive"); // 96% but under 500 reviews
    assert.equal(C.reviewLabel(490, 10).label, "Overwhelmingly Positive");
    assert.equal(C.reviewLabel(45, 5).label, "Very Positive"); // 50 reviews at 90%
    assert.equal(C.reviewLabel(34, 6).label, "Positive");
    assert.equal(C.reviewLabel(28, 12).label, "Mostly Positive");
    assert.equal(C.reviewLabel(25, 25).label, "Mixed");
    assert.equal(C.reviewLabel(2, 18).label, "Negative");
    const next = C.nextLabel(40, 10); assert.equal(next.from, "Very Positive"); assert.equal(next.label, "Overwhelmingly Positive"); assert.ok(C.reviewLabel(40 + next.positives, 10).total >= 500);
    assert.deepEqual(C.nextLabel(5, 0).positives, 5);
});

test("break-even, wishlist and revenue figures are ranges that line up", () => {
    const b = C.breakEven({ budget: 30000, netPerCopy: 10 });
    assert.equal(b.copies, 3000); assert.ok(b.reviews.min < b.reviews.typical && b.reviews.typical < b.reviews.max);
    assert.ok(b.wishlists.min < b.wishlists.typical && b.wishlists.typical < b.wishlists.max);
    assert.equal(C.breakEven({ budget: 1, netPerCopy: 0 }), null);
    const w = C.wishlistSales({ wishlists: 10000 }); assert.equal(w.week.typical, 1200); assert.equal(w.year.typical, 3000);
    assert.equal(C.wishlistsFor({ copies: 3000 }).typical, 10000);
    const r = C.revenueFromReviews({ reviews: 100, price: 10 }); assert.equal(r.typical.copies, 3500); assert.equal(r.typical.net, 24500);
    assert.equal(C.conversionBand(1000, 150).name, "Good"); assert.equal(C.conversionBand(0, 5), null);
});

test("image stats and verdicts read dark, flat pictures as weak", () => {
    const dark = new Uint8ClampedArray(400).fill(20); for (let i = 3; i < 400; i += 4) dark[i] = 255;
    const st = C.imageStats(dark); assert.ok(st.brightness < 30 && st.contrast < 1);
    const v = C.capsuleVerdict(st); assert.equal(v[0][0], "bad"); assert.equal(v[1][0], "bad");
    const order = C.screenshotOrder([{ brightness: 30, contrast: 10, saturation: 5 }, { brightness: 120, contrast: 60, saturation: 40 }]);
    assert.deepEqual(order.order, [1, 0]); assert.deepEqual(order.dark, [0]);
});

test("cover crops fill the target without stretching and stay inside the picture", () => {
    const c = C.coverCrop(1920, 1080, 600, 900, 0.5, 0.5);
    assert.ok(Math.abs(c.sw / c.sh - 600 / 900) < 1e-9); assert.ok(c.sx >= 0 && c.sx + c.sw <= 1920 + 1e-6);
    assert.equal(C.coverCrop(1000, 1000, 1000, 500, 0.5, 0).sy, 0);
    assert.equal(C.CAPSULES.find(x => x.id === "header").w, 920);
});

test("the zip writer produces a real zip that unzip accepts", () => {
    const data = C.zip([{ name: "a.txt", data: new TextEncoder().encode("hello") }, { name: "b/c.bin", data: Uint8Array.from([1, 2, 3, 250]) }]);
    const dir = mkdtempSync(join(tmpdir(), "z-")), f = join(dir, "t.zip"); writeFileSync(f, data);
    try { const out = execFileSync("unzip", ["-t", f], { encoding: "utf8" }); assert.match(out, /No errors detected/); }
    catch (e) { if (e.code === "ENOENT") return; throw e; }
});

test("short description, tag and launch helpers", () => {
    const bad = C.gradeShortDescription("WELCOME TO THE BEST GAME EVER!!! You will love it!!!", "roguelike");
    assert.ok(bad.some(x => x[0] === "warn")); assert.equal(C.gradeShortDescription("", "")[0][0], "bad");
    assert.equal(C.gradeShortDescription("x".repeat(301))[0][0], "bad");
    const good = C.gradeShortDescription("A roguelike where every death rewrites the dungeon. Fight through shifting rooms, steal your enemies' powers and see how deep you can go before the map remembers you.", "roguelike");
    assert.ok(good.every(x => x[0] === "good"), JSON.stringify(good));
    const t = C.checkTags("Indie, Action, Singleplayer, Deckbuilder, Roguelike, Card Battler");
    assert.deepEqual(t.flagged, ["Indie", "Action", "Singleplayer"]); assert.equal(t.unused, 14); assert.deepEqual(t.reordered.slice(0, 3), ["Deckbuilder", "Roguelike", "Card Battler"]);
    const day = 86400000, ev = [{ name: "A", start: 100 * day, end: 107 * day }, { name: "B", start: 130 * day, end: 137 * day }];
    const ctx = C.launchContext(115 * day, ev); assert.equal(ctx.inside.length, 0); assert.equal(ctx.before.name, "A"); assert.equal(ctx.after.daysAway, 15);
    assert.equal(C.launchContext(103 * day, ev).inside[0].name, "A");
    assert.equal(C.demoOrPlaytest({ vertical: true, page: true, fest: true, feedback: false, stable: true }).pick, "demo");
    assert.equal(C.demoOrPlaytest({ vertical: false, page: false, fest: false, feedback: true, stable: false }).pick, "playtest");
});

test("X posts fit in 280 characters, counting every link as 23", () => {
    assert.equal(C.xLen("hi https://store.steampowered.com/app/123456/A_Very_Long_Name/ there"), 3 + 23 + 6);
    const short = C.xPost({ kind: "launch", name: "Turtle Farm", pitch: "A cozy farm.", url: "https://store.steampowered.com/app/1/", price: "$9.99", genre: "farming sim" });
    assert.ok(short.fits); assert.match(short.text, /Turtle Farm is out now on Steam for \$9.99/); assert.match(short.text, /#indiegame #Steam #farmingsim #indiedev$/);
    const long = C.xPost({ kind: "announce", name: "Turtle Farm", pitch: "word ".repeat(120), url: "https://store.steampowered.com/app/1/", genre: "x" });
    assert.ok(long.fits && long.text.includes("…") && long.length <= 280);
    assert.match(C.xPost({ kind: "saturday", name: "Z" }).text, /#ScreenshotSaturday #indiedev #gamedev$/);
    const wed = Date.UTC(2026, 10, 11), thu = Date.UTC(2026, 10, 12); // Nov 11 2026 is a Wednesday
    assert.match(C.xPost({ kind: "announce", name: "Z", now: wed }).text, /#WishlistWednesday/); assert.ok(!/WishlistWednesday/.test(C.xPost({ kind: "announce", name: "Z", now: thu }).text));
    assert.match(C.xPost({ kind: "sale", name: "Z" }).text, /#SteamSale/);
    assert.ok(C.xPost({ name: "Z", tags: "foo, #bar" }).text.endsWith("#foo #bar"));
});

test("every tool listed on the tools page has a working screen, and every screen is listed", async () => {
    const { INDIE_TOOLS, INDIE_CATS, indieSeo } = await import("../src/indiemeta.js");
    await import("../public/indietools.js");
    const ids = INDIE_TOOLS.map(t => t.id).sort();
    assert.deepEqual(globalThis.IndieTools.ids.slice().sort(), ids);
    assert.equal(new Set(ids).size, ids.length);
    for (const t of INDIE_TOOLS) { assert.ok(INDIE_CATS.some(c => c.id === t.cat), `${t.id} has a category`); assert.ok(indieSeo(`/indie/tools/${t.id}`), `${t.id} has its own search listing`); assert.ok(t.desc.length > 20); }
    assert.equal(indieSeo("/indie/tools/nope"), null);
});

test("next fest score rewards what's done, lists the biggest gaps first, and the trailer check flags dark or still openings", () => {
    const none = C.nextFestScore({}), all = C.nextFestScore({ ...Object.fromEntries(C.FEST_ITEMS.map(([id]) => [id, true])), wishlists: 9000 });
    assert.equal(none.score, 0); assert.equal(none.band, "Not yet"); assert.equal(all.score, 100); assert.equal(all.band, "Ready"); assert.equal(all.gaps.length, 0);
    assert.equal(none.gaps[0].id, "wishlists", "the heaviest missing piece is first");
    const dark = C.trailerOpening([{ second: 0, brightness: 10, motion: null }, { second: 1, brightness: 12, motion: 0.5 }, { second: 2, brightness: 20, motion: 1 }, { second: 3, brightness: 15, motion: 1 }]);
    assert.equal(dark.checks[0][0], "bad"); assert.equal(dark.checks[1][0], "bad");
    const lively = C.trailerOpening([{ second: 0, brightness: 120, motion: null }, { second: 1, brightness: 130, motion: 25 }, { second: 2, brightness: 110, motion: 30 }]);
    assert.deepEqual(lively.checks.map(c => c[0]), ["good", "good", "good"]);
    assert.equal(C.frameMotion(new Uint8Array(64).fill(10), new Uint8Array(64).fill(10)), 0);
    assert.ok(C.frameMotion(new Uint8Array(64).fill(0), new Uint8Array(64).fill(255)) > 90);
});

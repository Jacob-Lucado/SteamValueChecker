import test from "node:test";
import assert from "node:assert/strict";
import { summarize, buildRows, sortRows, totals, resolvePaid, savingsReport, isMajorStore } from "../src/report.js";
import { money, tableEmbed, summaryEmbed, toCsv, pageCount, ROWS_PER_PAGE } from "../src/render.js";

const deal = (shop, price, regular, cut = 0) => ({
    shop: { id: 1, name: shop }, price: { amount: price, currency: "USD" }, regular: { amount: regular, currency: "USD" }, cut
});
const entry = (deals, atl) => ({ id: "x", historyLow: atl == null ? undefined : { all: { amount: atl, currency: "USD" } }, deals });

test("summarize picks Steam price, MSRP and the cheapest store", () => {
    const s = summarize(entry([deal("Steam", 14.99, 24.99, 40), deal("Some Key Site", 9.5, 24.99, 62), deal("GOG", 12, 24.99, 52)], 8));
    assert.equal(s.msrp, 24.99);
    assert.equal(s.steam, 14.99);
    assert.equal(s.cut, 40);
    assert.deepEqual(s.best, { price: 9.5, shop: "Some Key Site", url: null });
    assert.equal(s.atl, 8);
    assert.equal(s.currency, "USD");
});

test("majorOnly ignores unknown key sites", () => {
    const e = entry([deal("Steam", 14.99, 24.99), deal("Some Key Site", 9.5, 24.99), deal("GOG", 12, 24.99)]);
    assert.deepEqual(summarize(e, { majorOnly: true }).best, { price: 12, shop: "GOG", url: null });
    assert.equal(isMajorStore("Green Man Gaming"), true);
    assert.equal(isMajorStore("Some Key Site"), false);
});

test("summarize copes with missing or odd data", () => {
    assert.equal(summarize(undefined).hasPrices, false);
    assert.equal(summarize({ deals: [{ shop: { name: "Steam" } }] }).steam, null);
    const noSteam = summarize(entry([deal("GOG", 10, 20)]));
    assert.equal(noSteam.steam, null);
    assert.equal(noSteam.msrp, 20);
});

const resolved = [
    { title: "A", id: "a", approx: false, matched: "A" },
    { title: "B", id: "b", approx: true, matched: "B Deluxe" },
    { title: "Ghost", id: null, approx: false, matched: "Ghost" }
];
const prices = new Map([
    ["a", entry([deal("Steam", 10, 20, 50), deal("GOG", 8, 20, 60)], 6)],
    ["b", entry([deal("Steam", 30, 30, 0)], 15)]
]);

test("buildRows, totals and sorting", () => {
    const rows = buildRows(resolved, prices);
    assert.equal(rows.length, 3);
    assert.equal(rows[2].found, false);
    const t = totals(rows);
    assert.equal(t.count, 3);
    assert.equal(t.found, 2);
    assert.equal(t.msrp, 50);
    assert.equal(t.steam, 40);
    assert.equal(t.best, 38);
    assert.equal(t.atl, 21);
    assert.deepEqual(sortRows(rows, "msrp").map(r => r.title), ["B", "A", "Ghost"]);
    assert.deepEqual(sortRows(rows, "name").map(r => r.title), ["A", "B", "Ghost"]);
    assert.deepEqual(sortRows(rows, "input").map(r => r.title), ["A", "B", "Ghost"]);
});

test("resolvePaid prefers the typed total, else the file amounts", () => {
    const rows = buildRows(resolved, prices, new Map([["A", 3], ["B", 7]]));
    assert.deepEqual(resolvePaid(25, rows), { total: 25, source: "entered" });
    assert.deepEqual(resolvePaid(null, rows), { total: 10, source: "file", games: 2 });
    assert.equal(resolvePaid(null, buildRows(resolved, prices)), null);
    assert.deepEqual(resolvePaid(0, rows), { total: 0, source: "entered" }); // a free bundle is valid
});

test("savingsReport math", () => {
    const rows = buildRows(resolved, prices);
    const t = totals(rows);
    const r = savingsReport({ total: 25, source: "entered" }, t, rows);
    const by = k => r.lines.find(l => l.key === k);
    assert.equal(by("msrp").diff, 25);
    assert.equal(Math.round(by("msrp").pct), 50);
    assert.equal(by("steam").diff, 15);
    assert.equal(by("best").diff, 13);
    assert.equal(by("atl").diff, -4);
    assert.equal(r.perGame, 12.5); // 25 across the 2 games found
    assert.match(r.verdict, /50% of MSRP/);
    assert.match(r.verdict, /less than the cheapest/);
});

test("savingsReport flags overpaying and best deals from per-game amounts", () => {
    const rows = buildRows(resolved, prices, new Map([["A", 12], ["B", 5]]));
    const t = totals(rows);
    const r = savingsReport(resolvePaid(null, rows), t, rows);
    assert.deepEqual(r.overpaid.map(x => x.title), ["A"]); // paid 12, cheapest now 8
    assert.equal(r.biggest[0].title, "B");                 // MSRP 30, paid 5
    assert.equal(savingsReport(null, t, rows), null);
});

test("rendering: money, table, summary, csv", () => {
    assert.equal(money(1234.5, "USD"), "$1,234.50");
    assert.equal(money(null), "-");

    const rows = buildRows(resolved, prices, new Map([["A", 3]]));
    const t = totals(rows);
    const table = tableEmbed(rows, 0, "USD");
    assert.match(table.description, /not found/);
    assert.match(table.description, /~B/);
    assert.match(table.description, /Paid/);
    assert.ok(table.description.length < 4096);

    const sum = summaryEmbed(t, savingsReport({ total: 25, source: "entered" }, t, rows), { region: "US", majorOnly: false });
    assert.ok(sum.fields.some(f => f.name === "Paid vs value"));
    assert.ok(sum.fields.every(f => f.value.length <= 1024));

    const csv = toCsv(rows, "USD");
    assert.ok(csv.startsWith("﻿"));
    assert.match(csv, /"Ghost","","no"/);
});

test("csv neutralises spreadsheet formulas in titles", () => {
    const rows = buildRows([{ title: "=HYPERLINK(\"x\")", id: null }], new Map());
    assert.match(toCsv(rows, "USD"), /"'=HYPERLINK/);
});

test("100 rows paginate and stay inside Discord limits", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
        title: `A fairly long game title number ${i}`, found: true, approx: i % 2 === 0, paid: 4.99,
        msrp: 1999.99, steam: 1999.99, cut: 0, best: { price: 1999.99, shop: "Humble Store" }, atl: 1, hasPrices: true, currency: "USD"
    }));
    assert.equal(pageCount(many), Math.ceil(100 / ROWS_PER_PAGE));
    const embed = tableEmbed(many, 0, "USD");
    assert.ok(embed.description.length < 4096, `description is ${embed.description.length} chars`);
});

import test from "node:test";
import assert from "node:assert/strict";
import { containsKey, parseMoney, splitCsvLine, parseUpload, parseTyped, sanitize } from "../src/parse.js";

test("containsKey flags real-looking keys but not hyphenated titles", () => {
    assert.equal(containsKey("C0WNB-VLC8R-Z7FWB"), true);
    assert.equal(containsKey("Meltopia | C0WNB-VLC8R-Z7FWB"), true);
    assert.equal(containsKey("AAAAA-BBBBB-CCCCC-DDDDD-EEEEE"), false); // letters only: treated as a title
    assert.equal(containsKey("Half-Life-Alyx"), false);
    assert.equal(containsKey("Hades"), false);
});

test("parseMoney handles common formats", () => {
    assert.equal(parseMoney("$12.50"), 12.5);
    assert.equal(parseMoney("12,50"), 12.5);
    assert.equal(parseMoney("1.234,56"), 1234.56);
    assert.equal(parseMoney("1,234"), 1234);
    assert.equal(parseMoney("0"), 0);
    assert.equal(parseMoney("free"), null);
    assert.equal(parseMoney("-5"), null);
    assert.equal(parseMoney(null), null);
});

test("splitCsvLine honours quotes", () => {
    assert.deepEqual(splitCsvLine('"Hades, the game",KEY,"say ""hi"""'), ["Hades, the game", "KEY", 'say "hi"']);
});

test("CSV export: reads titles and never returns the key column", () => {
    const csv = '﻿"Game","Key"\r\n"Meltopia","C0WNB-VLC8R-Z7FWB"\r\n"Hades","AAAAA-11111-BBBBB"\r\n';
    const out = parseUpload(csv, "FanaticalGrabber_2026-10-26.csv");
    assert.deepEqual(out.map(e => e.title), ["Meltopia", "Hades"]);
    assert.ok(out.every(e => !JSON.stringify(e).includes("C0WNB")));
});

test("CSV with a Paid column", () => {
    const out = parseUpload("Game,Key,Paid\nHades,X,$4.99\nCeleste,Y,\n", "x.csv");
    assert.deepEqual(out, [{ title: "Hades", paid: 4.99 }, { title: "Celeste", paid: null }]);
});

test("JSON export shapes", () => {
    const a = parseUpload(JSON.stringify({ exportedAt: "x", count: 2, keys: [{ game: "A", key: "K1" }, { game: "B", key: "K2" }] }), "x.json");
    assert.deepEqual(a.map(e => e.title), ["A", "B"]);
    const b = parseUpload(JSON.stringify(["One", "Two"]), "x.json");
    assert.deepEqual(b.map(e => e.title), ["One", "Two"]);
});

test("TXT export: only the list between the separators, title part only", () => {
    const txt = [
        "FanaticalGrabber", "© 2026 Jacob Lucado", "", "Fanatical Key Export Report", "", "Export Date: 10/26/2026", "",
        "========================================", "",
        "Meltopia | C0WNB-VLC8R-Z7FWB", "Hades | AAAAA-11111-BBBBB", "",
        "========================================", "", "Games Exported: 2", "Created By: Jacob Lucado"
    ].join("\n");
    assert.deepEqual(parseUpload(txt, "x.txt").map(e => e.title), ["Meltopia", "Hades"]);
});

test("Markdown export table", () => {
    const md = "# Fanatical Keys\n\nExported now\n\n| Game | Key |\n| --- | --- |\n| Hades | `AAAAA-11111-BBBBB` |\n| A \\| B | `CCCCC-22222-DDDDD` |\n";
    assert.deepEqual(parseUpload(md, "x.md").map(e => e.title), ["Hades", "A | B"]);
});

test("parseTyped splits on ; and newlines", () => {
    assert.deepEqual(parseTyped("Hades; Celeste\nHollow Knight;").map(e => e.title), ["Hades", "Celeste", "Hollow Knight"]);
    assert.deepEqual(parseTyped(null), []);
});

test("sanitize drops keys, dedupes, caps and reports", () => {
    const r = sanitize([
        { title: "Hades", paid: 5 }, { title: "hades", paid: null }, { title: "AAAAA-11111-BBBBB" },
        { title: "  Celeste  " }, { title: "x".repeat(300) }
    ], { max: 2 });
    assert.equal(r.sawKeys, true);
    assert.equal(r.truncated, true);
    assert.deepEqual(r.entries.map(e => e.title), ["Hades", "Celeste"]);
    assert.equal(r.entries[0].paid, 5);
});

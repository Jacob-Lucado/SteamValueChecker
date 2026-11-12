import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { ORDER, buildPack } from "../src/dashi18n.js";
import { LANGS, DISCORD_LOCALE, tr, dictionary, languageDone, localizeCommands } from "../src/i18n.js";
import { hubCommands } from "../src/commands.js";
import { prefsPatch } from "../src/prefs.js";

test("bot languages: twelve, each with every button and a confirmation of its own", () => {
    assert.deepEqual(Object.keys(LANGS), ["en", "es", "fr", "de", "pt", "it", "ru", "pl", "tr", "ja", "ko", "zh"]);
    const keys = Object.keys(dictionary("es"));
    for (const l of Object.keys(LANGS).filter(l => l !== "en")) {
        assert.deepEqual(Object.keys(dictionary(l)), keys, l);
        assert.ok(Object.values(dictionary(l)).every(v => typeof v === "string" && v.length > 0 && v.length <= 80), `${l} has an empty or too long label`);
        assert.notEqual(languageDone(l), languageDone("en"), l);
    }
    assert.equal(tr("de", "View deal"), "Angebot ansehen");
    assert.equal(tr("xx", "View deal"), "View deal");
    assert.equal(tr("fr", "Nav:Library"), "Bibliothèque");
});

test("/language is a command with every language as a choice, and /alerts language matches", () => {
    const lang = hubCommands.find(c => c.name === "language");
    assert.ok(lang);
    assert.deepEqual(lang.options[0].choices.map(c => c.value), Object.keys(LANGS));
    const alerts = hubCommands.find(c => c.name === "alerts").options.find(o => o.name === "language");
    assert.deepEqual(alerts.options[0].choices.map(c => c.value), Object.keys(LANGS));
    for (const l of Object.keys(LANGS)) assert.deepEqual(prefsPatch({ lang: l }, {}), { lang: l });
});

test("command descriptions are localized for Discord without touching names, options or the originals", () => {
    const before = JSON.stringify(hubCommands);
    const out = localizeCommands(hubCommands);
    assert.equal(JSON.stringify(hubCommands), before, "the source commands are left alone");
    assert.deepEqual(out.map(c => c.name), hubCommands.map(c => c.name));
    const games = out.find(c => c.name === "games");
    assert.deepEqual(Object.keys(games.description_localizations).sort(), Object.values(DISCORD_LOCALE).sort());
    assert.match(games.description_localizations.de, /Preise/);
    for (const c of out) {
        for (const d of [c, ...(c.options ?? []).filter(o => o.type === 1 || o.type === 2)]) {
            for (const [loc, text] of Object.entries(d.description_localizations ?? {})) assert.ok(text.length >= 1 && text.length <= 100, `${c.name} ${loc}`);
        }
    }
    assert.ok(out.find(c => c.name === "language").description_localizations.ja);
    assert.ok(games.options.find(o => o.name === "menu").description_localizations.ko);
});

// The page's helper with every language's file loaded the way the server serves them.
function pageHelper({ language = "en", stored = null, added = [] } = {}) {
    const w = { localStorage: { getItem: () => stored, setItem() {} }, navigator: { language, languages: [language] }, document: { head: { appendChild: el => added.push(el.src) }, createElement: () => ({}), documentElement: {}, addEventListener() {} } };
    w.window = w;
    vm.runInNewContext(readFileSync(new URL("../public/i18n.js", import.meta.url), "utf8"), w);
    return w;
}
function withAll(w) { for (const code of ORDER) vm.runInNewContext(buildPack(code), w); return w.SVC_I18N; }

test("dashboard phrases: every language has every phrase, and unknown text stays as it is", () => {
    const I = withAll(pageHelper({ language: "de-DE" }));
    assert.deepEqual(Object.keys(I.LANGS), Object.keys(LANGS));
    const base = Object.keys(I._dict.es);
    assert.ok(base.length > 550, `only ${base.length} strings`);
    for (const l of Object.keys(LANGS).filter(l => l !== "en")) {
        assert.deepEqual(Object.keys(I._dict[l]), base, l);
        assert.ok(Object.values(I._dict[l]).every(v => typeof v === "string" && v.trim()), `${l} has a blank phrase`);
    }
    assert.equal(I.pick(), "de", "a German browser starts in German");
    assert.equal(I.tx("ja", "Wishlist"), "ウィッシュリスト");
    assert.equal(I.tx("ja", "Something not listed"), "Something not listed");
    assert.equal(I.tx("en", "Wishlist"), "Wishlist");
    assert.equal(I.tx("de", 42), 42);
    assert.equal(I.tx("constructor", "Wishlist"), "Wishlist");
});

test("dashboard translations: patterns work and key pages are covered in every language", () => {
    const I = withAll(pageHelper());
    for (const l of ORDER) {
        for (const t of ["Giveaway overlay", "Nobody is streaming right now.", "Server only", "Move up"]) assert.notEqual(I.tx(l, t), t, `${l}: ${t}`);
    }
    assert.equal(I.tx("de", "Server only"), "Nur Server");
    assert.equal(I.tx("en", "Server only"), "Server only");
    assert.equal(I.tx("es", "Something never translated"), "Something never translated");
    assert.equal(I.tx("es", "20% off"), "20% de descuento");
});

test("dashboard translations: a language that has not loaded yet stays in English, and only its own file is fetched", () => {
    const added = [], w = pageHelper({ language: "ja", added });
    assert.deepEqual(added, ["/i18n-ja.js"], "a Japanese browser asks for its language file as soon as the page starts");
    const I = w.SVC_I18N;
    assert.equal(I.tx("ja", "Wishlist"), "Wishlist", "nothing loaded yet");
    I.load("ja"); I.load("ja"); I.load("en"); I.load("nope");
    assert.deepEqual(added, ["/i18n-ja.js"], "one request, for the reader's own language");
    vm.runInNewContext(buildPack("ja"), w);
    assert.equal(I.tx("ja", "Wishlist"), "ウィッシュリスト");
    assert.ok(buildPack("ja").length < 200_000, "a single language file stays small");
    assert.equal(buildPack("xx"), null);
});

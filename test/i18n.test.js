import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
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

test("dashboard phrases: every language has every phrase, and unknown text stays as it is", () => {
    const sandbox = { window: {}, navigator: { language: "de-DE", languages: ["de-DE"] }, localStorage: { getItem: () => null, setItem() {} } };
    vm.runInNewContext(readFileSync(new URL("../public/i18n.js", import.meta.url), "utf8"), sandbox);
    const I = sandbox.window.SVC_I18N;
    assert.deepEqual(Object.keys(I.LANGS), Object.keys(LANGS));
    const base = Object.keys(I._dict.es);
    assert.ok(base.length > 150);
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

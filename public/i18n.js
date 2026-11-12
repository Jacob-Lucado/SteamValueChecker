// Dashboard languages. This small file holds the language list and the lookup; the phrases for each language are a separate file
// (/i18n-<code>.js, cut out of src/dashi18n.js by the server) that is fetched only when that language is in use, so an English reader
// downloads none of them. Anything without a translation stays in English.
(function () {
  var LANGS = { en: "English", es: "Español", fr: "Français", de: "Deutsch", pt: "Português", it: "Italiano", ru: "Русский", pl: "Polski", tr: "Türkçe", ja: "日本語", ko: "한국어", zh: "中文" };
  var KEY = "svc_lang";
  var dict = { en: {} }, pats = {}, loading = {};

  function valid(code) { return Object.prototype.hasOwnProperty.call(LANGS, code); }
  function fromBrowser() {
    var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"];
    for (var i = 0; i < list.length; i++) {
      var short = String(list[i]).toLowerCase().split("-")[0];
      if (valid(short)) return short;
    }
    return "en";
  }
  function saved() { try { var v = localStorage.getItem(KEY); return valid(v) ? v : null; } catch (e) { return null; } }
  function remember(code) { try { localStorage.setItem(KEY, code); } catch (e) { /* private window */ } }

  // Called by the language file itself.
  function pack(code, words, patterns) {
    dict[code] = words;
    pats[code] = patterns.map(function (p) { return { re: new RegExp(p[0]), to: p[1] }; });
  }

  // Resolves when the language is ready to use. A language that fails to load simply stays in English.
  function load(code) {
    if (!valid(code) || code === "en" || dict[code]) return Promise.resolve();
    if (loading[code]) return loading[code];
    loading[code] = new Promise(function (done) {
      var s = document.createElement("script");
      s.src = "/i18n-" + code + ".js";
      s.onload = s.onerror = function () { done(); };
      document.head.appendChild(s);
    });
    return loading[code];
  }

  window.SVC_I18N = {
    LANGS: LANGS,
    valid: valid,
    pick: function () { return saved() || fromBrowser(); },
    hasChoice: function () { return saved() !== null; },
    remember: remember,
    pack: pack,
    load: load,
    _dict: dict,
    tx: function (lang, text) {
      if (lang === "en" || typeof text !== "string") return text;
      if (!valid(lang)) return text;
      var d = dict[lang];
      if (!d) return text;
      if (Object.prototype.hasOwnProperty.call(d, text)) return d[text];
      var list = pats[lang] || [];
      for (var i = 0; i < list.length; i++) {
        var m = list[i].re.exec(text);
        if (m) return list[i].to.replace(/\$(\d)/g, function (_, n) { var c = m[Number(n)]; return Object.prototype.hasOwnProperty.call(d, c) ? d[c] : c; });
      }
      return text;
    }
  };

  // Start fetching the reader's language straight away, in parallel with the rest of the page.
  var first = window.SVC_I18N.pick();
  if (first !== "en") load(first);
})();

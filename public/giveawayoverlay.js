// Giveaway overlay for OBS. The look is set in the address (style, theme, anchor, scale, accent, font, toggles); the numbers come from the bot.
(() => {
  "use strict";
  const q = new URLSearchParams(location.search);
  const pick = (k, list, d) => (list.includes(q.get(k)) ? q.get(k) : d);
  const num = (k, d, lo, hi) => { const v = Number(q.get(k)); return q.get(k) !== null && q.get(k) !== "" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  const on = (k, d) => (q.has(k) ? q.get(k) !== "0" : d);
  const cfg = { token: q.get("token") || "", demo: q.has("demo") && q.get("demo") !== "0", style: pick("style", ["card", "bar", "mini"], "card"), theme: pick("theme", ["dark", "light", "glass", "neon", "clear"], "dark"),
    anchor: pick("anchor", ["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"], "tr"), font: pick("font", ["system", "rounded", "mono", "serif"], "system"), scale: num("scale", 1, 0.5, 3),
    accent: /^[0-9a-fA-F]{6}$/.test(q.get("accent") || "") ? "#" + q.get("accent") : "#4da3ff", entries: on("entries", true), timer: on("timer", true), bar: on("bar", true), steps: on("steps", true),
    prizes: on("prizes", true), winners: on("winners", true), hide: on("hide", false), join: (q.get("join") || "").slice(0, 80), label: (q.get("label") || "").slice(0, 40), hold: num("hold", 60, 5, 600) };
  const root = document.getElementById("gw");
  root.dataset.theme = cfg.theme; root.dataset.style = cfg.style; root.dataset.font = cfg.font;
  root.dataset.anchor = [cfg.anchor[0] === "t" ? "t" : cfg.anchor[0] === "m" ? "m" : "b", cfg.anchor[1] === "l" ? "l" : cfg.anchor[1] === "r" ? "r" : "c"].join(" ");
  root.style.setProperty("--accent", cfg.accent); root.style.zoom = String(cfg.scale);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const DEMO = () => ({ giveaway: { title: "Stream giveaway: Hades II", prizes: ["Hades II", "Celeste"], entries: 128, endsAt: Date.now() + 47 * 60_000 + 12_000, startedAt: Date.now() - 13 * 60_000, status: "active",
    steps: [{ label: "Follow on Twitch" }, { label: "Join the Discord" }], winners: [] }, now: Date.now() });
  const clock = ms => { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };

  let data = null, skew = 0, box = null, built = "", lastEntries = -1, endedSeen = 0, parts = {};
  const sig = d => JSON.stringify([d.title, d.prizes, d.steps, d.status, d.winners, d.endsAt]);

  function build(d) {
    const b = el("div", "gbox"), body = el("div", "gbody");
    parts = {};
    const ended = d.status === "ended";
    if (cfg.style !== "mini") body.append(el("div", "gtag", ended ? "Winners" : cfg.label || "Giveaway"));
    body.append(el("div", "gname", ended ? "Congratulations!" : d.title));
    if (ended && cfg.winners) {
      if (d.winners.length) for (const w of d.winners.slice(0, 6)) { const p = el("div", "win", w.name); if (d.winners.length > 1 || w.prize) p.append(el("small", null, w.prize)); body.append(p); }
      else body.append(el("div", "prize", "No winner this time."));
    } else if (!ended && cfg.prizes && d.prizes.length) body.append(el("div", "prize", d.prizes.length > 3 ? d.prizes.slice(0, 3).join(", ") + " + " + (d.prizes.length - 3) + " more" : d.prizes.join(", ")));
    if (!ended) {
      const stats = el("div", "stats");
      if (cfg.entries) { const s = el("div", "stat"), n = el("b", null, "0"); s.append(n, el("span", null, "Entries")); parts.entries = n; stats.append(s); }
      if (cfg.timer) { const s = el("div", "stat"), n = el("b", null, "--"); s.append(n, el("span", null, "Time left")); parts.timer = n; stats.append(s); }
      if (stats.children.length) body.append(stats);
      if (cfg.bar && cfg.timer) { const t = el("div", "track"), i = el("i"); t.append(i); parts.bar = i; body.append(t); }
      if (cfg.steps && d.steps.length) { const ul = el("ul", "steps"); for (const s of d.steps.slice(0, 5)) ul.append(el("li", null, s.label)); body.append(ul); }
      if (cfg.join) body.append(el("div", "how", cfg.join));
    }
    b.append(body); return b;
  }
  function tick() {
    const d = data?.giveaway;
    if (!d) { if (box) { const old = box; box = null; built = ""; old.classList.remove("in"); setTimeout(() => old.remove(), 500); } return; }
    if (d.status === "ended") { if (!endedSeen) endedSeen = Date.now(); if (cfg.hide && Date.now() - endedSeen > cfg.hold * 1000) { data = { giveaway: null }; return tick(); } } else endedSeen = 0;
    const s = sig(d);
    if (s !== built) {
      const next = build(d), old = box; built = s;
      if (old) { old.classList.remove("in"); setTimeout(() => old.remove(), 500); }
      root.append(next); requestAnimationFrame(() => requestAnimationFrame(() => { next.classList.add("in"); if (d.status === "ended") next.classList.add("pop"); })); box = next; lastEntries = -1;
    }
    if (parts.entries && d.entries !== lastEntries) { parts.entries.textContent = String(d.entries); if (lastEntries >= 0) { box.classList.remove("pop"); void box.offsetWidth; box.classList.add("pop"); } lastEntries = d.entries; }
    if (d.status !== "ended") {
      const left = d.endsAt - (Date.now() + skew);
      if (parts.timer) parts.timer.textContent = left > 0 ? clock(left) : "Drawing…";
      if (parts.bar) { const total = d.endsAt - (d.startedAt || d.endsAt - 3600_000); parts.bar.style.width = Math.max(0, Math.min(100, (1 - left / Math.max(1, total)) * 100)).toFixed(1) + "%"; }
    }
  }
  async function load() {
    if (cfg.demo) { if (!data) { data = DEMO(); if (q.get("demo") === "ended") Object.assign(data.giveaway, { status: "ended", winners: [{ prize: "Hades II", name: "SomeViewer" }, { prize: "Celeste", name: "AnotherFan" }] }); } return; }
    if (!cfg.token) return;
    try {
      const r = await fetch("/api/giveawayoverlay/data?token=" + encodeURIComponent(cfg.token), { cache: "no-store" });
      if (r.ok) { data = await r.json(); if (data.now) skew = data.now - Date.now(); } else if (r.status === 404) data = { giveaway: null };
    } catch { /* keep what we have */ }
  }
  (async () => { await load(); tick(); setInterval(tick, 1000); setInterval(load, 5000); })();
})();

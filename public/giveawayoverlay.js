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
    prizes: on("prizes", true), winners: on("winners", true), hide: on("hide", false), join: (q.get("join") || "").slice(0, 80), label: (q.get("label") || "").slice(0, 40), hold: num("hold", 60, 5, 600), every: num("every", 8, 3, 60), dots: on("dots", true), chat: on("chat", true) };
  const root = document.getElementById("gw");
  root.dataset.theme = cfg.theme; root.dataset.style = cfg.style; root.dataset.font = cfg.font;
  root.dataset.anchor = [cfg.anchor[0] === "t" ? "t" : cfg.anchor[0] === "m" ? "m" : "b", cfg.anchor[1] === "l" ? "l" : cfg.anchor[1] === "r" ? "r" : "c"].join(" ");
  root.style.setProperty("--accent", cfg.accent); root.style.zoom = String(cfg.scale);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const DEMO = () => { const t = Date.now(); return { giveaways: [
    { id: 1, title: "Stream giveaway: Hades II", prizes: ["Hades II", "Celeste"], entries: 128, endsAt: t + 47 * 60_000 + 12_000, startedAt: t - 13 * 60_000, status: "active", steps: [{ label: "Follow on Twitch" }, { label: "Join the Discord" }], winners: [], chat: true },
    { id: 2, title: "Weekend key drop", prizes: ["Balatro"], entries: 54, endsAt: t + 5 * 3600_000, startedAt: t - 3600_000, status: "active", steps: [{ label: "Wishlist on Steam" }], winners: [] },
    { id: 3, title: "Subscriber thank-you", prizes: ["Discord Nitro"], entries: 301, endsAt: t + 22 * 60_000, startedAt: t - 98 * 60_000, status: "active", steps: [], winners: [] }], now: t }; };
  const clock = ms => { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };

  let list = [], skew = 0, idx = 0, box = null, shownId = 0, shownSig = "", lastEntries = -1, parts = {}, dotsEl = null, endedSeen = new Map();
  const sig = d => JSON.stringify([d.id, d.title, d.prizes, d.steps, d.status, d.winners, d.endsAt, d.chat]);

  function build(d, dir) {
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
      if (d.chat && cfg.chat) body.append(el("div", "how", "Type !enter in chat to join"));
      if (cfg.join) body.append(el("div", "how", cfg.join));
    }
    b.append(body); if (dir) b.classList.add(dir); return b;
  }
  function drawDots() {
    if (!cfg.dots || list.length < 2) { dotsEl?.remove(); dotsEl = null; return; }
    if (!dotsEl) { dotsEl = el("div", "dots"); root.append(dotsEl); }
    while (dotsEl.children.length < list.length) dotsEl.append(el("i"));
    while (dotsEl.children.length > list.length) dotsEl.lastChild.remove();
    [...dotsEl.children].forEach((d, i) => d.classList.toggle("on", i === idx));
  }
  /** Puts giveaway `idx` on screen. `slide` makes the old one leave to the left while the new one comes in from the right. */
  function show(slide) {
    const d = list[idx];
    if (!d) { if (box) { const old = box; box = null; shownId = 0; shownSig = ""; old.classList.remove("in"); setTimeout(() => old.remove(), 600); } drawDots(); return; }
    const next = build(d, slide ? "from-r" : ""), old = box;
    shownId = d.id; shownSig = sig(d); lastEntries = -1;
    if (old) { old.classList.remove("in"); if (slide) old.classList.add("to-l"); setTimeout(() => old.remove(), 650); }
    (dotsEl ? root.insertBefore(next, dotsEl) : root.append(next));
    requestAnimationFrame(() => requestAnimationFrame(() => { next.classList.add("in"); next.classList.remove("from-r"); if (d.status === "ended" && !slide) next.classList.add("pop"); }));
    box = next; drawDots();
  }
  function tick() {
    const d = list[idx];
    if (!d) { if (box) show(false); return; }
    if (d.status === "ended" && cfg.hide) {
      if (!endedSeen.has(d.id)) endedSeen.set(d.id, Date.now());
      if (Date.now() - endedSeen.get(d.id) > cfg.hold * 1000) { list.splice(idx, 1); idx = list.length ? idx % list.length : 0; show(Boolean(list.length)); return; }
    }
    if (d.id !== shownId || sig(d) !== shownSig) show(false);
    if (parts.entries && d.entries !== lastEntries) { parts.entries.textContent = String(d.entries); if (lastEntries >= 0) { box.classList.remove("pop"); void box.offsetWidth; box.classList.add("pop"); } lastEntries = d.entries; }
    if (d.status !== "ended") {
      const left = d.endsAt - (Date.now() + skew);
      if (parts.timer) parts.timer.textContent = left > 0 ? clock(left) : "Drawing…";
      if (parts.bar) { const total = d.endsAt - (d.startedAt || d.endsAt - 3600_000); parts.bar.style.width = Math.max(0, Math.min(100, (1 - left / Math.max(1, total)) * 100)).toFixed(1) + "%"; }
    }
  }
  function rotate() { if (list.length < 2) return; idx = (idx + 1) % list.length; show(true); }
  /** New numbers from the bot: keep the same giveaway on screen when it is still in the list, and update the live stats in place. */
  function take(next) {
    const cur = list[idx]?.id;
    list = next;
    const at = list.findIndex(x => x.id === cur);
    idx = at >= 0 ? at : 0;
    drawDots();
  }
  async function load() {
    if (cfg.demo) { if (!list.length) { const d = DEMO(); list = d.giveaways; if (q.get("demo") === "ended") Object.assign(list[0], { status: "ended", winners: [{ prize: "Hades II", name: "SomeViewer" }, { prize: "Celeste", name: "AnotherFan" }] }); if (q.get("demo") === "one") list = list.slice(0, 1); } else for (const g of list) if (g.status !== "ended") g.entries += Math.random() < 0.5 ? 1 : 0; return; }
    if (!cfg.token) return;
    try {
      const r = await fetch("/api/giveawayoverlay/data?token=" + encodeURIComponent(cfg.token), { cache: "no-store" });
      if (r.ok) { const d = await r.json(); if (d.now) skew = d.now - Date.now(); take(Array.isArray(d.giveaways) ? d.giveaways : []); } else if (r.status === 404) take([]);
    } catch { /* keep what we have */ }
  }
  (async () => { await load(); tick(); setInterval(tick, 1000); setInterval(load, 5000); setInterval(rotate, cfg.every * 1000); })();
})();

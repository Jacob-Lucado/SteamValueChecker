// A goal bar, server stats or a timer for OBS. The look comes from the overlay's saved settings (or, in the studio preview, from the address).
(() => {
  "use strict";
  const q = new URLSearchParams(location.search);
  const root = document.getElementById("ov");
  const FONTS = { Inter: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif", System: "system-ui, -apple-system, 'Segoe UI', sans-serif", Georgia: "Georgia, 'Times New Roman', serif", Mono: "ui-monospace, Menlo, Consolas, monospace" };
  const demo = q.get("demo") === "1";
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const n = v => Number(v ?? 0).toLocaleString("en-US");
  const hexOk = v => /^#[0-9a-f]{6}$/i.test(v) ? v : null;
  let state = null, offset = 0, tick = 0, poll = 0;

  function look(c) {
    const s = root.style;
    s.setProperty("--accent", hexOk(c.accent) || "#5865f2"); s.setProperty("--text", hexOk(c.text) || "#ffffff"); s.setProperty("--muted", hexOk(c.muted) || "#94a3b8");
    s.setProperty("--bg", hexOk(c.bg) || "#0b0e14"); s.setProperty("--border", hexOk(c.border) || "#1e2638");
    s.setProperty("--bgop", Math.max(0, Math.min(100, Number(c.bgOpacity ?? 85))) + "%"); s.setProperty("--font", FONTS[c.font] || FONTS.Inter);
    s.setProperty("--radius", Math.max(0, Math.min(40, Number(c.radius ?? 16))) + "px"); s.setProperty("--pad", Math.max(4, Math.min(48, Number(c.padding ?? 20))) + "px");
    s.setProperty("--scale", String(Math.max(0.5, Math.min(3, Number(c.scale ?? 1)))));
  }

  const two = v => String(v).padStart(2, "0");
  function clock(ms) {
    const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return (d ? d + "d " : "") + two(h) + ":" + two(m) + ":" + two(s % 60);
  }

  function draw() {
    if (!state) return;
    const { kind, config: c, data: d } = state;
    look(c);
    const card = el("div", "card" + (c.showBorder ? " bordered" : "") + (c.shadow ? " shadow" : ""));
    if (kind === "goal") {
      const head = el("div", "head"); head.append(el("div", "label", c.label || "Goal"));
      const nums = el("div", "nums"); const cur = el("b", "", n(d.current));
      if (d.current >= d.target && c.doneText) nums.append(el("b", "", c.doneText)); else nums.append(cur, document.createTextNode(" / " + n(d.target) + (c.unit ? " " + c.unit : "")));
      head.append(nums);
      const track = el("div", "track"), fill = el("div", "fill"); track.append(fill);
      card.append(head, track);
      if (c.showPercent) card.append(el("div", "pct", d.pct + "%"));
      requestAnimationFrame(() => { fill.style.width = d.pct + "%"; });
    } else if (kind === "stats") {
      if (c.label) { const head = el("div", "head"); head.append(el("div", "label", c.label)); card.append(head); }
      const tiles = el("div", "tiles");
      if (c.showMembers && d.members != null) { const t = el("div", "tile"); t.append(el("b", "", n(d.members)), el("span", "", c.membersLabel)); tiles.append(t); }
      if (c.showBoosts && d.boosts != null) { const t = el("div", "tile accent"); t.append(el("b", "", n(d.boosts)), el("span", "", c.boostsLabel)); tiles.append(t); }
      if (!tiles.children.length) tiles.append(el("div", "nums", "Nothing to show yet"));
      card.append(tiles);
    } else if (kind === "timer") {
      const head = el("div", "head sub"); head.style.justifyContent = "center"; head.append(el("div", "label", c.label || ""));
      const big = el("div", "clock"); card.append(head, big);
      const paint = () => {
        const at = Date.now() + offset, ms = c.mode === "countdown" ? c.at - at : at - c.at;
        if (!c.at) { big.textContent = "00:00:00"; return; }
        if (c.mode === "countdown" && ms <= 0) { big.textContent = c.endText || "00:00:00"; big.classList.add("done"); head.classList.add("hide"); return; }
        big.classList.remove("done"); head.classList.remove("hide"); big.textContent = clock(Math.max(0, ms));
      };
      paint(); clearInterval(tick); tick = setInterval(paint, 250);
    }
    root.replaceChildren(card);
  }

  async function load() {
    try {
      const r = await fetch("/api/ov/data?token=" + encodeURIComponent(q.get("token") || ""), { cache: "no-store" });
      if (!r.ok) { root.replaceChildren(); return; }
      const j = await r.json(); offset = j.now - Date.now();
      const same = state && JSON.stringify(state.data) === JSON.stringify(j.data) && JSON.stringify(state.config) === JSON.stringify(j.config);
      state = j; if (!same) draw();
      poll = setTimeout(load, Math.max(5, Math.min(120, Number(j.config.refresh) || 10)) * 1000);
    } catch { poll = setTimeout(load, 15000); }
  }

  if (demo) {
    // The studio preview: everything comes from the address, nothing is fetched.
    let c = {}, v = {}; try { c = JSON.parse(q.get("c") || "{}"); v = JSON.parse(q.get("v") || "{}"); } catch { /* an empty preview is fine */ }
    const kind = ["goal", "stats", "timer"].includes(q.get("k")) ? q.get("k") : "goal";
    const target = Math.max(1, Number(c.target) || 100), current = Number(v.current) || 0;
    const data = kind === "goal" ? { current, target, pct: Math.max(0, Math.min(100, Math.round(current / target * 100))) }
      : kind === "stats" ? { members: v.members ?? null, boosts: v.boosts ?? null } : { at: c.at, mode: c.mode };
    state = { kind, config: c, data };
    draw();
  } else load();
})();

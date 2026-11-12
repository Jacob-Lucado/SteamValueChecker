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
  let state = null, offset = 0, poll = 0;

  function look(c, target = root) {
    const s = target.style;
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

  /** One card for one overlay. Used on its own and, for a scene, once per overlay in the rotation. */
  function build(kind, c, d, timers) {
    const card = el("div", "card" + (c.showBorder ? " bordered" : "") + (c.shadow ? " shadow" : ""));
    look(c, card);
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
    } else if (kind === "poll") {
      const head = el("div", "head"); head.append(el("div", "label", d.on ? d.question : "No poll running")); card.append(head);
      if (d.on) {
        const top = Math.max(0, ...d.options.map(o => o.count)), rows = el("div", "bars");
        d.options.forEach(o => {
          const pct = d.total ? Math.round(o.count / d.total * 100) : 0, row = el("div", "bar" + (!d.open && o.count === top && top > 0 ? " win" : ""));
          const top2 = el("div", "bartop"); top2.append(el("span", "who", o.title), el("span", "val", o.count + (c.showPercent ? " · " + pct + "%" : "")));
          const track = el("div", "track"), fill = el("div", "fill"); track.append(fill); row.append(top2, track); rows.append(row);
          requestAnimationFrame(() => { fill.style.width = pct + "%"; });
        });
        card.append(rows);
        const foot = el("div", "pct"); foot.style.textAlign = "left";
        const paint = () => { const ms = d.until - (Date.now() + offset); foot.textContent = d.total + (d.total === 1 ? " vote" : " votes") + (d.open && ms > 0 ? " · " + clock(ms).replace(/^00:/, "") + " left" : " · voting closed"); };
        paint(); timers.push(setInterval(paint, 1000)); card.append(foot);
      } else card.append(el("div", "nums", "Start one in the Overlay studio"));
    } else if (kind === "board") {
      const head = el("div", "head"); head.append(el("div", "label", c.label || "Top members")); card.append(head);
      const rows = el("div", "rows");
      (d.rows || []).forEach((r, i) => { const row = el("div", "row"); row.append(el("span", "rank", String(i + 1)), el("span", "who", r.name), el("span", "val", (c.showLevel ? "Lv " + r.level + " · " : "") + n(r.xp) + " XP")); rows.append(row); });
      if (!(d.rows || []).length) rows.append(el("div", "nums", "No one has earned XP yet"));
      card.append(rows);
    } else if (kind === "deals") {
      const head = el("div", "head"); head.append(el("div", "label", c.label || "Best deals right now")); card.append(head);
      const rows = el("div", "rows");
      const money = (v, cur) => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur || "USD" }).format(v); } catch { return String(v); } };
      (d.deals || []).forEach(g => { const row = el("div", "row"); row.append(el("span", "who", g.title), el("span", "val", "-" + g.cut + "% · " + money(g.price, g.currency))); rows.append(row); });
      if (!(d.deals || []).length) rows.append(el("div", "nums", "Loading the best deals…"));
      card.append(rows);
    } else if (kind === "free") {
      const head = el("div", "head"); head.append(el("div", "label", c.label || "Free right now")); card.append(head);
      const rows = el("div", "rows");
      (d.games || []).forEach(g => { const row = el("div", "row"); const left = g.expiry ? Math.max(0, Date.parse(g.expiry) - Date.now()) : 0; const days = Math.floor(left / 86400000), hrs = Math.floor(left % 86400000 / 3600000); row.append(el("span", "who", g.title), el("span", "val", g.shop + (g.expiry && left ? " · " + (days ? days + "d " : "") + hrs + "h left" : ""))); rows.append(row); });
      if (!(d.games || []).length) rows.append(el("div", "nums", "No free games right now"));
      card.append(rows);
    } else if (kind === "playing") {
      const head = el("div", "head"); head.append(el("div", "label", c.label || "Playing now")); card.append(head);
      const rows = el("div", "rows");
      (d.games || []).forEach(g => { const row = el("div", "row"); row.append(el("span", "who", g.game), el("span", "val", g.names.join(", ") + (g.count > g.names.length ? " +" + (g.count - g.names.length) : ""))); rows.append(row); });
      if (!(d.games || []).length) rows.append(el("div", "nums", "Nobody is playing right now"));
      card.append(rows);
    } else if (kind === "sale") {
      const head = el("div", "head sub"); head.style.justifyContent = "center";
      const big = el("div", "clock"), sub = el("div", "pct"); sub.style.textAlign = "center";
      if (!d.name) { head.append(el("div", "label", c.label || "Steam sale")); big.textContent = "Soon"; big.style.fontSize = "34px"; card.append(head, big); }
      else {
        head.append(el("div", "label", c.label || d.name)); card.append(head, big, sub);
        const when = d.live ? d.end : d.start;
        sub.textContent = d.live ? "until it ends" : (c.showDate ? "until " + d.name + " · " + new Date(d.start).toLocaleDateString(undefined, { month: "long", day: "numeric" }) : "until it starts");
        const paint = () => { const ms = when - (Date.now() + offset); if (ms <= 0) { big.textContent = d.live ? "Ended" : (c.endText || "On now"); sub.textContent = ""; big.style.fontSize = "34px"; return; } big.textContent = clock(ms); };
        paint(); timers.push(setInterval(paint, 250));
      }
    } else if (kind === "timer") {
      const head = el("div", "head sub"); head.style.justifyContent = "center"; head.append(el("div", "label", c.label || ""));
      const big = el("div", "clock"); card.append(head, big);
      const paint = () => {
        const at = Date.now() + offset, ms = c.mode === "countdown" ? c.at - at : at - c.at;
        if (!c.at) { big.textContent = "00:00:00"; return; }
        if (c.mode === "countdown" && ms <= 0) { big.textContent = c.endText || "00:00:00"; big.classList.add("done"); head.classList.add("hide"); return; }
        big.classList.remove("done"); head.classList.remove("hide"); big.textContent = clock(Math.max(0, ms));
      };
      paint(); timers.push(setInterval(paint, 250));
    }
    return card;
  }

  let timers = [], sceneTimer = 0;
  const stopTimers = () => { timers.forEach(clearInterval); timers = []; clearInterval(sceneTimer); sceneTimer = 0; };

  function draw() {
    if (!state) return;
    const { kind, config: c, data: d } = state;
    if (kind === "alerts") return;
    stopTimers();
    root.classList.toggle("scene", kind === "scene");
    if (kind === "scene") return drawScene(c, d.children || []);
    root.replaceChildren(build(kind, c, d, timers));
  }

  /** A scene shows its overlays one after another in the same spot. */
  function drawScene(c, kids) {
    root.replaceChildren();
    if (!kids.length) return;
    let i = 0;
    const show = first => {
      const k = kids[i % kids.length];
      timers.forEach(clearInterval); timers = [];
      const card = build(k.kind, k.config, k.data, timers);
      card.classList.add("sc", c.transition === "slide" ? "sc-slide" : "sc-fade");
      const old = root.firstElementChild;
      if (old && !first) { old.classList.add("sc-out"); setTimeout(() => old.remove(), 450); }
      else root.replaceChildren();
      root.append(card);
      requestAnimationFrame(() => card.classList.add("sc-in"));
      i++;
    };
    show(true);
    if (kids.length > 1) sceneTimer = setInterval(() => show(false), Math.max(4, c.seconds || 10) * 1000);
  }

  // ---- alerts: a pop-up for each new member or boost, one at a time ----
  let since = null, queue = [], busy = false;
  const ICON = { join: "👋", boost: "🚀", level: "⭐" };
  function pump(c) {
    if (busy || !queue.length) return;
    busy = true;
    const e = queue.shift();
    let tmpl = e.type === "boost" ? c.boostText : e.type === "level" ? (c.levelText || "{name} reached level {count}!") : c.joinText;
    if (!e.name && /\{name\}/.test(tmpl)) tmpl = e.type === "boost" ? "Server boosted! {count} boosts" : e.type === "level" ? "Someone reached level {count}!" : "New member! We're at {count}"; // no name to show (the bot can't see it, or it is switched off)
    const card = el("div", "card alertcard" + (c.showBorder ? " bordered" : "") + (c.shadow ? " shadow" : ""));
    look(c, card);
    const body = el("div", "abody");
    body.append(el("div", "label", String(tmpl || "").replace(/\{name\}/g, e.name || "").replace(/\{count\}/g, e.count == null ? "" : n(e.count)).replace(/\{n\}/g, String(e.by || 1)).replace(/\s+/g, " ").trim()));
    if (e.by > 1) body.append(el("div", "nums", "+" + e.by + (e.type === "boost" ? " new boosts" : " new members")));
    const icon = el("div", "aicon", ICON[e.type] || "✨");
    if (e.avatar && /^https:\/\/cdn\.discordapp\.com\//.test(e.avatar)) { const im = el("img"); im.alt = ""; im.referrerPolicy = "no-referrer"; im.src = e.avatar; im.onerror = () => im.remove(); icon.textContent = ""; icon.append(im); }
    card.append(icon, body);
    const wrap = el("div", "alertwrap " + (c.position === "bottom" ? "bottom" : "top")); wrap.append(card);
    root.replaceChildren(wrap);
    requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add("in")));
    setTimeout(() => card.classList.remove("in"), Math.max(3, c.hold || 6) * 1000);
    setTimeout(() => { root.replaceChildren(); busy = false; pump(c); }, Math.max(3, c.hold || 6) * 1000 + 600);
  }
  function onAlerts(j) {
    const prev = since; since = j.data.seq;
    if (prev === null) return;
    queue.push(...(j.data.events || []));
    if (queue.length > 8) queue.splice(0, queue.length - 8);
    pump(j.config);
  }

  async function load() {
    try {
      const r = await fetch("/api/ov/data?token=" + encodeURIComponent(q.get("token") || "") + (since !== null ? "&since=" + since : ""), { cache: "no-store" });
      if (!r.ok) { root.replaceChildren(); return; }
      const j = await r.json(); offset = j.now - Date.now();
      if (j.kind === "alerts") { state = j; onAlerts(j); poll = setTimeout(load, Math.max(5, Math.min(60, Number(j.config.refresh) || 5)) * 1000); return; }
      const same = state && JSON.stringify(state.data) === JSON.stringify(j.data) && JSON.stringify(state.config) === JSON.stringify(j.config);
      state = j; if (!same) draw();
      poll = setTimeout(load, Math.max(5, Math.min(120, Number(j.config.refresh) || 10)) * 1000);
    } catch { poll = setTimeout(load, 15000); }
  }

  if (demo) {
    // The studio preview: everything comes from the address, nothing is fetched.
    let c = {}, v = {}; try { c = JSON.parse(q.get("c") || "{}"); v = JSON.parse(q.get("v") || "{}"); } catch { /* an empty preview is fine */ }
    const kind = ["goal", "stats", "timer", "alerts", "sale", "scene", "board", "playing", "poll", "free", "deals"].includes(q.get("k")) ? q.get("k") : "goal";
    const target = Math.max(1, Number(c.target) || 100), current = Number(v.current) || 0;
    if (kind === "alerts") {
      look(c); let k = 0;
      const fire = () => { k++; queue.push({ type: k % 3 === 1 ? "join" : k % 3 === 2 ? "boost" : "level", count: k % 3 === 1 ? 1280 + k : k % 3 === 2 ? 14 + k : 5 + k, by: 1, name: c.showNames === false ? "" : ["Alex", "Sam", "Riley"][k % 3] }); pump(c); };
      fire(); setInterval(() => { if (queue.length < 2) fire(); }, Math.max(4, (c.hold || 6) + 2) * 1000);
    } else {
      const sale = v.sale || { name: "Steam Winter Sale", start: Date.now() + 6 * 86400_000 + 4 * 3600_000, end: Date.now() + 24 * 86400_000, live: false };
      const data = kind === "goal" ? { current, target, pct: Math.max(0, Math.min(100, Math.round(current / target * 100))) }
        : kind === "stats" ? { members: v.members ?? null, boosts: v.boosts ?? null } : kind === "sale" ? sale : kind === "poll" ? { on: true, question: "What should we play next?", open: true, until: Date.now() + 240000, total: 24, options: [{ title: "Deep Rock Galactic", count: 11 }, { title: "Hades II", count: 8 }, { title: "Balatro", count: 5 }] } : kind === "board" ? { rows: [["Alex", 12, 4210], ["Sam", 9, 2890], ["Riley", 7, 1760], ["Jo", 5, 940], ["Kai", 3, 410]].slice(0, Math.max(3, Number(c.limit) || 5)).map(([name, level, xp]) => ({ name, level, xp })) } : kind === "deals" ? { deals: [{ title: "Hades II", cut: 40, price: 17.99, currency: "USD" }, { title: "Balatro", cut: 25, price: 10.49, currency: "USD" }, { title: "Elden Ring", cut: 35, price: 38.99, currency: "USD" }, { title: "Hollow Knight", cut: 50, price: 7.49, currency: "USD" }].slice(0, Math.max(2, Number(c.limit) || 4)) } : kind === "free" ? { games: [{ title: "Hades", shop: "Epic", expiry: new Date(Date.now() + 2 * 86400000).toISOString() }, { title: "Balatro", shop: "GOG", expiry: null }, { title: "Dead Cells", shop: "Steam", expiry: new Date(Date.now() + 5 * 3600000).toISOString() }].slice(0, Math.max(2, Number(c.limit) || 4)) } : kind === "playing" ? { games: [{ game: "Deep Rock Galactic", count: 4, names: ["Alex", "Sam", "Riley"] }, { game: "Hades II", count: 1, names: ["Jo"] }] } : kind === "scene" ? { children: Array.isArray(v.children) ? v.children : [] } : { at: c.at, mode: c.mode };
      state = { kind, config: c, data };
      draw();
    }
  } else load();
})();

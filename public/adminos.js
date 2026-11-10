// The admin panel as a desktop: every page is an icon, every open page is a window you can drag, resize, minimize and maximize,
// with a taskbar and a Start menu along the bottom. The pages themselves are drawn by app.js; this file only handles the windows.
(function (root) {
  "use strict";
  const KEY = "adm-view", SAVE = "adm-windows";
  const store = {
    get(k) { try { return root.localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { root.localStorage.setItem(k, v); } catch { /* private window: fine, nothing is remembered */ } }
  };
  let on = false, cfg = null, desk, layer, bar, tasks, startMenu, wins = new Map(), z = 10, cascade = 0, h;

  const wanted = () => (store.get(KEY) || "os") === "os" && root.innerWidth >= 900;
  const setMode = m => { store.set(KEY, m); root.location.reload(); };

  function el(tag, cls, attrs = {}, ...kids) { const n = document.createElement(tag); if (cls) n.className = cls; for (const [k, v] of Object.entries(attrs)) { if (k === "text") n.textContent = v; else n.setAttribute(k, v); } n.append(...kids.filter(Boolean)); return n; }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function persist() {
    store.set(SAVE, JSON.stringify([...wins.values()].map(w => ({ id: w.id, x: w.x, y: w.y, w: w.w, h: w.h, max: w.max, min: w.min, z: Number(w.node.style.zIndex) || 0 }))));
  }
  function focus(w) {
    for (const o of wins.values()) o.node.classList.toggle("focus", o === w);
    w.node.style.zIndex = String(++z); w.task.classList.add("on"); for (const o of wins.values()) if (o !== w) o.task.classList.remove("on");
    document.title = `${metaOf(w.id).title} · Admin · Steam Value Checker`; persist();
  }
  function place(w) {
    const n = w.node, W = layer.clientWidth, H = layer.clientHeight;
    if (w.max) { n.classList.add("max"); for (const k of ["left", "top", "width", "height"]) n.style.removeProperty(k); return; }
    n.classList.remove("max");
    w.w = clamp(w.w, 380, W); w.h = clamp(w.h, 260, H); w.x = clamp(w.x, -w.w + 120, W - 120); w.y = clamp(w.y, 0, H - 40);
    n.style.left = w.x + "px"; n.style.top = w.y + "px"; n.style.width = w.w + "px"; n.style.height = w.h + "px";
  }

  const GROUP_ICON = { Dashboard: "🖥️", Insights: "📊", People: "👥", Reach: "📣", Support: "🛟", Operations: "⚙️" };
  const metaOf = id => id.startsWith("f:") ? { title: id.slice(2), icon: GROUP_ICON[id.slice(2)] || "📁", sub: "" } : cfg.pages[id];
  const known = id => id.startsWith("f:") ? cfg.nav.some(([g]) => g === id.slice(2)) : Boolean(cfg.pages[id]);
  /** A folder window: the pages of one group laid out like files in Explorer. */
  function folderView(group) {
    const items = (cfg.nav.find(([g]) => g === group) || [, []])[1];
    const grid = el("div", "adm-files");
    for (const [id, title, glyph] of items) {
      const b = el("button", "adm-file", { type: "button", title: cfg.pages[id].sub }, el("span", "adm-icon-art", { "aria-hidden": "true", text: glyph }), el("span", "adm-icon-name", { text: title }), el("span", "adm-badge", { "data-badge": id, hidden: "" }));
      let last = 0; b.addEventListener("click", () => { grid.querySelectorAll(".sel").forEach(n => n.classList.remove("sel")); b.classList.add("sel"); if (Date.now() - last < 450 || root.matchMedia("(pointer: coarse)").matches) open(id); last = Date.now(); });
      b.addEventListener("keydown", e => { if (e.key === "Enter") open(id); });
      grid.append(b);
    }
    return grid;
  }

  function open(id, saved) {
    if (!known(id)) id = "overview";
    const have = wins.get(id);
    if (have) { have.min = false; have.node.hidden = false; focus(have); return have; }
    const meta = metaOf(id), W = layer.clientWidth, H = layer.clientHeight;
    const w = { id, w: Math.min(id.startsWith("f:") ? 640 : 920, W - 60), h: Math.min(id.startsWith("f:") ? 420 : 640, H - 40), x: Math.max(16, Math.min((desk.querySelector(".adm-icons")?.scrollWidth || 0) + 24, W - Math.min(920, W - 60) - 16)) + (cascade % 6) * 30, y: 20 + (cascade % 6) * 28, max: false, min: false, ...(saved || {}) };
    cascade++;
    const content = el("div", "adm-content adm-win-body");
    const title = el("div", "adm-win-title", {}, el("i", "", { "aria-hidden": "true", text: meta.icon }), el("span", "", { text: meta.title }));
    const bMin = el("button", "adm-win-btn", { type: "button", "aria-label": "Minimize", title: "Minimize", text: "–" });
    const bMax = el("button", "adm-win-btn", { type: "button", "aria-label": "Maximize", title: "Maximize", text: "▢" });
    const bClose = el("button", "adm-win-btn close", { type: "button", "aria-label": "Close", title: "Close", text: "✕" });
    const node = el("section", "adm-win", { role: "dialog", "aria-label": meta.title }, el("header", "adm-win-bar", {}, title, el("div", "adm-win-btns", {}, bMin, bMax, bClose)), content);
    const task = el("button", "adm-task", { type: "button", title: meta.title }, el("i", "", { "aria-hidden": "true", text: meta.icon }), el("span", "", { text: meta.title }));
    w.node = node; w.task = task; w.content = content; wins.set(id, w);
    layer.append(node); tasks.append(task);
    place(w); if (w.min) { node.hidden = true; } else focus(w); if (saved && saved.z) node.style.zIndex = String(saved.z);
    if (id.startsWith("f:")) { content.classList.add("adm-folder"); content.append(folderView(id.slice(2))); } else cfg.render(id, content);

    const minimize = () => { w.min = true; node.hidden = true; task.classList.remove("on"); node.classList.remove("focus"); persist(); };
    const toggleMax = () => { w.max = !w.max; place(w); focus(w); };
    bMin.addEventListener("click", minimize); bMax.addEventListener("click", toggleMax);
    bClose.addEventListener("click", () => { node.remove(); task.remove(); wins.delete(id); persist(); const top = [...wins.values()].filter(o => !o.min).sort((a, b) => Number(b.node.style.zIndex) - Number(a.node.style.zIndex))[0]; if (top) focus(top); else document.title = "Admin · Steam Value Checker"; });
    task.addEventListener("click", () => { if (w.min) { w.min = false; node.hidden = false; focus(w); } else if (node.classList.contains("focus")) minimize(); else focus(w); });
    node.addEventListener("pointerdown", () => { if (!node.classList.contains("focus")) focus(w); }, true);
    title.addEventListener("dblclick", toggleMax);

    // dragging by the title bar
    node.querySelector(".adm-win-bar").addEventListener("pointerdown", e => {
      if (e.target.closest("button") || e.button !== 0) return;
      const sx = e.clientX, sy = e.clientY, ox = w.x, oy = w.y, wasMax = w.max;
      const bar0 = e.currentTarget; bar0.setPointerCapture(e.pointerId);
      const move = ev => {
        if (wasMax && !w.max) return;
        if (w.max) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return; w.max = false; w.x = ev.clientX - w.w / 2; w.y = 0; place(w); return; }
        w.x = ox + ev.clientX - sx; w.y = oy + ev.clientY - sy; place(w);
      };
      const up = () => { bar0.removeEventListener("pointermove", move); bar0.removeEventListener("pointerup", up); bar0.removeEventListener("pointercancel", up); persist(); };
      bar0.addEventListener("pointermove", move); bar0.addEventListener("pointerup", up); bar0.addEventListener("pointercancel", up);
    });
    // resizing from the corner grip
    const grip = el("div", "adm-win-grip", { "aria-hidden": "true" }); node.append(grip);
    grip.addEventListener("pointerdown", e => {
      if (w.max) return; e.preventDefault(); grip.setPointerCapture(e.pointerId);
      const sx = e.clientX, sy = e.clientY, ow = w.w, oh = w.h;
      const move = ev => { w.w = ow + ev.clientX - sx; w.h = oh + ev.clientY - sy; place(w); };
      const up = () => { grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); grip.removeEventListener("pointercancel", up); persist(); };
      grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up); grip.addEventListener("pointercancel", up);
    });
    return w;
  }

  /** The desktop: one folder per group, the way a school computer lays out its shortcuts. */
  function icons() {
    const grid = el("div", "adm-icons", { role: "list" });
    const add = (art, name, run, extra = {}) => {
      const b = el("button", "adm-icon", { type: "button", role: "listitem", ...extra }, el("span", "adm-icon-art", { "aria-hidden": "true", text: art }), el("span", "adm-icon-name", { text: name }));
      let last = 0;
      b.addEventListener("click", () => { grid.querySelectorAll(".sel").forEach(n => n.classList.remove("sel")); b.classList.add("sel"); if (Date.now() - last < 450 || root.matchMedia("(pointer: coarse)").matches) run(); last = Date.now(); });
      b.addEventListener("keydown", e => { if (e.key === "Enter") run(); });
      grid.append(b); return b;
    };
    for (const [group] of cfg.nav) add(GROUP_ICON[group] || "📁", group, () => open("f:" + group));
    add("🌐", "Steam Value Checker", () => { root.location.href = cfg.siteUrl || "/"; });
    return grid;
  }

  const WINLOGO = () => el("span", "adm-winlogo", { "aria-hidden": "true" }, el("i"), el("i"), el("i"), el("i"));
  const TILES = [["overview", "Overview", "#0a64c8"], ["bugs", "Bug reports", "#c4392b"], ["supporters", "Supporters", "#8a3ffc"], ["system", "System health", "#1a8f5a"], ["announce", "Announcements", "#d4741a"], ["indie", "Indie showcase", "#c0287a"]];

  /** Start button, the Windows-style menu, and the "Type here to search" box. Returns both for the taskbar. */
  function start() {
    startMenu = el("div", "adm-start", { hidden: "" });
    const rail = el("div", "adm-start-rail");
    const results = el("div", "adm-start-list");
    const tilesBox = el("div", "adm-start-tiles", {}, el("div", "adm-start-group", { text: "Pinned" }));
    for (const [id, name, color] of TILES) { const t = el("button", "adm-tile", { type: "button" }, el("span", "adm-tile-art", { "aria-hidden": "true", text: cfg.pages[id].icon }), el("span", "", { text: name })); t.style.setProperty("--tile", color); t.addEventListener("click", () => { close(); open(id); }); tilesBox.append(t); }
    const paint = q => {
      q = (q || "").trim().toLowerCase(); results.replaceChildren();
      for (const [group, items] of cfg.nav) {
        const hit = items.filter(([, t, , sub]) => !q || t.toLowerCase().includes(q) || (sub || "").toLowerCase().includes(q) || group.toLowerCase().includes(q)); if (!hit.length) continue;
        results.append(el("div", "adm-start-group", { text: group }));
        for (const [id, t, g] of hit) { const b = el("button", "adm-start-item", { type: "button" }, el("i", "", { "aria-hidden": "true", text: g }), el("span", "", { text: t })); b.addEventListener("click", () => { close(); open(id); }); results.append(b); }
      }
      if (!results.children.length) results.append(el("p", "adm-start-none", { text: "Nothing matches that." }));
    };
    const railBtn = (glyph, label, run) => { const b = el("button", "adm-rail-btn", { type: "button", title: label, "aria-label": label, text: glyph }); b.addEventListener("click", run); return b; };
    rail.append(railBtn("☰", "Switch to the classic panel", () => setMode("classic")), railBtn("🌐", "Back to Steam Value Checker", () => { root.location.href = cfg.siteUrl || "/"; }));
    startMenu.append(rail, results, tilesBox); paint("");
    const btn = el("button", "adm-startbtn", { type: "button", "aria-label": "Start menu", "aria-expanded": "false" }, WINLOGO());
    const search = el("input", "", { type: "text", placeholder: "Type here to search", "aria-label": "Search the admin panel", autocomplete: "off", spellcheck: "false" });
    const box = el("label", "adm-searchbox", {}, el("span", "", { "aria-hidden": "true", text: "⌕" }), search);
    const close = () => { startMenu.hidden = true; btn.setAttribute("aria-expanded", "false"); };
    const show = q => { startMenu.hidden = false; btn.setAttribute("aria-expanded", "true"); paint(q); };
    btn.addEventListener("click", e => { e.stopPropagation(); if (startMenu.hidden) { search.value = ""; show(""); } else close(); });
    search.addEventListener("focus", () => show(search.value)); search.addEventListener("input", () => show(search.value));
    search.addEventListener("keydown", e => { if (e.key === "Enter") { results.querySelector(".adm-start-item")?.click(); search.value = ""; search.blur(); } });
    document.addEventListener("pointerdown", e => { if (!startMenu.hidden && !startMenu.contains(e.target) && !btn.contains(e.target) && !box.contains(e.target)) close(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
    return [btn, box];
  }

  function clock() {
    const c = el("div", "adm-clock"), tick = () => { const d = new Date(); c.replaceChildren(el("span", "", { text: d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }) }), el("span", "", { text: d.toLocaleDateString("en-US", { timeZone: "America/New_York" }) })); c.title = "Eastern time"; };
    tick(); setInterval(tick, 20_000); return c;
  }

  function begin(options) {
    cfg = options; on = true;
    document.getElementById("adm").hidden = true; document.body.classList.add("adm-os");
    desk = el("div", "adm-desk"); layer = el("div", "adm-layer"); tasks = el("div", "adm-tasks");
    const tray = el("div", "adm-tray"); const status = document.getElementById("admStatus"), user = document.getElementById("admUser");
    if (status) tray.append(status); if (user) { user.querySelectorAll("button").forEach(b => { if (b.textContent === "Desktop view") b.remove(); }); tray.append(user); }
    tray.append(clock());
    const [btn, box] = start();
    bar = el("footer", "adm-taskbar", {}, btn, box, tasks, tray);
    desk.append(icons(), layer, startMenu, bar); document.body.prepend(desk);
    root.addEventListener("resize", () => { for (const w of wins.values()) place(w); });
    let saved = []; try { saved = JSON.parse(store.get(SAVE) || "[]"); } catch { /* start fresh */ }
    for (const s of saved.filter(s => known(s.id)).sort((a, b) => (a.z || 0) - (b.z || 0)).slice(0, 8)) open(s.id, s);
    if (!wins.size) open("overview");
  }

  root.AdminOS = { wanted, begin, open: id => open(id), active: () => on, setMode };
})(typeof globalThis !== "undefined" ? globalThis : this);

// LucadoOS for the whole site: the same pages, laid out as a desktop. Every page is an icon, every open page is a window you can drag,
// resize, minimize and snap, with a taskbar and a Start menu along the bottom. The pages themselves are the normal site pages, shown in
// frames, so everything on them works exactly as it does in the classic view. It's a second theme: Classic stays the default.
(function (root) {
  "use strict";
  const KEY = "lucado-site-view", SAVE = "lucado-site-windows";
  const store = {
    get(k) { try { return root.localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { root.localStorage.setItem(k, v); } catch { /* private window: fine, nothing is remembered */ } }
  };
  const wanted = () => {
    const q = /[?&]os=(0|1)\b/.exec(root.location.search); if (q) store.set(KEY, q[1] === "1" ? "os" : "classic");
    return store.get(KEY) === "os" && root.innerWidth >= 900 && root.self === root.top;
  };
  const setMode = m => { store.set(KEY, m); root.location.reload(); };
  let on = false, cfg = null, desk, layer, bar, tasks, startMenu, wins = new Map(), z = 10, cascade = 0, h;



  function el(tag, cls, attrs = {}, ...kids) { const n = document.createElement(tag); if (cls) n.className = cls; for (const [k, v] of Object.entries(attrs)) { if (k === "text") n.textContent = v; else n.setAttribute(k, v); } n.append(...kids.filter(Boolean)); return n; }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // Snap zones as fractions of the desktop: x, y, width, height. Edges and the layout picker both use these.
  const ZONES = { L: [0, 0, .5, 1], R: [.5, 0, .5, 1], TL: [0, 0, .5, .5], TR: [.5, 0, .5, .5], BL: [0, .5, .5, .5], BR: [.5, .5, .5, .5], L23: [0, 0, 2 / 3, 1], R13: [2 / 3, 0, 1 / 3, 1], C1: [0, 0, 1 / 3, 1], C2: [1 / 3, 0, 1 / 3, 1], C3: [2 / 3, 0, 1 / 3, 1] };
  const LAYOUTS = [["L", "R"], ["L23", "R13"], ["C1", "C2", "C3"], ["TL", "TR", "BL", "BR"]];
  const zoneRect = z => { const [a, b, c, d] = ZONES[z], W = layer.clientWidth, H = layer.clientHeight; return { x: Math.round(a * W), y: Math.round(b * H), w: Math.round(c * W), h: Math.round(d * H) }; };

  function persist() {
    store.set(SAVE, JSON.stringify([...wins.values()].map(w => ({ id: w.id, path: w.path, x: w.x, y: w.y, w: w.w, h: w.h, max: w.max, min: w.min, snap: w.snap || null, z: Number(w.node.style.zIndex) || 0 }))));
  }
  function focus(w) {
    for (const o of wins.values()) o.node.classList.toggle("focus", o === w);
    w.node.style.zIndex = String(++z); w.task.classList.add("on"); for (const o of wins.values()) if (o !== w) o.task.classList.remove("on");
    if (w.pending && w.frame) { w.frame.src = w.pending; w.pending = null; } // a restored window loads the first time you reach for it
    document.title = `${metaOf(w.id).title} · LucadoOS`; persist(); addressOf(w); syncActive();
  }
  /** Keeps the cost down: only windows you can actually see animate their waves, and the desktop's own waves stop while a full-screen window covers them. */
  let lastActive = new Map(), lastDesk = null;
  function syncActive() {
    const zOf = o => Number(o.node.style.zIndex) || 0, list = [...wins.values()];
    const coveredBy = w => list.some(o => o !== w && !o.min && !o.node.hidden && o.max && zOf(o) > zOf(w));
    for (const w of list) {
      if (!w.frame) continue;
      const on = !w.min && !w.node.hidden && !w.pending && !coveredBy(w);
      if (lastActive.get(w) !== on) { lastActive.set(w, on); try { w.frame.contentWindow?.postMessage({ svc: "los-active", on }, root.location.origin); } catch { /* not loaded yet; the load handler resends */ } }
    }
    const hidden = list.some(o => !o.min && !o.node.hidden && o.max && !o.id.startsWith("os:"));
    if (hidden !== lastDesk) { lastDesk = hidden; if (root.IndieWaves) (prefs.waves && !hidden) ? root.IndieWaves.start() : root.IndieWaves.stop(); }
  }
  function place(w) {
    const n = w.node, W = layer.clientWidth, H = layer.clientHeight;
    if (w.max) { n.classList.add("max"); for (const k of ["left", "top", "width", "height"]) n.style.removeProperty(k); return; }
    n.classList.remove("max");
    if (w.snap && ZONES[w.snap]) { const r = zoneRect(w.snap); Object.assign(w, r); n.classList.add("snapped"); } else { n.classList.remove("snapped"); w.snap = null; }
    w.w = clamp(w.w, 380, W); w.h = clamp(w.h, 260, H); w.x = clamp(w.x, -w.w + 120, W - 120); w.y = clamp(w.y, 0, H - 40);
    n.style.left = w.x + "px"; n.style.top = w.y + "px"; n.style.width = w.w + "px"; n.style.height = w.h + "px";
  }

  let pages = {}, nav = [], who = null, closeStart = () => {}, prefs = { wall: "default", waves: true }, logout = null;
  const GLYPH = { "/": "🏠" };
  const pageMeta = id => pages[id] || { title: id.replace(/^\//, "").split("/")[0] || "Home", icon: "📄", sub: "" };
  const metaOf = id => wins.get(id)?.meta || pageMeta(id);
  const known = id => id === "os:personalize" || typeof id === "string" && /^\/(?!api\/|auth\/|admin)/.test(id) && !/^\/\//.test(id);
  let previewEl = null;
  function showPreview(zone) {
    if (!zone) { previewEl?.remove(); previewEl = null; return; }
    if (!previewEl) { previewEl = el("div", "los-snap-preview", { "aria-hidden": "true" }); layer.append(previewEl); }
    const r = zone === "MAX" ? { x: 0, y: 0, w: layer.clientWidth, h: layer.clientHeight } : zoneRect(zone);
    Object.assign(previewEl.style, { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" });
  }
  /** Puts a window in a zone ("MAX" fills the desktop, null brings it back to its old size). */
  function snapTo(w, zone) {
    if (zone === "MAX") { if (!w.max && !w.snap) w.restore = { w: w.w, h: w.h, x: w.x, y: w.y }; w.snap = null; w.max = true; place(w); persist(); return; }
    if (zone === null) { const r = w.restore || { w: 880, h: 600, x: 60, y: 40 }; w.max = false; w.snap = null; Object.assign(w, { w: r.w, h: r.h, x: r.x ?? 60, y: r.y ?? 40 }); place(w); persist(); return; }
    if (!w.max && !w.snap) w.restore = { w: w.w, h: w.h, x: w.x, y: w.y };
    w.max = false; w.snap = zone; w.min = false; w.node.hidden = false; place(w); focus(w); persist(); assist(zone);
  }
  /** After one window snaps, offer the other open windows for the spaces that are left (Windows 11's snap assist). */
  function assist(zone) {
    root.document.querySelector(".los-assist")?.remove();
    const layout = LAYOUTS.find(l => l.includes(zone)); if (!layout) return;
    const free = layout.filter(z => z !== zone && ![...wins.values()].some(o => o.snap === z && !o.min));
    const others = [...wins.values()].filter(o => !o.snap && !o.max);
    if (!free.length || !others.length) return;
    const zoneNow = free[0], r = zoneRect(zoneNow);
    const box = el("div", "los-assist", { role: "dialog", "aria-label": "Pick a window for this space" });
    Object.assign(box.style, { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" });
    box.append(el("p", "", { text: "Pick a window for this space" }));
    const row = el("div", "los-assist-row");
    for (const o of others) { const m = metaOf(o.id), b = el("button", "los-assist-card", { type: "button" }, el("span", "", { "aria-hidden": "true", text: m.icon }), el("b", "", { text: m.title })); b.addEventListener("click", () => { box.remove(); snapTo(o, zoneNow); }); row.append(b); }
    box.append(row); layer.append(box);
    const away = ev => { if (!box.contains(ev.target)) { box.remove(); document.removeEventListener("pointerdown", away, true); } };
    setTimeout(() => document.addEventListener("pointerdown", away, true), 0);
    document.addEventListener("keydown", function esc(ev) { if (ev.key === "Escape") { box.remove(); document.removeEventListener("keydown", esc); } });
  }
  /** The little layout picker under the maximize button. */
  function layoutFlyout(w, anchor) {
    document.querySelector(".los-flyout")?.remove();
    const fly = el("div", "los-flyout", { role: "menu" });
    for (const layout of LAYOUTS) {
      const cell = el("div", "los-fly-layout");
      for (const z of layout) { const [a, b, c, d] = ZONES[z], t = el("button", "los-fly-zone", { type: "button", "aria-label": "Snap " + z, title: "Snap here" }); Object.assign(t.style, { left: a * 100 + "%", top: b * 100 + "%", width: c * 100 + "%", height: d * 100 + "%" }); t.addEventListener("click", () => { fly.remove(); snapTo(w, z); }); cell.append(t); }
      fly.append(cell);
    }
    const rc = anchor.getBoundingClientRect(); fly.style.top = rc.bottom + 4 + "px"; fly.style.left = Math.max(8, rc.right - 190) + "px";
    document.body.append(fly);
    const gone = ev => { if (!fly.contains(ev.target) && ev.target !== anchor) { fly.remove(); document.removeEventListener("pointermove", gone); } };
    fly.addEventListener("pointerleave", () => fly.remove()); setTimeout(() => document.addEventListener("pointermove", ev => { if (!fly.isConnected) return; const f = fly.getBoundingClientRect(), a = anchor.getBoundingClientRect(); const inside = (r, x, y) => x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 6; if (!inside(f, ev.clientX, ev.clientY) && !inside(a, ev.clientX, ev.clientY)) fly.remove(); }), 0);
  }


  /** Opens a page in a window. The window shows the page in a frame and follows it as you click around inside. */
  function open(id, saved) {
    if (!known(id)) id = "/";
    const have = wins.get(id);
    if (have) { have.min = false; have.node.hidden = false; focus(have); return have; }
    const meta = { ...pageMeta(id) }, W = layer.clientWidth, H = layer.clientHeight;
    const w = { id, path: id, meta, w: Math.min(1000, W - 200), h: Math.min(680, H - 40), x: Math.max(16, Math.min((desk.querySelector(".los-icons")?.scrollWidth || 0) + 24 + (cascade % 6) * 28, W - 400)), y: 24 + (cascade % 6) * 28, ...(saved ? { x: saved.x, y: saved.y, w: saved.w, h: saved.h, max: saved.max, min: saved.min, snap: saved.snap } : {}) };
    cascade++;
    const native = id.startsWith("os:");
    if (!saved && !native) { w.restore = { w: w.w, h: w.h, x: w.x, y: w.y }; w.max = true; } // pages open full screen; people resize them from there
    if (saved?.path && known(saved.path)) w.path = saved.path;
    const frame = native ? null : el("iframe", "los-frame", { ...(saved && saved.defer ? {} : { src: w.path }), title: meta.title, loading: "eager", referrerpolicy: "same-origin" });
    const content = el("div", native ? "los-win-body los-native" : "los-win-body los-page", {}, ...(frame ? [frame] : []));
    if (native) { w.w = Math.min(w.w, 720); w.h = Math.min(w.h, 520); personalize(content); }
    const titleText = el("span", "", { text: meta.title }), titleIcon = el("i", "", { "aria-hidden": "true", text: meta.icon });
    const title = el("div", "los-win-title", {}, titleIcon, titleText);
    const bMin = el("button", "los-win-btn", { type: "button", "aria-label": "Minimize", title: "Minimize", text: "–" });
    const bMax = el("button", "los-win-btn", { type: "button", "aria-label": "Maximize", title: "Maximize", text: "▢" });
    const bClose = el("button", "los-win-btn close", { type: "button", "aria-label": "Close", title: "Close", text: "✕" });
    const node = el("section", "los-win", { role: "dialog", "aria-label": meta.title }, el("header", "los-win-bar", {}, title, el("div", "los-win-btns", {}, bMin, bMax, bClose)), content);
    const taskIcon = el("i", "", { "aria-hidden": "true", text: meta.icon }), taskText = el("span", "", { text: meta.title });
    const task = el("button", "los-task", { type: "button", title: meta.title }, taskIcon, taskText);
    w.node = node; w.task = task; w.content = content; w.frame = frame; wins.set(id, w); if (saved && saved.defer) w.pending = w.path;
    layer.append(node); tasks.append(task);
    place(w); if (w.min) { node.hidden = true; } else if (w.pending) { node.style.zIndex = String(saved.z || ++z); } else focus(w); if (saved && saved.z) node.style.zIndex = String(saved.z);
    // follow the page inside: its title and address change as you move around it, and the browser address follows the window you're in
    const sync = () => {
      let path, t;
      try { const l = frame.contentWindow.location; path = l.pathname + l.search; t = frame.contentDocument.title; } catch { return; }
      if (!path || path === "about:blank") return;
      if (path !== w.path) { w.path = path; persist(); if (node.classList.contains("focus")) addressOf(w); }
      const m = pages[path.split("?")[0]] ?? null, name = m ? m.title : String(t || "").split(/[:|·]/)[0].trim().slice(0, 40) || meta.title;
      if (name !== meta.title) { meta.title = name; if (m) meta.icon = m.icon; titleText.textContent = taskText.textContent = name; titleIcon.textContent = taskIcon.textContent = meta.icon; task.title = name; node.setAttribute("aria-label", name); if (node.classList.contains("focus")) document.title = `${name} · LucadoOS`; }
    };
    if (frame) {
      frame.addEventListener("load", () => { lastActive.delete(w); syncActive(); sync(); try { frame.contentWindow.addEventListener("pointerdown", () => { closeStart(); if (!node.classList.contains("focus")) focus(w); }, true); } catch { /* not ours */ } });
      w.timer = setInterval(() => { if (!node.isConnected) clearInterval(w.timer); else sync(); }, 800);
    }
    const shut = () => { clearInterval(w.timer); node.remove(); task.remove(); wins.delete(id); persist(); const top = [...wins.values()].filter(o => !o.min).sort((a, b) => Number(b.node.style.zIndex) - Number(a.node.style.zIndex))[0]; if (top) focus(top); else { document.title = "LucadoOS"; } };
    const minimize = () => { w.min = true; node.hidden = true; task.classList.remove("on"); node.classList.remove("focus"); persist(); };
    const toggleMax = () => { snapTo(w, w.max ? null : "MAX"); focus(w); };
    bMin.addEventListener("click", minimize); bMax.addEventListener("click", toggleMax); bClose.addEventListener("click", shut);
    task.addEventListener("click", () => { if (w.min) { w.min = false; node.hidden = false; focus(w); } else if (node.classList.contains("focus")) minimize(); else focus(w); });
    node.addEventListener("pointerdown", () => { if (!node.classList.contains("focus")) focus(w); }, true);
    title.addEventListener("dblclick", toggleMax);
    // dragging by the title bar; near an edge it snaps, like Windows 11
    node.querySelector(".los-win-bar").addEventListener("pointerdown", e => {
      if (e.target.closest("button") || e.button !== 0) return;
      const bar0 = e.currentTarget; bar0.setPointerCapture(e.pointerId);
      const sx = e.clientX, sy = e.clientY; let ox = w.x, oy = w.y, started = false, target = null;
      const edgeZone = ev => {
        const r = layer.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top, W = r.width, H = r.height, e0 = 6;
        if (y <= e0) return x <= 60 ? "TL" : x >= W - 60 ? "TR" : "MAX";
        if (x <= e0) return y <= 60 ? "TL" : y >= H - 60 ? "BL" : "L";
        if (x >= W - e0) return y <= 60 ? "TR" : y >= H - 60 ? "BR" : "R";
        return null;
      };
      const move = ev => {
        if (!started) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return; started = true; if (w.max || w.snap) { const was = w.restore || { w: 880, h: 600 }; const frac = (sx - (layer.getBoundingClientRect().left + w.x)) / Math.max(1, w.w || 1); w.max = false; w.snap = null; w.w = was.w; w.h = was.h; w.x = ev.clientX - was.w * clamp(frac, .1, .9); w.y = 0; ox = w.x; oy = w.y; place(w); focus(w); } }
        w.x = ox + ev.clientX - sx; w.y = oy + ev.clientY - sy; w.restore = { w: w.w, h: w.h }; place(w);
        target = edgeZone(ev); showPreview(target);
      };
      const up = () => { bar0.removeEventListener("pointermove", move); bar0.removeEventListener("pointerup", up); bar0.removeEventListener("pointercancel", up); showPreview(null); if (started && target) snapTo(w, target); persist(); };
      bar0.addEventListener("pointermove", move); bar0.addEventListener("pointerup", up); bar0.addEventListener("pointercancel", up);
    });
    // hovering the maximize button offers the snap layouts
    let flyTimer = 0;
    bMax.addEventListener("pointerenter", () => { flyTimer = setTimeout(() => layoutFlyout(w, bMax), 450); });
    bMax.addEventListener("pointerleave", () => { clearTimeout(flyTimer); });
    node.addEventListener("keydown", e => {
      if (!(e.ctrlKey && e.altKey)) return;
      const k = { ArrowLeft: "L", ArrowRight: "R", ArrowUp: "MAX" }[e.key];
      if (k) { e.preventDefault(); snapTo(w, k); } else if (e.key === "ArrowDown") { e.preventDefault(); snapTo(w, null); }
    });
    // resizing from the corner grip
    const grip = el("div", "los-win-grip", { "aria-hidden": "true" }); node.append(grip);
    grip.addEventListener("pointerdown", e => {
      if (w.max) return; e.preventDefault(); grip.setPointerCapture(e.pointerId);
      const sx = e.clientX, sy = e.clientY, ow = w.w, oh = w.h;
      if (w.snap) { w.snap = null; w.restore = null; } const move = ev => { w.w = ow + ev.clientX - sx; w.h = oh + ev.clientY - sy; place(w); };
      const up = () => { grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); grip.removeEventListener("pointercancel", up); persist(); };
      grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up); grip.addEventListener("pointercancel", up);
    });
    return w;
  }
  /** The browser's address bar shows the page of the window you're in, so a copied link opens the same page. */
  function addressOf(w) { if (!w.frame) return; try { root.history.replaceState(null, "", w.path); } catch { /* keep going */ } }

  const WALLS = [
    ["default", "Default", ""],
    ["ocean", "Ocean", "linear-gradient(135deg, #0a3a86 0%, #0e55b8 45%, #1b86e0 100%)"],
    ["dusk", "Dusk", "linear-gradient(135deg, #2b1055 0%, #7597de 100%)"],
    ["sunset", "Sunset", "linear-gradient(135deg, #42275a 0%, #a8456b 55%, #f09a5b 100%)"],
    ["forest", "Forest", "linear-gradient(135deg, #0b3d2e 0%, #1c7a52 60%, #6bbf8a 100%)"],
    ["graphite", "Graphite", "linear-gradient(135deg, #16181d 0%, #2b2f38 100%)"],
    ["aurora", "Aurora", "radial-gradient(900px 600px at 20% 10%, #2dd4bf55, transparent 60%), radial-gradient(900px 600px at 85% 80%, #8b5cf655, transparent 60%), linear-gradient(135deg, #0b1220, #101a33)"]
  ];
  const PREFS = "lucado-site-prefs", PINS = "lucado-site-pins";
  function loadPrefs() { try { const p = JSON.parse(store.get(PREFS) || "null"); if (p) prefs = { wall: WALLS.some(x => x[0] === p.wall) || /^#[0-9a-f]{6}$/i.test(p.wall || "") ? p.wall : "default", waves: p.waves !== false }; } catch { /* defaults */ } }
  /** The wallpaper and the neon waves. The wallpaper sits on the page so the waves can roll between it and the windows. */
  function applyPrefs() {
    const css = /^#[0-9a-f]{6}$/i.test(prefs.wall) ? prefs.wall : (WALLS.find(x => x[0] === prefs.wall) || [])[2] || "";
    css ? document.body.style.setProperty("--wall", css) : document.body.style.removeProperty("--wall");
    document.body.classList.toggle("los-waves", prefs.waves);
    lastDesk = null; syncActive();
  }
  function savePrefs(patch) { prefs = { ...prefs, ...patch }; store.set(PREFS, JSON.stringify(prefs)); applyPrefs(); }
  /** The Personalize window: wallpaper, neon waves and the light or dark theme. Kept in this browser. */
  function personalize(host) {
    const box = el("div", "pz");
    const draw = () => {
      const swatches = WALLS.map(([id, name, css]) => { const b = el("button", "pz-wall" + (prefs.wall === id ? " on" : ""), { type: "button", title: name, "aria-label": name }, el("span", "", { text: name })); if (css) b.style.background = css; b.addEventListener("click", () => { savePrefs({ wall: id }); draw(); }); return b; });
      const color = el("input", "", { type: "color", "aria-label": "Pick any color", value: /^#/.test(prefs.wall) ? prefs.wall : "#1b2a4a" });
      color.addEventListener("change", () => { savePrefs({ wall: color.value }); draw(); });
      const wv = el("input", "", { type: "checkbox" }); wv.checked = prefs.waves; wv.addEventListener("change", () => { savePrefs({ waves: wv.checked }); draw(); });
      const light = root.svcTheme?.current() === "light";
      const themeBtn = el("button", "btn gray small", { type: "button", text: light ? "Switch to dark" : "Switch to light" }); themeBtn.addEventListener("click", () => { toggleTheme(); draw(); });
      box.replaceChildren(el("h3", "", { text: "Wallpaper" }), el("div", "pz-row", {}, ...swatches, el("label", "pz-color" + (/^#/.test(prefs.wall) ? " on" : ""), {}, color, el("span", "", { text: "Any color" }))),
        el("label", "pz-waves", {}, wv, el("span", "", {}, el("b", "", { text: "Neon waves" }), el("small", "", { text: "Glowing lines rolling over the wallpaper." }))),
        el("h3", "", { text: "Theme" }), el("div", "pz-row", {}, themeBtn), el("p", "muted small", { text: "These are saved in this browser." }));
    };
    draw(); host.append(box);
  }
  /** Light or dark for the desktop and every open page. */
  function toggleTheme() { root.svcTheme?.toggle(); }
  function pushTheme() {
    const t = root.svcTheme?.current(); if (!t) return;
    for (const w of wins.values()) { try { w.frame?.contentDocument?.documentElement.setAttribute("data-theme", t); } catch { /* not loaded yet */ } }
  }
  root.addEventListener("svc-theme", pushTheme);
  // The extension (FanaticalGrabber) only talks to the top page. Pages in windows hand their messages to us, and we pass its answers back down.
  root.addEventListener("message", e => {
    if (e.origin !== root.location.origin) return;
    const d = e.data;
    if (d && d.svcRelay === "page" && d.msg && d.msg.svc === "page" && [...wins.values()].some(w => w.frame && w.frame.contentWindow === e.source)) root.postMessage(d.msg, root.location.origin);
    else if (e.source === root && d && d.svc === "ext") for (const w of wins.values()) { try { w.frame?.contentWindow?.postMessage(d, root.location.origin); } catch { /* not loaded */ } }
  });

  /** The desktop: one icon for each section of the site. */
  function icons() {
    const grid = el("div", "los-icons", { role: "list" });
    for (const g of nav) {
      const first = g.pages[0]; if (!first) continue;
      const b = el("button", "los-icon", { type: "button", role: "listitem", title: g.pages.map(p => p.title).join(", ") }, el("span", "los-icon-art", { "aria-hidden": "true", text: g.icon }), el("span", "los-icon-name", { text: g.label }));
      let last = 0;
      b.addEventListener("click", () => { grid.querySelectorAll(".sel").forEach(n => n.classList.remove("sel")); b.classList.add("sel"); if (Date.now() - last < 450 || root.matchMedia("(pointer: coarse)").matches) open(first.path); last = Date.now(); });
      b.addEventListener("keydown", e => { if (e.key === "Enter") open(first.path); });
      if (g.badge) b.append(el("i", "los-icon-badge", { text: String(Math.min(99, g.badge)) }));
      grid.append(b);
    }
    const pz = el("button", "los-icon", { type: "button", role: "listitem", title: "Wallpaper, neon waves and theme" }, el("span", "los-icon-art", { "aria-hidden": "true", text: "🎨" }), el("span", "los-icon-name", { text: "Personalize" }));
    let lastPz = 0; pz.addEventListener("click", () => { grid.querySelectorAll(".sel").forEach(n => n.classList.remove("sel")); pz.classList.add("sel"); if (Date.now() - lastPz < 450 || root.matchMedia("(pointer: coarse)").matches) open("os:personalize"); lastPz = Date.now(); });
    pz.addEventListener("keydown", e => { if (e.key === "Enter") open("os:personalize"); });
    grid.append(pz);
    if (cfg?.adminUrl) { const ad = el("a", "los-icon", { href: cfg.adminUrl, target: "_blank", rel: "noopener noreferrer", role: "listitem", title: "Open the admin panel in a new tab" }, el("span", "los-icon-art", { "aria-hidden": "true", text: "🛠️" }), el("span", "los-icon-name", { text: "Admin" })); grid.append(ad); }
    return grid;
  }

  const WINLOGO = () => el("span", "los-winlogo", { "aria-hidden": "true" }, el("i"), el("i"), el("i"), el("i"));
  /** Start button, the menu with every page, and the search box. */
  function start() {
    startMenu = el("div", "los-start", { hidden: "" });
    const rail = el("div", "los-start-rail"), results = el("div", "los-start-list");
    const tilesBox = el("div", "los-start-tiles");
    const DEFAULT_PINS = ["/home", "/", "/library", "/feed", "/free", "/indie", "/servers", "/help"];
    const loadPins = () => { try { const p = JSON.parse(store.get(PINS) || "null"); if (Array.isArray(p)) return p.filter(x => pages[x]); } catch { /* defaults */ } return DEFAULT_PINS.filter(p => pages[p]); };
    let pinned = loadPins(), lastQ = "", dragFrom = -1;
    const savePins = () => { store.set(PINS, JSON.stringify(pinned)); drawTiles(); paint(lastQ); };
    const hues = ["#0a64c8", "#8a3ffc", "#1a8f5a", "#d4741a", "#c4392b", "#0f7b8a", "#6a4fd0"];
    function drawTiles() {
      const reset = el("button", "los-pin-reset", { type: "button", title: "Back to the default pinned pages", text: "Reset" }); reset.addEventListener("click", () => { pinned = DEFAULT_PINS.filter(p => pages[p]); store.set(PINS, JSON.stringify(pinned)); drawTiles(); paint(lastQ); });
      const head = el("div", "los-start-group los-pins-head", {}, el("span", "", { text: "Pinned" }), el("small", "", { text: "drag to reorder · ✕ to unpin" }), reset);
      const wraps = pinned.map((p, i) => {
        const t = el("button", "los-tile", { type: "button" }, el("span", "los-tile-art", { "aria-hidden": "true", text: pages[p].icon }), el("span", "", { text: pages[p].title })); t.style.setProperty("--tile", hues[i % hues.length]);
        t.addEventListener("click", () => { close(); open(p); });
        const x = el("button", "los-tile-x", { type: "button", "aria-label": "Unpin " + pages[p].title, title: "Unpin", text: "✕" }); x.addEventListener("click", () => { pinned = pinned.filter(v => v !== p); savePins(); });
        const wrap = el("div", "los-tile-wrap", { draggable: "true" }, t, x);
        wrap.addEventListener("dragstart", e => { dragFrom = i; e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", p); } catch { /* fine */ } wrap.classList.add("drag"); });
        wrap.addEventListener("dragend", () => wrap.classList.remove("drag"));
        wrap.addEventListener("dragover", e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; });
        wrap.addEventListener("drop", e => { e.preventDefault(); if (dragFrom < 0 || dragFrom === i) return; const [m] = pinned.splice(dragFrom, 1); pinned.splice(i, 0, m); dragFrom = -1; savePins(); });
        return wrap;
      });
      tilesBox.replaceChildren(el("div", "los-start-brand", { text: "LucadoOS" }), head, ...(wraps.length ? wraps : [el("p", "los-start-none", { text: "Nothing pinned. Use the ☆ beside any page to pin it here." })]));
    }
    const paint = q => {
      lastQ = q = (q || "").trim().toLowerCase(); results.replaceChildren();
      for (const g of nav) {
        const hit = g.pages.filter(p => !q || p.title.toLowerCase().includes(q) || g.label.toLowerCase().includes(q)); if (!hit.length) continue;
        results.append(el("div", "los-start-group", { text: g.label }));
        for (const p of hit) {
          const b = el("button", "los-start-item", { type: "button" }, el("i", "", { "aria-hidden": "true", text: p.icon }), el("span", "", { text: p.title })); b.addEventListener("click", () => { close(); open(p.path); });
          const on = pinned.includes(p.path), pin = el("button", "los-pin" + (on ? " on" : ""), { type: "button", title: on ? "Unpin from the start menu" : "Pin to the start menu", "aria-label": (on ? "Unpin " : "Pin ") + p.title, text: on ? "★" : "☆" });
          pin.addEventListener("click", () => { pinned = on ? pinned.filter(v => v !== p.path) : [...pinned, p.path]; savePins(); });
          results.append(el("div", "los-start-row", {}, b, pin));
        }
      }
      if (!results.children.length) results.append(el("p", "los-start-none", { text: "Nothing matches that." }));
    };
    const railBtn = (glyph, label, run) => { const b = el("button", "los-rail-btn", { type: "button", title: label, "aria-label": label, text: glyph }); b.addEventListener("click", run); return b; };
    rail.append(...[railBtn("🎨", "Personalize", () => { close(); open("os:personalize"); }), cfg?.adminUrl ? railBtn("🛠️", "Admin panel", () => { root.open(cfg.adminUrl, "_blank", "noopener"); }) : null, who && logout ? railBtn("⎋", "Log out", () => logout()) : null, railBtn("☰", "Switch to the classic site", () => setMode("classic"))].filter(Boolean));
    startMenu.append(rail, results, tilesBox); drawTiles(); paint("");
    const btn = el("button", "los-startbtn", { type: "button", "aria-label": "Start menu", "aria-expanded": "false" }, WINLOGO());
    const search = el("input", "", { type: "text", placeholder: "Type here to search", "aria-label": "Search the site's pages", autocomplete: "off", spellcheck: "false" });
    const box = el("label", "los-searchbox", {}, el("span", "", { "aria-hidden": "true", text: "⌕" }), search);
    const close = () => { startMenu.hidden = true; btn.setAttribute("aria-expanded", "false"); }; closeStart = close;
    const show = q => { startMenu.hidden = false; btn.setAttribute("aria-expanded", "true"); paint(q); };
    btn.addEventListener("click", e => { e.stopPropagation(); if (startMenu.hidden) { search.value = ""; show(""); } else close(); });
    search.addEventListener("focus", () => show(search.value)); search.addEventListener("input", () => show(search.value));
    search.addEventListener("keydown", e => { if (e.key === "Enter") { results.querySelector(".los-start-item")?.click(); search.value = ""; search.blur(); } });
    document.addEventListener("pointerdown", e => { if (!startMenu.hidden && !startMenu.contains(e.target) && !btn.contains(e.target) && !box.contains(e.target)) close(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
    return [btn, box];
  }

  function clock() {
    const c = el("div", "los-clock"), tick = () => { const d = new Date(); c.replaceChildren(el("span", "", { text: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) }), el("span", "", { text: d.toLocaleDateString("en-US") })); c.title = "Your local time"; };
    tick(); setInterval(tick, 20_000); return c;
  }


  /** Takes over the page. `options`: { pages: {path: {title, icon, sub}}, nav: [{label, icon, pages: [{path, title, icon}]}], user: {name, avatar} | null, loginUrl, open: path to start on }. */
  function begin(options) {
    pages = { ...options.pages, "os:personalize": { title: "Personalize", icon: "🎨", sub: "" } }; nav = options.nav; who = options.user || null; logout = options.logout || null; loadPrefs();
    if (on) { return; }
    on = true; cfg = options;
    document.body.classList.add("los-os", "los-orig", "los-waves");
    desk = el("div", "los-desk"); layer = el("div", "los-layer"); tasks = el("div", "los-tasks");
    const tray = el("div", "los-tray");
    if (who) tray.append(el("span", "los-who", {}, who.avatar ? el("img", "", { src: who.avatar, alt: "", width: "22", height: "22" }) : el("i"), el("span", "", { text: who.name })));
    else tray.append(el("a", "btn steam small", { href: "/auth/steam", text: "Sign in with Steam" }), el("a", "btn green small", { href: options.loginUrl || "/auth/login", text: "Sign in with Discord" }));
    const classic = el("button", "btn gray small los-classic", { type: "button", title: "Switch back to the classic site", text: "← Classic site" }); classic.addEventListener("click", () => setMode("classic")); tray.append(classic);
    if (options.adminUrl) tray.append(el("a", "btn gray small los-admin", { href: options.adminUrl, target: "_blank", rel: "noopener noreferrer", title: "Open the admin panel", text: "Admin" }));
    const tb = el("button", "los-traybtn", { type: "button" }); const paintT = () => { const l = root.svcTheme?.current() === "light"; tb.textContent = l ? "☾" : "☀"; tb.title = tb.ariaLabel = l ? "Switch to the dark theme" : "Switch to the light theme"; };
    tb.addEventListener("click", () => { toggleTheme(); paintT(); }); root.addEventListener("svc-theme", paintT); paintT();
    tray.append(tb, clock());
    const [btn, box] = start();
    bar = el("footer", "los-taskbar", {}, btn, box, tasks, tray);
    desk.append(icons(), layer, startMenu, bar); document.body.prepend(desk);
    applyPrefs(); setInterval(syncActive, 600); // minimizing, maximizing and closing all change what's visible
    let narrow = false;
    root.addEventListener("resize", () => { for (const w of wins.values()) place(w); if (root.innerWidth < 900 && !narrow) { narrow = true; root.location.reload(); } }); // a small screen gets the classic site
    let saved = []; try { saved = JSON.parse(store.get(SAVE) || "[]"); } catch { /* start fresh */ }
    const live = saved.filter(s => known(s.id)).sort((a, b) => (a.z || 0) - (b.z || 0)).slice(0, 8), topLive = [...live].reverse().find(s => !s.min);
    for (const s of live) open(s.id, { ...s, defer: s !== topLive });
    for (const s of live) { const w = wins.get(s.id); if (w) w.node.style.zIndex = String(++z); } // restore the stacking order exactly: oldest at the bottom, newest on top
    if (topLive && wins.get(topLive.id)) focus(wins.get(topLive.id));
    const want = options.open && known(options.open) && options.open !== "/" ? options.open : null;
    if (want) { const have = [...wins.values()].find(w => w.id === want || w.path === want); if (have) { have.min = false; have.node.hidden = false; focus(have); } else open(want); }
    if (!wins.size) open(options.home && known(options.home) ? options.home : "/"); // first visit lands on the Home page
    else { const top = [...wins.values()].filter(o => !o.min).sort((a, b) => Number(b.node.style.zIndex) - Number(a.node.style.zIndex))[0]; if (top) addressOf(top); }
  }

  root.LucadoOS = { wanted, begin, open: id => open(id), active: () => on, setMode, canUse: () => root.innerWidth >= 900 && root.self === root.top };
})(typeof globalThis !== "undefined" ? globalThis : this);

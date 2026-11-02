// Now-playing overlay. Everything about how it looks is in the address, so a streamer can paste one link into OBS and be done.
(() => {
  "use strict";
  const q = new URLSearchParams(location.search);
  const num = (k, d, lo, hi) => { const v = Number(q.get(k)); return Number.isFinite(v) && q.get(k) !== null && q.get(k) !== "" ? Math.max(lo, Math.min(hi, v)) : d; };
  const flag = (k, d) => (q.has(k) ? q.get(k) !== "0" : d);
  const hex = (k, d) => (/^[0-9a-fA-F]{6}$/.test(q.get(k) || "") ? "#" + q.get(k) : d);
  const pick = (k, list, d) => (list.includes(q.get(k)) ? q.get(k) : d);
  const cfg = {
    token: q.get("token") || "", demo: q.has("demo") && q.get("demo") !== "0",
    style: pick("style", ["card", "minimal", "bar", "square", "vinyl", "neon", "poster", "ticker", "compact"], "card"), theme: pick("theme", ["dark", "light", "glass", "clear"], "dark"),
    accent: hex("accent", "#4da3ff"), accent2: hex("accent2", "#7c6cff"), scale: num("scale", 1, 0.5, 3),
    anchor: pick("anchor", ["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"], "bl"),
    progress: flag("progress", true), viz: flag("viz", true), art: flag("art", true), label: flag("label", true), next: flag("next", false),
    popup: q.get("mode") === "popup", hold: num("hold", 10, 3, 120), hideAfterPause: num("pause", 6, 0, 300), delay: num("delay", 200, 0, 1000),
    bg: num("bg", 100, 0, 100), opacity: num("opacity", 100, 10, 100)
  };
  const root = document.getElementById("ov");
  root.style.setProperty("--bgop", String(cfg.bg / 100)); root.style.opacity = String(cfg.opacity / 100);
  root.dataset.style = cfg.style; root.dataset.theme = cfg.theme;
  root.dataset.anchor = [cfg.anchor[0] === "t" ? "t" : cfg.anchor[0] === "m" ? "m" : "b", cfg.anchor[1] === "l" ? "l" : cfg.anchor[1] === "r" ? "r" : "c"].join(" ");
  root.style.setProperty("--accent", cfg.accent); root.style.setProperty("--accent2", cfg.accent2);

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const card = el("div", "card"); card.style.zoom = String(cfg.scale);
  const canvas = el("canvas", "viz"); if (!cfg.viz) canvas.hidden = true;
  const artWrap = el("div", "art-wrap", "♪"); const imgs = [el("img", "art"), el("img", "art")]; imgs.forEach(i => { i.alt = ""; i.referrerPolicy = "no-referrer"; artWrap.append(i); });
  if (!cfg.art) artWrap.hidden = true;
  const body = el("div", "body");
  const eq = el("span", "eq"); eq.append(el("i"), el("i"), el("i"));
  const labelText = el("span", "", "Now playing"); const label = el("div", "label"); label.append(eq, labelText); if (!cfg.label) label.hidden = true;
  const title = el("div", "line title"), titleIn = el("span"); title.append(titleIn);
  const artist = el("div", "line artist"), artistIn = el("span"); artist.append(artistIn);
  const next = el("div", "next"); if (!cfg.next) next.hidden = true;
  body.append(label, title, artist, next);
  const prog = el("div", "prog"), fill = el("i"); prog.append(fill); if (!cfg.progress) prog.hidden = true;
  card.append(canvas, artWrap, body, prog); root.append(card);

  // ---- showing and hiding ----
  let shown = false, hideTimer = 0, pausedTimer = 0, offTimer = 0;
  const show = () => { clearTimeout(offTimer); if (!shown) { shown = true; root.classList.add("in"); } };
  const hide = () => { if (shown) { shown = false; root.classList.remove("in"); } };
  const later = (fn, s) => setTimeout(fn, s * 1000);

  // ---- the current song ----
  let song = { id: "", position: 0, duration: 0, live: false, at: 0, playing: false, n: null };
  const labelFor = n => (n.paused ? "Paused" : n.live ? "Live radio" : n.auto ? "Auto DJ" : "Now playing");
  let artSlot = 0;
  function fit(box, inner) {
    box.classList.remove("scroll"); inner.style.removeProperty("--shift");
    requestAnimationFrame(() => {
      const over = inner.scrollWidth - box.clientWidth;
      if (over > 4) { box.classList.add("scroll"); inner.style.setProperty("--shift", `-${over + 18}px`); inner.style.setProperty("--dur", `${Math.max(4, over / 28)}s`); }
    });
  }
  function setSong(n, animate) {
    const parts = [label, title, artist, next].filter(x => !x.hidden);
    const apply = () => {
      titleIn.textContent = n.title || ""; artistIn.textContent = n.artist || (n.live ? "Live radio" : ""); labelText.textContent = labelFor(song.n || n);
      next.replaceChildren(...(n.next ? [document.createTextNode("Up next: "), Object.assign(document.createElement("b"), { textContent: n.next })] : [])); next.style.display = n.next ? "" : "none";
      fit(title, titleIn); fit(artist, artistIn);
      const img = imgs[artSlot ^= 1], old = imgs[artSlot ^ 1];
      if (n.thumb) { img.onload = () => { img.classList.add("on"); old.classList.remove("on"); }; img.src = n.thumb; } else { img.classList.remove("on"); old.classList.remove("on"); }
      for (const p of parts) { p.classList.remove("swap-out"); p.classList.add("swap-in"); }
      root.dataset.live = n.live ? "1" : "0";
    };
    if (!animate) return apply();
    for (const p of parts) { p.classList.remove("swap-in"); p.classList.add("swap-out"); }
    root.classList.remove("shine"); void root.offsetWidth; root.classList.add("shine");
    setTimeout(apply, 280);
  }
  function onNp(n) {
    const wasId = song.id;
    if (!n.on || !n.id) { // nothing playing: let the card go
      song.playing = false; clearTimeout(pausedTimer); if (!offTimer) offTimer = later(() => { offTimer = 0; hide(); }, 1.2); return;
    }
    clearTimeout(offTimer); offTimer = 0;
    const changed = n.id !== wasId;
    song = { id: n.id, position: n.position, duration: n.duration, live: n.live, at: performance.now(), playing: n.playing && !n.paused, n };
    root.classList.toggle("paused", Boolean(n.paused));
    if (changed) setSong(n, shown); else labelText.textContent = labelFor(n);
    if (n.paused) {
      clearTimeout(pausedTimer); if (cfg.hideAfterPause > 0) pausedTimer = later(hide, cfg.hideAfterPause);
      if (!shown && !cfg.popup) show();
      return;
    }
    clearTimeout(pausedTimer);
    if (cfg.popup) { if (changed || !shown) { show(); clearTimeout(hideTimer); hideTimer = later(hide, cfg.hold); } }
    else show();
  }

  // ---- progress and visualizer, drawn every frame ----
  const BANDS = 24, HOP = 1024, RATE = 48000, cur = new Float32Array(BANDS), aim = new Float32Array(BANDS);
  let vq = [], vLast = -1, vLastM = 0, vFresh = 0;
  function onViz(m) {
    const bin = atob(m.d), n = Math.floor(bin.length / BANDS), at = performance.now();
    if (m.m < vLastM - 500 || m.f < vLast - 100) { vq = []; vLast = m.f - 1; }
    vLastM = m.m;
    for (let i = 0; i < n; i++) {
      const idx = m.f + i; if (idx <= vLast) continue; vLast = idx;
      const v = new Uint8Array(BANDS); for (let b = 0; b < BANDS; b++) v[b] = bin.charCodeAt(i * BANDS + b);
      vq.push({ at: at + ((idx * HOP) / RATE) * 1000 - m.m + cfg.delay, v });
    }
    if (vq.length > 200) vq.splice(0, vq.length - 200);
  }
  const ctx = canvas.getContext("2d");
  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now();
    if (cfg.progress && song.id) {
      const p = song.playing ? song.position + (now - song.at) / 1000 : song.position;
      fill.style.width = song.duration ? Math.min(100, (p / song.duration) * 100) + "%" : "0%";
    }
    if (!cfg.viz || !shown) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.round(card.clientWidth * dpr), h = Math.round(card.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    while (vq.length && vq[0].at <= now) { const f = vq.shift(); for (let b = 0; b < BANDS; b++) aim[b] = f.v[b] / 255; vFresh = now; }
    const live = now - vFresh < 700 && song.playing;
    for (let b = 0; b < BANDS; b++) { const to = live ? aim[b] : 0; cur[b] += (to - cur[b]) * (to > cur[b] ? 0.65 : 0.12); }
    ctx.clearRect(0, 0, w, h);
    if (cur[0] < 0.01 && cur[8] < 0.01) return;
    const N = 40, gap = w / N, bw = gap * 0.6, g = ctx.createLinearGradient(0, h * 0.3, 0, h);
    g.addColorStop(0, cfg.accent2 + "00"); g.addColorStop(1, cfg.accent + "aa"); ctx.fillStyle = g;
    for (let i = 0; i < N; i++) {
      const pos = (i / (N - 1)) * (BANDS - 1), lo = Math.floor(pos), v = cur[lo] + (cur[Math.min(BANDS - 1, lo + 1)] - cur[lo]) * (pos - lo);
      const bh = Math.max(2, v ** 1.3 * h * 0.75), r = Math.min(bw / 2, 8 * dpr);
      ctx.beginPath(); ctx.roundRect(i * gap + (gap - bw) / 2, h - bh, bw, bh + r, [r, r, 0, 0]); ctx.fill();
    }
  }
  requestAnimationFrame(frame);

  // ---- where the information comes from ----
  const SAMPLES = [
    ["Midnight Run", "Neon Harbor", "#7c6cff", "#4da3ff", 214], ["Glass Hearts", "Luma", "#ff6b9a", "#7c6cff", 187],
    ["Pixel Rain", "8bit Ghost", "#3ddc97", "#4da3ff", 242], ["Overclocked (feat. a really long guest list for the chorus)", "Dual Core & The Extended Title Players", "#f2b84b", "#ff6b6b", 199]
  ].map(([title, artist, a, b, duration], i, all) => ({ title, artist, duration, next: all[(i + 1) % all.length][0], thumb: "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs><rect width='300' height='300' fill='url(#g)'/><circle cx='150' cy='150' r='70' fill='none' stroke='white' stroke-opacity='.45' stroke-width='10'/></svg>`) }));
  function demo() {
    // A short show reel: two songs, a pause so you can see the card fade away, then a third song.
    const t0 = performance.now();
    const tick = () => {
      const ph = ((performance.now() - t0) / 1000) % 42, paused = ph >= 22 && ph < 30, idx = ph < 11 ? 0 : ph < 30 ? 1 : 2;
      const into = idx === 0 ? ph : idx === 1 ? Math.min(ph, 22) - 11 : ph - 30, s = SAMPLES[idx];
      onNp({ on: true, playing: !paused, paused, id: s.title, title: s.title, artist: s.artist, thumb: s.thumb, duration: s.duration, live: false, position: 40 + into, next: s.next, auto: false });
    };
    // made-up levels, so the visualizer has something to show
    setInterval(() => {
      if (!song.playing) return;
      const tt = performance.now() / 1000;
      for (let b = 0; b < BANDS; b++) aim[b] = Math.max(0, Math.min(1, (0.35 + 0.3 * Math.sin(tt * 5 + b * 0.55)) * (1 - b / 40) * (b < 4 ? 0.55 + 0.45 * Math.abs(Math.sin(tt * 6.5)) : 1)));
      vFresh = performance.now();
    }, 40);
    tick(); setInterval(tick, 1000);
  }
  function live() {
    if (!window.EventSource) return;
    const es = new EventSource(`/api/overlay/stream?token=${encodeURIComponent(cfg.token)}${cfg.viz ? "&viz=1" : ""}`);
    es.addEventListener("np", e => { try { onNp(JSON.parse(e.data)); } catch { /* skip */ } });
    es.addEventListener("viz", e => { try { onViz(JSON.parse(e.data)); } catch { /* skip */ } });
  }
  if (cfg.demo) demo(); else if (cfg.token) live();
})();

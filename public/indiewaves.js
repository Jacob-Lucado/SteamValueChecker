// The site's backdrop: a few glowing lines that roll slowly behind every page. Their colors follow the area you're in
// (cool blues on the main pages, sunset in the indie corner, Twitch purple, YouTube red and Kick green for streamers) and slide
// from one set to the next when you move. It stands still if you've asked your device for less motion, and pauses in a background tab.
(function (root) {
  "use strict";
  let bound = null, ro = null, canvas = null, ctx = null, raf = 0, t0 = 0, w = 0, h = 0, dpr = 1, still = false, last = 0, energy = 0;
  // Music: the radio tells us where the track is while it plays. We can't hear the audio (it plays inside SoundCloud's own frame), so the
  // lines pulse on a steady beat worked out from the track and its position, with louder and calmer stretches. No updates for a moment means it's stopped.
  let song = null;
  function music(m) { song = m ? { seed: String(m.seed || ""), pos: Number(m.pos) || 0, at: performance.now(), playing: m.playing !== false } : null; }
  function hash(str) { let x = 2166136261; for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0) / 4294967295; }
  function target(now) {
    if (!song || !song.playing || now - song.at > 2500) return 0;
    const r = hash(song.seed), bpm = 92 + Math.floor(r * 44), pos = song.pos + (now - song.at), beat = (pos / 60000) * bpm;
    const kick = Math.exp(-(beat % 1) * 5.5), hat = Math.exp(-(((beat + .5) % 1)) * 9) * .3;
    const section = .62 + .38 * Math.sin(beat / 16 * Math.PI * 2 + r * 6.28), breath = .18 + .1 * Math.sin(pos / 2300);
    return Math.min(1, (kick * .85 + hat) * section + breath * section);
  }
  const LINES = [
    { y: .52, amp: 46, len: 1.4, speed: .00032, phase: 0, hue: 22, width: 2.2 },
    { y: .6, amp: 38, len: 1.9, speed: -.00026, phase: 1.7, hue: 335, width: 2 },
    { y: .69, amp: 54, len: 1.1, speed: .00021, phase: 3.1, hue: 282, width: 2.4 },
    { y: .78, amp: 30, len: 2.3, speed: -.00036, phase: 4.6, hue: 12, width: 1.6 },
    { y: .87, amp: 42, len: 1.6, speed: .00028, phase: 5.8, hue: 318, width: 1.8 },
    { y: .44, amp: 28, len: 2.6, speed: -.0002, phase: 2.4, hue: 190, width: 1.4 }
  ];
  const PALETTES = { main: [212, 256, 188, 232, 276, 172], indie: [22, 335, 282, 12, 318, 190], streamer: [270, 355, 145, 285, 8, 160] };
  const now_ = L => L.cur === undefined ? (L.cur = L.hue) : L.cur;
  const areaPal = () => PALETTES[document.documentElement.dataset.area] || PALETTES.main;
  const light = () => document.documentElement.dataset.theme === "light";

  function size() {
    dpr = Math.min(2, root.devicePixelRatio || 1); w = bound ? bound.clientWidth : root.innerWidth; h = bound ? bound.clientHeight : root.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function frame(now) {
    ctx.clearRect(0, 0, w, h);
    const dark = !light(), step = w < 600 ? 10 : 6, dt = Math.min(64, now - (last || now)); last = now;
    const tg = target(performance.now()); energy += (tg - energy) * (tg > energy ? .5 : .09); const e = energy;
    ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
    const pal = areaPal();
    for (let i = 0; i < LINES.length; i++) {
      const L = LINES[i], c0 = now_(L); let d = ((pal[i] - c0 + 540) % 360) - 180; L.cur = (c0 + (Math.abs(d) < .5 ? d : d * .04) + 360) % 360; L.hue = L.cur;
      const base = L.y * h, k = (Math.PI * 2 * L.len) / w;
      const amp = L.amp * (1 + e * (.35 + .75 * i / (LINES.length - 1)));
      L.t = (L.t || 0) + (still ? 0 : dt * L.speed * 6 * (1 + e * 1.1)); const p = L.phase + L.t;
      ctx.beginPath();
      for (let x = -10; x <= w + 10; x += step) {
        const y = base + Math.sin(x * k + p) * amp + Math.sin(x * k * 2.3 - p * 1.4) * (amp * .35) + Math.sin(x * k * .5 + p * .6) * (amp * .5);
        x === -10 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      const g = ctx.createLinearGradient(0, 0, w, 0), a = (dark ? 0.9 : 0.55) * (document.documentElement.dataset.area ? 1 : .75), l = dark ? 62 : 48;
      g.addColorStop(0, `hsla(${L.hue}, 100%, ${l}%, 0)`); g.addColorStop(.25, `hsla(${L.hue}, 100%, ${l}%, ${a})`); g.addColorStop(.75, `hsla(${(L.hue + 40) % 360}, 100%, ${l}%, ${a})`); g.addColorStop(1, `hsla(${(L.hue + 40) % 360}, 100%, ${l}%, 0)`);
      ctx.strokeStyle = g; ctx.lineWidth = L.width * (1 + e * .9); ctx.lineJoin = "round";
      if (dark) { const w0 = ctx.lineWidth; ctx.globalAlpha = .18; ctx.lineWidth = w0 * 6; ctx.stroke(); ctx.globalAlpha = 1; ctx.lineWidth = w0; } // soft glow: a wide faint pass under the line, far cheaper than a real blur
      ctx.stroke();
    }
    if (!still && canvas) raf = root.requestAnimationFrame(frame);
  }
  /** Puts the canvas inside an element (a LucadoOS window), or back on the page when there is none. */
  function attach(host) {
    bound = host || null;
    if (bound) { canvas.classList.add("in"); bound.prepend(canvas); if (root.ResizeObserver) { ro = ro || new ResizeObserver(() => size()); ro.disconnect(); ro.observe(bound); } }
    else { canvas.classList.remove("in"); document.body.prepend(canvas); if (ro) ro.disconnect(); }
    size();
  }
  function start(host) {
    if (canvas) { if ((host || null) !== bound) attach(host); return; }
    still = Boolean(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
    canvas = document.createElement("canvas"); canvas.id = "ix-waves"; canvas.setAttribute("aria-hidden", "true");
    document.body.prepend(canvas); ctx = canvas.getContext("2d"); if (!ctx) { stop(); return; } if (host) attach(host);
    t0 = performance.now(); size(); root.addEventListener("resize", size); document.addEventListener("visibilitychange", onVis); raf = root.requestAnimationFrame(frame);
  }
  function onVis() { if (!canvas || still) return; if (document.hidden) root.cancelAnimationFrame(raf); else raf = root.requestAnimationFrame(frame); }
  function stop() {
    if (!canvas) return;
    root.cancelAnimationFrame(raf); root.removeEventListener("resize", size); document.removeEventListener("visibilitychange", onVis); canvas.remove(); canvas = ctx = null; bound = null; if (ro) ro.disconnect();
  }
  root.IndieWaves = { start, stop, music };
})(typeof globalThis !== "undefined" ? globalThis : this);

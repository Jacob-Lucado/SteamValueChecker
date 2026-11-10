// A wallpaper of soft hearts drifting up the screen, each swaying a little and glowing in pinks, reds and violets.
// It stands still if the device asks for less motion, and pauses in a background tab. Same start(host)/stop() as the waves.
(function (root) {
  "use strict";
  let bound = null, ro = null, canvas = null, ctx = null, raf = 0, w = 0, h = 0, dpr = 1, still = false, last = 0, hearts = [];
  const HUES = [338, 350, 322, 300, 8, 280];
  const light = () => document.documentElement.dataset.theme === "light";
  const rnd = (a, b) => a + Math.random() * (b - a);

  function make(fresh) {
    const size = rnd(10, 46);
    return { x: rnd(0, w), y: fresh ? rnd(0, h) : h + size * 2, size, speed: rnd(.018, .05) * (1.4 - size / 70), sway: rnd(8, 34), rate: rnd(.0004, .0011), phase: rnd(0, 6.28), hue: HUES[Math.floor(Math.random() * HUES.length)], alpha: rnd(.22, .6), beat: rnd(0, 6.28) };
  }
  function fill() { const n = Math.max(14, Math.min(46, Math.round(w * h / 32000))); hearts = Array.from({ length: n }, () => make(true)); }
  function size() {
    dpr = Math.min(2, root.devicePixelRatio || 1); w = bound ? bound.clientWidth : root.innerWidth; h = bound ? bound.clientHeight : root.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!hearts.length) fill(); draw(0);
  }
  /** One heart, centered on 0,0 and about `s` wide, from two curves. */
  function path(s) {
    const t = s / 2; ctx.beginPath();
    ctx.moveTo(0, t * .9);
    ctx.bezierCurveTo(-t * 1.5, -t * .1, -t * .9, -t * 1.25, 0, -t * .5);
    ctx.bezierCurveTo(t * .9, -t * 1.25, t * 1.5, -t * .1, 0, t * .9);
    ctx.closePath();
  }
  function draw(dt) {
    ctx.clearRect(0, 0, w, h);
    const dark = !light(); ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
    for (let i = 0; i < hearts.length; i++) {
      const o = hearts[i];
      if (!still) { o.y -= dt * o.speed; o.phase += dt * o.rate; o.beat += dt * .0032; }
      if (o.y < -o.size * 2) { hearts[i] = make(false); continue; }
      const fade = Math.min(1, (h - o.y + o.size) / (h * .18), Math.max(0, o.y + o.size) / (h * .25)), pulse = 1 + Math.sin(o.beat) * .06;
      ctx.save(); ctx.translate(o.x + Math.sin(o.phase) * o.sway, o.y); ctx.rotate(Math.sin(o.phase * .8) * .28); ctx.scale(pulse, pulse);
      path(o.size);
      const l = dark ? 62 : 52, a = o.alpha * Math.max(0, fade) * (dark ? 1 : .8), g = ctx.createRadialGradient(0, -o.size * .15, o.size * .05, 0, 0, o.size * .8);
      g.addColorStop(0, `hsla(${o.hue}, 100%, ${l + 14}%, ${a})`); g.addColorStop(1, `hsla(${o.hue}, 95%, ${l - 10}%, ${a * .55})`);
      ctx.shadowColor = `hsla(${o.hue}, 100%, 60%, ${a})`; ctx.shadowBlur = dark ? o.size * .9 : o.size * .4;
      ctx.fillStyle = g; ctx.fill(); ctx.restore();
    }
  }
  function frame(now) {
    const dt = Math.min(64, now - (last || now)); last = now; draw(dt);
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
    canvas = document.createElement("canvas"); canvas.id = "ix-hearts"; canvas.setAttribute("aria-hidden", "true");
    document.body.prepend(canvas); ctx = canvas.getContext("2d"); if (!ctx) { stop(); return; } if (host) attach(host);
    hearts = []; size(); root.addEventListener("resize", size); document.addEventListener("visibilitychange", onVis); last = 0; raf = root.requestAnimationFrame(frame);
  }
  function onVis() { if (!canvas || still) return; if (document.hidden) root.cancelAnimationFrame(raf); else { last = 0; raf = root.requestAnimationFrame(frame); } }
  function stop() {
    if (!canvas) return;
    root.cancelAnimationFrame(raf); root.removeEventListener("resize", size); document.removeEventListener("visibilitychange", onVis); canvas.remove(); canvas = ctx = null; bound = null; hearts = []; if (ro) ro.disconnect();
  }
  root.HeartsBg = { start, stop };
})(typeof globalThis !== "undefined" ? globalThis : this);

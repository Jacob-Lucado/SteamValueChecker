// The indie section's backdrop: a few glowing lines that roll slowly across the page, in the section's sunset colors.
// It only runs while you're in the indie area, stands still if you've asked your device for less motion, and pauses in a background tab.
(function (root) {
  "use strict";
  let canvas = null, ctx = null, raf = 0, t0 = 0, w = 0, h = 0, dpr = 1, still = false;
  const LINES = [
    { y: .52, amp: 46, len: 1.4, speed: .00032, phase: 0, hue: 22, width: 2.2 },
    { y: .6, amp: 38, len: 1.9, speed: -.00026, phase: 1.7, hue: 335, width: 2 },
    { y: .69, amp: 54, len: 1.1, speed: .00021, phase: 3.1, hue: 282, width: 2.4 },
    { y: .78, amp: 30, len: 2.3, speed: -.00036, phase: 4.6, hue: 12, width: 1.6 },
    { y: .87, amp: 42, len: 1.6, speed: .00028, phase: 5.8, hue: 318, width: 1.8 },
    { y: .44, amp: 28, len: 2.6, speed: -.0002, phase: 2.4, hue: 190, width: 1.4 }
  ];
  const light = () => document.documentElement.dataset.theme === "light";

  function size() {
    dpr = Math.min(2, root.devicePixelRatio || 1); w = root.innerWidth; h = root.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function frame(now) {
    ctx.clearRect(0, 0, w, h);
    const dark = !light(), step = w < 600 ? 10 : 6;
    ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
    for (const L of LINES) {
      const base = L.y * h, k = (Math.PI * 2 * L.len) / w, p = L.phase + (still ? 0 : (now - t0) * L.speed * 6);
      ctx.beginPath();
      for (let x = -10; x <= w + 10; x += step) {
        const y = base + Math.sin(x * k + p) * L.amp + Math.sin(x * k * 2.3 - p * 1.4) * (L.amp * .35) + Math.sin(x * k * .5 + p * .6) * (L.amp * .5);
        x === -10 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      const g = ctx.createLinearGradient(0, 0, w, 0), a = dark ? 0.9 : 0.55, l = dark ? 62 : 48;
      g.addColorStop(0, `hsla(${L.hue}, 100%, ${l}%, 0)`); g.addColorStop(.25, `hsla(${L.hue}, 100%, ${l}%, ${a})`); g.addColorStop(.75, `hsla(${(L.hue + 40) % 360}, 100%, ${l}%, ${a})`); g.addColorStop(1, `hsla(${(L.hue + 40) % 360}, 100%, ${l}%, 0)`);
      ctx.strokeStyle = g; ctx.lineWidth = L.width; ctx.lineJoin = "round";
      if (dark) { const w0 = ctx.lineWidth; ctx.globalAlpha = .18; ctx.lineWidth = w0 * 6; ctx.stroke(); ctx.globalAlpha = 1; ctx.lineWidth = w0; } // soft glow: a wide faint pass under the line, far cheaper than a real blur
      ctx.stroke();
    }
    if (!still && canvas) raf = root.requestAnimationFrame(frame);
  }
  function start() {
    if (canvas) return;
    still = Boolean(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
    canvas = document.createElement("canvas"); canvas.id = "ix-waves"; canvas.setAttribute("aria-hidden", "true");
    document.body.prepend(canvas); ctx = canvas.getContext("2d"); if (!ctx) { stop(); return; }
    t0 = performance.now(); size(); root.addEventListener("resize", size); document.addEventListener("visibilitychange", onVis); raf = root.requestAnimationFrame(frame);
  }
  function onVis() { if (!canvas || still) return; if (document.hidden) root.cancelAnimationFrame(raf); else raf = root.requestAnimationFrame(frame); }
  function stop() {
    if (!canvas) return;
    root.cancelAnimationFrame(raf); root.removeEventListener("resize", size); document.removeEventListener("visibilitychange", onVis); canvas.remove(); canvas = ctx = null;
  }
  root.IndieWaves = { start, stop };
})(typeof globalThis !== "undefined" ? globalThis : this);

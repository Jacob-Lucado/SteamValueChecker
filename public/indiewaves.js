// The indie section's backdrop: a glowing wireframe valley that drifts slowly toward you, with a few stars and a purple horizon.
// It only runs while you're in the indie area, holds still if you've asked your device for less motion, and pauses in a background tab.
(function (root) {
  "use strict";
  const ROWS = 36, NEAR = 1.5, FAR = 36, COL_GAP = .45, SPEED = 0.00075;
  let canvas = null, ctx = null, raf = 0, t0 = 0, w = 0, h = 0, dpr = 1, still = false, cols = 28, stars = [];
  const light = () => document.documentElement.dataset.theme === "light";

  // The ground: a calm floor down the middle, with ridges that climb on both sides. Pure maths, so it can scroll forever.
  const ridge = (x, z) => Math.sin(x * 1.25 + z * .62) + .6 * Math.sin(x * .7 - z * 1.05) + .3 * Math.sin(x * 2.1 + z * .43);
  function height(x, z) {
    const side = Math.max(0, Math.abs(x) - 2.6), wall = Math.min(1, side / 2.4);
    return (.16 * Math.sin(x * 1.9 + z * 1.3) + .1 * Math.sin(z * .9 - x)) + wall * wall * (1.1 + 1.5 * (ridge(x, z) * .5 + .5));
  }

  function size() {
    dpr = Math.min(2, root.devicePixelRatio || 1); w = root.innerWidth; h = root.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = w < 600 ? 28 : 46; stars = Array.from({ length: w < 600 ? 40 : 90 }, () => ({ x: Math.random(), y: Math.random() * .4, r: Math.random() * 1.1 + .3, ph: Math.random() * 6.28 }));
  }

  function frame(now) {
    const dark = !light(), t = still ? 0 : now - t0, horizon = h * .42, focal = h * .6, camH = 2.3, camX = Math.sin(t * .00018) * 1.3;
    ctx.clearRect(0, 0, w, h);
    if (dark) {
      for (const s of stars) { ctx.globalAlpha = .25 + .45 * (.5 + .5 * Math.sin(t * .0012 + s.ph)); ctx.fillStyle = "#e9dcff"; ctx.fillRect(s.x * w, s.y * h, s.r, s.r); }
      ctx.globalAlpha = 1;
      const g = ctx.createLinearGradient(0, horizon - h * .13, 0, horizon + h * .05);
      g.addColorStop(0, "rgba(160, 60, 255, 0)"); g.addColorStop(.7, "rgba(200, 80, 255, .32)"); g.addColorStop(1, "rgba(120, 40, 255, 0)");
      ctx.fillStyle = g; ctx.fillRect(0, horizon - h * .13, w, h * .18);
    }
    // Rows slide toward you; the fractional part keeps the motion smooth between whole rows.
    const shift = (t * SPEED) % 1, grid = [];
    for (let i = 0; i <= ROWS; i++) {
      const z = NEAR + ((i - shift) / ROWS) ** 1.55 * (FAR - NEAR), row = [], scale = focal / z;
      const dz = z + t * SPEED * 1.6; // the ground is sampled further along as time passes, so the hills travel with the lines
      for (let c = -cols / 2; c <= cols / 2; c++) {
        const x = c * COL_GAP + camX;
        row.push([w / 2 + (c * COL_GAP) * scale, horizon + (camH - height(x, dz * .55)) * scale]);
      }
      grid.push({ z, row, fade: Math.max(0, 1 - (z - NEAR) / (FAR - NEAR)) ** 1.4 });
    }
    ctx.lineJoin = "round"; ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
    for (let i = ROWS; i >= 0; i--) {
      const { row, fade } = grid[i], near = 1 - i / ROWS, hue = 285 - near * 80, a = (dark ? .08 + .55 * fade : .06 + .32 * fade);
      const trace = () => {
        ctx.beginPath(); row.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        if (i < ROWS) { const far = grid[i + 1].row; for (let k = 0; k < row.length; k++) { ctx.moveTo(row[k][0], row[k][1]); ctx.lineTo(far[k][0], far[k][1]); } } // the lines that run away from you
        ctx.stroke();
      };
      // The glow is a wide faint pass under the sharp line. A real blur looks the same but is far slower on weaker machines.
      if (dark && fade > .4) { ctx.strokeStyle = `hsla(${hue}, 100%, 60%, ${a * .22})`; ctx.lineWidth = 5 + 5 * fade; trace(); }
      ctx.strokeStyle = `hsla(${hue}, 100%, ${dark ? 62 : 45}%, ${a})`; ctx.lineWidth = .6 + 1.4 * fade; trace();
    }
    ctx.globalCompositeOperation = "source-over";
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

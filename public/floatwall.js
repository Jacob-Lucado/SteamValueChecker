// A wallpaper of glowing frames and little Steam logos that float out of the middle of the screen toward you, in the site's own blues and violets.
// It's a CSS animation (the browser does the work on the graphics chip), stands still if the device asks for less motion, and has the same start(host)/stop() as the waves.
(function (root) {
  "use strict";
  const NS = "http://www.w3.org/2000/svg", CELLS = 30, DOTS = 22, HUES = [212, 256, 188, 232, 276, 172];
  // The Steam mark, same shape the sign-in button uses.
  const STEAM = "M12 2a10 10 0 0 0-9.96 9.1l5.35 2.2a2.8 2.8 0 0 1 1.6-.5h.15l2.4-3.45v-.05a3.75 3.75 0 1 1 3.75 3.75h-.1l-3.4 2.45a2.8 2.8 0 0 1-5.55.45L2.3 14.2A10 10 0 1 0 12 2z";
  let box = null, bound = null;
  const light = () => document.documentElement.dataset.theme === "light";
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const color = () => (Math.random() < .12 ? (light() ? "hsl(214 60% 40%)" : "#eaf4ff") : `hsl(${pick(HUES)} 100% ${light() ? 54 : 68}%)`);

  function logo() {
    const s = document.createElementNS(NS, "svg"), p = document.createElementNS(NS, "path");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); p.setAttribute("d", STEAM); s.append(p); return s;
  }
  function build() {
    const wrap = document.createElement("div"); wrap.id = "ix-float"; wrap.setAttribute("aria-hidden", "true");
    for (let i = 0; i < CELLS; i++) {
      const c = document.createElement("div"), col = color();
      c.className = "fw-cell"; c.style.setProperty("--c", col); c.style.setProperty("--deg", pick([-180, 180]) + "deg"); c.style.setProperty("--i", String(i));
      // a scatter of tiny glints inside the frame
      c.style.backgroundImage = Array.from({ length: DOTS }, () => `radial-gradient(${col} 50%, transparent 0)`).join(",");
      c.style.backgroundPosition = Array.from({ length: DOTS }, () => `${rnd(-20, 120).toFixed(0)}% ${rnd(-20, 100).toFixed(0)}%`).join(",");
      c.style.backgroundSize = "1px 1px"; c.style.backgroundRepeat = "no-repeat";
      for (let k = 0; k < 2; k++) {
        const s = logo(), size = rnd(5, 13);
        s.setAttribute("class", "fw-logo"); s.style.left = rnd(0, 100).toFixed(0) + "%"; s.style.top = rnd(0, 100).toFixed(0) + "%"; s.style.width = s.style.height = size.toFixed(1) + "px";
        c.append(s);
      }
      wrap.append(c);
    }
    return wrap;
  }
  function place(host) { bound = host || null; box.classList.toggle("in", Boolean(bound)); (bound || document.body).prepend(box); }
  function start(host) {
    if (box) { if ((host || null) !== bound) place(host); return; }
    box = build(); place(host);
  }
  function stop() { if (!box) return; box.remove(); box = null; bound = null; }
  root.FloatBg = { start, stop };
})(typeof globalThis !== "undefined" ? globalThis : this);

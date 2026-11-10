// The moving part of a profile style: a light canvas of embers, petals or snow behind the cards.
// It stops for people who ask their device for less motion, and pauses while the tab is hidden.
(function () {
  const KINDS = {
    embers: { n: 70, color: () => (Math.random() < .7 ? "193,18,31" : "179,155,108"), lighter: true, make: (w, h, r) => ({ x: r() * w, y: h + r() * 40, vx: (r() - .5) * .3, vy: -(.3 + r() * .9), s: .6 + r() * 1.8, a: .3 + r() * .6, sway: r() * 6 }), step: (p, t) => { p.x += p.vx + Math.sin(t / 700 + p.sway) * .25; p.y += p.vy; p.a -= .0016; }, dead: (p) => p.y < -10 || p.a <= 0, draw: (c, p, col) => { c.fillStyle = `rgba(${col},${Math.max(p.a, 0)})`; c.beginPath(); c.arc(p.x, p.y, p.s, 0, 6.3); c.fill(); } },
    petals: { n: 28, color: () => "224,120,150", lighter: false, make: (w, h, r) => ({ x: r() * w, y: -20 - r() * 60, vx: .2 + r() * .5, vy: .4 + r() * .8, s: 3 + r() * 4, a: .35 + r() * .45, rot: r() * 6, vr: (r() - .5) * .04 }), step: (p, t) => { p.x += p.vx + Math.sin(t / 900 + p.rot) * .4; p.y += p.vy; p.rot += p.vr; }, dead: (p, w, h) => p.y > h + 20 || p.x > w + 20, draw: (c, p, col) => { c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.fillStyle = `rgba(${col},${p.a})`; c.beginPath(); c.ellipse(0, 0, p.s, p.s * .55, 0, 0, 6.3); c.fill(); c.restore(); } },
    snow: { n: 90, color: () => "220,240,255", lighter: false, make: (w, h, r) => ({ x: r() * w, y: -10 - r() * 40, vx: (r() - .5) * .4, vy: .35 + r() * .9, s: .6 + r() * 1.8, a: .3 + r() * .6, sway: r() * 6 }), step: (p, t) => { p.x += p.vx + Math.sin(t / 1100 + p.sway) * .3; p.y += p.vy; }, dead: (p, w, h) => p.y > h + 10, draw: (c, p, col) => { c.fillStyle = `rgba(${col},${p.a})`; c.beginPath(); c.arc(p.x, p.y, p.s, 0, 6.3); c.fill(); } }
  };
  let raf = 0, cv = null;
  function stop() { cancelAnimationFrame(raf); raf = 0; cv?.remove(); cv = null; }
  function start(host, kind) {
    stop();
    const k = KINDS[kind];
    if (!k || !host || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    cv = document.createElement("canvas"); cv.className = "pf-fx"; cv.setAttribute("aria-hidden", "true");
    host.append(cv);
    const c = cv.getContext("2d"); let w = 0, h = 0, parts = [];
    const rnd = Math.random;
    const size = () => { const b = host.getBoundingClientRect(); w = cv.width = Math.max(1, Math.round(b.width)); h = cv.height = Math.max(1, Math.round(Math.min(b.height, 1800))); };
    size();
    const spawn = (scatter) => { const p = k.make(w, h, rnd); p.col = k.color(); if (scatter) p.y = rnd() * h; return p; };
    parts = Array.from({ length: k.n }, () => spawn(true));
    const frame = (t) => {
      if (!cv || !cv.isConnected) return stop();
      if (document.hidden) { raf = requestAnimationFrame(frame); return; }
      if (host.getBoundingClientRect().width !== w) size();
      c.clearRect(0, 0, w, h);
      c.globalCompositeOperation = k.lighter ? "lighter" : "source-over";
      for (let i = 0; i < parts.length; i++) { const p = parts[i]; k.step(p, t); if (k.dead(p, w, h)) parts[i] = spawn(false); else k.draw(c, p, p.col); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }
  window.ProfileFx = { start, stop };
})();

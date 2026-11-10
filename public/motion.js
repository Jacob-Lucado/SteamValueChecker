// Page motion shared by every public page and the app: smooth wheel scrolling, a progress bar, reveal on scroll, count-up
// numbers, a pointer glow, button ripples and a page-enter animation. Nothing here is needed for the pages to work, so
// every part skips itself for people who ask for reduced motion.
(() => {
  const root = document.documentElement;
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (calm) return;
  root.classList.add("mo");

  // ---------- smooth scrolling (mouse wheel and in-page links; trackpads and touch already scroll smoothly) ----------
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  let target = 0, now = 0, running = false, lastSet = 0;
  const max = () => Math.max(0, root.scrollHeight - innerHeight);
  const clamp = v => Math.max(0, Math.min(max(), v));
  const step = () => {
    const d = target - now;
    if (Math.abs(d) < 0.4) { now = target; scrollTo(0, now); lastSet = scrollY; running = false; return; }
    now += d * 0.14; scrollTo(0, now); lastSet = scrollY;
    requestAnimationFrame(step);
  };
  const go = y => { if (!running) { now = scrollY; } target = clamp(y); if (!running) { running = true; requestAnimationFrame(step); } };
  const scrollable = (el, dy) => {
    for (; el && el !== document.body && el !== root; el = el.parentElement) {
      const s = getComputedStyle(el);
      if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1) {
        if ((dy < 0 && el.scrollTop > 0) || (dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1)) return true;
      }
    }
    return false;
  };
  if (fine) {
    root.classList.add("smooth-js");
    addEventListener("wheel", e => {
      if (e.ctrlKey || e.defaultPrevented || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (getComputedStyle(document.body).overflow === "hidden" || getComputedStyle(root).overflow === "hidden") return;
      const dy = e.deltaMode === 1 ? e.deltaY * 34 : e.deltaMode === 2 ? e.deltaY * innerHeight : e.deltaY;
      // Small fractional steps come from a trackpad, which already has its own smoothing.
      if (e.deltaMode === 0 && (Math.abs(dy) < 40 || !Number.isInteger(dy))) return;
      if (scrollable(e.target, dy)) return;
      e.preventDefault();
      go((running ? target : scrollY) + dy * 0.9);
    }, { passive: false });
    // Scrolling that did not come from here (keyboard, scroll bar, the app jumping to the top) takes over.
    addEventListener("scroll", () => { if (running && Math.abs(scrollY - lastSet) > 3) { running = false; } }, { passive: true });
    document.addEventListener("click", e => {
      const a = e.target.closest?.('a[href^="#"]');
      if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
      const id = a.getAttribute("href").slice(1);
      if (!/^[A-Za-z][\w-]*$/.test(id)) return;
      const el = document.getElementById(id);
      if (!el) return;
      e.preventDefault();
      const pad = parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
      // Layout position, not the drawn one: an element still fading in is shifted by its transform.
      let top = 0; for (let n = el; n; n = n.offsetParent) top += n.offsetTop;
      go(top - pad);
      history.replaceState(null, "", "#" + id);
    });
  }

  // ---------- progress bar ----------
  const bar = document.createElement("div"); bar.className = "mo-bar"; bar.setAttribute("aria-hidden", "true");
  let barRaf = 0;
  const drawBar = () => { barRaf = 0; const m = max(); bar.style.setProperty("transform", `scaleX(${m ? Math.min(1, scrollY / m) : 0})`); };
  addEventListener("scroll", () => { if (!barRaf) barRaf = requestAnimationFrame(drawBar); }, { passive: true });

  // ---------- reveal on scroll ----------
  const GROUPS = [
    "#app .panel", "#app .tile", "#app .lx-newcard", "#app .lx-feat > *", "#app .lx-sec", "#app .lx-final",
    "main > section", ".faq details", ".more .links", "#features .card", ".tool"
  ].join(",");
  const io = new IntersectionObserver(list => {
    for (const en of list) if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); countUp(en.target); }
  }, { threshold: 0, rootMargin: "0px 0px -8% 0px" });
  const arm = el => {
    if (el.dataset.rv !== undefined || el.closest(".reveal,[data-no-motion]") || el.classList.contains("reveal")) return;
    const r = el.getBoundingClientRect();
    // Anything already on screen just shows (the page-enter animation covers it); the rest waits to be scrolled to.
    if (r.top < innerHeight * 0.92 && r.bottom > 0) return;
    const sibs = el.parentElement ? [...el.parentElement.children].filter(c => c.tagName === el.tagName) : [el];
    el.setAttribute("data-rv", ""); el.style.setProperty("--rv", String(Math.min(5, Math.max(0, sibs.indexOf(el)) % 6)));
    io.observe(el);
  };
  const scan = scope => { (scope.querySelectorAll ? scope.querySelectorAll(GROUPS) : []).forEach(arm); if (scope.matches?.(GROUPS)) arm(scope); };

  // ---------- count-up numbers: <b data-count="1284"> ----------
  function countUp(scope) {
    for (const el of [...(scope.querySelectorAll?.("[data-count]") ?? []), ...(scope.matches?.("[data-count]") ? [scope] : [])]) {
      if (el.dataset.counted) continue; el.dataset.counted = "1";
      const to = Number(el.dataset.count); if (!Number.isFinite(to)) continue;
      const t0 = performance.now(), dur = 1100, dec = Number(el.dataset.decimals || 0);
      const draw = t => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 4); el.textContent = (el.dataset.prefix || "") + (to * e).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + (el.dataset.suffix || ""); if (p < 1) requestAnimationFrame(draw); };
      requestAnimationFrame(draw);
    }
  }

  // ---------- pointer glow on cards, button ripple ----------
  const GLOW = ".panel,.tile,.lx-newcard,.lx-feat > *,.card,.sale,.ts-row";
  if (fine) addEventListener("pointermove", e => {
    const c = e.target.closest?.(GLOW); if (!c) return;
    const r = c.getBoundingClientRect();
    if (!c.classList.contains("mo-glow")) c.classList.add("mo-glow");
    c.style.setProperty("--mx", `${e.clientX - r.left}px`); c.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, { passive: true });
  document.addEventListener("pointerdown", e => {
    const b = e.target.closest?.(".btn,button.go,.lx-cta a,.cta a"); if (!b || b.disabled) return;
    const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2;
    b.classList.add("mo-ripple-host");
    const d = document.createElement("span"); d.className = "mo-ripple";
    for (const [k, v] of [["width", s], ["height", s], ["left", e.clientX - r.left - s / 2], ["top", e.clientY - r.top - s / 2]]) d.style.setProperty(k, v + "px");
    b.append(d); setTimeout(() => d.remove(), 650);
  });

  // ---------- page enter and ambient color ----------
  const hero = () => {
    const h = document.querySelector("main h1") ?? document.querySelector(".hero h1, .lx-hero h1");
    const box = h?.parentElement; if (!box || box.classList.contains("mo-hero")) return;
    box.classList.add("mo-hero"); [...box.children].slice(0, 7).forEach((c, i) => c.style.setProperty("--i", String(i)));
  };
  const aurora = () => {
    const want = root.hasAttribute("data-aurora") || document.querySelector("main.wrap > h1");
    const has = document.querySelector(".mo-aurora");
    if (want && !has) { const a = document.createElement("div"); a.className = "mo-aurora"; a.setAttribute("aria-hidden", "true"); document.body.prepend(a); }
    else if (!want && has) has.remove();
  };

  const boot = () => {
    document.body.append(bar); drawBar(); hero(); aurora(); scan(document); countUp(document);
    // The app draws its pages after load: pick up what it adds, and do the page-enter again after each route change.
    const app = document.getElementById("app");
    if (app) new MutationObserver(ms => {
      for (const m of ms) m.addedNodes.forEach(n => { if (n.nodeType === 1) { scan(n); countUp(n); } });
      hero(); aurora();
    }).observe(app, { childList: true, subtree: true });
    // Elements we hid but that never reach the screen (a hidden tab, a layout that moved) must not stay invisible.
    setTimeout(() => document.querySelectorAll("[data-rv]:not(.in)").forEach(el => { const r = el.getBoundingClientRect(); if (r.top < innerHeight && r.bottom > 0) { el.classList.add("in"); io.unobserve(el); } }), 2500);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();

// Runs before the page paints, so there is no flash of the wrong theme.
// Uses the saved choice, otherwise the system setting. Storage can be blocked, so it is always wrapped.
(() => {
  "use strict";
  const KEY = "svc_theme";
  const root = document.documentElement;
  const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;

  const saved = () => { try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : null; } catch { return null; } };
  const system = () => (mq && mq.matches ? "light" : "dark");

  function apply(theme) {
    root.setAttribute("data-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#ffffff" : "#0f1724");
    window.dispatchEvent(new CustomEvent("svc-theme", { detail: theme }));
  }

  apply(saved() || system());
  if (mq && mq.addEventListener) mq.addEventListener("change", () => { if (!saved()) apply(system()); });

  window.svcTheme = {
    current: () => root.getAttribute("data-theme"),
    toggle() {
      const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      try { localStorage.setItem(KEY, next); } catch { /* private mode: still switches for this visit */ }
      apply(next);
      return next;
    }
  };
})();

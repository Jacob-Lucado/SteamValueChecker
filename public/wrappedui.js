// Steam Wrapped: your year in games as five pictures you can flip through, save and share.
// app.js hands over its helpers (ctx) and calls WrappedUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, field, h, pageHead, select, state } = ctx;
    const thisYear = new Date().getFullYear();
    const years = [thisYear, thisYear - 1, thisYear - 2].map(String);
    const year = select(years.map(y => [y, y]), years[0]);
    const out = h("div");
    app.replaceChildren(pageHead("Wrapped", "Your year in games in five pictures: hours, top games, your best month and what kind of player you are. Counted from the day you linked Steam. In Discord: /me steam wrapped."),
      h("div", { class: "panel" }, field("Year", year)), out);
    async function load() {
      out.replaceChildren(h("p", { class: "muted", text: "Loading…" }));
      let r;
      try { r = await api("/api/steam/wrapped?year=" + encodeURIComponent(year.value)); } catch (e) { out.replaceChildren(h("div", { class: "notice warn", text: e.message })); return; }
      if (!r.data) { out.replaceChildren(h("div", { class: "empty", text: `Nothing tracked for ${r.year} yet. Hours count from the day you link Steam, so play something and check back.` })); return; }
      let at = 1;
      const img = h("img", { class: "wrapped-slide", alt: "" });
      const label = h("p", { class: "muted small center" });
      const prev = h("button", { class: "btn gray", type: "button", text: "Back", "aria-label": "Previous picture" });
      const next = h("button", { class: "btn blue", type: "button", text: "Next", "aria-label": "Next picture" });
      const save = h("a", { class: "btn gray", text: "Save this picture", download: "" });
      const dots = h("div", { class: "wrapped-dots", role: "tablist" });
      const src = n => `/api/steam/wrapped/${n}.png?year=${encodeURIComponent(r.year)}`;
      const show = n => {
        at = Math.min(r.slides, Math.max(1, n));
        img.src = src(at); img.alt = `Picture ${at} of ${r.slides} of your ${r.year} in games`;
        label.textContent = `${at} of ${r.slides}`;
        save.href = src(at); save.setAttribute("download", `wrapped-${r.year}-${at}.png`);
        prev.disabled = at === 1; next.disabled = at === r.slides;
        [...dots.children].forEach((d, i) => { d.className = i + 1 === at ? "dot on" : "dot"; d.setAttribute("aria-selected", String(i + 1 === at)); });
      };
      for (let n = 1; n <= r.slides; n++) { const d = h("button", { class: "dot", type: "button", role: "tab", "aria-label": "Picture " + n }); d.addEventListener("click", () => show(n)); dots.append(d); }
      prev.addEventListener("click", () => show(at - 1)); next.addEventListener("click", () => show(at + 1));
      out.replaceChildren(
        h("div", { class: "panel" },
          h("p", {}, h("b", { text: r.data.hours.toLocaleString("en-US") + " hours" }), ` across ${r.data.games} games on ${r.data.activeDays} days. You are `, h("b", { text: r.data.archetype }), r.data.partial ? " (so far this year)." : "."),
          h("p", { class: "muted small", text: r.data.line })),
        h("div", { class: "wrapped" }, img, label, dots, h("div", { class: "row center" }, prev, next, save)));
      show(1);
    }
    year.addEventListener("change", load); await load();
  }
  root.WrappedUI = { view };
})(window);

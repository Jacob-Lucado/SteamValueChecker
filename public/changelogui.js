// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls ChangelogUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, h, inline, pageHead, renderChrome, state } = ctx;
    const holder = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(pageHead("What's new", ""), holder);
    try {
      const d = await api("/api/changelog");
      state.me.news = null; renderChrome();
      holder.className = "";
      holder.replaceChildren(...d.entries.map(e => h("div", { class: "panel" }, h("h3", { text: e.title }), h("p", { class: "muted small", text: e.date }), h("ul", {}, ...e.items.map(x => h("li", {}, inline(x)))))));
    } catch (e) { holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
  }
  root.ChangelogUI = { view };
})(window);

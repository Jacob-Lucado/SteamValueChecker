// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls FreeUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, h, loadFree, pageHead, soonPanel, state, toast } = ctx;
    const panel = h("div", { class: "panel" }, h("h3", { text: "Free right now" }), h("p", { class: "muted", text: "Loading…" }));
    const set = state.me.settings;
    const sw = (key, label, hint) => { const c = h("input", { type: "checkbox", checked: key === "free_dlc" ? set.free_dlc !== false : Boolean(set[key]) });
      c.addEventListener("change", async () => { try { const r = await api("/api/settings", { [key]: c.checked }); state.me.settings = r.settings; toast("Saved.", "ok"); if (key === "free_dlc") loadFree(panel); } catch (e) { toast(e.message, "error"); c.checked = !c.checked; } });
      return h("label", { class: "check" }, c, " ", h("b", { text: label }), " ", h("span", { class: "muted small", text: hint })); };
    app.replaceChildren(pageHead("Free games", "Everything that is free to claim right now on Steam, Epic, GOG and more. Claiming happens on the store's site."),
      h("div", { class: "panel" }, sw("free", "Tell me when a game goes free", "(sent by DM or to your alert channel)"), h("p"), sw("free_dlc", "Show free DLC", "(also hides it from /games freegames)")),
      soonPanel(), panel);
    loadFree(panel);
  }
  root.FreeUI = { view };
})(window);

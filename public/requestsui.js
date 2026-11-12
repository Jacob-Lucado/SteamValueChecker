// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls RequestsUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { app, h, pageHead, requestList } = ctx;
    const box = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(pageHead("Feature requests", "Suggest something for the bot, vote on ideas, and see what's planned or being built."), box);
    await requestList(box);
    box.className = "";
  }
  root.RequestsUI = { view };
})(window);

// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls HelpUI.view(ctx).
(function (root) {
  "use strict";
  function view(ctx) {
    const { app, commandGuidePanel, ext, fanaticalCard, h, md, pageHead, state } = ctx;
    app.replaceChildren(
      pageHead("Help", "The dashboard does everything the Discord commands do."),
      ...(state.cfg.supportUrl ? [h("div", { class: "panel support-panel" }, h("h3", { text: "Need a hand?" }),
        h("p", { class: "muted", text: "Join the support server to ask questions, share ideas, report bugs and see new features as they land." }),
        h("div", { class: "row" }, ext(state.cfg.supportUrl, "Join the support server", "btn blue big")))] : []),
      h("div", { class: "panel" }, h("h3", { text: "Using the bot" }), md(state.cfg.help)),
      commandGuidePanel(),
      h("div", { class: "panel" }, h("h3", { text: "Privacy" }), md(state.cfg.privacy)),
      fanaticalCard());
  }
  root.HelpUI = { view };
})(window);

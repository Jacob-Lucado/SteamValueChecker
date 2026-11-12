// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls PublicProfileUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx, slug) {
    const { api, app, h, renderProfile } = ctx;
    const holder = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(holder);
    try {
      const d = await api("/api/public/profile?slug=" + encodeURIComponent(slug));
      document.title = d.profile.name + " on Steam Value Checker";
      app.replaceChildren(renderProfile(d.profile, { canMark: d.canMark, signedIn: d.signedIn, region: d.region, social: d.social }));
    } catch (e) { holder.className = ""; holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
  }
  root.PublicProfileUI = { view };
})(window);

// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls AboutUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, ext, h, md, safeHref, state } = ctx;
    const holder = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(holder);
    try {
      const x = await api("/api/about");
      state.about = x.about; state.creator = x.creator; state.freeNow = x.freeNow ?? null;
      const ab = x.about, c = x.creator;
      const n = v => (v === null || v === undefined ? "-" : Number(v).toLocaleString());
      const tile = (icon, k, v) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: String(v) }));
      holder.className = "about-page";
      holder.replaceChildren(
        // Drawn in the page rather than shown as a picture, so it stays sharp on any screen.
        h("div", { class: "about-banner-live", role: "img", "aria-label": "Steam Value Checker: MSRP, sale price and cheapest price now" },
          h("i", { class: "ab-ring r1", "aria-hidden": "true" }), h("i", { class: "ab-ring r2", "aria-hidden": "true" }),
          h("img", { class: "ab-tag", src: "/tag.svg", alt: "", width: "108", height: "120" }),
          h("div", { class: "ab-text" }, h("h1", { class: "ab-title", text: "Steam Value Checker" }), h("div", { class: "ab-sub", text: "MSRP, sale price and cheapest price now" }), h("div", { class: "ab-note", text: "Works with FanaticalGrabber exports" }))),
        h("div", { class: "panel about" },
          h("div", { class: "about-head" },
            h("img", { class: "about-logo", src: "/logo.png", alt: "", width: "84", height: "84" }),
            h("div", {}, h("h3", { text: "Steam Value Checker" }),
              c && h("div", { class: "creator" }, h("img", { class: "creator-logo", src: "/creator.png", alt: "", width: "32", height: "32" }), "Created by ", ext(c.url, c.name)))),
          md(state.cfg.about),
          ab && h("p", { class: "muted small", text: "Online since " + new Date(ab.startedAt).toLocaleString() + " · v" + ab.version + " · Node " + String(ab.node).replace(/^v/, "") }),
          ab ? h("div", { class: "grid four about-stats" },
            tile("", "Uptime", ab.uptime), tile("", "Servers", n(ab.servers)), tile("", "Members reached", n(ab.members)), tile("", "Latency", ab.pingMs === null ? "-" : ab.pingMs + " ms"),
            tile("", "Games watched", n(ab.gamesWatched)), tile("", "Alerts, last 24h", n(ab.alerts24h)), tile("", "Giveaways run", n(ab.giveaways)), tile("", "Keys redeemed", n(ab.redeemed)))
            : h("p", { class: "muted", text: "Live numbers are not available right now." }),
          h("div", { class: "rule inline" },
            c && h("a", { class: "btn blue", href: safeHref(c.url), target: "_blank", rel: "noopener noreferrer", text: "Created by " + c.name }),
            h("a", { class: "btn gray", href: safeHref(state.cfg.fanaticalUrl), target: "_blank", rel: "noopener noreferrer", text: "FanaticalGrabber" }),
            h("a", { class: "btn gray", href: "/licenses.html", text: "Licenses" }))));
    } catch (e) { holder.className = ""; holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
  }
  root.AboutUI = { view };
})(window);

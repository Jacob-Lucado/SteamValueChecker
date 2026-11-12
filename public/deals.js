// The deals page.
// app.js hands over its helpers (ctx) and calls DealsUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, busy, ext, field, h, money, pageHead } = ctx;
    const bundlesOut = h("div", { class: "muted", text: "Looking for bundles…" });
    const game = h("input", { type: "text", placeholder: "A game or a bundle page link (leave empty to check your wishlist)", maxlength: "300" });
    const tone = l => (l === "great" || l === "good" ? "ok" : l === "wait" ? "warn" : "");
    async function loadBundles() {
      bundlesOut.className = "muted"; bundlesOut.replaceChildren("Looking for bundles…");
      try {
        const d = await api("/api/bundles" + (game.value.trim() ? "?game=" + encodeURIComponent(game.value.trim()) : ""));
        bundlesOut.className = "";
        if (!d.bundles.length) { bundlesOut.replaceChildren(h("div", { class: "empty", text: game.value.trim() ? "That game is not in an active bundle right now." : "None of your wishlist games are in an active bundle right now." })); return; }
        bundlesOut.replaceChildren(...d.bundles.map(b => h("div", { class: "panel" },
          h("h3", { text: b.title }),
          h("p", { class: "muted small", text: [b.shop, b.expiry ? "ends " + new Date(b.expiry).toLocaleDateString() : null].filter(Boolean).join(" · ") }),
          h("div", { class: "notice " + tone(b.verdict.level), text: b.verdict.text }),
          h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Tier", "Games", "You own", "Worth today", "Saves", "On your wishlist"].map(c => h("th", { text: c })))),
            h("tbody", {}, b.tiers.map(t => h("tr", {}, h("td", { class: "num", text: money(t.price, b.currency || d.currency) }), h("td", { class: "num", text: String(t.games) }), h("td", { class: "num", text: String(t.owned) }),
              h("td", { class: "num", text: t.worth > 0 ? money(t.worth, b.currency || d.currency) : "–" }), h("td", { class: "num", text: t.worth > 0 ? (t.saves >= 0 ? "+" : "−") + money(Math.abs(t.saves), b.currency || d.currency) : "–" }), h("td", { text: t.wanted.slice(0, 4).join(", ") })))))),
          b.url ? ext(b.url, "Open the bundle") : null,
          h("p", { class: "muted small", text: "Assumes each tier includes the cheaper ones and leaves out games you own." }))));
      } catch (e) { bundlesOut.className = ""; bundlesOut.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    const checkBtn = h("button", { class: "btn blue", text: "Check bundles", onclick: () => busy(checkBtn, loadBundles) });
    const regionGame = h("input", { type: "text", placeholder: "A game, e.g. Hades", maxlength: "100" });
    const regionOut = h("div");
    const regionBtn = h("button", { class: "btn blue", text: "Compare regions", onclick: () => busy(regionBtn, async () => {
      const r = await api("/api/regions?game=" + encodeURIComponent(regionGame.value.trim()));
      const ranked = r.rows.some(x => x.usd !== null);
      regionOut.replaceChildren(h("div", { class: "panel" }, h("h3", { text: r.game + ": price by region" }),
        h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", { text: "Region" }), h("th", { text: "Cheapest" }), h("th", { text: ranked ? "In US dollars" : "" }), h("th", { text: "Shop" }))),
          h("tbody", {}, r.rows.map(x => h("tr", {}, h("td", { text: x.name + (x.home ? " (yours)" : "") }), h("td", { text: money(x.price, x.currency) }), h("td", { class: "muted", text: x.usd !== null && x.currency !== "USD" ? "about " + money(x.usd, "USD") : "" }), h("td", { text: x.shop })))))),
        h("p", { class: "muted small", text: "Keys and accounts are usually locked to the region they were sold in, so use this for information." })));
    }) });
    app.replaceChildren(pageHead("Check a deal", "Where a game is cheapest in the world, and whether a bundle is worth it. Planning a cart for a Steam sale is on the Sale planner page."),
      h("h2", { text: "Price by region" }), h("div", { class: "panel" }, field("Game", regionGame), h("p"), regionBtn), regionOut,
      h("h2", { text: "Bundle check" }), h("div", { class: "panel" }, field("Game", game), h("p"), checkBtn), bundlesOut,
      h("p", { class: "muted small" }, "Want a plan for the next sale? ", h("a", { href: "#/warroom", text: "Open the Sale planner" }), "."));
    loadBundles();
  }
  root.DealsUI = { view };
})(window);

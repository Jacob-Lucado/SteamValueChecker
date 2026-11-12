// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls GameUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx, id) {
    const { api, app, busy, ext, h, lineChart, money, pageHead, steamArt, toast } = ctx;
    const holder = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(holder);
    try {
      const g = await api("/api/game?id=" + encodeURIComponent(id));
      const cur = g.currency;
      const tile = (k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: v }), sub ? h("div", { class: "s", text: sub }) : "");
      const good = g.advice && (g.advice.verdict === "buy" || g.advice.verdict === "lean_buy");
      const add = h("button", { class: "btn green", text: "Add to my wishlist" });
      add.addEventListener("click", () => busy(add, async () => { await api("/api/wishlist/add", { title: g.title }); toast("Added.", "ok"); add.hidden = true; }));
      holder.className = "";
      holder.replaceChildren(
        pageHead(g.title, g.release ? "Released " + new Date(g.release).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : ""),
        g.appid ? steamArt(g.appid, "next-art") : "",
        h("div", { class: "game-actions" }, g.url ? ext(g.url, "View the best deal", "btn green") : "", g.onWishlist || g.inLibrary ? h("span", { class: "chip ok", text: g.inLibrary ? "In your library" : "On your wishlist" }) : add),
        h("div", { class: "grid four" },
          tile("Best price now", g.price != null ? money(g.price, cur) : "–", g.shop || ""),
          tile("Steam", g.steam != null ? money(g.steam, cur) : "–", g.msrp ? "Regular " + money(g.msrp, cur) : ""),
          tile("All-time low", g.atl != null ? money(g.atl, cur) : "–"),
          tile("1-year low", g.low1y != null ? money(g.low1y, cur) : "–", g.low3m != null ? "3-month " + money(g.low3m, cur) : "")),
        g.advice ? h("div", { class: "notice " + (good ? "ok" : "warn") }, h("b", { text: (good ? "" : "") + "Buy now or wait? " + g.advice.label + ". " }), g.advice.reasons.join(" ")) : "",
        g.points.length ? h("div", { class: "panel" }, h("h3", { text: "Price over the last year" }), lineChart([{ name: "Price", cls: "s0", points: g.points.map(p => ({ x: p.t, y: p.price })) }], { format: v => money(v, cur), label: "Price history for " + g.title })) : "",
        g.free.length ? h("div", { class: "panel" }, h("h3", { text: "Free right now" }), g.free.map(f => h("div", { class: "game-line" }, h("span", {}, h("b", { text: f.title }), " on " + f.shop), f.url ? ext(f.url, "Claim", "btn green small") : ""))) : "",
        g.bundles.length ? h("div", { class: "panel" }, h("h3", { text: "In a bundle" }), g.bundles.map(b => h("div", { class: "game-line" }, h("span", {}, h("b", { text: b.title }), ` (${b.shop || "bundle"}) from ${money(b.price, b.currency || cur)}`), b.url ? ext(b.url, "Open", "btn gray small") : ""))) : "",
        g.watchers ? h("p", { class: "muted", text: `${g.watchers} member${g.watchers === 1 ? "" : "s"} of your server ${g.watchers === 1 ? "is" : "are"} watching this (only people who opted in with /alerts share).` }) : "");
    } catch (e) { holder.className = ""; holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
  }
  root.GameUI = { view };
})(window);

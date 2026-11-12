// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls PublicWishlistUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx, slug) {
    const { api, app, ext, giftButton, h, pageHead, soonControl } = ctx;
    const holder = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(holder);
    try {
      const d = await api("/api/public/wishlist?slug=" + encodeURIComponent(slug));
      const money2 = (n, c) => (n === null || n === undefined ? "-" : new Intl.NumberFormat(undefined, { style: "currency", currency: c || "USD" }).format(n));
      holder.className = "";
      if (/^#[0-9a-f]{6}$/i.test(d.accent || "")) { holder.style.setProperty("--accent", d.accent); holder.style.setProperty("--accent-2", d.accent); }
      holder.replaceChildren(pageHead(d.slug + "'s wishlist", `${d.games.length} game${d.games.length === 1 ? "" : "s"} with today's best prices. Thinking of a gift?`),
        d.games.length ? h("div", { class: "free-grid" }, d.games.map(g => h("div", { class: "free-card" },
          g.art ? h("img", { src: g.art, alt: "", loading: "lazy" }) : h("div", { class: "free-noart", text: "" }),
          h("div", { class: "free-info" }, h("strong", { text: g.title }),
            h("span", { class: "muted small", text: (g.discount > 0 ? `${g.discount}% off • ` : "") + (g.shop || "") }),
            h("b", { text: money2(g.price, g.currency) }),
            g.url && ext(g.url, "View deal", "btn green small"), soonControl(g, d.slug, d.canMark), giftButton(g, d.slug, { signedIn: d.signedIn, owner: d.owner, open: d.giftsOpen !== false, region: d.region }))))) : h("div", { class: "empty", text: "Nothing on this list yet." }));
    } catch (e) { holder.className = ""; holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
  }
  root.PublicWishlistUI = { view };
})(window);

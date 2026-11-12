// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls ForYouUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, h, money, pageHead, select, steamArt } = ctx;
    const host = h("div", { class: "muted", text: "Finding deals for you…" });
    const st = { sort: "best", atl: false, great: false, wish: false, cut: 0, max: "any", shop: "all", page: 0 };
    let data = null, tries = 0;
    const PER = 24;
    const sorters = { best: null, cut: (a, b) => b.cut - a.cut, price: (a, b) => a.price - b.price };
    const chip = (label, on, fn) => { const b = h("button", { class: "chip-btn" + (on ? " on" : ""), type: "button", text: label }); b.addEventListener("click", fn); return b; };
    function draw() {
      const cur = data.currency;
      const shops = [...new Set(data.deals.map(d => d.shop))].sort();
      const maxN = st.max === "any" ? Infinity : Number(st.max);
      let list = data.deals.filter(d => d.cut >= st.cut && d.price <= maxN && (!st.atl || d.atl) && (!st.great || (d.match || 0) >= 80) && (!st.wish || d.wishlist) && (st.shop === "all" || d.shop === st.shop));
      if (sorters[st.sort]) list = [...list].sort(sorters[st.sort]);
      const pages = Math.max(1, Math.ceil(list.length / PER));
      st.page = Math.min(st.page, pages - 1);
      const sort = select([["best", "Best for you"], ["cut", "Biggest discount"], ["price", "Lowest price"]], st.sort);
      sort.addEventListener("change", () => { st.sort = sort.value; st.page = 0; draw(); });
      const maxSel = select([["any", "Any"], ["5", "Under 5"], ["10", "Under 10"], ["20", "Under 20"], ["40", "Under 40"]], st.max);
      maxSel.addEventListener("change", () => { st.max = maxSel.value; st.page = 0; draw(); });
      const set = (k, v) => () => { st[k] = v; st.page = 0; draw(); };
      const card = d => h("a", { class: "fy-card", href: d.url && /^https:\/\//.test(d.url) ? d.url : "#/foryou", target: "_blank", rel: "noopener noreferrer" },
        h("div", { class: "fy-match" + (d.match === null ? " none" : ""), "aria-label": d.match === null ? "No match score yet" : d.match + " percent match" }, h("b", { text: d.match === null ? "–" : String(d.match) }), h("small", { text: "MATCH" })),
        steamArt(d.appid, "fy-art", 460, 215, d.id),
        h("div", { class: "fy-info" },
          h("strong", { class: "fy-title", text: d.title }),
          h("span", { class: "muted small", text: d.shop + (d.atl ? " · all-time low" : "") + (d.wishlist ? " · on your wishlist" : "") }),
          d.genres.length ? h("span", { class: "fy-genres", text: d.genres.join(" · ") }) : null),
        h("div", { class: "fy-price" }, h("span", { class: "fy-cut", text: "-" + d.cut + "%" }), h("b", { text: money(d.price, cur) }), h("s", { text: money(d.regular, cur) })));
      const prev = h("button", { class: "pg-btn wide", text: "‹ Prev", onclick: () => { st.page--; draw(); host.scrollIntoView({ block: "start" }); } }); prev.disabled = st.page === 0;
      const next = h("button", { class: "pg-btn wide", text: "Next ›", onclick: () => { st.page++; draw(); host.scrollIntoView({ block: "start" }); } }); next.disabled = st.page >= pages - 1;
      host.className = "";
      host.replaceChildren(
        !data.personalized ? h("div", { class: "notice" }, "These are the best current discounts. ", h("a", { href: "#/steam", text: "Sign in through Steam" }), " (or add wishlist games) and they will be ranked for you.") : null,
        h("div", { class: "panel fy-filters" },
          h("div", { class: "fy-row" }, h("span", { class: "fy-lab", text: "Sort" }), sort,
            chip("All-time low", st.atl, set("atl", !st.atl)), chip("Strong match 80+", st.great, set("great", !st.great)), chip("On wishlist", st.wish, set("wish", !st.wish))),
          h("div", { class: "fy-row" }, h("span", { class: "fy-lab", text: "Discount" }), ...[[0, "Any discount"], [25, "25%+"], [50, "50%+"], [75, "75%+"]].map(([n, t]) => chip(t, st.cut === n, set("cut", n))),
            h("span", { class: "fy-lab", text: "Max price" }), maxSel),
          shops.length > 1 ? h("div", { class: "fy-row" }, h("span", { class: "fy-lab", text: "Store" }), chip("All", st.shop === "all", set("shop", "all")), ...shops.slice(0, 12).map(x => chip(x, st.shop === x, set("shop", x)))) : null),
        h("p", { class: "muted small", text: `${list.length} deals matched · ranked for you` + (data.pending ? ` · still reading genres for ${data.pending} games` : "") }),
        list.length ? h("div", { class: "fy-grid" }, list.slice(st.page * PER, (st.page + 1) * PER).map(card)) : h("div", { class: "empty", text: "No deals match those filters." }),
        h("div", { class: "lib-pager" }, h("div", { class: "pg-nav" }, prev, h("span", { class: "muted small", text: `Page ${st.page + 1} of ${pages}` }), next)));
    }
    async function load() {
      try {
        data = await api("/api/foryou");
        draw();
        if (data.pending && tries++ < 40) setTimeout(() => { if (host.isConnected) load(); }, 3500);
      } catch (e) { host.className = ""; host.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    app.replaceChildren(pageHead("For you", "Live discounts ranked by how well each game fits your taste and wishlist. Games you already own are left out."), host);
    load();
  }
  root.ForYouUI = { view };
})(window);

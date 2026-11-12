// The war room page.
// app.js hands over its helpers (ctx) and calls WarRoomUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, busy, currentView, field, h, money, pageHead, select } = ctx;
    const out = h("div", { class: "muted", text: "Checking your wishlist…" });
    const st = { rows: [], cur: "USD", picked: new Set(), budget: 0, sale: null, store: "all", sort: "discount" };
    const isSteam = r => /^steam$/i.test(r.shop);
    const SORTS = { discount: (a, b) => b.discount - a.discount || a.title.localeCompare(b.title), saving: (a, b) => ((b.regular ?? b.price) - b.price) - ((a.regular ?? a.price) - a.price), cheap: (a, b) => a.price - b.price, pricey: (a, b) => b.price - a.price, name: (a, b) => a.title.localeCompare(b.title) };
    // What the filters leave showing. The cart keeps anything ticked even when a filter hides it.
    const shown = () => st.rows.filter(r => st.store === "all" || (st.store === "steam" ? isSteam(r) : !isSteam(r))).sort(SORTS[st.sort]);
    const slider = h("input", { type: "range", class: "war-slider", min: "0", max: "500", step: "5", value: "0", "aria-label": "Budget" });
    const label = h("strong", { text: "" });
    const total = h("div", { class: "muted" });
    const list = h("div", { class: "panel war-list" });
    const sum = () => st.rows.filter(r => st.picked.has(r.itad_id)).reduce((t, r) => t + r.price, 0);
    function autofill() {
      st.picked = new Set(); let left = st.budget;
      const order = [...shown()].sort((a, b) => ((b.regular ?? b.price) - b.price) / b.price - ((a.regular ?? a.price) - a.price) / a.price);
      for (const r of order) if (r.price <= left + 1e-9) { st.picked.add(r.itad_id); left -= r.price; }
    }
    function draw() {
      label.textContent = "Budget: " + money(st.budget, st.cur);
      const spent = sum(), saved = st.rows.filter(r => st.picked.has(r.itad_id)).reduce((t, r) => t + Math.max(0, (r.regular ?? r.price) - r.price), 0);
      total.textContent = st.picked.size + " in the cart · " + money(spent, st.cur) + (spent > st.budget && st.budget > 0 ? " (over budget by " + money(spent - st.budget, st.cur) + ")" : "") + " · saves " + money(saved, st.cur);
      const rows = shown();
      if (!st.rows.length) return list.replaceChildren(h("div", { class: "empty", text: "Nothing on your wishlist is at or near a low right now. Games show up here as they drop." }));
      if (!rows.length) return list.replaceChildren(h("div", { class: "empty", text: "Nothing matches that filter. Try All stores." }));
      list.replaceChildren(...rows.map(r => {
        const box = h("input", { type: "checkbox", checked: st.picked.has(r.itad_id) });
        box.addEventListener("change", () => { if (box.checked) st.picked.add(r.itad_id); else st.picked.delete(r.itad_id); draw(); });
        return h("label", { class: "war-row" }, box, h("b", { text: " " + r.title }), h("span", { class: "muted", text: "  " + money(r.price, st.cur) + (r.discount > 0 ? " (-" + Math.round(r.discount * 100) + "%)" : "") + " at " + r.shop + (r.verdict ? " · " + r.verdict : "") }));
      }));
    }
    slider.addEventListener("input", () => { st.budget = Number(slider.value); autofill(); draw(); });
    const storeSel = select([["all", "All stores"], ["steam", "Steam only"], ["other", "Other stores only"]], st.store);
    const sortSel = select([["discount", "Biggest discount"], ["saving", "Most money saved"], ["cheap", "Cheapest first"], ["pricey", "Priciest first"], ["name", "Name A to Z"]], st.sort);
    storeSel.addEventListener("change", () => { st.store = storeSel.value; draw(); });
    sortSel.addEventListener("change", () => { st.sort = sortSel.value; draw(); });
    const quick = (text, title, fn) => { const b = h("button", { class: "btn small blue", type: "button", text, title }); b.addEventListener("click", () => { fn(); draw(); }); return b; };
    // "Steam sale picks": the Steam sale only lowers Steam prices, so tick every game whose best price is on Steam right now (best savings first, inside the budget when one is set).
    const salePicks = () => {
      st.picked = new Set(); let left = st.budget > 0 ? st.budget : Infinity;
      for (const r of st.rows.filter(isSteam).sort(SORTS.saving)) if (r.price <= left + 1e-9) { st.picked.add(r.itad_id); left -= r.price; }
    };
    const tools = h("div", { class: "row war-tools" },
      field("Show", storeSel), field("Sort by", sortSel),
      h("div", { class: "war-quick" },
        quick("Steam sale picks", "Tick the games that are cheapest on Steam right now", salePicks),
        quick("Select shown", "Tick everything the filter is showing", () => { for (const r of shown()) st.picked.add(r.itad_id); }),
        quick("Clear", "Untick everything", () => { st.picked = new Set(); })));
    async function load() {
      try {
        const d = await api("/api/saleprep");
        st.rows = d.buyNow; st.cur = d.currency; st.sale = d.sale;
        const top = Math.max(50, Math.ceil(st.rows.reduce((t, r) => t + r.price, 0) / 5) * 5);
        slider.max = String(top);
        out.className = "";
        out.replaceChildren(h("p", { class: "muted", text: (d.sale ? (d.sale.live ? d.sale.name + " is on now. This page refreshes every 5 minutes." : "Next: " + d.sale.name + " starts " + new Date(d.sale.start).toLocaleDateString() + ".") : "No Steam sale is on the calendar yet.") + " " + st.rows.length + " of " + d.watching + " wishlist games are at or near a low." }),
          h("div", { class: "panel" }, label, slider, total), tools, list);
        st.picked = new Set([...st.picked].filter(id => st.rows.some(r => r.itad_id === id)));
        draw();
        if (d.sale && d.sale.live && currentView() === "warroom") setTimeout(() => { if (currentView() === "warroom") load(); }, 300_000);
      } catch (e) { out.className = ""; out.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    const recapOut = h("div");
    const recapBtn = h("button", { class: "btn gray", text: "Show sale recap", onclick: () => busy(recapBtn, async () => {
      const r = await api("/api/saleprep/recap");
      recapOut.replaceChildren(r.alerts ? h("div", { class: "panel" }, h("h3", { text: "Last " + r.days + " days" }), h("p", { text: "Your alerts caught " + r.games + " games, " + r.spend.toFixed(2) + " at the alert prices" + (r.saved > 0 ? ", " + r.saved.toFixed(2) + " under regular." : ".") }),
        h("ul", { class: "plain" }, r.top.map(a => h("li", {}, h("b", { text: a.title }), " ", h("span", { class: "muted", text: a.price.toFixed(2) + (a.regular ? " (was " + a.regular.toFixed(2) + ")" : "") + (a.shop ? " at " + a.shop : "") }))))) : h("div", { class: "empty", text: "No sale alerts in the last " + r.days + " days." }));
    }) });
    app.replaceChildren(pageHead("Sale planner", "Plan your cart for a Steam sale: set a budget and the best savings fill it first. Untick anything you do not want. After a sale, see what your alerts caught."), out, h("h2", { text: "After the sale" }), recapBtn, recapOut);
    load();
  }
  root.WarRoomUI = { view };
})(window);

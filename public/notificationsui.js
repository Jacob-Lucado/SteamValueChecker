// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls NotificationsUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { PRIZE_STATUS, api, app, ext, h, noteCard, pageHead, renderChrome, state } = ctx;
    const holder = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(pageHead("Notifications", "A copy of every alert the bot sends you, so a missed DM is never lost. Muted kinds are kept here but not sent to Discord (change that in Alert settings)."), holder);
    try {
      const d = await api("/api/notifications");
      const prizes = (await api("/api/claims").catch(() => ({ prizes: [] }))).prizes;
      holder.className = "";
      holder.replaceChildren(...[
        prizes.length ? h("div", { class: "panel" }, h("h3", { text: "Your prizes" }),
          h("p", { class: "muted small", text: "Press Claim prize on the winners message in Discord. Keys are never shown here." }),
          ...prizes.map(p => h("div", { class: "kv" }, h("span", {}, h("b", { text: p.label + " " }), h("span", { class: "muted", text: `${p.title} · ${PRIZE_STATUS[p.status] || p.status}${p.status === "assigned" && p.deadline ? " · claim by " + new Date(p.deadline).toLocaleString() : ""}` })),
            p.link ? ext(p.link, "Open in Discord") : null))) : null,
        h("p", { class: "muted small" }, "Choose what is sent to Discord in ", h("a", { href: "#/alerts", text: "Alert settings" }), "."),
        (() => {
          // Filter what is kept here by kind of alert and by words in the title.
          const KIND = { alert: "Sales", sale: "Sales", bundle: "Bundles", free: "Free games", news: "News", digest: "Digest", release: "Releases", codes: "Codes", promo: "Promos", friend: "Friends" };
          const kinds = [...new Set(d.items.map(n => n.type).filter(Boolean))];
          let kind = "", q = "";
          const list = h("div", { class: "cards" });
          const paint = () => {
            const rows = d.items.filter(n => (!kind || n.type === kind) && (!q || (String(n.title) + " " + String(n.body || "")).toLowerCase().includes(q)));
            list.replaceChildren(...(rows.length ? rows.map(noteCard) : [h("p", { class: "muted", text: d.items.length ? "Nothing matches." : "Nothing yet. Alerts will show up here." })]));
            chips.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String((b.dataset.kind || "") === kind)));
          };
          const chip = (k, text) => { const b = h("button", { type: "button", class: "chip", "data-kind": k, text }); b.addEventListener("click", () => { kind = k; paint(); }); return b; };
          const chips = h("div", { class: "row chips" }, chip("", "All"), ...kinds.map(k => chip(k, KIND[k] || k[0].toUpperCase() + k.slice(1))));
          const search = h("input", { type: "search", placeholder: "Search your alerts", "aria-label": "Search your alerts" });
          search.addEventListener("input", () => { q = search.value.trim().toLowerCase(); paint(); });
          paint();
          return h("div", { class: "panel" }, h("h3", { text: "Recent" }), d.items.length > 3 ? h("div", { class: "lookup-row" }, search) : null, d.items.length > 3 && kinds.length > 1 ? chips : null, list);
        })()].filter(Boolean));
      if (d.unread) { await api("/api/notifications/read", {}); state.me.unread = 0; renderChrome(); }
    } catch (e) { holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
  }
  root.NotificationsUI = { view };
})(window);

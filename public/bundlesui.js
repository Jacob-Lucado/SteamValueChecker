// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls BundlesUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, busy, h, pageHead, state, toast } = ctx;
    const st = { store: "", status: "active" };
    const list = h("div", { class: "muted", text: "Loading…" });
    const head = h("div", { class: "chips" });
    const owner = Boolean(state.me && state.me.isOwner);
    const when = ms => { const d = ms - Date.now(); if (d < 0) return "ended"; const days = Math.floor(d / 86400_000); return days >= 1 ? `ends in ${days} day${days === 1 ? "" : "s"}` : `ends in ${Math.max(1, Math.round(d / 3600_000))} h`; };
    async function load() {
      const d = await api("/api/bundlefeed?status=" + st.status + (st.store ? "&store=" + encodeURIComponent(st.store) : ""));
      head.replaceChildren(
        h("button", { class: "tab small" + (!st.store ? " active" : ""), text: "All stores", onclick: () => { st.store = ""; load().catch(fail); } }),
        ...d.stores.map(x => h("button", { class: "tab small" + (st.store === x.key ? " active" : ""), text: x.name, onclick: () => { st.store = x.key; load().catch(fail); } })),
        h("button", { class: "tab small" + (st.status === "expired" ? " active" : ""), text: st.status === "expired" ? "Showing ended" : "Show ended", onclick: () => { st.status = st.status === "expired" ? "active" : "expired"; load().catch(fail); } }));
      list.className = "";
      list.replaceChildren(d.bundles.length ? h("div", { class: "free-grid" }, d.bundles.map(b => h("div", { class: "free-card" + (b.status === "expired" ? " ended" : "") },
        b.image ? (() => { const img = h("img", { src: "/art/bundle/" + b.id + ".jpg", alt: "", loading: "lazy" }); let direct = false; img.addEventListener("error", () => { if (!direct) { direct = true; img.src = b.image; } else img.replaceWith(h("div", { class: "free-noart", text: b.storeName })); }); return img; })() : h("div", { class: "free-noart", text: b.storeName }),
        h("div", { class: "free-info" }, h("strong", { text: b.title }), h("div", { class: "muted small", text: b.storeName + (b.gameCount ? ` · ${b.gameCount} games` : "") }),
          b.price ? h("div", { text: b.price }) : null,
          b.games.length ? h("details", {}, h("summary", { class: "muted small", text: "See the games" }), h("ul", { class: "muted small" }, ...b.games.slice(0, 12).map(g => h("li", { text: g })), b.games.length > 12 ? h("li", { text: `and ${b.games.length - 12} more` }) : null)) : null,
          h("span", { class: "muted small", text: b.expiresAt ? when(b.expiresAt) : "no end date listed" }),
          h("div", { class: "row" }, b.status === "active" ? h("a", { class: "btn blue small", href: b.url, target: "_blank", rel: "noopener noreferrer", text: "Open on " + b.storeName }) : h("span", { class: "chip dim", text: "Ended" })))))
      ) : h("p", { class: "muted", text: st.status === "expired" ? "No ended bundles in the last week." : "No bundles listed right now. New ones show up here as soon as a store lists them." }));
    }
    const fail = e => list.replaceChildren(h("div", { class: "notice warn", text: e.message }));
    const poll = owner ? h("button", { class: "btn gray small", text: "Check for new bundles now" }) : null;
    if (poll) poll.addEventListener("click", () => busy(poll, async () => { const r = await api("/api/admin/bundles/poll", {}); toast(r.result.skipped ? "A check is already running." : `Checked: ${r.result.added} new, ${r.result.posted} posted.${r.result.feedError ? " Problems: " + r.result.feedError : ""}`, r.result.feedError ? "warn" : "ok"); await load(); }));
    app.replaceChildren(pageHead("Bundles", "Game bundles that are running now on Humble Bundle, Fanatical, IndieGala and the Steam store. Each one is listed once, with the games inside and when it ends where the store says. Server managers can have new ones posted in a channel from the Codes & promos tab of their server."),
      h("div", { class: "row" }, head, poll), list);
    load().catch(fail);
  }
  root.BundlesUI = { view };
})(window);

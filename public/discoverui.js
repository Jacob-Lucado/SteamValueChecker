// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls DiscoverUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { FEED_STATE, api, app, h, httpsOnly, navigate, pageHead, personRow, pfArt, state } = ctx;
    const box = h("div", { class: "muted", text: "Loading…" });
    const pickWrap = h("div", { class: "fd-bar" });
    let which = "all-servers";
    app.replaceChildren(pageHead("Discover", "What people are into this week, the rarest achievements around, and members whose libraries look like yours."), pickWrap, box);
    const run = async () => {
    try {
      const d = await api("/api/social/discover" + (which === "all-servers" ? "" : "?server=" + encodeURIComponent(which)));
      if (!pickWrap.children.length) {
        const sel = h("select", { class: "fd-pick", "aria-label": "Where" }, h("option", { value: "all-servers", text: "Everywhere" }), h("option", { value: "all", text: "All connected servers" }), ...d.servers.map(g => h("option", { value: g.id, text: g.name })));
        sel.addEventListener("change", () => { which = sel.value; run(); });
        pickWrap.append(sel);
      }
      const trend = d.trending.length ? h("div", { class: "fd-trend" }, d.trending.map(g => {
        const a = h("button", { class: "fd-trend-card", type: "button" }, h("div", { class: "fd-art" }, pfArt(g.art, g.game)), h("strong", { text: g.game }), h("span", { class: "muted small", text: `${g.people} ${g.people === 1 ? "person" : "people"}${g.posts ? ` · ${g.posts} post${g.posts === 1 ? "" : "s"}` : ""}${g.finishes ? ` · ${g.finishes} finished` : ""}` }));
        a.addEventListener("click", () => { FEED_STATE.game = { appid: g.appid, game: g.game }; FEED_STATE.scope = "everyone"; navigate("/feed"); });
        return a;
      })) : h("p", { class: "muted", text: "Nothing is trending yet. Finish a game or post about one and it will show up here." });
      const rare = d.rare.length ? h("div", { class: "fd-rare" }, d.rare.map(r => h("div", { class: "fd-rare-row" }, httpsOnly(r.icon) ? h("img", { class: "fd-ach", src: r.icon, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : h("div", { class: "fd-ach none", text: "★" }),
        h("div", {}, h("strong", { text: r.achievement }), h("div", { class: "muted small" }, `${r.game} · ${r.pct}% of players · `, r.slug ? h("a", { href: "#/u/" + r.slug, text: r.name }) : r.name))))) : h("p", { class: "muted", text: "Nobody has shared achievements yet. Turn on the Rarest achievements section on your page." });
      const people = state.me ? (d.similar.length ? h("div", { class: "fd-people" }, d.similar.map(p => personRow(p, `${p.shared} games in common`))) : h("p", { class: "muted", text: "Sync your Steam library and you'll see members who own a lot of the same games." })) : h("p", { class: "muted", text: "Sign in to see people with libraries like yours." });
      box.className = ""; box.replaceChildren(h("div", { class: "panel" }, h("h3", { text: "Trending this week" }), trend), h("div", { class: "panel" }, h("h3", { text: "Rarest achievements" }), rare), h("div", { class: "panel" }, h("h3", { text: "People you might like" }), people));
    } catch (e) { box.className = ""; box.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    };
    run();
  }
  root.DiscoverUI = { view };
})(window);

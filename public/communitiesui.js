// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls CommunitiesUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { FEED_STATE, api, app, ext, h, leaderboardPanel, manageRow, navigate, pageHead } = ctx;
    const box = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(pageHead("Communities", "Every server the bot is in. Open one to see what its members are up to, or join it."), box);
    try {
      const d = await api("/api/social/servers");
      const q = h("input", { type: "search", class: "fd-search", placeholder: "Find a server", "aria-label": "Find a server" });
      const grid = h("div", { class: "fd-servers" });
      const draw = () => {
        const term = q.value.trim().toLowerCase();
        const shown = d.servers.filter(g => !term || g.name.toLowerCase().includes(term) || (g.about || "").toLowerCase().includes(term));
        grid.replaceChildren(...(shown.length ? shown.map(g => {
          const open = h("button", { class: "btn gray small", type: "button", text: "Open feed" });
          open.addEventListener("click", () => { FEED_STATE.scope = "servers"; FEED_STATE.server = g.id; FEED_STATE.game = null; navigate("/feed"); });
          return h("div", { class: "fd-server-card" }, h("div", { class: "fd-server-top" }, h("div", { class: "fd-av init", text: g.name.slice(0, 1).toUpperCase() }), h("div", { class: "fd-who" }, h("strong", { class: "fd-name", text: g.name }),
            h("span", { class: "muted small", text: [g.members ? `${g.members.toLocaleString()} members` : null, `${g.people} with public pages`, g.active ? `${g.active} active this week` : null].filter(Boolean).join(" · ") }))),
            g.about ? h("p", { class: "fd-about", text: g.about }) : null, h("div", { class: "fd-actions" }, open, g.invite ? ext(g.invite, "Join", "btn blue small") : null));
        }) : [h("div", { class: "empty", text: "No servers match that." })]));
      };
      q.addEventListener("input", draw);
      box.className = ""; box.replaceChildren(h("div", { class: "fd-bar" }, q, h("a", { class: "btn gray small", href: "/feed", text: "All servers' feed" })), grid);
      draw();
      box.append(leaderboardPanel(d.servers));
      if (d.manage.length) box.append(h("div", { class: "panel" }, h("h3", { text: "Your servers" }),
        h("p", { class: "muted small", text: "Servers you manage show up here by default. Add a short description and a Discord invite so people can join, or take the server out of the directory." }), ...d.manage.map(manageRow)));
    } catch (e) { box.className = ""; box.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
  }
  root.CommunitiesUI = { view };
})(window);

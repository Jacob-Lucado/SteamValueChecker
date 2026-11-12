// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls ServersUI.view(ctx).
(function (root) {
  "use strict";
  function view(ctx) {
    const { app, botBadge, ext, guildInvite, h, navigate, pageHead, serverIcon, state } = ctx;
    const all = state.me.servers;
    const mine = all.filter(g => g.manageable);
    const withBot = all.filter(g => g.bot);
    let filter = "all", q = "";
    const grid = h("div", { class: "sv-grid" });

    function card(g) {
      const open = () => { navigate("/servers/" + g.id); };
      const stat = (icon, label, value) => h("div", { class: "sv-stat" }, h("span", { class: "sv-ico", text: icon }), h("span", { class: "muted", text: label }), h("b", { text: value }));
      const actions = g.bot === false
        ? [guildInvite(g) && g.manageable ? ext(guildInvite(g), "Add the bot", "btn green") : null, h("button", { class: "btn gray", text: "Details", onclick: open })]
        : [h("button", { class: "btn blue", text: g.manageable ? "Manage" : "Open", onclick: open })];
      return h("div", { class: "sv-card" + (g.bot === false ? " off" : "") },
        h("div", { class: "sv-top" }, serverIcon(g, "sv-icon"),
          h("div", { class: "sv-name" }, h("strong", { text: g.name }), h("div", { class: "sv-badges" }, g.manageable ? h("span", { class: "chip", text: "You manage this" }) : h("span", { class: "chip dim", text: "Member" }), botBadge(g)))),
        h("div", { class: "sv-stats" },
          stat("", "Alert channel", g.alertChannel ? "Set" : "Not set"),
          stat("", "Group alerts", g.groupMin ? `From ${g.groupMin} members` : "Off")),
        h("div", { class: "sv-actions" }, ...actions.filter(Boolean)));
    }

    function draw() {
      const rows = all.filter(g => (filter === "all" || (filter === "mine" && g.manageable) || (filter === "bot" && g.bot) || (filter === "nobot" && g.bot === false)) && g.name.toLowerCase().includes(q));
      grid.replaceChildren(...(rows.length ? rows.map(card) : [h("div", { class: "empty", text: all.length ? "No servers match." : "You are not in any servers." })]));
    }
    const tabBtn = (id, label, count) => {
      const b = h("button", { class: "tab" + (filter === id ? " active" : ""), text: count === null ? label : `${label} (${count})`, onclick: () => { filter = id; tabs.querySelectorAll(".tab").forEach(t => t.classList.remove("active")); b.classList.add("active"); draw(); } });
      return b;
    };
    const known = all.some(g => g.bot !== null && g.bot !== undefined);
    const tabs = h("div", { class: "tabs" }, tabBtn("all", "All", all.length), tabBtn("mine", "I manage", mine.length),
      ...(known ? [tabBtn("bot", "Bot installed", withBot.length), tabBtn("nobot", "Needs the bot", all.length - withBot.length)] : []));
    const search = h("input", { type: "search", class: "sv-search", placeholder: "Search your servers", "aria-label": "Search your servers" });
    search.addEventListener("input", () => { q = search.value.trim().toLowerCase(); draw(); });
    draw();
    app.replaceChildren(
      pageHead("Servers", "Set up alerts, the shared wishlist and giveaways for the servers you are in.", state.cfg.inviteUrl && ext(state.cfg.inviteUrl, "Add the bot to a server", "btn blue")),
      h("div", { class: "sv-toolbar" }, tabs, search),
      grid);
  }
  root.ServersUI = { view };
})(window);

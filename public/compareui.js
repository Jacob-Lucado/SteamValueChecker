// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls CompareUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, busy, field, h, pageHead, serverPicker, state } = ctx;
    const servers = state.me.servers.filter(g => g.bot !== false);
    const out = h("div");
    const guild = serverPicker(servers);
    const people = h("div", { class: "chips" });
    app.replaceChildren(pageHead("Compare", "Pick a friend to see what you both own and what only one of you has. Only members who opted in with /alerts share can be compared."),
      h("div", { class: "panel" }, servers.length > 1 ? field("Server", guild) : null, people), out);
    async function loadMembers() {
      out.replaceChildren(); people.replaceChildren(h("span", { class: "muted", text: "Loading…" }));
      if (!servers.length) { people.replaceChildren(h("p", { class: "muted", text: "Invite the bot to a server first. Comparing works between members of the same server." })); return; }
      try {
        const d = await api("/api/gamenight/members?guild=" + encodeURIComponent(guild.value));
        const others = d.members.filter(m => !state.me.user || m.id !== state.me.user.id);
        if (!others.length) { people.replaceChildren(h("p", { class: "muted", text: "Nobody else here has opted in yet. Members turn it on with /alerts share (or on the Alerts page)." })); return; }
        people.replaceChildren(...others.map(m => { const b = h("button", { type: "button", class: "tab small", text: m.name }); b.addEventListener("click", () => busy(b, async () => show(await api("/api/compare?guild=" + encodeURIComponent(guild.value) + "&user=" + encodeURIComponent(m.id))))); return b; }));
      } catch (e) { people.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    const hrs = m => (m >= 60 ? Math.round(m / 60).toLocaleString() + "h" : "");
    function show(r) {
      const list = (title, rows, f) => h("div", { class: "subpanel" }, h("h4", { text: title }), rows.length ? h("ul", {}, ...rows.map(x => h("li", { text: f(x) }))) : h("p", { class: "muted", text: "Nothing." }));
      out.replaceChildren(
        h("div", { class: "panel" }, h("h3", { text: "You and " + r.name }),
          h("div", { class: "grid four" },
            h("div", { class: "tile" }, h("div", { class: "k", text: "In common" }), h("div", { class: "v", text: String(r.shared.length) }), h("div", { class: "s", text: r.overlapPct + "% overlap" })),
            h("div", { class: "tile" }, h("div", { class: "k", text: "Your games" }), h("div", { class: "v", text: String(r.a.games) }), h("div", { class: "s", text: hrs(r.a.minutes) ? hrs(r.a.minutes) + " on record" : "" })),
            h("div", { class: "tile" }, h("div", { class: "k", text: r.name + "'s games" }), h("div", { class: "v", text: String(r.b.games) }), h("div", { class: "s", text: hrs(r.b.minutes) ? hrs(r.b.minutes) + " on record" : "" })),
            h("div", { class: "tile" }, h("div", { class: "k", text: "You have, they don't" }), h("div", { class: "v", text: String(r.onlyA.length) }))),
          list(`You both own (${r.shared.length})`, r.shared, x => x.title + (x.aMinutes || x.bMinutes ? `  (you ${hrs(x.aMinutes) || "0h"}, them ${hrs(x.bMinutes) || "0h"})` : "")),
          list(`Only you (${r.onlyA.length})`, r.onlyA, x => x.title),
          list(`Only ${r.name} (${r.onlyB.length})`, r.onlyB, x => x.title)));
    }
    guild.addEventListener("change", loadMembers);
    loadMembers();
  }
  root.CompareUI = { view };
})(window);

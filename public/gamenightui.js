// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls GameNightUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, busy, field, h, pageHead, serverPicker, state, toast } = ctx;
    const servers = state.me.servers.filter(g => g.bot !== false);
    const out = h("div");
    const guild = serverPicker(servers);
    const people = h("div", { class: "chips" });
    app.replaceChildren(pageHead("Game night", "Pick who is playing. See what everyone owns, who is missing a game, and what is worth buying together. Only members who opted in with /alerts share are listed."),
      h("div", { class: "panel" }, servers.length > 1 ? field("Server", guild) : null, people, out));
    // One game: who in the server owns it, to get a co-op group going.
    const coopIn = h("input", { type: "text", maxlength: "100", placeholder: "A game's name", "aria-label": "Game name" }), coopOut = h("div");
    const coopGo = h("button", { class: "btn blue small", type: "button", text: "Find owners" });
    const coopRun = () => busy(coopGo, async () => {
      coopOut.replaceChildren();
      const d = await api(`/api/coop?guild=${encodeURIComponent(guild.value)}&game=${encodeURIComponent(coopIn.value)}`);
      coopOut.replaceChildren(d.owners.length ? h("div", {}, h("p", { text: `${d.owners.length} ${d.owners.length === 1 ? "member owns" : "members own"} ${d.game}:` }), h("ul", {}, d.owners.map(o => h("li", { text: `${o.name} · ${o.hours ? o.hours + "h played" : "hasn't started"}` }))))
        : h("p", { class: "muted", text: "Nobody here who shares their library owns it yet." }));
    }).catch(e => toast(e.message, "error"));
    coopGo.addEventListener("click", coopRun);
    coopIn.addEventListener("keydown", e => { if (e.key === "Enter") coopRun(); });
    app.append(h("div", { class: "panel" }, h("h3", { text: "Who owns a game?" }), h("div", { class: "row" }, coopIn, coopGo), coopOut));
    const picked = new Set();
    async function loadMembers() {
      picked.clear(); out.replaceChildren(); people.replaceChildren(h("span", { class: "muted", text: "Loading…" }));
      try {
        const d = await api("/api/gamenight/members?guild=" + encodeURIComponent(guild.value));
        if (!d.members.length) { people.replaceChildren(h("p", { class: "muted", text: "Nobody here has opted in yet. Members turn it on with /alerts share (or on the Alerts page)." })); return; }
        people.replaceChildren(...d.members.map(m => { const b = h("button", { type: "button", class: "tab small", text: m.name }); b.addEventListener("click", () => { picked.has(m.id) ? picked.delete(m.id) : picked.add(m.id); b.classList.toggle("active", picked.has(m.id)); }); return b; }),
          (() => { const go = h("button", { class: "btn green small", text: "Work it out" }); go.addEventListener("click", () => busy(go, async () => show(await api("/api/gamenight", { guild_id: guild.value, user_ids: [...picked] })))); return go; })());
      } catch (e) { people.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    function show(r) {
      const list = (title, rows) => h("div", { class: "subpanel" }, h("h4", { text: title }), rows.length ? h("ul", {}, ...rows.map(x => h("li", { text: x }))) : h("p", { class: "muted", text: "None." }));
      out.replaceChildren(
        list(`Everyone owns (${r.allOwn.length})`, r.allOwn),
        list("Almost everyone owns", r.almost.map(a => `${a.title} (missing: ${a.missing.join(", ")})`)),
        list("Worth buying together", r.buy.map(b => `${b.title}, wanted by ${b.wanters.join(", ")}${b.price !== null ? ` at ${b.price.toFixed(2)} ${b.currency}${b.shop ? " at " + b.shop : ""}` : ""}`)),
        r.allOwn.length ? (() => { const b = h("button", { class: "btn gray small", text: "Pick a game for us" }); b.addEventListener("click", () => toast("Tonight: " + r.allOwn[Math.floor(Math.random() * r.allOwn.length)], "ok")); return b; })() : null);
    }
    guild.addEventListener("change", loadMembers);
    loadMembers();
  }
  root.GameNightUI = { view };
})(window);

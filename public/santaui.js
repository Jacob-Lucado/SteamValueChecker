// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls SantaUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, busy, field, h, pageHead, select, serverPicker, state, toast } = ctx;
    const servers = state.me.servers.filter(g => g.bot !== false);
    const guild = serverPicker(servers), out = h("div");
    app.replaceChildren(pageHead("Secret Santa", "Draw names in your server and get a private message with who you're buying for and what's on their wishlist inside the budget. Joining shares your wishlist with only whoever draws you. In Discord: /server santa."),
      h("div", { class: "panel" }, servers.length > 1 ? field("Server", guild) : null), out);
    async function load() {
      if (!servers.length) { out.replaceChildren(h("p", { class: "muted", text: "Invite the bot to a server first." })); return; }
      let d;
      try { d = await api("/api/santa?guild=" + encodeURIComponent(guild.value)); } catch (e) { out.replaceChildren(h("div", { class: "notice warn", text: e.message })); return; }
      const post = body => api("/api/santa", { guild_id: guild.value, ...body });
      const run = (btn, fn, msg) => busy(btn, async () => { const r = await fn(); toast(typeof msg === "function" ? msg(r) : msg, "ok"); load(); });
      const parts = [];
      const ev = d.event;
      if (ev && ev.status !== "ended") {
        const money = n => { try { return new Intl.NumberFormat(undefined, { style: "currency", currency: ev.currency }).format(n); } catch { return n + " " + ev.currency; } };
        const mine = h("div");
        const actions = [];
        if (ev.status === "open") {
          const b = h("button", { class: d.joined ? "btn gray" : "btn green", type: "button", text: d.joined ? "Leave" : "Join" });
          b.addEventListener("click", () => run(b, () => post({ action: d.joined ? "leave" : "join" }), d.joined ? "You left." : "You're in."));
          actions.push(b);
        } else if (d.drawn) {
          const b = h("button", { class: "btn blue", type: "button", text: "Who do I have?" });
          b.addEventListener("click", () => busy(b, async () => { const r = await post({ action: "ideas" }); mine.replaceChildren(h("div", { class: "panel" }, h("h3", { text: r.title }), h("p", { text: r.text, class: "pre" }))); }));
          actions.push(b);
        }
        parts.push(h("div", { class: "panel" }, h("h3", { text: "🎅 " + ev.title }), h("p", { class: "muted", text: `Budget ${money(ev.budget)} · ${ev.status === "open" ? "open for sign-ups" : "names drawn"} · ${d.people.length} in` }),
          d.people.length ? h("ul", { class: "plain" }, d.people.map(p => h("li", { text: p.name }))) : h("p", { class: "muted", text: "Nobody yet." }),
          h("div", { class: "row" }, ...actions), mine));
        if (d.canManage) {
          const draw = h("button", { class: "btn blue", type: "button", text: "Draw names", disabled: ev.status !== "open" }), reveal = h("button", { class: "btn red small", type: "button", text: "Reveal and finish" });
          draw.addEventListener("click", () => run(draw, () => post({ action: "draw" }), r => `Drawn. ${r.count} people messaged${r.failed ? `, ${r.failed} with closed DMs (they can use /server santa ideas)` : ""}.`));
          reveal.addEventListener("click", () => { if (confirm("Show who had who and finish this Secret Santa?")) run(reveal, () => post({ action: "reveal" }), "Finished."); });
          parts.push(h("div", { class: "panel" }, h("h3", { text: "Manage (Manage Server)" }), h("p", { class: "muted small", text: "Drawing needs at least three people. Everyone gets a private message with their giftee and ideas." }), h("div", { class: "row" }, draw, reveal)));
        }
      } else if (d.canManage) {
        const title = h("input", { type: "text", maxlength: "80", placeholder: "Secret Santa" });
        const budget = h("input", { type: "number", min: "1", max: "1000", step: "1", value: "20", class: "short-num", "aria-label": "Budget" });
        const chSel = select([["", "Don't post an announcement"], ...d.channels.map(c => [c.id, "#" + c.name])], "");
        const go = h("button", { class: "btn green", type: "button", text: "Start it" });
        go.addEventListener("click", () => run(go, () => post({ action: "create", title: title.value, budget: Number(budget.value), channel_id: chSel.value }), "Secret Santa started."));
        parts.push(h("div", { class: "panel" }, h("h3", { text: "Start a Secret Santa" }), field("Name", title), field("Budget per gift, in your store's currency", budget), field("Announce in", chSel), h("div", { class: "row" }, go)));
      } else parts.push(h("div", { class: "empty", text: "No Secret Santa here yet. A server manager can start one." }));
      out.replaceChildren(...parts);
    }
    guild.addEventListener("change", load); await load();
  }
  root.SantaUI = { view };
})(window);

// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls ClubUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, busy, ext, field, h, pageHead, select, serverPicker, state, toast } = ctx;
    const servers = state.me.servers.filter(g => g.bot !== false);
    const guild = serverPicker(servers), out = h("div");
    app.replaceChildren(pageHead("Game club", "One game a month for the whole server. Members who share their library (/alerts share) show up with their hours and achievements. In Discord: /server club."),
      h("div", { class: "panel" }, servers.length > 1 ? field("Server", guild) : null), out);
    async function load() {
      if (!servers.length) { out.replaceChildren(h("p", { class: "muted", text: "Invite the bot to a server first." })); return; }
      let d;
      try { d = await api("/api/club?guild=" + encodeURIComponent(guild.value)); } catch (e) { out.replaceChildren(h("div", { class: "notice warn", text: e.message })); return; }
      const post = body => api("/api/club", { guild_id: guild.value, ...body });
      const parts = [];
      if (d.club) {
        const row = r => h("li", {}, h("b", { text: r.name }), ` ${r.hours}h`, r.ach_total ? `, ${r.ach_done}/${r.ach_total} achievements` : "", r.finished ? " ✅" : r.started ? " ▶️" : " ⏳ not started");
        parts.push(h("div", { class: "panel" }, h("h3", { text: d.club.title }), h("p", { class: "muted", text: d.club.month + " pick. " + d.owners.length + " of " + d.sharing + " sharing members own it." }),
          d.club.appid ? ext("https://store.steampowered.com/app/" + d.club.appid + "/", "Steam page", "btn gray small") : null,
          d.owners.length ? h("ul", { class: "plain" }, d.owners.map(row)) : h("p", { class: "muted", text: "Nobody who shares their library owns it yet." })));
      } else parts.push(h("div", { class: "empty", text: "No pick yet." + (d.canManage ? " Set one below." : " A server manager can set one.") }));
      if (d.canManage) {
        const title = h("input", { type: "text", maxlength: "100", placeholder: "Game title", value: d.club ? d.club.title : "" });
        const chSel = select([["", "Not set"], ...d.channels.map(c => [c.id, "#" + c.name])], d.channel || "");
        const run = (btn, fn, msg) => busy(btn, async () => { await fn(); toast(msg, "ok"); load(); });
        const pick = h("button", { class: "btn blue", type: "button", text: "Set this month's pick" }), sv = h("button", { class: "btn gray small", type: "button", text: "Save channel" }), off = h("button", { class: "btn red small", type: "button", text: "Turn the club off" });
        pick.addEventListener("click", () => run(pick, () => post({ action: "pick", title: title.value }), "Pick saved."));
        sv.addEventListener("click", () => run(sv, () => post({ action: "channel", channel_id: chSel.value }), "Saved."));
        off.addEventListener("click", () => run(off, () => post({ action: "off" }), "Game club is off."));
        parts.push(h("div", { class: "panel" }, h("h3", { text: "Manage (Manage Server)" }), field("Game of the month", title), h("div", { class: "row" }, pick),
          field("Weekly card channel (posted once a week, and when the month ends)", chSel), h("div", { class: "row" }, sv, off)));
      }
      out.replaceChildren(...parts);
    }
    guild.addEventListener("change", load); await load();
  }
  root.ClubUI = { view };
})(window);

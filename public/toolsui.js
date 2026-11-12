// Server tools: role menus, starboard, polls, suggestions and custom commands for one server.
// app.js hands over its helpers (ctx) and calls ToolsUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, busy, field, h, pageHead, select, serverPicker, state, toast } = ctx;
    const servers = state.me.servers.filter(g => g.bot !== false);
    const guild = serverPicker(servers), out = h("div");
    app.replaceChildren(pageHead("Server tools", "Role menus, a starboard, polls, a suggestion box and your own custom commands. In Discord: /manage rolemenu, /manage starboard, /manage poll, /server suggest and /server tag."),
      h("div", { class: "panel" }, servers.length > 1 ? field("Server", guild) : null), out);
    const post = (path, body) => api(path, { guild_id: guild.value, ...body });
    const run = (btn, fn, msg) => busy(btn, async () => { await fn(); if (msg) toast(msg, "ok"); await load(); });
    const btn = (text, cls = "btn blue small") => h("button", { type: "button", class: cls, text });
    const chOpts = d => [["", "Pick a channel"], ...d.channels.map(c => [c.id, "#" + c.name])];
    const chName = (d, id) => { const c = d.channels.find(x => x.id === id); return c ? "#" + c.name : "a channel"; };

    function menusPanel(d) {
      const title = h("input", { type: "text", maxlength: "100", placeholder: "Pick your platforms" });
      const ch = select(chOpts(d), ""), mode = select([["toggle", "Pick as many as you like"], ["single", "Pick one at a time"]], "toggle");
      const make = btn("Post the menu");
      make.addEventListener("click", () => run(make, () => post("/api/tools/rolemenu", { action: "create", title: title.value, channel_id: ch.value, mode: mode.value }), "Menu posted."));
      const cards = d.menus.map(m => {
        const role = select([["", "Add a role…"], ...d.roles.map(r => [r.id, r.name])], ""), label = h("input", { type: "text", maxlength: "80", placeholder: "Button text (optional)" }), emoji = h("input", { type: "text", maxlength: "60", placeholder: "Emoji", class: "narrow" });
        const add = btn("Add"), del = btn("Delete menu", "btn gray small");
        add.addEventListener("click", () => { if (!role.value) return toast("Pick a role first.", "error"); run(add, () => post("/api/tools/rolemenu", { action: "add", menu_id: m.id, role_id: role.value, label: label.value, emoji: emoji.value }), "Added."); });
        del.addEventListener("click", () => run(del, () => post("/api/tools/rolemenu", { action: "delete", menu_id: m.id }), "Menu deleted."));
        return h("div", { class: "subpanel" }, h("h4", { text: `#${m.id} ${m.title}` }),
          h("p", { class: "muted small", text: `${chName(d, m.channel_id)} · ${m.mode === "single" ? "pick one" : "pick any"}` }),
          m.items.length ? h("ul", { class: "plain" }, m.items.map(it => { const x = btn("Remove", "btn gray small"); x.addEventListener("click", () => run(x, () => post("/api/tools/rolemenu", { action: "remove", menu_id: m.id, role_id: it.role_id }), "Removed.")); return h("li", {}, (it.emoji ? it.emoji + " " : "") + it.label + " ", x); })) : h("p", { class: "muted small", text: "No roles yet." }),
          h("div", { class: "row" }, role, label, emoji, add), h("div", { class: "row" }, del));
      });
      return h("div", { class: "panel" }, h("h3", { text: "Role menus" }),
        h("p", { class: "muted small", text: "Members press a button to get or drop a role. Only plain roles can be offered: roles that can moderate or manage the server are hidden on purpose. Keep my role above the ones you offer." }),
        ...cards, h("div", { class: "subpanel" }, h("h4", { text: "New menu" }), field("Title", title), field("Channel", ch), field("How picking works", mode), h("div", { class: "row" }, make)));
    }

    function starPanel(d) {
      const s = d.starboard, on = h("input", { type: "checkbox", checked: s.on }), ch = select(chOpts(d), s.channel || ""), th = h("input", { type: "number", min: "1", max: "25", value: String(s.threshold) }), em = h("input", { type: "text", maxlength: "60", value: s.emoji, class: "narrow" }), self = h("input", { type: "checkbox", checked: s.selfStar });
      const save = btn("Save starboard");
      save.addEventListener("click", () => run(save, () => post("/api/tools/starboard", { on: on.checked, channel_id: ch.value, threshold: Number(th.value), emoji: em.value, selfStar: self.checked }), "Saved."));
      return h("div", { class: "panel" }, h("h3", { text: "⭐ Starboard" }),
        h("p", { class: "muted small", text: "When a message gets enough reactions, it is copied to its own channel with a link back. Messages in age-restricted channels and from bots are skipped." }),
        h("label", { class: "check" }, on, " Starboard is on"), field("Channel for starred messages", ch), field("Reactions needed", th), field("Emoji", em),
        h("label", { class: "check" }, self, " Count the author's own reaction"), h("div", { class: "row" }, save),
        s.top.length ? h("div", {}, h("h4", { text: `Top posts (${s.posts} so far)` }), h("ul", { class: "plain" }, s.top.map(p => h("li", {}, `⭐ ${p.stars} · `, h("a", { href: p.link, target: "_blank", rel: "noopener noreferrer", text: "open message" }))))) : null);
    }

    function pollPanel(d) {
      const q = h("input", { type: "text", maxlength: "240", placeholder: "What are you asking?" }), opts = h("textarea", { rows: "4", placeholder: "One choice per line (2 to 10)" }), ch = select(chOpts(d), ""), hours = h("input", { type: "number", min: "0", max: "720", value: "24", class: "narrow" }), multi = h("input", { type: "checkbox" });
      const make = btn("Start the poll");
      make.addEventListener("click", () => run(make, () => post("/api/tools/poll", { action: "create", question: q.value, options: opts.value.split("\n"), channel_id: ch.value, hours: Number(hours.value), multi: multi.checked }), "Poll started."));
      return h("div", { class: "panel" }, h("h3", { text: "📊 Polls" }),
        d.polls.length ? h("ul", { class: "plain" }, d.polls.map(p => { const end = btn("End now", "btn gray small"); end.addEventListener("click", () => run(end, () => post("/api/tools/poll", { action: "end", id: p.id }), "Poll ended.")); return h("li", {}, h("b", { text: `#${p.id} ${p.question}` }), ` · ${p.votes} votes · ${p.closed ? "ended" : "open"} `, p.closed ? null : end); })) : h("p", { class: "muted small", text: "No polls yet." }),
        h("div", { class: "subpanel" }, h("h4", { text: "New poll" }), field("Question", q), field("Choices", opts), field("Channel", ch), field("Ends after (hours, 0 = when you end it)", hours), h("label", { class: "check" }, multi, " Let people pick more than one"), h("div", { class: "row" }, make)));
    }

    function suggestPanel(d) {
      const s = d.suggest, ch = select(chOpts(d), s.channel || "");
      const save = btn("Save channel"), off = btn("Turn off", "btn gray small");
      save.addEventListener("click", () => run(save, () => post("/api/tools/suggest", { action: "setup", channel_id: ch.value }), "Saved."));
      off.addEventListener("click", () => run(off, () => post("/api/tools/suggest", { action: "off" }), "Suggestion box is off."));
      const rows = s.items.map(it => {
        const st = select(s.statuses.map(x => [x.id, x.label]), it.status), note = h("input", { type: "text", maxlength: "500", placeholder: "Short answer (optional)", value: it.note || "" }), go = btn("Update");
        go.addEventListener("click", () => run(go, () => post("/api/tools/suggest", { action: "decide", id: it.id, status: st.value, note: note.value }), "Updated."));
        return h("div", { class: "subpanel" }, h("p", {}, h("b", { text: `#${it.id} ` }), it.text), h("p", { class: "muted small", text: `👍 ${it.votes.up} · 👎 ${it.votes.down}` }), h("div", { class: "row" }, st, note, go));
      });
      return h("div", { class: "panel" }, h("h3", { text: "🗳️ Suggestion box" }),
        h("p", { class: "muted small", text: "Members use /server suggest, everyone votes with buttons, and you answer here or with /manage suggestions decide." }),
        field("Suggestions channel", ch), h("div", { class: "row" }, save, s.channel ? off : null), ...(rows.length ? rows : [h("p", { class: "muted small", text: "No suggestions yet." })]));
    }

    function tagPanel(d, canManage) {
      const list = d.tags.length ? h("ul", { class: "plain" }, d.tags.map(t => { const row = [h("code", { text: t.name }), t.uses !== undefined ? ` · used ${t.uses}×` : ""]; if (canManage) { const x = btn("Remove", "btn gray small"); x.addEventListener("click", () => run(x, () => post("/api/tools/tag", { action: "remove", name: t.name }), "Removed.")); row.push(" ", x); } return h("li", {}, ...row); })) : h("p", { class: "muted small", text: "No custom commands yet." });
      if (!canManage) return h("div", { class: "panel" }, h("h3", { text: "Custom commands" }), h("p", { class: "muted small", text: "Use them in Discord with /server tag." }), list);
      const name = h("input", { type: "text", maxlength: "32", placeholder: "rules" }), resp = h("textarea", { rows: "3", maxlength: "1800", placeholder: "What it says" }), save = btn("Save command");
      save.addEventListener("click", () => run(save, () => post("/api/tools/tag", { action: "save", name: name.value, response: resp.value }), "Saved."));
      return h("div", { class: "panel" }, h("h3", { text: "Custom commands" }), h("p", { class: "muted small", text: "Short answers members can call up with /server tag, like your rules, a server address or a link." }), list,
        h("div", { class: "subpanel" }, h("h4", { text: "New or changed command" }), field("Name", name), field("Answer", resp), h("div", { class: "row" }, save)));
    }

    async function load() {
      if (!servers.length) { out.replaceChildren(h("p", { class: "muted", text: "Invite the bot to a server first." })); return; }
      let d;
      try { d = await api("/api/tools?guild=" + encodeURIComponent(guild.value)); } catch (e) { out.replaceChildren(h("div", { class: "notice warn", text: e.message })); return; }
      if (!d.canManage) { out.replaceChildren(h("div", { class: "notice", text: "You need the Manage Server permission to change these. Here are this server's custom commands." }), tagPanel(d, false)); return; }
      out.replaceChildren(menusPanel(d), starPanel(d), pollPanel(d), suggestPanel(d), tagPanel(d, true));
    }
    guild.addEventListener("change", load); await load();
  }
  root.ToolsUI = { view };
})(window);

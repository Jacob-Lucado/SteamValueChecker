// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls LfgUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, busy, ext, field, h, pageHead, select, serverPicker, state, toast } = ctx;
    const servers = state.me.servers.filter(g => g.bot !== false);
    const out = h("div", { class: "muted", text: "Loading…" });
    const form = h("div");
    const guild = serverPicker(servers);
    app.replaceChildren(pageHead("Looking for group", "Find people to play with. Members join with a button, and the group gets a reminder when it starts."),
      h("div", { class: "panel" }, servers.length > 1 ? field("Server", guild) : null, form, out));
    async function load() {
      out.className = "muted"; out.replaceChildren("Loading…");
      try {
        const g = servers.find(x => x.id === guild.value);
        const d = await api("/api/lfg?guild=" + encodeURIComponent(guild.value));
        if (d.manageable) {
          const game = h("input", { type: "text", maxlength: "80", placeholder: "Game" });
          const when = h("input", { type: "datetime-local" });
          const slots = h("input", { type: "number", min: "2", max: "20", value: "4" });
          const note = h("input", { type: "text", maxlength: "200", placeholder: "Optional" });
          const chan = select([["", "Loading channels…"]], "");
          const evt = h("input", { type: "checkbox" });
          api("/api/servers/channels?guild=" + encodeURIComponent(guild.value)).then(c => { chan.replaceChildren(...c.channels.map(x => h("option", { value: x.id, text: "#" + x.name }))); }).catch(() => {});
          const post = h("button", { class: "btn blue", text: "Post", onclick: () => busy(post, async () => {
            if (!when.value) throw new Error("Pick a date and time.");
            const r = await api("/api/lfg", { guild_id: guild.value, channel_id: chan.value, game: game.value, starts_at: new Date(when.value).getTime(), slots: Number(slots.value), note: note.value, event: evt.checked });
            toast("Posted." + (r.eventError ? " " + r.eventError : ""), r.eventError ? "warn" : "ok"); load();
          }) });
          form.replaceChildren(h("div", { class: "grid two" }, field("Game", game), field("When (your local time)", when), field("Players, counting you", slots), field("Channel", chan)), field("Note", note),
            h("label", { class: "check" }, evt, " Also create a Discord event (the bot needs Manage Events)"), h("p"), post);
        } else form.replaceChildren(h("p", { class: "muted small", text: "Server managers can post from here. Everyone can post with /server lfg post in Discord, and join from here or from the post." }));
        out.className = "";
        if (!d.posts.length) { out.replaceChildren(h("div", { class: "empty", text: "No open posts. Start one with /server lfg post." + (g ? "" : "") })); return; }
        out.replaceChildren(...d.posts.map(p => {
          const act = async (path, msg) => { try { await api(path, { guild_id: guild.value, id: p.id }); toast(msg, "ok"); load(); } catch (e) { toast(e.message, "error"); } };
          const join = h("button", { class: "btn green small", text: p.joined ? "Leave" : "Join", onclick: () => act(p.joined ? "/api/lfg/leave" : "/api/lfg/join", p.joined ? "You left." : "You are in.") });
          const close = p.canClose ? h("button", { class: "btn red small", text: "Close", onclick: () => act("/api/lfg/close", "Closed.") }) : null;
          return h("div", { class: "panel" }, h("h3", { text: p.game }), h("p", { class: "muted", text: new Date(p.starts_at).toLocaleString() + " · hosted by " + p.host + " · " + p.members.length + "/" + p.slots }),
            p.note ? h("p", { text: p.note }) : null, h("p", { class: "muted small", text: "Players: " + p.members.join(", ") }), h("div", { class: "row" }, join, close, p.url ? ext(p.url, "Open in Discord") : null));
        }));
      } catch (e) { out.className = ""; out.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    guild.addEventListener("change", load);
    load();
  }
  root.LfgUI = { view };
})(window);

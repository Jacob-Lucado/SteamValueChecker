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
    const pactBox = h("div", { class: "panel pacts" });
    async function loadPacts() {
      try {
        const d = await api("/api/pacts?guild=" + encodeURIComponent(guild.value));
        const game = h("input", { type: "text", maxlength: "80", placeholder: "Game", "aria-label": "Game" });
        const price = h("input", { type: "number", min: "0.5", step: "0.01", placeholder: "Price", "aria-label": "Target price" });
        const players = h("input", { type: "number", min: "2", max: "20", value: "2", "aria-label": "Players needed" });
        const chan = select([["", "Loading channels…"]], "");
        api("/api/servers/channels?guild=" + encodeURIComponent(guild.value)).then(c => { chan.replaceChildren(...c.channels.map(x => h("option", { value: x.id, text: "#" + x.name }))); }).catch(() => {});
        const start = h("button", { class: "btn blue", type: "button", text: "Start a pact" });
        start.addEventListener("click", () => busy(start, async () => {
          const r = await api("/api/pacts", { guild_id: guild.value, channel_id: chan.value, game: game.value, price: Number(price.value), players: Number(players.value) });
          toast("Pact started." + (r.now ? ` It is ${r.now.price} at ${r.now.shop} right now.` : ""), "ok"); loadPacts();
        }));
        const act = async (p, path, msg) => { try { await api(path, { guild_id: guild.value, id: p.id }); toast(msg, "ok"); loadPacts(); } catch (e) { toast(e.message, "error"); } };
        const money = (n, c) => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency: c }).format(n); } catch { return String(n); } };
        pactBox.replaceChildren(h("h3", { text: "🤝 Buy pacts" }),
          h("p", { class: "muted small", text: "Agree on a price with friends. Everyone who joins is pinged together when the game reaches it." }),
          h("div", { class: "grid two" }, field("Game", game), field("Price (your region's currency)", price), field("Players needed before I ping", players), field("Channel", chan)), start,
          ...(d.pacts.length ? d.pacts.map(p => h("div", { class: "pact-row" },
            h("strong", { text: p.title }), h("span", { class: "muted", text: ` at ${money(p.target, p.currency)} · ${p.count} in, ${p.need} needed` }), " ",
            h("button", { class: "btn green small", type: "button", text: p.joined ? "Leave" : "I'm in", onclick: () => act(p, p.joined ? "/api/pacts/leave" : "/api/pacts/join", p.joined ? "You left." : "You are in.") }),
            p.canCancel ? h("button", { class: "btn red small", type: "button", text: "Cancel", onclick: () => act(p, "/api/pacts/cancel", "Cancelled.") }) : null,
            p.url ? ext(p.url, "Open in Discord") : null)) : [h("p", { class: "muted small", text: "No open pacts. Start one above or with /games pact in Discord." })]));
      } catch (e) { pactBox.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    app.replaceChildren(pageHead("Looking for group", "Find people to play with. Members join with a button, and the group gets a reminder when it starts."),
      h("div", { class: "panel" }, servers.length > 1 ? field("Server", guild) : null, form, out),
      pactBox);
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
    guild.addEventListener("change", () => { load(); loadPacts(); });
    load(); loadPacts();
  }
  root.LfgUI = { view };
})(window);

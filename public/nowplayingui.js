// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls NowPlayingUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { NOWPLAYING_POLL_MS, api, app, busy, currentView, ext, field, h, pageHead, serverPicker, state, toast } = ctx;
    const servers = state.me.servers.filter(g => g.bot !== false);
    const guild = serverPicker(servers), out = h("div"), stamp = h("span", { class: "muted small" });
    let timer = null, loadedAt = 0;
    const alive = () => document.body.contains(out) && currentView() === "nowplaying";
    const on = Boolean(state.me.settings && state.me.settings.nowplaying);
    async function load() {
      if (!servers.length) { out.replaceChildren(h("p", { class: "muted", text: "Invite the bot to a server first." })); return; }
      try {
        const d = await api("/api/nowplaying?guild=" + encodeURIComponent(guild.value));
        if (!alive()) return;
        loadedAt = Date.now();
        if (!d.enabled) { out.replaceChildren(h("div", { class: "notice warn", text: "This bot has no Steam API key set, so it cannot see what people are playing." })); return; }
        out.replaceChildren(d.games.length
          ? h("div", { class: "grid three" }, d.games.map(g => h("div", { class: "panel np-card" },
              h("img", { src: "/art/header/" + g.appid + ".jpg", alt: "", loading: "lazy" }),
              h("h3", { text: g.game }), h("p", { class: "muted", text: g.players.map(p => p.name).join(", ") }),
              g.players.length >= 2 ? h("span", { class: "chip ok", text: g.players.length + " playing together" }) : null,
              ext("https://store.steampowered.com/app/" + g.appid + "/", "Steam page", "btn gray small"))))
          : h("div", { class: "empty", text: d.watching ? "Nobody who shares their activity is in a game right now." : "Nobody in this server has turned this on yet." }),
          h("p", { class: "muted small", text: d.watching + (d.watching === 1 ? " member shares" : " members share") + " what they play." }));
      } catch (e) { if (!loadedAt) out.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    const toggle = h("button", { class: "btn " + (on ? "gray" : "green"), type: "button", text: on ? "Leave the board" : "Show me on the board" });
    toggle.addEventListener("click", () => busy(toggle, async () => {
      const r = await api("/api/settings", { nowplaying: !state.me.settings.nowplaying });
      state.me.settings = r.settings; toast(r.settings.nowplaying ? "You are on the board. Link Steam, turn on sharing and make Game details public so it can see you." : "You are off the board.", "ok"); nowPlayingView();
    }));
    guild.addEventListener("change", load);
    app.replaceChildren(pageHead("Now playing", "Who in your server is in a game right now. Members choose to show up here, and two or more in the same game can trigger a squad-up post."),
      h("div", { class: "panel" }, servers.length > 1 ? field("Server", guild) : null, h("div", { class: "row" }, toggle, stamp)), out);
    out.replaceChildren(h("p", { class: "muted", text: "Loading…" }));
    await load();
    clearInterval(timer);
    timer = setInterval(() => { if (!alive()) return clearInterval(timer); stamp.textContent = loadedAt ? "Refreshes by itself every minute." : ""; if (!document.hidden) load(); }, NOWPLAYING_POLL_MS);
  }
  root.NowPlayingUI = { view };
})(window);

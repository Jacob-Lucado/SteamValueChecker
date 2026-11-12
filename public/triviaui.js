// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls TriviaUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, busy, field, h, pageHead, select, serverPicker, state, toast } = ctx;
    const servers = state.me.servers.filter(g => g.bot !== false);
    const guild = serverPicker(servers), out = h("div");
    app.replaceChildren(pageHead("Trivia", "Guess the game from clues that get easier. Tap the right title; the sooner you get it, the more points. Scores add up per server. In Discord: /server trivia.",),
      h("div", { class: "panel" }, servers.length > 1 ? field("Server", guild) : null), out);
    async function load() {
      if (!servers.length) { out.replaceChildren(h("p", { class: "muted", text: "Invite the bot to a server first." })); return; }
      let d;
      try { d = await api("/api/trivia?guild=" + encodeURIComponent(guild.value)); } catch (e) { out.replaceChildren(h("div", { class: "notice warn", text: e.message })); return; }
      const post = body => api("/api/trivia", { guild_id: guild.value, ...body });
      const parts = [];
      if (d.active) parts.push(h("div", { class: "notice ok", text: `A game is going: round ${d.active.round} of ${d.active.rounds}.` }));
      if (d.canManage && d.enabled) {
        if (d.active) {
          const stop = h("button", { class: "btn red", type: "button", text: "Stop the game" });
          stop.addEventListener("click", () => busy(stop, async () => { await post({ action: "stop" }); toast("Stopped. Scores so far are saved.", "ok"); load(); }));
          parts.push(h("div", { class: "panel" }, h("h3", { text: "Manage (Manage Server)" }), h("div", { class: "row" }, stop)));
        } else {
          const chSel = select(d.channels.map(c => [c.id, "#" + c.name]), d.channels[0] ? d.channels[0].id : "");
          const rounds = select([["3", "3 questions"], ["5", "5 questions"], ["8", "8 questions"], ["10", "10 questions"]], "5");
          const go = h("button", { class: "btn green", type: "button", text: "Start trivia" });
          go.addEventListener("click", () => busy(go, async () => { await post({ action: "start", channel_id: chSel.value, rounds: Number(rounds.value) }); toast("Trivia started.", "ok"); load(); }));
          parts.push(h("div", { class: "panel" }, h("h3", { text: "Start a game" }), field("Play in", chSel), field("Length", rounds), h("div", { class: "row" }, go)));
        }
      } else if (!d.canManage) parts.push(h("p", { class: "muted", text: "A server manager starts the games. Watch for the clues in the channel they pick." }));
      const medal = i => ["🥇", "🥈", "🥉"][i] || String(i + 1) + ".";
      parts.push(h("div", { class: "panel" }, h("h3", { text: "Leaderboard" }),
        d.top.length ? h("ul", { class: "plain" }, d.top.map((r, i) => h("li", { text: `${medal(i)} ${r.name}: ${r.points} pts, ${r.correct} right, ${r.wins} win${r.wins === 1 ? "" : "s"}` })))
          : h("p", { class: "muted", text: "No games played yet." }),
        d.mine ? h("p", { class: "muted small", text: `You: ${d.mine.points} pts from ${d.mine.played} game${d.mine.played === 1 ? "" : "s"}.` }) : null));
      out.replaceChildren(...parts);
    }
    guild.addEventListener("change", load); await load();
  }
  root.TriviaUI = { view };
})(window);

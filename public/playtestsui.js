// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls PlaytestsUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { PLAYTEST_POLL_MS, api, app, currentView, ext, h, pageHead, state, toast } = ctx;
    const F = { kind: "all", mine: false, hideOwned: false, q: "", genre: "" };
    let data = null, seen = null, fresh = new Set(), loadedAt = 0, timer = null, failed = false;
    const list = h("div"), stamp = h("span", { class: "muted small" }), bar = h("div", { class: "row free-bar" });
    const alive = () => document.body.contains(list) && currentView() === "playtests";
    const when = ms => { const m = Math.max(1, Math.round((Date.now() - ms) / 60000)); return m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago"; };
    const KINDS = [["all", "All"], ["playtest", "Playtests"], ["demo", "Demos"], ["beta", "Betas"], ["weekend", "Free weekends"]];
    const search = h("input", { type: "search", placeholder: "Search games", "aria-label": "Search playtests" });
    search.addEventListener("input", () => { F.q = search.value.trim().toLowerCase(); draw(); });
    const mineBox = h("input", { type: "checkbox" }), ownBox = h("input", { type: "checkbox" });
    mineBox.addEventListener("change", () => { F.mine = mineBox.checked; draw(); });
    ownBox.addEventListener("change", () => { F.hideOwned = ownBox.checked; draw(); });
    const genreSel = h("select", { "aria-label": "Filter by genre" });
    genreSel.addEventListener("change", () => { F.genre = genreSel.value; draw(); });
    const fillGenres = () => {
      const count = new Map();
      for (const x of data.items) for (const t of x.tags || []) count.set(t, (count.get(t) || 0) + 1);
      const names = [...count.keys()].sort((a, b) => count.get(b) - count.get(a) || a.localeCompare(b));
      genreSel.replaceChildren(h("option", { value: "", text: names.length ? "Any genre" : "Genres load with Playtester" }), ...names.map(n => h("option", { value: n, text: `${n} (${count.get(n)})` })));
      genreSel.value = names.includes(F.genre) ? F.genre : ""; F.genre = genreSel.value; genreSel.hidden = !names.length;
    };
    const refreshBtn = h("button", { class: "btn gray small", type: "button", text: "Refresh", onclick: () => load(true) });
    const tick = () => { stamp.textContent = !loadedAt ? "" : (failed ? "Could not refresh. Showing the last list. " : "") + "Updated " + (Date.now() - loadedAt < 60000 ? "just now" : when(loadedAt)) + ". Refreshes by itself."; };

    function card(x) {
      const tag = h("span", { class: "pt-kind pt-" + x.kind, text: x.label });
      return h("div", { class: "free-card pt-card" },
        x.image ? h("img", { src: x.image, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : null,
        h("div", { class: "free-info" },
          h("div", { class: "pt-tags" }, tag, fresh.has(x.id) ? h("span", { class: "chip", text: "New" }) : null, x.wishlist ? h("span", { class: "chip ok", text: "On your wishlist" }) : null, x.owned ? h("span", { class: "chip dim", text: "You own it" }) : null),
          h("strong", { text: x.game }),
          h("span", { class: "muted small", text: x.title !== x.game ? x.title : "" }),
          x.summary ? h("span", { class: "muted small pt-sum", text: x.summary }) : null,
          x.tags && x.tags.length ? h("span", { class: "muted small", text: x.tags.slice(0, 5).join(" · ") }) : null,
          h("span", { class: "muted small", text: `${x.source} · ${when(x.date)}` }),
          ext(x.url, "How to join", "btn green small")));
    }
    function draw() {
      if (!data) return;
      bar.replaceChildren(
        h("div", { class: "chips" }, KINDS.map(([id, label]) => { const n = data.items.filter(x => id === "all" || x.kind === id).length; return h("button", { class: "tab small" + (F.kind === id ? " active" : ""), type: "button", text: `${label} (${n})`, onclick: () => { F.kind = id; draw(); } }); })));
      const rows = data.items.filter(x => (F.kind === "all" || x.kind === F.kind) && (!F.mine || x.wishlist) && (!F.hideOwned || !x.owned) && (!F.q || x.game.toLowerCase().includes(F.q)) && (!F.genre || (x.tags || []).includes(F.genre)));
      list.replaceChildren(rows.length ? h("div", { class: "free-grid" }, rows.map(card))
        : h("div", { class: "empty", text: data.items.length ? "Nothing matches those filters." : "No playtests or demos found right now. This page checks again by itself." }));
    }
    async function load(manual) {
      try {
        const d = await api("/api/playtests");
        if (!alive()) return;
        const ids = new Set(d.items.map(x => x.id));
        if (seen) {
          const added = d.items.filter(x => !seen.has(x.id));
          for (const x of added) fresh.add(x.id);
          if (added.length) toast(added.length === 1 ? "1 new playtest or demo." : added.length + " new playtests and demos.", "ok");
          else if (manual) toast("Already up to date.", "ok");
        }
        seen = ids; data = d; failed = false; loadedAt = Date.now();
        notes.replaceChildren(...[!d.sources.abg && h("div", { class: "notice warn", text: "The playtest sites could not be reached just now, so only Steam announcements are shown." }), !d.sources.steam && d.watching === 0 && h("p", { class: "muted small", text: "Add games to your wishlist or link Steam and their Steam announcements show up here too." })].filter(Boolean));
        fillGenres(); draw();
      } catch (e) { failed = true; if (!data) list.replaceChildren(h("div", { class: "notice warn", text: e.message })); else if (manual) toast(e.message, "error"); }
      tick();
    }
    const notes = h("div");
    const schedule = () => {
      clearInterval(timer);
      timer = setInterval(() => { if (!alive()) { clearInterval(timer); document.removeEventListener("visibilitychange", onVis); return; } tick(); if (!document.hidden && Date.now() - loadedAt >= PLAYTEST_POLL_MS - 1000) load(false); }, 30_000);
    };
    const onVis = () => { if (!alive()) return document.removeEventListener("visibilitychange", onVis); if (!document.hidden && Date.now() - loadedAt >= PLAYTEST_POLL_MS) load(false); };
    document.addEventListener("visibilitychange", onVis);
    const on = state.me && state.me.settings && state.me.settings.playtest;
    app.replaceChildren(pageHead("Playtests", "Playtests, betas, demos and free weekends happening now. It reads the Steam announcements of games on your wishlist or in your library, and Alpha Beta Gamer, Playtester, GamerPower, itch.io and Steam's new demos for games Steam news never mentions."),
      h("div", { class: "panel" }, h("div", { class: "row free-bar" }, search, genreSel,
        h("label", { class: "check" }, mineBox, " ", h("span", { text: "On my wishlist" })), h("label", { class: "check" }, ownBox, " ", h("span", { text: "Hide games I own" })), refreshBtn, stamp),
        h("p", { class: "muted small" }, on ? "Your playtest alerts are on. " : "Want a message when one shows up? ", h("a", { href: "#/alerts", text: on ? "Change them in Alert settings." : "Turn on playtest alerts." }))),
      notes, bar, list);
    list.replaceChildren(h("p", { class: "muted", text: "Loading…" }));
    await load(false); schedule();
  }
  root.PlaytestsUI = { view };
})(window);

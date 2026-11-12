// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls MyPageUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, busy, h, pageHead, publicPagePanel, startTour, state } = ctx;
    const grid = h("div", { class: "mp-grid" });
    const KEY = "svc_mypage";
    const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
    const save = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* per-device only */ } };
    const lay = Object.assign({ order: [], hidden: [], pinned: [] }, load());
    let me = state.me, profile = null, showHidden = false;
    try { me = Object.assign({}, state.me, await api("/api/me")); state.me = me; } catch { /* the cached copy is fine */ }
    try { profile = await api("/api/profile"); } catch { /* optional */ }
    const flag = id => { const x = (me.setup || []).find(t => t.id === id); return Boolean(x && x.done); };
    const st = () => me.settings;
    const CARDS = [
      { id: "wishlist", icon: "", title: "Wishlist sale alerts", text: "Watch games and hear about sales, lows and bundles.", href: "#/wishlist", status: () => [me.games > 0, me.games + " game" + (me.games === 1 ? "" : "s") + " watched"], toggle: { key: "paused", label: "Alerts on", invert: true } },
      { id: "free", icon: "", title: "Free game alerts", text: "Told when a game is free on Steam, Epic, GOG and more. The free games page lists them all.", href: "#/free", status: () => [st().free, st().free ? "On" : "Off"], toggle: { key: "free", label: "Turn on" } },
      { id: "digest", icon: "", title: "Weekly digest", text: "One summary of your wishlist sales each week.", href: "#/alerts", status: () => [st().digest, st().digest ? "On" : "Off"], toggle: { key: "digest", label: "Turn on" } },
      { id: "bundles", icon: "", title: "Bundle and giveaway alerts", text: "When a wishlist game is in a bundle, given away, or joins or leaves a subscription.", href: "#/alerts", status: () => [st().bundles, st().bundles ? "On" : "Off"], toggle: { key: "bundles", label: "Turn on" } },
      { id: "share", icon: "", title: "Share with your server", text: "Group alerts, the savings leaderboard and the backlog league.", href: "#/alerts", status: () => [st().share, st().share ? "Opted in" : "Not shared"], toggle: { key: "share", label: "Share" } },
      { id: "library", icon: "", title: "Library", text: "What you own, what you paid, backlog, spend and trophies.", href: "#/library", status: () => [me.library > 0, me.library + " game" + (me.library === 1 ? "" : "s")] },
      { id: "steam", icon: "", title: "Steam link", text: "Hours played, hours tracked over time and a taste profile.", href: "#/steam", status: () => [flag("steam"), flag("steam") ? "Linked" : "Not linked"] },
      { id: "challenge", icon: "", title: "Backlog challenge", text: "A monthly goal of games to finish, with a streak and badges.", href: "#/library", status: () => [flag("challenge"), flag("challenge") ? "Goal set this month" : "No goal this month"] },
      { id: "friends", icon: "", title: "Friends and gifts", text: "Birthdays, reminders and what is on sale for them.", href: "#/friends", status: () => [flag("friend"), flag("friend") ? "Friends added" : "None yet"] },
      { id: "redeem", icon: "", title: "Batch redeem", text: "Redeem many Steam keys through the FanaticalGrabber extension.", href: "#/redeem", status: null },
      { id: "war", icon: "", title: "Sale planner", text: "Plan a sale cart with a budget slider, then see what your alerts caught.", href: "#/warroom", status: null },
      { id: "foryou", icon: "", title: "For you", text: "Discounts ranked by your taste and wishlist.", href: "#/foryou", status: null },
      { id: "deals", icon: "", title: "Check a deal", text: "Price by region and bundle checks.", href: "#/deals", status: null },
      { id: "codes", icon: "", title: "Codes & promos", text: "Working codes for Borderlands, Genshin, Star Rail, Zenless, Destiny 2 and Warframe, plus key giveaway news and DMs for new ones.", href: "#/codes", status: null },
      { id: "calendar", icon: "", title: "Calendar", text: "Release dates, Steam sales and server events.", href: "#/calendar", status: null },
      { id: "compare", icon: "", title: "Compare libraries", text: "See what you and a friend both own.", href: "#/compare", status: null },
      { id: "notifications", icon: "", title: "Notifications", text: "A copy of every alert, and what to mute.", href: "#/notifications", status: () => [me.unread === 0, me.unread ? me.unread + " unread" : "All read"] }
    ];
    const ids = CARDS.map(c => c.id);
    const ordered = () => {
      const rank = id => { const i = lay.order.indexOf(id); return i < 0 ? 1000 + ids.indexOf(id) : i; };
      return [...CARDS].sort((a, b) => (lay.pinned.includes(b.id) - lay.pinned.includes(a.id)) || rank(a.id) - rank(b.id));
    };
    const persist = () => save(lay);
    function move(id, d) {
      const list = ordered().map(c => c.id), i = list.indexOf(id), j = i + d;
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]]; lay.order = list; persist(); draw();
    }
    function card(c) {
      const hidden = lay.hidden.includes(c.id), pinned = lay.pinned.includes(c.id);
      const stt = c.status ? c.status() : null;
      const tools = h("div", { class: "mp-tools" },
        h("button", { class: "btn gray small", type: "button", title: pinned ? "Unpin" : "Pin to the top", "aria-label": (pinned ? "Unpin " : "Pin ") + c.title, text: pinned ? "★" : "☆", onclick: () => { lay.pinned = pinned ? lay.pinned.filter(x => x !== c.id) : [...lay.pinned, c.id]; persist(); draw(); } }),
        h("button", { class: "btn gray small", type: "button", "aria-label": "Move " + c.title + " earlier", text: "↑", onclick: () => move(c.id, -1) }),
        h("button", { class: "btn gray small", type: "button", "aria-label": "Move " + c.title + " later", text: "↓", onclick: () => move(c.id, 1) }),
        h("button", { class: "btn gray small", type: "button", text: hidden ? "Show" : "Hide", onclick: () => { lay.hidden = hidden ? lay.hidden.filter(x => x !== c.id) : [...lay.hidden, c.id]; persist(); draw(); } }));
      const actions = h("div", { class: "mp-actions" });
      if (c.toggle) {
        const on = c.toggle.invert ? !st()[c.toggle.key] : Boolean(st()[c.toggle.key]);
        const b = h("button", { class: "btn small " + (on ? "red" : "green"), text: on ? "Turn off" : c.toggle.label, onclick: () => busy(b, async () => {
          const r = await api("/api/settings", { [c.toggle.key]: c.toggle.invert ? on : !on }); me.settings = r.settings; state.me.settings = r.settings; draw();
        }) });
        actions.append(b);
      }
      actions.append(h("a", { class: "btn blue small", href: c.href, text: !stt ? "Open" : stt[0] ? "Manage" : "Set up" }));
      return h("div", { class: "panel mp-card" + (hidden ? " mp-hidden" : "") },
        h("div", { class: "mp-head" }, h("span", { class: "mp-icon", text: c.icon }), h("strong", { text: c.title }), stt ? h("span", { class: "chip " + (stt[0] ? "ok" : "dim"), text: stt[1] }) : null),
        h("p", { class: "muted small", text: c.text }), actions, tools);
    }
    function draw() {
      const list = ordered().filter(c => showHidden || !lay.hidden.includes(c.id));
      const toggleHidden = lay.hidden.length ? h("button", { class: "btn gray small", type: "button", text: showHidden ? "Hide the hidden cards" : "Show " + lay.hidden.length + " hidden card" + (lay.hidden.length === 1 ? "" : "s"), onclick: () => { showHidden = !showHidden; draw(); } }) : null;
      const reset = h("button", { class: "btn gray small", type: "button", text: "Reset layout", onclick: () => { lay.order = []; lay.hidden = []; lay.pinned = []; persist(); draw(); } });
      grid.replaceChildren(...list.map(card));
      bar.replaceChildren(toggleHidden || "", reset);
    }
    const bar = h("div", { class: "mp-bar" });
    const on = CARDS.filter(c => c.status && c.status()[0]).length, tot = CARDS.filter(c => c.status).length;
    const tourBtn = h("button", { class: "btn gray small", type: "button", text: "Take the tour", onclick: () => startTour({ replay: true }) });
    app.replaceChildren(pageHead("My page", "Everything you can do here. " + on + " of " + tot + " features are set up. Switch simple ones on right here, pin the ones you use, and hide the rest. The layout is kept on this device."), tourBtn, bar, grid, publicPagePanel());
    draw();
  }
  root.MyPageUI = { view };
})(window);

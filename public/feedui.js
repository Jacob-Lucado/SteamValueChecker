// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls FeedUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { FEED_STATE, NATIVE, api, app, busy, env, feedCard, feedComposer, h, pageHead, serverCard, state, toast } = ctx;
    const signedIn = Boolean(state.me);
    const st = FEED_STATE;
    if (!st.scope) st.scope = "following";
    let following = 0, reactions = [], cursor = null, loading = false;
    const list = h("div", { class: "fd-list" }), more = h("button", { class: "btn gray small fd-more", type: "button", text: "Show more", hidden: true });
    const filter = h("div", { class: "fd-filter", hidden: true });
    const composer = h("div", { class: "fd-composer" });
    const scopes = h("div", { class: "fd-scopes" }), serverBar = h("div", { class: "fd-serverbar", hidden: true }), serverHead = h("div", { class: "fd-serverhead" });
    let servers = [];
    const onServer = id => { st.scope = "servers"; st.server = id; drawChrome(); reload(); (NATIVE ? env.scroller?.scrollTo({ top: 0, behavior: "smooth" }) : window.scrollTo({ top: 0, behavior: "smooth" })); };
    const onGame = (appid, game) => { st.game = { appid, game }; drawChrome(); reload(); (NATIVE ? env.scroller?.scrollTo({ top: 0, behavior: "smooth" }) : window.scrollTo({ top: 0, behavior: "smooth" })); };
    function drawChrome() {
      if (st.scope === "following" && !signedIn) st.scope = "everyone";
      scopes.replaceChildren(...[["following", "Following"], ["everyone", "Everyone"], ["servers", "Servers"], ["mine", "My posts"]].filter(([k]) => signedIn || k === "everyone" || k === "servers").map(([k, label]) => {
        const b = h("button", { class: "chip-btn" + (st.scope === k ? " on" : ""), type: "button", text: label, "aria-pressed": String(st.scope === k) });
        b.addEventListener("click", () => { st.scope = k; drawChrome(); reload(); });
        return b;
      }));
      if (!signedIn && st.scope === "mine") st.scope = "everyone";
      drawServerBar();
      filter.hidden = !st.game;
      if (st.game) { const x = h("button", { class: "fd-link", type: "button", text: "Clear" }); x.addEventListener("click", () => { st.game = null; drawChrome(); reload(); }); filter.replaceChildren(h("span", { text: "Showing posts about " }), h("strong", { text: st.game.game }), x); }
    }
    function drawServerBar() {
      serverBar.hidden = st.scope !== "servers";
      if (st.scope !== "servers") { serverHead.replaceChildren(); return; }
      const one = st.server !== "all";
      const seg = (label, on, fn) => { const b = h("button", { class: "chip-btn" + (on ? " on" : ""), type: "button", text: label, "aria-pressed": String(on) }); b.addEventListener("click", fn); return b; };
      const sel = h("select", { class: "fd-pick", "aria-label": "Pick a server" }, ...(servers.some(g => g.id === st.server) || !one ? [] : [h("option", { value: st.server, text: "This server" })]), ...servers.map(g => h("option", { value: g.id, text: g.name })));
      if (one) sel.value = st.server;
      sel.addEventListener("change", () => { st.server = sel.value; drawServerBar(); reload(); });
      serverBar.replaceChildren(h("div", { class: "fd-seg" }, seg("All servers", !one, () => { if (!one) return; st.server = "all"; drawServerBar(); reload(); }),
        seg("One server", one, () => { if (one) return; st.server = servers[0]?.id ?? "all"; if (st.server === "all") return toast("No servers are listed yet.", "warn"); drawServerBar(); reload(); })),
        one ? sel : null, h("a", { class: "fd-link", href: "/communities", text: "Browse all servers" }));
      serverHead.replaceChildren();
      if (one) api("/api/social/server?id=" + encodeURIComponent(st.server)).then(r => serverHead.replaceChildren(serverCard(r.server, r.people))).catch(() => {});
    }
    async function load(append) {
      if (loading) return; loading = true;
      try {
        const q = new URLSearchParams({ scope: st.scope }); if (st.scope === "servers") q.set("server", st.server); if (st.game) q.set("game", st.game.appid); if (append && cursor) q.set("before", cursor);
        const r = await api("/api/social/feed?" + q);
        following = r.following; reactions = r.reactions;
        if (JSON.stringify(servers) !== JSON.stringify(r.servers)) { servers = r.servers; if (st.scope === "servers") drawServerBar(); }
        const ctx = { signedIn, reactions, onGame, onServer };
        if (!append) list.replaceChildren();
        if (!r.items.length && !append) {
          list.replaceChildren(h("div", { class: "empty fd-empty" }, st.scope === "following" && !following
            ? [h("strong", { text: "Your feed is empty" }), h("p", { text: "Follow a few people and what they finish, unlock and post shows up here." }), h("a", { class: "btn blue small", href: "/discover", text: "Find people to follow" })]
            : [h("strong", { text: st.game ? "Nobody has posted about that yet" : st.scope === "mine" ? "You haven't posted yet" : st.scope === "servers" ? "Nothing from this server yet" : "Nothing here yet" }), h("p", { text: st.scope === "mine" ? "Say something above, or finish a game and it appears on its own." : "Check back in a bit, or switch to Everyone." })]));
        } else r.items.forEach(it => list.append(feedCard(it, ctx)));
        cursor = r.items.length ? r.items[r.items.length - 1].id : cursor; more.hidden = !r.more;
      } catch (e) { if (!append) list.replaceChildren(h("div", { class: "notice warn", text: e.message })); else toast(e.message, "error"); }
      loading = false;
    }
    const reload = () => { cursor = null; return load(false); };
    more.addEventListener("click", () => busy(more, () => load(true)));
    app.replaceChildren(pageHead("Feed", "What people are finishing, unlocking and saying. It follows the pages people have made public."), composer, h("div", { class: "fd-bar" }, scopes), serverBar, serverHead, filter, list, h("div", { class: "fd-foot" }, more));
    drawChrome();
    if (signedIn) {
      let games = []; try { games = (await api("/api/social/mygames")).games; } catch { /* the picker is optional */ }
      composer.replaceChildren(h("div", { class: "panel fd-panel" }, feedComposer({ games, onPosted: async () => { await reload(); toast("Posted.", "ok"); } })));
      const prefs = h("details", { class: "fd-prefs panel" }, h("summary", { text: "Feed settings" }));
      api("/api/social/people").then(r => {
        const ev = h("input", { type: "checkbox", checked: r.prefs.events }), dg = h("input", { type: "checkbox", checked: r.prefs.digest });
        ev.addEventListener("change", () => api("/api/social/prefs", { events: ev.checked }).then(() => toast(ev.checked ? "Your finished games and rare unlocks show in the feed." : "Only your posts show in the feed now.", "ok")).catch(e => { ev.checked = !ev.checked; toast(e.message, "error"); }));
        dg.addEventListener("change", () => api("/api/social/prefs", { digest: dg.checked }).then(() => toast(dg.checked ? "You'll get a weekly rundown on Discord." : "No more weekly digest.", "ok")).catch(e => { dg.checked = !dg.checked; toast(e.message, "error"); }));
        const flag = (key, text, onMsg, offMsg) => { const c = h("input", { type: "checkbox", checked: r.prefs[key] }); c.addEventListener("change", () => api("/api/social/prefs", { [key]: c.checked }).then(() => toast(c.checked ? onMsg : offMsg, "ok")).catch(e => { c.checked = !c.checked; toast(e.message, "warn"); })); return h("label", { class: "fd-check" }, c, h("span", { text })); };
        prefs.append(flag("notify", "Tell me in my notifications when someone replies, reacts, follows me or signs my guestbook", "You'll see feed activity in your notifications.", "Feed activity won't show up in your notifications."),
          flag("dm", "Also send those to me on Discord (at most five an hour)", "You'll get them on Discord too.", "No Discord messages for feed activity."),
          flag("guestbook", "Let visitors sign the guestbook on my page", "Your guestbook is open.", "Your guestbook is closed."));
        prefs.append(h("label", { class: "fd-check" }, ev, h("span", { text: "Show my finished games, rare unlocks and trophies in the feed" })), h("label", { class: "fd-check" }, dg, h("span", { text: "Send me a weekly rundown of the people I follow on Discord" })),
          h("p", { class: "muted small", text: "Your page has to be on for anything to show. Turn it on under My profile." }));
      }).catch(() => {});
      app.append(prefs);
    } else composer.replaceChildren(h("div", { class: "notice", role: "status" }, "You're reading as a guest. ", h("a", { href: "/auth/login", text: "Sign in with Discord" }), " to follow people, post and react."));
    reload();
  }
  root.FeedUI = { view };
})(window);

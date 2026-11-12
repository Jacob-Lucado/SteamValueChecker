// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls StreamersUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx, opts = {}) {
    const { api, app, currentParam, currentView, field, h, pageHead, serverPicker, state } = ctx;
    const servers = state.me.servers.filter(g => g.bot !== false);
    const holder = opts.into ?? h("div");
    if (!opts.into) app.replaceChildren(pageHead("Streamers", "Everyone in your server who linked a Twitch, Kick or YouTube channel, and who is live right now."), holder);
    if (!servers.length) { holder.replaceChildren(h("div", { class: "notice warn", text: "The bot is not in any of your servers yet. Add it from the Servers page." })); return; }
    const guild = opts.guild ?? serverPicker(servers, currentParam());
    const st = { show: "all", site: "all" }, SITE = { twitch: "Twitch", kick: "Kick", youtube: "YouTube" };
    let data = null, timer = 0;
    const alive = () => currentView() === (opts.into ? "streamer" : "streamers") && holder.isConnected;
    const ago = ms => { const m = Math.max(1, Math.round(ms / 60_000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
    const chip = (label, on, fn) => { const b = h("button", { class: "chip-btn" + (on ? " on" : ""), type: "button", text: label, "aria-pressed": String(on) }); b.addEventListener("click", fn); return b; };
    guild.addEventListener("change", () => { data = null; load(); });
    function draw() {
      const all = data.people, liveN = all.filter(p => p.live).length;
      const chans = p => (p.channels && p.channels.length ? p.channels : [{ platform: p.platform, handle: p.handle, url: p.url, checked: p.checked }]);
      const list = all.filter(p => (st.show === "all" || (st.show === "live") === Boolean(p.live)) && (st.site === "all" || chans(p).some(c => c.platform === st.site)));
      const sites = [...new Set(all.flatMap(p => chans(p).map(c => c.platform)))];
      const siteOf = u => /twitch/.test(u) ? "Twitch" : /kick/.test(u) ? "Kick" : /youtu/.test(u) ? "YouTube" : "stream";
      const card = p => {
        const live = p.live;
        const av = h("div", { class: "sr-av" + (live ? " live" : "") }, p.avatar ? h("img", { src: p.avatar, alt: "", width: "56", height: "56", referrerpolicy: "no-referrer", loading: "lazy" }) : h("span", { text: p.name.slice(0, 1).toUpperCase() }));
        return h("div", { class: "sr-card " + p.platform + (live ? " live" : "") },
          live ? h("div", { class: "sr-banner" }, h("span", { class: "sr-dot" }), "LIVE NOW", h("span", { class: "sr-since", text: " · " + ago(data.now - live.since) })) : null,
          h("div", { class: "sr-top" }, av,
            h("div", { class: "sr-id" }, h("strong", { text: p.name + (p.mine ? " (you)" : "") }),
              ...chans(p).map(c => h("a", { class: "sr-chan", href: c.url, target: "_blank", rel: "noopener noreferrer", text: SITE[c.platform] + " · " + c.handle + " ↗" }))),
            h("span", { class: "sr-pills" }, ...chans(p).map(c => h("span", { class: "sr-pill " + c.platform, text: SITE[c.platform] })))),
          live ? h("div", { class: "sr-live" }, h("div", { class: "sr-title", text: live.title }), live.game ? h("div", { class: "sr-game", text: "🎮 " + live.game }) : null)
            : h("div", { class: "sr-off" }, h("span", { class: "sr-dot off" }), chans(p).some(c => c.checked) ? "Offline" : "Not checked automatically"),
          live ? h("div", { class: "sr-watchrow" }, h("a", { class: "btn green small sr-watch", href: live.url, target: "_blank", rel: "noopener noreferrer", text: (live.also || []).length ? "Watch on " + siteOf(live.url) : "Watch the stream" }), ...(live.also || []).map(u => h("a", { class: "btn gray small sr-watch", href: u, target: "_blank", rel: "noopener noreferrer", text: "Watch on " + siteOf(u) }))) : null);
      };
      holder.replaceChildren(
        servers.length > 1 && !opts.guild ? h("div", { class: "panel" }, field("Server", guild)) : null,
        h("div", { class: "sr-stats" },
          h("div", { class: "sr-stat" }, h("b", { text: String(all.length) }), h("span", { text: "linked" })),
          h("div", { class: "sr-stat" + (liveN ? " hot" : "") }, h("b", { text: String(liveN) }), h("span", { text: "live now" })),
          h("div", { class: "sr-stat" }, h("b", { text: String(all.length - liveN) }), h("span", { text: "offline" })),
          h("a", { class: "btn blue sr-link", href: "#/" + (opts.into ? "streamer" : "streams") + "?guild=" + encodeURIComponent(guild.value), text: "Link your channel" })),
        all.length ? h("div", { class: "panel fy-filters" },
          h("div", { class: "fy-row" }, h("span", { class: "fy-lab", text: "Show" }), chip("Everyone", st.show === "all", () => { st.show = "all"; draw(); }), chip("Live now", st.show === "live", () => { st.show = "live"; draw(); }), chip("Offline", st.show === "off", () => { st.show = "off"; draw(); })),
          sites.length > 1 ? h("div", { class: "fy-row" }, h("span", { class: "fy-lab", text: "Site" }), chip("All", st.site === "all", () => { st.site = "all"; draw(); }), ...sites.map(x => chip(SITE[x], st.site === x, () => { st.site = x; draw(); }))) : null) : null,
        list.length ? h("div", { class: "sr-grid" }, ...list.map(card)) : h("div", { class: "empty", text: all.length ? "Nobody matches that filter." : "Nobody has linked a channel in this server yet. Streamers (and moderators and managers) can link theirs on the Streams page or with /server stream link." }));
    }
    async function load() {
      clearTimeout(timer);
      try { data = await api("/api/streams/roster?guild=" + encodeURIComponent(guild.value)); draw(); }
      catch (e) { holder.replaceChildren(servers.length > 1 ? h("div", { class: "panel" }, field("Server", guild)) : null, h("div", { class: "notice warn", text: e.message })); }
      timer = setTimeout(() => { if (alive()) load(); }, 30_000);
    }
    load();
  }
  root.StreamersUI = { view };
})(window);

// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls SetupUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, busy, channelPanel, currentParam, ext, field, h, pageHead, progressBar, select, serverPicker, state, toast } = ctx;
    const servers = state.me.servers.filter(g => g.manageable);
    const holder = h("div");
    app.replaceChildren(pageHead("Server setup", "A few choices and your server is ready. The same steps are in Discord with /manage setup."), holder);
    if (!servers.length) { holder.replaceChildren(h("div", { class: "notice warn", text: "You need the Manage Server permission in a server to set it up." })); return; }
    const wanted = currentParam();
    const guild = serverPicker(servers, wanted);
    async function load() {
      holder.replaceChildren(h("p", { class: "muted", text: "Loading…" }));
      try {
        const st = await api("/api/servers/setup?guild=" + encodeURIComponent(guild.value));
        const picker = servers.length > 1 ? h("div", { class: "panel" }, field("Server", guild)) : null;
        if (st.bot === false) {
          holder.replaceChildren(...[picker, h("div", { class: "panel" }, h("h3", { text: "Add the bot first" }), h("p", { class: "muted", text: "The bot is not in this server yet." }),
            state.cfg && state.cfg.inviteUrl ? ext(state.cfg.inviteUrl, "Add to this server", "btn green") : null)].filter(Boolean));
          return;
        }
        const [ch, ro, fo] = await Promise.all([api("/api/servers/channels?guild=" + encodeURIComponent(guild.value)).catch(() => ({ channels: [] })), api("/api/servers/roles?guild=" + encodeURIComponent(guild.value)).catch(() => ({ roles: [] })), api("/api/servers/forums?guild=" + encodeURIComponent(guild.value)).catch(() => ({ forums: [] }))]);
        const cmap = await api("/api/servers/channelmap?guild=" + encodeURIComponent(guild.value)).catch(() => ({ channels: [] }));
        const feat = await api("/api/servers/features?guild=" + encodeURIComponent(guild.value)).catch(() => ({ features: [] }));
        // Whole areas of the bot this server can switch off (the same switches as /manage features).
        const featuresPanel = list => list.length ? h("div", { class: "panel" }, h("h3", { text: "What this server uses" }),
          h("p", { class: "muted", text: "Switch off the areas you don't want. Their commands then answer with a short note instead of running. Prices, wishlists and alerts are always on." }),
          ...list.map(a => { const b = h("button", { class: "btn small " + (a.on ? "red" : "green"), text: a.on ? "Switch off" : "Switch on" });
            b.addEventListener("click", () => busy(b, async () => { await api("/api/servers/features", { guild_id: guild.value, id: a.id, on: !a.on }); load(); }));
            return h("div", { class: "setup-row" }, h("div", {}, h("b", { text: (a.on ? "🟢 " : "⚪ ") + a.emoji + " " + a.name }), h("div", { class: "muted small", text: a.about })), b); })) : null;
        const reqSel = select([["", "Not set"], ...fo.forums.map(c => [c.id, "#" + c.name])], st.requestsChannel || "");
        const chOpts = cur => select([["", "Not set"], ...ch.channels.map(c => [c.id, "#" + c.name])], cur || "");
        const row = (step, title, help, ...controls) => h("div", { class: "setup-row" }, h("div", {}, h("b", { text: (step.done ? "✅ " : step.optional ? "➖ " : "⬜ ") + title }), h("div", { class: "muted small", text: help })), ...controls.filter(Boolean));
        const save = (label, fn) => { const b = h("button", { class: "btn blue small", text: label }); b.addEventListener("click", () => busy(b, async () => { await fn(); toast("Saved.", "ok"); load(); })); return b; };
        const [sAlert, sFeed, sSupport, sVouch] = st.steps; // (the forum row finds its step by id)
        const alertSel = chOpts(st.alertChannel), supportSel = chOpts(st.supportChannel), vouchSel = chOpts(st.vouchChannel);
        const staffSel = select([["", "Only people with Manage Server"], ...ro.roles.map(r => [r.id, r.name])], st.staffRole || "");
        const done = st.steps.filter(x => x.done).length;
        const auto = st.complete && st.vouchChannel && st.requestsChannel ? null : h("div", { class: "panel" }, h("h3", { text: "Fastest way" }),
          h("p", { class: "muted", text: "I can create a Steam Value Checker category with #deal-alerts, a private #support-tickets (only you and the bot), #vouches and a #feature-requests forum, and connect them. Needs the Manage Channels permission." }),
          (() => { const b = h("button", { class: "btn green", text: "Create the channels for me" }); b.addEventListener("click", () => busy(b, async () => { const r = await api("/api/servers/setup/auto", { guild_id: guild.value, staff_role_id: staffSel.value || null }); toast(r.created.length ? "Channels created and connected." : r.note, "ok"); load(); })); return b; })());
        const feedBtn = h("button", { class: "btn small " + (st.feed ? "red" : "green"), text: st.feed ? "Stop the feed" : "Turn on the feed" });
        feedBtn.addEventListener("click", () => busy(feedBtn, async () => { await api("/api/servers/feed", { guild_id: guild.value, enabled: !st.feed }); load(); }));
        holder.replaceChildren(...[picker, auto, h("div", { class: "panel" },
          h("h3", { text: `Checklist (${done} of ${st.steps.length})` }), progressBar(done / st.steps.length),
          row(sAlert, "Alert channel", "Where alerts go when a member's DM fails, and where the free-games feed posts. The bot posts a short note there to check it can.",
            h("div", { class: "row" }, alertSel, save("Save", () => (alertSel.value ? api("/api/servers/channel", { guild_id: guild.value, channel_id: alertSel.value }) : api("/api/servers/channel", { guild_id: guild.value, clear: true }))))),
          row(sFeed, "Free-games feed", "Posts new free games (not DLC) in the alert channel for everyone.", st.alertChannel ? feedBtn : h("span", { class: "muted small", text: "Choose an alert channel first." })),
          row(st.steps.find(x => x.id === "digest"), "Friday round-up", "Every Friday the alert channel gets cheap games that opted-in members watch (never who), the free games on now and the week's server events.",
            st.alertChannel ? (() => { const b = h("button", { class: "btn small " + (st.weeklyDigest ? "red" : "green"), text: st.weeklyDigest ? "Turn off" : "Turn on" }); b.addEventListener("click", () => busy(b, async () => { await api("/api/servers/digest", { guild_id: guild.value, enabled: !st.weeklyDigest }); load(); })); return b; })() : h("span", { class: "muted small", text: "Choose an alert channel first." })),
          row(st.steps.find(x => x.id === "gamenight"), "Game night nudges", "When 2 or more opted-in members in a voice channel all have the same game hit their alert, the bot posts once in that channel's text chat. Members join with /alerts share.",
            (() => { const b = h("button", { class: "btn small " + (st.gameNight ? "red" : "green"), text: st.gameNight ? "Turn off" : "Turn on" }); b.addEventListener("click", () => busy(b, async () => { await api("/api/servers/gamenight", { guild_id: guild.value, enabled: !st.gameNight }); load(); })); return b; })()),
          row(sSupport, "Support tickets", "Members use /bot support open. Tickets appear here with Reply, Assign and Resolve buttons, and in the Support page.",
            h("div", { class: "row" }, supportSel, staffSel, save("Save", () => api("/api/tickets/setup", { guild_id: guild.value, channel_id: supportSel.value, staff_role_id: staffSel.value })))),
          state.me.giveaways ? row(sVouch, "Giveaway vouches", "Winners' confirmations are posted here. Without one the bot looks for a channel named #vouches.",
            h("div", { class: "row" }, vouchSel, save("Save", () => api("/api/giveaways/setup", { guild_id: guild.value, vouch_channel_id: vouchSel.value })))) : null,
          row(st.steps.find(x => x.id === "requests"), "Feature requests forum", "Every idea members send in on the dashboard becomes a post here, tagged with its status (planned, in development, shipped…). Needs a forum channel, which Discord only offers on Community servers.",
            fo.forums.length ? h("div", { class: "row" }, reqSel, save("Save", () => api("/api/community/places", { guild_id: guild.value, requests_channel: reqSel.value }))) : h("span", { class: "muted small", text: "No forum channel yet. \"Create the channels for me\" makes one, or add one in Discord." }))),
          cmap.channels.length ? channelPanel(cmap.channels, ch.channels, st.alertChannel, guild.value, load) : null,
          featuresPanel(feat.features),
          h("div", { class: "panel" }, h("h3", { text: "What members can do now" }), h("ul", {},
            h("li", {}, "Import a wishlist for sale alerts: ", h("code", { text: "/me wishlist import" }), ", then star favorites with ", h("code", { text: "/me wishlist priority" })),
            h("li", {}, "Price a library: ", h("code", { text: "/games value" }), " or link Steam for hours, ", h("code", { text: "/me steam recap" }), " and ", h("code", { text: "/me library challenge" })),
            h("li", {}, "Share a wishlist for gifts: ", h("code", { text: "/me publicpage" })), h("li", {}, "Keep friends' birthdays and gift deals: ", h("code", { text: "/me friend add" })), h("li", {}, "Earn badges and join the monthly league: ", h("code", { text: "/me library badges" }), " and ", h("code", { text: "/server leaderboard board:finished" })), h("li", {}, "Track bundles and hour goals: ", h("code", { text: "/me library bundle" }), " and ", h("code", { text: "/me steam goal" })), h("li", {}, "See events and release dates: ", h("code", { text: "/server calendar view" })),
            h("li", {}, "Ask for help: ", h("code", { text: "/bot support open" })), h("li", {}, "Managers can run giveaways: ", h("code", { text: "/server giveaway create" }))))].filter(Boolean));
      } catch (e) { holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    guild.addEventListener("change", load);
    load();
  }
  root.SetupUI = { view };
})(window);

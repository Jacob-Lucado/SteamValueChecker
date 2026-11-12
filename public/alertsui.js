// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls AlertsUI.view(ctx).
(function (root) {
  "use strict";
  function view(ctx) {
    const { PLAYTEST_SOURCES, api, app, busy, field, h, muteToggles, pageHead, samplePanel, select, state, toast } = ctx;
    const s = state.me.settings;
    const dm = h("input", { type: "radio", name: "delivery", value: "dm", checked: s.delivery === "dm" });
    const ch = h("input", { type: "radio", name: "delivery", value: "channel", checked: s.delivery === "channel" });
    const paused = h("input", { type: "checkbox", checked: s.paused });
    const region = select(state.cfg.regions.map(r => [r.value, r.name]), s.region);
    const stores = select([["major", "Major stores only (recommended)"], ["all", "All tracked stores, including key sites"]], s.stores);
    const withChannel = state.me.servers.filter(g => g.alertChannel);
    const server = select([["", "None"], ...state.me.servers.map(g => [g.id, g.name + (g.alertChannel ? "" : " (no alert channel)")])],
      s.guild_id || (withChannel.length === 1 ? withChannel[0].id : ""));
    const myTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; } })();
    const qs = h("input", { type: "time", value: s.quiet_start || "" });
    const qe = h("input", { type: "time", value: s.quiet_end || "" });
    const tz = h("input", { type: "text", value: s.tz && s.tz !== "UTC" ? s.tz : myTz, maxlength: "60" });
    const minDisc = h("input", { type: "number", min: "0", max: "90", step: "5", value: String(s.min_discount || 0), class: "short-num", "aria-label": "Minimum discount percent" });
    const maxPrice = h("input", { type: "number", min: "0", max: "1000", step: "1", value: String(s.max_price || 0), class: "short-num", "aria-label": "Highest price worth an alert" });
    const lowsOnly = h("input", { type: "checkbox", checked: Boolean(s.lows_only) });
    const digest = h("input", { type: "checkbox", checked: s.digest });
    const digestDay = select(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => [String(i), d]), String(s.digest_day));
    const bundles = h("input", { type: "checkbox", checked: s.bundles });
    const share = h("input", { type: "checkbox", checked: s.share });
    const free = h("input", { type: "checkbox", checked: s.free });
    const freeDlc = h("input", { type: "checkbox", checked: s.free_dlc !== false });
    const dlcOn = h("input", { type: "checkbox", checked: Boolean(s.dlc) });
    const refundOn = h("input", { type: "checkbox", checked: Boolean(s.refund) });
    const playSel = select([["0", "Off"], ["1", "Only games on my wishlist"], ["2", "Every playtest and demo found"]], String(s.playtest ?? 0));
    const skipOn = new Set(s.playtest_skip || []);
    const skipBoxes = PLAYTEST_SOURCES.map(([id, label]) => { const cb = h("input", { type: "checkbox", checked: skipOn.has(id) }); cb.dataset.src = id; return h("label", { class: "check" }, cb, " " + label); });
    const skipField = h("div", { class: "field" }, h("label", { text: "Don't include listings from" }), h("div", { class: "stack" }, ...skipBoxes), h("p", { class: "muted small", text: "Tick a site and its playtests and demos are left out of your alerts. Steam announcements aren't affected." }));
    const skipList = () => skipBoxes.map(l => l.firstChild).filter(cb => cb.checked).map(cb => cb.dataset.src);
    const achvOn = h("input", { type: "checkbox", checked: Boolean(s.achv) });
    const nudgeOn = h("input", { type: "checkbox", checked: Boolean(s.nudge) });
    const nowOn = h("input", { type: "checkbox", checked: Boolean(s.nowplaying) });
    const yearOn = h("input", { type: "checkbox", checked: Boolean(s.yearly) });
    const milesOn = h("input", { type: "checkbox", checked: Boolean(s.milestones) });
    const newsMode = select([["0", "Off"], ["1", "Patch notes only"], ["2", "Every announcement"]], String(s.news ?? 0));
    /** Game code and giveaway news alerts: the rows go into "What to tell me about" and are saved with everything else. */
    function codeAlertRows() {
      const box = h("div", {}, h("p", { class: "muted small", text: "Loading game code options…" }));
      let collect = async () => {};
      api("/api/alerts/codes").then(d => {
        const codes = h("input", { type: "checkbox", checked: d.codes }), promos = h("input", { type: "checkbox", checked: d.promos });
        const picked = new Set(d.families.filter(f => !d.games.length || f.games.some(k => d.games.includes(k))).map(f => f.key));
        const boxes = d.families.map(x => { const c = h("input", { type: "checkbox", checked: picked.has(x.key) }); c.addEventListener("change", () => { c.checked ? picked.add(x.key) : picked.delete(x.key); }); return h("label", { class: "check" }, c, " ", x.title); });
        collect = async () => {
          if (codes.checked && !picked.size) throw new Error("Keep at least one game ticked, or turn game code alerts off.");
          await api("/api/alerts/codes", { codes: codes.checked, promos: promos.checked, games: picked.size ? [...picked] : d.families.map(x => x.key) });
        };
        box.replaceChildren(
          h("label", { class: "check" }, codes, "Tell me when a new game code drops, for these games (only new ones from now on):"), h("div", { class: "checks" }, boxes),
          h("label", { class: "check" }, promos, "Tell me about giveaway and code news from NVIDIA, SteelSeries and game studios (can be a false alarm now and then)"));
      }).catch(e => box.replaceChildren(h("div", { class: "notice warn", text: e.message })));
      return { box, save: () => collect() };
    }
    const codeRows = codeAlertRows();
    const save = h("button", { class: "btn green", text: "Save settings", onclick: () => busy(save, async () => {
      const r = await api("/api/settings", {
        delivery: ch.checked ? "channel" : "dm", paused: paused.checked, region: region.value, stores: stores.value, guild_id: server.value || null,
        quiet_start: qs.value || null, quiet_end: qe.value || null, tz: tz.value, digest: digest.checked, digest_day: Number(digestDay.value),
        max_price: Number(maxPrice.value || 0), lows_only: lowsOnly.checked, bundles: bundles.checked, share: share.checked, free: free.checked, free_dlc: freeDlc.checked, dlc: dlcOn.checked, refund: refundOn.checked, milestones: milesOn.checked, yearly: yearOn.checked, nudge: nudgeOn.checked, nowplaying: nowOn.checked, achv: achvOn.checked, playtest: Number(playSel.value), playtest_skip: skipList(), news: Number(newsMode.value), min_discount: Number(minDisc.value || 0)
      });
      state.me.settings = r.settings;
      await codeRows.save();
      toast("Settings saved.", "ok");
    }) });
    app.replaceChildren(
      pageHead("Alert settings", "How and where you hear about sales, free games, codes and giveaways."),
      h("div", { class: "panel" },
        h("h3", { text: "Delivery" }),
        h("label", { class: "check" }, dm, "Direct message. If it cannot be delivered, the server alert channel is used as a fallback."),
        h("label", { class: "check" }, ch, "Server alert channel only. You are mentioned there, and everyone who can see the channel sees the game name."),
        field("Server for the alert channel", server), h("p", { class: "muted small", text: "Alerts that cannot be sent by DM go to this server's alert channel." }),
        field("Only alert for sales of at least this percent off (0 = any; starred games always come through)", minDisc),
        field("Only alert when the price is at or under this amount, in your store's currency (0 = no limit; starred games always come through)", maxPrice),
        h("label", { class: "check" }, lowsOnly, "Only alert for record lows (the lowest price ever seen; starred games always come through)"),
        h("label", { class: "check" }, paused, "Pause all alerts (your wishlist is kept)")),
      h("div", { class: "panel" },
        h("h3", { text: "Prices" }),
        h("div", { class: "row" }, field("Region", region), field("Stores that count", stores))),
      h("div", { class: "panel" },
        h("h3", { text: "What to tell me about" }),
        h("label", { class: "check" }, bundles, "A wishlist game is in a bundle, is given away, or joins or leaves a subscription (Game Pass and so on)"),
        h("label", { class: "check" }, free, "Any game is free to claim (Steam, Epic, GOG and others). Games from one store arrive together with a Claim all button."),
        h("label", { class: "check" }, freeDlc, "Include free DLC and add-ons (also controls what /games freegames and the Free games page show)"),
        h("label", { class: "check" }, refundOn, "A heads-up before the refund window closes on a new Steam game I barely played, or when it drops below what I paid (that part needs the extension's purchase sync)"),
        field("Playtests, demos and betas (Steam, Alpha Beta Gamer, Playtester, GamerPower and itch.io)", playSel), skipField,
        h("label", { class: "check" }, achvOn, "A heads-up when I am almost at 100% achievements in a game"),
        h("label", { class: "check" }, nudgeOn, "A monthly pick from my backlog to try next"),
        h("label", { class: "check" }, nowOn, "Show the game I am in on my server's Now playing board (needs Steam linked, library sharing and public game details)"),
        h("label", { class: "check" }, yearOn, "My year in games card, sent at the end of December"),
        h("label", { class: "check" }, milesOn, "A card when a game passes 100, 250, 500, 1000 or 2000 hours"),
        h("label", { class: "check" }, dlcOn, "A big sale on DLC and add-ons for games I play (Steam library, two hours or more)"),
        h("div", { class: "row" }, field("Patch notes and news for the Steam games I own or wishlist", newsMode)),
        codeRows.box),
      h("div", { class: "panel" },
        h("h3", { text: "Quiet hours and weekly digest" }),
        h("p", { class: "muted small", text: "Alerts that arrive during quiet hours are held and sent afterwards. Leave both empty to turn quiet hours off." }),
        h("div", { class: "row" }, field("Quiet from", qs), field("Until", qe), field("Your time zone", tz)),
        h("label", { class: "check" }, digest, "Weekly digest of your wishlist sales, sent from 9:00 in your time zone on"), field("Day", digestDay)),
      muteToggles(),
      samplePanel(),
      h("div", { class: "panel" },
        h("h3", { text: "Share with your server" }),
        h("label", { class: "check" }, share, "Count me in group alerts (“3 members are watching…”) and on the savings leaderboard. Shows only my name, my game count and my percent saved.")),
      h("p", { class: "muted", text: `Watching ${state.me.games} game${state.me.games === 1 ? "" : "s"}. Prices are checked about once an hour.` }),
      h("p", { class: "muted small" }, "Everything the bot has sent you is kept on the ", h("a", { href: "#/notifications", text: "Notifications" }), " page, including what you muted."),
      save);
  }
  root.AlertsUI = { view };
})(window);

// A piece of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls ServerDetailUI.view(ctx).
(function (root) {
  "use strict";
  function view(shared, id) {
    const { api, app, board, botBadge, busy, ext, field, guildInvite, h, navigate, select, serverIcon, sharedList, state, statsPanel, toast } = shared;
    const g = state.me.servers.find(x => x.id === id);
    if (!g) { navigate("/servers"); return; }
    const canUse = g.bot !== false;
    const body = h("div", { class: "sv-body" });
    const sections = [["overview", "Overview"], ...(canUse ? [["alerts", "Deal alerts", true], ["codes", "Codes & promos", true], ["list", "Shared wishlist"], ["board", "Leaderboard"], ["stats", "Server stats"], ["giveaways", "Giveaways", true]] : [])]
      .filter(([, , managerOnly]) => !managerOnly || g.manageable);
    let current = "overview";
    const tabs = h("div", { class: "tabs" }, sections.map(([key, label]) => h("button", { class: "tab" + (key === current ? " active" : ""), text: label, onclick: ev => {
      current = key; tabs.querySelectorAll(".tab").forEach(t => t.classList.remove("active")); ev.currentTarget.classList.add("active"); show();
    } })));

    function overview() {
      const tile = (icon, k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: v }), sub && h("div", { class: "s", text: sub }));
      const go = key => () => { const t = [...tabs.children].find(b => b.textContent === sections.find(s => s[0] === key)[1]); t && t.click(); };
      const action = (icon, title, text, onclick) => h("button", { class: "sv-action", onclick }, h("span", { class: "sv-ico big", text: icon }), h("span", {}, h("b", { text: title }), h("span", { class: "muted small", text })));
      const out = [];
      if (g.bot === false) out.push(h("div", { class: "notice warn" }, "The bot is not in this server yet. ", guildInvite(g) && g.manageable ? ext(guildInvite(g), "Add it now", "btn green small") : "Ask a server manager to add it."));
      out.push(h("div", { class: "grid three" },
        tile("", "Alert channel", g.alertChannel ? "Set" : "Not set", g.alertChannel ? "Used when a DM fails or a member picks channel delivery" : "Alerts go by DM only"),
        tile("", "Group alerts", g.groupMin ? `From ${g.groupMin}` : "Off", "When several opted-in members want the same game"),
        tile("", "Bot", g.bot === null ? "-" : g.bot ? "Installed" : "Not added")));
      if (canUse) {
        out.push(h("div", { class: "sv-actions-grid" },
          g.manageable && action("", "Choose the alert channel", "Where alerts go when a DM cannot be delivered", go("alerts")),
          action("", "Shared wishlist", "Suggest games and vote with your server", go("list")),
          action("", "Leaderboard", "Who has saved the most against MSRP", go("board")),
          g.manageable && action("", "Giveaways", "Create and manage key giveaways", () => { navigate("/giveaways"); })));
      }
      return out.filter(Boolean);
    }

    function alertsPanel() {
      const holder = h("div", { class: "muted", text: "Loading channels…" });
      (async () => {
        try {
          const data = await api("/api/servers/channels?guild=" + encodeURIComponent(g.id));
          const pick = select(data.channels.map(c => ["" + c.id, "#" + c.name]), data.current || "");
          const status = h("p", { class: "sv-status", text: g.alertChannel ? "Alerts are posted in #" + ((data.channels.find(c => "" + c.id === "" + data.current) || {}).name || "the chosen channel") + "." : "No alert channel yet. Alerts go by DM only." });
          const set = h("button", { class: "btn green", text: "Save channel" });
          set.addEventListener("click", () => busy(set, async () => {
            const r = await api("/api/servers/channel", { guild_id: g.id, channel_id: pick.value });
            g.alertChannel = r.channel.id; status.textContent = "Alerts are posted in #" + r.channel.name + "."; toast("Alert channel set. A confirmation was posted there.", "ok");
          }));
          const clear = h("button", { class: "btn red", text: "Remove" });
          clear.addEventListener("click", () => busy(clear, async () => {
            await api("/api/servers/channel", { guild_id: g.id, clear: true }); g.alertChannel = null; status.textContent = "No alert channel yet. Alerts go by DM only."; toast("Alert channel removed.", "ok");
          }));
          const feedOn = h("input", { type: "checkbox", checked: Boolean(g.freeFeed) });
          const feedLabel = h("label", { text: "Post free games to this server's alert channel" });
          feedOn.addEventListener("change", async () => {
            try { const r = await api("/api/servers/feed", { guild_id: g.id, enabled: feedOn.checked }); g.freeFeed = r.freeFeed; toast(r.freeFeed ? "Free game feed on." : "Free game feed off.", "ok"); }
            catch (e) { feedOn.checked = !feedOn.checked; toast(e.message, "error"); }
          });
          const hotMin = h("input", { type: "number", min: "0", max: "95", value: String(g.hotMin || 0), "aria-label": "Smallest discount to post, in percent" });
          const setHot = h("button", { class: "btn gray", text: "Save" });
          setHot.addEventListener("click", () => busy(setHot, async () => {
            const r = await api("/api/servers/hot", { guild_id: g.id, minimum: Number(hotMin.value) });
            g.hotMin = r.hotMin; toast(r.hotMin ? `Hot deals on from ${r.hotMin}% off.` : "Hot deals off.", "ok");
          }));
          const saleOn = h("input", { type: "checkbox", checked: Boolean(g.saleFeed) });
          saleOn.addEventListener("change", async () => {
            try { const r = await api("/api/servers/sales", { guild_id: g.id, enabled: saleOn.checked }); g.saleFeed = r.saleFeed; toast(r.saleFeed ? "Sale posts on." : "Sale posts off.", "ok"); }
            catch (e) { saleOn.checked = !saleOn.checked; toast(e.message, "error"); }
          });
          const digestOn = h("input", { type: "checkbox", checked: Boolean(g.weeklyDigest) });
          digestOn.addEventListener("change", async () => {
            try { const r = await api("/api/servers/digest", { guild_id: g.id, enabled: digestOn.checked }); g.weeklyDigest = r.weeklyDigest; toast(r.weeklyDigest ? "Weekly digest on." : "Weekly digest off.", "ok"); }
            catch (e) { digestOn.checked = !digestOn.checked; toast(e.message, "error"); }
          });
          const min = h("input", { type: "number", min: "0", max: "20", value: String(g.groupMin || 0) });
          const setMin = h("button", { class: "btn gray", text: "Save" });
          setMin.addEventListener("click", () => busy(setMin, async () => {
            const r = await api("/api/servers/group", { guild_id: g.id, minimum: Number(min.value) });
            g.groupMin = r.groupMin; toast(r.groupMin ? `Group alerts on from ${r.groupMin} members.` : "Group alerts off.", "ok");
          }));
          holder.className = ""; holder.replaceChildren(
            h("div", { class: "panel" }, h("h3", { text: "Alert channel" }), status,
              h("div", { class: "rule inline" }, pick, set, g.alertChannel && clear),
              h("p", { class: "muted small", text: "Saving posts a short confirmation there, which also checks that the bot can post. If that fails, give the bot View Channel, Send Messages and Embed Links in the channel." })),
            h("div", { class: "panel" }, h("h3", { text: "Free game feed" }),
              h("p", { class: "muted", text: "Post new free games, and Steam free weekends, in the alert channel for everyone, once each. Not DLC. Needs an alert channel." }),
              h("div", { class: "rule inline" }, feedOn, feedLabel)),
            h("div", { class: "panel" }, h("h3", { text: "Hot deals" }),
              h("p", { class: "muted", text: "Post big Steam discounts in the alert channel, even for games nobody here watches, each deal once. Enter the smallest discount to post (30 to 95 percent). 0 turns it off. Needs an alert channel." }),
              h("div", { class: "rule inline" }, hotMin, setHot)),
            h("div", { class: "panel" }, h("h3", { text: "Steam sales" }),
              h("p", { class: "muted", text: "Post once when a Steam sale or festival starts (from Valve's published calendar). If one is already running, it posts right away. Needs an alert channel." }),
              h("div", { class: "rule inline" }, saleOn, h("label", { text: "Post when a Steam sale starts" }))),
            h("div", { class: "panel" }, h("h3", { text: "Weekly digest" }),
              h("p", { class: "muted", text: "On Fridays, post cheap games that opted-in members watch (never who), the free games on now and the week's server events. Needs an alert channel." }),
              h("div", { class: "rule inline" }, digestOn, h("label", { text: "Post the weekly digest" }))),
            h("div", { class: "panel" }, h("h3", { text: "Group alerts" }),
              h("p", { class: "muted", text: "Post in the channel when this many opted-in members watch the same game and it hits their alert. 0 turns it off. Needs an alert channel." }),
              h("div", { class: "rule inline" }, min, setMin)));
        } catch (e) { holder.className = ""; holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
      })();
      return [holder];
    }

    function codesPanel() {
      const holder = h("div", { class: "muted", text: "Loading…" });
      (async () => {
        try {
          const d = await api("/api/servers/codes?guild=" + encodeURIComponent(g.id));
          const st = d.settings;
          const chan = select([["", "No channel (off)"], ...d.channels.map(c => ["" + c.id, "#" + c.name])], st.channel_id || "");
          const role = select([["", "Nobody"], ...d.roles.filter(r => r.name !== "@everyone").map(r => ["" + r.id, r.name])], st.role_id || "");
          const picked = new Set(d.families.filter(f => !st.games.length || f.games.some(k => st.games.includes(k))).map(f => f.key));
          const boxes = d.families.map(x => { const c = h("input", { type: "checkbox", checked: picked.has(x.key) }); c.addEventListener("change", () => { c.checked ? picked.add(x.key) : picked.delete(x.key); }); return h("label", { class: "check" }, c, " ", x.title); });
          const save = h("button", { class: "btn green", text: "Save" });
          save.addEventListener("click", () => busy(save, async () => {
            if (!picked.size) throw new Error("Keep at least one game ticked, or pick no channel to turn this off.");
            await api("/api/servers/codes", { guild_id: g.id, channel_id: chan.value, role_id: role.value, games: [...picked] });
            toast(chan.value ? "Saved. New codes will be posted there." : "Saved. Codes are off for this server.", "ok");
          }));
          holder.className = "";
          holder.replaceChildren(
            h("div", { class: "panel" }, h("h3", { text: "Game codes" }),
              h("p", { class: "muted", text: "Limited-time codes for Borderlands, Genshin Impact, Star Rail, Zenless Zone Zero, Destiny 2 and Warframe, posted once each in the channel you pick. When a code ends, its post is grayed out. The same list is on the Game codes page for everyone." }),
              field("Channel", chan), field("Ping this role for new codes", role),
              h("div", {}, h("label", { text: "Games" }), h("div", { class: "checks" }, boxes)),
              h("div", { class: "row" }, save)));
        } catch (e) { holder.className = ""; holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
      })();
      return [holder];
    }

    function bundlesPanel() {
      const holder = h("div", { class: "muted", text: "Loading…" });
      (async () => {
        try {
          const d = await api("/api/servers/bundles?guild=" + encodeURIComponent(g.id));
          const st = d.settings;
          const chan = select([["", "No channel (off)"], ...d.channels.map(c => ["" + c.id, "#" + c.name])], st.channel_id || "");
          const role = select([["", "Nobody"], ...d.roles.filter(r => r.name !== "@everyone").map(r => ["" + r.id, r.name])], st.role_id || "");
          const picked = new Set(d.stores.filter(s => !st.stores.length || st.stores.includes(s.key)).map(s => s.key));
          const boxes = d.stores.map(x => { const c = h("input", { type: "checkbox", checked: picked.has(x.key) }); c.addEventListener("change", () => { c.checked ? picked.add(x.key) : picked.delete(x.key); }); return h("label", { class: "check" }, c, " ", x.name); });
          const adult = h("input", { type: "checkbox", checked: Boolean(st.adult) });
          const save = h("button", { class: "btn green", text: "Save" });
          save.addEventListener("click", () => busy(save, async () => {
            if (!picked.size) throw new Error("Keep at least one store ticked, or pick no channel to turn this off.");
            await api("/api/servers/bundles", { guild_id: g.id, channel_id: chan.value, role_id: role.value, stores: [...picked], adult: adult.checked });
            toast(chan.value ? "Saved. New bundles will be posted there." : "Saved. Bundle posts are off for this server.", "ok");
          }));
          holder.className = "";
          holder.replaceChildren(h("div", { class: "panel" }, h("h3", { text: "Game bundles" }),
            h("p", { class: "muted", text: "New bundles from Humble, Fanatical, IndieGala and Steam, posted once each in the channel you pick, with the games inside and when it ends. When a bundle ends, its post is grayed out." }),
            field("Channel", chan), field("Ping this role for new bundles", role),
            h("div", {}, h("label", { text: "Stores" }), h("div", { class: "checks" }, boxes)),
            h("div", {}, h("label", { class: "check" }, adult, " Include adult bundles"), h("p", { class: "muted small", text: "Off by default. Only turn this on if everyone in the server is 18 or older and the channel is marked age-restricted." })),
            h("div", { class: "row" }, save)));
        } catch (e) { holder.className = ""; holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
      })();
      return [holder];
    }

    function dropsPanel() {
      const holder = h("div", { class: "muted", text: "Loading…" });
      const reload = () => { const fresh = dropsPanel(); holder.replaceWith(...fresh); };
      (async () => {
        try {
          const d = await api("/api/servers/drops?guild=" + encodeURIComponent(g.id));
          const st = d.settings;
          const chan = select([["", "No channel (off)"], ...d.channels.map(c => ["" + c.id, "#" + c.name])], st.channel_id || "");
          const role = select([["", "Nobody"], ...d.roles.filter(r => r.name !== "@everyone").map(r => ["" + r.id, r.name])], st.role_id || "");
          const news = h("input", { type: "checkbox", checked: Boolean(st.news) });
          const save = h("button", { class: "btn green", text: "Save" });
          save.addEventListener("click", () => busy(save, async () => {
            await api("/api/servers/drops", { guild_id: g.id, channel_id: chan.value, role_id: role.value, news: news.checked });
            toast(chan.value ? "Saved." : "Saved. Promo drops are off for this server.", "ok");
          }));
          const f = { title: h("input", { type: "text", maxlength: "100", placeholder: "SteelSeries Game On key" }), code: h("input", { type: "text", maxlength: "120", placeholder: "Optional" }),
            url: h("input", { type: "text", maxlength: "300", placeholder: "https://… (optional)" }), source: h("input", { type: "text", maxlength: "60", placeholder: "SteelSeries" }),
            days: h("input", { type: "number", min: "1", max: "365", placeholder: "Days until it ends (optional)" }), note: h("input", { type: "text", maxlength: "300", placeholder: "Region, one per account…" }) };
          const add = h("button", { class: "btn blue", text: "Post it" });
          add.addEventListener("click", () => busy(add, async () => {
            await api("/api/servers/drops/add", { guild_id: g.id, title: f.title.value, code: f.code.value, url: f.url.value, source: f.source.value, days: f.days.value, note: f.note.value });
            toast("Added. It goes out in the channel in a moment.", "ok"); reload();
          }));
          const rows = d.drops.map(x => {
            const end = x.status === "active" ? h("button", { class: "btn red small", text: "Mark ended" }) : h("span", { class: "chip dim", text: "Ended" });
            if (x.status === "active") end.addEventListener("click", () => busy(end, async () => { await api("/api/servers/drops/end", { guild_id: g.id, id: x.id }); toast("Marked as ended.", "ok"); reload(); }));
            return h("div", { class: "rule" }, h("div", {}, h("strong", { text: x.title }), x.source ? h("span", { class: "muted", text: " · " + x.source }) : null,
              x.code ? h("div", {}, h("code", { class: "code-text", text: x.code })) : null,
              h("div", { class: "muted small", text: x.expiresAt ? "Ends " + new Date(x.expiresAt).toLocaleDateString() : "No end date" }), x.url ? ext(x.url, "Open link", "small") : null), end);
          });
          holder.className = "";
          holder.replaceChildren(
            h("div", { class: "panel" }, h("h3", { text: "Promo drops" }),
              h("p", { class: "muted", text: "Key giveaways from SteelSeries, NVIDIA and others. Add a code or a link and it is posted once in your promo channel, then grayed out when it ends." }),
              field("Channel", chan), field("Ping this role", role),
              h("label", { class: "check" }, news, " Also post news that mentions a giveaway or a code: NVIDIA, SteelSeries and games like Dead by Daylight (new ones only)"),
              h("div", { class: "row" }, save)),
            h("div", { class: "panel" }, h("h3", { text: "Add a drop" }), field("Title", f.title), field("Code", f.code), field("Link", f.url), field("From", f.source), field("Days until it ends", f.days), field("Note", f.note), h("div", { class: "row" }, add)),
            h("div", { class: "panel" }, h("h3", { text: "Your drops" }), rows.length ? h("div", {}, rows) : h("p", { class: "muted", text: "Nothing added yet." })),
            d.news.length ? h("div", { class: "panel" }, h("h3", { text: "Spotted in the news lately" }), h("div", {}, d.news.map(n => h("div", { class: "rule" }, h("div", {}, ext(n.url, n.title, ""), h("div", { class: "muted small", text: n.source }))))), h("p", { class: "muted small", text: "Only news that mentions a giveaway or a code shows up here." })) : null);
        } catch (e) { holder.className = ""; holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
      })();
      return [holder];
    }

    function show() {
      body.replaceChildren();
      if (current === "overview") body.append(...overview());
      else if (current === "alerts") body.append(...alertsPanel());
      else if (current === "list") { const into = h("div"); body.append(into); sharedList(g, into).catch(e => into.replaceChildren(h("div", { class: "notice warn", text: e.message }))); }
      else if (current === "board") { const into = h("div"); body.append(into); board(g, into).catch(e => into.replaceChildren(h("div", { class: "notice warn", text: e.message }))); }
      else if (current === "codes") body.append(...codesPanel(), ...bundlesPanel(), ...dropsPanel());
      else if (current === "stats") statsPanel(g, body);
      else if (current === "giveaways") { navigate("/giveaways"); }
    }
    show();
    app.replaceChildren(
      h("a", { class: "back", href: "#/servers", text: "← All servers" }),
      h("div", { class: "sv-hero" }, serverIcon(g, "sv-icon big"),
        h("div", {}, h("h1", { text: g.name }), h("div", { class: "sv-badges" }, g.manageable ? h("span", { class: "chip", text: "You manage this" }) : h("span", { class: "chip dim", text: "Member" }), botBadge(g)))),
      tabs, body);
  }
  root.ServerDetailUI = { view };
})(window);

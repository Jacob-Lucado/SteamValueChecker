// Steam Value Checker dashboard. All text is inserted with textContent, never innerHTML.
(() => {
  "use strict";

  const state = { cfg: null, me: null };
  const app = document.getElementById("app");

  // ---------- helpers ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "value" || k === "checked" || k === "disabled" || k === "selected") el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const safeHref = u => (/^https?:\/\//i.test(u) ? u : "#");
  const ext = (href, text, cls) => h("a", { href: safeHref(href), target: "_blank", rel: "noopener noreferrer", class: cls }, text);

  function money(n, cur) {
    if (n === null || n === undefined || Number.isNaN(n)) return "–";
    try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur || "USD" }).format(n); }
    catch { return Number(n).toFixed(2) + " " + cur; }
  }

  // Minimal, safe inline formatting for the help text: **bold**, `code`, links.
  function inline(text) {
    const out = [];
    const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)]+)/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      const t = m[0];
      if (t.startsWith("**")) out.push(h("strong", { text: t.slice(2, -2) }));
      else if (t.startsWith("`")) out.push(h("code", { text: t.slice(1, -1) }));
      else if (t.startsWith("[")) {
        const close = t.indexOf("](");
        out.push(ext(t.slice(close + 2, -1), t.slice(1, close)));
      } else out.push(ext(t, t));
      last = m.index + t.length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }
  const md = text => h("div", { class: "help" }, text.split("\n").map(line => (line.trim() ? h("p", {}, inline(line.replace(/^•\s*/, "• "))) : null)));

  function toast(msg, kind) {
    const t = h("div", { class: "toast " + (kind || ""), text: msg });
    document.getElementById("toasts").append(t);
    setTimeout(() => t.remove(), 6000);
  }

  async function api(path, body) {
    const opts = body === undefined
      ? { headers: { Accept: "application/json" } }
      : { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "dashboard" }, body: JSON.stringify(body) };
    let res;
    try { res = await fetch(path, opts); } catch { throw new Error("Could not reach the dashboard server."); }
    let data = {};
    try { data = await res.json(); } catch { /* not JSON */ }
    if (res.status === 401) { state.me = null; renderChrome(); }
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }

  // Runs an action with the button disabled; errors become toasts.
  async function busy(btn, fn) {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Working…";
    try { return await fn(); }
    catch (e) { toast(e.message, "error"); }
    finally { btn.disabled = false; btn.textContent = label; }
  }

  function field(label, control) { return h("div", {}, h("label", { text: label }), control); }
  function select(options, current) {
    const s = h("select");
    for (const [value, text] of options) s.append(h("option", { value, text, selected: value === current }));
    return s;
  }

  const fanaticalCard = () => state.cfg && h("a", { class: "card-link", href: safeHref(state.cfg.fanaticalUrl), target: "_blank", rel: "noopener noreferrer" },
    h("span", { class: "icon", text: "🔑" }),
    h("span", {}, h("strong", { text: "FanaticalGrabber on GitHub" }),
      h("span", { class: "muted", text: "The browser extension that reveals and exports your Fanatical keys. Its CSV, JSON, TXT and Markdown exports work with the Value Checker." })));

  // ---------- theme ----------
  function themeButton() {
    const btn = h("button", { class: "theme-btn", type: "button" });
    const paint = () => {
      const light = window.svcTheme && window.svcTheme.current() === "light";
      btn.textContent = light ? "☾" : "☀";
      btn.setAttribute("aria-label", light ? "Switch to dark theme" : "Switch to light theme");
      btn.title = btn.getAttribute("aria-label");
    };
    btn.addEventListener("click", () => { if (window.svcTheme) window.svcTheme.toggle(); paint(); });
    paint();
    return btn;
  }

  // ---------- chrome ----------
  const NAV = [["value", "Value Checker"], ["wishlist", "Wishlist"], ["alerts", "Alerts"], ["servers", "Servers"], ["mydata", "My Data"], ["help", "Help"]];
  const currentView = () => (location.hash.replace(/^#\/?/, "") || "").split("?")[0];

  function renderChrome() {
    const view = currentView();
    const nav = document.getElementById("nav");
    nav.replaceChildren(...NAV
      .filter(([id]) => state.me || id === "help")
      .map(([id, text]) => h("a", { href: "#/" + id, class: view === id ? "active" : "", text })));

    const acct = document.getElementById("account");
    const links = [state.cfg && ext(state.cfg.fanaticalUrl, "FanaticalGrabber ↗")].filter(Boolean);
    if (state.me) {
      acct.replaceChildren(...[...links,
        state.me.user.avatar && h("img", { class: "avatar", src: state.me.user.avatar, alt: "" }),
        h("span", { class: "who", text: state.me.user.username }),
        themeButton(),
        h("button", { class: "btn gray small", text: "Log out", onclick: async () => { try { await api("/auth/logout", {}); } catch {} state.me = null; location.hash = "#/"; boot(); } })].filter(Boolean));
    } else {
      acct.replaceChildren(...[...links, themeButton(), h("a", { class: "btn green", href: "/auth/login", text: "Sign in with Discord" })].filter(Boolean));
    }
    document.getElementById("footer-links").replaceChildren(
      ...(state.cfg ? [ext(state.cfg.fanaticalUrl, "FanaticalGrabber"), " · ", ext(state.cfg.repoUrl, "Source on GitHub")] : []));
  }

  // ---------- landing ----------
  function landing() {
    const failed = new URLSearchParams(location.search).get("error");
    app.replaceChildren(
      h("section", { class: "hero" },
        h("h1", { text: "What is your game library worth?" }),
        h("p", { text: "Price a list of games, keep a wishlist, and get told when something goes on sale. Everything the Discord bot does, in your browser." }),
        failed && h("div", { class: "notice warn", text: "Sign-in did not work. Please try again." }),
        h("a", { class: "btn green", href: "/auth/login", text: "Sign in with Discord" })),
      h("div", { class: "grid two" },
        h("div", { class: "panel" }, h("h3", { text: "Value Checker" }), h("p", { text: "MSRP, the current Steam price, the cheapest price right now across stores, and what you saved against what you paid." })),
        h("div", { class: "panel" }, h("h3", { text: "Wishlist and alerts" }), h("p", { text: "Import your public Steam wishlist and choose when to be alerted: any sale, a percentage off, a price, or an all-time low." }))),
      fanaticalCard(),
      h("p", { class: "muted small", text: "Signing in with Discord shares only your name, avatar and server list with this dashboard. No passwords and no game keys are ever requested." }));
  }

  // ---------- value checker ----------
  function valueView() {
    const titles = h("textarea", { placeholder: "Hades; Celeste; Hollow Knight\n(or one per line)", maxlength: "20000" });
    const file = h("input", { type: "file", accept: ".csv,.json,.txt,.md" });
    const paid = h("input", { type: "number", min: "0", max: "1000000", step: "0.01", placeholder: "Total you paid (optional)" });
    const region = select(state.cfg.regions.map(r => [r.value, r.name]), state.me.settings.region);
    const stores = select([["all", "All tracked stores, including key sites"], ["major", "Major stores only"]], state.me.settings.stores);
    const sort = select([["input", "As entered"], ["name", "Name (A-Z)"], ["msrp", "MSRP (high to low)"], ["cheapest", "Cheapest price (high to low)"]], "input");
    const results = h("div");

    const run = h("button", { class: "btn green", text: "Check value", onclick: () => busy(run, async () => {
      let upload = null;
      const f = file.files[0];
      if (f) {
        if (f.size > state.cfg.maxUploadChars) throw new Error("That file is too large (200 KB max).");
        upload = { name: f.name, text: await f.text() };
      }
      const data = await api("/api/value", {
        titles: titles.value, file: upload, paid: paid.value, region: region.value, stores: stores.value, sort: sort.value
      });
      renderValue(results, data);
    }) });

    app.replaceChildren(
      pageHead("Value Checker", "Price a game library: MSRP, Steam, cheapest right now, and what you saved."),
      h("div", { class: "panel" },
        field("Game titles", titles),
        h("div", { class: "row" }, field("Or upload a FanaticalGrabber export (.csv .json .txt .md)", file), field("Total paid", paid)),
        h("div", { class: "row" }, field("Region", region), field("Stores for “cheapest”", stores), field("Sort", sort)),
        h("p", { class: "muted small", text: "Never paste game keys. Anything that looks like a key is ignored." }),
        run),
      fanaticalCard(),
      results);
  }

  function renderValue(into, d) {
    const t = d.totals, cur = t.currency;
    const tile = (k, v, s) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: v }), s && h("div", { class: "s", text: s }));
    const blocks = [
      ...d.notes.map(n => h("div", { class: "notice warn", text: n })),
      h("div", { class: "grid four" },
        tile("MSRP", money(t.msrp, cur), `${t.found}/${t.count} games found`),
        tile("Steam now", money(t.steam, cur), t.steamCount < t.found ? `${t.steamCount} on Steam` : ""),
        tile("Cheapest now", money(t.best, cur), d.majorOnly ? "major stores" : "all tracked stores"),
        t.atlCount > 0 && tile("All-time low", money(t.atl, cur)))
    ];

    if (d.savings) {
      const sv = d.savings;
      blocks.push(h("div", { class: "panel" },
        h("h3", { text: "Paid vs value" }),
        h("div", { class: "grid four" },
          tile("You paid", money(sv.paid, cur), sv.perGame !== null ? money(sv.perGame, cur) + " per game" : ""),
          ...sv.lines.map(l => tile("vs " + l.label, (l.diff >= 0 ? "Saved " : "Extra ") + money(Math.abs(l.diff), cur), Math.round(Math.abs(l.pct)) + "%" + (l.diff >= 0 ? "" : " more")))),
        sv.verdict && h("div", { class: "notice", text: sv.verdict }),
        sv.biggest.length > 0 && h("p", {}, h("strong", { text: "Best deals: " }), sv.biggest.map(r => `${r.title} (paid ${money(r.paid, cur)}, MSRP ${money(r.msrp, cur)})`).join("; ")),
        sv.overpaid.length > 0 && h("p", {}, h("strong", { text: "Cheaper elsewhere now: " }), sv.overpaid.slice(0, 5).map(r => `${r.title} (paid ${money(r.paid, cur)}, now ${money(r.best.price, cur)} at ${r.best.shop})`).join("; "))));
    }

    const showPaid = d.rows.some(r => r.paid !== null);
    const head = ["Game", "MSRP", "Steam", "Cheapest", "Store", "All-time low", showPaid && "Paid"].filter(Boolean);
    const body = d.rows.map(r => {
      if (!r.found) return h("tr", { class: "missing" }, h("td", { text: r.title }), h("td", { colspan: head.length - 1, text: "not found" }));
      return h("tr", {},
        h("td", { class: "title-cell", title: r.approx ? "Closest match: " + r.matched : "" }, (r.approx ? "~ " : "") + r.title),
        h("td", { class: "num", text: money(r.msrp, cur) }),
        h("td", { class: "num" }, r.cut > 0 && h("span", { class: "badge", text: "-" + r.cut + "%" }), " ", money(r.steam, cur)),
        h("td", { class: "num now", text: money(r.best && r.best.price, cur) }),
        h("td", { text: r.best ? r.best.shop : "–" }),
        h("td", { class: "num", text: money(r.atl, cur) }),
        showPaid && h("td", { class: "num", text: money(r.paid, cur) }));
    });
    const csv = h("button", { class: "btn blue small", text: "Download CSV", onclick: () => {
      const url = URL.createObjectURL(new Blob([d.csv], { type: "text/csv" }));
      const a = h("a", { href: url, download: "steam-value.csv" });
      document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } });
    blocks.push(h("div", { class: "panel" },
      h("div", { class: "page-head" }, h("h3", { text: `Results (${d.region})` }), csv),
      h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, head.map((c, i) => h("th", { class: i > 0 && c !== "Store" ? "num" : "", text: c })))), h("tbody", {}, body))),
      h("p", { class: "muted small", text: "~ = approximate title match. Prices by IsThereAnyDeal." })));
    into.replaceChildren(...blocks);
  }

  const pageHead = (title, sub, right) => h("div", { class: "page-head" }, h("div", {}, h("h1", { text: title }), sub && h("p", { class: "muted", text: sub })), right);

  // ---------- wishlist ----------
  function ruleControl(init, onSave, label) {
    const type = select(state.cfg.alertTypes.map(a => [a.value, a.name]), init.type);
    const value = h("input", { type: "number", step: "0.01", min: "0", placeholder: "value", value: init.value ?? "" });
    const sync = () => { value.style.display = type.value === "percent" || type.value === "price" ? "" : "none"; value.placeholder = type.value === "percent" ? "% off" : "price"; };
    type.addEventListener("change", sync); sync();
    const save = h("button", { class: "btn gray small", text: label || "Save rule" });
    save.addEventListener("click", () => busy(save, () => onSave(type.value, value.value === "" ? null : Number(value.value))));
    return [type, value, save];
  }

  async function wishlistView() {
    const list = h("div", { class: "muted", text: "Loading prices…" });
    const profile = h("input", { type: "text", placeholder: "Steam profile link, custom name or SteamID64", maxlength: "200" });
    const importBtn = h("button", { class: "btn green", text: "Import", onclick: () => busy(importBtn, async () => {
      const r = await api("/api/wishlist/import", { profile: profile.value });
      const parts = [`Imported ${r.added} new game${r.added === 1 ? "" : "s"} (${r.existing} already listed).`];
      if (r.pruned) parts.push(`Removed ${r.pruned} that left your Steam wishlist.`);
      if (r.unmatched) parts.push(`${r.unmatched} could not be matched.`);
      if (r.truncated) parts.push("Only the first 150 games were read.");
      if (r.skippedForLimit) parts.push(`List is full, ${r.skippedForLimit} skipped.`);
      toast(parts.join(" "), "ok");
      state.me.games += r.added;
      loadList();
    }) });

    const title = h("input", { type: "text", placeholder: "Game title", maxlength: "100" });
    const addType = select(state.cfg.alertTypes.map(a => [a.value, a.name]), "any");
    const addValue = h("input", { type: "number", step: "0.01", min: "0", placeholder: "value" });
    const addValueField = field("Value", addValue);
    const syncAdd = () => { addValueField.style.display = addType.value === "percent" || addType.value === "price" ? "" : "none"; addValue.placeholder = addType.value === "percent" ? "% off" : "price"; };
    addType.addEventListener("change", syncAdd); syncAdd();
    const addBtn = h("button", { class: "btn blue", text: "Add game", onclick: () => busy(addBtn, async () => {
      const r = await api("/api/wishlist/add", { title: title.value, type: addType.value, value: addValue.value === "" ? null : Number(addValue.value) });
      toast(`Added ${r.name}${r.approx ? " (closest match)" : ""}. Alert: ${r.trigger}.`, "ok");
      title.value = "";
      loadList();
    }) });

    async function loadList() {
      try {
        const data = await api("/api/wishlist");
        if (!data.rows.length) { list.replaceChildren(h("div", { class: "empty", text: "Your wishlist is empty. Import your Steam wishlist or add a game above." })); list.className = ""; return; }
        list.className = "";
        const cur = data.currency;
        const all = h("div", { class: "panel" }, h("h3", { text: "Alert rule for every game" }),
          h("div", { class: "rule inline" }, ...ruleControl({ type: "any" }, async (type, value) => {
            const r = await api("/api/wishlist/alert", { type, value });
            toast(`${r.updated} games will now alert on: ${r.label}.`, "ok");
            loadList();
          }, "Apply to all")));
        list.replaceChildren(all, ...data.rows.map(r => wishRow(r, cur, loadList)));
      } catch (e) {
        list.className = "";
        list.replaceChildren(h("div", { class: "notice warn", text: e.message }));
      }
    }

    app.replaceChildren(
      pageHead("Wishlist", "Sales first. You are alerted according to each game's rule."),
      h("div", { class: "grid two" },
        h("div", { class: "panel" }, h("h3", { text: "Import from Steam" }), field("Profile", profile), h("p", { class: "muted small", text: "Your wishlist must be public (Steam Profile > Edit Profile > Privacy Settings > Game details). No login needed. Run it again to sync." }), importBtn),
        h("div", { class: "panel" }, h("h3", { text: "Add a game" }), field("Title", title), h("div", { class: "row" }, field("Alert me on", addType), addValueField), h("p", {}), addBtn)),
      list);
    loadList();
  }

  function wishRow(r, cur, reload) {
    const best = r.best;
    const sale = r.discount > 0;
    const pct = Math.round(r.discount * 100);
    const remove = h("button", { class: "btn red small", text: "Remove" });
    remove.addEventListener("click", () => busy(remove, async () => { await api("/api/wishlist/remove", { itad_id: r.itad_id }); state.me.games--; reload(); }));
    return h("div", { class: "wish" + (sale ? " sale" : "") },
      h("div", {}, h("div", { class: "name", text: r.title }), h("div", { class: "meta", text: `${r.source === "steam" ? "From Steam" : "Added by hand"} · alert: ${r.alert}${r.atl !== null ? " · all-time low " + money(r.atl, cur) : ""}` })),
      h("div", { class: "price-box" },
        h("span", { class: "badge" + (sale ? "" : " none"), text: sale ? "-" + pct + "%" : "–" }),
        sale && r.regular !== null && h("span", { class: "was", text: money(r.regular, cur) }),
        h("span", { class: "now", text: best ? money(best.price, cur) : "no price" }),
        best && h("span", { class: "muted small", text: best.shop })),
      h("div", { class: "rule" }, ...ruleControl({ type: r.trigger_type, value: r.trigger_value }, async (type, value) => {
        await api("/api/wishlist/alert", { itad_id: r.itad_id, type, value });
        toast("Rule saved.", "ok"); reload();
      }), remove));
  }

  // ---------- alerts ----------
  function alertsView() {
    const s = state.me.settings;
    const dm = h("input", { type: "radio", name: "delivery", value: "dm", checked: s.delivery === "dm" });
    const ch = h("input", { type: "radio", name: "delivery", value: "channel", checked: s.delivery === "channel" });
    const paused = h("input", { type: "checkbox", checked: s.paused });
    const region = select(state.cfg.regions.map(r => [r.value, r.name]), s.region);
    const stores = select([["major", "Major stores only (recommended)"], ["all", "All tracked stores, including key sites"]], s.stores);
    const withChannel = state.me.servers.filter(g => g.alertChannel);
    const server = select([["", "None"], ...state.me.servers.map(g => [g.id, g.name + (g.alertChannel ? "" : " (no alert channel)")])],
      s.guild_id || (withChannel.length === 1 ? withChannel[0].id : ""));
    const save = h("button", { class: "btn green", text: "Save settings", onclick: () => busy(save, async () => {
      const r = await api("/api/settings", {
        delivery: ch.checked ? "channel" : "dm", paused: paused.checked, region: region.value, stores: stores.value, guild_id: server.value || null
      });
      state.me.settings = r.settings;
      toast("Settings saved.", "ok");
    }) });
    app.replaceChildren(
      pageHead("Alerts", "How and where you hear about sales."),
      h("div", { class: "panel" },
        h("h3", { text: "Delivery" }),
        h("label", { class: "check" }, dm, "Direct message. If it cannot be delivered, the server alert channel is used as a fallback."),
        h("label", { class: "check" }, ch, "Server alert channel only. You are mentioned there, and everyone who can see the channel sees the game name."),
        field("Server for the alert channel", server), h("p", { class: "muted small", text: "Alerts that cannot be sent by DM go to this server's alert channel." }),
        h("label", { class: "check" }, paused, "Pause all alerts (your wishlist is kept)")),
      h("div", { class: "panel" },
        h("h3", { text: "Prices" }),
        h("div", { class: "row" }, field("Region", region), field("Stores that count", stores))),
      h("p", { class: "muted", text: `Watching ${state.me.games} game${state.me.games === 1 ? "" : "s"}. Prices are checked about once an hour.` }),
      save);
  }

  // ---------- servers ----------
  function serversView() {
    const panels = state.me.servers.map(g => {
      const body = h("div", { class: "body" });
      const status = h("span", { class: "muted", text: g.alertChannel ? "Alert channel is set." : "No alert channel yet." });
      body.append(h("strong", { text: g.name }), " ", g.manageable && h("span", { class: "tag", text: "You manage this" }), h("div", {}, status));
      if (g.manageable) {
        const holder = h("div");
        const manage = h("button", { class: "btn blue small", text: "Choose channel" });
        manage.addEventListener("click", () => busy(manage, async () => {
          const data = await api("/api/servers/channels?guild=" + encodeURIComponent(g.id));
          const pick = select(data.channels.map(c => ["" + c.id, "#" + c.name]), data.current || "");
          const set = h("button", { class: "btn green small", text: "Set channel" });
          set.addEventListener("click", () => busy(set, async () => {
            const r = await api("/api/servers/channel", { guild_id: g.id, channel_id: pick.value });
            g.alertChannel = r.channel.id; status.textContent = "Alert channel is #" + r.channel.name + ".";
            toast("Alert channel set. A confirmation was posted there.", "ok");
          }));
          const clear = h("button", { class: "btn red small", text: "Clear" });
          clear.addEventListener("click", () => busy(clear, async () => {
            await api("/api/servers/channel", { guild_id: g.id, clear: true });
            g.alertChannel = null; status.textContent = "No alert channel yet."; toast("Alert channel removed.", "ok");
          }));
          holder.replaceChildren(h("div", { class: "row" }, pick, h("span", { class: "shrink" }, set), h("span", { class: "shrink" }, clear)));
          manage.remove();
        }));
        body.append(holder, manage);
      }
      return h("div", { class: "server" }, g.icon ? h("img", { src: g.icon, alt: "" }) : h("div", { class: "noicon" }), body);
    });
    app.replaceChildren(
      pageHead("Servers", "Alert channels are used when a DM cannot be delivered, or when a member chooses channel delivery.", state.cfg.inviteUrl && ext(state.cfg.inviteUrl, "Invite the bot", "btn blue")),
      h("div", { class: "panel" }, panels.length ? panels : h("div", { class: "empty", text: "None of your servers manage an alert channel yet. Only people with Manage Server can set one." })),
      h("div", { class: "notice", text: "Setting a channel posts a short confirmation there, which also checks that the bot can post. If that fails, give the bot View Channel, Send Messages and Embed Links in the channel." }));
  }

  // ---------- my data ----------
  function myDataView() {
    const confirm = h("input", { type: "text", placeholder: "Type DELETE", autocomplete: "off" });
    const del = h("button", { class: "btn red", text: "Delete everything", onclick: () => busy(del, async () => {
      await api("/api/mydata/delete", { confirm: confirm.value });
      toast("Deleted. The bot no longer stores anything about you.", "ok");
      state.me.games = 0;
      boot();
    }) });
    app.replaceChildren(
      pageHead("My Data", "Everything the bot stores about you, and control over it."),
      h("div", { class: "panel" }, h("h3", { text: "Stored" }),
        h("p", { text: "Your Discord ID, your wishlist and alert rules, your settings, the server you last used, and your public Steam ID if you imported a wishlist. The Value Checker stores nothing." }),
        h("a", { class: "btn blue", href: "/api/mydata/download", text: "Download my data (JSON)" })),
      h("div", { class: "panel" }, h("h3", { text: "Delete" }),
        h("p", { text: "This deletes your wishlist, alert settings and Steam profile ID. It cannot be undone." }),
        field("Confirm", confirm), h("p"), del));
  }

  // ---------- help ----------
  function helpView() {
    app.replaceChildren(
      pageHead("Help", "The dashboard does everything the Discord commands do."),
      h("div", { class: "panel" }, h("h3", { text: "Using the bot" }), md(state.cfg.help)),
      h("div", { class: "panel" }, h("h3", { text: "About" }), md(state.cfg.about)),
      h("div", { class: "panel" }, h("h3", { text: "Privacy" }), md(state.cfg.privacy)),
      fanaticalCard());
  }

  // ---------- routing ----------
  const VIEWS = { value: valueView, wishlist: wishlistView, alerts: alertsView, servers: serversView, mydata: myDataView, help: helpView };

  function route() {
    renderChrome();
    const view = currentView();
    if (!state.me && view !== "help") return landing();
    (VIEWS[view] || (state.me ? valueView : landing))();
    window.scrollTo(0, 0);
  }

  async function boot() {
    try {
      if (!state.cfg) state.cfg = await api("/api/config");
      try { state.me = await api("/api/me"); } catch { state.me = null; }
    } catch (e) {
      app.replaceChildren(h("div", { class: "notice warn", text: e.message }));
      return;
    }
    route();
  }

  window.addEventListener("hashchange", route);
  boot();
})();

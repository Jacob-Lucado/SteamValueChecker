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
    h("span", {}, h("strong", { text: "FanaticalGrabber" }),
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
  // Menu groups: a group with one visible page becomes a plain link, otherwise a dropdown.
  const NAV = [
    { id: "home", label: "Home", pages: [["home", "Home"]] },
    { id: "games", label: "Games", pages: [["value", "Value Checker"], ["wishlist", "Wishlist"], ["library", "Library"]] },
    { id: "servers", label: "Servers", pages: [["servers", "Servers"], ["setup", "Setup"], ["giveaways", "Giveaways"]] },
    { id: "account", label: "Account", pages: [["notifications", "Notifications"], ["alerts", "Alert settings"], ["mydata", "My Data"]] },
    { id: "help", label: "Help", pages: [["support", "Support"], ["help", "Help"], ["status", "Status"], ["changelog", "What's new"], ["about", "About"]] },
    { id: "admin", label: "Admin", pages: [["admin", "Admin"]] }
  ];
  const PUBLIC_PAGES = new Set(["home", "help", "about", "status"]);
  function pageVisible(id) {
    const me = state.me;
    if (id === "admin") return Boolean(me && me.isOwner);
    if (id === "giveaways") return Boolean(me && me.giveaways && me.servers.some(g => g.manageable));
    if (id === "setup") return Boolean(me && me.servers.some(g => g.manageable));
    return Boolean(me) || PUBLIC_PAGES.has(id);
  }
  let openMenu = null;
  function closeMenu() { if (openMenu) { openMenu.btn.setAttribute("aria-expanded", "false"); openMenu.menu.hidden = true; openMenu = null; } }
  document.addEventListener("click", e => { if (openMenu && !openMenu.wrap.contains(e.target)) closeMenu(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && openMenu) { const b = openMenu.btn; closeMenu(); b.focus(); } });
  window.addEventListener("hashchange", closeMenu);
  const currentView = () => (location.hash.replace(/^#\/?/, "") || "").split("?")[0].split("/")[0];
  const currentParam = () => (location.hash.replace(/^#\/?/, "") || "").split("?")[0].split("/")[1] || null;

  const NAV_I18N = {
    es: { games: "Juegos", account: "Cuenta", setup: "Configuración", wishlist: "Lista de deseos", library: "Biblioteca", alerts: "Alertas", support: "Soporte", notifications: "Avisos", servers: "Servidores", help: "Ayuda", mydata: "Mis datos" },
    fr: { games: "Jeux", account: "Compte", setup: "Configuration", wishlist: "Liste de souhaits", library: "Bibliothèque", alerts: "Alertes", support: "Assistance", notifications: "Notifications", servers: "Serveurs", help: "Aide", mydata: "Mes données" }
  };
  const navText = (id, text) => (state.me && NAV_I18N[state.me.settings.lang] && NAV_I18N[state.me.settings.lang][id]) || text;

  function renderChrome() {
    const view = currentView();
    const nav = document.getElementById("nav");
    const badge = n => (n ? h("span", { class: "badge-count", text: String(Math.min(99, n)) }) : null);
    closeMenu();
    nav.replaceChildren(...NAV.map(group => {
      const pages = group.pages.filter(([id]) => pageVisible(id));
      if (!pages.length) return null;
      const unread = group.id === "account" && state.me ? state.me.unread : 0;
      if (pages.length === 1) {
        const [id, text] = pages[0];
        return h("a", { href: "#/" + id, class: view === id ? "active" : "", text: navText(id, text) });
      }
      const active = pages.some(([id]) => id === view);
      const menu = h("div", { class: "menu", role: "menu", hidden: true },
        ...pages.map(([id, text]) => h("a", { href: "#/" + id, role: "menuitem", class: view === id ? "active" : "" }, navText(id, text), id === "notifications" ? badge(state.me && state.me.unread) : null)));
      const btn = h("button", { type: "button", class: "nav-btn" + (active ? " active" : ""), "aria-haspopup": "true", "aria-expanded": "false" }, navText(group.id, group.label), " ▾", badge(unread));
      const wrap = h("div", { class: "nav-group" }, btn, menu);
      btn.addEventListener("click", e => {
        e.stopPropagation();
        const wasOpen = openMenu && openMenu.btn === btn;
        closeMenu();
        if (!wasOpen) { menu.hidden = false; btn.setAttribute("aria-expanded", "true"); openMenu = { wrap, btn, menu }; }
      });
      return wrap;
    }).filter(Boolean));

    const acct = document.getElementById("account");
    const links = [state.cfg && ext(state.cfg.fanaticalUrl, "FanaticalGrabber ↗")].filter(Boolean);
    if (state.me) {
      acct.replaceChildren(...[...links,
        state.me.user.avatar && h("img", { class: "avatar", src: state.me.user.avatar, alt: "" }),
        h("span", { class: "who", text: state.me.user.username }),
        h("button", { class: "theme-btn", type: "button", text: "🔍", title: "Search (press /)", "aria-label": "Search", onclick: openSearch }),
        contrastButton(), themeButton(),
        h("button", { class: "btn gray small", text: "Log out", onclick: async () => { try { await api("/auth/logout", {}); } catch {} state.me = null; location.hash = "#/"; boot(); } })].filter(Boolean));
    } else {
      acct.replaceChildren(...[...links, themeButton(), h("a", { class: "btn green", href: "/auth/login", text: "Sign in with Discord" })].filter(Boolean));
    }
    const cr = state.creator;
    document.getElementById("footer-links").replaceChildren(
      ...(cr ? [h("a", { class: "copyright", href: safeHref(cr.url), target: "_blank", rel: "noopener noreferrer" },
        h("img", { src: "/creator.png", alt: "", width: "22", height: "22" }), `© ${new Date().getFullYear()} ${cr.name}`)] : []));
  }

  // ---------- landing ----------
  function landing() {
    const failed = new URLSearchParams(location.search).get("error");
    const ab = state.about;
    const n = v => (v === null || v === undefined ? null : Number(v).toLocaleString());
    const invite = state.cfg && state.cfg.inviteUrl;
    const cta = (extra = "") => h("div", { class: "lp-cta " + extra },
      invite && ext(invite, "Add to a server", "btn green big"),
      state.cfg && state.cfg.userInstallUrl && ext(state.cfg.userInstallUrl, "Add to your account", "btn blue big"),
      state.me ? h("a", { class: "btn blue big", href: "#/value", text: "Open the dashboard" }) : h("a", { class: "btn blue big", href: "/auth/login", text: "Sign in with Discord" }));

    // A small mock of what a sale alert looks like in Discord.
    const mock = h("div", { class: "dc-card", "aria-hidden": "true" },
      h("div", { class: "dc-bot" }, h("img", { src: "/logo.png", alt: "", width: "36", height: "36" }), h("b", { text: "Steam Value Checker" }), h("span", { class: "dc-tag", text: "APP" })),
      h("div", { class: "dc-embed" },
        h("div", { class: "dc-title", text: "Wanderstop is 61% off" }),
        h("div", { class: "dc-line", text: "🏆 All-time low" }),
        h("div", { class: "dc-line", text: "$9.87 at Fanatical (you save $15.12)" }),
        h("div", { class: "dc-fields" }, h("span", {}, h("b", { text: "Regular" }), "$24.99"), h("span", {}, h("b", { text: "Discount" }), "61% off"), h("span", {}, h("b", { text: "All-time low" }), "$9.83")),
        h("div", { class: "dc-art", text: "game art" })),
      h("div", { class: "dc-buttons" }, h("span", { class: "dc-btn link", text: "View deal at Fanatical" }), h("span", { class: "dc-btn link", text: "Steam page" }), h("span", { class: "dc-btn link", text: "Price history" }), h("span", { class: "dc-btn", text: "Stop watching" })));

    const feature = (icon, title, text) => h("div", { class: "lp-feature" }, h("div", { class: "lp-icon", text: icon }), h("h3", { text: title }), h("p", { text }));
    const step = (num, title, text) => h("div", { class: "lp-step" }, h("div", { class: "lp-num", text: num }), h("h3", { text: title }), h("p", { text }));
    const stat = (label, value) => value && h("div", { class: "lp-stat" }, h("div", { class: "v", text: value }), h("div", { class: "k", text: label }));

    app.replaceChildren(...[
      state.me && newsBanner(),
      state.me && h("section", { class: "lp-setup" }, setupCard()),
      h("section", { class: "lp-hero" },
        h("div", { class: "lp-hero-text" },
          failed && h("div", { class: "notice warn", text: "Sign-in did not work. Please try again." }),
          h("div", { class: "lp-kicker", text: "Free Discord bot for PC gamers" }),
          h("h1", { text: "Know what your games are worth. Never miss a sale." }),
          h("p", { class: "lp-sub", text: "Price your whole library, watch your wishlist for deals, get told when games are free, and run key giveaways in your server. All from Discord, with a dashboard that does it all too." }),
          cta(),
          h("p", { class: "muted small", text: "No passwords, no game keys, no charge. Sign-in shares only your name, avatar and server list." })),
        h("div", { class: "lp-hero-art" }, mock)),

      ab && (n(ab.servers) || n(ab.gamesWatched)) ? h("section", { class: "lp-stats" },
        stat("Servers", n(ab.servers)), stat("Games watched", n(ab.gamesWatched)), stat("Alerts in the last 24h", n(ab.alerts24h)), stat("Giveaway keys redeemed", n(ab.redeemed))) : null,

      h("section", { class: "lp-section" },
        h("h2", { text: "Everything a game buyer needs" }),
        h("div", { class: "lp-grid" },
          feature("💸", "Library value", "MSRP, the current Steam price, the cheapest price right now across stores, and how much you really saved against what you paid."),
          feature("🔔", "Wishlist sale alerts", "Import your public Steam wishlist. Choose any sale, a percent off, a price, or an all-time low. Alerts come with game art and a deal verdict."),
          feature("🎁", "Free game alerts", "Hear when a game is free on Steam, Epic, GOG and more, with one-click Claim buttons. Or run /freegames any time."),
          feature("🏆", "Key giveaways", "Server owners run giveaways with many keys, custom art, GIFs or video. Winners claim by button, confirm it worked, and a vouch is posted."),
          feature("👥", "Server tools", "A shared server wishlist with votes, an opt-in savings leaderboard, and group pings when several members want the same deal."),
          feature("📊", "A full dashboard", "Everything the commands do, in your browser: charts, price history, bulk actions and giveaway management."))),

      h("section", { class: "lp-section" },
        h("h2", { text: "Up and running in a minute" }),
        h("div", { class: "lp-grid three" },
          step("1", "Add the bot", "Invite it to your server. It only asks for permission to read, send messages and embed links."),
          step("2", "Bring your games", "Import your Steam wishlist, upload a FanaticalGrabber export, or add games by name."),
          step("3", "Get the good stuff", "Sale alerts in your DMs or a server channel, free game alerts, and giveaways your community will love."))),

      h("section", { class: "lp-section lp-split" },
        h("div", {},
          h("h2", { text: "Giveaways people trust" }),
          h("p", { class: "lp-sub", text: "Prize keys are encrypted the moment they are saved and sent only to the winner. When the winner confirms the key worked, it is wiped and a public vouch goes up automatically." }),
          h("ul", { class: "lp-list" },
            h("li", { text: "Add many keys to one giveaway, grouped neatly on the post" }),
            h("li", { text: "Winner presses Claim key. If DMs are closed, they get the key privately in the channel" }),
            h("li", { text: "Unclaimed prizes are redrawn. Unused keys come back to you" }),
            h("li", { text: "Custom art, GIFs or video, role requirements, bonus entries and more" }))),
        h("div", { class: "lp-flow" },
          ...[["🎉", "Giveaway ends", "Winners are drawn and announced"], ["🔑", "Claim key", "The key arrives by DM"], ["✅", "Confirm it worked", "One button for the winner"], ["📣", "Vouch posted", "Automatic, in your vouches channel"]]
            .map(([i, t, s]) => h("div", { class: "lp-flow-step" }, h("span", { class: "lp-flow-icon", text: i }), h("div", {}, h("b", { text: t }), h("div", { class: "muted small", text: s })))))),

      fanaticalCard(),

      h("section", { class: "lp-section lp-trust" },
        h("h2", { text: "Built to respect your data" }),
        h("div", { class: "lp-grid three" },
          feature("🔒", "No logins, ever", "The bot never asks for Steam, Fanatical or store passwords, and ignores anything that looks like a key in chat."),
          feature("🧾", "Only what it needs", "Game titles go to IsThereAnyDeal for prices. Nothing else leaves the bot."),
          feature("🗑️", "Yours to delete", "Export or delete everything stored about you with /mydata, or from the dashboard."))),

      h("section", { class: "lp-final" },
        h("h2", { text: "Ready to find your next deal?" }),
        cta("center"))].filter(Boolean));
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
    const toLib = h("button", { class: "btn gray small", text: "Add found games to my library", onclick: () => busy(toLib, async () => {
      const entries = d.rows.filter(r => r.found).map(r => ({ title: r.matched || r.title, paid: r.paid }));
      const r = await api("/api/library/import", { entries });
      toast(`Library: added ${r.added}, updated ${r.updated}.`, "ok");
      state.me.library = (state.me.library || 0) + r.added;
    }) });
    blocks.push(h("div", { class: "panel" },
      h("div", { class: "page-head" }, h("h3", { text: `Results (${d.region})` }), h("div", { class: "actions" }, toLib, csv)),
      h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, head.map((c, i) => h("th", { class: i > 0 && c !== "Store" ? "num" : "", text: c })))), h("tbody", {}, body))),
      h("p", { class: "muted small", text: "~ = approximate title match. Prices by IsThereAnyDeal." })));
    into.replaceChildren(...blocks);
  }

  const pageHead = (title, sub, right) => h("div", { class: "page-head" }, h("div", {}, h("h1", { text: title }), sub && h("p", { class: "muted", text: sub })), right);


  // ---------- charts (inline SVG, drawn with the DOM so nothing is parsed as HTML) ----------
  const SVGNS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs, ...kids) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    for (const kid of kids) if (kid) el.append(kid);
    return el;
  }
  const shortDate = t => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });

  /**
   * Line chart. series: [{ name, cls, points: [{ x, y }] }] (x = ms). One y axis, starts at zero for money.
   * Two or more series get a legend. Hover or touch shows the nearest point of every series.
   */
  function lineChart(series, { format, label }) {
    const W = 640, H = 240, L = 54, R = 14, T = 12, B = 28;
    const pts = series.flatMap(s => s.points);
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs) === x0 ? x0 + 1 : Math.max(...xs);
    // round the top of the axis to a tidy number so the ticks read as 0, 5, 10 and not 4.86, 9.72
    const rough = Math.max(...ys, 1) * 1.05 / 4, mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(v => v >= rough);
    const yMax = step * 4;
    const X = x => L + ((x - x0) / (x1 - x0)) * (W - L - R);
    const Y = y => T + (1 - y / yMax) * (H - T - B);
    const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": label });
    for (let i = 0; i <= 4; i++) {
      const v = (yMax / 4) * i, y = Y(v);
      root.append(svg("line", { x1: L, x2: W - R, y1: y, y2: y, class: "grid" }));
      const t = svg("text", { x: L - 8, y: y + 4, class: "axis", "text-anchor": "end" }); t.textContent = format(v); root.append(t);
    }
    [0, 0.5, 1].forEach(f => {
      const t = svg("text", { x: L + f * (W - L - R), y: H - 8, class: "axis", "text-anchor": f === 0 ? "start" : f === 1 ? "end" : "middle" });
      t.textContent = shortDate(x0 + f * (x1 - x0)); root.append(t);
    });
    for (const s of series) {
      if (s.points.length === 1) {
        root.append(svg("circle", { cx: X(s.points[0].x), cy: Y(s.points[0].y), r: 4, class: "dot " + s.cls }));
      } else {
        root.append(svg("polyline", { points: s.points.map(p => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" "), class: "line " + s.cls, fill: "none" }));
      }
    }
    const cross = svg("line", { y1: T, y2: H - B, class: "cross", visibility: "hidden" });
    root.append(cross);
    const markers = series.map(s => svg("circle", { r: 4.5, class: "dot " + s.cls, visibility: "hidden" }));
    markers.forEach(m => root.append(m));
    const tip = h("div", { class: "tip", hidden: true });
    const hit = svg("rect", { x: L, y: T, width: W - L - R, height: H - T - B, fill: "transparent" });
    const nearest = (s, x) => s.points.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a));
    const show = ev => {
      const box = root.getBoundingClientRect();
      const cx = ((ev.clientX - box.left) / box.width) * W;
      const x = x0 + ((cx - L) / (W - L - R)) * (x1 - x0);
      const hits = series.map(s => nearest(s, x));
      const ref = hits[0];
      cross.setAttribute("x1", X(ref.x)); cross.setAttribute("x2", X(ref.x)); cross.setAttribute("visibility", "visible");
      hits.forEach((p, i) => { markers[i].setAttribute("cx", X(p.x)); markers[i].setAttribute("cy", Y(p.y)); markers[i].setAttribute("visibility", "visible"); });
      tip.hidden = false;
      tip.replaceChildren(h("strong", { text: shortDate(ref.x) }), ...series.map((s, i) => h("div", { text: `${s.name}: ${format(hits[i].y)}` })));
      const frac = X(ref.x) / W;
      tip.className = "tip " + (frac > 0.6 ? "left" : "right");
      tip.dataset.x = String(Math.round(frac * 100));
    };
    const hide = () => { cross.setAttribute("visibility", "hidden"); markers.forEach(m => m.setAttribute("visibility", "hidden")); tip.hidden = true; };
    hit.addEventListener("pointermove", show); hit.addEventListener("pointerleave", hide); hit.addEventListener("pointerdown", show);
    root.append(hit);

    const legend = series.length > 1 ? h("div", { class: "legend" }, series.map(s => h("span", {}, h("i", { class: "swatch " + s.cls }), s.name))) : null;
    return h("figure", { class: "chart-box" }, legend, h("div", { class: "chart-wrap" }, root, tip),
      h("details", { class: "chart-table" }, h("summary", { text: "Show as table" }),
        h("table", {}, h("thead", {}, h("tr", {}, h("th", { text: "Date" }), ...series.map(s => h("th", { class: "num", text: s.name })))),
          h("tbody", {}, series[0].points.slice(-30).reverse().map((p, i) => h("tr", {}, h("td", { text: shortDate(p.x) }),
            ...series.map(s => { const q = s.points[s.points.length - 1 - i]; return h("td", { class: "num", text: q ? format(q.y) : "–" }); })))))));
  }

  const verdictBadge = v => v && h("span", { class: "verdict " + v.level, text: v.text });

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
      if (r.rateLimited) parts.push("IsThereAnyDeal asked the bot to slow down, so only part was added. Import again in a minute to add the rest.");
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
    const watchOnly = h("input", { type: "checkbox" });
    const addBtn = h("button", { class: "btn blue", text: "Add game", onclick: () => busy(addBtn, async () => {
      const r = await api("/api/wishlist/add", { title: title.value, type: addType.value, value: addValue.value === "" ? null : Number(addValue.value), watch: watchOnly.checked });
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
        const picked = new Set();
        const count = h("span", { class: "muted small", text: "0 selected" });
        const sync = () => { count.textContent = picked.size + " selected"; };
        const bulkRule = h("div", { class: "rule inline" }, ...ruleControl({ type: "any" }, async (type, value) => {
          if (!picked.size) throw new Error("Select at least one game first.");
          const r = await api("/api/wishlist/bulk", { action: "alert", itad_ids: [...picked], type, value });
          toast(`${r.updated} games will alert on: ${r.label}.`, "ok"); loadList();
        }, "Apply to selected"));
        const removeSel = h("button", { class: "btn red small", text: "Remove selected" });
        removeSel.addEventListener("click", () => busy(removeSel, async () => {
          if (!picked.size) throw new Error("Select at least one game first.");
          const r = await api("/api/wishlist/bulk", { action: "remove", itad_ids: [...picked] });
          state.me.games -= r.removed; toast(`Removed ${r.removed} games.`, "ok"); loadList();
        }));
        const rows = data.rows.map(r => wishRow(r, cur, loadList, (id, on) => { if (on) picked.add(id); else picked.delete(id); sync(); }));
        const selectAll = h("input", { type: "checkbox", "aria-label": "Select all games" });
        selectAll.addEventListener("change", () => {
          rows.forEach(el => { const c = el.querySelector("input.pick"); if (c.checked !== selectAll.checked) c.click(); });
        });
        const bulk = h("div", { class: "panel" }, h("h3", { text: "Several games at once" }),
          h("div", { class: "rule inline" }, h("label", { class: "check" }, selectAll, "Select all"), count, bulkRule, removeSel));
        list.replaceChildren(all, bulk, ...rows);
      } catch (e) {
        list.className = "";
        list.replaceChildren(h("div", { class: "notice warn", text: e.message }));
      }
    }

    app.replaceChildren(
      pageHead("Wishlist", "Sales first. You are alerted according to each game's rule."),
      h("div", { class: "grid two" },
        h("div", { class: "panel" }, h("h3", { text: "Import from Steam" }), field("Profile", profile), h("p", { class: "muted small", text: "Your wishlist must be public (Steam Profile > Edit Profile > Privacy Settings > Game details). No login needed. Run it again to sync." }), importBtn),
        h("div", { class: "panel" }, h("h3", { text: "Add a game" }), field("Title", title), h("div", { class: "row" }, field("Alert me on", addType), addValueField), h("label", { class: "check" }, watchOnly, "Just watch it once: remove it after the alert, or after 30 days"), h("p", {}), addBtn)),
      list);
    loadList();
  }

  function wishRow(r, cur, reload, onPick) {
    const best = r.best;
    const sale = r.discount > 0;
    const pct = Math.round(r.discount * 100);
    const remove = h("button", { class: "btn red small", text: "Remove" });
    remove.addEventListener("click", () => busy(remove, async () => { await api("/api/wishlist/remove", { itad_id: r.itad_id }); state.me.games--; reload(); }));
    const snooze = h("button", { class: "btn gray small", text: "Snooze 7d", title: "No alerts for this game for 7 days" });
    snooze.addEventListener("click", () => busy(snooze, async () => { await api("/api/wishlist/snooze", { itad_id: r.itad_id, days: 7 }); toast("Snoozed for 7 days.", "ok"); }));
    const chartHolder = h("div", { class: "wide" });
    const hist = h("button", { class: "btn gray small", text: "Price history" });
    hist.addEventListener("click", () => {
      if (chartHolder.firstChild) { chartHolder.replaceChildren(); return; }
      busy(hist, async () => {
        const d = await api("/api/wishlist/history?itad_id=" + encodeURIComponent(r.itad_id));
        if (!d.points.length) { chartHolder.replaceChildren(h("p", { class: "muted small", text: "No price history yet." })); return; }
        chartHolder.replaceChildren(h("p", { class: "muted small", text: "Lowest store price over the last year, " + r.title }),
          lineChart([{ name: "Price", cls: "s0", points: d.points.map(p => ({ x: p.t, y: p.price })) }], { format: v => money(v, cur), label: "Price history for " + r.title }));
      });
    });
    const pick = h("input", { type: "checkbox", class: "pick", "aria-label": "Select " + r.title });
    pick.addEventListener("change", () => onPick && onPick(r.itad_id, pick.checked));
    return h("div", { class: "wish" + (sale ? " sale" : "") },
      h("div", {}, h("div", { class: "name" }, pick, " ", r.title, " ", verdictBadge(r.verdict)), h("div", { class: "meta", text: `${r.source === "steam" ? "From Steam" : "Added by hand"} · alert: ${r.alert}${r.atl !== null ? " · all-time low " + money(r.atl, cur) : ""}` })),
      h("div", { class: "price-box" },
        h("span", { class: "badge" + (sale ? "" : " none"), text: sale ? "-" + pct + "%" : "–" }),
        sale && r.regular !== null && h("span", { class: "was", text: money(r.regular, cur) }),
        h("span", { class: "now", text: best ? money(best.price, cur) : "no price" }),
        best && h("span", { class: "muted small", text: best.shop })),
      h("div", { class: "rule" }, ...ruleControl({ type: r.trigger_type, value: r.trigger_value }, async (type, value) => {
        await api("/api/wishlist/alert", { itad_id: r.itad_id, type, value });
        toast("Rule saved.", "ok"); reload();
      }), snooze, hist, remove), chartHolder);
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
    const myTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; } })();
    const qs = h("input", { type: "time", value: s.quiet_start || "" });
    const qe = h("input", { type: "time", value: s.quiet_end || "" });
    const tz = h("input", { type: "text", value: s.tz && s.tz !== "UTC" ? s.tz : myTz, maxlength: "60" });
    const digest = h("input", { type: "checkbox", checked: s.digest });
    const digestDay = select(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => [String(i), d]), String(s.digest_day));
    const bundles = h("input", { type: "checkbox", checked: s.bundles });
    const share = h("input", { type: "checkbox", checked: s.share });
    const free = h("input", { type: "checkbox", checked: s.free });
    const freeDlc = h("input", { type: "checkbox", checked: s.free_dlc !== false });
    const freeNow = h("div", { class: "panel" }, h("h3", { text: "Free right now" }), h("p", { class: "muted", text: "Loading…" }));
    loadFree(freeNow);
    const history = h("div", { class: "panel" }, h("h3", { text: "Recent alerts" }), h("p", { class: "muted", text: "Loading…" }));
    api("/api/alerts/history").then(d => {
      const kinds = { sale: "Sale", bundle: "Bundle", giveaway: "Free", group: "Group", digest: "Digest" };
      history.replaceChildren(h("h3", { text: "Recent alerts" }), d.alerts.length
        ? h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["When", "Type", "Game", "Price", "Store", "Sent by"].map((c, i) => h("th", { class: i === 3 ? "num" : "", text: c })))),
          h("tbody", {}, d.alerts.map(a => h("tr", {}, h("td", { text: new Date(a.at).toLocaleString() }), h("td", { text: kinds[a.kind] || a.kind }), h("td", { text: a.title }),
            h("td", { class: "num", text: a.price === null ? "–" : a.price.toFixed(2) }), h("td", { text: a.shop || "–" }), h("td", { text: a.via || "–" }))))))
        : h("div", { class: "empty", text: "No alerts yet." }));
    }).catch(e => history.replaceChildren(h("div", { class: "notice warn", text: e.message })));
    const save = h("button", { class: "btn green", text: "Save settings", onclick: () => busy(save, async () => {
      const r = await api("/api/settings", {
        delivery: ch.checked ? "channel" : "dm", paused: paused.checked, region: region.value, stores: stores.value, guild_id: server.value || null,
        quiet_start: qs.value || null, quiet_end: qe.value || null, tz: tz.value, digest: digest.checked, digest_day: Number(digestDay.value),
        bundles: bundles.checked, share: share.checked, free: free.checked, free_dlc: freeDlc.checked
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
      h("div", { class: "panel" },
        h("h3", { text: "Quiet hours and digest" }),
        h("p", { class: "muted small", text: "Alerts that arrive during quiet hours are held and sent afterwards. Leave both empty to turn quiet hours off." }),
        h("div", { class: "row" }, field("Quiet from", qs), field("Until", qe), field("Your time zone", tz)),
        h("label", { class: "check" }, digest, "Weekly digest of your wishlist sales, sent from 9:00 in your time zone on"), field("Day", digestDay),
        h("label", { class: "check" }, bundles, "Tell me when a wishlist game is in a bundle or being given away"),
        h("label", { class: "check" }, free, "Tell me when any game is free to claim (Steam, Epic, GOG and others). Games from one store arrive together with a Claim all button."),
        h("label", { class: "check" }, freeDlc, "Include free DLC and add-ons (also controls what /freegames and the list below show)")),
      freeNow, salesPanel(), publicPagePanel(),
      h("div", { class: "panel" },
        h("h3", { text: "Share with your server" }),
        h("label", { class: "check" }, share, "Count me in group alerts (“3 members are watching…”) and on the savings leaderboard. Shows only my name, my game count and my percent saved.")),
      h("p", { class: "muted", text: `Watching ${state.me.games} game${state.me.games === 1 ? "" : "s"}. Prices are checked about once an hour.` }),
      save, history);
  }

  function publicPagePanel() {
    const panel = h("div", { class: "panel" }, h("h3", { text: "Public wishlist page" }), h("p", { class: "muted", text: "Loading…" }));
    api("/api/profile").then(p => {
      const on = h("input", { type: "checkbox", checked: p.public });
      const slug = h("input", { type: "text", value: p.slug || "", placeholder: "your-name", maxlength: "24" });
      const link = h("div", { class: "muted small" });
      const showLink = s => { link.replaceChildren(...(s && on.checked ? [h("a", { href: "#/u/" + s, text: location.origin + "/#/u/" + s })] : [])); };
      const save = h("button", { class: "btn blue", text: "Save", onclick: () => busy(save, async () => {
        const r = await api("/api/profile", { enabled: on.checked, slug: slug.value });
        slug.value = r.slug || ""; showLink(r.slug); toast(r.public ? "Your page is on." : "Your page is off.", "ok");
      }) });
      showLink(p.slug);
      panel.replaceChildren(h("h3", { text: "Public wishlist page" }),
        h("p", { class: "muted", text: "Share a link to your wishlist and its best prices, handy for gifts. It shows only game names, art and prices. Never your Discord account or anything else." }),
        h("label", { class: "check" }, on, "Turn my page on"), field("Page name", slug), link, h("p"), save);
    }).catch(e => panel.replaceChildren(h("h3", { text: "Public wishlist page" }), h("div", { class: "notice warn", text: e.message })));
    return panel;
  }

  async function publicWishlistView(slug) {
    const holder = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(holder);
    try {
      const d = await api("/api/public/wishlist?slug=" + encodeURIComponent(slug));
      const money2 = (n, c) => (n === null || n === undefined ? "-" : new Intl.NumberFormat(undefined, { style: "currency", currency: c || "USD" }).format(n));
      holder.className = "";
      holder.replaceChildren(pageHead(d.slug + "'s wishlist", `${d.games.length} game${d.games.length === 1 ? "" : "s"} with today's best prices. Thinking of a gift?`),
        d.games.length ? h("div", { class: "free-grid" }, d.games.map(g => h("div", { class: "free-card" },
          g.art ? h("img", { src: g.art, alt: "", loading: "lazy" }) : h("div", { class: "free-noart", text: "🎮" }),
          h("div", { class: "free-info" }, h("strong", { text: g.title }),
            h("span", { class: "muted small", text: (g.discount > 0 ? `${g.discount}% off • ` : "") + (g.shop || "") }),
            h("b", { text: money2(g.price, g.currency) }),
            g.url && ext(g.url, "View deal", "btn green small"))))) : h("div", { class: "empty", text: "Nothing on this list yet." }));
    } catch (e) { holder.className = ""; holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
  }

  function salesPanel() {
    const panel = h("div", { class: "panel" }, h("h3", { text: "Steam sale calendar" }), h("p", { class: "muted", text: "Loading…" }));
    api("/api/sales").then(d => {
      const fmt = ms => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      panel.replaceChildren(h("h3", { text: "Steam sale calendar" }),
        d.sales.length ? h("div", { class: "st-list" }, d.sales.map(e => h("div", { class: "st-row" },
          h("div", {}, h("b", { text: (e.kind === "sale" ? "🏷️ " : "🎪 ") + e.name }), e.note && h("div", { class: "muted small", text: e.note })),
          h("div", { class: "st-when" }, h("span", { class: "chip " + (e.live ? "ok" : "dim"), text: e.live ? "On now" : "Upcoming" }), h("span", { class: "muted small", text: `${fmt(e.start)} to ${fmt(e.end)}` })))))
          : h("div", { class: "empty", text: "No upcoming events listed." }),
        h("p", { class: "muted small", text: `From Valve's published schedule (updated ${d.updated}). Black Friday week is announced closer to the time.` }));
    }).catch(e => panel.replaceChildren(h("h3", { text: "Steam sale calendar" }), h("div", { class: "notice warn", text: e.message })));
    return panel;
  }

  async function loadFree(panel) {
    try {
      const d = await api("/api/free");
      const all = d.platforms.flatMap(p => p.games.map(g => ({ ...g, shop: p.shop })));
      let cat = "games", shop = "all";
      const body = h("div");
      const tabs = h("div", { class: "tabs" });
      const draw = () => {
        const inCat = all.filter(g => cat === "all" || (cat === "dlc") === g.dlc);
        const shops = [...new Set(inCat.map(g => g.shop))];
        if (!shops.includes(shop)) shop = "all";
        tabs.replaceChildren(...[["games", "🎮 Games"], ...(d.showDlc ? [["dlc", "🧩 DLC"], ["all", "📋 All"]] : [])].map(([id, label]) =>
          h("button", { class: "tab" + (id === cat ? " active" : ""), text: `${label} (${all.filter(g => id === "all" || (id === "dlc") === g.dlc).length})`, onclick: () => { cat = id; draw(); } })));
        const rows = inCat.filter(g => shop === "all" || g.shop === shop);
        body.replaceChildren(...[
          shops.length > 1 ? h("div", { class: "chips" }, ["all", ...shops].map(x => h("button", { class: "tab small" + (x === shop ? " active" : ""), text: x === "all" ? "All stores" : x, onclick: () => { shop = x; draw(); } }))) : null,
          rows.length ? h("div", { class: "free-grid" }, rows.map(g => h("div", { class: "free-card" },
            g.art ? h("img", { src: g.art, alt: "", loading: "lazy" }) : h("div", { class: "free-noart", text: g.dlc ? "🧩" : "🎮" }),
            h("div", { class: "free-info" }, h("strong", { text: g.title }), h("span", { class: "muted small", text: g.shop + (g.dlc ? " • DLC" : "") + (g.expiry ? " • ends " + new Date(g.expiry).toLocaleDateString() : "") }),
              ext(g.url, "Claim", "btn green small"))))) : h("div", { class: "empty", text: "Nothing here right now." })].filter(Boolean));
      };
      draw();
      panel.replaceChildren(h("h3", { text: "Free right now" }), all.length ? h("div", {}, tabs, body) : h("div", { class: "empty", text: "Nothing is being given away right now." }),
        h("p", { class: "muted small", text: "Claiming happens on the store's site, where you need to be signed in." }));
    } catch (e) { panel.replaceChildren(h("h3", { text: "Free right now" }), h("div", { class: "notice warn", text: e.message })); }
  }

  // ---------- servers ----------
  const guildInvite = g => (state.cfg.inviteUrl ? `${state.cfg.inviteUrl}&guild_id=${encodeURIComponent(g.id)}&disable_guild_select=true` : null);
  const serverIcon = (g, cls) => (g.icon ? h("img", { class: cls, src: g.icon, alt: "" }) : h("div", { class: cls + " noicon", text: (g.name || "?").trim().charAt(0).toUpperCase() }));
  const botBadge = g => (g.bot === null || g.bot === undefined ? null : h("span", { class: "chip " + (g.bot ? "ok" : "warn"), text: g.bot ? "Bot installed" : "Bot not added" }));

  function serversView() {
    const all = state.me.servers;
    const mine = all.filter(g => g.manageable);
    const withBot = all.filter(g => g.bot);
    let filter = "all", q = "";
    const grid = h("div", { class: "sv-grid" });

    function card(g) {
      const open = () => { location.hash = "#/servers/" + g.id; };
      const stat = (icon, label, value) => h("div", { class: "sv-stat" }, h("span", { class: "sv-ico", text: icon }), h("span", { class: "muted", text: label }), h("b", { text: value }));
      const actions = g.bot === false
        ? [guildInvite(g) && g.manageable ? ext(guildInvite(g), "Add the bot", "btn green") : null, h("button", { class: "btn gray", text: "Details", onclick: open })]
        : [h("button", { class: "btn blue", text: g.manageable ? "Manage" : "Open", onclick: open })];
      return h("div", { class: "sv-card" + (g.bot === false ? " off" : "") },
        h("div", { class: "sv-top" }, serverIcon(g, "sv-icon"),
          h("div", { class: "sv-name" }, h("strong", { text: g.name }), h("div", { class: "sv-badges" }, g.manageable ? h("span", { class: "chip", text: "You manage this" }) : h("span", { class: "chip dim", text: "Member" }), botBadge(g)))),
        h("div", { class: "sv-stats" },
          stat("📣", "Alert channel", g.alertChannel ? "Set" : "Not set"),
          stat("👥", "Group alerts", g.groupMin ? `From ${g.groupMin} members` : "Off")),
        h("div", { class: "sv-actions" }, ...actions.filter(Boolean)));
    }

    function draw() {
      const rows = all.filter(g => (filter === "all" || (filter === "mine" && g.manageable) || (filter === "bot" && g.bot) || (filter === "nobot" && g.bot === false)) && g.name.toLowerCase().includes(q));
      grid.replaceChildren(...(rows.length ? rows.map(card) : [h("div", { class: "empty", text: all.length ? "No servers match." : "You are not in any servers." })]));
    }
    const tabBtn = (id, label, count) => {
      const b = h("button", { class: "tab" + (filter === id ? " active" : ""), text: count === null ? label : `${label} (${count})`, onclick: () => { filter = id; tabs.querySelectorAll(".tab").forEach(t => t.classList.remove("active")); b.classList.add("active"); draw(); } });
      return b;
    };
    const known = all.some(g => g.bot !== null && g.bot !== undefined);
    const tabs = h("div", { class: "tabs" }, tabBtn("all", "All", all.length), tabBtn("mine", "I manage", mine.length),
      ...(known ? [tabBtn("bot", "Bot installed", withBot.length), tabBtn("nobot", "Needs the bot", all.length - withBot.length)] : []));
    const search = h("input", { type: "search", class: "sv-search", placeholder: "Search your servers", "aria-label": "Search your servers" });
    search.addEventListener("input", () => { q = search.value.trim().toLowerCase(); draw(); });
    draw();
    app.replaceChildren(
      pageHead("Servers", "Set up alerts, the shared wishlist and giveaways for the servers you are in.", state.cfg.inviteUrl && ext(state.cfg.inviteUrl, "Add the bot to a server", "btn blue")),
      h("div", { class: "sv-toolbar" }, tabs, search),
      grid);
  }

  async function statsPanel(g, into) {
    const holder = h("div", { class: "muted", text: "Loading…" });
    into.replaceChildren(holder);
    try {
      const s = await api("/api/servers/stats?guild=" + encodeURIComponent(g.id));
      if (!s.members) { holder.className = ""; holder.replaceChildren(h("div", { class: "empty", text: "Nobody here has opted in yet. Members turn it on with /alerts share (or on their Alerts page)." })); return; }
      const tile = (k, v) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: String(v) }));
      holder.className = "";
      holder.replaceChildren(
        h("div", { class: "grid four" }, tile("Members counted", s.members), tile("Games in libraries", s.games), tile("Saved vs MSRP", s.saved > 0 ? s.saved.toFixed(2) : "-"), tile("Sale alerts, 30 days", s.alerts30d)),
        h("div", { class: "grid two" },
          h("div", { class: "panel" }, h("h3", { text: "Most wanted" }), s.mostWanted.length ? h("ol", {}, s.mostWanted.map(x => h("li", { text: `${x.title} (${x.watchers})` }))) : h("p", { class: "muted", text: "Nothing yet." })),
          h("div", { class: "panel" }, h("h3", { text: "Top of the server list" }), s.sharedList.length ? h("ol", {}, s.sharedList.map(x => h("li", { text: `${x.title} (${x.votes} votes)` }))) : h("p", { class: "muted", text: "The server list is empty." }))),
        h("p", { class: "muted small", text: "Members who opted in only. Counts only: nobody is named for what they want." }));
    } catch (e) { holder.className = ""; holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
  }

  function serverDetail(id) {
    const g = state.me.servers.find(x => x.id === id);
    if (!g) { location.hash = "#/servers"; return; }
    const canUse = g.bot !== false;
    const body = h("div", { class: "sv-body" });
    const sections = [["overview", "Overview"], ...(canUse ? [["alerts", "Alert channel", true], ["list", "Shared wishlist"], ["board", "Leaderboard"], ["stats", "Server stats"], ["giveaways", "Giveaways", true]] : [])]
      .filter(([, , managerOnly]) => !managerOnly || g.manageable);
    let current = "overview";
    const tabs = h("div", { class: "tabs" }, sections.map(([key, label]) => h("button", { class: "tab" + (key === current ? " active" : ""), text: label, onclick: ev => {
      current = key; tabs.querySelectorAll(".tab").forEach(t => t.classList.remove("active")); ev.currentTarget.classList.add("active"); show();
    } })));

    function overview() {
      const tile = (icon, k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: `${icon} ${k}` }), h("div", { class: "v", text: v }), sub && h("div", { class: "s", text: sub }));
      const go = key => () => { const t = [...tabs.children].find(b => b.textContent === sections.find(s => s[0] === key)[1]); t && t.click(); };
      const action = (icon, title, text, onclick) => h("button", { class: "sv-action", onclick }, h("span", { class: "sv-ico big", text: icon }), h("span", {}, h("b", { text: title }), h("span", { class: "muted small", text })));
      const out = [];
      if (g.bot === false) out.push(h("div", { class: "notice warn" }, "The bot is not in this server yet. ", guildInvite(g) && g.manageable ? ext(guildInvite(g), "Add it now", "btn green small") : "Ask a server manager to add it."));
      out.push(h("div", { class: "grid three" },
        tile("📣", "Alert channel", g.alertChannel ? "Set" : "Not set", g.alertChannel ? "Used when a DM fails or a member picks channel delivery" : "Alerts go by DM only"),
        tile("👥", "Group alerts", g.groupMin ? `From ${g.groupMin}` : "Off", "When several opted-in members want the same game"),
        tile("🤖", "Bot", g.bot === null ? "-" : g.bot ? "Installed" : "Not added")));
      if (canUse) {
        out.push(h("div", { class: "sv-actions-grid" },
          g.manageable && action("📣", "Choose the alert channel", "Where alerts go when a DM cannot be delivered", go("alerts")),
          action("🎮", "Shared wishlist", "Suggest games and vote with your server", go("list")),
          action("🏆", "Leaderboard", "Who has saved the most against MSRP", go("board")),
          g.manageable && action("🎁", "Giveaways", "Create and manage key giveaways", () => { location.hash = "#/giveaways"; })));
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
              h("p", { class: "muted", text: "Post new free games (not DLC) in the alert channel for everyone, once each. Needs an alert channel." }),
              h("div", { class: "rule inline" }, feedOn, feedLabel)),
            h("div", { class: "panel" }, h("h3", { text: "Group alerts" }),
              h("p", { class: "muted", text: "Post in the channel when this many opted-in members watch the same game and it hits their alert. 0 turns it off. Needs an alert channel." }),
              h("div", { class: "rule inline" }, min, setMin)));
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
      else if (current === "stats") statsPanel(g, body);
      else if (current === "giveaways") { location.hash = "#/giveaways"; }
    }
    show();
    app.replaceChildren(
      h("a", { class: "back", href: "#/servers", text: "← All servers" }),
      h("div", { class: "sv-hero" }, serverIcon(g, "sv-icon big"),
        h("div", {}, h("h1", { text: g.name }), h("div", { class: "sv-badges" }, g.manageable ? h("span", { class: "chip", text: "You manage this" }) : h("span", { class: "chip dim", text: "Member" }), botBadge(g)))),
      tabs, body);
  }

  // ---------- shared server list and leaderboard ----------
  async function sharedList(g, into) {
    const d = await api("/api/servers/list?guild=" + encodeURIComponent(g.id));
    const title = h("input", { type: "text", placeholder: "Suggest a game", maxlength: "100" });
    const add = h("button", { class: "btn blue small", text: "Add" });
    add.addEventListener("click", () => busy(add, async () => { await api("/api/servers/list/add", { guild_id: g.id, title: title.value }); toast("Added to the server list.", "ok"); await sharedList(g, into); }));
    const rows = d.rows.map(r => {
      const vote = h("button", { class: "btn small " + (r.voted ? "green" : "gray"), text: (r.voted ? "Voted " : "Vote ") + r.votes });
      vote.addEventListener("click", () => busy(vote, async () => { await api("/api/servers/list/vote", { guild_id: g.id, itad_id: r.itad_id }); await sharedList(g, into); }));
      const rm = h("button", { class: "btn red small", text: "Remove" });
      rm.addEventListener("click", () => busy(rm, async () => { await api("/api/servers/list/remove", { guild_id: g.id, itad_id: r.itad_id }); await sharedList(g, into); }));
      const sale = r.discount > 0;
      return h("tr", {}, h("td", {}, r.title, " ", verdictBadge(r.verdict)),
        h("td", { class: "num" }, sale && h("span", { class: "badge", text: "-" + Math.round(r.discount * 100) + "%" }), " ", money(r.best && r.best.price, d.currency)),
        h("td", { text: r.best ? r.best.shop : "–" }), h("td", { class: "actions" }, vote, rm));
    });
    into.replaceChildren(h("div", { class: "subpanel" }, h("h4", { text: "Server wishlist" }), h("div", { class: "rule inline" }, title, add),
      rows.length ? h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Game", "Price now", "Store", ""].map((c, i) => h("th", { class: i === 1 ? "num" : "", text: c })))), h("tbody", {}, rows)))
        : h("div", { class: "empty", text: "Nothing here yet. Suggest a game above." }),
      h("p", { class: "muted small", text: "Everyone in the server can see this list. You can remove games you added; server managers can remove any." })));
  }

  async function board(g, into) {
    const d = await api("/api/servers/leaderboard?guild=" + encodeURIComponent(g.id));
    into.replaceChildren(h("div", { class: "subpanel" }, h("h4", { text: "Savings leaderboard" }),
      d.entries.length ? h("ol", { class: "board" }, d.entries.map(e => h("li", {}, h("strong", { text: e.name + (e.you ? " (you)" : "") }), ` ${Math.round(e.savedPct)}% saved across ${e.games} games`)))
        : h("div", { class: "empty", text: "Nobody has joined yet." }),
      h("p", { class: "muted small", text: d.joined ? "You are on the leaderboard. Change this on the Alerts page." : "You are not on it. Opt in on the Alerts page (“Share with your server”). Ranked by percent saved vs MSRP, since members shop in different currencies." })));
  }

  // ---------- library ----------
  async function libraryView() {
    const body = h("div", { class: "muted", text: "Loading prices…" });
    const title = h("input", { type: "text", placeholder: "Game title", maxlength: "100" });
    const paid = h("input", { type: "number", min: "0", max: "10000", step: "0.01", placeholder: "What you paid (optional)" });
    const add = h("button", { class: "btn blue", text: "Add game", onclick: () => busy(add, async () => {
      await api("/api/library/add", { title: title.value, paid: paid.value === "" ? null : Number(paid.value) });
      title.value = ""; paid.value = ""; toast("Added.", "ok"); load();
    }) });
    const file = h("input", { type: "file", accept: ".csv,.json,.txt,.md" });
    const imp = h("button", { class: "btn gray", text: "Import file", onclick: () => busy(imp, async () => {
      const f = file.files[0];
      if (!f) throw new Error("Choose a file first.");
      if (f.size > state.cfg.maxUploadChars) throw new Error("That file is too large (200 KB max).");
      const r = await api("/api/library/import", { file: { name: f.name, text: await f.text() } });
      toast(`Added ${r.added}, updated ${r.updated}.` + (r.notFound.length ? ` ${r.notFound.length} not found.` : ""), "ok"); load();
    }) });

    const nextOut = h("div");
    const nextBtn = h("button", { class: "btn green", text: "Pick for me", onclick: () => busy(nextBtn, async () => {
      const d = await api("/api/library/next");
      nextOut.replaceChildren(d.next ? h("div", { class: "panel" }, h("h3", { text: "🎯 Play next" }), h("p", {}, h("b", { text: d.next.pick.title })), h("p", { class: "muted", text: d.next.why }),
        d.next.others.length ? h("p", { class: "muted small", text: "Also in the running: " + d.next.others.map(o => o.title).join(", ") }) : null) : h("div", { class: "notice warn", text: "Nothing in your backlog." }));
    }) });
    async function load() {
      try {
        const d = await api("/api/library");
        state.me.library = d.rows.length;
        if (!d.rows.length) { body.className = ""; body.replaceChildren(h("div", { class: "empty", text: "Your library is empty. Add games above, import a FanaticalGrabber export, or send results from the Value Checker." })); return; }
        const t = d.totals, cur = d.currency;
        const tile = (k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: v }), sub && h("div", { class: "s", text: sub }));
        const snaps = d.snapshots;
        const chart = snaps.length > 1
          ? h("div", { class: "panel" }, h("h3", { text: "Value over time" }), lineChart([
              { name: "Worth at MSRP", cls: "s1", points: snaps.map(x => ({ x: Date.parse(x.day), y: x.msrp })) },
              { name: "Cheapest now", cls: "s0", points: snaps.map(x => ({ x: Date.parse(x.day), y: x.cheapest })) }
            ], { format: v => money(v, cur), label: "Library value over time" }))
          : h("p", { class: "muted small", text: "The value chart appears after the second day of data." });
        const rows = d.rows.map(r => {
          const rm = h("button", { class: "btn red small", text: "Remove" });
          rm.addEventListener("click", () => busy(rm, async () => { await api("/api/library/remove", { itad_id: r.itad_id }); load(); }));
          const holder = h("tr", { class: "chart-row", hidden: true }, h("td", { colspan: "7" }));
          const stat = select([["backlog", "Backlog"], ["playing", "Playing"], ["finished", "Finished"], ["dropped", "Dropped"]], r.status || "backlog");
          stat.addEventListener("change", async () => { try { await api("/api/library/status", { itad_id: r.itad_id, status: stat.value }); toast(`${r.title}: ${stat.value}.`, "ok"); load(); } catch (e) { toast(e.message, "error"); } });
          const hist = h("button", { class: "btn gray small", text: "Price history" });
          hist.addEventListener("click", () => {
            if (!holder.hidden) { holder.hidden = true; return; }
            busy(hist, async () => {
              const h2 = await api("/api/wishlist/history?itad_id=" + encodeURIComponent(r.itad_id));
              holder.firstChild.replaceChildren(h2.points.length ? lineChart([{ name: "Price", cls: "s0", points: h2.points.map(p => ({ x: p.t, y: p.price })) }], { format: v => money(v, cur), label: "Price history for " + r.title }) : h("p", { class: "muted small", text: "No price history yet." }));
              holder.hidden = false;
            });
          });
          return [h("tr", {}, h("td", { text: r.title }), h("td", {}, stat), h("td", { class: "num", text: money(r.paid, cur) }), h("td", { class: "num", text: money(r.msrp, cur) }),
            h("td", { class: "num", text: money(r.best && r.best.price, cur) }),
            h("td", { class: "num", text: r.saved === null ? "–" : (r.saved >= 0 ? "+" : "−") + money(Math.abs(r.saved), cur) }), h("td", { class: "actions" }, hist, rm)), holder];
        });
        body.className = "";
        body.replaceChildren(
          h("div", { class: "grid four" }, tile("Games", String(t.games), t.paidGames < t.games ? `${t.paidGames} with a price` : ""), tile("You paid", money(t.paid, cur)),
            tile("Worth at MSRP", money(t.msrp, cur)), tile("Saved vs MSRP", money(t.saved, cur), t.msrpPaid > 0 ? Math.round(t.savedPct) + "% off" : "add prices to see savings")),
          h("div", { class: "grid four" }, tile("Not started", String(t.backlogGames), t.backlogPaid > 0 ? money(t.backlogPaid, cur) + " spent on unplayed games" : ""), tile("Playing", String(t.playing)), tile("Finished", String(t.finished)),
            h("div", { class: "tile" }, h("div", { class: "k", text: "What to play next" }), nextBtn)),
          nextOut,
          chart,
          h("div", { class: "panel" }, h("h3", { text: "Your games" }), h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Game", "Status", "Paid", "MSRP", "Cheapest now", "Saved", ""].map((c, i) => h("th", { class: i > 1 && i < 6 ? "num" : "", text: c })))), h("tbody", {}, rows.flat())))));
      } catch (e) { body.className = ""; body.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }

    app.replaceChildren(pageHead("Library", "Games you own and what you paid, against what they are worth now."),
      h("div", { class: "grid two" },
        h("div", { class: "panel" }, h("h3", { text: "Add a game" }), field("Title", title), field("Paid", paid), h("p"), add),
        h("div", { class: "panel" }, h("h3", { text: "Import" }), field("FanaticalGrabber export (a Paid column is used)", file), h("p"), imp)),
      body);
    load();
  }

  // ---------- owner ----------
  // Recent bot logs (errors and crashes by default), owner only.
  function logPanel() {
    const out = h("pre", { class: "logbox", text: "Loading…" });
    const level = select([["error", "Errors and crashes"], ["warn", "Errors and warnings"], ["all", "Everything"]], "error");
    const fmt = l => `${new Date(l.at).toLocaleString()}  ${l.level.toUpperCase().padEnd(5)} ${l.earlier ? "(before restart) " : ""}${l.text}`;
    let lastText = "";
    async function load() {
      out.textContent = "Loading…";
      try {
        const d = await api("/api/admin/logs?level=" + encodeURIComponent(level.value));
        lastText = d.lines.map(fmt).join("\n\n");
        out.textContent = d.available ? (lastText || "Nothing logged at this level. That is good news.") : "Logging is not turned on.";
      } catch (e) { out.textContent = e.message; }
    }
    level.addEventListener("change", load);
    const refresh = h("button", { class: "btn gray", text: "Refresh", onclick: load });
    const copy = h("button", { class: "btn gray", text: "Copy", onclick: async () => { try { await navigator.clipboard.writeText(lastText); toast("Copied.", "ok"); } catch { toast("Could not copy. Select the text instead.", "error"); } } });
    load();
    return h("div", { class: "panel" }, h("h3", { text: "Recent logs" }),
      h("p", { class: "muted small", text: "Newest first. Errors and crashes are kept across restarts. Tokens and keys are hidden." }),
      h("div", { class: "rule inline" }, level, refresh, copy), out);
  }

  async function adminView() {
    const holder = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(pageHead("Admin", "Only you, the bot owner, can see this."), holder);
    try {
      const d = await api("/api/admin/stats");
      const st = d.stats, hl = d.health || {};
      const tile = (k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: String(v) }), sub && h("div", { class: "s", text: sub }));
      const when = t => (t ? new Date(t).toLocaleString() : "never");
      holder.className = "";
      holder.replaceChildren(
        h("div", { class: "grid four" }, tile("Members", st.users, `${st.activeUsers} with alerts on`), tile("Wishlist games", st.wishlistGames, `${st.uniqueGames} different games`),
          tile("Library games", st.libraryGames), tile("Servers with a channel", st.serversWithChannel),
          tile("Alerts, last 24h", st.alerts24h), tile("DM delivery", st.dmUsers, `${st.channelUsers} use the channel`), tile("DMs failing", st.usersFailingDm, "3 or more failures in a row")),
        h("div", { class: "panel" }, h("h3", { text: "Alerts in the last 7 days" }),
          Object.keys(st.alerts7d).length ? h("p", { text: Object.entries(st.alerts7d).map(([k, n]) => `${k}: ${n}`).join("   ") }) : h("p", { class: "muted", text: "None." })),
        h("div", { class: "panel" }, h("h3", { text: "Health" }),
          h("p", { text: "Last price check: " + when(hl.cycle && hl.cycle.at) }),
          h("p", { text: "Last backup: " + (hl.backup ? `${when(hl.backup.at)} (${hl.backup.ok ? "ok" : "FAILED"})` : "none yet") }),
          h("p", { class: "muted small", text: "Recent errors: " + ((hl.errors || []).slice(0, 5).map(e => `${e.where} (${when(e.at)})`).join(", ") || "none") })),
        logPanel());
    } catch (e) { holder.className = ""; holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
  }


  // ---------- giveaways ----------
  async function giveawaysView() {
    const servers = state.me.servers.filter(g => g.manageable);
    const holder = h("div");
    const guild = select(servers.map(g => [g.id, g.name]), servers[0] && servers[0].id);
    const statusLabel = { active: "Running", scheduled: "Scheduled", ended: "Ended", cancelled: "Cancelled" };

    // Entry counts tick up live while a giveaway runs, without touching the form.
    const liveTimer = setInterval(async () => {
      const cells = [...holder.querySelectorAll(".live-entries")];
      if (!cells.length) { if (!document.body.contains(holder)) clearInterval(liveTimer); return; }
      try {
        const list = await api("/api/giveaways?guild=" + encodeURIComponent(guild.value));
        for (const c of cells) { const g = list.giveaways.find(x => String(x.id) === c.dataset.gid); if (g) c.textContent = String(g.entries); }
      } catch { /* try again next time */ }
    }, 15000);
    async function load() {
      holder.replaceChildren(h("p", { class: "muted", text: "Loading…" }));
      try {
        const [list, ch, ro] = await Promise.all([
          api("/api/giveaways?guild=" + encodeURIComponent(guild.value)),
          api("/api/servers/channels?guild=" + encodeURIComponent(guild.value)).catch(() => ({ channels: [] })),
          api("/api/servers/roles?guild=" + encodeURIComponent(guild.value)).catch(() => ({ roles: [] }))
        ]);
        holder.replaceChildren(giveawayForm(ch.channels, ro.roles, list.settings), giveawayTable(list.giveaways), setupPanel(ch.channels, ro.roles, list.settings));
      } catch (e) { holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }

    function giveawayForm(channels, roles, settings) {
      const text = (ph, max, type = "text") => h("input", { type, placeholder: ph, maxlength: String(max) });
      const chSel = select(channels.map(c => [c.id, "#" + c.name]), channels[0] && channels[0].id);
      const roleSel = () => select([["", "None"], ...roles.map(r => [r.id, r.name])], "");
      const vouchSel = select([["", "A channel named #vouches (or the server default)"], ...channels.map(c => [c.id, "#" + c.name])], "");
      const title = text("Title (optional, made from the prizes if blank)", 100), length = text("2h, 3d, 1w, 1d12h", 20), game = text("Game name (optional, taken from the first prize)", 100);
      length.value = "24h";
      const presets = h("div", { class: "chips" }, ["1h", "6h", "24h", "3d", "1w"].map(p => h("button", { type: "button", class: "tab small", text: p, onclick: () => { length.value = p; } })));
      const preview = h("div", { class: "gw-preview muted small", text: "Artwork appears here once you add a prize." });
      let previewTimer = 0, previewKey = "";
      const refreshPreview = () => {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(async () => {
          if (image.value.trim()) { preview.replaceChildren(h("span", { text: "Using your own image." })); return; }
          const first = (keys.value.split("\n").find(l => l.trim()) || "").split("|")[0].trim();
          const q = game.value.trim() || (keys.value.includes("|") ? first : "");
          if (!q || !auto.checked) { preview.replaceChildren(h("span", { text: "Artwork appears here once you add a prize." })); return; }
          if (q === previewKey) return; previewKey = q;
          preview.replaceChildren(h("span", { text: "Looking for artwork…" }));
          try { const r = await api("/api/giveaways/art?game=" + encodeURIComponent(q)); preview.replaceChildren(r.image ? h("img", { src: r.image, alt: q }) : h("span", { text: "No artwork found. Paste an image link under Look and rules." })); }
          catch { preview.replaceChildren(h("span", { text: "Could not look up artwork." })); }
        }, 500);
      };
      const desc = h("textarea", { placeholder: "Extra text on the giveaway (optional)", maxlength: "1500" });
      const image = text("Your own image, GIF or video link, https (optional)", 500), thumb = text("Your own small picture or GIF link, https (optional)", 500);
      const auto = h("input", { type: "checkbox", checked: true });
      const color = text("#5865F2", 8), label = text("Enter giveaway", 40);
      const claim = text("48", 3, "number"), acct = text("0", 4, "number"), memb = text("0", 4, "number"), bonusN = text("2", 2, "number");
      const reqRole = roleSel(), bonusRole = roleSel(), pingRole = roleSel();
      const boosters = h("input", { type: "checkbox" });
      const startIn = text("Start later, e.g. 2h or 1d (blank = now)", 20), rounds = text("1", 2, "number"), repeatEvery = text("e.g. 7d", 20);
      const keys = h("textarea", { placeholder: "Hades | AAAAA-BBBBB-CCCCC\nCeleste | DDDDD-EEEEE-FFFFF\n(a key on its own uses the game name)", maxlength: "20000", autocomplete: "off", spellcheck: "false" });
      for (const el of [keys, game, image]) el.addEventListener("input", refreshPreview);
      auto.addEventListener("change", () => { previewKey = ""; refreshPreview(); });
      // Templates keep everything except the prize keys.
      const FIELDS = { title, length, game, desc, image, thumb, auto, color, label, claim, acct, memb, bonusN, reqRole, bonusRole, pingRole, vouchSel, boosters, startIn, rounds, repeatEvery, chSel };
      const grab = () => Object.fromEntries(Object.entries(FIELDS).map(([k, el]) => [k, el.type === "checkbox" ? el.checked : el.value]));
      const apply = data => { for (const [k, el] of Object.entries(FIELDS)) if (data[k] !== undefined) { if (el.type === "checkbox") el.checked = Boolean(data[k]); else el.value = data[k]; } previewKey = ""; refreshPreview(); };
      let tpls = [];
      const tplSel = select([["", "Load a template…"]], "");
      const tplName = text("Template name", 40);
      const paintTpls = () => { tplSel.replaceChildren(h("option", { value: "", text: "Load a template…" }), ...tpls.map(t => h("option", { value: String(t.id), text: t.name }))); };
      api("/api/giveaways/templates?guild=" + encodeURIComponent(guild.value)).then(r => { tpls = r.templates; paintTpls(); }).catch(() => {});
      tplSel.addEventListener("change", () => { const t = tpls.find(x => String(x.id) === tplSel.value); if (t) { apply(t.data); toast(`Loaded "${t.name}".`, "ok"); } });
      const saveTpl = h("button", { type: "button", class: "btn gray small", text: "Save as template", onclick: () => busy(saveTpl, async () => { const r = await api("/api/giveaways/templates", { guild_id: guild.value, name: tplName.value, data: grab() }); tpls = r.templates; paintTpls(); toast("Template saved. Prize keys are never saved in it.", "ok"); }) });
      const delTpl = h("button", { type: "button", class: "btn red small", text: "Delete", onclick: () => busy(delTpl, async () => { if (!tplSel.value) return; const r = await api("/api/giveaways/templates", { guild_id: guild.value, remove: Number(tplSel.value) }); tpls = r.templates; paintTpls(); }) });
      const create = h("button", { class: "btn green", text: "Start giveaway", onclick: () => busy(create, async () => {
        const num = el => (el.value === "" ? undefined : Number(el.value));
        const r = await api("/api/giveaways/create", {
          guild_id: guild.value, channel_id: chSel.value, title: title.value, length: length.value, game: game.value, description: desc.value,
          image: image.value, thumbnail: thumb.value, auto_image: auto.checked, color: color.value, button_label: label.value,
          claim_hours: num(claim), min_account_days: num(acct), min_member_days: num(memb), bonus_entries: num(bonusN),
          require_role_id: reqRole.value, bonus_role_id: bonusRole.value, ping_role_id: pingRole.value, vouch_channel_id: vouchSel.value, keys: keys.value,
          boosters: boosters.checked, start_in: startIn.value, rounds: num(rounds), repeat_every: repeatEvery.value
        });
        keys.value = "";
        toast(r.rounds > 1 ? `Series created: ${r.rounds} rounds scheduled.` : r.scheduled ? `Giveaway #${r.id} is scheduled.` : `Giveaway #${r.id} is live with ${r.prizes} prize${r.prizes === 1 ? "" : "s"}.`, "ok");
        load();
      }) });
      return h("div", { class: "panel" }, h("h3", { text: "Start a giveaway" }),
        h("div", { class: "row" }, field("Template", tplSel), field("Save these settings as", tplName), h("div", { class: "shrink" }, saveTpl, " ", delTpl)),
        field("Prize keys (paste them, one per line: Name | KEY)", keys),
        preview,
        h("div", { class: "row" }, field("Channel", chSel), field("Length", length)), presets,
        field("Title", title),
        h("p", { class: "muted small", text: "Keys are encrypted as soon as they are saved. Each is deleted once the winner confirms it worked, and unused keys are sent back to you by DM. One winner per prize." }),
        h("details", { class: "more" }, h("summary", { text: "Look and rules (all optional)" }),
          h("div", { class: "row" }, field("Game (for automatic artwork)", game), field("Enter button text", label), field("Color", color)),
          field("Description", desc),
          h("div", { class: "row" }, field("Image, GIF or video link", image), field("Small picture or GIF link", thumb)),
          h("label", { class: "check" }, auto, "Find artwork automatically when I don't give an image"),
          h("div", { class: "row" }, field("Must have role", reqRole), field("Bonus-entry role", bonusRole), field("Bonus entries (2-10)", bonusN)),
          h("div", { class: "row" }, field("Ping role", pingRole), field("Hours to claim", claim), field("Vouches channel", vouchSel)),
          h("div", { class: "row" }, field("Min. Discord account age (days)", acct), field("Min. days in this server", memb)),
          h("label", { class: "check" }, boosters, "Only server boosters can enter"),
          h("h4", { text: "Schedule" }),
          h("div", { class: "row" }, field("Start in", startIn), field("Rounds (prizes are split across them)", rounds), field("Repeat every", repeatEvery))),
        h("p"), create);
    }

    function giveawayTable(rows) {
      const detail = h("div");
      const act = (text, cls, path, bodyExtra, done) => {
        const b = h("button", { class: "btn small " + cls, text });
        b.addEventListener("click", () => busy(b, async () => { const r = await api(path, { guild_id: guild.value, ...bodyExtra }); toast(done(r), "ok"); load(); }));
        return b;
      };
      const body = rows.map(g => {
        const details = h("button", { class: "btn gray small", text: "Details" });
        details.addEventListener("click", () => busy(details, () => showDetails(g, detail)));
        return h("tr", {}, h("td", { text: "#" + g.id }), h("td", { text: g.title }), h("td", { text: statusLabel[g.status] || g.status }),
          h("td", { class: "num live-entries", "data-gid": String(g.id), text: String(g.entries) }), h("td", { class: "num", text: `${g.redeemed}/${g.prizes}` }),
          h("td", { text: g.status === "active" ? new Date(g.ends_at).toLocaleString() : g.status === "scheduled" ? "Starts " + new Date(g.starts_at).toLocaleString() : "" }),
          h("td", { class: "actions" }, details,
            g.status === "active" ? act("End now", "blue", "/api/giveaways/end", { id: g.id }, r => `Ended. ${r.winners} winner${r.winners === 1 ? "" : "s"} drawn.`) : null,
            g.status === "active" || g.status === "scheduled" ? act("Cancel", "red", "/api/giveaways/cancel", { id: g.id }, () => "Cancelled. Unused keys were sent to you by DM.") : null,
            g.status === "ended" ? act("Draw for open prizes", "gray", "/api/giveaways/reroll", { id: g.id }, r => `Drew ${r.winners} new winner${r.winners === 1 ? "" : "s"}.`) : null));
      });
      return h("div", { class: "panel" }, h("h3", { text: "Giveaways" }),
        rows.length ? h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["", "Title", "Status", "Entries", "Redeemed", "Ends", ""].map((c, i) => h("th", { class: i === 3 || i === 4 ? "num" : "", text: c })))), h("tbody", {}, body)))
          : h("div", { class: "empty", text: "No giveaways yet." }), detail);
    }

    async function showDetails(g, into) {
      const d = await api(`/api/giveaways/info?guild=${encodeURIComponent(guild.value)}&id=${g.id}`);
      const names = { assigned: "Waiting to claim", delivered: "Key sent", confirmed: "Redeemed", problem: "Reported a problem", available: "No winner", expired: "Expired", returned: "No winner (sent back to you)" };
      const rows = d.keys.map(k => {
        const key = h("input", { type: "text", placeholder: "New key", maxlength: "200", autocomplete: "off", spellcheck: "false" });
        const rep = h("button", { class: "btn gray small", text: "Replace key" });
        rep.addEventListener("click", () => busy(rep, async () => { await api("/api/giveaways/replace", { guild_id: guild.value, id: g.id, user_id: k.winner_id, key: key.value }); toast("Replaced. The winner was told to claim again.", "ok"); key.value = ""; showDetails(g, into); }));
        const reroll = h("button", { class: "btn red small", text: "Take away and redraw" });
        reroll.addEventListener("click", () => busy(reroll, async () => { await api("/api/giveaways/reroll", { guild_id: guild.value, id: g.id, user_id: k.winner_id }); toast("Drew a new winner.", "ok"); showDetails(g, into); }));
        const canEdit = k.winner_id && g.status !== "active" && !["confirmed", "expired"].includes(k.status);
        return h("tr", {}, h("td", { text: String(k.position) }), h("td", { text: k.label }), h("td", { text: k.winner_id ? "Winner ID " + k.winner_id : "–" }), h("td", { text: names[k.status] || k.status }),
          h("td", { class: "actions" }, canEdit ? [key, rep, reroll] : null));
      });
      into.replaceChildren(h("div", { class: "subpanel" }, h("h4", { text: `#${d.id} ${d.title}: ${d.entries} entries` }),
        h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["#", "Prize", "Winner", "Status", ""].map(c => h("th", { text: c })))), h("tbody", {}, rows))),
        h("p", { class: "muted small", text: "Prize keys are never shown here." })));
    }

    function setupPanel(channels, roles, settings) {
      const vouch = select([["", "A channel named #vouches"], ...channels.map(c => [c.id, "#" + c.name])], settings.vouch_channel_id || "");
      const mgr = select([["", "Only people with Manage Server"], ...roles.map(r => [r.id, r.name])], settings.manager_role_id || "");
      const save = h("button", { class: "btn gray", text: "Save", onclick: () => busy(save, async () => { await api("/api/giveaways/setup", { guild_id: guild.value, vouch_channel_id: vouch.value, manager_role_id: mgr.value }); toast("Saved.", "ok"); }) });
      return h("div", { class: "panel" }, h("h3", { text: "Server settings" }),
        h("div", { class: "row" }, field("Vouches channel (winners' confirmations are posted here)", vouch), field("Role that can run giveaways in Discord", mgr)), h("p"), save);
    }

    guild.addEventListener("change", load);
    app.replaceChildren(pageHead("Giveaways", "Give away game keys to your server. Winners claim with a button, and confirm when it worked."),
      ...(servers.length > 1 ? [h("div", { class: "panel" }, field("Server", guild))] : []), holder);
    load();
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
        h("p", { text: "Your Discord ID, your wishlist and alert rules, giveaway entries, your library and what you paid, your settings (including quiet hours and time zone), your last 90 days of alert history, the server you last used, and your public Steam ID if you imported a wishlist. Games you suggest or vote for on a server list are stored with that server. The Value Checker stores nothing." }),
        h("a", { class: "btn blue", href: "/api/mydata/download", text: "Download my data (JSON)" })),
      h("div", { class: "panel" }, h("h3", { text: "Delete" }),
        h("p", { text: "This deletes your wishlist, library, alert history and settings, your Steam profile ID, your votes and the games you added to server lists. It cannot be undone. Backups made before you delete are removed as they rotate out (7 days)." }),
        field("Confirm", confirm), h("p"), del));
  }

  // ---------- help ----------
  // The About page: the same numbers as the /about command in Discord.
  let statusTimer = 0;
  async function statusView() {
    clearInterval(statusTimer);
    const holder = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(holder);
    const LABEL = { operational: "Operational", degraded: "Degraded", down: "Down", unknown: "Checking" };
    const HEAD = { operational: "All systems operational", degraded: "Some systems are degraded", down: "Major outage" };
    const n = v => (v === null || v === undefined ? "-" : Number(v).toLocaleString());
    const ago = ms => { const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };
    async function load(manual) {
      try {
        const d = await api("/api/status");
        const tm = d.telemetry, st = d.stats;
        const refresh = h("button", { class: "btn gray small", text: "Refresh now", onclick: () => busy(refresh, () => load(true)) });
        const tile = (icon, k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: `${icon} ${k}` }), h("div", { class: "v", text: String(v) }), sub && h("div", { class: "s", text: sub }));
        const row = (k, v) => h("div", { class: "kv" }, h("span", { class: "muted", text: k }), h("b", { text: v === null || v === undefined ? "-" : String(v) }));
        const up = d.uptime;
        holder.className = "status-page";
        holder.replaceChildren(...[
          h("div", { class: "st-banner " + d.overall },
            h("div", {}, h("span", { class: "st-dot " + d.overall }), h("strong", { text: HEAD[d.overall] || "Checking…" })),
            h("div", { class: "st-meta" }, h("span", { class: "muted small", text: d.checkedAt ? "Last checked " + ago(d.checkedAt) : "Starting up…" }), refresh)),
          st && h("div", { class: "grid four" },
            tile("🌐", "Servers", n(st.servers)), tile("👥", "Members served", n(st.members)), tile("🎮", "Games watched", n(st.gamesWatched)),
            tile("✅", "Uptime, 90 days", up.pct90 === null ? "-" : up.pct90 + "%", up.pct30 === null ? null : `${up.pct30}% over the last 30 days`)),
          h("div", { class: "panel" }, h("h3", { text: "Services" }),
            h("div", { class: "st-list" }, d.components.map(c => h("div", { class: "st-row" },
              h("div", {}, h("b", { text: c.name }), h("div", { class: "muted small", text: c.detail ? `${c.desc} • ${c.detail}` : c.desc })),
              h("span", { class: "chip " + (c.state === "operational" ? "ok" : c.state === "unknown" ? "dim" : "warn"), text: LABEL[c.state] || c.state }))))),
          h("div", { class: "panel" }, h("h3", { text: "Bot details" }),
            h("div", { class: "grid three" },
              h("div", {}, row("Version", tm.version), row("Node.js", tm.node), row("discord.js", tm.discordjs)),
              h("div", {}, row("Gateway latency", tm.pingMs === null ? null : tm.pingMs + " ms"), row("Memory (heap)", tm.heapMb + " MB"), row("Memory (total)", tm.rssMb + " MB")),
              h("div", {}, row("Process uptime", tm.uptime), row("Shards", "1 (standalone)"), row("Region", tm.region || "-")))),
          h("div", { class: "panel" }, h("h3", { text: "Uptime, past 90 days" }),
            h("div", { class: "st-bars" }, up.days.map(x => h("span", { class: "st-bar " + (x.pct === null ? "none" : x.pct >= 99.9 ? "good" : x.pct >= 95 ? "warn" : "bad"), title: `${x.day}: ${x.pct === null ? "no data" : x.pct + "%"}` }))),
            h("div", { class: "st-axis muted small" }, h("span", { text: "90 days ago" }), h("span", { text: "Today" }))),
          h("div", { class: "panel" }, h("h3", { text: "Recent incidents" }),
            d.incidents.length ? h("div", { class: "st-list" }, d.incidents.map(e => h("div", { class: "st-row" },
              h("div", {}, h("b", { text: (d.components.find(c => c.id === e.component) || { name: e.component === "bot" ? "Bot" : e.component }).name }), h("div", { class: "muted small", text: e.note || "" })),
              h("div", { class: "st-when" }, h("span", { class: "chip " + (e.state === "operational" ? "ok" : "warn"), text: LABEL[e.state] || e.state }), h("span", { class: "muted small", text: new Date(e.at).toLocaleString() })))))
              : h("div", { class: "empty", text: "No incidents recorded." })),
          h("p", { class: "muted small", text: "Checked every minute. Time the bot was offline counts against uptime. History starts when status tracking was first turned on." })].filter(Boolean));
      } catch (e) { if (manual || !holder.firstChild || holder.className !== "status-page") holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    await load();
    statusTimer = setInterval(() => { if (currentView() !== "status") clearInterval(statusTimer); else load(); }, 30_000);
  }

  async function aboutView() {
    const holder = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(holder);
    try {
      const x = await api("/api/about");
      state.about = x.about; state.creator = x.creator;
      const ab = x.about, c = x.creator;
      const n = v => (v === null || v === undefined ? "-" : Number(v).toLocaleString());
      const tile = (icon, k, v) => h("div", { class: "tile" }, h("div", { class: "k", text: `${icon} ${k}` }), h("div", { class: "v", text: String(v) }));
      holder.className = "about-page";
      holder.replaceChildren(
        h("img", { class: "about-banner", src: "/banner.png", alt: "Steam Value Checker" }),
        h("div", { class: "panel about" },
          h("div", { class: "about-head" },
            h("img", { class: "about-logo", src: "/logo.png", alt: "", width: "84", height: "84" }),
            h("div", {}, h("h3", { text: "Steam Value Checker" }),
              c && h("div", { class: "creator" }, h("img", { class: "creator-logo", src: "/creator.png", alt: "", width: "32", height: "32" }), "Created by ", ext(c.url, c.name)))),
          md(state.cfg.about),
          ab && h("p", { class: "muted small", text: "Online since " + new Date(ab.startedAt).toLocaleString() + " · v" + ab.version + " · Node " + String(ab.node).replace(/^v/, "") }),
          ab ? h("div", { class: "grid four about-stats" },
            tile("🟢", "Uptime", ab.uptime), tile("🌐", "Servers", n(ab.servers)), tile("👥", "Members reached", n(ab.members)), tile("📡", "Latency", ab.pingMs === null ? "-" : ab.pingMs + " ms"),
            tile("🎮", "Games watched", n(ab.gamesWatched)), tile("🔔", "Alerts, last 24h", n(ab.alerts24h)), tile("🎁", "Giveaways run", n(ab.giveaways)), tile("✅", "Keys redeemed", n(ab.redeemed)))
            : h("p", { class: "muted", text: "Live numbers are not available right now." }),
          h("div", { class: "rule inline" },
            c && h("a", { class: "btn blue", href: safeHref(c.url), target: "_blank", rel: "noopener noreferrer", text: "Created by " + c.name }),
            h("a", { class: "btn gray", href: safeHref(state.cfg.fanaticalUrl), target: "_blank", rel: "noopener noreferrer", text: "FanaticalGrabber" }))));
    } catch (e) { holder.className = ""; holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
  }

  function helpView() {
    app.replaceChildren(
      pageHead("Help", "The dashboard does everything the Discord commands do."),
      h("div", { class: "panel" }, h("h3", { text: "Using the bot" }), md(state.cfg.help)),
      h("div", { class: "panel" }, h("h3", { text: "Privacy" }), md(state.cfg.privacy)),
      fanaticalCard());
  }

  // ---------- routing ----------
  // ---------- support tickets ----------
  const STATUS_ICON = { open: "🟢", waiting: "🟡", resolved: "✅", closed: "⚫" };
  const STATUS_CHIP = { open: "ok", waiting: "warn", resolved: "", closed: "dim" };

  async function supportView() {
    const id = currentParam();
    if (id) return ticketThread(id);
    const holder = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(pageHead("Support", "Ask for help, follow your tickets, and (for server managers) answer them. Replies show up here and in Discord."), holder);
    let filter = { q: "", status: "active" };
    async function load() {
      const d = await api("/api/tickets?status=" + encodeURIComponent(filter.status === "all" ? "" : filter.status) + "&q=" + encodeURIComponent(filter.q));
      const row = (t, who) => h("a", { class: "card-link", href: "#/support/" + t.id },
        h("span", { class: "icon", text: STATUS_ICON[t.status] }),
        h("span", {}, h("strong", { text: `#${t.id} ${t.subject}` }),
          h("span", { class: "muted", text: `${t.status} · ${new Date(t.updated_at).toLocaleString()}${who && t.user_name ? " · " + t.user_name : ""}${t.assignee_id ? " · assigned" : ""}${t.tags.length ? " · " + t.tags.join(", ") : ""}` })));
      const subject = h("input", { type: "text", maxlength: "100", placeholder: "What is this about?" });
      const body = h("textarea", { maxlength: "1500", placeholder: "Tell us what happened" });
      const guildSel = select([["", "The bot's team"], ...(state.me.servers || []).map(g => [g.id, g.name])], "");
      const send = h("button", { class: "btn green", text: "Open ticket", onclick: () => busy(send, async () => {
        const r = await api("/api/tickets", { subject: subject.value, body: body.value, guild_id: guildSel.value || null });
        toast(`Ticket #${r.id} opened.`); location.hash = "#/support/" + r.id;
      }) });
      const q = h("input", { type: "search", placeholder: "Search subject, tag or #id", value: filter.q });
      const st = select([["active", "Active"], ["all", "All"], ["open", "Open"], ["waiting", "Waiting on user"], ["resolved", "Resolved"], ["closed", "Closed"]], filter.status);
      const apply = () => { filter = { q: q.value.trim(), status: st.value }; load().catch(e => toast(e.message, "error")); };
      q.addEventListener("change", apply); st.addEventListener("change", apply);
      holder.className = "";
      holder.replaceChildren(...[
        h("div", { class: "panel" }, h("h3", { text: "Open a ticket" }),
          h("div", { class: "row" }, field("Subject", subject), field("Send to", guildSel)), field("Details", body),
          h("p", { class: "muted small", text: "Never include a game key here. Server staff cannot see keys." }), send),
        h("div", { class: "panel" }, h("h3", { text: "Your tickets" }),
          d.mine.length ? h("div", { class: "cards" }, ...d.mine.map(t => row(t, false))) : h("p", { class: "muted", text: "No tickets yet." })),
        d.staff && h("div", { class: "panel" }, h("h3", { text: d.owner ? "Inbox (all tickets)" : "Inbox (your servers)" }),
          h("div", { class: "row" }, field("Search", q), field("Show", st)),
          d.inbox.length ? h("div", { class: "cards" }, ...d.inbox.map(t => row(t, true))) : h("p", { class: "muted", text: "Nothing here." })),
        d.staff && ticketSettingsPanel(d)
      ].filter(Boolean));
    }
    load().catch(e => holder.replaceChildren(h("div", { class: "notice warn", text: e.message })));
  }

  function ticketSettingsPanel(d) {
    const scopes = [...(d.ownerSettings ? [{ id: "*", name: "Tickets with no server queue (you, the owner)", ...d.ownerSettings }] : []), ...d.guilds];
    const sel = select(scopes.map(s => [s.id, s.name]), scopes[0]?.id);
    const ch = h("input", { type: "text", placeholder: "Channel ID" }), role = h("input", { type: "text", placeholder: "Staff role ID (optional)" });
    const cannedBox = h("div"), cTitle = h("input", { type: "text", maxlength: "60", placeholder: "Title, e.g. Try a new key" }), cBody = h("textarea", { maxlength: "1500", placeholder: "Reply text" });
    const cur = () => scopes.find(s => s.id === sel.value);
    function paint() {
      const s = cur(); if (!s) return;
      ch.value = s.channel_id || ""; role.value = s.staff_role_id || "";
      cannedBox.replaceChildren(...s.canned.map(c => h("div", { class: "kv" }, h("span", {}, h("b", { text: c.title + " " }), h("span", { class: "muted", text: c.body.slice(0, 80) })),
        h("button", { class: "btn red small", text: "Remove", onclick: async e => busy(e.currentTarget, async () => { const r = await api("/api/tickets/canned", { guild_id: s.id, remove: c.id }); s.canned = r.canned; paint(); }) }))));
    }
    sel.addEventListener("change", paint); paint();
    const save = h("button", { class: "btn blue", text: "Save", onclick: () => busy(save, async () => { const r = await api("/api/tickets/setup", { guild_id: sel.value, channel_id: ch.value, staff_role_id: role.value }); Object.assign(cur(), r); toast("Saved."); }) });
    const add = h("button", { class: "btn gray", text: "Add canned reply", onclick: () => busy(add, async () => { const r = await api("/api/tickets/canned", { guild_id: sel.value, title: cTitle.value, body: cBody.value }); cur().canned = r.canned; cTitle.value = ""; cBody.value = ""; paint(); }) });
    return h("div", { class: "panel" }, h("h3", { text: "Ticket settings" }),
      h("p", { class: "muted small", text: "With a channel set, new tickets are posted there with Reply, Assign and Resolve buttons. Without one they go to the bot owner. Same as /support setup." }),
      field("Queue", sel), h("div", { class: "row" }, field("Channel ID", ch), field("Staff role ID", role)), save,
      h("h4", { text: "Canned replies" }), cannedBox, h("div", { class: "row" }, field("Title", cTitle)), field("Text", cBody), add);
  }

  async function ticketThread(id) {
    const holder = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(pageHead("Ticket #" + id, ""), holder);
    async function load() {
      const d = await api("/api/tickets/one?id=" + encodeURIComponent(id)), t = d.ticket;
      const who = m => (m.role === "system" ? "System" : m.role === "staff" ? "Staff" : t.user_name || "User");
      const thread = h("div", { class: "thread" }, ...d.messages.map(m => h("div", { class: "msg " + m.role },
        h("div", { class: "muted small", text: `${who(m)} · ${new Date(m.at).toLocaleString()}` }), h("div", { text: m.body }))));
      const box = h("textarea", { maxlength: "1500", placeholder: d.staff ? "Reply to the user" : "Write a message" });
      const send = h("button", { class: "btn green", text: "Send", onclick: () => busy(send, async () => { await api("/api/tickets/reply", { id: t.id, body: box.value }); await load(); }) });
      const canned = d.staff && d.canned.length ? select([["", "Insert canned reply…"], ...d.canned.map(c => [String(c.id), c.title])], "") : null;
      if (canned) canned.addEventListener("change", () => { const c = d.canned.find(x => String(x.id) === canned.value); if (c) box.value = c.body; canned.value = ""; });
      const act = (label, cls, path, extra) => { const b = h("button", { class: "btn small " + cls, text: label, onclick: () => busy(b, async () => { await api(path, { id: t.id, ...extra }); await load(); }) }); return b; };
      const tags = h("input", { type: "text", value: t.tags.join(", "), placeholder: "tags, comma separated" });
      const dl = h("button", { class: "btn gray small", text: "Download transcript", onclick: () => busy(dl, async () => {
        const r = await api("/api/tickets/transcript?id=" + t.id);
        const a = h("a", { href: URL.createObjectURL(new Blob([r.text], { type: "text/plain" })), download: r.name }); document.body.append(a); a.click(); a.remove();
      }) });
      const stars = t.status === "resolved" || t.status === "closed" ? h("div", { class: "row" }, h("span", { class: "muted", text: t.rating ? `Rated ${"⭐".repeat(t.rating)}` : "Was this helpful?" }),
        ...(!t.rating && !d.staff ? [1, 2, 3, 4, 5].map(n => { const b = h("button", { class: "btn gray small shrink", text: "⭐".repeat(n), onclick: () => busy(b, async () => { await api("/api/tickets/rate", { id: t.id, rating: n }); await load(); }) }); return b; }) : [])) : null;
      app.replaceChildren(
        pageHead(`#${t.id} ${t.subject}`, `${STATUS_ICON[t.status]} ${t.status}${t.tags.length ? " · " + t.tags.join(", ") : ""}`),
        h("p", {}, h("a", { href: "#/support", text: "← All tickets" })),
        h("div", { class: "panel" }, thread),
        t.status !== "closed" && h("div", { class: "panel" }, canned, box, h("div", { class: "row" }, send,
          d.staff && act("Resolve", "blue", "/api/tickets/status", { status: "resolved" }),
          d.staff && act(t.assignee_id ? "Unassign" : "Assign to me", "gray", "/api/tickets/assign", { assignee: t.assignee_id ? null : "me" }),
          act("Close", "red", "/api/tickets/status", { status: "closed" }))),
        d.staff && h("div", { class: "panel" }, field("Tags", tags), h("div", { class: "row" },
          (() => { const b = h("button", { class: "btn gray small", text: "Save tags", onclick: () => busy(b, async () => { await api("/api/tickets/tags", { id: t.id, tags: tags.value.split(",") }); await load(); }) }); return b; })())),
        stars && h("div", { class: "panel" }, stars),
        d.errors && h("div", { class: "panel" }, h("h4", { text: "Recent bot errors (owner only)" }), h("pre", { class: "logs", text: d.errors.map(l => typeof l === "string" ? l : `${l.time ?? ""} ${l.text ?? l.message ?? ""}`).join("\n") || "None." })),
        h("div", { class: "panel" }, dl)
      );
    }
    load().catch(e => holder.replaceChildren(h("div", { class: "notice warn", text: e.message })));
  }

  // CSP blocks style attributes, so the width is set through the DOM.
  const progressBar = f => { const i = h("div"); i.style.width = Math.round(f * 100) + "%"; return h("div", { class: "progress" }, i); };

  // ---------- notifications, what's new, search, shortcuts, contrast ----------
  const TYPE_LABEL = { alert: "Sale alerts", bundle: "Bundles & giveaways", free: "Free games", digest: "Weekly digest" };
  const PRIZE_STATUS = { assigned: "Waiting for you to claim", delivered: "Key sent", confirmed: "Redeemed", problem: "Problem reported", expired: "Expired" };
  const TYPE_ICON = { alert: "🔔", bundle: "🎁", free: "🆓", digest: "📰", status: "🛠️", giveaway: "🏆", ticket: "🎫" };

  async function notificationsView() {
    const holder = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(pageHead("Notifications", "A copy of every alert the bot sends you, so a missed DM is never lost. Muted kinds are kept here but not sent to Discord."), holder);
    try {
      const d = await api("/api/notifications");
      const prizes = (await api("/api/claims").catch(() => ({ prizes: [] }))).prizes;
      const s = state.me.settings, muted = new Set(s.muted || []);
      const toggles = Object.entries(TYPE_LABEL).map(([id, text]) => {
        const box = h("input", { type: "checkbox", checked: !muted.has(id) });
        box.addEventListener("change", async () => {
          box.checked ? muted.delete(id) : muted.add(id);
          try { const r = await api("/api/settings", { muted: [...muted] }); state.me.settings = r.settings; toast("Saved.", "ok"); } catch (e) { toast(e.message, "error"); box.checked = !box.checked; }
        });
        return h("label", { class: "check" }, box, " ", `Send ${text} to Discord`);
      });
      holder.className = "";
      holder.replaceChildren(
        prizes.length ? h("div", { class: "panel" }, h("h3", { text: "Your prizes" }),
          h("p", { class: "muted small", text: "Press Claim key on the winners message in Discord. Keys are never shown here." }),
          ...prizes.map(p => h("div", { class: "kv" }, h("span", {}, h("b", { text: p.label + " " }), h("span", { class: "muted", text: `${p.title} · ${PRIZE_STATUS[p.status] || p.status}${p.status === "assigned" && p.deadline ? " · claim by " + new Date(p.deadline).toLocaleString() : ""}` })),
            p.link ? ext(p.link, "Open in Discord") : null))) : null,
        h("div", { class: "panel" }, h("h3", { text: "What gets sent to Discord" }), ...toggles),
        h("div", { class: "panel" }, h("h3", { text: "Recent" }),
          d.items.length ? h("div", { class: "cards" }, ...d.items.map(n => h(n.url && /^https:\/\//.test(n.url) ? "a" : "div", { class: "card-link" + (n.read ? "" : " unread"), ...(n.url && /^https:\/\//.test(n.url) ? { href: n.url, target: "_blank", rel: "noopener noreferrer" } : {}) },
            h("span", { class: "icon", text: TYPE_ICON[n.type] || "🔔" }),
            h("span", {}, h("strong", { text: n.title }), h("span", { class: "muted", text: `${new Date(n.at).toLocaleString()}${n.body ? " · " + n.body.replace(/[*_`]/g, "").slice(0, 140) : ""}` }))))) : h("p", { class: "muted", text: "Nothing yet. Alerts will show up here." })));
      if (d.unread) { await api("/api/notifications/read", {}); state.me.unread = 0; renderChrome(); }
    } catch (e) { holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
  }

  async function changelogView() {
    const holder = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(pageHead("What's new", ""), holder);
    try {
      const d = await api("/api/changelog");
      state.me.news = null; renderChrome();
      holder.className = "";
      holder.replaceChildren(...d.entries.map(e => h("div", { class: "panel" }, h("h3", { text: e.title }), h("p", { class: "muted small", text: e.date }), h("ul", {}, ...e.items.map(x => h("li", {}, inline(x)))))));
    } catch (e) { holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
  }

  function newsBanner() {
    if (!state.me || !state.me.news || currentView() === "changelog") return null;
    return h("div", { class: "notice news" }, h("span", { text: "✨ New: support tickets, a notification center, snooze buttons and more. " }), h("a", { href: "#/changelog", text: "See what's new" }),
      h("button", { class: "btn gray small", text: "Dismiss", onclick: async e => { try { await api("/api/changelog/seen", {}); } catch {} state.me.news = null; e.currentTarget.parentElement.remove(); } }));
  }

  function setupCard() {
    const steps = state.me && state.me.setup;
    if (!steps || steps.every(x => x.done)) return null;
    const done = steps.filter(x => x.done).length;
    return h("div", { class: "panel" }, h("h3", { text: `Get set up (${done} of ${steps.length})` }),
      progressBar(done / steps.length),
      ...steps.map(x => h("a", { class: "step-row" + (x.done ? " done" : ""), href: x.href }, h("span", { text: x.done ? "✅" : "⬜" }), " ", x.text)));
  }

  // High contrast is a per-device choice kept in localStorage; the page works without it.
  function contrastOn() { try { return localStorage.getItem("svc_contrast") === "1"; } catch { return false; } }
  function applyContrast(on) { document.documentElement.toggleAttribute("data-contrast", on); try { localStorage.setItem("svc_contrast", on ? "1" : "0"); } catch {} }
  applyContrast(contrastOn());
  function contrastButton() {
    const b = h("button", { class: "theme-btn", type: "button", text: "◐", title: "High contrast", "aria-label": "Toggle high contrast" });
    b.addEventListener("click", () => applyContrast(!contrastOn()));
    return b;
  }

  // Search overlay: press / anywhere. Keyboard: g then w/l/a/s/n/h jumps to a page, ? lists the keys.
  let searchEl = null;
  function openSearch() {
    if (!state.me || searchEl) return;
    const input = h("input", { type: "search", placeholder: "Search games, tickets, servers, pages…", "aria-label": "Search" });
    const list = h("div", { class: "search-results" });
    searchEl = h("div", { class: "search-overlay", role: "dialog", "aria-label": "Search", onclick: e => { if (e.target === searchEl) closeSearch(); } }, h("div", { class: "search-box" }, input, list));
    document.body.append(searchEl); input.focus();
    let timer = null;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const d = await api("/api/search?q=" + encodeURIComponent(input.value));
          list.replaceChildren(...(d.results.length ? d.results.map(r => h("a", { href: r.href, onclick: closeSearch }, h("span", { class: "chip dim", text: r.kind }), " ", r.title)) : [h("p", { class: "muted", text: input.value.trim().length < 2 ? "Type at least 2 letters." : "No matches." })]));
        } catch (e) { list.replaceChildren(h("p", { class: "muted", text: e.message })); }
      }, 200);
    });
  }
  function closeSearch() { if (searchEl) { searchEl.remove(); searchEl = null; } }
  let gPending = false;
  document.addEventListener("keydown", e => {
    const t = e.target, typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    if (e.key === "Escape") return closeSearch();
    if (typing || e.ctrlKey || e.metaKey || e.altKey || !state.me) return;
    if (e.key === "/") { e.preventDefault(); return openSearch(); }
    if (e.key === "?") return toast("Keys: / search · g then w wishlist, l library, a alerts, s servers, n notifications, h help", "ok");
    if (gPending) { gPending = false; const dest = { w: "wishlist", l: "library", a: "alerts", s: "servers", n: "notifications", h: "help", t: "support", v: "value" }[e.key]; if (dest) location.hash = "#/" + dest; return; }
    if (e.key === "g") { gPending = true; setTimeout(() => { gPending = false; }, 1200); }
  });

  // ---------- guided server setup (same checklist as /setup in Discord) ----------
  async function setupView() {
    const servers = state.me.servers.filter(g => g.manageable);
    const holder = h("div");
    app.replaceChildren(pageHead("Server setup", "A few choices and your server is ready. The same steps are in Discord with /setup."), holder);
    if (!servers.length) { holder.replaceChildren(h("div", { class: "notice warn", text: "You need the Manage Server permission in a server to set it up." })); return; }
    const wanted = currentParam();
    const guild = select(servers.map(g => [g.id, g.name]), servers.some(g => g.id === wanted) ? wanted : servers[0].id);
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
        const [ch, ro] = await Promise.all([api("/api/servers/channels?guild=" + encodeURIComponent(guild.value)).catch(() => ({ channels: [] })), api("/api/servers/roles?guild=" + encodeURIComponent(guild.value)).catch(() => ({ roles: [] }))]);
        const chOpts = cur => select([["", "Not set"], ...ch.channels.map(c => [c.id, "#" + c.name])], cur || "");
        const row = (step, title, help, ...controls) => h("div", { class: "setup-row" }, h("div", {}, h("b", { text: (step.done ? "✅ " : step.optional ? "➖ " : "⬜ ") + title }), h("div", { class: "muted small", text: help })), ...controls.filter(Boolean));
        const save = (label, fn) => { const b = h("button", { class: "btn blue small", text: label }); b.addEventListener("click", () => busy(b, async () => { await fn(); toast("Saved.", "ok"); load(); })); return b; };
        const [sAlert, sFeed, sSupport, sVouch] = st.steps;
        const alertSel = chOpts(st.alertChannel), supportSel = chOpts(st.supportChannel), vouchSel = chOpts(st.vouchChannel);
        const staffSel = select([["", "Only people with Manage Server"], ...ro.roles.map(r => [r.id, r.name])], st.staffRole || "");
        const done = st.steps.filter(x => x.done).length;
        const auto = st.complete && st.vouchChannel ? null : h("div", { class: "panel" }, h("h3", { text: "Fastest way" }),
          h("p", { class: "muted", text: "I can create a Steam Value Checker category with #deal-alerts, a private #support-tickets (only you and the bot) and #vouches, and connect them. Needs the Manage Channels permission." }),
          (() => { const b = h("button", { class: "btn green", text: "Create the channels for me" }); b.addEventListener("click", () => busy(b, async () => { const r = await api("/api/servers/setup/auto", { guild_id: guild.value, staff_role_id: staffSel.value || null }); toast(r.created.length ? "Channels created and connected." : r.note, "ok"); load(); })); return b; })());
        const feedBtn = h("button", { class: "btn small " + (st.feed ? "red" : "green"), text: st.feed ? "Stop the feed" : "Turn on the feed" });
        feedBtn.addEventListener("click", () => busy(feedBtn, async () => { await api("/api/servers/feed", { guild_id: guild.value, enabled: !st.feed }); load(); }));
        holder.replaceChildren(...[picker, auto, h("div", { class: "panel" },
          h("h3", { text: `Checklist (${done} of ${st.steps.length})` }), progressBar(done / st.steps.length),
          row(sAlert, "Alert channel", "Where alerts go when a member's DM fails, and where the free-games feed posts. The bot posts a short note there to check it can.",
            h("div", { class: "row" }, alertSel, save("Save", () => (alertSel.value ? api("/api/servers/channel", { guild_id: guild.value, channel_id: alertSel.value }) : api("/api/servers/channel", { guild_id: guild.value, clear: true }))))),
          row(sFeed, "Free-games feed", "Posts new free games (not DLC) in the alert channel for everyone.", st.alertChannel ? feedBtn : h("span", { class: "muted small", text: "Choose an alert channel first." })),
          row(sSupport, "Support tickets", "Members use /support open. Tickets appear here with Reply, Assign and Resolve buttons, and in the Support page.",
            h("div", { class: "row" }, supportSel, staffSel, save("Save", () => api("/api/tickets/setup", { guild_id: guild.value, channel_id: supportSel.value, staff_role_id: staffSel.value })))),
          state.me.giveaways ? row(sVouch, "Giveaway vouches", "Winners' confirmations are posted here. Without one the bot looks for a channel named #vouches.",
            h("div", { class: "row" }, vouchSel, save("Save", () => api("/api/giveaways/setup", { guild_id: guild.value, vouch_channel_id: vouchSel.value })))) : null),
          h("div", { class: "panel" }, h("h3", { text: "What members can do now" }), h("ul", {},
            h("li", {}, "Import a wishlist for sale alerts: ", h("code", { text: "/wishlist import" })), h("li", {}, "Price a library: ", h("code", { text: "/value" })),
            h("li", {}, "Ask for help: ", h("code", { text: "/support open" })), h("li", {}, "Managers can run giveaways: ", h("code", { text: "/giveaway create" }))))].filter(Boolean));
      } catch (e) { holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    guild.addEventListener("change", load);
    load();
  }

  const VIEWS = { setup: setupView, notifications: notificationsView, changelog: changelogView, support: supportView, value: valueView, wishlist: wishlistView, library: libraryView, alerts: alertsView, servers: serversView, giveaways: giveawaysView, mydata: myDataView, help: helpView, about: aboutView, status: statusView, home: landing, admin: adminView };

  function route() {
    renderChrome();
    const view = currentView();
    if (!state.me && view !== "help" && view !== "about" && view !== "home" && view !== "status" && view !== "u") return landing();
    if (view === "u" && currentParam()) { publicWishlistView(currentParam()); window.scrollTo(0, 0); return; }
    if (view === "servers" && state.me && currentParam()) { serverDetail(currentParam()); window.scrollTo(0, 0); return; }
    (VIEWS[view] || (state.me ? valueView : landing))();
    const nb = newsBanner();
    if (nb && view !== "home") app.prepend(nb);
    window.scrollTo(0, 0);
  }

  async function boot() {
    try {
      if (!state.cfg) state.cfg = await api("/api/config");
      try { const x = await api("/api/about"); state.about = x.about; state.creator = x.creator; } catch { state.about = null; state.creator = null; }
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

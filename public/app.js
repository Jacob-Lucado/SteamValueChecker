// Steam Value Checker dashboard. All text is inserted with textContent, never innerHTML.
(() => {
  "use strict";

  const state = { cfg: null, me: null };
  const app = document.getElementById("app");

  // The browser turns null/undefined/false passed to replaceChildren/append/prepend into the words "null", "undefined", "false".
  // Skip them instead, so an optional piece of a page can simply be null.
  for (const name of ["replaceChildren", "append", "prepend"]) {
    const native = Element.prototype[name];
    Element.prototype[name] = function (...nodes) { return native.apply(this, nodes.flat(Infinity).filter(n => n !== null && n !== undefined && n !== false)); };
  }

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
      h("span", { class: "muted", text: "The browser extension that reveals and exports your Fanatical keys, fills in what you paid from your Steam purchase history, and checks Fanatical bundles and your cart against Steam prices. Its exports work with the Value Checker." })));

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
  // Menu sections. Each one is a single link in the top bar; its pages show as tabs just under it, so related pages sit together
  // and the bar stays short.
  const NAV = [
    { id: "home", label: "Home", pages: [["home", "Home"]] },
    { id: "library", label: "Library", pages: [["library", "Library"], ["steam", "Steam"], ["redeem", "Batch redeem"]] },
    { id: "prices", label: "Prices", pages: [["value", "Value Checker"], ["wishlist", "Wishlist"], ["foryou", "For you"], ["deals", "Deals"], ["free", "Free games"], ["warroom", "Sale war room"]] },
    { id: "social", label: "Friends", pages: [["friends", "Friends"], ["compare", "Compare"], ["gamenight", "Game night"], ["lfg", "Looking for group"], ["calendar", "Calendar"]] },
    { id: "servers", label: "Servers", pages: [["servers", "Servers"], ["community", "Community"], ["xp", "Server XP"], ["mod", "Moderation"], ["setup", "Setup"], ["giveaways", "Giveaways"]] },
    { id: "account", label: "Account", pages: [["mypage", "My page"], ["alerts", "Alert settings"], ["notifications", "Notifications"], ["mydata", "My Data"]] },
    { id: "help", label: "Help", pages: [["help", "Help"], ["support", "Support"], ["status", "Status"], ["changelog", "What's new"], ["about", "About"]] },
    { id: "admin", label: "Admin", pages: [["admin", "Admin"]] }
  ];
  // Pages that are not tabs themselves but belong to a section: one game's page sits under Prices.
  const HUB_ALIAS = { g: "prices" };
  const PUBLIC_PAGES = new Set(["home", "help", "about", "status"]);
  function pageVisible(id) {
    const me = state.me;
    if (id === "home" && me) return false; // the logo already goes home when signed in
    if (id === "admin") return Boolean(me && me.isOwner);
    if (id === "giveaways") return Boolean(me && me.giveaways && me.servers.some(g => g.manageable));
    if (id === "gamenight" || id === "compare" || id === "community" || id === "xp" || id === "mod") return Boolean(me && me.servers.some(g => g.bot !== false));
    if (id === "setup") return Boolean(me && me.servers.some(g => g.manageable));
    return Boolean(me) || PUBLIC_PAGES.has(id);
  }
  let openMenu = null;
  function closeMenu() { if (openMenu) { openMenu.btn.setAttribute("aria-expanded", "false"); openMenu.menu.hidden = true; openMenu = null; } }
  document.addEventListener("click", e => { if (openMenu && !openMenu.wrap.contains(e.target)) closeMenu(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && openMenu) { const b = openMenu.btn; closeMenu(); b.focus(); } });
  window.addEventListener("hashchange", closeMenu);
  const STEAM_ICON = "M12 2a10 10 0 0 0-9.96 9.1l5.35 2.2a2.8 2.8 0 0 1 1.6-.5h.15l2.4-3.45v-.05a3.75 3.75 0 1 1 3.75 3.75h-.1l-3.4 2.45a2.8 2.8 0 0 1-5.55.45L2.3 14.2A10 10 0 1 0 12 2z";
  const steamIcon = () => { const n = document.createElementNS("http://www.w3.org/2000/svg", "svg"); n.setAttribute("viewBox", "0 0 24 24"); n.setAttribute("width", "18"); n.setAttribute("height", "18"); n.setAttribute("aria-hidden", "true"); const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", STEAM_ICON); p.setAttribute("fill", "currentColor"); n.append(p); return n; };
  const steamLoginBtn = (text = "Sign in through Steam", cls = "btn steam") => h("a", { class: cls, href: "/auth/steam" }, steamIcon(), " " + text);
  const currentView = () => (location.hash.replace(/^#\/?/, "") || "").split("?")[0].split("/")[0];
  const currentParam = () => (location.hash.replace(/^#\/?/, "") || "").split("?")[0].split("/")[1] || null;

  const NAV_I18N = {
    es: { prices: "Precios", social: "Amigos", account: "Cuenta", setup: "Configuración", wishlist: "Lista de deseos", library: "Biblioteca", alerts: "Alertas", support: "Soporte", notifications: "Avisos", servers: "Servidores", help: "Ayuda", mydata: "Mis datos" },
    fr: { prices: "Prix", social: "Amis", account: "Compte", setup: "Configuration", wishlist: "Liste de souhaits", library: "Bibliothèque", alerts: "Alertes", support: "Assistance", notifications: "Notifications", servers: "Serveurs", help: "Aide", mydata: "Mes données" }
  };
  const navText = (id, text) => (state.me && NAV_I18N[state.me.settings.lang] && NAV_I18N[state.me.settings.lang][id]) || text;

  // Prices come from one saved setting, the region (it decides the currency). It is kept on the account, so the Discord bot uses it too.
  function currencyPicker() {
    const regions = state.cfg.regions;
    const current = regions.find(r => r.value === state.me.settings.region);
    const code = (current && current.name.match(/\(([A-Z]{3})\)/) || [])[1] || state.me.settings.region;
    const btn = h("button", { type: "button", class: "nav-btn cur-btn", "aria-haspopup": "true", "aria-expanded": "false", title: "Currency for prices here and in the Discord bot", "aria-label": "Currency: " + (current ? current.name : code) }, code, " ▾");
    const menu = h("div", { class: "menu right scroll", role: "menu", hidden: true },
      ...regions.map(r => {
        const item = h("button", { type: "button", role: "menuitem", class: r.value === state.me.settings.region ? "active" : "", text: r.name });
        item.addEventListener("click", async () => {
          closeMenu();
          if (r.value === state.me.settings.region) return;
          try {
            const res = await api("/api/settings", { region: r.value });
            state.me.settings = res.settings;
            toast("Prices are now in " + r.name + ".", "ok");
            route();
          } catch (e) { toast(e.message, "error"); }
        });
        return item;
      }));
    const wrap = h("div", { class: "nav-group" }, btn, menu);
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const wasOpen = openMenu && openMenu.btn === btn;
      closeMenu();
      if (!wasOpen) { menu.hidden = false; btn.setAttribute("aria-expanded", "true"); openMenu = { wrap, btn, menu }; }
    });
    return wrap;
  }

  function renderChrome() {
    const view = currentView();
    const nav = document.getElementById("nav");
    const badge = n => (n ? h("span", { class: "badge-count", text: String(Math.min(99, n)) }) : null);
    closeMenu();
    const hubOf = id => (HUB_ALIAS[id] ? NAV.find(g => g.id === HUB_ALIAS[id]) : NAV.find(g => g.pages.some(([p]) => p === id)));
    const here = hubOf(view);
    nav.replaceChildren(...NAV.map(group => {
      const pages = group.pages.filter(([id]) => pageVisible(id));
      if (!pages.length) return null;
      const unread = state.me ? (group.id === "account" ? state.me.unread : group.id === "admin" ? state.me.bugsNew : 0) : 0;
      const active = group === here;
      return h("a", { href: "#/" + pages[0][0], class: active ? "active" : "", "data-pages": pages.map(p => p[0]).join(" "), "aria-current": active ? "page" : null }, navText(group.id, group.label), badge(unread));
    }).filter(Boolean));
    // The tabs for the section you are in (only when it has more than one page you can see).
    let bar = document.getElementById("hubbar");
    if (!bar) { bar = h("nav", { id: "hubbar", class: "hubbar", "aria-label": "Section pages" }); app.before(bar); }
    const tabs = here ? here.pages.filter(([id]) => pageVisible(id)) : [];
    bar.hidden = tabs.length < 2;
    bar.replaceChildren(...(tabs.length < 2 ? [] : [
      ...tabs.map(([id, text]) => h("a", { href: "#/" + id, class: "hubtab" + (view === id ? " active" : ""), "aria-current": view === id ? "page" : null }, navText(id, text), id === "notifications" ? badge(state.me && state.me.unread) : null)),
      here.id === "help" && state.cfg ? ext(state.cfg.fanaticalUrl, "FanaticalGrabber ↗", "hubtab") : null].filter(Boolean)));

    const acct = document.getElementById("account");
    const links = state.me ? [] : [state.cfg && ext(state.cfg.fanaticalUrl, "FanaticalGrabber ↗")].filter(Boolean); // signed in: it lives in the Help menu
    if (state.me) {
      acct.replaceChildren(...[...links,
        h("button", { class: "theme-btn", type: "button", text: "🔍", title: "Search (press /)", "aria-label": "Search", onclick: openSearch }),
        currencyPicker(), displayMenu(),
        // The signed-in name and Log out always sit together, set slightly apart from the tools.
        h("div", { class: "user-chip" },
          state.me.user.avatar && h("img", { class: "avatar", src: state.me.user.avatar, alt: "" }),
          h("span", { class: "who", text: state.me.user.username }),
          h("button", { class: "btn gray small", text: "Log out", onclick: async () => { try { await api("/auth/logout", {}); } catch {} state.me = null; location.hash = "#/"; boot(); } }))].filter(Boolean));
    } else {
      acct.replaceChildren(...[...links, themeButton(), steamLoginBtn("Steam", "btn steam small"), h("a", { class: "btn green", href: "/auth/login", text: "Sign in with Discord" })].filter(Boolean));
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
      state.me ? h("a", { class: "btn blue big", href: "#/value", text: "Open the dashboard" }) : [steamLoginBtn("Sign in through Steam", "btn steam big"), h("a", { class: "btn blue big", href: "/auth/login", text: "Sign in with Discord" })]);

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
          state.freeNow ? h("a", { class: "lp-live", href: state.me ? "#/free" : "/auth/login" }, h("i", { class: "lp-dot" }), `${state.freeNow} free offer${state.freeNow === 1 ? "" : "s"} live right now`) : h("div", { class: "lp-kicker", text: "Free Discord bot for PC gamers" }),
          h("h1", { text: "Know what your games are worth. Never miss a sale." }),
          h("p", { class: "lp-sub", text: "Price your whole library, watch your wishlist for deals, get told when games are free, and run key giveaways in your server. All from Discord, with a dashboard that does it all too." }),
          cta(),
          h("p", { class: "muted small", text: "No passwords, no game keys, no charge. Sign-in shares only your name, avatar and server list." })),
        h("div", { class: "lp-hero-art" }, mock)),

      h("div", { class: "lp-ticker", "aria-hidden": "true" }, h("div", { class: "lp-ticker-track" },
        ...[0, 1].flatMap(() => ["Library value", "Wishlist alerts", "Free game alerts", "Key giveaways", "Bundle check", "Play next", "Price history"].map(t => h("span", { text: t }))))),

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
          feature("🎂", "Friends and gifts", "Keep friends' birthdays, see what is on sale on their public wishlist and get a reminder a week ahead. Visitors can mark gifts so nobody doubles up."),
          feature("🏅", "Trophies and leagues", "Earn badges from your library and monthly challenge streak, and compete in a server backlog league."),
          feature("📱", "Sale war room", "Plan a Steam sale cart with a budget slider."),
          feature("🎮", "Your Steam library", "Sign in through Steam for hours played, library analytics, what you never played, achievements and a Play next pick. Prices you paid fill in from Steam purchase history, and gifts are marked."),
          feature("🔥", "Hot deals and sale starts", "Servers can get a post when a big deal appears or when a Steam sale begins, with a minimum discount you choose."),
          feature("📦", "Bundle check", "See whether a bundle is worth it against what its games cost today, skipping ones you own."),
          feature("🐞", "Bug reports and support", "Report a problem with /bug or open a ticket; the team answers in the same thread on Discord and here."),
          feature("📊", "A full dashboard", "Everything the commands do, in your browser: charts, price history, bulk actions and giveaway management."))),

      h("section", { class: "lp-section" },
        h("h2", { text: "Up and running in a minute" }),
        h("div", { class: "lp-grid three" },
          step("1", "Add the bot", "Invite it to your server. It only asks for permission to read, send messages and embed links."),
          step("2", "Bring your games", "Sign in through Steam and your library and wishlist fill in on their own, or upload a FanaticalGrabber export, or add games by name."),
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

  // ---------- for you: discounts ranked by your taste and wishlist ----------
  async function forYouView() {
    const host = h("div", { class: "muted", text: "Finding deals for you…" });
    const st = { sort: "best", atl: false, great: false, wish: false, cut: 0, max: "any", shop: "all", page: 0 };
    let data = null, tries = 0;
    const PER = 24;
    const sorters = { best: null, cut: (a, b) => b.cut - a.cut, price: (a, b) => a.price - b.price };
    const chip = (label, on, fn) => { const b = h("button", { class: "chip-btn" + (on ? " on" : ""), type: "button", text: label }); b.addEventListener("click", fn); return b; };
    function draw() {
      const cur = data.currency;
      const shops = [...new Set(data.deals.map(d => d.shop))].sort();
      const maxN = st.max === "any" ? Infinity : Number(st.max);
      let list = data.deals.filter(d => d.cut >= st.cut && d.price <= maxN && (!st.atl || d.atl) && (!st.great || (d.match || 0) >= 80) && (!st.wish || d.wishlist) && (st.shop === "all" || d.shop === st.shop));
      if (sorters[st.sort]) list = [...list].sort(sorters[st.sort]);
      const pages = Math.max(1, Math.ceil(list.length / PER));
      st.page = Math.min(st.page, pages - 1);
      const sort = select([["best", "Best for you"], ["cut", "Biggest discount"], ["price", "Lowest price"]], st.sort);
      sort.addEventListener("change", () => { st.sort = sort.value; st.page = 0; draw(); });
      const maxSel = select([["any", "Any"], ["5", "Under 5"], ["10", "Under 10"], ["20", "Under 20"], ["40", "Under 40"]], st.max);
      maxSel.addEventListener("change", () => { st.max = maxSel.value; st.page = 0; draw(); });
      const set = (k, v) => () => { st[k] = v; st.page = 0; draw(); };
      const card = d => h("a", { class: "fy-card", href: d.url && /^https:\/\//.test(d.url) ? d.url : "#/foryou", target: "_blank", rel: "noopener noreferrer" },
        h("div", { class: "fy-match" + (d.match === null ? " none" : ""), "aria-label": d.match === null ? "No match score yet" : d.match + " percent match" }, h("b", { text: d.match === null ? "–" : String(d.match) }), h("small", { text: "MATCH" })),
        d.appid ? steamArt(d.appid, "fy-art", 460, 215, d.id) : h("div", { class: "fy-art art-missing" }),
        h("div", { class: "fy-info" },
          h("strong", { class: "fy-title", text: d.title }),
          h("span", { class: "muted small", text: d.shop + (d.atl ? " · all-time low" : "") + (d.wishlist ? " · on your wishlist" : "") }),
          d.genres.length ? h("span", { class: "fy-genres", text: d.genres.join(" · ") }) : null),
        h("div", { class: "fy-price" }, h("span", { class: "fy-cut", text: "-" + d.cut + "%" }), h("b", { text: money(d.price, cur) }), h("s", { text: money(d.regular, cur) })));
      const prev = h("button", { class: "pg-btn wide", text: "‹ Prev", onclick: () => { st.page--; draw(); host.scrollIntoView({ block: "start" }); } }); prev.disabled = st.page === 0;
      const next = h("button", { class: "pg-btn wide", text: "Next ›", onclick: () => { st.page++; draw(); host.scrollIntoView({ block: "start" }); } }); next.disabled = st.page >= pages - 1;
      host.className = "";
      host.replaceChildren(
        !data.personalised ? h("div", { class: "notice" }, "These are the best current discounts. ", h("a", { href: "#/steam", text: "Sign in through Steam" }), " (or add wishlist games) and they will be ranked for you.") : null,
        h("div", { class: "panel fy-filters" },
          h("div", { class: "fy-row" }, h("span", { class: "fy-lab", text: "Sort" }), sort,
            chip("All-time low", st.atl, set("atl", !st.atl)), chip("Great match 80+", st.great, set("great", !st.great)), chip("On wishlist", st.wish, set("wish", !st.wish))),
          h("div", { class: "fy-row" }, h("span", { class: "fy-lab", text: "Discount" }), ...[[0, "Any discount"], [25, "25%+"], [50, "50%+"], [75, "75%+"]].map(([n, t]) => chip(t, st.cut === n, set("cut", n))),
            h("span", { class: "fy-lab", text: "Max price" }), maxSel),
          shops.length > 1 ? h("div", { class: "fy-row" }, h("span", { class: "fy-lab", text: "Store" }), chip("All", st.shop === "all", set("shop", "all")), ...shops.slice(0, 12).map(x => chip(x, st.shop === x, set("shop", x)))) : null),
        h("p", { class: "muted small", text: `${list.length} deals matched · ranked for you` + (data.pending ? ` · still reading genres for ${data.pending} games` : "") }),
        list.length ? h("div", { class: "fy-grid" }, list.slice(st.page * PER, (st.page + 1) * PER).map(card)) : h("div", { class: "empty", text: "No deals match those filters." }),
        h("div", { class: "lib-pager" }, h("div", { class: "pg-nav" }, prev, h("span", { class: "muted small", text: `Page ${st.page + 1} of ${pages}` }), next)));
    }
    async function load() {
      try {
        data = await api("/api/foryou");
        draw();
        if (data.pending && tries++ < 40) setTimeout(() => { if (host.isConnected) load(); }, 3500);
      } catch (e) { host.className = ""; host.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    app.replaceChildren(pageHead("For you", "Live discounts ranked by how well each game fits your taste and wishlist. Games you already own are left out."), host);
    load();
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
    const linked = Boolean(state.me.steam && state.me.steam.linked);
    const importBtn = h("button", { class: "btn green", text: linked ? "Import my Steam wishlist" : "Import", onclick: () => busy(importBtn, async () => {
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
        const ownedN = data.rows.filter(r => r.owned).length;
        const cleanBtn = h("button", { class: "btn gray small", text: "Remove them" });
        cleanBtn.addEventListener("click", () => busy(cleanBtn, async () => { const c = await api("/api/wishlist/cleanup", {}); state.me.games -= c.removed; toast(`Removed ${c.removed} owned game${c.removed === 1 ? "" : "s"}.`, "ok"); loadList(); }));
        const cleanup = ownedN ? h("div", { class: "notice" }, `${ownedN} game${ownedN === 1 ? " is" : "s are"} already in your library. `, cleanBtn) : "";
        list.replaceChildren(cleanup, all, bulk, ...rows);
      } catch (e) {
        list.className = "";
        list.replaceChildren(h("div", { class: "notice warn", text: e.message }));
      }
    }

    app.replaceChildren(
      pageHead("Wishlist", "Sales first. You are alerted according to each game's rule."),
      h("div", { class: "grid two" },
        h("div", { class: "panel" }, h("h3", { text: "Import from Steam" }),
          linked ? h("p", { class: "muted", text: "Uses the Steam account you signed in with. Your wishlist must be public (Steam Profile > Edit Profile > Privacy Settings > Game details). Run it again to sync." })
            : h("p", { class: "muted", text: "Sign in through Steam once and the bot knows your account everywhere. No links to paste." }),
          h("div", { class: "row" }, linked ? importBtn : steamLoginBtn()),
          linked ? null : h("details", { class: "paste" }, h("summary", { text: "Use a profile link instead" }), field("Profile", profile), importBtn)),
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
        chartHolder.replaceChildren(d.advice ? h("div", { class: "notice " + (d.advice.verdict === "buy" || d.advice.verdict === "lean_buy" ? "" : "warn") }, h("b", { text: (d.advice.verdict === "buy" || d.advice.verdict === "lean_buy" ? "🟢 " : "🟠 ") + "Buy now or wait? " + d.advice.label + ". " }), d.advice.reasons.join(" ")) : "",
          h("p", { class: "muted small", text: "Lowest store price over the last year, " + r.title }),
          lineChart([{ name: "Price", cls: "s0", points: d.points.map(p => ({ x: p.t, y: p.price })) }], { format: v => money(v, cur), label: "Price history for " + r.title }));
      });
    });
    const star = h("button", { class: "btn gray small", text: r.priority ? "★ Priority" : "☆ Priority", title: "Priority games are listed first and alert even in quiet hours", "aria-pressed": String(Boolean(r.priority)) });
    star.addEventListener("click", () => busy(star, async () => { await api("/api/wishlist/priority", { itad_id: r.itad_id, starred: !r.priority }); reload(); }));
    const pick = h("input", { type: "checkbox", class: "pick", "aria-label": "Select " + r.title });
    pick.addEventListener("change", () => onPick && onPick(r.itad_id, pick.checked));
    return h("div", { class: "wish" + (sale ? " sale" : "") },
      h("div", {}, h("div", { class: "name" }, pick, " ", r.priority ? "⭐ " : "", h("a", { href: "#/g/" + r.itad_id, class: "game-link", text: r.title }), " ", verdictBadge(r.verdict), r.owned ? h("span", { class: "badge none", text: "Owned" }) : ""), h("div", { class: "meta", text: `${r.source === "steam" ? "From Steam" : "Added by hand"} · alert: ${r.alert}${r.atl !== null ? " · all-time low " + money(r.atl, cur) : ""}${r.release_at ? " · releases " + new Date(r.release_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) + " (you will be told)" : ""}` })),
      h("div", { class: "price-box" },
        h("span", { class: "badge" + (sale ? "" : " none"), text: sale ? "-" + pct + "%" : "–" }),
        sale && r.regular !== null && h("span", { class: "was", text: money(r.regular, cur) }),
        h("span", { class: "now", text: best ? money(best.price, cur) : "no price" }),
        best && h("span", { class: "muted small", text: best.shop })),
      h("div", { class: "rule" }, ...ruleControl({ type: r.trigger_type, value: r.trigger_value }, async (type, value) => {
        await api("/api/wishlist/alert", { itad_id: r.itad_id, type, value });
        toast("Rule saved.", "ok"); reload();
      }), star, snooze, hist, remove), chartHolder);
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
    const minDisc = h("input", { type: "number", min: "0", max: "90", step: "5", value: String(s.min_discount || 0), class: "short-num", "aria-label": "Minimum discount percent" });
    const digest = h("input", { type: "checkbox", checked: s.digest });
    const digestDay = select(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => [String(i), d]), String(s.digest_day));
    const bundles = h("input", { type: "checkbox", checked: s.bundles });
    const share = h("input", { type: "checkbox", checked: s.share });
    const free = h("input", { type: "checkbox", checked: s.free });
    const freeDlc = h("input", { type: "checkbox", checked: s.free_dlc !== false });
    const freeNow = h("div", { class: "panel" }, h("h3", { text: "Free right now" }), h("p", { class: "muted", text: "Everything that is free to claim today has its own page now." }), h("a", { class: "btn blue small", href: "#/free", text: "Open Free games" }));
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
        bundles: bundles.checked, share: share.checked, free: free.checked, free_dlc: freeDlc.checked, min_discount: Number(minDisc.value || 0)
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
        field("Only alert for sales of at least this percent off (0 = any; starred games always come through)", minDisc),
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
        h("label", { class: "check" }, on, "Turn my page on"), field("Page name", slug), link,
        h("p", { class: "muted small", text: "Visitors can mark a game as “I’m gifting this” so nobody doubles up. You are never told who or which games, so the surprise stays." + (p.claims ? ` ${p.claims} ${p.claims === 1 ? "is" : "are"} claimed right now.` : "") }),
        p.claims ? h("button", { class: "btn gray small", text: "Clear gift marks", onclick: ev => busy(ev.currentTarget, async () => { const r = await api("/api/profile", { enabled: on.checked, slug: slug.value, resetClaims: true }); toast(`Cleared ${r.cleared}.`, "ok"); }) }) : "", h("p"), save);
    }).catch(e => panel.replaceChildren(h("h3", { text: "Public wishlist page" }), h("div", { class: "notice warn", text: e.message })));
    return panel;
  }

  // A random code that stands in for "me" on public wishlist pages, so I can undo a gift mark. Never tied to an account.
  let memoryCode = "";
  function giftCode() {
    try {
      let c = localStorage.getItem("svc-gift-code");
      if (!/^[A-Za-z0-9_-]{16,64}$/.test(c || "")) { c = randomCode(); localStorage.setItem("svc-gift-code", c); }
      return c;
    } catch { return memoryCode || (memoryCode = randomCode()); }
  }
  function randomCode() { const a = new Uint8Array(24); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function giftButton(g, slug) {
    const wrap = h("div", { class: "gift" });
    const draw = () => {
      if (g.claim === "taken") { wrap.replaceChildren(h("span", { class: "muted small", text: "🎁 Someone is already gifting this" })); return; }
      const b = h("button", { class: "btn gray small", text: g.claim === "mine" ? "🎁 You are gifting this (undo)" : "🎁 I’ll gift this" });
      b.addEventListener("click", () => busy(b, async () => {
        try {
          const r = await api("/api/public/gift", { slug, id: g.id, token: giftCode(), claim: g.claim !== "mine" });
          g.claim = r.claim; toast(g.claim === "mine" ? "Marked. Others will see someone is gifting this." : "Mark removed.", "ok");
        } catch (e) { toast(e.message, "error"); if (/already/.test(e.message)) g.claim = "taken"; }
        draw();
      }));
      wrap.replaceChildren(b);
    };
    draw();
    return wrap;
  }

  // One page per game: price, history and verdict, bundles, free offers and who in the server is watching it.
  async function gameView(id) {
    const holder = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(holder);
    try {
      const g = await api("/api/game?id=" + encodeURIComponent(id));
      const cur = g.currency;
      const tile = (k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: v }), sub ? h("div", { class: "s", text: sub }) : "");
      const good = g.advice && (g.advice.verdict === "buy" || g.advice.verdict === "lean_buy");
      const add = h("button", { class: "btn green", text: "Add to my wishlist" });
      add.addEventListener("click", () => busy(add, async () => { await api("/api/wishlist/add", { title: g.title }); toast("Added.", "ok"); add.hidden = true; }));
      holder.className = "";
      holder.replaceChildren(
        pageHead(g.title, g.release ? "Released " + new Date(g.release).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : ""),
        g.appid ? steamArt(g.appid, "next-art") : "",
        h("div", { class: "game-actions" }, g.url ? ext(g.url, "View the best deal", "btn green") : "", g.onWishlist || g.inLibrary ? h("span", { class: "chip ok", text: g.inLibrary ? "In your library" : "On your wishlist" }) : add),
        h("div", { class: "grid four" },
          tile("Best price now", g.price != null ? money(g.price, cur) : "–", g.shop || ""),
          tile("Steam", g.steam != null ? money(g.steam, cur) : "–", g.msrp ? "Regular " + money(g.msrp, cur) : ""),
          tile("All-time low", g.atl != null ? money(g.atl, cur) : "–"),
          tile("1-year low", g.low1y != null ? money(g.low1y, cur) : "–", g.low3m != null ? "3-month " + money(g.low3m, cur) : "")),
        g.advice ? h("div", { class: "notice " + (good ? "ok" : "warn") }, h("b", { text: (good ? "🟢 " : "🟠 ") + "Buy now or wait? " + g.advice.label + ". " }), g.advice.reasons.join(" ")) : "",
        g.points.length ? h("div", { class: "panel" }, h("h3", { text: "Price over the last year" }), lineChart([{ name: "Price", cls: "s0", points: g.points.map(p => ({ x: p.t, y: p.price })) }], { format: v => money(v, cur), label: "Price history for " + g.title })) : "",
        g.free.length ? h("div", { class: "panel" }, h("h3", { text: "🎁 Free right now" }), g.free.map(f => h("div", { class: "game-line" }, h("span", {}, h("b", { text: f.title }), " on " + f.shop), f.url ? ext(f.url, "Claim", "btn green small") : ""))) : "",
        g.bundles.length ? h("div", { class: "panel" }, h("h3", { text: "In a bundle" }), g.bundles.map(b => h("div", { class: "game-line" }, h("span", {}, h("b", { text: b.title }), ` (${b.shop || "bundle"}) from ${money(b.price, b.currency || cur)}`), b.url ? ext(b.url, "Open", "btn gray small") : ""))) : "",
        g.watchers ? h("p", { class: "muted", text: `👥 ${g.watchers} member${g.watchers === 1 ? "" : "s"} of your server ${g.watchers === 1 ? "is" : "are"} watching this (only people who opted in with /alerts share).` }) : "");
    } catch (e) { holder.className = ""; holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
  }

  async function publicWishlistView(slug) {
    const holder = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(holder);
    try {
      const d = await api("/api/public/wishlist?slug=" + encodeURIComponent(slug) + "&t=" + encodeURIComponent(giftCode()));
      const money2 = (n, c) => (n === null || n === undefined ? "-" : new Intl.NumberFormat(undefined, { style: "currency", currency: c || "USD" }).format(n));
      holder.className = "";
      holder.replaceChildren(pageHead(d.slug + "'s wishlist", `${d.games.length} game${d.games.length === 1 ? "" : "s"} with today's best prices. Thinking of a gift?`),
        d.games.length ? h("div", { class: "free-grid" }, d.games.map(g => h("div", { class: "free-card" },
          g.art ? h("img", { src: g.art, alt: "", loading: "lazy" }) : h("div", { class: "free-noart", text: "🎮" }),
          h("div", { class: "free-info" }, h("strong", { text: g.title }),
            h("span", { class: "muted small", text: (g.discount > 0 ? `${g.discount}% off • ` : "") + (g.shop || "") }),
            h("b", { text: money2(g.price, g.currency) }),
            g.url && ext(g.url, "View deal", "btn green small"), giftButton(g, d.slug))))) : h("div", { class: "empty", text: "Nothing on this list yet." }));
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
      let cat = "games", shop = "all", sort = "ending";
      const SORTS = { ending: (a, b) => (a.expiry || Infinity) - (b.expiry || Infinity) || a.title.localeCompare(b.title), name: (a, b) => a.title.localeCompare(b.title), store: (a, b) => a.shop.localeCompare(b.shop) || a.title.localeCompare(b.title) };
      const sortSel = select([["ending", "Ending soonest"], ["name", "A to Z"], ["store", "By store"]], sort);
      sortSel.addEventListener("change", () => { sort = sortSel.value; draw(); });
      const soon = g => g.expiry && g.expiry - Date.now() < 48 * 3600_000 && g.expiry > Date.now();
      const body = h("div");
      const tabs = h("div", { class: "tabs" });
      const draw = () => {
        const inCat = all.filter(g => cat === "all" || (cat === "dlc") === g.dlc);
        const shops = [...new Set(inCat.map(g => g.shop))];
        if (!shops.includes(shop)) shop = "all";
        tabs.replaceChildren(...[["games", "🎮 Games"], ...(d.showDlc ? [["dlc", "🧩 DLC"], ["all", "📋 All"]] : [])].map(([id, label]) =>
          h("button", { class: "tab" + (id === cat ? " active" : ""), text: `${label} (${all.filter(g => id === "all" || (id === "dlc") === g.dlc).length})`, onclick: () => { cat = id; draw(); } })));
        const rows = inCat.filter(g => shop === "all" || g.shop === shop).sort(SORTS[sort]);
        body.replaceChildren(...[
          shops.length > 1 ? h("div", { class: "chips" }, ["all", ...shops].map(x => h("button", { class: "tab small" + (x === shop ? " active" : ""), text: x === "all" ? "All stores" : x, onclick: () => { shop = x; draw(); } }))) : null,
          rows.length ? h("div", { class: "free-grid" }, rows.map(g => h("div", { class: "free-card" },
            g.art ? h("img", { src: g.art, alt: "", loading: "lazy" }) : h("div", { class: "free-noart", text: g.dlc ? "🧩" : "🎮" }),
            h("div", { class: "free-info" }, h("strong", { text: g.title }), g.dlc ? h("span", { class: "dlc-tag", text: "🧩 DLC" }) : null, g.dlc && g.base && g.baseOwned !== null ? h("span", { class: "own-note " + (g.baseOwned ? "yes" : "no"), text: (g.baseOwned ? "You own the base game" : "You don't own the base game") + " (" + g.base + ")" }) : null, h("span", { class: "muted small", text: g.shop + (g.dlc ? " • DLC" : "") + (g.expiry ? " • ends " + new Date(g.expiry).toLocaleDateString() : "") }), soon(g) ? h("span", { class: "chip warn", text: "⏰ Ending soon" }) : null,
              ext(g.url, "Claim", "btn green small"))))) : h("div", { class: "empty", text: "Nothing here right now." })].filter(Boolean));
      };
      draw();
      panel.replaceChildren(h("h3", { text: "Free right now" }), all.length ? h("div", {}, h("div", { class: "row free-bar" }, tabs, field("Sort", sortSel)), body) : h("div", { class: "empty", text: "Nothing is being given away right now." }),
        h("p", { class: "muted small", text: "Claiming happens on the store's site, where you need to be signed in." }));
    } catch (e) { panel.replaceChildren(h("h3", { text: "Free right now" }), h("div", { class: "notice warn", text: e.message })); }
  }

  // Free games: everything free to claim right now, with the store filter and sort, and the two settings that matter here.
  async function freeView() {
    const panel = h("div", { class: "panel" }, h("h3", { text: "Free right now" }), h("p", { class: "muted", text: "Loading…" }));
    const set = state.me.settings;
    const sw = (key, label, hint) => { const c = h("input", { type: "checkbox", checked: key === "free_dlc" ? set.free_dlc !== false : Boolean(set[key]) });
      c.addEventListener("change", async () => { try { const r = await api("/api/settings", { [key]: c.checked }); state.me.settings = r.settings; toast("Saved.", "ok"); if (key === "free_dlc") loadFree(panel); } catch (e) { toast(e.message, "error"); c.checked = !c.checked; } });
      return h("label", { class: "check" }, c, " ", h("b", { text: label }), " ", h("span", { class: "muted small", text: hint })); };
    app.replaceChildren(pageHead("Free games", "Everything that is free to claim right now on Steam, Epic, GOG and more. Claiming happens on the store's site."),
      h("div", { class: "panel" }, sw("free", "Tell me when a game goes free", "(sent by DM or to your alert channel)"), h("p"), sw("free_dlc", "Show free DLC", "(also hides it from /freegames)")),
      panel);
    loadFree(panel);
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
              h("p", { class: "muted", text: "Post new free games (not DLC) in the alert channel for everyone, once each. Needs an alert channel." }),
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
    const BOARDS = [["savings", "Most saved vs MSRP"], ["finished", "Backlog league (this month)"], ["hours", "Hours played this year"], ["games", "Biggest library"]];
    const pick = h("select", { "aria-label": "Leaderboard" }, BOARDS.map(([v, t]) => h("option", { value: v, text: t })));
    const list = h("div");
    const note = h("p", { class: "muted small" });
    async function load() {
      const which = pick.value;
      list.replaceChildren(h("div", { class: "muted", text: "Loading…" }));
      try {
        const d = await api("/api/servers/leaderboard?guild=" + encodeURIComponent(g.id) + (which === "savings" ? "" : "&board=" + which));
        const text = e => which === "savings" ? `${Math.round(e.savedPct)}% saved across ${e.games} games` : which === "finished" ? `${e.done} finished` : e.label;
        list.replaceChildren(d.entries.length ? h("ol", { class: "board" }, d.entries.map(e => h("li", {}, h("strong", { text: e.name + (e.you ? " (you)" : "") }), " " + text(e)))) : h("div", { class: "empty", text: "Nobody has joined yet." }));
        note.textContent = (d.joined ? "You are on the boards. " : "You are not on them. Opt in on the Alerts page (“Share with your server”). ") + (which === "savings" ? "Ranked by percent saved vs MSRP, since members shop in different currencies." : which === "hours" ? "Counts hours tracked since each member linked Steam." : "Only members who opted in.");
      } catch (e) { list.replaceChildren(h("div", { class: "empty", text: e.message })); }
    }
    pick.addEventListener("change", load);
    into.replaceChildren(h("div", { class: "subpanel" }, h("h4", { text: "Leaderboards" }), h("div", { class: "rule inline" }, pick), list, note));
    load();
  }

  // ---------- bundles and sale prep ----------
  async function dealsView() {
    const bundlesOut = h("div", { class: "muted", text: "Looking for bundles…" });
    const prepOut = h("div", { class: "muted", text: "Checking your wishlist…" });
    const recapOut = h("div");
    const game = h("input", { type: "text", placeholder: "A game (leave empty to check your wishlist)", maxlength: "100" });
    const budget = h("input", { type: "number", min: "1", max: "10000", step: "1", placeholder: "Budget (optional)" });
    const tone = l => (l === "great" || l === "good" ? "ok" : l === "wait" ? "warn" : "");
    async function loadBundles() {
      bundlesOut.className = "muted"; bundlesOut.replaceChildren("Looking for bundles…");
      try {
        const d = await api("/api/bundles" + (game.value.trim() ? "?game=" + encodeURIComponent(game.value.trim()) : ""));
        bundlesOut.className = "";
        if (!d.bundles.length) { bundlesOut.replaceChildren(h("div", { class: "empty", text: game.value.trim() ? "That game is not in an active bundle right now." : "None of your wishlist games are in an active bundle right now." })); return; }
        bundlesOut.replaceChildren(...d.bundles.map(b => h("div", { class: "panel" },
          h("h3", { text: b.title }),
          h("p", { class: "muted small", text: [b.shop, b.expiry ? "ends " + new Date(b.expiry).toLocaleDateString() : null].filter(Boolean).join(" · ") }),
          h("div", { class: "notice " + tone(b.verdict.level), text: b.verdict.text }),
          h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Tier", "Games", "You own", "Worth today", "Saves", "On your wishlist"].map(c => h("th", { text: c })))),
            h("tbody", {}, b.tiers.map(t => h("tr", {}, h("td", { class: "num", text: money(t.price, b.currency || d.currency) }), h("td", { class: "num", text: String(t.games) }), h("td", { class: "num", text: String(t.owned) }),
              h("td", { class: "num", text: t.worth > 0 ? money(t.worth, b.currency || d.currency) : "–" }), h("td", { class: "num", text: t.worth > 0 ? (t.saves >= 0 ? "+" : "−") + money(Math.abs(t.saves), b.currency || d.currency) : "–" }), h("td", { text: t.wanted.slice(0, 4).join(", ") })))))),
          b.url ? ext(b.url, "Open the bundle") : null,
          h("p", { class: "muted small", text: "Assumes each tier includes the cheaper ones and leaves out games you own." }))));
      } catch (e) { bundlesOut.className = ""; bundlesOut.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    async function loadPrep() {
      prepOut.className = "muted"; prepOut.replaceChildren("Checking your wishlist…");
      try {
        const d = await api("/api/saleprep" + (budget.value ? "?budget=" + encodeURIComponent(budget.value) : ""));
        prepOut.className = "";
        const cur = d.currency;
        const when = d.sale ? (d.sale.live ? d.sale.name + " is on now." : "Next: " + d.sale.name + " starts " + new Date(d.sale.start).toLocaleDateString() + ".") : "No Steam sale is on the calendar yet.";
        const list = (rows, f) => h("ul", { class: "plain" }, rows.map(r => h("li", {}, h("b", { text: r.title }), " ", h("span", { class: "muted", text: f(r) }))));
        prepOut.replaceChildren(h("p", { class: "muted", text: when + " Looked at " + d.watching + " wishlist games." }),
          h("div", { class: "grid two" },
            h("div", { class: "panel" }, h("h3", { text: "Buy now (" + d.buyNow.length + ")" }), d.buyNow.length ? list(d.buyNow, r => money(r.price, cur) + (r.discount > 0 ? " (-" + Math.round(r.discount * 100) + "%)" : "") + " · " + r.verdict) : h("p", { class: "muted", text: "Nothing at or near a low right now." })),
            h("div", { class: "panel" }, h("h3", { text: "Wait for a bigger drop (" + d.wait.length + ")" }), d.wait.length ? list(d.wait, r => money(r.price, cur) + ", has been " + money(r.atl, cur)) : h("p", { class: "muted", text: "Nothing far above its low." }))),
          d.plan ? h("div", { class: "panel" }, h("h3", { text: "With " + money(d.budget, cur) }), d.plan.picks.length ? list(d.plan.picks, r => money(r.price, cur)) : h("p", { class: "muted", text: "Nothing on the buy-now list fits that budget." }),
            h("p", { class: "muted small", text: money(d.plan.spent, cur) + " spent, " + money(d.plan.left, cur) + " left." })) : null);
      } catch (e) { prepOut.className = ""; prepOut.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    const recapBtn = h("button", { class: "btn gray", text: "Show sale recap", onclick: () => busy(recapBtn, async () => {
      const r = await api("/api/saleprep/recap");
      recapOut.replaceChildren(r.alerts ? h("div", { class: "panel" }, h("h3", { text: "Last " + r.days + " days" }), h("p", { text: "Your alerts caught " + r.games + " games, " + r.spend.toFixed(2) + " at the alert prices" + (r.saved > 0 ? ", " + r.saved.toFixed(2) + " under regular." : ".") }),
        h("ul", { class: "plain" }, r.top.map(a => h("li", {}, h("b", { text: a.title }), " ", h("span", { class: "muted", text: a.price.toFixed(2) + (a.regular ? " (was " + a.regular.toFixed(2) + ")" : "") + (a.shop ? " at " + a.shop : "") }))))) : h("div", { class: "empty", text: "No sale alerts in the last " + r.days + " days." }));
    }) });
    const checkBtn = h("button", { class: "btn blue", text: "Check bundles", onclick: () => busy(checkBtn, loadBundles) });
    const planBtn = h("button", { class: "btn blue", text: "Update plan", onclick: () => busy(planBtn, loadPrep) });
    const regionGame = h("input", { type: "text", placeholder: "A game, e.g. Hades", maxlength: "100" });
    const regionOut = h("div");
    const regionBtn = h("button", { class: "btn blue", text: "Compare regions", onclick: () => busy(regionBtn, async () => {
      const r = await api("/api/regions?game=" + encodeURIComponent(regionGame.value.trim()));
      const ranked = r.rows.some(x => x.usd !== null);
      regionOut.replaceChildren(h("div", { class: "panel" }, h("h3", { text: r.game + ": price by region" }),
        h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", { text: "Region" }), h("th", { text: "Cheapest" }), h("th", { text: ranked ? "In US dollars" : "" }), h("th", { text: "Shop" }))),
          h("tbody", {}, r.rows.map(x => h("tr", {}, h("td", { text: x.name + (x.home ? " (yours)" : "") }), h("td", { text: money(x.price, x.currency) }), h("td", { class: "muted", text: x.usd !== null && x.currency !== "USD" ? "about " + money(x.usd, "USD") : "" }), h("td", { text: x.shop })))))),
        h("p", { class: "muted small", text: "Keys and accounts are usually locked to the region they were sold in, so use this for information." })));
    }) });
    app.replaceChildren(pageHead("Deals", "Is a bundle worth it, and what to buy before the next Steam sale."),
      h("h2", { text: "Price by region" }), h("div", { class: "panel" }, field("Game", regionGame), h("p"), regionBtn), regionOut,
      h("h2", { text: "Bundle check" }), h("div", { class: "panel" }, field("Game", game), h("p"), checkBtn), bundlesOut,
      h("h2", { text: "Sale prep" }), h("div", { class: "panel" }, field("Budget", budget), h("p"), planBtn), prepOut,
      h("h2", { text: "Sale recap" }), recapBtn, recapOut);
    loadBundles(); loadPrep();
  }

  // ---------- steam link ----------
  // Steam game art. Newer games are not on the old path, so try the others in turn and show a quiet placeholder if none load.
  function steamArt(appid, cls, w, ht, itadId) {
    const urls = [...(appid ? [
      `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`,
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`,
      `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/capsule_231x87.jpg`,
      `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`,
      `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/capsule_616x353.jpg`,
      `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/library_hero.jpg`
    ] : []), ...(itadId ? [`https://assets.isthereanydeal.com/${encodeURIComponent(itadId)}/banner400.jpg`] : [])];
    if (!urls.length) return h("div", { class: cls + " art-missing", "aria-hidden": "true" });
    let i = 0;
    const img = h("img", { class: cls, src: urls[0], alt: "", loading: "lazy", ...(w ? { width: String(w), height: String(ht) } : {}) });
    img.addEventListener("error", () => {
      i += 1;
      if (i < urls.length) img.src = urls[i];
      else img.replaceWith(h("div", { class: cls + " art-missing", "aria-hidden": "true" }));
    });
    return img;
  }
  const hoursText = m => (m < 60 ? m + " min" : (m / 60).toFixed(m < 600 ? 1 : 0) + " h");
  // Hours tracked: this year per month and top games, plus the total since linking, and a card drawn on a canvas that can be saved as an image.
  function recapPanel() {
    const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const out = h("div", { class: "muted", text: "Loading…" });
    const tile = (k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: v }), sub ? h("div", { class: "s", text: sub }) : null);
    // A yearly hours goal: a bar, where this pace ends up, and a box to change it.
    function goalBox(g) {
      const input = h("input", { type: "number", min: "0", max: "5000", step: "1", placeholder: "Hours this year", value: g ? String(g.goal) : "", "aria-label": "Hours goal for this year" });
      const save = h("button", { class: "btn blue shrink", text: g ? "Update goal" : "Set goal" });
      save.addEventListener("click", () => busy(save, async () => { await api("/api/steam/goal", { hours: Number(input.value || 0) }); toast(Number(input.value) ? "Goal saved." : "Goal cleared.", "ok"); loadRecap(); }));
      return h("div", { class: "subpanel" }, h("h4", { text: "🎯 Hours goal" }),
        g ? h("div", {}, h("div", { class: "bar", role: "img", "aria-label": g.pct + "% of the goal" }, (() => { const f = h("div", { class: "fill" }); f.style.width = g.pct + "%"; return f; })()),
          h("p", { class: "small", text: `${g.done} of ${g.goal} hours (${g.pct}%).` + (g.reached ? " Goal reached 🎉" : ` On this pace: about ${g.projected} by the end of the year${g.projected >= g.goal ? ", so you are on track" : ""}. You need about ${g.perWeek} hours a week.`) }))
          : h("p", { class: "muted small", text: "Set a target for hours played this year and see if you are on pace." }),
        h("div", { class: "rule inline" }, input, save));
    }
    const loadRecap = async () => {
      try {
        const r = await api("/api/steam/recap");
        if (!r.allTime.totalMinutes) { out.className = ""; out.replaceChildren(h("p", { class: "muted", text: "Nothing tracked yet. Steam only shares lifetime hours per game, so this counts what you play after you link, as your library syncs (automatically every few hours)." }), goalBox(r.goal)); return; }
        const shot = h("div");
        const make = h("button", { class: "btn blue shrink", text: "Make my year-in-review image" });
        make.addEventListener("click", () => busy(make, async () => {
          const res = await fetch("/api/steam/recap.png", { credentials: "same-origin" });
          if (!res.ok) { let m = "Could not draw the picture."; try { m = (await res.json()).error || m; } catch { /* keep the default */ } throw new Error(m); }
          const url = URL.createObjectURL(await res.blob());
          shot.replaceChildren(h("img", { class: "recap-card", src: url, alt: `Hours played in ${r.year}: ${hoursText(r.totalMinutes)}` }), h("div", { class: "row" }, h("a", { class: "btn blue shrink", href: url, download: `my-${r.year}-in-games.png`, text: "Save image" })));
        }));
        const card = shot, save = make;
        out.className = "";
        out.replaceChildren(
          h("div", { class: "grid two" },
            tile("This year (" + r.year + ")", hoursText(r.totalMinutes), `${r.games} game${r.games === 1 ? "" : "s"} on ${r.activeDays} day${r.activeDays === 1 ? "" : "s"}`),
            tile("Since you linked", hoursText(r.allTime.totalMinutes), `${r.allTime.games} game${r.allTime.games === 1 ? "" : "s"} on ${r.allTime.activeDays} day${r.allTime.activeDays === 1 ? "" : "s"}, from ${new Date(r.since).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`)),
          goalBox(r.goal), card, h("div", { class: "row" }, save));
      } catch (e) { out.className = ""; out.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    };
    loadRecap();
    return h("div", { class: "panel" }, h("h3", { text: "⏱️ Hours tracked since you linked" }),
      h("p", { class: "muted small", text: "Steam only tells us lifetime hours per game, not when you played them. So this counts the hours you add after linking, as your library syncs. It can't show anything from before you linked. Save it as an image to share." }),
      out);
  }

  // A Steam profile card: picture, name, where and since when, and a link to the real profile. `actions` are extra buttons.
  function steamProfileCard(c, ...actions) {
    const dot = c.playing ? null : { online: "🟢 Online", offline: "⚫ Offline", "in-game": "🎮 In a game" }[c.status];
    const meta = [dot, c.memberSince ? "On Steam since " + c.memberSince : null].filter(Boolean).join(" · ");
    return h("div", { class: "panel sc-card" },
      c.avatar ? h("img", { class: "sc-avatar", src: c.avatar, alt: "", width: "72", height: "72", referrerpolicy: "no-referrer", loading: "lazy" }) : h("div", { class: "sc-avatar sc-none", text: "👤" }),
      h("div", { class: "sc-info" },
        h("h3", { text: c.name }),
        c.playing ? h("div", { class: "sc-playing", text: "🎮 Playing " + c.playing }) : null,
        meta ? h("div", { class: "muted small", text: meta }) : null),
      h("div", { class: "sc-actions" }, h("a", { class: "btn gray small", href: safeHref(c.url), target: "_blank", rel: "noopener noreferrer", text: "Open on Steam ↗" }), ...actions));
  }

  // Library analytics for a synced Steam library: tiles, hours by genre, played vs backlog, most played.
  function analyticsPanel(cur, st) {
    const box = h("div", { class: "analytics" });
    const tile = (k, v, sub, hot) => h("div", { class: "a-tile" + (hot ? " hot" : "") }, h("div", { class: "k", text: k }), h("div", { class: "v", text: v }), h("div", { class: "s", text: sub || "" }));
    let tries = 0;
    async function load() {
      try {
        const a = await api("/api/steam/analytics");
        const maxH = Math.max(1, ...a.genres.map(g => g.hours));
        const bar = (pct, cls = "") => { const f = h("div", { class: "a-fill " + cls }); f.style.width = Math.max(1, Math.min(100, pct)) + "%"; return h("div", { class: "a-track" }, f); }; // set through the DOM: the CSP forbids style attributes
        box.replaceChildren(
          h("div", { class: "a-tiles" },
            tile("Games", String(a.games), "in your library"),
            tile("Hours played", a.hours.toLocaleString(), "lifetime"),
            tile("Collection value", a.value ? money(a.value.msrp, a.currency) : "-", "est. retail"),
            tile("Played", String(a.played), `of ${a.games} · ${a.playedPct}%`, true),
            st && st.value && st.value.achTotal ? tile("Achievements", `${st.value.achDone.toLocaleString()}`, `of ${st.value.achTotal.toLocaleString()}`) : tile("Backlog", String(a.backlog), "never started")),
          h("div", { class: "a-grid" },
            h("div", { class: "panel" }, h("h3", { text: "Hours played by genre" }),
              h("p", { class: "muted small", text: "Ranked by time played. Games can span several genres, so hours overlap." }),
              a.genres.length ? a.genres.map(g => h("div", { class: "a-row" }, h("div", { class: "a-name", text: g.name }), h("div", { class: "a-meta", text: `${g.hours.toLocaleString()} hrs · ${g.games} games` }), bar(g.hours / maxH * 100)))
                : h("p", { class: "muted", text: "Reading genres from Steam…" }),
              a.pending ? h("p", { class: "muted small", text: `Still reading genres for ${a.pending} games…` }) : null),
            h("div", { class: "panel" }, h("h3", { text: "Played vs backlog" }),
              h("div", { class: "a-big", text: a.playedPct + "%" }), h("div", { class: "muted small", text: "of your library played" }),
              bar(a.playedPct),
              h("div", { class: "a-split" }, h("span", {}, h("b", { text: String(a.played) }), " played"), h("span", {}, h("b", { text: String(a.backlog) }), " in backlog")))),
          a.mostPlayed.length ? h("div", { class: "panel" }, h("h3", { text: "Most played" }),
            h("div", { class: "a-most" }, a.mostPlayed.map(g => h("div", { class: "a-game" }, steamArt(g.appid, "a-art", 460, 215, g.itad_id), h("div", { class: "a-cap" }, h("b", { text: g.title }), h("span", { text: g.hours.toLocaleString() + " hrs" })))))) : null);
        if (a.pending && tries++ < 80) setTimeout(() => { if (box.isConnected) load(); }, 3000);
      } catch (e) { box.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    load();
    return box;
  }

  async function steamView() {
    const out = h("div", { class: "muted", text: "Loading…" });
    const profile = h("input", { type: "text", placeholder: "Steam profile link, custom name or SteamID64", maxlength: "200" });
    const linkBtn = h("button", { class: "btn blue", text: "Link and import", onclick: () => busy(linkBtn, async () => {
      const r = await api("/api/steam/link", { profile: profile.value });
      state.artForce = true;
      toast(`Found ${r.owned} games` + (r.value && r.value.games ? ` worth ${money(r.value.msrp, r.value.currency)}` : "") + `. Added ${r.added}, updated ${r.updated}.` + (r.unmatched ? ` ${r.unmatched} had no price match.` : ""), "ok"); load();
    }) });
    // Look up anyone's public profile. Nothing is saved; it just shows their card and play stats.
    const found = h("div");
    const q = h("input", { type: "text", placeholder: "Steam profile link, custom name or SteamID64", maxlength: "200", "aria-label": "Steam profile to look up" });
    const findBtn = h("button", { class: "btn blue", text: "Look up", onclick: () => busy(findBtn, async () => {
      const r = await api("/api/steam/lookup?profile=" + encodeURIComponent(q.value));
      const st = r.stats, tile = (k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: v }), sub && h("div", { class: "s", text: sub }));
      const linkIt = !state.steamLinked && !r.mine ? h("button", { class: "btn green small", type: "button", text: "Link this profile", onclick: e => busy(e.currentTarget, async () => { await api("/api/steam/link", { profile: r.card.steamid }); toast("Linked.", "ok"); load(); }) }) : null;
      found.replaceChildren(steamProfileCard(r.card, linkIt),
        h("div", { class: "grid four" }, tile("Games", String(st.games), st.playedGames + " played"), tile("Hours played", hoursText(st.totalMinutes)), tile("Barely played", String(st.barely), "under an hour each")),
        st.mostPlayed.length ? h("div", { class: "panel" }, h("h3", { text: "Most played" }), h("ul", { class: "plain" }, st.mostPlayed.map(g => h("li", {}, h("b", { text: g.title }), " ", h("span", { class: "muted", text: hoursText(g.minutes) }))))) : null,
        h("p", { class: "muted small", text: "Only what their public profile shows. Nothing is saved." }));
    }) });
    q.addEventListener("keydown", e => { if (e.key === "Enter") findBtn.click(); });
    const lookup = h("div", {}, h("div", { class: "panel" }, h("h3", { text: "Look up a profile" }), field("Any public Steam profile", q), h("p"), findBtn,
      h("p", { class: "muted small", text: "See someone's card, games and hours. Nothing is saved." })), found);
    const linkPanel = h("div", { class: "panel steam-hero" }, h("h3", { text: "Sign in through Steam" }),
      h("p", { class: "muted", text: "One click and your library, hours played and taste profile fill in on their own. You sign in on Steam's own page; the bot never sees your password and only keeps your public ID." }),
      h("div", { class: "row" }, steamLoginBtn("Sign in through Steam", "btn steam big")),
      h("p", { class: "muted small", text: "Set Game details to Public in Steam's privacy settings so your games can be read." }),
      h("details", { class: "paste" }, h("summary", { text: "Use a profile link instead" }), field("Steam profile", profile), h("p"), linkBtn),
      h("div", { class: "lr-option" }, h("b", { text: "Or connect it through Discord Linked Roles" }),
        h("p", { class: "muted small", text: "Signs you in with Discord and Steam in one go, and shows Steam Verified, your games owned and hours on your Discord profile, so servers can give roles for it." }),
        h("a", { class: "btn gray", href: "/auth/linked", text: "Connect with Linked Roles" })));
    // Once Steam is linked: show what Discord will display, and let the member (re)connect it.
    const linkedRolesPanel = () => {
      const box = h("div", { class: "panel" }, h("h3", { text: "Discord Linked Roles" }), h("p", { class: "muted", text: "Loading…" }));
      api("/api/steam/linkedroles").then(r => {
        const pv = r.preview;
        box.replaceChildren(h("h3", { text: "Discord Linked Roles" }),
          h("p", { class: "muted", text: "Show your Steam on your Discord profile. Servers can then give roles to people who are Steam Verified, own enough games or have enough hours. Discord only shows what you connect here." }),
          pv ? h("p", {}, h("b", { text: "What Discord will show: " }), `Steam Verified ${pv.steam_verified ? "✅" : "❌ (sign in through Steam to verify)"} · ${pv.games_owned.toLocaleString()} games · ${pv.hours_played.toLocaleString()} hours`) : null,
          r.available ? h("div", { class: "row" }, h("a", { class: "btn blue", href: r.url, text: "Connect or update Linked Roles" })) : h("p", { class: "muted", text: "Linked Roles is not available on this bot." }),
          h("p", { class: "muted small", text: "Press it again after a sync to refresh your games and hours on your profile. Your normal Steam link works the same either way." }));
      }).catch(() => box.replaceChildren());
      return box;
    };
    const slot = h("div");
    async function load() {
      try {
        const d = await api("/api/steam");
        state.steamLinked = !!d.link;
        state.me.steam = d.link ? { linked: true, verified: Boolean(d.link.verified), synced: Boolean(d.link.synced_at) } : { linked: false };
        if (d.link && autoFillArt(d.card, d.stats, state.artForce)) toast("Updated your profile card picture and banner from Steam.", "ok");
        state.artForce = false;
        // Linked: the look-up takes the link box's place. Not linked: link first, look-up below.
        slot.replaceChildren(...(d.link ? [d.link.verified ? null : h("div", { class: "notice" }, "This profile was added from a link. ", steamLoginBtn("Verify with Steam", "btn steam small"), " Verified accounts can sign in with Steam and need no links."), lookup].filter(Boolean) : [linkPanel, lookup]));
        if (!d.link) { out.className = ""; out.replaceChildren(h("div", { class: "empty", text: "No Steam profile linked yet. Your Game details must be public on Steam for this to work." })); return; }
        const st = d.stats, cur = d.currency;
        const tile = (k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: v }), sub && h("div", { class: "s", text: sub }));
        const list = (rows, f) => h("ul", { class: "plain" }, rows.map(r => h("li", {}, h("b", { text: r.title }), " ", f(r))));
        const sync = h("button", { class: "btn gray", text: "Sync now", onclick: () => busy(sync, async () => { const r = await api("/api/steam/sync", {}); state.artForce = true; toast(`Synced ${r.owned} games.` + (r.achievements && r.achievements.checked ? ` Checked achievements for ${r.achievements.checked}` + (r.achievements.newlyFinished ? `, ${r.achievements.newlyFinished} marked Finished.` : ".") : ""), "ok"); load(); }) });
        const unlinkGames = h("input", { type: "checkbox" });
        const unlink = h("button", { class: "btn red", text: "Unlink", onclick: () => busy(unlink, async () => { const r = await api("/api/steam/unlink", { removeGames: unlinkGames.checked }); toast(r.removed ? `Unlinked, and removed ${r.removed} games.` : "Unlinked.", "ok"); load(); }) });

        // What to play next: a pick from your own library. "Pick another" never repeats one already offered.
        const offered = [];
        const nextOut = h("div");
        const nextBtn = h("button", { class: "btn green", text: "What should I play next?" });
        async function pickNext() {
          const q = offered.length ? "?skip=" + encodeURIComponent(offered.join(",")) : "";
          const r = await api("/api/steam/next" + q);
          if (!r.next) { nextOut.replaceChildren(h("div", { class: "notice warn", text: offered.length ? "That is everything. Start over to see them again." : "Nothing left to suggest. Everything is finished or dropped." })); offered.length = 0; nextBtn.textContent = "What should I play next?"; return; }
          const n = r.next;
          offered.push(n.pick.itad_id);
          nextBtn.textContent = "Pick another";
          nextOut.replaceChildren(h("div", { class: "panel" },
            n.pick.appid ? steamArt(n.pick.appid, "next-art") : null,
            h("h3", { text: "🎯 " + n.pick.title }), h("p", { class: "muted", text: n.why }),
            n.others.length ? h("p", { class: "muted small", text: "Also good: " + n.others.map(o => o.title).join(", ") }) : null,
            h("p", { class: "muted small", text: n.remaining ? `${n.remaining} more to choose from.` : "That is everything left that you have not finished." })));
        }
        nextBtn.addEventListener("click", () => busy(nextBtn, pickNext));

        out.className = "";
        const valueImageBtn = h("button", { class: "btn gray small", type: "button", text: "Save as image", title: "The same picture /steam value posts in Discord", onclick: e => busy(e.currentTarget, async () => {
          const res = await fetch("/api/steam/value.png", { credentials: "same-origin" });
          if (!res.ok) { let m = "Could not draw the picture."; try { m = (await res.json()).error || m; } catch { /* keep the default */ } throw new Error(m); }
          const url = URL.createObjectURL(await res.blob()), a = h("a", { href: url, download: "steam-account-value.png" }); a.click(); setTimeout(() => URL.revokeObjectURL(url), 4000);
        }) });
        const quickUnlink = h("button", { class: "btn red small", type: "button", text: "Unlink", title: "Unlink this profile (your games stay unless you remove them under Manage)", onclick: () => { if (confirm("Unlink this Steam profile? Your library games stay.")) busy(quickUnlink, async () => { await api("/api/steam/unlink", { removeGames: false }); toast("Unlinked.", "ok"); load(); }); } });
        out.replaceChildren(
          d.card ? steamProfileCard(d.card, quickUnlink) : null,
          analyticsPanel(cur, st),
          h("div", { class: "panel" }, h("div", { class: "panel-head" }, h("h3", { text: "💰 Estimated account value" }), valueImageBtn),
            h("div", { class: "grid four" },
              tile("At full price", money(st.value.msrp, cur), "list price today"),
              tile("At today's cheapest", money(st.value.cheapest, cur), "best current deal"),
              st.value.atl ? tile("At all-time lows", money(st.value.atl, cur), "if bought at the lowest ever") : null),
            st.value.achTotal ? h("p", { class: "muted small", text: `Achievements: ${st.value.achDone.toLocaleString()} of ${st.value.achTotal.toLocaleString()} unlocked across ${st.value.achGames} games.` }) : null,
            st.value.top.length ? h("p", { class: "muted small", text: "Most valuable: " + st.value.top.map(r => `${r.title} (${money(r.msrp, cur)})`).join(", ") }) : null,
            h("p", { class: "muted small", text: `${st.value.priced} of ${d.link.games} games priced. An estimate from current prices, not what was paid. Free, removed or unlisted games are not counted.` })),
          recapPanel(),
          h("div", { class: "panel" }, h("h3", { text: "What should I play next?" }),
            h("p", { class: "muted small", text: "A pick from your own library: what you are playing, games you started and never finished, then the most valuable ones you never touched." }), nextBtn),
          nextOut,
          h("div", { class: "grid two" },
            st.unplayedTop.length ? h("div", { class: "panel" }, h("h3", { text: "Biggest unplayed" }), list(st.unplayedTop, r => h("span", { class: "muted", text: r.msrp ? money(r.msrp, cur) : "no price" }))) : null),
          h("p", { class: "muted small", text: "Last synced " + (d.link.synced_at ? new Date(d.link.synced_at).toLocaleString() : "never") + ". Steam does not share what you paid. The FanaticalGrabber extension can fill it in from your Steam purchase history (open store.steampowered.com/account/history and press Send what I paid), or add it on the Library page." }),
          linkedRolesPanel(),
          h("div", { class: "panel" }, h("h3", { text: "Manage" }), h("div", { class: "row" }, sync), h("p"), h("label", { class: "check" }, unlinkGames, " Also remove the games that came from Steam"), h("p"), unlink));
      } catch (e) { out.className = ""; out.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    app.replaceChildren(pageHead("Steam", "Sign in through Steam to fill your library automatically: your games, hours played, what you never played and what to play next."),
      slot, out);
    if (/[?&]linked=1/.test(location.hash)) {
      // Just came back from Steam: read the library straight away, then tidy the address.
      history.replaceState(null, "", "#/steam");
      out.className = "muted"; out.textContent = "Reading your Steam library…";
      api("/api/steam/sync", {}).then(r => { state.artForce = true; state.me.steam = { linked: true, verified: true, synced: true }; toast(`Signed in. Found ${r.owned} games` + (r.value && r.value.games ? ` worth ${money(r.value.msrp, r.value.currency)}` : "") + ".", "ok"); }).catch(e => toast(e.message, "error")).finally(load);
    } else load();
  }

  // ---------- batch redeem ----------
  // Steam only takes keys from the owner's logged-in browser, so the FanaticalGrabber extension does the redeeming.
  // Keys travel page -> extension -> Steam in this browser. They are never sent to the dashboard's server.
  function redeemView() {
    const KEY_G = /\b[A-Z0-9]{5}(?:-[A-Z0-9]{5}){2}\b/gi;
    const WORDS = { redeemed: ["Redeemed", "ok"], owned: ["Already owned", "none"], used: ["Already used", "none"], invalid: ["Invalid", "bad"], region: ["Wrong region", "bad"], needs_base: ["Needs base game", "bad"], not_logged_in: ["Not logged in", "bad"], rate_limited: ["Rate limited", "bad"], error: ["Error", "bad"] };
    const box = h("textarea", { placeholder: "Paste keys here, one per line or mixed with other text.\nAAAAA-BBBBB-CCCCC", maxlength: "60000", autocomplete: "off", spellcheck: "false", rows: "8" });
    const file = h("input", { type: "file", accept: ".txt,.csv,.json,.md" });
    file.addEventListener("change", async () => {
      const f = file.files[0];
      if (!f) return;
      if (f.size > 200000) { toast("That file is too large (200 KB max).", "error"); file.value = ""; return; }
      box.value = (box.value ? box.value + "\n" : "") + await f.text();
      file.value = ""; refresh();
    });
    const found = h("p", { class: "muted small", text: "No keys yet." });
    const extState = h("div", { class: "notice", text: "Looking for the FanaticalGrabber extension…" });
    const go = h("button", { class: "btn green", text: "Redeem on Steam", disabled: true });
    const stop = h("button", { class: "btn red", text: "Stop", hidden: true });
    const progress = h("p", { class: "muted small" });
    const tbody = h("tbody");
    const table = h("div", { class: "table-wrap", hidden: true }, h("table", {}, h("thead", {}, h("tr", {}, h("th", { text: "Key" }), h("th", { text: "Result" }), h("th", { text: "Game" }))), tbody));
    const tools = h("p", { hidden: true });
    let ext = null, extFound = false, jobId = null, rows = new Map(), running = false, queued = null, outcomes = [];
    const queuedBox = h("div", { class: "notice", hidden: true });
    // The key vault: keys the extension saw when you revealed them on Fanatical and has not redeemed yet. Only titles are priced.
    const vaultBox = h("div", { class: "panel", hidden: true });
    function showVault(items) {
      if (!items.length) { vaultBox.hidden = true; return; }
      const worth = h("span", { class: "muted small", text: "" });
      const priceBtn = h("button", { class: "btn gray small", text: "What are they worth?" });
      priceBtn.addEventListener("click", () => busy(priceBtn, async () => {
        const r = await api("/api/vault/value", { titles: items.map(i => i.title) });
        worth.textContent = ` About ${money(r.fullPrice, r.currency)} at full price, ${money(r.cheapestNow, r.currency)} at today's cheapest prices (${r.matched} of ${items.length} matched).`;
      }));
      const load = h("button", { class: "btn blue small", text: `Load ${items.length} into the box` });
      load.addEventListener("click", () => { box.value = [...new Set([...keysIn(), ...items.map(i => i.key)])].join("\n"); refresh(); toast("Loaded. Press Redeem when you are ready.", "ok"); });
      vaultBox.hidden = false;
      vaultBox.replaceChildren(h("h3", { text: "🗝️ Key vault" }),
        h("p", { class: "muted small", text: `${items.length} key${items.length === 1 ? "" : "s"} you revealed on Fanatical and have not redeemed. They stay in your browser; only the game titles are used to price them.` }),
        h("ul", { class: "plain" }, items.slice(0, 8).map(i => h("li", {}, h("b", { text: i.title }), " ", h("code", { text: mask(i.key) })))),
        items.length > 8 ? h("p", { class: "muted small", text: `and ${items.length - 8} more` }) : "",
        h("div", { class: "row" }, priceBtn, load), worth);
    }
    const keysIn = () => [...new Set((box.value.match(KEY_G) || []).map(k => k.toUpperCase()))].slice(0, 500);
    const MIN_EXT = "2.3.0"; // the first FanaticalGrabber version with the page bridge
    const versionLess = (a, b) => { const x = String(a).split(".").map(n => parseInt(n, 10) || 0), y = String(b).split(".").map(n => parseInt(n, 10) || 0); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); } return false; };
    const getLink = () => (state.cfg && state.cfg.fanaticalUrl ? h("a", { href: safeHref(state.cfg.fanaticalUrl), target: "_blank", rel: "noopener noreferrer", text: "Get it here" }) : "");
    const recheck = () => { const b = h("button", { class: "btn gray small", text: "Check again" }); b.addEventListener("click", () => { window.postMessage({ svc: "page", type: "ping" }, location.origin); setTimeout(() => { if (!ext) b.textContent = "Still not detected. Reload this page after updating."; }, 800); }); return b; };
    const mask = k => k.slice(0, 5) + "-•••••-" + k.slice(-5);
    function refresh() {
      const n = keysIn().length;
      found.textContent = n ? `${n} Steam key${n === 1 ? "" : "s"} found${n === 500 ? " (500 is the most per batch)" : ""}.` : "No keys yet.";
      go.disabled = !ext || running || !n;
    }
    function onMsg(e) {
      if (e.source !== window || e.origin !== location.origin) return;
      const m = e.data;
      if (!m || m.svc !== "ext") return;
      if (m.type === "vault") { showVault(m.items || []); return; }
      if (m.type === "pong") {
        if (versionLess(m.version, MIN_EXT)) {
          ext = null; extFound = true;
          extState.className = "notice warn";
          extState.replaceChildren(`Your FanaticalGrabber is version ${String(m.version).slice(0, 12)}, but batch redeem needs ${MIN_EXT} or newer. Update it from the Chrome Web Store, or use the latest .zip, then reload this page. `, getLink(), " ", recheck());
        } else {
          ext = m.version; extFound = true;
          extState.className = "notice ok";
          extState.textContent = `FanaticalGrabber ${ext} is ready. Make sure you are logged into Steam in this browser.`;
        }
        refresh();
        if (ext) window.postMessage({ svc: "page", type: "vault" }, location.origin);
        return;
      }
      if (m.id !== jobId) return;
      if (m.type === "busy") { running = false; stop.hidden = true; progress.textContent = "The extension is already redeeming a batch. Wait for it to finish."; refresh(); return; }
      if (m.type === "result") {
        outcomes.push({ key: m.key, status: m.status, message: m.message, game: m.game });
        const tr = rows.get(m.key);
        const [word, tone] = WORDS[m.status] || WORDS.error;
        if (tr) { tr.cells[1].replaceChildren(h("span", { class: "badge " + (tone === "ok" ? "" : "none"), text: word }), m.message && m.status !== "redeemed" ? h("span", { class: "muted small", text: " " + m.message }) : ""); tr.cells[2].textContent = m.game || ""; tr.dataset.status = m.status; }
        progress.textContent = `Redeeming ${m.index + 1} of ${m.total}. About 3 seconds between keys so Steam does not block you.`;
        return;
      }
      if (m.type === "done") {
        running = false; stop.hidden = true;
        const c = s => [...rows.values()].filter(r => r.dataset.status === s).length;
        const left = [...rows.values()].filter(r => !r.dataset.status).length;
        progress.textContent = (m.aborted ? m.aborted + " " : "") + `${c("redeemed")} redeemed, ${c("owned") + c("used")} owned or used, ${c("invalid") + c("region") + c("needs_base") + c("error")} failed${left ? `, ${left} not tried` : ""}.`;
        tools.hidden = false;
        refresh();
        if (queued && queued.running) {
          const q = queued; queued = null;
          api("/api/redeem/finish", { id: q.id, results: outcomes, aborted: m.aborted || "" })
            .then(r => { progress.textContent += r.dm ? " The results are in your Discord DMs." : " The results are in your Notifications."; loadHistory(); })
            .catch(e => toast(e.message, "error"));
        } else {
          api("/api/redeem/log", { results: outcomes }).then(loadHistory).catch(() => {});
        }
      }
    }
    window.addEventListener("message", onMsg);
    // The page only lives while this view is open: stop listening once the route changes.
    window.addEventListener("hashchange", () => window.removeEventListener("message", onMsg), { once: true });
    window.postMessage({ svc: "page", type: "ping" }, location.origin);
    setTimeout(() => { if (!extFound) { extState.className = "notice warn"; extState.replaceChildren(`The FanaticalGrabber extension was not detected. Install it, or update it if it is older than ${MIN_EXT} (older versions cannot take keys from this page), then reload this page. `, getLink(), " ", recheck()); } }, 1500);
    box.addEventListener("input", refresh);
    async function start(keys, fromQueue) {
      if (!keys.length || !ext) return;
      const skipped = [];
      try {
        const { known } = await api("/api/redeem/check", { keys });
        for (const k of keys) if (known[k]) skipped.push({ key: k, status: known[k].status, game: known[k].game || "", message: "Already handled earlier" });
        if (skipped.length) { toast(`Skipping ${skipped.length} key${skipped.length === 1 ? "" : "s"} you already redeemed.`, "ok"); keys = keys.filter(k => !known[k]); }
      } catch { /* the check is a convenience */ }
      if (!keys.length) { if (queued && fromQueue) api("/api/redeem/finish", { id: queued.id, results: skipped, aborted: "" }).catch(() => {}); return; }
      if (!confirm(`Are you logged into Steam in this browser? Redeem ${keys.length} key${keys.length === 1 ? "" : "s"} on that account? Redeeming cannot be undone.`)) return;
      if (queued) queued.running = Boolean(fromQueue);
      jobId = "r" + Math.random().toString(36).slice(2);
      rows = new Map(); outcomes = skipped.slice(); tbody.replaceChildren(); tools.hidden = true;
      for (const k of keys) { const tr = h("tr", {}, h("td", {}, h("code", { text: mask(k) })), h("td", { class: "muted", text: "Waiting" }), h("td")); rows.set(k, tr); tbody.append(tr); }
      table.hidden = false; running = true; stop.hidden = false; progress.textContent = "Starting…"; refresh();
      window.postMessage({ svc: "page", type: "redeem", id: jobId, items: keys }, location.origin);
    }
    go.addEventListener("click", () => start(keysIn(), false));
    // A batch queued with /redeem in Discord: shown here, started only when the member presses Run.
    async function checkQueue() {
      if (running || queued) return;
      try {
        const { job } = await api("/api/redeem");
        if (!job || running) return;
        queued = { id: job.id, keys: job.keys, running: false };
        const run = h("button", { class: "btn green", text: "Run", disabled: !ext });
        run.addEventListener("click", () => { box.value = job.keys.join("\n"); refresh(); start(job.keys, true); });
        const drop = h("button", { class: "btn gray", text: "Cancel batch" });
        drop.addEventListener("click", () => busy(drop, async () => { await api("/api/redeem/finish", { cancel: true }); queued = null; queuedBox.hidden = true; toast("Batch cancelled.", "ok"); }));
        queuedBox.hidden = false; queuedBox.className = "notice ok";
        queuedBox.replaceChildren(h("strong", { text: `${job.total} key${job.total === 1 ? "" : "s"} queued from Discord. ` }), "Log into Steam in this browser, then press Run. Results go to your Discord DMs. ", run, " ", drop);
      } catch { /* not signed in or offline: the page still works by hand */ }
    }
    checkQueue();
    const poll = setInterval(checkQueue, 20000);
    window.addEventListener("hashchange", () => clearInterval(poll), { once: true });
    stop.addEventListener("click", () => { window.postMessage({ svc: "page", type: "stop", id: jobId }, location.origin); progress.textContent = "Stopping after the current key…"; });
    const copyBtn = h("button", { class: "btn gray", text: "Copy results" });
    copyBtn.addEventListener("click", async () => {
      const lines = [...rows.entries()].map(([k, tr]) => `${k}\t${tr.dataset.status || "not tried"}\t${tr.cells[2].textContent}`);
      try { await navigator.clipboard.writeText(lines.join("\n")); toast("Copied.", "ok"); } catch { toast("Could not copy.", "error"); }
    });
    const addBtn = h("button", { class: "btn blue", text: "Add redeemed games to my library" });
    addBtn.addEventListener("click", () => busy(addBtn, async () => {
      const entries = [...rows.values()].filter(r => r.dataset.status === "redeemed" && r.cells[2].textContent).map(r => ({ title: r.cells[2].textContent }));
      if (!entries.length) throw new Error("No redeemed games with a name to add.");
      const r = await api("/api/library/import", { entries });
      toast(`Added ${r.added != null ? r.added : entries.length} to your library.`, "ok");
    }));
    tools.append(copyBtn, " ", addBtn);
    const histOut = h("div", { class: "muted small", text: "Loading…" });
    async function loadHistory() {
      try {
        const d = await api("/api/redeem/history");
        if (!d.entries.length) { histOut.className = "muted small"; histOut.replaceChildren("Nothing yet. Keys you redeem here are listed with a masked hint. The keys themselves are never kept."); return; }
        const W = { redeemed: "Redeemed", owned: "Already owned", used: "Already used", invalid: "Invalid" };
        const clear = h("button", { class: "btn gray small", text: "Clear history" });
        clear.addEventListener("click", () => busy(clear, async () => { await api("/api/redeem/history/clear", {}); loadHistory(); }));
        histOut.className = "";
        histOut.replaceChildren(
          h("p", { class: "muted small", text: `${d.counts.redeemed} redeemed, ${d.counts.owned + d.counts.used} already owned or used, ${d.counts.invalid} invalid. Pasted keys that appear here are skipped automatically.` }),
          h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", { text: "Key" }), h("th", { text: "Result" }), h("th", { text: "Game" }), h("th", { text: "When" }))),
            h("tbody", {}, d.entries.slice(0, 50).map(e => h("tr", {}, h("td", {}, h("code", { text: e.hint })), h("td", { text: W[e.status] || e.status }), h("td", { text: e.game || "" }), h("td", { class: "muted", text: new Date(e.at).toLocaleDateString() })))))),
          h("p", {}, clear));
      } catch (e) { histOut.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    loadHistory();
    refresh();
    app.replaceChildren(
      pageHead("Batch redeem", "Paste Steam keys and redeem them all in one go."),
      vaultBox, h("div", { class: "panel" }, extState, queuedBox,
        h("div", { class: "notice warn", text: "Before you start: log into Steam in this browser (store.steampowered.com). Keys are redeemed on the account you are logged into there." }),
        h("p", { class: "muted small", text: "Steam only accepts keys from your own logged-in browser, and a website cannot use that login by itself. The FanaticalGrabber extension can, so this page hands the keys to it. Your keys go from this page to the extension to Steam. They are never sent to this site's server." }),
        field("Steam keys", box), field("Or add a file (.txt, .csv, .json)", file), found, h("p", {}, go, " ", stop), progress),
      h("div", { class: "panel", hidden: false }, h("h3", { text: "Results" }), table, tools,
        h("p", { class: "muted small", text: "Steam allows around 50 attempts an hour. If it blocks you, the batch stops and you can retry the rest later. Keys already handled are skipped." })),
      h("div", { class: "panel" }, h("h3", { text: "History" }), histOut));
  }

  // ---------- library ----------
  // Monthly backlog challenge: a goal, a progress bar and a streak.
  function challengePanel() {
    const out = h("div");
    function draw(c) {
      const goal = h("input", { type: "number", min: "0", max: "20", value: String(c.goal || 3), class: "short-num", "aria-label": "Games to finish this month" });
      const save = h("button", { class: "btn green small shrink", text: c.goal ? "Change goal" : "Start the challenge" });
      save.addEventListener("click", () => busy(save, async () => { draw(await api("/api/library/challenge", { goal: Number(goal.value) })); toast("Saved.", "ok"); }));
      const pct = c.goal ? Math.min(100, Math.round(c.done / c.goal * 100)) : 0;
      out.replaceChildren(
        c.goal ? h("div", {}, h("p", {}, h("b", { text: `${c.done} of ${c.goal} finished` }), c.done >= c.goal ? " 🎉 Goal met!" : ` · ${c.daysLeft} day${c.daysLeft === 1 ? "" : "s"} left in ${c.month}`), progressBar(pct / 100))
          : h("p", { class: "muted", text: `Pick how many games you want to finish in ${c.month}.` }),
        h("p", { class: "muted small", text: c.streak ? `🔥 ${c.streak}-month streak (best ${c.best})` : "No streak yet. Meet your goal this month to start one." }),
        c.titles.length ? h("p", { class: "muted small", text: "Finished: " + c.titles.join(", ") }) : "",
        c.history.length > 1 ? h("p", { class: "muted small", text: c.history.filter(x => x.month !== c.month).map(x => `${x.done >= x.goal ? "✅" : "▫️"} ${x.month} ${x.done}/${x.goal}`).join("   ") }) : "",
        h("div", { class: "row" }, field("Games to finish this month (0 clears)", goal), save));
    }
    api("/api/library/challenge").then(draw).catch(e => out.replaceChildren(h("div", { class: "notice warn", text: e.message })));
    return h("div", { class: "panel" }, h("h3", { text: "🏁 Backlog challenge" }),
      h("p", { class: "muted small", text: "Mark games finished (or reach 100% achievements) to count them. Keep the streak going month after month." }), out);
  }

  // Spend tracker: totals, the last 12 months and cost per hour, from the amounts you recorded.
  const nGames = n => n + (n === 1 ? " game" : " games");

  // Bundle tracker: add a bundle, see what its games are worth now and what each cost.
  function bundlesPanel(onChange) {
    const out = h("div", { class: "muted", text: "Loading…" });
    const name = h("input", { type: "text", maxlength: "80", placeholder: "Bundle name" });
    const paid = h("input", { type: "number", min: "0", max: "10000", step: "0.01", placeholder: "Paid", class: "short-num" });
    const titles = h("textarea", { rows: "2", maxlength: "1500", placeholder: "Games in it, separated by commas" });
    const add = h("button", { class: "btn green small shrink", text: "Add bundle" });
    add.addEventListener("click", () => busy(add, async () => {
      const r = await api("/api/library/bundle", { name: name.value, paid: Number(paid.value), titles: titles.value });
      toast(`Saved with ${r.matched} games.` + (r.notFound.length ? ` Not found: ${r.notFound.slice(0, 3).join(", ")}.` : ""), "ok");
      name.value = ""; paid.value = ""; titles.value = ""; if (onChange) onChange(); else load();
    }));
    async function load() {
      try {
        const v = await api("/api/library/bundles");
        out.className = "";
        out.replaceChildren(v.bundles.length ? h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Bundle", "Paid", "Worth", "Each", "Played", ""].map((c, i) => h("th", { class: i && i < 4 ? "num" : "", text: c })))),
          h("tbody", {}, v.bundles.map(b => {
            const rm = h("button", { class: "btn gray small shrink", text: "Remove", "aria-label": "Remove " + b.name });
            rm.addEventListener("click", () => busy(rm, async () => { await api("/api/library/bundle/remove", { id: b.id }); load(); }));
            return h("tr", {}, h("td", {}, h("strong", { text: b.name }), h("div", { class: "muted small", text: b.verdict ? b.verdict.text : "" })), h("td", { class: "num", text: money(b.paid, v.currency) }), h("td", { class: "num", text: money(b.msrp, v.currency) }), h("td", { class: "num", text: money(b.perGame, v.currency) }), h("td", { text: `${b.played}/${b.games} · ${b.hours} h` }), h("td", {}, rm));
          })))) : h("p", { class: "muted", text: "No bundles yet. Add one below." }),
          v.bundles.length ? h("p", { class: "muted small", text: `Total paid ${money(v.totals.paid, v.currency)} for games worth ${money(v.totals.msrp, v.currency)} at full price.` }) : "");
      } catch (e) { out.className = ""; out.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    load();
    return h("details", { class: "panel" }, h("summary", { text: "🎁 Bundles you bought" }), out,
      h("p", { class: "muted small", text: "The games are added to your library, with what you paid split evenly across them." }),
      h("div", { class: "bundle-form" }, h("div", { class: "rule inline" }, field("Name", name), field("Paid", paid)), field("Games", titles), h("div", { class: "row" }, add)));
  }

  function badgesPanel() {
    const out = h("div", { class: "muted", text: "Loading…" });
    api("/api/library/badges").then(tc => {
      out.className = "";
      out.replaceChildren(h("div", { class: "trophy-grid" }, tc.badges.map(b => h("div", { class: "trophy" + (b.tier ? " earned" : "") },
        h("span", { class: "trophy-icon", text: b.icon }), h("strong", { text: b.name }),
        h("span", { class: "muted small", text: (b.tier ? b.tier + " · " : "Not yet · ") + b.value + " " + b.unit + (b.next ? " (next at " + b.next + ")" : "") })))));
    }).catch(() => out.remove());
    return h("details", { class: "panel" }, h("summary", { text: "🏅 Trophy case" }), out);
  }

  function spendPanel() {
    const out = h("div", { class: "muted", text: "Loading…" });
    api("/api/library/spend").then(sp => {
      if (!sp.games) { out.className = ""; out.replaceChildren(h("p", { class: "muted", text: "No amounts recorded yet. Add what you paid in the table below, import a FanaticalGrabber export that has prices, or use the extension on your Steam purchase history (see the one-click send panel)." })); return; }
      const c = sp.currency, peak = Math.max(...sp.months.map(m => m.total), 1);
      const line = g => h("li", {}, h("b", { text: g.title }), ` ${money(g.paid, c)} for ${g.hours} h (${money(g.perHour, c)}/h)`);
      out.className = "";
      out.replaceChildren(
        h("div", { class: "grid four" },
          h("div", { class: "tile" }, h("div", { class: "k", text: "All time" }), h("div", { class: "v", text: money(sp.total, c) }), h("div", { class: "s", text: nGames(sp.games) + ", about " + money(sp.avg, c) + " each" })),
          h("div", { class: "tile" }, h("div", { class: "k", text: String(sp.year.year) }), h("div", { class: "v", text: money(sp.year.total, c) }), h("div", { class: "s", text: nGames(sp.year.games) })),
          h("div", { class: "tile" }, h("div", { class: "k", text: "Bought, not played" }), h("div", { class: "v", text: money(sp.unplayed.total, c) }), h("div", { class: "s", text: nGames(sp.unplayed.count) }))),
        h("div", { class: "spend-bars", role: "img", "aria-label": "Spending per month, last 12 months" }, sp.months.map(m => {
          const bar = h("i"); bar.style.height = Math.max(m.total ? 4 : 1, Math.round(m.total / peak * 100)) + "%";
          return h("div", { class: "spend-col", title: `${m.month}: ${money(m.total, c)} (${m.games} game${m.games === 1 ? "" : "s"})` }, bar, h("span", { text: m.month.slice(5) }));
        })),
        h("p", { class: "muted small", text: "Months follow when a game was added to your library, so treat them as approximate." }),
        h("div", { class: "grid two" },
          sp.bestValue.length ? h("div", {}, h("h4", { text: "Best value per hour" }), h("ul", { class: "plain" }, sp.bestValue.map(line))) : "",
          sp.worstValue.length ? h("div", {}, h("h4", { text: "Most expensive per hour" }), h("ul", { class: "plain" }, sp.worstValue.map(line))) : ""));
    }).catch(e => out.replaceChildren(h("div", { class: "notice warn", text: e.message })));
    return h("div", { class: "panel" }, h("h3", { text: "💸 What you have spent" }), out);
  }

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

    // One-click send from the FanaticalGrabber extension: a link code the extension keeps, shown here only once.
    const grabberOut = h("div", { class: "muted small", text: "Loading…" });
    async function grabberLoad() {
      try {
        const { link } = await api("/api/grabber");
        const make = h("button", { class: "btn blue small", text: link ? "Make a new code" : "Make a link code" });
        make.addEventListener("click", () => busy(make, async () => {
          const { token } = await api("/api/grabber/token", { action: "new" });
          const box = h("input", { type: "text", readonly: "", value: token, "aria-label": "Link code" });
          box.addEventListener("focus", () => box.select());
          grabberOut.replaceChildren(h("p", { class: "muted small", text: "Copy this now. It is shown once. Anyone with it can add games to your library." }), box,
            h("p", {}, h("button", { class: "btn gray small", text: "Copy", onclick: async () => { try { await navigator.clipboard.writeText(token); toast("Copied.", "ok"); } catch { box.select(); toast("Press Ctrl+C to copy.", "error"); } } })));
        }));
        // One click: the extension (2.7+) takes the code straight from this page, so there is nothing to paste.
        const connect = h("button", { class: "btn green small", text: link ? "Reconnect the extension" : "Connect the extension" });
        connect.addEventListener("click", () => busy(connect, async () => {
          const ask = (type, extra = {}) => new Promise(res => {
            const on = e => { if (e.source === window && e.data && e.data.svc === "ext" && (e.data.type === (type === "ping" ? "pong" : "connected"))) { window.removeEventListener("message", on); res(e.data); } };
            window.addEventListener("message", on); window.postMessage({ svc: "page", type, ...extra }, location.origin);
            setTimeout(() => { window.removeEventListener("message", on); res(null); }, 1500);
          });
          const here = await ask("ping");
          if (!here) { toast("I can't see the extension. Install or update FanaticalGrabber (2.7 or newer), then reload this page.", "error"); return; }
          const { token } = await api("/api/grabber/token", { action: "new" });
          const done = await ask("connect", { token });
          if (done && done.ok) { toast("Extension connected.", "ok"); grabberLoad(); } else toast("The extension did not accept the code. Update it to 2.7 or newer.", "error");
        }));
        const off = link && h("button", { class: "btn red small", text: "Turn off" });
        if (off) off.addEventListener("click", () => busy(off, async () => { await api("/api/grabber/token", { action: "off" }); toast("Link turned off.", "ok"); grabberLoad(); }));
        grabberOut.className = "";
        grabberOut.replaceChildren(h("p", { class: "muted small", text: link ? `Linked. ${link.sends} send${link.sends === 1 ? "" : "s"} so far${link.used_at ? `, last ${new Date(link.used_at).toLocaleDateString()}` : ""}.` : "Not linked. Press Connect the extension and you are done, no code to paste." }), h("p", {}, connect, " ", h("details", { class: "paste" }, h("summary", { text: "Or make a code to paste by hand" }), h("p", {}, make, " ", off))));
      } catch (e) { grabberOut.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }

    const offered = [];
    const nextOut = h("div");
    const nextBtn = h("button", { class: "btn green", text: "Pick for me", onclick: () => busy(nextBtn, async () => {
      const d = await api("/api/library/next" + (offered.length ? "?skip=" + encodeURIComponent(offered.join(",")) : ""));
      if (!d.next) { nextOut.replaceChildren(h("div", { class: "notice warn", text: offered.length ? "That is everything in your backlog. Press again to start over." : "Nothing in your backlog." })); offered.length = 0; nextBtn.textContent = "Pick for me"; return; }
      const n = d.next;
      offered.push(n.pick.itad_id);
      nextBtn.textContent = "Pick another";
      nextOut.replaceChildren(h("div", { class: "panel" }, h("h3", { text: "🎯 Play next" }),
        h("div", { class: "game-cell" }, (n.pick.appid || n.pick.itad_id) ? steamArt(n.pick.appid, "game-thumb", 92, 43, n.pick.itad_id) : null, h("div", {}, h("div", { class: "game-title", text: n.pick.title }), h("div", { class: "muted", text: n.why }))),
        n.others.length ? h("p", { class: "muted small", text: "Also in the running: " + n.others.map(o => o.title).join(", ") }) : null,
        h("p", { class: "muted small", text: n.remaining ? `${n.remaining} more to choose from.` : "That is everything left in your backlog." })));
    }) });
    const view = { q: "", status: "all", sort: "name", page: 0, mode: (() => { try { return localStorage.getItem("svc_libmode") === "list" ? "list" : "grid"; } catch { return "grid"; } })(), play: "all", genres: new Set(), filters: false };
    const picked = new Set(); // itad ids ticked for a bulk status change
    const STATUS_OPTIONS = [["backlog", "Backlog"], ["playing", "Playing"], ["played", "Played"], ["finished", "Finished"], ["dropped", "Dropped"]];
    async function load() {
      try {
        const d = await api("/api/library");
        state.me.library = d.rows.length;
        if (!d.rows.length) { body.className = ""; body.replaceChildren(h("div", { class: "empty", text: "Your library is empty. Add games above, import a FanaticalGrabber export, or send results from the Value Checker." }), bundlesPanel(() => load())); return; }
        const t = d.totals, cur = d.currency;
        const tile = (k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: v }), sub && h("div", { class: "s", text: sub }));
        const snaps = d.snapshots;
        const chart = snaps.length > 1
          ? h("div", { class: "panel" }, h("h3", { text: "Value over time" }), lineChart([
              { name: "Worth at MSRP", cls: "s1", points: snaps.map(x => ({ x: Date.parse(x.day), y: x.msrp })) },
              { name: "Cheapest now", cls: "s0", points: snaps.map(x => ({ x: Date.parse(x.day), y: x.cheapest })) }
            ], { format: v => money(v, cur), label: "Library value over time" }))
          : h("p", { class: "muted small", text: "The value chart appears after the second day of data." });
        const withCounts = snaps.filter(x => x.backlog !== null && x.backlog !== undefined);
        const backlogChart = withCounts.length > 1
          ? h("div", { class: "panel" }, h("h3", { text: "Backlog over time" }), lineChart([
              { name: "In backlog", cls: "s0", points: withCounts.map(x => ({ x: Date.parse(x.day), y: x.backlog })) },
              { name: "Finished", cls: "s1", points: withCounts.map(x => ({ x: Date.parse(x.day), y: x.finished || 0 })) }
            ], { format: v => String(Math.round(v)), label: "Games in your backlog and finished games over time" }))
          : null;
        // The games table: search, status filter, sort and pages, so a big Steam library stays easy to move around in.
        const PAGE = 50;
        const SORTS = [["name", "Name (A to Z)"], ["msrp", "Price, high to low"], ["cheapest", "Cheapest now, high to low"], ["saved", "Saved, most first"], ["hours", "Hours played"]];
        const num = v => (typeof v === "number" ? v : -Infinity);
        const sorters = { name: (x, y) => x.title.localeCompare(y.title), msrp: (x, y) => num(y.msrp) - num(x.msrp), cheapest: (x, y) => num(y.best && y.best.price) - num(x.best && x.best.price), saved: (x, y) => num(y.saved) - num(x.saved), hours: (x, y) => (y.minutes || 0) - (x.minutes || 0) };
        const tableHost = h("div");
        const search = h("input", { type: "search", placeholder: "Search your games", value: view.q, "aria-label": "Search your games" });
        const statusFilter = select([["all", "All statuses"], ...STATUS_OPTIONS], view.status);
        const sortBy = select(SORTS, view.sort);
        const redraw = () => { view.q = search.value; view.status = statusFilter.value; view.sort = sortBy.value; drawTable(); };
        search.addEventListener("input", () => { view.page = 0; redraw(); });
        statusFilter.addEventListener("change", () => { view.page = 0; redraw(); });
        sortBy.addEventListener("change", () => { view.page = 0; redraw(); });

        function rowFor(r) {
          const rm = h("button", { class: "btn red small", text: "Remove" });
          rm.addEventListener("click", () => busy(rm, async () => { await api("/api/library/remove", { itad_id: r.itad_id }); load(); }));
          const holder = h("tr", { class: "chart-row", hidden: true }, h("td", { colspan: "8" }));
          const stat = select(STATUS_OPTIONS, r.status || "backlog");
          stat.className = "status-select";
          stat.setAttribute("aria-label", "Status for " + r.title);
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
          const game = h("div", { class: "game-cell" },
            (r.appid || r.itad_id) ? steamArt(r.appid, "game-thumb", 92, 43, r.itad_id) : null,
            h("div", {}, h("div", { class: "game-title", text: r.title }), (r.minutes || r.ach_total) ? h("div", { class: "muted small", text: [r.minutes ? hoursText(r.minutes) + " played" : null, r.ach_total ? `🏆 ${r.ach_done}/${r.ach_total}` : null].filter(Boolean).join(" · ") }) : null));
          const tick = h("input", { type: "checkbox", checked: picked.has(r.itad_id), "aria-label": "Select " + r.title });
          tick.addEventListener("change", () => { tick.checked ? picked.add(r.itad_id) : picked.delete(r.itad_id); drawBar(); });
          return [h("tr", {}, h("td", { class: "tick" }, tick), h("td", {}, game), h("td", {}, stat), h("td", { class: "num" }, money(r.paid, cur), r.gifted ? h("span", { class: "gift-tip", tabindex: "0", "data-tip": "Gifted", "aria-label": "Gifted", text: "🎁" }) : null), h("td", { class: "num", text: money(r.msrp, cur) }),
            h("td", { class: "num", text: money(r.best && r.best.price, cur) }),
            h("td", { class: "num", text: r.saved === null ? "–" : (r.saved >= 0 ? "+" : "−") + money(Math.abs(r.saved), cur) }), h("td", {}, h("div", { class: "row-actions" }, hist, rm))), holder];
        }

        // Steam does not say which games you finished, so pick them here: tick games (or everything the filter shows) and set a status.
        const bar = h("div", { class: "bulk-bar", hidden: true });
        const bulkStatus = select(STATUS_OPTIONS, "finished");
        let matching = [];
        function drawBar() {
          const n = picked.size;
          bar.hidden = !n && !matching.length;
          const apply = h("button", { class: "btn blue small", text: "Apply" });
          apply.addEventListener("click", () => busy(apply, async () => {
            const r = await api("/api/library/status", { itad_ids: [...picked], status: bulkStatus.value });
            picked.clear(); toast(`${r.updated} games set to ${bulkStatus.value}.`, "ok"); load();
          }));
          const all = h("button", { class: "btn gray small", text: `Select all ${matching.length} shown`, onclick: () => { matching.forEach(r => picked.add(r.itad_id)); drawTable(); } });
          const none = h("button", { class: "btn gray small", text: "Clear", onclick: () => { picked.clear(); drawTable(); } });
          bar.replaceChildren(
            h("span", { class: "muted small", text: n ? `${n} selected` : "Tick games to change their status together." }),
            matching.length ? all : null,
            ...(n ? [bulkStatus, apply, none] : []));
        }

        const PLAY = [["all", "All playtime"], ["never", "Never played"], ["light", "Under 10 hours"], ["mid", "10 to 100 hours"], ["heavy", "100+ hours"]];
        const playOk = (r, f) => f === "all" || (f === "never" ? !r.minutes : f === "light" ? r.minutes > 0 && r.minutes < 600 : f === "mid" ? r.minutes >= 600 && r.minutes < 6000 : r.minutes >= 6000);
        const allGenres = [...new Set(d.rows.flatMap(r => r.genres || []))].sort();
        const GRID_PAGE = 12;

        function cardFor(r) {
          const stat = select(STATUS_OPTIONS, r.status || "backlog");
          stat.className = "status-select";
          stat.setAttribute("aria-label", "Status for " + r.title);
          stat.addEventListener("change", async () => { try { await api("/api/library/status", { itad_id: r.itad_id, status: stat.value }); toast(`${r.title}: ${stat.value}.`, "ok"); load(); } catch (e) { toast(e.message, "error"); } });
          const tick = h("input", { type: "checkbox", checked: picked.has(r.itad_id), "aria-label": "Select " + r.title });
          tick.addEventListener("change", () => { tick.checked ? picked.add(r.itad_id) : picked.delete(r.itad_id); drawBar(); });
          const holder = h("div", { class: "lib-hist", hidden: true });
          const hist = h("button", { class: "btn gray small", text: "Price history" });
          hist.addEventListener("click", () => {
            if (!holder.hidden) { holder.hidden = true; return; }
            busy(hist, async () => {
              const h2 = await api("/api/wishlist/history?itad_id=" + encodeURIComponent(r.itad_id));
              holder.replaceChildren(h2.points.length ? lineChart([{ name: "Price", cls: "s0", points: h2.points.map(p => ({ x: p.t, y: p.price })) }], { format: v => money(v, cur), label: "Price history for " + r.title }) : h("p", { class: "muted small", text: "No price history yet." }));
              holder.hidden = false;
            });
          });
          const rm = h("button", { class: "btn red small", text: "Remove" });
          rm.addEventListener("click", () => busy(rm, async () => { await api("/api/library/remove", { itad_id: r.itad_id }); load(); }));
          const prices = [r.msrp != null ? ["MSRP", money(r.msrp, cur)] : null, r.best ? ["Cheapest", money(r.best.price, cur)] : null, r.paid != null ? [r.gifted ? "Gift" : "Paid", money(r.paid, cur)] : null].filter(Boolean);
          return h("article", { class: "lib-card" + (picked.has(r.itad_id) ? " picked" : "") },
            h("div", { class: "lib-art" },
              (r.appid || r.itad_id) ? steamArt(r.appid, "lib-img", 460, 215, r.itad_id) : h("div", { class: "lib-img art-missing" }),
              h("label", { class: "lib-tick", title: "Select" }, tick),
              h("span", { class: "lib-badge " + (r.status || "backlog"), text: (STATUS_OPTIONS.find(o => o[0] === (r.status || "backlog")) || [0, "Backlog"])[1] }),
              h("div", { class: "lib-title", text: r.title })),
            h("div", { class: "lib-meta" },
              h("span", { text: r.minutes ? "⏱ " + hoursText(r.minutes) : "Never played" }),
              r.ach_total ? h("span", { text: `🏆 ${r.ach_done}/${r.ach_total}` }) : null,
              r.saved != null && r.saved > 0 ? h("span", { class: "lib-save", text: "Saved " + money(r.saved, cur) }) : null),
            prices.length ? h("div", { class: "lib-prices" }, prices.map(([k, v]) => h("span", {}, h("small", { text: k }), " " + v))) : null,
            (r.genres || []).length ? h("div", { class: "lib-tags" }, r.genres.map(g => h("span", { class: "lib-tag", text: g }))) : null,
            h("div", { class: "lib-actions" }, stat, hist, rm),
            holder);
        }

        function pageList(pages) { // 1 2 … 43, always showing the first, last and the pages around this one
          const set = [...new Set([0, 1, view.page - 1, view.page, view.page + 1, pages - 2, pages - 1].filter(n => n >= 0 && n < pages))].sort((a, b) => a - b);
          const out = [];
          set.forEach((n, i) => { if (i && n - set[i - 1] > 1) out.push(h("span", { class: "muted", text: "…" })); out.push(h("button", { class: "pg-btn" + (n === view.page ? " on" : ""), text: String(n + 1), "aria-current": n === view.page ? "page" : null, onclick: () => { view.page = n; drawTable(); tableHost.scrollIntoView({ block: "start" }); } })); });
          return out;
        }

        function drawTable() {
          const q = view.q.trim().toLowerCase();
          const list = d.rows.filter(r => (view.status === "all" || (r.status || "backlog") === view.status) && (!q || r.title.toLowerCase().includes(q)) && playOk(r, view.play) && (!view.genres.size || [...view.genres].every(g => (r.genres || []).includes(g)))).sort(sorters[view.sort] || sorters.name);
          if (view.mode === "grid") {
            matching = list;
            const pages = Math.max(1, Math.ceil(list.length / GRID_PAGE));
            view.page = Math.min(view.page, pages - 1);
            const start = view.page * GRID_PAGE;
            const prev = h("button", { class: "pg-btn wide", text: "‹ Previous", onclick: () => { view.page--; drawTable(); tableHost.scrollIntoView({ block: "start" }); } }); prev.disabled = view.page === 0;
            const next = h("button", { class: "pg-btn wide", text: "Next ›", onclick: () => { view.page++; drawTable(); tableHost.scrollIntoView({ block: "start" }); } }); next.disabled = view.page >= pages - 1;
            tableHost.replaceChildren(
              list.length ? h("div", { class: "lib-grid" }, list.slice(start, start + GRID_PAGE).map(cardFor)) : h("div", { class: "empty", text: "No games match." }),
              h("div", { class: "lib-pager" }, h("div", { class: "pg-nav" }, prev, ...pageList(pages), next), h("span", { class: "muted small", text: list.length ? `${start + 1}-${Math.min(list.length, start + GRID_PAGE)} of ${list.length} games` : "" })));
            drawBar();
            return;
          }
          return drawList(list);
        }

        function drawList(list) {
          matching = list;
          const pages = Math.max(1, Math.ceil(list.length / PAGE));
          view.page = Math.min(view.page, pages - 1);
          const start = view.page * PAGE;
          const go = n => () => { view.page += n; drawTable(); tableHost.scrollIntoView({ block: "start" }); };
          const prev = h("button", { class: "btn gray small", text: "← Previous", onclick: go(-1) }); prev.disabled = view.page === 0;
          const next = h("button", { class: "btn gray small", text: "Next →", onclick: go(1) }); next.disabled = view.page >= pages - 1;
          tableHost.replaceChildren(
            list.length ? h("div", { class: "table-wrap" }, h("table", { class: "library-table" }, h("thead", {}, h("tr", {}, ["", "Game", "Status", "Paid", "MSRP", "Cheapest now", "Saved", ""].map((c, i) => h("th", { class: i > 2 && i < 7 ? "num" : "", text: c })))),
              h("tbody", {}, list.slice(start, start + PAGE).flatMap(rowFor))))
              : h("div", { class: "empty", text: "No games match." }),
            h("div", { class: "pager" }, h("span", { class: "muted small", text: list.length ? `Showing ${start + 1}–${Math.min(list.length, start + PAGE)} of ${list.length}` : "" }), pages > 1 ? h("span", { class: "row-actions" }, prev, h("span", { class: "muted small", text: `Page ${view.page + 1} of ${pages}` }), next) : null));
          drawBar();
        }
        // Header with grid / list switch and a filter drawer (playtime, status and genre chips).
        const modeBtn = (mode, label, icon) => { const b = h("button", { class: "icon-toggle" + (view.mode === mode ? " on" : ""), type: "button", title: label, "aria-label": label, "aria-pressed": String(view.mode === mode), text: icon }); b.addEventListener("click", () => { view.mode = mode; try { localStorage.setItem("svc_libmode", mode); } catch { /* optional */ } view.page = 0; syncHead(); drawTable(); }); return b; };
        const gridBtn = modeBtn("grid", "Card view", "▦"), listBtn = modeBtn("list", "List view", "☰");
        const filterBtn = h("button", { class: "icon-toggle" + (view.filters ? " on" : ""), type: "button", title: "Filters", "aria-label": "Filters", text: "⚲" });
        const headCount = h("div", { class: "muted small" });
        const libHead = h("div", { class: "lib-head" }, h("div", {}, h("h3", { text: "Your games" }), headCount), h("div", { class: "lib-toggles" }, gridBtn, listBtn, filterBtn));
        const filterPanel = h("div", { class: "lib-filters", hidden: !view.filters });
        function syncHead() {
          for (const [b, m] of [[gridBtn, "grid"], [listBtn, "list"]]) { b.classList.toggle("on", view.mode === m); b.setAttribute("aria-pressed", String(view.mode === m)); }
          filterBtn.classList.toggle("on", view.filters); filterPanel.hidden = !view.filters;
          headCount.textContent = `${d.rows.length} games`;
        }
        filterBtn.addEventListener("click", () => { view.filters = !view.filters; syncHead(); });
        const playSel = select(PLAY, view.play); playSel.addEventListener("change", () => { view.play = playSel.value; view.page = 0; drawTable(); });
        const chip = (label, on, fn) => { const b = h("button", { class: "chip-btn" + (on ? " on" : ""), type: "button", text: label }); b.addEventListener("click", fn); return b; };
        const drawFilters = () => filterPanel.replaceChildren(
          h("div", { class: "row" }, field("Playtime", playSel)),
          allGenres.length ? h("div", {}, h("div", { class: "muted small", text: "Genres (a game must match all you pick)" }), h("div", { class: "chips" }, allGenres.map(g => chip(g, view.genres.has(g), () => { view.genres.has(g) ? view.genres.delete(g) : view.genres.add(g); view.page = 0; drawFilters(); drawTable(); })))) : h("p", { class: "muted small", text: "Genres appear after your Steam library has been read once." }),
          view.genres.size || view.play !== "all" ? h("button", { class: "btn gray small", type: "button", text: "Clear filters", onclick: () => { view.genres.clear(); view.play = "all"; playSel.value = "all"; view.page = 0; drawFilters(); drawTable(); } }) : null);
        drawFilters(); syncHead();
        drawTable();

        body.className = "";
        body.replaceChildren(
          h("div", { class: "grid five" }, tile("Games", String(t.games), t.paidGames < t.games ? `${t.paidGames} with what you paid` : ""), tile("You paid", money(t.paid, cur), t.paidGames ? `real prices, ${t.paidGames} games` : "no prices logged yet"),
            tile("Estimated paid", (t.estGames ? "~" : "") + money(t.estPaid, cur), t.estGames ? `${t.estGames} games guessed at their lowest-ever price. Log real prices with the extension.` : "every game has a real price"),
            tile("Worth at MSRP", money(t.msrp, cur)), tile("Saved vs MSRP", money(t.saved, cur), t.msrpPaid > 0 ? Math.round(t.savedPct) + "% off" : "add prices to see savings")),
          h("div", { class: "grid four" }, tile("Not started", String(t.backlogGames), t.backlogPaid > 0 ? money(t.backlogPaid, cur) + " spent on unplayed games" : ""), tile("Playing", String(t.playing)), tile("Finished", String(t.finished)),
            h("div", { class: "tile" }, h("div", { class: "k", text: "What to play next" }), nextBtn)),
          nextOut,
          challengePanel(), badgesPanel(), spendPanel(), bundlesPanel(() => load()), chart, backlogChart || "",
          h("div", { class: "panel" }, libHead, h("div", { class: "library-controls" }, search, statusFilter, sortBy), filterPanel, bar, tableHost));
      } catch (e) { body.className = ""; body.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }

    app.replaceChildren(pageHead("Library", "Games you own and what you paid, against what they are worth now."),
      h("div", { class: "grid two" },
        h("div", { class: "panel" }, h("h3", { text: "Add a game" }), field("Title", title), field("Paid", paid), h("p"), add),
        h("div", { class: "panel" }, h("h3", { text: "Import" }), field("FanaticalGrabber export (a Paid column is used)", file), h("p"), imp)),
      h("div", { class: "notice" }, "Want it filled in for you? ", h("a", { href: "#/steam", text: "Link your Steam profile" }), " to sync every game you own, with playtime. Steam does not share what you paid: the FanaticalGrabber extension fills it in from your Steam purchase history (see below)."),
      h("div", { class: "panel" }, h("h3", { text: "FanaticalGrabber one-click send" }), grabberOut,
        h("h4", { text: "Fill in what you paid, from Steam" }),
        h("p", { class: "muted small", text: "With the extension (2.6 or newer) and the link code above saved in it, open your Steam purchase history and press Send what I paid. Single-game purchases get their real price. Cart and bundle purchases have one total for several games, so those are skipped; add them with the bundle tool on this page. For games you activated with a key, open store.steampowered.com/account/licenses and press Record retail prices for my keys: they get the retail price, and prices you already have are kept." }),
        h("a", { class: "btn blue small", href: "https://store.steampowered.com/account/history", target: "_blank", rel: "noopener noreferrer", text: "Open my Steam purchase history" })),
      body);
    grabberLoad();
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
    let d, ins, bugData;
    try { [d, ins, bugData] = await Promise.all([api("/api/admin/stats"), api("/api/admin/insights"), api("/api/admin/bugs")]); }
    catch (e) { holder.className = ""; holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); return; }
    const st = d.stats, hl = d.health || {}, bot = ins.bot || {};
    const tile = (k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: String(v) }), sub && h("div", { class: "s", text: sub }));
    const when = t => (t ? new Date(t).toLocaleString() : "never");
    const n0 = v => (v === null || v === undefined ? "–" : Number(v).toLocaleString());
    const table = (head, rows) => {
      if (!rows.length) return h("p", { class: "muted", text: "Nothing yet." });
      const th = head.map((c, i) => h("th", { class: i ? "num" : "", text: c }));
      const trs = rows.map(r => h("tr", {}, r.map((c, i) => h("td", { class: i ? "num" : "", text: String(c) }))));
      return h("div", { class: "scroll-y" }, h("table", {}, h("thead", {}, h("tr", {}, th)), h("tbody", {}, trs)));
    };
    const daily = (rows, name, cls) => lineChart([{ name, cls, points: rows.map(r => ({ x: Date.parse(r.day + "T00:00:00Z"), y: r.n })) }], { format: v => (Number.isInteger(v) ? String(v) : ""), label: name + " per day, last 30 days" });
    const sum = rows => rows.reduce((t, r) => t + r.n, 0);

    const bugs = () => {
      const list = bugData.bugs;
      const newOnes = new Set(list.filter(b => b.isNew).map(b => b.id));
      // Opening this tab counts as reading them: the menu badge clears, while "New" stays on the cards until you leave.
      if (bugData.newCount && state.me) { api("/api/admin/bugs/seen", {}).then(() => { state.me.bugsNew = 0; bugData.newCount = 0; renderChrome(); }).catch(() => {}); }
      const ago = t => { const m = Math.max(1, Math.round((Date.now() - t) / 60000)); return m < 60 ? m + " min ago" : m < 2880 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago"; };
      return [h("div", { class: "panel" }, h("h3", { text: `Bug reports (${bugData.open} open)` }),
        h("p", { class: "muted small", text: "Sent by members with /bug, /support open (type: bug) or the Support page. Open one to read the thread and reply." }),
        list.length ? h("div", { class: "scroll-y tall" }, list.map(b => h("div", { class: "bug-card" + (newOnes.has(b.id) ? " new" : "") },
          h("div", { class: "row" }, h("strong", { text: `#${b.id} ${b.subject}` }), newOnes.has(b.id) ? h("span", { class: "badge-count", text: "NEW" }) : null, h("span", { class: "chip dim", text: b.status })),
          h("div", { class: "muted small", text: `${b.user_name || b.user_id} · ${ago(b.created_at)}${b.replies ? " · " + b.replies + " repl" + (b.replies === 1 ? "y" : "ies") : ""}` }),
          h("p", { class: "bug-text", text: b.text }),
          h("a", { class: "btn gray small", href: "#/support/" + b.id, text: "Open ticket" })))) : h("p", { class: "muted", text: "No bug reports yet." }))];
    };

    const overview = () => [
      bugData.newCount ? h("div", { class: "notice warn" }, h("strong", { text: `${bugData.newCount} new bug report${bugData.newCount === 1 ? "" : "s"}. ` }), h("a", { href: "#/admin", onclick: e => { e.preventDefault(); current = "bugs"; show(); }, text: "Read them" })) : null,
      h("div", { class: "grid four" }, tile("Members", st.users, `${st.activeUsers} with alerts on`), tile("Wishlist games", st.wishlistGames, `${st.uniqueGames} different games`),
        tile("Library games", st.libraryGames), tile("Servers with a channel", st.serversWithChannel),
        tile("Alerts, last 24h", st.alerts24h), tile("DM delivery", st.dmUsers, `${st.channelUsers} use the channel`), tile("DMs failing", st.usersFailingDm, "3 or more failures in a row"),
        tile("New members, 7 days", sum(ins.signups.slice(-7)), `${sum(ins.signups)} in 30 days`)),
      h("div", { class: "panel" }, h("h3", { text: "The bot right now" }),
        h("div", { class: "grid four" }, tile("Version", bot.version || "–", bot.node), tile("Uptime", bot.uptime || "–"), tile("Discord ping", bot.pingMs === null || bot.pingMs === undefined ? "–" : bot.pingMs + " ms"), tile("Servers", n0(bot.servers), "the bot is in"),
          tile("Memory", bot.rssMb + " MB"))),
      h("div", { class: "panel" }, h("h3", { text: "Alerts in the last 7 days" }),
        Object.keys(st.alerts7d).length ? h("p", { text: Object.entries(st.alerts7d).map(([k, n]) => `${k}: ${n}`).join("   ") }) : h("p", { class: "muted", text: "None." })),
      h("div", { class: "panel" }, h("h3", { text: "Health" }),
        h("p", { text: "Last price check: " + when(hl.cycle && hl.cycle.at) + (hl.cycle && hl.cycle.priceErrors ? ` (${hl.cycle.priceErrors} price errors)` : "") }),
        h("p", { text: "Last backup: " + (hl.backup ? `${when(hl.backup.at)} (${hl.backup.ok ? "ok" : "FAILED"})` : "none yet") }),
        h("p", { class: "muted small", text: "Recent errors: " + ((hl.errors || []).slice(0, 5).map(e => `${e.where} (${when(e.at)})`).join(", ") || "none") }))];

    const growth = () => [
      h("div", { class: "panel" }, h("h3", { text: "New members per day" }), daily(ins.signups, "New members", "s0")),
      h("div", { class: "panel" }, h("h3", { text: "Alerts sent per day" }), daily(ins.alerts, "Alerts", "s1")),
      h("div", { class: "grid two" },
        h("div", { class: "panel" }, h("h3", { text: "Regions" }), table(["Region", "Members"], ins.regions.map(r => [r.k, r.n]))),
        h("div", { class: "panel" }, h("h3", { text: "Languages" }), table(["Language", "Members"], ins.languages.map(r => [r.k, r.n]))))];

    const features = () => [
      h("div", { class: "panel" }, h("h3", { text: "Who uses what" }), h("div", { class: "kv" }, ins.features.map(([k, v]) => h("div", { class: v ? "" : "zero" }, h("span", { text: k }), h("b", { text: n0(v) }))))),
      h("div", { class: "panel" }, h("h3", { text: "Most watched games" }), table(["Game", "Members watching"], ins.watched.map(r => [r.title, r.n]))),
      h("div", { class: "panel" }, h("h3", { text: "Idle accounts" }),
        h("p", { text: `${n0(ins.idle.noWishlistOrLibrary)} member${ins.idle.noWishlistOrLibrary === 1 ? " has" : "s have"} no wishlist and no library games.` }),
        h("p", { text: `${n0(ins.idle.dmFailing)} member${ins.idle.dmFailing === 1 ? " has" : "s have"} DMs that keep failing.` }))];

    const servers = () => [h("div", { class: "panel" }, h("h3", { text: `Servers (${ins.servers.length})` }),
      ins.servers.length ? h("div", { class: "scroll-y tall" }, h("table", {}, h("thead", {}, h("tr", {}, ["Server", "Members", "Using the bot", "Alert channel", "Free feed", "Group alerts", "Digest"].map((c, i) => h("th", { class: i === 1 || i === 2 ? "num" : "", text: c })))),
        h("tbody", {}, ins.servers.map(g => h("tr", {}, h("td", {}, g.name || "Unknown server", h("div", { class: "muted small", text: g.id + (g.inServer === false ? " · bot has left" : "") })), h("td", { class: "num", text: n0(g.members) }), h("td", { class: "num", text: String(g.tracked) }),
          h("td", { text: g.channel ? "Yes" : "No" }), h("td", { text: g.freeFeed ? "On" : "Off" }), h("td", { text: g.groupMin ? "At " + g.groupMin : "Off" }), h("td", { text: g.digest ? "On" : "Off" })))))) : h("p", { class: "muted", text: "No servers yet." }))];

    const members = () => {
      const id = h("input", { type: "text", inputmode: "numeric", placeholder: "Discord user ID (paste it, or a mention)", maxlength: "30", "aria-label": "Discord user ID" });
      const out = h("div");
      const draw = u => {
        const act = (label, action, cls = "gray") => { const b = h("button", { class: "btn " + cls + " small", text: label }); b.addEventListener("click", () => busy(b, async () => { draw(await api("/api/admin/user", { id: u.id, action })); toast("Done.", "ok"); })); return b; };
        out.replaceChildren(h("div", { class: "panel" }, h("h3", { text: "Member " + u.id }),
          h("div", { class: "grid four" }, tile("Joined", new Date(u.joined).toLocaleDateString()), tile("Wishlist", u.wishlist), tile("Library", u.library), tile("Alerts received", u.alerts)),
          h("p", { text: `Region ${u.region} · delivery by ${u.delivery} · language ${u.lang} · ${u.paused ? "alerts paused" : "alerts on"} · ${u.dmFailures} failed DMs · ${u.share ? "on server boards" : "not on server boards"} · Steam ${u.steam ? "linked" : "not linked"} · grabber ${u.grabber ? "linked" : "not linked"} · ${u.tickets} support tickets` }),
          h("div", { class: "row" }, act("Reset failed DMs", "reset_dm"), u.paused ? act("Resume alerts", "resume", "green") : act("Pause alerts", "pause"))));
      };
      const find = h("button", { class: "btn blue", text: "Look up" });
      const go = () => busy(find, async () => { try { draw(await api("/api/admin/user?id=" + encodeURIComponent(id.value.replace(/\D/g, "")))); } catch (e) { out.replaceChildren(h("div", { class: "notice warn", text: e.message })); } });
      find.addEventListener("click", go);
      id.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
      return [h("div", { class: "panel" }, h("h3", { text: "Look up a member" }),
        h("p", { class: "muted small", text: "Counts and settings only. You can't see anyone's games, keys or messages from here." }), h("div", { class: "lookup-row" }, id, find)), out];
    };

    const tools = () => {
      const clear = h("button", { class: "btn gray small", text: "Reset failed DMs for everyone" });
      clear.addEventListener("click", () => busy(clear, async () => { const r = await api("/api/admin/clear-dm-failures", {}); toast(`Reset for ${r.cleared} member${r.cleared === 1 ? "" : "s"}.`, "ok"); }));
      return [
        h("div", { class: "panel" }, h("h3", { text: "Backup" }),
          h("p", { text: "Last backup: " + (hl.backup ? `${when(hl.backup.at)} (${hl.backup.ok ? "ok" : "FAILED"})` : "none yet") }),
          h("p", {}, h("a", { href: "/api/admin/backup", class: "btn gray small", download: "" }, "Download the latest backup"), h("span", { class: "muted small", text: "  (the whole database, including encrypted giveaway keys. Keep it private.)" }))),
        h("div", { class: "panel" }, h("h3", { text: "Maintenance" }),
          h("p", { class: "muted small", text: "Members whose DMs failed 3 times in a row are skipped until they change something. This gives all of them another try." }), clear),
        logPanel()];
    };

    const announce = () => {
      const title = h("input", { type: "text", maxlength: "100", placeholder: "Title (optional), e.g. Bot update tonight" });
      const msg = h("textarea", { rows: "5", maxlength: "1500", placeholder: "The bot will be offline around 11pm Eastern for about 10 minutes for an update. Alerts will catch up afterwards.", "aria-label": "Message" });
      const count = h("span", { class: "muted small", text: "0 / 1500" });
      const who = h("select", { "aria-label": "Who gets it" });
      const confirm = h("input", { type: "text", placeholder: "SEND", maxlength: "4", autocomplete: "off", "aria-label": "Type SEND to confirm" });
      const preview = h("div", { class: "notice" });
      const progress = h("div"), history = h("div");
      const send = h("button", { class: "btn red", type: "button", text: "Send announcement" });
      const test = h("button", { class: "btn gray", type: "button", text: "Send a test to me only" });
      let info = null, timer = 0;
      const box = h("div");
      const paintPreview = () => {
        count.textContent = msg.value.length + " / 1500";
        preview.replaceChildren(h("strong", { text: title.value.trim() || "Steam Value Checker notice" }), h("div", { text: msg.value.trim() || "Your message shows here." }), h("div", { class: "muted small", text: "A notice from the bot owner. You can't reply here; use the Support page on the dashboard." }));
      };
      const paintWho = () => {
        const c = info.counts;
        who.replaceChildren(...[["dm", `DMs to members (${c.dm})`], ["channels", `Alert channels in servers (${c.channels})`], ["both", `Both (${c.dm + c.channels})`]].map(([v, t]) => h("option", { value: v, text: t })));
      };
      const paintProgress = cur => {
        if (!cur) { progress.replaceChildren(); return; }
        const done = cur.sent + cur.failed;
        progress.replaceChildren(h("p", { text: `Sending #${cur.id}: ${done} of ${cur.total} (${cur.failed} could not be delivered)` }), (() => { const bar = h("div", { class: "bar" }); const f = h("div", { class: "fill" }); f.style.width = Math.round(done / Math.max(1, cur.total) * 100) + "%"; bar.append(f); return bar; })());
      };
      const paintHistory = () => {
        history.replaceChildren(info.history.length ? table(["When", "Title", "To", "Delivered"], info.history.map(b => [new Date(b.at).toLocaleString(), b.title, b.audience === "me" ? "test" : b.audience, `${b.sent} of ${b.total}${b.failed ? " (" + b.failed + " failed)" : ""}${b.done ? "" : " …"}`])) : h("p", { class: "muted", text: "Nothing sent yet." }));
      };
      async function refresh() {
        info = await api("/api/admin/broadcast");
        const keep = who.value; paintWho(); if (keep) who.value = keep;
        paintProgress(info.current); paintHistory();
        clearTimeout(timer);
        if (info.current && document.body.contains(box)) timer = setTimeout(() => refresh().catch(() => {}), 2500);
      }
      const go = async audience => {
        const r = await api("/api/admin/broadcast", { title: title.value, body: msg.value, audience, confirm: confirm.value });
        toast(audience === "me" ? "Test sent to you." : `Sending to ${r.total} places. You can leave this page.`, "ok");
        if (audience !== "me") confirm.value = "";
        await refresh();
      };
      test.addEventListener("click", () => busy(test, () => go("me")));
      send.addEventListener("click", () => busy(send, () => go(who.value)));
      for (const el of [title, msg]) el.addEventListener("input", paintPreview);
      paintPreview();
      refresh().then(() => {
        box.replaceChildren(
          h("div", { class: "panel" }, h("h3", { text: "Announce something" }),
            h("p", { class: "muted small", text: "For things like downtime for an update. DMs go out about one a second, so a large list takes a while. Members whose DMs keep failing are skipped." }),
            field("Title", title), field("Message", msg), count, h("h4", { text: "Preview" }), preview,
            h("div", { class: "row" }, field("Send to", who), field("Type SEND to confirm", confirm)),
            h("div", { class: "row" }, test, send)),
          h("div", { class: "panel" }, h("h3", { text: "Progress" }), progress, h("h4", { text: "Recent announcements" }), history));
      }).catch(e => box.replaceChildren(h("div", { class: "notice warn", text: e.message })));
      return [box];
    };

    const giveaway = () => {
      const title = h("input", { type: "text", maxlength: "100", placeholder: "Title (optional, made from the prizes)", "aria-label": "Giveaway title" });
      const game = h("input", { type: "text", maxlength: "100", placeholder: "Game name for the artwork (optional)", "aria-label": "Game name" });
      const desc = h("textarea", { class: "short", rows: "3", maxlength: "1500", placeholder: "Extra text shown on the giveaway (optional)", "aria-label": "Description" });
      const keys = h("textarea", { rows: "6", maxlength: "20000", autocomplete: "off", spellcheck: "false", placeholder: "Hades | AAAAA-BBBBB-CCCCC\nCeleste | DDDDD-EEEEE-FFFFF\n(a key on its own uses the game name)", "aria-label": "Prize keys" });
      const length = h("input", { type: "text", value: "24h", maxlength: "20", placeholder: "24h, 3d, 1w", "aria-label": "How long it runs" });
      const claim = h("input", { type: "number", min: "1", max: "168", value: "48", "aria-label": "Hours to claim" });
      const who = select([["both", "Every server's giveaway channel and DMs"], ["channels", "Server giveaway channels only"], ["dm", "DMs only"]], "both");
      const confirm = h("input", { type: "text", placeholder: "SEND", maxlength: "4", autocomplete: "off", "aria-label": "Type SEND to confirm" });
      const go = h("button", { class: "btn red", type: "button", text: "Start the giveaway" });
      // Who hosts it, and what people should do to be considered.
      const hostKind = select([["network", "Me (cross-server giveaway hosted by you)"], ["partner", "A partner"]], "network");
      const pName = h("input", { type: "text", maxlength: "60", placeholder: "Partner name", "aria-label": "Partner name" });
      const pLogo = h("input", { type: "url", maxlength: "300", placeholder: "Logo image link (https, optional)", "aria-label": "Partner logo" });
      const pWeb = h("input", { type: "url", maxlength: "300", placeholder: "https://partner-website.com", "aria-label": "Partner website" });
      const pDiscord = h("input", { type: "url", maxlength: "300", placeholder: "https://discord.gg/invite", "aria-label": "Partner Discord" });
      const pX = h("input", { type: "url", maxlength: "300", placeholder: "https://x.com/partner", "aria-label": "Partner X" });
      const pOther = h("input", { type: "url", maxlength: "300", placeholder: "Another link (Twitch, YouTube, Steam page...)", "aria-label": "Another partner link" });
      const partnerBox = h("div", { class: "panel", hidden: true }, h("h4", { text: "Partner" }), h("p", { class: "muted small", text: "The giveaway shows the partner as host, with these links. You still hold the keys and handle key problems." }),
        h("div", { class: "grid two" }, field("Name", pName), field("Logo", pLogo), field("Website", pWeb), field("Discord", pDiscord), field("X (Twitter)", pX), field("Another link", pOther)));
      hostKind.addEventListener("change", () => { partnerBox.hidden = hostKind.value !== "partner"; });
      const stepRows = h("div"), stepList = [];
      const addStep = (kind = "follow_x") => {
        const kinds = (info && info.stepKinds) || [];
        const sel = select(kinds.map(k => [k.id, k.label]), kind), url = h("input", { type: "url", maxlength: "300", placeholder: "https://…", "aria-label": "Step link" }), label = h("input", { type: "text", maxlength: "80", placeholder: "Button text (optional)", "aria-label": "Step text" });
        const hint = h("span", { class: "muted small" });
        const setHint = () => { const k = kinds.find(x => x.id === sel.value); hint.textContent = k ? k.hint : ""; };
        sel.addEventListener("change", setHint); setHint();
        const del = h("button", { class: "btn gray small", type: "button", text: "Remove" });
        const row = h("div", { class: "setup-row" }, h("div", { class: "row" }, sel, label, url, del), hint);
        const entry = { sel, url, label, row };
        del.addEventListener("click", () => { stepList.splice(stepList.indexOf(entry), 1); row.remove(); });
        stepList.push(entry); stepRows.append(row);
      };
      const addStepBtn = h("button", { class: "btn gray small", type: "button", text: "Add an entry step" });
      addStepBtn.addEventListener("click", () => { if (stepList.length >= 8) { toast("Up to 8 steps.", "warn"); return; } addStep(); });
      const box = h("div"), list = h("div");
      let info = null, timer = 0;
      const paintList = () => {
        const when = t => new Date(t).toLocaleString();
        list.replaceChildren(info.list.length ? table(["#", "Title", "Host", "Status", "Entries", "Shown in", "Ends"], info.list.map(g => [g.id, g.title, g.host || "-", g.status, g.entries,
          `${g.channels} server${g.channels === 1 ? "" : "s"}, ${g.dms} DM${g.dms === 1 ? "" : "s"}${g.spread && !g.spread.done ? ` (sending ${g.spread.sent + g.spread.failed}/${g.spread.total})` : g.spread && g.spread.failed ? ` (${g.spread.failed} failed)` : ""}`, when(g.ends_at)])) : h("p", { class: "muted", text: "No network-wide giveaways yet." }));
        // End buttons sit under the table so the table helper stays plain text.
        const active = info.list.filter(g => g.status === "active");
        if (active.length) list.append(h("div", { class: "row" }, ...active.map(g => { const b = h("button", { class: "btn gray small", type: "button", text: `End #${g.id} now and draw` }); b.addEventListener("click", () => busy(b, async () => { const r = await api("/api/admin/giveaways/end", { id: g.id }); toast(`Ended. ${r.winners} winner${r.winners === 1 ? "" : "s"} drawn.`, "ok"); await refresh(); })); return b; })));
      };
      async function refresh() {
        info = await api("/api/admin/giveaways");
        paintList();
        clearTimeout(timer);
        if (info.list.some(g => g.spread && !g.spread.done) && document.body.contains(box)) timer = setTimeout(() => refresh().catch(() => {}), 2500);
      }
      go.addEventListener("click", () => busy(go, async () => {
        const r = await api("/api/admin/giveaways/create", { title: title.value, game: game.value, description: desc.value, keys: keys.value, length: length.value, claim_hours: claim.value, audience: who.value, confirm: confirm.value,
          host: hostKind.value === "partner" ? { kind: "partner", name: pName.value, logo: pLogo.value, links: [["Website", pWeb.value], ["Discord", pDiscord.value], ["X", pX.value], ["", pOther.value]].filter(l => l[1].trim()).map(l => ({ label: l[0], url: l[1] })) } : { kind: "network" },
          steps: stepList.map(e => ({ kind: e.sel.value, url: e.url.value, label: e.label.value })) });
        toast(`Your giveaway is live with ${r.prizes} prize${r.prizes === 1 ? "" : "s"}. Sending it out to ${r.total} more place${r.total === 1 ? "" : "s"}.`, "ok");
        confirm.value = ""; keys.value = "";
        await refresh();
      }));
      refresh().then(() => {
        if (!info.available) { box.replaceChildren(h("div", { class: "notice warn", text: "Giveaways are not set up on this bot (the owner needs to set KEY_ENCRYPTION_SECRET)." })); return; }
        box.replaceChildren(
          h("div", { class: "panel" }, h("h3", { text: "Network-wide giveaway" }),
            h("p", { class: "muted small", text: `One giveaway, shown in every server's giveaway channel (or its alert channel if none is set) and in DMs. Entries from everywhere count together, and winners are drawn once. It is posted in ${info.destinations.length} server${info.destinations.length === 1 ? "" : "s"} and ${info.dm} member DM${info.dm === 1 ? "" : "s"}. Winners claim their key by DM.` }),
            info.destinations.length ? null : h("div", { class: "notice warn", text: "No server has a giveaway or alert channel yet. Set one on the Giveaways page (Server settings) first." }),
            field("Title", title), field("Game (for the artwork)", game), field("Description", desc), field("Prize keys, one per line (Game | KEY)", keys),
            field("Hosted by", hostKind), partnerBox,
            h("h4", { text: "Entry steps (optional)" }), h("p", { class: "muted small", text: "Ask people to do something first, like following a partner on X or joining their Discord. Each step shows as a numbered line and a link button on the giveaway. Discord cannot check these, so the post says winners may be checked." }), stepRows, addStepBtn,
            h("div", { class: "row" }, field("Runs for", length), field("Hours to claim a key", claim)),
            h("div", { class: "row" }, field("Send to", who), field("Type SEND to confirm", confirm)),
            go),
          h("div", { class: "panel" }, h("h3", { text: "Your network-wide giveaways" }), list));
      }).catch(e => box.replaceChildren(h("div", { class: "notice warn", text: e.message })));
      return [box];
    };

    // Community features across every server: what is built, what is used, and which giveaway partners ran what. Counts only.
    const community = () => {
      const box = h("div", { class: "muted", text: "Loading…" });
      api("/api/admin/community").then(c => {
        const t = c.totals, u = c.usage, g = c.giveaways;
        const use = k => (u[k] ? u[k].n : 0);
        const last = k => (u[k] && u[k].last_at ? new Date(u[k].last_at).toLocaleDateString() : "never");
        const row = (label, key) => [label, n0(use(key)), last(key)];
        box.className = "";
        box.replaceChildren(
          c.membersIntent ? null : h("div", { class: "notice warn", text: "Server Members Intent is off for the bot, so welcome messages and invite tracking are paused everywhere. Turn it on in the Discord Developer Portal (Bot, Privileged Gateway Intents) and restart." }),
          h("div", { class: "grid four" }, tile("Servers using community", t.servers, `${t.built} built with /community setup`), tile("Welcome on", t.welcomeOn, "servers"), tile("XP on", t.xpOn, `${n0(t.xpMembers)} members earning`), tile("Total XP earned", n0(t.xpTotal)),
            tile("Joins tracked", n0(t.joins), `${n0(t.referred)} through an invite`), tile("Personal invite links", n0(t.inviteLinks)), tile("Level rewards set", n0(t.levelRoles), `${n0(t.rewards)} referral rewards`), tile("Role picker roles", n0(t.selfRoles)), tile("Moderation cases", n0(t.modCases), `${t.modServers} servers · ${n0(t.activeWarnings)} active warnings`)),
          h("div", { class: "panel" }, h("h3", { text: "Feature use" }),
            table(["What", "Times", "Last used"], [row("Server built automatically (fresh server)", "setup_auto"), row("Server built with /community setup", "setup_manual"), row("Server built from the dashboard", "dash_setup"), row("Channels created", "channels_created"), row("Welcome messages posted", "welcomes"), row("Welcome DMs sent", "welcome_dms"), row("Welcome DMs that could not be delivered", "welcome_dm_failed"),
              row("Joins tracked", "joins_tracked"), row("Referrals credited", "referrals"), row("Invite links made", "invite_links"), row("Level-ups", "level_ups"), row("Roles picked from the panel", "role_picks"), row("Emoji added", "emoji_added"), row("Emoji added from the dashboard", "dash_emoji"), row("Emoji images uploaded on the dashboard", "dash_emoji_upload"), row("Steam Verified roles given", "steam_verified_roles"),
              row("/rank used", "cmd:rank"), row("/levels used", "cmd:levels"), row("/invites me used", "cmd:invites/me"), row("/invites top used", "cmd:invites/top"), row("/invites link used", "cmd:invites/link"), row("/emoji import used", "cmd:emoji/import"), row("/emoji list used", "cmd:emoji/list"), row("/community used", "cmd:community/status"),
              row("Warnings", "mod_warn"), row("Timeouts", "mod_timeout"), row("Timeouts lifted", "mod_untimeout"), row("Kicks", "mod_kick"), row("Bans", "mod_ban"), row("Unbans", "mod_unban"), row("Message cleanups", "mod_purge"), row("Messages deleted", "mod_messages_cleared"), row("Warnings cleared", "mod_warnings_cleared"), row("Moderation done on the dashboard", "dash_mod"), row("/mod warn used", "cmd:mod/warn"), row("/mod timeout used", "cmd:mod/timeout"), row("/mod kick used", "cmd:mod/kick"), row("/mod ban used", "cmd:mod/ban"), row("/mod purge used", "cmd:mod/purge"), row("/mod cases used", "cmd:mod/cases")])),
          h("div", { class: "panel" }, h("h3", { text: "Cross-server giveaways" }),
            h("div", { class: "grid four" }, tile("Cross-server giveaways", g.crossServer), tile("Hosted by a partner", g.partner), tile("With entry steps", g.withSteps), tile("Entries", n0(g.crossEntries))),
            h("h4", { text: "Partners" }), table(["Partner", "Giveaways", "Entries"], g.partners.map(p => [p.name, p.giveaways, n0(p.entries)]))),
          h("div", { class: "panel" }, h("h3", { text: `Servers (${c.servers.length})` }),
            table(["Server", "Built", "Welcome", "XP", "Members with XP", "XP total", "Joins", "Through an invite", "Level roles", "Mod cases"], c.servers.map(r => [r.name || r.id, r.setup_at ? "Yes" : "No", r.welcome_on ? "On" : "Off", r.xp_on ? `On ×${r.xp_mult}` : "Off", n0(r.xp_members), n0(r.xp_total), n0(r.joins), n0(r.referred), r.level_roles, n0(r.mod_cases)]))));
      }).catch(e => box.replaceChildren(h("div", { class: "notice warn", text: e.message })));
      return [box];
    };

    const TABS = [["overview", "Overview", overview], ["bugs", "Bugs", bugs], ["growth", "Growth", growth], ["features", "Usage", features], ["community", "Community", community], ["servers", "Servers", servers], ["members", "Members", members], ["announce", "Announce", announce], ["giveaway", "Giveaway", giveaway], ["tools", "Tools and logs", tools]];
    let current = "overview";
    const tabBar = h("div", { class: "tabs" });
    const body = h("div");
    const show = () => {
      tabBar.replaceChildren(...TABS.map(([id, label]) => h("button", { class: "tab" + (id === current ? " active" : ""), type: "button", onclick: () => { current = id; show(); } }, label, id === "bugs" && bugData.newCount ? h("span", { class: "badge-count", text: String(Math.min(99, bugData.newCount)) }) : null)));
      body.replaceChildren(...TABS.find(t => t[0] === current)[2]());
    };
    holder.className = "";
    holder.replaceChildren(tabBar, body);
    show();
  }


  // ---------- giveaways ----------
  async function giveawaysView() {
    const servers = state.me.servers.filter(g => g.manageable);
    const holder = h("div");
    const guild = serverPicker(servers);
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
      const gwCh = select([["", "The alert channel"], ...channels.map(c => [c.id, "#" + c.name])], settings.giveaway_channel_id || "");
      const save = h("button", { class: "btn gray", text: "Save", onclick: () => busy(save, async () => { await api("/api/giveaways/setup", { guild_id: guild.value, vouch_channel_id: vouch.value, giveaway_channel_id: gwCh.value, manager_role_id: mgr.value }); toast("Saved.", "ok"); }) });
      return h("div", { class: "panel" }, h("h3", { text: "Server settings" }),
        h("div", { class: "row" }, field("Vouches channel (winners' confirmations are posted here)", vouch), field("Role that can run giveaways in Discord", mgr)),
        h("div", { class: "row" }, field("Giveaway channel (network-wide giveaways from the bot owner appear here)", gwCh)), h("p"), save);
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
      state.about = x.about; state.creator = x.creator; state.freeNow = x.freeNow ?? null;
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
      const kindSel = select([["help", "I need help"], ["bug", "Report a bug (goes to the bot owner)"]], "help");
      const send = h("button", { class: "btn green", text: "Open ticket", onclick: () => busy(send, async () => {
        const r = await api("/api/tickets", { subject: subject.value, body: body.value, guild_id: kindSel.value === "bug" ? null : guildSel.value || null, kind: kindSel.value });
        toast(`Ticket #${r.id} opened.`); location.hash = "#/support/" + r.id;
      }) });
      const q = h("input", { type: "search", placeholder: "Search subject, tag or #id", value: filter.q });
      const st = select([["active", "Active"], ["all", "All"], ["open", "Open"], ["waiting", "Waiting on user"], ["resolved", "Resolved"], ["closed", "Closed"]], filter.status);
      const apply = () => { filter = { q: q.value.trim(), status: st.value }; load().catch(e => toast(e.message, "error")); };
      q.addEventListener("change", apply); st.addEventListener("change", apply);
      holder.className = "";
      holder.replaceChildren(...[
        h("div", { class: "panel" }, h("h3", { text: "Open a ticket" }),
          h("div", { class: "row" }, field("Type", kindSel), field("Subject", subject), field("Send to", guildSel)), field("Details", body),
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
  const TYPE_LABEL = { alert: "Sale alerts", bundle: "Bundles & giveaways", free: "Free games", digest: "Weekly digest", release: "Release day", friend: "Friend birthdays" };
  const PRIZE_STATUS = { assigned: "Waiting for you to claim", delivered: "Key sent", confirmed: "Redeemed", problem: "Problem reported", expired: "Expired" };
  const TYPE_ICON = { alert: "🔔", bundle: "🎁", free: "🆓", digest: "📰", release: "🎉", friend: "🎂", status: "🛠️", giveaway: "🏆", ticket: "🎫" };

  // Alert text is written for Discord (## headings, **bold**, <t:...> times). Show it as plain words on the website.
  function plainDiscord(text) {
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    const rel = sec => {
      const d = sec * 1000 - Date.now(), a = Math.abs(d);
      for (const [ms, unit] of [[86400000 * 365, "year"], [86400000 * 30, "month"], [86400000, "day"], [3600000, "hour"], [60000, "minute"]]) if (a >= ms) return rtf.format(Math.round(d / ms), unit);
      return rtf.format(0, "second");
    };
    return String(text)
      .replace(/<t:(\d{1,12})(?::([a-zA-Z]))?>/g, (_m, t, f) => (f === "R" ? rel(Number(t)) : new Date(Number(t) * 1000).toLocaleString(undefined, f === "d" || f === "D" ? { dateStyle: "medium" } : f === "t" || f === "T" ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" })))
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "$1")
      .replace(/<a?:\w+:\d+>/g, "").replace(/<[@#][&!]?\d+>/g, "")
      .replace(/^\s{0,3}#{1,3}\s+/gm, "").replace(/(\*\*|__|~~|`)/g, "").replace(/(^|\s)[*_](?=\S)|(?<=\S)[*_](?=\s|$)/g, "$1")
      .replace(/\s*\n+\s*/g, " · ").replace(/\s{2,}/g, " ").trim();
  }

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
      holder.replaceChildren(...[
        prizes.length ? h("div", { class: "panel" }, h("h3", { text: "Your prizes" }),
          h("p", { class: "muted small", text: "Press Claim key on the winners message in Discord. Keys are never shown here." }),
          ...prizes.map(p => h("div", { class: "kv" }, h("span", {}, h("b", { text: p.label + " " }), h("span", { class: "muted", text: `${p.title} · ${PRIZE_STATUS[p.status] || p.status}${p.status === "assigned" && p.deadline ? " · claim by " + new Date(p.deadline).toLocaleString() : ""}` })),
            p.link ? ext(p.link, "Open in Discord") : null))) : null,
        h("div", { class: "panel" }, h("h3", { text: "What gets sent to Discord" }), ...toggles),
        h("div", { class: "panel" }, h("h3", { text: "Recent" }),
          d.items.length ? h("div", { class: "cards" }, ...d.items.map(n => h(n.url && /^https:\/\//.test(n.url) ? "a" : "div", { class: "card-link" + (n.read ? "" : " unread"), ...(n.url && /^https:\/\//.test(n.url) ? { href: n.url, target: "_blank", rel: "noopener noreferrer" } : {}) },
            h("span", { class: "icon", text: TYPE_ICON[n.type] || "🔔" }),
            h("span", {}, h("strong", { text: n.title }), h("span", { class: "muted", text: `${new Date(n.at).toLocaleString()}${n.body ? " · " + plainDiscord(n.body).slice(0, 160) : ""}` }))))) : h("p", { class: "muted", text: "Nothing yet. Alerts will show up here." }))].filter(Boolean));
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
    return h("div", { class: "notice news" }, h("span", { text: "✨ New: " + (state.me.newsTitle || "see what changed") + ". " }), h("a", { href: "#/changelog", text: "See what's new" }),
      h("button", { class: "btn gray small", text: "Dismiss", onclick: async e => { const box = e.currentTarget.parentElement; state.me.news = null; box.remove(); try { await api("/api/changelog/seen", {}); } catch {} } }));
  }

  function setupCard() {
    const steps = state.me && state.me.setup;
    if (!steps || steps.every(x => x.done)) return null;
    const done = steps.filter(x => x.done).length;
    return h("div", { class: "panel" }, h("h3", { text: `Get set up (${done} of ${steps.length})` }),
      progressBar(done / steps.length),
      ...steps.map(x => h("a", { class: "step-row" + (x.done ? " done" : ""), href: x.href }, h("span", { text: x.done ? "✅" : "⬜" }), " ", x.text, x.optional && !x.done ? h("span", { class: "muted small", text: "  optional" }) : null)));
  }

  // High contrast is a per-device choice kept in localStorage; the page works without it.
  function contrastOn() { try { return localStorage.getItem("svc_contrast") === "1"; } catch { return false; } }
  function applyContrast(on) { document.documentElement.toggleAttribute("data-contrast", on); try { localStorage.setItem("svc_contrast", on ? "1" : "0"); } catch {} }
  applyContrast(contrastOn());
  // One display menu instead of two separate buttons: theme and high contrast.
  function displayMenu() {
    const btn = h("button", { type: "button", class: "theme-btn", "aria-haspopup": "true", "aria-expanded": "false", text: "◐", title: "Display", "aria-label": "Display: theme and contrast" });
    const light = () => window.svcTheme && window.svcTheme.current() === "light";
    const themeItem = h("button", { type: "button", role: "menuitem" }), contrastItem = h("button", { type: "button", role: "menuitem" });
    const paint = () => { themeItem.textContent = light() ? "☾ Switch to dark theme" : "☀ Switch to light theme"; contrastItem.textContent = (contrastOn() ? "✓ " : "") + "High contrast"; };
    themeItem.addEventListener("click", () => { if (window.svcTheme) window.svcTheme.toggle(); paint(); });
    contrastItem.addEventListener("click", () => { applyContrast(!contrastOn()); paint(); });
    paint();
    const menu = h("div", { class: "menu right", role: "menu", hidden: true }, themeItem, contrastItem);
    const wrap = h("div", { class: "nav-group" }, btn, menu);
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const wasOpen = openMenu && openMenu.btn === btn;
      closeMenu();
      if (!wasOpen) { paint(); menu.hidden = false; btn.setAttribute("aria-expanded", "true"); openMenu = { wrap, btn, menu }; }
    });
    return wrap;
  }

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

  // Server picker: pills instead of a long dropdown, starting on the server you used last (or the one your account is tied to).
  // It behaves like a select: it has .value and fires "change". Many servers fall back to a normal dropdown.
  function activeGuildId(servers, wanted) {
    let saved = null;
    try { saved = localStorage.getItem("svc_guild"); } catch { /* storage can be blocked */ }
    const ok = id => id && servers.some(g => g.id === id);
    return [wanted, saved, state.me && state.me.settings && state.me.settings.guild_id].find(ok) || (servers[0] && servers[0].id) || "";
  }
  function serverPicker(servers, wanted) {
    let current = activeGuildId(servers, wanted);
    const remember = id => { try { localStorage.setItem("svc_guild", id); } catch { /* fine */ } };
    if (servers.length > 8) {
      const sel = select(servers.map(g => [g.id, g.name]), current);
      sel.addEventListener("change", () => remember(sel.value));
      return sel;
    }
    const el = h("div", { class: "chips server-pills", role: "radiogroup", "aria-label": "Server" });
    Object.defineProperty(el, "value", { get: () => current, set: v => { current = v; paint(); } });
    function paint() {
      el.replaceChildren(...servers.map(g => {
        const b = h("button", { type: "button", class: "tab small" + (g.id === current ? " active" : ""), role: "radio", "aria-checked": g.id === current ? "true" : "false" },
          g.icon ? h("img", { class: "pill-icon", src: g.icon, alt: "", width: "18", height: "18" }) : null, g.name);
        b.addEventListener("click", () => { if (g.id === current) return; current = g.id; remember(g.id); paint(); el.dispatchEvent(new Event("change")); });
        return b;
      }));
    }
    paint();
    return el;
  }

  // ---------- game night ----------
  async function gameNightView() {
    const servers = state.me.servers.filter(g => g.bot !== false);
    const out = h("div");
    const guild = serverPicker(servers);
    const people = h("div", { class: "chips" });
    app.replaceChildren(pageHead("Game night", "Pick who is playing. See what everyone owns, who is missing a game, and what is worth buying together. Only members who opted in with /alerts share are listed."),
      h("div", { class: "panel" }, servers.length > 1 ? field("Server", guild) : null, people, out));
    const picked = new Set();
    async function loadMembers() {
      picked.clear(); out.replaceChildren(); people.replaceChildren(h("span", { class: "muted", text: "Loading…" }));
      try {
        const d = await api("/api/gamenight/members?guild=" + encodeURIComponent(guild.value));
        if (!d.members.length) { people.replaceChildren(h("p", { class: "muted", text: "Nobody here has opted in yet. Members turn it on with /alerts share (or on the Alerts page)." })); return; }
        people.replaceChildren(...d.members.map(m => { const b = h("button", { type: "button", class: "tab small", text: m.name }); b.addEventListener("click", () => { picked.has(m.id) ? picked.delete(m.id) : picked.add(m.id); b.classList.toggle("active", picked.has(m.id)); }); return b; }),
          (() => { const go = h("button", { class: "btn green small", text: "Work it out" }); go.addEventListener("click", () => busy(go, async () => show(await api("/api/gamenight", { guild_id: guild.value, user_ids: [...picked] })))); return go; })());
      } catch (e) { people.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    function show(r) {
      const list = (title, rows) => h("div", { class: "subpanel" }, h("h4", { text: title }), rows.length ? h("ul", {}, ...rows.map(x => h("li", { text: x }))) : h("p", { class: "muted", text: "None." }));
      out.replaceChildren(
        list(`Everyone owns (${r.allOwn.length})`, r.allOwn),
        list("Almost everyone owns", r.almost.map(a => `${a.title} (missing: ${a.missing.join(", ")})`)),
        list("Worth buying together", r.buy.map(b => `${b.title}, wanted by ${b.wanters.join(", ")}${b.price !== null ? ` at ${b.price.toFixed(2)} ${b.currency}${b.shop ? " at " + b.shop : ""}` : ""}`)),
        r.allOwn.length ? (() => { const b = h("button", { class: "btn gray small", text: "Pick a game for us" }); b.addEventListener("click", () => toast("Tonight: " + r.allOwn[Math.floor(Math.random() * r.allOwn.length)], "ok")); return b; })() : null);
    }
    guild.addEventListener("change", loadMembers);
    loadMembers();
  }

  // ---------- compare with a friend ----------
  async function compareView() {
    const servers = state.me.servers.filter(g => g.bot !== false);
    const out = h("div");
    const guild = serverPicker(servers);
    const people = h("div", { class: "chips" });
    app.replaceChildren(pageHead("Compare", "Pick a friend to see what you both own and what only one of you has. Only members who opted in with /alerts share can be compared."),
      h("div", { class: "panel" }, servers.length > 1 ? field("Server", guild) : null, people), out);
    async function loadMembers() {
      out.replaceChildren(); people.replaceChildren(h("span", { class: "muted", text: "Loading…" }));
      if (!servers.length) { people.replaceChildren(h("p", { class: "muted", text: "Invite the bot to a server first. Comparing works between members of the same server." })); return; }
      try {
        const d = await api("/api/gamenight/members?guild=" + encodeURIComponent(guild.value));
        const others = d.members.filter(m => !state.me.user || m.id !== state.me.user.id);
        if (!others.length) { people.replaceChildren(h("p", { class: "muted", text: "Nobody else here has opted in yet. Members turn it on with /alerts share (or on the Alerts page)." })); return; }
        people.replaceChildren(...others.map(m => { const b = h("button", { type: "button", class: "tab small", text: m.name }); b.addEventListener("click", () => busy(b, async () => show(await api("/api/compare?guild=" + encodeURIComponent(guild.value) + "&user=" + encodeURIComponent(m.id))))); return b; }));
      } catch (e) { people.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    const hrs = m => (m >= 60 ? Math.round(m / 60).toLocaleString() + "h" : "");
    function show(r) {
      const list = (title, rows, f) => h("div", { class: "subpanel" }, h("h4", { text: title }), rows.length ? h("ul", {}, ...rows.map(x => h("li", { text: f(x) }))) : h("p", { class: "muted", text: "Nothing." }));
      out.replaceChildren(
        h("div", { class: "panel" }, h("h3", { text: "You and " + r.name }),
          h("div", { class: "grid four" },
            h("div", { class: "tile" }, h("div", { class: "k", text: "In common" }), h("div", { class: "v", text: String(r.shared.length) }), h("div", { class: "s", text: r.overlapPct + "% overlap" })),
            h("div", { class: "tile" }, h("div", { class: "k", text: "Your games" }), h("div", { class: "v", text: String(r.a.games) }), h("div", { class: "s", text: hrs(r.a.minutes) ? hrs(r.a.minutes) + " on record" : "" })),
            h("div", { class: "tile" }, h("div", { class: "k", text: r.name + "'s games" }), h("div", { class: "v", text: String(r.b.games) }), h("div", { class: "s", text: hrs(r.b.minutes) ? hrs(r.b.minutes) + " on record" : "" })),
            h("div", { class: "tile" }, h("div", { class: "k", text: "You have, they don't" }), h("div", { class: "v", text: String(r.onlyA.length) }))),
          list(`You both own (${r.shared.length})`, r.shared, x => x.title + (x.aMinutes || x.bMinutes ? `  (you ${hrs(x.aMinutes) || "0h"}, them ${hrs(x.bMinutes) || "0h"})` : "")),
          list(`Only you (${r.onlyA.length})`, r.onlyA, x => x.title),
          list(`Only ${r.name} (${r.onlyB.length})`, r.onlyB, x => x.title)));
    }
    guild.addEventListener("change", loadMembers);
    loadMembers();
  }

  // ---------- calendar ----------
  // Built in: wishlist release dates, Steam sales, server events and group games. Managers add server events here.
  // The private feed link (for Google, Apple or Outlook calendar) is optional.
  // Sale war room: your buy-now list with a budget slider. Ticked games are the cart; the slider auto-fills the best savings first.
  async function warRoomView() {
    const out = h("div", { class: "muted", text: "Checking your wishlist…" });
    const st = { rows: [], cur: "USD", picked: new Set(), budget: 0, sale: null, store: "all", sort: "discount" };
    const isSteam = r => /^steam$/i.test(r.shop);
    const SORTS = { discount: (a, b) => b.discount - a.discount || a.title.localeCompare(b.title), saving: (a, b) => ((b.regular ?? b.price) - b.price) - ((a.regular ?? a.price) - a.price), cheap: (a, b) => a.price - b.price, pricey: (a, b) => b.price - a.price, name: (a, b) => a.title.localeCompare(b.title) };
    // What the filters leave showing. The cart keeps anything ticked even when a filter hides it.
    const shown = () => st.rows.filter(r => st.store === "all" || (st.store === "steam" ? isSteam(r) : !isSteam(r))).sort(SORTS[st.sort]);
    const slider = h("input", { type: "range", class: "war-slider", min: "0", max: "500", step: "5", value: "0", "aria-label": "Budget" });
    const label = h("strong", { text: "" });
    const total = h("div", { class: "muted" });
    const list = h("div", { class: "panel war-list" });
    const sum = () => st.rows.filter(r => st.picked.has(r.itad_id)).reduce((t, r) => t + r.price, 0);
    function autofill() {
      st.picked = new Set(); let left = st.budget;
      const order = [...shown()].sort((a, b) => ((b.regular ?? b.price) - b.price) / b.price - ((a.regular ?? a.price) - a.price) / a.price);
      for (const r of order) if (r.price <= left + 1e-9) { st.picked.add(r.itad_id); left -= r.price; }
    }
    function draw() {
      label.textContent = "Budget: " + money(st.budget, st.cur);
      const spent = sum(), saved = st.rows.filter(r => st.picked.has(r.itad_id)).reduce((t, r) => t + Math.max(0, (r.regular ?? r.price) - r.price), 0);
      total.textContent = st.picked.size + " in the cart · " + money(spent, st.cur) + (spent > st.budget && st.budget > 0 ? " (over budget by " + money(spent - st.budget, st.cur) + ")" : "") + " · saves " + money(saved, st.cur);
      const rows = shown();
      if (!st.rows.length) return list.replaceChildren(h("div", { class: "empty", text: "Nothing on your wishlist is at or near a low right now. Games show up here as they drop." }));
      if (!rows.length) return list.replaceChildren(h("div", { class: "empty", text: "Nothing matches that filter. Try All stores." }));
      list.replaceChildren(...rows.map(r => {
        const box = h("input", { type: "checkbox", checked: st.picked.has(r.itad_id) });
        box.addEventListener("change", () => { if (box.checked) st.picked.add(r.itad_id); else st.picked.delete(r.itad_id); draw(); });
        return h("label", { class: "war-row" }, box, h("b", { text: " " + r.title }), h("span", { class: "muted", text: "  " + money(r.price, st.cur) + (r.discount > 0 ? " (-" + Math.round(r.discount * 100) + "%)" : "") + " at " + r.shop + (r.verdict ? " · " + r.verdict : "") }));
      }));
    }
    slider.addEventListener("input", () => { st.budget = Number(slider.value); autofill(); draw(); });
    const storeSel = select([["all", "All stores"], ["steam", "Steam only"], ["other", "Other stores only"]], st.store);
    const sortSel = select([["discount", "Biggest discount"], ["saving", "Most money saved"], ["cheap", "Cheapest first"], ["pricey", "Priciest first"], ["name", "Name A to Z"]], st.sort);
    storeSel.addEventListener("change", () => { st.store = storeSel.value; draw(); });
    sortSel.addEventListener("change", () => { st.sort = sortSel.value; draw(); });
    const quick = (text, title, fn) => { const b = h("button", { class: "btn small blue", type: "button", text, title }); b.addEventListener("click", () => { fn(); draw(); }); return b; };
    // "Steam sale picks": the Steam sale only lowers Steam prices, so tick every game whose best price is on Steam right now (best savings first, inside the budget when one is set).
    const salePicks = () => {
      st.picked = new Set(); let left = st.budget > 0 ? st.budget : Infinity;
      for (const r of st.rows.filter(isSteam).sort(SORTS.saving)) if (r.price <= left + 1e-9) { st.picked.add(r.itad_id); left -= r.price; }
    };
    const tools = h("div", { class: "row war-tools" },
      field("Show", storeSel), field("Sort by", sortSel),
      h("div", { class: "war-quick" },
        quick("Steam sale picks", "Tick the games that are cheapest on Steam right now", salePicks),
        quick("Select shown", "Tick everything the filter is showing", () => { for (const r of shown()) st.picked.add(r.itad_id); }),
        quick("Clear", "Untick everything", () => { st.picked = new Set(); })));
    async function load() {
      try {
        const d = await api("/api/saleprep");
        st.rows = d.buyNow; st.cur = d.currency; st.sale = d.sale;
        const top = Math.max(50, Math.ceil(st.rows.reduce((t, r) => t + r.price, 0) / 5) * 5);
        slider.max = String(top);
        out.className = "";
        out.replaceChildren(h("p", { class: "muted", text: (d.sale ? (d.sale.live ? d.sale.name + " is on now. This page refreshes every 5 minutes." : "Next: " + d.sale.name + " starts " + new Date(d.sale.start).toLocaleDateString() + ".") : "No Steam sale is on the calendar yet.") + " " + st.rows.length + " of " + d.watching + " wishlist games are at or near a low." }),
          h("div", { class: "panel" }, label, slider, total), tools, list);
        st.picked = new Set([...st.picked].filter(id => st.rows.some(r => r.itad_id === id)));
        draw();
        if (d.sale && d.sale.live && currentView() === "warroom") setTimeout(() => { if (currentView() === "warroom") load(); }, 300_000);
      } catch (e) { out.className = ""; out.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    app.replaceChildren(pageHead("Sale war room", "Plan your cart for a Steam sale: set a budget and the best savings fill it first. Untick anything you do not want."), out);
    load();
  }

  // My page: every feature as a card with its status, a switch where one is simple, and a link to set it up. Cards can be pinned, hidden and reordered (kept on this device).
  // First-login tour: a short card that points at the real menu items one at a time. Shown once per account; "Take the tour" replays it.
  function startTour() {
    const steps = [
      { title: "Welcome", text: "A 30 second look around. Use the arrow keys or the buttons, and Esc to leave any time." },
      { sel: "#nav", title: "The menu", text: "Pages are grouped into Library, Prices, Friends, Servers, Account and Help. Pick one and its pages show as tabs just below the menu." },
      { href: "#/mypage", title: "My page", text: "Every feature as a card. Switch the simple ones on here, pin the ones you use and make a profile card." },
      { href: "#/wishlist", title: "Wishlist", text: "Import your Steam wishlist or add games. Pick the rule for each one: any sale, a percent off, a price or an all-time low." },
      { href: "#/library", title: "Library", text: "What you own and paid, your backlog, spend, challenge and trophies." },
      { href: "#/steam", title: "Steam", text: "Link your public profile for hours played, hours tracked over time and a taste profile." },
      { href: "#/free", title: "Free games", text: "Everything free to claim right now on Steam, Epic, GOG and more, with store filters." },
      { href: "#/alerts", title: "Alert settings", text: "Choose DM or a server channel, quiet hours, a weekly digest and free game alerts." },
      { href: "#/notifications", title: "Notifications", text: "A copy of every alert, so a missed DM is never lost." },
      { href: "#/help", title: "Help and support", text: "The full command list lives in Help, and Support reaches a human. Press / anywhere to search." }
    ];
    document.getElementById("tour")?.remove();
    const root = h("div", { id: "tour", class: "tour", role: "dialog", "aria-modal": "false", "aria-labelledby": "tour-title" });
    let n = 0, ringed = null, shownMenu = null;
    const finish = () => {
      root.remove(); document.removeEventListener("keydown", onKey, true); if (ringed) ringed.classList.remove("tour-ring"); if (shownMenu) shownMenu.hidden = true;
      if (state.me) { state.me.tour = false; api("/api/tour/done", {}).catch(() => {}); }
    };
    function show() {
      const s = steps[n];
      if (ringed) ringed.classList.remove("tour-ring");
      if (shownMenu) { shownMenu.hidden = true; shownMenu = null; }
      const target = s.sel ? document.querySelector(s.sel) : s.href ? document.querySelector('#nav a[data-pages~="' + s.href.replace("#/", "") + '"]') : null;
      ringed = target;
      const menu = target && target.closest(".menu");
      if (menu) { menu.hidden = false; shownMenu = menu; }
      if (target) { target.classList.add("tour-ring"); target.scrollIntoView({ block: "nearest" }); }
      const back = h("button", { class: "btn gray small", type: "button", text: "Back", disabled: n === 0, onclick: () => { n--; show(); } });
      const next = h("button", { class: "btn blue small", type: "button", text: n === steps.length - 1 ? "Done" : "Next", onclick: () => { if (n === steps.length - 1) finish(); else { n++; show(); } } });
      const skip = h("button", { class: "btn gray small", type: "button", text: "Skip", onclick: finish });
      root.replaceChildren(h("div", { class: "tour-card" },
        h("div", { class: "muted small", text: "Step " + (n + 1) + " of " + steps.length }),
        h("h3", { id: "tour-title", text: s.title }), h("p", { text: s.text }),
        h("div", { class: "row" }, skip, back, next)));
      next.focus();
    }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); finish(); }
      else if (e.key === "ArrowRight" && n < steps.length - 1) { n++; show(); }
      else if (e.key === "ArrowLeft" && n > 0) { n--; show(); }
    }
    document.addEventListener("keydown", onKey, true);
    document.body.append(root);
    show();
  }

  async function myPageView() {
    const grid = h("div", { class: "mp-grid" });
    const KEY = "svc_mypage";
    const art = loadMyArt();
    const artBox = h("details", { class: "panel" });
    const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
    const save = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* per-device only */ } };
    const lay = Object.assign({ order: [], hidden: [], pinned: [] }, load());
    let me = state.me, profile = null, showHidden = false;
    try { me = Object.assign({}, state.me, await api("/api/me")); state.me = me; } catch { /* the cached copy is fine */ }
    try { profile = await api("/api/profile"); } catch { /* optional */ }
    const flag = id => { const x = (me.setup || []).find(t => t.id === id); return Boolean(x && x.done); };
    const st = () => me.settings;
    const CARDS = [
      { id: "wishlist", icon: "💸", title: "Wishlist sale alerts", text: "Watch games and hear about sales, lows and bundles.", href: "#/wishlist", status: () => [me.games > 0, me.games + " game" + (me.games === 1 ? "" : "s") + " watched"], toggle: { key: "paused", label: "Alerts on", invert: true } },
      { id: "free", icon: "🎁", title: "Free game alerts", text: "Told when a game is free on Steam, Epic, GOG and more. The free games page lists them all.", href: "#/free", status: () => [st().free, st().free ? "On" : "Off"], toggle: { key: "free", label: "Turn on" } },
      { id: "digest", icon: "📰", title: "Weekly digest", text: "One summary of your wishlist sales each week.", href: "#/alerts", status: () => [st().digest, st().digest ? "On" : "Off"], toggle: { key: "digest", label: "Turn on" } },
      { id: "bundles", icon: "📦", title: "Bundle and giveaway alerts", text: "When a wishlist game is in a bundle or given away.", href: "#/alerts", status: () => [st().bundles, st().bundles ? "On" : "Off"], toggle: { key: "bundles", label: "Turn on" } },
      { id: "share", icon: "👥", title: "Share with your server", text: "Group alerts, the savings leaderboard and the backlog league.", href: "#/alerts", status: () => [st().share, st().share ? "Opted in" : "Not shared"], toggle: { key: "share", label: "Share" } },
      { id: "library", icon: "📚", title: "Library", text: "What you own, what you paid, backlog, spend and trophies.", href: "#/library", status: () => [me.library > 0, me.library + " game" + (me.library === 1 ? "" : "s")] },
      { id: "steam", icon: "🎮", title: "Steam link", text: "Hours played, hours tracked over time and a taste profile.", href: "#/steam", status: () => [flag("steam"), flag("steam") ? "Linked" : "Not linked"] },
      { id: "challenge", icon: "🏁", title: "Backlog challenge", text: "A monthly goal of games to finish, with a streak and badges.", href: "#/library", status: () => [flag("challenge"), flag("challenge") ? "Goal set this month" : "No goal this month"] },
      { id: "friends", icon: "🎂", title: "Friends and gifts", text: "Birthdays, reminders and what is on sale for them.", href: "#/friends", status: () => [flag("friend"), flag("friend") ? "Friends added" : "None yet"] },
      { id: "public", icon: "🔗", title: "Public wishlist page", text: "A shareable page for gifts, where visitors can mark what they will buy.", href: "#/alerts", status: () => [Boolean(profile && profile.public), profile && profile.public ? "On" : "Off"] },
      { id: "redeem", icon: "🔑", title: "Batch redeem", text: "Redeem many Steam keys through the FanaticalGrabber extension.", href: "#/redeem", status: null },
      { id: "war", icon: "⚔️", title: "Sale war room", text: "Plan a sale cart with a budget slider.", href: "#/warroom", status: null },
      { id: "foryou", icon: "✨", title: "For you", text: "Discounts ranked by your taste and wishlist.", href: "#/foryou", status: null },
      { id: "deals", icon: "🏷️", title: "Deals and bundles", text: "Bundle checks and sale prep.", href: "#/deals", status: null },
      { id: "calendar", icon: "📅", title: "Calendar", text: "Release dates, Steam sales and server events.", href: "#/calendar", status: null },
      { id: "compare", icon: "🆚", title: "Compare libraries", text: "See what you and a friend both own.", href: "#/compare", status: null },
      { id: "notifications", icon: "🔔", title: "Notifications", text: "A copy of every alert, and what to mute.", href: "#/notifications", status: () => [me.unread === 0, me.unread ? me.unread + " unread" : "All read"] }
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
    const tourBtn = h("button", { class: "btn gray small", type: "button", text: "Take the tour", onclick: startTour });
    app.replaceChildren(pageHead("My page", "Everything you can do here. " + on + " of " + tot + " features are set up. Switch simple ones on right here, pin the ones you use, and hide the rest. The layout is kept on this device."), tourBtn, myBanner(art), artBox, bar, grid);
    drawArt(artBox, art);
    draw();
    app.append(profileCardPanel());
  }

  // Pictures from any https address for your own My page and profile card. Shown on your profile card. The links are saved with your account so /profilecard can draw them; nothing is uploaded and nobody else sees them unless you post your card.
  const ART_KEY = "svc_myart";
  function loadMyArt() { try { const v = JSON.parse(localStorage.getItem(ART_KEY) || "{}"); return { banner: okImage(v.banner) ? v.banner : "", avatar: okImage(v.avatar) ? v.avatar : "", auto: v.auto === true }; } catch { return { banner: "", avatar: "", auto: false }; } }
  function saveMyArt(art) {
    try { localStorage.setItem(ART_KEY, JSON.stringify(art)); } catch { /* the website still works without it */ }
    // The /profilecard command draws from the server, so it needs the same pictures. Failing quietly is fine; the card here still works.
    if (state.me) api("/api/profile/card-settings", { avatar: art.avatar || "", banner: art.banner || "" }).catch(() => {});
  }
  // Steam art for the pictures. A wide hero for the banner (with the store header as a fallback) and the Steam profile picture.
  const heroUrl = appid => `https://cdn.akamai.steamstatic.com/steam/apps/${Number(appid)}/library_hero.jpg`;
  const headerUrl = appid => `https://cdn.akamai.steamstatic.com/steam/apps/${Number(appid)}/header.jpg`;
  // From Steam: the profile picture, and a banner from the hero art of the game you play most. Steam does not share profile
  // backgrounds, so the banner is the closest thing. On a sync or link (`force`) both are replaced with the fresh ones;
  // otherwise only empty slots are filled.
  function autoFillArt(card, stats, force = false) {
    const art = loadMyArt();
    let changed = false;
    if (okImage(card?.avatar) && (force || !art.avatar) && art.avatar !== card.avatar) { art.avatar = card.avatar; changed = true; }
    const top = stats?.mostPlayed?.[0]?.appid;
    if (top && (force || !art.banner) && art.banner !== heroUrl(top)) { art.banner = heroUrl(top); changed = true; }
    art.auto = true; saveMyArt(art);
    return changed;
  }
  function okImage(u) { if (!u) return false; try { const x = new URL(u); return x.protocol === "https:" && !x.username && !x.password && u.length <= 500; } catch { return false; } }
  function myBanner(art) {
    if (!art.banner) return "";
    const img = h("img", { class: "mp-banner", src: art.banner, alt: "", referrerpolicy: "no-referrer", loading: "lazy" });
    // Not every game has a wide hero image; fall back to its store header before giving up.
    img.addEventListener("error", () => { const m = /\/steam\/apps\/(\d+)\/library_hero\.jpg$/.exec(img.src); if (m && !img.dataset.tried) { img.dataset.tried = "1"; img.src = headerUrl(m[1]); } else img.remove(); });
    return img;
  }
  function drawArt(box, art) {
    const banner = h("input", { type: "url", maxlength: "500", placeholder: "https://… (a wide image)", value: art.banner });
    const avatar = h("input", { type: "url", maxlength: "500", placeholder: "https://… (a square picture)", value: art.avatar });
    const apply = h("button", { class: "btn blue", text: "Save pictures", onclick: () => {
      for (const [v, n] of [[banner.value.trim(), "banner"], [avatar.value.trim(), "picture"]]) if (v && !okImage(v)) return toast("The " + n + " link must start with https://", "error");
      art.banner = banner.value.trim(); art.avatar = avatar.value.trim(); art.auto = true;
      saveMyArt(art);
      toast("Saved on this device.", "ok"); myPageView();
    } });
    box.replaceChildren(h("summary", { text: "Your pictures (banner and profile card picture)" }),
      h("p", { class: "muted small", text: "Use images from any https address: a banner for this page and a picture for your profile card. They are loaded by your browser from that site, which can see your address, so use hosts you trust. Only the links are saved (with your account, for /profilecard); no image is uploaded. A picture the host does not allow for downloads is skipped on the saved card." }),
      h("div", { class: "row" }, field("Banner", banner), field("Profile card picture", avatar)), apply);
  }

  // A shareable profile card drawn on a canvas. Pick what it shows and the colour, then save it as an image. Nothing is uploaded.
  function profileCardPanel() {
    const KEY = "svc_profilecard";
    let opt = { games: true, finished: true, hours: true, saved: true, streak: true, badges: true, genres: true, theme: "steam" };
    let platforms = [];
    try { Object.assign(opt, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { /* defaults */ }
    const THEMES = { steam: ["#1b2838", "#66c0f4"], night: ["#14151a", "#b388ff"], forest: ["#13241c", "#5fd38d"], sunset: ["#2a1620", "#ff9a62"] };
    const out = h("div", { class: "muted", text: "Loading…" });
    const wrap = h("div", { class: "panel" }, h("h3", { text: "Profile card" }), out);
    api("/api/profile/card").then(d => {
      // What is saved with the account wins, so the card here and /profilecard match.
      const sp = d.prefs || {};
      if (sp.show) Object.assign(opt, sp.show);
      if (sp.theme) opt.theme = sp.theme;
      platforms = (sp.platforms || []).map(p => ({ id: p.id, name: p.name }));
      const labels = Object.fromEntries((d.platforms || []).map(p => [p.id, p.label]));
      const pushCard = patch => api("/api/profile/card-settings", patch).catch(e => toast(e.message, "error"));
      { const have = loadMyArt(); if ((have.avatar || "") !== (sp.avatar || "") || (have.banner || "") !== (sp.banner || "")) { if (have.avatar || have.banner) pushCard({ avatar: have.avatar, banner: have.banner }); } }
      const canvas = h("canvas", { width: "1200", height: "630", class: "recap-card", role: "img", "aria-label": "Your profile card" });
      let pic = null, banner = null;
      const loadImg = (src, done, fallback) => { const im = new Image(); im.crossOrigin = "anonymous"; im.referrerPolicy = "no-referrer"; im.onload = () => { done(im); draw(); }; im.onerror = () => { if (fallback) loadImg(fallback, done); }; im.src = src; };
      const loadArt = () => {
        const myArt = loadMyArt();
        if (myArt.avatar) loadImg(myArt.avatar, im => { pic = im; });
        if (myArt.banner) { const m = /\/steam\/apps\/(\d+)\/library_hero\.jpg$/.exec(myArt.banner); loadImg(myArt.banner, im => { banner = im; }, m ? headerUrl(m[1]) : null); }
      };
      loadArt();
      // Linked but no pictures yet: pull them from Steam so the card is never blank.
      { const have = loadMyArt(); if (!have.avatar || !have.banner) api("/api/steam").then(sd => { if (sd.link && autoFillArt(sd.card, sd.stats)) loadArt(); }).catch(() => {}); }
      const rr = (x, px, py, w, hh, r) => { x.beginPath(); x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + hh, r); x.arcTo(px + w, py + hh, px, py + hh, r); x.arcTo(px, py + hh, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath(); };
      const cover = (x, im, px, py, w, hh) => { const k = Math.max(w / im.width, hh / im.height), dw = im.width * k, dh = im.height * k; x.drawImage(im, px + (w - dw) / 2, py + (hh - dh) / 2, dw, dh); };
      const draw = () => {
        const [bg, ac] = THEMES[opt.theme] || THEMES.steam, x = canvas.getContext("2d");
        const BH = 230;
        // Background: a soft vertical fade with an accent glow in the corner.
        const g = x.createLinearGradient(0, 0, 0, 630); g.addColorStop(0, bg); g.addColorStop(1, "#0b0d12");
        x.fillStyle = g; x.fillRect(0, 0, 1200, 630);
        const glow = x.createRadialGradient(1100, 80, 10, 1100, 80, 520); glow.addColorStop(0, ac + "33"); glow.addColorStop(1, ac + "00");
        x.fillStyle = glow; x.fillRect(0, 0, 1200, 630);
        // Banner: the picture if there is one, else a diagonal accent pattern. A dark fade keeps the name readable.
        x.save(); x.beginPath(); x.rect(0, 0, 1200, BH); x.clip();
        if (banner) cover(x, banner, 0, 0, 1200, BH);
        else { const bg2 = x.createLinearGradient(0, 0, 1200, BH); bg2.addColorStop(0, ac + "55"); bg2.addColorStop(1, ac + "11"); x.fillStyle = bg2; x.fillRect(0, 0, 1200, BH); x.strokeStyle = ac + "22"; x.lineWidth = 2; for (let n = -BH; n < 1300; n += 36) { x.beginPath(); x.moveTo(n, BH); x.lineTo(n + BH, 0); x.stroke(); } }
        const fade = x.createLinearGradient(0, 0, 0, BH); fade.addColorStop(0, "rgba(0,0,0,0.10)"); fade.addColorStop(1, "rgba(11,13,18,0.92)");
        x.fillStyle = fade; x.fillRect(0, 0, 1200, BH); x.restore();
        x.fillStyle = ac; x.fillRect(0, BH - 3, 1200, 3);
        // Avatar: a ring in the accent colour overlapping the banner.
        const ax = 140, ay = BH + 6, R = 72;
        x.beginPath(); x.arc(ax, ay, R + 8, 0, Math.PI * 2); x.fillStyle = "#0b0d12"; x.fill();
        x.beginPath(); x.arc(ax, ay, R + 4, 0, Math.PI * 2); x.fillStyle = ac; x.fill();
        x.save(); x.beginPath(); x.arc(ax, ay, R, 0, Math.PI * 2); x.clip();
        if (pic) cover(x, pic, ax - R, ay - R, R * 2, R * 2);
        else { x.fillStyle = bg; x.fillRect(ax - R, ay - R, R * 2, R * 2); x.fillStyle = ac; x.font = "700 72px system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText((d.name || "?").slice(0, 1).toUpperCase(), ax, ay + 4); x.textAlign = "left"; x.textBaseline = "alphabetic"; }
        x.restore();
        // Name and subtitle.
        x.fillStyle = "#fff"; x.font = "700 52px system-ui, sans-serif"; x.fillText((d.name || "Gamer").slice(0, 24), 250, ay + 36);
        x.fillStyle = ac; x.font = "600 22px system-ui, sans-serif"; x.fillText("GAME LIBRARY", 252, ay + 70);
        // Stat tiles in one row.
        const stats = [];
        if (opt.games) stats.push([String(d.games), "games"]);
        if (opt.finished) stats.push([String(d.finished), "finished"]);
        if (opt.hours && d.hours) stats.push([d.hours.toLocaleString() + " h", "played"]);
        if (opt.saved && d.savedPct !== null) stats.push([d.savedPct + "%", "saved vs full price"]);
        if (opt.streak && d.bestStreak) stats.push([d.streak + " / " + d.bestStreak, "streak / best"]);
        const n = stats.length, gap = 18, left = 60, tw = n ? (1080 - gap * (n - 1)) / n : 0, ty = 330, th = 136;
        stats.forEach(([v, k], i) => {
          const tx = left + i * (tw + gap);
          rr(x, tx, ty, tw, th, 18); x.fillStyle = "rgba(255,255,255,0.06)"; x.fill();
          x.strokeStyle = "rgba(255,255,255,0.10)"; x.lineWidth = 1.5; x.stroke();
          x.fillStyle = ac; rr(x, tx + 22, ty + 18, 34, 5, 2.5); x.fill();
          x.fillStyle = "#fff"; x.font = `700 ${n > 4 ? 44 : 54}px system-ui, sans-serif`; x.fillText(v, tx + 22, ty + 82, tw - 40);
          x.fillStyle = "#9fb3c4"; x.font = "21px system-ui, sans-serif"; x.fillText(k, tx + 22, ty + 114, tw - 40);
        });
        // Trophies (by name) on the left, top genres on the right, then the gaming names they added.
        const by = 484, cut = (t, m) => (t.length > m ? t.slice(0, m - 1) + "…" : t);
        if (opt.badges && d.badges.length) {
          x.font = "600 20px system-ui, sans-serif"; let bx = 60;
          for (const b of d.badges.slice(0, 4)) { const label = cut(b.name, 16), w = x.measureText(label).width + 36; if (bx + w > 700) break; rr(x, bx, by + 8, w, 40, 20); x.fillStyle = "rgba(255,255,255,0.06)"; x.fill(); x.strokeStyle = "rgba(255,255,255,0.10)"; x.stroke(); x.fillStyle = "#fff"; x.fillText(label, bx + 18, by + 35); bx += w + 10; }
        }
        if (opt.genres && d.genres.length) {
          x.font = "600 21px system-ui, sans-serif"; let gx = 1140;
          for (const gname of [...d.genres].slice(0, 3).reverse()) { const w = x.measureText(gname).width + 34; gx -= w; rr(x, gx, by + 8, w, 40, 20); x.fillStyle = ac + "26"; x.fill(); x.strokeStyle = ac + "66"; x.stroke(); x.fillStyle = ac; x.fillText(gname, gx + 17, by + 35); gx -= 12; }
        }
        { let px = 60; const py = 548;
          for (let i = 0; i < platforms.length; i++) {
            const p = platforms[i], label = labels[p.id] || p.id, name = cut(p.name, 22);
            x.font = "18px system-ui, sans-serif"; const lw = x.measureText(label).width; x.font = "700 18px system-ui, sans-serif"; const w = lw + x.measureText(name).width + 40, more = platforms.length - i - 1;
            if (px + w > 1140 - (more > 0 ? 90 : 0)) { const t = "+" + (platforms.length - i) + " more"; x.font = "600 18px system-ui, sans-serif"; const w2 = x.measureText(t).width + 28; rr(x, px, py, w2, 36, 18); x.fillStyle = "rgba(255,255,255,0.04)"; x.fill(); x.strokeStyle = "rgba(255,255,255,0.10)"; x.stroke(); x.fillStyle = "#9fb3c4"; x.fillText(t, px + 14, py + 25); break; }
            rr(x, px, py, w, 36, 18); x.fillStyle = "rgba(255,255,255,0.06)"; x.fill(); x.strokeStyle = "rgba(255,255,255,0.10)"; x.stroke();
            x.font = "18px system-ui, sans-serif"; x.fillStyle = "#9fb3c4"; x.fillText(label, px + 18, py + 25); x.font = "700 18px system-ui, sans-serif"; x.fillStyle = "#fff"; x.fillText(name, px + 18 + lw + 8, py + 25);
            px += w + 10;
          } }
        x.fillStyle = "#5c7080"; x.font = "16px system-ui, sans-serif"; x.fillText("Steam Value Checker", 60, 616);
      };
      const box = (key, label) => { const c = h("input", { type: "checkbox", checked: opt[key] }); c.addEventListener("change", () => { opt[key] = c.checked; keep(); draw(); }); return h("label", { class: "check" }, c, label); };
      let timer = null;
      const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(opt)); } catch { /* per-device */ } clearTimeout(timer); timer = setTimeout(() => pushCard({ theme: opt.theme, show: { games: opt.games, finished: opt.finished, hours: opt.hours, saved: opt.saved, streak: opt.streak, badges: opt.badges, genres: opt.genres } }), 600); };
      const theme = select(Object.keys(THEMES).map(k => [k, k[0].toUpperCase() + k.slice(1)]), opt.theme);
      theme.addEventListener("change", () => { opt.theme = theme.value; keep(); draw(); });
      const save = h("button", { class: "btn blue", text: "Save as image", onclick: () => canvas.toBlob(b => { if (!b) return; const a = h("a", { href: URL.createObjectURL(b), download: "my-game-profile.png" }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }) });
      // Gaming names: pick a platform, type your name there, add. They show as small tags on the card.
      const plat = select((d.platforms || []).map(p => [p.id, p.label]), "steam");
      const pname = h("input", { type: "text", maxlength: "40", placeholder: "Your name or ID there" });
      const tags = h("div", { class: "chips" });
      const paintTags = () => tags.replaceChildren(...platforms.map(p => h("span", { class: "chip dim plat-chip" }, (labels[p.id] || p.id) + ": " + p.name + " ",
        h("button", { class: "chip-x", type: "button", title: "Remove", "aria-label": "Remove " + (labels[p.id] || p.id), text: "✕", onclick: () => { platforms = platforms.filter(q => q.id !== p.id); paintTags(); draw(); pushCard({ platforms }); } }))));
      const addPlat = () => {
        const name = pname.value.trim(); if (!name) return toast("Type your name or ID for " + (labels[plat.value] || "that platform") + " first.", "error");
        platforms = [...platforms.filter(q => q.id !== plat.value), { id: plat.value, name }]; pname.value = ""; paintTags(); draw();
        pushCard({ platforms }).then(r => { if (r) toast("Added to your card.", "ok"); });
      };
      pname.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addPlat(); } });
      paintTags();
      out.className = "";
      out.replaceChildren(h("p", { class: "muted small", text: "Drawn from your library, hours, challenge and badges. Choose what to show, add your gaming names, then save the image, or post it in Discord with /profilecard. Your choices are saved with your account." }),
        h("div", { class: "row" }, box("games", "Games"), box("finished", "Finished"), box("hours", "Hours"), box("saved", "Percent saved"), box("streak", "Streak"), box("badges", "Badges"), box("genres", "Top genres")),
        field("Colour", theme),
        h("h4", { text: "Your gaming names" }),
        h("div", { class: "row plat-row" }, field("Platform", plat), field("Name or ID", pname), h("button", { class: "btn gray shrink", type: "button", text: "Add", onclick: addPlat })),
        tags, canvas, save);
      draw();
    }).catch(e => out.replaceChildren(h("div", { class: "notice warn", text: e.message })));
    return wrap;
  }

  async function friendsView() {
    const list = h("div", { class: "muted", text: "Loading…" });
    const name = h("input", { type: "text", maxlength: "30", placeholder: "Nickname" });
    const bday = h("input", { type: "text", maxlength: "5", placeholder: "MM-DD (optional)" });
    const page = h("input", { type: "text", maxlength: "24", placeholder: "Their public page name (optional)" });
    const deals = h("div");
    async function load() {
      const { friends } = await api("/api/friends");
      if (!friends.length) return list.replaceChildren(h("div", { class: "empty", text: "No friends yet. Add a nickname, a birthday and their public wishlist page name; you get a reminder a week before with what is on sale for them." }));
      list.replaceChildren(...friends.map(f => {
        const show = h("button", { class: "btn blue small", text: "On sale for them", disabled: !f.slug });
        show.addEventListener("click", () => busy(show, async () => {
          const r = await api("/api/friends/deals?name=" + encodeURIComponent(f.name));
          deals.replaceChildren(h("h3", { text: "On sale for " + r.name }), r.deals.length ? h("div", {}, ...r.deals.map(d => h("div", { class: "row-line" }, h("a", { href: d.url || "#", target: "_blank", rel: "noopener", text: d.title }), h("span", { class: "muted", text: " " + money(d.price, d.currency || "USD") + (d.discount > 0 ? " (-" + d.discount + "%)" : "") + " at " + d.shop })))) : h("div", { class: "muted", text: "Nothing on their wishlist is on sale right now." }));
        }));
        const del = h("button", { class: "btn red small", text: "Remove" });
        del.addEventListener("click", () => busy(del, async () => { await api("/api/friends/remove", { name: f.name }); toast("Removed.", "ok"); load(); }));
        return h("div", { class: "panel" }, h("strong", { text: f.name }), h("span", { class: "muted", text: f.birthday ? "  🎂 " + f.birthday + (f.daysToBirthday <= 30 ? " (in " + f.daysToBirthday + " days)" : "") : "" }), h("div", { class: "mp-actions fr-actions" }, show, del));
      }));
    }
    const add = h("button", { class: "btn blue", text: "Save friend" });
    add.addEventListener("click", () => busy(add, async () => { await api("/api/friends/add", { name: name.value, birthday: bday.value, page: page.value }); toast("Saved.", "ok"); name.value = bday.value = page.value = ""; load(); }));
    app.replaceChildren(pageHead("Friends", "Birthdays and gift ideas. Only a nickname and the month and day are kept."),
      h("div", { class: "panel" }, h("div", { class: "row" }, field("Nickname", name), field("Birthday", bday), field("Public page", page)), h("div", { class: "mp-actions fr-actions" }, add)), list, deals);
    load().catch(e => list.replaceChildren(h("div", { class: "empty", text: e.message })));
  }

  async function calendarView() {
    const KIND = { release: ["🎮", "Releases"], sale: ["🏷️", "Steam sales"], event: ["📅", "Server events"], lfg: ["👥", "Group games"] };
    const st = { kinds: new Set(Object.keys(KIND)), guild: "", mode: "list", month: new Date() };
    st.month.setDate(1); st.month.setHours(0, 0, 0, 0);
    let data = null;
    const out = h("div", { class: "muted", text: "Loading…" });
    const toolbar = h("div", { class: "cal-toolbar" });
    const sync = h("div");
    const admin = h("div");
    const dayKey = ms => { const d = new Date(ms); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
    const timeText = e => e.allDay ? (e.end && dayKey(e.end) !== dayKey(e.start) ? new Date(e.start).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " to " + new Date(e.end).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "All day") : new Date(e.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const visible = () => data.entries.filter(e => st.kinds.has(e.kind) && (!st.guild || !e.guild_id || e.guild_id === st.guild));
    // A multi-day entry shows on every day it covers.
    const spans = e => { const days = []; const last = e.end && e.allDay ? e.end : e.start; for (let t = e.start, n = 0; t <= last && n < 40; t += 86400_000, n++) days.push(dayKey(t)); return days.length ? days : [dayKey(e.start)]; };

    function removeBtn(e) {
      if (!e.canRemove) return null;
      const b = h("button", { class: "btn red small", text: "Remove" });
      b.addEventListener("click", () => busy(b, async () => { await api("/api/calendar/events/delete", { guild_id: e.guild_id, id: e.id }); toast("Removed.", "ok"); load(); }));
      return b;
    }
    function drawList() {
      const list = visible().filter(e => (e.allDay ? (e.end || e.start) : e.start) >= data.now - 3600_000);
      if (!list.length) return out.replaceChildren(h("div", { class: "empty", text: "Nothing coming up. Wishlisted games with a release date, Steam sales and server events appear here." }));
      const groups = new Map();
      for (const e of list) { const k = dayKey(e.start); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
      out.replaceChildren(...[...groups].map(([k, rows]) => h("div", { class: "panel" },
        h("h3", { text: new Date(rows[0].start).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) }),
        ...rows.map(e => h("div", { class: "cal-row" },
          h("span", { class: "cal-ico", text: KIND[e.kind][0] }),
          h("div", {}, h("div", { class: "cal-title", text: e.title }), h("div", { class: "muted small", text: [timeText(e), e.server, e.notes].filter(Boolean).join(" · ") })),
          removeBtn(e) || "")))));
    }
    function drawMonth() {
      const first = new Date(st.month), startDow = first.getDay();
      const gridStart = new Date(first); gridStart.setDate(1 - startDow);
      const byDay = new Map();
      for (const e of visible()) for (const k of spans(e)) { if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); }
      const cells = [];
      for (let i = 0; i < 42; i++) {
        const d = new Date(gridStart); d.setDate(gridStart.getDate() + i);
        const items = byDay.get(dayKey(d)) || [];
        const today = dayKey(d) === dayKey(Date.now());
        cells.push(h("div", { class: "cal-cell" + (d.getMonth() !== first.getMonth() ? " other" : "") + (today ? " today" : "") },
          h("div", { class: "cal-day", text: String(d.getDate()) }),
          ...items.slice(0, 3).map(e => h("div", { class: "cal-chip " + e.kind, title: e.title + " · " + timeText(e), text: KIND[e.kind][0] + " " + e.title })),
          items.length > 3 ? h("div", { class: "muted small", text: "+" + (items.length - 3) + " more" }) : ""));
      }
      const prev = h("button", { class: "btn gray small", text: "‹", "aria-label": "Previous month" }), next = h("button", { class: "btn gray small", text: "›", "aria-label": "Next month" });
      prev.addEventListener("click", () => { st.month.setMonth(st.month.getMonth() - 1); drawMonth(); });
      next.addEventListener("click", () => { st.month.setMonth(st.month.getMonth() + 1); drawMonth(); });
      out.replaceChildren(h("div", { class: "panel" },
        h("div", { class: "cal-nav" }, prev, h("h3", { text: first.toLocaleDateString(undefined, { month: "long", year: "numeric" }) }), next),
        h("div", { class: "cal-grid" }, ...["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(n => h("div", { class: "cal-head", text: n })), ...cells)));
    }
    const draw = () => (st.mode === "month" ? drawMonth() : drawList());

    function drawToolbar() {
      const chips = Object.entries(KIND).map(([k, [ico, label]]) => { const b = h("button", { type: "button", class: "tab small" + (st.kinds.has(k) ? " active" : ""), text: ico + " " + label, "aria-pressed": String(st.kinds.has(k)) });
        b.addEventListener("click", () => { st.kinds.has(k) ? st.kinds.delete(k) : st.kinds.add(k); drawToolbar(); draw(); }); return b; });
      const mode = h("button", { type: "button", class: "tab small", text: st.mode === "list" ? "Month view" : "List view" });
      mode.addEventListener("click", () => { st.mode = st.mode === "list" ? "month" : "list"; drawToolbar(); draw(); });
      const parts = [h("div", { class: "chips" }, ...chips, mode)];
      if (data.servers.length > 1) { const sel = select([["", "All my servers"], ...data.servers.map(g => [g.id, g.name])], st.guild); sel.addEventListener("change", () => { st.guild = sel.value; draw(); }); parts.push(field("Show", sel)); }
      toolbar.replaceChildren(...parts);
    }

    function drawAdmin() {
      const mgr = data.servers.filter(g => g.manageable);
      if (!mgr.length) { admin.replaceChildren(); return; }
      const guild = select(mgr.map(g => [g.id, g.name]), mgr[0].id);
      const title = h("input", { type: "text", maxlength: "80", placeholder: "e.g. Co-op night: Helldivers 2" });
      const when = h("input", { type: "datetime-local" });
      const notes = h("textarea", { maxlength: "400", rows: "2", placeholder: "Details (optional)", class: "short" });
      const chan = h("select", {}, h("option", { value: "", text: "Do not announce in a channel" }));
      const remind = select([["60", "Remind 1 hour before"], ["15", "Remind 15 minutes before"], ["1440", "Remind 1 day before"], ["0", "No reminder"]], "60");
      const loadChans = () => api("/api/servers/channels?guild=" + encodeURIComponent(guild.value)).then(c => chan.replaceChildren(h("option", { value: "", text: "Do not announce in a channel" }), ...c.channels.map(x => h("option", { value: x.id, text: "Announce in #" + x.name })))).catch(() => {});
      guild.addEventListener("change", loadChans); loadChans();
      const add = h("button", { class: "btn green", text: "Add event" });
      add.addEventListener("click", () => busy(add, async () => {
        const at = when.value ? new Date(when.value).getTime() : NaN;
        const r = await api("/api/calendar/events", { guild_id: guild.value, title: title.value, notes: notes.value, starts_at: at, channel_id: chan.value || undefined, remind_min: Number(remind.value) });
        toast(r.announced ? "Event added and announced." : "Event added.", "ok"); title.value = ""; notes.value = ""; load();
      }));
      admin.replaceChildren(h("h2", { text: "Add a server event" }), h("div", { class: "panel" },
        h("p", { class: "muted small", text: "Members see it here and with /calendar view. If you pick a channel it is announced there now and members get a reminder before it starts." }),
        mgr.length > 1 ? field("Server", guild) : "", h("div", { class: "row" }, field("Title", title), field("Date and time (your browser's time zone)", when)), field("Notes", notes), h("div", { class: "row" }, field("Announce", chan), field("Reminder", remind)), h("p", {}, add)));
    }

    function drawSync() {
      const result = h("div");
      const make = h("button", { class: "btn gray", text: data.feed ? "Make a new link" : "Make a calendar link" });
      make.addEventListener("click", () => busy(make, async () => {
        const r = await api("/api/calendar/feed", { action: "new" });
        const box = h("input", { type: "text", readonly: "readonly", value: r.url, "aria-label": "Calendar link" });
        box.addEventListener("focus", () => box.select());
        result.replaceChildren(h("p", { class: "muted small", text: "Copy this now. It is shown once. Anyone with it can read your calendar, so keep it private." }), box);
        make.textContent = "Make a new link";
      }));
      const off = data.feed ? h("button", { class: "btn red", text: "Turn the link off" }) : null;
      if (off) off.addEventListener("click", () => busy(off, async () => { await api("/api/calendar/feed", { action: "off" }); toast("Link turned off.", "ok"); load(); }));
      sync.replaceChildren(h("h2", { text: "Use another calendar app (optional)" }), h("div", { class: "panel" },
        h("p", { class: "muted small", text: "This calendar works on its own. If you also want these dates in Google, Apple or Outlook calendar, make a private link and add it there as a subscription from a URL. It updates by itself." }),
        data.feed ? h("p", { class: "muted small", text: `A link is active${data.feed.used_at ? ", last used " + new Date(data.feed.used_at).toLocaleDateString() : ", not used yet"}.` }) : "",
        h("p", {}, make, " ", off || ""), result));
    }

    async function load() {
      try {
        data = await api("/api/calendar?days=365");
        drawToolbar(); draw(); drawAdmin(); drawSync();
      } catch (e) { out.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    app.replaceChildren(pageHead("Calendar", "Game releases from your wishlist, Steam sales, and your servers' events, all in one place."), toolbar, out, admin, sync);
    load();
  }

  // ---------- looking for group ----------
  async function lfgView() {
    const servers = state.me.servers.filter(g => g.bot !== false);
    const out = h("div", { class: "muted", text: "Loading…" });
    const form = h("div");
    const guild = serverPicker(servers);
    app.replaceChildren(pageHead("Looking for group", "Find people to play with. Members join with a button, and the group gets a reminder when it starts."),
      h("div", { class: "panel" }, servers.length > 1 ? field("Server", guild) : null, form, out));
    async function load() {
      out.className = "muted"; out.replaceChildren("Loading…");
      try {
        const g = servers.find(x => x.id === guild.value);
        const d = await api("/api/lfg?guild=" + encodeURIComponent(guild.value));
        if (d.manageable) {
          const game = h("input", { type: "text", maxlength: "80", placeholder: "Game" });
          const when = h("input", { type: "datetime-local" });
          const slots = h("input", { type: "number", min: "2", max: "20", value: "4" });
          const note = h("input", { type: "text", maxlength: "200", placeholder: "Optional" });
          const chan = select([["", "Loading channels…"]], "");
          const evt = h("input", { type: "checkbox" });
          api("/api/servers/channels?guild=" + encodeURIComponent(guild.value)).then(c => { chan.replaceChildren(...c.channels.map(x => h("option", { value: x.id, text: "#" + x.name }))); }).catch(() => {});
          const post = h("button", { class: "btn blue", text: "Post", onclick: () => busy(post, async () => {
            if (!when.value) throw new Error("Pick a date and time.");
            const r = await api("/api/lfg", { guild_id: guild.value, channel_id: chan.value, game: game.value, starts_at: new Date(when.value).getTime(), slots: Number(slots.value), note: note.value, event: evt.checked });
            toast("Posted." + (r.eventError ? " " + r.eventError : ""), r.eventError ? "warn" : "ok"); load();
          }) });
          form.replaceChildren(h("div", { class: "grid two" }, field("Game", game), field("When (your local time)", when), field("Players, counting you", slots), field("Channel", chan)), field("Note", note),
            h("label", { class: "check" }, evt, " Also create a Discord event (the bot needs Manage Events)"), h("p"), post);
        } else form.replaceChildren(h("p", { class: "muted small", text: "Server managers can post from here. Everyone can post with /lfg post in Discord, and join from here or from the post." }));
        out.className = "";
        if (!d.posts.length) { out.replaceChildren(h("div", { class: "empty", text: "No open posts. Start one with /lfg post." + (g ? "" : "") })); return; }
        out.replaceChildren(...d.posts.map(p => {
          const act = async (path, msg) => { try { await api(path, { guild_id: guild.value, id: p.id }); toast(msg, "ok"); load(); } catch (e) { toast(e.message, "error"); } };
          const join = h("button", { class: "btn green small", text: p.joined ? "Leave" : "Join", onclick: () => act(p.joined ? "/api/lfg/leave" : "/api/lfg/join", p.joined ? "You left." : "You are in.") });
          const close = p.canClose ? h("button", { class: "btn red small", text: "Close", onclick: () => act("/api/lfg/close", "Closed.") }) : null;
          return h("div", { class: "panel" }, h("h3", { text: p.game }), h("p", { class: "muted", text: new Date(p.starts_at).toLocaleString() + " · hosted by " + p.host + " · " + p.members.length + "/" + p.slots }),
            p.note ? h("p", { text: p.note }) : null, h("p", { class: "muted small", text: "Players: " + p.members.join(", ") }), h("div", { class: "row" }, join, close, p.url ? ext(p.url, "Open in Discord") : null));
        }));
      } catch (e) { out.className = ""; out.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    guild.addEventListener("change", load);
    load();
  }

  // ---------- guided server setup (same checklist as /setup in Discord) ----------
  async function setupView() {
    const servers = state.me.servers.filter(g => g.manageable);
    const holder = h("div");
    app.replaceChildren(pageHead("Server setup", "A few choices and your server is ready. The same steps are in Discord with /setup."), holder);
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
          row(st.steps.find(x => x.id === "digest"), "Friday round-up", "Every Friday the alert channel gets cheap games that opted-in members watch (never who), the free games on now and the week's server events.",
            st.alertChannel ? (() => { const b = h("button", { class: "btn small " + (st.weeklyDigest ? "red" : "green"), text: st.weeklyDigest ? "Turn off" : "Turn on" }); b.addEventListener("click", () => busy(b, async () => { await api("/api/servers/digest", { guild_id: guild.value, enabled: !st.weeklyDigest }); load(); })); return b; })() : h("span", { class: "muted small", text: "Choose an alert channel first." })),
          row(st.steps.find(x => x.id === "gamenight"), "Game night nudges", "When 2 or more opted-in members in a voice channel all have the same game hit their alert, the bot posts once in that channel's text chat. Members join with /alerts share.",
            (() => { const b = h("button", { class: "btn small " + (st.gameNight ? "red" : "green"), text: st.gameNight ? "Turn off" : "Turn on" }); b.addEventListener("click", () => busy(b, async () => { await api("/api/servers/gamenight", { guild_id: guild.value, enabled: !st.gameNight }); load(); })); return b; })()),
          row(sSupport, "Support tickets", "Members use /support open. Tickets appear here with Reply, Assign and Resolve buttons, and in the Support page.",
            h("div", { class: "row" }, supportSel, staffSel, save("Save", () => api("/api/tickets/setup", { guild_id: guild.value, channel_id: supportSel.value, staff_role_id: staffSel.value })))),
          state.me.giveaways ? row(sVouch, "Giveaway vouches", "Winners' confirmations are posted here. Without one the bot looks for a channel named #vouches.",
            h("div", { class: "row" }, vouchSel, save("Save", () => api("/api/giveaways/setup", { guild_id: guild.value, vouch_channel_id: vouchSel.value })))) : null),
          h("div", { class: "panel" }, h("h3", { text: "What members can do now" }), h("ul", {},
            h("li", {}, "Import a wishlist for sale alerts: ", h("code", { text: "/wishlist import" }), ", then star favorites with ", h("code", { text: "/wishlist priority" })),
            h("li", {}, "Price a library: ", h("code", { text: "/value" }), " or link Steam for hours, ", h("code", { text: "/steam recap" }), " and ", h("code", { text: "/library challenge" })),
            h("li", {}, "Share a wishlist for gifts: ", h("code", { text: "/publicpage" })), h("li", {}, "Keep friends' birthdays and gift deals: ", h("code", { text: "/friend add" })), h("li", {}, "Earn badges and join the monthly league: ", h("code", { text: "/library badges" }), " and ", h("code", { text: "/leaderboard board:finished" })), h("li", {}, "Track bundles and hour goals: ", h("code", { text: "/library bundle" }), " and ", h("code", { text: "/steam goal" })), h("li", {}, "See events and release dates: ", h("code", { text: "/calendar view" })),
            h("li", {}, "Ask for help: ", h("code", { text: "/support open" })), h("li", {}, "Managers can run giveaways: ", h("code", { text: "/giveaway create" }))))].filter(Boolean));
      } catch (e) { holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    guild.addEventListener("change", load);
    load();
  }

  // ---------- community: welcome, levels, invites, emoji, and the one-click server build ----------
  async function communityView() {
    const servers = state.me.servers.filter(g => g.bot !== false);
    const holder = h("div");
    app.replaceChildren(pageHead("Community", "Welcome messages, levels, invites and emoji for your gaming server. In Discord: /community, /rank, /levels, /invites and /emoji."), holder);
    if (!servers.length) { holder.replaceChildren(h("div", { class: "notice warn", text: "The bot is not in any of your servers yet. Add it from the Servers page." })); return; }
    const guild = serverPicker(servers, currentParam());
    const GID = () => guild.value;
    const post = (path, body) => api(path, { guild_id: GID(), ...body });
    async function load() {
      holder.replaceChildren(h("p", { class: "muted", text: "Loading…" }));
      try {
        const d = await api("/api/community?guild=" + encodeURIComponent(GID()));
        const picker = servers.length > 1 ? h("div", { class: "panel" }, field("Server", guild)) : null;
        const intent = d.membersIntent ? null : h("div", { class: "notice warn", text: "Welcome messages and invite tracking are paused: turn on Server Members Intent for the bot in the Discord Developer Portal (Bot, Privileged Gateway Intents)." });
        const nameOr = r => r.name || "Member";
        const me = d.me;
        const inv = me.invites;
        const linkBtn = h("button", { class: "btn blue", text: inv.link ? "Copy my invite link" : "Get my invite link" });
        linkBtn.addEventListener("click", () => busy(linkBtn, async () => {
          const r = inv.link ? { link: inv.link } : await post("/api/community/invite-link", {});
          try { await navigator.clipboard.writeText(r.link); toast("Link copied: " + r.link, "ok"); } catch { toast(r.link, "ok"); }
          inv.link = r.link; linkBtn.textContent = "Copy my invite link";
        }));
        const standing = h("div", { class: "panel" }, h("h3", { text: "Your standing" }),
          h("div", { class: "grid four" },
            h("div", { class: "tile" }, h("div", { class: "k", text: "Level" }), h("div", { class: "v", text: String(me.level) }), h("div", { class: "s", text: me.rank ? `#${me.rank} of ${me.members}` : "not ranked yet" })),
            h("div", { class: "tile" }, h("div", { class: "k", text: "XP" }), h("div", { class: "v", text: me.xp.toLocaleString() }), h("div", { class: "s", text: `${me.messages.toLocaleString()} messages` })),
            h("div", { class: "tile" }, h("div", { class: "k", text: "Invited" }), h("div", { class: "v", text: String(inv.active) }), h("div", { class: "s", text: `${inv.total} joined, ${inv.left} left` })),
            h("div", { class: "tile" }, h("div", { class: "k", text: "Voice" }), h("div", { class: "v", text: me.voiceMinutes + " min" }), h("div", { class: "s", text: "time in voice with others" }))),
          h("p", { class: "muted small", text: `${me.into.toLocaleString()} of ${me.need.toLocaleString()} XP to level ${me.level + 1}` }), progressBar(me.into / me.need),
          h("div", { class: "row" }, linkBtn), h("p", { class: "muted small", text: "Everyone who joins with your link counts for you. Chat and talk in voice to earn XP." }));
        const board = (title, rows, line) => h("div", { class: "panel" }, h("h3", { text: title }),
          rows.length ? h("ol", { class: "plain" }, rows.map((r, n) => h("li", {}, h("b", { text: `${n + 1}. ${nameOr(r)}` }), " ", h("span", { class: "muted", text: line(r) })))) : h("p", { class: "muted", text: "Nobody yet." }));
        const rewards = d.rewards.length ? h("p", { class: "muted small", text: "Invite rewards: " + d.rewards.map(r => `${r.count} invited`).join(", ") }) : null;
        const vBtn = h("button", { class: "btn steam", text: "Verify me with Steam" });
        vBtn.addEventListener("click", () => busy(vBtn, async () => { try { await post("/api/community/verify", {}); toast("You are verified ✅", "ok"); load(); } catch (e) { toast(e.message, "warn"); if (!d.verify.steamVerified) location.href = "/auth/linked"; } }));
        const verifyPanel = d.verify.available ? h("div", { class: "panel" }, h("h3", { text: "Steam Verified" }),
          h("p", { class: "muted", text: d.verify.steamVerified ? "Your Steam account is verified. Press the button to get the role in this server." : "Prove your Steam account to get the Steam Verified role. You sign in on Steam's own page." }),
          h("div", { class: "row" }, vBtn, h("a", { class: "btn gray", href: "/auth/linked", text: "Connect Linked Roles" }))) : null;
        const boards = h("div", { class: "grid two" }, board("Top inviters", d.inviteTop, r => `${r.active} here · ${r.total} joined`), h("div", { class: "panel" }, h("h3", { text: "Levels and XP" }), h("p", { class: "muted", text: `You are level ${me.level}${me.rank ? `, #${me.rank} in the server` : ""}.` }), h("a", { class: "btn blue", href: "#/xp/" + GID(), text: "Open the Server XP page" })));
        holder.replaceChildren(...[picker, intent, standing, verifyPanel, boards, rewards, d.manager ? manager(d) : null].filter(Boolean));
      } catch (e) { holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    function manager(d) {
      const st = d.settings;
      const box = h("div");
      (async () => {
        const [ch, ro] = await Promise.all([api("/api/servers/channels?guild=" + encodeURIComponent(GID())).catch(() => ({ channels: [] })), api("/api/servers/roles?guild=" + encodeURIComponent(GID())).catch(() => ({ roles: [] }))]);
        const chSel = cur => select([["", "Not set"], ...ch.channels.map(c => [c.id, "#" + c.name])], cur || "");
        const roSel = (cur, none = "No role") => select([["", none], ...ro.roles.map(r => [r.id, r.name])], cur || "");
        const roleName = id => (ro.roles.find(r => r.id === id) || {}).name || "a role";
        const save = (label, fn, cls = "btn blue small") => { const b = h("button", { class: cls, text: label }); b.addEventListener("click", () => busy(b, async () => { await fn(); toast("Saved.", "ok"); load(); })); return b; };
        const toggle = (on, path, key, labelOn, labelOff) => { const b = h("button", { class: "btn small " + (on ? "red" : "green"), text: on ? labelOn : labelOff }); b.addEventListener("click", () => busy(b, async () => { await post(path, { [key]: !on }); load(); })); return b; };
        // build
        const build = h("div", { class: "panel" }, h("h3", { text: "Build my server" }),
          h("p", { class: "muted", text: "Creates the usual gaming-server layout: Information (welcome, rules, announcements, roles), Community (general, introductions, memes, clips, off-topic, bot-commands), Gaming (looking-for-group, game-chat, game-night, wishlists), Deals and Giveaways, Voice lobbies and a private Staff area. Also creates Moderator, Member and level roles and a role picker, posts the rules and welcome, and connects deal alerts, giveaways, support tickets, welcome and XP. Anything that already exists is reused, so it is safe to run again. A brand-new server is built automatically when the bot joins." }),
          (() => { const b = h("button", { class: "btn green", text: d.built ? "Run setup again" : "Set up this server" }); b.addEventListener("click", () => busy(b, async () => { const r = await post("/api/community/setup", {}); toast(`Done: ${r.created.channels.length} channels, ${r.created.roles.length} roles created.`, "ok"); load(); })); return b; })());
        // welcome
        const wCh = chSel(st.welcome_channel), logCh = chSel(st.log_channel), wMsg = h("textarea", { rows: "3", maxlength: "1000", placeholder: st.defaultWelcome }); wMsg.value = st.welcome_msg || "";
        const auto = roSel(st.autorole_id, "No automatic role");
        const welcome = h("div", { class: "panel" }, h("h3", { text: "Welcome new members" }),
          h("div", { class: "row" }, toggle(st.welcome_on, "/api/community/welcome", "enabled", "Turn off", "Turn on"), toggle(st.welcome_dm, "/api/community/welcome", "dm", "Stop private welcome", "Also send a private welcome"), toggle(st.leave_on, "/api/community/welcome", "leave", "Stop leave notes", "Post a note when someone leaves")),
          field("Welcome channel", wCh), field("Log channel (joins, who invited them)", logCh), field("Message", wMsg),
          h("p", { class: "muted small", text: "Use " + st.fields.join(" ") + ". Leave empty for the default message." }),
          h("div", { class: "row" }, save("Save welcome", () => post("/api/community/welcome", { channel_id: wCh.value, log_channel_id: logCh.value, message: wMsg.value }))),
          field("Role every new member gets", auto), h("div", { class: "row" }, save("Save role", () => post("/api/community/autorole", { role_id: auto.value }))));
        const vRole = roSel(st.verified_role_id, "No Steam Verified role");
        const verify = h("div", { class: "panel" }, h("h3", { text: "Steam verification" }),
          h("p", { class: "muted", text: "Members prove their Steam account (they sign in on Steam's own page) and get this role from the button in #verify or /steam verify. Members who already verified get it the moment they join." }),
          field("Steam Verified role", vRole), h("div", { class: "row" }, save("Save", () => post("/api/community/verifyrole", { role_id: vRole.value }))),
          h("p", { class: "muted small", text: "Want Discord itself to require it? In Discord open Server Settings, Roles, pick the role, open Links, and add this bot's Steam Verified condition. That one step can only be done in Discord." }));
        // referral
        const bonus = h("input", { type: "number", min: "0", max: "1000", value: String(st.referral_xp) }), rCount = h("input", { type: "number", min: "1", max: "1000", placeholder: "Invited members" }), rRole = roSel("", "Choose a role");
        const referral = h("div", { class: "panel" }, h("h3", { text: "Invites and referrals" }),
          h("p", { class: "muted", text: "Members get their own invite link (/invites link or the button above). Every member who joins with it counts for them, earns the inviter bonus XP, and can unlock a role." }),
          field("Bonus XP for each new member they bring (0 for none)", bonus), h("div", { class: "row" }, save("Save bonus", () => post("/api/community/referral", { bonus: bonus.value }))),
          d.rewards.length ? h("ul", { class: "plain" }, d.rewards.map(r => h("li", {}, `${r.count} invited: `, h("b", { text: roleName(r.role_id) }), " ", save("Remove", () => post("/api/community/referral", { count: r.count, remove: true }), "btn gray small")))) : h("p", { class: "muted", text: "No role rewards yet." }),
          h("div", { class: "row" }, rCount, rRole, save("Add reward", () => post("/api/community/referral", { count: rCount.value, role_id: rRole.value }))));
        // emoji
        const eText = h("textarea", { rows: "3", placeholder: "Paste custom emoji or Discord emoji links, up to 20. Example: <:pog:123456789012345678>" }), eOut = h("div"), eList = h("div", { class: "emoji-grid" });
        const loadEmoji = async () => { try { const r = await api("/api/community/emoji?guild=" + encodeURIComponent(GID())); eList.replaceChildren(...r.emojis.slice(0, 60).map(e => h("img", { src: e.url, alt: e.name, title: ":" + e.name + ":", width: "32", height: "32", loading: "lazy" }))); if (!r.emojis.length) eList.replaceChildren(h("span", { class: "muted", text: "No custom emoji yet." })); } catch { eList.replaceChildren(h("span", { class: "muted", text: "Could not read the emoji list." })); } };
        const upName = h("input", { type: "text", maxlength: "32", placeholder: "Name for the emoji (letters, numbers, _)", "aria-label": "Emoji name" });
        const upFile = h("input", { type: "file", accept: "image/png,image/gif,image/jpeg,image/webp", "aria-label": "Emoji image" });
        upFile.addEventListener("change", () => { const f = upFile.files[0]; if (f && !upName.value) upName.value = f.name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 32); });
        const upBtn = h("button", { class: "btn blue", text: "Upload as emoji" });
        upBtn.addEventListener("click", () => busy(upBtn, async () => {
          const f = upFile.files[0];
          if (!f) { toast("Choose an image first.", "warn"); return; }
          if (f.size > 256 * 1024) { toast("That image is over 256 KB. Make it smaller (128x128 is plenty).", "warn"); return; }
          const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error("Could not read that file.")); r.readAsDataURL(f); });
          const r = await post("/api/community/emoji", { image_data: data, name: upName.value });
          toast("Added :" + r.added[0] + ":", "ok"); upFile.value = ""; upName.value = ""; loadEmoji();
        }));
        const emoji = h("div", { class: "panel" }, h("h3", { text: "Emoji import" }),
          h("p", { class: "muted", text: "Copy emoji from other servers. Copy them from a message (they look like <:name:id>) and paste them here. Needs the Manage Expressions permission for the bot." }), eText,
          h("div", { class: "row" }, (() => { const b = h("button", { class: "btn blue", text: "Add the emoji" }); b.addEventListener("click", () => busy(b, async () => {
            const r = await post("/api/community/emoji", { text: eText.value });
            eOut.replaceChildren(h("p", {}, r.added.length ? `Added ${r.added.length}: ${r.added.map(n => ":" + n + ":").join(" ")}` : "Nothing was added."), ...r.failed.map(f => h("p", { class: "muted small", text: `${f.name}: ${f.why}` })));
            if (r.added.length) { eText.value = ""; loadEmoji(); }
          })); return b; })()), eOut,
          h("h4", { text: "Or add one image" }), h("p", { class: "muted small", text: "PNG, GIF, JPG or WebP under 256 KB. Square images work best." }), h("div", { class: "row" }, upFile, upName, upBtn),
          h("h4", { text: "This server's emoji" }), eList);
        loadEmoji();
        box.replaceChildren(build, welcome, verify, referral, emoji);
      })();
      return box;
    }
    guild.addEventListener("change", load);
    load();
  }

  // ---------- server XP: leaderboard, your card, level rewards, how XP works, and the prize shop teaser ----------
  async function xpView() {
    const servers = state.me.servers.filter(g => g.bot !== false);
    const holder = h("div");
    app.replaceChildren(pageHead("Server XP", "Levels, the leaderboard and rewards for your server. In Discord: /rank and /levels."), holder);
    if (!servers.length) { holder.replaceChildren(h("div", { class: "notice warn", text: "The bot is not in any of your servers yet. Add it from the Servers page." })); return; }
    const guild = serverPicker(servers, currentParam());
    let page = 1;
    async function load() {
      holder.replaceChildren(h("p", { class: "muted", text: "Loading…" }));
      try {
        const d = await api("/api/community/xp?guild=" + encodeURIComponent(guild.value) + "&page=" + page);
        const picker = servers.length > 1 ? h("div", { class: "panel" }, field("Server", guild)) : null;
        const me = d.me, t = d.totals;
        const off = d.enabled ? null : h("div", { class: "notice warn", text: "XP is turned off in this server." + (d.manager ? " Turn it on below." : "") });
        const tile = (k, v, s) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: String(v) }), s && h("div", { class: "s", text: s }));
        const card = h("div", { class: "panel xp-card" }, h("div", { class: "xp-level" }, h("span", { class: "xp-lv-k", text: "LEVEL" }), h("b", { text: String(me.level) })),
          h("div", { class: "xp-card-main" }, h("h3", { text: me.rank ? `You are #${me.rank} of ${me.members}` : "You have no XP yet" }),
            h("p", { class: "muted small", text: `${me.into.toLocaleString()} / ${me.need.toLocaleString()} XP to level ${me.level + 1} · ${me.xp.toLocaleString()} XP in total` }), progressBar(me.into / me.need),
            h("p", { class: "muted small", text: `${me.messages.toLocaleString()} messages · ${me.voiceMinutes.toLocaleString()} minutes in voice` })));
        const stats = h("div", { class: "grid four" }, tile("Members with XP", t.members.toLocaleString()), tile("Total XP", t.xp.toLocaleString()), tile("Messages counted", t.messages.toLocaleString()), tile("Highest level", t.topLevel));
        const medal = r => (r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : String(r));
        const board = h("div", { class: "panel" }, h("h3", { text: "Leaderboard" }),
          d.board.length ? h("div", { class: "scroll-y tall" }, h("table", { class: "xp-board" }, h("thead", {}, h("tr", {}, ["#", "Member", "Level", "XP", "Messages", "Voice"].map((c, i) => h("th", { class: i > 1 ? "num" : "", text: c })))),
            h("tbody", {}, d.board.map(r => h("tr", {}, h("td", { text: medal(r.rank) }), h("td", { text: r.name || "Member" }), h("td", { class: "num", text: String(r.level) }), h("td", { class: "num", text: r.xp.toLocaleString() }), h("td", { class: "num", text: r.messages.toLocaleString() }), h("td", { class: "num", text: r.voice_minutes + " min" })))))) : h("p", { class: "muted", text: "Nobody has earned XP yet. Start chatting!" }),
          d.pages > 1 ? h("div", { class: "row lib-pager" }, h("button", { class: "btn gray small", text: "Previous", disabled: d.page <= 1, onclick: () => { page = d.page - 1; load(); } }), h("span", { class: "muted", text: `Page ${d.page} of ${d.pages}` }), h("button", { class: "btn gray small", text: "Next", disabled: d.page >= d.pages, onclick: () => { page = d.page + 1; load(); } })) : null);
        const rewards = h("div", { class: "panel" }, h("h3", { text: "Level rewards" }),
          d.rewards.length ? h("ul", { class: "plain" }, d.rewards.map(r => h("li", {}, h("b", { text: "Level " + r.level }), " → ", r.name, me.level >= r.level ? " ✅" : ""))) : h("p", { class: "muted", text: "No level rewards yet." }),
          h("p", { class: "muted small", text: "Reach the level and the bot gives you the role." }));
        const how = h("div", { class: "panel" }, h("h3", { text: "How XP works" }), h("ul", {},
          h("li", { text: `Chat: ${d.how.message[0]} to ${d.how.message[1]} XP for a message, at most once a minute.` }),
          h("li", { text: `Voice: ${d.how.voicePerMinute} XP a minute in a voice channel with someone else (not muted or deafened, not in AFK).` }),
          h("li", { text: d.how.referral ? `Invites: ${d.how.referral} XP each time someone joins through your invite link.` : "Invites: bring friends with your own link (/invites link)." }),
          h("li", { text: d.multiplier === 1 ? "XP speed is normal." : `This server runs XP at ×${d.multiplier}.` })));
        const curve = h("div", { class: "panel" }, h("h3", { text: "XP needed per level" }),
          h("div", { class: "scroll-y" }, h("table", {}, h("thead", {}, h("tr", {}, ["Level", "XP to reach it", "Total XP"].map((c, i) => h("th", { class: i ? "num" : "", text: c })))), h("tbody", {}, d.curve.map(c => h("tr", {}, h("td", { text: String(c.level) }), h("td", { class: "num", text: c.need.toLocaleString() }), h("td", { class: "num", text: c.total.toLocaleString() })))))));
        const shop = h("div", { class: "panel shop-soon" }, h("div", { class: "shop-badge", text: "COMING SOON" }), h("h3", { text: "🎁 Prize shop" }),
          h("p", { text: "Spend the XP you earn on rewards from your server's team. Game keys, roles, perks and more." }),
          h("div", { class: "shop-ghosts", "aria-hidden": "true" }, [["🎮", "Game key"], ["👑", "Special role"], ["✨", "Server perk"]].map(([i, n]) => h("div", { class: "shop-ghost" }, h("span", { text: i }), h("b", { text: n }), h("small", { text: "??? XP" })))),
          h("p", { class: "muted small", text: "Keep earning XP. Nothing you earn is lost when the shop opens." }));
        holder.replaceChildren(...[picker, off, card, stats, h("div", { class: "grid two" }, board, h("div", {}, rewards, how)), shop, curve, d.manager ? manage(d) : null].filter(Boolean));
      } catch (e) { holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    function manage(d) {
      const box = h("div");
      (async () => {
        const [ch, ro] = await Promise.all([api("/api/servers/channels?guild=" + encodeURIComponent(guild.value)).catch(() => ({ channels: [] })), api("/api/servers/roles?guild=" + encodeURIComponent(guild.value)).catch(() => ({ roles: [] }))]);
        const post = (path, body) => api(path, { guild_id: guild.value, ...body });
        const save = (label, fn, cls = "btn blue small") => { const b = h("button", { class: cls, text: label }); b.addEventListener("click", () => busy(b, async () => { await fn(); toast("Saved.", "ok"); load(); })); return b; };
        const st = d.settings;
        const mult = h("input", { type: "number", min: "0.1", max: "5", step: "0.1", value: String(st.xp_mult) });
        const ann = select([["same", "In the channel where they chat"], ["channel", "In one channel"], ["off", "Nowhere"]], st.levelup_mode);
        const annCh = select([["", "Not set"], ...ch.channels.map(c => [c.id, "#" + c.name])], st.levelup_channel || "");
        const lvlN = h("input", { type: "number", min: "1", max: "200", placeholder: "Level" }), lvlR = select([["", "Choose a role"], ...ro.roles.map(r => [r.id, r.name])], "");
        const tog = h("button", { class: "btn small " + (st.xp_on ? "red" : "green"), text: st.xp_on ? "Turn XP off" : "Turn XP on" });
        tog.addEventListener("click", () => busy(tog, async () => { await post("/api/community/xp", { enabled: !st.xp_on }); load(); }));
        box.replaceChildren(h("div", { class: "panel" }, h("h3", { text: "Manage XP" }), h("div", { class: "row" }, tog),
          h("div", { class: "grid two" }, field("XP speed (1 is normal)", mult), field("Announce level-ups", ann)), field("Level-up channel", annCh),
          h("div", { class: "row" }, save("Save XP settings", () => post("/api/community/xp", { multiplier: mult.value, announce: ann.value, channel_id: annCh.value }))),
          h("h4", { text: "Level rewards" }),
          d.rewards.length ? h("ul", { class: "plain" }, d.rewards.map(r => h("li", {}, `Level ${r.level}: `, h("b", { text: r.name }), " ", save("Remove", () => post("/api/community/levelrole", { level: r.level, remove: true }), "btn gray small")))) : h("p", { class: "muted", text: "No level rewards yet." }),
          h("div", { class: "row" }, lvlN, lvlR, save("Add reward", () => post("/api/community/levelrole", { level: lvlN.value, role_id: lvlR.value })))));
      })();
      return box;
    }
    guild.addEventListener("change", () => { page = 1; load(); });
    load();
  }

  // ---------- moderation: take an action, see the case log, choose the mod log channel ----------
  async function modView() {
    const servers = state.me.servers.filter(g => g.bot !== false);
    const holder = h("div");
    app.replaceChildren(pageHead("Moderation", "Warn, time out, kick, ban and clean up, with every action logged as a numbered case. In Discord: /mod."), holder);
    if (!servers.length) { holder.replaceChildren(h("div", { class: "notice warn", text: "The bot is not in any of your servers yet. Add it from the Servers page." })); return; }
    const guild = serverPicker(servers, currentParam());
    const ACTIONS = [["warn", "Warn", "moderate"], ["timeout", "Time out", "moderate"], ["untimeout", "Lift a timeout", "moderate"], ["kick", "Kick", "kick"], ["ban", "Ban", "ban"], ["unban", "Unban", "ban"], ["purge", "Clear messages", "manageMessages"]];
    const ICON = { warn: "⚠️", timeout: "🔇", untimeout: "🔈", kick: "👢", ban: "🔨", unban: "🕊️", purge: "🧹" };
    const LABEL = { warn: "Warning", timeout: "Timeout", untimeout: "Timeout lifted", kick: "Kick", ban: "Ban", unban: "Unban", purge: "Messages cleared" };
    const len = sec => { if (!sec) return ""; const d = Math.floor(sec / 86400), hr = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60); return [d && d + "d", hr && hr + "h", m && m + "m"].filter(Boolean).join(" ") || sec + "s"; };
    let filterUser = "", page = 1, d = null;
    const post = (path, body) => api(path, { guild_id: guild.value, ...body });
    const caseRow = c => h("li", { class: "case-row" },
      h("div", {}, h("b", { text: `#${c.case_no} ${ICON[c.action] ?? ""} ${LABEL[c.action] ?? c.action}${c.cleared ? " (cleared)" : ""}` }), " ",
        h("span", { class: "muted", text: `${c.user_name || c.user_id || ""}${c.duration_s ? " · " + len(c.duration_s) : ""} · ${new Date(c.created_at).toLocaleString()}${c.mod_name ? " · by " + c.mod_name : ""}` })),
      c.reason ? h("div", { class: "muted small", text: c.reason }) : null);
    async function load() {
      holder.replaceChildren(h("p", { class: "muted", text: "Loading…" }));
      try {
        d = await api("/api/mod?guild=" + encodeURIComponent(guild.value));
      } catch (e) { holder.replaceChildren(servers.length > 1 ? h("div", { class: "panel" }, field("Server", guild)) : null, h("div", { class: "notice warn", text: e.message })); return; }
      const allowed = ACTIONS.filter(a => d.perms.includes(a[2]));
      const act = select(allowed.map(a => [a[0], a[1]]), allowed[0]?.[0]);
      const user = h("input", { type: "text", placeholder: "User ID or @mention", maxlength: "40" });
      const reason = h("input", { type: "text", maxlength: "400", placeholder: "Why (shown in the log and sent to them)" });
      const dur = h("input", { type: "text", maxlength: "10", placeholder: "10m, 2h, 3d" });
      const days = select([["0", "Keep their messages"], ["1", "Delete the last day"], ["3", "Delete 3 days"], ["7", "Delete 7 days"]], "0");
      const chan = select(d.channels.map(c => [c.id, "#" + c.name]), d.channels[0]?.id);
      const amount = h("input", { type: "number", min: "1", max: "100", value: "10" });
      const rows = { user: field("Person", user), reason: field("Reason", reason), duration: field("Length", dur), days: field("Their recent messages", days), channel: field("Channel", chan), amount: field("How many (1 to 100)", amount) };
      const showFor = () => {
        const a = act.value;
        const on = { user: a !== "purge", reason: a !== "purge", duration: a === "timeout", days: a === "ban", channel: a === "purge", amount: a === "purge" };
        for (const k of Object.keys(rows)) rows[k].hidden = !on[k];
        if (a === "purge") { rows.user.hidden = false; user.placeholder = "Only this person's messages (optional)"; } else user.placeholder = a === "unban" ? "The banned person's user ID" : "User ID or @mention";
      };
      act.addEventListener("change", showFor); showFor();
      const go = h("button", { class: "btn red", text: "Do it" });
      go.addEventListener("click", () => busy(go, async () => {
        const a = act.value;
        if (["kick", "ban"].includes(a) && !confirm(`${a === "ban" ? "Ban" : "Kick"} this person?`)) return;
        const r = await post("/api/mod/action", { action: a, user: user.value, reason: reason.value, duration: dur.value, delete_days: Number(days.value), channel_id: chan.value, amount: Number(amount.value) });
        toast(r.summary || `Done: case #${r.case.case_no}.`, "ok"); reason.value = ""; await load();
      }));
      const actionPanel = allowed.length ? h("div", { class: "panel" }, h("h3", { text: "Take an action" }), field("Action", act), rows.user, rows.reason, rows.duration, rows.days, rows.channel, rows.amount,
        h("p", { class: "muted small", text: "Find a person's ID in Discord: turn on Developer Mode in Settings, Advanced, then right-click them and choose Copy User ID. You cannot act on yourself, the owner, the bot or anyone above you." }), h("div", { class: "row" }, go))
        : h("div", { class: "notice warn", text: "You can read the log here, but none of the moderation permissions (Moderate Members, Kick, Ban, Manage Messages) is yours in this server." });
      const logSel = select([["", "No mod log"], ...d.channels.map(c => [c.id, "#" + c.name])], d.logChannel ?? "");
      const logSave = h("button", { class: "btn blue", text: "Save" });
      logSave.addEventListener("click", () => busy(logSave, async () => { await post("/api/mod/log", { channel_id: logSel.value }); toast("Mod log saved.", "ok"); }));
      const logPanel = d.perms.includes("manageGuild") ? h("div", { class: "panel" }, h("h3", { text: "Moderator log" }), field("Where every action is posted", logSel), h("div", { class: "row" }, logSave),
        h("p", { class: "muted small", text: "A new server gets a private #mod-log for this. Joins and leaves go to #member-log." })) : null;
      const counts = Object.entries(d.counts);
      const stats = h("div", { class: "grid four" }, ...["warn", "timeout", "kick", "ban"].map(k => h("div", { class: "tile" }, h("div", { class: "k", text: LABEL[k] + "s" }), h("div", { class: "v", text: String(d.counts[k] ?? 0) }))));
      const list = h("div"), pager = h("div", { class: "row" });
      const fUser = h("input", { type: "text", placeholder: "Filter by user ID or @mention", maxlength: "40" }); fUser.value = filterUser;
      const fBtn = h("button", { class: "btn gray", text: "Filter" });
      const clearBtn = h("button", { class: "btn gray", text: "Clear this person's warnings", hidden: true });
      async function loadCases() {
        try {
          const r = await api("/api/mod/cases?guild=" + encodeURIComponent(guild.value) + "&page=" + page + (filterUser ? "&user=" + encodeURIComponent(filterUser) : ""));
          list.replaceChildren(r.cases.length ? h("ul", { class: "plain" }, r.cases.map(caseRow)) : h("p", { class: "muted", text: "No cases yet." }));
          const prev = h("button", { class: "btn gray", text: "Previous", disabled: r.page <= 1 }), next = h("button", { class: "btn gray", text: "Next", disabled: r.page >= r.pages });
          prev.addEventListener("click", () => { page = r.page - 1; loadCases(); }); next.addEventListener("click", () => { page = r.page + 1; loadCases(); });
          pager.replaceChildren(prev, h("span", { class: "muted", text: `Page ${r.page} of ${r.pages} · ${r.total} case${r.total === 1 ? "" : "s"}${filterUser ? ` · ${r.warnings} active warning${r.warnings === 1 ? "" : "s"}` : ""}` }), next);
          clearBtn.hidden = !filterUser || !r.warnings;
        } catch (e) { list.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
      }
      fBtn.addEventListener("click", () => { filterUser = fUser.value.trim(); page = 1; loadCases(); });
      clearBtn.addEventListener("click", () => busy(clearBtn, async () => { const r = await post("/api/mod/clearwarns", { user: filterUser }); toast(`Cleared ${r.cleared} warning${r.cleared === 1 ? "" : "s"}.`, "ok"); loadCases(); }));
      const casesPanel = h("div", { class: "panel" }, h("h3", { text: "Cases" }), h("div", { class: "row" }, fUser, fBtn, clearBtn), list, pager);
      holder.replaceChildren(...[servers.length > 1 ? h("div", { class: "panel" }, field("Server", guild)) : null, stats, actionPanel, logPanel, casesPanel].filter(Boolean));
      loadCases();
    }
    guild.addEventListener("change", () => { page = 1; filterUser = ""; load(); });
    load();
  }

  const VIEWS = { mod: modView, xp: xpView, community: communityView, gamenight: gameNightView, lfg: lfgView, setup: setupView, notifications: notificationsView, changelog: changelogView, support: supportView, value: valueView, wishlist: wishlistView, library: libraryView, redeem: redeemView, compare: compareView, calendar: calendarView, friends: friendsView, steam: steamView, foryou: forYouView, deals: dealsView, free: freeView, warroom: warRoomView, alerts: alertsView, servers: serversView, giveaways: giveawaysView, mydata: myDataView, help: helpView, about: aboutView, status: statusView, home: landing, mypage: myPageView, admin: adminView };

  function route() {
    if (!state.cfg) return; // still starting; boot() calls route() once the settings are in
    renderChrome();
    const view = currentView();
    if (!state.me && view !== "help" && view !== "about" && view !== "home" && view !== "status" && view !== "u") return landing();
    if (view === "u" && currentParam()) { publicWishlistView(currentParam()); window.scrollTo({ top: 0, behavior: "instant" }); return; }
    if (view === "g" && state.me && currentParam()) { gameView(currentParam()); window.scrollTo({ top: 0, behavior: "instant" }); return; }
    if (view === "servers" && state.me && currentParam()) { serverDetail(currentParam()); window.scrollTo({ top: 0, behavior: "instant" }); return; }
    (VIEWS[view] || (state.me ? valueView : landing))();
    const nb = newsBanner();
    if (nb && view !== "home") app.prepend(nb);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  async function boot() {
    try {
      if (!state.cfg) state.cfg = await api("/api/config");
      try { const x = await api("/api/about"); state.about = x.about; state.creator = x.creator; state.freeNow = x.freeNow ?? null; } catch { state.about = null; state.creator = null; }
      try { state.me = await api("/api/me"); } catch { state.me = null; }
    } catch (e) {
      app.replaceChildren(h("div", { class: "notice warn", text: e.message }));
      return;
    }
    route();
    if (state.me && state.me.tour) setTimeout(() => { if (state.me && state.me.tour && !document.getElementById("tour")) startTour(); }, 700);
  }

  // Visitor counter: totals only. A browser counts as new once (remembered here), no cookies and no addresses stored.
  // "Viewing now" uses a random id kept for this tab only; the server forgets it 75 seconds after the last ping.
  (function visitCounter() {
    const out = document.getElementById("visits");
    if (!out) return;
    const BASE = "/api/visits/dashboard";
    const rnd = new Uint8Array(12);
    crypto.getRandomValues(rnd);
    let id = Array.from(rnd, b => (b % 36).toString(36)).join("");
    try { const k = sessionStorage.getItem("svc_tab"); if (k && /^[a-z0-9]{12}$/.test(k)) id = k; else sessionStorage.setItem("svc_tab", id); } catch { /* storage blocked */ }
    let isNew = false;
    try { isNew = !localStorage.getItem("svc_visited"); } catch { /* count as a view only */ }
    let last = null;
    const n = v => Number(v).toLocaleString();
    const show = d => {
      if (!d || typeof d.visitors !== "number") return;
      last = d;
      out.replaceChildren(
        typeof d.online === "number" ? h("span", { class: "live-dot", "aria-hidden": "true", text: "● " }) : null,
        typeof d.online === "number" ? `${n(Math.max(1, d.online))} viewing now · ` : null,
        `${n(d.visitors)} visitors · ${n(d.views)} page views`);
      out.hidden = false;
    };
    fetch(`${BASE}?id=${id}${isNew ? "&new=1" : ""}`, { method: "POST", keepalive: true })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { show(d); if (d && isNew) { try { localStorage.setItem("svc_visited", "1"); } catch { /* ignore */ } } })
      .catch(() => {});
    const beat = () => {
      if (document.hidden || !last) return;
      fetch(`${BASE}/ping?id=${id}`, { method: "POST" }).then(r => (r.ok ? r.json() : null)).then(show).catch(() => {});
    };
    setInterval(beat, 30000);
    document.addEventListener("visibilitychange", beat);
  })();

  window.addEventListener("hashchange", route);
  boot();
})();

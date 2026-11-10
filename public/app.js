// Steam Value Checker dashboard. All text is inserted with textContent, never innerHTML.
window.SVC_SITE = envIn => {
  "use strict";
  const env = envIn || {};
  // One copy of the site per place it is shown. The normal page makes one for itself. A LucadoOS window makes one more for its own
  // element (env.root), with its own address, so pages open inside the desktop without a frame around each of them.
  const NATIVE = Boolean(env.root);
  // Read before the visitor counter marks this browser as seen, so the desktop-theme hint only goes to someone brand new.
  let FIRST_VISIT = false;
  try { FIRST_VISIT = !NATIVE && !localStorage.getItem("svc_visited") && !localStorage.getItem("svc_os_intro"); } catch { /* no storage, no hint */ }

  // A profile's address is /u/name, so chat apps can show a preview. The address bar keeps that form while one is open,
  // which means whatever people copy from it shares properly.

  const state = env.state || { cfg: null, me: null };
  if (!NATIVE) window.__svcState = state; // LucadoOS windows (frames) read this instead of asking the server for the same things again
  const ADMIN_MODE = document.documentElement.dataset.mode === "admin"; // admin.html: the owner's panel, not the member dashboard
  const app = env.root || document.getElementById("app");
  // LucadoOS (the desktop theme) shows each site page in a frame inside a window. Inside one of those frames the page drops its own header and footer.
  const EMBED_FRAME = !ADMIN_MODE && !NATIVE && window.self !== window.top, EMBED = EMBED_FRAME || NATIVE; // EMBED: no header or footer of its own
  // The FanaticalGrabber extension only listens in the top page. Inside a LucadoOS window the desktop passes its messages along in both directions.
  const extSend = msg => { if (EMBED_FRAME) window.parent.postMessage({ svcRelay: "page", msg }, location.origin); else window.postMessage(msg, location.origin); };
  const fromExt = e => e.origin === location.origin && (e.source === window || (EMBED_FRAME && e.source === window.parent));
  if (EMBED_FRAME) document.documentElement.classList.add("os-embed");

  // The browser turns null/undefined/false passed to replaceChildren/append/prepend into the words "null", "undefined", "false".
  // Skip them instead, so an optional piece of a page can simply be null.
  if (!Element.prototype.__svcPatched) for (const name of ["replaceChildren", "append", "prepend"]) {
    Element.prototype.__svcPatched = true;
    const native = Element.prototype[name];
    Element.prototype[name] = function (...nodes) { return native.apply(this, nodes.flat(Infinity).filter(n => n !== null && n !== undefined && n !== false)); };
  }

  // ---------- language ----------
  // Text is looked up by its English wording in public/i18n.js as the page is built; anything without a translation stays English.
  const I18N = window.SVC_I18N || { LANGS: { en: "English" }, valid: c => c === "en", pick: () => "en", hasChoice: () => false, remember() {}, tx: (l, t) => t };
  let LANG = I18N.pick();
  document.documentElement.lang = LANG;
  const tx = s => I18N.tx(LANG, s);
  const TX_ATTRS = new Set(["title", "placeholder", "aria-label", "alt"]);

  // ---------- helpers ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = tx(v);
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "value" || k === "checked" || k === "disabled" || k === "selected") el[k] = v;
      else el.setAttribute(k, v === true ? "" : TX_ATTRS.has(k) ? tx(v) : v);
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(tx(kid))));
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
    if (res.status === 401) { state.me = null; if (!ADMIN_MODE) renderChrome(); }
    if (res.status === 403 && data.restricted) { state.restricted = data.error; state.me = null; showRestricted(); throw new Error(data.error); }
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }

  // The full-page message a restricted person sees instead of the dashboard.
  function showRestricted() {
    const app = document.getElementById("app");
    document.title = "Access restricted";
    app.replaceChildren(h("div", { class: "panel restricted", role: "alert", style: "max-width:560px;margin:60px auto;text-align:center;padding:32px" },
      h("div", { style: "font-size:48px", text: "🚫" }),
      h("h2", { text: "Your access has been restricted" }),
      h("p", { text: state.restricted || "The bot owner has restricted your access to Steam Value Checker." }),
      h("p", { class: "muted", text: "The bot won't respond to your commands and the dashboard is closed to you." })));
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

  // Pick any number of roles: chosen ones show as chips you can click away, and `.value` is a comma list of ids (like a text field).
  function roleMulti(roles) {
    const chosen = [], box = h("div", { class: "rm" }), add = h("select", { "aria-label": "Add a role" });
    const draw = () => {
      const chips = chosen.map(id => {
        const r = (roles || []).find(x => x.id === id), b = h("button", { type: "button", class: "rm-chip", title: "Remove", text: (r ? r.name : id) + " ×" });
        b.addEventListener("click", () => { chosen.splice(chosen.indexOf(id), 1); draw(); });
        return b;
      });
      add.replaceChildren(h("option", { value: "", text: chosen.length ? "Add another role…" : "Add a role…" }), ...(roles || []).filter(r => !chosen.includes(r.id)).map(r => h("option", { value: r.id, text: r.name })));
      add.value = "";
      box.replaceChildren(...chips, add);
    };
    add.addEventListener("change", () => { if (add.value && chosen.length < 10) chosen.push(add.value); draw(); });
    Object.defineProperty(box, "value", { get: () => chosen.join(","), set: v => { chosen.splice(0, chosen.length, ...String(v || "").split(",").filter(Boolean)); draw(); } });
    draw();
    return box;
  }

  // A small thank-you card for Top.gg votes. It only shows once the bot has a Top.gg token, and fills in after the page loads.
  function voteCard() {
    const box = h("div");
    if (!state.me) return box;
    api("/api/topgg").then(v => {
      if (!v || !v.enabled) return;
      box.replaceChildren(h("a", { class: "card-link", href: safeHref(v.url), target: "_blank", rel: "noopener noreferrer" },
        h("span", { class: "icon", text: "🗳️" }),
        h("span", {}, h("strong", { text: "Vote for the bot on Top.gg" }),
          h("span", { class: "muted", text: v.voted ? `Thanks, you voted. You can vote again ${new Date(v.nextAt).toLocaleString()}.` : `Every vote gives you ${v.xp} bonus XP in each server where you already have XP.` }))));
    }).catch(() => {});
    return box;
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
    { id: "library", label: "Library", pages: [["library", "My library"], ["steam", "Steam"], ["value", "Value Checker"], ["redeem", "Batch redeem"]] },
    { id: "feed", label: "Social", pages: [["feed", "Feed"], ["people", "People"], ["friends", "Friends"], ["compare", "Compare"], ["communities", "Communities"], ["discover", "Discover"]] },
    { id: "deals", label: "Deals", pages: [["wishlist", "Wishlist"], ["foryou", "For you"], ["deals", "Check a deal"], ["warroom", "Sale planner"]] },
    { id: "indie", label: "Indie devs", pages: [["indie", "Showcase & tools"], ["devpanel", "Dev panel"]] },
    { id: "fortnite", label: "Fortnite", pages: [["fortnite", "Fortnite"]] },
    { id: "free", label: "Free & codes", pages: [["free", "Free games"], ["bundles", "Bundles"], ["playtests", "Playtests"], ["codes", "Codes & promos"]] },
    { id: "social", label: "Play together", pages: [["gamenight", "Game night"], ["nowplaying", "Now playing"], ["club", "Game club"], ["trivia", "Trivia"], ["lfg", "Looking for group"], ["calendar", "Calendar"]] },
    { id: "servers", label: "Servers", pages: [["servers", "My servers"], ["setup", "Setup"], ["community", "Community"], ["santa", "Secret Santa"], ["xp", "Server XP"], ["mod", "Moderation"], ["giveaways", "Giveaways"], ["music", "Music"]] },
    { id: "streamer", label: "Streamers", pages: [["streamer", "Streamer hub"], ["overlays", "Overlay studio"], ["streams", "Go live"], ["streamers", "Who is live"]] },
    { id: "account", label: "Account", pages: [["profile", "My profile"], ["mypage", "My page"], ["notifications", "Notifications"], ["alerts", "Alert settings"], ["mydata", "My data"]] },
    { id: "help", label: "Help", pages: [["help", "Help"], ["support", "Support"], ["tip", "Chip in"], ["requests", "Feature requests"], ["status", "Status"], ["changelog", "What's new"], ["about", "About"]] },
    { id: "admin", label: "Admin", pages: [["admin", "Admin"]] }
  ];
  // Pages that are not tabs themselves but belong to a section: one game's page sits under Deals.
  const HUB_ALIAS = { g: "deals" };
  const PUBLIC_PAGES = new Set(["fortnite", "home", "help", "about", "status", "tip", "feed", "discover", "communities", "indie"]);
  function pageVisible(id) {
    const me = state.me;
    if (id === "home" && me) return false; // the logo already goes home when signed in
    if (id === "admin") return Boolean(me && me.isOwner);
    if (id === "devpanel") return Boolean(me && me.indieDev);
    if (id === "giveaways") return Boolean(me && me.giveaways && me.servers.some(g => g.manageable));
    if (id === "gamenight" || id === "compare" || id === "santa" || id === "trivia" || id === "community" || id === "xp" || id === "mod") return Boolean(me && me.servers.some(g => g.bot !== false));
    if (id === "setup") return Boolean(me && me.servers.some(g => g.manageable));
    return Boolean(me) || PUBLIC_PAGES.has(id);
  }
  let openMenu = null;
  function closeMenu() { if (openMenu) { openMenu.btn.setAttribute("aria-expanded", "false"); openMenu.menu.hidden = true; openMenu = null; } }
  document.addEventListener("click", e => { if (openMenu && !openMenu.wrap.contains(e.target)) closeMenu(); });
  // "/" jumps to the search box on the current page, like most sites with a list.
  if (!NATIVE) document.addEventListener("keydown", e => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target, tag = (t?.tagName ?? "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || t?.isContentEditable) return;
    const box = [...document.querySelectorAll("input[type=search]")].find(el => el.offsetParent !== null);
    if (box) { e.preventDefault(); box.focus(); box.select?.(); }
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && openMenu) { const b = openMenu.btn; closeMenu(); b.focus(); } });
  window.addEventListener("hashchange", closeMenu);
  // On phones the top bar folds into a Menu button so it doesn't cover the page.
  const bar = document.querySelector(".topbar"), tog = document.getElementById("navtoggle");
  if (bar && tog && !NATIVE) { // the admin panel and other pages that share this script have no top bar
    const setOpen = on => { bar.classList.toggle("open", on); tog.setAttribute("aria-expanded", String(on)); };
    tog.addEventListener("click", () => setOpen(!bar.classList.contains("open")));
    window.addEventListener("hashchange", () => setOpen(false));
    document.getElementById("nav")?.addEventListener("click", e => { if (e.target.closest("a")) setOpen(false); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && bar.classList.contains("open")) { setOpen(false); tog.focus(); } });
  }
  const STEAM_ICON = "M12 2a10 10 0 0 0-9.96 9.1l5.35 2.2a2.8 2.8 0 0 1 1.6-.5h.15l2.4-3.45v-.05a3.75 3.75 0 1 1 3.75 3.75h-.1l-3.4 2.45a2.8 2.8 0 0 1-5.55.45L2.3 14.2A10 10 0 1 0 12 2z";
  const steamIcon = () => { const n = document.createElementNS("http://www.w3.org/2000/svg", "svg"); n.setAttribute("viewBox", "0 0 24 24"); n.setAttribute("width", "18"); n.setAttribute("height", "18"); n.setAttribute("aria-hidden", "true"); const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", STEAM_ICON); p.setAttribute("fill", "currentColor"); n.append(p); return n; };
  const steamLoginBtn = (text = "Sign in through Steam", cls = "btn steam") => h("a", { class: cls, href: "/auth/steam" }, steamIcon(), " " + text);
  // Pages have plain addresses like /wishlist and /servers/123. Old links with a # still work: they are rewritten on load.
  // A window keeps its own address here; the normal page uses the browser's.
  const LOC = NATIVE ? { pathname: "/", search: "", hash: "" } : location;
  const setLoc = path => { const u = new URL(String(path).replace(/^#/, ""), location.origin); LOC.pathname = u.pathname; LOC.search = u.search; LOC.hash = ""; };
  if (NATIVE) setLoc(env.path || "/");
  const routeText = () => {
    const h = LOC.hash.replace(/^#\/?/, "");
    return h || LOC.pathname.replace(/^\/+|\/+$/g, "") + LOC.search;
  };
  const navigate = path => {
    if (NATIVE) { setLoc(path); route(); env.onNavigate?.(LOC.pathname + LOC.search); return; }
    history.pushState(null, "", path); window.dispatchEvent(new Event("hashchange"));
  };
  const replaceUrl = path => { if (NATIVE) { setLoc(path); env.onNavigate?.(LOC.pathname + LOC.search); } else history.replaceState(null, "", path); };
  const scrollTop0 = () => { if (NATIVE) env.scroller?.scrollTo({ top: 0, behavior: "instant" }); else window.scrollTo({ top: 0, behavior: "instant" }); };
  const currentView = () => routeText().split("?")[0].split("/")[0];
  const currentParam = () => routeText().split("?")[0].split("/")[1] || null;

  const navText = (id, text) => text; // h() translates it

  // Prices come from one saved setting, the region (it decides the currency). It is kept on the account, so the Discord bot uses it too.
  /** The switch to the LucadoOS desktop theme (wide screens only; Classic stays the default). */
  const osButton = () => (window.LucadoOS?.canUse() ? h("button", { class: "theme-btn", type: "button", text: "🖥️", title: "Switch to the LucadoOS desktop", "aria-label": "Switch to the LucadoOS desktop", onclick: () => window.LucadoOS.setMode("os") }) : null);
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

  // The language is one setting for the dashboard and the Discord bot: signed in, it is saved on the account too.
  function languagePicker() {
    const btn = h("button", { type: "button", class: "nav-btn cur-btn", "aria-haspopup": "true", "aria-expanded": "false", title: "Language", "aria-label": "Language: " + I18N.LANGS[LANG] }, "🌐 " + LANG.toUpperCase());
    const menu = h("div", { class: "menu right scroll", role: "menu", hidden: true },
      ...Object.entries(I18N.LANGS).map(([code, name]) => {
        const item = h("button", { type: "button", role: "menuitem", lang: code, class: code === LANG ? "active" : "", text: name });
        item.addEventListener("click", async () => {
          closeMenu();
          if (code === LANG) return;
          LANG = code; I18N.remember(code); document.documentElement.lang = code;
          if (state.me) { try { const res = await api("/api/settings", { lang: code }); state.me.settings = res.settings; } catch { /* the page still switches */ } }
          renderChrome(); route();
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

  let nativeLinkClick = null; // a desktop window's link handling, shared by its page and its row of section tabs
  /** The tabs for the section you are in (only when it has more than one page you can see). A desktop window keeps its own row above its page. */
  function drawHubbar(view) {
    const hubOf = id => (HUB_ALIAS[id] ? NAV.find(g => g.id === HUB_ALIAS[id]) : NAV.find(g => g.pages.some(([p]) => p === id)));
    const here = hubOf(view);
    const badge = n => (n ? h("span", { class: "badge-count", text: String(Math.min(99, n)) }) : null);
    let bar = NATIVE ? app.parentElement?.querySelector(":scope > .hubbar") : document.getElementById("hubbar");
    if (!bar) { bar = h("nav", { class: "hubbar", "aria-label": "Section pages" }); if (!NATIVE) bar.id = "hubbar"; else bar.addEventListener("click", e => nativeLinkClick?.(e)); app.before(bar); }
    const tabs = here ? here.pages.filter(([id]) => pageVisible(id)) : [];
    bar.hidden = tabs.length < 2;
    bar.replaceChildren(...(tabs.length < 2 ? [] : [
      ...tabs.map(([id, text]) => h("a", { href: "#/" + id, class: "hubtab" + (view === id ? " active" : ""), "aria-current": view === id ? "page" : null }, navText(id, text), id === "notifications" ? badge(state.me && state.me.unread) : null)),
      here.id === "help" && state.cfg ? ext(state.cfg.fanaticalUrl, "FanaticalGrabber ↗", "hubtab") : null,
      here.id === "help" ? h("a", { class: "hubtab", href: "/ai", text: "AI companion (beta)" }) : null].filter(Boolean)));
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
      return h("a", { href: group.id === "admin" && state.me && state.me.adminUrl ? state.me.adminUrl : "#/" + pages[0][0], class: active ? "active" : "", "data-pages": pages.map(p => p[0]).join(" "), "aria-current": active ? "page" : null }, navText(group.id, group.label), badge(unread));
    }).filter(Boolean));
    drawHubbar(view);
    const cr = state.creator;
    document.getElementById("footer-links").replaceChildren(
      ...(cr ? [h("a", { class: "copyright", href: safeHref(cr.url), target: "_blank", rel: "noopener noreferrer" },
        h("img", { src: "/creator.png", alt: "", width: "22", height: "22" }), `© ${new Date().getFullYear()} ${cr.name}`)] : []));
  }

  // ---------- landing ----------
  /** A small stand-in for the desktop theme: icons, two windows and a taskbar. It's decoration, so it's hidden from screen readers. */
  function osPreview() {
    const icon = (e, t) => h("div", { class: "osm-ic" }, h("i", { text: e }), h("span", { text: t }));
    const win = (cls, icon_, title, ...body) => h("div", { class: "osm-win " + cls }, h("div", { class: "osm-bar" }, h("span", { text: icon_ + " " + title }), h("em", {}, h("u"), h("u"), h("u"))), h("div", { class: "osm-body" }, ...body));
    return h("div", { class: "osm", "aria-hidden": "true" },
      h("div", { class: "osm-icons" }, icon("🏠", "Home"), icon("📚", "Library"), icon("💸", "Deals"), icon("🛡️", "Servers"), icon("🪂", "Fortnite")),
      win("w1", "📚", "Value Checker", h("b", { class: "osm-h", text: "Library value" }),
        h("div", { class: "osm-stats" }, h("span", {}, h("b", { text: "$4,820" }), "worth"), h("span", {}, h("b", { text: "$1,942" }), "paid"), h("span", {}, h("b", { text: "60%" }), "saved")),
        h("i", { class: "osm-line l1" }), h("i", { class: "osm-line l2" }), h("i", { class: "osm-line l3" })),
      win("w2", "💸", "Deals", h("b", { class: "osm-h", text: "Wanderstop is 61% off" }), h("span", { class: "osm-sub", text: "All-time low: $9.87 at Fanatical" }),
        h("div", { class: "osm-btns" }, h("u", { text: "View deal" }), h("u", { text: "Price history" }))),
      h("div", { class: "osm-task" }, h("b", { text: "▦ Start" }), h("span", { text: "📚 Value Checker" }), h("span", { text: "💸 Deals" }), h("em", { text: "9:41 AM" })));
  }

  function landing() {
    const failed = new URLSearchParams(LOC.search).get("error");
    const ab = state.about;
    const n = v => (v === null || v === undefined ? null : Number(v).toLocaleString());
    const invite = state.cfg && state.cfg.inviteUrl;
    const onDesk = Boolean(window.LucadoOS?.active()); // already inside the desktop theme: offer the way back, not the way in
    const cta = (extra = "") => h("div", { class: "lp-cta " + extra },
      invite && ext(invite, "Add to a server", "btn green big"),
      state.cfg && state.cfg.supportUrl && ext(state.cfg.supportUrl, "Join the support server", "btn gray big"),
      state.cfg && state.cfg.userInstallUrl && ext(state.cfg.userInstallUrl, "Add to your account", "btn blue big"),
      state.me ? h("a", { class: "btn blue big", href: "#/value", text: "Open the dashboard" }) : [steamLoginBtn("Sign in through Steam", "btn steam big"), h("a", { class: "btn blue big", href: "/auth/login", text: "Sign in with Discord" })]);

    // The hero collage: a sale alert and two of the pictures the AI companion posts.
    const pic = (src, cls) => h("img", { class: "lx-pic " + cls, src, alt: "", loading: "eager", width: "480", height: "260" });
    const alertMock = h("div", { class: "dc-card lx-alert", "aria-hidden": "true" },
      h("div", { class: "dc-bot" }, h("img", { src: "/logo.png", alt: "", width: "32", height: "32" }), h("b", { text: "Steam Value Checker" }), h("span", { class: "dc-tag", text: "APP" })),
      h("div", { class: "dc-embed" },
        h("div", { class: "dc-title", text: "Wanderstop is 61% off" }),
        h("div", { class: "dc-line", text: "All-time low: $9.87 at Fanatical" }),
        h("div", { class: "dc-fields" }, h("span", {}, h("b", { text: "Regular" }), "$24.99"), h("span", {}, h("b", { text: "You save" }), "$15.12"))),
      h("div", { class: "dc-buttons" }, h("span", { class: "dc-btn link", text: "View deal" }), h("span", { class: "dc-btn", text: "Price history" })));
    const collage = h("div", { class: "lx-collage", "aria-hidden": "true" },
      h("i", { class: "lx-blob b1" }), h("i", { class: "lx-blob b2" }),
      pic("/img/ai/library.png", "p1"), pic("/img/ai/history.png", "p2"), alertMock);

    const sec = (cls, ...kids) => h("section", { class: "lx-sec " + cls }, ...kids);
    const head = (kicker, title, sub) => h("div", { class: "lx-head" }, h("div", { class: "lx-kick", text: kicker }), h("h2", { text: title }), sub && h("p", { class: "lx-lede", text: sub }));
    const stat = (label, value) => { if (!value) return value; const v = h("div", { class: "v", text: value }), num = Number(String(value).replace(/,/g, "")); if (Number.isFinite(num) && num > 0) v.setAttribute("data-count", String(num)); return h("div", { class: "lp-stat" }, v, h("div", { class: "k", text: label })); };

    // The features, by area. Tabs switch the grid under them.
    const AREAS = [
      ["Deals and alerts", "#ffb347", [
        ["Wishlist alerts", "Bring in your public Steam wishlist and pick what counts as worth a ping: any sale, a percent off, a price you set, or an all-time low."],
        ["Free game alerts", "A message when a game goes free on Steam, Epic, GOG and others, with a button to grab it."],
        ["Price history", "A graph of the last year with the all-time low marked, and a buy-or-wait verdict that counts the next big sale."],
        ["Hot deals and sale starts", "Your server gets a post when a big deal shows up or a Steam sale kicks off. You pick the minimum discount."],
        ["Sale war room", "Set a budget before a Steam sale and plan the cart around it."],
        ["Bundle check", "Checks a bundle against what its games cost today, and skips the ones you own."],
        ["Playtests and demos", "Betas, demos, free weekends and sign-ups from Steam announcements and a few other sources."],
        ["Game codes", "SHiFT codes and other limited-time game codes, posted once each with an end date, then greyed out."],
        ["DLC sales and news", "A heads-up when add-ons for games you play are heavily discounted, plus patch notes and release dates."]]],
      ["Your library", "#4ade80", [
        ["Library value", "The full price, what Steam charges today, the cheapest store right now, and what you saved on what you paid."],
        ["Steam library", "Sign in with Steam for hours, what you never touched, achievements and a pick for what to play next."],
        ["Spending", "What you've spent by month, what you paid per game, and the games bought but never played."],
        ["Badges and challenges", "Badges for your library, a monthly finish goal and a streak, plus a backlog league for your server."],
        ["Compare", "Put two games side by side on price, reviews and genre."],
        ["Profile card", "A shareable card with your library stats, and a public page of your own."],
        ["Refund reminders", "A nudge before the two-hour and fourteen-day refund windows close."]]],
      ["Your server", "#60a5fa", [
        ["Steam Verified role", "Members prove their Steam account with Steam's own sign-in and get a role. Nobody types a password."],
        ["Welcome and roles", "Welcome cards with a picture, an auto role for new members, and a goodbye message if you want one."],
        ["Levels and XP", "Chat levels with ranks, a leaderboard and role rewards."],
        ["Moderation", "Warnings, timeouts, bans and a log channel, all in one place."],
        ["Server guides", "Write your own answers for rules, roles and channels. The bot replies to matching questions by itself."],
        ["Looking for group", "Post a game, a time and open slots. People hit Join and the post fills up."],
        ["Calendar and game night", "A server calendar, event reminders and a game night that picks what to play."],
        ["Trivia, Secret Santa, game club", "Quizzes, gift swaps and a club that votes on its next game."],
        ["Now playing", "A squad-up post when two or more members are in the same game."],
        ["Shared wishlist", "A wishlist the whole server votes on, and a ping when a few members wait on the same deal."]]],
      ["Community", "#f472b6", [
        ["Community feed", "Follow people, post, react and discover what other gamers are up to."],
        ["Server directory", "A directory of communities, with a feed for each server."],
        ["Public profiles", "A page with your games, achievements and a guestbook people can sign."],
        ["Friends and gifts", "Friends' birthdays a week ahead, what's on sale from their wishlists, and gift claims so two people don't buy the same game."],
        ["Leaderboards", "A savings leaderboard for people who opt in, and a backlog league."]]],
      ["Giveaways and streaming", "#fbbf24", [
        ["Giveaways", "Hand out keys, Nitro, gift cards or anything else. Winners claim with a button, confirm it worked and a vouch posts for you."],
        ["Encrypted prize keys", "Keys are encrypted the moment they're saved, and only the winner ever sees one."],
        ["Twitch chat entry", "Viewers enter from Twitch chat. Winners are drawn and announced in Discord."],
        ["Stream overlays", "Giveaway, now-playing and stream-card overlays for OBS."],
        ["Streamer hub", "Link your channel, show who's live in your server and post go-live alerts."]]],
      ["Music and tools", "#a78bfa", [
        ["SoundCloud music", "Songs and playlists in a voice channel with /play. Queue, skip votes, loop and a live now-playing card."],
        ["Radio stations", "A radio mode and a full player on the dashboard."],
        ["FanaticalGrabber", "A Chrome extension that reveals and exports your Fanatical game keys, with batch redeem for Steam."],
        ["Twelve languages", "The dashboard and bot speak twelve languages."],
        ["Installable dashboard", "Add the dashboard to your phone's home screen. It works like an app."],
        ["Support desk", "Report a bug or open a ticket. Replies show up on Discord and the dashboard."]]]
    ];
    const tabsHost = h("div", { class: "lx-tabs", role: "tablist" }), gridHost = h("div", { class: "lx-feats" });
    const showArea = i => {
      [...tabsHost.children].forEach((b, k) => b.setAttribute("aria-selected", String(k === i)));
      const [, hue, items] = AREAS[i];
      gridHost.replaceChildren(...items.map(([t, d], k) => { const c = h("div", { class: "lx-feat" }, h("b", { text: t }), h("span", { text: d })); c.style.setProperty("--hue", hue); c.style.animationDelay = k * 30 + "ms"; return c; }));
    };
    AREAS.forEach(([name, hue], i) => { const b = h("button", { type: "button", role: "tab", text: name }); b.style.setProperty("--hue", hue); b.addEventListener("click", () => showArea(i)); tabsHost.append(b); });
    showArea(0);

    const shipped = [
      ["NEW", "Indie developer corner", "A free showcase for indie games and a toolbox for Steam developers. Browsing needs no sign-in."],
      ["AI", "The AI companion", "Ask in plain words and get pictures back: price graphs, comparisons, library stats and play plans."],
      ["NEW", "Buy or wait", "A verdict with the reasons and a year of price history."],
      ["NEW", "How-to guides", "Ask \"how do I get Steam verified\" and the bot answers with a picture guide on its own."],
      ["NEW", "Server guides", "Managers write their own answers for rules, roles and channels."],
      ["NEW", "Group posts by chat", "Ask for a looking-for-group post or an event and it makes the real thing."],
      ["NEW", "Notes it keeps", "It remembers what you like, a few short notes, and forgets whenever you say."]
    ];
    const step = (num, title, text) => h("div", { class: "lp-step" }, h("div", { class: "lp-num", text: num }), h("h3", { text: title }), h("p", { text }));
    const indieShots = h("div", { class: "lx-indie-shots" }, [["fee-calculator", "Steam fee and tax calculator", "What you keep from each sale"], ["wishlist-calculator", "Wishlist calculator", "Wishlists into likely sales"], ["capsule-analyzer", "Capsule analyzer", "Does it read at thumbnail size?"], ["next-fest-score", "Next Fest readiness score", "What to fix before the festival"]]
      .map(([id, t, d]) => h("a", { class: "lx-ix-tool", href: `/indie/tools/${id}` }, h("b", { text: t }), h("span", { text: d }))));
    api("/api/indie").then(d => {
      const list = [...(d.featured || []), ...(d.games || [])].filter((g, i, a) => a.findIndex(x => x.id === g.id) === i).slice(0, 3);
      if (list.length < 3 || !document.body.contains(indieShots)) return;
      indieShots.replaceChildren(...list.map(g => h("a", { class: "lx-ix-card real", href: `/indie/game/${g.id}`, tabindex: "-1" }, h("img", { src: g.image, alt: "", width: 460, height: 215, loading: "lazy" }), h("b", { text: g.title }), h("span", { text: g.studio || "Indie studio" }))));
    }).catch(() => {});
    const aiShots = ["history", "compare", "plan"].map(s => h("img", { src: `/img/ai/${s}.png`, alt: "", loading: "lazy", width: "480", height: "260" }));

    app.replaceChildren(...[
      state.me && newsBanner(),
      state.me && h("section", { class: "lp-setup" }, setupCard()),
      h("section", { class: "lx-hero" },
        h("i", { class: "lx-aurora a1" }), h("i", { class: "lx-aurora a2" }),
        h("div", { class: "lx-hero-text" },
          failed && h("div", { class: "notice warn", text: "Sign-in didn't work. Give it another go." }),
          h("a", { class: "lx-new", href: "/ai" }, h("b", { text: "NEW" }), "Meet the AI companion", h("span", { class: "lx-beta", text: "BETA" }), h("i", { text: "→" })),
          h("a", { class: "lx-new lx-new-indie", href: "/indie" }, h("b", { text: "NEW" }), "Indie devs: showcase and free tools", h("i", { text: "→" })),
          state.freeNow ? h("a", { class: "lp-live", href: state.me ? "#/free" : "/auth/login" }, h("i", { class: "lp-dot" }), `${state.freeNow} free offer${state.freeNow === 1 ? "" : "s"} live right now`) : null,
          h("h1", {}, "Your whole gaming life, ", h("span", { class: "lx-grad", text: "worth every penny" }), "."),
          h("p", { class: "lp-sub", text: "I made this bot because I kept losing track of what I'd paid for games. Now it prices your library, watches your wishlist, answers questions with pictures, and runs your gaming server. All free, in Discord and on the web." }),
          cta(),
          h("p", { class: "muted small", text: "It will never ask for a password or a game key. Signing in only shares your name, avatar and server list." })),
        collage),

      h("div", { class: "lp-ticker", "aria-hidden": "true" }, h("div", { class: "lp-ticker-track" },
        ...[0, 1].flatMap(() => ["AI companion", "Indie showcase", "Developer tools", "Library value", "Price graphs", "Wishlist alerts", "Free games", "Steam Verified", "Levels and XP", "Looking for group", "Giveaways", "Stream overlays", "Music", "Guides", "Profiles"].map(t => h("span", { text: t }))))),

      ab && (n(ab.servers) || n(ab.gamesWatched)) ? h("section", { class: "lp-stats" },
        stat("Servers", n(ab.servers)), stat("Games watched", n(ab.gamesWatched)), stat("Alerts in the last 24h", n(ab.alerts24h)), stat("Giveaway keys redeemed", n(ab.redeemed))) : null,

      sec("lx-os",
        h("div", { class: "lx-os-text" },
          h("span", { class: "lx-kick", text: "Desktop theme" }),
          h("h2", { text: onDesk ? "You're on the desktop theme" : "Want it to feel like a desktop?" }),
          h("p", { class: "lp-sub", text: onDesk ? "Every page is an icon and every page you open is a window. Drag them, resize them, snap them side by side, and use Personalize for your own wallpaper and colors. Prefer the regular site? It's one click away." : "LucadoOS turns the whole site into a desktop. Every page is an icon, every page you open is a window you can move, resize and snap side by side, and there's a taskbar and a Start menu. Pick your own wallpaper and colors in Personalize." }),
          h("div", { class: "lp-cta" }, onDesk ? h("button", { class: "btn gray big", type: "button", text: "Back to the classic site", onclick: () => window.LucadoOS.setMode("classic") }) : window.LucadoOS?.canUse() ? h("button", { class: "btn blue big", type: "button", text: "Try the desktop", onclick: () => window.LucadoOS.setMode("os") }) : null),
          h("p", { class: "muted small", text: onDesk ? "Your windows and settings are kept if you come back." : "It's a choice, not a change. Classic stays the default, and you can switch back from the taskbar any time. Desktop view needs a screen at least 900 pixels wide." })),
        osPreview()),

      sec("lx-ai",
        h("i", { class: "lx-aurora a3" }),
        h("div", { class: "lx-ai-text" },
          h("div", { class: "lx-ai-badges" }, h("span", { class: "lx-beta big", text: "BETA" }), h("span", { class: "lx-kick", text: "AI companion" })),
          h("h2", { text: "Say Hey AI. Get answers you can read at a glance." }),
          h("p", { class: "lp-sub", text: "Ask whether a game is worth buying, how two games compare, what to play with the hours you have, or how to set something up. It answers with real pictures and buttons, from your own data, and it can do things for you like adding to your wishlist or setting a price alert." }),
          h("div", { class: "lp-cta" }, h("a", { class: "btn blue big", href: "/ai", text: "See what it can do" }), invite && ext(invite, "Add it to a server", "btn gray big")),
          h("p", { class: "muted small", text: "It's in beta. It can be wrong, so check a price before you buy." })),
        h("div", { class: "lx-ai-shots", "aria-hidden": "true" }, ...aiShots)),

      sec("lx-indie",
        h("div", { class: "lx-indie-text" },
          h("span", { class: "lx-kick", text: "Indie corner" }),
          h("h2", { text: "A home for indie games on Steam" }),
          h("p", { class: "lp-sub", text: "Find games from small studios, or put your own in front of people. It's free, and developers get a set of Steam tools for fees, wishlists, capsules and launch planning." }),
          h("div", { class: "lp-cta" }, h("a", { class: "btn blue big", href: "/indie", text: "Browse indie games" }), h("a", { class: "btn gray big", href: "/indie/tools", text: "Developer tools" }))),
        indieShots),

      sec("",
        head("Fresh from the workshop", "What's new", "Everything added in the last few days."),
        h("div", { class: "lx-new-grid" }, ...shipped.map(([tag, t, d]) => h("div", { class: "lx-newcard" }, h("b", { class: "lx-tag" + (tag === "AI" ? " ai" : ""), text: tag }), h("h3", { text: t }), h("p", { text: d })))),
        h("p", { class: "lx-more" }, h("a", { href: "#/changelog", text: "See the full changelog →" }))),

      sec("",
        head("Everything in one bot", "Pick an area", "Six areas, one bot, one dashboard."),
        tabsHost, gridHost),

      sec("",
        head("Getting started", "Three steps", null),
        h("div", { class: "lp-grid three" },
          step("1", "Add the bot", "Invite it to your server. Alerts only need it to read and send messages. The community tools need channel and role permissions too, and the invite screen lists them."),
          step("2", "Add your games", "Sign in with Steam to bring in your library and wishlist, upload a FanaticalGrabber export, or just type game names."),
          step("3", "Choose your alerts", "Alerts come by DM or in a server channel, whichever you like. If you manage a server you can switch on the AI, guides, levels and giveaways too."))),

      sec("lp-split",
        h("div", {},
          h("h2", { text: "Giveaways that stay safe" }),
          h("p", { class: "lp-sub", text: "Prize keys are encrypted the moment they're saved, and only the winner ever sees one. Once the winner says it worked, the key is wiped and a vouch goes up." }),
          h("ul", { class: "lp-list" },
            h("li", { text: "Several prizes in one giveaway" }),
            h("li", { text: "The winner presses Claim prize. If their DMs are closed, the key is shown privately in the channel" }),
            h("li", { text: "Unclaimed prizes are redrawn, and unused keys go back to the host" }),
            h("li", { text: "Custom art, GIFs or video, role requirements and bonus entries" }))),
        h("div", { class: "lp-flow" },
          ...[["", "Giveaway ends", "Winners are drawn and announced"], ["", "Claim prize", "The key is sent by DM"], ["", "Confirm it worked", "The winner presses one button"], ["", "Vouch posted", "In your vouches channel"]]
            .map(([i, t, s]) => h("div", { class: "lp-flow-step" }, h("span", { class: "lp-flow-icon", text: i }), h("div", {}, h("b", { text: t }), h("div", { class: "muted small", text: s })))))),

      fanaticalCard(),

      h("section", { class: "lx-sec lp-trust" },
        head("Your data", "Yours, and you can leave", null),
        h("div", { class: "lp-grid three" },
          h("div", { class: "lp-feature" }, h("h3", { text: "No passwords" }), h("p", { text: "The bot never asks for a Steam, Fanatical or store password, and it ignores anything in chat that looks like a key." })),
          h("div", { class: "lp-feature" }, h("h3", { text: "Limited sharing" }), h("p", { text: "Game titles go to IsThereAnyDeal so it can look up prices. That's the only thing that leaves the bot." })),
          h("div", { class: "lp-feature" }, h("h3", { text: "Export or delete" }), h("p", { text: "Run /me mydata or use the dashboard to download or wipe everything stored about you, including what the AI remembers." })))),

      h("section", { class: "lp-final lx-final" },
        h("i", { class: "lx-aurora a1" }),
        h("h2", { text: "Add it to your server" }),
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
        steamArt(d.appid, "fy-art", 460, 215, d.id),
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
            chip("All-time low", st.atl, set("atl", !st.atl)), chip("Strong match 80+", st.great, set("great", !st.great)), chip("On wishlist", st.wish, set("wish", !st.wish))),
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
      fanaticalCard(), voteCard(),
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

    // After one import the bot keeps the list current by itself, until this is switched off.
    const syncBox = h("input", { type: "checkbox", id: "wish-sync" }), syncRow = h("label", { class: "check", for: "wish-sync", hidden: true }, syncBox, " Keep it in sync with Steam automatically (new games are added and ones you removed on Steam are dropped, about twice a day)");
    syncBox.addEventListener("change", () => api("/api/wishlist/sync", { on: syncBox.checked }).then(() => toast(syncBox.checked ? "I'll keep it in sync." : "Automatic sync is off.", "ok")).catch(e => { syncBox.checked = !syncBox.checked; toast(e.message, "warn"); }));
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

    // ----- the list: filter toolbar and cards, laid out like the For you page -----
    const W = { sort: "sale", sale: false, prio: false, hideOwned: false, q: "", page: 0 };
    const PER = 24; let data = null; const picked = new Set();
    // Saved views live in this browser only: a name and the sort and filter chips. Storage can be blocked, so every read and write is guarded.
    const VIEWS_KEY = "svc.wishviews";
    const readViews = () => { try { const v = JSON.parse(localStorage.getItem(VIEWS_KEY) || "[]"); return Array.isArray(v) ? v.filter(x => x && typeof x.name === "string").slice(0, 12) : []; } catch { return []; } };
    const writeViews = v => { try { localStorage.setItem(VIEWS_KEY, JSON.stringify(v.slice(0, 12))); return true; } catch { return false; } };
    const chip = (label, on, fn) => { const b = h("button", { class: "chip-btn" + (on ? " on" : ""), type: "button", text: label, "aria-pressed": String(on) }); b.addEventListener("click", fn); return b; };
    const sorters = { sale: null, cut: (a, b) => b.discount - a.discount, price: (a, b) => (a.best?.price ?? Infinity) - (b.best?.price ?? Infinity), name: (a, b) => a.title.localeCompare(b.title) };
    const listBox = h("div"), drawers = h("div");
    const drawer = (title, ...kids) => h("div", { class: "wl-drawer panel", hidden: true }, h("h3", { text: title }), h("div", { class: "wl-drawer-body" }, ...kids));
    const importDrawer = drawer("Import from Steam",
      linked ? h("p", { class: "muted small", text: "Uses the Steam account you signed in with. Your wishlist must be public (Steam Profile > Edit Profile > Privacy Settings > Game details). Run it again to sync." })
        : h("p", { class: "muted small", text: "Sign in through Steam once and the bot knows your account everywhere. No links to paste." }),
      h("div", { class: "row" }, linked ? importBtn : steamLoginBtn()),
      syncRow,
      linked ? null : h("details", { class: "paste" }, h("summary", { text: "Use a profile link instead" }), field("Profile", profile), importBtn));
    const addDrawer = drawer("Add a game", field("Title", title), h("div", { class: "row" }, field("Alert me on", addType), addValueField),
      h("label", { class: "check" }, watchOnly, "Just watch it once: remove it after the alert, or after 30 days"), h("div", { class: "row" }, addBtn));

    function draw() {
      const cur = data.currency, rows = data.rows;
      const q = W.q.trim().toLowerCase();
      let list = rows.filter(r => (!W.sale || r.discount > 0) && (!W.prio || r.priority) && (!W.hideOwned || !r.owned) && (!q || r.title.toLowerCase().includes(q)));
      if (sorters[W.sort]) list = [...list].sort(sorters[W.sort]);
      const pages = Math.max(1, Math.ceil(list.length / PER));
      W.page = Math.min(W.page, pages - 1);
      const sort = select([["sale", "Sales first"], ["cut", "Biggest discount"], ["price", "Lowest price"], ["name", "Name (A-Z)"]], W.sort);
      sort.addEventListener("change", () => { W.sort = sort.value; W.page = 0; draw(); });
      const search = h("input", { type: "search", class: "wl-search", placeholder: "Search your wishlist", value: W.q, "aria-label": "Search your wishlist", maxlength: "60" });
      search.addEventListener("input", () => { W.q = search.value; W.page = 0; const pos = search.selectionStart; draw(); const s2 = listBox.parentElement.querySelector(".wl-search"); if (s2) { s2.focus(); s2.setSelectionRange(pos, pos); } });
      const set = (k, v) => () => { W[k] = v; W.page = 0; draw(); };
      const views = readViews();
      const viewSel = select([["", views.length ? "Saved views" : "No saved views"], ...views.map((v, i) => [String(i), v.name])], "");
      viewSel.setAttribute("aria-label", "Saved views");
      viewSel.addEventListener("change", () => { const v = views[Number(viewSel.value)]; if (!v) return; Object.assign(W, { sort: sorters[v.sort] !== undefined ? v.sort : "sale", sale: Boolean(v.sale), prio: Boolean(v.prio), hideOwned: Boolean(v.hideOwned), q: String(v.q ?? ""), page: 0 }); draw(); });
      const viewName = h("input", { type: "text", placeholder: "Name this view", maxlength: "24", "aria-label": "Name for this view" });
      const saveView = h("button", { class: "btn gray small", type: "button", text: "Save view" });
      saveView.addEventListener("click", () => {
        const name = viewName.value.trim().slice(0, 24);
        if (!name) return toast("Give the view a name first.", "error");
        const next = [...views.filter(v => v.name.toLowerCase() !== name.toLowerCase()), { name, sort: W.sort, sale: W.sale, prio: W.prio, hideOwned: W.hideOwned, q: W.q }];
        if (!writeViews(next)) return toast("This browser wouldn't keep it. Saved views need site storage to be allowed.", "error");
        toast(`Saved "${name}".`, "ok"); draw();
      });
      const delView = h("button", { class: "btn gray small", type: "button", text: "Delete view" });
      delView.addEventListener("click", () => { const v = views[Number(viewSel.value)]; if (!v) return toast("Pick a saved view to delete.", "error"); writeViews(views.filter(x => x !== v)); draw(); });
      const onSale = rows.filter(r => r.discount > 0 && !r.owned).length, ownedN = rows.filter(r => r.owned).length;

      const allRule = h("div", { class: "rule inline" }, ...ruleControl({ type: "any" }, async (type, value) => {
        const r = await api("/api/wishlist/alert", { type, value });
        toast(`${r.updated} games will now alert on: ${r.label}.`, "ok"); loadList();
      }, "Apply to all"));
      const count = h("span", { class: "muted small", text: picked.size + " selected" });
      const bulkRule = h("div", { class: "rule inline" }, ...ruleControl({ type: "any" }, async (type, value) => {
        if (!picked.size) throw new Error("Select at least one game first.");
        const r = await api("/api/wishlist/bulk", { action: "alert", itad_ids: [...picked], type, value });
        toast(`${r.updated} games will alert on: ${r.label}.`, "ok"); loadList();
      }, "Apply to selected"));
      const removeSel = h("button", { class: "btn red small", type: "button", text: "Remove selected" });
      removeSel.addEventListener("click", () => busy(removeSel, async () => {
        if (!picked.size) throw new Error("Select at least one game first.");
        const r = await api("/api/wishlist/bulk", { action: "remove", itad_ids: [...picked] });
        state.me.games -= r.removed; picked.clear(); toast(`Removed ${r.removed} games.`, "ok"); loadList();
      }));
      const selectAll = h("input", { type: "checkbox", "aria-label": "Select every game shown" });
      selectAll.checked = list.length > 0 && list.every(r => picked.has(r.itad_id));
      selectAll.addEventListener("change", () => { for (const r of list) { if (selectAll.checked) picked.add(r.itad_id); else picked.delete(r.itad_id); } draw(); });
      const cleanBtn = h("button", { class: "btn gray small", type: "button", text: "Remove them" });
      cleanBtn.addEventListener("click", () => busy(cleanBtn, async () => { const c = await api("/api/wishlist/cleanup", {}); state.me.games -= c.removed; toast(`Removed ${c.removed} owned game${c.removed === 1 ? "" : "s"}.`, "ok"); loadList(); }));

      const prev = h("button", { class: "pg-btn wide", type: "button", text: "‹ Prev", onclick: () => { W.page--; draw(); listBox.scrollIntoView({ block: "start" }); } }); prev.disabled = W.page === 0;
      const next = h("button", { class: "pg-btn wide", type: "button", text: "Next ›", onclick: () => { W.page++; draw(); listBox.scrollIntoView({ block: "start" }); } }); next.disabled = W.page >= pages - 1;
      listBox.replaceChildren(
        ownedN ? h("div", { class: "notice" }, `${ownedN} game${ownedN === 1 ? " is" : "s are"} already in your library. `, cleanBtn) : null,
        h("div", { class: "panel fy-filters" },
          h("div", { class: "fy-row" }, h("span", { class: "fy-lab", text: "Sort" }), sort, search),
          h("div", { class: "fy-row" }, h("span", { class: "fy-lab", text: "Show" }), chip("On sale now", W.sale, set("sale", !W.sale)), chip("Priority", W.prio, set("prio", !W.prio)), chip("Hide owned", W.hideOwned, set("hideOwned", !W.hideOwned))),
          h("div", { class: "fy-row" }, h("span", { class: "fy-lab", text: "Views" }), viewSel, viewName, saveView, views.length ? delView : null)),
        h("p", { class: "muted small", text: `${list.length} of ${rows.length} game${rows.length === 1 ? "" : "s"} · ${onSale} on sale right now` }),
        list.length ? h("div", { class: "fy-grid wl-grid" }, ...list.slice(W.page * PER, (W.page + 1) * PER).map(r => wishCard(r, cur, loadList, (id, on) => { if (on) picked.add(id); else picked.delete(id); count.textContent = picked.size + " selected"; }, picked.has(r.itad_id)))) : h("div", { class: "empty", text: "No games match those filters." }),
        pages > 1 ? h("div", { class: "lib-pager" }, h("div", { class: "pg-nav" }, prev, h("span", { class: "muted small", text: `Page ${W.page + 1} of ${pages}` }), next)) : null,
        h("details", { class: "wl-drawer panel" }, h("summary", { text: "Alert rules and bulk edit" }),
          h("div", { class: "wl-drawer-body" }, h("h4", { text: "One rule for every game" }), allRule,
            h("h4", { text: "Several games at once" }), h("div", { class: "rule inline" }, h("label", { class: "check" }, selectAll, "Select all shown"), count, bulkRule, removeSel))));
    }
    async function loadList() {
      try {
        data = await api("/api/wishlist");
        syncRow.hidden = !data.sync?.available; syncBox.checked = Boolean(data.sync?.on);
        if (!data.rows.length) { listBox.replaceChildren(h("div", { class: "empty", text: "Your wishlist is empty. Import your Steam wishlist or add a game above." })); return; }
        draw();
      } catch (e) { listBox.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }

    app.replaceChildren(
      pageHead("Wishlist", "Sales first. You are alerted according to each game's rule."),
      h("div", { class: "wl-actions" }, h("button", { class: "chip-btn", type: "button", text: "＋ Add a game", onclick: () => { addDrawer.hidden = !addDrawer.hidden; importDrawer.hidden = true; if (!addDrawer.hidden) title.focus(); } }), h("button", { class: "chip-btn", type: "button", text: "⬇ Import from Steam", onclick: () => { importDrawer.hidden = !importDrawer.hidden; addDrawer.hidden = true; } })),
      importDrawer, addDrawer,
      listBox);
    listBox.className = "muted"; listBox.textContent = "Loading prices…";
    loadList().then(() => { listBox.className = ""; });
  }

  function wishCard(r, cur, reload, onPick, isPicked) {
    const sale = r.discount > 0, pct = Math.round(r.discount * 100), best = r.best;
    const remove = h("button", { class: "btn red small", type: "button", text: "Remove" });
    remove.addEventListener("click", () => busy(remove, async () => { await api("/api/wishlist/remove", { itad_id: r.itad_id }); state.me.games--; reload(); }));
    // One control for this game's alerts: on, snoozed for a while, or muted until switched back on.
    const quiet = r.snoozed_until && r.snoozed_until - Date.now() > 100 * 86400_000 ? "mute" : r.snoozed_until ? "snooze" : "on";
    const snooze = select([["on", quiet === "snooze" ? "Snoozed until " + new Date(r.snoozed_until).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " (change)" : "Alerts on"], ["7", "Snooze 7 days"], ["30", "Snooze 30 days"], ["mute", "Mute this game"], ["off", "Turn alerts back on"]], quiet);
    snooze.setAttribute("aria-label", "Alerts for " + r.title); snooze.className = "wl-quiet";
    if (quiet === "mute") snooze.title = "Muted: no alerts of any kind for this game";
    snooze.addEventListener("change", () => {
      const v = snooze.value; if (v === "on") return;
      busy(snooze, async () => {
        await api("/api/wishlist/snooze", v === "mute" ? { itad_id: r.itad_id, muted: true } : v === "off" ? { itad_id: r.itad_id, days: 0 } : { itad_id: r.itad_id, days: Number(v) });
        toast(v === "mute" ? "Muted. No alerts for " + r.title + " until you turn them back on." : v === "off" ? "Alerts are back on." : "Snoozed for " + v + " days.", "ok");
        reload();
      });
    });
    const chartHolder = h("div", { class: "wl-chart" });
    const hist = h("button", { class: "btn gray small", type: "button", text: "Price history" });
    hist.addEventListener("click", () => {
      if (chartHolder.firstChild) { chartHolder.replaceChildren(); return; }
      busy(hist, async () => {
        const d = await api("/api/wishlist/history?itad_id=" + encodeURIComponent(r.itad_id));
        if (!d.points.length) { chartHolder.replaceChildren(h("p", { class: "muted small", text: "No price history yet." })); return; }
        chartHolder.replaceChildren(d.advice ? h("div", { class: "notice " + (d.advice.verdict === "buy" || d.advice.verdict === "lean_buy" ? "" : "warn") }, h("b", { text: "Buy now or wait? " + d.advice.label + ". " }), d.advice.reasons.join(" ")) : null,
          h("p", { class: "muted small", text: "Lowest store price over the last year, " + r.title }),
          lineChart([{ name: "Price", cls: "s0", points: d.points.map(p => ({ x: p.t, y: p.price })) }], { format: v => money(v, cur), label: "Price history for " + r.title }));
      });
    });
    const star = h("button", { class: "btn gray small", type: "button", text: r.priority ? "★ Priority" : "☆ Priority", title: "Priority games are listed first and alert even in quiet hours", "aria-pressed": String(Boolean(r.priority)) });
    star.addEventListener("click", () => busy(star, async () => { await api("/api/wishlist/priority", { itad_id: r.itad_id, starred: !r.priority }); reload(); }));
    const pick = h("input", { type: "checkbox", class: "pick", "aria-label": "Select " + r.title }); pick.checked = Boolean(isPicked);
    pick.addEventListener("change", () => onPick && onPick(r.itad_id, pick.checked));
    const more = h("div", { class: "wl-more", hidden: true },
      h("div", { class: "rule" }, ...ruleControl({ type: r.trigger_type, value: r.trigger_value }, async (type, value) => {
        await api("/api/wishlist/alert", { itad_id: r.itad_id, type, value }); toast("Rule saved.", "ok"); reload();
      })),
      h("div", { class: "wl-btns" }, star, snooze, hist, remove), chartHolder);
    const toggle = h("button", { class: "wl-toggle", type: "button", "aria-expanded": "false", "aria-label": "Alert rule and actions for " + r.title, text: "⋯" });
    const card = h("div", { class: "wl-card" + (sale && !r.owned ? " sale" : "") });
    toggle.addEventListener("click", () => { const open = more.hidden; more.hidden = !open; card.classList.toggle("open", open); toggle.setAttribute("aria-expanded", String(open)); });
    card.append(
      h("div", { class: "wl-main" },
        h("label", { class: "wl-pick" }, pick),
        steamArt(r.appid, "fy-art", 460, 215, r.itad_id),
        h("div", { class: "fy-info" },
          h("a", { href: "#/g/" + r.itad_id, class: "fy-title game-link", text: r.title }),
          h("span", { class: "muted small", text: [best?.shop, r.alert].filter(Boolean).join(" · ") }),
          h("span", { class: "wl-tags" }, verdictBadge(r.verdict), r.owned ? h("span", { class: "badge none", text: "Owned" }) : null, r.priority ? h("span", { class: "badge none", text: "★ Priority" }) : null, r.release_at ? h("span", { class: "badge none", text: "Out " + new Date(r.release_at).toLocaleDateString() }) : null)),
        h("div", { class: "fy-price" }, sale ? h("span", { class: "fy-cut", text: "-" + pct + "%" }) : null, h("b", { class: sale ? "" : "wl-flat", text: best ? money(best.price, cur) : "no price" }), sale && r.regular !== null ? h("s", { text: money(r.regular, cur) }) : null),
        toggle),
      more);
    return card;
  }

  // ---------- alerts ----------
  /** One switch per kind of alert: off means it is not sent to Discord, but you can still read it on the Notifications page. */
  function muteToggles() {
    const s = state.me.settings, muted = new Set(s.muted || []);
    const toggles = Object.entries(TYPE_LABEL).map(([id, text]) => {
      const box = h("input", { type: "checkbox", checked: !muted.has(id) });
      box.addEventListener("change", async () => {
        box.checked ? muted.delete(id) : muted.add(id);
        try { const r = await api("/api/settings", { muted: [...muted] }); state.me.settings = r.settings; toast("Saved.", "ok"); } catch (e) { toast(e.message, "error"); box.checked = !box.checked; }
      });
      return h("label", { class: "check" }, box, " ", `Send ${text} to Discord`);
    });
    return h("div", { class: "panel" }, h("h3", { text: "What gets sent to Discord" }), h("p", { class: "muted small", text: "Switch a kind off and it stops arriving by DM or in your channel. It still shows up on the Notifications page." }), ...toggles);
  }

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
        max_price: Number(maxPrice.value || 0), lows_only: lowsOnly.checked, bundles: bundles.checked, share: share.checked, free: free.checked, free_dlc: freeDlc.checked, dlc: dlcOn.checked, refund: refundOn.checked, milestones: milesOn.checked, yearly: yearOn.checked, nudge: nudgeOn.checked, nowplaying: nowOn.checked, achv: achvOn.checked, playtest: Number(playSel.value), news: Number(newsMode.value), min_discount: Number(minDisc.value || 0)
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
        field("Playtests, demos and betas (Steam, Alpha Beta Gamer, GamerPower and itch.io)", playSel),
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

  /** Buttons that send one sample alert of each kind to the member's own DMs. */
  function samplePanel() {
    const KINDS = [["sale", "Sale"], ["free", "Free game"], ["bundle", "Bundle"], ["sub", "Subscription"], ["news", "Patch notes"], ["release", "Release day"]];
    return h("div", { class: "panel" }, h("h3", { text: "See how alerts look" }),
      h("p", { class: "muted small", text: "Send yourself a sample of any alert by Discord DM. It is marked as a sample and isn't a real deal." }),
      h("div", { class: "row chips" }, ...KINDS.map(([kind, label]) => {
        const b = h("button", { type: "button", class: "btn gray small", text: label });
        b.addEventListener("click", () => busy(b, async () => { await api("/api/alerts/test", { kind }); toast("Sample sent. Check your DMs.", "ok"); }));
        return b;
      })));
  }

  function publicPagePanel() {
    const panel = h("div", { class: "panel" }, h("h3", { text: "Public wishlist page" }), h("p", { class: "muted", text: "Loading…" }));
    api("/api/profile").then(p => {
      const on = h("input", { type: "checkbox", checked: p.public });
      const slug = h("input", { type: "text", value: p.slug || "", placeholder: "your-name", maxlength: "24" });
      const link = h("div", { class: "muted small" });
      const showLink = s => { link.replaceChildren(...(s && on.checked ? [h("a", { href: "#/u/" + s, text: location.origin + "/u/" + s })] : [])); };
      const save = h("button", { class: "btn blue", text: "Save", onclick: () => busy(save, async () => {
        const r = await api("/api/profile", { enabled: on.checked, slug: slug.value });
        slug.value = r.slug || ""; showLink(r.slug); toast(r.public ? "Your page is on." : "Your page is off.", "ok");
      }) });
      showLink(p.slug);
      panel.replaceChildren(h("h3", { text: "Public wishlist page" }),
        h("p", { class: "muted", text: "Share a link to your wishlist and its best prices, handy for gifts. It shows only game names, art and prices. Never your Discord account or anything else." }),
        h("label", { class: "check" }, on, "Turn my page on"), field("Page name", slug), link,
        h("p", { class: "muted small", text: "Signed-in Discord members can mark a game as “I’m gifting this” so nobody doubles up. You are never told who, so the surprise stays. Marks run out after three weeks unless renewed, and each person can hold only a few." + (p.claims ? ` ${p.claims} ${p.claims === 1 ? "is" : "are"} marked right now.` : "") }),
        h("label", { class: "check" }, (() => { const c = h("input", { type: "checkbox", checked: !p.giftsPaused }); c.addEventListener("change", () => api("/api/profile/gifts", { action: "pause", on: !c.checked }).then(() => toast(c.checked ? "Gift marks are on." : "Gift marks are paused. Existing ones stay until you clear them.", "ok")).catch(e => { toast(e.message, "error"); c.checked = !c.checked; })); return c; })(), "Let visitors mark gifts"),
        h("p", { class: "muted small", text: "If a mark looks fake, open your public page: you can release any mark there, and report it so abusive accounts get blocked." }),
        h("button", { class: "btn gray small", text: "Copy my page link", onclick: async () => { if (!slug.value || !on.checked) return toast("Turn your page on and save it first.", "warn"); try { await navigator.clipboard.writeText(location.origin + "/u/" + slug.value); toast("Copied. In Discord, `/me publicpage share:true` posts it for everyone.", "ok"); } catch { toast("Select the link above and copy it by hand.", "warn"); } } }),
        p.claims ? h("button", { class: "btn gray small", text: "Clear gift marks", onclick: ev => busy(ev.currentTarget, async () => { const r = await api("/api/profile", { enabled: on.checked, slug: slug.value, resetClaims: true }); toast(`Cleared ${r.cleared}.`, "ok"); }) }) : "", h("p"), save);
    }).catch(e => panel.replaceChildren(h("h3", { text: "Public wishlist page" }), h("div", { class: "notice warn", text: e.message })));
    return panel;
  }

  // ---------- full profiles ----------
  const PF_VIS = { public: "Public", server: "Server only", hidden: "Hidden" };
  const PF_TITLE = { about: "About me", favorites: "Favorite games", nowplaying: "Playing now", wishlist: "Wishlist", recent: "Recently finished", posts: "Latest posts", trophies: "Trophies", achievements: "Rarest achievements", activity: "Recent activity", steam: "Steam stats", value: "Library value", streams: "Streaming", guestbook: "Guestbook" };
  const httpsOnly = u => (/^https:\/\//i.test(u || "") ? u : "");

  /** The profile song: a play button that loads the official player when pressed (browsers block sound that starts alone). */
  function pfSong(song, preview = false) {
    const box = h("div", { class: "pf-song" });
    const name = song.title || ({ youtube: "YouTube", soundcloud: "SoundCloud", spotify: "Spotify", radio: "Live radio" })[song.provider] || "Song";
    // A live radio stream gets the same card as the OBS overlay: art tile, pulsing label, big title and a glowing live strip.
    const radioCard = auto => {
      const a = h("audio", { src: song.stream, preload: "none", referrerpolicy: "no-referrer" });
      const btn = h("button", { type: "button", class: "pf-rplay", "aria-label": "Pause" });
      const art = h("div", { class: "pf-rart" }, h("span", { class: "pf-rglyph", text: "📻" }), btn);
      const eq = h("span", { class: "pf-eq", "aria-hidden": "true" }, h("i"), h("i"), h("i"));
      const label = h("div", { class: "pf-rlabel" }, eq, h("span", { text: "Live radio" }));
      const vol = h("input", { type: "range", min: "0", max: "100", value: "80", class: "pf-rvol", "aria-label": "Volume" });
      vol.addEventListener("input", () => { a.volume = Number(vol.value) / 100; });
      a.volume = 0.8;
      const card = h("div", { class: "pf-rcard" }, art, h("div", { class: "pf-rbody" }, label, h("div", { class: "pf-rtitle", text: name }), h("div", { class: "pf-rsub muted small", text: "Profile song" }),
        h("div", { class: "pf-rrow" }, h("span", { class: "pf-rvolicon", "aria-hidden": "true", text: "🔈" }), vol, song.link ? ext(song.link, "Open", "pf-open") : null)), h("div", { class: "pf-rprog", "aria-hidden": "true" }, h("i")));
      // On a real profile the player floats in the corner so it never sits in the middle of the page; the dash arrow folds it down to just the play tile.
      if (!preview) {
        const fold = h("button", { type: "button", class: "pf-rfold", "aria-label": "Minimise the player", text: "–" });
        fold.addEventListener("click", () => { const mini = card.classList.toggle("mini"); fold.textContent = mini ? "+" : "–"; fold.setAttribute("aria-label", mini ? "Open the player" : "Minimise the player"); });
        card.append(fold);
      }
      const paint = on => { card.classList.toggle("playing", on); btn.textContent = on ? "❚❚" : "▶"; btn.setAttribute("aria-label", on ? "Pause" : "Play"); label.lastChild.textContent = "Live radio"; };
      btn.addEventListener("click", () => { if (a.paused) { a.src = song.stream; a.play().catch(() => {}); } else { a.pause(); } });
      a.addEventListener("playing", () => paint(true));
      a.addEventListener("pause", () => paint(false));
      a.addEventListener("error", () => { card.classList.remove("playing"); label.lastChild.textContent = "Not available"; card.querySelector(".pf-rsub").textContent = "This stream is not available right now."; btn.textContent = "▶"; });
      paint(auto);
      box.classList.add("pf-song-radio");
      box.classList.toggle("pf-float", !preview);
      box.replaceChildren(card);
      if (auto) a.play().catch(() => paint(false));
      box.stopAudio = () => { a.pause(); a.removeAttribute("src"); a.load(); };
    };
    // SoundCloud: its own player is a fixed light box, so the real player is hidden and driven through the widget's messages
    // while our card (same look as the radio one) shows the artwork, title, a seekable bar and the controls. If the widget never answers, the plain player shows instead, darkened.
    const soundCloudCard = auto => {
      const ORIGIN = "https://w.soundcloud.com";
      const frame = h("iframe", { src: auto ? song.embed : song.embed.replace("auto_play=true", "auto_play=false"), title: "Profile song: " + name, allow: "autoplay; encrypted-media", referrerpolicy: "strict-origin-when-cross-origin", class: "pf-sc-hidden", tabindex: "-1", "aria-hidden": "true" });
      const post = (method, value) => { try { frame.contentWindow?.postMessage(JSON.stringify({ method, value }), ORIGIN); } catch { /* not ready */ } };
      const btn = h("button", { type: "button", class: "pf-rplay", "aria-label": "Play", text: "▶" });
      const glyph = h("span", { class: "pf-rglyph", text: "☁" });
      const art = h("div", { class: "pf-rart" }, glyph, btn);
      const eq = h("span", { class: "pf-eq", "aria-hidden": "true" }, h("i"), h("i"), h("i"));
      const label = h("div", { class: "pf-rlabel" }, eq, h("span", { text: "SoundCloud" }));
      const title = h("div", { class: "pf-rtitle", text: name });
      const sub = h("div", { class: "pf-rsub muted small", text: "Profile song" });
      const bar = h("div", { class: "pf-sc-bar", role: "slider", tabindex: "0", "aria-label": "Seek", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0" }, h("i"));
      const tNow = h("span", { class: "pf-sc-time", text: "0:00" }), tEnd = h("span", { class: "pf-sc-time", text: "" });
      const vol = h("input", { type: "range", min: "0", max: "100", value: "80", class: "pf-rvol", "aria-label": "Volume" });
      vol.addEventListener("input", () => post("setVolume", Number(vol.value)));
      const card = h("div", { class: "pf-rcard pf-sc" }, art, h("div", { class: "pf-rbody" }, label, title, sub,
        h("div", { class: "pf-sc-row" }, tNow, bar, tEnd),
        h("div", { class: "pf-rrow" }, h("span", { class: "pf-rvolicon", "aria-hidden": "true", text: "🔈" }), vol, song.link ? ext(song.link, "Open", "pf-open") : null)), h("div", { class: "pf-rprog", "aria-hidden": "true" }, h("i")));
      let playing = false, duration = 0, ready = false;
      const fmt = ms => { const t = Math.max(0, Math.round(ms / 1000)); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };
      const paint = on => { playing = on; card.classList.toggle("playing", on); btn.textContent = on ? "❚❚" : "▶"; btn.setAttribute("aria-label", on ? "Pause" : "Play"); };
      const seekTo = frac => { if (duration) post("seekTo", Math.round(frac * duration)); };
      bar.addEventListener("click", e => { const r = bar.getBoundingClientRect(); seekTo(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))); });
      bar.addEventListener("keydown", e => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); post("getPosition"); const d = e.key === "ArrowRight" ? 5000 : -5000; bar._want = d; } });
      btn.addEventListener("click", () => post(playing ? "pause" : "play"));
      const onMessage = e => {
        if (e.origin !== ORIGIN || e.source !== frame.contentWindow) return;
        let m; try { m = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; }
        if (!m || typeof m !== "object") return;
        switch (m.method) {
          case "ready":
            ready = true; clearTimeout(giveUp);
            for (const ev of ["play", "pause", "finish", "playProgress"]) post("addEventListener", ev);
            post("getCurrentSound"); post("getDuration"); post("setVolume", Number(vol.value));
            break;
          case "getCurrentSound": {
            const v = m.value || {};
            if (v.title && !song.title) title.textContent = v.title;
            if (v.user?.username) sub.textContent = v.user.username;
            const artUrl = v.artwork_url || v.user?.avatar_url || "";
            if (/^https:\/\/[\w.-]*(sndcdn|soundcloud)\.com\//.test(artUrl)) { const img = h("img", { src: artUrl.replace("-large", "-t300x300"), alt: "", referrerpolicy: "no-referrer" }); img.addEventListener("error", () => img.remove()); glyph.replaceWith(img); }
            break; }
          case "getDuration": duration = Number(m.value) || duration; tEnd.textContent = duration ? fmt(duration) : ""; break;
          case "getPosition": if (bar._want) { const d = bar._want; bar._want = 0; post("seekTo", Math.max(0, Math.min(duration || 1e12, Number(m.value || 0) + d))); } break;
          case "play": paint(true); break;
          case "pause": case "finish": paint(false); break;
          case "playProgress": {
            const pv = m.value && typeof m.value === "object" ? m.value : m; // SoundCloud nests the numbers under value
            const rel = Number(pv.relativePosition) || 0, cur = Number(pv.currentPosition) || 0;
            card.style.setProperty("--p", Math.round(rel * 1000) / 10 + "%"); bar.setAttribute("aria-valuenow", String(Math.round(rel * 100)));
            tNow.textContent = fmt(cur); if (!duration && rel > 0) { duration = cur / rel; tEnd.textContent = fmt(duration); }
            break; }
        }
      };
      box._scCleanup?.();
      window.addEventListener("message", onMessage);
      box._scCleanup = () => { clearTimeout(giveUp); window.removeEventListener("message", onMessage); };
      frame.addEventListener("load", () => post("addEventListener", "ready"));
      // Blocked or slow: fall back to SoundCloud's own player, darkened to fit.
      const giveUp = setTimeout(() => {
        if (ready) return;
        window.removeEventListener("message", onMessage);
        box.classList.remove("pf-song-radio", "pf-float");
        frame.className = "pf-frame soundcloud"; frame.removeAttribute("aria-hidden"); frame.removeAttribute("tabindex");
        box.replaceChildren(frame);
      }, 7000);
      paint(auto);
      box.classList.add("pf-song-radio"); box.classList.toggle("pf-float", !preview);
      if (!preview) {
        const fold = h("button", { type: "button", class: "pf-rfold", "aria-label": "Minimise the player", text: "–" });
        fold.addEventListener("click", () => { const mini = card.classList.toggle("mini"); fold.textContent = mini ? "+" : "–"; fold.setAttribute("aria-label", mini ? "Open the player" : "Minimise the player"); });
        card.append(fold);
      }
      box.replaceChildren(card, frame);
      box.stopAudio = () => { clearTimeout(giveUp); window.removeEventListener("message", onMessage); post("pause"); frame.remove(); };
    };
    const draw = playing => {
      if (song.stream) { radioCard(playing); return; }
      if (song.provider === "soundcloud") { soundCloudCard(playing); return; }
      if (!playing) {
        box.classList.remove("pf-song-radio", "pf-float");
        const b = h("button", { type: "button", class: "pf-play", "aria-label": "Play profile song", text: "▶" });
        b.addEventListener("click", () => draw(true));
        box.replaceChildren(b, h("div", { class: "pf-song-info" }, h("strong", { text: name }), h("span", { class: "muted small", text: song.provider === "radio" ? "Live radio" : "Profile song" })),
          song.link ? ext(song.link, "Open", "pf-open") : null);
        return;
      }
      const f = h("iframe", { src: song.embed, title: "Profile song: " + name, allow: "autoplay; encrypted-media", referrerpolicy: "strict-origin-when-cross-origin", class: "pf-frame " + song.provider });
      const stop = h("button", { type: "button", class: "pf-play stop", "aria-label": "Stop the song", text: "■" });
      stop.addEventListener("click", () => draw(false));
      box.replaceChildren(stop, f);
    };
    draw(false);
    box.start = () => draw(true);
    return box;
  }

  /** A game picture that turns into the plain placeholder if the address does not load (unreleased games often have none yet). */
  function pfArt(src, title = "") {
    const none = () => h("div", { class: "free-noart pf-letter", text: String(title).trim().slice(0, 1).toUpperCase() || "🎮" });
    if (!src) return none();
    const img = h("img", { src, alt: "" }); // not lazy: browsers that save data swap lazy pictures for blank boxes
    img.addEventListener("error", () => img.replaceWith(none()));
    return img;
  }

  function pfTile(g) {
    const fallback = () => h("div", { class: "pf-noart", text: g.title.slice(0, 1).toUpperCase() });
    const img = g.art ? h("img", { src: g.art, alt: "", loading: "lazy" }) : null;
    if (img) img.addEventListener("error", () => img.replaceWith(fallback()));
    const t = h("div", { class: "pf-tile" }, img || fallback(), h("span", { text: g.title }));
    return t;
  }

  function pfReport(slug) {
    const wrap = h("span", { class: "pf-report" });
    const open = h("button", { type: "button", class: "pf-link", text: "Report" });
    open.addEventListener("click", () => {
      const reason = h("input", { type: "text", maxlength: "300", placeholder: "What is wrong with this profile?", "aria-label": "Reason" });
      const send = h("button", { type: "button", class: "btn gray small", text: "Send" });
      send.addEventListener("click", () => busy(send, async () => { await api("/api/public/profile/report", { slug, reason: reason.value }); wrap.replaceChildren(h("span", { class: "muted small", text: "Thanks. It will be looked at." })); }));
      wrap.replaceChildren(reason, send);
      reason.focus();
    });
    wrap.append(open);
    return wrap;
  }

  /** Draws one profile. Used for the public page and for the live preview in the editor. */
  // The picture behind a profile page. Presets are plain CSS; an upload or Steam background is an image from our own address.
  const PAGE_PRESET_CSS = {
    aurora: "radial-gradient(900px 600px at 18% 8%, rgba(59,130,246,.55), transparent 60%), radial-gradient(800px 600px at 88% 18%, rgba(34,211,160,.45), transparent 60%), #0a1020",
    nebula: "radial-gradient(900px 650px at 80% 10%, rgba(217,70,239,.5), transparent 60%), radial-gradient(800px 600px at 10% 40%, rgba(99,102,241,.55), transparent 60%), #0d0a1c",
    dusk: "radial-gradient(1000px 600px at 50% 0%, rgba(251,146,60,.5), transparent 65%), radial-gradient(900px 600px at 90% 60%, rgba(168,85,247,.4), transparent 60%), #150d1a",
    ember: "radial-gradient(900px 600px at 15% 0%, rgba(239,68,68,.5), transparent 62%), radial-gradient(800px 600px at 90% 30%, rgba(251,146,60,.35), transparent 60%), #140a0a",
    forest: "radial-gradient(900px 600px at 20% 10%, rgba(34,197,94,.42), transparent 62%), radial-gradient(800px 600px at 85% 40%, rgba(20,184,166,.32), transparent 60%), #08120e",
    ocean: "radial-gradient(1000px 650px at 70% 0%, rgba(14,165,233,.5), transparent 62%), radial-gradient(800px 600px at 10% 50%, rgba(45,212,191,.32), transparent 60%), #071420",
    carbon: "linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px) 0 0 / 32px 32px, linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px) 0 0 / 32px 32px, #0d0f14",
    paper: "radial-gradient(900px 600px at 20% 0%, rgba(255,255,255,.7), transparent 60%), #e4dfd2"
  };
  function pageBgEl(bg, { preview = false } = {}) {
    if (!bg || bg.kind === "none") return null;
    const el = h("div", { class: "pf-pagebg" + (preview ? " in-preview" : ""), "aria-hidden": "true" });
    if (bg.kind === "preset" && PAGE_PRESET_CSS[bg.preset]) el.style.background = PAGE_PRESET_CSS[bg.preset];
    else if (bg.kind === "image" && typeof bg.url === "string" && /^\/pbg\/\d+(\?v=\d+)?$/.test(bg.url)) { el.style.backgroundImage = `url("${bg.url}")`; el.classList.add("img"); el.style.setProperty("--dim", String((Number(bg.dim) || 0) / 100)); }
    else if (bg.kind === "video" && typeof bg.url === "string" && /^https:\/\//.test(bg.url)) {
      // Steam's animated background plays straight from Steam's own servers, muted and looping; nothing is stored here.
      const v = h("video", { src: bg.url, muted: true, loop: true, playsinline: true, autoplay: true, preload: "auto", "aria-hidden": "true", tabindex: "-1" });
      v.muted = true;
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) v.removeAttribute("autoplay"); else v.play?.().catch(() => {});
      el.append(v); el.classList.add("img", "vid"); el.style.setProperty("--dim", String((Number(bg.dim) || 0) / 100));
    }
    else return null;
    return el;
  }

  function renderProfile(p, { canMark = false, preview = false, signedIn = false, region = null, social = null } = {}) {
    const root = h("div", { class: "pf", "data-bg": p.theme.bgstyle, "data-layout": p.theme.layout, "data-light": p.theme.light ? "1" : "0", "data-style": p.theme.style || "classic" });
    root.style.setProperty("--pf-bg", p.theme.bg);
    root.style.setProperty("--pf-accent", p.theme.accent);
    root.style.setProperty("--pf-fg", p.theme.light ? "#1b1f2a" : "#eef1f8");
    const banner = h("div", { class: "pf-banner" + (p.banner.kind === "none" ? " none" : "") });
    if (p.banner.kind === "game" && httpsOnly(p.banner.art)) { banner.classList.add("art");
      // Steam's header is only 460 wide and looks soft stretched across the page. The hero is much larger; where a game has none, the header underneath shows instead.
      const hero = p.banner.art.replace(/\/art\/header\/(\d+)\.jpg$/, "/art/hero/$1.jpg").replace(/\/header\.jpg(\?.*)?$/, "/library_hero.jpg");
      banner.style.backgroundImage = hero !== p.banner.art ? `url("${hero}"), url("${p.banner.art}")` : `url("${p.banner.art}")`; }
    const avatar = httpsOnly(p.avatar) ? h("img", { class: "pf-avatar" + (p.supporter ? " sup" : ""), src: p.avatar, alt: "" }) : h("div", { class: "pf-avatar init" + (p.supporter ? " sup" : ""), text: (p.name || "?").slice(0, 1).toUpperCase() });
    const head = h("div", { class: "pf-head" }, avatar,
      h("div", { class: "pf-who" }, h("h1", { text: p.name }), h("div", { class: "muted small", text: "@" + p.slug }), p.supporter ? h("span", { class: "pf-badge", title: "Supports Steam Value Checker", text: "★ Supporter" }) : null, p.founder ? h("span", { class: "pf-badge founder", title: "One of the first 50 supporters", text: "✦ Founding supporter" }) : null),
      h("div", { class: "pf-actions" }, p.owner && !preview ? h("a", { class: "btn gray small", href: "#/profile", text: "Edit profile" }) : null, !p.owner && !preview ? pfReport(p.slug) : null));
    root.append(banner, head);
    if (social && !preview) root.append(pfSocial(p, social));
    const pageBg = pageBgEl(p.pagebg, { preview });
    if (pageBg && !preview) root.append(pageBg);
    let songBox = null;
    if (p.songOff && p.owner && !preview) root.append(h("div", { class: "notice warn", text: "Your song is saved, but profile songs are switched off on this bot right now, so visitors don't see the player. (Admin panel > Bot settings > Profile songs play.)" }));
    if (p.song) { songBox = pfSong(p.song, preview); root.append(songBox); }
    if (p.song && p.enter && !preview) {
      // The click on this screen is what lets the browser start the sound straight away.
      const gate = h("button", { type: "button", class: "pf-enter", "aria-label": "Enter " + p.name }, h("span", { class: "pf-enter-in" }, h("span", { class: "pf-enter-name", text: p.name }), h("span", { class: "pf-enter-hint", text: "Click to enter" })));
      gate.addEventListener("click", () => { gate.remove(); songBox.start(); });
      root.append(gate);
    }
    const body = h("div", { class: "pf-body" });
    for (const s of p.sections) {
      const title = h("h3", {}, PF_TITLE[s.key] || s.key, p.owner && s.vis !== "public" ? h("span", { class: "chip dim", text: PF_VIS[s.vis] }) : null);
      let inner = null;
      if (s.key === "about") {
        if (!p.bio && !p.links.length) { if (!p.owner) continue; inner = h("p", { class: "muted", text: "Add a bio and some links in the editor." }); }
        else inner = h("div", {}, p.bio ? h("p", { class: "pf-bio", text: p.bio }) : null,
          p.links.length ? h("div", { class: "pf-links" }, p.links.map(l => ext(l.url, l.label, "pf-chip"))) : null);
      } else if (s.key === "favorites") {
        inner = s.games.length ? h("div", { class: "pf-tiles" }, s.games.map(pfTile)) : h("p", { class: "muted", text: "Pick up to five favorites in the editor." });
      } else if (s.key === "nowplaying") {
        inner = s.now ? h("div", { class: "pf-tiles" }, pfTile(s.now), h("span", { class: "chip ok", text: "Playing right now" })) : h("p", { class: "muted", text: "Not in a game right now." });
      } else if (s.key === "recent") {
        inner = s.games.length ? h("div", { class: "pf-tiles" }, s.games.map(pfTile)) : h("p", { class: "muted", text: "Nothing marked finished yet." });
      } else if (s.key === "trophies") {
        inner = s.badges.length ? h("div", { class: "pf-links" }, s.badges.map(b => h("span", { class: "pf-chip", text: `${b.icon} ${b.name} · ${b.tier}` })), h("span", { class: "muted small", text: `${s.earned} of ${s.total} earned` })) : h("p", { class: "muted", text: "No trophies yet." });
      } else if (s.key === "posts") {
        inner = pfPosts(s);
      } else if (s.key === "guestbook") {
        inner = preview ? h("p", { class: "muted", text: "Visitors who sign in with Discord can leave you a short note here." }) : pfGuestbook(p, s);
      } else if (s.key === "achievements") {
        const stat = (n, l) => h("div", { class: "pf-stat" }, h("b", { text: Number(n).toLocaleString() }), h("span", { text: l }));
        inner = h("div", {},
          s.top.length ? h("div", { class: "pf-ach" }, s.top.map(a => h("div", { class: "pf-ach-i", title: `${a.name} · ${a.game} · ${a.pct}% of players` },
            a.icon ? h("img", { src: a.icon, alt: a.name, loading: "lazy", referrerpolicy: "no-referrer" }) : h("span", { class: "pf-ach-x", text: "★" })))) : null,
          h("div", { class: "pf-stats" }, stat(s.done, "Achievements"), stat(s.rare, "Rare achievements")));
      } else if (s.key === "activity") {
        const day = t => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        inner = h("div", { class: "pf-act" },
          s.hours2w ? h("p", { class: "muted small", text: `${s.hours2w} hours past 2 weeks` }) : null,
          s.games.map(g => h("div", { class: "pf-act-g" },
            h("div", { class: "pf-act-top" }, pfArt(g.art, g.title),
              h("div", { class: "pf-act-info" }, h("strong", { text: g.title }),
                h("span", { class: "muted small", text: `${g.hours.toLocaleString()} hrs on record` }),
                h("span", { class: "muted small", text: `last played ${day(g.last)}` }))),
            g.total ? h("div", { class: "pf-act-ach" },
              h("div", { class: "pf-act-bar" }, h("span", { text: `${g.done} / ${g.total} Achievements` }), h("i", {}, (() => { const fill = h("b"); fill.style.width = Math.round(g.done / g.total * 100) + "%"; return fill; })())),
              h("div", { class: "pf-act-ico" }, g.unlocks.map(u => u.icon ? h("img", { src: u.icon, alt: u.name, title: u.name, loading: "lazy", referrerpolicy: "no-referrer" }) : null),
                g.done > g.unlocks.length ? h("span", { class: "pf-act-more", text: "+" + (g.done - g.unlocks.length) }) : null)) : null)));
      } else if (s.key === "steam") {
        const stat = (n, l) => h("div", { class: "pf-stat" }, h("b", { text: Number(n).toLocaleString() }), h("span", { text: l }));
        inner = h("div", { class: "pf-stats" }, stat(s.games, "Steam games"), stat(s.hours, "Hours played"), stat(s.library, "In the library"), stat(s.finished, "Finished"));
      } else if (s.key === "value") {
        const stat = (n, l) => h("div", { class: "pf-stat" }, h("b", { text: n }), h("span", { text: l }));
        const usd = n => "$" + Number(n).toLocaleString();
        inner = h("div", {}, h("div", { class: "pf-stats" }, stat(usd(s.worth), "Library worth"), stat(usd(s.paid), "Actually paid"), stat(usd(s.saved), "Saved"), stat(Number(s.games).toLocaleString(), "Games counted")),
          h("p", { class: "muted small", text: "Worth is the full price of every game. Updated " + s.day + "." }),
          p.owner && p.slug ? h("label", { class: "muted small" }, "Badge image link for your bio or signature ",
            h("input", { type: "text", readonly: "readonly", value: location.origin + "/u/" + p.slug + "/badge.svg", onfocus: e => e.target.select() })) : null);
      } else if (s.key === "streams") {
        inner = h("div", {}, h("div", { class: "pf-links" }, ...(s.channels && s.channels.length ? s.channels : [s]).map(c => ext(c.url, (c.platform === "twitch" ? "Twitch" : c.platform === "kick" ? "Kick" : "YouTube") + ": " + c.handle, "pf-chip")), s.live ? h("span", { class: "chip warn", text: "LIVE NOW" }) : null),
          s.live ? h("p", { class: "muted small", text: s.live.title + (s.live.game ? " · " + s.live.game : "") }) : null);
      } else if (s.key === "wishlist") {
        inner = s.games.length ? wishSlider(s.games, g => h("div", { class: "free-card pf-slide" },
          pfArt(g.art, g.title),
          h("div", { class: "free-info" }, h("strong", { text: g.title }),
            h("span", { class: "muted small", text: (g.discount > 0 ? `${g.discount}% off • ` : "") + (g.shop || "") }),
            h("b", { text: money(g.price, g.currency) }),
            h("div", { class: "pf-slide-act" }, g.url && ext(g.url, "View deal", "btn green small"), preview ? null : soonControl(g, p.slug, canMark), preview ? null : giftButton(g, p.slug, { signedIn, owner: p.owner, open: s.giftsOpen !== false, region }))))) : h("p", { class: "muted", text: "Nothing on this list yet." });
      }
      if (inner) body.append(h("section", { class: "pf-card pf-" + s.key }, title, inner));
    }
    if (!p.sections.length) body.append(h("p", { class: "muted", text: "This profile has nothing to show right now." }));
    root.append(body);
    if (pageBg && preview) { const stage = h("div", { class: "pf-stage" }, pageBg, root); return stage; }
    if (p.theme.fx && window.ProfileFx) setTimeout(() => { if (root.isConnected) window.ProfileFx.start(root, p.theme.fx); }, 0);
    if (p.theme.style === "kinetic") root.prepend(h("div", { class: "pf-kin", "aria-hidden": "true" }, h("span", { class: "pf-kin-name", text: (p.name || "").slice(0, 14) })));
    return root;
  }

  /** A row of cards you slide through instead of one very long list. Swipe on a phone, arrows on a computer. */
  function wishSlider(games, card) {
    const track = h("div", { class: "pf-track", tabindex: "0", role: "list", "aria-label": "Wishlist games" }, games.map(g => { const c = card(g); c.setAttribute("role", "listitem"); return c; }));
    const step = dir => track.scrollBy({ left: dir * Math.max(200, track.clientWidth * .85), behavior: "smooth" });
    const prev = h("button", { class: "pf-arrow prev", type: "button", "aria-label": "Previous games", text: "‹", onclick: () => step(-1) });
    const next = h("button", { class: "pf-arrow next", type: "button", "aria-label": "Next games", text: "›", onclick: () => step(1) });
    const count = h("span", { class: "muted small pf-slide-count", text: games.length + (games.length === 1 ? " game" : " games") + (games.length > 1 ? " · slide for more" : "") });
    const edges = () => { prev.hidden = track.scrollLeft < 8; next.hidden = track.scrollLeft + track.clientWidth >= track.scrollWidth - 8; };
    track.addEventListener("scroll", edges, { passive: true });
    requestAnimationFrame(edges); setTimeout(edges, 400);
    return h("div", { class: "pf-slider" }, count, h("div", { class: "pf-slide-wrap" }, prev, track, next));
  }

  async function publicProfileView(slug) {
    const holder = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(holder);
    try {
      const d = await api("/api/public/profile?slug=" + encodeURIComponent(slug));
      document.title = d.profile.name + " on Steam Value Checker";
      app.replaceChildren(renderProfile(d.profile, { canMark: d.canMark, signedIn: d.signedIn, region: d.region, social: d.social }));
    } catch (e) { holder.className = ""; holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
  }

  /** The editor: every choice on the left, the real page on the right, updated as you go. */
  async function profileEditorView() {
    const holder = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(pageHead("My profile", "Build the page people see when you share your link."), holder);
    let d;
    try { d = await api("/api/profile/page"); } catch (e) { holder.className = ""; holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); return; }
    holder.className = "";
    if (!d.slug || !d.public) {
      holder.replaceChildren(h("div", { class: "notice" }, "Choose a page name and turn your page on first. Then come back here to design it."), publicPagePanel(),
        (() => { const b = h("button", { class: "btn blue", type: "button", text: "I did that, continue" }); b.addEventListener("click", () => route()); return b; })());
      return;
    }
    const cfg = JSON.parse(JSON.stringify(d.config));
    // The saved song is stored as provider and id. The editor works with the pasted link, so turn it back into one.
    // The saved song is stored as provider and id. The editor works with the pasted link, so turn it back into one (also after every save).
    const songToLink = sg => (sg ? { url: sg.provider === "radio" ? sg.id : sg.provider === "youtube" ? "https://youtu.be/" + sg.id : sg.provider === "soundcloud" ? "https://soundcloud.com/" + sg.id : "https://open.spotify.com/" + sg.kind + "/" + sg.id, title: sg.title || "" } : null);
    cfg.song = songToLink(cfg.song);
    const pv = h("div", { class: "pf-preview" });
    let dirty = false, timer = null;
    let tryStyle = null; // a supporter style someone is only looking at: shown in the preview, never saved
    let tryTheme = null; // a supporter theme someone is only looking at: shown in the preview, never saved
    const payload = () => ({ ...cfg, links: cfg.links.filter(l => l.url.trim()), favorites: cfg.favorites, song: cfg.song && cfg.song.url ? cfg.song : null });
    const draw = profile => { pv.replaceChildren(profile ? renderProfile(profile, { preview: true }) : h("p", { class: "muted", text: "Nothing to preview yet." })); };
    const refresh = () => { clearTimeout(timer); timer = setTimeout(async () => { try { draw((await api("/api/profile/preview", { ...payload(), ...(tryTheme ? { theme: tryTheme } : {}), ...(tryStyle ? { style: tryStyle } : {}) })).profile); } catch (e) { pv.prepend(h("div", { class: "notice warn", text: e.message })); } }, 450); };
    const changed = () => { dirty = true; saveBtn.disabled = false; refresh(); };

    // look
    const themeBox = h("div", { class: "pf-swatches" });
    const drawThemes = () => themeBox.replaceChildren(...d.choices.themes.map(t => {
      const b = h("button", { type: "button", class: "pf-swatch" + ((tryTheme || cfg.theme) === t.key ? " on" : "") + (t.locked ? " locked" : ""), title: t.locked ? t.key + " (supporters only)" : t.key, "aria-label": t.key + " theme", "aria-pressed": String(cfg.theme === t.key) });
      b.style.background = t.bg; b.style.borderColor = t.accent; b.style.setProperty("--dot", t.accent);
      b.addEventListener("click", () => { if (t.locked) { tryTheme = t.key; drawThemes(); refresh(); return toast("Previewing " + t.key + ". It's for supporters, so it won't save without a pass (Chip in page, Help menu).", "warn"); } tryTheme = null; cfg.theme = t.key; drawThemes(); changed(); });
      return b;
    }));
    drawThemes();
    const styleBox = h("div", { class: "pf-styles" });
    const drawStyles = () => styleBox.replaceChildren(...d.choices.styles.map(t => {
      const on = (tryStyle || cfg.style || "classic") === t.key;
      const b = h("button", { type: "button", class: "pf-style" + (on ? " on" : ""), "data-style": t.key, "aria-pressed": String(on), title: t.name },
        h("span", { class: "pf-style-pv" }, h("i"), h("i"), h("i")), h("b", { text: t.name + (t.locked ? " 🔒" : "") }), h("span", { class: "muted small", text: t.blurb }));
      if (t.bg) { b.style.setProperty("--sv-bg", t.bg); b.style.setProperty("--sv-ac", t.accent); }
      b.addEventListener("click", () => { if (t.locked) { tryStyle = t.key; drawStyles(); refresh(); return toast("Previewing " + t.name + ". It's for supporters, so it won't save without a pass (Chip in page, Help menu).", "warn"); } tryStyle = null; cfg.style = t.key; drawStyles(); changed(); });
      return b;
    }));
    drawStyles();
    const accent = h("input", { type: "color", value: cfg.accent || (d.choices.themes.find(t => t.key === cfg.theme) || {}).accent || "#66c0f4", "aria-label": "Accent colour" });
    accent.addEventListener("input", () => { cfg.accent = accent.value; changed(); });
    const accentReset = h("button", { type: "button", class: "btn gray small", text: "Use the theme colour" });
    accentReset.addEventListener("click", () => { cfg.accent = null; accent.value = (d.choices.themes.find(t => t.key === cfg.theme) || {}).accent; changed(); });
    const pick = (label, key, options) => { const s = select(options, cfg[key]); s.addEventListener("change", () => { cfg[key] = s.value; changed(); }); return field(label, s); };
    const nice = x => x[0].toUpperCase() + x.slice(1);
    const av = h("input", { type: "checkbox", checked: cfg.avatar, disabled: !d.steamLinked });
    av.addEventListener("change", () => { cfg.avatar = av.checked; changed(); });
    const gateBox = h("input", { type: "checkbox", checked: Boolean(cfg.enter) });
    gateBox.addEventListener("change", () => { cfg.enter = gateBox.checked; changed(); });
    const look = h("div", { class: "panel" }, h("h3", { text: "Look" }), field("Style", styleBox), h("p", { class: "muted small", text: "A style changes the whole look. Everything except Classic brings its own colors, and the accent below still tints it." }), field("Theme (Classic only)", themeBox), h("div", { class: "row" }, field("Accent colour", accent), h("div", {}, h("label", { text: "\u00a0" }), accentReset)),
      h("div", { class: "row" }, pick("Background", "bgstyle", d.choices.bgstyles.map(x => [x, nice(x)])), pick("Layout", "layout", d.choices.layouts.map(x => [x, nice(x)])), pick("Banner", "banner", [["gradient", "Colour"], ["game", "First favorite game's art"], ["none", "None"]])),
      h("label", { class: "check" }, av, " ", "Show my Steam picture", d.steamLinked ? null : h("span", { class: "muted small", text: " (link Steam first)" })));

    // about
    const name = h("input", { type: "text", maxlength: "32", value: cfg.name, placeholder: d.slug });
    name.addEventListener("input", () => { cfg.name = name.value; changed(); });
    const bio = h("textarea", { maxlength: "300", rows: "4", placeholder: "A line or two about you and what you play." }); bio.value = cfg.bio;
    const count = h("span", { class: "muted small", text: `${cfg.bio.length}/300` });
    bio.addEventListener("input", () => { cfg.bio = bio.value; count.textContent = `${bio.value.length}/300`; changed(); });
    const about = h("div", { class: "panel" }, h("h3", { text: "About you" }), field("Display name", name), field("Bio", bio), count);

    // links
    const linkBox = h("div", { class: "pf-rows" });
    const drawLinks = () => {
      linkBox.replaceChildren(...cfg.links.map((l, n) => {
        const k = select(d.choices.links, l.kind); k.addEventListener("change", () => { l.kind = k.value; changed(); });
        const u = h("input", { type: "url", value: l.url, placeholder: "https://", "aria-label": "Link address" }); u.addEventListener("input", () => { l.url = u.value; changed(); });
        const rm = h("button", { type: "button", class: "btn gray small", text: "Remove" }); rm.addEventListener("click", () => { cfg.links.splice(n, 1); drawLinks(); changed(); });
        return h("div", { class: "row pf-row" }, k, u, rm);
      }));
    };
    drawLinks();
    const addLink = h("button", { type: "button", class: "btn gray small", text: "Add a link" });
    addLink.addEventListener("click", () => { if (cfg.links.length >= 6) return toast("Up to 6 links.", "warn"); cfg.links.push({ kind: "website", url: "" }); drawLinks(); });
    const links = h("div", { class: "panel" }, h("h3", { text: "Links" }), linkBox, addLink);

    // favorites
    const favBox = h("div", { class: "chips" });
    const drawFavs = () => favBox.replaceChildren(...cfg.favorites.map((t, n) => { const x = h("button", { type: "button", class: "chip", text: t + " ✕", "aria-label": "Remove " + t }); x.addEventListener("click", () => { cfg.favorites.splice(n, 1); drawFavs(); changed(); }); return x; }));
    drawFavs();
    const favIn = h("input", { type: "text", list: "pf-titles", maxlength: "80", placeholder: "Start typing a game from your library or wishlist" });
    const addFav = () => { const t = favIn.value.trim(); if (!t) return; if (cfg.favorites.length >= 5) return toast("Up to five favorites.", "warn"); if (!cfg.favorites.includes(t)) cfg.favorites.push(t); favIn.value = ""; drawFavs(); changed(); };
    favIn.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addFav(); } });
    const favBtn = h("button", { type: "button", class: "btn gray small", text: "Add", onclick: addFav });
    const favs = h("div", { class: "panel" }, h("h3", { text: "Favorite games" }), h("datalist", { id: "pf-titles" }, d.choices.titles.map(t => h("option", { value: t }))), h("div", { class: "row" }, favIn, favBtn), favBox,
      h("p", { class: "muted small", text: "Games with art show up as tiles. The first one can also be your banner." }));

    // song
    cfg.song = cfg.song || null;
    const songUrl = h("input", { type: "url", placeholder: "YouTube, SoundCloud, Spotify or a live radio stream link", value: cfg.song ? cfg.song.url : "" });
    const songTitle = h("input", { type: "text", maxlength: "60", placeholder: "Song name (optional)", value: cfg.song ? cfg.song.title : "" });
    const songSync = () => { cfg.song = songUrl.value.trim() ? { url: songUrl.value.trim(), title: songTitle.value } : null; changed(); };
    songUrl.addEventListener("input", songSync); songTitle.addEventListener("input", songSync);
    const song = h("div", { class: "panel" }, h("h3", { text: "Profile song" }), h("div", { class: "row" }, field("Link", songUrl), field("Name", songTitle)),
      h("label", { class: "check" }, gateBox, " Start with a “Click to enter” screen, and play the song as soon as they click"),
      h("p", { class: "muted small", text: "Shows as a play button on your page. For radio, paste the direct stream address (https, ends in something like /stream or .mp3)." }));

    // sections
    const secBox = h("div", { class: "pf-rows" });
    const drawSecs = () => secBox.replaceChildren(...cfg.sections.map((s, n) => {
      const vis = select(Object.entries(PF_VIS), s.vis); vis.addEventListener("change", () => { s.vis = vis.value; changed(); });
      const up = h("button", { type: "button", class: "btn gray small", text: "↑", "aria-label": "Move up", disabled: n === 0 }), dn = h("button", { type: "button", class: "btn gray small", text: "↓", "aria-label": "Move down", disabled: n === cfg.sections.length - 1 });
      up.addEventListener("click", () => { [cfg.sections[n - 1], cfg.sections[n]] = [cfg.sections[n], cfg.sections[n - 1]]; drawSecs(); changed(); });
      dn.addEventListener("click", () => { [cfg.sections[n + 1], cfg.sections[n]] = [cfg.sections[n], cfg.sections[n + 1]]; drawSecs(); changed(); });
      return h("div", { class: "row pf-row" }, h("strong", { class: "pf-sec", text: PF_TITLE[s.key] || s.key }), vis, up, dn);
    }));
    drawSecs();
    const secs = h("div", { class: "panel" }, h("h3", { text: "Sections" }), h("p", { class: "muted small", text: "Choose what shows, who sees it, and the order. \"Server only\" means signed-in members of your server. Hidden sections are never sent to visitors." }), secBox);

    const saveBtn = h("button", { type: "button", class: "btn green", text: "Save profile", disabled: true });
    saveBtn.addEventListener("click", () => busy(saveBtn, async () => {
      const r = await api("/api/profile/page", payload());
      dirty = false; Object.assign(cfg, r.config, { song: songToLink(r.config.song) }); draw(r.profile); toast("Saved.", "ok");
    }));
    const open = h("a", { class: "btn gray", href: "#/u/" + d.slug, text: "Open my page" });
    const copy = h("button", { type: "button", class: "btn gray", text: "Copy link" });
    copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(location.origin + "/u/" + d.slug); toast("Link copied.", "ok"); } catch { toast(location.origin + "/u/" + d.slug); } });
    // behind the page: a preset, an uploaded picture, or the Steam profile background
    const bgBox = h("div", { class: "pf-bg-panel" });
    const shrink = file => new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), im = new Image();
      im.onload = () => {
        const k = Math.min(1, 1600 / im.width), c = document.createElement("canvas"); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        let q = 0.8, out = c.toDataURL("image/jpeg", q);
        while (out.length > 500_000 && q > 0.45) { q -= 0.1; out = c.toDataURL("image/jpeg", q); }
        out.length > 1_550_000 ? reject(new Error("That picture is too big even after shrinking it. Try a smaller one.")) : resolve(out);
      };
      im.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file is not a picture this browser can open.")); };
      im.src = url;
    });
    const adopt = r => { d.backgrounds = r.backgrounds; cfg.pagebg = r.config.pagebg; drawBg(); draw(r.profile); };
    const bgCall = (body, b) => busy(b, async () => { try { adopt(await api("/api/profile/background", body)); } catch (e) { toast(e.message, "error"); } });
    function drawBg() {
      const pb = cfg.pagebg || (cfg.pagebg = { kind: "none", preset: "aurora", dim: 35, image: null });
      const kinds = h("div", { class: "pf-bg-kinds" }, [["none", "None"], ["preset", "Preset"], ["image", "My picture"], ...(pb.video ? [["video", "Steam animated"]] : [])].map(([k, label]) => {
        const b = h("button", { type: "button", class: "btn small " + (pb.kind === k ? "blue" : "gray"), text: label, "aria-pressed": String(pb.kind === k) });
        b.addEventListener("click", () => { if (k === "image" && !(d.backgrounds || []).length) return toast("Upload a picture or copy your Steam background first.", "warn"); pb.kind = k; if (k === "image" && !pb.image) pb.image = d.backgrounds[0].id; drawBg(); changed(); });
        return b;
      }));
      const parts = [kinds];
      if (pb.kind === "preset") parts.push(h("div", { class: "pf-presets" }, d.presets.map(id => {
        const b = h("button", { type: "button", class: "pf-preset" + (pb.preset === id ? " on" : ""), title: id, "aria-label": id + " background", "aria-pressed": String(pb.preset === id) });
        b.style.background = PAGE_PRESET_CSS[id]; b.addEventListener("click", () => { pb.preset = id; drawBg(); changed(); }); return b;
      })));
      if (pb.kind === "image") {
        parts.push(h("div", { class: "pf-bg-thumbs" }, (d.backgrounds || []).map(bg => {
          const t = h("div", { class: "pf-bg-thumb" + (pb.image === bg.id ? " on" : "") });
          t.style.backgroundImage = `url("${bg.url}")`;
          const use = h("button", { type: "button", class: "pf-bg-use", "aria-label": "Use this picture", "aria-pressed": String(pb.image === bg.id), text: pb.image === bg.id ? "In use" : "Use" });
          use.addEventListener("click", () => bgCall({ action: "use", id: bg.id }, use));
          const del = h("button", { type: "button", class: "pf-bg-del", "aria-label": "Delete this picture", text: "✕" });
          del.addEventListener("click", () => { if (confirm("Delete this picture?")) bgCall({ action: "remove", id: bg.id }, del); });
          return h("div", {}, t, h("div", { class: "row" }, use, del, h("span", { class: "muted small", text: (bg.source === "steam" ? "Steam · " : "") + Math.round(bg.bytes / 1024) + " KB" })));
        })));
        const dim = h("input", { type: "range", min: "0", max: "70", value: String(pb.dim ?? 35), "aria-label": "Dim the picture" });
        dim.addEventListener("input", () => { pb.dim = Number(dim.value); changed(); });
        parts.push(field("Dim the picture so the page stays readable", dim));
      }
      const file = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", hidden: true });
      const up = h("button", { type: "button", class: "btn gray small", text: "Upload a picture" });
      up.addEventListener("click", () => file.click());
      file.addEventListener("change", () => { const f = file.files[0]; file.value = ""; if (!f) return; busy(up, async () => { try { adopt(await api("/api/profile/background", { action: "upload", data: await shrink(f) })); toast("Uploaded.", "ok"); } catch (e) { toast(e.message, "error"); } }); });
      const st = h("button", { type: "button", class: "btn gray small", text: "Use my Steam background", disabled: !d.steamLinked, title: d.steamLinked ? "" : "Link Steam first" });
      st.addEventListener("click", () => busy(st, async () => { try { adopt(await api("/api/profile/background", { action: "steam" })); toast(cfg.pagebg && cfg.pagebg.kind === "video" ? "Using your animated Steam background." : "Copied your Steam background.", "ok"); } catch (e) { toast(e.message, "error"); } }));
      parts.push(h("div", { class: "row" }, up, st, file));
      parts.push(h("p", { class: "muted small", text: `You can keep up to ${d.maxBackgrounds} pictures (${(d.backgrounds || []).length} stored). Pictures are cleared if you have not opened the bot or dashboard for 30 days. Keep it to pictures you have the right to use. If a page is reported, it can be hidden.` }));
      bgBox.replaceChildren(...parts);
    }
    drawBg();
    const pageBgPanel = h("div", { class: "panel" }, h("h3", { text: "Page background" }), h("p", { class: "muted small", text: "The space around your profile card." }), bgBox);
    holder.replaceChildren(h("div", { class: "pf-editor" },
      h("div", { class: "pf-form" }, look, pageBgPanel, about, links, favs, song, secs, h("div", { class: "row pf-save" }, saveBtn, open, copy)),
      h("div", { class: "pf-side" }, h("div", { class: "pf-sticky" }, h("h3", { text: "Preview" }), pv))));
    draw(d.profile);
    window.addEventListener("hashchange", () => { clearTimeout(timer); }, { once: true });
  }

  /** The gift mark under a game on a public wishlist. Needs a Discord sign-in; the list's owner can release a mark but is never told who made it. */
  function regionNote(r) {
    return r ? `Your Steam region (${r.yours}, ${r.yoursCurrency}) is not the same as theirs (${r.theirs}, ${r.theirsCurrency}). ${r.currencyDiffers ? "Steam can block gifts between regions with different currencies, and the price you pay may differ." : "Prices can differ a little, and some games are region locked."} Check the store page before you buy.` : "";
  }
  function giftButton(g, slug, { signedIn = false, owner = false, open = true, region = null } = {}) {
    const wrap = h("div", { class: "gift" });
    const draw = () => {
      if (owner) {
        if (g.claim !== "taken") { wrap.replaceChildren(); return; }
        const mk = (label, report) => {
          const b = h("button", { class: "btn gray small", type: "button", text: label });
          b.addEventListener("click", () => {
            if (report && !confirm("Release this mark and report it? Reporting is for fake or abusive marks. Accounts with repeated reports lose gift marks.")) return;
            busy(b, async () => { try { await api("/api/profile/gifts", { action: "release", id: g.id, report }); g.claim = null; toast(report ? "Released and reported. Thank you." : "Released.", "ok"); } catch (e) { toast(e.message, "error"); } draw(); });
          });
          return b;
        };
        wrap.replaceChildren(h("span", { class: "muted small", text: "Someone is gifting this" }), h("span", { class: "gift-owner" }, mk("Release", false), mk("Release and report", true)));
        return;
      }
      if (g.claim === "taken") { wrap.replaceChildren(h("span", { class: "muted small", text: "Someone is already gifting this" })); return; }
      if (!open && g.claim !== "mine") { wrap.replaceChildren(h("span", { class: "muted small", text: "Gift marks are off for this list" })); return; }
      if (!signedIn) { wrap.replaceChildren(h("a", { class: "btn gray small", href: "/auth/login", text: "Sign in with Discord to gift this" })); return; }
      const call = (claim, done) => async () => {
        try { const r = await api("/api/public/gift", { slug, id: g.id, claim }); g.claim = r.claim; toast(done(g.claim), "ok"); }
        catch (e) { toast(e.message, "error"); if (/already/.test(e.message)) g.claim = "taken"; }
        draw();
      };
      const b = h("button", { class: "btn gray small", text: g.claim === "mine" ? "You are gifting this (undo)" : "I’ll gift this" });
      b.addEventListener("click", () => { if (g.claim !== "mine" && region && !confirm(regionNote(region) + "\n\nMark it anyway?")) return; busy(b, call(g.claim !== "mine", c => (c === "mine" ? "Marked. Others will see someone is gifting this. It runs out after three weeks unless you renew it." : "Mark removed."))); });
      if (g.claim === "mine" && region) wrap.title = regionNote(region);
      if (g.claim === "mine") {
        const r = h("button", { class: "btn gray small", type: "button", text: "Renew for 3 weeks" });
        r.addEventListener("click", () => busy(r, call(true, () => "Renewed for three more weeks.")));
        wrap.replaceChildren(b, r);
        return;
      }
      wrap.replaceChildren(b);
    };
    draw();
    return wrap;
  }

  function soonControl(g, slug, canMark) {
    const wrap = h("div", { class: "soon" });
    const draw = () => {
      const kids = [];
      if (g.soon) kids.push(h("span", { class: "chip ok", text: "Up for giveaway soon" }));
      if (canMark) {
        const b = h("button", { class: "btn gray small", text: g.soon ? "Remove giveaway mark" : "Up for giveaway" });
        b.addEventListener("click", () => busy(b, async () => {
          try { const r = await api("/api/wishlist/soon", { slug, id: g.id, on: !g.soon }); g.soon = r.soon; toast(g.soon ? "Marked. Members can see it's coming up." : "Mark removed.", "ok"); }
          catch (e) { toast(e.message, "error"); }
          draw();
        }));
        kids.push(b);
      }
      wrap.replaceChildren(...kids);
    };
    draw();
    return wrap;
  }

  // Members: games their servers' staff plan to give away.
  function soonPanel() {
    const panel = h("div", { class: "panel" }, h("h3", { text: "Up for giveaway soon" }), h("p", { class: "muted", text: "Loading…" }));
    api("/api/giveaways/soon").then(d => {
      panel.replaceChildren(h("h3", { text: "Up for giveaway soon" }),
        h("p", { class: "muted small", text: "Games your servers' moderators plan to give away. Keep an eye on the giveaway channel." }),
        d.games.length ? h("div", { class: "free-grid" }, d.games.map(g => h("div", { class: "free-card" },
          g.art ? h("img", { src: g.art, alt: "", loading: "lazy" }) : h("div", { class: "free-noart", text: "" }),
          h("div", { class: "free-info" }, h("strong", { text: g.title }), h("span", { class: "muted small", text: g.server || "" }))))) : h("div", { class: "empty", text: "Nothing is marked right now." }));
    }).catch(e => panel.replaceChildren(h("h3", { text: "Up for giveaway soon" }), h("div", { class: "notice warn", text: e.message })));
    return panel;
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
        g.advice ? h("div", { class: "notice " + (good ? "ok" : "warn") }, h("b", { text: (good ? "" : "") + "Buy now or wait? " + g.advice.label + ". " }), g.advice.reasons.join(" ")) : "",
        g.points.length ? h("div", { class: "panel" }, h("h3", { text: "Price over the last year" }), lineChart([{ name: "Price", cls: "s0", points: g.points.map(p => ({ x: p.t, y: p.price })) }], { format: v => money(v, cur), label: "Price history for " + g.title })) : "",
        g.free.length ? h("div", { class: "panel" }, h("h3", { text: "Free right now" }), g.free.map(f => h("div", { class: "game-line" }, h("span", {}, h("b", { text: f.title }), " on " + f.shop), f.url ? ext(f.url, "Claim", "btn green small") : ""))) : "",
        g.bundles.length ? h("div", { class: "panel" }, h("h3", { text: "In a bundle" }), g.bundles.map(b => h("div", { class: "game-line" }, h("span", {}, h("b", { text: b.title }), ` (${b.shop || "bundle"}) from ${money(b.price, b.currency || cur)}`), b.url ? ext(b.url, "Open", "btn gray small") : ""))) : "",
        g.watchers ? h("p", { class: "muted", text: `${g.watchers} member${g.watchers === 1 ? "" : "s"} of your server ${g.watchers === 1 ? "is" : "are"} watching this (only people who opted in with /alerts share).` }) : "");
    } catch (e) { holder.className = ""; holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
  }

  async function publicWishlistView(slug) {
    const holder = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(holder);
    try {
      const d = await api("/api/public/wishlist?slug=" + encodeURIComponent(slug));
      const money2 = (n, c) => (n === null || n === undefined ? "-" : new Intl.NumberFormat(undefined, { style: "currency", currency: c || "USD" }).format(n));
      holder.className = "";
      if (/^#[0-9a-f]{6}$/i.test(d.accent || "")) { holder.style.setProperty("--accent", d.accent); holder.style.setProperty("--accent-2", d.accent); }
      holder.replaceChildren(pageHead(d.slug + "'s wishlist", `${d.games.length} game${d.games.length === 1 ? "" : "s"} with today's best prices. Thinking of a gift?`),
        d.games.length ? h("div", { class: "free-grid" }, d.games.map(g => h("div", { class: "free-card" },
          g.art ? h("img", { src: g.art, alt: "", loading: "lazy" }) : h("div", { class: "free-noart", text: "" }),
          h("div", { class: "free-info" }, h("strong", { text: g.title }),
            h("span", { class: "muted small", text: (g.discount > 0 ? `${g.discount}% off • ` : "") + (g.shop || "") }),
            h("b", { text: money2(g.price, g.currency) }),
            g.url && ext(g.url, "View deal", "btn green small"), soonControl(g, d.slug, d.canMark), giftButton(g, d.slug, { signedIn: d.signedIn, owner: d.owner, open: d.giftsOpen !== false, region: d.region }))))) : h("div", { class: "empty", text: "Nothing on this list yet." }));
    } catch (e) { holder.className = ""; holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
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
        tabs.replaceChildren(...[["games", "Games"], ...(d.showDlc ? [["dlc", "DLC"], ["all", "All"]] : [])].map(([id, label]) =>
          h("button", { class: "tab" + (id === cat ? " active" : ""), text: `${label} (${all.filter(g => id === "all" || (id === "dlc") === g.dlc).length})`, onclick: () => { cat = id; draw(); } })));
        const rows = inCat.filter(g => shop === "all" || g.shop === shop).sort(SORTS[sort]);
        body.replaceChildren(...[
          shops.length > 1 ? h("div", { class: "chips" }, ["all", ...shops].map(x => h("button", { class: "tab small" + (x === shop ? " active" : ""), text: x === "all" ? "All stores" : x, onclick: () => { shop = x; draw(); } }))) : null,
          rows.length ? h("div", { class: "free-grid" }, rows.map(g => h("div", { class: "free-card" },
            g.art ? h("img", { src: g.art, alt: "", loading: "lazy" }) : h("div", { class: "free-noart", text: "" }),
            h("div", { class: "free-info" }, h("strong", { text: g.title }), g.dlc ? h("span", { class: "dlc-tag", text: "DLC" }) : null, g.dlc && g.base && g.baseOwned !== null ? h("span", { class: "own-note " + (g.baseOwned ? "yes" : "no"), text: (g.baseOwned ? "You own the base game" : "You don't own the base game") + " (" + g.base + ")" }) : null, h("span", { class: "muted small", text: g.shop + (g.dlc ? " • DLC" : "") + (g.expiry ? " • ends " + new Date(g.expiry).toLocaleDateString() : "") }), soon(g) ? h("span", { class: "chip warn", text: "⏰ Ending soon" }) : null,
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
      h("div", { class: "panel" }, sw("free", "Tell me when a game goes free", "(sent by DM or to your alert channel)"), h("p"), sw("free_dlc", "Show free DLC", "(also hides it from /games freegames)")),
      soonPanel(), panel);
    loadFree(panel);
  }


  // ---------- playtests ----------
  // Playtests, betas, demos and free weekends. The list asks the server again every few minutes by itself, flags what is new
  // since the page opened, and pauses while the tab is hidden.
  const PLAYTEST_POLL_MS = 5 * 60_000;
  async function playtestsView() {
    const F = { kind: "all", mine: false, hideOwned: false, q: "" };
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
          h("span", { class: "muted small", text: `${x.source} · ${when(x.date)}` }),
          ext(x.url, "How to join", "btn green small")));
    }
    function draw() {
      if (!data) return;
      bar.replaceChildren(
        h("div", { class: "chips" }, KINDS.map(([id, label]) => { const n = data.items.filter(x => id === "all" || x.kind === id).length; return h("button", { class: "tab small" + (F.kind === id ? " active" : ""), type: "button", text: `${label} (${n})`, onclick: () => { F.kind = id; draw(); } }); })));
      const rows = data.items.filter(x => (F.kind === "all" || x.kind === F.kind) && (!F.mine || x.wishlist) && (!F.hideOwned || !x.owned) && (!F.q || x.game.toLowerCase().includes(F.q)));
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
        draw();
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
    app.replaceChildren(pageHead("Playtests", "Playtests, betas, demos and free weekends happening now. It reads the Steam announcements of games on your wishlist or in your library, and Alpha Beta Gamer, GamerPower, itch.io and Steam's new demos for games Steam news never mentions."),
      h("div", { class: "panel" }, h("div", { class: "row free-bar" }, search,
        h("label", { class: "check" }, mineBox, " ", h("span", { text: "On my wishlist" })), h("label", { class: "check" }, ownBox, " ", h("span", { text: "Hide games I own" })), refreshBtn, stamp),
        h("p", { class: "muted small" }, on ? "Your playtest alerts are on. " : "Want a message when one shows up? ", h("a", { href: "#/alerts", text: on ? "Change them in Alert settings." : "Turn on playtest alerts." }))),
      notes, bar, list);
    list.replaceChildren(h("p", { class: "muted", text: "Loading…" }));
    await load(false); schedule();
  }

  /** The server's game of the month: the pick, who is playing or finished, and (for managers) the controls. */
  async function clubView() {
    const servers = state.me.servers.filter(g => g.bot !== false);
    const guild = serverPicker(servers), out = h("div");
    app.replaceChildren(pageHead("Game club", "One game a month for the whole server. Members who share their library (/alerts share) show up with their hours and achievements. In Discord: /server club."),
      h("div", { class: "panel" }, servers.length > 1 ? field("Server", guild) : null), out);
    async function load() {
      if (!servers.length) { out.replaceChildren(h("p", { class: "muted", text: "Invite the bot to a server first." })); return; }
      let d;
      try { d = await api("/api/club?guild=" + encodeURIComponent(guild.value)); } catch (e) { out.replaceChildren(h("div", { class: "notice warn", text: e.message })); return; }
      const post = body => api("/api/club", { guild_id: guild.value, ...body });
      const parts = [];
      if (d.club) {
        const row = r => h("li", {}, h("b", { text: r.name }), ` ${r.hours}h`, r.ach_total ? `, ${r.ach_done}/${r.ach_total} achievements` : "", r.finished ? " ✅" : r.started ? " ▶️" : " ⏳ not started");
        parts.push(h("div", { class: "panel" }, h("h3", { text: d.club.title }), h("p", { class: "muted", text: d.club.month + " pick. " + d.owners.length + " of " + d.sharing + " sharing members own it." }),
          d.club.appid ? ext("https://store.steampowered.com/app/" + d.club.appid + "/", "Steam page", "btn gray small") : null,
          d.owners.length ? h("ul", { class: "plain" }, d.owners.map(row)) : h("p", { class: "muted", text: "Nobody who shares their library owns it yet." })));
      } else parts.push(h("div", { class: "empty", text: "No pick yet." + (d.canManage ? " Set one below." : " A server manager can set one.") }));
      if (d.canManage) {
        const title = h("input", { type: "text", maxlength: "100", placeholder: "Game title", value: d.club ? d.club.title : "" });
        const chSel = select([["", "Not set"], ...d.channels.map(c => [c.id, "#" + c.name])], d.channel || "");
        const run = (btn, fn, msg) => busy(btn, async () => { await fn(); toast(msg, "ok"); load(); });
        const pick = h("button", { class: "btn blue", type: "button", text: "Set this month's pick" }), sv = h("button", { class: "btn gray small", type: "button", text: "Save channel" }), off = h("button", { class: "btn red small", type: "button", text: "Turn the club off" });
        pick.addEventListener("click", () => run(pick, () => post({ action: "pick", title: title.value }), "Pick saved."));
        sv.addEventListener("click", () => run(sv, () => post({ action: "channel", channel_id: chSel.value }), "Saved."));
        off.addEventListener("click", () => run(off, () => post({ action: "off" }), "Game club is off."));
        parts.push(h("div", { class: "panel" }, h("h3", { text: "Manage (Manage Server)" }), field("Game of the month", title), h("div", { class: "row" }, pick),
          field("Weekly card channel (posted once a week, and when the month ends)", chSel), h("div", { class: "row" }, sv, off)));
      }
      out.replaceChildren(...parts);
    }
    guild.addEventListener("change", load); await load();
  }

  // Secret Santa for a server: sign up, draw, and see who you're buying for.
  async function santaView() {
    const servers = state.me.servers.filter(g => g.bot !== false);
    const guild = serverPicker(servers), out = h("div");
    app.replaceChildren(pageHead("Secret Santa", "Draw names in your server and get a private message with who you're buying for and what's on their wishlist inside the budget. Joining shares your wishlist with only whoever draws you. In Discord: /server santa."),
      h("div", { class: "panel" }, servers.length > 1 ? field("Server", guild) : null), out);
    async function load() {
      if (!servers.length) { out.replaceChildren(h("p", { class: "muted", text: "Invite the bot to a server first." })); return; }
      let d;
      try { d = await api("/api/santa?guild=" + encodeURIComponent(guild.value)); } catch (e) { out.replaceChildren(h("div", { class: "notice warn", text: e.message })); return; }
      const post = body => api("/api/santa", { guild_id: guild.value, ...body });
      const run = (btn, fn, msg) => busy(btn, async () => { const r = await fn(); toast(typeof msg === "function" ? msg(r) : msg, "ok"); load(); });
      const parts = [];
      const ev = d.event;
      if (ev && ev.status !== "ended") {
        const money = n => { try { return new Intl.NumberFormat(undefined, { style: "currency", currency: ev.currency }).format(n); } catch { return n + " " + ev.currency; } };
        const mine = h("div");
        const actions = [];
        if (ev.status === "open") {
          const b = h("button", { class: d.joined ? "btn gray" : "btn green", type: "button", text: d.joined ? "Leave" : "Join" });
          b.addEventListener("click", () => run(b, () => post({ action: d.joined ? "leave" : "join" }), d.joined ? "You left." : "You're in."));
          actions.push(b);
        } else if (d.drawn) {
          const b = h("button", { class: "btn blue", type: "button", text: "Who do I have?" });
          b.addEventListener("click", () => busy(b, async () => { const r = await post({ action: "ideas" }); mine.replaceChildren(h("div", { class: "panel" }, h("h3", { text: r.title }), h("p", { text: r.text, class: "pre" }))); }));
          actions.push(b);
        }
        parts.push(h("div", { class: "panel" }, h("h3", { text: "🎅 " + ev.title }), h("p", { class: "muted", text: `Budget ${money(ev.budget)} · ${ev.status === "open" ? "open for sign-ups" : "names drawn"} · ${d.people.length} in` }),
          d.people.length ? h("ul", { class: "plain" }, d.people.map(p => h("li", { text: p.name }))) : h("p", { class: "muted", text: "Nobody yet." }),
          h("div", { class: "row" }, ...actions), mine));
        if (d.canManage) {
          const draw = h("button", { class: "btn blue", type: "button", text: "Draw names", disabled: ev.status !== "open" }), reveal = h("button", { class: "btn red small", type: "button", text: "Reveal and finish" });
          draw.addEventListener("click", () => run(draw, () => post({ action: "draw" }), r => `Drawn. ${r.count} people messaged${r.failed ? `, ${r.failed} with closed DMs (they can use /server santa ideas)` : ""}.`));
          reveal.addEventListener("click", () => { if (confirm("Show who had who and finish this Secret Santa?")) run(reveal, () => post({ action: "reveal" }), "Finished."); });
          parts.push(h("div", { class: "panel" }, h("h3", { text: "Manage (Manage Server)" }), h("p", { class: "muted small", text: "Drawing needs at least three people. Everyone gets a private message with their giftee and ideas." }), h("div", { class: "row" }, draw, reveal)));
        }
      } else if (d.canManage) {
        const title = h("input", { type: "text", maxlength: "80", placeholder: "Secret Santa" });
        const budget = h("input", { type: "number", min: "1", max: "1000", step: "1", value: "20", class: "short-num", "aria-label": "Budget" });
        const chSel = select([["", "Don't post an announcement"], ...d.channels.map(c => [c.id, "#" + c.name])], "");
        const go = h("button", { class: "btn green", type: "button", text: "Start it" });
        go.addEventListener("click", () => run(go, () => post({ action: "create", title: title.value, budget: Number(budget.value), channel_id: chSel.value }), "Secret Santa started."));
        parts.push(h("div", { class: "panel" }, h("h3", { text: "Start a Secret Santa" }), field("Name", title), field("Budget per gift, in your store's currency", budget), field("Announce in", chSel), h("div", { class: "row" }, go)));
      } else parts.push(h("div", { class: "empty", text: "No Secret Santa here yet. A server manager can start one." }));
      out.replaceChildren(...parts);
    }
    guild.addEventListener("change", load); await load();
  }

  async function triviaView() {
    const servers = state.me.servers.filter(g => g.bot !== false);
    const guild = serverPicker(servers), out = h("div");
    app.replaceChildren(pageHead("Trivia", "Guess the game from clues that get easier. Tap the right title; the sooner you get it, the more points. Scores add up per server. In Discord: /server trivia.",),
      h("div", { class: "panel" }, servers.length > 1 ? field("Server", guild) : null), out);
    async function load() {
      if (!servers.length) { out.replaceChildren(h("p", { class: "muted", text: "Invite the bot to a server first." })); return; }
      let d;
      try { d = await api("/api/trivia?guild=" + encodeURIComponent(guild.value)); } catch (e) { out.replaceChildren(h("div", { class: "notice warn", text: e.message })); return; }
      const post = body => api("/api/trivia", { guild_id: guild.value, ...body });
      const parts = [];
      if (d.active) parts.push(h("div", { class: "notice ok", text: `A game is going: round ${d.active.round} of ${d.active.rounds}.` }));
      if (d.canManage && d.enabled) {
        if (d.active) {
          const stop = h("button", { class: "btn red", type: "button", text: "Stop the game" });
          stop.addEventListener("click", () => busy(stop, async () => { await post({ action: "stop" }); toast("Stopped. Scores so far are saved.", "ok"); load(); }));
          parts.push(h("div", { class: "panel" }, h("h3", { text: "Manage (Manage Server)" }), h("div", { class: "row" }, stop)));
        } else {
          const chSel = select(d.channels.map(c => [c.id, "#" + c.name]), d.channels[0] ? d.channels[0].id : "");
          const rounds = select([["3", "3 questions"], ["5", "5 questions"], ["8", "8 questions"], ["10", "10 questions"]], "5");
          const go = h("button", { class: "btn green", type: "button", text: "Start trivia" });
          go.addEventListener("click", () => busy(go, async () => { await post({ action: "start", channel_id: chSel.value, rounds: Number(rounds.value) }); toast("Trivia started.", "ok"); load(); }));
          parts.push(h("div", { class: "panel" }, h("h3", { text: "Start a game" }), field("Play in", chSel), field("Length", rounds), h("div", { class: "row" }, go)));
        }
      } else if (!d.canManage) parts.push(h("p", { class: "muted", text: "A server manager starts the games. Watch for the clues in the channel they pick." }));
      const medal = i => ["🥇", "🥈", "🥉"][i] || String(i + 1) + ".";
      parts.push(h("div", { class: "panel" }, h("h3", { text: "Leaderboard" }),
        d.top.length ? h("ul", { class: "plain" }, d.top.map((r, i) => h("li", { text: `${medal(i)} ${r.name}: ${r.points} pts, ${r.correct} right, ${r.wins} win${r.wins === 1 ? "" : "s"}` })))
          : h("p", { class: "muted", text: "No games played yet." }),
        d.mine ? h("p", { class: "muted small", text: `You: ${d.mine.points} pts from ${d.mine.played} game${d.mine.played === 1 ? "" : "s"}.` }) : null));
      out.replaceChildren(...parts);
    }
    guild.addEventListener("change", load); await load();
  }

  const NOWPLAYING_POLL_MS = 60_000;
  /** Who in a server is in a game right now. Reads Steam through the bot, so it stays current without a refresh. */
  async function nowPlayingView() {
    const servers = state.me.servers.filter(g => g.bot !== false);
    const guild = serverPicker(servers), out = h("div"), stamp = h("span", { class: "muted small" });
    let timer = null, loadedAt = 0;
    const alive = () => document.body.contains(out) && currentView() === "nowplaying";
    const on = Boolean(state.me.settings && state.me.settings.nowplaying);
    async function load() {
      if (!servers.length) { out.replaceChildren(h("p", { class: "muted", text: "Invite the bot to a server first." })); return; }
      try {
        const d = await api("/api/nowplaying?guild=" + encodeURIComponent(guild.value));
        if (!alive()) return;
        loadedAt = Date.now();
        if (!d.enabled) { out.replaceChildren(h("div", { class: "notice warn", text: "This bot has no Steam API key set, so it cannot see what people are playing." })); return; }
        out.replaceChildren(d.games.length
          ? h("div", { class: "grid three" }, d.games.map(g => h("div", { class: "panel np-card" },
              h("img", { src: "/art/header/" + g.appid + ".jpg", alt: "", loading: "lazy" }),
              h("h3", { text: g.game }), h("p", { class: "muted", text: g.players.map(p => p.name).join(", ") }),
              g.players.length >= 2 ? h("span", { class: "chip ok", text: g.players.length + " playing together" }) : null,
              ext("https://store.steampowered.com/app/" + g.appid + "/", "Steam page", "btn gray small"))))
          : h("div", { class: "empty", text: d.watching ? "Nobody who shares their activity is in a game right now." : "Nobody in this server has turned this on yet." }),
          h("p", { class: "muted small", text: d.watching + (d.watching === 1 ? " member shares" : " members share") + " what they play." }));
      } catch (e) { if (!loadedAt) out.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    const toggle = h("button", { class: "btn " + (on ? "gray" : "green"), type: "button", text: on ? "Leave the board" : "Show me on the board" });
    toggle.addEventListener("click", () => busy(toggle, async () => {
      const r = await api("/api/settings", { nowplaying: !state.me.settings.nowplaying });
      state.me.settings = r.settings; toast(r.settings.nowplaying ? "You are on the board. Link Steam, turn on sharing and make Game details public so it can see you." : "You are off the board.", "ok"); nowPlayingView();
    }));
    guild.addEventListener("change", load);
    app.replaceChildren(pageHead("Now playing", "Who in your server is in a game right now. Members choose to show up here, and two or more in the same game can trigger a squad-up post."),
      h("div", { class: "panel" }, servers.length > 1 ? field("Server", guild) : null, h("div", { class: "row" }, toggle, stamp)), out);
    out.replaceChildren(h("p", { class: "muted", text: "Loading…" }));
    await load();
    clearInterval(timer);
    timer = setInterval(() => { if (!alive()) return clearInterval(timer); stamp.textContent = loadedAt ? "Refreshes by itself every minute." : ""; if (!document.hidden) load(); }, NOWPLAYING_POLL_MS);
  }

  // ---------- game codes ----------
  /** Giveaway and code news the bot spotted, plus drops added in the member's own servers. Fills `into`. */
  async function promoBlock(into) {
    into.replaceChildren(h("h2", { text: "Giveaway news" }), h("p", { class: "muted", text: "Loading…" }));
    try {
      const d = await api("/api/promos");
      const ago = ms => { const m = Math.max(1, Math.round((Date.now() - ms) / 60000)); return m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago"; };
      into.replaceChildren(
        h("h2", { text: "Giveaway news" }),
        h("p", { class: "muted", text: "Key giveaways and code news the bot spots on the NVIDIA and SteelSeries blogs and in the Steam news of games like Dead by Daylight, plus anything the managers of your servers added. It is spotted automatically, so now and then one is a false alarm." }),
        h("div", { class: "panel" }, h("h3", { text: "From your servers" }),
          d.drops.length ? h("div", { class: "cards" }, d.drops.map(x => h(x.url ? "a" : "div", { class: "card-link", ...(x.url ? { href: x.url, target: "_blank", rel: "noopener noreferrer" } : {}) },
            h("span", { class: "icon", text: "🎟️" }), h("span", {}, h("strong", { text: x.title }), h("span", { class: "muted", text: `${x.server}${x.source ? " · " + x.source : ""}${x.code ? " · " + x.code : ""}${x.expiresAt ? " · ends " + new Date(x.expiresAt).toLocaleDateString() : ""}` }))))) : h("p", { class: "muted", text: "Nothing added in your servers right now. Server managers add drops under Servers, then Codes & promos." })),
        h("div", { class: "panel" }, h("h3", { text: "Spotted in the news" }),
          d.news.length ? h("div", { class: "cards" }, d.news.map(n => h("a", { class: "card-link", href: n.url, target: "_blank", rel: "noopener noreferrer" },
            h("span", { class: "icon", text: "📰" }), h("span", {}, h("strong", { text: n.title }), h("span", { class: "muted", text: `${n.source} · ${ago(n.seenAt)}` }))))) : h("p", { class: "muted", text: "Nothing yet. Posts that mention a giveaway or a code show up here as soon as they are published." })));
    } catch (e) { into.replaceChildren(h("h2", { text: "Giveaway news" }), h("div", { class: "notice warn", text: e.message })); }
  }

  // ---------- bundles: what the storefronts have running ----------
  async function bundlesView() {
    const st = { store: "", status: "active" };
    const list = h("div", { class: "muted", text: "Loading…" });
    const head = h("div", { class: "chips" });
    const owner = Boolean(state.me && state.me.isOwner);
    const when = ms => { const d = ms - Date.now(); if (d < 0) return "ended"; const days = Math.floor(d / 86400_000); return days >= 1 ? `ends in ${days} day${days === 1 ? "" : "s"}` : `ends in ${Math.max(1, Math.round(d / 3600_000))} h`; };
    async function load() {
      const d = await api("/api/bundlefeed?status=" + st.status + (st.store ? "&store=" + encodeURIComponent(st.store) : ""));
      head.replaceChildren(
        h("button", { class: "tab small" + (!st.store ? " active" : ""), text: "All stores", onclick: () => { st.store = ""; load().catch(fail); } }),
        ...d.stores.map(x => h("button", { class: "tab small" + (st.store === x.key ? " active" : ""), text: x.name, onclick: () => { st.store = x.key; load().catch(fail); } })),
        h("button", { class: "tab small" + (st.status === "expired" ? " active" : ""), text: st.status === "expired" ? "Showing ended" : "Show ended", onclick: () => { st.status = st.status === "expired" ? "active" : "expired"; load().catch(fail); } }));
      list.className = "";
      list.replaceChildren(d.bundles.length ? h("div", { class: "free-grid" }, d.bundles.map(b => h("div", { class: "free-card" + (b.status === "expired" ? " ended" : "") },
        b.image ? (() => { const img = h("img", { src: "/art/bundle/" + b.id + ".jpg", alt: "", loading: "lazy" }); let direct = false; img.addEventListener("error", () => { if (!direct) { direct = true; img.src = b.image; } else img.replaceWith(h("div", { class: "free-noart", text: b.storeName })); }); return img; })() : h("div", { class: "free-noart", text: b.storeName }),
        h("div", { class: "free-info" }, h("strong", { text: b.title }), h("div", { class: "muted small", text: b.storeName + (b.gameCount ? ` · ${b.gameCount} games` : "") }),
          b.price ? h("div", { text: b.price }) : null,
          b.games.length ? h("details", {}, h("summary", { class: "muted small", text: "See the games" }), h("ul", { class: "muted small" }, ...b.games.slice(0, 12).map(g => h("li", { text: g })), b.games.length > 12 ? h("li", { text: `and ${b.games.length - 12} more` }) : null)) : null,
          h("span", { class: "muted small", text: b.expiresAt ? when(b.expiresAt) : "no end date listed" }),
          h("div", { class: "row" }, b.status === "active" ? h("a", { class: "btn blue small", href: b.url, target: "_blank", rel: "noopener noreferrer", text: "Open on " + b.storeName }) : h("span", { class: "chip dim", text: "Ended" })))))
      ) : h("p", { class: "muted", text: st.status === "expired" ? "No ended bundles in the last week." : "No bundles listed right now. New ones show up here as soon as a store lists them." }));
    }
    const fail = e => list.replaceChildren(h("div", { class: "notice warn", text: e.message }));
    const poll = owner ? h("button", { class: "btn gray small", text: "Check for new bundles now" }) : null;
    if (poll) poll.addEventListener("click", () => busy(poll, async () => { const r = await api("/api/admin/bundles/poll", {}); toast(r.result.skipped ? "A check is already running." : `Checked: ${r.result.added} new, ${r.result.posted} posted.${r.result.feedError ? " Problems: " + r.result.feedError : ""}`, r.result.feedError ? "warn" : "ok"); await load(); }));
    app.replaceChildren(pageHead("Bundles", "Game bundles that are running now on Humble Bundle, Fanatical, IndieGala and the Steam store. Each one is listed once, with the games inside and when it ends where the store says. Server managers can have new ones posted in a channel from the Codes & promos tab of their server."),
      h("div", { class: "row" }, head, poll), list);
    load().catch(fail);
  }

  async function codesView() {
    const st = { game: "", status: "active" };
    const list = h("div", { class: "muted", text: "Loading…" });
    const head = h("div", { class: "chips" });
    const owner = Boolean(state.me && state.me.isOwner);
    const when = ms => { const d = ms - Date.now(); if (d < 0) return "ended"; const days = Math.floor(d / 86400_000); return days >= 1 ? `ends in ${days} day${days === 1 ? "" : "s"}` : `ends in ${Math.max(1, Math.round(d / 3600_000))} h`; };
    async function load() {
      const d = await api("/api/codes?status=" + st.status + (st.game ? "&game=" + encodeURIComponent(st.game) : ""));
      head.replaceChildren(
        h("button", { class: "tab small" + (!st.game ? " active" : ""), text: "All games", onclick: () => { st.game = ""; load().catch(fail); } }),
        ...d.families.map(x => h("button", { class: "tab small" + (st.game === x.key ? " active" : ""), text: x.title, onclick: () => { st.game = x.key; load().catch(fail); } })),
        h("button", { class: "tab small" + (st.status === "expired" ? " active" : ""), text: st.status === "expired" ? "Showing ended" : "Show ended", onclick: () => { st.status = st.status === "expired" ? "active" : "expired"; load().catch(fail); } }));
      list.className = "";
      list.replaceChildren(d.codes.length ? h("div", { class: "free-grid" }, d.codes.map(c => {
        const copy = h("button", { class: "btn blue small", text: "Copy code" });
        copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(c.code); toast("Copied.", "ok"); } catch { toast("Select the code and copy it by hand.", "warn"); } });
        const retire = owner && c.status === "active" ? h("button", { class: "btn red small", text: "Mark ended" }) : null;
        if (retire) retire.addEventListener("click", () => busy(retire, async () => { await api("/api/codes/retire", { id: c.id }); toast("Marked as ended. Server posts are being updated.", "ok"); await load(); }));
        return h("div", { class: "free-card" + (c.status === "expired" ? " ended" : "") },
          c.art ? h("img", { src: c.art, alt: "", loading: "lazy" }) : h("div", { class: "free-noart code-tile code-" + c.game, text: c.gameTitle }),
          h("div", { class: "free-info" }, h("strong", { text: c.gameTitle }), h("div", { text: c.reward || "Unknown reward" }),
            h("code", { class: "code-text", text: c.code }),
            h("span", { class: "muted small", text: `${c.platform || "All platforms"} · ${c.expiresAt ? when(c.expiresAt) : "no end date listed"}` }),
            c.note ? h("span", { class: "muted small", text: c.note + ". May only work on that region's account." }) : null,
            h("div", { class: "row" }, c.status === "active" ? copy : null, c.status === "active" ? ext(c.redeemUrl, c.provider === "hoyo" ? "Redeem" : c.provider === "community" ? "Redeem" : "Redeem on SHiFT", "btn gray small") : h("span", { class: "chip dim", text: "Ended" }), retire)));
      })) : h("p", { class: "muted", text: st.status === "expired" ? "No ended codes in the last two weeks." : "No working codes right now. New ones show up here as soon as they are listed." }));
    }
    const fail = e => list.replaceChildren(h("div", { class: "notice warn", text: e.message }));
    const poll = owner ? h("button", { class: "btn gray small", text: "Check for new codes now" }) : null;
    if (poll) poll.addEventListener("click", () => busy(poll, async () => { const r = await api("/api/admin/codes/poll", {}); toast(r.result.skipped ? "A check is already running." : `Checked: ${r.result.added} new, ${r.result.posted} posted.`, "ok"); await load(); }));
    const news = h("div");
    app.replaceChildren(pageHead("Codes & promos", "Limited-time codes for Borderlands (SHiFT), Genshin Impact, Honkai: Star Rail, Zenless Zone Zero, Destiny 2 and Warframe. Each one is listed once, under the right game, with an end date when one is known. Servers can have them posted in a channel. SHiFT codes come from mentalmars.com through a community mirror, the HoYoverse ones from two community code lists."), poll && h("div", { class: "panel" }, poll), head, list, news,
      h("p", { class: "muted small" }, "Want a message when something new drops? Turn on game code and giveaway alerts in ", h("a", { href: "#/alerts", text: "Alert settings" }), "."));
    load().catch(fail);
    promoBlock(news);
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
      const open = () => { navigate("/servers/" + g.id); };
      const stat = (icon, label, value) => h("div", { class: "sv-stat" }, h("span", { class: "sv-ico", text: icon }), h("span", { class: "muted", text: label }), h("b", { text: value }));
      const actions = g.bot === false
        ? [guildInvite(g) && g.manageable ? ext(guildInvite(g), "Add the bot", "btn green") : null, h("button", { class: "btn gray", text: "Details", onclick: open })]
        : [h("button", { class: "btn blue", text: g.manageable ? "Manage" : "Open", onclick: open })];
      return h("div", { class: "sv-card" + (g.bot === false ? " off" : "") },
        h("div", { class: "sv-top" }, serverIcon(g, "sv-icon"),
          h("div", { class: "sv-name" }, h("strong", { text: g.name }), h("div", { class: "sv-badges" }, g.manageable ? h("span", { class: "chip", text: "You manage this" }) : h("span", { class: "chip dim", text: "Member" }), botBadge(g)))),
        h("div", { class: "sv-stats" },
          stat("", "Alert channel", g.alertChannel ? "Set" : "Not set"),
          stat("", "Group alerts", g.groupMin ? `From ${g.groupMin} members` : "Off")),
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
              h("p", { class: "muted", text: "Limited-time codes for Borderlands, Genshin Impact, Star Rail, Zenless Zone Zero, Destiny 2 and Warframe, posted once each in the channel you pick. When a code ends, its post is greyed out. The same list is on the Game codes page for everyone." }),
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
            h("p", { class: "muted", text: "New bundles from Humble, Fanatical, IndieGala and Steam, posted once each in the channel you pick, with the games inside and when it ends. When a bundle ends, its post is greyed out." }),
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
              h("p", { class: "muted", text: "Key giveaways from SteelSeries, NVIDIA and others. Add a code or a link and it is posted once in your promo channel, then greyed out when it ends." }),
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
    const BOARDS = [["savings", "Most saved vs MSRP"], ["finished", "Backlog league (this month)"], ["hours", "Hours played this year"], ["games", "Biggest library"], ["completed", "Most games finished (all time)"]];
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
    const game = h("input", { type: "text", placeholder: "A game (leave empty to check your wishlist)", maxlength: "100" });
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
    const checkBtn = h("button", { class: "btn blue", text: "Check bundles", onclick: () => busy(checkBtn, loadBundles) });
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
    app.replaceChildren(pageHead("Check a deal", "Where a game is cheapest in the world, and whether a bundle is worth it. Planning a cart for a Steam sale is on the Sale planner page."),
      h("h2", { text: "Price by region" }), h("div", { class: "panel" }, field("Game", regionGame), h("p"), regionBtn), regionOut,
      h("h2", { text: "Bundle check" }), h("div", { class: "panel" }, field("Game", game), h("p"), checkBtn), bundlesOut,
      h("p", { class: "muted small" }, "Want a plan for the next sale? ", h("a", { href: "#/warroom", text: "Open the Sale planner" }), "."));
    loadBundles();
  }

  // ---------- steam link ----------
  // Steam game art. Newer games are not on the old path, so try the others in turn and show a quiet placeholder if none load.
  function steamArt(appid, cls, w, ht, itadId) {
    const urls = [...(appid ? [
      `/art/header/${appid}.jpg`,
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
      return h("div", { class: "subpanel" }, h("h4", { text: "Hours goal" }),
        g ? h("div", {}, h("div", { class: "bar", role: "img", "aria-label": g.pct + "% of the goal" }, (() => { const f = h("div", { class: "fill" }); f.style.width = g.pct + "%"; return f; })()),
          h("p", { class: "small", text: `${g.done} of ${g.goal} hours (${g.pct}%).` + (g.reached ? " Goal reached" : ` On this pace: about ${g.projected} by the end of the year${g.projected >= g.goal ? ", so you are on track" : ""}. You need about ${g.perWeek} hours a week.`) }))
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
    return h("div", { class: "panel" }, h("h3", { text: "Hours tracked since you linked" }),
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
        c.playing ? h("div", { class: "sc-playing", text: "Playing " + c.playing }) : null,
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

  /** Ties the viewer's Twitch account to their Discord account (read from their Discord connections), so !enter in a streamer's chat enters them. */
  function twitchLinkPanel() {
    const box = h("div", { class: "panel", id: "twitch-link" });
    async function draw() {
      let d; try { d = await api("/api/twitchlink"); } catch { box.replaceChildren(); return; }
      const back = /[?&]twitch=(1|none)/.exec(LOC.search)?.[1];
      if (back) { replaceUrl("/steam"); if (back === "1") toast("Twitch linked.", "ok"); }
      const off = h("button", { class: "btn gray small", type: "button", text: "Unlink" });
      off.addEventListener("click", () => busy(off, async () => { await api("/api/twitchlink", { action: "remove" }); toast("Unlinked.", "ok"); draw(); }));
      box.replaceChildren(h("h3", { text: "Twitch (enter giveaways from chat)" }),
        h("p", { class: "muted", text: "When a streamer runs a giveaway, you can type !enter in their Twitch chat to join. Link your Twitch once so the bot knows it is you. It reads the Twitch account shown in your Discord connections, so nobody can claim your name." }),
        back === "none" ? h("div", { class: "notice warn", text: "Discord doesn't show a Twitch account for you yet. In Discord open Settings, then Connections, add Twitch, then press the button again." }) : null,
        d.linked ? h("p", {}, "Linked to Twitch account ", h("b", { text: d.login }), ".") : null,
        h("div", { class: "row" }, h("a", { class: "btn blue", href: "/auth/twitch", text: d.linked ? "Link a different Twitch account" : "Link my Twitch" }), d.linked ? off : null));
    }
    draw();
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
            h("h3", { text: "" + n.pick.title }), h("p", { class: "muted", text: n.why }),
            n.others.length ? h("p", { class: "muted small", text: "Also good: " + n.others.map(o => o.title).join(", ") }) : null,
            h("p", { class: "muted small", text: n.remaining ? `${n.remaining} more to choose from.` : "That is everything left that you have not finished." })));
        }
        nextBtn.addEventListener("click", () => busy(nextBtn, pickNext));

        out.className = "";
        const valueImageBtn = h("button", { class: "btn gray small", type: "button", text: "Save as image", title: "The same picture /me steam value posts in Discord", onclick: e => busy(e.currentTarget, async () => {
          const res = await fetch("/api/steam/value.png", { credentials: "same-origin" });
          if (!res.ok) { let m = "Could not draw the picture."; try { m = (await res.json()).error || m; } catch { /* keep the default */ } throw new Error(m); }
          const url = URL.createObjectURL(await res.blob()), a = h("a", { href: url, download: "steam-account-value.png" }); a.click(); setTimeout(() => URL.revokeObjectURL(url), 4000);
        }) });
        const quickUnlink = h("button", { class: "btn red small", type: "button", text: "Unlink", title: "Unlink this profile (your games stay unless you remove them under Manage)", onclick: () => { if (confirm("Unlink this Steam profile? Your library games stay.")) busy(quickUnlink, async () => { await api("/api/steam/unlink", { removeGames: false }); toast("Unlinked.", "ok"); load(); }); } });
        out.replaceChildren(
          d.card ? steamProfileCard(d.card, quickUnlink) : null,
          analyticsPanel(cur, st),
          h("div", { class: "panel" }, h("div", { class: "panel-head" }, h("h3", { text: "Estimated account value" }), valueImageBtn),
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
      slot, out, twitchLinkPanel());
    if (/[?&]linked=1/.test(LOC.search)) {
      // Just came back from Steam: read the library straight away, then tidy the address.
      replaceUrl("/steam");
      out.className = "muted"; out.textContent = "Reading your Steam library…";
      api("/api/steam/sync", {}).then(r => { state.artForce = true; state.me.steam = { linked: true, verified: true, synced: true }; toast(`Signed in. Found ${r.owned} games` + (r.value && r.value.games ? ` worth ${money(r.value.msrp, r.value.currency)}` : "") + ".", "ok"); })
        .then(() => api("/api/wishlist/import", { profile: "" }).then(w => { if (w.added) { state.me.games += w.added; toast(`Also added ${w.added} game${w.added === 1 ? "" : "s"} from your Steam wishlist. I'll keep it in sync.`, "ok"); } }).catch(() => { /* private wishlist: the Wishlist page explains it */ }))
        .catch(e => toast(e.message, "error")).finally(load);
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
      vaultBox.replaceChildren(h("h3", { text: "Key vault" }),
        h("p", { class: "muted small", text: `${items.length} key${items.length === 1 ? "" : "s"} you revealed on Fanatical and have not redeemed. They stay in your browser; only the game titles are used to price them.` }),
        h("ul", { class: "plain" }, items.slice(0, 8).map(i => h("li", {}, h("b", { text: i.title }), " ", h("code", { text: mask(i.key) })))),
        items.length > 8 ? h("p", { class: "muted small", text: `and ${items.length - 8} more` }) : "",
        h("div", { class: "row" }, priceBtn, load), worth);
    }
    const keysIn = () => [...new Set((box.value.match(KEY_G) || []).map(k => k.toUpperCase()))].slice(0, 500);
    const MIN_EXT = "2.3.0"; // the first FanaticalGrabber version with the page bridge
    const versionLess = (a, b) => { const x = String(a).split(".").map(n => parseInt(n, 10) || 0), y = String(b).split(".").map(n => parseInt(n, 10) || 0); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); } return false; };
    const getLink = () => (state.cfg && state.cfg.fanaticalUrl ? h("a", { href: safeHref(state.cfg.fanaticalUrl), target: "_blank", rel: "noopener noreferrer", text: "Get it here" }) : "");
    const recheck = () => { const b = h("button", { class: "btn gray small", text: "Check again" }); b.addEventListener("click", () => { extSend({ svc: "page", type: "ping" }); setTimeout(() => { if (!ext) b.textContent = "Still not detected. Reload this page after updating."; }, 800); }); return b; };
    const mask = k => k.slice(0, 5) + "-•••••-" + k.slice(-5);
    function refresh() {
      const n = keysIn().length;
      found.textContent = n ? `${n} Steam key${n === 1 ? "" : "s"} found${n === 500 ? " (500 is the most per batch)" : ""}.` : "No keys yet.";
      go.disabled = !ext || running || !n;
    }
    function onMsg(e) {
      if (!fromExt(e)) return;
      const m = e.data;
      if (!m || m.svc !== "ext") return;
      if (m.type === "vault") { showVault(m.items || []); return; }
      if (m.type === "pong") {
        if (versionLess(m.version, MIN_EXT)) {
          ext = null; extFound = true;
          extState.className = "notice warn";
          extState.replaceChildren(`Your FanaticalGrabber is version ${String(m.version).slice(0, 12)}, but batch redeem needs ${MIN_EXT} or newer. Update it from the Chrome Web Store, then reload this page. `, getLink(), " ", recheck());
        } else {
          ext = m.version; extFound = true;
          extState.className = "notice ok";
          extState.textContent = `FanaticalGrabber ${ext} is ready. Make sure you are logged into Steam in this browser.`;
          const newest = state.cfg && state.cfg.extension && state.cfg.extension.latest;
          if (newest && versionLess(ext, newest)) { extState.className = "notice warn"; extState.replaceChildren(`FanaticalGrabber ${ext} is ready. A newer version (${newest}) is out with fixes and new features: update it from the Chrome Web Store. `, getLink()); }
        }
        refresh();
        if (ext) extSend({ svc: "page", type: "vault" });
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
    extSend({ svc: "page", type: "ping" });
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
      extSend({ svc: "page", type: "redeem", id: jobId, items: keys });
    }
    go.addEventListener("click", () => start(keysIn(), false));
    // A batch queued with /games redeem in Discord: shown here, started only when the member presses Run.
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
    stop.addEventListener("click", () => { extSend({ svc: "page", type: "stop", id: jobId }); progress.textContent = "Stopping after the current key…"; });
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
        c.goal ? h("div", {}, h("p", {}, h("b", { text: `${c.done} of ${c.goal} finished` }), c.done >= c.goal ? " Goal met!" : ` · ${c.daysLeft} day${c.daysLeft === 1 ? "" : "s"} left in ${c.month}`), progressBar(pct / 100))
          : h("p", { class: "muted", text: `Pick how many games you want to finish in ${c.month}.` }),
        h("p", { class: "muted small", text: c.streak ? `${c.streak}-month streak (best ${c.best})` : "No streak yet. Meet your goal this month to start one." }),
        c.titles.length ? h("p", { class: "muted small", text: "Finished: " + c.titles.join(", ") }) : "",
        c.history.length > 1 ? h("p", { class: "muted small", text: c.history.filter(x => x.month !== c.month).map(x => `${x.done >= x.goal ? "✅" : "▫️"} ${x.month} ${x.done}/${x.goal}`).join("   ") }) : "",
        h("div", { class: "row" }, field("Games to finish this month (0 clears)", goal), save));
    }
    api("/api/library/challenge").then(draw).catch(e => out.replaceChildren(h("div", { class: "notice warn", text: e.message })));
    return h("div", { class: "panel" }, h("h3", { text: "Backlog challenge" }),
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
    return h("details", { class: "panel" }, h("summary", { text: "Bundles you bought" }), out,
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
    return h("details", { class: "panel" }, h("summary", { text: "Trophy case" }), out);
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
    return h("div", { class: "panel" }, h("h3", { text: "What you have spent" }), out);
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
            const on = e => { if (fromExt(e) && e.data && e.data.svc === "ext" && (e.data.type === (type === "ping" ? "pong" : "connected"))) { window.removeEventListener("message", on); res(e.data); } };
            window.addEventListener("message", on); extSend({ svc: "page", type, ...extra });
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
        const unlocks = h("div", { class: "notice" }, h("b", { text: "The extension needs this link to work with the bot. " }), "Without it the extension only reveals and redeems keys. With it you also get, on Steam store pages: prices and your library status, playtest and demo badges, how many members of your server own the game, one-click wishlist and stream spotlight, and a toolbar count of new free games and alerts. Linking sends game names only, never keys.");
        grabberOut.replaceChildren(unlocks, h("p", { class: "muted small", text: link ? `Linked. ${link.sends} send${link.sends === 1 ? "" : "s"} so far${link.used_at ? `, last ${new Date(link.used_at).toLocaleDateString()}` : ""}.` : "Not linked. Press Connect the extension and you are done, no code to paste." }), h("p", {}, connect, " ", h("details", { class: "paste" }, h("summary", { text: "Or make a code to paste by hand" }), h("p", {}, make, " ", off))));
      } catch (e) { grabberOut.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }

    // Patch notes and announcements for the Steam games in the library and on the wishlist, loaded when asked for.
    function newsPanel() {
      const out = h("div", { class: "muted small", text: "Patch notes and announcements for the Steam games you play and want. Turn on alerts for them under Alerts." });
      const go = h("button", { class: "btn blue small", text: "Show the latest" });
      go.addEventListener("click", () => busy(go, async () => {
        const d = await api("/api/library/news");
        if (!d.known) { out.className = "notice warn"; out.textContent = "I don't know any of your Steam games yet. Link Steam on the Steam page or import your wishlist."; return; }
        if (!d.posts.length) { out.className = "muted small"; out.textContent = "No recent news for your games right now."; return; }
        out.className = "news-list";
        out.replaceChildren(...d.posts.map(p => h("a", { class: "news-card" + (p.patch ? " patch" : ""), href: p.url, target: "_blank", rel: "noopener noreferrer" },
          p.image ? h("img", { src: p.image, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : steamArt(p.appid, "news-art", 120, 56),
          h("div", { class: "news-text" }, h("div", { class: "news-game", text: (p.patch ? "🛠️ Patch notes · " : "📰 ") + p.game + " · " + new Date(p.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) }),
            h("div", { class: "news-title", text: p.title }), h("div", { class: "muted small", text: p.summary || "" })))));
        go.textContent = "Refresh";
      }));
      return h("div", { class: "panel" }, h("div", { class: "row" }, h("h3", { text: "News for your games" }), go), out);
    }

    const offered = [];
    const nextOut = h("div");
    const nextBtn = h("button", { class: "btn green", text: "Pick for me", onclick: () => busy(nextBtn, async () => {
      const d = await api("/api/library/next" + (offered.length ? "?skip=" + encodeURIComponent(offered.join(",")) : ""));
      if (!d.next) { nextOut.replaceChildren(h("div", { class: "notice warn", text: offered.length ? "That is everything in your backlog. Press again to start over." : "Nothing in your backlog." })); offered.length = 0; nextBtn.textContent = "Pick for me"; return; }
      const n = d.next;
      offered.push(n.pick.itad_id);
      nextBtn.textContent = "Pick another";
      nextOut.replaceChildren(h("div", { class: "panel" }, h("h3", { text: "Play next" }),
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
            h("div", {}, h("div", { class: "game-title", text: r.title }), (r.minutes || r.ach_total) ? h("div", { class: "muted small", text: [r.minutes ? hoursText(r.minutes) + " played" : null, r.ach_total ? `${r.ach_done}/${r.ach_total}` : null].filter(Boolean).join(" · ") }) : null));
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
              r.ach_total ? h("span", { text: `${r.ach_done}/${r.ach_total}` }) : null,
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
          newsPanel(),
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
    const level = select([["error", "Errors and crashes"], ["warn", "Errors and warnings"], ["activity", "Activity (what was done, restarts)"], ["all", "Everything"]], "error");
    const LABEL = { error: "ERROR", warn: "WARN", activity: "ACTION", info: "INFO" };
    const fmt = l => `${new Date(l.at).toLocaleString()}  ${(LABEL[l.level] ?? String(l.level ?? "info").toUpperCase()).padEnd(6)} ${l.earlier ? "(earlier run) " : ""}${l.text}`;
    let lastText = "";
    async function load() {
      out.textContent = "Loading…";
      try {
        const d = await api("/api/admin/logs?level=" + encodeURIComponent(level.value));
        lastText = d.lines.map(fmt).join("\n\n");
        out.textContent = d.available ? (lastText || (level.value === "activity" ? "No activity recorded yet." : "Nothing logged at this level. That is good news.")) : "Logging is not turned on.";
      } catch (e) { out.textContent = e.message; }
    }
    level.addEventListener("change", load);
    const refresh = h("button", { class: "btn gray", text: "Refresh", onclick: load });
    const copy = h("button", { class: "btn gray", text: "Copy", onclick: async () => { try { await navigator.clipboard.writeText(lastText); toast("Copied.", "ok"); } catch { toast("Could not copy. Select the text instead.", "error"); } } });
    const clear = h("button", { class: "btn red", text: "Clear logs" });
    clear.addEventListener("click", () => { if (!confirm("Clear all saved logs? This can't be undone.")) return; busy(clear, async () => { const r = await api("/api/admin/logs/clear", {}); toast(`Cleared ${r.cleared} line${r.cleared === 1 ? "" : "s"}.`, "ok"); await load(); }); });
    load();
    return h("div", { class: "panel" }, h("h3", { text: "Recent logs" }),
      h("p", { class: "muted small", text: "Newest first. ERROR is something that broke, WARN is worth a look, ACTION is something you or the bot did (broadcasts, giveaways, restarts). All are kept across restarts. Tokens and keys are hidden." }),
      h("div", { class: "rule inline" }, level, refresh, copy, clear), out);
  }

  /** Old links and bookmarks to #/admin land in the panel. */
  function adminRedirect() {
    app.replaceChildren(h("div", { class: "muted", text: "Opening the admin panel…" }));
    location.replace((state.me && state.me.adminUrl) || "/admin");
  }

  /** The data and page builders the admin panel (admin.html) is made from. The old in-dashboard Admin page is gone: the Admin button opens the panel. */
  async function adminView() {
    const opts = { shell: true };
    let d, ins, bugData;
    try { [d, ins, bugData] = await Promise.all([api("/api/admin/stats"), api("/api/admin/insights"), api("/api/admin/bugs")]); }
    catch (e) { throw e; }
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
        h("p", { class: "muted small", text: "Sent by members with /bot bug, /bot support open (type: bug) or the Support page. Open one to read the thread and reply." }),
        list.length ? h("div", { class: "scroll-y tall" }, list.map(b => h("div", { class: "bug-card" + (newOnes.has(b.id) ? " new" : "") },
          h("div", { class: "row" }, h("strong", { text: `#${b.id} ${b.subject}` }), newOnes.has(b.id) ? h("span", { class: "badge-count", text: "NEW" }) : null, h("span", { class: "chip dim", text: b.status })),
          h("div", { class: "muted small", text: `${b.user_name || b.user_id} · ${ago(b.created_at)}${b.replies ? " · " + b.replies + " repl" + (b.replies === 1 ? "y" : "ies") : ""}` }),
          h("p", { class: "bug-text", text: b.text }),
          h("a", { class: "btn gray small", href: "#/support/" + b.id, text: "Open ticket" })))) : h("p", { class: "muted", text: "No bug reports yet." }))];
    };

    const overview = () => [
      bugData.newCount ? h("div", { class: "notice warn" }, h("strong", { text: `${bugData.newCount} new bug report${bugData.newCount === 1 ? "" : "s"}. ` }), h("a", { href: opts.shell ? "#/bugs" : "#/admin", onclick: opts.shell ? undefined : (e => { e.preventDefault(); current = "bugs"; show(); }), text: "Read them" })) : null,
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
      ins.servers.length ? h("div", { class: "scroll-y tall" }, h("table", {}, h("thead", {}, h("tr", {}, ["Server", "Members", "Using the bot", "Alert channel", "Free feed", "Group alerts", "Digest", ""].map((c, i) => h("th", { class: i === 1 || i === 2 ? "num" : "", text: c })))),
        h("tbody", {}, ins.servers.map(g => h("tr", {}, h("td", {}, g.name || "Unknown server", h("div", { class: "muted small", text: g.id + (g.inServer === false ? " · bot has left" : "") })), h("td", { class: "num", text: n0(g.members) }), h("td", { class: "num", text: String(g.tracked) }),
          h("td", { text: g.channel ? "Yes" : "No" }), h("td", { text: g.freeFeed ? "On" : "Off" }), h("td", { text: g.groupMin ? "At " + g.groupMin : "Off" }), h("td", { text: g.digest ? "On" : "Off" }), h("td", {}, g.inServer === false ? null : (() => {
          const b = h("button", { class: "btn gray small", type: "button", text: "Get invite" });
          const out = h("div", { class: "muted small" });
          b.addEventListener("click", () => busy(b, async () => {
            const r = await api("/api/admin/server/invite", { id: g.id });
            const a = h("a", { href: r.url, target: "_blank", rel: "noopener noreferrer", text: r.url });
            out.replaceChildren("One use, expires in an hour: ", a);
          }));
          const act = (label, body, ask) => { const x = h("button", { class: "btn gray small", type: "button", text: label }); x.addEventListener("click", () => { if (ask && !confirm(ask)) return; busy(x, async () => { await api(body.path, body.data); toast("Done.", "ok"); route(); }); }); return x; };
          const acts = g.blocked ? [h("span", { class: "chip warn", text: "Blocked" }), act("Unblock", { path: "/api/admin/server/unblock", data: { id: g.id } })]
            : g.inServer === false ? [] : [act("Leave", { path: "/api/admin/server/leave", data: { id: g.id } }, `Make the bot leave ${g.name || g.id}? It can be invited back.`), act("Leave and block", { path: "/api/admin/server/leave", data: { id: g.id, block: true } }, `Leave ${g.name || g.id} and block it? If someone invites the bot back it will leave again until you unblock it.`)];
          return h("div", { class: "row" }, b, ...acts, out);
        })())))))) : h("p", { class: "muted", text: "No servers yet." }))];

    const members = () => {
      const ago = ms => { if (!ms) return "never"; const m = Math.floor((Date.now() - ms) / 60000); if (m < 2) return "just now"; if (m < 120) return m + " min ago"; const hr = Math.floor(m / 60); if (hr < 48) return hr + " hours ago"; return Math.floor(hr / 24) + " days ago"; };
      const setBan = async (uid, ban, reason) => { await api("/api/admin/ban", { id: uid, ban, reason }); };
      const askBan = uid => { const reason = prompt("Why are you restricting this person? (optional, only you see it)"); if (reason === null) return null; return reason; };

      // 1. Pick a server, see who's actually using the bot there.
      const pick = h("select", { "aria-label": "Server" }, h("option", { value: "", text: "Choose a server…" }), ...ins.servers.map(g => h("option", { value: g.id, text: (g.name || "Unknown server") + " (" + g.id + ")" })));
      const range = h("select", { "aria-label": "Activity" }, [["7", "Active in the last 7 days"], ["30", "Active in the last 30 days"], ["90", "Active in the last 90 days"], ["0", "Everyone who has used it"]].map(([v, t]) => h("option", { value: v, text: t, selected: v === "30" })));
      const search = h("input", { type: "search", placeholder: "Filter by name or ID", "aria-label": "Filter people" });
      const list = h("div", { class: "muted", text: "Pick a server to see its people." });
      let rows = [];
      const drawList = () => {
        const q = search.value.trim().toLowerCase();
        const shown = rows.filter(m => !q || m.id.includes(q) || (m.name || "").toLowerCase().includes(q) || (m.username || "").toLowerCase().includes(q));
        if (!shown.length) return list.replaceChildren(h("p", { class: "muted", text: rows.length ? "Nobody matches that." : "Nobody has been active here in that time." }));
        list.replaceChildren(h("div", { class: "scroll-y tall" }, h("table", {}, h("thead", {}, h("tr", {}, ["Person", "Last seen", "Wishlist", "Alerts", ""].map((c, i) => h("th", { class: i === 2 || i === 3 ? "num" : "", text: c })))),
          h("tbody", {}, shown.map(m => {
            const b = h("button", { class: "btn small " + (m.banned ? "green" : "red"), text: m.banned ? "Lift restriction" : "Restrict" });
            b.addEventListener("click", () => busy(b, async () => {
              if (m.banned) { await setBan(m.id, false); m.banned = false; toast("Restriction lifted.", "ok"); }
              else { const r = askBan(m.id); if (r === null) return; await setBan(m.id, true, r); m.banned = true; m.banReason = r; toast("Restricted. They're signed out and the bot ignores them.", "ok"); }
              drawList(); loadBans();
            }));
            return h("tr", { class: m.banned ? "banned" : "" }, h("td", {}, m.name || m.username || "Member", m.banned ? h("span", { class: "pill red", text: " restricted" }) : "", h("div", { class: "muted small", text: m.id + (m.banned && m.banReason ? " · " + m.banReason : "") })),
              h("td", { text: ago(m.lastSeen) }), h("td", { class: "num", text: String(m.wishlist) }), h("td", { class: "num", text: String(m.alerts) }), h("td", {}, b));
          })))));
      };
      const load = async () => {
        if (!pick.value) { rows = []; return list.replaceChildren(h("p", { class: "muted", text: "Pick a server to see its people." })); }
        list.replaceChildren(h("p", { class: "muted", text: "Loading…" }));
        try { rows = (await api("/api/admin/server-members?guild=" + pick.value + "&days=" + range.value)).members; drawList(); }
        catch (e) { list.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
      };
      pick.addEventListener("change", load); range.addEventListener("change", load); search.addEventListener("input", drawList);

      // 2. Everyone currently restricted.
      const banBox = h("div");
      async function loadBans() {
        try {
          const { bans } = await api("/api/admin/bans");
          banBox.replaceChildren(bans.length ? h("div", {}, ...bans.map(x => {
            const lift = h("button", { class: "btn green small", text: "Lift restriction" });
            lift.addEventListener("click", () => busy(lift, async () => { await setBan(x.discord_id, false); toast("Restriction lifted.", "ok"); loadBans(); if (pick.value) load(); }));
            return h("div", { class: "row", style: "align-items:center;justify-content:space-between;gap:12px" }, h("span", { text: x.discord_id + (x.reason ? " · " + x.reason : "") + " · " + new Date(x.at).toLocaleDateString() }), h("div", { style: "flex:none" }, lift));
          })) : h("p", { class: "muted", text: "Nobody is restricted." }));
        } catch (e) { banBox.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
      }
      loadBans();

      // 3. Look up anyone by ID.
      const id = h("input", { type: "text", inputmode: "numeric", placeholder: "Discord user ID (paste it, or a mention)", maxlength: "30", "aria-label": "Discord user ID" });
      const out = h("div");
      const draw = u => {
        const act = (label, action, cls = "gray") => { const b = h("button", { class: "btn " + cls + " small", text: label }); b.addEventListener("click", () => busy(b, async () => { draw(await api("/api/admin/user", { id: u.id, action })); toast("Done.", "ok"); })); return b; };
        const banBtn = h("button", { class: "btn small " + (u.banned ? "green" : "red"), text: u.banned ? "Lift restriction" : "Restrict from bot and dashboard" });
        banBtn.addEventListener("click", () => busy(banBtn, async () => {
          if (u.banned) await setBan(u.id, false); else { const r = askBan(u.id); if (r === null) return; await setBan(u.id, true, r); }
          u.banned = !u.banned; draw(u); loadBans(); if (pick.value) load();
        }));
        out.replaceChildren(h("div", { class: "panel" }, h("h3", { text: "Member " + u.id }),
          u.banned ? h("div", { class: "notice warn", text: "This person is restricted." }) : "",
          h("div", { class: "grid four" }, tile("Joined", new Date(u.joined).toLocaleDateString()), tile("Wishlist", u.wishlist), tile("Library", u.library), tile("Alerts received", u.alerts)),
          h("p", { text: `Region ${u.region} · delivery by ${u.delivery} · language ${u.lang} · last seen ${ago(u.lastSeen)} · ${u.paused ? "alerts paused" : "alerts on"} · ${u.dmFailures} failed DMs · ${u.share ? "on server boards" : "not on server boards"} · Steam ${u.steam ? "linked" : "not linked"} · grabber ${u.grabber ? "linked" : "not linked"}` }),
          h("div", { class: "row" }, act("Reset failed DMs", "reset_dm"), u.paused ? act("Resume alerts", "resume", "green") : act("Pause alerts", "pause"), banBtn)));
      };
      const find = h("button", { class: "btn blue", text: "Look up" });
      const go = () => busy(find, async () => { try { draw(await api("/api/admin/user?id=" + encodeURIComponent(id.value.replace(/\D/g, "")))); } catch (e) { out.replaceChildren(h("div", { class: "notice warn", text: e.message })); } });
      find.addEventListener("click", go);
      id.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
      return [
        h("div", { class: "panel" }, h("h3", { text: "People by server" }),
          h("p", { class: "muted small", text: "Choose a server to see who's using the bot there, most recent first. Restricting someone stops the bot answering them, ends their dashboard sign-in and stops alerts to them. Counts only; no games, keys or messages." }),
          h("div", { class: "lookup-row" }, pick, range), h("div", { class: "lookup-row" }, search), list),
        h("div", { class: "panel" }, h("h3", { text: "Restricted people" }), banBox),
        h("div", { class: "panel" }, h("h3", { text: "Look up by ID" }),
          h("p", { class: "muted small", text: "Find anyone who has used the bot, even if you don't know their server." }), h("div", { class: "lookup-row" }, id, find)), out];
    };

    const tools = () => {
      const clear = h("button", { class: "btn gray small", text: "Reset failed DMs for everyone" });
      clear.addEventListener("click", () => busy(clear, async () => { const r = await api("/api/admin/clear-dm-failures", {}); toast(`Reset for ${r.cleared} member${r.cleared === 1 ? "" : "s"}.`, "ok"); }));
      return [
        h("div", { class: "panel" }, h("h3", { text: "Backup" }),
          h("p", { text: "Last backup: " + (hl.backup ? `${when(hl.backup.at)} (${hl.backup.ok ? "ok" : "FAILED"})` : "none yet") }),
          h("p", {}, h("a", { href: "/api/admin/backup", class: "btn gray small", download: "" }, "Download the latest backup"), h("span", { class: "muted small", text: "  (the whole database, including encrypted giveaway keys. Keep it private.)" }))),
        (() => {
          const box = h("div", { class: "panel" }, h("h3", { text: "Offsite backup" }), h("p", { class: "muted", text: "Checking…" }));
          const size = n => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
          const load = async () => {
            try {
              const o = await api("/api/admin/offsite");
              if (!o.enabled) return box.replaceChildren(h("h3", { text: "Offsite backup" }), h("p", { text: "Not set up. Right now the backups live on the same disk as the database, so losing that disk loses both." }),
                h("p", { class: "muted small", text: "To switch it on, create a Tigris storage bucket from your Fly dashboard (Storage) and attach it to this app. Fly adds the access keys as secrets for you. Any other S3-style bucket works too, using the secrets BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_KEY and BACKUP_S3_SECRET. Restart the app afterwards." }));
              const check = h("button", { class: "btn gray small", type: "button", text: "Test the newest copy" }), out = h("p", { class: "muted small" });
              check.addEventListener("click", () => busy(check, async () => {
                try { const r = await api("/api/admin/offsite/verify", {}); out.className = r.ok ? "" : "bad"; out.textContent = r.ok ? `Good: ${r.key.split("/").pop()} downloaded, opened and passed the integrity check (${Number(r.users).toLocaleString()} members, ${size(r.bytes)}).` : "The copy downloaded but failed the integrity check."; }
                catch (e) { out.className = "bad"; out.textContent = e.message; }
              }));
              box.replaceChildren(h("h3", { text: "Offsite backup" }),
                h("p", { text: o.last ? `Last upload: ${when(o.last.at)} · ${size(o.last.bytes)}${o.last.encrypted ? " · encrypted" : " · not encrypted (set KEY_ENCRYPTION_SECRET to encrypt)"}` : "Nothing uploaded yet. The next daily backup sends the first one." }),
                o.error ? h("p", { class: "bad", text: "Could not read the bucket: " + o.error }) : o.list.length ? h("table", {}, h("thead", {}, h("tr", {}, [h("th", { text: "Copy" }), h("th", { text: "Size" })])), h("tbody", {}, o.list.map(x => h("tr", {}, h("td", { text: x.key.split("/").pop() }), h("td", { text: size(x.size) }))))) : null,
                h("p", {}, check), out);
            } catch (e) { box.replaceChildren(h("h3", { text: "Offsite backup" }), h("p", { class: "bad", text: e.message })); }
          };
          load();
          return box;
        })(),
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
      const mention = select([["none", "No ping"], ["everyone", "@everyone"], ["here", "@here"]], "none");
      const mentionRow = field("Ping in server channels", mention);
      const preview = h("div", { class: "notice" });
      const progress = h("div"), history = h("div");
      const send = h("button", { class: "btn red", type: "button", text: "Send announcement" });
      const test = h("button", { class: "btn gray", type: "button", text: "Send a test to me only" });
      let info = null, timer = 0;
      const box = h("div");
      const promoPanel = () => {
        const pWho = select([["me", "Only me (preview)"], ["dm", `DMs to members who have not opted out (${info.counts.promoDm})`], ["channels", `Every server's #announcements channel (${info.counts.channels})`], ["both", `Both (${info.counts.promoDm + info.counts.channels})`]], "me");
        const pConfirm = h("input", { type: "text", placeholder: "SEND", maxlength: "4", autocomplete: "off", "aria-label": "Type SEND to confirm" });
        const pBtn = h("button", { class: "btn red", type: "button", text: "Send the advertisement" });
        pBtn.addEventListener("click", () => busy(pBtn, async () => {
          const r = await api("/api/admin/broadcast", { kind: "promo", audience: pWho.value, confirm: pConfirm.value });
          toast(pWho.value === "me" ? "Preview sent to your DMs." : `Sending to ${r.total} places. You can leave this page.`, "ok");
          if (pWho.value !== "me") pConfirm.value = "";
          await refresh();
        }));
        return h("div", { class: "panel" }, h("h3", { text: "Advertise FanaticalGrabber" }),
          h("p", { class: "muted small", text: "A message from you (marked as from the bot developer) that lists the extension's features with example pictures, with Get it, Open the dashboard and No more promos buttons. Only people the bot already knows are messaged, and anyone who presses No more promos is skipped from then on. Always send yourself the preview first. /bot grabberad does the same in Discord." }),
          h("div", { class: "grid three" }, ["hero", "cart", "paid"].map(n => h("img", { src: `/grabber-ad-${n}.png`, alt: "", loading: "lazy", width: "300", height: "158", class: "ad-thumb" }))),
          h("div", { class: "row" }, field("Send to", pWho), field("Type SEND to confirm", pConfirm)), h("div", { class: "row" }, pBtn));
      };
      const quickPanel = () => {
        const kinds = { restart: ["Restarting for an update", "Tells people the bot is restarting, that nothing is lost and that missed alerts catch up."], dev: ["Still in active development", "A heads-up that updates and random downtime are normal while the bot is being built, and where to report bugs."], thanks: ["Thank you", "A thank-you note from you for using the bot."] };
        const pick = select(Object.entries(kinds).map(([k, v]) => [k, v[0]]), "restart");
        const pWho = select([["me", "Only me (preview)"], ["dm", `DMs to members (${info.counts.dm})`], ["channels", `Every server's #announcements channel (${info.counts.channels})`], ["both", `Both (${info.counts.dm + info.counts.channels})`]], "me");
        const pConfirm = h("input", { type: "text", placeholder: "SEND", maxlength: "4", autocomplete: "off", "aria-label": "Type SEND to confirm" });
        const img = h("img", { src: "/notice-restart.png", alt: "", class: "preset-img", width: "1200", height: "630", loading: "lazy" });
        const blurb = h("p", { class: "muted small", text: kinds.restart[1] });
        pick.addEventListener("change", () => { img.src = `/notice-${pick.value}.png`; blurb.textContent = kinds[pick.value][1]; });
        const pBtn = h("button", { class: "btn red", type: "button", text: "Send this announcement" });
        pBtn.addEventListener("click", () => busy(pBtn, async () => {
          const r = await api("/api/admin/broadcast", { kind: "preset", preset: pick.value, audience: pWho.value, confirm: pConfirm.value });
          toast(pWho.value === "me" ? "Preview sent to your DMs." : `Sending to ${r.total} places. You can leave this page.`, "ok");
          if (pWho.value !== "me") pConfirm.value = "";
          await refresh();
        }));
        return h("div", { class: "panel" }, h("h3", { text: "Ready-made announcements" }),
          h("p", { class: "muted small", text: "Pre-written, with a picture and buttons, marked as from the bot developer. Send yourself a preview first." }),
          h("div", { class: "row" }, field("Announcement", pick), field("Send to", pWho), field("Type SEND to confirm", pConfirm)), blurb, img, h("div", { class: "row" }, pBtn));
      };
      const paintPreview = () => {
        count.textContent = msg.value.length + " / 1500";
        preview.replaceChildren(h("div", { class: "muted small", text: "Official message from the Steam Value Checker developer" }), h("strong", { text: title.value.trim() || "Steam Value Checker notice" }), h("div", { text: msg.value.trim() || "Your message shows here." }), h("div", { class: "muted small", text: "Sent by the bot's owner/developer to every server using Steam Value Checker. It is not from this server's staff." }));
      };
      who.addEventListener("change", () => syncMention());
      const syncMention = () => { mentionRow.hidden = who.value === "dm" || who.value === "me"; if (mentionRow.hidden) mention.value = "none"; };
      const paintWho = () => {
        const c = info.counts;
        who.replaceChildren(...[["dm", `DMs to members (${c.dm})`], ["channels", `Every server's #announcements channel (${c.channels})`], ["both", `Both (${c.dm + c.channels})`]].map(([v, t]) => h("option", { value: v, text: t })));
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
        const keep = who.value; paintWho(); if (keep) who.value = keep; syncMention();
        paintProgress(info.current); paintHistory();
        clearTimeout(timer);
        if (info.current && document.body.contains(box)) timer = setTimeout(() => refresh().catch(() => {}), 2500);
      }
      const go = async audience => {
        const r = await api("/api/admin/broadcast", { title: title.value, body: msg.value, audience, confirm: confirm.value, mention: mention.value });
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
            h("div", { class: "row" }, field("Send to", who), mentionRow, field("Type SEND to confirm", confirm)),
            h("p", { class: "muted small", text: "The ping only goes on the server-channel copy (never DMs). Each server needs to let the bot mention everyone, otherwise Discord just shows the text." }),
            h("div", { class: "row" }, test, send)),
          quickPanel(), promoPanel(),
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
      const gImage = h("input", { type: "url", maxlength: "500", placeholder: "https://… (picture, GIF or video)", "aria-label": "Big picture link" });
      const gThumb = h("input", { type: "url", maxlength: "500", placeholder: "https://… (small picture or GIF)", "aria-label": "Small picture link" });
      const gColor = h("input", { type: "text", maxlength: "8", placeholder: "#ff9800", "aria-label": "Colour" });
      const gLabel = h("input", { type: "text", maxlength: "40", placeholder: "Enter giveaway", "aria-label": "Enter button text" });
      const gp = giveawayPreview(() => ({ title: title.value.trim(), desc: desc.value.trim(), keys: keys.value, image: gImage.value, thumb: gThumb.value, color: gColor.value, label: gLabel.value.trim(), length: length.value.trim(), host: "you" }));
      for (const el of [title, desc, keys, gImage, gThumb, gColor, gLabel, length]) el.addEventListener("input", gp.paint);
      const steamOnly = h("input", { type: "checkbox" });
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
        const r = await api("/api/admin/giveaways/create", { title: title.value, game: game.value, description: desc.value, image: gImage.value, thumbnail: gThumb.value, color: gColor.value, button_label: gLabel.value, steam_verified: steamOnly.checked, keys: keys.value, length: length.value, claim_hours: claim.value, audience: who.value, confirm: confirm.value,
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
            field("Title", title), field("Game (for the artwork)", game), field("Description", desc),
            h("label", { class: "check" }, steamOnly, " Only Steam Verified members can enter (checked on their account, so it works in every server)"),
            field("Prizes (one per line)", keys), prizeButtons(keys, gp.paint),
            h("p", { class: "muted small", text: "Game keys, Nitro links and gift card codes are handed out by the Claim button. Money and other prizes have no code: you get a DM when a winner claims one and you send it yourself." }),
            h("h4", { text: "Look" }),
            h("div", { class: "grid two" }, h("div", {},
              h("div", { class: "row" }, field("Big picture, GIF or video link", gImage), field("Small picture or GIF link", gThumb)),
              h("div", { class: "row" }, field("Colour", gColor), field("Enter button text", gLabel)),
              h("p", { class: "muted small", text: "Leave the big picture empty to use the game's artwork. Use a direct, permanent link to a picture (.png, .jpg, .gif, .webp)." })),
              h("div", {}, h("b", { text: "Preview" }), gp.el)),
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
          h("div", { class: "grid four" }, tile("Servers using community", t.servers, `${t.built} built with /manage community setup`), tile("Welcome on", t.welcomeOn, "servers"), tile("XP on", t.xpOn, `${n0(t.xpMembers)} members earning`), tile("Total XP earned", n0(t.xpTotal)),
            tile("Joins tracked", n0(t.joins), `${n0(t.referred)} through an invite`), tile("Personal invite links", n0(t.inviteLinks)), tile("Level rewards set", n0(t.levelRoles), `${n0(t.rewards)} referral rewards`), tile("Role picker roles", n0(t.selfRoles)), tile("Moderation cases", n0(t.modCases), `${t.modServers} servers · ${n0(t.activeWarnings)} active warnings`)),
          h("div", { class: "panel" }, h("h3", { text: "Feature use" }),
            table(["What", "Times", "Last used"], [row("Server built automatically (fresh server)", "setup_auto"), row("Server built with /manage community setup", "setup_manual"), row("Server built from the dashboard", "dash_setup"), row("Channels created", "channels_created"), row("Welcome messages posted", "welcomes"), row("Welcome DMs sent", "welcome_dms"), row("Welcome DMs that could not be delivered", "welcome_dm_failed"),
              row("Joins tracked", "joins_tracked"), row("Referrals credited", "referrals"), row("Invite links made", "invite_links"), row("Level-ups", "level_ups"), row("Roles picked from the panel", "role_picks"), row("Emoji added", "emoji_added"), row("Emoji added from the dashboard", "dash_emoji"), row("Emoji images uploaded on the dashboard", "dash_emoji_upload"), row("Steam Verified roles given", "steam_verified_roles"),
              row("/server rank used", "cmd:rank"), row("/server levels used", "cmd:levels"), row("/server invites me used", "cmd:invites/me"), row("/server invites top used", "cmd:invites/top"), row("/server invites link used", "cmd:invites/link"), row("/manage emoji import used", "cmd:emoji/import"), row("/manage emoji list used", "cmd:emoji/list"), row("/manage community used", "cmd:community/status"),
              row("Warnings", "mod_warn"), row("Timeouts", "mod_timeout"), row("Timeouts lifted", "mod_untimeout"), row("Kicks", "mod_kick"), row("Bans", "mod_ban"), row("Unbans", "mod_unban"), row("Message cleanups", "mod_purge"), row("Messages deleted", "mod_messages_cleared"), row("Warnings cleared", "mod_warnings_cleared"), row("Moderation done on the dashboard", "dash_mod"), row("/mod warn used", "cmd:mod/warn"), row("/mod timeout used", "cmd:mod/timeout"), row("/mod kick used", "cmd:mod/kick"), row("/mod ban used", "cmd:mod/ban"), row("/mod purge used", "cmd:mod/purge"), row("/mod cases used", "cmd:mod/cases")])),
          h("div", { class: "panel" }, h("h3", { text: "Cross-server giveaways" }),
            h("div", { class: "grid four" }, tile("Cross-server giveaways", g.crossServer), tile("Hosted by a partner", g.partner), tile("With entry steps", g.withSteps), tile("Entries", n0(g.crossEntries))),
            h("h4", { text: "Partners" }), table(["Partner", "Giveaways", "Entries"], g.partners.map(p => [p.name, p.giveaways, n0(p.entries)]))),
          h("div", { class: "panel" }, h("h3", { text: `Servers (${c.servers.length})` }),
            table(["Server", "Built", "Welcome", "XP", "Members with XP", "XP total", "Joins", "Through an invite", "Level roles", "Mod cases"], c.servers.map(r => [r.name || r.id, r.setup_at ? "Yes" : "No", r.welcome_on ? "On" : "Off", r.xp_on ? `On ×${r.xp_mult}` : "Off", n0(r.xp_members), n0(r.xp_total), n0(r.joins), n0(r.referred), r.level_roles, n0(r.mod_cases)]))));
      }).catch(e => box.replaceChildren(h("div", { class: "notice warn", text: e.message })));
      return [box];
    };

    const giftsTab = () => {
      const box = h("div", { class: "muted", text: "Loading…" });
      const load = () => api("/api/admin/gifts").then(r => {
        box.className = "";
        const act = (id, action, label, cls) => { const b = h("button", { class: "btn " + cls + " small", type: "button", text: label }); b.addEventListener("click", () => busy(b, async () => { await api("/api/admin/gifts", { claimer: id, action }); toast("Done.", "ok"); await load(); })); return b; };
        const who = x => `${x.name || "Unknown name"} (${x.claimer_id})`;
        box.replaceChildren(h("div", { class: "panel" }, h("h3", { text: "Gift mark reports" }),
          h("p", { class: "muted small", text: "List owners release a mark and report it when it looks fake. Three reports in 60 days blocks the account from marking gifts automatically, and its marks are removed." }),
          r.reports.length ? h("div", { class: "scroll-y" }, r.reports.map(x => h("div", { class: "bug-card" }, h("strong", { text: who(x) }),
            h("div", { class: "muted small", text: `${x.reports} report${x.reports === 1 ? "" : "s"} · last ${when(x.last_at)} · lists: ${x.lists || "?"} · games: ${x.games || "?"} · holds ${x.holding} now` }),
            h("div", { class: "row" }, x.banned ? h("span", { class: "chip warn", text: "Blocked" }) : act(x.claimer_id, "ban", "Block", "red"), x.banned ? act(x.claimer_id, "unban", "Unblock and clear", "gray") : act(x.claimer_id, "dismiss", "Dismiss reports", "gray"))))) : h("p", { class: "muted", text: "No reports." })),
          h("div", { class: "panel" }, h("h3", { text: "Blocked from gift marks" }),
            r.bans.length ? h("div", { class: "scroll-y" }, r.bans.map(x => h("div", { class: "row" }, h("span", { text: `${x.claimer_id} · ${x.auto ? "automatic" : "by you"} · ${when(x.at)} · ${x.reason}` }), act(x.claimer_id, "unban", "Unblock", "gray")))) : h("p", { class: "muted", text: "Nobody is blocked." })));
      }).catch(e => { box.className = ""; box.replaceChildren(h("div", { class: "notice warn", text: e.message })); });
      load();
      return [box];
    };
    const socialTab = () => {
      const box = h("div", { class: "muted", text: "Loading…" });
      const load = () => api("/api/admin/social").then(r => {
        box.className = "";
        const act = (body, label, cls, ok) => { const b = h("button", { class: "btn " + cls + " small", type: "button", text: label }); b.addEventListener("click", () => busy(b, async () => { await api("/api/admin/social", body); toast(ok, "ok"); await load(); })); return b; };
        box.replaceChildren(h("div", { class: "panel" }, h("h3", { text: "Reported posts" }),
          h("p", { class: "muted small", text: "Three different people reporting a post hides it until you decide. Restore keeps it, Delete removes it and any replies, and Block stops the author posting." }),
          r.reports.length ? h("div", { class: "scroll-y" }, r.reports.map(x => h("div", { class: "bug-card" }, h("strong", { text: `${x.by.name}${x.slug ? " (@" + x.slug + ")" : ""}` }),
            h("div", { class: "muted small", text: `${x.reports} report${x.reports === 1 ? "" : "s"} · last ${when(x.last_at)}${x.hidden ? " · hidden" : ""}${x.reasons ? " · " + x.reasons : ""}` }),
            h("p", { text: x.snapshot }),
            h("div", { class: "row" }, act({ action: "dismiss", id: x.feed_id }, "Restore", "gray", "Restored."), act({ action: "delete", id: x.feed_id }, "Delete", "red", "Deleted."), act({ action: "ban", id: x.feed_id, reason: "reported posts" }, "Delete and block author", "red", "Blocked."))))) : h("div", { class: "empty", text: "Nothing reported." })),
          h("div", { class: "panel" }, h("h3", { text: "Blocked from posting" }),
            r.bans.length ? h("div", { class: "scroll-y" }, r.bans.map(x => h("div", { class: "row" }, h("span", { text: `${x.by.name}${x.slug ? " (@" + x.slug + ")" : ""} · ${when(x.at)}${x.reason ? " · " + x.reason : ""}` }), act({ action: "unban", user: x.discord_id }, "Unblock", "gray", "Unblocked.")))) : h("div", { class: "empty", text: "Nobody." })));
      }).catch(e => { box.className = ""; box.replaceChildren(h("div", { class: "notice warn", text: e.message })); });
      load();
      return [box];
    };
    const requestsTab = () => { const box = h("div", { class: "muted", text: "Loading…" }); requestList(box, { admin: true }).then(() => { box.className = ""; }); return [box]; };
    const musicTab = () => {
      const box = h("div", { class: "muted", text: "Loading…" });
      const load = () => api("/api/admin/music").then(r => {
        box.className = "";
        const force = (gid, action, b) => busy(b, async () => { await api("/api/admin/music", { guild_id: gid, action }); toast(action === "leave" ? "Left." : "Stopped.", "ok"); await load(); });
        const rows = r.sessions.map(x => { const st = h("button", { class: "btn gray small", type: "button", text: "Stop" }), lv = h("button", { class: "btn red small", type: "button", text: "Leave" }); st.addEventListener("click", () => force(x.guildId, "stop", st)); lv.addEventListener("click", () => force(x.guildId, "leave", lv));
          return h("div", { class: "cal-row" }, h("span", { text: x.track?.live ? "📻" : "🎵" }), h("div", {}, h("b", { text: x.guildName }), h("div", { class: "muted small", text: [x.channelName ? "in " + x.channelName : "", x.track ? x.track.title + (x.track.live ? " (live)" : x.track.auto ? " (Auto DJ)" : "") : "idle", `${x.queue} queued`, `${x.listeners} listening`, x.autoDj ? "Auto DJ on" : ""].filter(Boolean).join(" · ") })), h("div", { class: "row" }, st, lv)); });
        box.replaceChildren(h("div", { class: "panel" }, h("h3", { text: `Voice sessions (${r.sessions.length})` }), h("p", { class: "muted small", text: "Every server where the bot is in a voice channel right now. Stop clears the queue and the Auto DJ stays quiet until someone adds a song; Leave disconnects." }), r.sessions.length ? h("div", { class: "scroll-y tall" }, ...rows) : h("p", { class: "muted", text: "The bot isn't in any voice channel." })));
      }).catch(e => { box.className = ""; box.replaceChildren(h("div", { class: "notice warn", text: e.message })); });
      load();
      return [box];
    };
    const panelsTab = () => {
      const box = h("div", { class: "muted", text: "Loading…" });
      api("/api/admin/panels").then(r => {
        box.className = "";
        box.replaceChildren(h("div", { class: "panel" }, h("h3", { text: `Run from panels (${n0(r.total)})` }),
          h("p", { class: "muted small", text: "How often each command was run with the Run button in a menu or panel. Typed commands are not counted here." }),
          r.rows.length ? table(["Command", "Runs"], r.rows.map(x => [x.command, n0(x.runs)])) : h("p", { class: "muted", text: "Nothing yet." })));
      }).catch(e => { box.className = ""; box.replaceChildren(h("div", { class: "notice warn", text: e.message })); });
      return [box];
    };
    // ---- live settings: every adjustable value, saved with one button and applied at once ----
    const settingsPanels = (view, groupKeys, after) => {
      const inputs = new Map();
      const control = def => {
        let el;
        if (def.type === "bool") { el = h("input", { type: "checkbox", checked: Boolean(def.value) }); inputs.set(def.key, () => el.checked); return h("label", { class: "check" }, el, " " + def.label); }
        if (def.type === "int") el = h("input", { type: "number", min: def.min, max: def.max, step: "1", value: String(def.value) });
        else if (def.type === "enum") el = select(def.options, def.value);
        else if (def.type === "text") { el = h("textarea", { rows: "4", maxlength: String(def.maxLen) }); el.value = def.value; }
        else if (def.key === "ai_model") {
          const anth = (view.settings.find(x => x.key === "ai_provider") || {}).value === "anthropic";
          const known = anth && view.models.some(([v]) => v === def.value);
          const pick = select(anth ? [...view.models, ["__custom", "Another model…"]] : [["__custom", "Model name…"]], known ? def.value : "__custom");
          if (!anth) pick.hidden = true;
          const custom = h("input", { type: "text", maxlength: "100", placeholder: "model name", value: known ? "" : def.value });
          custom.hidden = known;
          pick.addEventListener("change", () => { custom.hidden = pick.value !== "__custom"; });
          inputs.set(def.key, () => (pick.value === "__custom" ? custom.value.trim() : pick.value));
          const dl = h("datalist", { id: "ai-bot-models" }); custom.setAttribute("list", "ai-bot-models"); custom.setAttribute("autocomplete", "off");
          const loadBtn = h("button", { class: "btn gray small", type: "button", text: "Load models" });
          loadBtn.addEventListener("click", () => busy(loadBtn, async () => {
            const r = await api("/api/admin/ai/models", {});
            dl.replaceChildren(...r.models.map(m => h("option", { value: m })));
            if (pick.value !== "__custom") { custom.value = def.value; pick.value = "__custom"; custom.hidden = false; }
            toast(`${r.models.length} models found. Click the model box to pick one.`, "ok");
          }));
          return h("div", {}, h("label", { text: def.label }), pick, custom, dl, h("div", { class: "row" }, loadBtn), h("p", { class: "muted small", text: def.help + " Load models asks the service what the bot's key can use." }));
        } else el = h("input", { type: "text", maxlength: String(def.maxLen), value: def.value });
        inputs.set(def.key, () => (def.type === "int" ? Number(el.value) : el.value));
        return h("div", {}, h("label", { text: def.label }), el, h("p", { class: "muted small", text: def.help + (def.type === "int" ? ` (${def.min} to ${def.max}, normally ${def.default})` : "") }));
      };
      const save = h("button", { class: "btn green", type: "button", text: "Save settings" });
      const panels = groupKeys.map(g => h("div", { class: "panel" }, h("h3", { text: view.groups[g] }), ...view.settings.filter(x => x.group === g).map(x => (x.type === "bool" ? h("div", {}, control(x), h("p", { class: "muted small", text: x.help })) : control(x)))));
      save.addEventListener("click", () => busy(save, async () => {
        const patch = {};
        for (const [k, get] of inputs) patch[k] = get();
        const r = await api("/api/admin/settings", { patch });
        toast(r.changed.length ? `Saved. ${r.changed.length} changed, live now.` : "Nothing changed.", "ok");
        if (after) after(r);
      }));
      return [...panels, h("div", { class: "row" }, save)];
    };

    const aiTab = () => {
      const box = h("div", { class: "muted", text: "Loading…" });
      const load = () => api("/api/admin/ai").then(r => {
        box.className = "";
        const t = r.stats[0] || {};
        const week = r.stats.slice(0, 7).reduce((a, d) => ({ answers: a.answers + d.answers, errors: a.errors + d.errors, inTok: a.inTok + d.inTok, outTok: a.outTok + d.outTok }), { answers: 0, errors: 0, inTok: 0, outTok: 0 });
        const status = h("div", { class: "grid" },
          tile("API key", r.available ? "Set" : "Coming soon", r.available ? "The bot can reach the AI provider." : "No key yet, so servers get the bot's own answers for prices, free games, wishlist and library. Add the AI_API_KEY secret to switch the full AI on."),
          tile("“Hey AI” text", r.phrase ? "Works" : "Mentions only", r.phrase ? "Message Content intent is on." : "Turn on Message Content intent in the Developer Portal."),
          tile("Answers today", n0(t.answers), `${n0(t.errors)} failed · ${t.ms ? t.ms + " ms average" : "no timing yet"}`),
          tile("Last 7 days", n0(week.answers), `${n0(week.inTok + week.outTok)} tokens`),
          tile("Servers using it", n0(r.servers.filter(x => x.on).length), `${n0(r.blockedServers.length)} blocked · ${n0(r.blockedUsers.length)} people blocked`));
        const lastErr = r.lastError ? h("p", { class: "muted small", text: "Last problem: " + r.lastError }) : null;

        // try it
        const q = h("input", { type: "text", maxlength: "500", placeholder: "Ask it something, like a member would", value: "What should I play after Hades?" });
        const out = h("div", { class: "ai-test-out muted small", text: "" });
        const go = h("button", { class: "btn gray", type: "button", text: "Try it" });
        go.addEventListener("click", () => busy(go, async () => {
          out.className = "ai-test-out muted small"; out.textContent = "Thinking…";
          const a = await api("/api/admin/ai/test", { question: q.value });
          if (!a.ok) { out.className = "notice warn"; out.textContent = a.error || "No answer."; return; }
          out.className = "ai-test-out"; out.textContent = a.text;
          out.append(h("div", { class: "muted small", text: `${a.model} · ${a.ms} ms · ${a.inTok} in, ${a.outTok} out tokens. Uses the settings above, ignores the limits.` }));
        }));
        const tryIt = h("div", { class: "panel" }, h("h3", { text: "Try it" }), h("div", { class: "row" }, q, go), out);

        // usage by day
        const usage = h("div", { class: "panel" }, h("h3", { text: "Last 14 days" }),
          table(["Day", "Answers", "Failed", "Avg ms", "Tokens in", "Tokens out"], r.stats.map(d => [d.day, n0(d.answers), n0(d.errors), d.ms ? n0(d.ms) : "–", n0(d.inTok), n0(d.outTok)])),
          h("p", { class: "muted small", text: "Days are UTC. Tokens are what the provider counted, so you can work out the cost from its price list." }));

        // servers
        const rows = r.servers.map(x => {
          const cap = h("input", { type: "number", min: "0", max: "50000", placeholder: "normal", value: x.cap === null ? "" : String(x.cap), "aria-label": "Daily limit for " + (x.name || x.id) });
          const doIt = (label, body, cls = "btn gray small") => { const b = h("button", { class: cls, type: "button", text: label }); b.addEventListener("click", () => busy(b, async () => { await api("/api/admin/ai/server", { id: x.id, ...body }); toast("Done.", "ok"); await load(); })); return b; };
          const plus = h("button", { class: "btn gray small", type: "button", text: x.plus ? "Remove Plus" : "Give Plus" });
          plus.addEventListener("click", () => busy(plus, async () => { await api("/api/admin/ai/server", { id: x.id, plus: !x.plus }); await load(); }));
          const block = h("button", { class: "btn " + (x.blocked ? "gray" : "red") + " small", type: "button", text: x.blocked ? "Unblock" : "Block" });
          block.addEventListener("click", () => busy(block, async () => { await api("/api/admin/ai/block", { kind: "server", id: x.id, on: !x.blocked }); await load(); }));
          return h("tr", {}, h("td", {}, h("b", { text: x.name || "Unknown server" }), h("div", { class: "muted small", text: x.id })),
            h("td", { text: (x.main ? "Main server · " : "") + (x.blocked ? "Blocked" : x.on ? "On" : "Off") + (x.ownKey ? " · own key" : "") + (x.plus ? " · Plus" : "") + (x.interested && !x.plus ? " · wants Plus" : "") }), h("td", { class: "num", text: x.main ? `${n0(x.used)} / no limit` : `${n0(x.used)} / ${x.cap === null ? n0(r.settings.find(s => s.key === (x.plus ? "ai_plus_cap" : "ai_daily_cap")).value) : n0(x.cap)}` }),
            h("td", {}, h("div", { class: "row" }, cap, doIt("Set limit", { cap: cap.value === "" ? null : Number(cap.value) }))),
            h("td", {}, h("div", { class: "row" }, doIt("Reset today", { resetToday: true }), x.on ? doIt("Turn off", { turnOff: true }) : null, x.main ? null : plus, x.main ? null : block)));
        });
        const servers = h("div", { class: "panel" }, h("h3", { text: "Servers" }),
          h("p", { class: "muted small", text: "Servers that turned it on, used it today, have their own limit, or are blocked. A server's own limit replaces the general one (0 stops it). Servers with their own API key skip the general limit, since they pay for their answers. Your own server is never limited. Give Plus is the manual switch for the subscription that is still being built. Blocking a server silences it even if its managers switch it on." }),
          rows.length ? h("div", { class: "scroll-y" }, h("table", {}, h("thead", {}, h("tr", {}, ["Server", "Status", "Today / limit", "Daily limit", ""].map(c => h("th", { text: c })))), h("tbody", {}, rows))) : h("p", { class: "muted", text: "No server has used it yet." }));

        // blocked people and servers by ID
        const listPanel = (title, kind, ids, help) => {
          const id = h("input", { type: "text", inputmode: "numeric", maxlength: "25", placeholder: "Discord ID" });
          const add = h("button", { class: "btn gray small", type: "button", text: "Block" });
          add.addEventListener("click", () => busy(add, async () => { await api("/api/admin/ai/block", { kind, id: id.value.trim(), on: true }); toast("Blocked.", "ok"); await load(); }));
          return h("div", { class: "panel" }, h("h3", { text: title }), h("p", { class: "muted small", text: help }),
            ids.length ? h("div", { class: "chips" }, ids.map(v => { const b = h("button", { type: "button", class: "chip", text: v + " ✕", "aria-label": "Unblock " + v }); b.addEventListener("click", () => busy(b, async () => { await api("/api/admin/ai/block", { kind, id: v, on: false }); await load(); })); return b; })) : h("p", { class: "muted", text: "Nobody." }),
            h("div", { class: "row" }, id, add));
        };
        const blocked = [listPanel("Blocked people", "user", r.blockedUsers, "These people get no answers anywhere. Right-click a member in Discord with Developer Mode on to copy their ID."),
          listPanel("Blocked servers", "server", r.blockedServers, "These servers get no answers, whatever their managers choose.")];

        box.replaceChildren(status, lastErr, ...settingsPanels(r, ["ai"], load), tryIt, usage, servers, ...blocked);
      }).catch(e => { box.className = ""; box.replaceChildren(h("div", { class: "notice warn", text: e.message })); });
      load();
      return [box];
    };

    const settingsTab = () => {
      const box = h("div", { class: "muted", text: "Loading…" });
      api("/api/admin/settings").then(r => {
        box.className = "";
        box.replaceChildren(h("p", { class: "muted small", text: "Changes apply straight away, no restart. Anything you leave alone keeps its normal value. The AI companion has its own page." }), ...settingsPanels(r, Object.keys(r.groups).filter(g => g !== "ai")));
      }).catch(e => { box.className = ""; box.replaceChildren(h("div", { class: "notice warn", text: e.message })); });
      return [box];
    };
    const TABS = [["overview", "Overview", overview], ["bugs", "Bugs", bugs], ["requests", "Requests", requestsTab], ["gifts", "Gift marks", giftsTab], ["social", "Community", socialTab], ["music", "Music", musicTab], ["panels", "Panels", panelsTab], ["ai", "AI companion", aiTab], ["settings", "Bot settings", settingsTab], ["growth", "Growth", growth], ["features", "Usage", features], ["community", "Community", community], ["servers", "Servers", servers], ["members", "People", members], ["announce", "Announce", announce], ["giveaway", "Giveaway", giveaway], ["tools", "Tools and logs", tools]];
    return { TABS, tile, table, when, n0, st, hl, bot, ins, bugData, sum, daily };
  }

  // ---------- the admin panel (admin.html): a sidebar app around the same pages as adminView ----------
  const ADMIN_NAV = [
    ["Dashboard", [["overview", "Overview", "◧", "How the bot is doing right now."], ["system", "System health", "♥", "The bot's process, memory and sign-ins, refreshed live."]]],
    ["Insights", [["growth", "Growth", "↗", "New members and alerts over the last 30 days."], ["features", "Usage", "▦", "Who uses what, and the most watched games."], ["community", "Community", "◎", "Community features across every server."], ["votes", "Top.gg votes", "▲", "Who voted for the bot and the XP it paid out."], ["panels", "Panel runs", "▤", "Which commands people run from menus and panels."]]],
    ["People", [["supporters", "Supporters", "★", "Who has a supporter pass, and a way to hand one out."], ["servers", "Servers", "▣", "Every server the bot is in."], ["members", "People and restrictions", "☺", "Find anyone, see who is active, restrict or restore."], ["profiles", "Profile pages", "▭", "Reported profile pages, and a way to hide or restore one."], ["gifts", "Gift marks", "🎁", "Reported gift marks and who is blocked from making them."], ["social", "Community", "💬", "Reported feed posts and who is blocked from posting."]]],
    ["Reach", [["announce", "Announcements", "✉", "Tell members and servers something."], ["giveaway", "Giveaways", "★", "Network-wide key giveaways."], ["traffic", "Link traffic", "↗", "How many people open the bot's links and click through to the stores."], ["indie", "Indie showcase", "◈", "Review submissions, feature games and pause the form."], ["xposts", "X posting", "✕", "Post to the project's X account: ads, scheduled posts and the automatic free-game posts."]]],
    ["Support", [["radio", "Radio", "📻", "Add SoundCloud links and play them together."], ["chat", "Staff chat", "💬", "Chat with the team, and answer tickets and bug reports without leaving."]]],
    ["Operations", [["personalize", "Personalize", "🎨", "Pick the look and the wallpaper of your desktop. Only you see it."], ["admins", "Admin users", "👤", "Give other people their own login to this admin panel."], ["ai", "AI companion", "✦", "Turn it on or off, tune it, see who uses it, try it."], ["settings", "Bot settings", "☰", "Switches and numbers you can change without a restart."], ["music", "Music sessions", "♫", "Voice sessions running right now."], ["tools", "Backups and logs", "⚙", "Download a backup, reset failed DMs, read the log."], ["datareq", "Data requests", "⌫", "Who asked to export or delete their data, and when."], ["audit", "Audit log", "☰", "What you did in this panel, newest first."], ["account", "Account and security", "⚿", "A username and password as a second way in, and a two-step code."]]]
  ];
  const ADMIN_PAGES = Object.fromEntries(ADMIN_NAV.flatMap(([, items]) => items.map(([id, title, icon, sub]) => [id, { title, icon, sub }])));
  let adminCtx = null, adminCtxAt = 0, adminTimer = 0;

  async function adminContext(force = false) {
    if (!force && adminCtx && Date.now() - adminCtxAt < 45_000) return adminCtx;
    adminCtx = await adminView();
    adminCtxAt = Date.now();
    return adminCtx;
  }
  const admEl = id => document.getElementById(id);

  function adminCenter(title, text, ...actions) {
    app.replaceChildren(h("div", { class: "adm-center" }, h("div", { class: "panel" }, h("h2", { text: title }), h("p", { class: "muted", text }), h("div", { class: "row" }, actions))));
  }

  /** The signed-out screen: username and password, or Discord. Nothing of the panel is shown until one of them works. */
  function adminLoginScreen() {
    admEl("adm").classList.add("adm-bare");
    document.body.classList.add("adm-bare-body");
    document.title = "Sign in · LucadoOS";
    const user = h("input", { type: "text", name: "username", autocomplete: "username", autocapitalize: "none", spellcheck: "false", required: "" });
    const pass = h("input", { type: "password", name: "password", autocomplete: "current-password", required: "" });
    const code = h("input", { type: "text", name: "code", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "7", placeholder: "123456" });
    const codeRow = field("Authenticator code", code); codeRow.hidden = true;
    const msg = h("p", { class: "adm-login-msg", role: "alert", hidden: "" });
    const go = h("button", { class: "btn blue big", type: "submit", text: "Sign in" });
    const form = h("form", { class: "adm-login-form", novalidate: "" }, field("Username", user), field("Password", pass), codeRow, msg, go);
    form.addEventListener("submit", async e => {
      e.preventDefault();
      msg.hidden = true; go.disabled = true;
      try {
        const r = await api("/api/admin/login", { username: user.value, password: pass.value, code: code.value });
        if (r.needCode) { codeRow.hidden = false; code.focus(); msg.textContent = "Enter the 6-digit code from your authenticator app."; msg.hidden = false; return; }
        location.reload();
      } catch (err) { msg.textContent = err.message || "Could not sign in."; msg.hidden = false; }
      finally { go.disabled = false; }
    });
    // The sign-in screen looks like an operating system's: wallpaper, a big clock, a round picture and the fields underneath.
    const clock = h("div", { class: "adm-lock-clock" }), tick = () => { const d = new Date(); clock.replaceChildren(h("b", { text: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) }), h("span", { text: d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) })); };
    tick(); const clockTimer = setInterval(() => { if (!clock.isConnected) return clearInterval(clockTimer); tick(); }, 15_000);
    go.textContent = "→"; go.setAttribute("aria-label", "Sign in"); go.className = "adm-lock-go";
    form.replaceChildren(h("div", { class: "adm-lock-fields" }, user, h("div", { class: "adm-lock-pass" }, pass, go)), codeRow, msg);
    user.placeholder = "Username"; pass.placeholder = "Password"; user.setAttribute("aria-label", "Username"); pass.setAttribute("aria-label", "Password");
    app.replaceChildren(h("div", { class: "adm-lock" }, clock,
      h("div", { class: "adm-lock-card" },
        h("div", { class: "adm-lock-avatar" }, h("img", { src: "/logo.png", alt: "", width: "96", height: "96" })),
        h("h2", { text: "LucadoOS" }), h("p", { class: "adm-lock-sub", text: "Sign in to continue." }),
        form,
        h("a", { class: "adm-lock-alt", href: "/auth/login?next=admin", text: "Sign in with Discord" })),
      h("div", { class: "adm-lock-corner" }, themeButton())));
    user.focus();
  }

  const randomPassword = () => { const set = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789", a = crypto.getRandomValues(new Uint32Array(18)); return Array.from(a, n => set[n % set.length]).join(""); };

  /** The owner's list of other people who can use this panel, and what each may change. */
  /** The look and wallpaper of the desktop, saved for whoever is signed in. */
  async function adminPersonalize(body, fail) {
    let data; try { data = await api("/api/admin/prefs"); } catch (e) { return fail(e); }
    let prefs = data.prefs;
    const os = window.AdminOS;
    const save = async patch => { prefs = { ...prefs, ...patch }; os?.applyPrefs(prefs, data.walls); draw(); try { await api("/api/admin/prefs", prefs); } catch (e) { toast(e.message); } };
    const box = h("div", { class: "pz" });
    const draw = () => {
      const looks = [["original", "Original", "The LucadoOS colours, rounded windows"], ["windows", "Windows", "Flat and square, like a PC"]].map(([id, name, sub]) => h("button", { type: "button", class: "pz-look" + (prefs.look === id ? " on" : ""), onclick: () => save({ look: id }) }, h("b", { text: name }), h("small", { text: sub })));
      const swatches = data.walls.map(w => { const b = h("button", { type: "button", class: "pz-wall" + (prefs.wall === w.id ? " on" : ""), title: w.name, "aria-label": w.name, onclick: () => save({ wall: w.id }) }, h("span", { text: w.name })); if (w.css) b.style.setProperty("background", w.css); return b; });
      const color = h("input", { type: "color", "aria-label": "Pick any colour", value: /^#/.test(prefs.wall) ? prefs.wall : "#1b2a4a" });
      color.addEventListener("change", () => save({ wall: color.value }));
      const wv = h("input", { type: "checkbox" }); wv.checked = Boolean(prefs.waves); wv.addEventListener("change", () => save({ waves: wv.checked }));
      box.replaceChildren(h("h3", { text: "Look" }), h("div", { class: "pz-row" }, ...looks), h("h3", { text: "Wallpaper" }), h("div", { class: "pz-row" }, ...swatches, h("label", { class: "pz-color" + (/^#/.test(prefs.wall) ? " on" : "") }, color, h("span", { text: "Your colour" }))),
        h("label", { class: "pz-waves" }, wv, h("span", {}, h("b", { text: "Neon waves" }), h("small", { text: "Glowing lines rolling over the wallpaper. Works with any colour above, or on the default one." })))   ,
        os?.active() ? null : h("p", { class: "muted small", text: "The desktop look only shows on a wider screen, in desktop view." }));
    };
    draw(); body.replaceChildren(box);
  }

  async function adminAdmins(body, fail) {
    let d;
    try { d = await api("/api/admin/admins"); } catch (e) { return fail(e); }
    const redraw = () => adminAdmins(body, fail);
    const when = t => t ? new Date(t).toLocaleString() : "never";
    // A picker for "may change": everything, nothing, or particular areas.
    const picker = initial => {
      const all = h("input", { type: "checkbox" }), boxes = d.areas.map(a => { const c = h("input", { type: "checkbox", value: a.id }); return [a, c, h("label", { class: "check" }, c, " ", a.label)]; });
      all.checked = initial.includes("*");
      for (const [a, c] of boxes) c.checked = all.checked || initial.includes(a.id);
      const sync = () => { for (const [, c] of boxes) { c.disabled = all.checked; if (all.checked) c.checked = true; } };
      all.addEventListener("change", sync); sync();
      const node = h("div", { class: "adm-perms" }, h("label", { class: "check" }, all, h("b", { text: " Can change everything on the panel" })), h("div", { class: "adm-perm-grid" }, boxes.map(x => x[2])), h("p", { class: "muted small", text: "Everyone can look at every page. Leave all of these off for a view-only login." }));
      return { node, value: () => all.checked ? ["*"] : boxes.filter(([, c]) => c.checked).map(([a]) => a.id) };
    };
    let kind = "password";
    const kindSel = h("select", { "aria-label": "How they sign in" }, h("option", { value: "password", text: "Username and password" }), h("option", { value: "discord", text: "Discord account (their Discord ID)" }));
    const uName = h("input", { type: "text", autocapitalize: "none", spellcheck: "false", autocomplete: "off", "aria-label": "Username", placeholder: "username" });
    const pass = h("input", { type: "text", autocomplete: "off", spellcheck: "false", "aria-label": "Password", placeholder: "at least 12 characters" });
    const make = h("button", { type: "button", class: "btn gray small", text: "Make one", onclick: () => { pass.value = randomPassword(); } });
    const did = h("input", { type: "text", inputmode: "numeric", autocomplete: "off", "aria-label": "Discord ID", placeholder: "17 to 20 digits" });
    const label = h("input", { type: "text", maxlength: "40", autocomplete: "off", "aria-label": "A name to remember them by", placeholder: "e.g. Sam (mod)" });
    const pwFields = h("div", {}, field("Username", uName), field("Password", h("div", { class: "row" }, pass, make)));
    const dcFields = h("div", { hidden: "" }, field("Discord ID", did), field("Name (just for your list)", label),
      h("p", { class: "muted small", text: "They sign in with the Discord button on the admin page. In Discord, turn on Developer Mode, right-click them and choose Copy User ID." }));
    kindSel.addEventListener("change", () => { kind = kindSel.value; pwFields.hidden = kind !== "password"; dcFields.hidden = kind !== "discord"; });
    const perms = picker([]);
    const add = h("button", { type: "submit", class: "btn blue", text: "Add admin user" });
    const form = h("form", { class: "adm-form", novalidate: "" }, field("How they sign in", kindSel), pwFields, dcFields, h("h4", { text: "What they may change" }), perms.node,
      h("p", { class: "muted small", text: "Admin users never get bot powers, and they can't manage other admin users, change your sign-in, or download backups." }), add);
    form.addEventListener("submit", e => { e.preventDefault(); busy(add, async () => {
      await api("/api/admin/admins/add", kind === "discord" ? { kind, discordId: did.value, label: label.value, edit: perms.value() } : { kind, username: uName.value, password: pass.value, edit: perms.value() });
      toast(kind === "discord" ? "Added. They can sign in with Discord on this page." : "Added. Give them the username and password.", "ok"); redraw(); }); });
    const rows = d.admins.map(a => {
      const open = h("button", { type: "button", class: "btn gray small", text: "What they can change" }), del = h("button", { type: "button", class: "btn red small", text: "Remove" });
      const extra = [open];
      if (a.kind === "password") { const reset = h("button", { type: "button", class: "btn gray small", text: "New password" }); reset.addEventListener("click", () => { const np = prompt(`New password for ${a.username} (at least 12 characters). Leave it empty to make one.`, ""); if (np === null) return; const pw = np || randomPassword(); busy(reset, async () => { await api("/api/admin/admins/reset", { id: a.id, password: pw }); prompt(`Done. ${a.username} was signed out. Their new password:`, pw); }); }); extra.push(reset); }
      del.addEventListener("click", () => { if (confirm(`Remove ${a.username || a.label || a.id}? They lose access right away.`)) busy(del, async () => { await api("/api/admin/admins/remove", { id: a.id }); toast("Removed.", "ok"); redraw(); }); });
      const detail = h("tr", { hidden: "" }), p2 = picker(a.edit), save = h("button", { type: "button", class: "btn blue small", text: "Save" });
      save.addEventListener("click", () => busy(save, async () => { await api("/api/admin/admins/access", { id: a.id, edit: p2.value() }); toast("Saved.", "ok"); redraw(); }));
      detail.append(h("td", { colspan: "5" }, p2.node, save));
      open.addEventListener("click", () => { detail.hidden = !detail.hidden; });
      const summary = a.edit.includes("*") ? "Everything" : a.edit.length ? `${a.edit.length} area${a.edit.length === 1 ? "" : "s"}` : "View only";
      return [h("tr", {}, h("td", {}, h("b", { text: a.username || a.label || a.id }), a.kind === "discord" ? h("div", { class: "muted small", text: a.id }) : null), h("td", { text: a.kind === "discord" ? "Discord" : "Password" }), h("td", { text: summary }), h("td", { text: when(a.last_login) }), h("td", {}, h("div", { class: "row" }, ...extra, del))), detail];
    });
    body.replaceChildren(
      h("div", { class: "panel" }, h("h3", { text: "Add an admin user" }), form),
      h("div", { class: "panel" }, h("h3", { text: `Admin users (${d.admins.length})` }), rows.length
        ? h("div", { class: "scroll-y" }, h("table", {}, h("thead", {}, h("tr", {}, ["Who", "Signs in with", "May change", "Last password sign-in", ""].map(c => h("th", { text: c })))), h("tbody", {}, rows.flat())))
        : h("p", { class: "muted", text: "Nobody yet. It's just you." })));
  }
  /** What an admin user sees instead of the owner's Account page: their own password. */
  function adminSelf(body) {
    const cur = h("input", { type: "password", autocomplete: "current-password", "aria-label": "Current password", required: "" });
    const np = h("input", { type: "password", autocomplete: "new-password", "aria-label": "New password", required: "" });
    const np2 = h("input", { type: "password", autocomplete: "new-password", "aria-label": "Repeat the new password", required: "" });
    const save = h("button", { type: "submit", class: "btn blue", text: "Change password" });
    const form = h("form", { class: "adm-form", novalidate: "" }, field("Current password", cur), field("New password", np), field("Repeat the new password", np2), h("p", { class: "muted small", text: "Use at least 12 characters." }), save);
    form.addEventListener("submit", e => { e.preventDefault(); if (np.value !== np2.value) return toast("The two passwords don't match.", "error"); busy(save, async () => { await api("/api/admin/self/password", { current: cur.value, password: np.value }); toast("Saved. Your other sign-ins were ended.", "ok"); form.reset(); }); });
    body.replaceChildren(h("div", { class: "panel" }, h("h3", { text: "Your password" }), h("p", { class: "muted", text: `You're signed in as ${state.me.user.username}.` }), form));
  }

  /** Create or change the username and password, and turn the two-step code on or off. */
  async function adminAccount(body, fail) {
    let info;
    try { info = await api("/api/admin/account"); } catch (e) { return fail(e); }
    const redraw = () => adminAccount(body, fail);
    const pw = (label, ac) => h("input", { type: "password", autocomplete: ac, "aria-label": label, required: "" });
    const when = t => t ? new Date(t).toLocaleString() : "never";
    const note = h("p", { class: "muted small" });
    const status = h("div", { class: "panel" }, h("h3", { text: "Sign-in methods" }),
      h("p", {}, h("b", { text: "Discord" }), " is always on. It is the main way in and cannot be removed."),
      h("p", {}, h("b", { text: "Username and password" }), info.exists ? ` is on for “${info.username}”. Last used: ${when(info.lastLogin)}.` : " is not set up yet."),
      info.exists ? h("p", {}, h("b", { text: "Two-step code" }), info.totp ? " is on." : " is off.") : null,
      info.viaPassword ? h("p", { class: "muted small", text: "You are signed in with the password right now. This kind of sign-in lasts 12 hours and only opens this panel." }) : null);

    const uName = h("input", { type: "text", autocomplete: "username", autocapitalize: "none", spellcheck: "false", value: info.username || "", "aria-label": "Username", required: "" });
    const pNew = pw("New password", "new-password"), pNew2 = pw("Repeat the new password", "new-password"), pCur = pw("Current password", "current-password");
    const save = h("button", { class: "btn blue", type: "submit", text: info.exists ? "Save changes" : "Create sign-in" });
    const form = h("form", { class: "adm-form", novalidate: "" },
      field("Username", uName), field(info.exists ? "New password" : "Password", pNew), field("Repeat the password", pNew2),
      info.exists ? field("Current password (to confirm it is you)", pCur) : null,
      h("p", { class: "muted small", text: "Use at least 12 characters. A few random words in a row is easy to remember and hard to guess. The password is stored only as a salted hash, never as text." }), save);
    form.addEventListener("submit", async e => {
      e.preventDefault();
      if (pNew.value !== pNew2.value) return toast("The two passwords don't match.", "error");
      await busy(save, async () => {
        await api("/api/admin/account/save", { username: uName.value, password: pNew.value, current: pCur.value });
        toast(info.exists ? "Saved. Other password sign-ins were ended." : "Done. You can now sign in with this username and password.");
        redraw();
      });
    });
    const setup = h("div", { class: "panel" }, h("h3", { text: info.exists ? "Change the username or password" : "Create a username and password" }), form);

    const parts = [status, setup];
    if (info.exists) {
      // Two-step code
      const two = h("div", { class: "panel" }, h("h3", { text: "Two-step code" }), h("p", { class: "muted", text: "Adds a 6-digit code from an authenticator app (Google Authenticator, Authy, 1Password and so on) to the password sign-in. Strongly recommended." }));
      if (info.totp) {
        const cur = pw("Current password", "current-password");
        const off = h("button", { class: "btn red", type: "button", text: "Turn off two-step code" });
        off.addEventListener("click", () => busy(off, async () => { await api("/api/admin/account/totp/disable", { current: cur.value }); toast("Two-step code is off."); redraw(); }));
        two.append(field("Current password", cur), h("div", { class: "row" }, off));
      } else {
        const cur = pw("Current password", "current-password");
        const begin = h("button", { class: "btn blue", type: "button", text: "Set up two-step code" });
        const slot = h("div");
        begin.addEventListener("click", () => busy(begin, async () => {
          const r = await api("/api/admin/account/totp/start", { current: cur.value });
          const code = h("input", { type: "text", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "7", placeholder: "123456", "aria-label": "Code from the app" });
          const on = h("button", { class: "btn green", type: "button", text: "Check the code and turn it on" });
          on.addEventListener("click", () => busy(on, async () => { await api("/api/admin/account/totp/enable", { code: code.value }); toast("Two-step code is on."); redraw(); }));
          slot.replaceChildren(
            h("p", { text: "In your authenticator app choose “Enter a setup key” and paste this key. Pick “time based” if asked." }),
            h("div", { class: "adm-secret" }, h("code", { text: r.secret.replace(/(.{4})/g, "$1 ").trim() }),
              h("button", { class: "btn gray small", type: "button", text: "Copy", onclick: () => { navigator.clipboard?.writeText(r.secret).then(() => toast("Copied.")).catch(() => {}); } })),
            h("p", { class: "muted small", text: "Or open this link on the phone that has the app:" }), h("a", { href: r.uri, text: "Add to authenticator app" }),
            field("Then type the 6-digit code it shows", code), h("div", { class: "row" }, on));
        }));
        two.append(field("Current password", cur), h("div", { class: "row" }, begin), slot);
      }
      // Remove
      const rm = pw("Current password", "current-password");
      const del = h("button", { class: "btn red", type: "button", text: "Remove username and password" });
      del.addEventListener("click", () => busy(del, async () => {
        await api("/api/admin/account/remove", { current: rm.value });
        if (info.viaPassword) return location.reload();
        toast("Removed."); redraw();
      }));
      parts.push(two, h("div", { class: "panel" }, h("h3", { text: "Remove the password sign-in" }), h("p", { class: "muted", text: "Discord sign-in keeps working. Any open password sessions end." }), field("Current password", rm), h("div", { class: "row" }, del)));
    }
    parts.push(h("div", { class: "panel" }, h("h3", { text: "Good to know" }),
      h("p", { class: "muted small", text: "Five wrong tries in a row lock the password sign-in for 15 minutes (longer if it keeps happening). Discord sign-in is never locked. Every sign-in and change is written to the audit log, without any passwords." }), note));
    body.replaceChildren(...parts);
  }

  async function adminBoot() {
    try { state.cfg = await api("/api/config"); } catch (e) { return adminCenter("Can't reach the bot", e.message); }
    try { state.me = await api("/api/me"); } catch { state.me = null; }
    if (!state.me) return adminLoginScreen();
    if (!state.me.isOwner && !state.me.panel) return adminCenter("Owner only", "This account isn't the bot owner, so there's nothing to see here.",
      h("a", { class: "btn gray", href: state.cfg.siteUrl || "/", text: "Back to Steam Value Checker" }),
      h("button", { class: "btn gray", type: "button", text: "Sign out", onclick: async () => { try { await api("/auth/logout", {}); } catch { /* already out */ } location.reload(); } }));
    if (state.me.panel) { // someone the owner let in: no page for managing admins; a username login gets "My password", a Discord login has nothing to change
      const drop = new Set(state.me.panel.kind === "password" ? ["admins"] : ["admins", "account"]);
      for (const g of ADMIN_NAV) g[1] = g[1].filter(([id]) => !drop.has(id));
      for (const id of drop) delete ADMIN_PAGES[id];
      if (ADMIN_PAGES.account) { ADMIN_PAGES.account = { ...ADMIN_PAGES.account, title: "My password", sub: "Change the password for your admin login." }; ADMIN_NAV.forEach(g => g[1] = g[1].map(it => it[0] === "account" ? ["account", "My password", it[2], "Change the password for your admin login."] : it)); }
    }
    adminChrome();
    let look = null; try { look = await api("/api/admin/prefs"); } catch { /* the default look is fine */ }
    if (window.AdminOS?.wanted()) window.AdminOS.begin({ nav: ADMIN_NAV, pages: ADMIN_PAGES, siteUrl: state.cfg.siteUrl, render: (id, host) => adminMount(id, host), prefs: look?.prefs, walls: look?.walls });
    adminRoute();
    adminPulse();
    window.AdminChat?.watch({ api, toast });
    setInterval(adminPulse, 30_000);
  }

  function adminChrome() {
    const nav = admEl("admNav");
    nav.replaceChildren(...ADMIN_NAV.flatMap(([group, items]) => [h("div", { class: "adm-group", text: group }),
      ...items.map(([id, title, icon]) => h("a", { class: "adm-link", href: "#/" + id, "data-page": id }, h("i", { text: icon, "aria-hidden": "true" }), h("span", { text: title }), h("span", { class: "adm-badge", "data-badge": id, hidden: true })))]));
    admEl("admFoot").replaceChildren(h("a", { href: state.cfg.siteUrl || "/", text: "← Steam Value Checker" }), h("span", { text: "Signed in as " + (state.me.user?.username || "owner") }));
    admEl("admUser").replaceChildren(state.me.user?.avatar ? h("img", { src: state.me.user.avatar, alt: "", width: "30", height: "30", referrerpolicy: "no-referrer" }) : null, themeButton(),
      window.AdminOS && window.innerWidth >= 900 ? h("button", { class: "btn gray small", type: "button", text: "Desktop view", onclick: () => window.AdminOS.setMode("os") }) : null,
      h("button", { class: "btn gray small", type: "button", text: "Sign out", onclick: async () => { try { await api("/auth/logout", {}); } catch { /* already out */ } location.reload(); } }));
    const shell = admEl("adm");
    admEl("admBurger").addEventListener("click", () => shell.classList.toggle("open"));
    admEl("admScrim").addEventListener("click", () => shell.classList.remove("open"));
    admEl("admSearch").addEventListener("click", () => adminPalette());
    document.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); adminPalette(); } });
  }

  /** The little status light in the top bar, and the badge on Bug reports. */
  async function adminPulse() {
    const box = admEl("admStatus");
    try {
      const sys = await api("/api/admin/system");
      const b = sys.bot || {};
      box.replaceChildren(h("i", { class: "adm-dot ok", "aria-hidden": "true" }), h("span", { class: "txt", text: `Online${b.pingMs != null ? " · " + b.pingMs + " ms" : ""}${b.servers != null ? " · " + b.servers + " servers" : ""}` }));
    } catch (e) { box.replaceChildren(h("i", { class: "adm-dot bad", "aria-hidden": "true" }), h("span", { class: "txt", text: "Can't reach the bot" })); }
  }

  /** Draws one admin page (its heading, refresh button and content) into any box. The sidebar layout and the desktop windows both use this. */
  function adminMount(page, host, { classic = false } = {}) {
    const meta = ADMIN_PAGES[page];
    const body = h("div", {}, h("p", { class: "muted", text: "Loading…" }));
    const refresh = h("button", { class: "btn gray small", type: "button", text: "Refresh", onclick: () => { adminCtx = null; adminMount(page, host, { classic }); adminPulse(); } });
    host.replaceChildren(h("div", { class: "adm-head" }, h("div", {}, h("h1", { text: meta.title }), h("p", { text: meta.sub })), h("div", { class: "adm-actions" }, refresh)), body);
    if (classic) scrollTop0();
    if (page === "radio") { host.classList.add("adm-chat-host"); host.replaceChildren(); if (window.AdminRadio) window.AdminRadio.mount(host, { h, api, toast }); else host.append(h("div", { class: "notice warn", text: "The radio didn't load. Refresh the page." })); return; }
    if (page === "chat") { host.classList.add("adm-chat-host"); host.replaceChildren(); if (window.AdminChat) window.AdminChat.mount(host, { h, api, toast }); else host.append(h("div", { class: "notice warn", text: "The chat didn't load. Refresh the page." })); return; }
    const pm = state.me.panel;
    if (pm && pm.areas.includes(page) && !pm.edit.includes("*") && !pm.edit.includes(page)) host.insertBefore(h("div", { class: "notice", text: "You can look at this page, but you can't change anything on it. Ask the owner if you need edit access." }), body);
    const draw = nodes => body.replaceChildren(...nodes);
    const fail = e => body.replaceChildren(h("div", { class: "notice warn", text: e.message || "Something went wrong." }));
    if (page === "system") return void adminSystem(body, fail);
    if (page === "xposts") return void adminXPosts(body, fail);
    if (page === "traffic") return void adminTraffic(body, fail);
    if (page === "indie") return void adminIndie(body, fail);
    if (page === "votes") return void adminVotes(body, fail);
    if (page === "datareq") return void adminDataReq(body, fail);
    if (page === "supporters") return void adminSupporters(body, fail);
    if (page === "profiles") return void adminProfiles(body, fail);
    if (page === "audit") return void adminAudit(body);
    if (page === "account") return void (state.me.panel ? adminSelf(body) : adminAccount(body, fail));
    if (page === "admins") return void adminAdmins(body, fail);
    if (page === "personalize") return void adminPersonalize(body, fail);
    adminContext().then(ctx => {
      const tab = ctx.TABS.find(t => t[0] === page);
      const nodes = tab[2]();
      if (page === "overview") {
        // Quick doors first, then the headline numbers, then the charts.
        const firstGrid = nodes.findIndex(n => n && n.classList && n.classList.contains("grid"));
        nodes.splice(firstGrid + 1, 0, ...adminTrends(ctx));
        nodes.unshift(adminQuick(ctx));
        nodes.unshift(adminAttention());
      }
      draw(nodes);
    }).catch(fail);
  }
  function adminRoute() {
    clearTimeout(adminTimer);
    admEl("adm").classList.remove("open");
    const id = (location.hash.replace(/^#\/?/, "").split(/[/?]/)[0]) || "overview";
    const page = ({ bugs: "chat", requests: "chat" })[id] || (ADMIN_PAGES[id] ? id : "overview");
    if (window.AdminOS?.active()) { window.AdminOS.open(page); return; } // on the desktop, a link opens that page's window
    document.querySelectorAll(".adm-link").forEach(a => { const on = a.dataset.page === page; a.classList.toggle("active", on); on ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"); });
    const meta = ADMIN_PAGES[page];
    document.title = `${meta.title} · LucadoOS`;
    admEl("admCrumb").replaceChildren("Admin / ", h("b", { text: meta.title }));
    adminMount(page, app, { classic: true });
  }


  /** One-click doors to the things you do most. */
  /** What needs the owner right now. Fills in by itself; empty means all quiet. */
  function adminAttention() {
    const box = h("div", { class: "panel adm-attn" }, h("h3", { text: "Needs your attention" }), h("p", { class: "muted small", text: "Checking…" }));
    api("/api/admin/attention").then(r => {
      box.replaceChildren(h("h3", { text: "Needs your attention" }),
        r.items.length ? h("ul", { class: "adm-attn-list" }, ...r.items.map(i => h("li", { class: i.level }, h("a", { href: i.href, text: i.text })))) : h("p", { class: "muted", text: "All quiet. Nothing is waiting on you." }));
    }).catch(() => box.remove());
    return box;
  }
  function adminQuick(ctx) {
    const q = (href, title, text, extra = {}) => h("a", { href, ...extra }, h("b", { text: title }), h("span", { text }));
    return h("div", { class: "adm-quick" },
      q("#/announce", "Announce something", "Message members and servers"),
      q("#/giveaway", "Start a giveaway", "Network-wide, all servers"),
      q("#/chat", ctx.bugData.newCount ? `${ctx.bugData.newCount} new bug report${ctx.bugData.newCount === 1 ? "" : "s"}` : "Tickets and bugs", `${ctx.bugData.open} open`),
      q("/api/admin/backup", "Download the backup", "The latest database copy", { download: "" }));
  }
  function adminTrends(ctx) {
    return [h("div", { class: "grid two" },
      h("div", { class: "panel" }, h("h3", { text: "New members per day" }), ctx.daily(ctx.ins.signups, "New members", "s0")),
      h("div", { class: "panel" }, h("h3", { text: "Alerts sent per day" }), ctx.daily(ctx.ins.alerts, "Alerts", "s1")))];
  }

  /** Every link the bot posts goes through a page on the site first. This shows how many people opened them and how many went on to the store. */
  async function adminIndie(body, fail) {
    const tile = (k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: String(v) }), sub && h("div", { class: "s", text: sub }));
    let status = "pending";
    const draw = async () => {
      let d;
      try { d = await api("/api/admin/indie?status=" + status); } catch (e) { return fail(e); }
      if (!document.body.contains(body)) return;
      const act = async (g, action, extra = {}) => { try { await api("/api/admin/indie/review", { id: g.id, action, ...extra }); toast("Done.", "ok"); await draw(); } catch (e) { toast(e.message); } };
      const open = h("input", { type: "checkbox" }); open.checked = d.open; open.addEventListener("change", async () => { try { await api("/api/admin/indie/open", { open: open.checked }); toast(open.checked ? "Submissions are open." : "Submissions are paused.", "ok"); } catch (e) { toast(e.message); open.checked = !open.checked; } });
      const syncAll = h("button", { class: "btn gray small", type: "button", text: "Sync games from Steam now" }); syncAll.addEventListener("click", () => busy(syncAll, async () => { const r = await api("/api/admin/indie/review", { action: "syncall" }); toast(`Refreshed ${r.synced} game${r.synced === 1 ? "" : "s"}.`, "ok"); await draw(); }));
      const tabs = h("div", { class: "row" }, ["pending", "approved", "rejected"].map(k => { const b = h("button", { class: "btn small " + (status === k ? "blue" : "gray"), type: "button", text: `${k[0].toUpperCase() + k.slice(1)} (${d.counts[k] ?? 0})` }); b.addEventListener("click", () => { status = k; draw(); }); return b; }));
      const card = g => {
        const note = h("input", { type: "text", placeholder: "Note to the developer (optional)", maxlength: 300 }), btns = [];
        const mk = (text, cls, fn) => { const b = h("button", { class: "btn small " + cls, type: "button", text }); b.addEventListener("click", () => busy(b, fn)); btns.push(b); };
        if (g.status !== "approved") mk("Approve", "green", () => act(g, "approve", { note: note.value }));
        if (g.status !== "rejected") mk("Reject", "red", () => act(g, "reject", { note: note.value }));
        if (g.status === "approved") { mk(g.featured ? "Unfeature" : "Feature", g.featured ? "gray" : "blue", () => act(g, g.featured ? "unfeature" : "feature")); mk("Sync", "gray", () => act(g, "refresh")); mk("Post to X", "gray", async () => { if (confirm(`Post ${g.title} to the project's X account? Posts with a link cost about 20 cents.`)) await act(g, "xpost"); }); }
        if (g.status === "approved") mk(g.verified ? "Remove verified mark" : "Mark verified", "gray", () => act(g, g.verified ? "unverify" : "verify"));
        mk("Remove", "gray", async () => { if (confirm(`Remove ${g.title} for good?`)) await act(g, "remove"); });
        return h("div", { class: "panel ix-adm" }, h("div", { class: "ix-adm-head" }, h("img", { src: g.image, alt: "", width: 184, height: 69 }), h("div", {}, h("b", { text: g.title }), h("div", { class: "muted small", text: `${g.studio || "Unknown studio"} · Steam app ${g.appid} · by Discord user ${g.owner}` }), h("div", { class: "muted small", text: `${(g.genres || []).join(", ")} · ${g.price || "no price"} · ${g.release || ""}` }))),
          h("p", { text: g.pitch || "" }), g.note ? h("p", { class: "muted small", text: "Note: " + g.note }) : null, g.verified ? h("p", { class: "muted small", text: "✓ Verified by Steam page code" }) : null, g.reports ? h("p", { class: "notice warn", text: `${g.reports} open report${g.reports === 1 ? "" : "s"} on this game` }) : null,
          h("div", { class: "row" }, h("a", { href: g.steamUrl, target: "_blank", rel: "noopener noreferrer", text: "Steam page ↗" }), g.status === "approved" ? h("a", { href: `/indie/game/${g.id}`, target: "_blank", text: "Showcase page ↗" }) : null, Object.entries(g.links || {}).map(([k, u]) => h("a", { href: u, target: "_blank", rel: "noopener noreferrer nofollow", text: k + " ↗" })), g.status === "approved" ? h("span", { class: "muted small", text: `${g.views} views · ${g.clicks} clicks · ♥ ${g.likes}` }) : null),
          h("div", { class: "row" }, note, btns));
      };
      let rep = { reports: [] }, spot = null;
      try { rep = await api("/api/admin/indie/reports"); } catch { /* leave the panel empty */ }
      try { spot = await api("/api/admin/indie/spotlight"); } catch { /* spotlight not available */ }
      const when = ms => new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      const reportsPanel = h("div", { class: "panel" }, h("h3", { text: `Reports (${rep.reports.length})` }), rep.reports.length ? rep.reports.map(r => {
        const closeBtn = h("button", { class: "btn gray small", type: "button", text: "Dismiss" }), takeDown = h("button", { class: "btn red small", type: "button", text: "Take the game down" });
        closeBtn.addEventListener("click", () => busy(closeBtn, async () => { await api("/api/admin/indie/report", { gameId: r.gameId, action: "close" }); await draw(); }));
        takeDown.addEventListener("click", () => busy(takeDown, async () => { if (!confirm(`Take ${r.title} down?`)) return; await api("/api/admin/indie/report", { gameId: r.gameId, action: "remove" }); await draw(); }));
        return h("div", { class: "ix-adm-report" }, h("b", { text: r.title || "(removed game)" }), h("span", { class: "muted small", text: ` · reported ${when(r.created)}` }), h("p", { text: r.reason }), h("div", { class: "row" }, r.title ? h("a", { href: `/indie/game/${r.gameId}`, target: "_blank", text: "Showcase page ↗" }) : null, closeBtn, takeDown));
      }) : h("p", { class: "muted", text: "No open reports." }));
      let spotPanel = null;
      if (spot) {
        const on = h("input", { type: "checkbox" }); on.checked = spot.on; const chan = h("input", { type: "text", placeholder: "Discord channel ID (optional)", value: spot.channel || "", maxlength: 22 }), save = h("button", { class: "btn blue small", type: "button", text: "Save" }), runNow = h("button", { class: "btn gray small", type: "button", text: "Spotlight the next game now" });
        save.addEventListener("click", () => busy(save, async () => { try { await api("/api/admin/indie/spotlight", { on: on.checked, channel: chan.value }); toast("Saved.", "ok"); } catch (e) { toast(e.message); } }));
        runNow.addEventListener("click", () => busy(runNow, async () => { if (!confirm(spot.next ? `Spotlight ${spot.next.title} right now? It posts to X (if connected) and your channel.` : "There's no game ready to spotlight.")) return; try { const r = await api("/api/admin/indie/spotlight", { run: true }); toast(r.ran?.skipped ? r.ran.skipped : `Spotlighted ${r.ran.game}.`, "ok"); await draw(); } catch (e) { toast(e.message); } }));
        spotPanel = h("div", { class: "panel" }, h("h3", { text: "Weekly spotlight" }), h("label", { class: "check" }, on, " Spotlight one game every Wednesday at noon (Eastern)"),
          h("p", { class: "muted small", text: "It posts the game to X with #WishlistWednesday (when X posting is on) and to a Discord channel if you set one, then marks it Featured for the week. Every game gets a turn; verified and well-liked games go first." }),
          h("div", { class: "row" }, chan, save), h("p", { class: "muted small", text: spot.next ? `Up next: ${spot.next.title}${spot.next.studio ? " by " + spot.next.studio : ""}` : "Up next: nothing yet. Approve a game first." }),
          spot.last ? h("p", { class: "muted small", text: `Last: ${spot.last.game}, ${when(spot.last.at)}${spot.last.x ? " · posted to X" : ""}${spot.last.discord === true ? " · posted in Discord" : ""}` }) : null, runNow);
      }
      body.replaceChildren(
        h("div", { class: "panel" }, h("div", { class: "grid four" }, tile("Waiting", d.counts.pending ?? 0, "need a look"), tile("Live", d.counts.approved ?? 0, "in the showcase"), tile("Views", d.totals.views, "on game pages"), tile("Clicks to Steam", d.totals.clicks), tile("Likes", d.totals.likes))),
        h("div", { class: "panel" }, h("h3", { text: "Submissions" }), h("label", { class: "check" }, open, " Accept new submissions"), h("p", { class: "muted small", text: "Games re-sync from their Steam pages every day on their own, so prices and release dates stay current. You can also do it now." }), syncAll, h("a", { class: "btn gray small", href: "/indie", target: "_blank", text: "Open the showcase" })),
        ...(spotPanel ? [spotPanel] : []), reportsPanel,
        tabs, d.games.length ? d.games.map(card) : h("p", { class: "muted", text: status === "pending" ? "Nothing is waiting. You're all caught up." : "Nothing here." }));
    };
    await draw();
  }

  async function adminTraffic(body, fail) {
    const tile = (k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: String(v) }), sub && h("div", { class: "s", text: sub }));
    let t;
    try { t = await api("/api/admin/traffic"); } catch (e) { return fail(e); }
    if (!document.body.contains(body)) return;
    const rate = (c, v) => (v ? Math.round(c / v * 100) + "%" : "-");
    const peak = Math.max(1, ...t.days.map(d => d.visits));
    const bars = h("div", { class: "tr-bars" }, ...t.days.map(d => {
      const bar = h("i", { title: `${d.day}: ${d.visits} visits, ${d.clicks} clicks` });
      bar.style.height = Math.max(2, Math.round(d.visits / peak * 100)) + "%";
      return h("div", { class: "tr-col" }, bar, h("span", { text: d.day.slice(5) }));
    }));
    body.replaceChildren(
      h("div", { class: "panel" }, h("h3", { text: "At a glance" }),
        h("div", { class: "grid four" },
          tile("Visits today", t.today.visits, `${t.today.clicks} went on to the store`),
          tile("Last 7 days", t.week.visits, `${t.week.clicks} clicks, ${rate(t.week.clicks, t.week.visits)} went through`),
          tile("All time", t.total.visits, `${t.total.clicks} clicks`),
          tile("Link previews", t.week.previews, "robots reading a post, this week")),
        h("p", { class: "muted small", text: "A visit is a person opening one of the bot's links. Discord and X reading a link to build its preview is counted separately, so it doesn't inflate this." })),
      h("div", { class: "panel" }, h("h3", { text: "Visits per day" }), t.days.length ? bars : h("p", { class: "muted", text: "Nothing yet. Counts start once the bot has posted a few links." })),
      h("div", { class: "panel" }, h("h3", { text: "Most opened links" }),
        t.top.length ? h("table", {}, h("thead", {}, h("tr", {}, ["Page", "Type", "Store", "Visits", "Clicks", "Through", ""].map(c => h("th", { text: c })))),
          h("tbody", {}, ...t.top.map(p => h("tr", {}, h("td", {}, h("b", { text: p.title })), h("td", { text: p.kind }), h("td", { text: p.store }), h("td", { text: String(p.visits) }), h("td", { text: String(p.clicks) }), h("td", { text: rate(p.clicks, p.visits) }), h("td", {}, h("a", { href: p.url, target: "_blank", rel: "noopener", text: "Open" })))))) : h("p", { class: "muted", text: "No visits yet." })));
  }

  /** The project's X account: automatic free-game posts, a composer for ads and announcements, a schedule and the recent posts. */
  async function adminXPosts(body, fail) {
    const tile = (k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: String(v) }), sub && h("div", { class: "s", text: sub }));
    const money = n => (n > 0 && n < 0.1 ? (n * 100).toFixed(1).replace(/\.0$/, "") + " cents" : "$" + n.toFixed(2));
    // what X counts: a link is 23, and emoji and most non-Latin characters count double
    const LINK = /https?:\/\/\S+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|gg|tv|me|co|app|dev|xyz)\b(?:\/\S*)?/gi;
    const xLen = t => { let n = 0; for (const ch of t.replace(LINK, () => "x".repeat(23))) { const cp = ch.codePointAt(0); n += cp <= 4351 || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247) ? 1 : 2; } return n; };
    const hasLink = t => { LINK.lastIndex = 0; return LINK.test(t); };
    const when = at => new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    let draft = { text: "", image: null, imageName: "", at: "", bundleId: null }, bundleLink = true, freeLink = true;
    const draw = async () => {
      const xs = await api("/api/admin/xposter");
      const bl = await api("/api/admin/xposter/bundles?link=" + (bundleLink ? 1 : 0)).catch(() => ({ bundles: [] }));
      const fl = await api("/api/admin/xposter/free?link=" + (freeLink ? 1 : 0)).catch(() => ({ games: [] }));
      const wk = await api("/api/admin/weekly").catch(() => null);
      const nx = await api("/api/admin/xposter/next").catch(() => null);
      if (!document.body.contains(body)) return;
      const save = async patch => { try { await api("/api/admin/xposter", patch); toast("Saved.", "ok"); await draw(); } catch (e) { toast(e.message); } };

      // ----- status and the automatic posts -----
      const note = h("p", { class: "muted small", text: "" });
      const on = h("input", { type: "checkbox" }); on.checked = xs.enabled; on.disabled = !xs.configured; on.addEventListener("change", () => save({ enabled: on.checked }));
      const per = h("input", { type: "number", min: "1", max: String(xs.maxDaily), value: String(xs.daily), class: "x-num" });
      const chk = h("button", { class: "btn gray small", type: "button", text: "Check the keys" });
      chk.addEventListener("click", () => busy(chk, async () => { try { const r = await api("/api/admin/xposter/check", {}); note.textContent = "Connected" + (r.username ? " as @" + r.username : "") + "."; } catch (e) { note.textContent = e.message; } }));
      const sv = h("button", { class: "btn gray small", type: "button", text: "Save" }); sv.addEventListener("click", () => save({ daily: Number(per.value) }));
      const linksOn = h("input", { type: "checkbox" }); linksOn.checked = xs.links; linksOn.addEventListener("change", () => save({ links: linksOn.checked }));
      const tagsIn = h("input", { type: "text", value: xs.tags, class: "x-tags", placeholder: "#FreeGames #PCGaming …" });
      const tagsSave = h("button", { class: "btn gray small", type: "button", text: "Save tags" }); tagsSave.addEventListener("click", () => save({ tags: tagsIn.value }));
      const tagsReset = h("button", { class: "btn gray small", type: "button", text: "Reset" }); tagsReset.addEventListener("click", () => save({ tags: xs.defaultTags }));
      const status = h("div", { class: "panel" }, h("h3", { text: "Account and automatic posts" }),
        h("div", { class: "grid four" },
          tile("This month", money(xs.monthSpend), "about what X has charged"),
          tile("Automatic today", `${xs.postedToday} of ${xs.daily}`, xs.enabled ? "free games" : "switched off"),
          tile("Manual today", `${xs.manualToday} of ${xs.manualMax}`, "posts you wrote"),
          tile("Waiting", String(xs.queue.length), xs.queue.length ? "scheduled" : "nothing scheduled")),
        !xs.configured && h("p", { class: "bad", text: "The four X keys aren't set in Fly yet, so nothing can be posted." }),
        xs.error && h("p", { class: "bad", text: "Last problem: " + xs.error.message }),
        xs.imageError && h("p", { class: "bad small", text: "Last automatic post went out without a picture: " + xs.imageError.message }),
        h("label", { class: "check" }, on, " Post new free games automatically"),
        h("label", { class: "check" }, linksOn, " Put the game's link in automatic posts (about " + money(xs.linkCost) + " each instead of " + money(xs.plainCost) + ")"),
        h("div", { class: "row" }, h("label", { text: "Posts per day, at most " }), per, sv, chk),
        h("div", { class: "row" }, h("label", { text: "Hashtags " }), tagsIn, tagsSave, tagsReset),
        h("p", { class: "muted small", text: "Each automatic post gets its store's own tag (like #EpicGames) plus up to three from this list, rotating so no two posts match. Bundles skip the free and giveaway ones. A few well-picked tags do better than a wall of them." }),
        h("p", { class: "muted small", text: `Automatic posts carry the game's cover art (or the logo when there isn't any) and are spaced at least 3 hours apart. X charges about ${money(xs.plainCost)} for a plain post and about ${money(xs.linkCost)} for one with a link. ${xs.daily} a day is roughly ${money(xs.monthlyCost)} a month at the current setting.` }), note);

      // ----- the composer -----
      const text = h("textarea", { rows: "7", placeholder: "Write a post, or start from one of the ready-made ones…", class: "x-text" }); text.value = draft.text;
      const tpl = h("select", {}, h("option", { value: "", text: "Start from…" }), ...xs.templates.map(t => h("option", { value: t.id, text: t.name })));
      const addLink = h("input", { type: "checkbox" });
      const count = h("span", { class: "muted small" }), cost = h("span", { class: "muted small" });
      const fileIn = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif" });
      const preview = h("div", { class: "muted small", text: "" });
      const GRAPHICS = [["/img/x-post.jpg", "Project graphic"], ["/img/x-logo.jpg", "Logo"]];
      const pic = h("select", {}, h("option", { value: "", text: "Pick a ready-made picture…" }), ...GRAPHICS.map(([u, n]) => h("option", { value: u, text: n })));
      const setImage = (b64, name) => { draft.image = b64; draft.imageName = name; refresh(); };
      const useGraphic = async url => { try { const blob = await (await fetch(url)).blob(); const r = new FileReader(); r.onload = () => setImage(String(r.result).split(",")[1], GRAPHICS.find(g => g[0] === url)?.[1] || "picture"); r.readAsDataURL(blob); } catch { toast("Couldn't load that picture."); } };
      pic.addEventListener("change", () => { if (pic.value) { fileIn.value = ""; useGraphic(pic.value); } else setImage(null, ""); });
      const at = h("input", { type: "datetime-local" }); at.value = draft.at;
      const go = h("button", { class: "btn green", type: "button", text: "Post now" });
      const full = () => text.value.trim() + (addLink.checked && !hasLink(text.value) ? "\n\nsteamvaluechecker.com" : "");
      const refresh = () => {
        const t = full(), n = xLen(t);
        count.textContent = `${n} / 280`; count.className = n > 280 ? "bad small" : "muted small";
        cost.textContent = t ? `About ${money(hasLink(t) ? xs.linkCost : xs.plainCost)} on X${hasLink(t) ? " (it has a link)" : ""}.` : "";
        go.textContent = at.value ? "Schedule it" : "Post now"; go.disabled = !xs.configured || !t || n > 280;
        preview.textContent = draft.image ? `Picture: ${draft.imageName}` : draft.bundleId ? (/steamvaluechecker\.com\/[bd]\/\d+/i.test(draft.text) ? "The link will show the bundle's picture as a big card." : "The bundle's own picture will be attached.") : "No picture. Posts with one get noticed far more.";
        draft.text = text.value; draft.at = at.value;
      };
      tpl.addEventListener("change", () => { const t = xs.templates.find(x => x.id === tpl.value); if (t) { draft.bundleId = null; text.value = t.text; if (!draft.image) { pic.value = GRAPHICS[0][0]; useGraphic(GRAPHICS[0][0]); } else refresh(); } });
      [text, addLink, at].forEach(el => el.addEventListener("input", refresh));
      fileIn.addEventListener("change", () => {
        const f = fileIn.files?.[0]; pic.value = ""; if (!f) { draft.image = null; draft.imageName = ""; return refresh(); }
        if (f.size > (at.value ? 2 : 5) * 1024 * 1024) { toast(`Pictures can be ${at.value ? 2 : 5} MB at most${at.value ? " on scheduled posts" : ""}.`); fileIn.value = ""; return; }
        const r = new FileReader(); r.onload = () => { draft.image = String(r.result).split(",")[1]; draft.imageName = f.name; refresh(); }; r.readAsDataURL(f);
      });
      go.addEventListener("click", () => busy(go, async () => {
        const t = full(), sched = at.value ? new Date(at.value).getTime() : null;
        if (!confirm(sched ? `Schedule this post for ${when(sched)}?` : "Post this to X now? It goes out right away.")) return;
        try {
          await api("/api/admin/xposter/post", { text: t, ...(sched ? { at: sched } : {}), ...(draft.image ? { image: draft.image } : {}), ...(!sched && draft.bundleId ? { bundle_id: draft.bundleId } : {}) });
          toast(sched ? "Scheduled." : "Posted.", "ok"); draft = { text: "", image: null, imageName: "", at: "", bundleId: null }; await draw();
        } catch (e) { toast(e.message); }
      }));
      refresh();
      const composer = h("div", { class: "panel" }, h("h3", { text: "Write a post" }),
        h("p", { class: "muted", text: "For ads, announcements and anything else you'd rather word yourself. Ready-made posts say \"link in bio\"; add the website link with the tickbox when you want people to click straight through." }),
        h("div", { class: "row" }, tpl),
        text,
        h("div", { class: "row", style: "justify-content:space-between" }, count, cost),
        h("label", { class: "check" }, addLink, " Add the website link"),
        h("div", { class: "row" }, h("label", { text: "Picture " }), pic, fileIn), preview,
        h("div", { class: "row" }, h("label", { text: "Send at " }), at, h("span", { class: "muted small", text: "Leave empty to post now. Scheduled posts go out within a few minutes of the time." })),
        h("div", { class: "row" }, go),
        h("p", { class: "muted small", text: "Pictures are uploaded when the post goes out. If X turns the picture down, nothing gets posted and you'll see why." }));

      // ----- the latest bundles -----
      const postBundle = (b, btn) => busy(btn, async () => {
        if (!confirm(`Post "${b.title}" to X now?`)) return;
        try { await api("/api/admin/xposter/post", { text: b.text, bundle_id: b.id }); toast("Posted.", "ok"); await draw(); } catch (e) { toast(e.message); }
      });
      const linkBox = h("input", { type: "checkbox" }); linkBox.checked = bundleLink; linkBox.addEventListener("change", () => { bundleLink = linkBox.checked; draw(); });
      const fresh = bl.bundles.filter(b => !b.posted);
      const newest = h("button", { class: "btn green small", type: "button", text: "Post the newest", disabled: !xs.configured || !fresh.length }); if (fresh.length) newest.addEventListener("click", () => postBundle(fresh[0], newest));
      const bundles = h("div", { class: "panel" }, h("h3", { text: "Latest bundles" }),
        h("p", { class: "muted", text: "The newest bundles the bot has found. Each one goes out with its own picture and a link to a page on the site that shows the bundle and sends people on to the store after a few seconds. Post one as is, or send it to the box above to reword it first." }),
        h("div", { class: "row" }, newest, h("label", { class: "check" }, linkBox, ` Include the bundle's link (about ${money(xs.linkCost)} each instead of ${money(xs.plainCost)})`)),
        bl.bundles.length ? h("table", {}, h("thead", {}, h("tr", {}, ["Bundle", "Store", "Price", "Ends", "Visits", ""].map(c => h("th", { text: c })))),
          h("tbody", {}, bl.bundles.map(b => {
            const go = h("button", { class: "btn gray small", type: "button", text: "Post to X", disabled: !xs.configured }); go.addEventListener("click", () => postBundle(b, go));
            const ed = h("button", { class: "btn gray small", type: "button", text: "Edit first" });
            ed.addEventListener("click", () => { draft.text = b.text; draft.bundleId = b.id; draft.image = null; draft.imageName = ""; pic.value = ""; text.value = b.text; refresh(); text.scrollIntoView({ behavior: "smooth", block: "center" }); text.focus(); });
            return h("tr", {}, h("td", {}, h("b", { text: b.title }), b.gameCount ? h("div", { class: "muted small", text: b.gameCount + " games" }) : null), h("td", { text: b.storeName }), h("td", { text: b.price || "–" }),
              h("td", { text: b.expiresAt ? when(b.expiresAt) : "–" }), h("td", { text: b.visits ? `${b.visits} (${b.clicks} went on)` : "–" }), h("td", {}, b.posted ? h("span", { class: "muted", text: "Posted ✓ " }) : null, go, " ", ed));
          }))) : h("p", { class: "muted", text: "No active bundles right now." }));

      // ----- free games right now -----
      const postFree = (g, btn) => busy(btn, async () => {
        if (!confirm(`Post "${g.title}" to X now?`)) return;
        try { await api("/api/admin/xposter/post", { text: g.text, free_id: g.id }); toast("Posted.", "ok"); await draw(); } catch (e) { toast(e.message); }
      });
      const freeBox = h("input", { type: "checkbox" }); freeBox.checked = freeLink; freeBox.addEventListener("change", () => { freeLink = freeBox.checked; draw(); });
      const freshFree = fl.games.filter(g => !g.posted);
      const newestFree = h("button", { class: "btn green small", type: "button", text: "Post the soonest to end", disabled: !xs.configured || !freshFree.length }); if (freshFree.length) newestFree.addEventListener("click", () => postFree(freshFree[0], newestFree));
      const nextPanel = h("div", { class: "panel" }, h("h3", { text: "Next automatic post" }),
        !nx || nx.off ? h("p", { class: "muted", text: "Automatic posting is off, so nothing is lined up. Turn it on above and the next one shows up here." })
          : nx.nothing ? h("p", { class: "muted", text: "Nothing new to post right now. Every free game has already gone out." })
          : h("div", {},
            h("p", { class: "muted", text: `${nx.title} on ${nx.shop || "the store"}${nx.expiry ? ", ends " + new Date(nx.expiry).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET" : ""}. ${nx.capped ? "Today's limit is used up, so it goes out tomorrow." : nx.waitMs > 0 ? `It goes out in about ${Math.ceil(nx.waitMs / 60000)} min.` : "It goes out on the next check, within a few minutes."}` }),
            h("pre", { class: "xprev", text: nx.text }),
            h("p", { class: "muted small", text: `${nx.chars} characters, about ${money(nx.cost)} to send.${nx.link ? " X turns the link into a card with the game's picture." : ""}` })));
      const freeGames = h("div", { class: "panel" }, h("h3", { text: "Free games right now" }),
        h("p", { class: "muted", text: "Every game that's free to keep at the moment, soonest to end first. Each one goes out with a link to its page on the site, which shows the game's picture and sends people on to the store. Games you post here are skipped by the automatic posts." }),
        h("div", { class: "row" }, newestFree, h("label", { class: "check" }, freeBox, ` Include the game's link (about ${money(xs.linkCost)} each instead of ${money(xs.plainCost)})`)),
        fl.games.length ? h("table", {}, h("thead", {}, h("tr", {}, ["Game", "Store", "Ends", "Visits", ""].map(c => h("th", { text: c })))),
          h("tbody", {}, fl.games.map(g => {
            const go = h("button", { class: "btn gray small", type: "button", text: "Post to X", disabled: !xs.configured }); go.addEventListener("click", () => postFree(g, go));
            const ed = h("button", { class: "btn gray small", type: "button", text: "Edit first" });
            ed.addEventListener("click", () => { draft.text = g.text; draft.bundleId = null; draft.image = null; draft.imageName = ""; pic.value = ""; text.value = g.text; refresh(); text.scrollIntoView({ behavior: "smooth", block: "center" }); });
            return h("tr", {}, h("td", {}, h("b", { text: g.title })), h("td", { text: g.shop }), h("td", { text: g.expiry ? when(g.expiry) : "–" }), h("td", { text: g.visits ? `${g.visits} (${g.clicks} went on)` : "–" }),
              h("td", {}, g.posted ? h("span", { class: "muted small", text: "Already posted " }) : null, go, " ", ed));
          }))) : h("p", { class: "muted", text: "No free games right now." }));

      // ----- the Friday roundup -----
      const weeklyPanel = wk && h("div", { class: "panel" }, h("h3", { text: "Weekly best deals" }),
        h("p", { class: "muted", text: "Every Friday around noon Eastern, the bot posts the five biggest Steam savings of the week: one X post (when auto posting is on) and one Discord post in the channel below. Both link to one page on the site, so the visits show up on Link traffic." }),
        (() => {
          const on = h("input", { type: "checkbox" }); on.checked = wk.on; on.addEventListener("change", () => api("/api/admin/weekly", { on: on.checked }).then(() => toast("Saved.", "ok")).catch(e => toast(e.message)));
          const ch = h("input", { type: "text", placeholder: "Discord channel ID (optional)", value: wk.channel, size: "28" });
          const save = h("button", { class: "btn gray small", type: "button", text: "Save channel" }); save.addEventListener("click", () => busy(save, async () => { try { await api("/api/admin/weekly", { channel: ch.value }); toast("Saved.", "ok"); } catch (e) { toast(e.message); } }));
          const now = h("button", { class: "btn green small", type: "button", text: "Post it now", disabled: !wk.picks.length }); now.addEventListener("click", () => busy(now, async () => { if (!confirm("Post this week's deals now?")) return; try { await api("/api/admin/weekly/run", {}); toast("Posted.", "ok"); await draw(); } catch (e) { toast(e.message); } }));
          return h("div", {}, h("div", { class: "row" }, h("label", { class: "check" }, on, " Post every Friday"), ch, save, now),
            wk.last ? h("p", { class: "muted small", text: `Last post: ${when(wk.last.at)}. X: ${wk.last.x === null ? "not posted" : String(wk.last.x).startsWith("failed") ? wk.last.x : "posted"}. Discord: ${wk.last.discord === null ? "no channel set" : wk.last.discord === true ? "posted" : wk.last.discord}.` }) : h("p", { class: "muted small", text: "Nothing posted yet." }));
        })(),
        wk.picks.length ? h("table", {}, h("thead", {}, h("tr", {}, ["This week's picks", "Was", "Now", "Off"].map(c => h("th", { text: c })))),
          h("tbody", {}, wk.picks.map(p => h("tr", {}, h("td", {}, h("b", { text: p.title })), h("td", { text: p.regular }), h("td", { text: p.price }), h("td", { text: "-" + p.cut + "%" }))))) : h("p", { class: "muted", text: "No deals good enough to post right now." }),
        wk.xText ? h("pre", { class: "x-text", text: wk.xText }) : null);

      // ----- schedule -----
      const queue = h("div", { class: "panel" }, h("h3", { text: "Scheduled" }),
        xs.queue.length ? h("table", {}, h("thead", {}, h("tr", {}, ["When", "Post", ""].map(c => h("th", { text: c })))),
          h("tbody", {}, xs.queue.map(q => { const b = h("button", { class: "btn gray small", type: "button", text: "Remove" }); b.addEventListener("click", () => busy(b, async () => { await api("/api/admin/xposter/unschedule", { key: q.key }); await draw(); })); return h("tr", {}, h("td", { text: when(q.at) }), h("td", { text: q.text.length > 120 ? q.text.slice(0, 120) + "…" : q.text }), h("td", {}, b)); })))
          : h("p", { class: "muted", text: "Nothing is scheduled." }));

      // ----- what went out -----
      const kinds = { auto: "Free game", manual: "Manual", scheduled: "Scheduled", bundle: "Bundle" };
      const hist = h("div", { class: "panel" }, h("h3", { text: "Recent posts" }),
        xs.history.length ? h("div", { class: "scroll-y" }, h("table", {}, h("thead", {}, h("tr", {}, ["When", "Kind", "Post", ""].map(c => h("th", { text: c })))),
          h("tbody", {}, xs.history.map(x => {
            const del = h("button", { class: "btn gray small", type: "button", text: "Delete" });
            del.addEventListener("click", () => busy(del, async () => { if (!confirm("Delete this post from X?")) return; try { await api("/api/admin/xposter/delete", { id: x.id }); toast("Deleted.", "ok"); await draw(); } catch (e) { toast(e.message); } }));
            return h("tr", {}, h("td", { text: when(x.at) }), h("td", { text: (kinds[x.kind] || x.kind) + (x.media ? " + picture" : "") }), h("td", { text: x.text.length > 110 ? x.text.slice(0, 110) + "…" : x.text }),
              h("td", {}, x.id && h("a", { href: "https://x.com/i/status/" + x.id, target: "_blank", rel: "noopener", text: "View" }), " ", x.id && del));
          })))) : h("p", { class: "muted", text: "Nothing posted yet." }));
      body.replaceChildren(status, nextPanel, composer, weeklyPanel, freeGames, bundles, queue, hist);
    };
    try { await draw(); } catch (e) { fail(e); }
  }

  async function adminSystem(body, fail) {
    const draw = async () => {
      // don't redraw under someone who is typing in a box on this page
      if (body.children.length && body.contains(document.activeElement) && document.activeElement.tagName === "INPUT" && document.activeElement.type !== "checkbox") { adminTimer = setTimeout(() => draw().catch(() => {}), 10_000); return; }
      const sys = await api("/api/admin/system");
      if (!document.body.contains(body)) return;
      const p = sys.process, b = sys.bot || {};
      const up = s => { const d = Math.floor(s / 86400), hr = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${hr}h` : hr ? `${hr}h ${m}m` : `${m}m`; };
      const tile = (k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: String(v) }), sub && h("div", { class: "s", text: sub }));
      const lagBad = p.lagMs > 100;
      const st = await api("/api/admin/storage").catch(() => null);
      const [eg, se, cw, pb] = await Promise.all([api("/api/admin/errors").catch(() => null), api("/api/admin/serverevents").catch(() => null), api("/api/admin/commandwatch").catch(() => null), api("/api/admin/problems").catch(() => null)]);
      const ago = at => { const d = Math.round((Date.now() - at) / 1000); return d < 90 ? "just now" : up(d) + " ago"; };
      const errPanel = eg && h("div", { class: "panel" }, h("h3", { text: "Errors by cause" }),
        eg.groups.length ? h("div", { class: "scroll-y" }, h("table", {}, h("thead", {}, h("tr", {}, ["Where", "What", "Times", "Last seen"].map(c => h("th", { text: c })))),
          h("tbody", {}, eg.groups.map(g => h("tr", {}, h("td", {}, h("b", { text: g.where })), h("td", { text: g.message }), h("td", { text: String(g.count), class: g.count >= 10 ? "bad" : "" }), h("td", { text: ago(g.last) })))))) : h("p", { class: "muted", text: eg.available ? "No errors logged. Nice." : "The log isn't running." }));
      const pbPanel = pb && h("div", { class: "panel" }, h("h3", { text: "Quiet problems" }),
        h("p", { class: "muted", text: "Things that failed without anyone being told: a thank-you DM that wouldn't send, an X post that errored, a weekly post that didn't go out." }),
        pb.list.length ? h("div", {}, h("table", {}, h("thead", {}, h("tr", {}, ["Where", "What", "When"].map(c => h("th", { text: c })))),
          h("tbody", {}, pb.list.map(e => h("tr", {}, h("td", {}, h("b", { text: e.where })), h("td", { text: e.message }), h("td", { text: ago(e.at) }))))),
          (() => { const b = h("button", { class: "btn gray small", type: "button", text: "Clear the list" }); b.addEventListener("click", () => busy(b, async () => { await api("/api/admin/problems/clear", {}); adminRoute(); })); return b; })())
          : h("p", { class: "muted", text: "Nothing has failed quietly. All good." }));
      const cwPanel = cw && h("div", { class: "panel" }, h("h3", { text: "Busiest users" }),
        cw.rows.length ? h("table", {}, h("thead", {}, h("tr", {}, ["Discord ID", "Last hour", "Last 24 h", "Most used", ""].map(c => h("th", { text: c })))),
          h("tbody", {}, cw.rows.map(r => h("tr", {}, h("td", { text: r.id }), h("td", {}, h("b", { text: String(r.hour), class: r.heavy ? "bad" : "" })), h("td", { text: String(r.day) }), h("td", { text: r.top }),
            h("td", {}, (() => { const b = h("button", { class: "btn gray small", type: "button", text: "Restrict" }); b.addEventListener("click", () => { if (confirm("Cut " + r.id + " off from the bot and dashboard? You can undo it on the People page.")) busy(b, async () => { await api("/api/admin/ban", { id: r.id, ban: true, reason: "Too many commands" }); toast("Restricted.", "ok"); }); }); return b; })()))))) : h("p", { class: "muted", text: "No commands since the bot started." }),
        h("p", { class: "muted small", text: `Counts reset when the bot restarts. ${cw.threshold} or more in an hour is flagged.` }));
      const srvPanel = se && h("div", { class: "panel" }, h("h3", { text: "Server joins and leaves" }),
        se.list.length ? h("table", {}, h("thead", {}, h("tr", {}, ["", "Server", "Members", "When"].map(c => h("th", { text: c })))),
          h("tbody", {}, se.list.map(e => h("tr", {}, h("td", { text: e.kind === "join" ? "➕ Joined" : "➖ Left" }), h("td", {}, h("b", { text: e.name }), h("div", { class: "muted small", text: e.id })), h("td", { text: e.members != null ? String(e.members) : "–" }), h("td", { text: ago(e.at) }))))) : h("p", { class: "muted", text: "Nothing since this feature started. You also get a DM each time the bot is added or removed." }));
      const fmt = n => n >= 1024 ? (n / 1024).toFixed(2) + " GB" : n > 0 && n < 0.1 ? "under 0.1 MB" : n + " MB";
      const storagePanel = st && h("div", { class: "panel" }, h("h3", { text: "Storage" }),
        st.volume ? h("div", { class: "grid four" },
          tile("Disk used", st.volume.pct + "%", `${fmt(st.volume.usedMb)} of ${fmt(st.volume.totalMb)}`),
          tile("Free space", fmt(st.volume.freeMb), st.volume.pct >= 85 ? "Running low: extend the volume" : st.volume.pct >= 70 ? "Getting full, plan to extend" : "Plenty of room"),
          tile("Database", fmt(st.dbMb), st.walMb ? fmt(st.walMb) + " in the write log" : "Write log is empty"),
          tile("Backups", fmt(st.backupsMb), st.backupCount + (st.backupCount === 1 ? " file" : " files"))) : h("p", { class: "muted", text: "Disk size isn't available on this host." }),
        st.tables.length ? h("table", {}, h("thead", {}, h("tr", {}, [h("th", { text: "Biggest tables" }), h("th", { text: "Size" })])), h("tbody", {}, st.tables.map(t => h("tr", {}, h("td", { text: t.name }), h("td", { text: fmt(t.mb) }))))) : null);
      body.replaceChildren(
        h("div", { class: "grid four" }, tile("Uptime", up(p.uptimeS), b.version ? "Version " + b.version : p.node), tile("Discord ping", b.pingMs != null ? b.pingMs + " ms" : "–", b.servers != null ? b.servers + " servers" : null),
          tile("Memory", p.rssMb + " MB", `${p.heapMb} MB of ${p.heapLimitMb} MB heap`), tile("Event loop lag", p.lagMs + " ms", lagBad ? "Slow: something is blocking" : "Healthy")),
        h("div", { class: "grid four" }, tile("Started", new Date(sys.deploy.startedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }), sys.deploy.release ? `Release ${sys.deploy.release}${sys.deploy.machine ? " · machine " + sys.deploy.machine : ""}${sys.deploy.region ? " · " + sys.deploy.region : ""}` : "Not running on Fly"), tile("Signed in now", sys.sessions.signedIn, `${sys.sessions.steamOnly} Steam-only`), tile("Node", p.node, p.platform), tile("Admin address", sys.admin.host || "path /admin", sys.admin.sharedCookie ? "Shared sign-in on" : "Sign-in on this address only")),
        storagePanel,
        pbPanel,
        errPanel,
        cwPanel,
        srvPanel,
        h("div", { class: "panel" }, h("h3", { text: "Background jobs" }),
          sys.jobs && sys.jobs.length ? h("div", { class: "scroll-y" }, h("table", {}, h("thead", {}, h("tr", {}, ["Job", "Last run", "Took", "Result", "Failures"].map(c => h("th", { text: c })))),
            h("tbody", {}, sys.jobs.map(j => {
              const ago = j.lastRun ? up(Math.round((Date.now() - j.lastRun) / 1000)) + " ago" : "never";
              const bad = Boolean(j.lastError), stale = j.lastRun && Date.now() - j.lastRun > 3 * 3600_000;
              const det = j.detail ? Object.entries(j.detail).map(([k, v]) => `${v} ${k}`).join(", ") : "";
              return h("tr", {}, h("td", {}, h("b", { text: j.name })), h("td", { text: ago, class: stale ? "bad" : "" }), h("td", { text: j.ms != null ? (j.ms < 1000 ? j.ms + " ms" : (j.ms / 1000).toFixed(1) + " s") : "–" }),
                h("td", { class: bad ? "bad" : "", text: (bad ? "⚠️ " + j.lastError : "✅ ok") + (det ? " · " + det : "") }), h("td", { text: j.failures + " of " + j.runs }));
            })))) : h("p", { class: "muted", text: "No job has run yet since the bot started. They run every few minutes." })),
        h("div", { class: "panel" }, h("h3", { text: "Recent errors" }),
          sys.errors.length ? h("div", { class: "scroll-y" }, h("table", {}, h("thead", {}, h("tr", {}, [h("th", { text: "Where" }), h("th", { text: "When" })])), h("tbody", {}, sys.errors.map(e => h("tr", {}, h("td", { text: String(e.where) }), h("td", { text: new Date(e.at).toLocaleString() })))))) : h("p", { class: "muted", text: "None since the bot started." })),
        h("p", { class: "muted small", text: "This page refreshes by itself every 10 seconds." }));
      adminTimer = setTimeout(() => draw().catch(() => {}), 10_000);
    };
    try { await draw(); } catch (e) { fail(e); }
  }

  async function adminVotes(body, fail) {
    try {
      const v = await api("/api/admin/votes");
      if (!v.enabled) return body.replaceChildren(h("div", { class: "notice warn", text: "Top.gg isn't connected. Add the TOPGG_TOKEN secret on Fly and restart." }));
      const tile = (k, val, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: String(val) }), sub && h("div", { class: "s", text: sub }));
      const ago = at => { const d = Math.round((Date.now() - at) / 1000); return d < 90 ? "just now" : d < 3600 ? Math.round(d / 60) + " min ago" : d < 86400 ? Math.round(d / 3600) + " h ago" : Math.round(d / 86400) + " d ago"; };
      const ok = v.health.lastOkAt;
      body.replaceChildren(
        h("div", { class: "grid four" }, tile("Votes counted", v.votes.toLocaleString(), "Since tracking began"), tile("People who voted", v.voters.toLocaleString(), "All time"), tile("XP paid out", v.xp.toLocaleString(), `${v.perVote} per vote, double on weekends`),
          tile("Top.gg check", v.health.lastError ? "Failing" : ok ? "Working" : "Waiting", v.health.lastError ? "Last error: " + v.health.lastError : ok ? "Last check " + ago(ok) : "Runs every few minutes")),
        h("div", { class: "grid two" },
          h("div", { class: "panel" }, h("h3", { text: "Top voters" }),
            v.top.length ? h("table", {}, h("thead", {}, h("tr", {}, [h("th", { text: "Discord ID" }), h("th", { text: "Votes" })])), h("tbody", {}, v.top.map(t => h("tr", {}, h("td", { text: t.id }), h("td", { text: String(t.votes) }))))) : h("p", { class: "muted", text: "No votes yet." })),
          h("div", { class: "panel" }, h("h3", { text: "Latest votes" }),
            v.recent.length ? h("table", {}, h("thead", {}, h("tr", {}, ["When", "Voter", "XP"].map(c => h("th", { text: c })))), h("tbody", {}, v.recent.map(r => h("tr", {}, h("td", { text: ago(r.at) }), h("td", { text: r.id }), h("td", { text: `${r.xp}${r.servers ? " × " + r.servers + (r.servers === 1 ? " server" : " servers") : " (no XP yet)"}` }))))) : h("p", { class: "muted", text: "Nothing yet." }))));
    } catch (e) { fail(e); }
  }

  async function adminSupporters(body, fail) {
    try {
      const r = await api("/api/admin/supporters");
      const when = ms => new Date(ms).toLocaleDateString("en-US", { timeZone: "America/New_York" });
      const WHY = {
        "no-home-server": "I can't tell which server is your home server, because the bot is in more than one. On Fly, add a secret called MAIN_GUILD_ID with that server's ID (right-click the server with Developer Mode on, Copy Server ID), then restart.",
        "not-in-server": "The bot isn't in your home server any more.",
        "no-permission": "The bot doesn't have the Manage Roles permission in your home server. Turn it on for the bot's role in Server Settings, Roles.",
        "role-too-high": "A role called Supporter exists but sits above the bot's own role. In Server Settings, Roles, drag the bot's role above Supporter.",
        "not-a-member": "That person isn't in your home server. They get the role the moment they join.",
        "failed": "Discord refused the change. Check the bot's role is above Supporter and try again."
      };
      const id = h("input", { type: "text", placeholder: "Discord ID", inputmode: "numeric" }), days = h("input", { type: "number", min: "1", max: "3660", value: "30", class: "ovs-cur" });
      body.replaceChildren(
        r.home && !r.home.ok ? h("div", { class: "notice warn" }, h("strong", { text: "The Supporter role can't be given right now. " }), WHY[r.home.why] || "Something is off with the home server.") : null,
        r.home && r.home.ok ? h("div", { class: "notice ok", text: `The Supporter role goes out in ${r.home.name}.` }) : null,
        r.enabled ? null : h("div", { class: "notice warn", text: "Square isn't connected, so members can't buy a pass. Add SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID and SQUARE_WEBHOOK_SIGNATURE_KEY as secrets on Fly and restart. You can still hand passes out below." }),
        r.revenue && h("div", { class: "grid four" },
          ...[["Last 30 days", r.revenue.last30, r.revenue.count30 + " passes"], ["All time", r.revenue.total, r.revenue.count + " passes"], ["Refunded", r.revenue.refunded, r.revenue.refunds + " refund" + (r.revenue.refunds === 1 ? "" : "s") + ", not counted above"]].map(([k, c, s]) =>
            h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: "$" + (c / 100).toFixed(2) }), h("div", { class: "s", text: s })))),
        r.revenue && h("div", { class: "panel" }, h("h3", { text: "By month" }),
          h("p", { class: "muted small", text: `${r.revenue.founders} of ${r.revenue.foundersMax} founding spots taken. ${r.revenue.gifts} of the paid passes were gifts. Months are Eastern time.` }),
          r.revenue.months.length ? h("div", { class: "scroll-x" }, h("table", { class: "sup-table" }, h("thead", {}, h("tr", {}, ["Month", "Passes", "Sales", "Refunded"].map(c => h("th", { text: c })))),
            h("tbody", {}, ...r.revenue.months.map(m => h("tr", {}, h("td", { text: m.month }), h("td", { text: String(m.count) }), h("td", { text: "$" + (m.cents / 100).toFixed(2) }), h("td", { text: m.refunded ? "$" + (m.refunded / 100).toFixed(2) : "-" })))))) : h("p", { class: "muted", text: "No paid passes yet." })),
        h("div", { class: "panel" }, h("h3", { text: "Give someone a pass" }),
          h("div", { class: "row" }, id, days, h("span", { class: "muted small", text: "days" }),
            h("button", { class: "btn blue", type: "button", text: "Give pass", onclick: e => busy(e.currentTarget, async () => { const x = await api("/api/admin/supporters/grant", { user_id: id.value, days: Number(days.value) }); toast("Pass runs until " + when(x.until) + "." + (x.role && x.role !== "ok" ? " Role not given: " + (WHY[x.role] || x.role) : ""), x.role && x.role !== "ok" ? "warn" : "ok"); adminSupporters(body, fail); }) }))),
        h("div", { class: "panel" }, h("h3", { text: "Supporters" }),
          h("div", { class: "row" }, h("button", { class: "btn gray small", type: "button", text: "Re-send roles", title: "Give the Supporter role to everyone with a live pass", onclick: e => busy(e.currentTarget, async () => { const x = await api("/api/admin/supporters/resync", {}); const bad = Object.entries(x.problems); toast(bad.length ? `${x.ok} done. Not given: ` + bad.map(([k, n]) => `${n} (${(WHY[k] || k).split(".")[0]})`).join("; ") : `Role sent to ${x.ok}.`, bad.length ? "warn" : "ok"); }) }),
            h("button", { class: "btn gray small", type: "button", text: "Download CSV", onclick: e => busy(e.currentTarget, async () => { const x = await api("/api/admin/supporters.csv"); const a = h("a", { href: URL.createObjectURL(new Blob([x.csv], { type: "text/csv" })), download: "supporters.csv" }); document.body.append(a); a.click(); a.remove(); }) }),
            h("span", { class: "muted small", text: "Dates are Eastern time and end at 11:59 pm. Everything here is saved to the audit log." })),
          r.everyone.length ? h("div", { class: "scroll-x" }, h("table", { class: "sup-table" }, h("thead", {}, h("tr", {}, ["Discord ID", "Status", "Pass ends", "Add or remove days", "Founder", "Wall name", ""].map(c => h("th", { text: c })))),
            h("tbody", {}, r.everyone.map(a => {
              const call = (body, msg) => api("/api/admin/supporters/edit", { id: a.id, ...body }).then(x => { toast(msg + (x && x.role && x.role !== "ok" ? " Role not changed: " + (WHY[x.role] || x.role).split(".")[0] + "." : ""), x && x.role && x.role !== "ok" ? "warn" : "ok"); adminSupporters(body_, fail); }).catch(err => toast(err.message, "error"));
              const body_ = body;
              const date = h("input", { type: "date", value: a.until ? new Date(a.until).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : "", "aria-label": "Pass ends" });
              const days = h("input", { type: "number", value: "30", class: "ovs-cur", "aria-label": "Days to add" });
              const founder = h("input", { type: "checkbox", checked: a.founder, "aria-label": "Founding supporter" });
              const wall = h("input", { type: "text", maxlength: "24", value: a.wall, placeholder: "not shown", "aria-label": "Wall name" });
              return h("tr", {}, h("td", { text: a.id }), h("td", {}, h("span", { class: "pf-badge" + (a.active ? "" : " off"), text: a.active ? "Active" : "Ended" })),
                h("td", {}, h("div", { class: "row" }, date, h("button", { class: "btn gray small", type: "button", text: "Set", onclick: e => busy(e.currentTarget, () => call({ action: "set_until", date: date.value }, "Pass end date saved.")) }))),
                h("td", {}, h("div", { class: "row" }, days, h("button", { class: "btn gray small", type: "button", text: "Apply", onclick: e => busy(e.currentTarget, () => call({ action: "add_days", days: Number(days.value) }, "Days changed.")) }))),
                h("td", {}, (() => { founder.addEventListener("change", () => call({ action: "founder", on: founder.checked }, founder.checked ? "Marked as a founder." : "Founder mark removed.")); return founder; })()),
                h("td", {}, h("div", { class: "row" }, wall, h("button", { class: "btn gray small", type: "button", text: "Save", onclick: e => busy(e.currentTarget, () => call({ action: "wall", name: wall.value }, wall.value.trim() ? "Wall name saved." : "Taken off the wall.")) }))),
                h("td", {}, h("div", { class: "row" },
                  h("button", { class: "btn gray small", type: "button", text: "Re-send role", onclick: e => busy(e.currentTarget, () => call({ action: "resync" }, "Role re-sent.")) }),
                  a.active ? h("button", { class: "btn red small", type: "button", text: "End pass", onclick: e => busy(e.currentTarget, async () => { if (!confirm("End this pass now and take the Supporter role back?")) return; await call({ action: "remove" }, "Pass ended."); }) }) : null)));
            })))) : h("div", { class: "empty", text: "No supporters yet." })),
        h("div", { class: "panel" }, h("h3", { text: "Square activity" }), h("p", { class: "muted small", text: "Every call Square makes to the bot, newest first. If a payment never shows up here, Square isn't reaching it: check the webhook address and its events." }),
          r.payments.length ? h("table", {}, h("thead", {}, h("tr", {}, ["When", "What", "Details"].map(c => h("th", { text: c })))), h("tbody", {}, r.payments.map(e => h("tr", {}, h("td", { text: new Date(e.at).toLocaleString("en-US", { timeZone: "America/New_York" }) }), h("td", {}, h("b", { class: /Rejected|Error/.test(e.what) ? "bad" : "", text: e.what })), h("td", { text: e.detail || "" }))))) : h("div", { class: "empty", text: "Nothing yet." })),
        h("div", { class: "grid two" },
          h("div", { class: "panel" }, h("h3", { text: "Latest" }),
            r.recent.length ? h("table", {}, h("thead", {}, h("tr", {}, ["When", "Who", "Days", "Via"].map(c => h("th", { text: c })))), h("tbody", {}, r.recent.map(e => h("tr", {}, h("td", { text: new Date(e.at).toLocaleString("en-US", { timeZone: "America/New_York" }) }), h("td", { text: e.id }), h("td", { text: String(e.days) }), h("td", { text: e.via }))))) : h("div", { class: "empty", text: "Nothing yet." }))));
    } catch (e) { fail(e); }
  }

  /** Reported profile pages, plus a box to hide or restore any page by its name. */
  async function adminProfiles(body, fail) {
    try {
      const r = await api("/api/admin/profiles");
      const act = (slug, action, msg) => api("/api/admin/profiles", { slug, action }).then(() => { toast(msg, "ok"); adminProfiles(body, fail); }).catch(e => toast(e.message, "error"));
      const slug = h("input", { type: "text", placeholder: "Page name, like jacob", autocapitalize: "none", "aria-label": "Page name" });
      const ago = t => new Date(t).toLocaleString("en-US", { timeZone: "America/New_York" });
      const bySlug = new Map(); for (const x of r.reports) { const e = bySlug.get(x.slug) ?? { slug: x.slug, hidden: x.hidden, reasons: [], last: 0 }; e.reasons.push(x.reason); e.last = Math.max(e.last, x.at); bySlug.set(x.slug, e); }
      body.replaceChildren(
        h("div", { class: "panel" }, h("h3", { text: `Reported pages (${bySlug.size})` }),
          bySlug.size ? h("div", { class: "scroll-x" }, h("table", {}, h("thead", {}, h("tr", {}, ["Page", "Reports", "Latest", "What people said", ""].map(c => h("th", { text: c })))),
            h("tbody", {}, [...bySlug.values()].sort((a, b) => b.last - a.last).map(x => h("tr", {}, h("td", {}, h("a", { href: "/u/" + encodeURIComponent(x.slug), target: "_blank", rel: "noopener", text: "@" + x.slug }), x.hidden ? h("span", { class: "pf-badge off", text: "Hidden" }) : null),
              h("td", { text: String(x.reasons.length) }), h("td", { text: ago(x.last) }), h("td", { text: [...new Set(x.reasons)].slice(0, 3).join(" | ") }),
              h("td", {}, h("div", { class: "row" }, x.hidden ? h("button", { class: "btn gray small", type: "button", text: "Show again", onclick: e => busy(e.currentTarget, () => act(x.slug, "show", "Page is visible again.")) }) : h("button", { class: "btn red small", type: "button", text: "Hide page", onclick: e => busy(e.currentTarget, () => act(x.slug, "hide", "Page hidden.")) }),
                h("button", { class: "btn gray small", type: "button", text: "Dismiss", onclick: e => busy(e.currentTarget, () => act(x.slug, "dismiss", "Reports cleared.")) })))))))) : h("div", { class: "empty", text: "No reports. Nice." })),
        h("div", { class: "panel" }, h("h3", { text: "Hide or restore a page by name" }),
          h("div", { class: "row" }, slug, h("button", { class: "btn red small", type: "button", text: "Hide", onclick: e => busy(e.currentTarget, () => act(slug.value.trim().replace(/^@/, "").toLowerCase(), "hide", "Page hidden.")) }), h("button", { class: "btn gray small", type: "button", text: "Show", onclick: e => busy(e.currentTarget, () => act(slug.value.trim().replace(/^@/, "").toLowerCase(), "show", "Page is visible again.")) })),
          h("p", { class: "muted small", text: "A hidden page shows a not-found message to visitors. The owner can still see and edit it." })));
    } catch (e) { fail(e); }
  }

  async function adminDataReq(body, fail) {
    try {
      const r = await api("/api/admin/datarequests");
      const tile = (k, val, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: String(val) }), sub && h("div", { class: "s", text: sub }));
      body.replaceChildren(
        h("div", { class: "grid four" }, tile("Exports, 30 days", r.month.export), tile("Deletions, 30 days", r.month.delete), tile("Logged in all", r.list.length, "Newest 100 kept")),
        h("div", { class: "panel" }, h("h3", { text: "Requests" }),
          r.list.length ? h("table", {}, h("thead", {}, h("tr", {}, ["When", "Request", "From"].map(c => h("th", { text: c })))), h("tbody", {}, r.list.map(e => h("tr", {}, h("td", { text: new Date(e.at).toLocaleString() }), h("td", { text: e.kind === "delete" ? "🗑️ Deleted their data" : "📦 Exported their data" }), h("td", { text: e.via }))))) : h("p", { class: "muted", text: "Nobody has asked yet." }),
          h("p", { class: "muted small", text: "Requests are handled the moment they are made, so this is a record, not a queue. It keeps no names or IDs, so deleting someone's data never leaves a trace of who they were." })));
    } catch (e) { fail(e); }
  }

  async function adminAudit(body) {
    const rows = [];
    let more = false, q = "";
    const list = h("div"), search = h("input", { type: "search", placeholder: "Filter by action, person or detail", "aria-label": "Filter the audit log" });
    const more$ = h("button", { class: "btn gray small", type: "button", text: "Load older" });
    const csv = h("button", { class: "btn gray small", type: "button", text: "Download CSV" });
    const paint = () => {
      list.replaceChildren(rows.length ? h("div", { class: "scroll-y tall" }, h("table", {}, h("thead", {}, h("tr", {}, ["When", "Action", "Target", "Details"].map(c => h("th", { text: c })))),
        h("tbody", {}, rows.map(r => h("tr", {}, h("td", { text: new Date(r.at).toLocaleString() }), h("td", {}, h("b", { text: r.action })), h("td", { text: r.target || "–" }), h("td", { class: "adm-audit-detail", text: r.detail || "" })))))) : h("p", { class: "muted", text: q ? "Nothing matches." : "Nothing yet. Actions you take in this panel show up here." }));
      more$.hidden = !more;
    };
    const load = async reset => {
      if (reset) rows.length = 0;
      const before = rows.length ? rows[rows.length - 1].id : "";
      const r = await api(`/api/admin/audit?q=${encodeURIComponent(q)}${before ? "&before=" + before : ""}`);
      rows.push(...r.rows); more = r.more; paint();
    };
    let t = 0;
    search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { q = search.value.trim(); load(true).catch(e => toast(e.message, "bad")); }, 250); });
    more$.addEventListener("click", () => busy(more$, () => load(false)));
    csv.addEventListener("click", () => {
      const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const text = ["when,action,target,details", ...rows.map(r => [new Date(r.at).toISOString(), r.action, r.target, r.detail].map(esc).join(","))].join("\n");
      const a = h("a", { href: URL.createObjectURL(new Blob([text], { type: "text/csv" })), download: "admin-audit-log.csv" }); document.body.append(a); a.click(); a.remove();
    });
    body.replaceChildren(h("div", { class: "panel" }, h("div", { class: "lookup-row" }, search, csv), list, h("div", { class: "row" }, more$)));
    try { await load(true); } catch (e) { list.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
  }

  /** Ctrl+K: jump to a page, run a quick action, or look someone up by Discord ID. */
  function adminPalette() {
    if (document.querySelector(".adm-pal-back")) return;
    const items = [
      ...Object.entries(ADMIN_PAGES).map(([id, m]) => ({ label: m.title, hint: "Page", run: () => { location.hash = "#/" + id; } })),
      { label: "Download the latest backup", hint: "Action", run: () => { location.href = "/api/admin/backup"; } },
      { label: "Switch light / dark theme", hint: "Action", run: () => { window.svcTheme && window.svcTheme.toggle(); } },
      { label: "Open Steam Value Checker", hint: "Link", run: () => { location.href = state.cfg.siteUrl || "/"; } }];
    const input = h("input", { type: "text", placeholder: "Type a page, an action, or paste a Discord ID…", "aria-label": "Search the admin panel", autocomplete: "off", spellcheck: "false" });
    const ul = h("ul", { role: "listbox" });
    let shown = [], at = 0;
    const close = () => back.remove();
    const choose = it => { close(); it.run(); };
    const paint = () => {
      const q = input.value.trim().toLowerCase(), id = input.value.replace(/\D/g, "");
      shown = items.filter(i => !q || i.label.toLowerCase().includes(q));
      if (/^\d{5,25}$/.test(id)) shown.unshift({ label: `Look up member ${id}`, hint: "Person", run: () => adminMemberCard(id) });
      at = Math.min(at, Math.max(0, shown.length - 1));
      ul.replaceChildren(...(shown.length ? shown.map((it, i) => h("li", { class: i === at ? "on" : "", role: "option", onclick: () => choose(it) }, it.label, h("small", { text: it.hint }))) : [h("li", {}, "Nothing matches.")]));
    };
    input.addEventListener("input", () => { at = 0; paint(); });
    input.addEventListener("keydown", e => {
      if (e.key === "Escape") return close();
      if (e.key === "ArrowDown") { e.preventDefault(); at = Math.min(shown.length - 1, at + 1); paint(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); at = Math.max(0, at - 1); paint(); }
      else if (e.key === "Enter" && shown[at]) { e.preventDefault(); choose(shown[at]); }
    });
    const back = h("div", { class: "adm-pal-back", onclick: e => { if (e.target === back) close(); } },
      h("div", { class: "adm-pal" }, input, ul, h("div", { class: "adm-pal-foot" }, h("span", {}, h("kbd", { text: "↑↓" }), " move"), h("span", {}, h("kbd", { text: "Enter" }), " open"), h("span", {}, h("kbd", { text: "Esc" }), " close"))));
    document.body.append(back);
    paint(); input.focus();
  }

  /** A quick look at one person from the palette, with the actions you would reach for. */
  async function adminMemberCard(id) {
    const back = h("div", { class: "adm-pal-back", onclick: e => { if (e.target === back) back.remove(); } });
    const card = h("div", { class: "adm-card-modal" }, h("p", { class: "muted", text: "Looking them up…" }));
    back.append(card); document.body.append(back);
    document.addEventListener("keydown", function esc(e) { if (e.key === "Escape") { back.remove(); document.removeEventListener("keydown", esc); } });
    const draw = u => {
      const act = (label, action, cls = "gray") => h("button", { class: `btn ${cls} small`, type: "button", text: label, onclick: ev => busy(ev.currentTarget, async () => { draw(await api("/api/admin/user", { id: u.id, action })); toast("Done.", "ok"); }) });
      const ban = h("button", { class: "btn small " + (u.banned ? "green" : "red"), type: "button", text: u.banned ? "Lift restriction" : "Restrict", onclick: ev => busy(ev.currentTarget, async () => {
        if (u.banned) await api("/api/admin/ban", { id: u.id, ban: false });
        else { const r = prompt("Why are you restricting this person? (optional, only you see it)"); if (r === null) return; await api("/api/admin/ban", { id: u.id, ban: true, reason: r }); }
        u.banned = !u.banned; draw(u);
      }) });
      const t = (k, v) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: String(v) }));
      card.replaceChildren(h("h3", { text: "Member " + u.id }), u.banned ? h("div", { class: "notice warn", text: "This person is restricted." }) : null,
        h("div", { class: "grid four" }, t("Wishlist", u.wishlist), t("Library", u.library), t("Alerts", u.alerts), t("Failed DMs", u.dmFailures)),
        h("p", { class: "muted small", text: `Region ${u.region} · ${u.delivery} · language ${u.lang} · ${u.paused ? "alerts paused" : "alerts on"} · joined ${new Date(u.joined).toLocaleDateString()}` }),
        h("div", { class: "row" }, act("Reset failed DMs", "reset_dm"), u.paused ? act("Resume alerts", "resume", "green") : act("Pause alerts", "pause"), ban));
    };
    try { draw(await api("/api/admin/user?id=" + encodeURIComponent(id))); } catch (e) { card.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
  }

  // ---------- giveaways ----------
  // ---------- giveaway designer pieces, shared by the server form and the owner form ----------
  const PRIZE_TYPES = [
    ["key", "🎮", "Game key", "Hades | AAAAA-BBBBB-CCCCC"],
    ["nitro", "💎", "Discord Nitro", "nitro: Discord Nitro (1 month) | https://discord.gift/xxxxxxxx"],
    ["giftcard", "🎁", "Gift card", "giftcard: $20 Steam gift card | XXXX-XXXX-XXXX"],
    ["money", "💰", "Money", "money: $25 PayPal | sent by PayPal after the draw"],
    ["other", "🏅", "Other", "other: Signed poster | I will ship it, send me your address"]
  ];
  /** Buttons that add a prize line of each type, so nobody has to remember the format. */
  /** The "required steps" editor: rows of a kind, a link and an optional button label. get() gives the list to send. */
  function stepsEditor(kinds, { prefill = [] } = {}) {
    const rows = h("div"), list = [];
    const add = (kind = "follow_x", link = "") => {
      if (list.length >= 8) { toast("Up to 8 steps.", "warn"); return; }
      const sel = select(kinds.map(k => [k.id, k.label]), kind), url = h("input", { type: "url", maxlength: "300", placeholder: "https://…", "aria-label": "Step link", value: link });
      const label = h("input", { type: "text", maxlength: "80", placeholder: "Button text (optional)", "aria-label": "Step button text" });
      const hint = h("span", { class: "muted small" });
      const setHint = () => { const k = kinds.find(x => x.id === sel.value); hint.textContent = k ? k.hint : ""; };
      sel.addEventListener("change", setHint); setHint();
      const del = h("button", { class: "btn gray small", type: "button", text: "Remove" });
      const row = h("div", { class: "setup-row" }, h("div", { class: "row" }, sel, label, url, del), hint);
      const entry = { sel, url, label };
      del.addEventListener("click", () => { list.splice(list.indexOf(entry), 1); row.remove(); });
      list.push(entry); rows.append(row);
    };
    const quick = ["follow_twitch", "follow_x", "join_discord", "youtube", "wishlist_steam", "repost_x"].map(id => kinds.find(k => k.id === id)).filter(Boolean);
    const chips = h("div", { class: "chips" }, h("span", { class: "muted small", text: "Add a step: " }),
      quick.map(k => h("button", { type: "button", class: "tab small", text: k.label, onclick: () => add(k.id) })),
      h("button", { type: "button", class: "tab small", text: "Something else", onclick: () => add("custom") }));
    for (const x of prefill) add(x.kind, x.url);
    return { el: h("div", {}, chips, rows), get: () => list.map(e => ({ kind: e.sel.value, url: e.url.value, label: e.label.value })) };
  }
  function prizeButtons(area, after) {
    return h("div", { class: "chips" }, h("span", { class: "muted small", text: "Add a prize: " }),
      PRIZE_TYPES.map(([, icon, name, line]) => h("button", { type: "button", class: "tab small", text: `${icon} ${name}`, onclick: () => {
        area.value = (area.value && !area.value.endsWith("\n") ? area.value + "\n" : area.value) + line + "\n"; area.focus(); if (after) after();
      } })));
  }
  /** Reads the prize box the way the bot does, only enough to draw the preview. */
  function readPrizes(text) {
    const out = [];
    for (const raw of String(text || "").split(/\r?\n/)) {
      let line = raw.trim(); if (!line) continue;
      let kind = "key";
      const m = /^([a-z]+)\s*:\s*(.*)$/i.exec(line);
      if (m && PRIZE_TYPES.some(t => t[0] === m[1].toLowerCase())) { kind = m[1].toLowerCase(); line = m[2]; }
      const bar = line.lastIndexOf("|");
      const label = (bar >= 0 ? line.slice(0, bar) : (kind === "key" ? "Your game" : line)).trim() || (kind === "nitro" ? "Discord Nitro" : kind === "giftcard" ? "Gift card" : "Prize");
      out.push({ kind, label });
    }
    return out;
  }
  /** A Discord-style preview of the giveaway post that follows the form. get() returns the current values. */
  function giveawayPreview(get) {
    const pv = h("div", { class: "dpreview" });
    const THEME = { key: ["#ff9800", "🎮", "GIVEAWAY"], nitro: ["#5865f2", "💎", "DISCORD NITRO GIVEAWAY"], giftcard: ["#eb459e", "🎁", "GIFT CARD GIVEAWAY"], money: ["#2ecc71", "💰", "MONEY GIVEAWAY"], other: ["#fee75c", "🏅", "OTHER PRIZE GIVEAWAY"] };
    const icon = k => (PRIZE_TYPES.find(t => t[0] === k) || PRIZE_TYPES[0])[1];
    function paint() {
      const v = get(), prizes = readPrizes(v.keys);
      const kinds = [...new Set(prizes.map(p => p.kind))];
      const th = kinds.length === 1 ? THEME[kinds[0]] : ["#ff9800", "🎉", "GIVEAWAY"];
      const counts = new Map(); for (const p of prizes) { const id = p.kind + p.label; counts.set(id, (counts.get(id) || 0) + 1); }
      const lines = [...new Map(prizes.map(p => [p.kind + p.label, p])).values()].map(p => `${icon(p.kind)} ${p.label}${counts.get(p.kind + p.label) > 1 ? " ×" + counts.get(p.kind + p.label) : ""}`);
      const color = /^#?[0-9a-f]{6}$/i.test((v.color || "").trim()) ? "#" + v.color.trim().replace(/^#/, "") : th[0];
      const ok = u => /^https:\/\//i.test((u || "").trim());
      const card = h("div", { class: "dp-card" },
        h("div", { class: "dp-author", text: `${th[1]} ${th[2]}` }),
        h("div", { class: "dp-title", text: v.title || (prizes[0] ? prizes[0].label + (prizes.length > 1 ? ` + ${prizes.length - 1} more` : "") : "Your giveaway") }),
        v.desc ? h("div", { class: "dp-body", text: v.desc }) : null,
        h("div", { class: "dp-body" }, h("b", { text: `🏆 ${prizes.length === 1 ? "PRIZE" : `PRIZES (${prizes.length || 0})`}` }), h("div", { class: "dp-quote", text: lines.join("\n") || "Add a prize above" })),
        h("div", { class: "dp-fields" }, [["⏰ Ends", "in " + (v.length || "24h")], ["👑 Hosted by", v.host || "you"], ["🎟️ Entries", "0"]].map(([a, b]) => h("div", { class: "dp-field inline" }, h("b", { text: a }), h("div", { text: b })))),
        ok(v.image) ? h("img", { class: "dp-image", src: v.image.trim(), alt: "", referrerpolicy: "no-referrer" }) : (v.artUrl ? h("img", { class: "dp-image", src: v.artUrl, alt: "", referrerpolicy: "no-referrer" }) : null),
        h("div", { class: "dp-foot muted small", text: "Giveaway #1  •  Press the button to enter, press it again to leave" }),
        h("div", { class: "dp-btn", text: "🎉 " + (v.label || "Enter giveaway") }));
      if (ok(v.thumb)) card.classList.add("has-thumb"), card.append(h("img", { class: "dp-thumb", src: v.thumb.trim(), alt: "", referrerpolicy: "no-referrer" }));
      card.style.borderLeftColor = color;
      pv.replaceChildren(card);
    }
    paint();
    return { el: pv, paint };
  }

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
        holder.replaceChildren(giveawayForm(ch.channels, ro.roles, list.settings, list.stepKinds || []), giveawayTable(list.giveaways, ro.roles), setupPanel(ch.channels, ro.roles, list.settings));
      } catch (e) { holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }

    function giveawayForm(channels, roles, settings, stepKinds) {
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
          try { const r = await api("/api/giveaways/art?game=" + encodeURIComponent(q)); preview.replaceChildren(r.image ? h("img", { src: r.image, alt: q }) : h("span", { text: "No artwork found. Paste an image link under Look and rules." })); gp.paint(); }
          catch { preview.replaceChildren(h("span", { text: "Could not look up artwork." })); }
        }, 500);
      };
      const desc = h("textarea", { placeholder: "Extra text on the giveaway (optional)", maxlength: "1500" });
      const image = text("Your own image, GIF or video link, https (optional)", 500), thumb = text("Your own small picture or GIF link, https (optional)", 500);
      const auto = h("input", { type: "checkbox", checked: true });
      const color = text("#5865F2", 8), label = text("Enter giveaway", 40);
      const claim = text("48", 3, "number"), acct = text("0", 4, "number"), memb = text("0", 4, "number"), bonusN = text("2", 2, "number");
      const reqRole = roleMulti(roles), bonusRole = roleMulti(roles), overRole = roleMulti(roles), pingRole = roleSel();
      const reqAll = select([["any", "Any one of them"], ["all", "All of them"]], "any");
      const steps = stepsEditor(stepKinds);
      const boosters = h("input", { type: "checkbox" }), steamV = h("input", { type: "checkbox" });
      const startIn = text("Start later, e.g. 2h or 1d (blank = now)", 20), rounds = text("1", 2, "number"), repeatEvery = text("e.g. 7d", 20);
      const keys = h("textarea", { placeholder: "Hades | AAAAA-BBBBB-CCCCC\nCeleste | DDDDD-EEEEE-FFFFF\n(a key on its own uses the game name)", maxlength: "20000", autocomplete: "off", spellcheck: "false" });
      for (const el of [keys, game, image]) el.addEventListener("input", refreshPreview);
      const gp = giveawayPreview(() => ({ title: title.value.trim(), desc: desc.value.trim(), keys: keys.value, image: image.value, thumb: thumb.value, color: color.value, label: label.value.trim(), length: length.value.trim(), host: "@you", artUrl: preview.querySelector("img")?.src || "" }));
      for (const el of [title, desc, keys, image, thumb, color, label, length]) el.addEventListener("input", gp.paint);
      auto.addEventListener("change", () => { previewKey = ""; refreshPreview(); });
      // Templates keep everything except the prize keys.
      const FIELDS = { title, length, game, desc, image, thumb, auto, color, label, claim, acct, memb, bonusN, reqRole, reqAll, overRole, bonusRole, pingRole, vouchSel, boosters, startIn, rounds, repeatEvery, chSel };
      const grab = () => Object.fromEntries(Object.entries(FIELDS).map(([k, el]) => [k, el.type === "checkbox" ? el.checked : el.value]));
      const apply = data => { for (const [k, el] of Object.entries(FIELDS)) if (data[k] !== undefined) { if (el.type === "checkbox") el.checked = Boolean(data[k]); else el.value = data[k]; } previewKey = ""; refreshPreview(); gp.paint(); };
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
          require_role_ids: reqRole.value, require_all: reqAll.value === "all", override_role_ids: overRole.value, bonus_role_ids: bonusRole.value, ping_role_id: pingRole.value, vouch_channel_id: vouchSel.value, keys: keys.value,
          boosters: boosters.checked, steam_verified: steamV.checked, start_in: startIn.value, rounds: num(rounds), repeat_every: repeatEvery.value, steps: steps.get()
        });
        keys.value = "";
        toast(r.rounds > 1 ? `Series created: ${r.rounds} rounds scheduled.` : r.scheduled ? `Giveaway #${r.id} is scheduled.` : `Giveaway #${r.id} is live with ${r.prizes} prize${r.prizes === 1 ? "" : "s"}.`, "ok");
        load();
      }) });
      return h("div", { class: "panel" }, h("h3", { text: "Start a giveaway" }),
        h("div", { class: "row" }, field("Template", tplSel), field("Save these settings as", tplName), h("div", { class: "shrink" }, saveTpl, " ", delTpl)),
        field("Prizes (one per line)", keys), prizeButtons(keys, gp.paint),
        h("p", { class: "muted small", text: "Game keys, Discord Nitro links and gift card codes are kept encrypted and handed to the winner by the Claim button. Money and other prizes have no code: the bot tells you who won and you send it yourself." }),
        preview,
        h("div", { class: "row" }, field("Channel", chSel), field("Length", length)), presets,
        field("Title", title),
        h("p", { class: "muted small", text: "Codes are encrypted as soon as they are saved. Each is deleted once the winner confirms, and unused codes are sent back to you by DM. One winner per prize." }),
        h("h4", { text: "Look" }),
        h("div", { class: "grid two" }, h("div", {},
          field("Description", desc),
          h("div", { class: "row" }, field("Big picture, GIF or video link (https)", image), field("Small picture or GIF link (https)", thumb)),
          h("div", { class: "row" }, field("Game (for automatic artwork)", game), field("Enter button text", label), field("Color (#ff9800)", color)),
          h("label", { class: "check" }, auto, "Find artwork automatically when I don't give an image"),
          h("p", { class: "muted small", text: "Use a direct link to a picture (it ends in .png, .jpg, .gif or .webp). Links copied from a Discord message can expire, so host it somewhere permanent like Imgur." })),
          h("div", {}, h("b", { text: "Preview" }), gp.el)),
        h("h4", { text: "Required steps (optional)" }),
        h("p", { class: "muted small", text: "Ask people to do something first, like following you on X or Twitch, joining a Discord or wishlisting a game. Each step shows on the post as a numbered line and a link button. Discord can't check these, so it works on trust and winners may be checked." }),
        steps.el,
        h("details", { class: "more" }, h("summary", { text: "Rules, schedule and more (all optional)" }),
          h("div", { class: "row" }, field("Roles needed to enter (pick as many as you like)", reqRole), field("Entrants need", reqAll)),
          h("div", { class: "row" }, field("Skip every rule with this role (like Booster)", overRole)),
          h("div", { class: "row" }, field("Roles that get extra entries", bonusRole), field("Bonus entries (2-10)", bonusN)),
          h("div", { class: "row" }, field("Ping role", pingRole), field("Hours to claim", claim), field("Vouches channel", vouchSel)),
          h("div", { class: "row" }, field("Min. Discord account age (days)", acct), field("Min. days in this server", memb)),
          h("label", { class: "check" }, boosters, "Only server boosters can enter"),
          h("label", { class: "check" }, steamV, "Only Steam Verified members can enter"),
          h("h4", { text: "Schedule" }),
          h("div", { class: "row" }, field("Start in", startIn), field("Rounds (prizes are split across them)", rounds), field("Repeat every", repeatEvery))),
        h("p"), create);
    }

    // Change who can enter a giveaway that is already running. Blank pickers keep what is set; "Remove all rules" wipes them.
    function rulesEditor(g, roles, into) {
      const req = roleMulti(roles), over = roleMulti(roles), bonus = roleMulti(roles);
      const mode = select([["any", "Any one of them"], ["all", "All of them"]], "any");
      const extra = h("input", { type: "number", min: "2", max: "10", placeholder: "Extra entries (2-10)" });
      const steam = h("input", { type: "checkbox" });
      const save = h("button", { class: "btn blue small", type: "button", text: "Save rules" }), wipe = h("button", { class: "btn red small", type: "button", text: "Remove all rules" });
      const send = (b, extraBody, msg) => busy(b, async () => { await api("/api/giveaways/rules", { guild_id: guild.value, id: g.id, ...extraBody }); toast(msg, "ok"); into.replaceChildren(); });
      save.addEventListener("click", () => send(save, { require_role_ids: req.value, require_all: mode.value === "all", override_role_ids: over.value, bonus_role_ids: bonus.value, bonus_entries: extra.value || undefined, steam_verified: steam.checked ? true : undefined }, "Rules updated. The giveaway message now shows them."));
      wipe.addEventListener("click", () => send(wipe, { clear: true }, "All rules removed."));
      into.replaceChildren(h("div", { class: "panel" }, h("h4", { text: `Rules for #${g.id} (only what you fill in is added)` }),
        field("Roles needed to enter", req), field("Entrants need", mode), field("Skip every rule with this role", over), field("Roles that get extra entries", bonus), field("Bonus entries", extra),
        h("label", { class: "check" }, steam, "Only Steam Verified members can enter"), h("div", { class: "row" }, save, wipe)));
    }

    function giveawayTable(rows, roles = []) {
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
            g.status === "active" && !g.is_global ? (() => { const r = h("button", { class: "btn gray small", type: "button", text: "Rules" }); r.addEventListener("click", () => rulesEditor(g, roles, detail)); return r; })() : null,
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
  // The About page: the same numbers as the /bot about command in Discord.
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
        const tile = (icon, k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: String(v) }), sub && h("div", { class: "s", text: sub }));
        const row = (k, v) => h("div", { class: "kv" }, h("span", { class: "muted", text: k }), h("b", { text: v === null || v === undefined ? "-" : String(v) }));
        const up = d.uptime;
        holder.className = "status-page";
        holder.replaceChildren(...[
          h("div", { class: "st-banner " + d.overall },
            h("div", {}, h("span", { class: "st-dot " + d.overall }), h("strong", { text: HEAD[d.overall] || "Checking…" })),
            h("div", { class: "st-meta" }, h("span", { class: "muted small", text: d.checkedAt ? "Last checked " + ago(d.checkedAt) : "Starting up…" }), refresh)),
          st && h("div", { class: "grid four" },
            tile("", "Servers", n(st.servers)), tile("", "Members served", n(st.members)), tile("", "Games watched", n(st.gamesWatched)),
            tile("", "Uptime, 90 days", up.pct90 === null ? "-" : up.pct90 + "%", up.pct30 === null ? null : `${up.pct30}% over the last 30 days`)),
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
      const tile = (icon, k, v) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: String(v) }));
      holder.className = "about-page";
      holder.replaceChildren(
        // Drawn in the page rather than shown as a picture, so it stays sharp on any screen.
        h("div", { class: "about-banner-live", role: "img", "aria-label": "Steam Value Checker: MSRP, sale price and cheapest price now" },
          h("i", { class: "ab-ring r1", "aria-hidden": "true" }), h("i", { class: "ab-ring r2", "aria-hidden": "true" }),
          h("img", { class: "ab-tag", src: "/tag.svg", alt: "", width: "108", height: "120" }),
          h("div", { class: "ab-text" }, h("div", { class: "ab-title", text: "Steam Value Checker" }), h("div", { class: "ab-sub", text: "MSRP, sale price and cheapest price now" }), h("div", { class: "ab-note", text: "Works with FanaticalGrabber exports" }))),
        h("div", { class: "panel about" },
          h("div", { class: "about-head" },
            h("img", { class: "about-logo", src: "/logo.png", alt: "", width: "84", height: "84" }),
            h("div", {}, h("h3", { text: "Steam Value Checker" }),
              c && h("div", { class: "creator" }, h("img", { class: "creator-logo", src: "/creator.png", alt: "", width: "32", height: "32" }), "Created by ", ext(c.url, c.name)))),
          md(state.cfg.about),
          ab && h("p", { class: "muted small", text: "Online since " + new Date(ab.startedAt).toLocaleString() + " · v" + ab.version + " · Node " + String(ab.node).replace(/^v/, "") }),
          ab ? h("div", { class: "grid four about-stats" },
            tile("", "Uptime", ab.uptime), tile("", "Servers", n(ab.servers)), tile("", "Members reached", n(ab.members)), tile("", "Latency", ab.pingMs === null ? "-" : ab.pingMs + " ms"),
            tile("", "Games watched", n(ab.gamesWatched)), tile("", "Alerts, last 24h", n(ab.alerts24h)), tile("", "Giveaways run", n(ab.giveaways)), tile("", "Keys redeemed", n(ab.redeemed)))
            : h("p", { class: "muted", text: "Live numbers are not available right now." }),
          h("div", { class: "rule inline" },
            c && h("a", { class: "btn blue", href: safeHref(c.url), target: "_blank", rel: "noopener noreferrer", text: "Created by " + c.name }),
            h("a", { class: "btn gray", href: safeHref(state.cfg.fanaticalUrl), target: "_blank", rel: "noopener noreferrer", text: "FanaticalGrabber" }),
            h("a", { class: "btn gray", href: "/licenses.html", text: "Licenses" }))));
    } catch (e) { holder.className = ""; holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
  }

  /** Every command menu, as the bot shows it: hub, area, and how to type each command. Loaded from the bot's real command list. */
  function commandGuidePanel() {
    const body = h("div", { class: "cmd-guide" }, h("p", { class: "muted", text: "Loading the command list…" }));
    const panel = h("div", { class: "panel" }, h("h3", { text: "Commands and menus" }),
      h("p", { class: "muted small", text: "In Discord, type the hub name and pick menu (for example /server menu). It opens a private panel with live status for each area. Choose a command, fill in its options with dropdowns, member and channel pickers or a small form, and press Run. No typing of options needed. /alerts status opens your alert settings panel." }), body);
    api("/api/commands").then(d => {
      body.replaceChildren(...d.hubs.map(hub => h("details", { class: "cmd-hub" },
        h("summary", {}, h("strong", { text: "/" + hub.name }), " ", h("span", { class: "muted", text: hub.description })),
        hub.menu ? h("p", { class: "muted small" }, "Open the panel with ", h("code", { text: "/" + hub.name + " menu" }), ". Every command here can be filled in and run from it.")
          : hub.name === "alerts" ? h("p", { class: "muted small" }, "Open the settings panel with ", h("code", { text: "/alerts status" }), ".")
          : hub.name === "music" ? h("p", { class: "muted small" }, "Open the panel with the All commands button on ", h("code", { text: "/player" }), ".") : null,
        ...hub.areas.map(a => h("div", { class: "cmd-area" },
          h("div", { class: "chips" }, h("h4", { text: a.label }), a.page ? h("a", { class: "btn gray small", href: "#/" + a.page, text: "Open in the dashboard" }) : null),
          h("ul", { class: "cmd-list" }, ...a.items.map(i => h("li", {}, h("code", { text: i.usage }), " ", i.desc))))))));
    }).catch(e => body.replaceChildren(h("div", { class: "notice warn", text: e.message })));
    return panel;
  }

  function helpView() {
    app.replaceChildren(
      pageHead("Help", "The dashboard does everything the Discord commands do."),
      ...(state.cfg.supportUrl ? [h("div", { class: "panel support-panel" }, h("h3", { text: "Need a hand?" }),
        h("p", { class: "muted", text: "Join the support server to ask questions, share ideas, report bugs and see new features as they land." }),
        h("div", { class: "row" }, ext(state.cfg.supportUrl, "Join the support server", "btn blue big")))] : []),
      h("div", { class: "panel" }, h("h3", { text: "Using the bot" }), md(state.cfg.help)),
      commandGuidePanel(),
      h("div", { class: "panel" }, h("h3", { text: "Privacy" }), md(state.cfg.privacy)),
      fanaticalCard());
  }

  // ---------- routing ----------
  // ---------- support tickets ----------
  const STATUS_ICON = { open: "🟢", waiting: "🟡", resolved: "✅", closed: "⚫" };
  const STATUS_CHIP = { open: "ok", waiting: "warn", resolved: "", closed: "dim" };

  // ---------- feature requests ----------
  const REQ_CHIP = { open: "dim", planned: "ok", in_development: "ok", shipped: "ok", rejected: "warn", duplicate: "dim", on_hold: "warn" };
  const REQ_ICON = { open: "🗳️", planned: "📌", in_development: "🛠️", shipped: "🚀", rejected: "🚫", duplicate: "♻️", on_hold: "⏸️" };
  /** One request: title, text, status chip, vote button; the owner also gets a status picker and note. */
  function requestCard(r, d, reload, admin) {
    const vote = h("button", { class: "btn " + (r.voted ? "green" : "gray") + " small", text: `${r.voted ? "▲ Voted" : "▲ Vote"} · ${r.votes}` });
    vote.addEventListener("click", () => busy(vote, async () => { try { await api("/api/requests/vote", { id: r.id }); reload(); } catch (e) { toast(e.message, "error"); } }));
    const kids = [h("div", { class: "chips" }, h("strong", { text: r.title }), h("span", { class: "chip " + (REQ_CHIP[r.status] || "dim"), text: `${REQ_ICON[r.status] || ""} ${d.statuses[r.status] || r.status}` })),
      h("div", { class: "muted small", text: `${r.user_name || "A member"}${r.mine ? " (you)" : ""} · ${new Date(r.created_at).toLocaleDateString()}` })];
    if (r.body) kids.push(h("p", { class: "bug-text", text: r.body }));
    if (r.note) kids.push(h("div", { class: "notice" }, h("strong", { text: "From the developer: " }), r.note));
    kids.push(h("div", { class: "chips" }, vote));
    if (d.isOwner && admin) {
      const st = select(Object.entries(d.statuses), r.status), note = h("input", { type: "text", maxlength: "500", placeholder: "Note for the requester (optional)", value: r.note || "" });
      const save = h("button", { class: "btn blue small", text: "Save status", onclick: () => busy(save, async () => {
        const x = await api("/api/admin/requests/status", { id: r.id, status: st.value, note: note.value });
        toast(x.notified ? "Saved. The member was messaged." : "Saved.", "ok"); reload();
      }) });
      const del = h("button", { class: "btn red small", text: "Delete", onclick: () => { if (confirm("Delete this request?")) busy(del, async () => { await api("/api/admin/requests/delete", { id: r.id }); reload(); }); } });
      kids.push(h("div", { class: "row" }, field("Status", st), field("Note", note)), h("div", { class: "chips" }, save, del));
    }
    return h("div", { class: "bug-card" }, ...kids);
  }

  /** The list with filters; `admin` shows it inside the Admin tab (same cards, no submit form). */
  async function requestList(box, { admin = false } = {}) {
    let status = "", sort = "votes";
    async function load() {
      const d = await api("/api/requests?sort=" + sort + (status ? "&status=" + status : ""));
      const stSel = select([["", "All"], ...Object.entries(d.statuses)], status), sortSel = select([["votes", "Most votes"], ["new", "Newest"]], sort);
      stSel.addEventListener("change", () => { status = stSel.value; load().catch(e => toast(e.message, "error")); });
      sortSel.addEventListener("change", () => { sort = sortSel.value; load().catch(e => toast(e.message, "error")); });
      const parts = [];
      if (!admin) {
        const title = h("input", { type: "text", maxlength: "100", placeholder: "What would you like the bot to do?" });
        const body = h("textarea", { maxlength: "1000", placeholder: "More detail (optional): what problem does it solve?" });
        const send = h("button", { class: "btn green", text: "Send request", onclick: () => busy(send, async () => { await api("/api/requests", { title: title.value, body: body.value }); toast("Saved. Others can vote on it now.", "ok"); load().catch(() => {}); }) });
        parts.push(h("div", { class: "panel" }, h("h3", { text: "Suggest a feature" }), field("Idea", title), field("Details", body),
          h("p", { class: "muted small", text: `Check the list first and vote if it's already there. You can have ${d.max} requests waiting at once. You get a message when the status changes.` }), send));
      }
      parts.push(h("div", { class: "panel" }, h("h3", { text: `Requests (${Object.values(d.counts).reduce((a, b) => a + b, 0)})` }),
        h("div", { class: "row" }, field("Show", stSel), field("Sort", sortSel)),
        d.requests.length ? h("div", { class: "scroll-y tall" }, d.requests.map(r => requestCard(r, d, () => load().catch(e => toast(e.message, "error")), admin))) : h("p", { class: "muted", text: "Nothing here yet." })));
      box.replaceChildren(...parts);
    }
    try { await load(); } catch (e) { box.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
  }

  async function requestsView() {
    const box = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(pageHead("Feature requests", "Suggest something for the bot, vote on ideas, and see what's planned or being built."), box);
    await requestList(box);
    box.className = "";
  }

  // The same words as the Support page on the shop site.
  async function tipView() {
    const tip = state.cfg && state.cfg.tipUrl;
    app.replaceChildren(pageHead("Support the project", "Both tools are free, and they stay free. If one saved you money or time, you can chip in."),
      h("div", { class: "panel" },
        h("p", { text: "I make Steam Value Checker and FanaticalGrabber on my own and pay for the hosting out of pocket. Tips go toward the server bill and the time I spend fixing things. Nothing is locked behind them, and nobody gets treated differently for giving." }),
        tip ? h("p", {}, ext("https://www.paypal.com/paypalme/Lucadosus", "Chip in on PayPal", "btn blue")) : null,
        h("div", { id: "supporter-box" }),
        h("div", { id: "referral-box" }),
        h("h3", { text: "Other ways to help" }),
        h("ul", {},
          h("li", { text: "Add Steam Value Checker to a server and tell friends who buy too many bundles." }),
          h("li", { text: "Vote for the bot on Top.gg. Voting is free, and it earns you bonus XP in your servers." }),
          h("li", {}, "Send me a bug or an idea on ", ext("https://x.com/twit_user69", "X"), ". I read all of them.")),
        h("h3", { text: "Good to know" }),
        h("p", { class: "muted", text: "The PayPal button opens PayPal, which handles the payment. This dashboard never sees any payment details. A tip is a gift, not a purchase, and it doesn't buy a feature or a promise of support." })));
    if (!state.me) return;
    try { // invite links: each friend who joins earns the person a few supporter days
      const r = await api("/api/referral"), rb = document.getElementById("referral-box");
      if (rb) {
        const copy = h("button", { class: "btn blue", type: "button", text: "Copy my link" });
        copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(r.link); toast("Copied.", "ok"); } catch { toast("Select the link and copy it."); } });
        rb.replaceChildren(h("h3", { text: "Invite friends, earn supporter days" }),
          h("p", { class: "muted", text: `Share your own link. Every friend who signs in through it for the first time adds ${r.daysEach} days of supporter to your pass, up to ${r.max} friends.` }),
          h("div", { class: "row" }, h("input", { type: "text", value: r.link, readonly: "", size: "34", "aria-label": "Your invite link" }), copy),
          h("p", { class: r.full ? "notice ok" : "muted small", text: r.full ? `You've reached the limit: ${r.max} friends, ${r.daysEarned} days earned. Thank you for spreading the word!` : `${r.joined} of ${r.max} friends so far${r.joined ? ` (${r.daysEarned} days earned)` : ""}. Their Discord account has to be at least a week old to count.` }));
      }
    } catch { /* signed out or the feature is off */ }
    try {
      const s = await api("/api/supporter"), box = document.getElementById("supporter-box");
      if (!box || (!s.enabled && !s.until)) return;
      const fmt = ms => new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
      box.replaceChildren(h("h3", { text: "Supporter pass" }),
        routeText().includes("thanks=gift") ? h("div", { class: "notice ok", text: "Thank you! Your gift is on its way. They get a DM when it lands, and so do you." }) : routeText().includes("thanks=1") ? h("div", { class: "notice ok", text: "Thank you! Your pass shows up within a minute or two, and the bot will DM you when it does." }) : null,
        s.founder ? h("p", {}, h("span", { class: "pf-badge founder", text: "✦ Founding supporter" }), " You were one of the first 50, so this stays on your profile for good.") : null,
        s.until ? h("p", {}, h("strong", { text: "You're a supporter until " + fmt(s.until) + "." }), " Buying another pass adds to the time you have left.") : null,
        h("p", { class: "muted", text: `A pass gives you a Supporter role in the Steam Value Checker server, a badge and glowing ring on your profile, three exclusive profile themes, 24 overlay slots instead of 12, your own colour on your price-alert cards and ${Math.round((s.boost - 1) * 100)}% more XP. Everything else stays free for everyone.` }),
        s.enabled && !s.founder && s.founding_left > 0 ? h("p", { class: "muted small", text: s.founding_left === 50 ? "The first 50 paid passes earn a Founding supporter mark that never expires." : `${s.founding_left} of 50 Founding supporter spots left. It's a mark that never expires.` }) : null,
        s.enabled ? h("div", { class: "row" }, ...s.plans.map(p => h("button", { class: "btn blue", type: "button", text: `${p.name} · $${(p.cents / 100).toFixed(p.cents % 100 ? 2 : 0)}`, onclick: e => busy(e.currentTarget, async () => { const r = await api("/api/supporter/checkout", { plan: p.id }); location.href = r.url; }) }))) : null,
        s.enabled ? (() => {
          const to = h("input", { type: "text", placeholder: "Their page name or Discord ID", "aria-label": "Who to gift a pass to" });
          const plan = select(s.plans.map(p => [p.id, `${p.name} · $${(p.cents / 100).toFixed(p.cents % 100 ? 2 : 0)}`]), s.plans[0].id);
          return h("div", { class: "pass-gift" }, h("h4", { text: "Gift a pass 🎁" }), h("p", { class: "muted small", text: "Treat a friend. They get the role and perks, and a DM saying it's from you." }),
            h("div", { class: "row" }, to, plan, h("button", { class: "btn gray", type: "button", text: "Gift it", onclick: e => busy(e.currentTarget, async () => { try { const r = await api("/api/supporter/checkout", { plan: plan.value, gift_to: to.value }); location.href = r.url; } catch (err) { toast(err.message, "error"); } }) })));
        })() : null,
        s.enabled ? h("p", { class: "muted small", text: "Checkout is handled by Square. The bot never sees your card." }) : null,
        (s.until || s.founder) ? (() => {
          const nm = h("input", { type: "text", maxlength: "24", value: s.wall || "", placeholder: "A name to show, like Jacob" });
          return h("div", { class: "pass-wall-opt" }, h("h4", { text: "Supporter wall" }), h("p", { class: "muted small", text: "Want to be thanked in public? Pick a name and you'll show up below. It never links to your Discord. Clear it to leave." }),
            h("div", { class: "row" }, nm, h("button", { class: "btn gray", type: "button", text: "Save", onclick: e => busy(e.currentTarget, async () => { try { await api("/api/supporter/wall", { name: nm.value }); toast(nm.value.trim() ? "You're on the wall." : "Removed from the wall.", "ok"); tipView(); } catch (err) { toast(err.message, "error"); } }) })));
        })() : null,
        (s.until || s.founder) ? (() => {
          const pick = h("input", { type: "color", value: s.alert_color || "#57f287", "aria-label": "Alert colour" });
          return h("div", { class: "pass-wall-opt" }, h("h4", { text: "Alert colour" }), h("p", { class: "muted small", text: "Your own price alerts from the bot get the colour you pick down the side of the card." }),
            h("div", { class: "row" }, pick,
              h("button", { class: "btn gray", type: "button", text: "Save", onclick: e => busy(e.currentTarget, async () => { try { await api("/api/supporter/alertcolor", { color: pick.value }); toast("Your alerts will use that colour.", "ok"); } catch (err) { toast(err.message, "error"); } }) }),
              h("button", { class: "btn gray", type: "button", text: "Back to the default", onclick: e => busy(e.currentTarget, async () => { try { await api("/api/supporter/alertcolor", { color: "" }); toast("Back to the usual colours.", "ok"); tipView(); } catch (err) { toast(err.message, "error"); } }) })));
        })() : null);
    } catch { /* the pass is optional, so the rest of the page stands on its own */ }
    try {
      const w = (await api("/api/public/supporters")).wall;
      if (w.length) document.getElementById("supporter-box")?.after(h("div", { class: "panel pass-wall" }, h("h3", { text: "Thank you to" }), h("div", { class: "pass-wall-list" }, ...w.map(x => h("span", { class: "pf-badge" + (x.founder ? " founder" : ""), title: x.founder ? "Founding supporter" : "Supporter", text: (x.founder ? "✦ " : "★ ") + x.name })))));
    } catch { /* the wall is a nicety */ }
  }

  // Goal bars, server stats and timers for OBS, each with its own link and look, and a live preview that follows every change.
  async function overlaysView() {
    app.replaceChildren(pageHead("Overlay studio", "Build a goal bar, server stats or a timer, style it, and paste its link into OBS as a Browser source."), h("div", { class: "muted", text: "Loading…" }));
    let d;
    try { d = await api("/api/overlays"); } catch (e) { return app.replaceChildren(pageHead("Overlay studio", ""), h("div", { class: "notice warn", text: e.message })); }
    const KIND = { goal: ["Goal bar", "A progress bar toward a number you pick"], stats: ["Server stats", "Live member and boost counts"], timer: ["Timer", "Count down to a time, or count up from one"] };
    let sel = d.overlays[0]?.token ?? null, draft = null, frameTimer = 0;
    const list = h("div", { class: "ovs-list" }), editor = h("div", { class: "ovs-edit" });
    const find = tok => d.overlays.find(o => o.token === tok);
    const pad = v => String(v).padStart(2, "0");
    const toLocal = ms => { const x = new Date(ms || Date.now() + 30 * 60_000); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`; };
    const reload = async keep => { d = await api("/api/overlays"); if (keep !== undefined) sel = keep; paintList(); paintEditor(); };

    function paintList() {
      list.replaceChildren(
        ...d.overlays.map(o => h("button", { type: "button", class: "ovs-item" + (o.token === sel ? " on" : ""), onclick: () => { sel = o.token; paintList(); paintEditor(); } },
          h("strong", { text: o.name }), h("span", { class: "muted small", text: KIND[o.kind][0] }))),
        d.overlays.length ? null : h("p", { class: "muted small", text: "Nothing yet. Add one below." }),
        h("div", { class: "ovs-add" }, h("div", { class: "muted small", text: "Add an overlay" }),
          ...d.kinds.map(k => h("button", { type: "button", class: "btn gray small", title: KIND[k][1], text: "+ " + KIND[k][0], onclick: e => busy(e.currentTarget, async () => {
            const cfg = k === "timer" ? { at: Date.now() + 30 * 60_000 } : k === "goal" ? { target: 100 } : {};
            try { const r = await api("/api/overlays", { action: "create", kind: k, guild_id: k === "stats" ? d.guilds[0]?.id : undefined, config: cfg }); await reload(r.token); }
            catch (err) { toast(err.message, "error"); }
          }) }))));
    }

    function paintEditor() {
      const o = find(sel);
      if (!o) { editor.replaceChildren(h("div", { class: "panel" }, h("p", { class: "muted", text: "Pick an overlay on the left, or add a new one." }))); return; }
      draft = { name: o.name, guild_id: o.guild_id, config: { ...o.config }, value: o.value };
      const c = draft.config;
      const frame = h("iframe", { class: "ovs-frame", title: "Preview", loading: "lazy" });
      const sample = () => ({ current: o.kind === "goal" && c.source === "manual" ? draft.value : Math.round(c.target * 0.6), members: 1280, boosts: 14 });
      const refresh = () => { clearTimeout(frameTimer); frameTimer = setTimeout(() => { frame.src = "/ov?demo=1&k=" + o.kind + "&c=" + encodeURIComponent(JSON.stringify(c)) + "&v=" + encodeURIComponent(JSON.stringify(sample())); }, 120); };
      const row = (label, input) => h("label", { class: "ovs-row" }, h("span", { text: label }), input);
      const text = (key, max, ph) => { const i = h("input", { type: "text", maxlength: String(max), value: c[key] ?? "", placeholder: ph || "" }); i.addEventListener("input", () => { c[key] = i.value; refresh(); }); return i; };
      const color = key => { const i = h("input", { type: "color", value: c[key] }); i.addEventListener("input", () => { c[key] = i.value; refresh(); }); return i; };
      const range = (key, lo, hi, step = 1, unit = "") => { const out = h("span", { class: "muted small", text: c[key] + unit }); const i = h("input", { type: "range", min: String(lo), max: String(hi), step: String(step), value: String(c[key]) }); i.addEventListener("input", () => { c[key] = Number(i.value); out.textContent = i.value + unit; refresh(); }); return h("span", { class: "ovs-range" }, i, out); };
      const check = (key, label) => { const i = h("input", { type: "checkbox", checked: Boolean(c[key]) }); i.addEventListener("change", () => { c[key] = i.checked; refresh(); }); return h("label", { class: "ovs-check" }, i, " " + label); };
      const name = h("input", { type: "text", maxlength: "40", value: o.name }); name.addEventListener("input", () => { draft.name = name.value; });
      const server = h("select"); server.append(h("option", { value: "", text: "No server" }), ...d.guilds.map(g => h("option", { value: g.id, text: g.name, selected: g.id === o.guild_id })));
      server.addEventListener("change", () => { draft.guild_id = server.value || null; });
      const needsServer = o.kind === "stats" || (o.kind === "goal" && c.source !== "manual");

      const specific = [];
      if (o.kind === "goal") {
        const src = select([["manual", "A number I update myself"], ["members", "Server member count"], ["boosts", "Server boosts"]], c.source); src.addEventListener("change", () => { c.source = src.value; paintEditor(); });
        const tgt = h("input", { type: "number", min: "1", value: String(c.target) }); tgt.addEventListener("input", () => { c.target = Math.max(1, Number(tgt.value) || 1); refresh(); });
        specific.push(row("Label", text("label", 40, "Goal")), row("Counts", src), row("Target", tgt), row("Unit", text("unit", 12, "subs, $, boosts…")), row("When it's reached", text("doneText", 40, "Goal reached!")), check("showPercent", "Show the percentage"));
        if (c.source === "manual") {
          const cur = h("input", { type: "number", min: "0", value: String(o.value), class: "ovs-cur" });
          const send = async (by, set) => { try { const r = set !== undefined ? (await api("/api/overlays", { action: "save", token: o.token, value: set }), { value: set }) : await api("/api/overlays", { action: "bump", token: o.token, by }); o.value = draft.value = r.value; cur.value = String(r.value); refresh(); } catch (e) { toast(e.message, "error"); } };
          specific.push(h("div", { class: "ovs-bump" }, h("span", { class: "muted small", text: "Right now (changes show on stream within seconds)" }),
            h("div", { class: "row" }, ...[-10, -1, 1, 10].map(n => h("button", { type: "button", class: "btn gray small", text: (n > 0 ? "+" : "") + n, onclick: () => send(n) })), cur,
              h("button", { type: "button", class: "btn blue small", text: "Set", onclick: () => send(0, Math.max(0, Number(cur.value) || 0)) }))));
        }
      } else if (o.kind === "stats") {
        specific.push(row("Heading", text("label", 40, "Optional")), check("showMembers", "Show members"), row("Members label", text("membersLabel", 20)), check("showBoosts", "Show boosts"), row("Boosts label", text("boostsLabel", 20)));
      } else {
        const mode = select([["countdown", "Count down to a time"], ["countup", "Count up from a time"]], c.mode); mode.addEventListener("change", () => { c.mode = mode.value; refresh(); });
        const at = h("input", { type: "datetime-local", value: toLocal(c.at) }); at.addEventListener("input", () => { const ms = new Date(at.value).getTime(); if (Number.isFinite(ms)) { c.at = ms; refresh(); } });
        const soon = h("div", { class: "ovs-bump" }, h("span", { class: "muted small", text: "Start from now" }), h("div", { class: "row" }, ...[[5, "5 min"], [15, "15 min"], [30, "30 min"], [60, "1 hour"]].map(([m, l]) => h("button", { type: "button", class: "btn gray small", text: "In " + l, onclick: () => { c.at = Date.now() + m * 60_000; c.mode = "countdown"; mode.value = "countdown"; at.value = toLocal(c.at); refresh(); } }))));
        specific.push(row("Label", text("label", 40, "Starting soon")), row("Mode", mode), row("Time", at), soon, row("When it hits zero", text("endText", 40, "We're live!")));
      }
      const font = select(d.fonts.map(f => [f, f]), c.font); font.addEventListener("change", () => { c.font = font.value; refresh(); });
      const url = h("input", { type: "text", readonly: "readonly", value: o.url, onfocus: e => e.target.select() });
      const save = h("button", { type: "button", class: "btn blue", text: "Save", onclick: e => busy(e.currentTarget, async () => {
        try { await api("/api/overlays", { action: "save", token: o.token, name: draft.name, guild_id: needsServer ? (draft.guild_id || undefined) : (draft.guild_id ?? null), config: c }); toast("Saved. The overlay updates within seconds.", "ok"); await reload(o.token); }
        catch (err) { toast(err.message, "error"); }
      }) });
      editor.replaceChildren(
        h("div", { class: "panel" }, h("h3", { text: KIND[o.kind][0] }), row("Name", name), needsServer ? row("Server", server) : null, ...specific),
        h("div", { class: "panel" }, h("h3", { text: "Look" }),
          h("div", { class: "ovs-grid" }, row("Accent", color("accent")), row("Text", color("text")), row("Muted text", color("muted")), row("Background", color("bg")), row("Border", color("border")), row("Font", font)),
          row("Background opacity", range("bgOpacity", 0, 100, 1, "%")), row("Corner radius", range("radius", 0, 40, 1, "px")), row("Padding", range("padding", 4, 48, 1, "px")), row("Size", range("scale", 0.5, 3, 0.1, "×")),
          row("Refresh every", range("refresh", 5, 120, 5, "s")), h("div", { class: "row" }, check("showBorder", "Border"), check("shadow", "Drop shadow"))),
        h("div", { class: "panel" }, h("h3", { text: "Live preview" }), h("div", { class: "ovs-stage" }, frame),
          o.kind !== "timer" && (o.kind === "stats" || c.source !== "manual") ? h("p", { class: "muted small", text: "The preview uses sample numbers. On stream it shows your real ones." }) : null),
        h("div", { class: "panel" }, h("h3", { text: "OBS link" }), h("p", { class: "muted small", text: "In OBS: Sources, Add, Browser. Paste this as the URL, set the width and height to fit, and leave the background transparent. Keep the link private." }),
          h("div", { class: "row" }, url, h("button", { type: "button", class: "btn gray", text: "Copy", onclick: async () => { try { await navigator.clipboard.writeText(o.url); toast("Link copied.", "ok"); } catch { url.select(); toast("Select the link and copy it by hand.", "warn"); } } })),
          h("div", { class: "row" }, save,
            h("button", { type: "button", class: "btn gray", text: "New link", title: "The old link stops working", onclick: e => busy(e.currentTarget, async () => { if (!confirm("Make a new link? The old one stops working, so you'll need to paste the new one into OBS.")) return; try { const r = await api("/api/overlays", { action: "reset", token: o.token }); await reload(r.token); toast("New link made.", "ok"); } catch (err) { toast(err.message, "error"); } }) }),
            h("button", { type: "button", class: "btn gray", text: "Delete", onclick: e => busy(e.currentTarget, async () => { if (!confirm("Delete this overlay? Its link stops working.")) return; try { await api("/api/overlays", { action: "delete", token: o.token }); await reload(d.overlays.find(x => x.token !== o.token)?.token ?? null); } catch (err) { toast(err.message, "error"); } }) }))));
      refresh();
    }
    const mine = h("div", { class: "ovs" }, h("div", { class: "panel ovs-side" }, h("h3", { text: "Your overlays" }), list), editor);
    const TABS = [["mine", "Goal bars, stats and timers", () => mine], ["np", "Now playing", nowPlayingOverlayPanel], ["gw", "Giveaway", giveawayOverlayPanel], ["cards", "Deals and cards", streamCardPanel]];
    let tab = "mine"; try { tab = localStorage.getItem("svc_ovs_tab") || "mine"; } catch { /* fine */ }
    if (!TABS.some(t => t[0] === tab)) tab = "mine";
    const tabs = h("div", { class: "chips ovs-tabs", role: "tablist" }), stage = h("div");
    const show = key => {
      tab = key; try { localStorage.setItem("svc_ovs_tab", key); } catch { /* fine */ }
      tabs.replaceChildren(...TABS.map(([k, label]) => h("button", { type: "button", role: "tab", class: "chip-btn" + (k === key ? " on" : ""), "aria-selected": String(k === key), text: label, onclick: () => show(k) })));
      stage.replaceChildren(TABS.find(t => t[0] === key)[2]());
    };
    app.replaceChildren(pageHead("Overlay studio", "Every overlay for OBS in one place. Pick one, style it, and paste its link in as a Browser source."), tabs, stage);
    paintList(); paintEditor(); show(tab);
  }

  /** The now-playing card for OBS, with a server picker. Same panel the music page used to carry. */
  function nowPlayingOverlayPanel() {
    const servers = state.me.servers.filter(g => g.bot !== false);
    if (!servers.length) return h("div", { class: "notice warn", text: "The bot is not in any of your servers yet. Add it from the Servers page." });
    const guild = serverPicker(servers, currentParam());
    const box = h("div"), wrap = h("div");
    let ov = null, data = null, viz = null, vizGuild = "", ovBox = null;
    guild.addEventListener("change", () => { data = null; if (ov) ov.reload(); });
    const alive = () => wrap.isConnected && currentView() === "overlays";
    async function poll() {
      if (!alive()) { viz?.close(); viz = null; return; }
      try { data = await api("/api/music?guild=" + encodeURIComponent(guild.value)); } catch { data = null; }
      if (ov && data?.access?.canStream) {
        ovBox.hidden = false; ov.update();
        if (!viz || vizGuild !== guild.value) { viz?.close(); vizGuild = guild.value; viz = window.EventSource ? new EventSource("/api/music/viz?guild=" + encodeURIComponent(guild.value)) : null; if (viz) viz.onmessage = ev => { try { const m = JSON.parse(ev.data); if (m.p) ov.viz(m); } catch { /* ignore */ } }; }
        box.replaceChildren();
      } else if (ovBox) { ovBox.hidden = true; box.replaceChildren(h("div", { class: "notice", text: "You need permission to stream in this server to use this overlay. Ask a server manager, or pick another server." })); }
      setTimeout(poll, 3000);
    }
    (async () => {
      try { await overlayAssets(); } catch { box.replaceChildren(h("div", { class: "notice warn", text: "The overlay couldn't load. Refresh and try again." })); return; }
      ov = window.SvcOverlayPanel({ api, toast, getData: () => data, getGuild: () => guild.value, storeKey: "svc_music_ov" });
      ovBox = h("div", { class: "panel" }, h("h3", { text: "Now playing overlay" }), ov.el);
      wrap.append(ovBox); poll();
    })();
    wrap.prepend(servers.length > 1 ? h("div", { class: "panel" }, field("Server", guild)) : null, box);
    return wrap;
  }

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
        toast(`Ticket #${r.id} opened.`); navigate("/support/" + r.id);
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
      h("p", { class: "muted small", text: "With a channel set, new tickets are posted there with Reply, Assign and Resolve buttons. Without one they go to the bot owner. Same as /bot support setup." }),
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
  const TYPE_LABEL = { alert: "Sale alerts", bundle: "Bundles & giveaways", free: "Free games", news: "News and patch notes", dlc: "DLC sales", refund: "Refund reminders", milestones: "Playtime milestones", yearly: "Year in games", nudge: "Backlog pick", achv: "Achievements", playtest: "Playtests and demos", digest: "Weekly digest", release: "Release day", friend: "Friend birthdays", codes: "Game code alerts", promo: "Promo news alerts" };
  const PRIZE_STATUS = { assigned: "Waiting for you to claim", delivered: "Key sent", confirmed: "Redeemed", problem: "Problem reported", expired: "Expired" };
  const TYPE_ICON = { alert: "🔔", bundle: "🎁", free: "🆓", news: "🛠️", digest: "📰", release: "🎉", friend: "🎂", status: "🛠️", giveaway: "🏆", ticket: "🎫", codes: "🔑", promo: "🎟️" };

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

  // One notification. A digest carries its games, so it opens like an accordion: picture, price, discount and a link for each.
  function noteCard(n) {
    const when = new Date(n.at).toLocaleString();
    if (n.items && n.items.length) {
      const first = n.body ? plainDiscord(n.body).split("\n")[0].slice(0, 120) : "";
      return h("details", { class: "card-link note-open" + (n.read ? "" : " unread") },
        h("summary", {}, h("span", { class: "icon", text: TYPE_ICON[n.type] || "🔔" }),
          h("span", {}, h("strong", { text: n.title }), h("span", { class: "muted", text: `${when}${first ? " · " + first : ""} · tap to see the games` }))),
        h("div", { class: "note-games" }, ...n.items.map(g => h("div", { class: "note-game" },
          g.image ? h("img", { src: g.image, alt: "", loading: "lazy", width: "120", height: "56", referrerpolicy: "no-referrer", onerror: e => e.currentTarget.remove() }) : h("span", { class: "noimg" }),
          h("div", { class: "note-info" },
            h("div", {}, g.url && /^https:\/\//.test(g.url) ? h("a", { href: g.url, target: "_blank", rel: "noopener noreferrer", text: g.title + " ↗" }) : h("strong", { text: g.title })),
            h("div", { class: "muted small", text: `${g.price} · -${g.discount}% at ${g.shop}${g.low ? " · all-time low" : ""}${g.ends ? " · ends " + new Date(g.ends).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}` }),
            g.gid ? h("a", { class: "small", href: "#/g/" + encodeURIComponent(g.gid), text: "Price history and details" }) : ""))))); 
    }
    const link = n.url && /^https:\/\//.test(n.url);
    return h(link ? "a" : "div", { class: "card-link" + (n.read ? "" : " unread"), ...(link ? { href: n.url, target: "_blank", rel: "noopener noreferrer" } : {}) },
      h("span", { class: "icon", text: TYPE_ICON[n.type] || "🔔" }),
      h("span", {}, h("strong", { text: n.title }), h("span", { class: "muted", text: `${when}${n.body ? " · " + plainDiscord(n.body).slice(0, 160) : ""}` })));
  }

  async function notificationsView() {
    const holder = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(pageHead("Notifications", "A copy of every alert the bot sends you, so a missed DM is never lost. Muted kinds are kept here but not sent to Discord (change that in Alert settings)."), holder);
    try {
      const d = await api("/api/notifications");
      const prizes = (await api("/api/claims").catch(() => ({ prizes: [] }))).prizes;
      holder.className = "";
      holder.replaceChildren(...[
        prizes.length ? h("div", { class: "panel" }, h("h3", { text: "Your prizes" }),
          h("p", { class: "muted small", text: "Press Claim prize on the winners message in Discord. Keys are never shown here." }),
          ...prizes.map(p => h("div", { class: "kv" }, h("span", {}, h("b", { text: p.label + " " }), h("span", { class: "muted", text: `${p.title} · ${PRIZE_STATUS[p.status] || p.status}${p.status === "assigned" && p.deadline ? " · claim by " + new Date(p.deadline).toLocaleString() : ""}` })),
            p.link ? ext(p.link, "Open in Discord") : null))) : null,
        h("p", { class: "muted small" }, "Choose what is sent to Discord in ", h("a", { href: "#/alerts", text: "Alert settings" }), "."),
        (() => {
          // Filter what is kept here by kind of alert and by words in the title.
          const KIND = { alert: "Sales", sale: "Sales", bundle: "Bundles", free: "Free games", news: "News", digest: "Digest", release: "Releases", codes: "Codes", promo: "Promos", friend: "Friends" };
          const kinds = [...new Set(d.items.map(n => n.type).filter(Boolean))];
          let kind = "", q = "";
          const list = h("div", { class: "cards" });
          const paint = () => {
            const rows = d.items.filter(n => (!kind || n.type === kind) && (!q || (String(n.title) + " " + String(n.body || "")).toLowerCase().includes(q)));
            list.replaceChildren(...(rows.length ? rows.map(noteCard) : [h("p", { class: "muted", text: d.items.length ? "Nothing matches." : "Nothing yet. Alerts will show up here." })]));
            chips.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String((b.dataset.kind || "") === kind)));
          };
          const chip = (k, text) => { const b = h("button", { type: "button", class: "chip", "data-kind": k, text }); b.addEventListener("click", () => { kind = k; paint(); }); return b; };
          const chips = h("div", { class: "row chips" }, chip("", "All"), ...kinds.map(k => chip(k, KIND[k] || k[0].toUpperCase() + k.slice(1))));
          const search = h("input", { type: "search", placeholder: "Search your alerts", "aria-label": "Search your alerts" });
          search.addEventListener("input", () => { q = search.value.trim().toLowerCase(); paint(); });
          paint();
          return h("div", { class: "panel" }, h("h3", { text: "Recent" }), d.items.length > 3 ? h("div", { class: "lookup-row" }, search) : null, d.items.length > 3 && kinds.length > 1 ? chips : null, list);
        })()].filter(Boolean));
      if (d.unread) { await api("/api/notifications/read", {}); state.me.unread = 0; renderChrome(); }
    } catch (e) { holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
  }

  // ---------- music ----------
  async function musicView() {
    const holder = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(pageHead("Music", "Play SoundCloud songs, playlists and live radio in a voice channel. Join one in your server, then add music here or with /play."), holder);
    const big = h("a", { class: "btn blue", href: "#", target: "_blank", rel: "noopener", text: "View the big music player ↗", title: "Opens the full-screen player with session chat" });
    app.insertBefore(h("div", { class: "row" }, big), holder);
    const fmt = sec => { sec = Math.max(0, Math.floor(sec || 0)); const hh = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60; return (hh ? hh + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
    const toSeconds = text => { const t = String(text).trim().toLowerCase(); if (/^\d+$/.test(t)) return Number(t); const m = t.match(/^(?:(\d+):)?(\d+):(\d{1,2})$/) || t.match(/^()(\d+):(\d{1,2})$/); if (m) return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]); return NaN; };
    const TIERS = { manager: ["Server manager", "You can change every music setting and control the player."], moderator: ["Moderator", "You can control the player and take down any request."], dj: ["DJ", "You can control the player."], listener: ["Listener", "You can add songs and vote to skip. Only DJs, moderators and managers use the other controls when this server has a DJ role."] };
    let list;
    try { list = (await api("/api/music")).guilds; } catch (e) { return holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    if (!list.length) return holder.replaceChildren(h("div", { class: "empty", text: "I don't share a server with you yet. Add the bot to a server, then come back." }));
    let saved = ""; try { saved = localStorage.getItem("svc_music_guild") || ""; } catch { /* storage blocked */ }
    const pick = h("select", { "aria-label": "Server" }, ...list.map(g => h("option", { value: g.id, text: g.name + (g.active ? "  ·  playing" : ""), selected: g.id === saved })));
    const body = h("div");
    let timer = 0, tick = 0, built = false, cur = null;
    const stop = () => { clearTimeout(timer); clearInterval(tick); };
    const alive = () => currentView() === "music" && document.body.contains(body);
    // The OBS overlay panel lives on this page (same panel as the music studio's Stream tab). It follows what is actually playing.
    let streamNote = null;
    function streamPanel(d) {
      if (!d.access?.canStream) return;
      if (!streamNote?.isConnected) { streamNote = h("div", { class: "notice" }, "The OBS overlay for what's playing moved to the ", h("a", { href: "#/overlays", text: "Overlay studio" }), "."); body.append(streamNote); }
    }
    const syncers = []; // little functions that re-check what the person is allowed to do after every refresh
    const typing = box => box && box.contains(document.activeElement) && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);

    async function load(rebuild) {
      if (rebuild && !built) body.replaceChildren(h("p", { class: "muted", text: "Loading…" }));
      let d;
      try { d = await api("/api/music?guild=" + encodeURIComponent(pick.value)); } catch (e) { return body.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
      cur = d;
      if (rebuild || !built) { built = true; build(d); } else update(d);
      clearTimeout(timer); timer = setTimeout(() => { if (alive()) load(false); }, 3000);
    }
    const bigLink = () => { const base = state.cfg?.musicUrl || "/music"; const q = base + (base.includes("?") ? "&" : "?") + "guild=" + encodeURIComponent(pick.value); big.href = q; };
    bigLink();
    pick.addEventListener("change", () => { bigLink(); try { localStorage.setItem("svc_music_guild", pick.value); } catch { /* fine */ } stop(); built = false; load(true); });

    const gid = () => pick.value;
    const act = (label, action, extra = {}, cls = "gray") => {
      const b = h("button", { class: "btn small " + cls, type: "button", text: label });
      b.addEventListener("click", () => busy(b, async () => {
        const r = await api("/api/music/control", { guild_id: gid(), action, ...extra });
        if (r.result && r.result.skipped === false) toast(`Vote to skip: ${r.result.votes}/${r.result.need}`, "ok");
        await load(false);
      }));
      return b;
    };
    const inChannel = a => a.present && a.enabled && a.inVoice && a.sameChannel;

    // ----- parts that refresh every few seconds -----
    const npBox = h("div", { class: "panel" }), queueBox = h("div", { class: "panel" }), reqBox = h("div", { class: "panel" });
    function paintNow(d) {
      const st = d.status, a = d.access, t = st.current, can = inChannel(a);
      const bar = h("div", { class: "bar" }), fill = h("div", { class: "fill" }); bar.append(fill);
      const pos = h("span", { class: "muted small" });
      const stamp = Date.now();
      const draw = () => { if (!t || t.live) return; const p = st.paused ? st.position : st.position + (Date.now() - stamp) / 1000; const q = Math.min(p, t.duration || p); fill.style.width = t.duration ? Math.min(100, (q / t.duration) * 100) + "%" : "0%"; pos.textContent = t.duration ? `${fmt(q)} / ${fmt(t.duration)}` : fmt(q); };
      clearInterval(tick); draw(); if (t && !t.live && !st.paused) tick = setInterval(() => { if (alive()) draw(); }, 1000);
      const vol = h("input", { type: "range", min: "1", max: "100", value: String(st.volume), "aria-label": "Volume", disabled: !can || !t || !a.dj });
      vol.addEventListener("change", () => api("/api/music/control", { guild_id: gid(), action: "volume", value: Number(vol.value) }).then(() => load(false)).catch(e => toast(e.message, "error")));
      const loopSel = select([["off", "Loop: off"], ["track", "Loop: this song"], ["queue", "Loop: whole queue"]], st.loop);
      loopSel.disabled = !can || !t || !a.dj;
      loopSel.addEventListener("change", () => api("/api/music/control", { guild_id: gid(), action: "loop", value: loopSel.value }).then(() => load(false)).catch(e => toast(e.message, "error")));
      const lock = b => { if (!can || !t) b.disabled = true; return b; };
      const seekIn = h("input", { type: "text", placeholder: "1:30", size: "6", "aria-label": "Jump to a time", disabled: !can || !t || t.live || !a.dj });
      const seekGo = h("button", { class: "btn gray small", type: "button", text: "Jump", disabled: !can || !t || t.live || !a.dj });
      seekGo.addEventListener("click", () => { const n = toSeconds(seekIn.value); if (!Number.isFinite(n)) return toast("Type a time like 1:30.", "error"); busy(seekGo, async () => { await api("/api/music/control", { guild_id: gid(), action: "seek", value: n }); await load(false); }); });
      const sub = [t?.artist, st.paused ? "paused" : "playing", st.channelName ? "in " + st.channelName : ""].filter(Boolean).join(" · ");
      const tag = t?.live ? h("span", { class: "chip bad", text: "● LIVE" }) : t?.auto ? h("span", { class: "chip", text: "Auto DJ" }) : t?.submitted ? h("span", { class: "chip ok", text: "Member request" }) : "";
      const role = TIERS[a.tier] ?? TIERS.listener;
      const dj = !a.dj ? h("p", { class: "muted small", text: "This server uses a DJ role, so only DJs, moderators and managers can pause, shuffle or change the volume. You can still add songs and vote to skip." }) : "";
      const note = !a.enabled ? "Music is turned off in this server." : !a.inVoice ? "Join a voice channel in this server to add songs or use the controls." : !a.sameChannel ? "I'm playing in another voice channel. Join it to use the controls." : `You're in ${a.voiceName}.`;
      npBox.replaceChildren(h("h3", { text: "Now playing" }),
        t ? h("div", { class: "music-now" },
          t.thumb ? h("img", { src: t.thumb, alt: "", width: "96", height: "96", referrerpolicy: "no-referrer" }) : h("span", { class: "noimg", text: t.live ? "📻" : "" }),
          h("div", { class: "music-meta" }, h("div", {}, t.live ? h("span", { text: t.title }) : h("a", { href: t.url, target: "_blank", rel: "noopener noreferrer", text: t.title + " ↗" }), " ", tag), h("div", { class: "muted small", text: sub }), t.live ? h("div", { class: "muted small", text: "Live stream, no end" }) : bar, t.live ? "" : pos))
          : h("p", { class: "muted", text: st.active ? (st.auto.waiting ? `Waiting in ${st.channelName ?? "the voice channel"} for someone to join. ` + (d.autodj.lastStation && d.settings.radio ? `It goes back to ${d.autodj.lastStation}.` : st.auto.on ? "It starts the Auto DJ." : "Add something to get it going.") : st.auto.on ? "The queue is empty. The Auto DJ will start in a moment." : "The queue is empty. Add something below.") : "Nothing is playing." }),
        h("div", { class: "row" }, lock(act("⏮", "previous")), lock(act(st.paused ? "▶ Resume" : "⏸ Pause", st.paused ? "resume" : "pause", {}, st.paused ? "green" : "blue")), lock(act("⏭ Skip", "skip")), lock(act("⏹ Stop", "stop", {}, "red")), lock(act("🔀 Shuffle", "shuffle")), lock(act("Leave", "leave"))),
        h("div", { class: "row" }, field("Volume " + st.volume + "%", vol), field("Loop", loopSel), field("Jump to", h("div", { class: "row" }, seekIn, seekGo))),
        h("p", { class: "muted small", text: note }), h("p", { class: "muted small" }, h("b", { text: role[0] + ": " }), role[1]), dj);
    }
    function paintQueue(d) {
      const st = d.status, can = inChannel(d.access);
      const rows = st.next.map((x, i) => h("div", { class: "cal-row" }, h("span", { class: "muted", text: String(i + 1) }),
        h("div", {}, x.live ? h("span", { text: x.title }) : h("a", { href: x.url, target: "_blank", rel: "noopener noreferrer", text: x.title }), h("div", { class: "muted small", text: [x.artist, x.live ? "live" : x.duration ? fmt(x.duration) : ""].filter(Boolean).join(" · ") })),
        h("div", { class: "row" }, ...(can ? [act("⏭", "skipto", { n: i + 1 }), ...(i > 0 ? [act("▲", "move", { from: i + 1, to: i })] : []), act("✕", "remove", { n: i + 1 }, "red")] : []))));
      queueBox.replaceChildren(h("h3", { text: `Queue (${st.total} song${st.total === 1 ? "" : "s"}${st.totalSeconds ? " · " + fmt(st.totalSeconds) : ""})` }),
        rows.length ? h("div", { class: "scroll-y tall" }, ...rows) : h("p", { class: "muted", text: "Nothing waiting." }),
        rows.length && can && d.access.dj ? h("div", { class: "row" }, act("Clear the queue", "clear", {}, "red")) : "");
    }
    function paintReqs(d) {
      const s = d.settings, a = d.access, subs = d.submissions;
      reqBox.style.display = s.autodj ? "" : "none";
      if (!s.autodj) return;
      if (typing(reqBox)) return;
      const q = h("input", { type: "text", placeholder: "SoundCloud song or playlist link, or words to search", maxlength: "300", "aria-label": "Request a song" });
      const go = h("button", { class: "btn green", type: "button", text: "Request" }), find = h("button", { class: "btn blue", type: "button", text: "Search" });
      const results = h("div");
      go.disabled = find.disabled = !(a.enabled && s.autodj_submit);
      const send = (extra = {}) => api("/api/music/submit", { guild_id: gid(), query: q.value, ...extra }).then(r => { toast(r.added > 1 ? `Requested ${r.added} songs.` : "Requested. It plays before the Auto DJ's own songs.", "ok"); q.value = ""; results.replaceChildren(); return load(false); });
      go.addEventListener("click", () => busy(go, () => send()));
      q.addEventListener("keydown", e => { if (e.key === "Enter" && !go.disabled) go.click(); });
      find.addEventListener("click", () => busy(find, async () => {
        const r = await api("/api/music/search?guild=" + encodeURIComponent(gid()) + "&q=" + encodeURIComponent(q.value));
        results.replaceChildren(r.results.length ? h("div", { class: "cards" }, ...r.results.map(x => { const b = h("button", { class: "btn green small", type: "button", text: "Request" }); b.addEventListener("click", () => busy(b, () => send({ query: "", tracks: [x] }))); return h("div", { class: "note-game" }, x.thumb ? h("img", { src: x.thumb, alt: "", width: "56", height: "56", referrerpolicy: "no-referrer" }) : h("span", { class: "noimg" }), h("div", { class: "note-info" }, h("a", { href: x.url, target: "_blank", rel: "noopener noreferrer", text: x.title + " ↗" }), h("span", { class: "muted small", text: [x.artist, x.duration ? fmt(x.duration) : ""].filter(Boolean).join(" · ") })), b); })) : h("p", { class: "muted", text: "No results." }));
      }));
      const rows = subs.map(r => h("div", { class: "cal-row" }, r.thumb ? h("img", { src: r.thumb, alt: "", width: "40", height: "40", referrerpolicy: "no-referrer" }) : h("span", { class: "noimg" }),
        h("div", {}, h("a", { href: r.url, target: "_blank", rel: "noopener noreferrer", text: r.title }), h("div", { class: "muted small", text: [r.artist, "requested by " + (r.mine ? "you" : r.name)].filter(Boolean).join(" · ") })),
        (r.mine || a.dj) ? (() => { const b = h("button", { class: "btn red small", type: "button", text: "✕", title: "Take it off the list" }); b.addEventListener("click", () => busy(b, async () => { await api("/api/music/submission", { guild_id: gid(), id: r.id }); await load(false); })); return b; })() : ""));
      const clearBtn = (a.dj && subs.length > 1) ? (() => { const b = h("button", { class: "btn red small", type: "button", text: "Clear all requests" }); b.addEventListener("click", () => { if (!confirm("Remove every request from the list?")) return; busy(b, async () => { await api("/api/music/submission", { guild_id: gid(), action: "clear" }); await load(false); }); }); return b; })() : "";
      reqBox.replaceChildren(h("h3", { text: `Auto DJ requests (${subs.length} waiting)` }),
        h("p", { class: "muted small", text: s.autodj_submit ? "Ask for songs without being in the voice channel. The Auto DJ plays requests, oldest first, before its own playlist. Up to 5 waiting per person." : "Requests are turned off in this server." }),
        s.autodj_submit ? h("div", { class: "lookup-row" }, q, go, find) : "", results,
        subs.length ? h("div", { class: "scroll-y tall" }, ...rows) : h("p", { class: "muted", text: "No requests right now." }), clearBtn);
    }
    function update(d) { paintNow(d); paintQueue(d); paintReqs(d); streamPanel(d); for (const f of syncers) f(d); }

    // ----- parts that stay put while you type -----
    function addPanel(d) {
      const q = h("input", { type: "text", placeholder: "SoundCloud link (song or playlist), a live radio stream link, or words to search for", maxlength: "300", "aria-label": "Song, playlist, stream link or search" });
      const next = h("input", { type: "checkbox" }), shuf = h("input", { type: "checkbox" });
      const results = h("div");
      const play = h("button", { class: "btn green", type: "button", text: "Play" }), find = h("button", { class: "btn blue", type: "button", text: "Search" });
      const add = (extra = {}) => api("/api/music/play", { guild_id: gid(), query: q.value, next: next.checked, shuffle: shuf.checked, ...extra }).then(r => { toast(r.startedNow ? `Playing: ${r.title}` : r.added > 1 ? `Added ${r.added} songs.` : "Added to the queue.", "ok"); q.value = ""; results.replaceChildren(); return load(false); });
      play.addEventListener("click", () => busy(play, () => add()));
      q.addEventListener("keydown", e => { if (e.key === "Enter" && !play.disabled) play.click(); });
      find.addEventListener("click", () => busy(find, async () => {
        const r = await api("/api/music/search?guild=" + encodeURIComponent(gid()) + "&q=" + encodeURIComponent(q.value));
        results.replaceChildren(r.results.length ? h("div", { class: "cards" }, ...r.results.map(x => { const b = h("button", { class: "btn green small", type: "button", text: "Add" }); b.addEventListener("click", () => busy(b, () => add({ query: "", tracks: [x] }))); return h("div", { class: "note-game" }, x.thumb ? h("img", { src: x.thumb, alt: "", width: "56", height: "56", referrerpolicy: "no-referrer" }) : h("span", { class: "noimg" }), h("div", { class: "note-info" }, h("a", { href: x.url, target: "_blank", rel: "noopener noreferrer", text: x.title + " ↗" }), h("span", { class: "muted small", text: [x.artist, x.duration ? fmt(x.duration) : ""].filter(Boolean).join(" · ") })), b); })) : h("p", { class: "muted", text: "No results." }));
      }));
      syncers.push(d2 => { play.disabled = find.disabled = !inChannel(d2.access); });
      return h("div", { class: "panel" }, h("h3", { text: "Add music" }), h("div", { class: "lookup-row" }, q, play, find),
        h("div", { class: "row" }, h("label", { class: "check" }, next, " Play next"), h("label", { class: "check" }, shuf, " Shuffle if it's a playlist")),
        h("p", { class: "muted small", text: "Paste a SoundCloud song, playlist (set) or artist link to queue it all (up to 100 songs), or a live radio stream link (an Icecast or Shoutcast address like https://play.sas-media.ru/play_256), or type words and press Search." }), results);
    }
    function stationsPanel(d) {
      const out = h("div"), chips = h("div", { class: "row" }), btn = h("button", { class: "btn blue small", type: "button", text: "Show stations on the air" });
      let data = null, cat = "";
      const paint = () => {
        chips.replaceChildren(...[{ id: "", name: "All" }, ...data.categories].map(c => { const b = h("button", { class: "btn small " + (c.id === cat ? "blue" : "gray"), type: "button", text: c.name }); b.addEventListener("click", () => { cat = c.id; paint(); }); return b; }));
        const list = data.stations.filter(x => !cat || x.cat === cat);
        out.replaceChildren(list.length ? h("div", { class: "scroll-y tall" }, ...list.map(x => { const b = h("button", { class: "btn green small", type: "button", text: "Play" }); b.disabled = !inChannel(cur.access) || !cur.settings.radio; b.addEventListener("click", () => busy(b, async () => { const p = await api("/api/music/play", { guild_id: gid(), query: x.url }); toast(p.startedNow ? `Playing: ${x.title}` : "Added to the queue.", "ok"); await load(false); })); return h("div", { class: "cal-row" }, h("span", { text: "📻" }), h("div", {}, h("b", { text: x.title }), h("div", { class: "muted small", text: x.genre ?? "" })), b); })) : h("p", { class: "muted", text: data.stations.length ? "No stations of that kind are on the air right now." : "None of the stations answered just now. Try again in a minute." }));
      };
      btn.addEventListener("click", () => busy(btn, async () => { data = await api("/api/music/stations?guild=" + encodeURIComponent(gid())); paint(); }));
      return h("div", { class: "panel" }, h("h3", { text: "Live radio" }), h("p", { class: "muted small", text: d.settings.radio ? "Hip hop, R&B, dance, chill, rock, throwbacks and more. Stations are checked when you ask, so everything listed is on the air. You can also paste any stream link above." : "Live radio is turned off in this server. A manager can allow it below." }), h("div", { class: "row" }, btn), chips, out);
    }
    function playlistsPanel(d) {
      const pname = h("input", { type: "text", maxlength: "40", placeholder: "Name for a new playlist", "aria-label": "Playlist name" });
      const saveBtn = h("button", { class: "btn blue small", type: "button", text: "Save current queue" });
      saveBtn.addEventListener("click", () => busy(saveBtn, async () => { await api("/api/music/playlists", { guild_id: gid(), action: "save", name: pname.value }); toast("Saved.", "ok"); await load(true); }));
      const rows = d.playlists.map(p => { const lb = h("button", { class: "btn green small", type: "button", text: "Queue it" }), db2 = h("button", { class: "btn red small", type: "button", text: "Delete" });
        syncers.push(d2 => { lb.disabled = !inChannel(d2.access); });
        lb.addEventListener("click", () => busy(lb, async () => { const r = await api("/api/music/playlists", { guild_id: gid(), action: "load", name: p.name }); toast(`Added ${r.added} songs.`, "ok"); await load(false); }));
        db2.addEventListener("click", () => { if (!confirm("Delete this playlist?")) return; busy(db2, async () => { await api("/api/music/playlists", { guild_id: gid(), action: "delete", name: p.name }); await load(true); }); });
        return h("div", { class: "row", style: "align-items:center;justify-content:space-between" }, h("span", {}, h("b", { text: p.name }), h("span", { class: "muted small", text: `  ${p.count} song${p.count === 1 ? "" : "s"}` })), h("div", { class: "row" }, lb, db2)); });
      return h("div", { class: "panel" }, h("h3", { text: "My playlists" }), h("p", { class: "muted small", text: "Saved to your account, so you can load them in any server. Up to 10 playlists of 100 songs." }),
        ...(rows.length ? rows : [h("p", { class: "muted", text: "None yet." })]), h("div", { class: "lookup-row" }, pname, saveBtn));
    }
    function autoPanel(d) {
      const s = d.settings;
      const on = h("input", { type: "checkbox", checked: Boolean(s.autodj) }), sub = h("input", { type: "checkbox", checked: Boolean(s.autodj_submit) }), shuf = h("input", { type: "checkbox", checked: Boolean(s.autodj_shuffle) });
      const idle = h("input", { type: "number", min: "5", max: "600", value: String(s.autodj_idle) });
      const vc = h("select", {}, h("option", { value: "", text: "Only when someone starts it (stays in the channel it's already in)" }), ...(d.voiceChannels ?? []).map(c => h("option", { value: c.id, text: "🔊 " + c.name, selected: c.id === s.autodj_channel_id })));
      const link = h("input", { type: "text", maxlength: "300", placeholder: "SoundCloud playlist link", "aria-label": "Auto DJ playlist link" });
      const savedSel = select([["", "Or use one of my saved playlists…"], ...d.playlists.map(p => [p.name, `${p.name} (${p.count})`])], "");
      const save = h("button", { class: "btn green", type: "button", text: "Save Auto DJ settings" });
      const call = (extra, ok) => api("/api/music/autodj", { guild_id: gid(), ...extra }).then(r => { toast(r.note || ok || "Saved.", "ok"); return load(true); });
      save.addEventListener("click", () => busy(save, () => call({ autodj: on.checked, autodj_submit: sub.checked, autodj_shuffle: shuf.checked, autodj_idle: Number(idle.value), autodj_channel_id: vc.value })));
      const setLink = h("button", { class: "btn blue small", type: "button", text: "Use this playlist" });
      setLink.addEventListener("click", () => busy(setLink, () => call({ playlist_url: link.value })));
      const useSaved = h("button", { class: "btn blue small", type: "button", text: "Use it" });
      useSaved.addEventListener("click", () => { if (!savedSel.value) return toast("Pick a saved playlist first.", "error"); busy(useSaved, () => call({ saved_playlist: savedSel.value })); });
      const clr = h("button", { class: "btn red small", type: "button", text: "Remove playlist" });
      clr.addEventListener("click", () => { if (!confirm("Remove the Auto DJ's playlist?")) return; busy(clr, () => call({ clear_playlist: true })); });
      const pl = d.autodj.playlist;
      const preview = pl.length ? h("div", { class: "scroll-y tall" }, ...pl.slice(0, 50).map((t, i) => h("div", { class: "cal-row" }, h("span", { class: "muted", text: String(i + 1) }), t.thumb ? h("img", { src: t.thumb, alt: "", width: "40", height: "40", referrerpolicy: "no-referrer", loading: "lazy" }) : h("span", { class: "noimg" }), h("div", {}, h("a", { href: t.url, target: "_blank", rel: "noopener noreferrer", text: t.title }), h("div", { class: "muted small", text: [t.artist, t.duration ? fmt(t.duration) : ""].filter(Boolean).join(" · ") }))))) : h("p", { class: "muted", text: "No playlist yet. Paste a SoundCloud playlist link above." });
      return h("div", { class: "panel" }, h("h3", { text: "Auto DJ" }),
        h("p", { class: "muted small", text: "Keeps music going. When the bot sits in a voice channel with nothing playing for a while, it starts the playlist you choose. Members' requests play first, and anyone's /play beats the playlist right away. Turn on \"Stay in the last voice channel\" in the server settings below and the bot also waits there when everyone has left, then picks the last live station back up (or starts this playlist) when someone joins." }),
        h("label", { class: "check" }, on, " Auto DJ is on"), h("label", { class: "check" }, sub, " Members can request songs (even from outside the voice channel)"), h("label", { class: "check" }, shuf, " Shuffle the playlist"),
        h("div", { class: "row" }, field("Start after this many seconds of silence", idle), field("Join this voice channel by itself", vc)),
        save, h("hr"), h("h4", { text: `Playlist (${d.autodj.count} songs${s.autodj_source && /^https?:/.test(s.autodj_source) ? "" : ""})` }),
        h("div", { class: "lookup-row" }, link, setLink), h("div", { class: "lookup-row" }, savedSel, useSaved), d.autodj.count ? h("div", { class: "row" }, clr) : "", preview);
    }
    function settingsPanel(d) {
      const s = d.settings;
      const on = h("input", { type: "checkbox", checked: Boolean(s.enabled) }), ann = h("input", { type: "checkbox", checked: Boolean(s.announce) }), vcs = h("input", { type: "checkbox", checked: Boolean(s.vc_status) }), stay = h("input", { type: "checkbox", checked: Boolean(s.stay) }), radio = h("input", { type: "checkbox", checked: Boolean(s.radio) });
      const num = (v, lo, hi) => h("input", { type: "number", min: String(lo), max: String(hi), value: String(v) });
      const vol = num(s.volume, 1, 100), mq = num(s.max_queue, 5, 500), mm = num(s.max_minutes, 0, 600), lv = num(s.leave_minutes, 1, 60);
      const role = h("select", {}, h("option", { value: "", text: "Everyone can use the controls" }), ...d.roles.filter(r => r.id !== d.guild.id).map(r => h("option", { value: r.id, text: "DJ role: " + r.name, selected: r.id === s.dj_role_id })));
      const chan = h("select", {}, h("option", { value: "", text: "Where the song was added from" }), ...d.channels.map(c => h("option", { value: c.id, text: "#" + c.name, selected: c.id === s.channel_id })));
      const save = h("button", { class: "btn green", type: "button", text: "Save music settings" });
      save.addEventListener("click", () => busy(save, async () => { await api("/api/music/settings", { guild_id: gid(), enabled: on.checked, announce: ann.checked, vc_status: vcs.checked, stay: stay.checked, radio: radio.checked, volume: Number(vol.value), max_queue: Number(mq.value), max_minutes: Number(mm.value), leave_minutes: Number(lv.value), dj_role_id: role.value, channel_id: chan.value }); toast("Saved.", "ok"); await load(true); }));
      return h("div", { class: "panel" }, h("h3", { text: "Server music settings" }), h("p", { class: "muted small", text: "Only people with Manage Server see this. Moderators (the role from community setup) can always use the DJ controls. The bot needs Connect and Speak in your voice channels, plus Send Messages where it posts." }),
        h("label", { class: "check" }, on, " Music is on"), h("label", { class: "check" }, ann, " Post a message when each song starts"), h("label", { class: "check" }, vcs, " Show the song as the voice channel's status (the line under its name)"), h("label", { class: "check" }, stay, " Stay in the last voice channel and wait for people (goes back to the last live station, or starts the Auto DJ, when someone joins)"), h("label", { class: "check" }, radio, " Allow live radio stream links"),
        h("div", { class: "row" }, field("Controls", role), field("Now-playing messages go to", chan)),
        h("div", { class: "row" }, field("Starting volume (1-100)", vol), field("Most songs in the queue", mq), field("Longest song, minutes (0 = no limit)", mm), field("Leave after idle (minutes)", lv)), save);
    }
    function build(d) {
      clearInterval(tick); syncers.length = 0;
      body.replaceChildren(npBox, addPanel(d), stationsPanel(d), queueBox, reqBox, playlistsPanel(d), ...(d.channels ? [autoPanel(d), settingsPanel(d)] : [])); streamPanel(d);
      reqBox.replaceChildren();
      update(d);
    }

    holder.className = ""; holder.replaceChildren(field("Server", pick), body);
    load(true);
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
    return h("div", { class: "notice news" }, h("span", { text: "New: " + (state.me.newsTitle || "see what changed") + ". " }), h("a", { href: "#/changelog", text: "See what's new" }),
      h("button", { class: "btn gray small", text: "Dismiss", onclick: async e => { const box = e.currentTarget.parentElement; state.me.news = null; box.remove(); try { await api("/api/changelog/seen", {}); } catch {} } }));
  }

  /** A Steam-only session (Discord would not finish silently): the Discord half is one click away. */
  function discordBanner() {
    if (!state.me || !state.me.steamOnly) return null;
    return h("div", { class: "notice warn" }, h("span", { text: "You are signed in with Steam only. Connect Discord to see your servers, run giveaways and manage alerts. " }), h("a", { class: "btn blue small", href: "/auth/login", text: "Connect Discord" }));
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
  if (!NATIVE) document.addEventListener("keydown", e => {
    const t = e.target, typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    if (e.key === "Escape") return closeSearch();
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k" && state.me && !/^\/admin/.test(location.pathname)) { e.preventDefault(); return openSearch(); }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || !state.me) return;
    if (e.key === "/") { e.preventDefault(); return openSearch(); }
    if (e.key === "?") return toast("Keys: / or Ctrl+K search · g then w wishlist, l library, a alerts, s servers, n notifications, h help", "ok");
    if (gPending) { gPending = false; const dest = { w: "wishlist", l: "library", a: "alerts", s: "servers", n: "notifications", h: "help", t: "support", v: "value" }[e.key]; if (dest) navigate("/" + dest); return; }
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
    // One game: who in the server owns it, to get a co-op group going.
    const coopIn = h("input", { type: "text", maxlength: "100", placeholder: "A game's name", "aria-label": "Game name" }), coopOut = h("div");
    const coopGo = h("button", { class: "btn blue small", type: "button", text: "Find owners" });
    const coopRun = () => busy(coopGo, async () => {
      coopOut.replaceChildren();
      const d = await api(`/api/coop?guild=${encodeURIComponent(guild.value)}&game=${encodeURIComponent(coopIn.value)}`);
      coopOut.replaceChildren(d.owners.length ? h("div", {}, h("p", { text: `${d.owners.length} ${d.owners.length === 1 ? "member owns" : "members own"} ${d.game}:` }), h("ul", {}, d.owners.map(o => h("li", { text: `${o.name} · ${o.hours ? o.hours + "h played" : "hasn't started"}` }))))
        : h("p", { class: "muted", text: "Nobody here who shares their library owns it yet." }));
    }).catch(e => toast(e.message, "error"));
    coopGo.addEventListener("click", coopRun);
    coopIn.addEventListener("keydown", e => { if (e.key === "Enter") coopRun(); });
    app.append(h("div", { class: "panel" }, h("h3", { text: "Who owns a game?" }), h("div", { class: "row" }, coopIn, coopGo), coopOut));
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
    const recapOut = h("div");
    const recapBtn = h("button", { class: "btn gray", text: "Show sale recap", onclick: () => busy(recapBtn, async () => {
      const r = await api("/api/saleprep/recap");
      recapOut.replaceChildren(r.alerts ? h("div", { class: "panel" }, h("h3", { text: "Last " + r.days + " days" }), h("p", { text: "Your alerts caught " + r.games + " games, " + r.spend.toFixed(2) + " at the alert prices" + (r.saved > 0 ? ", " + r.saved.toFixed(2) + " under regular." : ".") }),
        h("ul", { class: "plain" }, r.top.map(a => h("li", {}, h("b", { text: a.title }), " ", h("span", { class: "muted", text: a.price.toFixed(2) + (a.regular ? " (was " + a.regular.toFixed(2) + ")" : "") + (a.shop ? " at " + a.shop : "") }))))) : h("div", { class: "empty", text: "No sale alerts in the last " + r.days + " days." }));
    }) });
    app.replaceChildren(pageHead("Sale planner", "Plan your cart for a Steam sale: set a budget and the best savings fill it first. Untick anything you do not want. After a sale, see what your alerts caught."), out, h("h2", { text: "After the sale" }), recapBtn, recapOut);
    load();
  }

  // My page: every feature as a card with its status, a switch where one is simple, and a link to set it up. Cards can be pinned, hidden and reordered (kept on this device).
  // First-run guide: a centred dialog with a detailed tour of the dashboard, then a short setup. The tour can be skipped (after a
  // confirmation); setup always follows. Shown once per account, and "Take the tour" on My page replays it.
  const WIZ_KEY = "svc.wizard";
  const TOUR_SLIDES = [
    { nav: "Welcome", title: "Welcome to Steam Value Checker", lead: "This dashboard and the Discord bot are one account. Change something here and the bot follows, change it in Discord and it shows up here. The next few screens explain each part. Then we set up your alerts, which takes about two minutes.",
      points: [["Price alerts that fit you", "Add the games you want and get told when one is cheap enough, by your own rules."], ["Everything you own, valued", "See what your library is worth, what you paid and what you have not played yet."], ["Free games and deals", "A live list of what is free right now and which discounts suit your taste."], ["Built for servers", "Share with friends, vote on what to play and run giveaways and playtest channels."]] },
    { nav: "Finding your way", title: "Finding your way around", lead: "The menu at the top groups pages by what you are doing. Pick a group and its pages appear as tabs underneath.",
      points: [["Library, Deals, Free & codes", "Your games, price tools, and everything free or code-based."], ["Friends and Servers", "Birthdays and gifts on one side, the servers you share with the bot on the other."], ["Press / to search", "On any page with a search box, / jumps straight to it. The search button in the menu finds pages and settings."], ["My page", "Every feature as a card with its status. Switch the simple ones on there, pin the ones you use."], ["Install it", "Your browser can add this site to your home screen or desktop as an app. Look for Install in the address bar or share menu."]] },
    { nav: "Wishlist", title: "Wishlist and sale alerts", lead: "Your wishlist is the heart of the bot. Every game on it is watched, and you choose what counts as a good price.",
      points: [["Import or add", "Import your public Steam wishlist in one click, or add any game by title."], ["A rule for each game", "Alert on any sale, a percent off, a price you set, or only at an all-time low."], ["Priority and quiet", "Star the ones you care about. Snooze a game for a week or a month, or mute it until you want it back."], ["Saved views", "Name a sort and filter combination, like Sale, hide owned, and bring it back later."], ["Buy or wait", "The check card compares today with the game's history, shows its Steam review score and charts the last year."]] },
    { nav: "Alerts", title: "How alerts reach you", lead: "Alerts arrive by direct message or in a server channel. Everything is also kept on the Notifications page, so a missed message is never lost.",
      points: [["Delivery and quiet hours", "Pick DM or a channel, set the hours you never want to be pinged and your time zone. Held alerts arrive afterwards."], ["Minimum discount", "Ignore small sales by setting a floor, like 30 percent."], ["Many kinds of alert", "Sales, bundles, free games, news and patch notes, DLC sales, release dates, refund reminders, milestones, playtests and more. Each has its own switch."], ["Try before you trust", "Alert settings can send you a sample of any kind, marked as a sample, so you see exactly what it looks like."], ["Notifications page", "Filter by kind, search, and mute a kind from there."]] },
    { nav: "Library", title: "Library, Steam and your backlog", lead: "Tell the bot what you own and it can show you what it is worth and what to play next.",
      points: [["Add what you own", "Link Steam to sync it, import a list, or add games with what you paid."], ["Value and spending", "Total value against what you paid, savings, and spending by month."], ["Backlog and challenge", "Mark games Backlog, Playing, Played, Finished or Dropped. Set a monthly goal and keep a streak."], ["Hours and achievements", "With Steam linked you get hours played, a yearly recap card, playtime milestones and near-complete achievement alerts."], ["The browser extension", "FanaticalGrabber reveals Fanatical keys and fills in what you paid from Steam purchase history. That also powers refund-and-rebuy alerts."]] },
    { nav: "Deals", title: "Deals, free games and codes", lead: "When you are not waiting on a specific game, these pages find something worth buying or claiming.",
      points: [["For you", "Current discounts ranked by your taste, library and wishlist."], ["Check a deal", "Price any game by region and see which bundles include it."], ["Sale planner", "During a Steam sale, set a budget and let the best savings fill your cart. Afterwards see what your alerts caught."], ["Free games", "Everything free right now on Steam, Epic, GOG and more, with store filters and a DLC tab."], ["Codes, promos and the calendar", "Working codes for popular games, key giveaways, release dates and sale dates in one place."]] },
    { nav: "Early access", title: "Playtests, demos and news", lead: "Hear about a game before it launches, or when something changes in one you already play.",
      points: [["Playtest watcher", "Betas, demos, free weekends and sign-ups from Steam announcements, Alpha Beta Gamer, GamerPower and itch.io. Choose wishlist games only, or every one found."], ["News and patch notes", "Announcements for the Steam games you own or wishlist. Patch notes only, or everything."], ["DLC sales", "A heads-up when add-ons for games you really play are heavily discounted."], ["Release dates", "Told when a wishlist game gets a date, or when it moves."]] },
    { nav: "Friends", title: "Friends, gifts and sharing", lead: "Games are better shared. None of this is on unless you turn it on.",
      points: [["Friends and gifts", "Save birthdays and public wishlist links, then see what is on sale for them before the day."], ["Your public page", "Share a wishlist page with a link. Friends can quietly claim a gift so nobody buys it twice, and the page uses your profile card colour."], ["Profile card", "A picture of your library with the stats and colours you choose, ready to post."], ["Compare libraries", "See what you and a friend both own, with hours side by side."]] },
    { nav: "Servers", title: "Servers and Discord", lead: "Add the bot to a server and it becomes a community toolkit. The dashboard is where managers run it.",
      points: [["Community setup", "One click builds channels, roles, a welcome flow, an XP system, support tickets, music and a playtests channel."], ["Share with your server", "Opt in with Share and members can compare libraries, see who owns a game, find co-op picks and plan game night with a vote."], ["Right-click shortcuts", "Right-click a member in Discord for Compare libraries, Play together, See their wishlist and Gift ideas. Right-click a game title to price it, add it or see who owns it."], ["Commands", "Everything here also has a slash command: /games, /me, /server and /alerts. /help lists them all."]] }
  ];

  function startTour(opts) {
    const o = opts || {};
    document.getElementById("wiz")?.remove();
    const opener = document.activeElement;
    const me = state.me, S = () => state.me.settings;
    const steps = [];
    TOUR_SLIDES.forEach((t, i) => steps.push({ phase: "tour", nav: t.nav, render: () => tourBody(t, i) }));
    const setupFns = [setupRegion, setupDelivery, setupSteam, setupAlerts, setupServer, setupDone];
    setupFns.forEach(fn => steps.push(fn()));
    const firstSetup = steps.findIndex(x => x.phase === "setup");
    let n = 0, confirming = false;
    try { const saved = JSON.parse(localStorage.getItem(WIZ_KEY) || "null"); if (saved && !o.replay && Number.isInteger(saved.n) && saved.n >= firstSetup && saved.n < steps.length) n = saved.n; } catch { /* a fresh start is fine */ }
    const remember = () => { try { localStorage.setItem(WIZ_KEY, JSON.stringify({ n })); } catch { /* optional */ } };

    const root = h("div", { id: "wiz", class: "wiz", role: "presentation" });
    const dlg = h("div", { class: "wiz-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "wiz-title", tabindex: "-1" });
    root.append(dlg);
    document.body.append(root); document.body.classList.add("wiz-open");

    const finish = async () => {
      document.removeEventListener("keydown", onKey, true); root.remove(); document.body.classList.remove("wiz-open");
      try { localStorage.removeItem(WIZ_KEY); } catch { /* ignore */ }
      if (state.me) { state.me.tour = false; api("/api/tour/done", {}).catch(() => {}); }
      try { state.me = Object.assign({}, state.me, await api("/api/me")); } catch { /* the cached copy is fine */ }
      if (opener && opener.focus) opener.focus();
      if (currentView() === "mypage") route();
    };

    function tourBody(t, i) {
      return h("div", { class: "wiz-slide" },
        h("div", { class: "wiz-kicker", text: "Part " + (i + 1) + " of " + TOUR_SLIDES.length }),
        h("h2", { id: "wiz-title", text: t.title }), h("p", { class: "wiz-lead", text: t.lead }),
        h("ul", { class: "wiz-points" }, t.points.map(([head, text]) => h("li", {}, h("strong", { text: head }), h("span", { text })))));
    }
    // ----- setup steps: each returns { phase, nav, render(), save?() } -----
    function setupFrame(kicker, title, lead, ...body) {
      return h("div", { class: "wiz-slide" }, h("div", { class: "wiz-kicker", text: kicker }), h("h2", { id: "wiz-title", text: title }), h("p", { class: "wiz-lead", text: lead }), ...body);
    }
    function setupRegion() {
      const region = select(state.cfg.regions.map(r => [r.value, r.name]), S().region);
      const stores = select([["major", "Major stores only (recommended)"], ["all", "All tracked stores, including key sites"]], S().stores);
      return { phase: "setup", nav: "Region", render: () => setupFrame("Setup 1 of 6", "Where do you shop?", "Prices are looked up for your region, so the currency and the stores match what you can actually buy.",
        h("div", { class: "wiz-form" }, field("Region and currency", region), field("Which stores count", stores))),
        save: async () => { const r = await api("/api/settings", { region: region.value, stores: stores.value }); state.me.settings = r.settings; } };
    }
    function setupDelivery() {
      const myTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; } })();
      const withChannel = state.me.servers.filter(g => g.alertChannel);
      const dm = h("input", { type: "radio", name: "wiz-delivery", value: "dm", checked: S().delivery !== "channel" });
      const ch = h("input", { type: "radio", name: "wiz-delivery", value: "channel", checked: S().delivery === "channel", disabled: !withChannel.length });
      const server = select(withChannel.map(g => [g.id, g.name]), S().guild_id || (withChannel[0] && withChannel[0].id) || "");
      const qs = h("input", { type: "time", value: S().quiet_start || "" }), qe = h("input", { type: "time", value: S().quiet_end || "" });
      const tz = h("input", { type: "text", value: S().tz && S().tz !== "UTC" ? S().tz : myTz, maxlength: "60", "aria-label": "Time zone" });
      return { phase: "setup", nav: "Delivery", render: () => setupFrame("Setup 2 of 6", "Where should alerts go?", "Direct messages are the simplest. If you would rather keep them out of your DMs, a server alert channel works too.",
        h("div", { class: "wiz-form" },
          h("label", { class: "check" }, dm, " Send them to me as direct messages"),
          h("label", { class: "check" }, ch, " Post them in a server alert channel", withChannel.length ? "" : " (no server you are in has one yet)"),
          withChannel.length ? field("Which server", server) : null,
          h("div", { class: "row" }, field("Quiet hours start", qs), field("Quiet hours end", qe)),
          field("Your time zone", tz),
          h("p", { class: "muted small", text: "Leave quiet hours empty to be told any time. Alerts held during quiet hours arrive when they end." }))),
        save: async () => {
          const body = { delivery: ch.checked ? "channel" : "dm", tz: tz.value.trim() || "UTC", quiet_start: qs.value || null, quiet_end: qe.value || null };
          if (ch.checked) body.guild_id = server.value;
          const r = await api("/api/settings", body); state.me.settings = r.settings;
        } };
    }
    function setupSteam() {
      const linked = () => Boolean(state.me.steam && state.me.steam.linked);
      const out = h("div", { class: "wiz-form" });
      const draw = () => {
        const importBtn = h("button", { class: "btn green", type: "button", text: "Import my Steam wishlist" });
        importBtn.addEventListener("click", () => busy(importBtn, async () => {
          const r = await api("/api/wishlist/import", { profile: "" });
          state.me.games += r.added; toast(`Imported ${r.added} new game${r.added === 1 ? "" : "s"}.`, "ok"); draw();
        }));
        out.replaceChildren(
          h("div", { class: "wiz-status" + (linked() ? " ok" : ""), text: linked() ? "Steam is linked to your account." : "Steam is not linked yet." }),
          linked() ? h("div", { class: "row" }, importBtn, h("span", { class: "muted small", text: state.me.games ? state.me.games + " game" + (state.me.games === 1 ? "" : "s") + " on your wishlist" : "Your Steam wishlist must be public for this to work." })) : h("div", { class: "row" }, (() => { const a = steamLoginBtn("Link Steam", "btn steam"); a.addEventListener("click", remember); return a; })(), h("span", { class: "muted small", text: "You come straight back here afterwards." })),
          h("p", { class: "muted small", text: "Linking is optional. It unlocks the wishlist import, hours played, your library and recap. You can do it later from the Steam page." }));
      };
      return { phase: "setup", nav: "Steam", render: () => { draw(); return setupFrame("Setup 3 of 6", "Bring in your games", "Linking your public Steam profile fills your wishlist and library for you, so alerts can start right away.", out); },
        save: async () => {} };
    }
    function setupAlerts() {
      const sw = (key, label, hint) => { const c = h("input", { type: "checkbox", checked: Boolean(S()[key]) }); return { key, c, node: h("label", { class: "check wiz-sw" }, c, h("span", {}, h("b", { text: label }), hint ? h("em", { text: hint }) : null)) }; };
      const core = [sw("free", "Free games", "Told when a game is free to claim."), sw("bundles", "Bundles and giveaways", "When a wishlist game is in one."), sw("digest", "Weekly digest", "One summary of your wishlist sales.")];
      const extra = [sw("dlc", "DLC sales", "Big discounts on add-ons for games you play."), sw("refund", "Refund reminders", "Before the 14 day window closes."), sw("milestones", "Playtime milestones", "At 100, 250, 500, 1000 and 2000 hours."), sw("achv", "Almost-done achievements", "When you are a few short of 100 percent."), sw("nudge", "Monthly backlog pick", "One unplayed game to try."), sw("yearly", "Year in games", "Your recap card, sent in late December.")];
      const news = select([["0", "Off"], ["1", "Patch notes only"], ["2", "Every announcement"]], String(S().news ?? 0));
      const play = select([["0", "Off"], ["1", "Only games on my wishlist"], ["2", "Every playtest and demo found"]], String(S().playtest ?? 0));
      const minDisc = h("input", { type: "number", min: "0", max: "90", step: "5", value: String(S().min_discount || 0), class: "short-num", "aria-label": "Minimum discount percent" });
      return { phase: "setup", nav: "Alerts", render: () => setupFrame("Setup 4 of 6", "Choose your alerts", "Sale alerts for your wishlist are always on. Pick the extras you want. Everything here can be changed later on the Alerts page.",
        h("div", { class: "wiz-form" },
          h("div", { class: "wiz-group" }, h("h4", { text: "Good to have" }), ...core.map(x => x.node)),
          h("div", { class: "wiz-group" }, h("h4", { text: "Extras" }), ...extra.map(x => x.node)),
          h("div", { class: "row" }, field("News and patch notes", news), field("Playtests and demos", play), field("Ignore sales under (% off)", minDisc)))),
        save: async () => {
          const body = { news: Number(news.value), playtest: Number(play.value), min_discount: Number(minDisc.value || 0) };
          for (const x of [...core, ...extra]) body[x.key] = x.c.checked;
          const r = await api("/api/settings", body); state.me.settings = r.settings;
        } };
    }
    function setupServer() {
      const share = h("input", { type: "checkbox", checked: Boolean(S().share) });
      const inv = state.cfg && state.cfg.inviteUrl;
      const withBot = state.me.servers.filter(g => g.bot);
      return { phase: "setup", nav: "Server", render: () => setupFrame("Setup 5 of 6", "Bring it to your server", "The bot works for you alone, but it is better with friends. This step is optional.",
        h("div", { class: "wiz-form" },
          h("div", { class: "wiz-status" + (withBot.length ? " ok" : ""), text: withBot.length ? "The bot is set up in " + withBot.length + " of your servers." : "The bot is not set up in any of your servers yet." }),
          inv ? h("div", { class: "row" }, ext(inv, "Add the bot to a server", "btn blue"), h("span", { class: "muted small", text: "Then open Servers and run community setup." })) : null,
          h("label", { class: "check wiz-sw" }, share, h("span", {}, h("b", { text: "Share my library with my server" }), h("em", { text: "Lets members compare libraries, see who owns a game and find co-op picks. Only titles and hours, and you can turn it off any time." })))) ),
        save: async () => { const r = await api("/api/settings", { share: share.checked }); state.me.settings = r.settings; } };
    }
    function setupDone() {
      const sample = h("button", { class: "btn gray", type: "button", text: "Send me a sample alert" });
      sample.addEventListener("click", () => busy(sample, async () => { await api("/api/alerts/test", { kind: "sale" }); toast("Check your Discord DMs.", "ok"); }));
      return { phase: "setup", nav: "Done", last: true, render: () => {
        const rows = (state.me.setup || []).map(t => h("li", { class: t.done ? "done" : "" }, h("span", { class: "wiz-tick", text: t.done ? "Done" : t.optional ? "Optional" : "To do" }), t.text));
        return setupFrame("Setup 6 of 6", "You are all set", "Here is where things stand. The checklist stays on your home page until it is finished, and you can replay this guide from My page.",
          h("ul", { class: "wiz-check" }, rows), h("div", { class: "row" }, sample));
      } };
    }

    // ----- frame -----
    const cur = () => steps[n];
    const inTour = () => cur().phase === "tour";
    function frame() {
      const st = cur(), tourCount = firstSetup, setupCount = steps.length - firstSetup;
      const idx = inTour() ? n : n - firstSetup, total = inTour() ? tourCount : setupCount;
      const header = h("div", { class: "wiz-head" },
        h("div", { class: "wiz-brand", text: "Steam Value Checker" }),
        h("div", { class: "wiz-phases", role: "list" }, h("span", { role: "listitem", class: inTour() ? "on" : "done", text: "1  Tour" }), h("span", { role: "listitem", class: inTour() ? "" : "on", text: "2  Setup" })),
        inTour() ? h("button", { class: "btn gray small wiz-skip", type: "button", text: "Skip tutorial", onclick: () => { confirming = true; draw(); } }) : h("span", { class: "wiz-skip-gap" }));
      const rail = h("ol", { class: "wiz-rail", "aria-label": inTour() ? "Tour steps" : "Setup steps" },
        steps.filter(x => x.phase === st.phase).map((x, i) => h("li", { class: i === idx ? "on" : i < idx ? "past" : "" }, h("span", { class: "wiz-num", text: String(i + 1) }), x.nav)));
      const bar = h("div", { class: "wiz-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(total), "aria-valuenow": String(idx + 1), "aria-label": inTour() ? "Tour progress" : "Setup progress" }, (() => { const f = h("span"); f.style.width = Math.round(((idx + 1) / total) * 100) + "%"; return f; })());
      const back = h("button", { class: "btn gray", type: "button", text: "Back", disabled: n === 0, onclick: () => go(-1) });
      const nextLabel = st.last ? "Finish" : n === firstSetup - 1 ? "Continue to setup" : "Next";
      const next = h("button", { class: "btn blue wiz-next", type: "button", text: nextLabel, onclick: () => go(1) });
      const body = h("div", { class: "wiz-body", tabindex: "-1" }, st.render());
      return h("div", { class: "wiz-shell" }, header, bar, h("div", { class: "wiz-main" }, rail, body), h("div", { class: "wiz-foot" }, h("span", { class: "muted small wiz-count", text: (inTour() ? "Tour" : "Setup") + " " + (idx + 1) + " of " + total }), h("div", { class: "row" }, back, next)));
    }
    function confirmBox() {
      const keep = h("button", { class: "btn blue", type: "button", text: "Keep going", onclick: () => { confirming = false; draw(); } });
      const yes = h("button", { class: "btn gray", type: "button", text: "Yes, skip the tutorial", onclick: () => { confirming = false; n = firstSetup; remember(); draw(); } });
      return h("div", { class: "wiz-confirm", role: "alertdialog", "aria-labelledby": "wiz-title", "aria-describedby": "wiz-confirm-text" },
        h("h2", { id: "wiz-title", text: "Are you sure you want to skip the tutorial?" }),
        h("p", { id: "wiz-confirm-text", text: "It only takes a couple of minutes and covers things that are easy to miss, like per-game rules, quiet hours and the server tools. You can replay it any time from My page. Either way, you will still go through setup next." }),
        h("div", { class: "row" }, keep, yes));
    }
    async function go(d) {
      if (d > 0 && cur().save) {
        const btn = dlg.querySelector(".wiz-next");
        try { if (btn) { btn.disabled = true; } await cur().save(); } catch (e) { toast(e.message || "That did not save.", "error"); if (btn) btn.disabled = false; return; }
      }
      if (d > 0 && cur().last) return finish();
      n = Math.max(0, Math.min(steps.length - 1, n + d)); if (!inTour()) remember(); draw();
    }
    function draw() {
      dlg.replaceChildren(confirming ? confirmBox() : frame());
      dlg.setAttribute("aria-label", "");
      const target = confirming ? dlg.querySelector(".wiz-confirm .btn.blue") : dlg.querySelector(".wiz-next");
      if (target) target.focus();
      const body = dlg.querySelector(".wiz-body"); if (body) body.scrollTop = 0;
    }
    function onKey(e) {
      if (!document.getElementById("wiz")) return;
      if (e.key === "Escape") { e.preventDefault(); if (confirming) { confirming = false; draw(); } else if (inTour()) { confirming = true; draw(); } return; }
      if (e.key === "Tab") { // keep focus inside the dialog
        const f = [...dlg.querySelectorAll("button, a[href], input, select, textarea, [tabindex='0']")].filter(x => !x.disabled && x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!dlg.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        return;
      }
      const typing = /^(input|select|textarea)$/i.test((e.target && e.target.tagName) || "");
      if (!confirming && inTour() && !typing) { if (e.key === "ArrowRight" && n < steps.length - 1) { e.preventDefault(); go(1); } else if (e.key === "ArrowLeft" && n > 0) { e.preventDefault(); go(-1); } }
    }
    document.addEventListener("keydown", onKey, true);
    draw();
  }

  async function myPageView() {
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
        return h("div", { class: "panel" }, h("strong", { text: f.name }), h("span", { class: "muted", text: f.birthday ? "  " + f.birthday + (f.daysToBirthday <= 30 ? " (in " + f.daysToBirthday + " days)" : "") : "" }), h("div", { class: "mp-actions fr-actions" }, show, del));
      }));
    }
    const add = h("button", { class: "btn blue", text: "Save friend" });
    add.addEventListener("click", () => busy(add, async () => { await api("/api/friends/add", { name: name.value, birthday: bday.value, page: page.value }); toast("Saved.", "ok"); name.value = bday.value = page.value = ""; load(); }));
    app.replaceChildren(pageHead("Friends", "Birthdays and gift ideas. Only a nickname and the month and day are kept."),
      h("div", { class: "panel" }, h("div", { class: "row" }, field("Nickname", name), field("Birthday", bday), field("Public page", page)), h("div", { class: "mp-actions fr-actions" }, add)), list, deals);
    load().catch(e => list.replaceChildren(h("div", { class: "empty", text: e.message })));
  }

  async function calendarView() {
    const KIND = { release: ["", "Releases"], sale: ["", "Steam sales"], event: ["", "Server events"], lfg: ["", "Group games"] };
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
          
          h("div", {}, h("div", { class: "cal-title" }, e.url ? h("a", { href: e.url, target: "_blank", rel: "noopener noreferrer", text: e.title + " ↗" }) : e.title), h("div", { class: "muted small", text: [timeText(e), e.server, e.notes].filter(Boolean).join(" · ") })),
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
          ...items.slice(0, 3).map(e => h("div", { class: "cal-chip " + e.kind, title: e.title + " · " + timeText(e), text: e.title })),
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
      const chips = Object.entries(KIND).map(([k, [ico, label]]) => { const b = h("button", { type: "button", class: "tab small" + (st.kinds.has(k) ? " active" : ""), text: label, "aria-pressed": String(st.kinds.has(k)) });
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
        h("p", { class: "muted small", text: "Members see it here and with /server calendar view. If you pick a channel it is announced there now and members get a reminder before it starts." }),
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
        } else form.replaceChildren(h("p", { class: "muted small", text: "Server managers can post from here. Everyone can post with /server lfg post in Discord, and join from here or from the post." }));
        out.className = "";
        if (!d.posts.length) { out.replaceChildren(h("div", { class: "empty", text: "No open posts. Start one with /server lfg post." + (g ? "" : "") })); return; }
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

  // ---------- guided server setup (same checklist as /manage setup in Discord) ----------
  /** One row per thing the bot posts, grouped, each with its own channel. Empty rows say what happens instead. */
  function channelPanel(list, channels, alertId, guildId, reload) {
    const nameOf = id => { const c = channels.find(x => x.id === id); return c ? "#" + c.name : "a channel I can't see"; };
    const groups = [...new Set(list.map(x => x.group))];
    return h("div", { class: "panel" }, h("h3", { text: "Every channel the bot posts in" }),
      h("p", { class: "muted small", text: "Give each kind of post its own channel. Anything left empty either does nothing or uses the channel noted under it." }),
      ...groups.map(g => h("div", { class: "chmap-group" }, h("div", { class: "chmap-head", text: g }),
        ...list.filter(x => x.group === g).map(x => {
          const sel = select([["", "Not set"], ...channels.map(c => [c.id, "#" + c.name])], x.value || "");
          const b = h("button", { class: "btn blue small", type: "button", text: "Save" });
          b.addEventListener("click", () => busy(b, async () => { await api("/api/servers/channelmap", { guild_id: guildId, key: x.key, channel_id: sel.value || null }); toast("Saved.", "ok"); reload(); }));
          const now = x.value ? "Posting in " + nameOf(x.value) + "." : x.fallback ? "Not set, so it uses " + x.fallback + (x.fallback === "the alert channel" ? (alertId ? " (" + nameOf(alertId) + ")" : ", which isn't set either") : "") + "." : "Not set, so it stays off.";
          return h("div", { class: "setup-row" }, h("div", {}, h("b", { text: (x.value ? "✅ " : "⬜ ") + x.label }), h("div", { class: "muted small", text: x.help }), h("div", { class: "muted small", text: now })), h("div", { class: "row" }, sel, b));
        }))));
  }

  async function setupView() {
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

  // ---------- community: welcome, levels, invites, emoji, and the one-click server build ----------
  async function communityView() {
    const servers = state.me.servers.filter(g => g.bot !== false);
    const holder = h("div");
    app.replaceChildren(pageHead("Community", "Welcome messages, levels, invites and emoji for your gaming server. In Discord: /manage community, /server rank, /server levels, /server invites and /manage emoji."), holder);
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
        holder.replaceChildren(...[picker, intent, standing, verifyPanel, boards, rewards, d.manager && d.growth ? growthPanel(d.growth) : null, d.manager ? manager(d) : null].filter(Boolean));
      } catch (e) { holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    // Joins and leaves for the last 30 days, people only. Only members the bot saw join are counted, so it fills in from when the bot arrived.
    function growthPanel(g) {
      const peak = Math.max(1, ...g.days.map(d => Math.max(d.joins, d.leaves)));
      const tile = (k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: v }), sub && h("div", { class: "s", text: sub }));
      const bars = h("div", { class: "grow-bars", role: "img", "aria-label": "People joining and leaving per day, last 30 days" }, g.days.map((d, n) => {
        const j = h("i", { class: "j" }), l = h("i", { class: "l" });
        j.style.height = Math.round(d.joins / peak * 100) + "%"; l.style.height = Math.round(d.leaves / peak * 100) + "%";
        return h("div", { class: "grow-col", title: `${new Date(d.day + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}: ${d.joins} joined, ${d.leaves} left` }, h("div", { class: "pair" }, j, l), n % 7 === 0 ? h("span", { text: d.day.slice(5) }) : h("span", { text: "" }));
      }));
      return h("div", { class: "panel" }, h("h3", { text: "Member growth, last 30 days" }),
        h("div", { class: "grid four" }, tile("Joined", String(g.joins)), tile("Left", String(g.leaves)), tile("Net", (g.net > 0 ? "+" : "") + g.net, g.net >= 0 ? "growing" : "shrinking"), tile("Tracked here now", String(g.trackedHere), `of ${g.trackedEver} the bot has seen join`)),
        g.trackedEver ? bars : h("p", { class: "muted", text: "Nothing yet. The bot records people as they join, so this fills in from now on." }),
        h("p", { class: "muted small", text: "People only: bots are never counted. Green is joining, grey is leaving." }));
    }
    let mgrTab = 0;
    /** The announcement designer: every part of the embed is editable, with a live preview that looks like Discord. */
    function announceDesigner({ chSel, roSel, defaultCh, history, roleName, chName }) {
      const inp = (ph, max = 256, type = "text") => h("input", { type, maxlength: String(max), placeholder: ph, "aria-label": ph });
      const ch = chSel(defaultCh), title = inp("Title", 256), body = h("textarea", { rows: "6", maxlength: "4000", placeholder: "Message (Discord formatting works: **bold**, *italic*, > quote)", "aria-label": "Message" });
      const color = h("input", { type: "color", value: "#4d8cff", "aria-label": "Colour" });
      const author = inp("Small text above the title (optional)", 100), footer = inp("Footer text (optional)", 200), image = inp("Big image link, https (optional)", 500, "url");
      const thumbKind = select([["", "No small image"], ["server", "This server's icon"], ["url", "A link"]], ""), thumb = inp("Small image link, https", 500, "url");
      const linkUrl = inp("Make the title a link (optional)", 500, "url"), bLabel = inp("Button text (optional)", 40), bUrl = inp("Button link, https", 500, "url");
      const stamp = h("input", { type: "checkbox" }), ping = select([["none", "Nobody"], ["everyone", "@everyone"], ["here", "@here"], ["role", "A role"]], "none"), pingRole = roSel("", "Choose a role");
      pingRole.hidden = true;
      const fieldRows = [], fieldBox = h("div"), addField = h("button", { class: "btn gray small", type: "button", text: "Add a field" });
      const addRow = () => {
        if (fieldRows.length >= 5) return;
        const n = inp("Field title", 100), v = inp("Field text", 500), inl = h("input", { type: "checkbox" });
        const row = { n, v, inl }; fieldRows.push(row);
        const rm = h("button", { class: "btn gray small", type: "button", text: "Remove" });
        const el = h("div", { class: "row" }, n, v, h("label", { class: "muted small" }, inl, " side by side"), rm);
        rm.addEventListener("click", () => { fieldRows.splice(fieldRows.indexOf(row), 1); el.remove(); paint(); });
        fieldBox.append(el); [n, v, inl].forEach(x => x.addEventListener("input", paint)); paint();
      };
      addField.addEventListener("click", addRow);
      const pv = h("div", { class: "dpreview" });
      function paint() {
        const parts = [];
        if (author.value.trim()) parts.push(h("div", { class: "dp-author", text: author.value.trim() }));
        if (title.value.trim()) parts.push(h("div", { class: "dp-title", text: title.value.trim() }));
        if (body.value.trim()) parts.push(h("div", { class: "dp-body", text: body.value.trim() }));
        const fl = fieldRows.filter(r => r.n.value.trim() && r.v.value.trim());
        if (fl.length) parts.push(h("div", { class: "dp-fields" }, fl.map(r => h("div", { class: "dp-field" + (r.inl.checked ? " inline" : "") }, h("b", { text: r.n.value.trim() }), h("div", { text: r.v.value.trim() })))));
        if (/^https:\/\//.test(image.value.trim())) parts.push(h("img", { class: "dp-image", src: image.value.trim(), alt: "", referrerpolicy: "no-referrer" }));
        if (bLabel.value.trim()) parts.push(h("div", { class: "dp-btn", text: bLabel.value.trim() + " ↗" }));
        if (footer.value.trim() || stamp.checked) parts.push(h("div", { class: "dp-foot muted small", text: [footer.value.trim(), stamp.checked ? "Today" : ""].filter(Boolean).join(" · ") }));
        const pre = ping.value === "everyone" ? "@everyone" : ping.value === "here" ? "@here" : ping.value === "role" && pingRole.value ? "@" + roleName(pingRole.value) : "";
        pv.replaceChildren(...(pre ? [h("div", { class: "dp-ping", text: pre })] : []), h("div", { class: "dp-card" }, ...(parts.length ? parts : [h("div", { class: "muted", text: "Your announcement shows here." })])));
        pv.firstElementChild && pv.lastElementChild.style.setProperty("border-left-color", color.value);
      }
      ping.addEventListener("change", () => { pingRole.hidden = ping.value !== "role"; sendBtn.textContent = "Post announcement"; armed = false; paint(); });
      [title, body, color, author, footer, image, thumb, linkUrl, bLabel, bUrl, stamp, pingRole].forEach(x => x.addEventListener("input", paint));
      thumbKind.addEventListener("change", () => { thumb.hidden = thumbKind.value !== "url"; }); thumb.hidden = true;
      const sendBtn = h("button", { class: "btn green", type: "button", text: "Post announcement" });
      let armed = false;
      const hist = h("div");
      const paintHist = rows => hist.replaceChildren(rows.length ? h("ul", { class: "plain" }, rows.map(r => h("li", {}, h("b", { text: r.title || "Announcement" }), h("span", { class: "muted small", text: ` · ${new Date(r.at).toLocaleString()} · #${chName(r.channel_id) || "channel"}` })))) : h("p", { class: "muted small", text: "Nothing posted yet." }));
      paintHist(history || []);
      sendBtn.addEventListener("click", () => busy(sendBtn, async () => {
        if ((ping.value === "everyone" || ping.value === "here") && !armed) { armed = true; sendBtn.textContent = "Click again to ping " + (ping.value === "here" ? "@here" : "@everyone"); return; }
        armed = false; sendBtn.textContent = "Post announcement";
        const r = await api("/api/community/announce", { guild_id: GID(), channel_id: ch.value, title: title.value, body: body.value, color: color.value, author: author.value, footer: footer.value, image: image.value, thumbnail: thumbKind.value === "server" ? "server" : thumbKind.value === "url" ? thumb.value : "",
          link_url: linkUrl.value, button_label: bLabel.value, button_url: bUrl.value, timestamp: stamp.checked, ping: ping.value, role_id: pingRole.value, fields: fieldRows.map(x => ({ name: x.n.value, value: x.v.value, inline: x.inl.checked })) });
        paintHist(r.history); toast("Announcement posted.", "ok");
      }));
      paint();
      return h("div", { class: "panel" }, h("h3", { text: "Announcements" }),
        h("p", { class: "muted", text: "Design a message and post it as an embed. Needs the bot to have Send Messages and Embed Links in the channel (and Mention Everyone to ping @everyone)." }),
        h("div", { class: "grid two" }, h("div", {}, field("Post in", ch), field("Title", title), field("Message", body), h("div", { class: "row" }, field("Colour", color), field("Ping", ping), pingRole),
          field("Small text above the title", author), field("Footer", footer), h("label", { class: "muted small" }, stamp, " Show the time"), field("Big image", image), field("Small image", thumbKind), thumb, field("Title link", linkUrl),
          h("div", { class: "row" }, field("Button text", bLabel), field("Button link", bUrl)), h("h4", { text: "Fields" }), fieldBox, addField),
          h("div", {}, h("h4", { text: "Preview" }), pv, h("div", { class: "row" }, sendBtn), h("h4", { text: "Recently posted" }), hist)));
    }
    function manager(d) {
      const st = d.settings;
      const box = h("div");
      (async () => {
        const [ch, ro, fo] = await Promise.all([api("/api/servers/channels?guild=" + encodeURIComponent(GID())).catch(() => ({ channels: [] })), api("/api/servers/roles?guild=" + encodeURIComponent(GID())).catch(() => ({ roles: [] })), api("/api/servers/forums?guild=" + encodeURIComponent(GID())).catch(() => ({ forums: [] }))]);
        const forumSel = cur => select([["", "Not set"], ...fo.forums.map(c => [c.id, "#" + c.name])], cur || "");
        const chSel = cur => select([["", "Not set"], ...ch.channels.map(c => [c.id, "#" + c.name])], cur || "");
        const roSel = (cur, none = "No role") => select([["", none], ...ro.roles.map(r => [r.id, r.name])], cur || "");
        const roleName = id => (ro.roles.find(r => r.id === id) || {}).name || "a role";
        const save = (label, fn, cls = "btn blue small") => { const b = h("button", { class: cls, text: label }); b.addEventListener("click", () => busy(b, async () => { await fn(); toast("Saved.", "ok"); load(); })); return b; };
        const toggle = (on, path, key, labelOn, labelOff) => { const b = h("button", { class: "btn small " + (on ? "red" : "green"), text: on ? labelOn : labelOff }); b.addEventListener("click", () => busy(b, async () => { await post(path, { [key]: !on }); load(); })); return b; };
        // build
        const build = h("div", { class: "panel" }, h("h3", { text: "Build my server" }),
          h("p", { class: "muted", text: "Creates the usual gaming-server layout: Information (welcome, rules, announcements, roles), Community (general, introductions, memes, clips, off-topic, bot-commands), Gaming (looking-for-group, game-chat, game-night, wishlists), Deals and Giveaways, Support (get-help tickets and report-a-bug), Music (a #music-commands channel with an intro of every music command, plus two Music voice channels), Voice lobbies and a private Staff area. Also creates Moderator, Member and level roles and a role picker, posts the rules (with the bot logo), the support buttons and the welcome, and connects deal alerts, giveaways, music, support tickets, welcome and XP. Safe to run again: a server that is already built only gets the channels that are new, and nothing you renamed, moved, deleted or changed is touched. A brand-new server is built automatically when the bot joins." }),
          (() => { const b = h("button", { class: "btn green", text: d.built ? "Run setup again (adds only what's new)" : "Set up this server" }); b.addEventListener("click", () => busy(b, async () => { const r = await post("/api/community/setup", {}); toast(r.updated ? `Updated: ${r.created.channels.length} new channel${r.created.channels.length === 1 ? "" : "s"} added, nothing else changed.` : `Done: ${r.created.channels.length} channels, ${r.created.roles.length} roles created.`, "ok"); load(); })); return b; })());
        // welcome
        const wCh = chSel(st.welcome_channel), logCh = chSel(st.log_channel), wMsg = h("textarea", { rows: "3", maxlength: "1000", placeholder: st.defaultWelcome }); wMsg.value = st.welcome_msg || "";
        const auto = roSel(st.autorole_id, "No automatic role");
        const welcome = h("div", { class: "panel" }, h("h3", { text: "Welcome new members" }),
          h("div", { class: "row" }, toggle(st.welcome_on, "/api/community/welcome", "enabled", "Turn off", "Turn on"), toggle(st.welcome_dm, "/api/community/welcome", "dm", "Stop private welcome", "Also send a private welcome"), toggle(st.welcome_card !== 0, "/api/community/welcome", "card", "Stop the picture card", "Show a picture card"), toggle(st.leave_on, "/api/community/welcome", "leave", "Stop leave notes", "Post a note when someone leaves")),
          field("Welcome channel", wCh), field("Log channel (joins, who invited them)", logCh), field("Message", wMsg),
          h("p", { class: "muted small", text: "Use " + st.fields.join(" ") + ". Leave empty for the default message." }),
          (() => {
            const shot = h("img", { class: "welcome-prev", alt: "Preview of the welcome picture card", hidden: true });
            const b = h("button", { type: "button", class: "btn gray", text: "Preview the picture card" });
            b.addEventListener("click", () => busy(b, async () => { const r = await post("/api/community/welcome/preview", {}); shot.src = r.image; shot.hidden = false; }));
            return h("div", {}, h("div", { class: "row" }, save("Save welcome", () => post("/api/community/welcome", { channel_id: wCh.value, log_channel_id: logCh.value, message: wMsg.value })), b), shot);
          })(),
          field("Role every new member gets", auto), h("div", { class: "row" }, save("Save role", () => post("/api/community/autorole", { role_id: auto.value }))));
        const vRole = roSel(st.verified_role_id, "No Steam Verified role");
        const verify = h("div", { class: "panel" }, h("h3", { text: "Steam verification" }),
          h("p", { class: "muted", text: "Members prove their Steam account (they sign in on Steam's own page) and get this role from the button in #verify or /me steam verify. Members who already verified get it the moment they join." }),
          field("Steam Verified role", vRole), h("div", { class: "row" }, save("Save", () => post("/api/community/verifyrole", { role_id: vRole.value }))),
          h("p", { class: "muted small", text: "Want Discord itself to require it? In Discord open Server Settings, Roles, pick the role, open Links, and add this bot's Steam Verified condition. That one step can only be done in Discord." }));
        // ping roles
        const pDeals = roSel(st.ping_deals, "Nobody"), pFree = roSel(st.ping_free, "Nobody"), pGw = roSel(st.ping_giveaway, "Nobody"), pLfg = roSel(st.ping_lfg, "Nobody"), pPlay = roSel(st.ping_playtest, "Nobody"), pPlayAll = h("input", { type: "checkbox", checked: Boolean(st.playtest_all) }), pPlayCh = chSel(st.playtest_channel), pSquad = roSel(st.ping_squad, "Nobody"), pSquadCh = chSel(st.squad_channel), pIndie = roSel(st.ping_indie, "Nobody"), pIndieCh = chSel(st.indie_channel), pIndieDev = roSel(st.indie_dev_role, "Nobody");
        const pings = h("div", { class: "panel" }, h("h3", { text: "Ping roles" }),
          h("p", { class: "muted", text: "Members opt in to these roles in #roles. The bot pings them (and nobody else) when it posts." }),
          field("Free games feed", pFree), field("Deals (big discounts, sale starts, group alerts)", pDeals), field("New giveaways (used unless a giveaway picks its own)", pGw), field("Looking-for-group posts", pLfg), field("Playtest channel (every playtest, demo and beta is posted here, and the role below is pinged)", pPlayCh), field("Playtest ping role", pPlay), field("Now playing channel (squad-up posts when two or more members are in the same game)", pSquadCh), field("Squad ping role", pSquad), field("Indie spotlight channel (the weekly indie game is posted here every Wednesday)", pIndieCh), field("Indie ping role", pIndie), field("Verified IndieDev role (the bot gives it to developers when their game is approved in the showcase)", pIndieDev), h("label", { class: "check" }, pPlayAll, "No playtest channel? Post every playtest in the alert channel too, not just games your members watch"),
          h("div", { class: "row" }, h("button", { class: "btn gray", type: "button", text: "Post current playtests now", title: "Posts the newest listed playtests, demos and betas in the playtest channel, without pinging the role", onclick: ev => busy(ev.currentTarget, async () => { const r = await post("/api/community/playtests", { count: 8 }); toast(r.posted ? `Posted ${r.posted} of ${r.found} listed. New ones are posted on their own.` : "Nothing is listed right now.", "ok"); }) }), save("Save ping roles", () => post("/api/community/pings", { free: pFree.value, deals: pDeals.value, giveaway: pGw.value, lfg: pLfg.value, playtest: pPlay.value, squad: pSquad.value, squad_channel: pSquadCh.value, indie: pIndie.value, indie_dev: pIndieDev.value, indie_channel: pIndieCh.value, playtest_all: pPlayAll.checked, playtest_channel: pPlayCh.value }))));
        // referral
        const bonus = h("input", { type: "number", min: "0", max: "1000", value: String(st.referral_xp) }), rCount = h("input", { type: "number", min: "1", max: "1000", placeholder: "Invited members" }), rRole = roSel("", "Choose a role");
        const referral = h("div", { class: "panel" }, h("h3", { text: "Invites and referrals" }),
          h("p", { class: "muted", text: "Members get their own invite link (/server invites link or the button above). Every member who joins with it counts for them, earns the inviter bonus XP, and can unlock a role." }),
          field("Bonus XP for each new member they bring (0 for none)", bonus), h("div", { class: "row" }, save("Save bonus", () => post("/api/community/referral", { bonus: bonus.value }))),
          d.rewards.length ? h("ul", { class: "plain" }, d.rewards.map(r => h("li", {}, `${r.count} invited: `, h("b", { text: roleName(r.role_id) }), " ", save("Remove", () => post("/api/community/referral", { count: r.count, remove: true }), "btn gray small")))) : h("p", { class: "muted", text: "No role rewards yet." }),
          h("div", { class: "row" }, rCount, rRole, save("Add reward", () => post("/api/community/referral", { count: rCount.value, role_id: rRole.value }))));
        // emoji
        const eText = h("textarea", { rows: "3", placeholder: "Paste custom emoji, Discord emoji links, or links to pictures on any website, up to 20. Example: <:pog:123456789012345678>" }), eOut = h("div"), eList = h("div", { class: "emoji-grid" });
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
        // emoji.gg packs: pick a pack, untick what you don't want, import in batches
        const packSort = select([["recent", "Newest"], ["downloads", "Most popular"], ["oldest", "Oldest"]], "recent");
        const packBox = h("div", { class: "muted", text: "Loading packs…" });
        const showPacks = async () => {
          packBox.className = "muted"; packBox.replaceChildren("Loading packs…");
          try {
            const r = await api("/api/community/emoji-packs?guild=" + encodeURIComponent(GID()) + "&sort=" + packSort.value);
            packBox.className = "";
            packBox.replaceChildren(h("div", { class: "pack-grid" }, ...r.packs.map(p => {
              const open = h("button", { class: "btn blue small", type: "button", text: "Open" });
              open.addEventListener("click", () => openPack(p));
              return h("div", { class: "pack-card" }, h("div", { class: "pack-previews" }, ...p.previews.map(u => h("img", { src: u, alt: "", width: "40", height: "40", loading: "lazy", referrerpolicy: "no-referrer" }))),
                h("b", { text: p.title }), h("span", { class: "muted small", text: p.count ? p.count + " emoji" : "" }), open);
            })));
          } catch (e) { packBox.className = ""; packBox.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
        };
        const openPack = async p => {
          packBox.className = "muted"; packBox.replaceChildren("Reading the pack…");
          let r; try { r = await api("/api/community/emoji-pack?guild=" + encodeURIComponent(GID()) + "&key=" + encodeURIComponent(p.key)); } catch (e) { packBox.className = ""; packBox.replaceChildren(h("div", { class: "notice warn", text: e.message }), (() => { const b = h("button", { class: "btn gray small", text: "Back" }); b.addEventListener("click", showPacks); return b; })()); return; }
          packBox.className = "";
          const boxes = r.emojis.map(e => { const c = h("input", { type: "checkbox", checked: true }); return { e, c, el: h("label", { class: "emoji-pick", title: ":" + e.name + ":" }, c, h("img", { src: e.url, alt: e.name, width: "40", height: "40", loading: "lazy", referrerpolicy: "no-referrer" }), h("span", { text: e.name })) }; });
          const count = h("span", { class: "muted small" }), out = h("div");
          const picked = () => boxes.filter(x => x.c.checked);
          const sync = () => { count.textContent = `${picked().length} of ${boxes.length} ticked`; };
          boxes.forEach(x => x.c.addEventListener("change", sync)); sync();
          const only = (label, f) => { const b = h("button", { class: "btn gray small", type: "button", text: label }); b.addEventListener("click", () => { boxes.forEach(x => { x.c.checked = f(x.e); }); sync(); }); return b; };
          const back = h("button", { class: "btn gray small", type: "button", text: "← All packs" }); back.addEventListener("click", showPacks);
          const go = h("button", { class: "btn green", type: "button", text: "Import the ticked emoji" });
          go.addEventListener("click", () => busy(go, async () => {
            const ids = picked().map(x => x.e.id); if (!ids.length) { toast("Tick at least one emoji.", "warn"); return; }
            let added = [], failed = [];
            for (let n = 0; n < ids.length; n += 30) {
              out.replaceChildren(h("p", { class: "muted", text: `Importing… ${Math.min(n, ids.length)} of ${ids.length}` }));
              const res = await post("/api/community/emoji-pack", { key: p.key, ids: ids.slice(n, n + 30) });
              added = added.concat(res.added); failed = failed.concat(res.failed);
              if (res.full && res.full.static && res.full.animated) break;
            }
            out.replaceChildren(h("p", {}, added.length ? `Added ${added.length}: ${added.slice(0, 40).map(x => ":" + x + ":").join(" ")}` : "Nothing was added."), ...failed.slice(0, 6).map(f => h("p", { class: "muted small", text: `${f.name}: ${f.why}` })), failed.length > 6 ? h("p", { class: "muted small", text: `…and ${failed.length - 6} more were skipped.` }) : "");
            if (added.length) loadEmoji();
          }));
          packBox.replaceChildren(h("div", { class: "row" }, back, h("b", { text: p.title }), h("a", { href: p.url, target: "_blank", rel: "noopener noreferrer", text: "emoji.gg ↗" })),
            h("p", { class: "muted small", text: "Still and animated emoji have separate slots in a server, so tick only what fits. Check the pack's license on emoji.gg." }),
            h("div", { class: "row" }, only("All", () => true), only("None", () => false), only("Still only", e => !e.animated), only("Animated only", e => e.animated), count),
            h("div", { class: "pick-grid" }, ...boxes.map(x => x.el)), h("div", { class: "row" }, go), out);
        };
        packSort.addEventListener("change", showPacks);
        showPacks();
        const emoji = h("div", { class: "panel" }, h("h3", { text: "Emoji import" }),
          h("p", { class: "muted", text: "Copy emoji from other servers (they look like <:name:id> in a message), paste a Discord emoji link, or paste a link to a picture on any website (PNG, GIF, JPG or WebP under 256 KB). Animated emoji keep their movement. Needs the Manage Expressions permission for the bot." }), eText,
          h("div", { class: "row" }, (() => { const b = h("button", { class: "btn blue", text: "Add the emoji" }); b.addEventListener("click", () => busy(b, async () => {
            const r = await post("/api/community/emoji", { text: eText.value });
            eOut.replaceChildren(h("p", {}, r.added.length ? `Added ${r.added.length}: ${r.added.map(n => ":" + n + ":").join(" ")}` : "Nothing was added."), ...r.failed.map(f => h("p", { class: "muted small", text: `${f.name}: ${f.why}` })));
            if (r.added.length) { eText.value = ""; loadEmoji(); }
          })); return b; })()), eOut,
          h("h4", { text: "Emoji packs from emoji.gg" }), h("div", { class: "row" }, field("Show", packSort)), packBox,
          h("h4", { text: "Or add one image" }), h("p", { class: "muted small", text: "PNG, GIF, JPG or WebP under 256 KB. Square images work best." }), h("div", { class: "row" }, upFile, upName, upBtn),
          h("h4", { text: "This server's emoji" }), eList);
        loadEmoji();
        // rules, announcements, support: where things are posted and what they say
        const annCh = chSel(st.announce_channel || (ch.channels.find(c => c.name === "announcements") || {}).id), rulesCh = chSel(st.rules_channel || (ch.channels.find(c => c.name === "rules") || {}).id);
        const reqCh = forumSel(st.requests_channel), trapCh = chSel(st.honeypot_channel);
        const places = h("div", { class: "panel" }, h("h3", { text: "Where things are posted" }),
          field("Announcements channel (your announcements, and the bot developer's notices to all servers)", annCh), field("Rules channel", rulesCh),
          field("Feature requests forum (each idea is a post tagged with its status; needs a forum channel)", reqCh),
          field("Trap channel for spam bots: anyone who types there is banned (staff are exempt)", trapCh),
          h("p", { class: "muted small", text: "Pick a channel that members can see and write in, and let me post the warning there. Make sure my role has Ban Members and sits above the members. The warning notice and channel description are added when you save a new channel." }),
          h("div", { class: "row" }, save("Save channels", () => post("/api/community/places", { announce_channel: annCh.value, rules_channel: rulesCh.value, requests_channel: reqCh.value, honeypot_channel: trapCh.value }))));
        // AI companion: members write "Hey AI ..." and get a short answer
        const ai = d.ai || {};
        const aiOn = h("input", { type: "checkbox", checked: Boolean(st.ai_on), disabled: !ai.available && !ai.lite });
        const guidesOn = h("input", { type: "checkbox", checked: st.guides_on !== 0 });
        const aiCh = chSel(st.ai_channel);
        const provs = ai.providers || [{ id: "anthropic", label: "Anthropic (Claude)", needsModel: false, keyHelp: "console.anthropic.com" }];
        const provNow = ai.keySet ? ai.keyProvider : "anthropic";
        const provSel = select(provs.map(p => [p.id, p.label]), provNow);
        provSel.disabled = Boolean(ai.keySet); // switching service means pasting a key for the new one: remove it first
        const provOf = () => provs.find(p => p.id === provSel.value) || provs[0];
        const keyIn = h("input", { type: "password", autocomplete: "off", spellcheck: "false", maxlength: "400", placeholder: ai.keySet ? "Paste a new key to replace it" : "Paste your API key" });
        const modelIn = h("input", { type: "text", maxlength: "100", spellcheck: "false", value: ai.keyModel || "", placeholder: "Model name" });
        const modelList = h("datalist", { id: "ai-models-" + st.guild_id });
        modelIn.setAttribute("list", "ai-models-" + st.guild_id); modelIn.setAttribute("autocomplete", "off");
        const loadModels = () => { const b = h("button", { class: "btn gray small", type: "button", text: "Load models" });
          b.addEventListener("click", () => busy(b, async () => {
            const r = await post("/api/community/ai-models", { ai_key: keyIn.value, ai_provider: provSel.value });
            modelList.replaceChildren(...r.models.map(m => h("option", { value: m })));
            toast(r.models.length ? `${r.models.length} models found. Click the Model box to pick one.` : "That key can't see any chat models.", r.models.length ? "ok" : "warn");
          })); return b; };
        const keyHelp = h("p", { class: "muted small" });
        const refresh = () => {
          const pv = provOf();
          modelIn.placeholder = pv.needsModel ? `Model name from ${pv.label}'s model list (required)` : "Leave empty for the default";
          keyHelp.textContent = `Get a key at ${pv.keyHelp}. It is checked when you save, stored encrypted, never shown again and never sent anywhere except ${pv.label}. With your own key your server pays ${pv.label} for its answers (they are small, usually a fraction of a cent each) and the bot's daily limit does not apply. You can remove it any time.`;
        };
        provSel.addEventListener("change", refresh); refresh();
        const provName = (provs.find(p => p.id === provNow) || provs[0]).label;
        const keyBox = h("div", {},
          ai.keyBad ? h("div", { class: "notice warn", text: `${provName} rejected this server's key the last time it was used, so the AI companion is silent here. Paste a working key to fix it.` }) : null,
          ai.keySet ? h("p", { class: "ai-use", text: `Using your own ${provName} key, ending ${ai.keyLast4 || "••••"}${ai.keyModel ? `, model ${ai.keyModel}` : ""}. ${ai.botKey ? "Your server is not counted against the bot's daily limit." : ""}` }) : null,
          ai.canStoreKey ? field("AI service", provSel) : h("p", { class: "muted small", text: "This bot can't store keys for servers yet." }),
          ai.canStoreKey ? field("Your own API key (optional)", keyIn) : null,
          ai.canStoreKey ? field("Model (press Load models to see what your key can use)", h("div", {}, modelIn, modelList)) : null,
          ai.canStoreKey ? keyHelp : null,
          ai.canStoreKey ? h("div", { class: "row" },
            save(ai.keySet ? "Replace key" : "Save key", () => { if (!keyIn.value.trim()) throw new Error("Paste your key first."); return post("/api/community/places", { ai_key: keyIn.value, ai_provider: provSel.value, ai_model: modelIn.value }); }),
            loadModels(),
            ai.keySet ? save("Save model", () => post("/api/community/places", { ai_provider: provNow, ai_model: modelIn.value })) : null,
            ai.keySet ? save("Remove key", () => post("/api/community/places", { ai_key_clear: true })) : null) : null);
        const aiP = h("div", { class: "panel" }, h("h3", {}, "AI companion", ai.available ? null : h("span", { class: "pill", text: "Coming soon" })),
          ai.available ? null : h("div", { class: "notice", text: "The full AI is coming soon. Until then, when you switch this on, the bot answers the common questions itself: game prices, the free games right now, and a member's own wishlist and library (try “Hey AI is Hades on sale?”). Anything else gets a polite “coming soon”. Want the full AI today? Add your own AI key below (Anthropic, OpenAI, Gemini and more)." }),
          h("label", { class: "check" }, guidesOn, " Answer how-to questions with a step by step guide (no AI needed), like “how do I get Steam Verified”"),
          h("label", { class: "check" }, aiOn, " Answer when members say “Hey AI” followed by a question"),
          field("Only answer in this channel (leave empty for every channel)", aiCh),
          h("p", { class: "muted small", text: "The bot needs View Channel, Read Message History and Send Messages in the channel. If it can't send there, it tells the person who asked (by DM) what to allow." }),
          h("p", { class: "muted small", text: ai.phrase ? "Members write “Hey AI, …” or mention the bot." : "Members mention the bot, because this bot can't read “Hey AI” yet (it needs the Message Content intent)." }),
          (ai.available || ai.lite) ? h("p", { class: "ai-use", text: ai.main ? `Answers today: ${ai.usedToday}. This is the bot owner's own server, so it has no daily limit.` : ai.keySet && ai.unlimited ? `Answers today: ${ai.usedToday}. No daily limit while your own key is used.` : `Used today: ${ai.usedToday} of ${ai.dailyCap} answers (resets at midnight UTC).${ai.plus ? " AI Plus is on for this server." : ""}` }) : null,
          h("div", { class: "row" }, save("Save AI settings", () => post("/api/community/places", { ai_on: aiOn.checked, ai_channel: aiCh.value, guides_on: guidesOn.checked }))),
          h("h4", { text: "Your own API key" }), keyBox,
          h("h4", { text: "How it works and its limits" }),
          h("ul", { class: "ai-limits" },
            h("li", { text: ai.main ? "This server is the bot owner's own, so it has no daily answer limit." : ai.keySet ? "Your server uses its own key, so there is no daily answer limit. The bot owner can still switch the AI off or set a limit for your server." : `Each server gets up to ${ai.dailyCap || 300} answers a day. After that the bot says it has reached the limit and starts again the next day. A server with its own key has no daily limit.` }),
            h("li", { text: `Each person can ask once every ${ai.cooldownSec || 15} seconds. Faster than that, the bot just reacts with ⏳.` }),
            h("li", { text: `Questions are cut at ${ai.maxQuestion || 700} characters. Answers are short, never longer than ${ai.maxReply || 1900} characters, and ping nobody.` }),
            h("li", { text: `Replying to one of its answers continues the conversation (it remembers the last ${ai.history || 6} messages of that thread). It remembers nothing else.` }),
            h("li", { text: (ai.available ? "" : "Right now it works from fixed questions, not free chat. ") + "It can look up live game prices, the free games right now, and the asker's own wishlist and library, and add a game to the asker's wishlist when asked. It never sees anyone else's lists or other channels." }),
            h("li", { text: ai.available ? "Only messages that say “Hey AI” or mention the bot are read. The question, the thread it replies to, the person's display name and the results of those lookups are sent to the AI service you chose (Anthropic by default; your own key can use another) to write the answer. Nothing else from your server is sent." : "Only messages that say “Hey AI” or mention the bot are read. While the full AI is coming soon, the bot answers them itself and nothing is sent to any AI provider." }),
            h("li", { text: "Servers that turn it on are responsible for who can use it: pick one channel above if you only want it in one place." })));
        const plusBtn = save(ai.plusInterest ? "Never mind" : "Tell me when it's ready", () => post("/api/community/places", { ai_plus_interest: !ai.plusInterest }));
        const plusP = ai.plusVisible && !ai.main ? h("div", { class: "panel" }, h("h3", {}, "AI Plus ", h("span", { class: "pill", text: "Work in progress" })),
          h("p", { text: `When your server reaches its daily limit, AI Plus would keep the answers coming using the bot's own AI, with a bigger limit (${(ai.plusCap || 2000).toLocaleString()} answers a day), and nothing for you to set up.` }),
          h("p", { class: "muted small", text: "Payments are not switched on yet, so there is nothing to buy today. Until then you can lift the limit for free with your own AI key above. Press the button and the bot owner will know your server wants this." }),
          ai.plus ? h("div", { class: "notice", text: "AI Plus is on for this server right now, so the bigger limit applies." }) : null,
          ai.plusInterest ? h("p", { class: "ai-use", text: "Noted. Your server is on the list." }) : null,
          h("div", { class: "row" }, plusBtn)) : null;
        const rText = h("textarea", { rows: "9", maxlength: "3000", placeholder: d.defaultRules }); rText.value = st.rules_text || "";
        const rulesP = h("div", { class: "panel" }, h("h3", { text: "Rules" }),
          h("p", { class: "muted", text: "Edit the rules shown in the rules channel. Leave it empty to use the standard community rules. The post comes with the bot logo and banner." }), field("Rules (Discord formatting works)", rText),
          h("div", { class: "row" }, save("Save", () => post("/api/community/rules", { text: rText.value })), save("Save and post in the rules channel", () => post("/api/community/rules", { text: rText.value, post: true }), "btn green small")));
        const tkCh = chSel(d.support.ticket_channel), tkRole = roSel(d.support.staff_role_id, "Server managers only");
        const supportP = h("div", { class: "panel" }, h("h3", { text: "Support tickets" }),
          h("p", { class: "muted", text: "Members press Open a ticket in #get-help (or use /bot support open). Tickets land in the channel below with Reply, Assign me and Resolve buttons. Bug reports go to the bot's developer instead." }),
          field("Tickets channel (staff only)", tkCh), field("Role that answers tickets", tkRole),
          h("div", { class: "row" }, save("Save support", () => post("/api/community/support", { ticket_channel: tkCh.value, staff_role_id: tkRole.value }))));
        const announceP = announceDesigner({ chSel, roSel, defaultCh: st.announce_channel || (ch.channels.find(c => c.name === "announcements") || {}).id, history: d.announcements, roleName, chName: id => (ch.channels.find(c => c.id === id) || {}).name });
        const lbCh = chSel(st.lb_channel), lbHours = h("input", { type: "number", min: "1", max: "48", value: String(st.lb_hours || 5), "aria-label": "Hours between refreshes" });
        const lbP = h("div", { class: "panel" }, h("h3", { text: "XP leaderboard" }),
          h("p", { class: "muted", text: "A read-only channel with the top members and top inviters. The bot edits the same message on a timer, so it never fills the channel. Members use /server rank for their own place." }),
          field("Leaderboard channel", lbCh), field("Refresh every (hours, 1 to 48)", lbHours),
          h("p", { class: "muted small", text: st.lb_at ? "Last updated " + new Date(st.lb_at).toLocaleString() + "." : "Not posted yet." }),
          h("div", { class: "row" }, save("Save", () => post("/api/community/leaderboard", { channel_id: lbCh.value, hours: lbHours.value })),
            save("Save and refresh now", () => post("/api/community/leaderboard", { channel_id: lbCh.value, hours: lbHours.value, refresh: true }), "btn green small")));
        const mCh = chSel(st.meme_channel || (ch.channels.find(c => c.name === "memes") || {}).id), mHours = h("select", { "aria-label": "How often" }, ...[1, 2, 3, 6, 12, 24].map(n => h("option", { value: String(n), text: n === 1 ? "Every hour" : `Every ${n} hours`, selected: n === (st.meme_hours || 1) })));
        const mOn = h("input", { type: "checkbox", checked: st.meme_on !== 0 });
        const mBody = () => ({ channel_id: mCh.value, hours: mHours.value, enabled: mOn.checked });
        const memeP = h("div", { class: "panel" }, h("h3", { text: "Auto memes" }),
          h("p", { class: "muted", text: "The bot posts a fresh gaming and internet meme in this channel on a timer. Nothing marked NSFW is used and a server never gets the same post twice." }),
          field("Memes channel", mCh), field("How often", mHours), h("label", { class: "check" }, mOn, " Post memes automatically"),
          h("p", { class: "muted small", text: st.meme_at ? "Last meme " + new Date(st.meme_at).toLocaleString() + "." : "None posted yet." }),
          h("div", { class: "row" }, save("Save", () => post("/api/community/memes", mBody())), save("Save and post one now", () => post("/api/community/memes", { ...mBody(), now: true }), "btn green small")));
        // group everything a manager can customise into tabs
        // Guides managers write for their own server: the bot answers matching questions by itself, and the AI can use them too
        const gTitle = h("input", { type: "text", maxlength: "80", placeholder: "How do I get the Raider role?" });
        const gKeys = h("textarea", { rows: "2", maxlength: "400", placeholder: "get raider role, raider role, how to join raids" });
        const gBody = h("textarea", { rows: "5", maxlength: "1500", placeholder: "Write the answer exactly as members should read it." });
        const guidesP = h("div", { class: "panel" }, h("h3", { text: "Server guides" }),
          h("p", { class: "muted", text: "Write answers to the questions your members keep asking: rules, roles, channels, how things work here. When someone asks something that contains one of your phrases, the bot replies with the guide by itself. The AI companion uses them too." }),
          (st.serverGuides || d.serverGuides || []).length ? h("ul", { class: "plain" }, (st.serverGuides || d.serverGuides || []).map(g => h("li", {}, h("b", { text: g.title }), h("span", { class: "muted small", text: "  ·  " + g.keywords.join(", ") }), " ", save("Remove", () => post("/api/community/guides", { remove: g.id }), "btn gray small")))) : h("p", { class: "muted small", text: "No guides yet." }),
          field("Title", gTitle), field("Phrases that trigger it (separate with commas)", gKeys), field("The answer", gBody),
          h("div", { class: "row" }, save("Add guide", () => post("/api/community/guides", { title: gTitle.value, keywords: gKeys.value, body: gBody.value }))));
        const groups = [["Setup", [build]], ["Welcome & verify", [welcome, verify]], ["AI companion", [aiP, guidesP, plusP].filter(Boolean)], ["Rules & announcements", [places, rulesP, announceP]], ["Support", [supportP]], ["Roles & pings", [pings, referral]], ["Leaderboard", [lbP]], ["Memes", [memeP]], ["Emoji", [emoji]]];
        const tabBar = h("div", { class: "tabs" }), body = h("div");
        const show = n => { mgrTab = n; [...tabBar.children].forEach((b, k) => b.classList.toggle("active", k === n)); body.replaceChildren(...groups[n][1]); };
        groups.forEach(([label], n) => tabBar.append(h("button", { class: "tab small", type: "button", text: label, onclick: () => show(n) })));
        box.replaceChildren(h("h2", { text: "Server settings" }), h("p", { class: "muted", text: "Everything you can customise for this server, in one place." }), tabBar, body);
        show(Math.min(mgrTab, groups.length - 1));
      })();
      return box;
    }
    guild.addEventListener("change", load);
    load();
  }

  // ---------- server XP: leaderboard, your card, level rewards, how XP works, and the prize shop teaser ----------
  // ---------- streams: go live, pings, and the streamer settings ----------
  /** Loads the shared stream-overlay panel (public/overlayui.js and .css) once. */
  const overlayAssets = (() => {
    let p = null;
    const load = (tag, attrs) => new Promise((res, rej) => { const e = document.createElement(tag); Object.assign(e, attrs); e.onload = res; e.onerror = rej; document.head.append(e); });
    return () => (p ??= Promise.all([window.SvcOverlayPanel ? 0 : load("script", { src: "/overlayui.js" }), document.querySelector('link[href="/overlayui.css"]') ? 0 : load("link", { rel: "stylesheet", href: "/overlayui.css" })]).catch(e => { p = null; throw e; }));
  })();

  async function streamsView(opts = {}) {
    const servers = state.me.servers.filter(g => g.bot !== false);
    const holder = opts.into ?? h("div");
    if (!opts.into) app.replaceChildren(pageHead("Streams", "Link your channel and the bot posts when you go live, by itself. Choose whether you get pinged when others do, and set up your OBS overlay. In Discord: /server stream."), holder);
    if (!servers.length) { holder.replaceChildren(h("div", { class: "notice warn", text: "The bot is not in any of your servers yet. Add it from the Servers page." })); return; }
    const guild = opts.guild ?? serverPicker(servers, currentParam());
    guild.addEventListener("change", () => { load(); });
    /** The giveaway tool for streamers: the same options as a server giveaway, plus drawing when the stream ends. */
    function streamGiveawayPanel(d, unset, post, run) {
      const text = (ph, max, type = "text") => h("input", { type, placeholder: ph, maxlength: String(max) });
      const keys = h("textarea", { placeholder: "Hades | AAAAA-BBBBB-CCCCC\nCeleste | DDDDD-EEEEE-FFFFF\n(a key on its own uses the game name)", maxlength: "20000", autocomplete: "off", spellcheck: "false" });
      const game = text("Game name (for the artwork, optional)", 100), title = text("Title (optional)", 100), desc = h("textarea", { placeholder: "Extra text on the giveaway (optional)", maxlength: "1500" });
      const length = text("30m, 1h, 2h", 20); length.value = "1h";
      const presets = h("div", { class: "chips" }, ["30m", "1h", "2h", "3h", "6h"].map(p => h("button", { type: "button", class: "tab small", text: p, onclick: () => { length.value = p; } })));
      const endWith = h("input", { type: "checkbox", id: "sgw-end", checked: true });
      const image = text("Your own image, GIF or video link, https (optional)", 500), thumb = text("Your own small picture or GIF link, https (optional)", 500);
      const auto = h("input", { type: "checkbox", checked: true }), color = text("#9146ff", 8), label = text("Enter giveaway", 40);
      const claim = text("24", 3, "number"), acct = text("0", 4, "number"), memb = text("0", 4, "number"), bonusN = text("2", 2, "number");
      const boosters = h("input", { type: "checkbox" }), steamV = h("input", { type: "checkbox" });
      const roles = d.roles || null, roleSel = () => select([["", "None"], ...(roles || []).map(r => [r.id, r.name])], "");
      const reqRole = roleMulti(roles || []), bonusRole = roleMulti(roles || []), overRole = roleMulti(roles || []), pingRole = roleSel();
      const reqAll = select([["any", "Any one of them"], ["all", "All of them"]], "any");
      const tw = (d.links || []).find(l => l.platform === "twitch"), yt = (d.links || []).find(l => l.platform === "youtube");
      const prefill = tw ? [{ kind: "follow_twitch", url: tw.url }] : yt ? [{ kind: "youtube", url: yt.url }] : [];
      const steps = stepsEditor(d.stepKinds || [], { prefill });
      const gp = giveawayPreview(() => ({ title: title.value.trim(), desc: desc.value.trim(), keys: keys.value, image: image.value, thumb: thumb.value, color: color.value, label: label.value.trim(), length: length.value.trim(), host: "you" }));
      for (const el of [title, desc, keys, image, thumb, color, label, length]) el.addEventListener("input", gp.paint);
      const isTwitch = Boolean(tw);
      const chatOn = h("input", { type: "checkbox", id: "sgw-chat", disabled: !isTwitch }), chatInvite = text("https://discord.gg/yourserver", 120, "url");
      const go = h("button", { class: "btn blue", type: "button", text: "🎁 Start the giveaway", disabled: unset });
      go.addEventListener("click", () => run(go, async () => {
        const num = el => (el.value === "" ? undefined : Number(el.value));
        const r = await post("/api/streams/giveaway", {
          keys: keys.value, game: game.value, title: title.value, description: desc.value, length: length.value, end_with_stream: endWith.checked,
          image: image.value, thumbnail: thumb.value, auto_image: auto.checked, color: color.value, button_label: label.value,
          claim_hours: num(claim), min_account_days: num(acct), min_member_days: num(memb), bonus_entries: num(bonusN), boosters: boosters.checked, steam_verified: steamV.checked,
          require_role_ids: reqRole.value, require_all: reqAll.value === "all", override_role_ids: overRole.value, bonus_role_ids: bonusRole.value, ping_role_id: pingRole.value, steps: steps.get(), chat_enter: chatOn.checked, chat_invite: chatInvite.value
        });
        keys.value = "";
        toast(`Giveaway posted in the live channel with ${r.prizes} prize${r.prizes === 1 ? "" : "s"}.${r.endsWithStream ? " It draws when you end your stream." : ""}${r.chat ? (r.chatReplies ? " Viewers can type !enter in your chat." : " Linked viewers can type !enter in your chat (the bot can't answer in chat until a Twitch bot login is set).") : ""}`, "ok");
      }));
      return h("div", { class: "panel" }, h("h3", { text: "Giveaway for your viewers" }),
        unset ? h("div", { class: "notice warn", text: "No live channel is set yet." + (d.can.manage ? " Pick one in the settings below." : " Ask a manager.") }) : null,
        h("p", { class: "muted small", text: "Give away one or more prizes while you are live. It is posted in the live channel and draws winners when you end your stream, or when the time is up. Winners get their prize from the bot by message. You must be marked live first." }),
        field("Prizes (one per line)", keys), prizeButtons(keys, gp.paint),
        h("p", { class: "muted small", text: "Keys, Discord Nitro links and gift card codes are kept encrypted and handed to the winner by a Claim button. Money and other prizes have no code: the bot tells you who won and you send it yourself." }),
        h("div", { class: "row" }, field("Runs for at most", length), field("Title", title)), presets,
        h("label", { class: "check", for: "sgw-end" }, endWith, " Draw the winners as soon as I end my stream"),
        h("h4", { text: "Look" }),
        h("div", { class: "grid two" }, h("div", {},
          field("Description", desc),
          h("div", { class: "row" }, field("Big picture, GIF or video link (https)", image), field("Small picture or GIF link (https)", thumb)),
          h("div", { class: "row" }, field("Game (for automatic artwork)", game), field("Enter button text", label), field("Color (#9146ff)", color)),
          h("label", { class: "check" }, auto, " Find artwork automatically when I don't give an image")),
          h("div", {}, h("b", { text: "Preview" }), gp.el)),
        h("h4", { text: "Required steps (optional)" }),
        h("p", { class: "muted small", text: "Ask viewers to do something first, like following your channel, joining your Discord or wishlisting your game. Each step shows on the post as a numbered line and a link button. Discord can't check these, so it works on trust and winners may be checked." }),
        steps.el,
        h("h4", { text: "Enter from Twitch chat" }),
        h("label", { class: "check", for: "sgw-chat" }, chatOn, " Let viewers type !enter in my Twitch chat"),
        isTwitch ? h("div", {}, field("Your Discord invite (the bot tells new viewers to join it)", chatInvite),
          h("p", { class: "muted small", text: "Viewers link their Twitch to the bot once on the Steam page (it reads the Twitch account shown in their Discord connections, so it can't be faked), then !enter works like the Enter button. Anyone who isn't linked gets a reply in chat pointing them to your Discord invite and the link page." + (d.chatReplies ? "" : " The bot can't write in chat yet (no Twitch bot login is set on the bot), so it only counts linked viewers.") }))
          : h("p", { class: "muted small", text: "Link your Twitch channel in the Your channel box above first, so I know which chat to listen to." }),
        h("details", { class: "more" }, h("summary", { text: "Rules (all optional)" }),
          h("div", { class: "row" }, field("Min. Discord account age (days)", acct), field("Min. days in this server", memb), field("Hours to claim", claim)),
          h("label", { class: "check" }, boosters, " Only server boosters can enter"),
          h("label", { class: "check" }, steamV, " Only Steam Verified members can enter"),
          roles ? h("div", {}, h("div", { class: "row" }, field("Roles needed to enter (pick as many as you like)", reqRole), field("Entrants need", reqAll)), h("div", { class: "row" }, field("Skip every rule with this role (like Booster)", overRole)), h("div", { class: "row" }, field("Roles that get extra entries", bonusRole), field("Bonus entries (2-10)", bonusN), field("Ping role", pingRole))) : h("p", { class: "muted small", text: "Role rules and pings are set by a server manager." })),
        h("p"), h("div", { class: "row" }, go));
    }
    async function load() {
      holder.replaceChildren(h("p", { class: "muted", text: "Loading…" }));
      let d;
      try { d = await api("/api/streams?guild=" + encodeURIComponent(guild.value)); } catch (e) { return holder.replaceChildren(servers.length > 1 && !opts.guild ? h("div", { class: "panel" }, field("Server", guild)) : null, h("div", { class: "notice warn", text: e.message })); }
      const gid = guild.value, post = (path, body) => api(path, { guild_id: gid, ...body });
      const run = (btn, fn, msg) => busy(btn, async () => { await fn(); if (msg) toast(msg, "ok"); load(); });
      const picker = servers.length > 1 && !opts.guild ? h("div", { class: "panel" }, field("Server", guild)) : null;
      const unset = !d.settings.live_channel;

      const liveList = h("div", { class: "panel" }, h("h3", { text: "Live now" }),
        d.live.length ? h("ul", { class: "plain" }, d.live.map(r => {
          const end = (d.can.manage || r.mine) ? h("button", { class: "btn gray small", text: "End", onclick: e => run(e.currentTarget, () => post("/api/streams/end", { user_id: r.userId }), "Marked as ended.") }) : null;
          return h("li", {}, "🔴 ", h("a", { href: r.url, target: "_blank", rel: "noopener noreferrer", text: r.title }), r.game ? " · " + r.game : "", " ", end);
        })) : h("p", { class: "muted", text: "Nobody is streaming right now." }));

      let pingPanel;
      if (!d.settings.ping_stream) pingPanel = h("div", { class: "panel" }, h("h3", { text: "Go-live pings" }), h("p", { class: "muted", text: "Pings aren't set up in this server yet." + (d.can.manage ? " Pick a ping role below." : " Ask a manager to set one up.") }));
      else {
        const on = d.optedIn === true, b = h("button", { class: "btn small " + (on ? "gray" : "blue"), text: on ? "Stop pinging me" : "Ping me when someone goes live" });
        b.addEventListener("click", () => run(b, () => post("/api/streams/ping", { on: !on }), on ? "No more stream pings." : "You'll get pinged when someone goes live."));
        pingPanel = h("div", { class: "panel" }, h("h3", { text: "Go-live pings" }), h("p", { class: "muted small", text: d.optedIn === null ? "I can't tell if you have the ping role right now, but the button still works." : on ? "You're opted in. You'll be pinged in the live channel whenever someone goes live." : "Get pinged in the live channel whenever someone in this server goes live." }), h("div", { class: "row" }, b));
      }

      let linkPanel = null;
      if (d.can.go) {
        const NAMES = { twitch: "Twitch", kick: "Kick", youtube: "YouTube" };
        const links = d.links || [];
        const url = h("input", { type: "url", placeholder: "https://twitch.tv/yourname", maxlength: "200", "aria-label": "Add a channel link" });
        const save = h("button", { class: "btn blue", type: "button", text: links.length ? "Add this channel" : "Link my channel", disabled: unset });
        save.addEventListener("click", () => run(save, () => post("/api/streams/link", { channel: url.value }), "Linked. I'll post when you go live."));
        const rows = links.map(l => {
          const gone = h("button", { class: "btn gray small", type: "button", text: "Remove", "aria-label": "Remove " + NAMES[l.platform] });
          gone.addEventListener("click", () => run(gone, () => post("/api/streams/unlink", { platform: l.platform }), "Removed " + NAMES[l.platform] + "."));
          return h("div", { class: "row stream-link-row" }, h("strong", { text: NAMES[l.platform] }), h("a", { href: l.url.replace(/\/live$/, ""), target: "_blank", rel: "noopener", text: l.handle }),
            h("span", { class: "muted small", text: d.watch[l.platform] ? "checked every couple of minutes" : "can't be checked on this bot yet" }), gone);
        });
        const note = links.length
          ? (links.length > 1 ? "I watch all of these. If you're live on more than one, there's a single post that links to each." : "I check every couple of minutes. When you go live I post in the live channel and ping the people who opted in, and I close the post when you finish.") + " You can link one channel on each site."
          : "Link your Twitch, Kick and YouTube channels and I'll notice when you go live on any of them, so you never have to post it yourself.";
        linkPanel = h("div", { class: "panel" }, h("h3", { text: links.length > 1 ? "Your channels" : "Your channel" }), unset ? h("div", { class: "notice warn", text: "No live channel is set yet." + (d.can.manage ? " Pick one in the settings below." : " Ask a manager.") }) : null,
          h("p", { class: "muted small", text: note }), ...rows, field(links.length ? "Add another channel (Twitch, Kick or YouTube)" : "Channel link (Twitch, Kick or YouTube)", url), h("div", { class: "row" }, save));
      }

      let goPanel;
      if (d.can.go) {
        const url = h("input", { type: "url", placeholder: "https://twitch.tv/yourname", maxlength: "300" }), title = h("input", { type: "text", placeholder: "What are you streaming?", maxlength: "120" }), game = h("input", { type: "text", placeholder: "Game (optional)", maxlength: "60" });
        const go = h("button", { class: "btn blue", text: "🔴 Go live", disabled: unset });
        go.addEventListener("click", () => run(go, async () => { const r = await post("/api/streams/live", { url: url.value, title: title.value, game: game.value }); toast(r.edited ? "Updated your post." : r.pinged ? "You're live! Everyone who opted in was pinged." : "You're live!", "ok"); }));
        goPanel = h("div", { class: "panel" }, h("h3", { text: linkPanel ? "Go live by hand" : "Go live" }), unset ? h("div", { class: "notice warn", text: "No live channel is set yet." + (d.can.manage ? " Pick one in the settings below." : " Ask a manager.") }) : null,
          h("div", { class: "grid two" }, field("Stream link", url), field("Title", title)), field("Game", game), h("div", { class: "row" }, go),
          h("p", { class: "muted small", text: "Posts in the live channel. If you went live in the last half hour, it updates your post instead of pinging again." }));
      } else goPanel = h("div", { class: "panel" }, h("h3", { text: "Go live" }), h("p", { class: "muted", text: d.settings.streamer_role_id ? "Only people with the streamer role, moderators and managers can announce streams here. Ask a manager for the role." : "This server hasn't picked a streamer role yet." }));

      let settings = null;
      if (d.can.manage) {
        const roles = [["", "Not set"], ...(d.roles ?? []).map(r => [r.id, r.name])], chans = [["", "Not set"], ...(d.channels ?? []).map(c => [c.id, "#" + c.name])];
        const sr = select(roles, d.settings.streamer_role_id || ""), lc = select(chans, d.settings.live_channel || ""), pr = select(roles, d.settings.ping_stream || "");
        const sv = h("button", { class: "btn blue small", text: "Save settings" });
        const autoBox = h("input", { type: "checkbox", id: "stream-auto" }); autoBox.checked = d.settings.auto !== false;
        sv.addEventListener("click", () => run(sv, () => post("/api/streams/settings", { streamer_role_id: sr.value, live_channel: lc.value, ping_stream: pr.value, auto: autoBox.checked }), "Saved."));
        settings = h("div", { class: "panel" }, h("h3", { text: "Settings (managers)" }), h("div", { class: "grid two" }, field("Streamer role", sr), field("Live channel", lc)), field("Ping role (members opt in to it)", pr), h("label", { class: "check", for: "stream-auto" }, autoBox, " Post by itself when linked streamers go live"), h("div", { class: "row" }, sv),
          h("p", { class: "muted small", text: "The streamer role, moderators and managers can announce streams, and see the OBS overlay in the music player. Community setup makes all three for you." }));
      }
      let gwPanel = null;
      if (d.can.go) {
        gwPanel = streamGiveawayPanel(d, unset, post, run);
      }
      holder.replaceChildren(...[picker, liveList, linkPanel, goPanel, gwPanel, pingPanel, settings].filter(Boolean));
      if (d.can.go) holder.append(h("div", { class: "notice" }, "Your OBS overlays (now playing, giveaway, deals and cards) live in the ", h("a", { href: "#/overlays", text: "Overlay studio" }), " now."));
    }
    load();
  }

  // ---------- streamer hub: everything for streamers on one page ----------
  /** The deals overlay panel: a private link for OBS that rotates the best wishlist deal, a free game and a "gift me" card. */
  function streamCardPanel() {
    const panel = h("div", { class: "panel", id: "sh-cards" });
    const KINDS = [["game", "The game I am playing right now"], ["deal", "Best deal on my wishlist"], ["free", "A free game that is live now"], ["gift", "“Gift me” with my public wishlist page"]];
    const copy = async text => { try { await navigator.clipboard.writeText(text); toast("Copied.", "ok"); } catch { toast("Select the link and copy it by hand.", "warn"); } };
    /** Chat bot commands for Twitch, Kick and YouTube chat: viewers type !deals, !free or !wishlist. */
    function chatBox(d) {
      const tools = Object.entries(d.chat || {});
      if (!tools.length) return null;
      const sel = select(tools.map(([k, t]) => [k, t.label]), tools[0][0]);
      const area = h("textarea", { readonly: true, rows: "3", "aria-label": "Chat commands" });
      const fill = () => { area.value = d.chat[sel.value].lines.join("\n"); };
      sel.addEventListener("change", fill); fill();
      const cp = h("button", { class: "btn gray small", type: "button", text: "Copy commands" }); cp.addEventListener("click", () => copy(area.value));
      return h("div", { class: "subpanel" }, h("h4", { text: "Chat commands (Twitch, Kick, YouTube)" }),
        h("p", { class: "muted small", text: "Paste these into your chat bot. Viewers type !deals, !free or !wishlist and get your best deal, a free game right now, or your gift-me page. The lines hold your private link, so keep them to yourself. In Discord: /server stream chat." }),
        field("Your chat bot", sel), area, h("div", { class: "row" }, cp));
    }
    async function draw() {
      let d;
      try { d = await api("/api/streamcard"); } catch (e) { panel.replaceChildren(h("h3", { text: "Deals overlay for OBS" }), h("div", { class: "notice warn", text: e.message })); return; }
      const head = h("h3", { text: "Deals overlay for OBS" });
      const blurb = h("p", { class: "muted", text: "A small card for your stream that rotates through the best deal on your wishlist, a game that is free right now, and a reminder that you have a public wishlist. It shows only public things. Add it in OBS as a Browser source." });
      if (!d.on) {
        const make = h("button", { class: "btn blue", type: "button", text: "Make my overlay link" });
        make.addEventListener("click", () => busy(make, async () => { await api("/api/streamcard", { action: "create" }); toast("Your overlay link is ready.", "ok"); draw(); }));
        panel.replaceChildren(head, blurb, h("div", { class: "row" }, make, h("a", { class: "btn gray", href: d.base + "?demo=1", target: "_blank", rel: "noopener noreferrer", text: "See a sample" })));
        return;
      }
      const boxes = KINDS.map(([k, label]) => { const c = h("input", { type: "checkbox", checked: d.kinds.includes(k) }); return [k, c, h("label", { class: "check" }, c, label)]; });
      const anchor = select([["bl", "Bottom left"], ["bc", "Bottom center"], ["br", "Bottom right"], ["tl", "Top left"], ["tc", "Top center"], ["tr", "Top right"], ["ml", "Middle left"], ["mr", "Middle right"]], "bl");
      const theme = select([["dark", "Dark"], ["light", "Light"], ["glass", "Glass"]], "dark");
      const hold = h("input", { type: "number", min: "4", max: "120", value: "12", "aria-label": "Seconds per card" });
      const scale = h("input", { type: "number", min: "0.5", max: "3", step: "0.1", value: "1", "aria-label": "Size" });
      const link = h("input", { type: "text", readonly: true, "aria-label": "Overlay link" });
      const build = () => { const u = new URL(d.base); u.searchParams.set("token", d.token); u.searchParams.set("anchor", anchor.value); if (theme.value !== "dark") u.searchParams.set("theme", theme.value); if (hold.value && hold.value !== "12") u.searchParams.set("hold", hold.value); if (scale.value && scale.value !== "1") u.searchParams.set("scale", scale.value); link.value = u.toString(); };
      [anchor, theme, hold, scale].forEach(e => e.addEventListener("input", build)); build();
      const save = h("button", { class: "btn blue small", type: "button", text: "Save cards" });
      save.addEventListener("click", () => busy(save, async () => { await api("/api/streamcard", { action: "save", kinds: boxes.filter(([, c]) => c.checked).map(([k]) => k) }); toast("Saved. The overlay updates within a couple of minutes.", "ok"); draw(); }));
      const reset = h("button", { class: "btn gray small", type: "button", text: "Make a new link" });
      reset.addEventListener("click", () => { if (confirm("Your old link stops working at once. Continue?")) busy(reset, async () => { await api("/api/streamcard", { action: "reset" }); toast("New link made. Paste it into OBS again.", "ok"); draw(); }); });
      const off = h("button", { class: "btn red small", type: "button", text: "Turn it off" });
      off.addEventListener("click", () => busy(off, async () => { await api("/api/streamcard", { action: "remove" }); toast("Overlay link removed.", "ok"); draw(); }));
      const giftNote = d.kinds.includes("gift") && !d.public ? h("div", { class: "notice warn", text: "The gift card stays hidden until your public wishlist page is on. Turn it on in the next section." }) : null;
      const copyBtn = h("button", { class: "btn gray small", type: "button", text: "Copy link" }); copyBtn.addEventListener("click", () => copy(link.value));
      panel.replaceChildren(head, blurb, h("div", { class: "grid two" }, boxes.map(b => b[2])), giftNote,
        h("div", { class: "row" }, save),
        h("h4", { text: "Look" }), h("div", { class: "grid two" }, field("Where", anchor), field("Colors", theme), field("Seconds per card", hold), field("Size (1 is normal)", scale)),
        field("Your private link (keep it to yourself)", link),
        h("div", { class: "row" }, copyBtn, h("a", { class: "btn gray small", href: link.value, target: "_blank", rel: "noopener noreferrer", text: "Open it" }), reset, off),
        h("p", { class: "muted small", text: "In OBS: add a Browser source, paste the link, set width 600 and height 200. Anyone with the link can see these cards, so make a new one if it leaks." }),
        chatBox(d));
    }
    draw();
    return panel;
  }

  /** The giveaway overlay for OBS: shows the streamer's stream giveaway (entries, time left, how to enter, then the winners). Same private link as the deals cards. */
  function giveawayOverlayPanel() {
    const panel = h("div", { class: "panel", id: "sh-gwoverlay" });
    const KEY = "svc_gwoverlay";
    let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { /* none */ }
    const copy = async text => { try { await navigator.clipboard.writeText(text); toast("Copied.", "ok"); } catch { toast("Select the link and copy it by hand.", "warn"); } };
    /** Choose which of the server's running giveaways go on screen. With none picked it just follows your latest stream giveaway. */
    const servers = state.me.servers.filter(g => g.bot !== false);
    function picker() {
      if (!servers.length) return null;
      const guild = select(servers.map(g => [g.id, g.name]), servers[0].id), list = h("div", { class: "gwpicks" }), save = h("button", { class: "btn blue small", type: "button", text: "Save my picks" });
      let rows = [];
      const note = h("p", { class: "muted small" });
      async function loadList() {
        list.replaceChildren(h("span", { class: "muted small", text: "Looking…" }));
        try { rows = (await api("/api/giveawayoverlay/pick?guild=" + encodeURIComponent(guild.value))).giveaways; } catch (e) { rows = []; list.replaceChildren(h("div", { class: "notice warn", text: e.message })); note.textContent = ""; return; }
        if (!rows.length) { list.replaceChildren(h("p", { class: "muted", text: "No giveaways are running in this server right now." })); note.textContent = ""; return; }
        list.replaceChildren(...rows.map(r => { const c = h("input", { type: "checkbox", checked: r.picked }); c.dataset.id = String(r.id); const when = r.endsAt ? new Date(r.endsAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""; return h("label", { class: "check" }, c, h("span", {}, h("b", { text: r.title }), h("span", { class: "muted small", text: ` ${r.entries} entries · ${r.prizes} prize${r.prizes === 1 ? "" : "s"} · ends ${when}${r.mine ? " · yours" : ""}` }))); }));
        note.textContent = "Tick up to six. With several ticked, the overlay slides between them with live stats.";
      }
      guild.addEventListener("change", loadList);
      save.addEventListener("click", () => busy(save, async () => { const ids = [...list.querySelectorAll("input:checked")].map(i => Number(i.dataset.id)); await api("/api/giveawayoverlay/pick", { guild_id: guild.value, ids }); toast(ids.length ? "Saved. Your overlay switches within seconds." : "Cleared. It follows your latest stream giveaway.", "ok"); loadList(); }));
      loadList();
      return h("div", { class: "subpanel" }, h("h4", { text: "Which giveaways to show" }), servers.length > 1 ? field("Server", guild) : null, list, note, h("div", { class: "row" }, save));
    }
    async function draw() {
      let d;
      try { d = await api("/api/streamcard"); } catch (e) { panel.replaceChildren(h("h3", { text: "Giveaway overlay for OBS" }), h("div", { class: "notice warn", text: e.message })); return; }
      const head = h("h3", { text: "Giveaway overlay for OBS" });
      const blurb = h("p", { class: "muted", text: "Show your stream giveaway on screen: the prize, how many people entered, a countdown, the steps to enter, and then the winners the moment they are drawn. Pick one giveaway or several and it slides between them with live stats, or pick none and it follows your latest stream giveaway by itself. Add it in OBS as a Browser source." });
      const base = (d.base || "").replace(/streamcard$/, "giveawayoverlay");
      if (!d.on) {
        const make = h("button", { class: "btn blue", type: "button", text: "Make my overlay link" });
        make.addEventListener("click", () => busy(make, async () => { await api("/api/streamcard", { action: "create" }); toast("Your overlay link is ready.", "ok"); draw(); }));
        panel.replaceChildren(head, blurb, h("div", { class: "row" }, make, h("a", { class: "btn gray", href: base + "?demo=1", target: "_blank", rel: "noopener noreferrer", text: "See a sample" })));
        return;
      }
      const v = (k, dflt) => (saved[k] ?? dflt);
      const style = select([["card", "Card"], ["bar", "Wide bar"], ["mini", "Small tag"]], v("style", "card"));
      const theme = select([["dark", "Dark"], ["light", "Light"], ["glass", "Glass"], ["neon", "Neon glow"], ["clear", "No background"]], v("theme", "dark"));
      const anchor = select([["tr", "Top right"], ["tc", "Top center"], ["tl", "Top left"], ["mr", "Middle right"], ["ml", "Middle left"], ["br", "Bottom right"], ["bc", "Bottom center"], ["bl", "Bottom left"]], v("anchor", "tr"));
      const font = select([["system", "Clean"], ["rounded", "Rounded"], ["mono", "Techy"], ["serif", "Classic"]], v("font", "system"));
      const accent = h("input", { type: "color", value: v("accent", "#4da3ff"), "aria-label": "Accent color" });
      const scale = h("input", { type: "number", min: "0.5", max: "3", step: "0.1", value: v("scale", "1"), "aria-label": "Size" });
      const label = h("input", { type: "text", maxlength: "40", placeholder: "Giveaway", value: v("label", ""), "aria-label": "Small heading" });
      const join = h("input", { type: "text", maxlength: "80", placeholder: "Join: discord.gg/yourserver", value: v("join", ""), "aria-label": "How to enter text" });
      const hold = h("input", { type: "number", min: "5", max: "600", value: v("hold", "60"), "aria-label": "Winner seconds" });
      const every = h("input", { type: "number", min: "3", max: "60", value: v("every", "8"), "aria-label": "Seconds per giveaway" });
      const dots = h("input", { type: "checkbox", checked: v("dots", true) !== false });
      const TOG = [["prizes", "Prizes"], ["entries", "Entry count"], ["timer", "Countdown"], ["bar", "Progress bar"], ["steps", "Steps to enter"], ["chat", "“Type !enter in chat” line"], ["winners", "Winners when drawn"]];
      const tog = TOG.map(([k, t]) => { const c = h("input", { type: "checkbox", checked: v(k, true) !== false }); return [k, c, h("label", { class: "check" }, c, t)]; });
      const autoHide = h("input", { type: "checkbox", checked: v("hide", false) === true }); 
      const link = h("input", { type: "text", readonly: true, "aria-label": "Giveaway overlay link" });
      const prev = h("iframe", { class: "gwprev", title: "Preview", loading: "lazy" });
      const demo = select([["1", "Preview: several giveaways"], ["one", "Preview: one giveaway"], ["ended", "Preview: winners"]], "1");
      const params = () => {
        const u = new URLSearchParams();
        if (style.value !== "card") u.set("style", style.value); if (theme.value !== "dark") u.set("theme", theme.value); if (anchor.value !== "tr") u.set("anchor", anchor.value);
        if (font.value !== "system") u.set("font", font.value); if (accent.value.toLowerCase() !== "#4da3ff") u.set("accent", accent.value.slice(1)); if (scale.value && scale.value !== "1") u.set("scale", scale.value);
        if (label.value.trim()) u.set("label", label.value.trim()); if (join.value.trim()) u.set("join", join.value.trim());
        for (const [k, c] of tog) if (!c.checked) u.set(k, "0");
        if (every.value && every.value !== "8") u.set("every", every.value); if (!dots.checked) u.set("dots", "0");
        if (autoHide.checked) { u.set("hide", "1"); if (hold.value && hold.value !== "60") u.set("hold", hold.value); }
        return u;
      };
      const rebuild = () => {
        const u = params(), real = new URL(base); real.searchParams.set("token", d.token); for (const [k, x] of u) real.searchParams.set(k, x);
        link.value = real.toString();
        const pv = new URL(base); pv.searchParams.set("demo", demo.value); for (const [k, x] of u) pv.searchParams.set(k, x); if (pv.toString() !== prev.getAttribute("src")) prev.src = pv.toString();
        try { localStorage.setItem(KEY, JSON.stringify({ style: style.value, theme: theme.value, anchor: anchor.value, font: font.value, accent: accent.value, scale: scale.value, label: label.value, join: join.value, hold: hold.value, every: every.value, dots: dots.checked, hide: autoHide.checked, ...Object.fromEntries(tog.map(([k, c]) => [k, c.checked])) })); } catch { /* fine */ }
      };
      [style, theme, anchor, font, accent, scale, label, join, hold, every, dots, autoHide, demo, ...tog.map(t => t[1])].forEach(e => e.addEventListener("input", rebuild)); rebuild();
      const copyBtn = h("button", { class: "btn blue small", type: "button", text: "Copy link" }); copyBtn.addEventListener("click", () => copy(link.value));
      panel.replaceChildren(head, blurb,
        h("div", { class: "gwprevwrap" }, prev), h("div", { class: "row" }, field("Preview", demo)),
        picker(), h("div", { class: "grid two" }, field("Seconds on each giveaway", every), h("label", { class: "check" }, dots, "Dots under the card when several are showing")),
        h("h4", { text: "Look" }), h("div", { class: "grid two" }, field("Layout", style), field("Colors", theme), field("Where", anchor), field("Font", font), field("Accent color", accent), field("Size (1 is normal)", scale)),
        h("h4", { text: "What it shows" }), h("div", { class: "grid two" }, tog.map(t => t[2])),
        h("div", { class: "grid two" }, field("Small heading", label), field("How to enter (your invite or link)", join)),
        h("div", { class: "grid two" }, h("label", { class: "check" }, autoHide, "Hide the winners after a while"), field("Seconds to show winners", hold)),
        field("Your private link (keep it to yourself)", link),
        h("div", { class: "row" }, copyBtn, h("a", { class: "btn gray small", href: link.value, target: "_blank", rel: "noopener noreferrer", text: "Open it" })),
        h("p", { class: "muted small", text: "In OBS: add a Browser source, paste the link, set width 1920 and height 1080 (your canvas size) and leave the background alone. It is the same private link as your deals overlay, so a new link there replaces this one too. It stays empty until you start a stream giveaway above." }));
    }
    draw();
    return panel;
  }

  async function streamerHubView() {
    const servers = state.me.servers.filter(g => g.bot !== false);
    const guild = servers.length ? serverPicker(servers, currentParam()) : null;
    const goBox = h("div", { id: "sh-live" }), rosterBox = h("div", { id: "sh-roster" });
    const jump = (id, label) => h("a", { class: "chip-btn", href: "#/streamer", text: label, onclick: e => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); } });
    app.replaceChildren(pageHead("Streamer hub", "Everything for streamers in one place: announce when you go live, the overlays for OBS, your gift-me wishlist, and who else is streaming. In Discord: /server stream."),
      h("div", { class: "panel" }, servers.length > 1 ? field("Server", guild) : null,
        h("div", { class: "chips" }, jump("sh-live", "Go live and pings"), jump("sh-gift", "Gift me page"), jump("sh-roster", "Who is live"))),
      h("div", { class: "notice" }, h("b", { text: "What these need: " }), "your Discord sign-in with the bot in your server. The Playing now card, !game and Now playing also need Steam linked (Steam page) and Game details set to Public. The browser extension features (spotlight, wishlist from a store page) need the extension linked with the bot: ", h("a", { href: "#/library", text: "Library, Connect the extension" }), "."),
      goBox, h("div", { class: "panel" }, h("h3", { text: "Overlays for OBS" }), h("p", { class: "muted", text: "Now playing, giveaway, deals and cards, goal bars, server stats and timers are all in one place now." }), h("a", { class: "btn blue", href: "#/overlays", text: "Open the Overlay studio" })), h("div", { id: "sh-gift" }, publicPagePanel()),
      h("div", { class: "panel" }, h("h3", { text: "Discord commands" }), h("p", { class: "muted small", text: "/server stream link links your Twitch, Kick or YouTube channel. /server stream live, title and game post or update a go-live message. /server stream end closes it. /server stream ping turns the go-live pings on or off for you. /alerts share and /server nowplaying let friends see you in a game." })),
      rosterBox);
    if (!servers.length) { goBox.replaceChildren(h("div", { class: "notice warn", text: "The bot is not in any of your servers yet, so go-live posts are off. The overlay and gift page below still work. Add the bot from the Servers page." })); rosterBox.remove(); return; }
    await Promise.all([streamsView({ into: goBox, guild }), streamersView({ into: rosterBox, guild })]);
  }

  // ---------- streamers: everyone who linked a channel in a server, and who is live ----------
  async function streamersView(opts = {}) {
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

  async function xpView() {
    const servers = state.me.servers.filter(g => g.bot !== false);
    const holder = h("div");
    app.replaceChildren(pageHead("Server XP", "Levels, the leaderboard and rewards for your server. In Discord: /server rank and /server levels."), holder);
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
          h("li", { text: d.how.referral ? `Invites: ${d.how.referral} XP each time someone joins through your invite link.` : "Invites: bring friends with your own link (/server invites link)." }),
          h("li", { text: d.multiplier === 1 ? "XP speed is normal." : `This server runs XP at ×${d.multiplier}.` })));
        const curve = h("div", { class: "panel" }, h("h3", { text: "XP needed per level" }),
          h("div", { class: "scroll-y" }, h("table", {}, h("thead", {}, h("tr", {}, ["Level", "XP to reach it", "Total XP"].map((c, i) => h("th", { class: i ? "num" : "", text: c })))), h("tbody", {}, d.curve.map(c => h("tr", {}, h("td", { text: String(c.level) }), h("td", { class: "num", text: c.need.toLocaleString() }), h("td", { class: "num", text: c.total.toLocaleString() })))))));
        const shop = h("div", { class: "panel shop-soon" }, h("div", { class: "shop-badge", text: "COMING SOON" }), h("h3", { text: "Prize shop" }),
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


  // ---------- community feed ----------
  const FEED_STATE = { scope: null, game: null, server: "all" };
  const feedAgo = ms => { const m = Math.max(0, Math.floor((Date.now() - ms) / 60000)); if (m < 1) return "just now"; if (m < 60) return m + " min ago"; const hr = Math.floor(m / 60); if (hr < 24) return hr + " h ago"; const d = Math.floor(hr / 24); return d < 30 ? d + " d ago" : new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
  const feedAvatar = (by, cls = "fd-av") => httpsOnly(by.avatar) ? h("img", { class: cls, src: by.avatar, alt: "", referrerpolicy: "no-referrer" }) : h("div", { class: cls + " init", text: (by.name || "?").slice(0, 1).toUpperCase() });
  const feedName = by => by.slug ? h("a", { class: "fd-name", href: "#/u/" + by.slug, text: by.name }) : h("span", { class: "fd-name", text: by.name });
  const gameChip = (it, onGame) => { const b = h("button", { class: "fd-game", type: "button", text: "🎮 " + it.game, title: "Show posts about " + it.game }); b.addEventListener("click", () => onGame(it.appid, it.game)); return b; };

  function feedBody(it, onGame) {
    const art = it.art ? h("div", { class: "fd-art" }, pfArt(it.art, it.game)) : null;
    if (it.kind === "finished") return h("div", { class: "fd-event" }, art, h("div", {}, h("div", { class: "fd-line" }, "🏁 Finished ", it.appid ? gameChip(it, onGame) : h("strong", { text: it.game })), h("div", { class: "muted small", text: "Added to their finished list." })));
    if (it.kind === "rare") {
      const d = it.data || {};
      return h("div", { class: "fd-event" }, httpsOnly(d.icon) ? h("img", { class: "fd-ach", src: d.icon, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : h("div", { class: "fd-ach none", text: "★" }),
        h("div", {}, h("div", { class: "fd-line" }, "💎 Unlocked ", h("strong", { text: d.name || "a rare achievement" }), " in ", it.appid ? gameChip(it, onGame) : h("strong", { text: it.game })), h("div", { class: "muted small", text: d.pct != null ? `Only ${d.pct}% of players have it.` : "" })));
    }
    if (it.kind === "trophy") { const d = it.data || {}; return h("div", { class: "fd-event" }, h("div", { class: "fd-ach none", text: d.icon || "🏆" }), h("div", {}, h("div", { class: "fd-line", text: `Earned the ${d.name || "a"} trophy` }), h("div", { class: "muted small", text: (d.tier || "") + " tier" }))); }
    return h("div", { class: "fd-post" }, h("p", { text: it.body }), it.appid ? gameChip(it, onGame) : null);
  }

  /** One card in the feed or one reply: who, when, what, reactions, and the actions that make sense for the viewer. */
  function feedCard(it, ctx) {
    const card = h("article", { class: "fd-card" + (it.parentId ? " reply" : "") + (it.hidden ? " hidden-item" : ""), "data-id": String(it.id) });
    const menu = h("span", { class: "fd-menu" });
    if (ctx.signedIn) {
      const del = h("button", { class: "fd-link", type: "button", text: it.own ? "Delete" : "Report" });
      del.addEventListener("click", () => busy(del, async () => {
        if (it.own) { if (!confirm("Delete this?")) return; await api("/api/social/delete", { id: it.id }); card.remove(); ctx.onGone?.(it); toast("Deleted.", "ok"); }
        else { const why = prompt("What's wrong with it? (optional)"); if (why === null) return; await api("/api/social/report", { id: it.id, reason: why }); toast("Thanks. It will be looked at.", "ok"); }
      }));
      menu.append(del);
    }
    const srv = !it.parentId && it.servers?.length && ctx.onServer ? h("span", { class: "fd-srvs" }, it.servers.map(g => { const b = h("button", { class: "fd-srv", type: "button", text: g.name, title: "See " + g.name + "'s feed" }); b.addEventListener("click", () => ctx.onServer(g.id)); return b; })) : null;
    const head = h("div", { class: "fd-head" }, feedAvatar(it.by), h("div", { class: "fd-who" }, feedName(it.by), h("span", { class: "muted small", text: feedAgo(it.at) + (it.hidden ? " · hidden pending review" : "") })), srv, menu);
    const bar = h("div", { class: "fd-actions" });
    const drawBar = () => {
      bar.replaceChildren(...ctx.reactions.map(e => {
        const n = it.reactions[e] || 0, on = it.mine === e;
        const b = h("button", { class: "fd-react" + (on ? " on" : ""), type: "button", title: on ? "Take it back" : "React", "aria-pressed": String(on) }, e, n ? h("span", { text: String(n) }) : null);
        b.addEventListener("click", async () => {
          if (!ctx.signedIn) return toast("Sign in with Discord to react.", "warn");
          try {
            const r = await api("/api/social/react", { id: it.id, emoji: e });
            if (it.mine) it.reactions[it.mine] = Math.max(0, (it.reactions[it.mine] || 1) - 1);
            it.mine = r.mine; if (r.mine) it.reactions[r.mine] = (it.reactions[r.mine] || 0) + 1;
            drawBar();
          } catch (err) { toast(err.message, "error"); }
        });
        return b;
      }));
      if (!it.parentId) bar.append(replyBtn);
    };
    const thread = h("div", { class: "fd-thread", hidden: true });
    const replyBtn = h("button", { class: "fd-reply", type: "button" });
    const paintReply = () => { replyBtn.textContent = "💬 " + (it.replies ? it.replies : "Reply"); };
    paintReply();
    let loaded = false;
    replyBtn.addEventListener("click", async () => {
      thread.hidden = !thread.hidden;
      if (thread.hidden || loaded) return;
      loaded = true; thread.replaceChildren(h("div", { class: "muted small", text: "Loading…" }));
      try {
        const r = await api("/api/social/item?id=" + it.id);
        const list = h("div", { class: "fd-replies" });
        const add = rep => list.append(feedCard(rep, { ...ctx, onGone: () => { it.replies = Math.max(0, it.replies - 1); paintReply(); } }));
        r.replies.forEach(add);
        thread.replaceChildren(list);
        if (ctx.signedIn) thread.append(feedComposer({ parent: it.id, placeholder: "Write a reply", button: "Reply", onPosted: async () => { loaded = false; thread.hidden = true; const r2 = await api("/api/social/item?id=" + it.id); it.replies = r2.replies.length; paintReply(); thread.hidden = false; list.replaceChildren(...r2.replies.map(x => feedCard(x, { ...ctx, onGone: () => { it.replies = Math.max(0, it.replies - 1); paintReply(); } }))); loaded = true; } }));
        else thread.append(h("p", { class: "muted small", text: "Sign in with Discord to reply." }));
      } catch (err) { loaded = false; thread.replaceChildren(h("div", { class: "notice warn", text: err.message })); }
    });
    drawBar();
    const pic = it.image ? h("a", { class: "fd-pic", href: "/fimg/" + it.image, target: "_blank", rel: "noopener" }, h("img", { src: "/fimg/" + it.image, alt: "Picture from " + (it.by?.name || "a post"), loading: "lazy" })) : null;
    card.append(head, feedBody(it, ctx.onGame), pic, bar, thread);
    return card;
  }

  /** The box for writing a post or a reply. */
  /** Shrinks a chosen picture to something light before it is sent: at most 1280 px on the long side, as a JPEG of roughly 250 KB. Resolves a data: address. */
  function shrinkPicture(file) {
    return new Promise((resolve, reject) => {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error("Pick a JPEG, PNG or WebP picture."));
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        // aim for about 250 KB: plenty for a feed post, and it keeps the database small
        let q = 0.8, out = c.toDataURL("image/jpeg", q);
        while (out.length > 340_000 && q > 0.45) { q -= 0.1; out = c.toDataURL("image/jpeg", q); }
        out.length > 1_500_000 ? reject(new Error("That picture is too big. Try a smaller one.")) : resolve(out);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file could not be read as a picture.")); };
      img.src = url;
    });
  }

  /** The box for writing a post or a reply. A post can also carry one picture. */
  function feedComposer({ parent = null, placeholder = "What are you playing?", button = "Post", games = [], onPosted }) {
    const box = h("textarea", { class: "fd-text", maxlength: "280", rows: parent ? "2" : "3", placeholder, "aria-label": placeholder });
    const count = h("span", { class: "muted small fd-count", text: "280" });
    const pick = !parent ? h("select", { class: "fd-pick", "aria-label": "Tag a game" }, h("option", { value: "", text: "No game" }), ...games.map(g => h("option", { value: String(g.appid), text: g.title }))) : null;
    const send = h("button", { class: "btn blue small", type: "button", text: button });
    let picture = null;
    const preview = h("div", { class: "fd-attach", hidden: true });
    const file = !parent ? h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", hidden: true, "aria-label": "Add a picture" }) : null;
    const attach = file ? h("button", { class: "btn gray small", type: "button", text: "📷 Picture", onclick: () => file.click() }) : null;
    const clear = () => { picture = null; preview.hidden = true; preview.replaceChildren(); if (file) file.value = ""; };
    file?.addEventListener("change", async () => {
      if (!file.files[0]) return;
      try {
        picture = await shrinkPicture(file.files[0]);
        const im = h("img", { src: picture, alt: "Your picture" });
        preview.replaceChildren(im, h("button", { class: "btn gray small", type: "button", text: "Remove", onclick: clear })); preview.hidden = false;
      } catch (e) { clear(); toast(e.message, "warn"); }
    });
    box.addEventListener("input", () => { count.textContent = String(280 - [...box.value].length); count.classList.toggle("warn", 280 - [...box.value].length < 20); });
    send.addEventListener("click", () => busy(send, async () => {
      await api("/api/social/post", { body: box.value, appid: pick?.value ? Number(pick.value) : undefined, parent: parent ?? undefined, image: picture ?? undefined });
      box.value = ""; count.textContent = "280"; if (pick) pick.value = ""; clear();
      await onPosted?.();
    }));
    return h("div", { class: "fd-compose" }, box, preview, h("div", { class: "fd-compose-row" }, pick, attach, file, count, send));
  }

  async function feedView() {
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


  /** A server's card: what it is, how active it is, a way in, and the members who have public pages. */
  function serverCard(g, people = []) {
    const join = g.invite ? ext(g.invite, "Join on Discord", "btn blue small") : h("span", { class: "muted small", text: "No public invite yet" });
    return h("div", { class: "panel fd-server" },
      h("div", { class: "fd-server-top" }, h("div", { class: "fd-av init", text: (g.name || "?").slice(0, 1).toUpperCase() }), h("div", { class: "fd-who" }, h("strong", { class: "fd-name", text: g.name }),
        h("span", { class: "muted small", text: [g.members ? `${g.members.toLocaleString()} members` : null, `${g.people} on the bot with a public page`, g.active ? `${g.active} active this week` : null].filter(Boolean).join(" · ") })), join),
      g.about ? h("p", { class: "fd-about", text: g.about }) : null,
      people.length ? h("div", { class: "fd-people fd-compact" }, people.slice(0, 8).map(p => personRow(p))) : null);
  }

  async function communitiesView() {
    const box = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(pageHead("Communities", "Every server the bot is in. Open one to see what its members are up to, or join it."), box);
    try {
      const d = await api("/api/social/servers");
      const q = h("input", { type: "search", class: "fd-search", placeholder: "Find a server", "aria-label": "Find a server" });
      const grid = h("div", { class: "fd-servers" });
      const draw = () => {
        const term = q.value.trim().toLowerCase();
        const shown = d.servers.filter(g => !term || g.name.toLowerCase().includes(term) || (g.about || "").toLowerCase().includes(term));
        grid.replaceChildren(...(shown.length ? shown.map(g => {
          const open = h("button", { class: "btn gray small", type: "button", text: "Open feed" });
          open.addEventListener("click", () => { FEED_STATE.scope = "servers"; FEED_STATE.server = g.id; FEED_STATE.game = null; navigate("/feed"); });
          return h("div", { class: "fd-server-card" }, h("div", { class: "fd-server-top" }, h("div", { class: "fd-av init", text: g.name.slice(0, 1).toUpperCase() }), h("div", { class: "fd-who" }, h("strong", { class: "fd-name", text: g.name }),
            h("span", { class: "muted small", text: [g.members ? `${g.members.toLocaleString()} members` : null, `${g.people} with public pages`, g.active ? `${g.active} active this week` : null].filter(Boolean).join(" · ") }))),
            g.about ? h("p", { class: "fd-about", text: g.about }) : null, h("div", { class: "fd-actions" }, open, g.invite ? ext(g.invite, "Join", "btn blue small") : null));
        }) : [h("div", { class: "empty", text: "No servers match that." })]));
      };
      q.addEventListener("input", draw);
      box.className = ""; box.replaceChildren(h("div", { class: "fd-bar" }, q, h("a", { class: "btn gray small", href: "/feed", text: "All servers' feed" })), grid);
      draw();
      box.append(leaderboardPanel(d.servers));
      if (d.manage.length) box.append(h("div", { class: "panel" }, h("h3", { text: "Your servers" }),
        h("p", { class: "muted small", text: "Servers you manage show up here by default. Add a short description and a Discord invite so people can join, or take the server out of the directory." }), ...d.manage.map(manageRow)));
    } catch (e) { box.className = ""; box.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
  }

  /** Who is posting, finishing and unlocking the most, for every server or one of them. Only members with a public page appear. */
  function leaderboardPanel(servers) {
    const body = h("div", { class: "fd-boards" });
    const sel = h("select", { class: "fd-pick", "aria-label": "Leaderboard for" }, h("option", { value: "all", text: "All servers" }), ...servers.map(g => h("option", { value: g.id, text: g.name })));
    const load = () => api("/api/social/leaderboards?server=" + encodeURIComponent(sel.value)).then(r => {
      body.replaceChildren(...r.boards.map(b => h("div", { class: "fd-board" }, h("h4", { text: b.title }),
        b.rows.length ? h("ol", {}, b.rows.map((x, i) => h("li", {}, h("span", { class: "fd-rank", text: String(i + 1) }), x.by.slug ? h("a", { href: "/u/" + x.by.slug, text: x.by.name }) : h("span", { text: x.by.name }), h("b", { text: String(x.n) })))) : h("p", { class: "muted small", text: "Nobody yet." }))));
    }).catch(e => body.replaceChildren(h("p", { class: "muted", text: e.message })));
    sel.addEventListener("change", load);
    load();
    return h("div", { class: "panel" }, h("div", { class: "fd-bar" }, h("h3", { text: "Leaderboards" }), sel), h("p", { class: "muted small", text: "Only members whose page is switched on are counted." }), body);
  }

  function manageRow(g) {
    const on = h("input", { type: "checkbox", checked: g.listed });
    const about = h("input", { type: "text", maxlength: "200", value: g.about || "", placeholder: "A line about your server", "aria-label": "Description" });
    const invite = h("input", { type: "text", value: g.invite || "", placeholder: "https://discord.gg/yourinvite", "aria-label": "Invite link" });
    const save = h("button", { class: "btn blue small", type: "button", text: "Save" });
    save.addEventListener("click", () => busy(save, async () => { await api("/api/social/server", { guild: g.id, listed: on.checked, about: about.value, invite: invite.value }); toast("Saved.", "ok"); }));
    return h("div", { class: "fd-manage" }, h("strong", { text: g.name }), h("label", { class: "fd-check" }, on, h("span", { text: "Show this server in the community directory" })), field("Description", about), field("Invite link", invite), save);
  }

  async function discoverView() {
    const box = h("div", { class: "muted", text: "Loading…" });
    const pickWrap = h("div", { class: "fd-bar" });
    let which = "all-servers";
    app.replaceChildren(pageHead("Discover", "What people are into this week, the rarest achievements around, and members whose libraries look like yours."), pickWrap, box);
    const run = async () => {
    try {
      const d = await api("/api/social/discover" + (which === "all-servers" ? "" : "?server=" + encodeURIComponent(which)));
      if (!pickWrap.children.length) {
        const sel = h("select", { class: "fd-pick", "aria-label": "Where" }, h("option", { value: "all-servers", text: "Everywhere" }), h("option", { value: "all", text: "All connected servers" }), ...d.servers.map(g => h("option", { value: g.id, text: g.name })));
        sel.addEventListener("change", () => { which = sel.value; run(); });
        pickWrap.append(sel);
      }
      const trend = d.trending.length ? h("div", { class: "fd-trend" }, d.trending.map(g => {
        const a = h("button", { class: "fd-trend-card", type: "button" }, h("div", { class: "fd-art" }, pfArt(g.art, g.game)), h("strong", { text: g.game }), h("span", { class: "muted small", text: `${g.people} ${g.people === 1 ? "person" : "people"}${g.posts ? ` · ${g.posts} post${g.posts === 1 ? "" : "s"}` : ""}${g.finishes ? ` · ${g.finishes} finished` : ""}` }));
        a.addEventListener("click", () => { FEED_STATE.game = { appid: g.appid, game: g.game }; FEED_STATE.scope = "everyone"; navigate("/feed"); });
        return a;
      })) : h("p", { class: "muted", text: "Nothing is trending yet. Finish a game or post about one and it will show up here." });
      const rare = d.rare.length ? h("div", { class: "fd-rare" }, d.rare.map(r => h("div", { class: "fd-rare-row" }, httpsOnly(r.icon) ? h("img", { class: "fd-ach", src: r.icon, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : h("div", { class: "fd-ach none", text: "★" }),
        h("div", {}, h("strong", { text: r.achievement }), h("div", { class: "muted small" }, `${r.game} · ${r.pct}% of players · `, r.slug ? h("a", { href: "#/u/" + r.slug, text: r.name }) : r.name))))) : h("p", { class: "muted", text: "Nobody has shared achievements yet. Turn on the Rarest achievements section on your page." });
      const people = state.me ? (d.similar.length ? h("div", { class: "fd-people" }, d.similar.map(p => personRow(p, `${p.shared} games in common`))) : h("p", { class: "muted", text: "Sync your Steam library and you'll see members who own a lot of the same games." })) : h("p", { class: "muted", text: "Sign in to see people with libraries like yours." });
      box.className = ""; box.replaceChildren(h("div", { class: "panel" }, h("h3", { text: "Trending this week" }), trend), h("div", { class: "panel" }, h("h3", { text: "Rarest achievements" }), rare), h("div", { class: "panel" }, h("h3", { text: "People you might like" }), people));
    } catch (e) { box.className = ""; box.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    };
    run();
  }

  /** A person in a list, with a follow button. */
  function personRow(p, note) {
    const btn = h("button", { class: "btn small", type: "button" });
    const paint = () => { btn.className = "btn small " + (p.following ? "gray" : "blue"); btn.textContent = p.following ? "Following" : "Follow"; };
    paint();
    btn.addEventListener("click", () => busy(btn, async () => { await api("/api/social/follow", { slug: p.slug, on: !p.following }); p.following = !p.following; paint(); }));
    return h("div", { class: "fd-person" }, feedAvatar(p), h("div", { class: "fd-who" }, feedName(p), note ? h("span", { class: "muted small", text: note }) : null), state.me ? btn : null);
  }

  async function peopleView() {
    const box = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(pageHead("People", "Who you follow, who follows you, and who you've blocked."), box);
    const tab = { v: "following" };
    const draw = r => {
      const unblock = b => { const x = h("button", { class: "btn gray small", type: "button", text: "Unblock" }); x.addEventListener("click", () => busy(x, async () => { await api("/api/social/block", { slug: b.slug, on: false }); r.blocked = r.blocked.filter(y => y !== b); draw(r); toast("Unblocked.", "ok"); })); return x; };
      const lists = { following: r.following.map(p => personRow(p)), followers: r.followers.map(p => personRow(p)), blocked: r.blocked.map(b => h("div", { class: "fd-person" }, h("div", { class: "fd-av init", text: "∅" }), h("div", { class: "fd-who" }, h("span", { class: "fd-name", text: b.name })), unblock(b))) };
      const empty = { following: "You aren't following anyone yet. Try Discover.", followers: "Nobody follows you yet. Share your page link.", blocked: "You haven't blocked anyone." };
      const tabs = h("div", { class: "fd-scopes" }, [["following", `Following (${r.following.length})`], ["followers", `Followers (${r.followers.length})`], ["blocked", `Blocked (${r.blocked.length})`]].map(([k, label]) => {
        const b = h("button", { class: "chip-btn" + (tab.v === k ? " on" : ""), type: "button", text: label }); b.addEventListener("click", () => { tab.v = k; draw(r); }); return b;
      }));
      box.className = ""; box.replaceChildren(tabs, h("div", { class: "panel" }, lists[tab.v].length ? h("div", { class: "fd-people" }, lists[tab.v]) : h("p", { class: "muted", text: empty[tab.v] })));
    };
    try { draw(await api("/api/social/people")); } catch (e) { box.className = ""; box.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
  }

  /** The follow button, counts, library comparison and block on someone's public page. */
  function pfSocial(p, social) {
    const wrap = h("div", { class: "pf-social" });
    const counts = h("span", { class: "muted small" });
    const paintCounts = () => { counts.textContent = `${social.followers} ${social.followers === 1 ? "follower" : "followers"} · ${social.following} following`; };
    paintCounts();
    wrap.append(counts);
    if (social.canFollow) {
      const f = h("button", { class: "btn small", type: "button" });
      const paint = () => { f.className = "btn small " + (social.iFollow ? "gray" : "blue"); f.textContent = social.iFollow ? "Following" : "Follow"; };
      paint();
      f.addEventListener("click", () => busy(f, async () => { const r = await api("/api/social/follow", { slug: p.slug, on: !social.iFollow }); social.iFollow = r.following; social.followers = r.followers; paint(); paintCounts(); }));
      const cmp = h("button", { class: "btn gray small", type: "button", text: "Compare libraries" });
      const out = h("div", { class: "pf-compare", hidden: true });
      cmp.addEventListener("click", () => busy(cmp, async () => {
        if (!out.hidden) { out.hidden = true; return; }
        try {
          const r = await api("/api/social/compare?slug=" + encodeURIComponent(p.slug));
          const col = (title, games, empty) => h("div", { class: "pf-cmp-col" }, h("h4", { text: `${title} (${games.length})` }), games.length ? h("ul", {}, games.slice(0, 40).map(g => h("li", { text: g }))) : h("p", { class: "muted small", text: empty }));
          out.replaceChildren(h("p", { class: "muted small", text: `You own ${r.yours} games and ${r.them.name} owns ${r.theirs}.` }),
            h("div", { class: "pf-cmp" }, col("You both own", r.shared, "No overlap yet."), col(`${r.them.name} has, you don't`, r.theyHave, "You have everything they do."), col("You have, they don't", r.youHave, "They have everything you do.")));
          out.hidden = false;
        } catch (e) { toast(e.message, "warn"); }
      }));
      wrap.append(f, cmp);
      const blk = h("button", { class: "fd-link", type: "button", text: "Block" });
      blk.addEventListener("click", () => busy(blk, async () => { if (!confirm(`Block ${p.name}? You won't see each other's posts.`)) return; await api("/api/social/block", { slug: p.slug }); social.iFollow = false; toast("Blocked. You can undo it under People.", "ok"); navigate("/people"); }));
      wrap.append(blk, out);
    } else if (!social.me && !state.me) wrap.append(h("a", { class: "btn blue small", href: "/auth/login", text: "Sign in to follow" }));
    return wrap;
  }

  /** Latest posts on a profile page. */
  /** The guestbook on a profile page: short notes from signed-in visitors. The page's owner can delete any note. */
  function pfGuestbook(p, s) {
    const box = h("div", { class: "pf-gb" }), list = h("div", { class: "pf-gb-list" }), foot = h("div", { class: "pf-gb-foot" });
    let before = null;
    const entry = e => {
      const who = e.by.slug ? h("a", { href: "/u/" + e.by.slug, text: e.by.name }) : h("span", { text: e.by.name });
      const del = e.canDelete ? h("button", { class: "linklike", type: "button", text: "Delete", onclick: () => busy(del, async () => { await api("/api/guestbook/delete", { id: e.id }); row.remove(); }) }) : null;
      const row = h("div", { class: "pf-gb-note" }, h("p", { text: e.body }), h("div", { class: "muted small" }, who, " · ", feedAgo(e.at), del ? " · " : "", del));
      return row;
    };
    let meta = null;
    async function load(more = false) {
      const q = new URLSearchParams({ slug: p.slug }); if (more && before) q.set("before", String(before));
      const r = await api("/api/public/guestbook?" + q);
      if (!more) { list.replaceChildren(); meta = r; }
      if (!r.items.length && !more) list.append(h("p", { class: "muted", text: r.open ? "Nobody has signed yet. Be the first." : "This guestbook is closed." }));
      for (const e of r.items) { list.append(entry(e)); before = e.id; }
      foot.replaceChildren(r.more ? h("button", { class: "btn gray small", type: "button", text: "Show older notes", onclick: e => busy(e.currentTarget, () => load(true)) }) : null);
      if (!more) composer(r);
    }
    const form = h("div", { class: "pf-gb-form" });
    function composer(r) {
      if (p.owner) {
        const open = h("input", { type: "checkbox", checked: r.open });
        open.addEventListener("change", () => api("/api/social/prefs", { guestbook: open.checked }).then(() => toast(open.checked ? "Your guestbook is open." : "Your guestbook is closed. Nobody can add notes.", "ok")).catch(e => { open.checked = !open.checked; toast(e.message, "warn"); }));
        form.replaceChildren(h("label", { class: "fd-check" }, open, h("span", { text: "Let visitors sign my guestbook" })));
        return;
      }
      if (!r.open) { form.replaceChildren(); return; }
      if (!r.signedIn) { form.replaceChildren(h("p", { class: "muted small" }, h("a", { href: "/auth/login", text: "Sign in with Discord" }), " to leave a note.")); return; }
      const ta = h("textarea", { rows: "2", maxlength: "280", placeholder: "Leave a note (no links)", "aria-label": "Leave a note" });
      const go = h("button", { class: "btn blue small", type: "button", text: "Sign guestbook", onclick: () => busy(go, async () => {
        await api("/api/guestbook/post", { slug: p.slug, body: ta.value }); ta.value = ""; toast("Signed.", "ok"); await load();
      }) });
      form.replaceChildren(ta, go);
    }
    box.append(form, list, foot);
    load().catch(e => list.replaceChildren(h("p", { class: "muted", text: e.message })));
    return box;
  }

  function pfPosts(s) {
    if (!s.items.length) return h("p", { class: "muted", text: "No posts yet. Write one in the Feed." });
    return h("div", { class: "pf-posts" }, s.items.map(x => h("div", { class: "pf-post" }, h("p", { text: x.body }),
      h("div", { class: "muted small" }, feedAgo(x.at), x.game ? " · " + x.game : "", Object.entries(x.reactions || {}).map(([e, n]) => ` · ${e} ${n}`).join(""), x.replies ? ` · ${x.replies} ${x.replies === 1 ? "reply" : "replies"}` : ""))));
  }

  const indieView = () => window.IndieUI.view({ h, api, app, state, navigate, pageHead, toast, busy });
  const fortniteView = () => window.FortniteUI.view({ h, api, app, state, navigate, pageHead, toast, busy });
  const devPanelView = () => window.DevPanel.view({ h, api, app, state, navigate, pageHead, toast, busy });
  const VIEWS = { fortnite: fortniteView, devpanel: devPanelView, indie: indieView, feed: feedView, communities: communitiesView, discover: discoverView, people: peopleView, bundles: bundlesView, streamer: streamerHubView, streams: streamsView, streamers: streamersView, music: musicView, promos: codesView, codes: codesView, mod: modView, xp: xpView, community: communityView, gamenight: gameNightView, lfg: lfgView, setup: setupView, notifications: notificationsView, changelog: changelogView, support: supportView, tip: tipView, overlays: overlaysView, requests: requestsView, value: valueView, wishlist: wishlistView, library: libraryView, redeem: redeemView, compare: compareView, calendar: calendarView, friends: friendsView, steam: steamView, foryou: forYouView, deals: dealsView, free: freeView, playtests: playtestsView, nowplaying: nowPlayingView, club: clubView, santa: santaView, trivia: triviaView, warroom: warRoomView, alerts: alertsView, servers: serversView, giveaways: giveawaysView, mydata: myDataView, help: helpView, about: aboutView, status: statusView, home: landing, mypage: myPageView, profile: profileEditorView, admin: adminRedirect };

  /** Hands the whole page to the LucadoOS desktop: one icon for each section, and every page opens in its own window. */
  function osMount() {
    const ICONS = { home: "🏠", library: "📚", feed: "💬", deals: "💸", indie: "🎮", free: "🎁", fortnite: "🪂", social: "🤝", servers: "🛡️", streamer: "📺", account: "👤", help: "🛟" };
    const pages = { "/": { title: state.me ? "Value Checker" : "Home", icon: state.me ? "📚" : "🏠", sub: "" }, "/home": { title: "Home", icon: "🏠", sub: "" } }, nav = [];
    for (const g of NAV) {
      if (g.id === "admin") continue;
      const list = g.pages.filter(([id]) => id === "home" || pageVisible(id)).map(([id, text]) => ({ path: id === "home" ? (state.me ? "/home" : "/") : "/" + id, title: text, icon: ICONS[g.id] || "📄" }));
      for (const p of list) if (p.path !== "/") pages[p.path] = { title: p.title, icon: p.icon, sub: g.label };
      if (list.length) nav.push({ label: g.label, icon: ICONS[g.id] || "📄", pages: list, badge: state.me && g.id === "account" ? Number(state.me.unread) || 0 : 0 });
    }
    const want = location.pathname + location.search.replace(/[?&]os=\d\b/, "");
    window.LucadoOS.begin({ pages, nav, open: want, home: "/home", mountPage: env => window.SVC_SITE({ ...env, state }), loginUrl: "/auth/login", adminUrl: state.me?.adminUrl || null, logout: async () => { try { await api("/auth/logout", {}); } catch { /* signed out anyway */ } location.href = "/"; }, user: state.me ? { name: state.me.user.username, avatar: state.me.user.avatar || null } : null });
  }

  function route() {
    if (!state.cfg) return; // still starting; boot() calls route() once the settings are in
    if (!ADMIN_MODE && !EMBED && window.LucadoOS?.wanted()) { osMount(); return; }
    if (state.restricted || new URLSearchParams(LOC.search).get("error") === "restricted") { state.restricted ||= "Your access to Steam Value Checker has been restricted by the bot owner. You can no longer use the bot or this dashboard. If you think this is a mistake, contact the bot owner."; return showRestricted(); }
    if (!ADMIN_MODE && !NATIVE) { const old = /^#\/(.*)$/.exec(location.hash); if (old) history.replaceState(null, "", "/" + old[1]); }
    if (!NATIVE) renderChrome(); else drawHubbar(currentView());
    const view = currentView();
    if (NATIVE) app.dataset.area = view === "streamer" || view === "streams" || view === "streamers" ? "streamer" : view === "indie" || view === "devpanel" ? "indie" : ""; // each window wears its own area colors
    if (!NATIVE) { // the desktop itself decides the colors and waves around its windows
    // The Streamers pages wear the colors of the big streaming sites (Twitch purple, YouTube red, Kick green).
    if (view === "streamer" || view === "streams" || view === "streamers") document.documentElement.dataset.area = "streamer"; else if (view === "indie") document.documentElement.dataset.area = "indie"; else delete document.documentElement.dataset.area;
    // In a LucadoOS window the page draws its own waves (the desktop's sit behind the window), unless Personalize turned them off.
    const wavesOn = () => { if (!EMBED) return true; if (window.__losOn === false) return false; try { return JSON.parse(localStorage.getItem("lucado-site-prefs") || "{}").waves !== false; } catch { return true; } };
    if (window.IndieWaves) { if (view === "u" || !wavesOn()) window.IndieWaves.stop(); else window.IndieWaves.start(); }
    if (EMBED && !window.__wavesWatch) {
      window.__wavesWatch = true;
      const apply = () => { if (window.IndieWaves && currentView() !== "u") wavesOn() ? window.IndieWaves.start() : window.IndieWaves.stop(); };
      window.addEventListener("storage", e => { if (e.key === "lucado-site-prefs") apply(); });
      window.addEventListener("message", e => { if (e.source === window.parent && e.origin === location.origin && e.data && e.data.svc === "los-active") { window.__losOn = Boolean(e.data.on); apply(); } }); // the desktop says when this window is hidden behind another
    }
    }
    if (!state.me && view !== "help" && view !== "about" && view !== "home" && view !== "status" && view !== "tip" && view !== "u" && view !== "feed" && view !== "discover" && view !== "communities" && view !== "indie" && view !== "fortnite") return landing();
    if (view === "u" && currentParam()) { publicProfileView(currentParam()); scrollTop0(); return; }
    if (view === "g" && state.me && currentParam()) { gameView(currentParam()); scrollTop0(); return; }
    if (view === "servers" && state.me && currentParam()) { serverDetail(currentParam()); scrollTop0(); return; }
    (VIEWS[view] || (state.me ? valueView : landing))();
    const nb = newsBanner();
    if (nb && view !== "home") app.prepend(nb);
    const sn = state.cfg && state.cfg.notice && state.cfg.notice.text ? h("div", { class: "notice site-notice" + (state.cfg.notice.level === "warn" ? " warn" : ""), role: "status", text: state.cfg.notice.text }) : null;
    if (sn) app.prepend(sn);
    const db = discordBanner();
    if (db && view !== "home") app.prepend(db);
    scrollTop0();
  }

  async function boot() {
    if (NATIVE) { route(); return; } // the desktop already loaded the settings and the account
    try {
      const shared = EMBED ? (() => { try { return window.parent.__svcState || null; } catch { return null; } })() : null; // a window reuses what the desktop already loaded
      if (shared && shared.cfg && !shared.restricted) { state.cfg = shared.cfg; state.about = shared.about; state.creator = shared.creator; state.freeNow = shared.freeNow ?? null; state.me = shared.me; }
      else { if (!state.cfg) state.cfg = await api("/api/config");
      try { const x = await api("/api/about"); state.about = x.about; state.creator = x.creator; state.freeNow = x.freeNow ?? null; } catch { state.about = null; state.creator = null; }
      try { state.me = await api("/api/me"); if (state.me?.adminOnly) state.me = null; } catch { state.me = null; } } // a password sign-in opens the admin panel only
      // No choice made in this browser yet: follow the language already set for the bot on this account.
      const mine = state.me?.settings?.lang;
      if (!I18N.hasChoice() && mine && mine !== "en" && I18N.valid(mine)) { LANG = mine; I18N.remember(mine); document.documentElement.lang = mine; }
    } catch (e) {
      app.replaceChildren(h("div", { class: "notice warn", text: e.message }));
      return;
    }
    route();
    osIntro();
    if (state.me && state.me.tour && !EMBED && !window.LucadoOS?.active()) setTimeout(() => { if (state.me && state.me.tour && !document.getElementById("tour")) startTour(); }, 700);
  }

  /** One small card, once, for someone's very first visit, so they know the desktop theme exists. */
  function osIntro() {
    if (!FIRST_VISIT || EMBED || ADMIN_MODE || !window.LucadoOS?.canUse() || window.LucadoOS.active()) return;
    try { localStorage.setItem("svc_os_intro", "1"); } catch { return; }
    const close = () => card.remove();
    const card = h("div", { class: "os-intro", role: "dialog", "aria-label": "Desktop theme" },
      h("button", { type: "button", class: "os-intro-x", "aria-label": "Close", text: "×", onclick: close }),
      h("b", { text: "🖥️ There's a desktop theme" }),
      h("p", { text: "LucadoOS turns the site into a desktop with windows you can move and snap. Want to see it? Switching back takes one click." }),
      h("div", { class: "os-intro-btns" }, h("button", { type: "button", class: "btn blue small", text: "Try it", onclick: () => window.LucadoOS.setMode("os") }), h("button", { type: "button", class: "btn gray small", text: "Not now", onclick: close })));
    setTimeout(() => { if (!document.getElementById("wiz")) document.body.append(card); }, 3500);
  }

  // Visitor counter: totals only. A browser counts as new once (remembered here), no cookies and no addresses stored.
  // "Viewing now" uses a random id kept for this tab only; the server forgets it 75 seconds after the last ping.
  (function visitCounter() {
    const out = document.getElementById("visits");
    if (!out || EMBED) return; // a desktop window's footer is hidden, and the desktop already counts the visit
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
        typeof d.online === "number" ? tx(`${n(Math.max(1, d.online))} viewing now · `) : null,
        tx(`${n(d.visitors)} visitors · ${n(d.views)} page views`));
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

  if (ADMIN_MODE) { window.addEventListener("hashchange", adminRoute); adminBoot(); }
  else if (NATIVE) {
    // A window's own links: pages open inside the window, other sites in a new tab, and sign-in takes over the tab.
    const tidyN = el => el.querySelectorAll?.('a[href^="#/"]').forEach(a => { a.dataset.spa = "1"; a.setAttribute("href", a.getAttribute("href").slice(1)); });
    new MutationObserver(ms => { for (const m of ms) m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.matches('a[href^="#/"]')) { n.dataset.spa = "1"; n.setAttribute("href", n.getAttribute("href").slice(1)); } tidyN(n); } }); }).observe(app, { childList: true, subtree: true });
    nativeLinkClick = e => {
      if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest?.("a[href]"); if (!a || a.target || a.hasAttribute("download")) return;
      const href = a.getAttribute("href") || "";
      if (/^https?:\/\//i.test(href)) { try { if (new URL(href).origin !== location.origin) { a.target = "_blank"; a.rel = "noopener noreferrer"; } } catch { /* leave it */ } return; }
      const path = href.startsWith("#/") ? href.slice(1) : href;
      if (path.startsWith("/") && !path.startsWith("//") && !/^\/(auth|api|admin)(\/|\?|$)/.test(path) && !/\.[a-z0-9]{2,5}$/i.test(path.split("?")[0])) { e.preventDefault(); navigate(path); }
    };
    app.addEventListener("click", nativeLinkClick);
    boot();
    return { navigate, route, path: () => LOC.pathname + LOC.search };
  } else {
    window.addEventListener("hashchange", route);
    window.addEventListener("popstate", () => window.dispatchEvent(new Event("hashchange")));
    // Links written as #/page show and copy as plain addresses, and open without reloading the page.
    const tidy = root => root.querySelectorAll?.('a[href^="#/"]').forEach(a => { a.dataset.spa = "1"; a.setAttribute("href", a.getAttribute("href").slice(1)); });
    new MutationObserver(ms => { for (const m of ms) m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.matches('a[href^="#/"]')) tidy({ querySelectorAll: () => [n] }); tidy(n); } }); }).observe(document.body, { childList: true, subtree: true });
    tidy(document);
    // Inside a LucadoOS window, sign-in pages can't load in a frame, so they take over the whole tab, and other sites open in a new one.
    if (EMBED) document.addEventListener("click", e => {
      const a = e.target.closest?.("a[href]"); if (!a || a.target) return;
      const href = a.getAttribute("href") || "";
      if (/^\/auth\//.test(href)) a.target = "_top"; else if (/^https?:\/\//i.test(href)) { try { if (new URL(href).origin !== location.origin) { a.target = "_blank"; a.rel = "noopener noreferrer"; } } catch { /* leave it */ } }
    }, true);
    document.addEventListener("click", e => {
      if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest?.("a[data-spa], a[href^=\"#/\"]");
      if (!a || a.target) return;
      e.preventDefault(); navigate(a.dataset.spa ? a.getAttribute("href") : a.getAttribute("href").slice(1));
    });
    boot();
  }
};
window.SVC_SITE(); // the normal page starts its own copy; every LucadoOS window then starts one more of its own

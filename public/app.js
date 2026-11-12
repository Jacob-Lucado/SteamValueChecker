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
  // Screen readers: after the page draws, give unlabeled fields a name from the text next to them, keep heading levels from skipping, and name picture-only links.
  const a11yPass = () => {
    try {
      const text = e => (e?.textContent ?? "").replace(/\s+/g, " ").trim();
      for (const f of app.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea")) {
        if (f.getAttribute("aria-label") || f.getAttribute("aria-labelledby") || f.title || f.closest("label") || (f.id && app.querySelector(`label[for="${CSS.escape(f.id)}"]`))) continue;
        let name = "";
        for (let node = f, hops = 0; node && node !== app && hops < 4 && !name; node = node.parentElement, hops++) {
          for (let sib = node.previousElementSibling; sib && !name; sib = sib.previousElementSibling) { const t = text(sib); if (t && t.length <= 90 && !sib.querySelector("input,select,textarea,button")) name = t; else if (sib.matches("h2,h3,h4,.k,strong,b,label")) name = t.slice(0, 90); if (name) break; }
        }
        f.setAttribute("aria-label", name || f.placeholder || f.name || (f.type === "number" ? "Number" : f.tagName === "SELECT" ? "Choose an option" : "Text"));
      }
      let prev = 0;
      for (const hd of app.querySelectorAll("h1,h2,h3,h4,h5")) { let lv = Number(hd.tagName[1]); if (prev && lv - prev > 1) { lv = prev + 1; hd.setAttribute("aria-level", String(lv)); } else hd.removeAttribute("aria-level"); prev = lv; }
      for (const a of app.querySelectorAll("a[href]")) {
        if (text(a) || a.getAttribute("aria-label") || a.title) continue;
        const img = a.querySelector("img[alt]:not([alt=''])");
        if (img) continue;
        const near = text(a.closest("article,li,.card,[class*=card]")?.querySelector("h2,h3,h4,strong,b")) || "";
        a.setAttribute("aria-label", near || "Open");
      }
    } catch { /* never let a helper break the page */ }
  };
  { let t = null; new MutationObserver(() => { clearTimeout(t); t = setTimeout(a11yPass, 150); }).observe(app, { childList: true, subtree: true }); }
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
  /** Prizes whose winner hasn't pressed Claim yet. Shown in the dashboard and in the admin panel, each with a Remind now button. */
  function pendingPanel(pending, remind, reload) {
    const rows = Array.isArray(pending) ? pending : [];
    const words = ms => { const hrs = ms / 3600_000; return hrs < 1 ? "under an hour" : hrs < 48 ? `${Math.round(hrs)} h` : `${Math.round(hrs / 24)} days`; };
    const panel = h("div", { class: "panel" }, h("h3", { text: "Waiting to be claimed" }));
    if (!rows.length) { panel.append(h("p", { class: "muted small", text: "Nobody is sitting on an unclaimed prize right now. Winners get a DM when they're drawn, a reminder halfway and a last call near the end, and you get a message if one runs out." })); return panel; }
    panel.append(h("p", { class: "muted small", text: "Winners who haven't pressed Claim prize. They're reminded halfway and near the end, and the prize is redrawn if time runs out. You can nudge anyone now." }));
    panel.append(h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Prize", "Giveaway", "Winner", "Reached", "Time left", "Reminders", ""].map(c => h("th", { text: c })))),
      h("tbody", {}, rows.map(r => {
        const b = h("button", { class: "btn gray small", type: "button", text: "Remind now" });
        b.addEventListener("click", () => busy(b, async () => { await remind(r.key_id); toast("Reminder sent.", "ok"); if (reload) await reload(); }));
        return h("tr", {}, h("td", {}, h("b", { text: r.prize })), h("td", { text: `#${r.giveaway_id} ${r.title}${r.server ? " · " + r.server : ""}` }),
          h("td", { text: r.winner ? `${r.winner} (${r.winner_id})` : r.winner_id }), h("td", { class: r.reached === "none" ? "warn-text" : "", text: ({ dm: "By DM", channel: "In a channel (DMs closed)", none: "Couldn't reach them" })[r.reached] || "Not sent yet" }), h("td", { class: r.left_ms < 6 * 3600_000 ? "warn-text" : "", text: words(r.left_ms) }),
          h("td", { text: r.reminders ? String(r.reminders) : "none yet" }), h("td", {}, b));
      })))));
    return panel;
  }

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
    { id: "deals", label: "Deals", pages: [["wishlist", "Wishlist"], ["foryou", "For you"], ["deals", "Check a deal"], ["warroom", "Sale planner"], ["free", "Free games"], ["bundles", "Bundles"], ["playtests", "Playtests"], ["codes", "Codes & promos"]] },
    { id: "feed", label: "Social", pages: [["feed", "Feed"], ["people", "People"], ["friends", "Friends"], ["compare", "Compare"], ["communities", "Communities"], ["discover", "Discover"]] },
    { id: "social", label: "Play together", pages: [["gamenight", "Game night"], ["nowplaying", "Now playing"], ["club", "Game club"], ["trivia", "Trivia"], ["lfg", "Looking for group"], ["calendar", "Calendar"], ["fortnite", "Fortnite"]] },
    { id: "servers", label: "Servers", pages: [["servers", "My servers"], ["setup", "Setup"], ["community", "Community"], ["santa", "Secret Santa"], ["xp", "Server XP"], ["mod", "Moderation"], ["giveaways", "Giveaways"], ["music", "Music"]] },
    { id: "indie", label: "Creators", pages: [["indie", "Indie showcase & tools"], ["devpanel", "Dev panel"], ["streamer", "Streamer hub"], ["overlays", "Overlay studio"], ["streams", "Go live"], ["streamers", "Who is live"]] },
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
    // On a narrow screen this row scrolls sideways, so bring the page you're on into view.
    const cur = bar.querySelector(".hubtab.active");
    if (cur && bar.scrollWidth > bar.clientWidth) bar.scrollLeft = Math.max(0, cur.offsetLeft - (bar.clientWidth - cur.offsetWidth) / 2);
  }

  // The browser tab names the page you're on. Pages that set their own title (a profile, an indie game) do it after this runs.
  const BASE_TITLE = document.title;
  let pageLabel = null;
  function setPageTitle(view) {
    const label = pageLabel = view === "home" ? null : NAV.flatMap(g => g.pages).find(([id]) => id === view)?.[1] ?? (HUB_ALIAS[view] ? "Game" : null);
    const count = /^\(\d+\) /.exec(document.title)?.[0] ?? "";
    document.title = count + (label ? `${label} · Steam Value Checker` : BASE_TITLE.replace(/^\(\d+\) /, ""));
  }

  // Tabs inside a page (Setup sections, Library categories) add their name to the tab title too.
  if (!ADMIN_MODE && !EMBED) app.addEventListener("click", e => {
    if (!e.target.closest(".tabs .tab")) return;
    setTimeout(() => {
      const on = app.querySelector(".tabs .tab.active"); if (!on) return;
      const label = on.textContent.replace(/\s*\(\d+\)\s*$/, "").trim(), count = /^\(\d+\) /.exec(document.title)?.[0] ?? "";
      if (label && pageLabel) document.title = `${count}${label} · ${pageLabel} · Steam Value Checker`;
    }, 0);
  });

  function renderChrome() {
    const view = currentView();
    if (!ADMIN_MODE && !EMBED) setPageTitle(view);
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
    const acct = document.getElementById("account");
    const support = state.cfg && state.cfg.supportUrl ? ext(state.cfg.supportUrl, "Support server", "btn gray small support-btn") : null;
    const links = state.me ? [] : [h("a", { href: "/ai", text: "AI companion" }), state.cfg && ext(state.cfg.fanaticalUrl, "FanaticalGrabber ↗")].filter(Boolean); // signed in: it lives in the Help menu
    if (state.me) {
      acct.replaceChildren(...[...links, support,
        h("button", { class: "theme-btn", type: "button", text: "🔍", title: "Search (press /)", "aria-label": "Search", onclick: openSearch }),
        osButton(), currencyPicker(), languagePicker(), displayMenu(),
        // The signed-in name and Log out always sit together, set slightly apart from the tools.
        h("div", { class: "user-chip" },
          state.me.user.avatar && h("img", { class: "avatar", src: state.me.user.avatar, alt: "" }),
          h("span", { class: "who", text: state.me.user.username }),
          h("button", { class: "btn gray small", text: "Log out", onclick: async () => { try { await api("/auth/logout", {}); } catch {} state.me = null; if (EMBED_FRAME) { window.parent.location.reload(); return; } if (NATIVE) { location.reload(); return; } navigate("/"); boot(); } }))].filter(Boolean));
    } else {
      acct.replaceChildren(...[...links, support, osButton(), languagePicker(), themeButton(), steamLoginBtn("Steam", "btn steam small"), h("a", { class: "btn green", href: "/auth/login", text: "Sign in with Discord" })].filter(Boolean));
    }
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

  function landing() { return window.LandingUI.view({ LOC, api, app, ext, fanaticalCard, h, newsBanner, osPreview, setupCard, state, steamLoginBtn }); }

  // ---------- for you: discounts ranked by your taste and wishlist ----------
  async function forYouView() { return window.ForYouUI.view({ api, app, h, money, pageHead, select, steamArt }); }

  // ---------- value checker ----------
  function valueView() { return window.ValueUI.view({ api, app, busy, fanaticalCard, field, h, pageHead, renderValue, select, state, voteCard }); }

  function renderValue(into, d) { return window.RenderValueUI.view({ api, busy, h, money, state, toast }, into, d); }

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

  async function wishlistView() { return window.WishlistUI.view({ api, app, busy, field, h, pageHead, ruleControl, select, state, steamLoginBtn, toast, wishCard }); }

  function wishCard(r, cur, reload, onPick, isPicked) { return window.WishCardUI.view({ api, busy, h, lineChart, money, ruleControl, select, state, steamArt, toast, verdictBadge }, r, cur, reload, onPick, isPicked); }

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

  function alertsView() { return window.AlertsUI.view({ PLAYTEST_SOURCES, api, app, busy, field, h, muteToggles, pageHead, samplePanel, select, state, toast }); }

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
  function pfSong(song, preview = false) { return window.ProfileSongUI.view({ ext, h }, song, preview = false); }

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

  function renderProfile(p, { canMark = false, preview = false, signedIn = false, region = null, social = null } = {}) { return window.ProfileRenderUI.view({ PF_TITLE, PF_VIS, ext, giftButton, h, httpsOnly, money, pageBgEl, pfArt, pfGuestbook, pfPosts, pfReport, pfSocial, pfSong, pfTile, soonControl, wishSlider }, p, { canMark = false, preview = false, signedIn = false, region = null, social = null } = {}); }

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

  async function publicProfileView(slug) { return window.PublicProfileUI.view({ api, app, h, renderProfile }, slug); }

  /** The editor: every choice on the left, the real page on the right, updated as you go. */
  async function profileEditorView() { return window.ProfileEditorUI.view({ PAGE_PRESET_CSS, PF_TITLE, PF_VIS, api, app, busy, field, h, pageHead, publicPagePanel, renderProfile, route, select, toast }); }

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
  async function gameView(id) { return window.GameUI.view({ api, app, busy, ext, h, lineChart, money, pageHead, steamArt, toast }, id); }

  async function publicWishlistView(slug) { return window.PublicWishlistUI.view({ api, app, ext, giftButton, h, pageHead, soonControl }, slug); }

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
  async function freeView() { return window.FreeUI.view({ api, app, h, loadFree, pageHead, soonPanel, state, toast }); }


  // ---------- playtests ----------
  // Playtests, betas, demos and free weekends. The list asks the server again every few minutes by itself, flags what is new
  // since the page opened, and pauses while the tab is hidden.
  const PLAYTEST_POLL_MS = 5 * 60_000;
  const PLAYTEST_SOURCES = [["abg", "Alpha Beta Gamer"], ["gamerpower", "GamerPower"], ["itch", "itch.io"], ["playtester", "Playtester"], ["steamdemo", "Steam demos"]];
  async function playtestsView() { return window.PlaytestsUI.view({ PLAYTEST_POLL_MS, api, app, currentView, ext, h, pageHead, state, toast }); }

  /** The server's game of the month: the pick, who is playing or finished, and (for managers) the controls. */
  async function clubView() { return window.ClubUI.view({ api, app, busy, ext, field, h, pageHead, select, serverPicker, state, toast }); }

  // Secret Santa for a server: sign up, draw, and see who you're buying for.
  async function santaView() { return window.SantaUI.view({ api, app, busy, field, h, pageHead, select, serverPicker, state, toast }); }

  async function triviaView() { return window.TriviaUI.view({ api, app, busy, field, h, pageHead, select, serverPicker, state, toast }); }

  const NOWPLAYING_POLL_MS = 60_000;
  /** Who in a server is in a game right now. Reads Steam through the bot, so it stays current without a refresh. */
  async function nowPlayingView() { return window.NowPlayingUI.view({ NOWPLAYING_POLL_MS, api, app, busy, currentView, ext, field, h, pageHead, serverPicker, state, toast }); }

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
  async function bundlesView() { return window.BundlesUI.view({ api, app, busy, h, pageHead, state, toast }); }

  async function codesView() { return window.CodesUI.view({ api, app, busy, ext, h, pageHead, promoBlock, state, toast }); }

  // ---------- servers ----------
  const guildInvite = g => (state.cfg.inviteUrl ? `${state.cfg.inviteUrl}&guild_id=${encodeURIComponent(g.id)}&disable_guild_select=true` : null);
  const serverIcon = (g, cls) => (g.icon ? h("img", { class: cls, src: g.icon, alt: "" }) : h("div", { class: cls + " noicon", text: (g.name || "?").trim().charAt(0).toUpperCase() }));
  const botBadge = g => (g.bot === null || g.bot === undefined ? null : h("span", { class: "chip " + (g.bot ? "ok" : "warn"), text: g.bot ? "Bot installed" : "Bot not added" }));

  function serversView() { return window.ServersUI.view({ app, botBadge, ext, guildInvite, h, navigate, pageHead, serverIcon, state }); }

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

  function serverDetail(id) { return window.ServerDetailUI.view({ api, app, board, botBadge, busy, ext, field, guildInvite, h, navigate, select, serverIcon, sharedList, state, statsPanel, toast }, id); }

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
  async function dealsView() { return window.DealsUI.view({ api, app, busy, ext, field, h, money, pageHead }); }

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

  async function steamView() { return window.SteamUI.view({ LOC, analyticsPanel, api, app, busy, field, h, hoursText, money, pageHead, recapPanel, replaceUrl, state, steamArt, steamLoginBtn, steamProfileCard, toast, twitchLinkPanel }); }

  // ---------- batch redeem ----------
  // Steam only takes keys from the owner's logged-in browser, so the FanaticalGrabber extension does the redeeming.
  // Keys travel page -> extension -> Steam in this browser. They are never sent to the dashboard's server.
  function redeemView() { return window.RedeemUI.view({ api, app, busy, extSend, field, fromExt, h, money, pageHead, safeHref, state, toast }); }

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

  // The page the extension's "Link now" button opens. One job: get the extension linked, with nothing else on the page.
  function connectView() { return window.ConnectUI.view({ api, app, extSend, fromExt, h, pageHead, state, steamLoginBtn }); }

  async function libraryView() { return window.LibraryUI.view({ api, app, badgesPanel, bundlesPanel, busy, challengePanel, extSend, field, fromExt, h, hoursText, lineChart, money, pageHead, select, spendPanel, state, steamArt, toast }); }

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

  async function giveawaysView() { return window.GiveawaysUI.view({ api, app, busy, field, giveawayPreview, h, pageHead, pendingPanel, prizeButtons, roleMulti, select, serverPicker, state, stepsEditor, toast }); }

  // ---------- my data ----------
  function myDataView() { return window.MyDataUI.view({ api, app, boot, busy, field, h, pageHead, state, toast }); }

  // ---------- help ----------
  // The About page: the same numbers as the /bot about command in Discord.
  async function statusView() { return window.StatusUI.view({ api, app, busy, currentView, h }); }

  async function aboutView() { return window.AboutUI.view({ api, app, ext, h, md, safeHref, state }); }

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

  function helpView() { return window.HelpUI.view({ app, commandGuidePanel, ext, fanaticalCard, h, md, pageHead, state }); }

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

  async function requestsView() { return window.RequestsUI.view({ app, h, pageHead, requestList }); }

  // The same words as the Support page on the shop site.
  async function tipView() { return window.TipUI.view({ api, app, busy, ext, h, pageHead, routeText, select, state, toast }); }

  // Goal bars, server stats and timers for OBS, each with its own link and look, and a live preview that follows every change.
  const overlaysView = () => window.OverlayStudio.view({ h, api, app, state, pageHead, toast, busy, select, field, serverPicker, currentParam, currentView, overlayAssets, giveawayOverlayPanel, streamCardPanel });

  async function supportView() { return window.SupportUI.view({ STATUS_ICON, api, app, busy, currentParam, field, h, navigate, pageHead, select, state, ticketSettingsPanel, ticketThread, toast }); }

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

  async function notificationsView() { return window.NotificationsUI.view({ PRIZE_STATUS, api, app, ext, h, noteCard, pageHead, renderChrome, state }); }

  // ---------- music ----------
  async function musicView() { return window.MusicUI.view({ api, app, busy, currentView, field, h, pageHead, select, state, toast }); }

  async function changelogView() { return window.ChangelogUI.view({ api, app, h, inline, pageHead, renderChrome, state }); }

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
  async function gameNightView() { return window.GameNightUI.view({ api, app, busy, field, h, pageHead, serverPicker, state, toast }); }

  // ---------- compare with a friend ----------
  async function compareView() { return window.CompareUI.view({ api, app, busy, field, h, pageHead, serverPicker, state }); }

  // ---------- calendar ----------
  // Built in: wishlist release dates, Steam sales, server events and group games. Managers add server events here.
  // The private feed link (for Google, Apple or Outlook calendar) is optional.
  // Sale war room: your buy-now list with a budget slider. Ticked games are the cart; the slider auto-fills the best savings first.
  async function warRoomView() { return window.WarRoomUI.view({ api, app, busy, currentView, field, h, money, pageHead, select }); }

  // My page: every feature as a card with its status, a switch where one is simple, and a link to set it up. Cards can be pinned, hidden and reordered (kept on this device).
  // First-run guide: a centered dialog with a detailed tour of the dashboard, then a short setup. The tour can be skipped (after a
  // confirmation); setup always follows. Shown once per account, and "Take the tour" on My page replays it.
  const WIZ_KEY = "svc.wizard";
  const TOUR_SLIDES = [
    { nav: "Welcome", title: "Welcome to Steam Value Checker", lead: "This dashboard and the Discord bot are one account. Change something here and the bot follows, change it in Discord and it shows up here. The next few screens explain each part. Then we set up your alerts, which takes about two minutes.",
      points: [["Price alerts that fit you", "Add the games you want and get told when one is cheap enough, by your own rules."], ["Everything you own, valued", "See what your library is worth, what you paid and what you have not played yet."], ["Free games and deals", "A live list of what is free right now and which discounts suit your taste."], ["Built for servers", "Share with friends, vote on what to play and run giveaways and playtest channels."]] },
    { nav: "Finding your way", title: "Finding your way around", lead: "The menu at the top groups pages by what you are doing. Pick a group and its pages appear as tabs underneath.",
      points: [["Library and Deals", "Your games, price tools, and everything free or code-based, all under Deals."], ["Friends and Servers", "Birthdays and gifts on one side, the servers you share with the bot on the other."], ["Press / to search", "On any page with a search box, / jumps straight to it. The search button in the menu finds pages and settings."], ["My page", "Every feature as a card with its status. Switch the simple ones on there, pin the ones you use."], ["Install it", "Your browser can add this site to your home screen or desktop as an app. Look for Install in the address bar or share menu."]] },
    { nav: "Wishlist", title: "Wishlist and sale alerts", lead: "Your wishlist is the heart of the bot. Every game on it is watched, and you choose what counts as a good price.",
      points: [["Import or add", "Import your public Steam wishlist in one click, or add any game by title."], ["A rule for each game", "Alert on any sale, a percent off, a price you set, or only at an all-time low."], ["Priority and quiet", "Star the ones you care about. Snooze a game for a week or a month, or mute it until you want it back."], ["Saved views", "Name a sort and filter combination, like Sale, hide owned, and bring it back later."], ["Buy or wait", "The check card compares today with the game's history, shows its Steam review score and charts the last year."]] },
    { nav: "Alerts", title: "How alerts reach you", lead: "Alerts arrive by direct message or in a server channel. Everything is also kept on the Notifications page, so a missed message is never lost.",
      points: [["Delivery and quiet hours", "Pick DM or a channel, set the hours you never want to be pinged and your time zone. Held alerts arrive afterwards."], ["Minimum discount", "Ignore small sales by setting a floor, like 30 percent."], ["Many kinds of alert", "Sales, bundles, free games, news and patch notes, DLC sales, release dates, refund reminders, milestones, playtests and more. Each has its own switch."], ["Try before you trust", "Alert settings can send you a sample of any kind, marked as a sample, so you see exactly what it looks like."], ["Notifications page", "Filter by kind, search, and mute a kind from there."]] },
    { nav: "Library", title: "Library, Steam and your backlog", lead: "Tell the bot what you own and it can show you what it is worth and what to play next.",
      points: [["Add what you own", "Link Steam to sync it, import a list, or add games with what you paid."], ["Value and spending", "Total value against what you paid, savings, and spending by month."], ["Backlog and challenge", "Mark games Backlog, Playing, Played, Finished or Dropped. Set a monthly goal and keep a streak."], ["Hours and achievements", "With Steam linked you get hours played, a yearly recap card, playtime milestones and near-complete achievement alerts."], ["The browser extension", "FanaticalGrabber reveals Fanatical keys and fills in what you paid from Steam purchase history. That also powers refund-and-rebuy alerts."]] },
    { nav: "Deals", title: "Deals, free games and codes", lead: "When you are not waiting on a specific game, these pages find something worth buying or claiming.",
      points: [["For you", "Current discounts ranked by your taste, library and wishlist."], ["Check a deal", "Price any game by region and see which bundles include it."], ["Sale planner", "During a Steam sale, set a budget and let the best savings fill your cart. Afterwards see what your alerts caught."], ["Free games", "Everything free right now on Steam, Epic, GOG and more, with store filters and a DLC tab."], ["Codes, promos and the calendar", "Working codes for popular games, key giveaways, release dates and sale dates in one place."]] },
    { nav: "Early access", title: "Playtests, demos and news", lead: "Hear about a game before it launches, or when something changes in one you already play.",
      points: [["Playtest watcher", "Betas, demos, free weekends and sign-ups from Steam announcements, Alpha Beta Gamer, Playtester, GamerPower and itch.io. Choose wishlist games only, or every one found."], ["News and patch notes", "Announcements for the Steam games you own or wishlist. Patch notes only, or everything."], ["DLC sales", "A heads-up when add-ons for games you really play are heavily discounted."], ["Release dates", "Told when a wishlist game gets a date, or when it moves."]] },
    { nav: "Friends", title: "Friends, gifts and sharing", lead: "Games are better shared. None of this is on unless you turn it on.",
      points: [["Friends and gifts", "Save birthdays and public wishlist links, then see what is on sale for them before the day."], ["Your public page", "Share a wishlist page with a link. Friends can quietly claim a gift so nobody buys it twice, and the page uses your profile card color."], ["Profile card", "A picture of your library with the stats and colors you choose, ready to post."], ["Compare libraries", "See what you and a friend both own, with hours side by side."]] },
    { nav: "Servers", title: "Servers and Discord", lead: "Add the bot to a server and it becomes a community toolkit. The dashboard is where managers run it.",
      points: [["Community setup", "One click builds channels, roles, a welcome flow, an XP system, support tickets, music and a playtests channel."], ["Share with your server", "Opt in with Share and members can compare libraries, see who owns a game, find co-op picks and plan game night with a vote."], ["Right-click shortcuts", "Right-click a member in Discord for Compare libraries, Play together, See their wishlist and Gift ideas. Right-click a game title to price it, add it or see who owns it."], ["Commands", "Everything here also has a slash command: /games, /me, /server and /alerts. /help lists them all."]] }
  ];

  function startTour(opts) { return window.TourUI.view({ TOUR_SLIDES, WIZ_KEY, api, busy, currentView, ext, field, h, route, select, state, steamLoginBtn, toast }, opts); }

  async function myPageView() { return window.MyPageUI.view({ api, app, busy, h, pageHead, publicPagePanel, startTour, state }); }


  async function friendsView() { return window.FriendsUI.view({ api, app, busy, field, h, money, pageHead, toast }); }

  async function calendarView() { return window.CalendarUI.view({ api, app, busy, field, h, pageHead, select, toast }); }

  // ---------- looking for group ----------
  async function lfgView() { return window.LfgUI.view({ api, app, busy, ext, field, h, pageHead, select, serverPicker, state, toast }); }

  // ---------- guided server setup (same checklist as /manage setup in Discord) ----------
  /** One row per thing the bot posts, grouped, each with its own channel. Empty rows say what happens instead. */
  function channelPanel(list, channels, alertId, guildId) {
    const nameOf = id => { const c = channels.find(x => x.id === id); return c ? "#" + c.name : "a channel I can't see"; };
    const groups = [...new Set(list.map(x => x.group))];
    const rows = []; // one per channel: where it is saved now, and what the dropdown says
    const status = x => x.value ? "Posting in " + nameOf(x.value) + "." : x.fallback ? "Not set, so it uses " + x.fallback + (x.fallback === "the alert channel" ? (alertId ? " (" + nameOf(alertId) + ")" : ", which isn't set either") : "") + "." : "Not set, so it stays off.";
    const saveAll = h("button", { class: "btn blue", type: "button", text: "Save all", disabled: true });
    const hint = h("span", { class: "muted small", text: "" });
    const refreshBar = () => { const n = rows.filter(r => r.sel.value !== (r.x.value || "")).length; saveAll.disabled = !n; hint.textContent = n ? `${n} unsaved change${n === 1 ? "" : "s"}` : ""; };
    const body = groups.map(g => h("div", { class: "chmap-group" }, h("div", { class: "chmap-head", text: g }),
      ...list.filter(x => x.group === g).map(x => {
        const sel = select([["", "Not set"], ...channels.map(c => [c.id, "#" + c.name])], x.value || "");
        const mark = h("b", { text: (x.value ? "✅ " : "⬜ ") + x.label }), now = h("div", { class: "muted small", text: status(x) });
        const row = { x, sel, mark, now };
        rows.push(row);
        sel.addEventListener("change", refreshBar);
        return h("div", { class: "setup-row" }, h("div", {}, mark, h("div", { class: "muted small", text: x.help }), now), h("div", { class: "row" }, sel));
      })));
    saveAll.addEventListener("click", () => busy(saveAll, async () => {
      const changed = rows.filter(r => r.sel.value !== (r.x.value || ""));
      let failed = 0, firstErr = "";
      for (const r of changed) {
        try {
          await api("/api/servers/channelmap", { guild_id: guildId, key: r.x.key, channel_id: r.sel.value || null });
          r.x.value = r.sel.value || null; // now what is saved, so the page stays put and just updates its notes
          r.mark.textContent = (r.x.value ? "✅ " : "⬜ ") + r.x.label; r.now.textContent = status(r.x);
        } catch (e) { failed++; firstErr ||= e.message; }
      }
      refreshBar();
      if (failed) toast(`${changed.length - failed} saved, ${failed} didn't (${firstErr})`, "error");
      else toast(changed.length === 1 ? "Saved." : `Saved ${changed.length} channels.`, "ok");
    }));
    return h("div", { class: "panel" }, h("h3", { text: "Every channel the bot posts in" }),
      h("p", { class: "muted small", text: "Give each kind of post its own channel, then press Save all. Anything left empty either does nothing or uses the channel noted under it." }),
      ...body, h("div", { class: "row" }, saveAll, hint));
  }

  async function setupView() { return window.SetupUI.view({ api, app, busy, channelPanel, currentParam, ext, field, h, pageHead, progressBar, select, serverPicker, state, toast }); }

  // ---------- community: welcome, levels, invites, emoji, and the one-click server build ----------
  async function communityView() { return window.CommunityUI.view({ PLAYTEST_SOURCES, api, app, busy, currentParam, field, h, pageHead, progressBar, select, serverPicker, state, toast }); }

  // ---------- server XP: leaderboard, your card, level rewards, how XP works, and the prize shop teaser ----------
  // ---------- streams: go live, pings, and the streamer settings ----------
  /** Loads the shared stream-overlay panel (public/overlayui.js and .css) once. */
  const overlayAssets = (() => {
    let p = null;
    const load = (tag, attrs) => new Promise((res, rej) => { const e = document.createElement(tag); Object.assign(e, attrs); e.onload = res; e.onerror = rej; document.head.append(e); });
    return () => (p ??= Promise.all([window.SvcOverlayPanel ? 0 : load("script", { src: "/overlayui.js" }), document.querySelector('link[href="/overlayui.css"]') ? 0 : load("link", { rel: "stylesheet", href: "/overlayui.css" })]).catch(e => { p = null; throw e; }));
  })();

  async function streamsView(opts = {}) { return window.StreamsUI.view({ api, app, busy, currentParam, field, giveawayPreview, h, pageHead, prizeButtons, roleMulti, select, serverPicker, state, stepsEditor, toast }, opts = {}); }

  // ---------- streamer hub: everything for streamers on one page ----------
  /** The deals overlay panel: a private link for OBS that rotates the best wishlist deal, a free game and a "gift me" card. */
  function streamCardPanel() { return window.StreamCardPanelUI.view({ api, busy, field, h, select, toast }); }

  /** The giveaway overlay for OBS: shows the streamer's stream giveaway (entries, time left, how to enter, then the winners). Same private link as the deals cards. */
  function giveawayOverlayPanel() { return window.GiveawayOverlayPanelUI.view({ api, busy, field, h, select, state, toast }); }

  async function streamerHubView() { return window.StreamerHubUI.view({ app, currentParam, field, h, pageHead, publicPagePanel, serverPicker, state, streamersView, streamsView }); }

  // ---------- streamers: everyone who linked a channel in a server, and who is live ----------
  async function streamersView(opts = {}) { return window.StreamersUI.view({ api, app, currentParam, currentView, field, h, pageHead, serverPicker, state }, opts = {}); }

  async function xpView() { return window.XpUI.view({ api, app, busy, currentParam, field, h, pageHead, progressBar, select, serverPicker, state, toast }); }

  // ---------- moderation: take an action, see the case log, choose the mod log channel ----------
  async function modView() { return window.ModUI.view({ api, app, busy, currentParam, field, h, pageHead, select, serverPicker, state, toast }); }


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
  function feedCard(it, ctx) { return window.FeedCardUI.view({ api, busy, feedAgo, feedAvatar, feedBody, feedComposer, feedName, h, toast }, it, ctx); }

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

  async function feedView() { return window.FeedUI.view({ FEED_STATE, NATIVE, api, app, busy, env, feedCard, feedComposer, h, pageHead, serverCard, state, toast }); }


  /** A server's card: what it is, how active it is, a way in, and the members who have public pages. */
  function serverCard(g, people = []) {
    const join = g.invite ? ext(g.invite, "Join on Discord", "btn blue small") : h("span", { class: "muted small", text: "No public invite yet" });
    return h("div", { class: "panel fd-server" },
      h("div", { class: "fd-server-top" }, h("div", { class: "fd-av init", text: (g.name || "?").slice(0, 1).toUpperCase() }), h("div", { class: "fd-who" }, h("strong", { class: "fd-name", text: g.name }),
        h("span", { class: "muted small", text: [g.members ? `${g.members.toLocaleString()} members` : null, `${g.people} on the bot with a public page`, g.active ? `${g.active} active this week` : null].filter(Boolean).join(" · ") })), join),
      g.about ? h("p", { class: "fd-about", text: g.about }) : null,
      people.length ? h("div", { class: "fd-people fd-compact" }, people.slice(0, 8).map(p => personRow(p))) : null);
  }

  async function communitiesView() { return window.CommunitiesUI.view({ FEED_STATE, api, app, ext, h, leaderboardPanel, manageRow, navigate, pageHead }); }

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

  async function discoverView() { return window.DiscoverUI.view({ FEED_STATE, api, app, h, httpsOnly, navigate, pageHead, personRow, pfArt, state }); }

  /** A person in a list, with a follow button. */
  function personRow(p, note) {
    const btn = h("button", { class: "btn small", type: "button" });
    const paint = () => { btn.className = "btn small " + (p.following ? "gray" : "blue"); btn.textContent = p.following ? "Following" : "Follow"; };
    paint();
    btn.addEventListener("click", () => busy(btn, async () => { await api("/api/social/follow", { slug: p.slug, on: !p.following }); p.following = !p.following; paint(); }));
    return h("div", { class: "fd-person" }, feedAvatar(p), h("div", { class: "fd-who" }, feedName(p), note ? h("span", { class: "muted small", text: note }) : null), state.me ? btn : null);
  }

  async function peopleView() { return window.PeopleUI.view({ api, app, busy, h, pageHead, personRow, toast }); }

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
  const VIEWS = { fortnite: fortniteView, devpanel: devPanelView, indie: indieView, feed: feedView, communities: communitiesView, discover: discoverView, people: peopleView, bundles: bundlesView, streamer: streamerHubView, streams: streamsView, streamers: streamersView, music: musicView, promos: codesView, codes: codesView, mod: modView, xp: xpView, community: communityView, gamenight: gameNightView, lfg: lfgView, setup: setupView, notifications: notificationsView, changelog: changelogView, support: supportView, tip: tipView, overlays: overlaysView, requests: requestsView, value: valueView, wishlist: wishlistView, library: libraryView, connect: connectView, redeem: redeemView, compare: compareView, calendar: calendarView, friends: friendsView, steam: steamView, foryou: forYouView, deals: dealsView, free: freeView, playtests: playtestsView, nowplaying: nowPlayingView, club: clubView, santa: santaView, trivia: triviaView, warroom: warRoomView, alerts: alertsView, servers: serversView, giveaways: giveawaysView, mydata: myDataView, help: helpView, about: aboutView, status: statusView, home: landing, mypage: myPageView, profile: profileEditorView, admin: adminRedirect };

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
    if (state.me && !EMBED && view !== "connect") { let pend = false; try { pend = localStorage.getItem("svc_connect") === "1"; } catch { /* storage blocked */ } if (pend) { replaceUrl("/connect"); return route(); } }
    if (!view && state.me && !EMBED) { replaceUrl("/home"); return route(); } // signed in, the bare address (and the logo) lands on Home
    if (!state.me && view !== "help" && view !== "about" && view !== "home" && view !== "status" && view !== "tip" && view !== "u" && view !== "feed" && view !== "discover" && view !== "communities" && view !== "indie" && view !== "fortnite" && view !== "connect") return landing();
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
      try { state.me = await api("/api/me?soft=1"); if (state.me?.adminOnly || state.me?.signedOut) state.me = null; } catch { state.me = null; } } // a password sign-in opens the admin panel only
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

  if (ADMIN_MODE) { const admin = window.AdminUI.create({ api, app, busy, field, giveawayPreview, h, lineChart, logPanel, pendingPanel, prizeButtons, renderChrome, requestList, route, scrollTop0, select, state, themeButton, toast }); window.addEventListener("hashchange", admin.route); admin.boot(); }
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

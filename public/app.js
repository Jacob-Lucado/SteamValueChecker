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
  const NAV = [["value", "Value Checker"], ["wishlist", "Wishlist"], ["library", "Library"], ["alerts", "Alerts"], ["servers", "Servers"], ["mydata", "My Data"], ["help", "Help"], ["admin", "Admin"]];
  const currentView = () => (location.hash.replace(/^#\/?/, "") || "").split("?")[0];

  function renderChrome() {
    const view = currentView();
    const nav = document.getElementById("nav");
    nav.replaceChildren(...NAV
      .filter(([id]) => (id === "admin" ? state.me && state.me.isOwner : state.me || id === "help"))
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
        h("div", { class: "panel" }, h("h3", { text: "Add a game" }), field("Title", title), h("div", { class: "row" }, field("Alert me on", addType), addValueField), h("p", {}), addBtn)),
      list);
    loadList();
  }

  function wishRow(r, cur, reload, onPick) {
    const best = r.best;
    const sale = r.discount > 0;
    const pct = Math.round(r.discount * 100);
    const remove = h("button", { class: "btn red small", text: "Remove" });
    remove.addEventListener("click", () => busy(remove, async () => { await api("/api/wishlist/remove", { itad_id: r.itad_id }); state.me.games--; reload(); }));
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
      }), hist, remove), chartHolder);
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
        bundles: bundles.checked, share: share.checked, free: free.checked
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
        h("label", { class: "check" }, free, "Tell me when any game is free to claim (Steam, Epic, GOG and others). Games from one store arrive together with a Claim all button.")),
      freeNow,
      h("div", { class: "panel" },
        h("h3", { text: "Share with your server" }),
        h("label", { class: "check" }, share, "Count me in group alerts (“3 members are watching…”) and on the savings leaderboard. Shows only my name, my game count and my percent saved.")),
      h("p", { class: "muted", text: `Watching ${state.me.games} game${state.me.games === 1 ? "" : "s"}. Prices are checked about once an hour.` }),
      save, history);
  }

  async function loadFree(panel) {
    try {
      const d = await api("/api/free");
      panel.replaceChildren(h("h3", { text: "Free right now" }), d.platforms.length
        ? d.platforms.map(p => h("div", { class: "subpanel" }, h("h4", { text: p.shop + (p.games.length > 1 ? ` (${p.games.length})` : "") }),
            h("ul", { class: "freelist" }, p.games.map(g => h("li", {}, ext(g.url, "Claim " + g.title, "btn green small"))))))
        : h("div", { class: "empty", text: "Nothing is being given away right now." }),
        h("p", { class: "muted small", text: "Claiming happens on the store's site, where you need to be signed in." }));
    } catch (e) { panel.replaceChildren(h("h3", { text: "Free right now" }), h("div", { class: "notice warn", text: e.message })); }
  }

  // ---------- servers ----------
  function serversView() {
    const panels = state.me.servers.map(g => {
      const body = h("div", { class: "body" });
      const status = h("span", { class: "muted", text: g.alertChannel ? "Alert channel is set." : "No alert channel yet." });
      body.append(...[h("strong", { text: g.name }), " ", g.manageable ? h("span", { class: "tag", text: "You manage this" }) : null, h("div", {}, status)].filter(Boolean));
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
      const extra = h("div", { class: "wide" });
      const showList = h("button", { class: "btn gray small", text: "Shared list" });
      showList.addEventListener("click", () => busy(showList, () => sharedList(g, extra)));
      const showBoard = h("button", { class: "btn gray small", text: "Leaderboard" });
      showBoard.addEventListener("click", () => busy(showBoard, () => board(g, extra)));
      body.append(h("div", { class: "actions" }, showList, showBoard));
      if (g.manageable) {
        const min = h("input", { type: "number", min: "0", max: "20", value: String(g.groupMin || 0) });
        const setMin = h("button", { class: "btn gray small", text: "Save" });
        setMin.addEventListener("click", () => busy(setMin, async () => {
          const r = await api("/api/servers/group", { guild_id: g.id, minimum: Number(min.value) });
          g.groupMin = r.groupMin; toast(r.groupMin ? `Group alerts on from ${r.groupMin} members.` : "Group alerts off.", "ok");
        }));
        body.append(h("div", { class: "rule inline" }, h("span", { class: "muted small", text: "Group alert when this many opted-in members watch a game (0 = off, needs an alert channel):" }), min, setMin));
      }
      body.append(extra);
      return h("div", { class: "server" }, g.icon ? h("img", { src: g.icon, alt: "" }) : h("div", { class: "noicon" }), body);
    });
    app.replaceChildren(
      pageHead("Servers", "Alert channels are used when a DM cannot be delivered, or when a member chooses channel delivery.", state.cfg.inviteUrl && ext(state.cfg.inviteUrl, "Invite the bot", "btn blue")),
      h("div", { class: "panel" }, panels.length ? panels : h("div", { class: "empty", text: "You are not in any servers." })),
      h("div", { class: "notice", text: "Setting a channel posts a short confirmation there, which also checks that the bot can post. If that fails, give the bot View Channel, Send Messages and Embed Links in the channel." }));
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
          const holder = h("tr", { class: "chart-row", hidden: true }, h("td", { colspan: "6" }));
          const hist = h("button", { class: "btn gray small", text: "Price history" });
          hist.addEventListener("click", () => {
            if (!holder.hidden) { holder.hidden = true; return; }
            busy(hist, async () => {
              const h2 = await api("/api/wishlist/history?itad_id=" + encodeURIComponent(r.itad_id));
              holder.firstChild.replaceChildren(h2.points.length ? lineChart([{ name: "Price", cls: "s0", points: h2.points.map(p => ({ x: p.t, y: p.price })) }], { format: v => money(v, cur), label: "Price history for " + r.title }) : h("p", { class: "muted small", text: "No price history yet." }));
              holder.hidden = false;
            });
          });
          return [h("tr", {}, h("td", { text: r.title }), h("td", { class: "num", text: money(r.paid, cur) }), h("td", { class: "num", text: money(r.msrp, cur) }),
            h("td", { class: "num", text: money(r.best && r.best.price, cur) }),
            h("td", { class: "num", text: r.saved === null ? "–" : (r.saved >= 0 ? "+" : "−") + money(Math.abs(r.saved), cur) }), h("td", { class: "actions" }, hist, rm)), holder];
        });
        body.className = "";
        body.replaceChildren(
          h("div", { class: "grid four" }, tile("Games", String(t.games), t.paidGames < t.games ? `${t.paidGames} with a price` : ""), tile("You paid", money(t.paid, cur)),
            tile("Worth at MSRP", money(t.msrp, cur)), tile("Saved vs MSRP", money(t.saved, cur), t.msrpPaid > 0 ? Math.round(t.savedPct) + "% off" : "add prices to see savings")),
          chart,
          h("div", { class: "panel" }, h("h3", { text: "Your games" }), h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Game", "Paid", "MSRP", "Cheapest now", "Saved", ""].map((c, i) => h("th", { class: i > 0 && i < 5 ? "num" : "", text: c })))), h("tbody", {}, rows.flat())))));
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
          h("p", { class: "muted small", text: "Recent errors: " + ((hl.errors || []).slice(0, 5).map(e => `${e.where} (${when(e.at)})`).join(", ") || "none") })));
    } catch (e) { holder.className = ""; holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
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
        h("p", { text: "Your Discord ID, your wishlist and alert rules, your library and what you paid, your settings (including quiet hours and time zone), your last 90 days of alert history, the server you last used, and your public Steam ID if you imported a wishlist. Games you suggest or vote for on a server list are stored with that server. The Value Checker stores nothing." }),
        h("a", { class: "btn blue", href: "/api/mydata/download", text: "Download my data (JSON)" })),
      h("div", { class: "panel" }, h("h3", { text: "Delete" }),
        h("p", { text: "This deletes your wishlist, library, alert history and settings, your Steam profile ID, your votes and the games you added to server lists. It cannot be undone. Backups made before you delete are removed as they rotate out (7 days)." }),
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
  const VIEWS = { value: valueView, wishlist: wishlistView, library: libraryView, alerts: alertsView, servers: serversView, mydata: myDataView, help: helpView, admin: adminView };

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

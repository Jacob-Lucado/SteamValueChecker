// The Fortnite page: the item shop laid out the way the game shows it (sections, sized tiles, rarity colors, V-Bucks prices), plus the news,
// what's new in the latest update, the island map, a cosmetic search and, when a key is set up, player stats.
(function (root) {
  "use strict";
  const n = v => Number(v || 0).toLocaleString("en-US");
  const RARITY = {
    common: "#9aa4b2", uncommon: "#5fb04a", rare: "#3da5f0", epic: "#b45be6", legendary: "#f0913d", mythic: "#f0d54a", transcendent: "#ff6bd6",
    marvelseries: "#e32636", dcuseries: "#4a6ea8", cubeseries: "#a23be6", creatorcollabseries: "#2fd3e6", columbusseries: "#f3c712", platformseries: "#6a5cf0",
    shadowseries: "#6b6f7a", slurpseries: "#25c7c4", frozenseries: "#8fd3ff", lavaseries: "#ff6a2b", icon: "#2fd3e6", marvel: "#e32636", dc: "#4a6ea8", gaminglegends: "#6a5cf0", starwars: "#f3c712", shadow: "#6b6f7a", slurp: "#25c7c4", frozen: "#8fd3ff", lava: "#ff6a2b", dark: "#a23be6"
  };
  const rarityColor = r => RARITY[String(r || "common").toLowerCase()] || RARITY.common;
  const KINDS = [["all", "Everything"], ["outfit", "Outfits"], ["pickaxe", "Pickaxes"], ["emote", "Emotes"], ["backpack", "Back blings"], ["glider", "Gliders"], ["wrap", "Wraps"], ["bundle", "Bundles"], ["jamtrack", "Jam tracks"], ["car", "Car cosmetics"], ["instrument", "Instruments"]];
  const kindName = k => (KINDS.find(x => x[0] === k) || [0, k])[1];

  /** "3d 4h", "5h 12m", "9m" from a number of milliseconds. */
  function span(ms) {
    if (ms <= 0) return "now";
    const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), hr = Math.floor((m % 1440) / 60);
    return d ? `${d}d ${hr}h` : hr ? `${hr}h ${m % 60}m` : `${Math.max(1, m)}m`;
  }
  const clock = ms => { const t = Math.max(0, Math.floor(ms / 1000)), p = x => String(x).padStart(2, "0"); return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`; };
  const day = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); }; // the shop and its dates run on UTC

  function view(ctx) {
    const { h, api, app, pageHead, toast, busy } = ctx;
    const q = new URLSearchParams(location.search);
    let tab = q.get("tab") || "shop";
    const st = { shop: null, news: null, fresh: null, map: null, status: null };
    const view_ = { kind: "all", q: "", only: "" }; // only: "", "sale", "leaving", "new"
    const fail = e => h("div", { class: "notice warn", text: (e && e.message) || "Something went wrong." });
    const vbuck = () => h("i", { class: "fn-vb", "aria-hidden": "true", title: "V-Bucks" });
    const price = (p, regular) => h("span", { class: "fn-price" }, vbuck(), regular > p ? h("s", { text: n(regular) }) : null, h("b", { text: n(p) }));
    const body = h("div", { class: "fn-body" });
    let timer = 0, countdownEl = null;
    const TABS = () => [["shop", "Item shop"], ["news", "News"], ["new", "New cosmetics"], ["map", "Map"], ["search", "Cosmetic search"], ...(st.status && st.status.stats ? [["stats", "Player stats"]] : [])];
    const tabsEl = h("nav", { class: "fn-tabs", "aria-label": "Fortnite" });
    function drawTabs() {
      tabsEl.replaceChildren(...TABS().map(([id, text]) => h("button", { type: "button", class: "fn-tab" + (tab === id ? " active" : ""), onclick: () => { tab = id; history.replaceState(null, "", id === "shop" ? "/fortnite" : "/fortnite?tab=" + id); drawTabs(); show(); } }, text)));
    }
    const hero = h("section", { class: "fn-hero" });
    app.replaceChildren(pageHead("Fortnite", "The item shop, news and everything new in the game."), tabsEl, hero, body);

    function drawHero() {
      const sh = st.shop;
      const left = h("div", { class: "fn-hero-main" }, h("span", { class: "fn-eyebrow", text: "Today's item shop" }), h("h2", { text: sh ? day(sh.date) : "Item shop" }));
      countdownEl = h("b", { class: "fn-count", text: sh ? clock(sh.refreshAt - Date.now()) : "--:--:--" });
      const chips = [];
      if (sh) { const sale = sh.sections.reduce((a, s) => a + s.entries.filter(e => e.price < e.regular).length, 0); chips.push(h("span", { class: "fn-chip", text: `${n(sh.count)} offers` }), h("span", { class: "fn-chip", text: `${sh.sections.length} sections` })); if (sale) chips.push(h("span", { class: "fn-chip sale", text: `${sale} on sale` })); }
      if (st.status && st.status.build) chips.push(h("span", { class: "fn-chip", text: "Build " + st.status.build }));
      hero.replaceChildren(left, h("div", { class: "fn-hero-side" }, h("span", { class: "fn-eyebrow", text: "Shop refreshes in" }), countdownEl, h("div", { class: "fn-chips" }, chips)));
    }
    function startClock() {
      clearInterval(timer);
      timer = setInterval(() => {
        if (!countdownEl || !document.body.contains(countdownEl)) { clearInterval(timer); return; }
        const sh = st.shop; if (!sh) return;
        const left = sh.refreshAt - Date.now();
        countdownEl.textContent = clock(left);
        if (left <= 0) { clearInterval(timer); st.shop = null; if (tab === "shop") show(); } // a new shop is out: fetch it
      }, 1000);
    }

    function show() {
      hero.hidden = tab !== "shop";
      ({ shop, news, new: fresh, map, search, stats })[tab]?.();
    }
    const loading = text => body.replaceChildren(h("p", { class: "muted", text }));

    // ---------- the item shop ----------
    async function shop() {
      if (!st.shop) { loading("Loading the shop…"); try { st.shop = await api("/api/fortnite/shop"); } catch (e) { body.replaceChildren(fail(e)); return; } }
      drawHero(); startClock(); drawShop();
    }
    function tile(e) {
      const now = Date.now(), left = e.out ? new Date(e.out).getTime() - now : Infinity, isNew = e.in && now - new Date(e.in).getTime() < 36 * 3600e3, leaving = left < 48 * 3600e3 && left > 0;
      const c1 = e.colors[0] ? "#" + e.colors[0] : rarityColor(e.rarity), c2 = e.colors[1] ? "#" + e.colors[1] : "#101826";
      const btn = h("button", { type: "button", class: "fn-tile s" + (/_(\d)_x_/.exec(e.size) || [0, 1])[1], "aria-label": `${e.name}, ${n(e.price)} V-Bucks` });
      btn.style.setProperty("--c1", c1); btn.style.setProperty("--c2", c2); btn.style.setProperty("--rar", rarityColor(e.rarity));
      btn.append(
        e.art ? h("img", { class: "fn-art", src: e.art, alt: "", loading: "lazy", width: "512", height: "512" }) : h("span", { class: "fn-noart", text: e.name.slice(0, 1) }),
        h("span", { class: "fn-badges" }, isNew ? h("em", { class: "new", text: "New" }) : null, e.price < e.regular ? h("em", { class: "sale", text: "-" + Math.round((1 - e.price / e.regular) * 100) + "%" }) : null, leaving ? h("em", { class: "leave", text: "Leaves in " + span(left) }) : null),
        h("span", { class: "fn-label" }, h("b", { text: e.name }), h("small", { text: e.bundle ? (e.bundleInfo || "Bundle") + (e.items.length ? ` · ${e.items.length} items` : "") : e.kind === "jamtrack" ? e.artist : kindName(e.kind).replace(/s$/, "") }), price(e.price, e.regular)));
      btn.addEventListener("click", () => detail(e));
      return btn;
    }
    function row(e) { // jam tracks and other long lists show as compact rows
      const b = h("button", { type: "button", class: "fn-row" }, e.art ? h("img", { src: e.art, alt: "", loading: "lazy", width: "48", height: "48" }) : h("span", { class: "fn-noart sm", text: "♪" }), h("span", { class: "fn-row-t" }, h("b", { text: e.name }), h("small", { text: e.artist || kindName(e.kind) })), price(e.price, e.regular));
      b.addEventListener("click", () => detail(e)); return b;
    }
    function passes(e) {
      if (view_.kind !== "all" && e.kind !== view_.kind) return false;
      const t = view_.q.trim().toLowerCase();
      if (t && !(e.name.toLowerCase().includes(t) || e.artist.toLowerCase().includes(t) || e.set.toLowerCase().includes(t) || e.items.some(i => i.name.toLowerCase().includes(t)))) return false;
      const now = Date.now(), left = e.out ? new Date(e.out).getTime() - now : Infinity;
      if (view_.only === "sale") return e.price < e.regular;
      if (view_.only === "leaving") return left < 48 * 3600e3;
      if (view_.only === "new") return e.in && now - new Date(e.in).getTime() < 36 * 3600e3;
      return true;
    }
    function drawShop() {
      const sh = st.shop, kinds = new Set(sh.sections.flatMap(s => s.entries.map(e => e.kind)));
      const search = h("input", { type: "search", class: "fn-search", placeholder: "Search the shop: a name, a set or an artist", value: view_.q, "aria-label": "Search the shop" });
      const list = h("div", { class: "fn-sections" });
      const paint = () => {
        const out = [];
        for (const s of sh.sections) {
          const es = s.entries.filter(passes); if (!es.length) continue;
          const soonest = Math.min(...es.map(e => (e.out ? new Date(e.out).getTime() : Infinity)));
          const head = h("header", { class: "fn-sec-head" }, h("h3", { text: s.name }), h("span", { class: "muted small", text: `${es.length} ${es.length === 1 ? "item" : "items"}${Number.isFinite(soonest) ? " · leaves in " + span(soonest - Date.now()) : ""}` }));
          let grid;
          if (s.display === "expandableList" || es.every(e => e.kind === "jamtrack")) {
            const rows = h("div", { class: "fn-rows" }), cap = 8; let open = es.length <= cap;
            const fill = () => { rows.replaceChildren(...(open ? es : es.slice(0, cap)).map(row)); if (!open) rows.append(h("button", { type: "button", class: "btn gray small fn-more", text: `Show all ${es.length}`, onclick: () => { open = true; fill(); } })); };
            fill(); grid = rows;
          } else grid = h("div", { class: "fn-grid" }, es.map(tile));
          out.push(h("section", { class: "fn-section" }, head, grid));
        }
        list.replaceChildren(...(out.length ? out : [h("p", { class: "muted", text: "Nothing in today's shop matches that." })]));
      };
      let wait = 0; search.addEventListener("input", () => { clearTimeout(wait); wait = setTimeout(() => { view_.q = search.value; paint(); }, 160); });
      const chips = h("div", { class: "fn-filters" }, KINDS.filter(([k]) => k === "all" || kinds.has(k)).map(([k, t]) => h("button", { type: "button", class: "fn-fchip" + (view_.kind === k ? " on" : ""), onclick: e => { view_.kind = k; for (const b of e.currentTarget.parentNode.children) b.classList.toggle("on", b === e.currentTarget); paint(); } }, t)));
      const only = h("div", { class: "fn-filters" }, [["", "All"], ["new", "New today"], ["sale", "On sale"], ["leaving", "Leaving soon"]].map(([k, t]) => h("button", { type: "button", class: "fn-fchip alt" + (view_.only === k ? " on" : ""), onclick: e => { view_.only = k; for (const b of e.currentTarget.parentNode.children) b.classList.toggle("on", b === e.currentTarget); paint(); } }, t)));
      body.replaceChildren(h("div", { class: "fn-bar" }, search, only), chips, list);
      paint();
    }
    function detail(e) {
      const back = h("div", { class: "fn-modal", role: "dialog", "aria-modal": "true", "aria-label": e.name });
      const close = () => { back.remove(); document.removeEventListener("keydown", esc); };
      const esc = ev => { if (ev.key === "Escape") close(); };
      document.addEventListener("keydown", esc);
      back.addEventListener("click", ev => { if (ev.target === back) close(); });
      const left = e.out ? new Date(e.out).getTime() - Date.now() : null;
      const c1 = e.colors[0] ? "#" + e.colors[0] : rarityColor(e.rarity), c2 = e.colors[1] ? "#" + e.colors[1] : "#101826";
      const art = h("div", { class: "fn-d-art" }, e.art ? h("img", { src: e.art, alt: e.name, width: "512", height: "512" }) : null);
      art.style.setProperty("--c1", c1); art.style.setProperty("--c2", c2);
      const card = h("div", { class: "fn-d" }, art, h("div", { class: "fn-d-info" },
        h("span", { class: "fn-eyebrow", text: [kindName(e.kind).replace(/s$/, ""), e.rarityName].filter(Boolean).join(" · ") }), h("h2", { text: e.name }),
        h("div", { class: "fn-d-price" }, price(e.price, e.regular), e.price < e.regular ? h("span", { class: "fn-chip sale", text: "Save " + n(e.regular - e.price) }) : null),
        e.set ? h("p", { class: "muted small", text: "Set: " + e.set }) : null, e.intro ? h("p", { class: "muted small", text: e.intro }) : null,
        left !== null && Number.isFinite(left) ? h("p", { class: "small", text: left > 0 ? `Leaves the shop in ${span(left)} (${day(e.out)}).` : "Leaving the shop." }) : null,
        e.giftable ? h("p", { class: "muted small", text: "Can be gifted." }) : null,
        e.items.length > 1 || e.bundle ? h("div", { class: "fn-d-items" }, h("h4", { text: "Included" }), e.items.map(i => h("div", { class: "fn-d-item" }, i.art ? h("img", { src: i.art, alt: "", width: "40", height: "40", loading: "lazy" }) : null, h("span", {}, h("b", { text: i.name }), h("small", { text: i.type }))))) : null,
        e.tracks.length ? h("div", { class: "fn-d-items" }, h("h4", { text: "Jam tracks" }), e.tracks.map(t => h("p", { class: "small", text: `${t.title} · ${t.artist}` }))) : null,
        h("button", { type: "button", class: "btn gray small", text: "Close", onclick: close })));
      back.append(card); document.body.append(back);
    }

    // ---------- news ----------
    async function news() {
      if (!st.news) { loading("Loading the news…"); try { st.news = await api("/api/fortnite/news"); } catch (e) { body.replaceChildren(fail(e)); return; } }
      const modes = [["br", "Battle Royale"], ["creative", "Creative"], ["stw", "Save the World"]].filter(([m]) => st.news.items.some(i => i.mode === m));
      let mode = modes[0] ? modes[0][0] : "br";
      const list = h("div", { class: "fn-news" });
      const paint = () => { const items = st.news.items.filter(i => i.mode === mode); list.replaceChildren(...(items.length ? items.map(i => h("article", { class: "fn-news-card" }, i.image ? h("img", { src: i.image, alt: "", loading: "lazy", width: "640", height: "360" }) : null, h("div", {}, h("h3", { text: i.title }), h("p", { text: i.body })))) : [h("p", { class: "muted", text: "No news right now." })])); };
      const chips = modes.length > 1 ? h("div", { class: "fn-filters" }, modes.map(([m, t]) => h("button", { type: "button", class: "fn-fchip" + (mode === m ? " on" : ""), onclick: e => { mode = m; for (const b of e.currentTarget.parentNode.children) b.classList.toggle("on", b === e.currentTarget); paint(); } }, t))) : null;
      body.replaceChildren(...[chips, list].filter(Boolean)); paint();
    }

    // ---------- what's new ----------
    function cosmeticCard(c, opts = {}) {
      const b = h("button", { type: "button", class: "fn-tile s1 cos", "aria-label": c.name });
      b.style.setProperty("--c1", rarityColor(c.rarity)); b.style.setProperty("--c2", "#101826"); b.style.setProperty("--rar", rarityColor(c.rarity));
      b.append(h("img", { class: "fn-art", src: c.art, alt: "", loading: "lazy", width: "256", height: "256" }), h("span", { class: "fn-label" }, h("b", { text: c.name }), h("small", { text: [c.typeName, c.rarityName].filter(Boolean).join(" · ") }), opts.history ? h("small", { text: c.shopHistory ? `In the shop ${c.shopHistory}×${c.lastSeen ? " · last " + day(c.lastSeen) : ""}` : "Never in the shop" }) : null));
      b.addEventListener("click", () => cosmeticDetail(c)); return b;
    }
    function cosmeticDetail(c) {
      const back = h("div", { class: "fn-modal", role: "dialog", "aria-modal": "true", "aria-label": c.name });
      const close = () => { back.remove(); document.removeEventListener("keydown", esc); }; const esc = ev => { if (ev.key === "Escape") close(); };
      document.addEventListener("keydown", esc); back.addEventListener("click", ev => { if (ev.target === back) close(); });
      const art = h("div", { class: "fn-d-art" }, h("img", { src: c.art, alt: c.name, width: "512", height: "512" })); art.style.setProperty("--c1", rarityColor(c.rarity)); art.style.setProperty("--c2", "#101826");
      back.append(h("div", { class: "fn-d" }, art, h("div", { class: "fn-d-info" }, h("span", { class: "fn-eyebrow", text: [c.typeName, c.rarityName].filter(Boolean).join(" · ") }), h("h2", { text: c.name }),
        c.desc ? h("p", { text: c.desc }) : null, c.set ? h("p", { class: "muted small", text: "Set: " + c.set }) : null, c.intro ? h("p", { class: "muted small", text: c.intro }) : null,
        c.added ? h("p", { class: "muted small", text: "Added " + day(c.added) }) : null,
        h("p", { class: "small", text: c.shopHistory ? `Seen in the item shop ${c.shopHistory} ${c.shopHistory === 1 ? "time" : "times"}${c.lastSeen ? `, last on ${day(c.lastSeen)}` : ""}.` : "Not in the item shop yet." }),
        h("button", { type: "button", class: "btn gray small", text: "Close", onclick: close }))));
      document.body.append(back);
    }
    async function fresh() {
      if (!st.fresh) { loading("Loading the latest cosmetics…"); try { st.fresh = await api("/api/fortnite/new"); } catch (e) { body.replaceChildren(fail(e)); return; } }
      const types = [...new Set(st.fresh.items.map(i => i.type))].filter(Boolean); let type = "all";
      const grid = h("div", { class: "fn-grid cosgrid" });
      const paint = () => grid.replaceChildren(...st.fresh.items.filter(i => type === "all" || i.type === type).map(c => cosmeticCard(c, { history: true })));
      const chips = h("div", { class: "fn-filters" }, [["all", "Everything"], ...types.map(t => [t, (st.fresh.items.find(i => i.type === t) || {}).typeName || t])].map(([k, t]) => h("button", { type: "button", class: "fn-fchip" + (type === k ? " on" : ""), onclick: e => { type = k; for (const b of e.currentTarget.parentNode.children) b.classList.toggle("on", b === e.currentTarget); paint(); } }, t)));
      body.replaceChildren(h("p", { class: "muted", text: `${st.fresh.items.length} cosmetics arrived with the latest update${st.fresh.build ? " (build " + st.fresh.build.replace(/^\+\+Fortnite\+/, "") + ")" : ""}.` }), chips, grid); paint();
    }

    // ---------- map ----------
    async function map() {
      if (!st.map) { loading("Loading the map…"); try { st.map = await api("/api/fortnite/map"); } catch (e) { body.replaceChildren(fail(e)); return; } }
      let labels = true;
      const img = h("img", { class: "fn-map-img", src: st.map.image || st.map.blank, alt: "The current Fortnite island map", width: "2048", height: "2048" });
      const toggle = h("label", { class: "fn-toggle" }, h("input", { type: "checkbox", checked: true, onchange: e => { labels = e.target.checked; img.src = (labels ? st.map.image : st.map.blank) || st.map.image || st.map.blank; } }), " Show place names");
      body.replaceChildren(h("div", { class: "fn-map" }, h("div", { class: "fn-map-pic" }, toggle, img), h("aside", { class: "fn-map-list" }, h("h3", { text: `Named places (${st.map.pois.length})` }), h("ul", {}, [...st.map.pois].sort((a, b) => a.name.localeCompare(b.name)).map(p => h("li", { text: p.name }))))));
    }

    // ---------- cosmetic search ----------
    function search() {
      const input = h("input", { type: "search", class: "fn-search", placeholder: "Search every outfit, pickaxe, emote and more by name", "aria-label": "Cosmetic name" });
      const go = h("button", { type: "button", class: "btn blue", text: "Search" }), out = h("div", { class: "fn-out" });
      const run = () => busy(go, async () => {
        const term = input.value.trim(); if (term.length < 2) { toast("Type at least two letters.", "warn"); return; }
        try { const d = await api("/api/fortnite/search?q=" + encodeURIComponent(term)); out.replaceChildren(d.items.length ? h("div", { class: "fn-grid cosgrid" }, d.items.map(c => cosmeticCard(c, { history: true }))) : h("p", { class: "muted", text: "Nothing found under that name." })); } catch (e) { out.replaceChildren(fail(e)); }
      });
      go.addEventListener("click", run); input.addEventListener("keydown", e => { if (e.key === "Enter") run(); });
      body.replaceChildren(h("div", { class: "fn-bar" }, input, go), h("p", { class: "muted small", text: "Shows when it was last in the item shop, so you can guess when it might come back." }), out);
    }

    // ---------- player stats ----------
    function stats() {
      const name = h("input", { type: "text", class: "fn-search", placeholder: "Epic username", "aria-label": "Epic username", maxlength: "40" });
      const plat = h("select", { "aria-label": "Platform" }, [["epic", "Epic"], ["psn", "PlayStation"], ["xbl", "Xbox"]].map(([v, t]) => h("option", { value: v, text: t })));
      const go = h("button", { type: "button", class: "btn blue", text: "Look up" }), out = h("div", { class: "fn-out" });
      const block = (title, s) => s ? h("section", { class: "fn-stat" }, h("h3", { text: title }), h("div", { class: "fn-stat-grid" }, [["Wins", n(s.wins)], ["Win rate", s.winRate.toFixed(1) + "%"], ["Kills", n(s.kills)], ["K/D", s.kd.toFixed(2)], ["Matches", n(s.matches)], ["Top 10", n(s.top10)], ["Hours", n(Math.round(s.minutes / 60))]].map(([k, v]) => h("div", {}, h("b", { text: v }), h("small", { text: k }))))) : null;
      const run = () => busy(go, async () => {
        const who = name.value.trim(); if (who.length < 3) { toast("Type the player's Epic name.", "warn"); return; }
        try { const d = await api(`/api/fortnite/stats?name=${encodeURIComponent(who)}&platform=${plat.value}`); out.replaceChildren(h("h2", { text: d.name }), d.level ? h("p", { class: "muted", text: "Battle pass level " + d.level }) : null, block("Overall", d.overall), block("Solo", d.solo), block("Duos", d.duo), block("Squads", d.squad)); } catch (e) { out.replaceChildren(fail(e)); }
      });
      go.addEventListener("click", run); name.addEventListener("keydown", e => { if (e.key === "Enter") run(); });
      body.replaceChildren(h("div", { class: "fn-bar" }, name, plat, go), h("p", { class: "muted small", text: "Battle royale stats for players whose stats are public." }), out);
    }
    api("/api/fortnite/status").then(s => { st.status = s; drawTabs(); drawHero(); }).catch(() => {});
    drawTabs(); show();
  }

  root.FortniteUI = { view };
})(typeof globalThis !== "undefined" ? globalThis : this);

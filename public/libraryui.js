// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls LibraryUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, badgesPanel, bundlesPanel, busy, challengePanel, extSend, field, fromExt, h, hoursText, lineChart, money, pageHead, select, spendPanel, state, steamArt, toast } = ctx;
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
  root.LibraryUI = { view };
})(window);

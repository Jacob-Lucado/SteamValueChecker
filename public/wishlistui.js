// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls WishlistUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, busy, field, h, pageHead, ruleControl, select, state, steamLoginBtn, toast, wishCard } = ctx;
    const list = h("div", { class: "muted", text: "Loading prices…" });
    const profile = h("input", { type: "text", placeholder: "Steam profile link, custom name or SteamID64", maxlength: "200" });
    const linked = Boolean(state.me.steam && state.me.steam.linked);
    const importBtn = h("button", { class: "btn green", text: linked ? "Import my Steam wishlist" : "Import", onclick: () => busy(importBtn, async () => {
      const r = await api("/api/wishlist/import", { profile: profile.value });
      const parts = [`Imported ${r.added} new game${r.added === 1 ? "" : "s"} (${r.existing} already listed).`];
      if (r.pruned) parts.push(`Removed ${r.pruned} that left your Steam wishlist.`);
      if (r.unmatched) parts.push(`${r.unmatched} could not be matched.`);
      if (r.truncated) parts.push("Only the first 400 games were read.");
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
  root.WishlistUI = { view };
})(window);

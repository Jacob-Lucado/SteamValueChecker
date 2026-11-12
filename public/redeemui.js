// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls RedeemUI.view(ctx).
(function (root) {
  "use strict";
  function view(ctx) {
    const { api, app, busy, extSend, field, fromExt, h, money, pageHead, safeHref, state, toast } = ctx;
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
        drop.addEventListener("click", () => busy(drop, async () => { await api("/api/redeem/finish", { cancel: true }); queued = null; queuedBox.hidden = true; toast("Batch canceled.", "ok"); }));
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
  root.RedeemUI = { view };
})(window);

// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls StatusUI.view(ctx).
(function (root) {
  "use strict";
  let statusTimer = 0; // the refresh timer outlives one visit, so the next visit can stop it
  async function view(ctx) {
    const { api, app, busy, currentView, h } = ctx;
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
            h("div", {}, h("span", { class: "st-dot " + d.overall }), h("h1", { class: "st-head", text: HEAD[d.overall] || "Checking…" })),
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
  root.StatusUI = { view };
})(window);

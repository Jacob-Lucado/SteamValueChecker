// A piece of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls WishCardUI.view(ctx).
(function (root) {
  "use strict";
  function view(shared, r, cur, reload, onPick, isPicked) {
    const { api, busy, h, lineChart, money, ruleControl, select, state, steamArt, toast, verdictBadge } = shared;
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
  root.WishCardUI = { view };
})(window);

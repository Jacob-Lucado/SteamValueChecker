// The moderation page.
// app.js hands over its helpers (ctx) and calls ModUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, busy, currentParam, field, h, pageHead, select, serverPicker, state, toast } = ctx;
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
  root.ModUI = { view };
})(window);

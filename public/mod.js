// The moderation page.
// app.js hands over its helpers (ctx) and calls ModUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, busy, currentParam, field, h, pageHead, select, serverPicker, state, toast } = ctx;
    const servers = state.me.servers.filter(g => g.bot !== false);
    const holder = h("div");
    app.replaceChildren(pageHead("Moderation", "Warn, time out, kick, ban, lock channels, set slowmode and clean up, with every action logged as a numbered case. The auto-moderator and raid guard work on their own. In Discord: /mod."), holder);
    if (!servers.length) { holder.replaceChildren(h("div", { class: "notice warn", text: "The bot is not in any of your servers yet. Add it from the Servers page." })); return; }
    const guild = serverPicker(servers, currentParam());
    const ACTIONS = [["warn", "Warn", "moderate"], ["timeout", "Time out", "moderate"], ["untimeout", "Lift a timeout", "moderate"], ["kick", "Kick", "kick"], ["ban", "Ban", "ban"], ["unban", "Unban", "ban"], ["purge", "Clear messages", "manageMessages"], ["note", "Add a staff note", "moderate"], ["slowmode", "Slowmode", "manageChannels"], ["lock", "Lock a channel", "manageChannels"], ["unlock", "Unlock a channel", "manageChannels"]];
    const ICON = { note: "📝", slowmode: "🐌", lock: "🔒", unlock: "🔓", automod: "🤖", raid: "🚨", warn: "⚠️", timeout: "🔇", untimeout: "🔈", kick: "👢", ban: "🔨", unban: "🕊️", purge: "🧹" };
    const LABEL = { note: "Staff note", slowmode: "Slowmode", lock: "Channel locked", unlock: "Channel unlocked", automod: "Auto-mod", raid: "Raid guard", warn: "Warning", timeout: "Timeout", untimeout: "Timeout lifted", kick: "Kick", ban: "Ban", unban: "Unban", purge: "Messages cleared" };
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
        const chanActs = ["purge", "slowmode", "lock", "unlock"];
        const on = { user: !["slowmode", "lock", "unlock"].includes(a), reason: a !== "purge", duration: ["timeout", "slowmode", "ban"].includes(a), days: a === "ban", channel: chanActs.includes(a), amount: a === "purge" };
        for (const k of Object.keys(rows)) rows[k].hidden = !on[k];
        user.placeholder = a === "purge" ? "Only this person's messages (optional)" : a === "unban" ? "The banned person's user ID" : "User ID or @mention";
        reason.placeholder = a === "note" ? "The note (only staff see it)" : "Why (shown in the log and sent to them)";
        dur.placeholder = a === "ban" ? "Empty = permanent, or 12h, 7d, 30d (lifts itself)" : a === "slowmode" ? "5s, 30s, 2m, 1h or off" : "10m, 2h, 3d";
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

      // ---- auto-moderator and raid guard ----
      const autoPanel = h("div", { class: "panel" }, h("h3", { text: "Auto-moderator" }), h("p", { class: "muted", text: "Loading…" }));
      (async () => {
        let a;
        try { a = await api("/api/mod/automod?guild=" + encodeURIComponent(guild.value)); } catch (e) { autoPanel.replaceChildren(h("h3", { text: "Auto-moderator" }), h("div", { class: "notice warn", text: e.message })); return; }
        const S = JSON.parse(JSON.stringify(a.settings)), edit = a.canEdit;
        const chk = (label, get, set, hint) => { const i = h("input", { type: "checkbox" }); i.checked = Boolean(get()); i.disabled = !edit; i.addEventListener("change", () => set(i.checked)); return h("label", { class: "check" }, i, " ", label, hint ? h("span", { class: "muted small", text: "  " + hint }) : null); };
        const num = (get, set, min, max, w) => { const i = h("input", { type: "number", min: String(min), max: String(max), value: String(get()) }); if (w) { i.style.setProperty("width", w); i.style.setProperty("flex", "none"); } i.disabled = !edit; i.addEventListener("input", () => set(Number(i.value))); return i; };
        const txt = (get, set, ph, rowsN) => { const i = rowsN ? h("textarea", { rows: String(rowsN), placeholder: ph }) : h("input", { type: "text", placeholder: ph }); i.value = get(); i.disabled = !edit; i.addEventListener("input", () => set(i.value)); return i; };
        const multi = (items, chosen, label) => { const wrap = h("div", { class: "picks" }); for (const it of items) { const b = h("button", { type: "button", class: "pick" + (chosen.includes(it.id) ? " on" : ""), text: label(it), disabled: !edit }); b.addEventListener("click", () => { const i = chosen.indexOf(it.id); if (i < 0) chosen.push(it.id); else chosen.splice(i, 1); b.classList.toggle("on", i < 0); }); wrap.append(b); } return wrap; };
        const R = S.rules, list = v => (v || []).join("\n");
        const rule = (key, title, hint, body) => h("div", { class: "rule" }, chk(title, () => R[key].on, v => { R[key].on = v; }, hint), body ? h("div", { class: "rule-body" }, body) : null);
        const exch = multi(a.channels.map(c => ({ id: c.id, name: "#" + c.name })), S.exemptChannels, c => c.name), exro = multi(a.roles, S.exemptRoles, r => r.name);
        const save = h("button", { class: "btn blue", text: "Save auto-moderator" });
        save.addEventListener("click", () => busy(save, async () => {
          const r = await post("/api/mod/automod", { settings: S }); toast("Auto-moderator saved.", "ok");
        }));
        autoPanel.replaceChildren(
          h("h3", { text: "Auto-moderator" }),
          h("p", { class: "muted small", text: "Watches messages and deletes the ones that break a rule, then logs a case. Staff, exempt roles and exempt channels are never touched. Needs the bot to have Manage Messages, and Moderate Members for timeouts." }),
          edit ? null : h("div", { class: "notice warn", text: "You can see these settings, but only someone with Manage Server can change them." }),
          chk("Auto-moderator on", () => S.on, v => { S.on = v; }),
          rule("spam", "Message spam", "too many messages too fast", h("div", { class: "row" }, "More than ", num(() => R.spam.count, v => { R.spam.count = v; }, 3, 20, "5em"), " messages in ", num(() => R.spam.seconds, v => { R.spam.seconds = v; }, 2, 60, "5em"), " seconds")),
          rule("mentions", "Mass mentions", "pinging lots of people at once", h("div", { class: "row" }, "More than ", num(() => R.mentions.max, v => { R.mentions.max = v; }, 2, 30, "5em"), " mentions in one message")),
          rule("invites", "Discord invite links", "advertising other servers"),
          rule("links", "Links", "any link not on your allow-list", h("div", {}, h("p", { class: "muted small", text: "Allowed sites, one per line (youtube.com also allows its subdomains)" }), txt(() => list(R.links.allow), v => { R.links.allow = v.split(/[\n,]+/); }, "youtube.com\nsteampowered.com", 3))),
          rule("words", "Blocked words", "whole words only", h("div", {}, h("p", { class: "muted small", text: "One per line" }), txt(() => list(R.words.list), v => { R.words.list = v.split(/[\n,]+/); }, "a word\nanother", 4))),
          rule("caps", "SHOUTING", "mostly capital letters", h("div", { class: "row" }, "At least ", num(() => R.caps.percent, v => { R.caps.percent = v; }, 40, 100, "5em"), "% capitals in messages over ", num(() => R.caps.minLength, v => { R.caps.minLength = v; }, 8, 200, "5em"), " letters")),
          h("h4", { text: "When a rule is broken" }),
          h("p", { class: "muted small", text: "The message is always deleted. You can also:" }),
          chk("Warn them (a case is logged and they get a private message)", () => S.action.warn, v => { S.action.warn = v; }),
          h("div", { class: "row" }, "Or time them out for ", num(() => S.action.timeoutMinutes, v => { S.action.timeoutMinutes = v; }, 0, 40320, "6em"), " minutes (0 = no timeout)"),
          h("h4", { text: "Escalation" }),
          h("div", { class: "row" }, "After ", num(() => S.escalate.warns, v => { S.escalate.warns = v; }, 0, 20, "5em"), " active warnings (0 = never), ", (() => { const sel = select([["timeout", "time them out"], ["kick", "kick them"], ["ban", "ban them"]], S.escalate.action); sel.disabled = !edit; sel.addEventListener("change", () => { S.escalate.action = sel.value; }); return sel; })(), " for ", num(() => S.escalate.minutes, v => { S.escalate.minutes = v; }, 1, 40320, "6em"), " minutes (timeouts only)"),
          h("h4", { text: "Never touch" }),
          h("p", { class: "muted small", text: "Channels" }), exch.children.length ? exch : h("p", { class: "muted small", text: "No channels to list." }),
          h("p", { class: "muted small", text: "Roles" }), exro.children.length ? exro : h("p", { class: "muted small", text: "No roles to list." }),
          h("h4", { text: "Raid guard" }),
          chk("Raid guard on", () => S.raid.on, v => { S.raid.on = v; }, "reacts to a flood of new accounts"),
          h("div", { class: "row" }, "If ", num(() => S.raid.joins, v => { S.raid.joins = v; }, 3, 50, "5em"), " people join within ", num(() => S.raid.seconds, v => { S.raid.seconds = v; }, 5, 300, "5em"), " seconds, ", (() => { const sel = select([["timeout", "time out"], ["kick", "kick"]], S.raid.action); sel.disabled = !edit; sel.addEventListener("change", () => { S.raid.action = sel.value; }); return sel; })(), " every newcomer for the next 10 minutes (timeouts last ", num(() => S.raid.minutes, v => { S.raid.minutes = v; }, 1, 40320, "6em"), " minutes)"),
          h("div", { class: "row" }, "Also act on accounts younger than ", num(() => S.raid.minAccountDays, v => { S.raid.minAccountDays = v; }, 0, 365, "5em"), " days (0 = off)"),
          edit ? h("div", { class: "row" }, save) : null
        );
      })();
      // ---- appeals, warning expiry and moderator activity ----
      const teamPanel = h("div", { class: "panel" }, h("h3", { text: "Appeals and team" }), h("p", { class: "muted", text: "Loading…" }));
      (async () => {
        const canBan = d.perms.includes("ban"), canSet = d.perms.includes("manageGuild");
        const [st, ap] = await Promise.all([api("/api/mod/stats?guild=" + encodeURIComponent(guild.value)).catch(() => null), canBan ? api("/api/mod/appeals?guild=" + encodeURIComponent(guild.value)).catch(() => null) : null]);
        const parts = [h("h3", { text: "Appeals and team" })];
        if (ap) {
          const wd = h("input", { type: "number", min: "0", max: "365", value: String(ap.warnDays), class: "narrow" }), on = h("input", { type: "checkbox", checked: ap.appealsOn });
          const save = h("button", { class: "btn blue small", text: "Save" });
          save.addEventListener("click", () => busy(save, async () => { await post("/api/mod/settings", { warn_days: Number(wd.value), appeals_on: on.checked }); toast("Saved.", "ok"); }));
          if (canSet) parts.push(h("label", { class: "check" }, on, " Let banned people appeal on the website (permanent bans tell them where)"), h("div", { class: "row" }, "Warnings stop counting after ", wd, " days (0 = never) ", save));
          parts.push(h("h4", { text: `Open appeals (${ap.appeals.length})` }));
          parts.push(ap.appeals.length ? h("ul", { class: "plain" }, ap.appeals.map(a => {
            const note = h("input", { type: "text", maxlength: "300", placeholder: "Message back (optional)" }), yes = h("button", { class: "btn blue small", text: "Accept and unban" }), no = h("button", { class: "btn gray small", text: "Deny" });
            const decide = accept => busy(accept ? yes : no, async () => { await post("/api/mod/appeals/decide", { id: a.id, accept, note: note.value }); toast(accept ? "Appeal accepted, they are unbanned." : "Appeal denied.", "ok"); load(); });
            yes.addEventListener("click", () => decide(true)); no.addEventListener("click", () => decide(false));
            return h("li", {}, h("b", { text: `#${a.id} ${a.name || a.user_id}` }), h("span", { class: "muted small", text: ` · ${new Date(a.created_at).toLocaleString()}` }), h("div", { text: a.text }), h("div", { class: "row" }, note, yes, no));
          })) : h("p", { class: "muted small", text: "Nothing waiting." }));
          if (ap.tempBans.length) parts.push(h("h4", { text: "Temporary bans" }), h("ul", { class: "plain" }, ap.tempBans.map(t => h("li", {}, `${t.user_id} · lifts ${new Date(t.lift_at).toLocaleString()}`))));
        }
        if (st) { parts.push(h("h4", { text: "Moderator activity, last 30 days" }), st.stats.length ? h("ul", { class: "plain" }, st.stats.map(r => h("li", {}, h("b", { text: r.name || r.mod_id }), " · " + r.total + " (" + Object.entries(r.actions).map(([k, n]) => n + " " + (LABEL[k] || k).toLowerCase()).join(", ") + ")"))) : h("p", { class: "muted small", text: "No actions yet." })); }
        teamPanel.replaceChildren(...parts);
      })();
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
      holder.replaceChildren(...[servers.length > 1 ? h("div", { class: "panel" }, field("Server", guild)) : null, stats, actionPanel, teamPanel, autoPanel, logPanel, casesPanel].filter(Boolean));
      loadCases();
    }
    guild.addEventListener("change", () => { page = 1; filterUser = ""; load(); });
    load();
  }
  root.ModUI = { view };
})(window);

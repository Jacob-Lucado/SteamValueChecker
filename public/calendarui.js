// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls CalendarUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, busy, field, h, pageHead, select, toast } = ctx;
    const KIND = { release: ["", "Releases"], sale: ["", "Steam sales"], event: ["", "Server events"], lfg: ["", "Group games"] };
    const st = { kinds: new Set(Object.keys(KIND)), guild: "", mode: "list", month: new Date() };
    st.month.setDate(1); st.month.setHours(0, 0, 0, 0);
    let data = null;
    const out = h("div", { class: "muted", text: "Loading…" });
    const toolbar = h("div", { class: "cal-toolbar" });
    const sync = h("div");
    const admin = h("div");
    const dayKey = ms => { const d = new Date(ms); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
    const timeText = e => e.allDay ? (e.end && dayKey(e.end) !== dayKey(e.start) ? new Date(e.start).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " to " + new Date(e.end).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "All day") : new Date(e.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const visible = () => data.entries.filter(e => st.kinds.has(e.kind) && (!st.guild || !e.guild_id || e.guild_id === st.guild));
    // A multi-day entry shows on every day it covers.
    const spans = e => { const days = []; const last = e.end && e.allDay ? e.end : e.start; for (let t = e.start, n = 0; t <= last && n < 40; t += 86400_000, n++) days.push(dayKey(t)); return days.length ? days : [dayKey(e.start)]; };

    function removeBtn(e) {
      if (!e.canRemove) return null;
      const b = h("button", { class: "btn red small", text: "Remove" });
      b.addEventListener("click", () => busy(b, async () => { await api("/api/calendar/events/delete", { guild_id: e.guild_id, id: e.id }); toast("Removed.", "ok"); load(); }));
      return b;
    }
    function drawList() {
      const list = visible().filter(e => (e.allDay ? (e.end || e.start) : e.start) >= data.now - 3600_000);
      if (!list.length) return out.replaceChildren(h("div", { class: "empty", text: "Nothing coming up. Wishlisted games with a release date, Steam sales and server events appear here." }));
      const groups = new Map();
      for (const e of list) { const k = dayKey(e.start); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
      out.replaceChildren(...[...groups].map(([k, rows]) => h("div", { class: "panel" },
        h("h3", { text: new Date(rows[0].start).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) }),
        ...rows.map(e => h("div", { class: "cal-row" },
          
          h("div", {}, h("div", { class: "cal-title" }, e.url ? h("a", { href: e.url, target: "_blank", rel: "noopener noreferrer", text: e.title + " ↗" }) : e.title), h("div", { class: "muted small", text: [timeText(e), e.server, e.notes].filter(Boolean).join(" · ") })),
          removeBtn(e) || "")))));
    }
    function drawMonth() {
      const first = new Date(st.month), startDow = first.getDay();
      const gridStart = new Date(first); gridStart.setDate(1 - startDow);
      const byDay = new Map();
      for (const e of visible()) for (const k of spans(e)) { if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); }
      const cells = [];
      for (let i = 0; i < 42; i++) {
        const d = new Date(gridStart); d.setDate(gridStart.getDate() + i);
        const items = byDay.get(dayKey(d)) || [];
        const today = dayKey(d) === dayKey(Date.now());
        cells.push(h("div", { class: "cal-cell" + (d.getMonth() !== first.getMonth() ? " other" : "") + (today ? " today" : "") },
          h("div", { class: "cal-day", text: String(d.getDate()) }),
          ...items.slice(0, 3).map(e => h("div", { class: "cal-chip " + e.kind, title: e.title + " · " + timeText(e), text: e.title })),
          items.length > 3 ? h("div", { class: "muted small", text: "+" + (items.length - 3) + " more" }) : ""));
      }
      const prev = h("button", { class: "btn gray small", text: "‹", "aria-label": "Previous month" }), next = h("button", { class: "btn gray small", text: "›", "aria-label": "Next month" });
      prev.addEventListener("click", () => { st.month.setMonth(st.month.getMonth() - 1); drawMonth(); });
      next.addEventListener("click", () => { st.month.setMonth(st.month.getMonth() + 1); drawMonth(); });
      out.replaceChildren(h("div", { class: "panel" },
        h("div", { class: "cal-nav" }, prev, h("h3", { text: first.toLocaleDateString(undefined, { month: "long", year: "numeric" }) }), next),
        h("div", { class: "cal-grid" }, ...["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(n => h("div", { class: "cal-head", text: n })), ...cells)));
    }
    const draw = () => (st.mode === "month" ? drawMonth() : drawList());

    function drawToolbar() {
      const chips = Object.entries(KIND).map(([k, [ico, label]]) => { const b = h("button", { type: "button", class: "tab small" + (st.kinds.has(k) ? " active" : ""), text: label, "aria-pressed": String(st.kinds.has(k)) });
        b.addEventListener("click", () => { st.kinds.has(k) ? st.kinds.delete(k) : st.kinds.add(k); drawToolbar(); draw(); }); return b; });
      const mode = h("button", { type: "button", class: "tab small", text: st.mode === "list" ? "Month view" : "List view" });
      mode.addEventListener("click", () => { st.mode = st.mode === "list" ? "month" : "list"; drawToolbar(); draw(); });
      const parts = [h("div", { class: "chips" }, ...chips, mode)];
      if (data.servers.length > 1) { const sel = select([["", "All my servers"], ...data.servers.map(g => [g.id, g.name])], st.guild); sel.addEventListener("change", () => { st.guild = sel.value; draw(); }); parts.push(field("Show", sel)); }
      toolbar.replaceChildren(...parts);
    }

    function drawAdmin() {
      const mgr = data.servers.filter(g => g.manageable);
      if (!mgr.length) { admin.replaceChildren(); return; }
      const guild = select(mgr.map(g => [g.id, g.name]), mgr[0].id);
      const title = h("input", { type: "text", maxlength: "80", placeholder: "e.g. Co-op night: Helldivers 2" });
      const when = h("input", { type: "datetime-local" });
      const notes = h("textarea", { maxlength: "400", rows: "2", placeholder: "Details (optional)", class: "short" });
      const chan = h("select", {}, h("option", { value: "", text: "Do not announce in a channel" }));
      const remind = select([["60", "Remind 1 hour before"], ["15", "Remind 15 minutes before"], ["1440", "Remind 1 day before"], ["0", "No reminder"]], "60");
      const loadChans = () => api("/api/servers/channels?guild=" + encodeURIComponent(guild.value)).then(c => chan.replaceChildren(h("option", { value: "", text: "Do not announce in a channel" }), ...c.channels.map(x => h("option", { value: x.id, text: "Announce in #" + x.name })))).catch(() => {});
      guild.addEventListener("change", loadChans); loadChans();
      const add = h("button", { class: "btn green", text: "Add event" });
      add.addEventListener("click", () => busy(add, async () => {
        const at = when.value ? new Date(when.value).getTime() : NaN;
        const r = await api("/api/calendar/events", { guild_id: guild.value, title: title.value, notes: notes.value, starts_at: at, channel_id: chan.value || undefined, remind_min: Number(remind.value) });
        toast(r.announced ? "Event added and announced." : "Event added.", "ok"); title.value = ""; notes.value = ""; load();
      }));
      admin.replaceChildren(h("h2", { text: "Add a server event" }), h("div", { class: "panel" },
        h("p", { class: "muted small", text: "Members see it here and with /server calendar view. If you pick a channel it is announced there now and members get a reminder before it starts." }),
        mgr.length > 1 ? field("Server", guild) : "", h("div", { class: "row" }, field("Title", title), field("Date and time (your browser's time zone)", when)), field("Notes", notes), h("div", { class: "row" }, field("Announce", chan), field("Reminder", remind)), h("p", {}, add)));
    }

    function drawSync() {
      const result = h("div");
      const make = h("button", { class: "btn gray", text: data.feed ? "Make a new link" : "Make a calendar link" });
      make.addEventListener("click", () => busy(make, async () => {
        const r = await api("/api/calendar/feed", { action: "new" });
        const box = h("input", { type: "text", readonly: "readonly", value: r.url, "aria-label": "Calendar link" });
        box.addEventListener("focus", () => box.select());
        result.replaceChildren(h("p", { class: "muted small", text: "Copy this now. It is shown once. Anyone with it can read your calendar, so keep it private." }), box);
        make.textContent = "Make a new link";
      }));
      const off = data.feed ? h("button", { class: "btn red", text: "Turn the link off" }) : null;
      if (off) off.addEventListener("click", () => busy(off, async () => { await api("/api/calendar/feed", { action: "off" }); toast("Link turned off.", "ok"); load(); }));
      sync.replaceChildren(h("h2", { text: "Use another calendar app (optional)" }), h("div", { class: "panel" },
        h("p", { class: "muted small", text: "This calendar works on its own. If you also want these dates in Google, Apple or Outlook calendar, make a private link and add it there as a subscription from a URL. It updates by itself." }),
        data.feed ? h("p", { class: "muted small", text: `A link is active${data.feed.used_at ? ", last used " + new Date(data.feed.used_at).toLocaleDateString() : ", not used yet"}.` }) : "",
        h("p", {}, make, " ", off || ""), result));
    }

    async function load() {
      try {
        data = await api("/api/calendar?days=365");
        drawToolbar(); draw(); drawAdmin(); drawSync();
      } catch (e) { out.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    app.replaceChildren(pageHead("Calendar", "Game releases from your wishlist, Steam sales, and your servers' events, all in one place."), toolbar, out, admin, sync);
    load();
  }
  root.CalendarUI = { view };
})(window);

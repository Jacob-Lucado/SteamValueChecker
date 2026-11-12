// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls SupportUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { STATUS_ICON, api, app, busy, currentParam, field, h, navigate, pageHead, select, state, ticketSettingsPanel, ticketThread, toast } = ctx;
    const id = currentParam();
    if (id) return ticketThread(id);
    const holder = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(pageHead("Support", "Ask for help, follow your tickets, and (for server managers) answer them. Replies show up here and in Discord."), holder);
    let filter = { q: "", status: "active" };
    async function load() {
      const d = await api("/api/tickets?status=" + encodeURIComponent(filter.status === "all" ? "" : filter.status) + "&q=" + encodeURIComponent(filter.q));
      const row = (t, who) => h("a", { class: "card-link", href: "#/support/" + t.id },
        h("span", { class: "icon", text: STATUS_ICON[t.status] }),
        h("span", {}, h("strong", { text: `#${t.id} ${t.subject}` }),
          h("span", { class: "muted", text: `${t.status} · ${new Date(t.updated_at).toLocaleString()}${who && t.user_name ? " · " + t.user_name : ""}${t.assignee_id ? " · assigned" : ""}${t.tags.length ? " · " + t.tags.join(", ") : ""}` })));
      const subject = h("input", { type: "text", maxlength: "100", placeholder: "What is this about?" });
      const body = h("textarea", { maxlength: "1500", placeholder: "Tell us what happened" });
      const guildSel = select([["", "The bot's team"], ...(state.me.servers || []).map(g => [g.id, g.name])], "");
      const kindSel = select([["help", "I need help"], ["bug", "Report a bug (goes to the bot owner)"]], "help");
      const send = h("button", { class: "btn green", text: "Open ticket", onclick: () => busy(send, async () => {
        const r = await api("/api/tickets", { subject: subject.value, body: body.value, guild_id: kindSel.value === "bug" ? null : guildSel.value || null, kind: kindSel.value });
        toast(`Ticket #${r.id} opened.`); navigate("/support/" + r.id);
      }) });
      const q = h("input", { type: "search", placeholder: "Search subject, tag or #id", value: filter.q });
      const st = select([["active", "Active"], ["all", "All"], ["open", "Open"], ["waiting", "Waiting on user"], ["resolved", "Resolved"], ["closed", "Closed"]], filter.status);
      const apply = () => { filter = { q: q.value.trim(), status: st.value }; load().catch(e => toast(e.message, "error")); };
      q.addEventListener("change", apply); st.addEventListener("change", apply);
      holder.className = "";
      holder.replaceChildren(...[
        h("div", { class: "panel" }, h("h3", { text: "Open a ticket" }),
          h("div", { class: "row" }, field("Type", kindSel), field("Subject", subject), field("Send to", guildSel)), field("Details", body),
          h("p", { class: "muted small", text: "Never include a game key here. Server staff cannot see keys." }), send),
        h("div", { class: "panel" }, h("h3", { text: "Your tickets" }),
          d.mine.length ? h("div", { class: "cards" }, ...d.mine.map(t => row(t, false))) : h("p", { class: "muted", text: "No tickets yet." })),
        d.staff && h("div", { class: "panel" }, h("h3", { text: d.owner ? "Inbox (all tickets)" : "Inbox (your servers)" }),
          h("div", { class: "row" }, field("Search", q), field("Show", st)),
          d.inbox.length ? h("div", { class: "cards" }, ...d.inbox.map(t => row(t, true))) : h("p", { class: "muted", text: "Nothing here." })),
        d.staff && ticketSettingsPanel(d)
      ].filter(Boolean));
    }
    load().catch(e => holder.replaceChildren(h("div", { class: "notice warn", text: e.message })));
  }
  root.SupportUI = { view };
})(window);

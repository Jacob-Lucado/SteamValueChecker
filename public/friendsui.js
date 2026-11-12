// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls FriendsUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, busy, field, h, money, pageHead, toast } = ctx;
    const list = h("div", { class: "muted", text: "Loading…" });
    const name = h("input", { type: "text", maxlength: "30", placeholder: "Nickname" });
    const bday = h("input", { type: "text", maxlength: "5", placeholder: "MM-DD (optional)" });
    const page = h("input", { type: "text", maxlength: "24", placeholder: "Their public page name (optional)" });
    const deals = h("div");
    async function load() {
      const { friends } = await api("/api/friends");
      if (!friends.length) return list.replaceChildren(h("div", { class: "empty", text: "No friends yet. Follow someone's page and they show up here on their own, or add a nickname, a birthday and their public page name below. Once a birthday is set you get a reminder a week before, with what is on sale for them." }));
      list.replaceChildren(...friends.map(f => {
        const show = h("button", { class: "btn blue small", text: "On sale for them", disabled: !f.slug });
        show.addEventListener("click", () => busy(show, async () => {
          const r = await api("/api/friends/deals?name=" + encodeURIComponent(f.name));
          deals.replaceChildren(h("h3", { text: "On sale for " + r.name }), r.deals.length ? h("div", {}, ...r.deals.map(d => h("div", { class: "row-line" }, h("a", { href: d.url || "#", target: "_blank", rel: "noopener", text: d.title }), h("span", { class: "muted", text: " " + money(d.price, d.currency || "USD") + (d.discount > 0 ? " (-" + d.discount + "%)" : "") + " at " + d.shop })))) : h("div", { class: "muted", text: "Nothing on their wishlist is on sale right now." }));
        }));
        const del = h("button", { class: "btn red small", text: "Remove" });
        del.addEventListener("click", () => busy(del, async () => { await api("/api/friends/remove", { name: f.name }); toast("Removed.", "ok"); load(); }));
        // A friend that came from a follow has no birthday yet: it can be added right on the row.
        const bd = h("input", { type: "text", maxlength: "5", placeholder: "MM-DD", "aria-label": "Birthday for " + f.name, class: "fr-bday" });
        const bdSave = h("button", { class: "btn gray small", type: "button", text: "Set birthday" });
        bdSave.addEventListener("click", () => busy(bdSave, async () => { await api("/api/friends/birthday", { name: f.name, birthday: bd.value }); toast("Birthday saved. You'll get a reminder a week before.", "ok"); load(); }));
        return h("div", { class: "panel" }, h("strong", { text: f.name }), f.auto ? h("span", { class: "chip dim", text: " Following" }) : null, h("span", { class: "muted", text: f.birthday ? "  " + f.birthday + (f.daysToBirthday <= 30 ? " (in " + f.daysToBirthday + " days)" : "") + (f.fromPage ? ", shared on their page" : "") : "" }), h("div", { class: "mp-actions fr-actions" }, f.birthday ? null : bd, f.birthday ? null : bdSave, show, del));
      }));
    }
    const add = h("button", { class: "btn blue", text: "Save friend" });
    add.addEventListener("click", () => busy(add, async () => { await api("/api/friends/add", { name: name.value, birthday: bday.value, page: page.value }); toast("Saved.", "ok"); name.value = bday.value = page.value = ""; load(); }));
    app.replaceChildren(pageHead("Friends", "Birthdays and gift ideas. People you follow land here automatically, and only a nickname and the month and day are kept."),
      h("div", { class: "panel" }, h("div", { class: "row" }, field("Nickname", name), field("Birthday", bday), field("Public page", page)), h("div", { class: "mp-actions fr-actions" }, add)), list, deals);
    load().catch(e => list.replaceChildren(h("div", { class: "empty", text: e.message })));
  }
  root.FriendsUI = { view };
})(window);

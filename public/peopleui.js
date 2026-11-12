// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls PeopleUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, busy, h, pageHead, personRow, toast } = ctx;
    const box = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(pageHead("People", "Who you follow, who follows you, and who you've blocked."), box);
    const tab = { v: "following" };
    const draw = r => {
      const unblock = b => { const x = h("button", { class: "btn gray small", type: "button", text: "Unblock" }); x.addEventListener("click", () => busy(x, async () => { await api("/api/social/block", { slug: b.slug, on: false }); r.blocked = r.blocked.filter(y => y !== b); draw(r); toast("Unblocked.", "ok"); })); return x; };
      const lists = { following: r.following.map(p => personRow(p)), followers: r.followers.map(p => personRow(p)), blocked: r.blocked.map(b => h("div", { class: "fd-person" }, h("div", { class: "fd-av init", text: "∅" }), h("div", { class: "fd-who" }, h("span", { class: "fd-name", text: b.name })), unblock(b))) };
      const empty = { following: "You aren't following anyone yet. Try Discover.", followers: "Nobody follows you yet. Share your page link.", blocked: "You haven't blocked anyone." };
      const tabs = h("div", { class: "fd-scopes" }, [["following", `Following (${r.following.length})`], ["followers", `Followers (${r.followers.length})`], ["blocked", `Blocked (${r.blocked.length})`]].map(([k, label]) => {
        const b = h("button", { class: "chip-btn" + (tab.v === k ? " on" : ""), type: "button", text: label }); b.addEventListener("click", () => { tab.v = k; draw(r); }); return b;
      }));
      box.className = ""; box.replaceChildren(tabs, h("div", { class: "panel" }, lists[tab.v].length ? h("div", { class: "fd-people" }, lists[tab.v]) : h("p", { class: "muted", text: empty[tab.v] })));
    };
    try { draw(await api("/api/social/people")); } catch (e) { box.className = ""; box.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
  }
  root.PeopleUI = { view };
})(window);

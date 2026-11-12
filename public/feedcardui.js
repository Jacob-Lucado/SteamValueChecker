// A piece of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls FeedCardUI.view(ctx).
(function (root) {
  "use strict";
  function view(shared, it, ctx) {
    const { api, busy, feedAgo, feedAvatar, feedBody, feedComposer, feedName, h, toast } = shared;
    const card = h("article", { class: "fd-card" + (it.parentId ? " reply" : "") + (it.hidden ? " hidden-item" : ""), "data-id": String(it.id) });
    const menu = h("span", { class: "fd-menu" });
    if (ctx.signedIn) {
      const del = h("button", { class: "fd-link", type: "button", text: it.own ? "Delete" : "Report" });
      del.addEventListener("click", () => busy(del, async () => {
        if (it.own) { if (!confirm("Delete this?")) return; await api("/api/social/delete", { id: it.id }); card.remove(); ctx.onGone?.(it); toast("Deleted.", "ok"); }
        else { const why = prompt("What's wrong with it? (optional)"); if (why === null) return; await api("/api/social/report", { id: it.id, reason: why }); toast("Thanks. It will be looked at.", "ok"); }
      }));
      menu.append(del);
    }
    const srv = !it.parentId && it.servers?.length && ctx.onServer ? h("span", { class: "fd-srvs" }, it.servers.map(g => { const b = h("button", { class: "fd-srv", type: "button", text: g.name, title: "See " + g.name + "'s feed" }); b.addEventListener("click", () => ctx.onServer(g.id)); return b; })) : null;
    const head = h("div", { class: "fd-head" }, feedAvatar(it.by), h("div", { class: "fd-who" }, feedName(it.by), h("span", { class: "muted small", text: feedAgo(it.at) + (it.hidden ? " · hidden pending review" : "") })), srv, menu);
    const bar = h("div", { class: "fd-actions" });
    const drawBar = () => {
      bar.replaceChildren(...ctx.reactions.map(e => {
        const n = it.reactions[e] || 0, on = it.mine === e;
        const b = h("button", { class: "fd-react" + (on ? " on" : ""), type: "button", title: on ? "Take it back" : "React", "aria-pressed": String(on) }, e, n ? h("span", { text: String(n) }) : null);
        b.addEventListener("click", async () => {
          if (!ctx.signedIn) return toast("Sign in with Discord to react.", "warn");
          try {
            const r = await api("/api/social/react", { id: it.id, emoji: e });
            if (it.mine) it.reactions[it.mine] = Math.max(0, (it.reactions[it.mine] || 1) - 1);
            it.mine = r.mine; if (r.mine) it.reactions[r.mine] = (it.reactions[r.mine] || 0) + 1;
            drawBar();
          } catch (err) { toast(err.message, "error"); }
        });
        return b;
      }));
      if (!it.parentId) bar.append(replyBtn);
    };
    const thread = h("div", { class: "fd-thread", hidden: true });
    const replyBtn = h("button", { class: "fd-reply", type: "button" });
    const paintReply = () => { replyBtn.textContent = "💬 " + (it.replies ? it.replies : "Reply"); };
    paintReply();
    let loaded = false;
    replyBtn.addEventListener("click", async () => {
      thread.hidden = !thread.hidden;
      if (thread.hidden || loaded) return;
      loaded = true; thread.replaceChildren(h("div", { class: "muted small", text: "Loading…" }));
      try {
        const r = await api("/api/social/item?id=" + it.id);
        const list = h("div", { class: "fd-replies" });
        const add = rep => list.append(feedCard(rep, { ...ctx, onGone: () => { it.replies = Math.max(0, it.replies - 1); paintReply(); } }));
        r.replies.forEach(add);
        thread.replaceChildren(list);
        if (ctx.signedIn) thread.append(feedComposer({ parent: it.id, placeholder: "Write a reply", button: "Reply", onPosted: async () => { loaded = false; thread.hidden = true; const r2 = await api("/api/social/item?id=" + it.id); it.replies = r2.replies.length; paintReply(); thread.hidden = false; list.replaceChildren(...r2.replies.map(x => feedCard(x, { ...ctx, onGone: () => { it.replies = Math.max(0, it.replies - 1); paintReply(); } }))); loaded = true; } }));
        else thread.append(h("p", { class: "muted small", text: "Sign in with Discord to reply." }));
      } catch (err) { loaded = false; thread.replaceChildren(h("div", { class: "notice warn", text: err.message })); }
    });
    drawBar();
    const pic = it.image ? h("a", { class: "fd-pic", href: "/fimg/" + it.image, target: "_blank", rel: "noopener" }, h("img", { src: "/fimg/" + it.image, alt: "Picture from " + (it.by?.name || "a post"), loading: "lazy" })) : null;
    card.append(head, feedBody(it, ctx.onGame), pic, bar, thread);
    return card;
  }
  root.FeedCardUI = { view };
})(window);

// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls CodesUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, busy, ext, h, pageHead, promoBlock, state, toast } = ctx;
    const st = { game: "", status: "active" };
    const list = h("div", { class: "muted", text: "Loading…" });
    const head = h("div", { class: "chips" });
    const owner = Boolean(state.me && state.me.isOwner);
    const when = ms => { const d = ms - Date.now(); if (d < 0) return "ended"; const days = Math.floor(d / 86400_000); return days >= 1 ? `ends in ${days} day${days === 1 ? "" : "s"}` : `ends in ${Math.max(1, Math.round(d / 3600_000))} h`; };
    async function load() {
      const d = await api("/api/codes?status=" + st.status + (st.game ? "&game=" + encodeURIComponent(st.game) : ""));
      head.replaceChildren(
        h("button", { class: "tab small" + (!st.game ? " active" : ""), text: "All games", onclick: () => { st.game = ""; load().catch(fail); } }),
        ...d.families.map(x => h("button", { class: "tab small" + (st.game === x.key ? " active" : ""), text: x.title, onclick: () => { st.game = x.key; load().catch(fail); } })),
        h("button", { class: "tab small" + (st.status === "expired" ? " active" : ""), text: st.status === "expired" ? "Showing ended" : "Show ended", onclick: () => { st.status = st.status === "expired" ? "active" : "expired"; load().catch(fail); } }));
      list.className = "";
      list.replaceChildren(d.codes.length ? h("div", { class: "free-grid" }, d.codes.map(c => {
        const copy = h("button", { class: "btn blue small", text: "Copy code" });
        copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(c.code); toast("Copied.", "ok"); } catch { toast("Select the code and copy it by hand.", "warn"); } });
        const retire = owner && c.status === "active" ? h("button", { class: "btn red small", text: "Mark ended" }) : null;
        if (retire) retire.addEventListener("click", () => busy(retire, async () => { await api("/api/codes/retire", { id: c.id }); toast("Marked as ended. Server posts are being updated.", "ok"); await load(); }));
        return h("div", { class: "free-card" + (c.status === "expired" ? " ended" : "") },
          c.art ? h("img", { src: c.art, alt: "", loading: "lazy" }) : h("div", { class: "free-noart code-tile code-" + c.game, text: c.gameTitle }),
          h("div", { class: "free-info" }, h("strong", { text: c.gameTitle }), h("div", { text: c.reward || "Unknown reward" }),
            h("code", { class: "code-text", text: c.code }),
            h("span", { class: "muted small", text: `${c.platform || "All platforms"} · ${c.expiresAt ? when(c.expiresAt) : "no end date listed"}` }),
            c.note ? h("span", { class: "muted small", text: c.note + ". May only work on that region's account." }) : null,
            h("div", { class: "row" }, c.status === "active" ? copy : null, c.status === "active" ? ext(c.redeemUrl, c.provider === "hoyo" ? "Redeem" : c.provider === "community" ? "Redeem" : "Redeem on SHiFT", "btn gray small") : h("span", { class: "chip dim", text: "Ended" }), retire)));
      })) : h("p", { class: "muted", text: st.status === "expired" ? "No ended codes in the last two weeks." : "No working codes right now. New ones show up here as soon as they are listed." }));
    }
    const fail = e => list.replaceChildren(h("div", { class: "notice warn", text: e.message }));
    const poll = owner ? h("button", { class: "btn gray small", text: "Check for new codes now" }) : null;
    if (poll) poll.addEventListener("click", () => busy(poll, async () => { const r = await api("/api/admin/codes/poll", {}); toast(r.result.skipped ? "A check is already running." : `Checked: ${r.result.added} new, ${r.result.posted} posted.`, "ok"); await load(); }));
    const news = h("div");
    app.replaceChildren(pageHead("Codes & promos", "Limited-time codes for Borderlands (SHiFT), Genshin Impact, Honkai: Star Rail, Zenless Zone Zero, Destiny 2 and Warframe. Each one is listed once, under the right game, with an end date when one is known. Servers can have them posted in a channel. SHiFT codes come from mentalmars.com through a community mirror, the HoYoverse ones from two community code lists."), poll && h("div", { class: "panel" }, poll), head, list, news,
      h("p", { class: "muted small" }, "Want a message when something new drops? Turn on game code and giveaway alerts in ", h("a", { href: "#/alerts", text: "Alert settings" }), "."));
    load().catch(fail);
    promoBlock(news);
  }
  root.CodesUI = { view };
})(window);

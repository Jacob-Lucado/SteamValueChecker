// The indie dev panel: for developers with a game approved in the showcase. An overview of each game, an inbox for review key requests
// (approve or decline one by one or in bulk, with a pool of keys that goes out on its own), the key pool, and news for followers.
(function (root) {
  "use strict";
  const n = v => Number(v || 0).toLocaleString("en-US");
  const ago = ms => { if (!ms) return ""; const d = Math.max(0, Date.now() - ms), m = Math.round(d / 60000); return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} hr ago` : `${Math.round(m / 1440)} d ago`; };

  function view(ctx) {
    const { h, api, app, state, navigate, pageHead, toast, busy } = ctx;
    if (!state.me) { app.replaceChildren(pageHead("Dev panel", "Sign in to open the panel."), h("a", { class: "btn green", href: "/auth/login?next=devpanel", text: "Sign in with Discord" })); return; }
    let data = null, tab = (new URLSearchParams(location.search).get("tab") || "overview");
    const TABS = [["overview", "Overview"], ["requests", "Key requests"], ["keys", "Key pool"], ["news", "News"]];
    const fail = e => h("div", { class: "notice warn", text: e.message || "Something went wrong." });

    async function load() { data = await api("/api/indie/dev"); }
    function frame(...kids) {
      const bar = h("nav", { class: "dv-tabs", "aria-label": "Dev panel" }, TABS.map(([id, text]) => h("button", { type: "button", class: "dv-tab" + (tab === id ? " active" : ""), onclick: () => { tab = id; draw(); } }, text, id === "requests" && data?.pending ? h("span", { class: "dv-badge", text: String(data.pending) }) : null)));
      app.replaceChildren(pageHead("Dev panel", "Your games, review key requests and followers, in one place."), bar, ...kids);
    }
    function draw() {
      if (!data) return;
      if (!data.games.length) return frame(h("p", { class: "muted", text: "No games yet. Submit one from the indie page." }));
      ({ overview, requests, keys, news })[tab]();
    }

    function spark(days) {
      const max = Math.max(1, ...days.map(d => d.views)), box = h("div", { class: "dv-spark", role: "img", "aria-label": "Views in the last two weeks" });
      for (const d of days) { const b = h("i", { title: `${d.day}: ${d.views} views, ${d.clicks} clicks` }); b.style.height = Math.max(3, Math.round((d.views / max) * 100)) + "%"; box.append(b); }
      return box;
    }
    function overview() {
      const g = data.games, sum = k => g.reduce((t, x) => t + (x[k] || 0), 0);
      const tile = (label, value, sub) => h("div", { class: "dv-tile" }, h("b", { text: n(value) }), h("span", { text: label }), sub ? h("small", { class: "muted", text: sub }) : null);
      const cards = g.map(x => {
        const open = h("input", { type: "checkbox" }); open.checked = x.keysOpen; open.disabled = x.status !== "approved";
        open.addEventListener("change", async () => { try { await api("/api/indie/keys/open", { id: x.id, open: open.checked }); x.keysOpen = open.checked; toast(open.checked ? "Key requests are open." : "Key requests are closed.", "ok"); } catch (e) { open.checked = !open.checked; toast(e.message); } });
        return h("section", { class: "dv-game" },
          h("div", { class: "dv-game-head" }, x.image ? h("img", { src: x.image, alt: "", width: "92", height: "43", loading: "lazy" }) : null, h("div", {}, h("h3", { text: x.title }), h("small", { class: "muted", text: x.status === "approved" ? (x.verified ? "Live · verified" : "Live in the showcase") : x.status === "pending" ? "Waiting for review" : "Not accepted" }))),
          h("div", { class: "dv-nums" }, ...[["Views", x.views], ["Clicks", x.clicks], ["Likes", x.likes], ["Followers", x.followers]].map(([l, v]) => h("div", {}, h("b", { text: n(v) }), h("small", { class: "muted", text: l })))),
          spark(x.days),
          h("div", { class: "dv-meta" }, h("span", { text: `${x.requests.pending} waiting · ${x.requests.approved} approved · ${x.requests.declined} declined` }), h("span", { text: `Keys left: ${x.pool.left} of ${x.pool.total}` })),
          h("label", { class: "check" }, open, " Take review key requests"),
          h("div", { class: "row" }, h("a", { class: "btn gray small", href: `/indie/game/${x.id}`, text: "Game page" }), h("button", { class: "btn small", type: "button", text: "Open requests", onclick: () => { tab = "requests"; filters.game = String(x.id); draw(); } })));
      });
      frame(h("div", { class: "dv-tiles" }, tile("Waiting for an answer", data.pending), tile("Views", sum("views")), tile("Clicks to Steam", sum("clicks")), tile("Likes", sum("likes")), tile("Followers", sum("followers"))), h("div", { class: "dv-games" }, ...cards));
    }

    // ---- key requests ----
    const filters = { game: "", status: "pending", q: "" };
    let rows = [], picked = new Set();
    async function requests() {
      const list = h("div", { class: "dv-list" }, h("p", { class: "muted", text: "Loading…" }));
      const game = h("select", { "aria-label": "Game" }, h("option", { value: "", text: "All games" }), ...data.games.map(g => h("option", { value: String(g.id), text: g.title })));
      game.value = filters.game;
      const status = h("select", { "aria-label": "Status" }, ...[["pending", "Waiting"], ["approved", "Approved"], ["declined", "Declined"], ["", "Everything"]].map(([v, t]) => h("option", { value: v, text: t })));
      status.value = filters.status;
      const q = h("input", { type: "search", placeholder: "Search name, channel or note", "aria-label": "Search", value: filters.q });
      const note = h("input", { type: "text", maxlength: "300", placeholder: "Optional message to the requester", "aria-label": "Message to the requester" });
      const bulk = h("div", { class: "dv-bulk" });
      const all = h("input", { type: "checkbox", "aria-label": "Select all" });
      const csv = h("button", { class: "btn gray small", type: "button", text: "Export CSV", onclick: () => exportCsv() });
      const sel = () => [...picked];
      async function decide(ids, approve, btn) {
        if (!ids.length) return toast("Pick at least one request.");
        await busy(btn, async () => {
          try {
            const r = await api("/api/indie/dev/decide", { ids, approve, note: note.value });
            const bits = [approve ? `${r.approved} approved` : `${r.declined} declined`];
            if (approve && r.sent) bits.push(`${r.sent} key${r.sent === 1 ? "" : "s"} sent`);
            if (approve && r.noKeys) bits.push(`${r.noKeys} without a key (add some in Key pool, or send it yourself)`);
            toast(bits.join(" · "), "ok"); picked.clear(); await load(); await fetchRows();
          } catch (e) { toast(e.message); }
        });
      }
      const approveSel = h("button", { class: "btn green small", type: "button", text: "Approve selected", onclick: e => decide(sel(), true, e.currentTarget) });
      const declineSel = h("button", { class: "btn gray small", type: "button", text: "Decline selected", onclick: e => decide(sel(), false, e.currentTarget) });
      bulk.append(all, h("span", { class: "muted small", text: "Select all" }), approveSel, declineSel, note, csv);
      function paint() {
        all.checked = rows.length > 0 && rows.every(r => picked.has(r.id));
        if (!rows.length) { list.replaceChildren(h("p", { class: "muted", text: filters.status === "pending" ? "Nothing waiting. New requests show up here and in your notifications." : "Nothing matches." })); return; }
        list.replaceChildren(...rows.map(r => {
          const c = h("input", { type: "checkbox", "aria-label": `Select ${r.name}` }); c.checked = picked.has(r.id);
          c.addEventListener("change", () => { c.checked ? picked.add(r.id) : picked.delete(r.id); all.checked = rows.every(x => picked.has(x.id)); });
          const link = /^https?:\/\//i.test(r.channel || "") ? h("a", { href: r.channel, target: "_blank", rel: "noopener noreferrer", text: r.channel.replace(/^https?:\/\/(www\.)?/i, "").slice(0, 70) }) : h("span", { text: r.channel || "" });
          return h("article", { class: "dv-req " + r.status },
            c, h("div", { class: "dv-req-main" }, h("div", { class: "dv-req-top" }, h("b", { text: r.name }), h("span", { class: "dv-chip " + r.status, text: r.status === "pending" ? "Waiting" : r.status === "approved" ? (r.keySent ? "Approved · key sent" : "Approved") : "Declined" }), h("small", { class: "muted", text: `${r.game} · ${ago(r.created)}` })), h("div", { class: "dv-req-link" }, link), r.note ? h("p", { class: "dv-req-note", text: r.note }) : null, r.reply ? h("small", { class: "muted", text: `You said: ${r.reply}` }) : null),
            h("div", { class: "dv-req-actions" }, r.keySent ? null : h("button", { class: "btn green small", type: "button", text: r.status === "approved" ? "Send key" : "Approve", onclick: e => decide([r.id], true, e.currentTarget) }), r.status === "declined" || r.keySent ? null : h("button", { class: "btn gray small", type: "button", text: "Decline", onclick: e => decide([r.id], false, e.currentTarget) })));
        }));
      }
      all.addEventListener("change", () => { for (const r of rows) all.checked ? picked.add(r.id) : picked.delete(r.id); paint(); });
      async function fetchRows() {
        try {
          const p = new URLSearchParams(); if (filters.game) p.set("game", filters.game); if (filters.status) p.set("status", filters.status); if (filters.q) p.set("q", filters.q);
          rows = (await api("/api/indie/dev/requests?" + p)).requests; picked = new Set([...picked].filter(id => rows.some(r => r.id === id))); paint();
        } catch (e) { list.replaceChildren(fail(e)); }
      }
      let t = 0;
      game.addEventListener("change", () => { filters.game = game.value; fetchRows(); }); status.addEventListener("change", () => { filters.status = status.value; fetchRows(); });
      q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { filters.q = q.value.trim(); fetchRows(); }, 300); });
      function exportCsv() {
        const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const body = [["Game", "Name", "Channel", "Note", "Status", "Asked", "Your message"].map(esc).join(","), ...rows.map(r => [r.game, r.name, r.channel, r.note, r.status, new Date(r.created).toISOString(), r.reply].map(esc).join(","))].join("\r\n");
        const a = h("a", { href: URL.createObjectURL(new Blob([body], { type: "text/csv" })), download: "key-requests.csv" }); document.body.append(a); a.click(); a.remove();
      }
      const noKeys = data.games.some(g => g.requests.pending && !g.pool.left);
      frame(h("div", { class: "dv-filters" }, game, status, q), noKeys ? h("p", { class: "notice small", text: "Some of these games have no keys loaded. Approving still works, but you'll send the key yourself. Add keys in Key pool to have them go out automatically." }) : null, bulk, list);
      await fetchRows();
    }

    // ---- key pool ----
    let keyGame = null;
    async function keys() {
      keyGame ||= String(data.games[0].id);
      const sel = h("select", { "aria-label": "Game" }, ...data.games.map(g => h("option", { value: String(g.id), text: g.title }))); sel.value = keyGame;
      const box = h("div", {}, h("p", { class: "muted", text: "Loading…" }));
      sel.addEventListener("change", () => { keyGame = sel.value; draw(); });
      const text = h("textarea", { rows: "6", placeholder: "One key per line", "aria-label": "Keys to add" });
      async function paint() {
        try {
          const r = await api("/api/indie/dev/keys?id=" + keyGame);
          const left = r.keys.filter(k => !k.sentTo);
          box.replaceChildren(h("p", {}, h("b", { text: `${r.pool.left} left` }), h("span", { class: "muted", text: ` of ${r.pool.total} loaded. When you approve a request, the next key is sent to that person automatically in a Discord message.` })),
            h("div", { class: "dv-keys" }, ...r.keys.slice(0, 200).map(k => h("div", { class: "dv-key" + (k.sentTo ? " sent" : "") }, h("code", { text: k.sentTo ? k.key.slice(0, 5) + "…" : k.key }), k.sentTo ? h("small", { class: "muted", text: `sent ${ago(k.sentAt)}` }) : h("button", { class: "btn gray small", type: "button", text: "Remove", onclick: e => busy(e.currentTarget, async () => { try { await api("/api/indie/dev/keys/remove", { game: Number(keyGame), id: k.id }); await load(); await paint(); } catch (er) { toast(er.message); } }) })))),
            left.length ? h("button", { class: "btn gray small", type: "button", text: "Remove all unsent keys", onclick: e => { if (!confirm("Remove every key that hasn't been sent?")) return; busy(e.currentTarget, async () => { try { await api("/api/indie/dev/keys/remove", { game: Number(keyGame), all: true }); await load(); await paint(); } catch (er) { toast(er.message); } }); } }) : null);
        } catch (e) { box.replaceChildren(fail(e)); }
      }
      const add = h("button", { class: "btn green", type: "button", text: "Add keys", onclick: e => busy(e.currentTarget, async () => {
        try { const r = await api("/api/indie/dev/keys/add", { id: Number(keyGame), keys: text.value }); text.value = ""; toast(`${r.added} added${r.skipped ? `, ${r.skipped} skipped (repeats or not a key)` : ""}.`, "ok"); await load(); await paint(); } catch (er) { toast(er.message); }
      }) });
      frame(h("div", { class: "dv-filters" }, sel), h("section", { class: "dv-card" }, h("h3", { text: "Add keys" }), text, h("div", { class: "row" }, add), h("p", { class: "muted small", text: "Keys are kept on this site's server until they're sent, so only load what you're happy to hand out. Remove them any time." })), h("section", { class: "dv-card" }, h("h3", { text: "Pool" }), box));
      await paint();
    }

    // ---- news for followers ----
    function news() {
      const g = h("select", { "aria-label": "Game" }, ...data.games.filter(x => x.status === "approved").map(x => h("option", { value: String(x.id), text: x.title })));
      const kind = h("select", { "aria-label": "Kind" }, ...[["news", "📰 News"], ["demo", "🎮 Demo"], ["playtest", "🧪 Playtest"], ["release", "🚀 Release"], ["sale", "🏷️ Sale"]].map(([v, t]) => h("option", { value: v, text: t })));
      const title = h("input", { type: "text", maxlength: "100", placeholder: "Headline", "aria-label": "Headline" }), body = h("textarea", { rows: "4", maxlength: "500", placeholder: "Details (optional, 500 characters)", "aria-label": "Details" }), link = h("input", { type: "url", placeholder: "https:// link (optional)", "aria-label": "Link" });
      const post = h("button", { class: "btn green", type: "button", text: "Post to followers", onclick: e => busy(e.currentTarget, async () => {
        try { await api("/api/indie/update", { id: Number(g.value), kind: kind.value, title: title.value, body: body.value, link: link.value }); title.value = body.value = link.value = ""; toast("Posted. Your followers were told.", "ok"); await load(); draw(); } catch (er) { toast(er.message); }
      }) });
      const recent = data.games.flatMap(x => x.updates.map(u => ({ ...u, game: x.title }))).sort((a, b) => b.created - a.created).slice(0, 6);
      frame(h("section", { class: "dv-card" }, h("h3", { text: "Tell your followers" }), h("div", { class: "dv-filters" }, g, kind), title, body, link, h("div", { class: "row" }, post)), recent.length ? h("section", { class: "dv-card" }, h("h3", { text: "Recent" }), ...recent.map(u => h("p", {}, h("b", { text: u.title }), h("small", { class: "muted", text: ` ${u.game} · ${ago(u.created)}` })))) : null);
    }

    app.replaceChildren(pageHead("Dev panel", "Loading…"));
    load().then(draw).catch(e => app.replaceChildren(pageHead("Dev panel", ""), fail(e)));
  }
  root.DevPanel = { view };
})(typeof globalThis !== "undefined" ? globalThis : this);

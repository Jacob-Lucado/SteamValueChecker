// Music studio: the player, queue, search, radio, requests, playlists and the live chat, all talking to the same /api/music endpoints as the dashboard.
(() => {
  "use strict";
  const root = document.getElementById("mu");
  const REACTIONS = ["🔥", "💜", "🎉", "😂", "👏", "🤘", "🎧", "😍"];

  // ---------- small helpers ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === "text") el.textContent = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const store = { get(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* blocked */ } } };
  const fmt = sec => { sec = Math.max(0, Math.floor(sec || 0)); const hh = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60; return (hh ? hh + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
  function toast(text, kind) {
    const t = h("div", { class: "mu-toast" + (kind === "error" ? " error" : ""), text });
    document.getElementById("muToasts").append(t);
    setTimeout(() => t.remove(), 3200);
  }
  async function api(path, body) {
    const opts = body === undefined ? { headers: { Accept: "application/json" } } : { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "dashboard" }, body: JSON.stringify(body) };
    let res;
    try { res = await fetch(path, opts); } catch { throw new Error("Could not reach the server."); }
    let data = {};
    try { data = await res.json(); } catch { /* not JSON */ }
    if (res.status === 401) { const e = new Error(data.error || "Please sign in."); e.status = 401; throw e; }
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }
  const initials = name => String(name || "?").trim().slice(0, 2).toUpperCase();
  const avatar = (u, cls) => u.avatar ? h("img", { class: cls, src: u.avatar, alt: "", referrerpolicy: "no-referrer", loading: "lazy" }) : h("span", { class: cls, text: initials(u.name) });
  const themeBtn = () => {
    const b = h("button", { class: "theme-btn", type: "button" });
    const paint = () => { const light = window.svcTheme && window.svcTheme.current() === "light"; b.textContent = light ? "☾" : "☀"; b.setAttribute("aria-label", light ? "Switch to dark theme" : "Switch to light theme"); b.title = b.getAttribute("aria-label"); };
    b.addEventListener("click", () => { if (window.svcTheme) window.svcTheme.toggle(); paint(); });
    paint();
    return b;
  };

  // ---------- sign-in and empty screens ----------
  function gate(title, text, ...actions) {
    root.replaceChildren(h("div", { class: "mu-gate" }, h("div", { class: "card" }, h("img", { src: "/logo.png", alt: "", width: "72", height: "72" }), h("h1", { text: title }), h("p", { text }), h("div", { class: "row" }, actions))));
  }

  // ---------- state ----------
  let me = null, guilds = [], gid = "", data = null, built = false, ui = {};
  let pollTimer = 0, chatTimer = 0, tickTimer = 0, stamp = 0, lastSig = "", chatSince = 0, chatFirst = true, dragFrom = -1;

  async function boot() {
    try { me = await api("/api/me"); } catch (e) { me = null; }
    if (!me || me.adminOnly) return gate("Music studio", "Play SoundCloud and live radio in your server's voice channel, queue songs with friends and chat while it plays.", h("a", { class: "mu-link", href: "/auth/login", text: "Sign in with Discord" }));
    let list;
    try { list = (await api("/api/music")).guilds; } catch (e) { return gate("Music isn't available", e.message, h("a", { class: "mu-link plain", href: "/", text: "Back" })); }
    guilds = list;
    if (!guilds.length) return gate("No servers yet", "I don't share a server with you yet. Add the bot to a server, then come back.", h("a", { class: "mu-link", href: me.inviteUrl || "/", text: "Back to the dashboard" }));
    const saved = store.get("svc_music_guild");
    gid = guilds.find(g => g.id === saved)?.id || (guilds.find(g => g.active) || guilds[0]).id;
    buildShell();
    selectGuild(gid, true);
  }

  // ---------- layout ----------
  function buildShell() {
    ui = {};
    const rail = h("nav", { class: "mu-rail", "aria-label": "Servers" }, h("img", { class: "mu-logo", src: "/logo.png", alt: "Steam Value Checker" }));
    ui.srv = {};
    for (const g of guilds) {
      const b = h("button", { class: "mu-srv", type: "button", title: g.name, "aria-label": g.name, onclick: () => selectGuild(g.id) }, g.icon ? h("img", { src: `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=96`, alt: "", referrerpolicy: "no-referrer" }) : initials(g.name));
      ui.srv[g.id] = b; rail.append(b);
    }
    rail.append(h("div", { class: "grow" }), themeBtn());

    // hero
    ui.cover = h("div", { class: "mu-cover-wrap" }, h("div", { class: "mu-vinyl" }), h("div", { class: "mu-nocover", text: "♪" }));
    ui.tags = h("div", { class: "mu-tags" });
    ui.title = h("h2", { class: "mu-title", text: "Nothing playing" });
    ui.artist = h("p", { class: "mu-artist" });
    ui.eq = h("div", { class: "mu-eq", "aria-hidden": "true" }, ...Array.from({ length: 28 }, (_, i) => { const b = h("i"); b.style.animationDelay = (-((i * 137) % 1100)) + "ms"; b.style.animationDuration = (800 + (i * 53) % 700) + "ms"; return b; }));
    ui.fill = h("div", { class: "mu-fill" });
    ui.bar = h("div", { class: "mu-bar", role: "slider", "aria-label": "Song position", "aria-valuemin": "0" }, ui.fill);
    ui.pos = h("span", { text: "0:00" }); ui.dur = h("span", { text: "0:00" });
    ui.bar.addEventListener("click", e => {
      if (!ui.bar.classList.contains("seek") || !data?.status?.current?.duration) return;
      const r = ui.bar.getBoundingClientRect(), to = Math.round(((e.clientX - r.left) / r.width) * data.status.current.duration);
      control("seek", { value: to });
    });
    const btn = (label, aria, fn, cls = "") => h("button", { class: "mu-btn " + cls, type: "button", "aria-label": aria, title: aria, text: label, onclick: fn });
    ui.prev = btn("⏮", "Previous song", () => control("previous"));
    ui.play = btn("▶", "Play or pause", () => control(data.status.paused ? "resume" : "pause"), "main");
    ui.next = btn("⏭", "Skip", () => control("skip"));
    ui.stop = btn("⏹", "Stop and clear", () => control("stop"), "danger");
    ui.shuf = btn("🔀", "Shuffle the queue", () => control("shuffle"));
    ui.loop = btn("🔁", "Loop: off", () => { const order = ["off", "track", "queue"]; control("loop", { value: order[(order.indexOf(data.status.loop) + 1) % 3] }); });
    ui.leave = btn("⏏", "Make the bot leave the voice channel", () => control("leave"));
    ui.vol = h("input", { type: "range", min: "1", max: "100", value: "50", "aria-label": "Volume" });
    ui.vol.addEventListener("change", () => control("volume", { value: Number(ui.vol.value) }));
    ui.pill = h("span", { class: "mu-pill" });
    ui.note = h("p", { class: "mu-note" });
    ui.name = h("h1", { text: "" });
    const hero = h("section", { class: "mu-hero" }, ui.cover,
      h("div", { class: "mu-meta" }, ui.tags, ui.title, ui.artist, ui.eq, h("div", { class: "mu-prog" }, ui.pos, ui.bar, ui.dur),
        h("div", { class: "mu-ctl" }, ui.prev, ui.play, ui.next, ui.stop, ui.shuf, ui.loop, ui.leave, h("label", { class: "mu-vol" }, "🔊", ui.vol))));

    // tabs
    const panes = {}, tabs = {};
    const tabDefs = [["queue", "Queue"], ["search", "Add music"], ["radio", "Radio"], ["requests", "Requests"], ["playlists", "Playlists"]];
    const tabBar = h("div", { class: "mu-tabs", role: "tablist" });
    for (const [id, label] of tabDefs) {
      tabs[id] = h("button", { class: "mu-tab", type: "button", role: "tab", onclick: () => showTab(id) }, label, h("b", { hidden: true }));
      panes[id] = h("div", { class: "mu-pane", role: "tabpanel" });
      tabBar.append(tabs[id]);
    }
    ui.panes = panes; ui.tabs = tabs;
    buildSearch(); buildRadio(); buildPlaylists();
    ui.queueList = h("div", { class: "mu-list" });
    panes.queue.append(ui.queueList);
    ui.reqList = h("div", { class: "mu-list" });
    ui.reqForm = h("div");
    panes.requests.append(ui.reqForm, ui.reqList);

    const stage = h("main", { class: "mu-stage" }, h("div", { class: "mu-top" }, ui.name, ui.pill, h("span", { class: "sp" })), ui.note, hero, tabBar, ...Object.values(panes));

    // chat
    ui.here = h("div", { class: "mu-here" });
    ui.clear = h("button", { class: "mu-mini", type: "button", text: "Clear", hidden: true, onclick: async () => { try { await api("/api/music/chat/delete", { guild_id: gid, clear: true }); } catch (e) { toast(e.message, "error"); } } });
    ui.msgs = h("div", { class: "mu-msgs", "aria-live": "polite" });
    ui.msgInput = h("input", { type: "text", placeholder: "Say something…", maxlength: "300", autocomplete: "off", "aria-label": "Message" });
    ui.send = h("button", { type: "submit", "aria-label": "Send", text: "➤" });
    const form = h("form", { class: "mu-compose" }, ui.msgInput, ui.send);
    form.addEventListener("submit", e => { e.preventDefault(); sendChat(); });
    const react = h("div", { class: "mu-react" }, ...REACTIONS.map(r => h("button", { type: "button", "aria-label": "React " + r, text: r, onclick: () => sendChat(r) })));
    const chat = h("aside", { class: "mu-chat" }, h("div", { class: "mu-chat-head" }, h("h2", {}, "Session chat", h("span", { class: "sp" }), ui.clear), ui.here), ui.msgs, react, form);

    ui.float = h("div", { class: "mu-float" });
    const bottom = h("div", { class: "mu-bottom" },
      h("button", { type: "button", class: "on", "data-v": "player", text: "♪ Player", onclick: () => setView("player") }),
      h("button", { type: "button", "data-v": "chat", text: "💬 Chat", onclick: () => setView("chat") }));
    ui.bottom = bottom;
    ui.art = h("div", { class: "mu-art" });
    root.replaceChildren(ui.art, h("div", { class: "mu-veil" }), rail, stage, chat, bottom, ui.float);
    showTab(store.get("svc_music_tab") || "queue");
    document.addEventListener("keydown", onKey);
    built = true;
  }
  function setView(v) { root.dataset.view = v; for (const b of ui.bottom.children) b.classList.toggle("on", b.dataset.v === v); if (v === "chat") scrollChat(true); }
  function showTab(id) {
    if (!ui.panes[id]) id = "queue";
    for (const k of Object.keys(ui.panes)) { ui.panes[k].classList.toggle("on", k === id); ui.tabs[k].classList.toggle("on", k === id); ui.tabs[k].setAttribute("aria-selected", String(k === id)); }
    store.set("svc_music_tab", id);
    if (id === "radio" && !ui.radioLoaded) loadRadio();
  }
  function onKey(e) {
    if (e.target.closest?.("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === " " && data?.status?.current) { e.preventDefault(); ui.play.click(); }
    else if (e.key.toLowerCase() === "n") ui.next.click();
    else if (e.key === "/") { e.preventDefault(); showTab("search"); ui.q.focus(); }
  }

  // ---------- actions ----------
  const can = () => { const a = data?.access; return Boolean(a && a.present && a.enabled && a.inVoice && a.sameChannel); };
  async function control(action, extra = {}) {
    try {
      const r = await api("/api/music/control", { guild_id: gid, action, ...extra });
      if (r.result && r.result.skipped === false) toast(`Vote to skip: ${r.result.votes}/${r.result.need}`);
      data.status = r.status; paint(true);
    } catch (e) { toast(e.message, "error"); }
  }
  async function add(payload, label) {
    try {
      const r = await api("/api/music/play", { guild_id: gid, ...payload });
      toast(r.startedNow ? `Playing: ${r.title}` : r.added > 1 ? `Added ${r.added} songs.` : `Queued: ${r.title || label || "song"}`);
      await refresh();
    } catch (e) { toast(e.message, "error"); }
  }

  // ---------- add music ----------
  function buildSearch() {
    ui.q = h("input", { type: "search", placeholder: "Search SoundCloud, or paste a link or radio stream…", "aria-label": "Search for music", autocomplete: "off" });
    ui.qGo = h("button", { class: "mu-go", type: "submit", text: "Search" });
    ui.results = h("div", { class: "mu-list" });
    const form = h("form", { class: "mu-form" }, ui.q, ui.qGo);
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const q = ui.q.value.trim(); if (!q) return;
      if (/^https?:\/\//i.test(q)) { await add({ query: q }); ui.q.value = ""; ui.results.replaceChildren(); return; }
      ui.qGo.disabled = true; ui.results.replaceChildren(h("p", { class: "mu-empty", text: "Searching…" }));
      try {
        const r = await api(`/api/music/search?guild=${encodeURIComponent(gid)}&q=${encodeURIComponent(q)}`);
        ui.results.replaceChildren(...(r.results.length ? r.results.map(t => trackRow(t, [
          h("button", { class: "mu-mini go", type: "button", text: "Add", disabled: !can(), onclick: () => add({ tracks: [t] }, t.title) }),
          h("button", { class: "mu-mini", type: "button", text: "Next", disabled: !can(), onclick: () => add({ tracks: [t], next: true }, t.title) })])) : [h("p", { class: "mu-empty", text: "Nothing found. Try different words." })]));
      } catch (err) { ui.results.replaceChildren(h("p", { class: "mu-empty", text: err.message })); }
      finally { ui.qGo.disabled = false; }
    });
    ui.panes.search.append(h("p", { class: "mu-hint", text: "Press / anywhere to jump here. Playlists work too: paste a SoundCloud set link." }), form, ui.results);
  }
  function trackRow(t, acts, n = "") {
    return h("div", { class: "mu-row" }, h("span", { class: "n", text: n }),
      t.thumb ? h("img", { src: t.thumb, alt: "", referrerpolicy: "no-referrer", loading: "lazy" }) : h("span", { class: "ph", text: t.live ? "📻" : "♪" }),
      h("div", { class: "t" }, h("b", { text: t.title || "Untitled" }), h("span", { text: [t.artist, t.live ? "live" : t.duration ? fmt(t.duration) : ""].filter(Boolean).join(" · ") })),
      h("div", { class: "acts" }, acts));
  }

  // ---------- radio ----------
  function buildRadio() {
    ui.radioList = h("div", { class: "mu-list" });
    ui.panes.radio.append(h("p", { class: "mu-hint", text: "Live stations that are on the air right now." }), ui.radioList);
  }
  async function loadRadio() {
    ui.radioLoaded = true;
    ui.radioList.replaceChildren(h("p", { class: "mu-empty", text: "Tuning in…" }));
    try {
      const r = await api("/api/music/stations?guild=" + encodeURIComponent(gid));
      ui.radioList.replaceChildren(...(r.stations.length ? r.stations.map(s => trackRow({ title: s.title, artist: s.genre, live: true }, [h("button", { class: "mu-mini go", type: "button", text: "Play", disabled: !can() || !data?.settings?.radio, title: data?.settings?.radio ? "" : "Live radio is off in this server", onclick: () => add({ query: s.url }, s.title) })])) : [h("p", { class: "mu-empty", text: "No stations answered just now. Try again in a minute." })]));
    } catch (e) { ui.radioLoaded = false; ui.radioList.replaceChildren(h("p", { class: "mu-empty", text: e.message })); }
  }

  // ---------- playlists ----------
  function buildPlaylists() {
    ui.plName = h("input", { type: "text", placeholder: "Name this queue to save it", maxlength: "40", "aria-label": "Playlist name" });
    const save = h("button", { class: "mu-go", type: "submit", text: "Save queue" });
    const form = h("form", { class: "mu-form" }, ui.plName, save);
    form.addEventListener("submit", async e => {
      e.preventDefault();
      try { const r = await api("/api/music/playlists", { guild_id: gid, action: "save", name: ui.plName.value }); data.playlists = r.playlists; ui.plName.value = ""; toast("Saved."); paintPlaylists(); } catch (err) { toast(err.message, "error"); }
    });
    ui.plList = h("div", { class: "mu-list" });
    ui.panes.playlists.append(h("p", { class: "mu-hint", text: "Your saved playlists follow you to every server." }), form, ui.plList);
  }
  function paintPlaylists() {
    const pl = data.playlists || [];
    ui.plList.replaceChildren(...(pl.length ? pl.map(p => h("div", { class: "mu-row" }, h("span", { class: "n" }), h("span", { class: "ph", text: "▤" }), h("div", { class: "t" }, h("b", { text: p.name }), h("span", { text: `${p.count} song${p.count === 1 ? "" : "s"}` })),
      h("div", { class: "acts" },
        h("button", { class: "mu-mini go", type: "button", text: "Load", disabled: !can(), onclick: async () => { try { const r = await api("/api/music/playlists", { guild_id: gid, action: "load", name: p.name }); toast(`Added ${r.added} songs.`); await refresh(); } catch (e) { toast(e.message, "error"); } } }),
        h("button", { class: "mu-mini bad", type: "button", text: "✕", "aria-label": "Delete " + p.name, onclick: async () => { try { const r = await api("/api/music/playlists", { guild_id: gid, action: "delete", name: p.name }); data.playlists = r.playlists; paintPlaylists(); } catch (e) { toast(e.message, "error"); } } })))) : [h("p", { class: "mu-empty", text: "No saved playlists yet. Build a queue, then save it here." })]));
  }

  // ---------- painting ----------
  function paint(light) {
    const d = data, st = d.status, a = d.access, t = st.current, ok = can(), dj = Boolean(a.dj);
    root.classList.toggle("playing", st.playing);
    ui.name.textContent = guilds.find(g => g.id === gid)?.name || "";
    ui.pill.className = "mu-pill" + (ok ? " good" : " warn");
    ui.pill.textContent = ok ? `🔊 In ${a.voiceName}` : !a.enabled ? "Music is off here" : !a.inVoice ? "Not in a voice channel" : "Different voice channel";
    ui.note.hidden = ok;
    ui.note.textContent = !a.present ? "I'm not in that server." : !a.enabled ? "Music is turned off in this server. A manager can turn it on from the dashboard." : !a.inVoice ? "Join a voice channel in this server and the controls unlock. You can already browse, chat and react." : `I'm playing in another voice channel (${st.channelName || "elsewhere"}). Join it to use the controls.`;

    const sig = JSON.stringify([t?.url, t?.title, t?.thumb, st.paused, st.playing, st.loop, st.total]);
    if (!light || sig !== lastSig) {
      lastSig = sig;
      ui.tags.replaceChildren(...[t?.live && h("span", { class: "mu-tag live", text: "● Live" }), t?.auto && h("span", { class: "mu-tag auto", text: "Auto DJ" }), t?.submitted && h("span", { class: "mu-tag", text: "Member request" }), st.paused && t && h("span", { class: "mu-tag", text: "Paused" })].filter(Boolean));
      ui.title.replaceChildren(t ? (t.live || !t.url ? t.title : h("a", { href: t.url, target: "_blank", rel: "noopener noreferrer", text: t.title })) : "Nothing playing");
      ui.artist.textContent = t ? (t.artist || "") : st.active ? (st.auto?.waiting ? "Waiting for someone to join the voice channel." : st.auto?.on ? "The Auto DJ will start in a moment." : "The queue is empty. Add something below.") : "Add a song below and I'll hop into your voice channel.";
      const cover = t?.thumb ? h("img", { class: "mu-cover", src: t.thumb.replace("-large", "-t500x500"), alt: "", referrerpolicy: "no-referrer" }) : h("div", { class: "mu-nocover", text: t?.live ? "📻" : "♪" });
      ui.cover.replaceChildren(h("div", { class: "mu-vinyl" }), cover);
      ui.art.style.setProperty("--art", t?.thumb ? `url("${t.thumb}")` : "none");
      document.title = t ? `${st.playing ? "▶" : "⏸"} ${t.title} · Music` : "Music · Steam Value Checker";
      ui.play.textContent = st.paused ? "▶" : "⏸";
      ui.loop.classList.toggle("on", st.loop !== "off");
      ui.loop.textContent = st.loop === "track" ? "🔂" : "🔁";
      ui.loop.title = ui.loop.ariaLabel = st.loop === "off" ? "Loop: off" : st.loop === "track" ? "Loop: this song" : "Loop: the whole queue";
    }
    for (const b of [ui.prev, ui.next, ui.play, ui.stop, ui.shuf, ui.loop, ui.leave]) b.disabled = !ok || (!t && b !== ui.leave && b !== ui.shuf) || (!dj && [ui.stop, ui.shuf, ui.loop, ui.leave, ui.play].includes(b));
    ui.prev.disabled = ui.prev.disabled || t?.live; ui.leave.disabled = !ok || !dj;
    ui.vol.disabled = !ok || !dj; if (document.activeElement !== ui.vol) ui.vol.value = String(st.volume);
    ui.bar.classList.toggle("seek", ok && dj && Boolean(t) && !t.live);
    ui.bar.classList.toggle("live", Boolean(t?.live));
    for (const [id, srv] of Object.entries(ui.srv)) { srv.classList.toggle("on", id === gid); srv.classList.toggle("live", Boolean(guilds.find(g => g.id === id)?.active)); }
    tick(); clearInterval(tickTimer); if (t && !t.live && !st.paused) tickTimer = setInterval(tick, 500);
    stampAt = Date.now();

    // queue
    const qsig = JSON.stringify([st.next.map(x => x.url + x.title), ok, dj, st.total]);
    if (qsig !== ui.qsig && dragFrom < 0) {
      ui.qsig = qsig;
      ui.queueList.replaceChildren(...(st.next.length ? st.next.map((x, i) => {
        const row = trackRow(x, ok ? [h("button", { class: "mu-mini", type: "button", text: "▶", title: "Play this now", onclick: () => control("skipto", { n: i + 1 }) }), h("button", { class: "mu-mini bad", type: "button", text: "✕", "aria-label": "Remove", onclick: () => control("remove", { n: i + 1 }) })] : [], String(i + 1));
        if (ok) {
          row.draggable = true;
          row.addEventListener("dragstart", e => { dragFrom = i; row.classList.add("drag"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", String(i)); } catch { /* old browser */ } });
          row.addEventListener("dragend", () => { dragFrom = -1; row.classList.remove("drag"); for (const r of ui.queueList.children) r.classList.remove("over"); });
          row.addEventListener("dragover", e => { if (dragFrom >= 0) { e.preventDefault(); row.classList.add("over"); } });
          row.addEventListener("dragleave", () => row.classList.remove("over"));
          row.addEventListener("drop", e => { e.preventDefault(); const from = dragFrom; dragFrom = -1; if (from >= 0 && from !== i) control("move", { from: from + 1, to: i + 1 }); });
        }
        return row;
      }) : [h("p", { class: "mu-empty", text: t ? "Nothing waiting after this song." : "The queue is empty." })]));
    }
    setCount("queue", st.next.length); setCount("requests", d.submissions.length);
    // requests
    const rsig = JSON.stringify([d.submissions.map(r => r.id), a.canSubmit]);
    if (rsig !== ui.rsig) {
      ui.rsig = rsig;
      ui.reqForm.replaceChildren(a.canSubmit ? h("p", { class: "mu-hint", text: "Send a song for the Auto DJ to play when the queue is empty. Use the Add music tab to find one, then press Request." }) : h("p", { class: "mu-hint", text: "Requests are off in this server." }));
      ui.reqList.replaceChildren(...(d.submissions.length ? d.submissions.map(r => trackRow(r, (r.mine || dj) ? [h("button", { class: "mu-mini bad", type: "button", text: "✕", "aria-label": "Remove request", onclick: async () => { try { await api("/api/music/submission", { guild_id: gid, id: r.id }); await refresh(); } catch (e) { toast(e.message, "error"); } } })] : [])).map((row, i) => { row.querySelector(".t span").textContent += ` · from ${d.submissions[i].name}`; return row; }) : [h("p", { class: "mu-empty", text: "No requests waiting." })]));
    }
    if (!ui.plBuilt) { ui.plBuilt = true; }
    paintPlaylists();
    ui.clear.hidden = !(dj || a.isManager || a.isBotOwner);
  }
  let stampAt = Date.now();
  function tick() {
    const st = data?.status, t = st?.current;
    if (!t || t.live) { ui.fill.style.width = "0%"; ui.pos.textContent = t?.live ? "LIVE" : "0:00"; ui.dur.textContent = ""; return; }
    const p = st.paused ? st.position : st.position + (Date.now() - stampAt) / 1000, q = Math.min(p, t.duration || p);
    ui.fill.style.width = t.duration ? Math.min(100, (q / t.duration) * 100) + "%" : "0%";
    ui.pos.textContent = fmt(q); ui.dur.textContent = t.duration ? fmt(t.duration) : "";
  }
  function setCount(tab, n) { const b = ui.tabs[tab].querySelector("b"); b.hidden = !n; b.textContent = String(n); }

  // ---------- loading ----------
  async function refresh() {
    try { data = await api("/api/music?guild=" + encodeURIComponent(gid)); } catch (e) { if (e.status === 401) return boot(); toast(e.message, "error"); return; }
    paint(true);
    try { guilds.find(g => g.id === gid).active = data.status.active; } catch { /* fine */ }
  }
  function loop() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => { if (!document.hidden) await refresh(); loop(); }, document.hidden ? 8000 : 2500);
  }
  function selectGuild(id, first) {
    gid = id; store.set("svc_music_guild", id);
    ui.radioLoaded = false; ui.qsig = ui.rsig = lastSig = ""; ui.results.replaceChildren(); ui.radioList.replaceChildren(h("p", { class: "mu-empty", text: "Open this tab to see stations." }));
    data = null; chatSince = 0; chatFirst = true; ui.msgs.replaceChildren();
    for (const [k, srv] of Object.entries(ui.srv)) srv.classList.toggle("on", k === id);
    refresh().then(() => { if (ui.panes.radio.classList.contains("on")) loadRadio(); });
    loop(); chatLoop();
  }

  // ---------- chat ----------
  function scrollChat(force) { const m = ui.msgs; if (force || m.scrollHeight - m.scrollTop - m.clientHeight < 90) m.scrollTop = m.scrollHeight; }
  function floatEmoji(emoji, name) {
    const s = h("span", {}, emoji, name ? h("small", { text: name }) : null);
    s.style.left = (8 + Math.random() * 84) + "%"; s.style.setProperty("--dx", ((Math.random() - .5) * 120) + "px");
    ui.float.append(s); s.addEventListener("animationend", () => s.remove());
  }
  function renderMsg(m) {
    if (m.kind === "note") return h("div", { class: "mu-note-line", "data-id": m.id, text: m.text });
    const mine = m.userId === me.user.id, canDel = mine || data?.access?.dj || data?.access?.isManager || data?.access?.isBotOwner;
    const when = new Date(m.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return h("div", { class: "mu-msg" + (mine ? " me" : ""), "data-id": m.id }, avatar({ avatar: m.avatar, name: m.name }, "av"),
      h("div", {}, h("div", { class: "who" }, m.name, h("small", { text: when })), h("div", { class: "txt", text: m.text })),
      canDel ? h("button", { class: "x", type: "button", "aria-label": "Delete message", text: "✕", onclick: async () => { try { await api("/api/music/chat/delete", { guild_id: gid, id: m.id }); } catch (e) { toast(e.message, "error"); } } }) : null);
  }
  async function pollChat() {
    const mine = gid;
    let r;
    try { r = await api(`/api/music/chat?guild=${encodeURIComponent(gid)}&since=${chatSince}`); } catch (e) { if (e.status === 401) boot(); return; }
    if (mine !== gid) return;
    const stick = ui.msgs.scrollHeight - ui.msgs.scrollTop - ui.msgs.clientHeight < 90;
    for (const m of r.messages) {
      if (m.kind === "gone") { ui.msgs.querySelector(`[data-id="${m.text}"]`)?.remove(); continue; }
      if (m.kind === "clear") { ui.msgs.replaceChildren(); continue; }
      if (m.kind === "react") { if (!chatFirst) floatEmoji(m.text, m.userId === me.user.id ? "" : m.name); continue; }
      ui.msgs.querySelector(`[data-id="${m.id}"]`) || ui.msgs.append(renderMsg(m));
    }
    chatSince = r.last; chatFirst = false;
    if (!ui.msgs.children.length) ui.msgs.replaceChildren(h("p", { class: "mu-chat-empty", text: "It's quiet. Say hi, or send a 🔥 when the song hits." }));
    else ui.msgs.querySelector(".mu-chat-empty")?.remove();
    if (stick) scrollChat(true);
    ui.here.replaceChildren(...r.here.slice(0, 7).map(u => avatar(u, "av")), h("em", { text: r.here.length === 1 ? "Just you" : `${r.here.length} here` }));
  }
  function chatLoop() {
    clearTimeout(chatTimer);
    const go = async () => { if (!document.hidden) await pollChat(); chatTimer = setTimeout(go, document.hidden ? 8000 : 2000); };
    go();
  }
  async function sendChat(react) {
    const text = ui.msgInput.value;
    if (!react && !text.trim()) return;
    try {
      if (react) { floatEmoji(react, ""); await api("/api/music/chat", { guild_id: gid, react }); }
      else { ui.msgInput.value = ""; await api("/api/music/chat", { guild_id: gid, text }); }
      await pollChat();
    } catch (e) { if (!react) ui.msgInput.value = text; toast(e.message, "error"); }
  }

  boot();
})();

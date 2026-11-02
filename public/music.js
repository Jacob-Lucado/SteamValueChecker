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
  const toSeconds = text => { const t = String(text).trim(); if (/^\d+$/.test(t)) return Number(t); const m = t.match(/^(?:(\d+):)?(\d+):(\d{1,2})$/) || t.match(/^()(\d+):(\d{1,2})$/); return m ? Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN; };
  const field = (label, control) => h("label", { class: "mu-field" }, h("span", { text: label }), control);
  const check = (on, label) => { const i = h("input", { type: "checkbox" }); i.checked = Boolean(on); return [i, h("label", { class: "mu-check" }, i, " " + label)]; };
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
    const wanted = new URLSearchParams(location.search).get("guild"), saved = store.get("svc_music_guild");
    gid = guilds.find(g => g.id === wanted)?.id || guilds.find(g => g.id === saved)?.id || (guilds.find(g => g.active) || guilds[0]).id;
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
    ui.listen = h("a", { class: "mu-listen", target: "_blank", rel: "noopener", hidden: true, text: "🎧 Listen now", title: "Opens the voice channel in Discord" });
    ui.note = h("p", { class: "mu-note" });
    ui.name = h("h1", { text: "" });
    const hero = h("section", { class: "mu-hero" }, ui.cover,
      h("div", { class: "mu-meta" }, ui.tags, ui.title, ui.artist, ui.eq, h("div", { class: "mu-prog" }, ui.pos, ui.bar, ui.dur),
        h("div", { class: "mu-ctl" }, ui.prev, ui.play, ui.next, ui.stop, ui.shuf, ui.loop, ui.leave, h("label", { class: "mu-vol" }, "🔊", ui.vol)),
        h("form", { class: "mu-jump", onsubmit: e => { e.preventDefault(); const n = toSeconds(ui.jump.value); if (!Number.isFinite(n)) return toast("Type a time like 1:30.", "error"); control("seek", { value: n }); ui.jump.value = ""; } }, ui.jump = h("input", { type: "text", placeholder: "Jump to 1:30", size: "9", "aria-label": "Jump to a time" }), h("button", { class: "mu-mini", type: "submit", text: "Go" }))));

    // tabs
    const panes = {}, tabs = {};
    const tabDefs = [["queue", "Queue"], ["search", "Add music"], ["radio", "Radio"], ["requests", "Requests"], ["playlists", "Playlists"], ["stream", "Stream"], ["autodj", "Auto DJ"], ["settings", "Settings"]];
    const tabBar = h("div", { class: "mu-tabs", role: "tablist" });
    for (const [id, label] of tabDefs) {
      tabs[id] = h("button", { class: "mu-tab", type: "button", role: "tab", onclick: () => showTab(id) }, label, h("b", { hidden: true }));
      panes[id] = h("div", { class: "mu-pane", role: "tabpanel" });
      tabBar.append(tabs[id]);
    }
    ui.panes = panes; ui.tabs = tabs;
    buildSearch(); buildRadio(); buildPlaylists();
    ui.autoBox = h("div"); ui.setBox = h("div");
    buildStream();
    panes.autodj.append(ui.autoBox); panes.settings.append(ui.setBox);
    ui.queueList = h("div", { class: "mu-list" });
    panes.queue.append(ui.queueList);
    ui.reqList = h("div", { class: "mu-list" });
    ui.reqForm = h("div");
    panes.requests.append(ui.reqForm, ui.reqList);

    ui.vizBtn = h("button", { class: "mu-mini", type: "button", onclick: cycleViz });
    ui.chatBtn = h("button", { class: "mu-mini", type: "button", title: "Show new chat messages floating over the player", onclick: () => { floatChatOn = !floatChatOn; store.set("svc_music_floatchat", floatChatOn ? "1" : "0"); paintChatBtn(); if (!floatChatOn) { floatQueue.length = 0; ui.float.querySelectorAll(".msg").forEach(n => n.remove()); } } });
    paintChatBtn();
    paintVizBtn();
    const stage = h("main", { class: "mu-stage" }, h("div", { class: "mu-top" }, ui.name, ui.pill, ui.listen, h("span", { class: "sp" }), ui.chatBtn, ui.vizBtn), ui.note, hero, tabBar, ...Object.values(panes));

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
    ui.viz = h("canvas", { class: "mu-viz", "aria-hidden": "true" });
    root.replaceChildren(ui.art, h("div", { class: "mu-veil" }), ui.viz, rail, stage, chat, bottom, ui.float);
    const wantTab = new URLSearchParams(location.search).get("tab");
    showTab(ui.panes[wantTab] ? wantTab : (store.get("svc_music_tab") || "queue"));
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", () => { if (document.hidden) vizClose(); else vizOpen(); });
    window.addEventListener("resize", sizeViz); window.addEventListener("svc-theme", () => { vizColors = null; });
    sizeViz(); requestAnimationFrame(vizFrame);
    built = true;
  }
  function setView(v) { root.dataset.view = v; for (const b of ui.bottom.children) b.classList.toggle("on", b.dataset.v === v); if (v === "chat") scrollChat(true); }
  function showTab(id) {
    if (!ui.panes[id]) id = "queue";
    for (const k of Object.keys(ui.panes)) { ui.panes[k].classList.toggle("on", k === id); ui.tabs[k].classList.toggle("on", k === id); ui.tabs[k].setAttribute("aria-selected", String(k === id)); }
    store.set("svc_music_tab", id);
    root.classList.toggle("on-stream", id === "stream");
    if (id === "radio" && !ui.radioLoaded) loadRadio();
    if (id === "stream") streamOpen();
  }
  function onKey(e) {
    if (e.target.closest?.("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === " " && data?.status?.current) { e.preventDefault(); ui.play.click(); }
    else if (e.key.toLowerCase() === "n") ui.next.click();
    else if (e.key === "/") { e.preventDefault(); showTab("search"); ui.q.focus(); }
    else if (e.key === "[" || e.key === "]") { vizDelay = Math.max(0, Math.min(800, vizDelay + (e.key === "]" ? 20 : -20))); store.set("svc_music_viz_delay", String(vizDelay)); toast(`Visualizer delay ${vizDelay} ms. [ and ] line it up with what you hear.`); }
    else if (e.key.toLowerCase() === "v") cycleViz();
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
    ui.q = h("input", { type: "search", placeholder: "Search SoundCloud, or paste a song, playlist or radio stream link…", "aria-label": "Search for music", autocomplete: "off", maxlength: "300" });
    ui.qGo = h("button", { class: "mu-go", type: "submit", text: "Search" });
    ui.qPlay = h("button", { class: "mu-go", type: "button", text: "Play" });
    ui.results = h("div", { class: "mu-list" });
    const [nextBox, nextLabel] = check(false, "Play next"), [shufBox, shufLabel] = check(false, "Shuffle if it's a playlist");
    ui.opts = { next: nextBox, shuf: shufBox };
    const doPlay = async () => { const q = ui.q.value.trim(); if (!q) return; await add({ query: q, next: nextBox.checked, shuffle: shufBox.checked }); ui.q.value = ""; ui.results.replaceChildren(); };
    ui.qPlay.addEventListener("click", doPlay);
    const form = h("form", { class: "mu-form" }, ui.q, ui.qGo, ui.qPlay);
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const q = ui.q.value.trim(); if (!q) return;
      if (/^https?:\/\//i.test(q)) return doPlay();
      ui.qGo.disabled = true; ui.results.replaceChildren(h("p", { class: "mu-empty", text: "Searching…" }));
      try {
        const r = await api(`/api/music/search?guild=${encodeURIComponent(gid)}&q=${encodeURIComponent(q)}`);
        ui.results.replaceChildren(...(r.results.length ? r.results.map(t => trackRow(t, [
          h("button", { class: "mu-mini go", type: "button", text: "Add", disabled: !can(), onclick: () => add({ tracks: [t], next: nextBox.checked }, t.title) }),
          h("button", { class: "mu-mini", type: "button", text: "Next", disabled: !can(), onclick: () => add({ tracks: [t], next: true }, t.title) }),
          data?.settings?.autodj && data?.settings?.autodj_submit ? h("button", { class: "mu-mini", type: "button", title: "Send it to the Auto DJ as a request", text: "Request", onclick: () => request({ tracks: [t] }) }) : null].filter(Boolean))) : [h("p", { class: "mu-empty", text: "Nothing found. Try different words." })]));
      } catch (err) { ui.results.replaceChildren(h("p", { class: "mu-empty", text: err.message })); }
      finally { ui.qGo.disabled = false; }
    });
    ui.panes.search.append(h("p", { class: "mu-hint", text: "Press / anywhere to jump here. Paste a SoundCloud song, playlist (set) or artist link to queue it all (up to 100 songs), or a live radio stream link (an Icecast or Shoutcast address)." }), form, h("div", { class: "mu-opts" }, nextLabel, shufLabel), ui.results);
  }
  async function request(payload) {
    try { const r = await api("/api/music/submit", { guild_id: gid, ...payload }); toast(r.added > 1 ? `Requested ${r.added} songs.` : "Requested. It plays before the Auto DJ's own songs."); await refresh(); } catch (e) { toast(e.message, "error"); }
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
    ui.radioChips = h("div", { class: "mu-seg", role: "radiogroup", "aria-label": "Kind of music" });
    ui.radioCat = "";
    ui.panes.radio.append(h("p", { class: "mu-hint", text: "Live stations that are on the air right now." }), ui.radioChips, ui.radioList);
  }
  function paintRadio() {
    const r = ui.radioData; if (!r) return;
    ui.radioChips.replaceChildren(...[{ id: "", name: "All" }, ...r.categories].map(c => h("button", { type: "button", role: "radio", class: c.id === ui.radioCat ? "on" : "", "aria-checked": String(c.id === ui.radioCat), text: c.name, onclick: () => { ui.radioCat = c.id; paintRadio(); } })));
    const list = r.stations.filter(s => !ui.radioCat || s.cat === ui.radioCat);
    ui.radioList.replaceChildren(...(list.length ? list.map(s => trackRow({ title: s.title, artist: s.genre, live: true }, [h("button", { class: "mu-mini go", type: "button", text: "Play", disabled: !can() || !data?.settings?.radio, title: data?.settings?.radio ? "" : "Live radio is off in this server", onclick: () => add({ query: s.url }, s.title) })])) : [h("p", { class: "mu-empty", text: "No stations of that kind are on the air right now." })]));
  }
  async function loadRadio() {
    ui.radioLoaded = true;
    ui.radioList.replaceChildren(h("p", { class: "mu-empty", text: "Tuning in…" }));
    try { ui.radioData = await api("/api/music/stations?guild=" + encodeURIComponent(gid)); paintRadio(); }
    catch (e) { ui.radioLoaded = false; ui.radioList.replaceChildren(h("p", { class: "mu-empty", text: e.message })); }
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
    const streamOk = Boolean(a.canStream);
    ui.tabs.stream.hidden = !streamOk;
    if (streamOk && ui.panes.stream.classList.contains("on")) ui.ov?.update();
    if (!streamOk && ui.panes.stream.classList.contains("on")) showTab("queue");
    ui.listen.hidden = !(st.active && st.channelId);
    if (!ui.listen.hidden) ui.listen.href = `https://discord.com/channels/${encodeURIComponent(gid)}/${encodeURIComponent(st.channelId)}`;
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
    ui.jump.disabled = ui.jump.nextSibling.disabled = !ok || !dj || !t || t.live;
    ui.vol.disabled = !ok || !dj; if (document.activeElement !== ui.vol) ui.vol.value = String(st.volume);
    ui.bar.classList.toggle("seek", ok && dj && Boolean(t) && !t.live);
    ui.bar.classList.toggle("live", Boolean(t?.live));
    for (const [id, srv] of Object.entries(ui.srv)) { srv.classList.toggle("on", id === gid); srv.classList.toggle("live", Boolean(guilds.find(g => g.id === id)?.active)); }
    syncClock(st, t);
    tick(); clearInterval(tickTimer); if (t && !t.live && !st.paused) tickTimer = setInterval(tick, 250);

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
      const rq = h("input", { type: "text", placeholder: "SoundCloud song or playlist link, or words to search", maxlength: "300", "aria-label": "Request a song", disabled: !a.canSubmit });
      const rg = h("button", { class: "mu-go", type: "submit", text: "Request", disabled: !a.canSubmit });
      const rf = h("form", { class: "mu-form", onsubmit: e => { e.preventDefault(); if (rq.value.trim()) request({ query: rq.value }).then(() => { rq.value = ""; }); } }, rq, rg);
      ui.reqForm.replaceChildren(h("p", { class: "mu-hint", text: a.canSubmit ? "Request a song for the Auto DJ. Requests play before its own songs, and they work even if you're not in the voice channel. Search results in the Add music tab have a Request button too." : "Requests are off in this server. A manager can turn them on under Auto DJ." }), rf);
      ui.reqList.replaceChildren(...(d.submissions.length ? d.submissions.map(r => trackRow(r, (r.mine || dj) ? [h("button", { class: "mu-mini bad", type: "button", text: "✕", "aria-label": "Remove request", onclick: async () => { try { await api("/api/music/submission", { guild_id: gid, id: r.id }); await refresh(); } catch (e) { toast(e.message, "error"); } } })] : [])).map((row, i) => { row.querySelector(".t span").textContent += ` · from ${d.submissions[i].name}`; return row; }) : [h("p", { class: "mu-empty", text: "No requests waiting." })]));
    }
    paintPlaylists();
    const mgr = Boolean(d.channels);
    ui.tabs.autodj.hidden = ui.tabs.settings.hidden = !mgr;
    if (!mgr && ["autodj", "settings"].includes(store.get("svc_music_tab"))) showTab("queue");
    if (mgr && ui.mgrKey !== gid) { ui.mgrKey = gid; buildManager(d); }
    ui.clear.hidden = !(dj || a.isManager || a.isBotOwner);
  }
  // ---------- stream overlay: the shared panel (public/overlayui.js), also used on the dashboard's Music page ----------
  function buildStream() {
    ui.ov = window.SvcOverlayPanel({ api, toast: (m, k) => toast(m, k === "error" ? "error" : undefined), getData: () => data, getGuild: () => gid, storeKey: "svc_music_ov" });
    ui.panes.stream.append(ui.ov.el);
  }
  function streamOpen() { ui.ov?.update(); }

  // ---------- manager panels (Auto DJ and server settings), same as the dashboard's Music page ----------
  const num = (v, lo, hi) => { const i = h("input", { type: "number", min: String(lo), max: String(hi), value: String(v) }); return i; };
  const sel = (opts, value) => { const s = h("select"); for (const [v, t] of opts) { const o = h("option", { value: v, text: t }); if (v === value) o.selected = true; s.append(o); } return s; };
  const press = async (btn, fn) => { const label = btn.textContent; btn.disabled = true; btn.textContent = "Working…"; try { await fn(); } catch (e) { toast(e.message, "error"); } finally { btn.disabled = false; btn.textContent = label; } };
  function buildManager(d) {
    const s = d.settings;
    // Auto DJ
    const [on, onL] = check(s.autodj, "Auto DJ is on"), [sub, subL] = check(s.autodj_submit, "Members can request songs (even from outside the voice channel)"), [shuf, shufL] = check(s.autodj_shuffle, "Shuffle the playlist");
    const idle = num(s.autodj_idle, 5, 600);
    const vc = sel([["", "Only when someone starts it"], ...(d.voiceChannels ?? []).map(c => [c.id, "🔊 " + c.name])], s.autodj_channel_id || "");
    const link = h("input", { type: "text", maxlength: "300", placeholder: "SoundCloud playlist link", "aria-label": "Auto DJ playlist link" });
    const saved = sel([["", "Or use one of my saved playlists…"], ...d.playlists.map(p => [p.name, `${p.name} (${p.count})`])], "");
    const call = (extra, ok) => api("/api/music/autodj", { guild_id: gid, ...extra }).then(r => { toast(r.note || ok || "Saved."); ui.mgrKey = ""; return refresh(); });
    const save = h("button", { class: "mu-go", type: "button", text: "Save Auto DJ settings" });
    save.addEventListener("click", () => press(save, () => call({ autodj: on.checked, autodj_submit: sub.checked, autodj_shuffle: shuf.checked, autodj_idle: Number(idle.value), autodj_channel_id: vc.value })));
    const useLink = h("button", { class: "mu-mini go", type: "button", text: "Use this playlist" });
    useLink.addEventListener("click", () => press(useLink, () => call({ playlist_url: link.value })));
    const useSaved = h("button", { class: "mu-mini go", type: "button", text: "Use it" });
    useSaved.addEventListener("click", () => { if (!saved.value) return toast("Pick a saved playlist first.", "error"); press(useSaved, () => call({ saved_playlist: saved.value })); });
    const clr = h("button", { class: "mu-mini bad", type: "button", text: "Remove playlist" });
    clr.addEventListener("click", () => { if (confirm("Remove the Auto DJ's playlist?")) press(clr, () => call({ clear_playlist: true })); });
    const pl = d.autodj.playlist;
    ui.autoBox.replaceChildren(
      h("p", { class: "mu-hint", text: "Keeps music going. When the bot sits in a voice channel with nothing playing for a while, it starts your playlist. Members' requests play first, and anyone's /play beats the playlist right away." }),
      h("div", { class: "mu-set" }, onL, subL, shufL, field("Start after this many seconds of silence", idle), field("Join this voice channel by itself", vc), h("div", { class: "mu-actions" }, save)),
      h("h3", { class: "mu-h", text: `Playlist (${d.autodj.count} song${d.autodj.count === 1 ? "" : "s"})` }),
      h("div", { class: "mu-form" }, link, useLink), h("div", { class: "mu-form" }, saved, useSaved, d.autodj.count ? clr : null),
      h("div", { class: "mu-list" }, ...(pl.length ? pl.slice(0, 50).map((t, i) => trackRow(t, [], String(i + 1))) : [h("p", { class: "mu-empty", text: "No playlist yet. Paste a SoundCloud playlist link above." })])));
    // Server settings
    const [en, enL] = check(s.enabled, "Music is on"), [ann, annL] = check(s.announce, "Post a message when each song starts"), [vcs, vcsL] = check(s.vc_status, "Show the song as the voice channel's status"), [stay, stayL] = check(s.stay, "Stay in the last voice channel and wait for people"), [radio, radioL] = check(s.radio, "Allow live radio stream links");
    const vol = num(s.volume, 1, 100), mq = num(s.max_queue, 5, 500), mm = num(s.max_minutes, 0, 600), lv = num(s.leave_minutes, 1, 60);
    const role = sel([["", "Everyone can use the controls"], ...d.roles.filter(r => r.id !== d.guild.id).map(r => [r.id, "DJ role: " + r.name])], s.dj_role_id || "");
    const chan = sel([["", "Where the song was added from"], ...d.channels.map(c => [c.id, "#" + c.name])], s.channel_id || "");
    const save2 = h("button", { class: "mu-go", type: "button", text: "Save music settings" });
    save2.addEventListener("click", () => press(save2, async () => { await api("/api/music/settings", { guild_id: gid, enabled: en.checked, announce: ann.checked, vc_status: vcs.checked, stay: stay.checked, radio: radio.checked, volume: Number(vol.value), max_queue: Number(mq.value), max_minutes: Number(mm.value), leave_minutes: Number(lv.value), dj_role_id: role.value, channel_id: chan.value }); toast("Saved."); ui.mgrKey = ""; await refresh(); }));
    ui.setBox.replaceChildren(
      h("p", { class: "mu-hint", text: "Only people with Manage Server see this. Moderators can always use the DJ controls. The bot needs Connect and Speak in your voice channels, plus Send Messages where it posts." }),
      h("div", { class: "mu-set" }, enL, annL, vcsL, stayL, radioL, field("Controls", role), field("Now-playing messages go to", chan), field("Starting volume (1-100)", vol), field("Most songs in the queue", mq), field("Longest song, minutes (0 = no limit)", mm), field("Leave after idle (minutes)", lv), h("div", { class: "mu-actions" }, save2)));
  }

  // The song position runs on a local clock. Each refresh from the server only nudges it (a big gap, like a seek or a new song, snaps it),
  // so the bar glides instead of jumping forward and back with every poll.
  const clock = { id: "", pos: 0, at: 0, running: false };
  function syncClock(st, t) {
    const now = performance.now(), id = t ? `${t.url ?? ""}|${t.title}` : "", running = Boolean(t) && !t.live && Boolean(st.playing) && !st.paused;
    const est = clock.running && clock.id === id ? clock.pos + (now - clock.at) / 1000 : null;
    const truth = Number(st.position) || 0;
    clock.pos = running && est !== null && Math.abs(est - truth) < 1.5 ? est + (truth - est) * 0.2 : truth;
    clock.id = id; clock.at = now; clock.running = running;
  }
  const clockNow = () => (clock.running ? clock.pos + (performance.now() - clock.at) / 1000 : clock.pos);
  function tick() {
    const st = data?.status, t = st?.current;
    if (!t || t.live) { ui.fill.style.width = "0%"; ui.pos.textContent = t?.live ? "LIVE" : "0:00"; ui.dur.textContent = ""; return; }
    const p = clockNow(), q = Math.min(p, t.duration || p);
    ui.fill.style.width = t.duration ? Math.min(100, (q / t.duration) * 100) + "%" : "0%";
    ui.pos.textContent = fmt(q); ui.dur.textContent = t.duration ? fmt(t.duration) : "";
  }
  function setCount(tab, n) { const b = ui.tabs[tab].querySelector("b"); b.hidden = !n; b.textContent = String(n); }

  // ---------- loading ----------
  async function refresh() {
    try { data = await api("/api/music?guild=" + encodeURIComponent(gid)); } catch (e) { if (e.status === 401) return boot(); toast(e.message, "error"); return; }
    ui.ovStamp = performance.now();
    paint(true);
    try { guilds.find(g => g.id === gid).active = data.status.active; } catch { /* fine */ }
  }
  function loop() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => { if (!document.hidden) await refresh(); loop(); }, document.hidden ? 8000 : 2500);
  }
  function selectGuild(id, first) {
    gid = id; store.set("svc_music_guild", id);
    vizOpen(true);
    ui.radioLoaded = false; ui.qsig = ui.rsig = lastSig = ""; ui.mgrKey = ""; if (ui.ov) ui.ov.reload(); ui.results.replaceChildren(); ui.radioList.replaceChildren(h("p", { class: "mu-empty", text: "Open this tab to see stations." }));
    data = null; chatSince = 0; chatFirst = true; ui.msgs.replaceChildren();
    for (const [k, srv] of Object.entries(ui.srv)) srv.classList.toggle("on", k === id);
    refresh().then(() => { if (ui.panes.radio.classList.contains("on")) loadRadio(); });
    loop(); chatLoop();
  }

  // ---------- live visualizer: the bot measures the sound it sends to Discord and streams the levels here ----------
  const BANDS = 24, HOP = 1024, RATE = 48000;
  const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  let vizMode = store.get("svc_music_viz") || (reduced ? "off" : "bars"), vizDelay = Number(store.get("svc_music_viz_delay")) || 200;
  let es = null, vizQueue = [], vizLast = -1, vizLastM = 0, vizFresh = 0, vizColors = null;
  const cur = new Float32Array(BANDS), aim = new Float32Array(BANDS);
  const MODES = { bars: "Visualizer: bars", mirror: "Visualizer: mirror", off: "Visualizer: off" };
  function paintVizBtn() { ui.vizBtn.textContent = "✦ " + MODES[vizMode].replace("Visualizer: ", ""); ui.vizBtn.title = `${MODES[vizMode]}. Press V to change it, [ and ] to line it up with the sound.`; }
  function cycleViz() { vizMode = vizMode === "bars" ? "mirror" : vizMode === "mirror" ? "off" : "bars"; store.set("svc_music_viz", vizMode); paintVizBtn(); if (vizMode === "off") vizClose(); else vizOpen(); }
  function vizClose() { if (es) { es.close(); es = null; } }
  function vizOpen(fresh) {
    if (fresh) { vizClose(); vizQueue = []; vizLast = -1; vizLastM = 0; }
    if (vizMode === "off" || es || document.hidden || !window.EventSource || !gid) return;
    es = new EventSource("/api/music/viz?guild=" + encodeURIComponent(gid));
    es.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (!m.p) { vizFresh = 0; return; }
      ui.ov?.viz(m);
      const bin = atob(m.d), n = Math.floor(bin.length / BANDS), at = performance.now();
      if (m.m < vizLastM - 500 || m.f < vizLast - 100) { vizQueue = []; vizLast = m.f - 1; } // a new song, or a jump
      vizLastM = m.m;
      for (let i = 0; i < n; i++) {
        const idx = m.f + i; if (idx <= vizLast) continue; vizLast = idx;
        const v = new Uint8Array(BANDS); for (let b = 0; b < BANDS; b++) v[b] = bin.charCodeAt(i * BANDS + b);
        vizQueue.push({ at: at + ((idx * HOP) / RATE) * 1000 - m.m + vizDelay, v });
      }
      if (vizQueue.length > 200) vizQueue.splice(0, vizQueue.length - 200);
    };
    es.onerror = () => { if (es && es.readyState === 2) { es = null; } };
  }
  function sizeViz() {
    const r = ui.viz.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    ui.viz.width = Math.round(r.width * dpr); ui.viz.height = Math.round(r.height * dpr);
  }
  function vizFrame(t) {
    requestAnimationFrame(vizFrame);
    if (!built) return;
    const now = performance.now();
    let got = false;
    while (vizQueue.length && vizQueue[0].at <= now) { const f = vizQueue.shift(); for (let b = 0; b < BANDS; b++) aim[b] = f.v[b] / 255; got = true; vizFresh = now; }
    const live = now - vizFresh < 700 && data?.status?.playing;
    for (let b = 0; b < BANDS; b++) {
      const to = live ? aim[b] : 0;
      cur[b] = to > cur[b] ? cur[b] + (to - cur[b]) * 0.65 : cur[b] + (to - cur[b]) * (live ? 0.18 : 0.08); // rise quickly, fall gently
    }
    root.classList.toggle("viz-live", live && vizMode !== "off");
    if (live) { const eq = ui.eq.children; for (let i = 0; i < eq.length; i++) eq[i].style.transform = `scaleY(${Math.max(0.08, cur[Math.floor((i / eq.length) * BANDS)] ** 1.2).toFixed(3)})`; }
    else if (!root.classList.contains("playing")) for (const i of ui.eq.children) i.style.transform = "";
    const bass = (cur[0] + cur[1] + cur[2]) / 3;
    ui.art.style.setProperty("--pulse", (1.1 + bass * 0.07).toFixed(3));
    const c = ui.viz.getContext("2d"), W = ui.viz.width, H = ui.viz.height;
    c.clearRect(0, 0, W, H);
    if (vizMode === "off" || (!live && cur[0] < 0.01 && cur[8] < 0.01)) return;
    if (!vizColors) { const cs = getComputedStyle(document.documentElement); vizColors = [cs.getPropertyValue("--accent").trim() || "#4da3ff", cs.getPropertyValue("--accent-2").trim() || "#7c6cff"]; }
    const N = 56, gap = W / N, bw = gap * 0.64, lift = vizMode === "mirror" ? H / 2 : H;
    const grad = c.createLinearGradient(0, vizMode === "mirror" ? H * 0.2 : H * 0.35, 0, lift);
    grad.addColorStop(0, vizColors[1] + "00"); grad.addColorStop(1, vizColors[0] + (vizMode === "mirror" ? "55" : "66"));
    c.fillStyle = grad;
    for (let i = 0; i < N; i++) {
      const pos = (i / (N - 1)) * (BANDS - 1), lo = Math.floor(pos), v = cur[lo] + (cur[Math.min(BANDS - 1, lo + 1)] - cur[lo]) * (pos - lo);
      const h2 = Math.max(2, (v ** 1.35) * H * (vizMode === "mirror" ? 0.3 : 0.5)), x = i * gap + (gap - bw) / 2, r = Math.min(bw / 2, 10);
      c.beginPath();
      if (vizMode === "mirror") { c.roundRect(x, lift - h2, bw, h2 * 2, r); } else { c.roundRect(x, lift - h2, bw, h2 + r, [r, r, 0, 0]); }
      c.fill();
    }
  }

  // ---------- chat ----------
  function scrollChat(force) { const m = ui.msgs; if (force || m.scrollHeight - m.scrollTop - m.clientHeight < 90) m.scrollTop = m.scrollHeight; }
  function floatEmoji(emoji, name) {
    const s = h("span", {}, emoji, name ? h("small", { text: name }) : null);
    s.style.left = (8 + Math.random() * 84) + "%"; s.style.setProperty("--dx", ((Math.random() - .5) * 120) + "px");
    ui.float.append(s); s.addEventListener("animationend", () => s.remove());
  }
  // Chat on screen: new messages drift up over the player like the emoji do. Everything is plain text and kept small:
  // links are hidden, long messages are cut, stretched-out letters are squeezed, and only a few show at once.
  let floatChatOn = store.get("svc_music_floatchat") !== "0";
  const floatQueue = []; let floatTimer = 0;
  const FLOAT_MAX_ON_SCREEN = 4, FLOAT_MAX_QUEUE = 5, FLOAT_GAP_MS = 900, FLOAT_MAX_CHARS = 90;
  function paintChatBtn() { ui.chatBtn.textContent = floatChatOn ? "💬 On screen" : "💬 Off"; ui.chatBtn.setAttribute("aria-pressed", String(floatChatOn)); }
  /** What is safe and short enough to put on screen, or "" to skip the message. */
  function screenText(raw) {
    let t = String(raw ?? "").replace(/(https?:\/\/|www\.)\S+/gi, "🔗").replace(/\s+/g, " ").trim();
    t = t.replace(/(.)\1{5,}/gu, "$1$1$1$1$1");                // "aaaaaaaaaaaa" -> "aaaaa"
    t = t.split(" ").map(w => (w.length > 24 ? w.slice(0, 24) + "…" : w)).join(" "); // no one giant word
    if (!/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(t)) return "";    // nothing but symbols
    return t.length > FLOAT_MAX_CHARS ? t.slice(0, FLOAT_MAX_CHARS - 1).trimEnd() + "…" : t;
  }
  function floatMessage(m) {
    if (!floatChatOn || document.hidden || m.kind !== "msg") return;
    const text = screenText(m.text); if (!text) return;
    if (floatQueue.length >= FLOAT_MAX_QUEUE) floatQueue.shift(); // too busy: drop the oldest waiting one
    floatQueue.push({ name: String(m.name ?? "").slice(0, 24), text, mine: m.userId === me.user.id });
    if (!floatTimer) floatTimer = setTimeout(drainFloat, 0);
  }
  function drainFloat() {
    floatTimer = 0;
    if (!floatQueue.length) return;
    if (ui.float.querySelectorAll(".msg").length < FLOAT_MAX_ON_SCREEN) {
      const q = floatQueue.shift();
      const b = h("div", { class: "msg" + (q.mine ? " me" : "") }, h("b", { text: q.mine ? "You" : q.name }), h("span", { text: q.text }));
      b.style.left = (4 + Math.random() * 40) + "%"; b.style.setProperty("--dx", ((Math.random() - .5) * 80) + "px");
      ui.float.append(b); b.addEventListener("animationend", () => b.remove());
    }
    if (floatQueue.length) floatTimer = setTimeout(drainFloat, FLOAT_GAP_MS);
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
      if (!ui.msgs.querySelector(`[data-id="${m.id}"]`)) { ui.msgs.append(renderMsg(m)); if (!chatFirst) floatMessage(m); }
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

// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls MusicUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, busy, currentView, field, h, pageHead, select, state, toast } = ctx;
    const holder = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(pageHead("Music", "Play SoundCloud songs, playlists and live radio in a voice channel. Join one in your server, then add music here or with /play."), holder);
    const big = h("a", { class: "btn blue", href: "#", target: "_blank", rel: "noopener", text: "View the big music player ↗", title: "Opens the full-screen player with session chat" });
    app.insertBefore(h("div", { class: "row" }, big), holder);
    const fmt = sec => { sec = Math.max(0, Math.floor(sec || 0)); const hh = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60; return (hh ? hh + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
    const toSeconds = text => { const t = String(text).trim().toLowerCase(); if (/^\d+$/.test(t)) return Number(t); const m = t.match(/^(?:(\d+):)?(\d+):(\d{1,2})$/) || t.match(/^()(\d+):(\d{1,2})$/); if (m) return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]); return NaN; };
    const TIERS = { manager: ["Server manager", "You can change every music setting and control the player."], moderator: ["Moderator", "You can control the player and take down any request."], dj: ["DJ", "You can control the player."], listener: ["Listener", "You can add songs and vote to skip. Only DJs, moderators and managers use the other controls when this server has a DJ role."] };
    let list;
    try { list = (await api("/api/music")).guilds; } catch (e) { return holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    if (!list.length) return holder.replaceChildren(h("div", { class: "empty", text: "I don't share a server with you yet. Add the bot to a server, then come back." }));
    let saved = ""; try { saved = localStorage.getItem("svc_music_guild") || ""; } catch { /* storage blocked */ }
    const pick = h("select", { "aria-label": "Server" }, ...list.map(g => h("option", { value: g.id, text: g.name + (g.active ? "  ·  playing" : ""), selected: g.id === saved })));
    const body = h("div");
    let timer = 0, tick = 0, built = false, cur = null;
    const stop = () => { clearTimeout(timer); clearInterval(tick); };
    const alive = () => currentView() === "music" && document.body.contains(body);
    // The OBS overlay panel lives on this page (same panel as the music studio's Stream tab). It follows what is actually playing.
    let streamNote = null;
    function streamPanel(d) {
      if (!d.access?.canStream) return;
      if (!streamNote?.isConnected) { streamNote = h("div", { class: "notice" }, "The OBS overlay for what's playing moved to the ", h("a", { href: "#/overlays", text: "Overlay studio" }), "."); body.append(streamNote); }
    }
    const syncers = []; // little functions that re-check what the person is allowed to do after every refresh
    const typing = box => box && box.contains(document.activeElement) && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);

    async function load(rebuild) {
      if (rebuild && !built) body.replaceChildren(h("p", { class: "muted", text: "Loading…" }));
      let d;
      try { d = await api("/api/music?guild=" + encodeURIComponent(pick.value)); } catch (e) { return body.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
      cur = d;
      if (rebuild || !built) { built = true; build(d); } else update(d);
      clearTimeout(timer); timer = setTimeout(() => { if (alive()) load(false); }, 3000);
    }
    const bigLink = () => { const base = state.cfg?.musicUrl || "/music"; const q = base + (base.includes("?") ? "&" : "?") + "guild=" + encodeURIComponent(pick.value); big.href = q; };
    bigLink();
    pick.addEventListener("change", () => { bigLink(); try { localStorage.setItem("svc_music_guild", pick.value); } catch { /* fine */ } stop(); built = false; load(true); });

    const gid = () => pick.value;
    const act = (label, action, extra = {}, cls = "gray") => {
      const b = h("button", { class: "btn small " + cls, type: "button", text: label });
      b.addEventListener("click", () => busy(b, async () => {
        const r = await api("/api/music/control", { guild_id: gid(), action, ...extra });
        if (r.result && r.result.skipped === false) toast(`Vote to skip: ${r.result.votes}/${r.result.need}`, "ok");
        await load(false);
      }));
      return b;
    };
    const inChannel = a => a.present && a.enabled && a.inVoice && a.sameChannel;

    // ----- parts that refresh every few seconds -----
    const npBox = h("div", { class: "panel" }), queueBox = h("div", { class: "panel" }), reqBox = h("div", { class: "panel" });
    function paintNow(d) {
      const st = d.status, a = d.access, t = st.current, can = inChannel(a);
      const bar = h("div", { class: "bar" }), fill = h("div", { class: "fill" }); bar.append(fill);
      const pos = h("span", { class: "muted small" });
      const stamp = Date.now();
      const draw = () => { if (!t || t.live) return; const p = st.paused ? st.position : st.position + (Date.now() - stamp) / 1000; const q = Math.min(p, t.duration || p); fill.style.width = t.duration ? Math.min(100, (q / t.duration) * 100) + "%" : "0%"; pos.textContent = t.duration ? `${fmt(q)} / ${fmt(t.duration)}` : fmt(q); };
      clearInterval(tick); draw(); if (t && !t.live && !st.paused) tick = setInterval(() => { if (alive()) draw(); }, 1000);
      const vol = h("input", { type: "range", min: "1", max: "100", value: String(st.volume), "aria-label": "Volume", disabled: !can || !t || !a.dj });
      vol.addEventListener("change", () => api("/api/music/control", { guild_id: gid(), action: "volume", value: Number(vol.value) }).then(() => load(false)).catch(e => toast(e.message, "error")));
      const loopSel = select([["off", "Loop: off"], ["track", "Loop: this song"], ["queue", "Loop: whole queue"]], st.loop);
      loopSel.disabled = !can || !t || !a.dj;
      loopSel.addEventListener("change", () => api("/api/music/control", { guild_id: gid(), action: "loop", value: loopSel.value }).then(() => load(false)).catch(e => toast(e.message, "error")));
      const lock = b => { if (!can || !t) b.disabled = true; return b; };
      const seekIn = h("input", { type: "text", placeholder: "1:30", size: "6", "aria-label": "Jump to a time", disabled: !can || !t || t.live || !a.dj });
      const seekGo = h("button", { class: "btn gray small", type: "button", text: "Jump", disabled: !can || !t || t.live || !a.dj });
      seekGo.addEventListener("click", () => { const n = toSeconds(seekIn.value); if (!Number.isFinite(n)) return toast("Type a time like 1:30.", "error"); busy(seekGo, async () => { await api("/api/music/control", { guild_id: gid(), action: "seek", value: n }); await load(false); }); });
      const sub = [t?.artist, st.paused ? "paused" : "playing", st.channelName ? "in " + st.channelName : ""].filter(Boolean).join(" · ");
      const tag = t?.live ? h("span", { class: "chip bad", text: "● LIVE" }) : t?.auto ? h("span", { class: "chip", text: "Auto DJ" }) : t?.submitted ? h("span", { class: "chip ok", text: "Member request" }) : "";
      const role = TIERS[a.tier] ?? TIERS.listener;
      const dj = !a.dj ? h("p", { class: "muted small", text: "This server uses a DJ role, so only DJs, moderators and managers can pause, shuffle or change the volume. You can still add songs and vote to skip." }) : "";
      const note = !a.enabled ? "Music is turned off in this server." : !a.inVoice ? "Join a voice channel in this server to add songs or use the controls." : !a.sameChannel ? "I'm playing in another voice channel. Join it to use the controls." : `You're in ${a.voiceName}.`;
      npBox.replaceChildren(h("h3", { text: "Now playing" }),
        t ? h("div", { class: "music-now" },
          t.thumb ? h("img", { src: t.thumb, alt: "", width: "96", height: "96", referrerpolicy: "no-referrer" }) : h("span", { class: "noimg", text: t.live ? "📻" : "" }),
          h("div", { class: "music-meta" }, h("div", {}, t.live ? h("span", { text: t.title }) : h("a", { href: t.url, target: "_blank", rel: "noopener noreferrer", text: t.title + " ↗" }), " ", tag), h("div", { class: "muted small", text: sub }), t.live ? h("div", { class: "muted small", text: "Live stream, no end" }) : bar, t.live ? "" : pos))
          : h("p", { class: "muted", text: st.active ? (st.auto.waiting ? `Waiting in ${st.channelName ?? "the voice channel"} for someone to join. ` + (d.autodj.lastStation && d.settings.radio ? `It goes back to ${d.autodj.lastStation}.` : st.auto.on ? "It starts the Auto DJ." : "Add something to get it going.") : st.auto.on ? "The queue is empty. The Auto DJ will start in a moment." : "The queue is empty. Add something below.") : "Nothing is playing." }),
        h("div", { class: "row" }, lock(act("⏮", "previous")), lock(act(st.paused ? "▶ Resume" : "⏸ Pause", st.paused ? "resume" : "pause", {}, st.paused ? "green" : "blue")), lock(act("⏭ Skip", "skip")), lock(act("⏹ Stop", "stop", {}, "red")), lock(act("🔀 Shuffle", "shuffle")), lock(act("Leave", "leave"))),
        h("div", { class: "row" }, field("Volume " + st.volume + "%", vol), field("Loop", loopSel), field("Jump to", h("div", { class: "row" }, seekIn, seekGo))),
        h("p", { class: "muted small", text: note }), h("p", { class: "muted small" }, h("b", { text: role[0] + ": " }), role[1]), dj);
    }
    function paintQueue(d) {
      const st = d.status, can = inChannel(d.access);
      const rows = st.next.map((x, i) => h("div", { class: "cal-row" }, h("span", { class: "muted", text: String(i + 1) }),
        h("div", {}, x.live ? h("span", { text: x.title }) : h("a", { href: x.url, target: "_blank", rel: "noopener noreferrer", text: x.title }), h("div", { class: "muted small", text: [x.artist, x.live ? "live" : x.duration ? fmt(x.duration) : ""].filter(Boolean).join(" · ") })),
        h("div", { class: "row" }, ...(can ? [act("⏭", "skipto", { n: i + 1 }), ...(i > 0 ? [act("▲", "move", { from: i + 1, to: i })] : []), act("✕", "remove", { n: i + 1 }, "red")] : []))));
      queueBox.replaceChildren(h("h3", { text: `Queue (${st.total} song${st.total === 1 ? "" : "s"}${st.totalSeconds ? " · " + fmt(st.totalSeconds) : ""})` }),
        rows.length ? h("div", { class: "scroll-y tall" }, ...rows) : h("p", { class: "muted", text: "Nothing waiting." }),
        rows.length && can && d.access.dj ? h("div", { class: "row" }, act("Clear the queue", "clear", {}, "red")) : "");
    }
    function paintReqs(d) {
      const s = d.settings, a = d.access, subs = d.submissions;
      reqBox.style.display = s.autodj ? "" : "none";
      if (!s.autodj) return;
      if (typing(reqBox)) return;
      const q = h("input", { type: "text", placeholder: "SoundCloud song or playlist link, or words to search", maxlength: "300", "aria-label": "Request a song" });
      const go = h("button", { class: "btn green", type: "button", text: "Request" }), find = h("button", { class: "btn blue", type: "button", text: "Search" });
      const results = h("div");
      go.disabled = find.disabled = !(a.enabled && s.autodj_submit);
      const send = (extra = {}) => api("/api/music/submit", { guild_id: gid(), query: q.value, ...extra }).then(r => { toast(r.added > 1 ? `Requested ${r.added} songs.` : "Requested. It plays before the Auto DJ's own songs.", "ok"); q.value = ""; results.replaceChildren(); return load(false); });
      go.addEventListener("click", () => busy(go, () => send()));
      q.addEventListener("keydown", e => { if (e.key === "Enter" && !go.disabled) go.click(); });
      find.addEventListener("click", () => busy(find, async () => {
        const r = await api("/api/music/search?guild=" + encodeURIComponent(gid()) + "&q=" + encodeURIComponent(q.value));
        results.replaceChildren(r.results.length ? h("div", { class: "cards" }, ...r.results.map(x => { const b = h("button", { class: "btn green small", type: "button", text: "Request" }); b.addEventListener("click", () => busy(b, () => send({ query: "", tracks: [x] }))); return h("div", { class: "note-game" }, x.thumb ? h("img", { src: x.thumb, alt: "", width: "56", height: "56", referrerpolicy: "no-referrer" }) : h("span", { class: "noimg" }), h("div", { class: "note-info" }, h("a", { href: x.url, target: "_blank", rel: "noopener noreferrer", text: x.title + " ↗" }), h("span", { class: "muted small", text: [x.artist, x.duration ? fmt(x.duration) : ""].filter(Boolean).join(" · ") })), b); })) : h("p", { class: "muted", text: "No results." }));
      }));
      const rows = subs.map(r => h("div", { class: "cal-row" }, r.thumb ? h("img", { src: r.thumb, alt: "", width: "40", height: "40", referrerpolicy: "no-referrer" }) : h("span", { class: "noimg" }),
        h("div", {}, h("a", { href: r.url, target: "_blank", rel: "noopener noreferrer", text: r.title }), h("div", { class: "muted small", text: [r.artist, "requested by " + (r.mine ? "you" : r.name)].filter(Boolean).join(" · ") })),
        (r.mine || a.dj) ? (() => { const b = h("button", { class: "btn red small", type: "button", text: "✕", title: "Take it off the list" }); b.addEventListener("click", () => busy(b, async () => { await api("/api/music/submission", { guild_id: gid(), id: r.id }); await load(false); })); return b; })() : ""));
      const clearBtn = (a.dj && subs.length > 1) ? (() => { const b = h("button", { class: "btn red small", type: "button", text: "Clear all requests" }); b.addEventListener("click", () => { if (!confirm("Remove every request from the list?")) return; busy(b, async () => { await api("/api/music/submission", { guild_id: gid(), action: "clear" }); await load(false); }); }); return b; })() : "";
      reqBox.replaceChildren(h("h3", { text: `Auto DJ requests (${subs.length} waiting)` }),
        h("p", { class: "muted small", text: s.autodj_submit ? "Ask for songs without being in the voice channel. The Auto DJ plays requests, oldest first, before its own playlist. Up to 5 waiting per person." : "Requests are turned off in this server." }),
        s.autodj_submit ? h("div", { class: "lookup-row" }, q, go, find) : "", results,
        subs.length ? h("div", { class: "scroll-y tall" }, ...rows) : h("p", { class: "muted", text: "No requests right now." }), clearBtn);
    }
    function update(d) { paintNow(d); paintQueue(d); paintReqs(d); streamPanel(d); for (const f of syncers) f(d); }

    // ----- parts that stay put while you type -----
    function addPanel(d) {
      const q = h("input", { type: "text", placeholder: "SoundCloud link (song or playlist), a live radio stream link, or words to search for", maxlength: "300", "aria-label": "Song, playlist, stream link or search" });
      const next = h("input", { type: "checkbox" }), shuf = h("input", { type: "checkbox" });
      const results = h("div");
      const play = h("button", { class: "btn green", type: "button", text: "Play" }), find = h("button", { class: "btn blue", type: "button", text: "Search" });
      const add = (extra = {}) => api("/api/music/play", { guild_id: gid(), query: q.value, next: next.checked, shuffle: shuf.checked, ...extra }).then(r => { toast(r.startedNow ? `Playing: ${r.title}` : r.added > 1 ? `Added ${r.added} songs.` : "Added to the queue.", "ok"); q.value = ""; results.replaceChildren(); return load(false); });
      play.addEventListener("click", () => busy(play, () => add()));
      q.addEventListener("keydown", e => { if (e.key === "Enter" && !play.disabled) play.click(); });
      find.addEventListener("click", () => busy(find, async () => {
        const r = await api("/api/music/search?guild=" + encodeURIComponent(gid()) + "&q=" + encodeURIComponent(q.value));
        results.replaceChildren(r.results.length ? h("div", { class: "cards" }, ...r.results.map(x => { const b = h("button", { class: "btn green small", type: "button", text: "Add" }); b.addEventListener("click", () => busy(b, () => add({ query: "", tracks: [x] }))); return h("div", { class: "note-game" }, x.thumb ? h("img", { src: x.thumb, alt: "", width: "56", height: "56", referrerpolicy: "no-referrer" }) : h("span", { class: "noimg" }), h("div", { class: "note-info" }, h("a", { href: x.url, target: "_blank", rel: "noopener noreferrer", text: x.title + " ↗" }), h("span", { class: "muted small", text: [x.artist, x.duration ? fmt(x.duration) : ""].filter(Boolean).join(" · ") })), b); })) : h("p", { class: "muted", text: "No results." }));
      }));
      syncers.push(d2 => { play.disabled = find.disabled = !inChannel(d2.access); });
      return h("div", { class: "panel" }, h("h3", { text: "Add music" }), h("div", { class: "lookup-row" }, q, play, find),
        h("div", { class: "row" }, h("label", { class: "check" }, next, " Play next"), h("label", { class: "check" }, shuf, " Shuffle if it's a playlist")),
        h("p", { class: "muted small", text: "Paste a SoundCloud song, playlist (set) or artist link to queue it all (up to 100 songs), or a live radio stream link (an Icecast or Shoutcast address like https://play.sas-media.ru/play_256), or type words and press Search." }), results);
    }
    function stationsPanel(d) {
      const out = h("div"), chips = h("div", { class: "row" }), btn = h("button", { class: "btn blue small", type: "button", text: "Show stations on the air" });
      let data = null, cat = "";
      const paint = () => {
        chips.replaceChildren(...[{ id: "", name: "All" }, ...data.categories].map(c => { const b = h("button", { class: "btn small " + (c.id === cat ? "blue" : "gray"), type: "button", text: c.name }); b.addEventListener("click", () => { cat = c.id; paint(); }); return b; }));
        const list = data.stations.filter(x => !cat || x.cat === cat);
        out.replaceChildren(list.length ? h("div", { class: "scroll-y tall" }, ...list.map(x => { const b = h("button", { class: "btn green small", type: "button", text: "Play" }); b.disabled = !inChannel(cur.access) || !cur.settings.radio; b.addEventListener("click", () => busy(b, async () => { const p = await api("/api/music/play", { guild_id: gid(), query: x.url }); toast(p.startedNow ? `Playing: ${x.title}` : "Added to the queue.", "ok"); await load(false); })); return h("div", { class: "cal-row" }, h("span", { text: "📻" }), h("div", {}, h("b", { text: x.title }), h("div", { class: "muted small", text: x.genre ?? "" })), b); })) : h("p", { class: "muted", text: data.stations.length ? "No stations of that kind are on the air right now." : "None of the stations answered just now. Try again in a minute." }));
      };
      btn.addEventListener("click", () => busy(btn, async () => { data = await api("/api/music/stations?guild=" + encodeURIComponent(gid())); paint(); }));
      return h("div", { class: "panel" }, h("h3", { text: "Live radio" }), h("p", { class: "muted small", text: d.settings.radio ? "Hip hop, R&B, dance, chill, rock, throwbacks and more. Stations are checked when you ask, so everything listed is on the air. You can also paste any stream link above." : "Live radio is turned off in this server. A manager can allow it below." }), h("div", { class: "row" }, btn), chips, out);
    }
    function playlistsPanel(d) {
      const pname = h("input", { type: "text", maxlength: "40", placeholder: "Name for a new playlist", "aria-label": "Playlist name" });
      const saveBtn = h("button", { class: "btn blue small", type: "button", text: "Save current queue" });
      saveBtn.addEventListener("click", () => busy(saveBtn, async () => { await api("/api/music/playlists", { guild_id: gid(), action: "save", name: pname.value }); toast("Saved.", "ok"); await load(true); }));
      const rows = d.playlists.map(p => { const lb = h("button", { class: "btn green small", type: "button", text: "Queue it" }), db2 = h("button", { class: "btn red small", type: "button", text: "Delete" });
        syncers.push(d2 => { lb.disabled = !inChannel(d2.access); });
        lb.addEventListener("click", () => busy(lb, async () => { const r = await api("/api/music/playlists", { guild_id: gid(), action: "load", name: p.name }); toast(`Added ${r.added} songs.`, "ok"); await load(false); }));
        db2.addEventListener("click", () => { if (!confirm("Delete this playlist?")) return; busy(db2, async () => { await api("/api/music/playlists", { guild_id: gid(), action: "delete", name: p.name }); await load(true); }); });
        return h("div", { class: "row", style: "align-items:center;justify-content:space-between" }, h("span", {}, h("b", { text: p.name }), h("span", { class: "muted small", text: `  ${p.count} song${p.count === 1 ? "" : "s"}` })), h("div", { class: "row" }, lb, db2)); });
      return h("div", { class: "panel" }, h("h3", { text: "My playlists" }), h("p", { class: "muted small", text: "Saved to your account, so you can load them in any server. Up to 10 playlists of 100 songs." }),
        ...(rows.length ? rows : [h("p", { class: "muted", text: "None yet." })]), h("div", { class: "lookup-row" }, pname, saveBtn));
    }
    function autoPanel(d) {
      const s = d.settings;
      const on = h("input", { type: "checkbox", checked: Boolean(s.autodj) }), sub = h("input", { type: "checkbox", checked: Boolean(s.autodj_submit) }), shuf = h("input", { type: "checkbox", checked: Boolean(s.autodj_shuffle) });
      const idle = h("input", { type: "number", min: "5", max: "600", value: String(s.autodj_idle) });
      const vc = h("select", {}, h("option", { value: "", text: "Only when someone starts it (stays in the channel it's already in)" }), ...(d.voiceChannels ?? []).map(c => h("option", { value: c.id, text: "🔊 " + c.name, selected: c.id === s.autodj_channel_id })));
      const link = h("input", { type: "text", maxlength: "300", placeholder: "SoundCloud playlist link", "aria-label": "Auto DJ playlist link" });
      const savedSel = select([["", "Or use one of my saved playlists…"], ...d.playlists.map(p => [p.name, `${p.name} (${p.count})`])], "");
      const save = h("button", { class: "btn green", type: "button", text: "Save Auto DJ settings" });
      const call = (extra, ok) => api("/api/music/autodj", { guild_id: gid(), ...extra }).then(r => { toast(r.note || ok || "Saved.", "ok"); return load(true); });
      save.addEventListener("click", () => busy(save, () => call({ autodj: on.checked, autodj_submit: sub.checked, autodj_shuffle: shuf.checked, autodj_idle: Number(idle.value), autodj_channel_id: vc.value })));
      const setLink = h("button", { class: "btn blue small", type: "button", text: "Use this playlist" });
      setLink.addEventListener("click", () => busy(setLink, () => call({ playlist_url: link.value })));
      const useSaved = h("button", { class: "btn blue small", type: "button", text: "Use it" });
      useSaved.addEventListener("click", () => { if (!savedSel.value) return toast("Pick a saved playlist first.", "error"); busy(useSaved, () => call({ saved_playlist: savedSel.value })); });
      const clr = h("button", { class: "btn red small", type: "button", text: "Remove playlist" });
      clr.addEventListener("click", () => { if (!confirm("Remove the Auto DJ's playlist?")) return; busy(clr, () => call({ clear_playlist: true })); });
      const pl = d.autodj.playlist;
      const preview = pl.length ? h("div", { class: "scroll-y tall" }, ...pl.slice(0, 50).map((t, i) => h("div", { class: "cal-row" }, h("span", { class: "muted", text: String(i + 1) }), t.thumb ? h("img", { src: t.thumb, alt: "", width: "40", height: "40", referrerpolicy: "no-referrer", loading: "lazy" }) : h("span", { class: "noimg" }), h("div", {}, h("a", { href: t.url, target: "_blank", rel: "noopener noreferrer", text: t.title }), h("div", { class: "muted small", text: [t.artist, t.duration ? fmt(t.duration) : ""].filter(Boolean).join(" · ") }))))) : h("p", { class: "muted", text: "No playlist yet. Paste a SoundCloud playlist link above." });
      return h("div", { class: "panel" }, h("h3", { text: "Auto DJ" }),
        h("p", { class: "muted small", text: "Keeps music going. When the bot sits in a voice channel with nothing playing for a while, it starts the playlist you choose. Members' requests play first, and anyone's /play beats the playlist right away. Turn on \"Stay in the last voice channel\" in the server settings below and the bot also waits there when everyone has left, then picks the last live station back up (or starts this playlist) when someone joins." }),
        h("label", { class: "check" }, on, " Auto DJ is on"), h("label", { class: "check" }, sub, " Members can request songs (even from outside the voice channel)"), h("label", { class: "check" }, shuf, " Shuffle the playlist"),
        h("div", { class: "row" }, field("Start after this many seconds of silence", idle), field("Join this voice channel by itself", vc)),
        save, h("hr"), h("h4", { text: `Playlist (${d.autodj.count} songs${s.autodj_source && /^https?:/.test(s.autodj_source) ? "" : ""})` }),
        h("div", { class: "lookup-row" }, link, setLink), h("div", { class: "lookup-row" }, savedSel, useSaved), d.autodj.count ? h("div", { class: "row" }, clr) : "", preview);
    }
    function settingsPanel(d) {
      const s = d.settings;
      const on = h("input", { type: "checkbox", checked: Boolean(s.enabled) }), ann = h("input", { type: "checkbox", checked: Boolean(s.announce) }), vcs = h("input", { type: "checkbox", checked: Boolean(s.vc_status) }), stay = h("input", { type: "checkbox", checked: Boolean(s.stay) }), radio = h("input", { type: "checkbox", checked: Boolean(s.radio) });
      const num = (v, lo, hi) => h("input", { type: "number", min: String(lo), max: String(hi), value: String(v) });
      const vol = num(s.volume, 1, 100), mq = num(s.max_queue, 5, 500), mm = num(s.max_minutes, 0, 600), lv = num(s.leave_minutes, 1, 60);
      const role = h("select", {}, h("option", { value: "", text: "Everyone can use the controls" }), ...d.roles.filter(r => r.id !== d.guild.id).map(r => h("option", { value: r.id, text: "DJ role: " + r.name, selected: r.id === s.dj_role_id })));
      const chan = h("select", {}, h("option", { value: "", text: "Where the song was added from" }), ...d.channels.map(c => h("option", { value: c.id, text: "#" + c.name, selected: c.id === s.channel_id })));
      const save = h("button", { class: "btn green", type: "button", text: "Save music settings" });
      save.addEventListener("click", () => busy(save, async () => { await api("/api/music/settings", { guild_id: gid(), enabled: on.checked, announce: ann.checked, vc_status: vcs.checked, stay: stay.checked, radio: radio.checked, volume: Number(vol.value), max_queue: Number(mq.value), max_minutes: Number(mm.value), leave_minutes: Number(lv.value), dj_role_id: role.value, channel_id: chan.value }); toast("Saved.", "ok"); await load(true); }));
      return h("div", { class: "panel" }, h("h3", { text: "Server music settings" }), h("p", { class: "muted small", text: "Only people with Manage Server see this. Moderators (the role from community setup) can always use the DJ controls. The bot needs Connect and Speak in your voice channels, plus Send Messages where it posts." }),
        h("label", { class: "check" }, on, " Music is on"), h("label", { class: "check" }, ann, " Post a message when each song starts"), h("label", { class: "check" }, vcs, " Show the song as the voice channel's status (the line under its name)"), h("label", { class: "check" }, stay, " Stay in the last voice channel and wait for people (goes back to the last live station, or starts the Auto DJ, when someone joins)"), h("label", { class: "check" }, radio, " Allow live radio stream links"),
        h("div", { class: "row" }, field("Controls", role), field("Now-playing messages go to", chan)),
        h("div", { class: "row" }, field("Starting volume (1-100)", vol), field("Most songs in the queue", mq), field("Longest song, minutes (0 = no limit)", mm), field("Leave after idle (minutes)", lv)), save);
    }
    function build(d) {
      clearInterval(tick); syncers.length = 0;
      body.replaceChildren(npBox, addPanel(d), stationsPanel(d), queueBox, reqBox, playlistsPanel(d), ...(d.channels ? [autoPanel(d), settingsPanel(d)] : [])); streamPanel(d);
      reqBox.replaceChildren();
      update(d);
    }

    holder.className = ""; holder.replaceChildren(field("Server", pick), body);
    load(true);
  }
  root.MusicUI = { view };
})(window);

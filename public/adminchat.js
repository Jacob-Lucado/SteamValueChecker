// The staff chat window: channels and direct messages on the left, the conversation in the middle, who's around on the right.
// It asks the server for new messages every few seconds while it is open and visible.
(function (root) {
  "use strict";
  const COLORS = ["#7c6cff", "#3b9fe8", "#e0527f", "#2fb67c", "#e08a2b", "#b45fd1", "#d9534f", "#3aa8a8"];
  const colorOf = key => { let n = 0; for (const c of String(key)) n = (n * 31 + c.charCodeAt(0)) >>> 0; return COLORS[n % COLORS.length]; };
  const clock = at => new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const dayName = at => { const d = new Date(at), t = new Date(); return d.toDateString() === t.toDateString() ? "Today" : d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }); };
  const dmId = (a, b) => "dm:" + [a, b].sort().join(":");

  const REACTS = ["👍", "❤️", "😂", "🎉", "👀", "✅", "🙏", "🔥"];
  const KEY = "lucado-chat-prefs";
  const prefs = { desk: true, sound: true, muted: [] };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { /* storage may be blocked */ }
  const savePrefs = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* fine */ } };
  let audio = null;
  function beep() {
    if (!prefs.sound) return;
    try {
      audio = audio || new (root.AudioContext || root.webkitAudioContext)();
      const o = audio.createOscillator(), g = audio.createGain(); o.type = "sine"; o.frequency.value = 880; g.gain.value = 0.05;
      o.connect(g); g.connect(audio.destination); o.start(); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.25); o.stop(audio.currentTime + 0.26);
    } catch { /* no sound is fine */ }
  }
  const live = { room: null, onTab: () => false, toast: null, total: 0 };
  /** One heads-up: a toast inside the panel, a desktop notification when the tab isn't in front, and a short sound. */
  function ping(title, body, tag, room) {
    if (room && prefs.muted.includes(room)) return;
    beep();
    if (live.toast && document.hasFocus() && !document.hidden) live.toast(`${title}: ${body}`);
    if (prefs.desk && root.Notification && Notification.permission === "granted" && (document.hidden || !document.hasFocus())) {
      try { const n = new Notification(title, { body, tag }); n.onclick = () => { root.focus(); location.hash = "#/chat"; root.AdminOS?.open?.("chat"); n.close(); }; } catch { /* some browsers need a service worker */ }
    }
  }
  const baseTitle = document.title;
  function setTitleCount(n) { live.total = n; if (!/^\(\d+\) /.test(document.title) && !n) return; document.title = (n ? `(${n}) ` : "") + document.title.replace(/^\(\d+\) /, ""); }
  /** Runs for the whole time the panel is open, even when the chat window is closed. */
  function watch({ api, toast }) {
    if (live.watching) return; live.watching = true; live.toast = toast;
    let base = null;
    const tick = async () => {
      if (!document.getElementById("adm") && !document.querySelector(".adm-os")) { /* keep going: either layout counts */ }
      try {
        const [c, t, r] = await Promise.all([api("/api/admin/chat/state"), api("/api/admin/chat/tickets").catch(() => null), api("/api/admin/chat/requests").catch(() => null)]);
        const cur = { unread: c.unread || {}, tickets: new Set((t?.tickets || []).map(x => x.id)), reqs: new Set((r?.requests || []).map(x => x.id)) };
        const names = Object.fromEntries(c.channels.map(x => [x.id, "#" + x.name]));
        if (base) {
          for (const [room, n] of Object.entries(cur.unread)) if (n > (base.unread[room] || 0) && !(live.room === room && document.hasFocus() && !document.hidden)) {
            const l = c.latest?.[room], mention = (c.mentions?.[room] || 0) > (base.mentions?.[room] || 0), dm = room.startsWith("dm:");
            ping(mention ? `${l?.name || "Someone"} mentioned you` : dm ? (l?.name || "New message") : `${l?.name || "Someone"} in ${names[room] || room}`, l?.body || "New message", "chat-" + room, room);
          }
          for (const x of t?.tickets || []) if (!base.tickets.has(x.id) && ["open", "waiting"].includes(x.status)) ping(x.bug ? "New bug report" : "New support ticket", x.subject, "tk-" + x.id);
          for (const x of r?.requests || []) if (!base.reqs.has(x.id) && x.status === "open") ping("New feature request", x.title, "rq-" + x.id);
        }
        base = { ...cur, mentions: c.mentions };
        const n = Object.entries(cur.unread).filter(([room]) => !prefs.muted.includes(room)).reduce((a, [, v]) => a + v, 0) + (t?.open || 0);
        setTitleCount(n);
        document.querySelectorAll('[data-badge="chat"]').forEach(b => { b.hidden = !n; b.textContent = String(n); });
      } catch { /* the next tick tries again */ }
    };
    tick(); setInterval(() => { if (!document.hidden || prefs.desk) tick(); }, 7000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
  }

  function mount(host, { h, api, toast }) {
    host.classList.add("sc-host");
    let st = null, room = null, last = 0, timer = 0, replyTo = null, shown = [], busyPoll = false, tkFilter = "active", tkOpen = 0, tkId = 0, rqOpen = 0, editing = null, lastTyped = 0, pending = null;
    const side = h("aside", { class: "sc-side" }), people = h("aside", { class: "sc-people" });
    const title = h("div", { class: "sc-title" }), log = h("div", { class: "sc-log", role: "log", "aria-live": "polite" });
    const replyBar = h("div", { class: "sc-replybar", hidden: "" });
    const input = h("textarea", { class: "sc-input", rows: "1", maxlength: "1000", placeholder: "Message the room. Enter sends, Shift+Enter makes a new line.", "aria-label": "Message" });
    const sendBtn = h("button", { type: "button", class: "sc-send", "aria-label": "Send", text: "➤" });
    const fileIn = h("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/quicktime", hidden: "" });
    const attachBtn = h("button", { type: "button", class: "sc-attach", title: "Add a picture or clip", "aria-label": "Add a picture or clip", text: "📎" });
    const preview = h("div", { class: "sc-preview", hidden: "" });
    const compose = h("div", { class: "sc-compose" }, attachBtn, input, sendBtn, fileIn), tk = h("div", { class: "sc-tk", hidden: "" });
    const typingLine = h("div", { class: "sc-typing", "aria-live": "polite" });
    const main = h("section", { class: "sc-main" }, title, log, typingLine, replyBar, preview, compose, tk);
    const wrap = h("div", { class: "sc" }, side, main, people);
    host.replaceChildren(wrap);

    const me = () => st.me;
    const person = key => st.people.find(p => p.key === key) || { key, name: "Someone", role: "staff" };
    const roomName = () => room === "requests" ? "Feature requests" : room === "tickets" ? "Tickets and bugs" : room.startsWith("dm:") ? "@ " + person(room.slice(3).split(":").find(k => k !== me().key)).name : "# " + room;
    const unreadOf = id => prefs.muted.includes(id) ? 0 : (st.unread[id] || 0);

    function drawSide() {
      const chans = st.channels.map(c => { const b = h("button", { type: "button", class: "sc-room" + (room === c.id ? " on" : ""), title: c.topic }, h("span", { text: "# " + c.name }), unreadOf(c.id) ? h("i", { class: "sc-badge", text: String(unreadOf(c.id)) }) : null); b.addEventListener("click", () => open(c.id)); return b; });
      const dms = st.people.filter(p => p.key !== me().key).map(p => { const id = dmId(me().key, p.key); const b = h("button", { type: "button", class: "sc-room" + (room === id ? " on" : "") }, h("span", { class: "sc-dot" + (p.online ? " on" : ""), "aria-hidden": "true" }), h("span", { text: p.name }), unreadOf(id) ? h("i", { class: "sc-badge", text: String(unreadOf(id)) }) : null); b.addEventListener("click", () => open(id)); return b; });
      const add = me().owner ? h("button", { type: "button", class: "sc-add", title: "New channel", "aria-label": "New channel", text: "+" }) : null;
      add?.addEventListener("click", async () => { const n = prompt("Name for the new channel (letters, numbers and dashes):"); if (!n) return; try { await api("/api/admin/chat/channel", { name: n }); await loadState(); } catch (e) { toast(e.message); } });
      side.replaceChildren(h("div", { class: "sc-brand" }, h("b", { text: "Staff chat" }), h("small", { text: "Just the people who run this" }), h("button", { type: "button", class: "sc-gear", title: "Notifications", "aria-label": "Notification settings", text: "🔔", onclick: settings })),
        h("div", { class: "sc-group" }, h("span", { text: "Channels" }), add), ...chans,
        h("div", { class: "sc-group" }, h("span", { text: "Support" })),
        (() => { const b = h("button", { type: "button", class: "sc-room" + (room === "tickets" ? " on" : "") }, h("span", { text: "🎫 Tickets and bugs" }), tkOpen ? h("i", { class: "sc-badge", text: String(tkOpen) }) : null); b.addEventListener("click", () => open("tickets")); return b; })(),
        (() => { const b = h("button", { type: "button", class: "sc-room" + (room === "requests" ? " on" : "") }, h("span", { text: "✎ Feature requests" }), rqOpen ? h("i", { class: "sc-badge", text: String(rqOpen) }) : null); b.addEventListener("click", () => open("requests")); return b; })(),
        h("div", { class: "sc-group" }, h("span", { text: "Direct messages" })), ...(dms.length ? dms : [h("p", { class: "muted small sc-nobody", text: "Nobody else here yet." })]));
    }

    function settings() {
      const old = wrap.querySelector(".sc-pop"); if (old) { old.remove(); return; }
      const row = (label, key) => { const c = h("input", { type: "checkbox" }); c.checked = prefs[key]; c.addEventListener("change", () => { prefs[key] = c.checked; savePrefs(); if (key === "desk" && c.checked && root.Notification && Notification.permission === "default") Notification.requestPermission().then(drawPerm); }); return h("label", { class: "sc-set" }, c, h("span", { text: label })); };
      const perm = h("p", { class: "muted small" }); const drawPerm = () => { perm.textContent = !root.Notification ? "This browser can't show desktop notifications." : Notification.permission === "granted" ? "Desktop notifications are on." : Notification.permission === "denied" ? "Desktop notifications are blocked in your browser's site settings." : "Your browser will ask to allow them."; }; drawPerm();
      const muteBtn = h("button", { type: "button", class: "btn gray small", text: prefs.muted.includes(room) ? "Unmute this room" : "Mute this room", onclick: () => { const i = prefs.muted.indexOf(room); i >= 0 ? prefs.muted.splice(i, 1) : prefs.muted.push(room); savePrefs(); pop.remove(); drawSide(); } });
      const test = h("button", { type: "button", class: "btn gray small", text: "Send a test", onclick: () => ping("Staff chat", "This is what a notification looks like.", "test") });
      const ask = h("button", { type: "button", class: "btn small", text: "Allow desktop notifications", onclick: () => root.Notification?.requestPermission().then(drawPerm) });
      const pop = h("div", { class: "sc-pop", role: "dialog", "aria-label": "Notification settings" }, h("b", { text: "Notifications" }), row("Desktop notifications", "desk"), row("Play a sound", "sound"), perm,
        root.Notification && Notification.permission === "default" ? ask : null, h("div", { class: "sc-popbtns" }, room && room !== "tickets" && room !== "requests" ? muteBtn : null, test));
      wrap.append(pop);
    }
    function drawPeople() {
      const by = (role, label) => { const list = st.people.filter(p => (role === "staff" ? p.role !== "owner" && p.role !== "admin" : p.role === role)); if (!list.length) return []; return [h("div", { class: "sc-group" }, h("span", { text: `${label} · ${list.length}` })), ...list.map(p => h("div", { class: "sc-person" + (p.online ? "" : " off") }, face(p.key, p.name, false), h("span", { text: p.name + (p.key === me().key ? " (you)" : "") }), h("i", { class: "sc-dot" + (p.online ? " on" : ""), "aria-hidden": "true" })))]; };
      people.replaceChildren(h("div", { class: "sc-brand" }, h("b", { text: "People" }), h("small", { text: `${st.people.filter(p => p.online).length} online` })), ...by("owner", "Owner"), ...by("admin", "Admins"), ...by("staff", "Staff"));
    }
    function drawTitle() { title.replaceChildren(h("b", { text: roomName() }), h("span", { class: "muted small", text: room === "requests" ? "What members are asking for. Set a status and they get told." : room === "tickets" ? "Every support ticket and bug report, answered right here" : room.startsWith("dm:") ? "Only the two of you can see this" : (st.channels.find(c => c.id === room)?.topic || "") }),
      me().owner && room !== "tickets" && room !== "requests" && !room.startsWith("dm:") && !["general", "support"].includes(room) ? h("button", { type: "button", class: "btn gray small", text: "Delete channel", onclick: async () => { if (!confirm(`Delete #${room} and everything said in it?`)) return; try { await api("/api/admin/chat/channel/delete", { id: room }); await loadState(); open("general"); } catch (e) { toast(e.message); } } }) : null); }


    const chips = m => { const keys = Object.keys(m.reactions || {}); if (!keys.length) return null;
      return h("div", { class: "sc-reacts" }, ...keys.map(e => { const who = m.reactions[e], b = h("button", { type: "button", class: "sc-react" + (who.includes(me().key) ? " on" : ""), title: who.map(k => person(k).name).join(", "), text: `${e} ${who.length}` }); b.addEventListener("click", () => react(m, e)); return b; })); };
    async function react(m, emoji) { try { await api("/api/admin/chat/react", { id: m.id, emoji }); await load(true); } catch (e) { toast(e.message); } }
    function reactPicker(m, anchor) {
      wrap.querySelector(".sc-picker")?.remove();
      const p = h("div", { class: "sc-picker" }, ...REACTS.map(e => h("button", { type: "button", text: e, onclick: () => { p.remove(); react(m, e); } })));
      anchor.closest(".sc-bubble").append(p); setTimeout(() => document.addEventListener("click", () => p.remove(), { once: true }), 0);
    }
    /** A round picture: their Discord avatar when we have one, otherwise a coloured circle with their initial. */
    function face(key, name, ghost) {
      const url = person(key).avatar, a = h("span", { class: "sc-av" + (ghost ? " ghost" : ""), text: ghost ? "" : (name[0] || "?").toUpperCase() });
      if (ghost) return a;
      a.style.background = colorOf(key);
      if (url) { const img = h("img", { src: url, alt: "", width: "34", height: "34", loading: "lazy" }); img.addEventListener("error", () => img.remove()); a.textContent = ""; a.append(img); img.addEventListener("error", () => { a.textContent = (name[0] || "?").toUpperCase(); }); }
      return a;
    }
    const mediaUrl = id => "/api/admin/chat/media?id=" + encodeURIComponent(id);
    function mediaNode(m) {
      if (!m.media) return null;
      if (m.media.kind === "video") return h("video", { class: "sc-media", src: mediaUrl(m.media.id), controls: "", preload: "metadata", playsinline: "" });
      const img = h("img", { class: "sc-media", src: mediaUrl(m.media.id), alt: "Picture from " + m.name, loading: "lazy" });
      img.addEventListener("click", () => lightbox(mediaUrl(m.media.id)));
      img.addEventListener("load", () => { if (log.scrollHeight - log.scrollTop - log.clientHeight < 400) log.scrollTop = log.scrollHeight; });
      return img;
    }
    function lightbox(src) {
      const box = h("div", { class: "sc-lightbox", role: "dialog", "aria-label": "Picture" }, h("img", { src, alt: "" }), h("button", { type: "button", class: "sc-lbx", "aria-label": "Close", text: "✕" }));
      const close = () => { box.remove(); document.removeEventListener("keydown", esc); }, esc = e => { if (e.key === "Escape") close(); };
      box.addEventListener("click", close); document.addEventListener("keydown", esc); document.body.append(box);
    }
    function drawPreview() {
      preview.hidden = !pending;
      if (!pending) { preview.replaceChildren(); return; }
      const thumb = pending.kind === "video" ? h("video", { src: pending.local, muted: "", preload: "metadata" }) : h("img", { src: pending.local, alt: "" });
      preview.replaceChildren(thumb, h("span", { class: "small muted", text: pending.up ? "Uploading…" : pending.file.name }), h("button", { type: "button", class: "btn gray small", text: "Remove", onclick: () => { URL.revokeObjectURL(pending.local); pending = null; drawPreview(); } }));
    }
    async function attach(file) {
      if (!file) return;
      const kind = /^video\//.test(file.type) ? "video" : /^image\//.test(file.type) ? "image" : null;
      if (!kind) { toast("Only pictures and clips can go in the chat."); return; }
      if (file.size > (kind === "video" ? 30e6 : 10e6)) { toast(kind === "video" ? "Clips can be up to 30 MB." : "Pictures can be up to 10 MB."); return; }
      if (pending) URL.revokeObjectURL(pending.local);
      const mine = pending = { file, kind, local: URL.createObjectURL(file), up: true, id: null }; drawPreview();
      try {
        const r = await fetch("/api/admin/chat/upload", { method: "POST", credentials: "same-origin", headers: { "X-Requested-With": "dashboard", "Content-Type": file.type || "application/octet-stream" }, body: file });
        const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "That didn't upload.");
        if (pending === mine) { mine.id = j.id; mine.up = false; drawPreview(); }
      } catch (e) { if (pending === mine) { URL.revokeObjectURL(mine.local); pending = null; drawPreview(); } toast(e.message); }
    }
    attachBtn.addEventListener("click", () => fileIn.click());
    fileIn.addEventListener("change", () => { attach(fileIn.files[0]); fileIn.value = ""; });
    input.addEventListener("paste", e => { const f = [...(e.clipboardData?.files || [])].find(x => /^(image|video)\//.test(x.type)); if (f) { e.preventDefault(); attach(f); } });
    main.addEventListener("dragover", e => { if (room !== "tickets" && room !== "requests" && e.dataTransfer?.types?.includes("Files")) e.preventDefault(); });
    main.addEventListener("drop", e => { const f = e.dataTransfer?.files?.[0]; if (f && room !== "tickets" && room !== "requests") { e.preventDefault(); attach(f); } });
    function bubble(m, prev) {
      const mine = m.author === me().key, grouped = prev && prev.author === m.author && m.at - prev.at < 5 * 60_000 && !m.reply;
      const text = h("div", { class: "sc-text" }); if (!m.body) text.hidden = true;
      for (const part of m.body.split(/(@[\w.-]+)/g)) text.append(/^@[\w.-]+$/.test(part) ? h("span", { class: "sc-mention", text: part }) : document.createTextNode(part));
      const acts = h("span", { class: "sc-acts" }, h("button", { type: "button", title: "React", "aria-label": "React", text: "☺", onclick: e => reactPicker(m, e.currentTarget) }),
        h("button", { type: "button", title: "Reply", "aria-label": "Reply", text: "↩", onclick: () => { replyTo = m; drawReply(); input.focus(); } }),
        mine ? h("button", { type: "button", title: "Edit", "aria-label": "Edit", text: "✎", onclick: () => { editing = m; input.value = m.body; input.focus(); drawReply(); } }) : null,
        mine || me().owner ? h("button", { type: "button", title: "Delete", "aria-label": "Delete", text: "✕", onclick: async () => { try { await api("/api/admin/chat/delete", { id: m.id }); await load(true); } catch (e) { toast(e.message); } } }) : null);
      const av = face(m.author, m.name, grouped);
      return h("div", { class: "sc-msg" + (mine ? " mine" : "") + (grouped ? " grouped" : ""), "data-id": m.id }, av, h("div", { class: "sc-body" },
        grouped ? null : h("div", { class: "sc-meta" }, h("b", { text: m.name }), h("span", { class: "muted small", text: clock(m.at) })),
        m.reply ? h("div", { class: "sc-quote" }, h("b", { text: m.reply.name }), " ", m.reply.body || "📎 Attachment") : null, h("div", { class: "sc-bubble" }, mediaNode(m), text, m.edited ? h("small", { class: "sc-edited", text: " (edited)" }) : null, acts), chips(m)));
    }
    function paint(append) {
      const near = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
      if (!append) log.replaceChildren();
      const from = append ? log.querySelectorAll(".sc-msg").length : 0;
      const nodes = [];
      for (let i = append ? from : 0; i < shown.length; i++) {
        const m = shown[i], p = shown[i - 1];
        if (!p || new Date(p.at).toDateString() !== new Date(m.at).toDateString()) nodes.push(h("div", { class: "sc-day" }, h("span", { text: dayName(m.at) })));
        nodes.push(bubble(m, p));
      }
      log.append(...nodes);
      if (!shown.length && !append) log.append(h("p", { class: "muted sc-empty", text: "Nothing here yet. Say hi." }));
      if (!append || near) log.scrollTop = log.scrollHeight;
    }
    function drawReply() {
      if (editing) { replyBar.hidden = false; replyBar.replaceChildren(h("span", {}, "Editing your message"), h("button", { type: "button", class: "btn gray small", text: "Cancel", onclick: () => { editing = null; input.value = ""; drawReply(); } })); return; }
      replyBar.hidden = !replyTo;
      if (replyTo) replyBar.replaceChildren(h("span", {}, "Replying to ", h("b", { text: replyTo.name })), h("button", { type: "button", class: "btn gray small", text: "Cancel", onclick: () => { replyTo = null; drawReply(); } }));
    }


    const ago = at => { const m = Math.max(1, Math.round((Date.now() - at) / 60000)); return m < 60 ? m + "m" : m < 1440 ? Math.round(m / 60) + "h" : Math.round(m / 1440) + "d"; };
    async function tkList() {
      tkId = 0;
      const r = await api("/api/admin/chat/tickets?status=" + tkFilter); tkOpen = r.open;
      const chips = [["active", "Open"], ["resolved", "Resolved"], ["closed", "Closed"]].map(([k, t]) => h("button", { type: "button", class: "sc-chip" + (tkFilter === k ? " on" : ""), text: t, onclick: () => { tkFilter = k; tkList().catch(e => toast(e.message)); } }));
      const rows = r.tickets.map(t => h("button", { type: "button", class: "sc-tkrow", onclick: () => tkView(t.id).catch(e => toast(e.message)) },
        h("span", { class: "sc-tkico", text: t.bug ? "⚑" : "🎫" }),
        h("span", { class: "sc-tkmain" }, h("b", { text: t.subject }), h("small", { class: "muted", text: `#${t.id} · ${t.user_name || "someone"} · ${ago(t.updated_at)} ago` })),
        t.isNew ? h("i", { class: "sc-badge", text: "new" }) : null, h("span", { class: "sc-st " + t.status, text: t.status })));
      tk.replaceChildren(h("div", { class: "sc-chips" }, ...chips), ...(rows.length ? rows : [h("p", { class: "muted sc-empty", text: "Nothing here. All caught up." })]));
      drawSide();
      if (tkFilter === "active") api("/api/admin/bugs/seen", {}).catch(() => {});
    }
    async function tkView(id) {
      tkId = id;
      const r = await api("/api/admin/chat/ticket?id=" + id), t = r.ticket;
      const thread = h("div", { class: "sc-tkthread" }, ...r.messages.map(m => h("div", { class: "sc-msg" + (m.role === "staff" ? " mine" : "") }, h("span", { class: "sc-av", text: (m.role === "staff" ? "S" : (t.user_name || "?")[0]).toUpperCase() }), h("div", { class: "sc-body" }, h("div", { class: "sc-meta" }, h("b", { text: m.role === "staff" ? "Staff" : (t.user_name || "Member") }), h("span", { class: "muted small", text: clock(m.at) })), h("div", { class: "sc-bubble" }, h("div", { class: "sc-text", text: m.body }))))));
      thread.querySelectorAll(".sc-av").forEach((a, i) => a.style.setProperty("background", r.messages[i].role === "staff" ? "#7c6cff" : colorOf(t.user_id || "")));
      const box = h("textarea", { class: "sc-input", rows: "2", maxlength: "1800", placeholder: "Reply to " + (t.user_name || "them") + ". They get it in their DMs and on the site.", "aria-label": "Reply" });
      const go = h("button", { type: "button", class: "sc-send", text: "➤", "aria-label": "Send reply" });
      go.addEventListener("click", async () => { const body = box.value.trim(); if (!body) return; go.disabled = true; try { await api("/api/admin/tickets/reply", { id, body }); await tkView(id); } catch (e) { toast(e.message); go.disabled = false; } });
      const done = st2 => h("button", { type: "button", class: "btn gray small", text: st2 === "resolved" ? "Mark resolved" : "Close", onclick: async () => { try { await api("/api/admin/tickets/status", { id, status: st2 }); await tkList(); } catch (e) { toast(e.message); } } });
      const canned = (r.canned || []).slice(0, 6).map(c => h("button", { type: "button", class: "sc-chip", title: c.body, text: c.name || c.title || "Canned", onclick: () => { box.value = c.body; box.focus(); } }));
      const open = ["open", "waiting"].includes(t.status);
      tk.replaceChildren(h("div", { class: "sc-tkhead" }, h("button", { type: "button", class: "btn gray small", text: "← All tickets", onclick: () => tkList().catch(e => toast(e.message)) }),
          h("b", { text: `#${t.id} ${t.subject}` }), h("span", { class: "sc-st " + t.status, text: t.status }), open ? done("resolved") : null, t.status !== "closed" ? done("closed") : null),
        thread, ...(r.errors?.length ? [h("details", { class: "sc-errs" }, h("summary", { text: "Recent bot errors" }), h("pre", { text: r.errors.map(e => `${e.level || "error"} ${e.msg || e.message || JSON.stringify(e)}`).join("\n").slice(0, 1500) }))] : []),
        h("div", { class: "sc-chips" }, ...canned), h("div", { class: "sc-compose" }, box, go));
      const th = tk.querySelector(".sc-tkthread"); th.scrollTop = th.scrollHeight;
    }

    const RQ_LABEL = { open: "Open", on_hold: "On hold", planned: "Planned", in_development: "In development", shipped: "Shipped", rejected: "Rejected" };
    async function rqList(openId) {
      const r = await api("/api/admin/chat/requests"); rqOpen = r.open;
      const keys = Object.keys(r.statuses || RQ_LABEL);
      const rows = r.requests.map(q => {
        const sel = h("select", { class: "sc-sel", "aria-label": "Status" }, ...keys.map(k => h("option", { value: k, text: r.statuses[k] || RQ_LABEL[k] || k }))); sel.value = q.status;
        const note = h("input", { class: "sc-note", maxlength: "300", placeholder: "Optional note for them", value: q.note || "" });
        const save = h("button", { type: "button", class: "btn small", text: "Update", onclick: async () => { save.disabled = true; try { await api("/api/admin/requests/status", { id: q.id, status: sel.value, note: note.value }); toast("Saved. They've been told."); await rqList(q.id); } catch (e) { toast(e.message); save.disabled = false; } } });
        return h("details", { class: "sc-rq", open: openId === q.id ? "" : undefined }, h("summary", {}, h("span", { class: "sc-votes", text: "▲ " + q.votes }), h("b", { text: q.title }), h("small", { class: "muted", text: `${q.user_name || "someone"} · ${ago(q.created_at)} ago` }), h("span", { class: "sc-st " + q.status, text: r.statuses[q.status] || q.status })),
          h("div", { class: "sc-rqbody" }, h("p", { text: q.body || "No more detail." }), h("div", { class: "sc-rqact" }, sel, note, save)));
      });
      tk.replaceChildren(...(rows.length ? rows : [h("p", { class: "muted sc-empty", text: "No requests yet." })])); drawSide();
    }
    async function loadState() { st = await api("/api/admin/chat/state"); api("/api/admin/chat/tickets").then(r => { if (tkOpen !== r.open) { tkOpen = r.open; drawSide(); } }).catch(() => {}); api("/api/admin/chat/requests").then(r => { if (rqOpen !== r.open) { rqOpen = r.open; drawSide(); } }).catch(() => {}); drawSide(); drawPeople(); if (room) drawTitle(); }
    async function load(full) {
      if (busyPoll || !room || room === "tickets" || room === "requests") return; busyPoll = true;
      try {
        const r = await api("/api/admin/chat/messages?channel=" + encodeURIComponent(room) + (!full && last ? "&after=" + last : ""));
        typingLine.textContent = r.typing?.length ? `${r.typing.slice(0, 2).join(" and ")} ${r.typing.length > 1 ? "are" : "is"} typing…` : "";
        for (const p of r.people) { const x = st.people.find(q => q.key === p.key); if (x) x.online = p.online; }
        if (full) { shown = r.messages; last = shown.length ? shown[shown.length - 1].id : 0; paint(false); }
        else if (r.messages.length) { shown = shown.concat(r.messages); last = shown[shown.length - 1].id; paint(true); }
        if (r.messages.length || full) { st.unread[room] = 0; }
        drawPeople();
      } finally { busyPoll = false; }
    }
    function open(id) {
      const isTk = id === "tickets" || id === "requests"; log.hidden = compose.hidden = typingLine.hidden = isTk; tk.hidden = !isTk; if (isTk) replyBar.hidden = true;
      if (isTk) { room = id; live.room = id; drawSide(); drawTitle(); (id === "requests" ? rqList : tkList)().catch(e => toast(e.message)); return; }
      room = id; live.room = id; last = 0; shown = []; replyTo = null; drawReply(); st.unread[id] = 0; drawSide(); drawTitle(); load(true).catch(e => toast(e.message)); input.focus(); }
    async function send() {
      const body = input.value.trim(); if (!body && !(pending && pending.id)) return;
      if (pending && pending.up) { toast("Hold on, the file is still uploading."); return; }
      sendBtn.disabled = true;
      try { if (editing) { await api("/api/admin/chat/edit", { id: editing.id, body }); editing = null; drawReply(); await load(true); input.value = ""; return; } await api("/api/admin/chat/send", { channel: room, body, reply: replyTo?.id, media: pending?.id }); if (pending) { URL.revokeObjectURL(pending.local); pending = null; drawPreview(); } input.value = ""; input.style.height = ""; replyTo = null; drawReply(); await load(false); }
      catch (e) { toast(e.message); } finally { sendBtn.disabled = false; input.focus(); }
    }
    sendBtn.addEventListener("click", send);
    input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
    input.addEventListener("input", () => { if (!editing && Date.now() - lastTyped > 3000) { lastTyped = Date.now(); api("/api/admin/chat/typing", { channel: room }).catch(() => {}); } input.style.height = "auto"; input.style.height = Math.min(120, input.scrollHeight) + "px"; });
    // collapse the side columns when the window is narrow
    if (root.ResizeObserver) new ResizeObserver(() => { const w = wrap.clientWidth; wrap.classList.toggle("no-people", w < 820); wrap.classList.toggle("no-side", w < 560); }).observe(wrap);

    loadState().then(() => open("general")).catch(e => { host.replaceChildren(h("div", { class: "notice warn", text: e.message })); });
    let ticks = 0;
    timer = setInterval(() => {
      if (!wrap.isConnected) { clearInterval(timer); live.room = null; return; }
      if (document.hidden || !st) return;
      ticks++; if (room === "tickets" && !tkId && ticks % 4 === 0) tkList().catch(() => {}); if (room === "requests" && ticks % 6 === 0) rqList().catch(() => {}); load(false).catch(() => {}); if (ticks % 6 === 0) loadState().catch(() => {});
    }, 2500);
  }
  root.AdminChat = { mount, watch };
})(typeof globalThis !== "undefined" ? globalThis : this);

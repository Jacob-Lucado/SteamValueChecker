// The radio: a shared list of SoundCloud tracks and sets the staff add, played in one place. The player is SoundCloud's own
// widget; we only talk to it with its message protocol so the next track starts when one ends.
(function (root) {
  "use strict";
  const WIDGET = "https://w.soundcloud.com";
  const KEY = "lucado-radio";
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
  const write = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* fine without it */ } };

  function mount(host, { h, api, toast }) {
    host.classList.add("rd-host");
    let tracks = [], me = { owner: false }, now = null, auto = read().auto !== false, shuffle = Boolean(read().shuffle), frame = null, timer = 0;
    const stage = h("div", { class: "rd-stage" });
    const list = h("div", { class: "rd-list", role: "list" });
    const url = h("input", { class: "rd-url", type: "url", placeholder: "Paste a SoundCloud track or set link", "aria-label": "SoundCloud link", autocomplete: "off", spellcheck: "false" });
    const add = h("button", { type: "button", class: "btn small", text: "Add to the radio" });
    const form = h("div", { class: "rd-add" }, url, add);
    host.replaceChildren(h("div", { class: "rd" }, h("section", { class: "rd-main" }, stage), h("aside", { class: "rd-side" }, form, list)));

    const idx = () => tracks.findIndex(t => t.id === now);
    const isSet = t => /\/playlists\//.test(t.embed);
    function say(msg) { stage.replaceChildren(h("div", { class: "rd-empty" }, h("div", { class: "rd-icon", text: "📻" }), h("b", { text: msg }), h("p", { class: "muted", text: "Add a SoundCloud link on the right, then press play on any track." }))); }

    let lastPos = 0;
    const sub = () => { try { for (const v of ["finish", "play", "pause", "playProgress"]) frame.contentWindow.postMessage(JSON.stringify({ method: "addEventListener", value: v }), WIDGET); } catch { /* the ready message covers it */ } };
    function listen(ev) {
      if (!frame || ev.source !== frame.contentWindow || ev.origin !== WIDGET) return;
      let d = ev.data; try { if (typeof d === "string") d = JSON.parse(d); } catch { return; }
      if (d?.method === "ready") sub();
      const w = root.IndieWaves, cur0 = tracks[idx()];
      if (d?.method === "play" || d?.method === "pause" || d?.method === "finish") w?.music?.(d.method === "play" ? { seed: cur0?.embed, pos: lastPos } : null);
      if (d?.method === "playProgress") { const pos = Number(d.value?.currentPosition); if (Number.isFinite(pos)) { lastPos = pos; w?.music?.({ seed: cur0?.embed, pos }); } }
      if (d?.method === "finish" && auto) { const cur = tracks[idx()]; if (cur && !isSet(cur)) step(1); }
    }
    root.addEventListener("message", listen);

    function play(id) {
      const t = tracks.find(x => x.id === id); if (!t) return;
      now = id; lastPos = 0; write({ ...read(), last: id });
      const src = `${WIDGET}/player/?url=${encodeURIComponent(t.embed)}&auto_play=true&color=%237c6cff&hide_related=true&show_comments=false&show_user=true&show_reposts=false&visual=false`;
      frame = h("iframe", { class: "rd-frame", src, title: t.title, allow: "autoplay; encrypted-media", scrolling: "no", frameborder: "no", width: "100%", height: isSet(t) ? "380" : "166" });
      frame.addEventListener("load", sub);
      const art = t.art ? h("img", { class: "rd-art", src: t.art, alt: "" }) : h("div", { class: "rd-art rd-noart", text: "♪" });
      stage.replaceChildren(h("div", { class: "rd-now" }, art, h("div", { class: "rd-meta" }, h("small", { class: "muted", text: "NOW PLAYING" }), h("b", { class: "rd-title", text: t.title }), h("span", { class: "muted", text: t.author }), h("small", { class: "muted", text: `Added by ${t.by}` }))),
        frame, controls(t));
      draw();
    }
    function controls(t) {
      const btn = (label, text, run, on) => { const b = h("button", { type: "button", class: "rd-btn" + (on ? " on" : ""), title: label, "aria-label": label, text }); b.addEventListener("click", run); return b; };
      const a = btn("Auto-play the next track", "⟳ Auto-next", () => { auto = !auto; write({ ...read(), auto }); play(now); }, auto), s = btn("Shuffle", "⤨ Shuffle", () => { shuffle = !shuffle; write({ ...read(), shuffle }); play(now); }, shuffle);
      return h("div", { class: "rd-ctl" }, btn("Previous", "⏮", () => step(-1)), btn("Next", "⏭", () => step(1)), a, s, h("a", { class: "rd-btn", href: t.url, target: "_blank", rel: "noopener noreferrer", text: "Open on SoundCloud ↗" }));
    }
    function step(dir) {
      if (!tracks.length) return;
      if (shuffle && tracks.length > 1) { let n; do n = tracks[Math.floor(Math.random() * tracks.length)].id; while (n === now); return play(n); }
      const i = idx(); play(tracks[(i + dir + tracks.length) % tracks.length].id);
    }
    function draw() {
      list.replaceChildren(...(tracks.length ? tracks.map((t, i) => {
        const row = h("div", { class: "rd-row" + (t.id === now ? " on" : ""), role: "listitem" },
          t.art ? h("img", { src: t.art, alt: "", width: "40", height: "40", loading: "lazy" }) : h("span", { class: "rd-thumb", text: "♪" }),
          h("button", { type: "button", class: "rd-pick", onclick: () => play(t.id) }, h("b", { text: t.title }), h("small", { class: "muted", text: `${t.author || "Unknown"} · ${t.by}${isSet(t) ? " · set" : ""}` })),
          t.mine || me.owner ? h("button", { type: "button", class: "rd-x", title: "Remove", "aria-label": "Remove " + t.title, text: "✕", onclick: async () => { try { await api("/api/admin/radio/remove", { id: t.id }); await load(); } catch (e) { toast(e.message); } } }) : null);
        return row;
      }) : [h("p", { class: "muted small rd-none", text: "Nothing on the radio yet." })]));
    }
    async function load() {
      const r = await api("/api/admin/radio"); tracks = r.tracks; me = r; if (now && !tracks.some(t => t.id === now)) now = null;
      draw(); if (!now && !stage.firstChild) say(tracks.length ? "Pick a track to start" : "The radio is quiet");
    }
    async function submit() {
      const v = url.value.trim(); if (!v) return; add.disabled = true;
      try { await api("/api/admin/radio/add", { url: v }); url.value = ""; await load(); toast("Added to the radio."); } catch (e) { toast(e.message); } finally { add.disabled = false; url.focus(); }
    }
    add.addEventListener("click", submit); url.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
    load().catch(e => host.replaceChildren(h("div", { class: "notice warn", text: e.message })));
    timer = setInterval(() => { if (!host.isConnected) { clearInterval(timer); root.removeEventListener("message", listen); return; } if (!document.hidden) load().catch(() => {}); }, 20_000);
  }
  root.AdminRadio = { mount };
})(typeof globalThis !== "undefined" ? globalThis : this);

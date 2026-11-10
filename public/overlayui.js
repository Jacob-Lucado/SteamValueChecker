// The stream overlay panel: a live preview of the compact now-playing card, its options, and each person's own OBS link.
// It is used by the music studio's Stream tab and the dashboard's Music page, so both look and work the same.
(() => {
  const DEFAULTS = { style: "card", theme: "dark", accent: "4da3ff", scale: 1, anchor: "bl", art: 1, progress: 1, viz: 1, label: 1, next: 0, bg: 100, opacity: 100, preview: "live", backdrop: "checker", view: "close", mode: "always", hold: 10, pause: 6 };
  const SIZES = { card: [520, 170], minimal: [500, 120], bar: [820, 120], square: [330, 410], vinyl: [520, 180], neon: [520, 150], poster: [390, 390], ticker: [690, 80], compact: [360, 100] };
  const BOOLEAN_ATTRS = new Set(["hidden", "disabled", "checked", "selected", "readonly"]);

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs ?? {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") e.className = v; else if (k === "text") e.textContent = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (BOOLEAN_ATTRS.has(k)) e[k] = Boolean(v); else e.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  }

  window.SvcOverlayPanel = function create({ api, toast, getData, getGuild, storeKey = "svc_overlay_opts" }) {
    const o = { ...DEFAULTS };
    try { Object.assign(o, JSON.parse(localStorage.getItem(storeKey) || "{}")); } catch { /* start fresh */ }
    const save = () => { try { localStorage.setItem(storeKey, JSON.stringify(o)); } catch { /* storage blocked */ } };
    const S = { token: null, base: location.origin + "/overlay", guild: "", loaded: false };

    // ---- what is playing, on a clock that only gets nudged by each refresh, so the bar glides ----
    const clock = { id: "", pos: 0, at: 0, running: false };
    function syncClock() {
      const st = getData()?.status, t = st?.current; if (!st) return;
      const now = performance.now(), id = t ? `${t.url ?? ""}|${t.title}` : "", running = Boolean(t) && !t.live && Boolean(st.playing) && !st.paused;
      const est = clock.running && clock.id === id ? clock.pos + (now - clock.at) / 1000 : null, truth = Number(st.position) || 0;
      clock.pos = running && est !== null && Math.abs(est - truth) < 1.5 ? est + (truth - est) * 0.2 : truth;
      clock.id = id; clock.at = now; clock.running = running;
    }
    const clockNow = () => (clock.running ? clock.pos + (performance.now() - clock.at) / 1000 : clock.pos);

    // ---- the URL for the preview and the real link ----
    const params = kind => {
      const p = new URLSearchParams();
      if (kind === "link") p.set("token", S.token); else if (kind === "feed") p.set("feed", "parent"); else p.set("demo", "1");
      p.set("style", o.style); p.set("theme", o.theme); p.set("accent", o.accent); if (o.scale !== 1) p.set("scale", String(o.scale)); p.set("anchor", o.anchor);
      for (const k of ["art", "progress", "viz", "label", "next", "bg", "opacity"]) if (o[k] !== DEFAULTS[k]) p.set(k, String(o[k]));
      if (o.mode === "popup") { p.set("mode", "popup"); p.set("hold", String(o.hold)); }
      if (o.pause !== DEFAULTS.pause) p.set("pause", String(o.pause));
      return p.toString();
    };
    const src = () => "/overlay?" + params(o.preview === "demo" ? "demo" : "feed");

    // ---- the preview ----
    const frame = h("iframe", { class: "ovp-frame", title: "Preview of the stream overlay", loading: "lazy" });
    const hint = h("div", { class: "ovp-hint", hidden: true }, h("b", { text: "Nothing is playing right now." }), h("span", { text: " Start a song to see it here." }),
      h("button", { class: "ovp-mini", type: "button", text: "Show the demo reel", onclick: () => setOpt("preview", "demo") }));
    const stage = h("div", { class: "ovp-stage" }, frame, hint);
    const now = h("p", { class: "ovp-note" });
    function sizeStage() {
      const full = o.view === "scene", w = stage.clientWidth || 800;
      stage.dataset.bg = o.backdrop;
      if (full) { const k = w / 1920; frame.style.width = "1920px"; frame.style.height = "1080px"; frame.style.transform = `scale(${k})`; stage.style.height = Math.round(1080 * k) + "px"; }
      else { frame.style.width = "100%"; frame.style.height = "100%"; frame.style.transform = "none"; stage.style.height = ""; }
    }
    function pushNp() {
      const d = getData(), st = d?.status, t = st?.current; let np;
      if (!st?.active || !t) np = { on: false };
      else np = { on: true, playing: Boolean(st.playing), paused: Boolean(st.paused), id: `${t.url ?? ""}|${t.title}`, title: String(t.title ?? ""), artist: String(t.artist ?? ""), thumb: /^https:/.test(t.thumb ?? "") ? t.thumb : "", duration: t.duration || 0, live: Boolean(t.live || st.live), position: clockNow(), next: st.next?.[0]?.title ?? "", auto: Boolean(t.auto), volume: st.volume };
      const live = o.preview === "live";
      hint.hidden = !(live && !np.on);
      now.textContent = live ? (np.on ? `Previewing what's playing right now: ${np.title}${np.artist ? " by " + np.artist : ""}.` : "") : "Showing the demo reel: made-up songs so you can see the fades and the song swap.";
      if (live && frame.contentWindow) { try { frame.contentWindow.postMessage({ svc: "np", np }, location.origin); } catch { /* not loaded yet */ } }
    }
    let timer = 0;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => { save(); frame.src = src(); paintUrl(); }, 250); };
    function setOpt(key, value) {
      o[key] = value; save(); paintSegs();
      if (key === "preview") { frame.src = src(); pushNp(); } else if (key === "backdrop" || key === "view") sizeStage(); else refresh();
    }

    // ---- controls ----
    const segs = [];
    const paintSegs = () => { for (const { key, wrap } of segs) for (const b of wrap.querySelectorAll("button")) { const on = b.dataset.v === o[key]; b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); } };
    const seg = (key, label, opts) => {
      const wrap = h("div", { class: "ovp-seg", role: "radiogroup", "aria-label": label }, ...opts.map(([v, text]) => h("button", { type: "button", role: "radio", "data-v": v, text, onclick: () => setOpt(key, v) })));
      segs.push({ key, wrap }); return h("div", { class: "ovp-seg-wrap" }, h("span", { class: "ovp-k", text: label }), wrap);
    };
    const field = (label, control) => h("div", { class: "ovp-field" }, h("label", { text: label }), control);
    const sel = (key, opts) => { const s = h("select"); for (const [v, text] of opts) s.append(h("option", { value: v, text, selected: String(o[key]) === v })); s.addEventListener("change", () => { o[key] = s.value; refresh(); }); return s; };
    const box = (key, label) => { const i = h("input", { type: "checkbox", checked: o[key] === 1 }); i.addEventListener("change", () => { o[key] = i.checked ? 1 : 0; refresh(); }); return h("label", { class: "ovp-check" }, i, " " + label); };
    const color = h("input", { type: "color", value: "#" + o.accent, "aria-label": "Accent color" });
    color.addEventListener("input", () => { o.accent = color.value.slice(1); refresh(); });
    const range = (key, min, max, step, fmt, label) => { const r = h("input", { type: "range", min: String(min), max: String(max), step: String(step), value: String(o[key]), "aria-label": label }); const out = h("span", { class: "ovp-val", text: fmt(o[key]) }); r.addEventListener("input", () => { o[key] = Number(r.value); out.textContent = fmt(o[key]); refresh(); }); return h("div", { class: "ovp-inline" }, r, out); };
    const num = (key, min, max, fallback, label) => { const i = h("input", { type: "number", min: String(min), max: String(max), value: String(o[key]), "aria-label": label }); i.addEventListener("change", () => { o[key] = Math.max(min, Math.min(max, Number(i.value) || fallback)); refresh(); }); return i; };
    const anchors = h("div", { class: "ovp-anchor", role: "radiogroup", "aria-label": "Where it sits" });
    for (const a of ["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"]) { const b = h("button", { type: "button", class: o.anchor === a ? "on" : "", "aria-label": a, onclick: () => { o.anchor = a; for (const x of anchors.children) x.classList.toggle("on", x === b); refresh(); } }); anchors.append(b); }

    // ---- the link ----
    const url = h("input", { type: "password", readonly: true, class: "ovp-url", "aria-label": "Overlay link", autocomplete: "off", spellcheck: "false" });
    const copy = h("button", { class: "ovp-btn", type: "button", text: "Copy link", onclick: async () => { try { await navigator.clipboard.writeText(url.value); toast("Link copied. Paste it into OBS as a Browser source.", "ok"); } catch { url.type = "text"; url.select(); toast("Press Ctrl+C to copy it."); } } });
    const reveal = h("button", { class: "ovp-mini", type: "button", text: "Show", onclick: () => { const on = url.type === "password"; url.type = on ? "text" : "password"; reveal.textContent = on ? "Hide" : "Show"; } });
    const make = h("button", { class: "ovp-btn", type: "button", text: "Create the link", onclick: () => call("create") });
    const reset = h("button", { class: "ovp-mini", type: "button", text: "Make a new link", title: "The old link stops working right away", onclick: () => { if (confirm("Make a new link? The old one stops working right away, so you'd need to paste the new one into OBS.")) call("reset"); } });
    const off = h("button", { class: "ovp-mini bad", type: "button", text: "Turn off", onclick: () => { if (confirm("Turn the overlay off? The link stops working.")) call("remove"); } });
    const linkBox = h("div", { class: "ovp-link" });
    const size = h("p", { class: "ovp-note" });
    function paintUrl() {
      const [w, hh] = SIZES[o.style].map(n => Math.round(n * o.scale));
      size.textContent = `In OBS: add a Browser source, paste the link, set the width to ${w} and the height to ${hh} (or the size of your whole scene and pick where it sits above). Leave "Shutdown source when not visible" off for the smoothest fades.`;
      if (S.token) url.value = `${S.base}?${params("link")}`;
    }
    function drawLink(on) {
      if (!on) { S.token = null; size.hidden = true; linkBox.replaceChildren(h("p", { class: "ovp-note", text: "No link yet for this server. This link is yours alone: it's made for your account, so nobody else shares it and resetting it only affects you. Anyone who has it can see the song that's playing here, nothing else." }), h("div", { class: "ovp-row" }, make)); return; }
      size.hidden = false; paintUrl();
      linkBox.replaceChildren(h("div", { class: "ovp-row" }, url, reveal, copy), h("div", { class: "ovp-row" }, reset, off), h("p", { class: "ovp-note", text: "Keep it private like a password. Make a new link any time and the old one stops working. It also stops working if you lose your streamer or moderator role." }));
    }
    async function load() {
      const g = getGuild(); S.guild = g; S.loaded = true;
      try { const r = await api("/api/music/overlay?guild=" + encodeURIComponent(g)); if (g !== S.guild) return; S.token = r.token; S.base = r.base || S.base; drawLink(r.on); }
      catch (e) { linkBox.replaceChildren(h("p", { class: "ovp-note", text: e.message })); }
    }
    async function call(action) {
      try { const r = await api("/api/music/overlay", { guild_id: getGuild(), action }); S.token = r.token; drawLink(r.on); toast(action === "remove" ? "Overlay turned off." : action === "reset" ? "New link made. The old one no longer works." : "Link created.", "ok"); }
      catch (e) { toast(e.message, "error"); }
    }

    const options = h("div", { class: "ovp-grid" },
      field("Look", sel("style", [["card", "Card"], ["vinyl", "Spinning record"], ["neon", "Neon outline"], ["poster", "Poster (big cover)"], ["square", "Square cover"], ["bar", "Wide bar"], ["ticker", "Slim strip"], ["compact", "Small chip"], ["minimal", "Minimal text"]])),
      field("Theme", sel("theme", [["dark", "Dark"], ["light", "Light"], ["glass", "Frosted glass"], ["clear", "Clear (no background)"]])),
      field("Accent color", color), field("Size", range("scale", 0.6, 2, 0.1, v => v + "×", "Size")),
      field("Card background opacity", range("bg", 0, 100, 5, v => v + "%", "Card background opacity")), field("Whole overlay opacity", range("opacity", 10, 100, 5, v => v + "%", "Whole overlay opacity")),
      field("Where it sits", anchors), field("When it shows", sel("mode", [["always", "Whenever music is playing"], ["popup", "Pop up for each new song"]])),
      field("Seconds to show each new song", num("hold", 3, 120, 10, "Seconds to show each new song")), field("Hide after pausing (seconds, 0 = stay)", num("pause", 0, 300, 0, "Seconds before it hides when paused")),
      box("art", "Cover art"), box("progress", "Progress bar"), box("viz", "Live visualizer"), box("label", "“Now playing” label"), box("next", "Up next"));

    const el = h("div", { class: "ovp" },
      h("p", { class: "ovp-note", text: "A compact now-playing card for your stream. It fades in when a song starts, swaps with a shine when it changes, and fades out when the music stops. The preview below shows what is playing right now. Pick a look, then paste your link into OBS." }),
      h("div", { class: "ovp-bar" }, seg("preview", "Preview", [["live", "What's playing now"], ["demo", "Demo reel"]]), seg("backdrop", "Behind it", [["checker", "Transparent"], ["game", "Game scene"], ["bright", "Bright"]]), seg("view", "View", [["close", "Close-up"], ["scene", "Full 1080p scene"]]),
        h("button", { class: "ovp-mini", type: "button", text: "↻ Replay", onclick: () => { frame.src = src() + "&r=" + Date.now(); } })),
      stage, now, options, h("h3", { class: "ovp-h", text: "Your own link for this server" }), linkBox, size);
    paintSegs(); frame.src = src(); sizeStage();
    if (window.ResizeObserver) new ResizeObserver(sizeStage).observe(stage);
    frame.addEventListener("load", pushNp);
    window.addEventListener("message", e => { if (e.origin === location.origin && e.source === frame.contentWindow && e.data?.svc === "ready") pushNp(); });
    const feed = setInterval(() => { if (el.isConnected) pushNp(); }, 1000);

    return {
      el,
      /** Call after every refresh of the music data. */
      update() {
        const d = getData(); if (!d) return;
        el.hidden = !d.access?.canStream; if (el.hidden) return;
        syncClock(); pushNp();
        if (!S.loaded || S.guild !== getGuild()) load();
      },
      /** The studio hands over the visualizer levels it already receives. */
      viz(m) { if (o.preview === "live" && el.isConnected && el.offsetParent !== null) { try { frame.contentWindow.postMessage({ svc: "viz", m }, location.origin); } catch { /* not ready */ } } },
      reload() { S.loaded = false; if (getData()?.access?.canStream) load(); },
      destroy() { clearInterval(feed); }
    };
  };
})();

// A piece of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls ProfileSongUI.view(ctx).
(function (root) {
  "use strict";
  function view(shared, song, preview = false) {
    const { ext, h } = shared;
    const box = h("div", { class: "pf-song" });
    const name = song.title || ({ youtube: "YouTube", soundcloud: "SoundCloud", spotify: "Spotify", radio: "Live radio" })[song.provider] || "Song";
    // A live radio stream gets the same card as the OBS overlay: art tile, pulsing label, big title and a glowing live strip.
    const radioCard = auto => {
      const a = h("audio", { src: song.stream, preload: "none", referrerpolicy: "no-referrer" });
      const btn = h("button", { type: "button", class: "pf-rplay", "aria-label": "Pause" });
      const art = h("div", { class: "pf-rart" }, h("span", { class: "pf-rglyph", text: "📻" }), btn);
      const eq = h("span", { class: "pf-eq", "aria-hidden": "true" }, h("i"), h("i"), h("i"));
      const label = h("div", { class: "pf-rlabel" }, eq, h("span", { text: "Live radio" }));
      const vol = h("input", { type: "range", min: "0", max: "100", value: "80", class: "pf-rvol", "aria-label": "Volume" });
      vol.addEventListener("input", () => { a.volume = Number(vol.value) / 100; });
      a.volume = 0.8;
      const card = h("div", { class: "pf-rcard" }, art, h("div", { class: "pf-rbody" }, label, h("div", { class: "pf-rtitle", text: name }), h("div", { class: "pf-rsub muted small", text: "Profile song" }),
        h("div", { class: "pf-rrow" }, h("span", { class: "pf-rvolicon", "aria-hidden": "true", text: "🔈" }), vol, song.link ? ext(song.link, "Open", "pf-open") : null)), h("div", { class: "pf-rprog", "aria-hidden": "true" }, h("i")));
      // On a real profile the player floats in the corner so it never sits in the middle of the page; the dash arrow folds it down to just the play tile.
      if (!preview) {
        const fold = h("button", { type: "button", class: "pf-rfold", "aria-label": "Minimize the player", text: "–" });
        fold.addEventListener("click", () => { const mini = card.classList.toggle("mini"); fold.textContent = mini ? "+" : "–"; fold.setAttribute("aria-label", mini ? "Open the player" : "Minimize the player"); });
        card.append(fold);
      }
      const paint = on => { card.classList.toggle("playing", on); btn.textContent = on ? "❚❚" : "▶"; btn.setAttribute("aria-label", on ? "Pause" : "Play"); label.lastChild.textContent = "Live radio"; };
      btn.addEventListener("click", () => { if (a.paused) { a.src = song.stream; a.play().catch(() => {}); } else { a.pause(); } });
      a.addEventListener("playing", () => paint(true));
      a.addEventListener("pause", () => paint(false));
      a.addEventListener("error", () => { card.classList.remove("playing"); label.lastChild.textContent = "Not available"; card.querySelector(".pf-rsub").textContent = "This stream is not available right now."; btn.textContent = "▶"; });
      paint(auto);
      box.classList.add("pf-song-radio");
      box.classList.toggle("pf-float", !preview);
      box.replaceChildren(card);
      if (auto) a.play().catch(() => paint(false));
      box.stopAudio = () => { a.pause(); a.removeAttribute("src"); a.load(); };
    };
    // SoundCloud: its own player is a fixed light box, so the real player is hidden and driven through the widget's messages
    // while our card (same look as the radio one) shows the artwork, title, a seekable bar and the controls. If the widget never answers, the plain player shows instead, darkened.
    const soundCloudCard = auto => {
      const ORIGIN = "https://w.soundcloud.com";
      const frame = h("iframe", { src: auto ? song.embed : song.embed.replace("auto_play=true", "auto_play=false"), title: "Profile song: " + name, allow: "autoplay; encrypted-media", referrerpolicy: "strict-origin-when-cross-origin", class: "pf-sc-hidden", tabindex: "-1", "aria-hidden": "true" });
      const post = (method, value) => { try { frame.contentWindow?.postMessage(JSON.stringify({ method, value }), ORIGIN); } catch { /* not ready */ } };
      const btn = h("button", { type: "button", class: "pf-rplay", "aria-label": "Play", text: "▶" });
      const glyph = h("span", { class: "pf-rglyph", text: "☁" });
      const art = h("div", { class: "pf-rart" }, glyph, btn);
      const eq = h("span", { class: "pf-eq", "aria-hidden": "true" }, h("i"), h("i"), h("i"));
      const label = h("div", { class: "pf-rlabel" }, eq, h("span", { text: "SoundCloud" }));
      const title = h("div", { class: "pf-rtitle", text: name });
      const sub = h("div", { class: "pf-rsub muted small", text: "Profile song" });
      const bar = h("div", { class: "pf-sc-bar", role: "slider", tabindex: "0", "aria-label": "Seek", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0" }, h("i"));
      const tNow = h("span", { class: "pf-sc-time", text: "0:00" }), tEnd = h("span", { class: "pf-sc-time", text: "" });
      const vol = h("input", { type: "range", min: "0", max: "100", value: "80", class: "pf-rvol", "aria-label": "Volume" });
      vol.addEventListener("input", () => post("setVolume", Number(vol.value)));
      const card = h("div", { class: "pf-rcard pf-sc" }, art, h("div", { class: "pf-rbody" }, label, title, sub,
        h("div", { class: "pf-sc-row" }, tNow, bar, tEnd),
        h("div", { class: "pf-rrow" }, h("span", { class: "pf-rvolicon", "aria-hidden": "true", text: "🔈" }), vol, song.link ? ext(song.link, "Open", "pf-open") : null)), h("div", { class: "pf-rprog", "aria-hidden": "true" }, h("i")));
      let playing = false, duration = 0, ready = false;
      const fmt = ms => { const t = Math.max(0, Math.round(ms / 1000)); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };
      const paint = on => { playing = on; card.classList.toggle("playing", on); btn.textContent = on ? "❚❚" : "▶"; btn.setAttribute("aria-label", on ? "Pause" : "Play"); };
      const seekTo = frac => { if (duration) post("seekTo", Math.round(frac * duration)); };
      bar.addEventListener("click", e => { const r = bar.getBoundingClientRect(); seekTo(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))); });
      bar.addEventListener("keydown", e => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); post("getPosition"); const d = e.key === "ArrowRight" ? 5000 : -5000; bar._want = d; } });
      btn.addEventListener("click", () => post(playing ? "pause" : "play"));
      const onMessage = e => {
        if (e.origin !== ORIGIN || e.source !== frame.contentWindow) return;
        let m; try { m = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; }
        if (!m || typeof m !== "object") return;
        switch (m.method) {
          case "ready":
            ready = true; clearTimeout(giveUp);
            for (const ev of ["play", "pause", "finish", "playProgress"]) post("addEventListener", ev);
            post("getCurrentSound"); post("getDuration"); post("setVolume", Number(vol.value));
            break;
          case "getCurrentSound": {
            const v = m.value || {};
            if (v.title && !song.title) title.textContent = v.title;
            if (v.user?.username) sub.textContent = v.user.username;
            const artUrl = v.artwork_url || v.user?.avatar_url || "";
            if (/^https:\/\/[\w.-]*(sndcdn|soundcloud)\.com\//.test(artUrl)) { const img = h("img", { src: artUrl.replace("-large", "-t300x300"), alt: "", referrerpolicy: "no-referrer" }); img.addEventListener("error", () => img.remove()); glyph.replaceWith(img); }
            break; }
          case "getDuration": duration = Number(m.value) || duration; tEnd.textContent = duration ? fmt(duration) : ""; break;
          case "getPosition": if (bar._want) { const d = bar._want; bar._want = 0; post("seekTo", Math.max(0, Math.min(duration || 1e12, Number(m.value || 0) + d))); } break;
          case "play": paint(true); break;
          case "pause": case "finish": paint(false); break;
          case "playProgress": {
            const pv = m.value && typeof m.value === "object" ? m.value : m; // SoundCloud nests the numbers under value
            const rel = Number(pv.relativePosition) || 0, cur = Number(pv.currentPosition) || 0;
            card.style.setProperty("--p", Math.round(rel * 1000) / 10 + "%"); bar.setAttribute("aria-valuenow", String(Math.round(rel * 100)));
            tNow.textContent = fmt(cur); if (!duration && rel > 0) { duration = cur / rel; tEnd.textContent = fmt(duration); }
            break; }
        }
      };
      box._scCleanup?.();
      window.addEventListener("message", onMessage);
      box._scCleanup = () => { clearTimeout(giveUp); window.removeEventListener("message", onMessage); };
      frame.addEventListener("load", () => post("addEventListener", "ready"));
      // Blocked or slow: fall back to SoundCloud's own player, darkened to fit.
      const giveUp = setTimeout(() => {
        if (ready) return;
        window.removeEventListener("message", onMessage);
        box.classList.remove("pf-song-radio", "pf-float");
        frame.className = "pf-frame soundcloud"; frame.removeAttribute("aria-hidden"); frame.removeAttribute("tabindex");
        box.replaceChildren(frame);
      }, 7000);
      paint(auto);
      box.classList.add("pf-song-radio"); box.classList.toggle("pf-float", !preview);
      if (!preview) {
        const fold = h("button", { type: "button", class: "pf-rfold", "aria-label": "Minimize the player", text: "–" });
        fold.addEventListener("click", () => { const mini = card.classList.toggle("mini"); fold.textContent = mini ? "+" : "–"; fold.setAttribute("aria-label", mini ? "Open the player" : "Minimize the player"); });
        card.append(fold);
      }
      box.replaceChildren(card, frame);
      box.stopAudio = () => { clearTimeout(giveUp); window.removeEventListener("message", onMessage); post("pause"); frame.remove(); };
    };
    const draw = playing => {
      if (song.stream) { radioCard(playing); return; }
      if (song.provider === "soundcloud") { soundCloudCard(playing); return; }
      if (!playing) {
        box.classList.remove("pf-song-radio", "pf-float");
        const b = h("button", { type: "button", class: "pf-play", "aria-label": "Play profile song", text: "▶" });
        b.addEventListener("click", () => draw(true));
        box.replaceChildren(b, h("div", { class: "pf-song-info" }, h("strong", { text: name }), h("span", { class: "muted small", text: song.provider === "radio" ? "Live radio" : "Profile song" })),
          song.link ? ext(song.link, "Open", "pf-open") : null);
        return;
      }
      const f = h("iframe", { src: song.embed, title: "Profile song: " + name, allow: "autoplay; encrypted-media", referrerpolicy: "strict-origin-when-cross-origin", class: "pf-frame " + song.provider });
      const stop = h("button", { type: "button", class: "pf-play stop", "aria-label": "Stop the song", text: "■" });
      stop.addEventListener("click", () => draw(false));
      box.replaceChildren(stop, f);
    };
    draw(false);
    box.start = () => draw(true);
    return box;
  }
  root.ProfileSongUI = { view };
})(window);

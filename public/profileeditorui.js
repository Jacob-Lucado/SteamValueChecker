// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls ProfileEditorUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { PAGE_PRESET_CSS, PF_TITLE, PF_VIS, api, app, busy, field, h, pageHead, publicPagePanel, renderProfile, route, select, toast } = ctx;
    const holder = h("div", { class: "muted", text: "Loading…" });
    app.replaceChildren(pageHead("My profile", "Build the page people see when you share your link."), holder);
    let d;
    try { d = await api("/api/profile/page"); } catch (e) { holder.className = ""; holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); return; }
    holder.className = "";
    if (!d.slug || !d.public) {
      holder.replaceChildren(h("div", { class: "notice" }, "Choose a page name and turn your page on first. Then come back here to design it."), publicPagePanel(),
        (() => { const b = h("button", { class: "btn blue", type: "button", text: "I did that, continue" }); b.addEventListener("click", () => route()); return b; })());
      return;
    }
    const cfg = JSON.parse(JSON.stringify(d.config));
    // The saved song is stored as provider and id. The editor works with the pasted link, so turn it back into one.
    // The saved song is stored as provider and id. The editor works with the pasted link, so turn it back into one (also after every save).
    const songToLink = sg => (sg ? { url: sg.provider === "radio" ? sg.id : sg.provider === "youtube" ? "https://youtu.be/" + sg.id : sg.provider === "soundcloud" ? "https://soundcloud.com/" + sg.id : "https://open.spotify.com/" + sg.kind + "/" + sg.id, title: sg.title || "" } : null);
    cfg.song = songToLink(cfg.song);
    const pv = h("div", { class: "pf-preview" });
    let dirty = false, timer = null;
    let tryStyle = null; // a supporter style someone is only looking at: shown in the preview, never saved
    let tryTheme = null; // a supporter theme someone is only looking at: shown in the preview, never saved
    const payload = () => ({ ...cfg, links: cfg.links.filter(l => l.url.trim()), favorites: cfg.favorites, song: cfg.song && cfg.song.url ? cfg.song : null });
    const draw = profile => { pv.replaceChildren(profile ? renderProfile(profile, { preview: true }) : h("p", { class: "muted", text: "Nothing to preview yet." })); };
    const refresh = () => { clearTimeout(timer); timer = setTimeout(async () => { try { draw((await api("/api/profile/preview", { ...payload(), ...(tryTheme ? { theme: tryTheme } : {}), ...(tryStyle ? { style: tryStyle } : {}) })).profile); } catch (e) { pv.prepend(h("div", { class: "notice warn", text: e.message })); } }, 450); };
    const changed = () => { dirty = true; saveBtn.disabled = false; refresh(); };

    // look
    const themeBox = h("div", { class: "pf-swatches" });
    const drawThemes = () => themeBox.replaceChildren(...d.choices.themes.map(t => {
      const b = h("button", { type: "button", class: "pf-swatch" + ((tryTheme || cfg.theme) === t.key ? " on" : "") + (t.locked ? " locked" : ""), title: t.locked ? t.key + " (supporters only)" : t.key, "aria-label": t.key + " theme", "aria-pressed": String(cfg.theme === t.key) });
      b.style.background = t.bg; b.style.borderColor = t.accent; b.style.setProperty("--dot", t.accent);
      b.addEventListener("click", () => { if (t.locked) { tryTheme = t.key; drawThemes(); refresh(); return toast("Previewing " + t.key + ". It's for supporters, so it won't save without a pass (Chip in page, Help menu).", "warn"); } tryTheme = null; cfg.theme = t.key; drawThemes(); changed(); });
      return b;
    }));
    drawThemes();
    const styleBox = h("div", { class: "pf-styles" });
    const drawStyles = () => styleBox.replaceChildren(...d.choices.styles.map(t => {
      const on = (tryStyle || cfg.style || "classic") === t.key;
      const b = h("button", { type: "button", class: "pf-style" + (on ? " on" : ""), "data-style": t.key, "aria-pressed": String(on), title: t.name },
        h("span", { class: "pf-style-pv" }, h("i"), h("i"), h("i")), h("b", { text: t.name + (t.locked ? " 🔒" : "") }), h("span", { class: "muted small", text: t.blurb }));
      if (t.bg) { b.style.setProperty("--sv-bg", t.bg); b.style.setProperty("--sv-ac", t.accent); }
      b.addEventListener("click", () => { if (t.locked) { tryStyle = t.key; drawStyles(); refresh(); return toast("Previewing " + t.name + ". It's for supporters, so it won't save without a pass (Chip in page, Help menu).", "warn"); } tryStyle = null; cfg.style = t.key; drawStyles(); changed(); });
      return b;
    }));
    drawStyles();
    const accent = h("input", { type: "color", value: cfg.accent || (d.choices.themes.find(t => t.key === cfg.theme) || {}).accent || "#66c0f4", "aria-label": "Accent color" });
    accent.addEventListener("input", () => { cfg.accent = accent.value; changed(); });
    const accentReset = h("button", { type: "button", class: "btn gray small", text: "Use the theme color" });
    accentReset.addEventListener("click", () => { cfg.accent = null; accent.value = (d.choices.themes.find(t => t.key === cfg.theme) || {}).accent; changed(); });
    const pick = (label, key, options) => { const s = select(options, cfg[key]); s.addEventListener("change", () => { cfg[key] = s.value; changed(); }); return field(label, s); };
    const nice = x => x[0].toUpperCase() + x.slice(1);
    const av = h("input", { type: "checkbox", checked: cfg.avatar, disabled: !d.steamLinked });
    av.addEventListener("change", () => { cfg.avatar = av.checked; changed(); });
    const gateBox = h("input", { type: "checkbox", checked: Boolean(cfg.enter) });
    gateBox.addEventListener("change", () => { cfg.enter = gateBox.checked; changed(); });
    const look = h("div", { class: "panel" }, h("h3", { text: "Look" }), field("Style", styleBox), h("p", { class: "muted small", text: "A style changes the whole look. Everything except Classic brings its own colors, and the accent below still tints it." }), field("Theme (Classic only)", themeBox), h("div", { class: "row" }, field("Accent color", accent), h("div", {}, h("label", { text: "\u00a0" }), accentReset)),
      h("div", { class: "row" }, pick("Background", "bgstyle", d.choices.bgstyles.map(x => [x, nice(x)])), pick("Layout", "layout", d.choices.layouts.map(x => [x, nice(x)])), pick("Banner", "banner", [["gradient", "Color"], ["game", "First favorite game's art"], ["none", "None"]])),
      h("label", { class: "check" }, av, " ", "Show my Steam picture", d.steamLinked ? null : h("span", { class: "muted small", text: " (link Steam first)" })));

    // about
    const name = h("input", { type: "text", maxlength: "32", value: cfg.name, placeholder: d.slug });
    name.addEventListener("input", () => { cfg.name = name.value; changed(); });
    const bio = h("textarea", { maxlength: "300", rows: "4", placeholder: "A line or two about you and what you play." }); bio.value = cfg.bio;
    const count = h("span", { class: "muted small", text: `${cfg.bio.length}/300` });
    bio.addEventListener("input", () => { cfg.bio = bio.value; count.textContent = `${bio.value.length}/300`; changed(); });
    const about = h("div", { class: "panel" }, h("h3", { text: "About you" }), field("Display name", name), field("Bio", bio), count);
    // The birthday is kept apart from the page design: it saves on its own and never shows on the page.
    const bdIn = h("input", { type: "text", maxlength: "5", placeholder: "MM-DD", value: (d.birthday && d.birthday.value) || "", "aria-label": "Your birthday" });
    const bdShare = h("input", { type: "checkbox", checked: Boolean(d.birthday && d.birthday.share) });
    const bdSave = h("button", { class: "btn gray small", type: "button", text: "Save birthday" });
    bdSave.addEventListener("click", () => busy(bdSave, async () => { const r = await api("/api/profile/birthday", { birthday: bdIn.value.trim(), share: bdShare.checked }); bdShare.checked = r.share; toast(r.birthday ? (r.share ? "Saved. People with your page on their friends list will get a reminder." : "Saved. It stays private.") : "Birthday removed.", "ok"); }));
    const birthday = h("div", { class: "panel" }, h("h3", { text: "Birthday" }),
      h("p", { class: "muted small", text: "Month and day only, never the year. It never shows on your page." }),
      field("Your birthday", bdIn), h("label", { class: "check" }, bdShare, " Remind people who have my page on their friends list (they only see a reminder, and you can turn this off any time)"), h("div", { class: "row" }, bdSave));

    // links
    const linkBox = h("div", { class: "pf-rows" });
    const drawLinks = () => {
      linkBox.replaceChildren(...cfg.links.map((l, n) => {
        const k = select(d.choices.links, l.kind); k.addEventListener("change", () => { l.kind = k.value; changed(); });
        const u = h("input", { type: "url", value: l.url, placeholder: "https://", "aria-label": "Link address" }); u.addEventListener("input", () => { l.url = u.value; changed(); });
        const rm = h("button", { type: "button", class: "btn gray small", text: "Remove" }); rm.addEventListener("click", () => { cfg.links.splice(n, 1); drawLinks(); changed(); });
        return h("div", { class: "row pf-row" }, k, u, rm);
      }));
    };
    drawLinks();
    const addLink = h("button", { type: "button", class: "btn gray small", text: "Add a link" });
    addLink.addEventListener("click", () => { if (cfg.links.length >= 6) return toast("Up to 6 links.", "warn"); cfg.links.push({ kind: "website", url: "" }); drawLinks(); });
    const links = h("div", { class: "panel" }, h("h3", { text: "Links" }), linkBox, addLink);

    // favorites
    const favBox = h("div", { class: "chips" });
    const drawFavs = () => favBox.replaceChildren(...cfg.favorites.map((t, n) => { const x = h("button", { type: "button", class: "chip", text: t + " ✕", "aria-label": "Remove " + t }); x.addEventListener("click", () => { cfg.favorites.splice(n, 1); drawFavs(); changed(); }); return x; }));
    drawFavs();
    const favIn = h("input", { type: "text", list: "pf-titles", maxlength: "80", placeholder: "Start typing a game from your library or wishlist" });
    const addFav = () => { const t = favIn.value.trim(); if (!t) return; if (cfg.favorites.length >= 5) return toast("Up to five favorites.", "warn"); if (!cfg.favorites.includes(t)) cfg.favorites.push(t); favIn.value = ""; drawFavs(); changed(); };
    favIn.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addFav(); } });
    const favBtn = h("button", { type: "button", class: "btn gray small", text: "Add", onclick: addFav });
    const favs = h("div", { class: "panel" }, h("h3", { text: "Favorite games" }), h("datalist", { id: "pf-titles" }, d.choices.titles.map(t => h("option", { value: t }))), h("div", { class: "row" }, favIn, favBtn), favBox,
      h("p", { class: "muted small", text: "Games with art show up as tiles. The first one can also be your banner." }));

    // song
    cfg.song = cfg.song || null;
    const songUrl = h("input", { type: "url", placeholder: "YouTube, SoundCloud, Spotify or a live radio stream link", value: cfg.song ? cfg.song.url : "" });
    const songTitle = h("input", { type: "text", maxlength: "60", placeholder: "Song name (optional)", value: cfg.song ? cfg.song.title : "" });
    const songSync = () => { cfg.song = songUrl.value.trim() ? { url: songUrl.value.trim(), title: songTitle.value } : null; changed(); };
    songUrl.addEventListener("input", songSync); songTitle.addEventListener("input", songSync);
    const song = h("div", { class: "panel" }, h("h3", { text: "Profile song" }), h("div", { class: "row" }, field("Link", songUrl), field("Name", songTitle)),
      h("label", { class: "check" }, gateBox, " Start with a “Click to enter” screen, and play the song as soon as they click"),
      h("p", { class: "muted small", text: "Shows as a play button on your page. For radio, paste the direct stream address (https, ends in something like /stream or .mp3)." }));

    // sections
    const secBox = h("div", { class: "pf-rows" });
    const drawSecs = () => secBox.replaceChildren(...cfg.sections.map((s, n) => {
      const vis = select(Object.entries(PF_VIS), s.vis); vis.addEventListener("change", () => { s.vis = vis.value; changed(); });
      const up = h("button", { type: "button", class: "btn gray small", text: "↑", "aria-label": "Move up", disabled: n === 0 }), dn = h("button", { type: "button", class: "btn gray small", text: "↓", "aria-label": "Move down", disabled: n === cfg.sections.length - 1 });
      up.addEventListener("click", () => { [cfg.sections[n - 1], cfg.sections[n]] = [cfg.sections[n], cfg.sections[n - 1]]; drawSecs(); changed(); });
      dn.addEventListener("click", () => { [cfg.sections[n + 1], cfg.sections[n]] = [cfg.sections[n], cfg.sections[n + 1]]; drawSecs(); changed(); });
      return h("div", { class: "row pf-row" }, h("strong", { class: "pf-sec", text: PF_TITLE[s.key] || s.key }), vis, up, dn);
    }));
    drawSecs();
    const secs = h("div", { class: "panel" }, h("h3", { text: "Sections" }), h("p", { class: "muted small", text: "Choose what shows, who sees it, and the order. \"Server only\" means signed-in members of your server. Hidden sections are never sent to visitors." }), secBox);

    const saveBtn = h("button", { type: "button", class: "btn green", text: "Save profile", disabled: true });
    saveBtn.addEventListener("click", () => busy(saveBtn, async () => {
      const r = await api("/api/profile/page", payload());
      dirty = false; Object.assign(cfg, r.config, { song: songToLink(r.config.song) }); draw(r.profile); toast("Saved.", "ok");
    }));
    const open = h("a", { class: "btn gray", href: "#/u/" + d.slug, text: "Open my page" });
    const copy = h("button", { type: "button", class: "btn gray", text: "Copy link" });
    copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(location.origin + "/u/" + d.slug); toast("Link copied.", "ok"); } catch { toast(location.origin + "/u/" + d.slug); } });
    // behind the page: a preset, an uploaded picture, or the Steam profile background
    const bgBox = h("div", { class: "pf-bg-panel" });
    const shrink = file => new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), im = new Image();
      im.onload = () => {
        const k = Math.min(1, 1600 / im.width), c = document.createElement("canvas"); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        let q = 0.8, out = c.toDataURL("image/jpeg", q);
        while (out.length > 500_000 && q > 0.45) { q -= 0.1; out = c.toDataURL("image/jpeg", q); }
        out.length > 1_550_000 ? reject(new Error("That picture is too big even after shrinking it. Try a smaller one.")) : resolve(out);
      };
      im.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file is not a picture this browser can open.")); };
      im.src = url;
    });
    const adopt = r => { d.backgrounds = r.backgrounds; cfg.pagebg = r.config.pagebg; drawBg(); draw(r.profile); };
    const bgCall = (body, b) => busy(b, async () => { try { adopt(await api("/api/profile/background", body)); } catch (e) { toast(e.message, "error"); } });
    function drawBg() {
      const pb = cfg.pagebg || (cfg.pagebg = { kind: "none", preset: "aurora", dim: 35, image: null });
      const kinds = h("div", { class: "pf-bg-kinds" }, [["none", "None"], ["preset", "Preset"], ["image", "My picture"], ...(pb.video ? [["video", "Steam animated"]] : [])].map(([k, label]) => {
        const b = h("button", { type: "button", class: "btn small " + (pb.kind === k ? "blue" : "gray"), text: label, "aria-pressed": String(pb.kind === k) });
        b.addEventListener("click", () => { if (k === "image" && !(d.backgrounds || []).length) return toast("Upload a picture or copy your Steam background first.", "warn"); pb.kind = k; if (k === "image" && !pb.image) pb.image = d.backgrounds[0].id; drawBg(); changed(); });
        return b;
      }));
      const parts = [kinds];
      if (pb.kind === "preset") parts.push(h("div", { class: "pf-presets" }, d.presets.map(id => {
        const b = h("button", { type: "button", class: "pf-preset" + (pb.preset === id ? " on" : ""), title: id, "aria-label": id + " background", "aria-pressed": String(pb.preset === id) });
        b.style.background = PAGE_PRESET_CSS[id]; b.addEventListener("click", () => { pb.preset = id; drawBg(); changed(); }); return b;
      })));
      if (pb.kind === "image") {
        parts.push(h("div", { class: "pf-bg-thumbs" }, (d.backgrounds || []).map(bg => {
          const t = h("div", { class: "pf-bg-thumb" + (pb.image === bg.id ? " on" : "") });
          t.style.backgroundImage = `url("${bg.url}")`;
          const use = h("button", { type: "button", class: "pf-bg-use", "aria-label": "Use this picture", "aria-pressed": String(pb.image === bg.id), text: pb.image === bg.id ? "In use" : "Use" });
          use.addEventListener("click", () => bgCall({ action: "use", id: bg.id }, use));
          const del = h("button", { type: "button", class: "pf-bg-del", "aria-label": "Delete this picture", text: "✕" });
          del.addEventListener("click", () => { if (confirm("Delete this picture?")) bgCall({ action: "remove", id: bg.id }, del); });
          return h("div", {}, t, h("div", { class: "row" }, use, del, h("span", { class: "muted small", text: (bg.source === "steam" ? "Steam · " : "") + Math.round(bg.bytes / 1024) + " KB" })));
        })));
        const dim = h("input", { type: "range", min: "0", max: "70", value: String(pb.dim ?? 35), "aria-label": "Dim the picture" });
        dim.addEventListener("input", () => { pb.dim = Number(dim.value); changed(); });
        parts.push(field("Dim the picture so the page stays readable", dim));
      }
      const file = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", hidden: true });
      const up = h("button", { type: "button", class: "btn gray small", text: "Upload a picture" });
      up.addEventListener("click", () => file.click());
      file.addEventListener("change", () => { const f = file.files[0]; file.value = ""; if (!f) return; busy(up, async () => { try { adopt(await api("/api/profile/background", { action: "upload", data: await shrink(f) })); toast("Uploaded.", "ok"); } catch (e) { toast(e.message, "error"); } }); });
      const st = h("button", { type: "button", class: "btn gray small", text: "Use my Steam background", disabled: !d.steamLinked, title: d.steamLinked ? "" : "Link Steam first" });
      st.addEventListener("click", () => busy(st, async () => { try { adopt(await api("/api/profile/background", { action: "steam" })); toast(cfg.pagebg && cfg.pagebg.kind === "video" ? "Using your animated Steam background." : "Copied your Steam background.", "ok"); } catch (e) { toast(e.message, "error"); } }));
      parts.push(h("div", { class: "row" }, up, st, file));
      parts.push(h("p", { class: "muted small", text: `You can keep up to ${d.maxBackgrounds} pictures (${(d.backgrounds || []).length} stored). Pictures are cleared if you have not opened the bot or dashboard for 30 days. Keep it to pictures you have the right to use. If a page is reported, it can be hidden.` }));
      bgBox.replaceChildren(...parts);
    }
    drawBg();
    const pageBgPanel = h("div", { class: "panel" }, h("h3", { text: "Page background" }), h("p", { class: "muted small", text: "The space around your profile card." }), bgBox);
    holder.replaceChildren(h("div", { class: "pf-editor" },
      h("div", { class: "pf-form" }, look, pageBgPanel, about, birthday, links, favs, song, secs, h("div", { class: "row pf-save" }, saveBtn, open, copy)),
      h("div", { class: "pf-side" }, h("div", { class: "pf-sticky" }, h("h3", { text: "Preview" }), pv))));
    draw(d.profile);
    window.addEventListener("hashchange", () => { clearTimeout(timer); }, { once: true });
  }
  root.ProfileEditorUI = { view };
})(window);

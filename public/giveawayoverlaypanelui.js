// A piece of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls GiveawayOverlayPanelUI.view(ctx).
(function (root) {
  "use strict";
  function view(shared) {
    const { api, busy, field, h, select, state, toast } = shared;
    const panel = h("div", { class: "panel", id: "sh-gwoverlay" });
    const KEY = "svc_gwoverlay";
    let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { /* none */ }
    const copy = async text => { try { await navigator.clipboard.writeText(text); toast("Copied.", "ok"); } catch { toast("Select the link and copy it by hand.", "warn"); } };
    /** Choose which of the server's running giveaways go on screen. With none picked it just follows your latest stream giveaway. */
    const servers = state.me.servers.filter(g => g.bot !== false);
    function picker() {
      if (!servers.length) return null;
      const guild = select(servers.map(g => [g.id, g.name]), servers[0].id), list = h("div", { class: "gwpicks" }), save = h("button", { class: "btn blue small", type: "button", text: "Save my picks" });
      let rows = [];
      const note = h("p", { class: "muted small" });
      async function loadList() {
        list.replaceChildren(h("span", { class: "muted small", text: "Looking…" }));
        try { rows = (await api("/api/giveawayoverlay/pick?guild=" + encodeURIComponent(guild.value))).giveaways; } catch (e) { rows = []; list.replaceChildren(h("div", { class: "notice warn", text: e.message })); note.textContent = ""; return; }
        if (!rows.length) { list.replaceChildren(h("p", { class: "muted", text: "No giveaways are running in this server right now." })); note.textContent = ""; return; }
        list.replaceChildren(...rows.map(r => { const c = h("input", { type: "checkbox", checked: r.picked }); c.dataset.id = String(r.id); const when = r.endsAt ? new Date(r.endsAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""; return h("label", { class: "check" }, c, h("span", {}, h("b", { text: r.title }), h("span", { class: "muted small", text: ` ${r.entries} entries · ${r.prizes} prize${r.prizes === 1 ? "" : "s"} · ends ${when}${r.mine ? " · yours" : ""}` }))); }));
        note.textContent = "Tick up to six. With several ticked, the overlay slides between them with live stats.";
      }
      guild.addEventListener("change", loadList);
      save.addEventListener("click", () => busy(save, async () => { const ids = [...list.querySelectorAll("input:checked")].map(i => Number(i.dataset.id)); await api("/api/giveawayoverlay/pick", { guild_id: guild.value, ids }); toast(ids.length ? "Saved. Your overlay switches within seconds." : "Cleared. It follows your latest stream giveaway.", "ok"); loadList(); }));
      loadList();
      return h("div", { class: "subpanel" }, h("h4", { text: "Which giveaways to show" }), servers.length > 1 ? field("Server", guild) : null, list, note, h("div", { class: "row" }, save));
    }
    async function draw() {
      let d;
      try { d = await api("/api/streamcard"); } catch (e) { panel.replaceChildren(h("h3", { text: "Giveaway overlay for OBS" }), h("div", { class: "notice warn", text: e.message })); return; }
      const head = h("h3", { text: "Giveaway overlay for OBS" });
      const blurb = h("p", { class: "muted", text: "Show your stream giveaway on screen: the prize, how many people entered, a countdown, the steps to enter, and then the winners the moment they are drawn. Pick one giveaway or several and it slides between them with live stats, or pick none and it follows your latest stream giveaway by itself. Add it in OBS as a Browser source." });
      const base = (d.base || "").replace(/streamcard$/, "giveawayoverlay");
      if (!d.on) {
        const make = h("button", { class: "btn blue", type: "button", text: "Make my overlay link" });
        make.addEventListener("click", () => busy(make, async () => { await api("/api/streamcard", { action: "create" }); toast("Your overlay link is ready.", "ok"); draw(); }));
        panel.replaceChildren(head, blurb, h("div", { class: "row" }, make, h("a", { class: "btn gray", href: base + "?demo=1", target: "_blank", rel: "noopener noreferrer", text: "See a sample" })));
        return;
      }
      const v = (k, dflt) => (saved[k] ?? dflt);
      const style = select([["card", "Card"], ["bar", "Wide bar"], ["mini", "Small tag"]], v("style", "card"));
      const theme = select([["dark", "Dark"], ["light", "Light"], ["glass", "Glass"], ["neon", "Neon glow"], ["clear", "No background"]], v("theme", "dark"));
      const anchor = select([["tr", "Top right"], ["tc", "Top center"], ["tl", "Top left"], ["mr", "Middle right"], ["ml", "Middle left"], ["br", "Bottom right"], ["bc", "Bottom center"], ["bl", "Bottom left"]], v("anchor", "tr"));
      const font = select([["system", "Clean"], ["rounded", "Rounded"], ["mono", "Techy"], ["serif", "Classic"]], v("font", "system"));
      const accent = h("input", { type: "color", value: v("accent", "#4da3ff"), "aria-label": "Accent color" });
      const scale = h("input", { type: "number", min: "0.5", max: "3", step: "0.1", value: v("scale", "1"), "aria-label": "Size" });
      const label = h("input", { type: "text", maxlength: "40", placeholder: "Giveaway", value: v("label", ""), "aria-label": "Small heading" });
      const join = h("input", { type: "text", maxlength: "80", placeholder: "Join: discord.gg/yourserver", value: v("join", ""), "aria-label": "How to enter text" });
      const hold = h("input", { type: "number", min: "5", max: "600", value: v("hold", "60"), "aria-label": "Winner seconds" });
      const every = h("input", { type: "number", min: "3", max: "60", value: v("every", "8"), "aria-label": "Seconds per giveaway" });
      const dots = h("input", { type: "checkbox", checked: v("dots", true) !== false });
      const TOG = [["prizes", "Prizes"], ["entries", "Entry count"], ["timer", "Countdown"], ["bar", "Progress bar"], ["steps", "Steps to enter"], ["chat", "“Type !enter in chat” line"], ["winners", "Winners when drawn"]];
      const tog = TOG.map(([k, t]) => { const c = h("input", { type: "checkbox", checked: v(k, true) !== false }); return [k, c, h("label", { class: "check" }, c, t)]; });
      const autoHide = h("input", { type: "checkbox", checked: v("hide", false) === true }); 
      const link = h("input", { type: "text", readonly: true, "aria-label": "Giveaway overlay link" });
      const prev = h("iframe", { class: "gwprev", title: "Preview", loading: "lazy" });
      const demo = select([["1", "Preview: several giveaways"], ["one", "Preview: one giveaway"], ["ended", "Preview: winners"]], "1");
      const params = () => {
        const u = new URLSearchParams();
        if (style.value !== "card") u.set("style", style.value); if (theme.value !== "dark") u.set("theme", theme.value); if (anchor.value !== "tr") u.set("anchor", anchor.value);
        if (font.value !== "system") u.set("font", font.value); if (accent.value.toLowerCase() !== "#4da3ff") u.set("accent", accent.value.slice(1)); if (scale.value && scale.value !== "1") u.set("scale", scale.value);
        if (label.value.trim()) u.set("label", label.value.trim()); if (join.value.trim()) u.set("join", join.value.trim());
        for (const [k, c] of tog) if (!c.checked) u.set(k, "0");
        if (every.value && every.value !== "8") u.set("every", every.value); if (!dots.checked) u.set("dots", "0");
        if (autoHide.checked) { u.set("hide", "1"); if (hold.value && hold.value !== "60") u.set("hold", hold.value); }
        return u;
      };
      const rebuild = () => {
        const u = params(), real = new URL(base); real.searchParams.set("token", d.token); for (const [k, x] of u) real.searchParams.set(k, x);
        link.value = real.toString();
        const pv = new URL(base); pv.searchParams.set("demo", demo.value); for (const [k, x] of u) pv.searchParams.set(k, x); if (pv.toString() !== prev.getAttribute("src")) prev.src = pv.toString();
        try { localStorage.setItem(KEY, JSON.stringify({ style: style.value, theme: theme.value, anchor: anchor.value, font: font.value, accent: accent.value, scale: scale.value, label: label.value, join: join.value, hold: hold.value, every: every.value, dots: dots.checked, hide: autoHide.checked, ...Object.fromEntries(tog.map(([k, c]) => [k, c.checked])) })); } catch { /* fine */ }
      };
      [style, theme, anchor, font, accent, scale, label, join, hold, every, dots, autoHide, demo, ...tog.map(t => t[1])].forEach(e => e.addEventListener("input", rebuild)); rebuild();
      const copyBtn = h("button", { class: "btn blue small", type: "button", text: "Copy link" }); copyBtn.addEventListener("click", () => copy(link.value));
      panel.replaceChildren(head, blurb,
        h("div", { class: "gwprevwrap" }, prev), h("div", { class: "row" }, field("Preview", demo)),
        picker(), h("div", { class: "grid two" }, field("Seconds on each giveaway", every), h("label", { class: "check" }, dots, "Dots under the card when several are showing")),
        h("h4", { text: "Look" }), h("div", { class: "grid two" }, field("Layout", style), field("Colors", theme), field("Where", anchor), field("Font", font), field("Accent color", accent), field("Size (1 is normal)", scale)),
        h("h4", { text: "What it shows" }), h("div", { class: "grid two" }, tog.map(t => t[2])),
        h("div", { class: "grid two" }, field("Small heading", label), field("How to enter (your invite or link)", join)),
        h("div", { class: "grid two" }, h("label", { class: "check" }, autoHide, "Hide the winners after a while"), field("Seconds to show winners", hold)),
        field("Your private link (keep it to yourself)", link),
        h("div", { class: "row" }, copyBtn, h("a", { class: "btn gray small", href: link.value, target: "_blank", rel: "noopener noreferrer", text: "Open it" })),
        h("p", { class: "muted small", text: "In OBS: add a Browser source, paste the link, set width 1920 and height 1080 (your canvas size) and leave the background alone. It is the same private link as your deals overlay, so a new link there replaces this one too. It stays empty until you start a stream giveaway above." }));
    }
    draw();
    return panel;
  }
  root.GiveawayOverlayPanelUI = { view };
})(window);

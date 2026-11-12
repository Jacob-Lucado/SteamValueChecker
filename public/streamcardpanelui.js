// A piece of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls StreamCardPanelUI.view(ctx).
(function (root) {
  "use strict";
  function view(shared) {
    const { api, busy, field, h, select, toast } = shared;
    const panel = h("div", { class: "panel", id: "sh-cards" });
    const KINDS = [["game", "The game I am playing right now"], ["deal", "Best deal on my wishlist"], ["free", "A free game that is live now"], ["gift", "“Gift me” with my public wishlist page"]];
    const copy = async text => { try { await navigator.clipboard.writeText(text); toast("Copied.", "ok"); } catch { toast("Select the link and copy it by hand.", "warn"); } };
    /** Chat bot commands for Twitch, Kick and YouTube chat: viewers type !deals, !free or !wishlist. */
    function chatBox(d) {
      const tools = Object.entries(d.chat || {});
      if (!tools.length) return null;
      const sel = select(tools.map(([k, t]) => [k, t.label]), tools[0][0]);
      const area = h("textarea", { readonly: true, rows: "3", "aria-label": "Chat commands" });
      const fill = () => { area.value = d.chat[sel.value].lines.join("\n"); };
      sel.addEventListener("change", fill); fill();
      const cp = h("button", { class: "btn gray small", type: "button", text: "Copy commands" }); cp.addEventListener("click", () => copy(area.value));
      return h("div", { class: "subpanel" }, h("h4", { text: "Chat commands (Twitch, Kick, YouTube)" }),
        h("p", { class: "muted small", text: "Paste these into your chat bot. Viewers type !deals, !free or !wishlist and get your best deal, a free game right now, or your gift-me page. The lines hold your private link, so keep them to yourself. In Discord: /server stream chat." }),
        field("Your chat bot", sel), area, h("div", { class: "row" }, cp));
    }
    async function draw() {
      let d;
      try { d = await api("/api/streamcard"); } catch (e) { panel.replaceChildren(h("h3", { text: "Deals overlay for OBS" }), h("div", { class: "notice warn", text: e.message })); return; }
      const head = h("h3", { text: "Deals overlay for OBS" });
      const blurb = h("p", { class: "muted", text: "A small card for your stream that rotates through the best deal on your wishlist, a game that is free right now, and a reminder that you have a public wishlist. It shows only public things. Add it in OBS as a Browser source." });
      if (!d.on) {
        const make = h("button", { class: "btn blue", type: "button", text: "Make my overlay link" });
        make.addEventListener("click", () => busy(make, async () => { await api("/api/streamcard", { action: "create" }); toast("Your overlay link is ready.", "ok"); draw(); }));
        panel.replaceChildren(head, blurb, h("div", { class: "row" }, make, h("a", { class: "btn gray", href: d.base + "?demo=1", target: "_blank", rel: "noopener noreferrer", text: "See a sample" })));
        return;
      }
      const boxes = KINDS.map(([k, label]) => { const c = h("input", { type: "checkbox", checked: d.kinds.includes(k) }); return [k, c, h("label", { class: "check" }, c, label)]; });
      const anchor = select([["bl", "Bottom left"], ["bc", "Bottom center"], ["br", "Bottom right"], ["tl", "Top left"], ["tc", "Top center"], ["tr", "Top right"], ["ml", "Middle left"], ["mr", "Middle right"]], "bl");
      const theme = select([["dark", "Dark"], ["light", "Light"], ["glass", "Glass"]], "dark");
      const hold = h("input", { type: "number", min: "4", max: "120", value: "12", "aria-label": "Seconds per card" });
      const scale = h("input", { type: "number", min: "0.5", max: "3", step: "0.1", value: "1", "aria-label": "Size" });
      const link = h("input", { type: "text", readonly: true, "aria-label": "Overlay link" });
      const build = () => { const u = new URL(d.base); u.searchParams.set("token", d.token); u.searchParams.set("anchor", anchor.value); if (theme.value !== "dark") u.searchParams.set("theme", theme.value); if (hold.value && hold.value !== "12") u.searchParams.set("hold", hold.value); if (scale.value && scale.value !== "1") u.searchParams.set("scale", scale.value); link.value = u.toString(); };
      [anchor, theme, hold, scale].forEach(e => e.addEventListener("input", build)); build();
      const save = h("button", { class: "btn blue small", type: "button", text: "Save cards" });
      save.addEventListener("click", () => busy(save, async () => { await api("/api/streamcard", { action: "save", kinds: boxes.filter(([, c]) => c.checked).map(([k]) => k) }); toast("Saved. The overlay updates within a couple of minutes.", "ok"); draw(); }));
      const reset = h("button", { class: "btn gray small", type: "button", text: "Make a new link" });
      reset.addEventListener("click", () => { if (confirm("Your old link stops working at once. Continue?")) busy(reset, async () => { await api("/api/streamcard", { action: "reset" }); toast("New link made. Paste it into OBS again.", "ok"); draw(); }); });
      const off = h("button", { class: "btn red small", type: "button", text: "Turn it off" });
      off.addEventListener("click", () => busy(off, async () => { await api("/api/streamcard", { action: "remove" }); toast("Overlay link removed.", "ok"); draw(); }));
      const giftNote = d.kinds.includes("gift") && !d.public ? h("div", { class: "notice warn", text: "The gift card stays hidden until your public wishlist page is on. Turn it on in the next section." }) : null;
      const copyBtn = h("button", { class: "btn gray small", type: "button", text: "Copy link" }); copyBtn.addEventListener("click", () => copy(link.value));
      panel.replaceChildren(head, blurb, h("div", { class: "grid two" }, boxes.map(b => b[2])), giftNote,
        h("div", { class: "row" }, save),
        h("h4", { text: "Look" }), h("div", { class: "grid two" }, field("Where", anchor), field("Colors", theme), field("Seconds per card", hold), field("Size (1 is normal)", scale)),
        field("Your private link (keep it to yourself)", link),
        h("div", { class: "row" }, copyBtn, h("a", { class: "btn gray small", href: link.value, target: "_blank", rel: "noopener noreferrer", text: "Open it" }), reset, off),
        h("p", { class: "muted small", text: "In OBS: add a Browser source, paste the link, set width 600 and height 200. Anyone with the link can see these cards, so make a new one if it leaks." }),
        chatBox(d));
    }
    draw();
    return panel;
  }
  root.StreamCardPanelUI = { view };
})(window);

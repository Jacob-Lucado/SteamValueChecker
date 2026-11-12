// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls ConnectUI.view(ctx).
(function (root) {
  "use strict";
  function view(ctx) {
    const { api, app, extSend, fromExt, h, pageHead, state, steamLoginBtn } = ctx;
    const box = h("div", { class: "panel" });
    app.replaceChildren(pageHead("Link FanaticalGrabber", "Connect the extension to your account so prices, playtests and your library show up while you browse."), box);
    const flag = on => { try { on ? localStorage.setItem("svc_connect", "1") : localStorage.removeItem("svc_connect"); } catch { /* storage blocked */ } };
    if (!state.me) {
      flag(true);
      box.replaceChildren(h("p", {}, "Sign in first, then this page links the extension for you automatically."),
        h("p", {}, steamLoginBtn("Sign in through Steam", "btn steam big"), " ", h("a", { class: "btn blue big", href: "/auth/login", text: "Sign in with Discord" })));
      return;
    }
    flag(false);
    const status = h("p", { class: "muted", text: "Looking for the extension…" });
    const code = h("div"), retry = h("button", { class: "btn gray", text: "Try again" });
    box.replaceChildren(status, h("p", {}, retry), code);
    const ask = (type, extra = {}) => new Promise(res => {
      const on = e => { if (fromExt(e) && e.data && e.data.svc === "ext" && (e.data.type === (type === "ping" ? "pong" : "connected"))) { window.removeEventListener("message", on); res(e.data); } };
      window.addEventListener("message", on); extSend({ svc: "page", type, ...extra });
      setTimeout(() => { window.removeEventListener("message", on); res(null); }, 1500);
    });
    async function manual() {
      try {
        const { token } = await api("/api/grabber/token", { action: "new" });
        const input = h("input", { type: "text", readonly: "", value: token, style: "width:100%;font-family:monospace" });
        input.addEventListener("focus", () => input.select());
        const copy = h("button", { class: "btn blue small", text: "Copy code" });
        copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(token); copy.textContent = "Copied"; } catch { input.select(); } });
        code.replaceChildren(h("h4", { text: "Or paste a code" }), h("p", { class: "muted small", text: "Click the FanaticalGrabber icon in your toolbar (the puzzle piece menu if it is hidden), open \"Have a code? Paste it\", and paste this. It is shown once, and anyone with it can add games to your library." }), input, h("p", {}, copy));
      } catch (e) { code.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    const success = (ver, again) => {
      const feats = ["Prices, all-time lows and your library status on Steam pages", "Playtest and demo badges", "How many people in your server own a game", "One-click wishlist and stream spotlight", "Free games to keep, with optional auto-claim", "Price and region checks on Fanatical"];
      status.className = "";
      status.replaceChildren(h("div", { class: "notice" }, h("b", { text: again ? "FanaticalGrabber is already connected. " : "Connected successfully. " }), `FanaticalGrabber${ver ? " " + String(ver).slice(0, 12) : ""} is linked to your account${state.me && state.me.name ? ", " + state.me.name : ""}. Only game names are ever sent, never your keys.`),
        h("h4", { text: "Now switched on" }), h("ul", {}, feats.map(f => h("li", { text: f }))),
        h("p", {}, h("a", { class: "btn steam", href: "https://store.steampowered.com", target: "_blank", rel: "noopener noreferrer", text: "Open the Steam store" }), " ", h("a", { class: "btn blue", href: "#/home", text: "Go to my dashboard" })),
        again ? h("p", { class: "muted small", text: "Having trouble? Press Try again to make a fresh link." }) : h("p", { class: "muted small", text: "You can close this tab. The extension's toolbar icon now shows your free game and alert counts." }));
    };
    async function go(force) {
      status.className = "muted"; status.textContent = "Looking for the extension…"; code.replaceChildren();
      const here = await ask("ping");
      if (!here) { status.className = ""; status.replaceChildren(h("div", { class: "notice warn", text: "I can't see the extension on this page. Make sure FanaticalGrabber is installed and up to date, then reload. If it keeps happening, paste a code instead." })); manual(); return; }
      if (here.linked && force !== true) { try { const { link } = await api("/api/grabber"); if (link) { success(here.version, true); return; } } catch { /* fall through and link again */ } }
      try {
        const { token } = await api("/api/grabber/token", { action: "new" });
        const done = await ask("connect", { token });
        if (done && done.ok) { success(here.version, false); return; }
      } catch (e) { status.replaceChildren(h("div", { class: "notice warn", text: e.message })); return; }
      status.replaceChildren(h("div", { class: "notice warn", text: "The extension did not accept the link. Update it, then try again, or paste a code instead." })); manual();
    }
    retry.addEventListener("click", () => go(true));
    go();
  }
  root.ConnectUI = { view };
})(window);

// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls StreamerHubUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { app, currentParam, field, h, pageHead, publicPagePanel, serverPicker, state, streamersView, streamsView } = ctx;
    const servers = state.me.servers.filter(g => g.bot !== false);
    const guild = servers.length ? serverPicker(servers, currentParam()) : null;
    const goBox = h("div", { id: "sh-live" }), rosterBox = h("div", { id: "sh-roster" });
    const jump = (id, label) => h("a", { class: "chip-btn", href: "#/streamer", text: label, onclick: e => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); } });
    app.replaceChildren(pageHead("Streamer hub", "Everything for streamers in one place: announce when you go live, the overlays for OBS, your gift-me wishlist, and who else is streaming. In Discord: /server stream."),
      h("div", { class: "panel" }, servers.length > 1 ? field("Server", guild) : null,
        h("div", { class: "chips" }, jump("sh-live", "Go live and pings"), jump("sh-gift", "Gift me page"), jump("sh-roster", "Who is live"))),
      h("div", { class: "notice" }, h("b", { text: "What these need: " }), "your Discord sign-in with the bot in your server. The Playing now card, !game and Now playing also need Steam linked (Steam page) and Game details set to Public. The browser extension features (spotlight, wishlist from a store page) need the extension linked with the bot: ", h("a", { href: "#/library", text: "Library, Connect the extension" }), "."),
      goBox, h("div", { class: "panel" }, h("h3", { text: "Overlays for OBS" }), h("p", { class: "muted", text: "Now playing, giveaway, deals and cards, goal bars, server stats and timers are all in one place now." }), h("a", { class: "btn blue", href: "#/overlays", text: "Open the Overlay studio" })), h("div", { id: "sh-gift" }, publicPagePanel()),
      h("div", { class: "panel" }, h("h3", { text: "Discord commands" }), h("p", { class: "muted small", text: "/server stream link links your Twitch, Kick or YouTube channel. /server stream live, title and game post or update a go-live message. /server stream end closes it. /server stream ping turns the go-live pings on or off for you. /alerts share and /server nowplaying let friends see you in a game." })),
      rosterBox);
    if (!servers.length) { goBox.replaceChildren(h("div", { class: "notice warn", text: "The bot is not in any of your servers yet, so go-live posts are off. The overlay and gift page below still work. Add the bot from the Servers page." })); rosterBox.remove(); return; }
    await Promise.all([streamsView({ into: goBox, guild }), streamersView({ into: rosterBox, guild })]);
  }
  root.StreamerHubUI = { view };
})(window);

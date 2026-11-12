// A piece of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls ProfileRenderUI.view(ctx).
(function (root) {
  "use strict";
  function view(shared, p, { canMark = false, preview = false, signedIn = false, region = null, social = null } = {}) {
    const { PF_TITLE, PF_VIS, ext, giftButton, h, httpsOnly, money, pageBgEl, pfArt, pfGuestbook, pfPosts, pfReport, pfSocial, pfSong, pfTile, soonControl, wishSlider } = shared;
    const root = h("div", { class: "pf", "data-bg": p.theme.bgstyle, "data-layout": p.theme.layout, "data-light": p.theme.light ? "1" : "0", "data-style": p.theme.style || "classic" });
    root.style.setProperty("--pf-bg", p.theme.bg);
    root.style.setProperty("--pf-accent", p.theme.accent);
    root.style.setProperty("--pf-fg", p.theme.light ? "#1b1f2a" : "#eef1f8");
    const banner = h("div", { class: "pf-banner" + (p.banner.kind === "none" ? " none" : "") });
    if (p.banner.kind === "game" && httpsOnly(p.banner.art)) { banner.classList.add("art");
      // Steam's header is only 460 wide and looks soft stretched across the page. The hero is much larger; where a game has none, the header underneath shows instead.
      const hero = p.banner.art.replace(/\/art\/header\/(\d+)\.jpg$/, "/art/hero/$1.jpg").replace(/\/header\.jpg(\?.*)?$/, "/library_hero.jpg");
      banner.style.backgroundImage = hero !== p.banner.art ? `url("${hero}"), url("${p.banner.art}")` : `url("${p.banner.art}")`; }
    const avatar = httpsOnly(p.avatar) ? h("img", { class: "pf-avatar" + (p.supporter ? " sup" : ""), src: p.avatar, alt: "" }) : h("div", { class: "pf-avatar init" + (p.supporter ? " sup" : ""), text: (p.name || "?").slice(0, 1).toUpperCase() });
    const head = h("div", { class: "pf-head" }, avatar,
      h("div", { class: "pf-who" }, h("h1", { text: p.name }), h("div", { class: "muted small", text: "@" + p.slug }), p.supporter ? h("span", { class: "pf-badge", title: "Supports Steam Value Checker", text: "★ Supporter" }) : null, p.founder ? h("span", { class: "pf-badge founder", title: "One of the first 50 supporters", text: "✦ Founding supporter" }) : null),
      h("div", { class: "pf-actions" }, p.owner && !preview ? h("a", { class: "btn gray small", href: "#/profile", text: "Edit profile" }) : null, !p.owner && !preview ? pfReport(p.slug) : null));
    root.append(banner, head);
    if (social && !preview) root.append(pfSocial(p, social));
    const pageBg = pageBgEl(p.pagebg, { preview });
    if (pageBg && !preview) root.append(pageBg);
    let songBox = null;
    if (p.songOff && p.owner && !preview) root.append(h("div", { class: "notice warn", text: "Your song is saved, but profile songs are switched off on this bot right now, so visitors don't see the player. (Admin panel > Bot settings > Profile songs play.)" }));
    if (p.song) { songBox = pfSong(p.song, preview); root.append(songBox); }
    if (p.song && p.enter && !preview) {
      // The click on this screen is what lets the browser start the sound straight away.
      const gate = h("button", { type: "button", class: "pf-enter", "aria-label": "Enter " + p.name }, h("span", { class: "pf-enter-in" }, h("span", { class: "pf-enter-name", text: p.name }), h("span", { class: "pf-enter-hint", text: "Click to enter" })));
      gate.addEventListener("click", () => { gate.remove(); songBox.start(); });
      root.append(gate);
    }
    const body = h("div", { class: "pf-body" });
    for (const s of p.sections) {
      const title = h("h3", {}, PF_TITLE[s.key] || s.key, p.owner && s.vis !== "public" ? h("span", { class: "chip dim", text: PF_VIS[s.vis] }) : null);
      let inner = null;
      if (s.key === "about") {
        if (!p.bio && !p.links.length) { if (!p.owner) continue; inner = h("p", { class: "muted", text: "Add a bio and some links in the editor." }); }
        else inner = h("div", {}, p.bio ? h("p", { class: "pf-bio", text: p.bio }) : null,
          p.links.length ? h("div", { class: "pf-links" }, p.links.map(l => ext(l.url, l.label, "pf-chip"))) : null);
      } else if (s.key === "favorites") {
        inner = s.games.length ? h("div", { class: "pf-tiles" }, s.games.map(pfTile)) : h("p", { class: "muted", text: "Pick up to five favorites in the editor." });
      } else if (s.key === "nowplaying") {
        inner = s.now ? h("div", { class: "pf-tiles" }, pfTile(s.now), h("span", { class: "chip ok", text: "Playing right now" })) : h("p", { class: "muted", text: "Not in a game right now." });
      } else if (s.key === "recent") {
        inner = s.games.length ? h("div", { class: "pf-tiles" }, s.games.map(pfTile)) : h("p", { class: "muted", text: "Nothing marked finished yet." });
      } else if (s.key === "trophies") {
        inner = s.badges.length ? h("div", { class: "pf-links" }, s.badges.map(b => h("span", { class: "pf-chip", text: `${b.icon} ${b.name} · ${b.tier}` })), h("span", { class: "muted small", text: `${s.earned} of ${s.total} earned` })) : h("p", { class: "muted", text: "No trophies yet." });
      } else if (s.key === "posts") {
        inner = pfPosts(s);
      } else if (s.key === "guestbook") {
        inner = preview ? h("p", { class: "muted", text: "Visitors who sign in with Discord can leave you a short note here." }) : pfGuestbook(p, s);
      } else if (s.key === "achievements") {
        const stat = (n, l) => h("div", { class: "pf-stat" }, h("b", { text: Number(n).toLocaleString() }), h("span", { text: l }));
        inner = h("div", {},
          s.top.length ? h("div", { class: "pf-ach" }, s.top.map(a => h("div", { class: "pf-ach-i", title: `${a.name} · ${a.game} · ${a.pct}% of players` },
            a.icon ? h("img", { src: a.icon, alt: a.name, loading: "lazy", referrerpolicy: "no-referrer" }) : h("span", { class: "pf-ach-x", text: "★" })))) : null,
          h("div", { class: "pf-stats" }, stat(s.done, "Achievements"), stat(s.rare, "Rare achievements")));
      } else if (s.key === "activity") {
        const day = t => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        inner = h("div", { class: "pf-act" },
          s.hours2w ? h("p", { class: "muted small", text: `${s.hours2w} hours past 2 weeks` }) : null,
          s.games.map(g => h("div", { class: "pf-act-g" },
            h("div", { class: "pf-act-top" }, pfArt(g.art, g.title),
              h("div", { class: "pf-act-info" }, h("strong", { text: g.title }),
                h("span", { class: "muted small", text: `${g.hours.toLocaleString()} hrs on record` }),
                h("span", { class: "muted small", text: `last played ${day(g.last)}` }))),
            g.total ? h("div", { class: "pf-act-ach" },
              h("div", { class: "pf-act-bar" }, h("span", { text: `${g.done} / ${g.total} Achievements` }), h("i", {}, (() => { const fill = h("b"); fill.style.width = Math.round(g.done / g.total * 100) + "%"; return fill; })())),
              h("div", { class: "pf-act-ico" }, g.unlocks.map(u => u.icon ? h("img", { src: u.icon, alt: u.name, title: u.name, loading: "lazy", referrerpolicy: "no-referrer" }) : null),
                g.done > g.unlocks.length ? h("span", { class: "pf-act-more", text: "+" + (g.done - g.unlocks.length) }) : null)) : null)));
      } else if (s.key === "steam") {
        const stat = (n, l) => h("div", { class: "pf-stat" }, h("b", { text: Number(n).toLocaleString() }), h("span", { text: l }));
        inner = h("div", { class: "pf-stats" }, stat(s.games, "Steam games"), stat(s.hours, "Hours played"), stat(s.library, "In the library"), stat(s.finished, "Finished"));
      } else if (s.key === "value") {
        const stat = (n, l) => h("div", { class: "pf-stat" }, h("b", { text: n }), h("span", { text: l }));
        const usd = n => "$" + Number(n).toLocaleString();
        inner = h("div", {}, h("div", { class: "pf-stats" }, stat(usd(s.worth), "Library worth"), stat(usd(s.paid), "Actually paid"), stat(usd(s.saved), "Saved"), stat(Number(s.games).toLocaleString(), "Games counted")),
          h("p", { class: "muted small", text: "Worth is the full price of every game. Updated " + s.day + "." }),
          p.owner && p.slug ? h("label", { class: "muted small" }, "Badge image link for your bio or signature ",
            h("input", { type: "text", readonly: "readonly", value: location.origin + "/u/" + p.slug + "/badge.svg", onfocus: e => e.target.select() })) : null);
      } else if (s.key === "streams") {
        inner = h("div", {}, h("div", { class: "pf-links" }, ...(s.channels && s.channels.length ? s.channels : [s]).map(c => ext(c.url, (c.platform === "twitch" ? "Twitch" : c.platform === "kick" ? "Kick" : "YouTube") + ": " + c.handle, "pf-chip")), s.live ? h("span", { class: "chip warn", text: "LIVE NOW" }) : null),
          s.live ? h("p", { class: "muted small", text: s.live.title + (s.live.game ? " · " + s.live.game : "") }) : null);
      } else if (s.key === "wishlist") {
        inner = s.games.length ? wishSlider(s.games, g => h("div", { class: "free-card pf-slide" },
          pfArt(g.art, g.title),
          h("div", { class: "free-info" }, h("strong", { text: g.title }),
            h("span", { class: "muted small", text: (g.discount > 0 ? `${g.discount}% off • ` : "") + (g.shop || "") }),
            h("b", { text: money(g.price, g.currency) }),
            h("div", { class: "pf-slide-act" }, g.url && ext(g.url, "View deal", "btn green small"), preview ? null : soonControl(g, p.slug, canMark), preview ? null : giftButton(g, p.slug, { signedIn, owner: p.owner, open: s.giftsOpen !== false, region }))))) : h("p", { class: "muted", text: "Nothing on this list yet." });
      }
      if (inner) body.append(h("section", { class: "pf-card pf-" + s.key }, title, inner));
    }
    if (!p.sections.length) body.append(h("p", { class: "muted", text: "This profile has nothing to show right now." }));
    root.append(body);
    if (pageBg && preview) { const stage = h("div", { class: "pf-stage" }, pageBg, root); return stage; }
    if (p.theme.fx && window.ProfileFx) setTimeout(() => { if (root.isConnected) window.ProfileFx.start(root, p.theme.fx); }, 0);
    if (p.theme.style === "kinetic") root.prepend(h("div", { class: "pf-kin", "aria-hidden": "true" }, h("span", { class: "pf-kin-name", text: (p.name || "").slice(0, 14) })));
    return root;
  }
  root.ProfileRenderUI = { view };
})(window);

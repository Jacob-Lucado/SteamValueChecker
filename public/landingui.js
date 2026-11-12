// A piece of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls LandingUI.view(ctx).
(function (root) {
  "use strict";
  function view(shared) {
    const { LOC, api, app, ext, fanaticalCard, h, newsBanner, osPreview, setupCard, state, steamLoginBtn } = shared;
    const failed = new URLSearchParams(LOC.search).get("error");
    const ab = state.about;
    const n = v => (v === null || v === undefined ? null : Number(v).toLocaleString());
    const invite = state.cfg && state.cfg.inviteUrl;
    const onDesk = Boolean(window.LucadoOS?.active()); // already inside the desktop theme: offer the way back, not the way in
    const cta = (extra = "") => h("div", { class: "lp-cta " + extra },
      invite && ext(invite, "Add to a server", "btn green big"),
      state.cfg && state.cfg.supportUrl && ext(state.cfg.supportUrl, "Join the support server", "btn gray big"),
      state.cfg && state.cfg.userInstallUrl && ext(state.cfg.userInstallUrl, "Add to your account", "btn blue big"),
      state.me ? h("a", { class: "btn blue big", href: "#/value", text: "Open the dashboard" }) : [steamLoginBtn("Sign in through Steam", "btn steam big"), h("a", { class: "btn blue big", href: "/auth/login", text: "Sign in with Discord" })]);

    // The hero collage: a sale alert and two of the pictures the AI companion posts.
    const pic = (src, cls) => h("img", { class: "lx-pic " + cls, src, alt: "", loading: "eager", width: "480", height: "260" });
    const alertMock = h("div", { class: "dc-card lx-alert", "aria-hidden": "true" },
      h("div", { class: "dc-bot" }, h("img", { src: "/logo.png", alt: "", width: "32", height: "32" }), h("b", { text: "Steam Value Checker" }), h("span", { class: "dc-tag", text: "APP" })),
      h("div", { class: "dc-embed" },
        h("div", { class: "dc-title", text: "Wanderstop is 61% off" }),
        h("div", { class: "dc-line", text: "All-time low: $9.87 at Fanatical" }),
        h("div", { class: "dc-fields" }, h("span", {}, h("b", { text: "Regular" }), "$24.99"), h("span", {}, h("b", { text: "You save" }), "$15.12"))),
      h("div", { class: "dc-buttons" }, h("span", { class: "dc-btn link", text: "View deal" }), h("span", { class: "dc-btn", text: "Price history" })));
    const collage = h("div", { class: "lx-collage", "aria-hidden": "true" },
      h("i", { class: "lx-blob b1" }), h("i", { class: "lx-blob b2" }),
      pic("/img/ai/library.png", "p1"), pic("/img/ai/history.png", "p2"), alertMock);

    const sec = (cls, ...kids) => h("section", { class: "lx-sec " + cls }, ...kids);
    const head = (kicker, title, sub) => h("div", { class: "lx-head" }, h("div", { class: "lx-kick", text: kicker }), h("h2", { text: title }), sub && h("p", { class: "lx-lede", text: sub }));
    const stat = (label, value) => { if (!value) return value; const v = h("div", { class: "v", text: value }), num = Number(String(value).replace(/,/g, "")); if (Number.isFinite(num) && num > 0) v.setAttribute("data-count", String(num)); return h("div", { class: "lp-stat" }, v, h("div", { class: "k", text: label })); };

    // The features, by area. Tabs switch the grid under them.
    const AREAS = [
      ["Deals and alerts", "#ffb347", [
        ["Wishlist alerts", "Bring in your public Steam wishlist and pick what counts as worth a ping: any sale, a percent off, a price you set, or an all-time low."],
        ["Free game alerts", "A message when a game goes free on Steam, Epic, GOG and others, with a button to grab it."],
        ["Price history", "A graph of the last year with the all-time low marked, and a buy-or-wait verdict that counts the next big sale."],
        ["Hot deals and sale starts", "Your server gets a post when a big deal shows up or a Steam sale kicks off. You pick the minimum discount."],
        ["Sale war room", "Set a budget before a Steam sale and plan the cart around it."],
        ["Bundle check", "Checks a bundle against what its games cost today, and skips the ones you own."],
        ["Playtests and demos", "Betas, demos, free weekends and sign-ups from Steam announcements and a few other sources."],
        ["Game codes", "SHiFT codes and other limited-time game codes, posted once each with an end date, then grayed out."],
        ["DLC sales and news", "A heads-up when add-ons for games you play are heavily discounted, plus patch notes and release dates."]]],
      ["Your library", "#4ade80", [
        ["Library value", "The full price, what Steam charges today, the cheapest store right now, and what you saved on what you paid."],
        ["Steam library", "Sign in with Steam for hours, what you never touched, achievements and a pick for what to play next."],
        ["Spending", "What you've spent by month, what you paid per game, and the games bought but never played."],
        ["Badges and challenges", "Badges for your library, a monthly finish goal and a streak, plus a backlog league for your server."],
        ["Compare", "Put two games side by side on price, reviews and genre."],
        ["Profile card", "A shareable card with your library stats, and a public page of your own."],
        ["Refund reminders", "A nudge before the two-hour and fourteen-day refund windows close."]]],
      ["Your server", "#60a5fa", [
        ["Steam Verified role", "Members prove their Steam account with Steam's own sign-in and get a role. Nobody types a password."],
        ["Welcome and roles", "Welcome cards with a picture, an auto role for new members, and a goodbye message if you want one."],
        ["Levels and XP", "Chat levels with ranks, a leaderboard and role rewards."],
        ["Moderation", "Warnings, timeouts, bans and a log channel, all in one place."],
        ["Server guides", "Write your own answers for rules, roles and channels. The bot replies to matching questions by itself."],
        ["Looking for group", "Post a game, a time and open slots. People hit Join and the post fills up."],
        ["Calendar and game night", "A server calendar, event reminders and a game night that picks what to play."],
        ["Trivia, Secret Santa, game club", "Quizzes, gift swaps and a club that votes on its next game."],
        ["Now playing", "A squad-up post when two or more members are in the same game."],
        ["Shared wishlist", "A wishlist the whole server votes on, and a ping when a few members wait on the same deal."]]],
      ["Community", "#f472b6", [
        ["Community feed", "Follow people, post, react and discover what other gamers are up to."],
        ["Server directory", "A directory of communities, with a feed for each server."],
        ["Public profiles", "A page with your games, achievements and a guestbook people can sign."],
        ["Friends and gifts", "Friends' birthdays a week ahead, what's on sale from their wishlists, and gift claims so two people don't buy the same game."],
        ["Leaderboards", "A savings leaderboard for people who opt in, and a backlog league."]]],
      ["Giveaways and streaming", "#fbbf24", [
        ["Giveaways", "Hand out keys, Nitro, gift cards or anything else. Winners claim with a button, confirm it worked and a vouch posts for you."],
        ["Encrypted prize keys", "Keys are encrypted the moment they're saved, and only the winner ever sees one."],
        ["Twitch chat entry", "Viewers enter from Twitch chat. Winners are drawn and announced in Discord."],
        ["Stream overlays", "Giveaway, now-playing and stream-card overlays for OBS."],
        ["Streamer hub", "Link your channel, show who's live in your server and post go-live alerts."]]],
      ["Music and tools", "#a78bfa", [
        ["SoundCloud music", "Songs and playlists in a voice channel with /play. Queue, skip votes, loop and a live now-playing card."],
        ["Radio stations", "A radio mode and a full player on the dashboard."],
        ["FanaticalGrabber", "A Chrome extension that reveals and exports your Fanatical game keys, with batch redeem for Steam."],
        ["Twelve languages", "The dashboard and bot speak twelve languages."],
        ["Installable dashboard", "Add the dashboard to your phone's home screen. It works like an app."],
        ["Support desk", "Report a bug or open a ticket. Replies show up on Discord and the dashboard."]]]
    ];
    const tabsHost = h("div", { class: "lx-tabs", role: "tablist" }), gridHost = h("div", { class: "lx-feats" });
    const showArea = i => {
      [...tabsHost.children].forEach((b, k) => b.setAttribute("aria-selected", String(k === i)));
      const [, hue, items] = AREAS[i];
      gridHost.replaceChildren(...items.map(([t, d], k) => { const c = h("div", { class: "lx-feat" }, h("b", { text: t }), h("span", { text: d })); c.style.setProperty("--hue", hue); c.style.animationDelay = k * 30 + "ms"; return c; }));
    };
    AREAS.forEach(([name, hue], i) => { const b = h("button", { type: "button", role: "tab", text: name }); b.style.setProperty("--hue", hue); b.addEventListener("click", () => showArea(i)); tabsHost.append(b); });
    showArea(0);

    const shipped = [
      ["NEW", "Indie developer corner", "A free showcase for indie games and a toolbox for Steam developers. Browsing needs no sign-in."],
      ["AI", "The AI companion", "Ask in plain words and get pictures back: price graphs, comparisons, library stats and play plans."],
      ["NEW", "Buy or wait", "A verdict with the reasons and a year of price history."],
      ["NEW", "How-to guides", "Ask \"how do I get Steam verified\" and the bot answers with a picture guide on its own."],
      ["NEW", "Server guides", "Managers write their own answers for rules, roles and channels."],
      ["NEW", "Group posts by chat", "Ask for a looking-for-group post or an event and it makes the real thing."],
      ["NEW", "Notes it keeps", "It remembers what you like, a few short notes, and forgets whenever you say."]
    ];
    const step = (num, title, text) => h("div", { class: "lp-step" }, h("div", { class: "lp-num", text: num }), h("h3", { text: title }), h("p", { text }));
    const indieShots = h("div", { class: "lx-indie-shots" }, [["fee-calculator", "Steam fee and tax calculator", "What you keep from each sale"], ["wishlist-calculator", "Wishlist calculator", "Wishlists into likely sales"], ["capsule-analyzer", "Capsule analyzer", "Does it read at thumbnail size?"], ["next-fest-score", "Next Fest readiness score", "What to fix before the festival"]]
      .map(([id, t, d]) => h("a", { class: "lx-ix-tool", href: `/indie/tools/${id}` }, h("b", { text: t }), h("span", { text: d }))));
    api("/api/indie").then(d => {
      const list = [...(d.featured || []), ...(d.games || [])].filter((g, i, a) => a.findIndex(x => x.id === g.id) === i).slice(0, 3);
      if (list.length < 3 || !document.body.contains(indieShots)) return;
      indieShots.replaceChildren(...list.map(g => h("a", { class: "lx-ix-card real", href: `/indie/game/${g.id}`, tabindex: "-1" }, h("img", { src: g.image, alt: "", width: 460, height: 215, loading: "lazy" }), h("b", { text: g.title }), h("span", { text: g.studio || "Indie studio" }))));
    }).catch(() => {});
    const aiShots = ["history", "compare", "plan"].map(s => h("img", { src: `/img/ai/${s}.png`, alt: "", loading: "lazy", width: "480", height: "260" }));

    app.replaceChildren(...[
      state.me && newsBanner(),
      state.me && h("section", { class: "lp-setup" }, setupCard()),
      h("section", { class: "lx-hero" },
        h("i", { class: "lx-aurora a1" }), h("i", { class: "lx-aurora a2" }),
        h("div", { class: "lx-hero-text" },
          failed && h("div", { class: "notice warn", text: "Sign-in didn't work. Give it another go." }),
          h("a", { class: "lx-new", href: "/ai" }, h("b", { text: "NEW" }), "Meet the AI companion", h("span", { class: "lx-beta", text: "BETA" }), h("i", { text: "→" })),
          h("a", { class: "lx-new lx-new-indie", href: "/indie" }, h("b", { text: "NEW" }), "Creators: indie showcase and free tools", h("i", { text: "→" })),
          state.freeNow ? h("a", { class: "lp-live", href: state.me ? "#/free" : "/auth/login" }, h("i", { class: "lp-dot" }), `${state.freeNow} free offer${state.freeNow === 1 ? "" : "s"} live right now`) : null,
          h("h1", {}, "Your whole gaming life, ", h("span", { class: "lx-grad", text: "worth every penny" }), "."),
          h("p", { class: "lp-sub", text: "I made this bot because I kept losing track of what I'd paid for games. Now it prices your library, watches your wishlist, answers questions with pictures, and runs your gaming server. All free, in Discord and on the web." }),
          cta(),
          h("p", { class: "muted small", text: "It will never ask for a password or a game key. Signing in only shares your name, avatar and server list." })),
        collage),

      h("div", { class: "lp-ticker", "aria-hidden": "true" }, h("div", { class: "lp-ticker-track" },
        ...[0, 1].flatMap(() => ["AI companion", "Indie showcase", "Developer tools", "Library value", "Price graphs", "Wishlist alerts", "Free games", "Steam Verified", "Levels and XP", "Looking for group", "Giveaways", "Stream overlays", "Music", "Guides", "Profiles"].map(t => h("span", { text: t }))))),

      ab && (n(ab.servers) || n(ab.gamesWatched)) ? h("section", { class: "lp-stats" },
        stat("Servers", n(ab.servers)), stat("Games watched", n(ab.gamesWatched)), stat("Alerts in the last 24h", n(ab.alerts24h)), stat("Giveaway keys redeemed", n(ab.redeemed))) : null,

      sec("lx-os",
        h("div", { class: "lx-os-text" },
          h("span", { class: "lx-kick", text: "Desktop theme" }),
          h("h2", { text: onDesk ? "You're on the desktop theme" : "Want it to feel like a desktop?" }),
          h("p", { class: "lp-sub", text: onDesk ? "Every page is an icon and every page you open is a window. Drag them, resize them, snap them side by side, and use Personalize for your own wallpaper and colors. Prefer the regular site? It's one click away." : "LucadoOS turns the whole site into a desktop. Every page is an icon, every page you open is a window you can move, resize and snap side by side, and there's a taskbar and a Start menu. Pick your own wallpaper and colors in Personalize." }),
          h("div", { class: "lp-cta" }, onDesk ? h("button", { class: "btn gray big", type: "button", text: "Back to the classic site", onclick: () => window.LucadoOS.setMode("classic") }) : window.LucadoOS?.canUse() ? h("button", { class: "btn blue big", type: "button", text: "Try the desktop", onclick: () => window.LucadoOS.setMode("os") }) : null),
          h("p", { class: "muted small", text: onDesk ? "Your windows and settings are kept if you come back." : "It's a choice, not a change. Classic stays the default, and you can switch back from the taskbar any time. Desktop view needs a screen at least 900 pixels wide." })),
        osPreview()),

      sec("lx-ai",
        h("i", { class: "lx-aurora a3" }),
        h("div", { class: "lx-ai-text" },
          h("div", { class: "lx-ai-badges" }, h("span", { class: "lx-beta big", text: "BETA" }), h("span", { class: "lx-kick", text: "AI companion" })),
          h("h2", { text: "Say Hey AI. Get answers you can read at a glance." }),
          h("p", { class: "lp-sub", text: "Ask whether a game is worth buying, how two games compare, what to play with the hours you have, or how to set something up. It answers with real pictures and buttons, from your own data, and it can do things for you like adding to your wishlist or setting a price alert." }),
          h("div", { class: "lp-cta" }, h("a", { class: "btn blue big", href: "/ai", text: "See what it can do" }), invite && ext(invite, "Add it to a server", "btn gray big")),
          h("p", { class: "muted small", text: "It's in beta. It can be wrong, so check a price before you buy." })),
        h("div", { class: "lx-ai-shots", "aria-hidden": "true" }, ...aiShots)),

      sec("lx-indie",
        h("div", { class: "lx-indie-text" },
          h("span", { class: "lx-kick", text: "Indie corner" }),
          h("h2", { text: "A home for indie games on Steam" }),
          h("p", { class: "lp-sub", text: "Find games from small studios, or put your own in front of people. It's free, and developers get a set of Steam tools for fees, wishlists, capsules and launch planning." }),
          h("div", { class: "lp-cta" }, h("a", { class: "btn blue big", href: "/indie", text: "Browse indie games" }), h("a", { class: "btn gray big", href: "/indie/tools", text: "Developer tools" }))),
        indieShots),

      sec("",
        head("Fresh from the workshop", "What's new", "Everything added in the last few days."),
        h("div", { class: "lx-new-grid" }, ...shipped.map(([tag, t, d]) => h("div", { class: "lx-newcard" }, h("b", { class: "lx-tag" + (tag === "AI" ? " ai" : ""), text: tag }), h("h3", { text: t }), h("p", { text: d })))),
        h("p", { class: "lx-more" }, h("a", { href: "#/changelog", text: "See the full changelog →" }))),

      sec("",
        head("Everything in one bot", "Pick an area", "Six areas, one bot, one dashboard."),
        tabsHost, gridHost),

      sec("",
        head("Getting started", "Three steps", null),
        h("div", { class: "lp-grid three" },
          step("1", "Add the bot", "Invite it to your server. Alerts only need it to read and send messages. The community tools need channel and role permissions too, and the invite screen lists them."),
          step("2", "Add your games", "Sign in with Steam to bring in your library and wishlist, upload a FanaticalGrabber export, or just type game names."),
          step("3", "Choose your alerts", "Alerts come by DM or in a server channel, whichever you like. If you manage a server you can switch on the AI, guides, levels and giveaways too."))),

      sec("lp-split",
        h("div", {},
          h("h2", { text: "Giveaways that stay safe" }),
          h("p", { class: "lp-sub", text: "Prize keys are encrypted the moment they're saved, and only the winner ever sees one. Once the winner says it worked, the key is wiped and a vouch goes up." }),
          h("ul", { class: "lp-list" },
            h("li", { text: "Several prizes in one giveaway" }),
            h("li", { text: "The winner presses Claim prize. If their DMs are closed, the key is shown privately in the channel" }),
            h("li", { text: "Unclaimed prizes are redrawn, and unused keys go back to the host" }),
            h("li", { text: "Custom art, GIFs or video, role requirements and bonus entries" }))),
        h("div", { class: "lp-flow" },
          ...[["", "Giveaway ends", "Winners are drawn and announced"], ["", "Claim prize", "The key is sent by DM"], ["", "Confirm it worked", "The winner presses one button"], ["", "Vouch posted", "In your vouches channel"]]
            .map(([i, t, s]) => h("div", { class: "lp-flow-step" }, h("span", { class: "lp-flow-icon", text: i }), h("div", {}, h("b", { text: t }), h("div", { class: "muted small", text: s })))))),

      fanaticalCard(),

      h("section", { class: "lx-sec lp-trust" },
        head("Your data", "Yours, and you can leave", null),
        h("div", { class: "lp-grid three" },
          h("div", { class: "lp-feature" }, h("h3", { text: "No passwords" }), h("p", { text: "The bot never asks for a Steam, Fanatical or store password, and it ignores anything in chat that looks like a key." })),
          h("div", { class: "lp-feature" }, h("h3", { text: "Limited sharing" }), h("p", { text: "Game titles go to IsThereAnyDeal so it can look up prices. That's the only thing that leaves the bot." })),
          h("div", { class: "lp-feature" }, h("h3", { text: "Export or delete" }), h("p", { text: "Run /me mydata or use the dashboard to download or wipe everything stored about you, including what the AI remembers." })))),

      h("section", { class: "lp-final lx-final" },
        h("i", { class: "lx-aurora a1" }),
        h("h2", { text: "Add it to your server" }),
        cta("center"))].filter(Boolean));
  }
  root.LandingUI = { view };
})(window);

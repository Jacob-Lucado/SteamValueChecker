// The indie section: the showcase, a game's page, submitting, your own games and the tools pages.
// app.js hands over its helpers (ctx) and calls view(ctx) whenever the address starts with /indie.
(function (root) {
  "use strict";
  const C = root.IndieCalc, T = root.IndieTools;
  const parts = () => location.pathname.replace(/^\/+|\/+$/g, "").split("/").slice(1); // what comes after /indie
  const money = n => Number(n).toLocaleString("en-US");

  function view(ctx) {
    const { h, api, app, state, navigate, pageHead, toast, busy } = ctx;
    const go = (e, href) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; e.preventDefault(); navigate(href); };
    const link = (href, content, cls) => h("a", { href, class: cls, onclick: e => go(e, href) }, content);
    const setSeo = (title, desc) => { document.title = title; const m = document.querySelector('meta[name="description"]'); if (m && desc) m.setAttribute("content", desc); };
    const signIn = (label = "Sign in with Discord") => h("a", { class: "btn green", href: "/auth/login?next=indie", text: label });
    const tools = async () => { try { return state.indieTools ||= await api("/api/indie/tools"); } catch { return { cats: [], tools: [] }; } };

    /** A tab row shared by every page in the section. */
    const tabs = here => h("nav", { class: "ix-tabs", "aria-label": "Indie section" }, [["", "Showcase", "/indie"], ["tools", "Developer tools", "/indie/tools"], ["submit", "Submit a game", "/indie/submit"], ...(state.me ? [["mine", "My games", "/indie/mine"]] : [])]
      .map(([id, text, href]) => link(href, text, "ix-tab" + (here === id ? " active" : ""))));
    const wrapPage = (here, ...kids) => app.replaceChildren(tabs(here), ...kids);
    const banner = (eyebrow, title, text, ...actions) => h("section", { class: "ix-banner" }, h("div", { class: "ix-banner-copy" }, h("span", { class: "ix-eyebrow", text: eyebrow }), h("h1", { text: title }), h("p", { class: "muted", text }), h("div", { class: "ix-cta" }, actions)), art());
    const art = () => h("div", { class: "ix-banner-art", "aria-hidden": "true" }, [1, 2, 3, 4, 5].map(() => h("i")));
    const loading = () => h("p", { class: "muted", text: "Loading…" });
    const failBox = e => h("div", { class: "notice warn", text: e.message || "Something went wrong." });

    const verifiedMark = () => h("span", { class: "ix-verified", title: "The developer proved they control this game's Steam page", text: "✓ Verified" });
    const ago = ms => { const d = Math.max(0, Date.now() - ms), m = Math.round(d / 60000); return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} hr ago` : `${Math.round(m / 1440)} d ago`; };
    const KIND = { news: ["📰", "News"], demo: ["🎮", "Demo"], playtest: ["🧪", "Playtest"], release: ["🚀", "Release"], sale: ["🏷️", "Sale"] };
    const kindTag = k => h("span", { class: "ix-kind " + k, text: `${(KIND[k] || KIND.news)[0]} ${(KIND[k] || KIND.news)[1]}` });

    function gameCard(g) {
      return h("article", { class: "ix-card" + (g.featured ? " featured" : "") },
        link(`/indie/game/${g.id}`, h("img", { src: g.image, alt: "", width: 460, height: 215, loading: "lazy" }), "ix-card-pic"),
        h("div", { class: "ix-card-body" }, g.featured ? h("span", { class: "ix-badge", text: "Featured" }) : null,
          h("h3", {}, link(`/indie/game/${g.id}`, g.title)), h("p", { class: "muted small" }, g.studio || "Indie studio", g.verified ? [" ", verifiedMark()] : null),
          h("p", { class: "ix-pitch", text: g.pitch || g.blurb || "" }),
          h("div", { class: "ix-chips" }, (g.genres || []).slice(0, 3).map(x => h("span", { class: "ix-chip", text: x })), g.price ? h("span", { class: "ix-chip price", text: g.price }) : null),
          h("div", { class: "ix-card-foot muted small" }, h("span", { text: `♥ ${money(g.likes)}` }), g.release ? h("span", { text: g.release }) : null)));
    }

    // ---------- the showcase ----------
    async function hub() {
      setSeo("Indie games on Steam: discover and submit | Steam Value Checker", "A showcase for indie games on Steam. Browse what small studios are making, submit your own game for free, and use a toolbox of free Steam developer tools.");
      const q = { q: "", genre: "", sort: "new", page: 0 }, grid = h("div", { class: "ix-grid" }), pager = h("div", { class: "ix-pager" }), featured = h("div", { class: "ix-featured" }), count = h("span", { class: "muted small" });
      const search = h("input", { type: "search", placeholder: "Search games or studios", "aria-label": "Search the showcase" }), genre = h("select", { "aria-label": "Genre" }, h("option", { value: "", text: "All genres" })), sort = h("select", { "aria-label": "Sort" }, [["new", "Newest"], ["popular", "Most liked"], ["az", "A to Z"]].map(([v, t]) => h("option", { value: v, text: t })));
      const t = await tools();
      const teaser = h("section", { class: "ix-teaser" }, h("div", {}, h("h2", { text: "Free tools for developers" }), h("p", { class: "muted", text: `${t.tools.length} calculators, checkers and generators for your Steam launch. No sign-in, and nothing you enter or drop in leaves your browser.` }), link("/indie/tools", "Open the toolbox", "btn blue")),
        h("div", { class: "ix-teaser-list" }, t.tools.slice(0, 6).map(x => link(`/indie/tools/${x.id}`, x.name, "ix-teaser-item"))));
      wrapPage("", banner("Indie corner", "Find your next favorite indie game", "Games from small studios, with a free home for yours. Every game links straight to its Steam page, and the toolbox is free for any developer.", link("/indie/submit", "Submit your game", "btn green"), link("/indie/tools", "Developer tools", "btn gray")), featured,
        h("div", { class: "ix-filters" }, search, genre, sort, count), grid, pager, teaser);
      let timer = null;
      const newsBox = h("section", { class: "ix-news", hidden: true }), picksBox = h("section", { class: "ix-picks", hidden: true });
      app.querySelector(".ix-filters")?.before(picksBox, newsBox);
      api("/api/indie/foryou").then(d => {
        if (!d.signedIn) { picksBox.hidden = false; picksBox.replaceChildren(h("h2", { text: "Indie picks for you" }), h("p", { class: "muted", text: "Sign in and we'll match indie games to what's in your library and wishlist." }), signIn()); return; }
        if (!d.picks.length) return;
        picksBox.hidden = false; picksBox.replaceChildren(h("h2", { text: "Indie picks for you" }), h("p", { class: "muted small", text: "Matched to the genres in your library and wishlist." }),
          h("div", { class: "ix-grid" }, d.picks.map(g => h("div", { class: "ix-pick" }, gameCard(g), h("span", { class: "ix-because muted small", text: `Because you like ${g.because.join(" and ")}` })))));
      }).catch(() => {});
      api("/api/indie/news").then(d => {
        if (!d.news.length) return;
        newsBox.hidden = false; newsBox.replaceChildren(h("h2", { text: "Latest from developers" }), h("ul", { class: "ix-news-list" }, d.news.slice(0, 6).map(n => h("li", {}, kindTag(n.kind), link(`/indie/game/${n.gameId}`, [h("b", { text: n.game }), ` ${n.title}`]), h("span", { class: "muted small", text: ago(n.created) })))));
      }).catch(() => {});
      const load = async () => {
        try {
          const d = await api(`/api/indie?q=${encodeURIComponent(q.q)}&genre=${encodeURIComponent(q.genre)}&sort=${q.sort}&page=${q.page}`);
          if (genre.options.length === 1) for (const g of d.genres) genre.append(h("option", { value: g.name, text: `${g.name} (${g.n})` }));
          featured.replaceChildren(...(d.featured.length ? [h("h2", { text: "Featured" }), h("div", { class: "ix-grid" }, d.featured.map(gameCard))] : []));
          count.textContent = d.total ? `${d.total} game${d.total === 1 ? "" : "s"}` : "";
          const shown = d.featured.length ? d.games.filter(g => !d.featured.some(f => f.id === g.id)) : d.games;
          grid.replaceChildren(...(shown.length ? shown.map(gameCard) : [h("div", { class: "ix-empty" }, h("b", { text: q.q || q.genre ? "Nothing matches that." : "No games here yet." }), h("p", { class: "muted", text: q.q || q.genre ? "Try a different search or clear the genre." : "Be the first. It takes a minute and it's free." }), q.q || q.genre ? null : link("/indie/submit", "Submit your game", "btn green"))]));
          const pages = Math.ceil(d.total / d.per);
          pager.replaceChildren(...(pages > 1 ? [h("button", { class: "btn gray small", type: "button", text: "Previous", disabled: q.page === 0, onclick: () => { q.page--; load(); window.scrollTo({ top: 0 }); } }), h("span", { class: "muted small", text: `Page ${q.page + 1} of ${pages}` }), h("button", { class: "btn gray small", type: "button", text: "Next", disabled: q.page >= pages - 1, onclick: () => { q.page++; load(); window.scrollTo({ top: 0 }); } })] : []));
        } catch (e) { grid.replaceChildren(failBox(e)); }
      };
      search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { q.q = search.value.trim(); q.page = 0; load(); }, 250); });
      genre.addEventListener("change", () => { q.genre = genre.value; q.page = 0; load(); }); sort.addEventListener("change", () => { q.sort = sort.value; q.page = 0; load(); });
      load();
    }

    // ---------- one game ----------
    async function gamePage(id) {
      wrapPage("", loading());
      let d;
      try { d = await api("/api/indie/game?id=" + encodeURIComponent(id)); } catch (e) { wrapPage("", failBox(e), link("/indie", "Back to the showcase", "btn gray")); return; }
      const g = d.game, pageUrl = `${location.origin}/indie/game/${g.id}`;
      setSeo(`${g.title} by ${g.studio || "an indie studio"} | Indie showcase`, g.pitch || g.blurb);
      const like = h("button", { class: "btn gray", type: "button", text: `${g.liked ? "♥ Liked" : "♡ Like"} · ${money(g.likes)}` });
      like.addEventListener("click", async () => { if (!state.me) { location.href = "/auth/login?next=indie"; return; } try { const r = await api("/api/indie/like", { id: g.id }); g.liked = r.liked; g.likes = r.likes; like.textContent = `${r.liked ? "♥ Liked" : "♡ Like"} · ${money(r.likes)}`; } catch (e) { toast(e.message); } });
      const steam = h("a", { class: "btn blue", href: g.steamUrl, target: "_blank", rel: "noopener noreferrer", text: "View on Steam" });
      steam.addEventListener("click", () => { try { fetch("/api/indie/click", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: g.id }), keepalive: true }); } catch { /* counting is best effort */ } });
      const xText = C.xPost({ kind: "announce", name: g.title, pitch: g.pitch || g.blurb, url: pageUrl, genre: g.genres?.[0] }).text;
      const share = h("a", { class: "btn gray", target: "_blank", rel: "noopener noreferrer", href: "https://x.com/intent/post?text=" + encodeURIComponent(xText), text: "Share on X" });
      const copy = h("button", { class: "btn gray", type: "button", text: "Copy link" }); copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(pageUrl); toast("Link copied.", "ok"); } catch { toast("Couldn't copy the link."); } });
      const L = g.links || {}, extra = [["Website", L.website], ["Discord", L.discord], ["Trailer", L.trailer], ["X or Bluesky", L.x]].filter(x => x[1]).map(([t, u]) => h("a", { class: "ix-extra", href: u, target: "_blank", rel: "noopener noreferrer nofollow", text: t + " ↗" }));
      const status = d.game.status && d.game.status !== "approved" ? h("div", { class: "notice warn", text: d.game.status === "pending" ? "Only you and the site owner can see this page. It goes public once it's been looked at." : `This game wasn't accepted${d.game.note ? ": " + d.game.note : "."} Edit your pitch under My games and send it back in.` }) : null;
      wrapPage("", h("article", { class: "ix-game-page" }, status, h("img", { class: "ix-hero", src: g.image, alt: g.title, width: 460, height: 215 }),
        h("div", { class: "ix-game-main" }, g.featured ? h("span", { class: "ix-badge", text: "Featured" }) : null, h("h1", { text: g.title }), h("p", { class: "muted", text: g.studio ? `by ${g.studio}` : "" }),
          h("p", { class: "ix-lead", text: g.pitch || g.blurb }), g.pitch && g.blurb ? h("p", { class: "muted", text: g.blurb }) : null,
          h("div", { class: "ix-chips" }, (g.genres || []).map(x => h("span", { class: "ix-chip", text: x })), g.price ? h("span", { class: "ix-chip price", text: g.price }) : null, g.release ? h("span", { class: "ix-chip", text: g.release }) : null),
          h("div", { class: "ix-actions" }, steam, like, share, copy), extra.length ? h("div", { class: "ix-extras" }, extra) : null)),
        d.more.length ? h("section", {}, h("h2", { text: "More indie games" }), h("div", { class: "ix-grid" }, d.more.map(gameCard))) : null,
        h("p", { class: "muted small", text: "The picture, title and description come from the game's Steam page. The pitch is written by the developer." }));
      gameExtras(g, d);
    }


    /** Everything on a game page beyond the basics: follow, verified mark, developer news, key requests, other games by the studio, report. */
    function gameExtras(g, d) {
      const article = app.querySelector(".ix-game-page"), main = app.querySelector(".ix-game-main"), actions = main?.querySelector(".ix-actions");
      if (!article || !main || g.status && g.status !== "approved") return;
      if (g.verified) main.querySelector("h1")?.after(verifiedMark());
      const needSignIn = () => { location.href = "/auth/login?next=indie"; };
      const followBtn = (kind, onText, offText) => {
        const b = h("button", { class: "btn gray", type: "button" }); let on = Boolean(g.following?.[kind]);
        const paint = () => { b.textContent = on ? onText : offText; b.classList.toggle("on", on); }; paint();
        b.addEventListener("click", () => { if (!state.me) return needSignIn(); busy(b, async () => { const r = await api("/api/indie/follow", { id: g.id, kind }); on = r.following; if (kind === "game") g.followers = r.followers; paint(); toast(on ? (kind === "game" ? "You'll hear when this game posts news." : "You'll hear when this studio posts news.") : "Unfollowed.", "ok"); }); });
        return b;
      };
      if (!g.mine) { actions?.append(followBtn("game", `✓ Following · ${money(g.followers)}`, `+ Follow · ${money(g.followers)}`)); if (g.studio) actions?.append(followBtn("studio", "✓ Following studio", "+ Follow studio")); }
      else if (g.followers) main.append(h("p", { class: "muted small", text: `${money(g.followers)} follower${g.followers === 1 ? "" : "s"}` }));
      // developer news
      if (g.updates?.length) article.append(h("section", { class: "ix-timeline" }, h("h2", { text: "From the developer" }), h("ul", {}, g.updates.map(u => h("li", {}, h("div", { class: "ix-tl-head" }, kindTag(u.kind), h("b", { text: u.title }), h("span", { class: "muted small", text: ago(u.created) })),
        u.body ? h("p", { text: u.body }) : null, u.link ? h("a", { class: "ix-extra", href: u.link, target: "_blank", rel: "noopener noreferrer nofollow", text: "Open the link ↗" }) : null)))));
      // review key requests
      if (g.keysOpen && !g.mine) {
        const box = h("section", { class: "ix-keys panel" }, h("h2", { text: "Review keys" }));
        if (g.keyRequest) box.append(h("p", { class: "muted", text: g.keyRequest === "approved" ? "Approved. The developer will send your key using the contact you gave." : g.keyRequest === "declined" ? "The developer passed on this one." : "Your request is with the developer." }));
        else if (!state.me) box.append(h("p", { class: "muted", text: "Creators and reviewers can ask this developer for a key." }), signIn("Sign in to ask for a key"));
        else {
          const name = h("input", { type: "text", maxlength: 60, placeholder: "Your channel, outlet or handle", "aria-label": "Who you are" }), ch = h("input", { type: "url", placeholder: "https://youtube.com/@you", "aria-label": "Link to your channel or site" }), note = h("textarea", { rows: 2, maxlength: 300, placeholder: "Anything the developer should know (optional)", "aria-label": "Note" }), send = h("button", { class: "btn green", type: "button", text: "Ask for a key" });
          send.addEventListener("click", () => busy(send, async () => { try { await api("/api/indie/keys/request", { id: g.id, name: name.value, channel: ch.value, note: note.value }); box.replaceChildren(h("h2", { text: "Review keys" }), h("p", { class: "muted", text: "Sent. The developer will see it and you'll get a notification when they answer." })); } catch (e) { toast(e.message); } }));
          box.append(h("p", { class: "muted", text: "This developer is giving out review keys. Tell them where you'd cover the game." }), h("div", { class: "ix-two" }, name, ch), note, send);
        }
        article.append(box);
      }
      if (d.game.studioGames?.length) article.append(h("section", {}, h("h2", { text: `More from ${g.studio || "this studio"}` }), h("div", { class: "ix-grid" }, d.game.studioGames.map(gameCard))));
      // report
      if (!g.mine) {
        const rep = h("button", { class: "ix-report", type: "button", text: "Report this game" });
        rep.addEventListener("click", () => { if (!state.me) return needSignIn(); const reason = prompt("What's wrong with this game's listing?"); if (!reason) return; busy(rep, async () => { try { const r = await api("/api/indie/report", { id: g.id, reason }); toast(r.already ? "You've already reported this one. Thanks." : "Thanks, a person will take a look.", "ok"); } catch (e) { toast(e.message); } }); });
        article.append(h("p", { class: "ix-report-row muted small" }, rep));
      }
    }

    // ---------- submit ----------
    async function submit() {
      setSeo("Submit your indie game | Steam Value Checker", "Submit your Steam game to the indie showcase. Free, and every submission is read by a person before it goes live.");
      if (!state.me) { wrapPage("submit", pageHead("Submit your game", "Sign in with Discord first so your game is tied to you and you can follow what happens to it."), signIn()); return; }
      const url = h("input", { type: "text", placeholder: "https://store.steampowered.com/app/123456/Your_Game/", "aria-label": "Steam store link" }), preview = h("div", { class: "ix-preview" });
      const pitch = h("textarea", { rows: 4, maxlength: 400, placeholder: "What makes your game worth a look? Say it the way you'd tell a friend.", "aria-label": "Your pitch" }), left = h("span", { class: "muted small", text: "0 / 400" });
      pitch.addEventListener("input", () => { left.textContent = `${pitch.value.length} / 400`; });
      const L = { website: h("input", { type: "url", placeholder: "https://yourgame.com" }), discord: h("input", { type: "url", placeholder: "https://discord.gg/…" }), trailer: h("input", { type: "url", placeholder: "https://youtube.com/watch?v=…" }), x: h("input", { type: "url", placeholder: "https://x.com/yourstudio" }) };
      const team = h("input", { type: "checkbox", id: "ix-team" }), btn = h("button", { class: "btn green", type: "button", text: "Send it in" }), msg = h("div", { "aria-live": "polite" });
      let timer = null;
      url.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(async () => { const v = url.value.trim(); if (!/store\.steampowered\.com\/app\/\d+|^\d+$/.test(v)) { preview.replaceChildren(); return; }
        try { const r = await api("/api/indie/lookup?q=" + encodeURIComponent(v)); const g = r.game; preview.replaceChildren(h("div", { class: "ix-game" }, h("img", { src: g.image, alt: "", width: 184, height: 69 }), h("div", {}, h("b", { text: g.title }), h("div", { class: "muted small", text: `${g.studio || ""}${g.genres.length ? " · " + g.genres.slice(0, 3).join(", ") : ""}` }), g.type !== "game" ? h("div", { class: "notice warn", text: "This isn't a game page. Use the main game's link." }) : null))); } catch (e) { preview.replaceChildren(h("span", { class: "muted small", text: e.message })); } }, 400); });
      btn.addEventListener("click", () => busy(btn, async () => { msg.replaceChildren();
        try { const r = await api("/api/indie/submit", { url: url.value.trim(), pitch: pitch.value, team: team.checked, links: Object.fromEntries(Object.entries(L).map(([k, el]) => [k, el.value.trim()])) });
          wrapPage("submit", h("div", { class: "ix-done" }, h("h2", { text: r.status === "approved" ? "It's live" : "Got it, thank you" }), h("p", { class: "muted", text: r.status === "approved" ? `${r.title} is in the showcase now.` : `${r.title} is in the queue. A person reads every submission, and you'll get a notification here when it's decided.` }), h("div", { class: "ix-actions" }, link("/indie/mine", "See my games", "btn blue"), link("/indie", "Back to the showcase", "btn gray"))));
        } catch (e) { msg.replaceChildren(failBox(e)); } }));
      const field = (label, el, hint) => h("div", { class: "ix-field" }, h("label", { text: label }), el, hint ? h("span", { class: "muted small", text: hint }) : null);
      let paused = false; try { paused = (await api("/api/indie")).open === false; } catch { /* leave the form open */ }
      wrapPage("submit", pageHead("Submit your game", "Free, and it takes a minute. We read every submission before it goes public."), paused ? h("div", { class: "notice warn", text: "Submissions are paused for a bit. Check back soon." }) : null,
        h("div", { class: "panel ix-form-panel" }, field("Steam store link", url, "Your game needs a public store page, even a 'coming soon' one."), preview, field("Your pitch", pitch), left,
          h("h3", { text: "Links (all optional)" }), h("div", { class: "ix-two" }, field("Website", L.website), field("Discord", L.discord), field("Trailer", L.trailer), field("X or Bluesky", L.x)),
          h("div", { class: "ix-field check" }, h("label", { for: "ix-team" }, team, " I'm part of the team that makes this game")), btn, msg,
          h("p", { class: "muted small", text: "The picture, name and Steam description are taken from your store page. Only games count, not DLC or demos." })));
    }

    // ---------- my games ----------
    async function mine() {
      setSeo("Your indie submissions | Steam Value Checker", "Your games in the indie showcase.");
      if (!state.me) { wrapPage("mine", pageHead("My games", "Sign in to see your submissions."), signIn()); return; }
      wrapPage("mine", pageHead("My games", "Everything you've sent in and where it stands."), loading());
      let d; try { d = await api("/api/indie/mine"); } catch (e) { wrapPage("mine", failBox(e)); return; }
      const label = { pending: "Waiting for review", approved: "Live", rejected: "Not accepted" };
      const row = g => {
        const edit = h("button", { class: "btn gray small", type: "button", text: "Edit pitch and links" }), del = h("button", { class: "btn red small", type: "button", text: "Remove" }), box = h("div", { class: "ix-edit", hidden: true });
        const pitch = h("textarea", { rows: 3, maxlength: 400 }); pitch.value = g.pitch || "";
        const L = Object.fromEntries(["website", "discord", "trailer", "x"].map(k => { const el = h("input", { type: "url", placeholder: k }); el.value = g.links?.[k] || ""; return [k, el]; })), save = h("button", { class: "btn blue small", type: "button", text: "Save" });
        save.addEventListener("click", () => busy(save, async () => { await api("/api/indie/edit", { id: g.id, pitch: pitch.value, links: Object.fromEntries(Object.entries(L).map(([k, el]) => [k, el.value.trim()])) }); toast("Saved.", "ok"); mine(); }));
        box.append(pitch, h("div", { class: "ix-two" }, Object.values(L)), save);
        edit.addEventListener("click", () => { box.hidden = !box.hidden; });
        del.addEventListener("click", () => busy(del, async () => { if (!confirm(`Remove ${g.title} from the showcase?`)) return; await api("/api/indie/withdraw", { id: g.id }); mine(); }));
        const sync = h("button", { class: "btn gray small", type: "button", text: "Sync from Steam" });
        sync.addEventListener("click", () => busy(sync, async () => { const r = await api("/api/indie/sync", { id: g.id }); toast(`Updated from Steam: ${r.game.title}, ${r.game.price || "price not listed"}.`, "ok"); mine(); }));
        const pageUrl = `${location.origin}/indie/game/${g.id}`, kit = h("details", { class: "ix-kit" }, h("summary", { text: "Promote this game" }),
          h("p", { class: "muted small", text: "Ready-made help for getting it seen. The ones that take game details open with yours already filled in." }),
          h("div", { class: "ix-kit-links" }, [["x-post", "X post"], ["press-email", "Press email"], ["creator-pitch", "Creator pitch"], ["fact-sheet", "Fact sheet"], ["short-description", "Check your short description"], ["page-checklist", "Store page checklist"], ["next-fest-checklist", "Next Fest checklist"]].map(([id, t]) => link(`/indie/tools/${id}?app=${g.appid}`, t, "ix-chip link"))),
          g.status === "approved" ? h("div", { class: "ix-field" }, h("label", { text: "Your showcase page, to put on your Steam page, Discord and press kit" }), (() => { const i = h("input", { type: "text", readonly: true, value: pageUrl }); i.addEventListener("focus", () => i.select()); return i; })()) : null);
        return h("article", { class: "ix-mine" }, h("img", { src: g.image, alt: "", width: 184, height: 69 }), h("div", { class: "ix-mine-main" }, h("b", {}, g.status === "approved" ? link(`/indie/game/${g.id}`, g.title) : g.title), h("span", { class: "ix-status " + g.status, text: label[g.status] || g.status }),
          g.note ? h("p", { class: "muted small", text: "Note from the reviewer: " + g.note }) : null, g.status === "approved" ? h("p", { class: "muted small", text: `${money(g.views)} views · ${money(g.clicks)} clicks to Steam · ♥ ${money(g.likes)}` }) : null, h("div", { class: "ix-actions" }, edit, sync, del), box, kit, g.status === "approved" ? manage(g) : null));
      };
      wrapPage("mine", pageHead("My games", "Everything you've sent in and where it stands."), d.games.length ? d.games.map(row) : h("div", { class: "ix-empty" }, h("b", { text: "You haven't submitted a game yet." }), link("/indie/submit", "Submit your game", "btn green")));
      followingBox();
    }


    /** The developer's own toolbox for one live game: numbers, news, keys, verification, badge. Each part loads when its section is opened. */
    function manage(g) {
      const pageUrl = `${location.origin}/indie/game/${g.id}`, sec = (title, build, badge) => {
        const body = h("div", { class: "ix-sec-body" }); let loaded = false;
        const d = h("details", { class: "ix-sec" }, h("summary", {}, title, badge ? h("span", { class: "ix-count", text: String(badge) }) : null), body);
        d.addEventListener("toggle", () => { if (d.open && !loaded) { loaded = true; body.replaceChildren(loading()); Promise.resolve(build(body)).catch(e => body.replaceChildren(failBox(e))); } });
        return d;
      };
      const bars = days => {
        const NS = "http://www.w3.org/2000/svg", W = 560, H = 120, max = Math.max(1, ...days.map(x => x.views)), bw = W / days.length, svg = document.createElementNS(NS, "svg");
        svg.setAttribute("viewBox", `0 0 ${W} ${H + 18}`); svg.setAttribute("class", "ix-chart"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Page views and Steam clicks over the last 14 days");
        days.forEach((x, i) => {
          const vh = Math.round((x.views / max) * H), ch = Math.round((x.clicks / max) * H), g2 = document.createElementNS(NS, "g"), t = document.createElementNS(NS, "title"); t.textContent = `${x.day}: ${x.views} views, ${x.clicks} clicks to Steam`; g2.append(t);
          const r1 = document.createElementNS(NS, "rect"); r1.setAttribute("x", String(i * bw + 4)); r1.setAttribute("width", String(bw - 8)); r1.setAttribute("y", String(H - vh)); r1.setAttribute("height", String(Math.max(vh, x.views ? 2 : 0))); r1.setAttribute("rx", "3"); r1.setAttribute("class", "views");
          const r2 = document.createElementNS(NS, "rect"); r2.setAttribute("x", String(i * bw + 4 + (bw - 8) * 0.25)); r2.setAttribute("width", String((bw - 8) * 0.5)); r2.setAttribute("y", String(H - ch)); r2.setAttribute("height", String(Math.max(ch, x.clicks ? 2 : 0))); r2.setAttribute("rx", "2"); r2.setAttribute("class", "clicks");
          g2.append(r1, r2); svg.append(g2);
          if (i % 2 === 0 || days.length < 8) { const tx = document.createElementNS(NS, "text"); tx.setAttribute("x", String(i * bw + bw / 2)); tx.setAttribute("y", String(H + 13)); tx.setAttribute("text-anchor", "middle"); tx.textContent = x.day.slice(5); svg.append(tx); }
        });
        return svg;
      };
      const stats = sec("Numbers and launch tracker", async body => {
        const d = await api("/api/indie/stats?id=" + g.id), rv = d.reviews, last = rv[rv.length - 1], weekAgo = rv.find(r => r.day >= new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)) || rv[0];
        const rel = Date.parse(d.release || ""), dayN = Number.isFinite(rel) ? Math.round((rel - Date.now()) / 864e5) : null;
        const tile = (label, value, sub) => h("div", { class: "ix-stat" }, h("span", { class: "ix-label", text: label }), h("b", { text: value }), sub ? h("span", { class: "ix-sub", text: sub }) : null);
        body.replaceChildren(h("div", { class: "ix-stats" }, tile("Views", money(d.views), "all time"), tile("Steam clicks", money(d.clicks), d.views ? `${Math.round(d.clicks / d.views * 100)}% of views` : ""), tile("Likes", money(d.likes)), tile("Followers", money(d.followers), "of the game"),
          dayN == null ? null : tile(dayN >= 0 ? "Launch in" : "Out for", `${Math.abs(dayN)} day${Math.abs(dayN) === 1 ? "" : "s"}`, d.release), last ? tile("Steam reviews", money(last.total), last.total ? `${Math.round(last.positive / last.total * 100)}% positive` : "none yet") : null,
          last && weekAgo && rv.length > 1 ? tile("Reviews this week", `+${money(Math.max(0, last.total - weekAgo.total))}`, "since the first snapshot in 7 days") : null),
          h("div", { class: "ix-chart-wrap" }, bars(d.days), h("div", { class: "ix-legend muted small" }, h("i", { class: "views" }), " Page views  ", h("i", { class: "clicks" }), " Clicks to Steam")),
          h("p", { class: "muted small", text: "Counts come from this showcase only, not Steam. Review totals are saved once a day, so the launch tracker fills in as days pass." }));
      });
      const news = sec("Post an update", async body => {
        const kind = h("select", { "aria-label": "Kind of update" }, Object.entries(KIND).map(([v, [i, n]]) => h("option", { value: v, text: `${i} ${n}` }))), title = h("input", { type: "text", maxlength: 100, placeholder: "Headline: Demo is live, Playtest signups open…", "aria-label": "Headline" }),
          text = h("textarea", { rows: 3, maxlength: 500, placeholder: "A few lines on what's new (optional)", "aria-label": "Details" }), link2 = h("input", { type: "url", placeholder: "https://… (demo page, signup form, trailer)", "aria-label": "Link" }), send = h("button", { class: "btn green", type: "button", text: "Post and notify followers" }), list = h("ul", { class: "ix-tl-mini" });
        const draw = async () => { const d = await api("/api/indie/game?id=" + g.id); list.replaceChildren(...d.game.updates.map(u => h("li", {}, kindTag(u.kind), h("b", { text: u.title }), h("span", { class: "muted small", text: ago(u.created) }), (() => { const x = h("button", { class: "btn gray small", type: "button", text: "Delete" }); x.addEventListener("click", () => busy(x, async () => { await api("/api/indie/update/delete", { id: u.id }); draw(); })); return x; })()))); };
        send.addEventListener("click", () => busy(send, async () => { try { await api("/api/indie/update", { id: g.id, kind: kind.value, title: title.value, body: text.value, link: link2.value.trim() }); toast("Posted. Followers will be told.", "ok"); title.value = ""; text.value = ""; link2.value = ""; draw(); } catch (e) { toast(e.message); } }));
        body.replaceChildren(h("p", { class: "muted small", text: "People who follow the game or your studio get a notification and a message. Demo, playtest and release news also reaches members whose library matches your genres." }), h("div", { class: "ix-two" }, kind, title), text, link2, send, list); await draw();
      });
      const keys = sec("Review keys", async body => {
        const draw = async () => {
          const d = await api("/api/indie/keys?id=" + g.id), tog = h("button", { class: "btn " + (d.open ? "gray" : "blue") + " small", type: "button", text: d.open ? "Stop taking requests" : "Open key requests" });
          tog.addEventListener("click", () => busy(tog, async () => { await api("/api/indie/keys/open", { id: g.id, open: !d.open }); draw(); }));
          body.replaceChildren(h("p", { class: "muted small", text: "When this is on, signed-in creators and reviewers can ask for a key from your game page. You approve or decline, then send keys yourself with the contact they gave." }), tog,
            d.requests.length ? h("ul", { class: "ix-keylist" }, d.requests.map(k => h("li", {}, h("div", {}, h("b", { text: k.name }), " ", h("a", { href: k.channel, target: "_blank", rel: "noopener noreferrer nofollow", text: "channel ↗" }), k.note ? h("p", { class: "muted small", text: k.note }) : null),
              k.status === "pending" ? h("div", { class: "ix-actions" }, ...[["Approve", true, "green"], ["Decline", false, "gray"]].map(([t, ok, c]) => { const b = h("button", { class: `btn ${c} small`, type: "button", text: t }); b.addEventListener("click", () => busy(b, async () => { await api("/api/indie/keys/decide", { id: k.id, approve: ok }); draw(); })); return b; })) : h("span", { class: "ix-status " + (k.status === "approved" ? "approved" : "rejected"), text: k.status })))) : h("p", { class: "muted", text: "No requests yet." }));
        };
        await draw();
      }, g.pendingKeys);
      const verify = sec(g.verified ? "✓ Verified" : "Get verified", async body => {
        if (g.verified) { body.replaceChildren(h("p", { class: "muted", text: "Your game shows the verified mark." })); return; }
        const st = await api("/api/indie/verify/start", { id: g.id });
        if (st.verified) { body.replaceChildren(h("p", { text: "Verified." })); return; }
        const msg = h("p", { class: "muted small", "aria-live": "polite" }), check = h("button", { class: "btn blue small", type: "button", text: "Check my Steam page" });
        check.addEventListener("click", () => busy(check, async () => { const r = await api("/api/indie/verify/check", { id: g.id }); if (r.verified) { toast("Verified.", "ok"); mine(); } else msg.textContent = r.message; }));
        body.replaceChildren(h("p", { class: "muted", text: "Proving you control the Steam page earns a verified mark on your game and a better spot in the weekly spotlight." }),
          h("ol", { class: "ix-steps" }, h("li", { text: "Add this code anywhere in your store page's About This Game text, as plain text:" }), h("li", {}, h("code", { class: "ix-code", text: st.code })), h("li", { text: "Save it in Steamworks and publish the change. Steam can take a few minutes to show it." }), h("li", { text: "Press the button. Once you're verified, you can delete the code from your page." })), check, msg);
      });
      const badge = sec("Badge for your site", async body => {
        const imgUrl = `${location.origin}/indie/game/${g.id}/badge.svg`, html = `<a href="${pageUrl}"><img src="${imgUrl}" alt="${g.title.replace(/"/g, "&quot;")} in the indie showcase" width="300" height="64"></a>`, md = `[![${g.title} in the indie showcase](${imgUrl})](${pageUrl})`;
        const snip = (label, text) => { const i = h("input", { type: "text", readonly: true, value: text, "aria-label": label }); i.addEventListener("focus", () => i.select()); return h("div", { class: "ix-field" }, h("label", { text: label }), i); };
        body.replaceChildren(h("img", { class: "ix-badge-img", src: imgUrl, alt: "Your badge", width: 300, height: 64 }), snip("HTML for your website", html), snip("Markdown for a README or forum post", md), snip("Your showcase page", pageUrl), h("p", { class: "muted small", text: "The badge updates itself with your like count and verified mark." }));
      });
      return h("div", { class: "ix-manage" }, stats, news, keys, verify, badge);
    }

    async function followingBox() {
      let d; try { d = await api("/api/indie/following"); } catch { return; }
      app.append(h("section", { class: "ix-following" }, h("h2", { text: "Games you follow" }), d.games.length ? h("div", { class: "ix-grid" }, d.games.map(gameCard)) : h("p", { class: "muted", text: "Follow a game or a studio from its page and its news lands here and in your notifications." })));
    }

    // ---------- tools ----------
    async function toolsDir() {
      const t = await tools();
      setSeo(`${t.tools.length} free Steam tools for indie game developers | Steam Value Checker`, `${t.tools.length} free tools for Steam developers: fee and tax calculator, wishlist calculator, capsule analyzer and resizer, tag checker, press email generator and more. No sign-in, nothing uploaded.`);
      wrapPage("tools", h("section", { class: "ix-banner" }, h("div", { class: "ix-banner-copy" }, h("span", { class: "ix-eyebrow", text: "Free · no sign-in" }), h("h1", { text: `${t.tools.length} free Steam tools for indie game developers` }), h("p", { class: "muted", text: "Calculators, checkers and writing helpers for your store page, your launch and your press. They all run in your browser, so your numbers and artwork never leave your computer." }),
        h("div", { class: "ix-pills" }, t.cats.map(c => h("a", { class: "ix-pill", href: "#ix-" + c.id, text: c.name, onclick: e => { e.preventDefault(); document.getElementById("ix-" + c.id)?.scrollIntoView({ behavior: "smooth" }); } }))), ), art()),
        t.cats.map(c => h("section", { class: "ix-cat", id: "ix-" + c.id }, h("h2", { text: c.name }), h("p", { class: "muted", text: c.blurb }), h("div", { class: "ix-tool-grid" }, t.tools.filter(x => x.cat === c.id).map(x => link(`/indie/tools/${x.id}`, [h("b", { text: x.name }), x.fresh ? h("span", { class: "ix-new", text: "new" }) : null, h("span", { class: "muted small", text: x.desc })], "ix-tool-card"))))),
        h("section", { class: "ix-teaser" }, h("div", {}, h("h2", { text: "Made a game?" }), h("p", { class: "muted", text: "Put it in the showcase so people can find it." }), link("/indie/submit", "Submit your game", "btn green"))));
    }
    async function toolPage(id) {
      const t = await tools(), meta = t.tools.find(x => x.id === id);
      if (!meta) { wrapPage("tools", failBox(new Error("That tool doesn't exist.")), link("/indie/tools", "All tools", "btn gray")); return; }
      setSeo(`${meta.name}: free tool for Steam developers | Steam Value Checker`, `${meta.desc} Free, no sign-in.`);
      const body = h("div", {}); const el = T.render(id, { h, api, toast, busy });
      body.append(el ?? failBox(new Error("This tool isn't available right now.")));
      const more = t.tools.filter(x => x.cat === meta.cat && x.id !== id).concat(t.tools.filter(x => x.cat !== meta.cat)).slice(0, 4);
      wrapPage("tools", h("p", { class: "ix-crumb muted small" }, link("/indie/tools", "Developer tools"), " / ", meta.name), h("h1", { text: meta.name }), h("p", { class: "muted", text: meta.desc }), h("div", { class: "panel ix-panel" }, body),
        h("section", {}, h("h2", { text: "More tools" }), h("div", { class: "ix-tool-grid" }, more.map(x => link(`/indie/tools/${x.id}`, [h("b", { text: x.name }), h("span", { class: "muted small", text: x.desc })], "ix-tool-card")))));
    }

    const p = parts();
    if (!p.length) return hub();
    if (p[0] === "tools") return p[1] ? toolPage(p[1]) : toolsDir();
    if (p[0] === "game" && p[1]) return gamePage(p[1]);
    if (p[0] === "submit") return submit();
    if (p[0] === "mine") return mine();
    return hub();
  }

  root.IndieUI = { view };
})(typeof globalThis !== "undefined" ? globalThis : this);

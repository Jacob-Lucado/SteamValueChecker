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

    function gameCard(g) {
      return h("article", { class: "ix-card" + (g.featured ? " featured" : "") },
        link(`/indie/game/${g.id}`, h("img", { src: g.image, alt: "", width: 460, height: 215, loading: "lazy" }), "ix-card-pic"),
        h("div", { class: "ix-card-body" }, g.featured ? h("span", { class: "ix-badge", text: "Featured" }) : null,
          h("h3", {}, link(`/indie/game/${g.id}`, g.title)), h("p", { class: "muted small", text: g.studio || "Indie studio" }),
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
      wrapPage("", banner("Indie corner", "Find your next favourite indie game", "Games from small studios, with a free home for yours. Every game links straight to its Steam page, and the toolbox is free for any developer.", link("/indie/submit", "Submit your game", "btn green"), link("/indie/tools", "Developer tools", "btn gray")), featured,
        h("div", { class: "ix-filters" }, search, genre, sort, count), grid, pager, teaser);
      let timer = null;
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
          g.note ? h("p", { class: "muted small", text: "Note from the reviewer: " + g.note }) : null, g.status === "approved" ? h("p", { class: "muted small", text: `${money(g.views)} views · ${money(g.clicks)} clicks to Steam · ♥ ${money(g.likes)}` }) : null, h("div", { class: "ix-actions" }, edit, sync, del), box, kit));
      };
      wrapPage("mine", pageHead("My games", "Everything you've sent in and where it stands."), d.games.length ? d.games.map(row) : h("div", { class: "ix-empty" }, h("b", { text: "You haven't submitted a game yet." }), link("/indie/submit", "Submit your game", "btn green")));
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

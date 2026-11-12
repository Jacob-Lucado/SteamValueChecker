// A piece of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls TourUI.view(ctx).
(function (root) {
  "use strict";
  function view(shared, opts) {
    const { TOUR_SLIDES, WIZ_KEY, api, busy, currentView, ext, field, h, route, select, state, steamLoginBtn, toast } = shared;
    const o = opts || {};
    document.getElementById("wiz")?.remove();
    const opener = document.activeElement;
    const me = state.me, S = () => state.me.settings;
    const steps = [];
    TOUR_SLIDES.forEach((t, i) => steps.push({ phase: "tour", nav: t.nav, render: () => tourBody(t, i) }));
    const setupFns = [setupRegion, setupDelivery, setupSteam, setupAlerts, setupServer, setupDone];
    setupFns.forEach(fn => steps.push(fn()));
    const firstSetup = steps.findIndex(x => x.phase === "setup");
    let n = 0, confirming = false;
    try { const saved = JSON.parse(localStorage.getItem(WIZ_KEY) || "null"); if (saved && !o.replay && Number.isInteger(saved.n) && saved.n >= firstSetup && saved.n < steps.length) n = saved.n; } catch { /* a fresh start is fine */ }
    const remember = () => { try { localStorage.setItem(WIZ_KEY, JSON.stringify({ n })); } catch { /* optional */ } };

    const root = h("div", { id: "wiz", class: "wiz", role: "presentation" });
    const dlg = h("div", { class: "wiz-dialog", role: "dialog", "aria-modal": "true", "aria-labeledby": "wiz-title", tabindex: "-1" });
    root.append(dlg);
    document.body.append(root); document.body.classList.add("wiz-open");

    const finish = async () => {
      document.removeEventListener("keydown", onKey, true); root.remove(); document.body.classList.remove("wiz-open");
      try { localStorage.removeItem(WIZ_KEY); } catch { /* ignore */ }
      if (state.me) { state.me.tour = false; api("/api/tour/done", {}).catch(() => {}); }
      try { state.me = Object.assign({}, state.me, await api("/api/me")); } catch { /* the cached copy is fine */ }
      if (opener && opener.focus) opener.focus();
      if (currentView() === "mypage") route();
    };

    function tourBody(t, i) {
      return h("div", { class: "wiz-slide" },
        h("div", { class: "wiz-kicker", text: "Part " + (i + 1) + " of " + TOUR_SLIDES.length }),
        h("h2", { id: "wiz-title", text: t.title }), h("p", { class: "wiz-lead", text: t.lead }),
        h("ul", { class: "wiz-points" }, t.points.map(([head, text]) => h("li", {}, h("strong", { text: head }), h("span", { text })))));
    }
    // ----- setup steps: each returns { phase, nav, render(), save?() } -----
    function setupFrame(kicker, title, lead, ...body) {
      return h("div", { class: "wiz-slide" }, h("div", { class: "wiz-kicker", text: kicker }), h("h2", { id: "wiz-title", text: title }), h("p", { class: "wiz-lead", text: lead }), ...body);
    }
    function setupRegion() {
      const region = select(state.cfg.regions.map(r => [r.value, r.name]), S().region);
      const stores = select([["major", "Major stores only (recommended)"], ["all", "All tracked stores, including key sites"]], S().stores);
      return { phase: "setup", nav: "Region", render: () => setupFrame("Setup 1 of 6", "Where do you shop?", "Prices are looked up for your region, so the currency and the stores match what you can actually buy.",
        h("div", { class: "wiz-form" }, field("Region and currency", region), field("Which stores count", stores))),
        save: async () => { const r = await api("/api/settings", { region: region.value, stores: stores.value }); state.me.settings = r.settings; } };
    }
    function setupDelivery() {
      const myTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; } })();
      const withChannel = state.me.servers.filter(g => g.alertChannel);
      const dm = h("input", { type: "radio", name: "wiz-delivery", value: "dm", checked: S().delivery !== "channel" });
      const ch = h("input", { type: "radio", name: "wiz-delivery", value: "channel", checked: S().delivery === "channel", disabled: !withChannel.length });
      const server = select(withChannel.map(g => [g.id, g.name]), S().guild_id || (withChannel[0] && withChannel[0].id) || "");
      const qs = h("input", { type: "time", value: S().quiet_start || "" }), qe = h("input", { type: "time", value: S().quiet_end || "" });
      const tz = h("input", { type: "text", value: S().tz && S().tz !== "UTC" ? S().tz : myTz, maxlength: "60", "aria-label": "Time zone" });
      return { phase: "setup", nav: "Delivery", render: () => setupFrame("Setup 2 of 6", "Where should alerts go?", "Direct messages are the simplest. If you would rather keep them out of your DMs, a server alert channel works too.",
        h("div", { class: "wiz-form" },
          h("label", { class: "check" }, dm, " Send them to me as direct messages"),
          h("label", { class: "check" }, ch, " Post them in a server alert channel", withChannel.length ? "" : " (no server you are in has one yet)"),
          withChannel.length ? field("Which server", server) : null,
          h("div", { class: "row" }, field("Quiet hours start", qs), field("Quiet hours end", qe)),
          field("Your time zone", tz),
          h("p", { class: "muted small", text: "Leave quiet hours empty to be told any time. Alerts held during quiet hours arrive when they end." }))),
        save: async () => {
          const body = { delivery: ch.checked ? "channel" : "dm", tz: tz.value.trim() || "UTC", quiet_start: qs.value || null, quiet_end: qe.value || null };
          if (ch.checked) body.guild_id = server.value;
          const r = await api("/api/settings", body); state.me.settings = r.settings;
        } };
    }
    function setupSteam() {
      const linked = () => Boolean(state.me.steam && state.me.steam.linked);
      const out = h("div", { class: "wiz-form" });
      const draw = () => {
        const importBtn = h("button", { class: "btn green", type: "button", text: "Import my Steam wishlist" });
        importBtn.addEventListener("click", () => busy(importBtn, async () => {
          const r = await api("/api/wishlist/import", { profile: "" });
          state.me.games += r.added; toast(`Imported ${r.added} new game${r.added === 1 ? "" : "s"}.`, "ok"); draw();
        }));
        out.replaceChildren(
          h("div", { class: "wiz-status" + (linked() ? " ok" : ""), text: linked() ? "Steam is linked to your account." : "Steam is not linked yet." }),
          linked() ? h("div", { class: "row" }, importBtn, h("span", { class: "muted small", text: state.me.games ? state.me.games + " game" + (state.me.games === 1 ? "" : "s") + " on your wishlist" : "Your Steam wishlist must be public for this to work." })) : h("div", { class: "row" }, (() => { const a = steamLoginBtn("Link Steam", "btn steam"); a.addEventListener("click", remember); return a; })(), h("span", { class: "muted small", text: "You come straight back here afterwards." })),
          h("p", { class: "muted small", text: "Linking is optional. It unlocks the wishlist import, hours played, your library and recap. You can do it later from the Steam page." }));
      };
      return { phase: "setup", nav: "Steam", render: () => { draw(); return setupFrame("Setup 3 of 6", "Bring in your games", "Linking your public Steam profile fills your wishlist and library for you, so alerts can start right away.", out); },
        save: async () => {} };
    }
    function setupAlerts() {
      const sw = (key, label, hint) => { const c = h("input", { type: "checkbox", checked: Boolean(S()[key]) }); return { key, c, node: h("label", { class: "check wiz-sw" }, c, h("span", {}, h("b", { text: label }), hint ? h("em", { text: hint }) : null)) }; };
      const core = [sw("free", "Free games", "Told when a game is free to claim."), sw("bundles", "Bundles and giveaways", "When a wishlist game is in one."), sw("digest", "Weekly digest", "One summary of your wishlist sales.")];
      const extra = [sw("dlc", "DLC sales", "Big discounts on add-ons for games you play."), sw("refund", "Refund reminders", "Before the 14 day window closes."), sw("milestones", "Playtime milestones", "At 100, 250, 500, 1000 and 2000 hours."), sw("achv", "Almost-done achievements", "When you are a few short of 100 percent."), sw("nudge", "Monthly backlog pick", "One unplayed game to try."), sw("yearly", "Year in games", "Your recap card, sent in late December.")];
      const news = select([["0", "Off"], ["1", "Patch notes only"], ["2", "Every announcement"]], String(S().news ?? 0));
      const play = select([["0", "Off"], ["1", "Only games on my wishlist"], ["2", "Every playtest and demo found"]], String(S().playtest ?? 0));
      const minDisc = h("input", { type: "number", min: "0", max: "90", step: "5", value: String(S().min_discount || 0), class: "short-num", "aria-label": "Minimum discount percent" });
      return { phase: "setup", nav: "Alerts", render: () => setupFrame("Setup 4 of 6", "Choose your alerts", "Sale alerts for your wishlist are always on. Pick the extras you want. Everything here can be changed later on the Alerts page.",
        h("div", { class: "wiz-form" },
          h("div", { class: "wiz-group" }, h("h4", { text: "Good to have" }), ...core.map(x => x.node)),
          h("div", { class: "wiz-group" }, h("h4", { text: "Extras" }), ...extra.map(x => x.node)),
          h("div", { class: "row" }, field("News and patch notes", news), field("Playtests and demos", play), field("Ignore sales under (% off)", minDisc)))),
        save: async () => {
          const body = { news: Number(news.value), playtest: Number(play.value), min_discount: Number(minDisc.value || 0) };
          for (const x of [...core, ...extra]) body[x.key] = x.c.checked;
          const r = await api("/api/settings", body); state.me.settings = r.settings;
        } };
    }
    function setupServer() {
      const share = h("input", { type: "checkbox", checked: Boolean(S().share) });
      const inv = state.cfg && state.cfg.inviteUrl;
      const withBot = state.me.servers.filter(g => g.bot);
      return { phase: "setup", nav: "Server", render: () => setupFrame("Setup 5 of 6", "Bring it to your server", "The bot works for you alone, but it is better with friends. This step is optional.",
        h("div", { class: "wiz-form" },
          h("div", { class: "wiz-status" + (withBot.length ? " ok" : ""), text: withBot.length ? "The bot is set up in " + withBot.length + " of your servers." : "The bot is not set up in any of your servers yet." }),
          inv ? h("div", { class: "row" }, ext(inv, "Add the bot to a server", "btn blue"), h("span", { class: "muted small", text: "Then open Servers and run community setup." })) : null,
          h("label", { class: "check wiz-sw" }, share, h("span", {}, h("b", { text: "Share my library with my server" }), h("em", { text: "Lets members compare libraries, see who owns a game and find co-op picks. Only titles and hours, and you can turn it off any time." })))) ),
        save: async () => { const r = await api("/api/settings", { share: share.checked }); state.me.settings = r.settings; } };
    }
    function setupDone() {
      const sample = h("button", { class: "btn gray", type: "button", text: "Send me a sample alert" });
      sample.addEventListener("click", () => busy(sample, async () => { await api("/api/alerts/test", { kind: "sale" }); toast("Check your Discord DMs.", "ok"); }));
      return { phase: "setup", nav: "Done", last: true, render: () => {
        const rows = (state.me.setup || []).map(t => h("li", { class: t.done ? "done" : "" }, h("span", { class: "wiz-tick", text: t.done ? "Done" : t.optional ? "Optional" : "To do" }), t.text));
        return setupFrame("Setup 6 of 6", "You are all set", "Here is where things stand. The checklist stays on your home page until it is finished, and you can replay this guide from My page.",
          h("ul", { class: "wiz-check" }, rows), h("div", { class: "row" }, sample));
      } };
    }

    // ----- frame -----
    const cur = () => steps[n];
    const inTour = () => cur().phase === "tour";
    function frame() {
      const st = cur(), tourCount = firstSetup, setupCount = steps.length - firstSetup;
      const idx = inTour() ? n : n - firstSetup, total = inTour() ? tourCount : setupCount;
      const header = h("div", { class: "wiz-head" },
        h("div", { class: "wiz-brand", text: "Steam Value Checker" }),
        h("div", { class: "wiz-phases", role: "list" }, h("span", { role: "listitem", class: inTour() ? "on" : "done", text: "1  Tour" }), h("span", { role: "listitem", class: inTour() ? "" : "on", text: "2  Setup" })),
        inTour() ? h("button", { class: "btn gray small wiz-skip", type: "button", text: "Skip tutorial", onclick: () => { confirming = true; draw(); } }) : h("span", { class: "wiz-skip-gap" }));
      const rail = h("ol", { class: "wiz-rail", "aria-label": inTour() ? "Tour steps" : "Setup steps" },
        steps.filter(x => x.phase === st.phase).map((x, i) => h("li", { class: i === idx ? "on" : i < idx ? "past" : "" }, h("span", { class: "wiz-num", text: String(i + 1) }), x.nav)));
      const bar = h("div", { class: "wiz-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(total), "aria-valuenow": String(idx + 1), "aria-label": inTour() ? "Tour progress" : "Setup progress" }, (() => { const f = h("span"); f.style.width = Math.round(((idx + 1) / total) * 100) + "%"; return f; })());
      const back = h("button", { class: "btn gray", type: "button", text: "Back", disabled: n === 0, onclick: () => go(-1) });
      const nextLabel = st.last ? "Finish" : n === firstSetup - 1 ? "Continue to setup" : "Next";
      const next = h("button", { class: "btn blue wiz-next", type: "button", text: nextLabel, onclick: () => go(1) });
      const body = h("div", { class: "wiz-body", tabindex: "-1" }, st.render());
      return h("div", { class: "wiz-shell" }, header, bar, h("div", { class: "wiz-main" }, rail, body), h("div", { class: "wiz-foot" }, h("span", { class: "muted small wiz-count", text: (inTour() ? "Tour" : "Setup") + " " + (idx + 1) + " of " + total }), h("div", { class: "row" }, back, next)));
    }
    function confirmBox() {
      const keep = h("button", { class: "btn blue", type: "button", text: "Keep going", onclick: () => { confirming = false; draw(); } });
      const yes = h("button", { class: "btn gray", type: "button", text: "Yes, skip the tutorial", onclick: () => { confirming = false; n = firstSetup; remember(); draw(); } });
      return h("div", { class: "wiz-confirm", role: "alertdialog", "aria-labeledby": "wiz-title", "aria-describedby": "wiz-confirm-text" },
        h("h2", { id: "wiz-title", text: "Are you sure you want to skip the tutorial?" }),
        h("p", { id: "wiz-confirm-text", text: "It only takes a couple of minutes and covers things that are easy to miss, like per-game rules, quiet hours and the server tools. You can replay it any time from My page. Either way, you will still go through setup next." }),
        h("div", { class: "row" }, keep, yes));
    }
    async function go(d) {
      if (d > 0 && cur().save) {
        const btn = dlg.querySelector(".wiz-next");
        try { if (btn) { btn.disabled = true; } await cur().save(); } catch (e) { toast(e.message || "That did not save.", "error"); if (btn) btn.disabled = false; return; }
      }
      if (d > 0 && cur().last) return finish();
      n = Math.max(0, Math.min(steps.length - 1, n + d)); if (!inTour()) remember(); draw();
    }
    function draw() {
      dlg.replaceChildren(confirming ? confirmBox() : frame());
      dlg.setAttribute("aria-label", "");
      const target = confirming ? dlg.querySelector(".wiz-confirm .btn.blue") : dlg.querySelector(".wiz-next");
      if (target) target.focus();
      const body = dlg.querySelector(".wiz-body"); if (body) body.scrollTop = 0;
    }
    function onKey(e) {
      if (!document.getElementById("wiz")) return;
      if (e.key === "Escape") { e.preventDefault(); if (confirming) { confirming = false; draw(); } else if (inTour()) { confirming = true; draw(); } return; }
      if (e.key === "Tab") { // keep focus inside the dialog
        const f = [...dlg.querySelectorAll("button, a[href], input, select, textarea, [tabindex='0']")].filter(x => !x.disabled && x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!dlg.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        return;
      }
      const typing = /^(input|select|textarea)$/i.test((e.target && e.target.tagName) || "");
      if (!confirming && inTour() && !typing) { if (e.key === "ArrowRight" && n < steps.length - 1) { e.preventDefault(); go(1); } else if (e.key === "ArrowLeft" && n > 0) { e.preventDefault(); go(-1); } }
    }
    document.addEventListener("keydown", onKey, true);
    draw();
  }
  root.TourUI = { view };
})(window);

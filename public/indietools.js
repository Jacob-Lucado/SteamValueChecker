// The indie developer tools. Each one runs in the visitor's browser: numbers and pictures are never uploaded.
// The only thing that touches our server is a Steam lookup when someone pastes a store link.
(function (root) {
  "use strict";
  const C = root.IndieCalc;
  const TOOLS = {};
  const usd = n => (Number.isFinite(n) ? n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 }) : "–");
  const int = n => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "–");
  const ICON = { good: "✓", warn: "!", bad: "✕" };

  /** Little builders shared by every tool, so they all look and behave alike. */
  function kit(ctx) {
    const { h } = ctx;
    const stat = (label, value, sub, tone) => h("div", { class: "ix-stat" + (tone ? " " + tone : "") }, h("span", { class: "ix-label", text: label }), h("b", { text: value }), sub ? h("span", { class: "ix-sub", text: sub }) : null);
    const stats = (...items) => h("div", { class: "ix-stats" }, items);
    const checks = rows => h("ul", { class: "ix-checks" }, rows.map(([state, text]) => h("li", { class: state }, h("span", { class: "ix-dot", "aria-hidden": "true", text: ICON[state] ?? "•" }), h("span", { text }))));
    const note = text => h("p", { class: "muted small ix-note", text });
    const copy = (label, getText) => { const b = h("button", { class: "btn gray small", type: "button", text: label }); b.addEventListener("click", async () => { try { await navigator.clipboard.writeText(getText()); ctx.toast("Copied.", "ok"); } catch { ctx.toast("Couldn't copy. Select the text and copy it yourself."); } }); return b; };
    /** A form that recalculates as you type. specs: { key, label, type, value, hint, options, step, min }. */
    function calc(specs, render, { before = null } = {}) {
      const vals = {}, out = h("div", { class: "ix-out", "aria-live": "polite" });
      const run = () => { let r; try { r = render({ ...vals }); } catch (e) { r = h("p", { class: "muted", text: e.message }); } out.replaceChildren(...[].concat(r).filter(Boolean)); };
      const fields = specs.map(sp => {
        let el;
        if (sp.type === "select") { el = h("select", {}, sp.options.map(([v, t]) => h("option", { value: v, text: t }))); el.value = sp.value ?? sp.options[0][0]; }
        else if (sp.type === "check") { el = h("input", { type: "checkbox" }); el.checked = Boolean(sp.value); }
        else if (sp.type === "textarea") { el = h("textarea", { rows: sp.rows ?? 4, placeholder: sp.placeholder ?? "" }); el.value = sp.value ?? ""; }
        else { el = h("input", { type: sp.type ?? "text", value: sp.value ?? "", placeholder: sp.placeholder ?? "", step: sp.step, min: sp.min, inputmode: sp.type === "number" ? "decimal" : null }); }
        const read = () => (sp.type === "check" ? el.checked : el.value);
        vals[sp.key] = read();
        el.addEventListener("input", () => { vals[sp.key] = read(); run(); }); el.addEventListener("change", () => { vals[sp.key] = read(); run(); });
        return h("div", { class: "ix-field" + (sp.type === "check" ? " check" : "") }, sp.type === "check" ? h("label", {}, el, " " + sp.label) : [h("label", { text: sp.label }), el], sp.hint ? h("span", { class: "muted small", text: sp.hint }) : null);
      });
      run();
      return h("div", { class: "ix-tool" }, before, h("div", { class: "ix-form" }, fields), out);
    }
    /** Pull a game's details from Steam for pre-filling a form. */
    function steamBox(onGame, { withReviews = false } = {}) {
      const input = h("input", { type: "text", placeholder: "Steam store link, app ID or game name", "aria-label": "Steam store link" });
      const btn = h("button", { class: "btn blue small", type: "button", text: "Fill from Steam" }), msg = h("span", { class: "muted small" });
      const go = () => ctx.busy(btn, async () => {
        msg.textContent = "";
        let d = await ctx.api("/api/indie/lookup?q=" + encodeURIComponent(input.value.trim())), byName = false;
        if (!d.game && d.results?.length) { byName = true; d = await ctx.api("/api/indie/lookup?q=" + d.results[0].appid); } // a name works too: take the top match
        if (!d.game) { msg.textContent = "Steam found nothing under that name. Try the store link, or the App ID Finder."; return; }
        onGame(d.game); msg.textContent = byName ? `Loaded ${d.game.title}, the top match. Wrong game? Paste its store link instead.` : `Loaded ${d.game.title}.`;
      });
      btn.addEventListener("click", go); input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); go(); } });
      // Sent here from My games with ?app=123: fill everything in straight away.
      const app = new URLSearchParams(location.search).get("app");
      if (/^\d{1,9}$/.test(app || "")) setTimeout(() => { input.value = app; go(); }, 0);
      return h("div", { class: "ix-steam" }, input, btn, msg);
    }
    /** Checklist with progress kept in this browser only. */
    function checklist(key, groups) {
      let saved = {}; try { saved = JSON.parse(localStorage.getItem("ix:" + key) || "{}") || {}; } catch { /* storage blocked */ }
      const bar = h("div", { class: "ix-bar" }, h("i")), count = h("b"), total = groups.reduce((a, g) => a + g.items.length, 0);
      const paint = () => { const done = Object.values(saved).filter(Boolean).length; count.textContent = `${done} of ${total} done`; bar.firstChild.style.width = Math.round((done / total) * 100) + "%"; };
      const lists = groups.map(g => h("section", { class: "ix-group" }, h("h3", { text: g.title }), h("ul", { class: "ix-todo" }, g.items.map(([id, text, why]) => {
        const box = h("input", { type: "checkbox", id: `ix-${key}-${id}` }); box.checked = Boolean(saved[id]);
        box.addEventListener("change", () => { saved[id] = box.checked; try { localStorage.setItem("ix:" + key, JSON.stringify(saved)); } catch { /* ignore */ } paint(); });
        return h("li", {}, box, h("label", { for: `ix-${key}-${id}` }, h("span", { text }), why ? h("span", { class: "muted small", text: why }) : null));
      }))));
      const reset = h("button", { class: "btn gray small", type: "button", text: "Start over" }); reset.addEventListener("click", () => { saved = {}; try { localStorage.removeItem("ix:" + key); } catch { /* ignore */ } lists.forEach(l => l.querySelectorAll("input").forEach(i => { i.checked = false; })); paint(); });
      paint();
      return h("div", { class: "ix-tool" }, h("div", { class: "ix-progress" }, count, bar, reset), lists, note("Ticks are saved in this browser only."));
    }
    /** Read a dropped or chosen picture as an image element. */
    const loadImage = file => new Promise((resolve, reject) => { const url = URL.createObjectURL(file), img = new Image(); img.onload = () => resolve({ img, url }); img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file isn't a picture this browser can open. Try a PNG or JPG.")); }; img.src = url; });
    /** Put a value into the field with this label and let the tool recalculate. */
    const fill = (root, label, val) => { const el = [...root.querySelectorAll(".ix-field")].find(f => f.firstChild?.textContent === label)?.querySelector("input,textarea,select"); if (el && val) { el.value = val; el.dispatchEvent(new Event("input")); } };
    return { h, stat, stats, checks, note, copy, calc, steamBox, checklist, loadImage, fill };
  }

  const reg = (id, fn) => { TOOLS[id] = fn; };

  // ---------- check your store page ----------
  reg("short-description", ctx => { const k = kit(ctx);
    const form = k.calc([{ key: "genre", label: "Your game's genre", placeholder: "roguelike, farming sim, puzzle platformer…" }, { key: "text", label: "Short description", type: "textarea", rows: 5, placeholder: "Paste what you have on your Steam page." }],
      v => [k.stats(k.stat("Length", `${v.text.trim().length} / 300`, "characters Steam allows")), k.checks(C.gradeShortDescription(v.text, v.genre)), k.note("These are rules of thumb, not Valve's rules. A great line can break any of them.")], { before: k.steamBox(g => { k.fill(form, "Your game's genre", (g.genres[0] ?? "").toLowerCase()); k.fill(form, "Short description", g.blurb); }) });
    return form; });

  reg("tag-checker", ctx => { const k = kit(ctx);
    return k.calc([{ key: "tags", label: "Your tags, in order, separated by commas", type: "textarea", rows: 4, placeholder: "Indie, Action, Singleplayer, Roguelike, Deckbuilder…" }],
      v => { const r = C.checkTags(v.tags); if (!r.tags.length) return k.note("Add your tags to see the check.");
        return [k.stats(k.stat("Tags", `${r.tags.length} / 20`, `${r.unused} slots free`), k.stat("Broad tags", String(r.broadCount), "in the whole list"), k.stat("Broad in top five", String(r.flagged.length), r.flagged.length ? r.flagged.join(", ") : "none", r.flagged.length > 1 ? "warn" : "good")),
          k.checks([r.flagged.length > 1 ? ["warn", `${r.flagged.join(", ")} are very broad. The top five tags decide where you show up, so spend them on what's specific about the game.`] : ["good", "Your top five aren't crowded with broad tags."], r.unused > 0 ? ["warn", `${r.unused} tag slots are empty. Steam lets you use 20, and every extra tag is another way to be found.`] : ["good", "All 20 slots used."]]),
          r.flagged.length ? h2(ctx, "A better order", r.reordered.join(", ")) : null, k.note("Steam's tags come from the developer first and players after. Check the order on your store page's tag list in Steamworks.")]; }); });

  const h2 = (ctx, title, text) => ctx.h("div", { class: "ix-suggest" }, ctx.h("b", { text: title }), ctx.h("p", { text }));

  reg("page-checklist", ctx => kit(ctx).checklist("page", [
    { title: "Words", items: [["sd", "Short description is written, under 300 characters", "It shows in search and on the front page."], ["ld", "About This Game section has headers and short paragraphs", "Skimmers decide in seconds."], ["gif", "A GIF or two in the description shows the game in motion"], ["sr", "System requirements are filled in"], ["lang", "Supported languages are listed honestly"]] },
    { title: "Pictures and video", items: [["cap", "All capsule images are uploaded", "Header, small, main, vertical and the library set."], ["ss", "At least five screenshots, best first", "Players rarely scroll past the first few."], ["tr", "A trailer with gameplay in the first seconds"], ["logo", "The game's name is readable on the capsule at its smallest size"]] },
    { title: "Setup", items: [["tags", "Tags are set and the top five are specific"], ["genre", "Genre and categories are accurate (controller, achievements, cloud saves)"], ["price", "Price is set, with regional prices reviewed"], ["date", "Release date or 'Coming soon' is set"], ["links", "Website, Discord and social links are added"]] },
    { title: "Before you press the button", items: [["rev", "Store page passed Valve's review"], ["wish", "Wishlist button is live and you're collecting wishlists"], ["demo", "A demo is up, if you have one"], ["feat", "Every link on the page opens"]] }
  ]));

  reg("next-fest-checklist", ctx => kit(ctx).checklist("nextfest", [
    { title: "Months before", items: [["page", "Store page is public with a finished capsule and trailer", "Valve needs it live well before the festival."], ["demo", "Demo is built, tested and uploaded", "Fresh crashes cost you the visits you worked to get."], ["wl", "Wishlist button is on the demo's page"], ["reg", "You've signed up for the festival in Steamworks"]] },
    { title: "Weeks before", items: [["short", "Demo has a clear start: no menus to fight, the fun inside two minutes"], ["feed", "You've asked friends and players to try the demo for bugs"], ["press", "Streamers and press have been sent demo keys or the link"], ["mail", "You've told your newsletter and Discord when it starts"]] },
    { title: "During the fest", items: [["live", "You're ready for a live stream or developer chat during the festival"], ["fix", "You can patch the demo fast if something breaks"], ["watch", "You'll check wishlists and demo plays each day"], ["thank", "You'll reply to demo feedback and reviews"]] }
  ]));

  // ---------- capsules and screenshots ----------
  reg("capsule-analyzer", ctx => { const k = kit(ctx), { h } = ctx;
    const out = h("div", { class: "ix-out" }), pick = h("input", { type: "file", accept: "image/*", "aria-label": "Choose your capsule" });
    pick.addEventListener("change", async () => {
      const f = pick.files[0]; if (!f) return;
      try {
        const { img, url } = await k.loadImage(f);
        const w = 231, ht = 87, c = h("canvas", { width: w, height: ht, class: "ix-pix" }), g = c.getContext("2d", { willReadFrequently: true }), cr = C.coverCrop(img.naturalWidth, img.naturalHeight, w, ht);
        g.drawImage(img, cr.sx, cr.sy, cr.sw, cr.sh, 0, 0, w, ht); URL.revokeObjectURL(url);
        const st = C.imageStats(g.getImageData(0, 0, w, ht).data);
        const bg = h("div", { class: "ix-rowmock" }, h("div", { class: "ix-rowmock-pic" }, c), h("div", {}, h("b", { text: "Your game" }), h("span", { class: "muted small", text: "Shown the way Steam shows it in a list, at 231 × 87" })));
        out.replaceChildren(bg, k.stats(k.stat("Brightness", `${Math.round(st.brightness)} / 255`), k.stat("Contrast", String(Math.round(st.contrast))), k.stat("Color", `${Math.round(st.saturation)}%`)), k.checks(C.capsuleVerdict(st)), k.note("Your picture stays on this device. Aspect ratio matters: Steam's small capsule is wide, so keep the name and focal point away from the edges."));
      } catch (e) { out.replaceChildren(h("p", { class: "notice warn", text: e.message })); }
    });
    return h("div", { class: "ix-tool" }, h("div", { class: "ix-field" }, h("label", { text: "Choose your capsule picture" }), pick), out); });

  reg("capsule-sizes", ctx => { const k = kit(ctx), { h } = ctx;
    const table = h("table", { class: "ix-table" }, h("thead", {}, h("tr", {}, ["Image", "Size", "Where it shows up"].map(t => h("th", { text: t })))), h("tbody", {}, C.CAPSULES.map(c => h("tr", {}, h("td", {}, h("b", { text: c.name })), h("td", { text: `${c.w} × ${c.h}` }), h("td", { class: "muted", text: c.note })))));
    const state = { img: null, fx: 0.5, fy: 0.5 }, out = h("div", { class: "ix-previews" }), pick = h("input", { type: "file", accept: "image/*", "aria-label": "Choose a picture to crop" });
    const fx = h("input", { type: "range", min: 0, max: 100, value: 50, "aria-label": "Focus left to right" }), fy = h("input", { type: "range", min: 0, max: 100, value: 50, "aria-label": "Focus top to bottom" });
    const dl = h("button", { class: "btn blue small", type: "button", text: "Download all as a zip", disabled: true }), bar = h("div", { class: "ix-resize-bar", hidden: true });
    const render = c => { const cv = document.createElement("canvas"); cv.width = c.w; cv.height = c.h; const cr = C.coverCrop(state.img.naturalWidth, state.img.naturalHeight, c.w, c.h, state.fx, state.fy); cv.getContext("2d").drawImage(state.img, cr.sx, cr.sy, cr.sw, cr.sh, 0, 0, c.w, c.h); return cv; };
    const draw = () => { if (!state.img) return; out.replaceChildren(...C.CAPSULES.map(c => { const cv = render(c); cv.className = "ix-pix"; cv.style.aspectRatio = `${c.w} / ${c.h}`; cv.style.width = "100%"; cv.style.height = "auto"; return h("figure", {}, cv, h("figcaption", { class: "muted small", text: `${c.name}, ${c.w} × ${c.h}` })); })); };
    pick.addEventListener("change", async () => { const f = pick.files[0]; if (!f) return; try { const { img } = await k.loadImage(f); state.img = img; dl.disabled = false; bar.hidden = false; draw(); } catch (e) { ctx.toast(e.message); } });
    fx.addEventListener("input", () => { state.fx = fx.value / 100; draw(); }); fy.addEventListener("input", () => { state.fy = fy.value / 100; draw(); });
    dl.addEventListener("click", () => ctx.busy(dl, async () => {
      const files = []; for (const c of C.CAPSULES) { const blob = await new Promise(r => render(c).toBlob(r, "image/png")); files.push({ name: `${c.id}-${c.w}x${c.h}.png`, data: new Uint8Array(await blob.arrayBuffer()) }); }
      const url = URL.createObjectURL(new Blob([C.zip(files)], { type: "application/zip" })), a = document.createElement("a"); a.href = url; a.download = "steam-capsules.zip"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    }));
    bar.append(h("div", { class: "ix-field" }, h("label", { text: "Move the focus left or right" }), fx), h("div", { class: "ix-field" }, h("label", { text: "Move the focus up or down" }), fy), dl);
    return h("div", { class: "ix-tool" }, h("h3", { text: "Every Steam image size" }), h("div", { class: "ix-scroll" }, table), h("h3", { text: "Crop one picture to all of them" }),
      h("div", { class: "ix-field" }, h("label", { text: "Choose a picture (wider than tall works best)" }), pick), bar, out, k.note("Cropping fills each size, so some edges are cut. Move the focus until the important part stays in every one. The Library logo needs a transparent background, so make that one in your art tool. Nothing is uploaded.")); });

  reg("screenshot-checker", ctx => { const k = kit(ctx), { h } = ctx, out = h("div", { class: "ix-out" }), pick = h("input", { type: "file", accept: "image/*", multiple: true, "aria-label": "Choose your screenshots in store order" });
    pick.addEventListener("change", async () => {
      const files = [...pick.files].slice(0, 12); if (!files.length) return;
      out.replaceChildren(h("p", { class: "muted", text: "Looking…" }));
      try {
        const rows = [];
        for (const f of files) { const { img, url } = await k.loadImage(f), c = document.createElement("canvas"); c.width = 160; c.height = 90; const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, 160, 90); URL.revokeObjectURL(url); rows.push({ name: f.name, canvas: c, st: C.imageStats(g.getImageData(0, 0, 160, 90).data) }); }
        const r = C.screenshotOrder(rows.map(x => x.st)), early = r.dark.filter(i => i < 5);
        out.replaceChildren(k.checks([early.length ? ["bad", `${early.length} of your first five are dark (${early.map(i => "#" + (i + 1)).join(", ")}). Players decide on the first few, so lead with brighter, busier shots.`] : ["good", "None of your first five are dark."], r.dark.length > early.length ? ["warn", `${r.dark.length - early.length} later screenshots are dark. Fine as long as they show something worth the squint.`] : null].filter(Boolean)),
          h("div", { class: "ix-shots" }, rows.map((x, i) => h("figure", { class: r.dark.includes(i) ? "dim" : "" }, x.canvas, h("figcaption", { class: "small", text: `#${i + 1} · brightness ${Math.round(x.st.brightness)}` })))),
          h2(ctx, "A stronger order to try", r.order.map(i => "#" + (i + 1)).join(", ")), k.note("The order is a starting point based on brightness, contrast and color. You know which shots tell your game's story best. Nothing is uploaded."));
      } catch (e) { out.replaceChildren(h("p", { class: "notice warn", text: e.message })); }
    });
    return h("div", { class: "ix-tool" }, h("div", { class: "ix-field" }, h("label", { text: "Choose your screenshots, in the order they appear on your page (up to 12)" }), pick), out); });

  // ---------- price and revenue ----------
  reg("fee-calculator", ctx => { const k = kit(ctx);
    return k.calc([{ key: "price", label: "Price (USD)", type: "number", value: 19.99, step: "0.01" }, { key: "copies", label: "Copies sold", type: "number", value: 1000 }, { key: "vat", label: "VAT or sales tax inside the price (%)", type: "number", value: 12, hint: "Averages differ by country. Most of Europe is 19 to 25%; the US adds sales tax on top." },
      { key: "refunds", label: "Refund rate (%)", type: "number", value: 6, hint: "Many games see 5 to 10%." }, { key: "tax", label: "Your own income tax estimate (%)", type: "number", value: 0, hint: "Leave at 0 to see what you earn before your own taxes." }],
      v => { const r = C.fees({ price: v.price, copies: v.copies, vat: v.vat, refunds: v.refunds, incomeTax: v.tax });
        return [k.stats(k.stat("You keep", usd(r.keep), `${r.keepPct}% of what players paid`, "good"), k.stat("Per copy", usd(r.perCopy)), k.stat("Valve's cut", usd(r.valve))),
          h3(ctx, [["Players paid", usd(r.sold)], ["VAT and sales tax", "− " + usd(r.vat)], ["Refunds", "− " + usd(r.refunded)], ["Valve's cut", "− " + usd(r.valve)], ["Your income tax", "− " + usd(r.tax)], ["You keep", usd(r.keep)]]),
          k.note("Valve takes 30% of the first $10 million an app earns, 25% from $10 to $50 million and 20% beyond. Real tax depends on where each buyer lives and where you live, so treat this as an estimate.")]; }); });

  const h3 = (ctx, rows) => ctx.h("table", { class: "ix-table slim" }, ctx.h("tbody", {}, rows.map(([a, b], i) => ctx.h("tr", { class: i === rows.length - 1 ? "total" : "" }, ctx.h("td", { text: a }), ctx.h("td", { class: "num", text: b })))));

  reg("break-even", ctx => { const k = kit(ctx);
    return k.calc([{ key: "budget", label: "What the game cost to make (USD)", type: "number", value: 40000 }, { key: "price", label: "Price (USD)", type: "number", value: 14.99, step: "0.01" }, { key: "vat", label: "VAT inside the price (%)", type: "number", value: 12 }, { key: "refunds", label: "Refund rate (%)", type: "number", value: 6 }],
      v => { const f = C.fees({ price: v.price, copies: 1, vat: v.vat, refunds: v.refunds }), b = C.breakEven({ budget: v.budget, netPerCopy: f.keep });
        if (!b) return k.note("Enter a price above zero to see the numbers.");
        return [k.stats(k.stat("You keep per copy", usd(f.keep)), k.stat("Copies to break even", int(b.copies), "at full price", "good")),
          h3(ctx, [["Reviews that usually come with that many sales", `${int(b.reviews.min)} to ${int(b.reviews.max)} (about ${int(b.reviews.typical)})`], ["Wishlists you'd likely need in year one", `${int(b.wishlists.min)} to ${int(b.wishlists.max)} (about ${int(b.wishlists.typical)})`]]),
          k.note("Discounts bring in less per copy, so a game that sells mostly on sale needs more copies. The review and wishlist figures are community rules of thumb, so use them as a rough guide.")]; }); });

  reg("review-score", ctx => { const k = kit(ctx);
    return k.calc([{ key: "pos", label: "Positive reviews", type: "number", value: 120 }, { key: "neg", label: "Negative reviews", type: "number", value: 18 }],
      v => { const r = C.reviewLabel(v.pos, v.neg), n = C.nextLabel(v.pos, v.neg);
        return [k.stats(k.stat("Steam shows", r.label, r.pct != null ? `${r.pct}% positive of ${int(r.total)}` : null, r.pct >= 80 ? "good" : r.pct != null && r.pct < 70 ? "warn" : null)),
          n ? k.checks([["good", `${int(n.positives)} more positive review${n.positives === 1 ? "" : "s"} (and no new negative ones) would move you from ${n.from} to ${n.label}.`]]) : k.note("There's no higher label to reach from here, or it would take an enormous number of reviews."),
          k.note("Labels follow Valve's published breakpoints. Steam can also count recent reviews separately, so your store page may show two labels.")]; }); });

  reg("revenue-estimator", ctx => { const k = kit(ctx), { h } = ctx, state = {}, out = h("div", { class: "ix-out" });
    const show = () => { const g = state.game; if (!g) return; const rv = g.reviews, price = g.priceCents ? g.priceCents / 100 : 0;
      if (!rv || !rv.total) { out.replaceChildren(k.note(`${g.title} has no public reviews yet, so there's nothing to estimate from.`)); return; }
      const e = C.revenueFromReviews({ reviews: rv.total, price }), lab = C.reviewLabel(rv.positive, rv.negative);
      out.replaceChildren(h("div", { class: "ix-game" }, h("img", { src: g.image, alt: "", width: 184, height: 69 }), h("div", {}, h("b", { text: g.title }), h("div", { class: "muted small", text: `${g.studio || ""} · ${price ? usd(price) : "Free"} · ${int(rv.total)} reviews · ${lab.label}` }))),
        k.stats(k.stat("Copies, typical", int(e.typical.copies), `${int(e.low.copies)} to ${int(e.high.copies)}`), k.stat("Gross revenue", usd(e.typical.gross), `${usd(e.low.gross)} to ${usd(e.high.gross)}`), k.stat("After Valve's cut", usd(e.typical.net), "before VAT, refunds and tax")),
        k.note("Estimated as reviews × 20 to 50 copies, with about 35 as the typical middle. Real ratios swing a lot by genre, price and how much of the audience leaves reviews. Paid price is today's, not an average over time, and free games can't be estimated this way."));
    };
    return h("div", { class: "ix-tool" }, k.steamBox(g => { state.game = g; show(); }), out); });

  // ---------- wishlists and launch ----------
  reg("wishlist-calculator", ctx => { const k = kit(ctx);
    return k.calc([{ key: "mode", label: "I want to…", type: "select", options: [["from", "See what my wishlists could sell"], ["goal", "See how many wishlists I need for a sales goal"]] }, { key: "n", label: "Wishlists (or copies, for a goal)", type: "number", value: 5000 }],
      v => { if (v.mode === "goal") { const y = C.wishlistsFor({ copies: v.n }), w = C.wishlistsFor({ copies: v.n, window: "week" });
          return [k.stats(k.stat("For the first year", `${int(y.min)} to ${int(y.max)}`, `about ${int(y.typical)}`), k.stat("For the first week", `${int(w.min)} to ${int(w.max)}`, `about ${int(w.typical)}`)), k.note("The wide range is the point. Games with a strong, specific audience land near the low end.")]; }
        const r = C.wishlistSales({ wishlists: v.n });
        return [k.stats(k.stat("First week", int(r.week.typical), `${int(r.week.low)} to ${int(r.week.high)} copies`), k.stat("First year", int(r.year.typical), `${int(r.year.low)} to ${int(r.year.high)} copies`, "good")), k.note("Rules of thumb from public talks and post-mortems: roughly 7 to 20% of wishlists buy in launch week and 15 to 45% within a year. Your genre, price and marketing move these a lot.")]; }); });

  reg("wishlist-conversion", ctx => { const k = kit(ctx);
    return k.calc([{ key: "v", label: "Store page visits", type: "number", value: 4000 }, { key: "w", label: "Wishlists those visits added", type: "number", value: 380 }],
      v => { const r = C.conversionBand(v.v, v.w); if (!r) return k.note("Enter your visits to see the rate.");
        return [k.stats(k.stat("Visit → wishlist", r.rate + "%", r.name, r.name === "Low" ? "warn" : "good")), k.checks([[r.name === "Low" ? "warn" : "good", r.note]]), k.note("Find both numbers in Steamworks under your app's traffic and wishlist reports. The bands are rough: under 5% low, 5 to 10 okay, 10 to 20 good, above 20 strong.")]; }); });

  reg("launch-planner", ctx => { const k = kit(ctx), { h } = ctx, out = h("div", { class: "ix-out" }), date = h("input", { type: "date", "aria-label": "Planned launch date" });
    let events = [];
    const fmt = ms => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    const run = () => { if (!date.value || !events.length) return; const ms = Date.parse(date.value + "T12:00:00Z"), c = C.launchContext(ms, events);
      const rows = [];
      if (c.inside.length) rows.push(["warn", `Launching during ${c.inside.map(e => e.name).join(" and ")}. Big events pull a lot of attention away from new games.`]);
      if (c.before && c.before.daysAgo <= 14) rows.push(["warn", `${c.before.name} ended ${c.before.daysAgo} day${c.before.daysAgo === 1 ? "" : "s"} before. Players have just spent their money.`]);
      if (c.after && c.after.daysAway <= 14) rows.push(["warn", `${c.after.name} starts in ${c.after.daysAway} day${c.after.daysAway === 1 ? "" : "s"}. Your game will compete with the sale before you can discount it.`]);
      if (!rows.length) rows.push(["good", "No major Steam sale or festival is right beside this date."]);
      out.replaceChildren(k.checks(rows), k.stats(c.before ? k.stat("Last event", c.before.name, `${c.before.daysAgo} days earlier`) : null, c.after ? k.stat("Next event", c.after.name, `${c.after.daysAway} days later`) : null), k.note("Valve announces sale dates ahead of time and they can shift. Check the Steamworks calendar before you commit."));
    };
    date.addEventListener("change", run);
    ctx.api("/api/indie/calendar").then(d => { events = d.sales; const list = h("table", { class: "ix-table" }, h("thead", {}, h("tr", {}, ["Event", "Starts", "Ends"].map(t => h("th", { text: t })))), h("tbody", {}, events.map(e => h("tr", {}, h("td", {}, h("b", { text: e.name }), e.note ? h("div", { class: "muted small", text: e.note }) : null), h("td", { text: fmt(e.start) }), h("td", { text: fmt(e.end) }))))); wrap.append(h("h3", { text: "Upcoming Steam sales and festivals" }), h("div", { class: "ix-scroll" }, list)); run(); }).catch(() => wrap.append(k.note("The calendar couldn't load right now.")));
    const wrap = h("div", { class: "ix-tool" }, h("div", { class: "ix-field" }, h("label", { text: "Planned launch date" }), date), out);
    return wrap; });

  reg("demo-or-playtest", ctx => { const k = kit(ctx), yn = [["1", "Yes"], ["0", "No"]];
    const q = (key, label, value) => ({ key, label, type: "select", options: yn, value });
    return k.calc([q("vertical", "Do you have a polished slice that shows what the game is?", "1"), q("page", "Is your store page public?", "1"), q("fest", "Is a Steam festival coming up that you could join?", "0"), q("feedback", "Is your main goal feedback on specific things, not reach?", "0"), q("stable", "Does the build run without crashing for strangers?", "1")],
      v => { const r = C.demoOrPlaytest({ vertical: v.vertical === "1", page: v.page === "1", fest: v.fest === "1", feedback: v.feedback === "1", stable: v.stable === "1" });
        return [k.stats(k.stat("Better fit", r.pick === "demo" ? "A demo" : "A playtest", `${r.demo} points for a demo, ${r.play} for a playtest`, "good")), k.checks(r.why.map(t => ["good", t])), k.note("You can do both: a closed playtest first, then a demo once the build is ready for the public.")]; }); });


  reg("next-fest-score", ctx => { const k = kit(ctx), yn = [["1", "Yes"], ["0", "Not yet"]];
    const q = (key, label) => ({ key, label, type: "select", options: yn, value: "0" });
    return k.calc([{ key: "wishlists", label: "Wishlists right now", type: "number", value: 0 }, q("page", "Store page is public with a finished capsule and trailer?"), q("demo", "Demo is uploaded and tested?"), q("quick", "The fun lands in the demo's first two minutes?"), q("wishbtn", "The demo ends with a wishlist or follow prompt?"),
      q("trailer", "Trailer shows gameplay in the first few seconds?"), q("shots", "Five or more good screenshots, best first?"), q("press", "Streamers and press have your demo?"), q("mail", "Your followers know the festival dates?"), q("patch", "You can patch the demo fast?"), q("there", "You'll be around during the festival?")],
      v => { const r = C.nextFestScore({ ...Object.fromEntries(Object.entries(v).map(([key, val]) => [key, val === "1"])), wishlists: v.wishlists });
        return [k.stats(k.stat("Readiness", `${r.score} / 100`, r.band, r.score >= 70 ? "good" : r.score >= 40 ? "warn" : "bad")),
          r.gaps.length ? k.checks(r.gaps.map(g => ["warn", g.fix])) : k.checks([["good", "Nothing big is missing. Do one last install test of the demo on a clean machine."]]),
          k.note("This is a planning aid built from what tends to matter at Next Fest. It isn't Valve's measure, and a great demo beats a perfect checklist.")]; }); });

  reg("trailer-check", ctx => { const k = kit(ctx), { h } = ctx, out = h("div", { class: "ix-out" }), pick = h("input", { type: "file", accept: "video/*", "aria-label": "Choose your trailer file" });
    pick.addEventListener("change", async () => {
      const f = pick.files[0]; if (!f) return;
      out.replaceChildren(h("p", { class: "muted", text: "Looking at your first seconds…" }));
      const url = URL.createObjectURL(f), v = h("video", { muted: "", preload: "auto", playsinline: "" });
      try {
        v.muted = true; v.src = url;
        await new Promise((ok, no) => { v.onloadeddata = ok; v.onerror = () => no(new Error("That video couldn't be opened in your browser. MP4 (H.264) works best.")); });
        const secs = [0, 1, 2, 3, 4, 5].filter(t => t <= Math.max(0, (v.duration || 6) - 0.1)), frames = [], w = 160, ht = 90, strip = h("div", { class: "ix-frames" });
        let prev = null;
        for (const t of secs) {
          await new Promise(ok => { v.onseeked = ok; v.currentTime = t; });
          const c = h("canvas", { width: w, height: ht, class: "ix-pix" }), g = c.getContext("2d", { willReadFrequently: true });
          g.drawImage(v, 0, 0, w, ht); const px = g.getImageData(0, 0, w, ht).data, st = C.imageStats(px);
          frames.push({ second: t, brightness: st.brightness, motion: prev ? C.frameMotion(prev, px) : null }); prev = new Uint8ClampedArray(px);
          strip.append(h("figure", {}, c, h("figcaption", { class: "muted small", text: `${t}s` })));
        }
        const r = C.trailerOpening(frames);
        out.replaceChildren(strip, k.checks(r.checks), k.note(`Your video stays on this device. Length: ${Math.round(v.duration)}s. Steam plays trailers muted and small on a page, so the first three seconds have to work with no sound.`));
      } catch (e) { out.replaceChildren(h("p", { class: "notice warn", text: e.message })); }
      finally { URL.revokeObjectURL(url); }
    });
    return h("div", { class: "ix-tool" }, h("div", { class: "ix-field" }, h("label", { text: "Choose your trailer file" }), pick), out); });

  // ---------- press and creators ----------
  /** The game-details form shared by the three writing tools. */
  function gameForm(ctx, extra, render) {
    const k = kit(ctx), { h } = ctx;
    const specs = [{ key: "name", label: "Game name", placeholder: "Your Game" }, { key: "studio", label: "Studio or your name" }, { key: "genre", label: "Genre", placeholder: "cozy farming sim" }, { key: "pitch", label: "One-line pitch", placeholder: "Run a farm on the back of a giant sleeping turtle." },
      { key: "url", label: "Steam store link" }, { key: "release", label: "Release date", placeholder: "March 12, 2027" }, { key: "price", label: "Price", placeholder: "$14.99" }, { key: "platforms", label: "Platforms", value: "Windows" },
      { key: "email", label: "Contact email" }, { key: "kit", label: "Press kit or trailer link" }, ...extra];
    const form = k.calc(specs, v => render(v, k), { before: k.steamBox(g => { const set = (key, val) => { const el = [...form.querySelectorAll(".ix-field")].find(f => f.firstChild?.textContent === specs.find(s => s.key === key)?.label)?.querySelector("input,textarea"); if (el && val) { el.value = val; el.dispatchEvent(new Event("input")); } };
      set("name", g.title); set("studio", g.studio); set("genre", (g.genres[0] ?? "").toLowerCase()); set("pitch", g.blurb); set("url", `https://store.steampowered.com/app/${g.appid}/`); set("release", g.release); set("price", g.price); set("platforms", g.platforms.map(p => ({ windows: "Windows", mac: "macOS", linux: "Linux" }[p] ?? p)).join(", ")); }) });
    return form;
  }
  const out = (ctx, label, text, rows = 12) => { const { h } = ctx, k = kit(ctx), box = h("textarea", { rows, readonly: true, class: "ix-result", "aria-label": label }); box.value = text; return h("div", { class: "ix-result-wrap" }, h("div", { class: "ix-result-head" }, h("b", { text: label }), k.copy("Copy", () => box.value)), box); };

  reg("x-post", ctx => { const { h } = ctx, k = kit(ctx);
    const form = k.calc([{ key: "kind", label: "What are you posting?", type: "select", options: Object.entries(C.X_KINDS) }, { key: "name", label: "Game name" }, { key: "pitch", label: "One line about it", placeholder: "A cozy farming sim on the back of a giant turtle." }, { key: "url", label: "Link", placeholder: "Steam page or your showcase page" },
      { key: "genre", label: "Genre tag", placeholder: "roguelike" }, { key: "price", label: "Price", placeholder: "$14.99" }, { key: "date", label: "Release date", placeholder: "March 12" }, { key: "tags", label: "Hashtags (optional)", placeholder: "indiedev gamedev roguelike", hint: "Leave empty and we pick the tags indie developers follow most, like #indiegame, #gamedev and #Steam, plus your genre. On Wednesdays announcements also get #WishlistWednesday." }],
      v => { const r = C.xPost(v), box = h("textarea", { rows: 7, readonly: true, class: "ix-result", "aria-label": "Your post" }); box.value = r.text;
        const open = h("a", { class: "btn blue small", target: "_blank", rel: "noopener noreferrer", href: "https://x.com/intent/post?text=" + encodeURIComponent(r.text), text: "Open in X" });
        return [h("div", { class: "ix-result-wrap" }, h("div", { class: "ix-result-head" }, h("b", { text: "Your post" }), h("span", { class: "muted small", text: `${r.length} / 280` }), k.copy("Copy", () => box.value), open), box), r.fits ? null : k.note("It's over 280 characters. Shorten the line about your game."), k.note("Posts with a short clip or a GIF get more attention than text alone. Attach one before you send.")]; },
      { before: k.steamBox(g => { const set = (label, val) => { const el = [...form.querySelectorAll(".ix-field")].find(f => f.firstChild?.textContent === label)?.querySelector("input,textarea"); if (el && val) { el.value = val; el.dispatchEvent(new Event("input")); } }; set("Game name", g.title); set("One line about it", g.blurb.slice(0, 140)); set("Link", `https://store.steampowered.com/app/${g.appid}/`); set("Genre tag", (g.genres[0] ?? "").toLowerCase()); set("Price", g.price); set("Release date", g.release); }) });
    return form; });

  reg("press-email", ctx => gameForm(ctx, [{ key: "to", label: "Who you're writing to", placeholder: "Sam" }], (v, k) => {
    const n = v.name || "[Game name]", s = v.studio || "[Studio]", who = v.to ? v.to.trim() : "[Name]", link = v.url || "[Steam link]";
    const pitch = `Subject: ${n}: ${v.genre ? `a ${v.genre}` : "a new game"} from ${s}\n\nHi ${who},\n\n${v.pitch ? v.pitch.trim() : "[One sentence on what makes the game worth a look.]"}\n\nI'm ${s}, and I'm making ${n}${v.release ? `, out ${v.release}` : ""}${v.price ? ` for ${v.price}` : ""} on ${v.platforms || "Windows"}. ${link}\n${v.kit ? `\nTrailer and press kit: ${v.kit}\n` : ""}\nIf it looks like your kind of thing, I'd be happy to send a review key. No pressure either way, and thanks for reading.\n\n${s}${v.email ? `\n${v.email}` : ""}`;
    const keyOffer = `Subject: A key for ${n}\n\nHi ${who},\n\nThanks for getting back to me. Here's a Steam key for ${n}: [KEY]\n\nA few things that might help: ${v.pitch ? v.pitch.trim() : "[what to look for in the first 30 minutes]"} If anything breaks or you'd like to talk to me about it, ${v.email ? `reach me at ${v.email}` : "just reply to this email"}.\n\nNo obligation to cover it, and I appreciate you taking the time.\n\n${s}`;
    const launch = `Subject: ${n} is out now\n\nHi ${who},\n\n${n} is live on Steam today${v.price ? ` for ${v.price}` : ""}: ${link}\n\n${v.pitch ? v.pitch.trim() : "[One sentence on the game.]"}\n\nIf you've already covered it, thank you. If you'd like a key or an interview, just reply${v.email ? ` or write to ${v.email}` : ""}.\n\n${s}`;
    return [out(ctx, "First pitch", pitch), out(ctx, "Review key offer", keyOffer, 10), out(ctx, "Launch day email", launch, 10), k.note("Edit the bracketed parts before you send. Short, specific emails to people who cover games like yours work better than a mass mail.")]; }));

  reg("creator-pitch", ctx => gameForm(ctx, [{ key: "platform", label: "Where they post", type: "select", options: [["YouTube", "YouTube"], ["Twitch", "Twitch"], ["TikTok", "TikTok"]] }, { key: "who", label: "Creator's name", placeholder: "Alex" }, { key: "why", label: "Why you picked them", placeholder: "I loved your video on cozy deckbuilders." }], (v, k) => {
    const n = v.name || "[Game name]", s = v.studio || "[Studio]", who = v.who ? v.who.trim() : "[Name]", link = v.url || "[Steam link]", why = v.why ? v.why.trim() : "[Say what you actually watched or liked of theirs.]", p = v.platform;
    const email = `Subject: ${n}, a key for your ${p === "TikTok" ? "TikToks" : p === "Twitch" ? "streams" : "videos"}?\n\nHi ${who},\n\n${why} ${n} is ${v.genre ? `a ${v.genre}` : "a game"} I think your audience would enjoy: ${v.pitch ? v.pitch.trim() : "[one sentence]"}\n\nHere's the page: ${link}${v.kit ? `\nTrailer and press kit: ${v.kit}` : ""}\n\nI'd love to send you a Steam key. There's no deal attached and you're free to say what you really think.\n\n${s}${v.email ? `\n${v.email}` : ""}`;
    const dm = `Hi ${who}! ${why} I make ${n}${v.genre ? `, a ${v.genre}` : ""}. ${v.pitch ? v.pitch.trim() + " " : ""}Can I send you a free key? No strings. ${link}`;
    const follow = `Hi ${who}, just a quick follow-up on ${n}. No worries if it isn't for you. If you'd like a key, I can send one right away. ${link}`;
    return [out(ctx, `${p} email`, email, 11), out(ctx, "Short DM", dm, 5), out(ctx, "Follow-up after a week", follow, 5), k.note("Creators get a lot of keys. Naming something you really watched of theirs is what gets a reply.")]; }));

  reg("fact-sheet", ctx => gameForm(ctx, [{ key: "format", label: "Format", type: "select", options: [["md", "Markdown"], ["html", "HTML"], ["txt", "Plain text"], ["json", "JSON"]] }, { key: "features", label: "Key features, one per line", type: "textarea", rows: 4 }, { key: "website", label: "Website" }, { key: "social", label: "Social or Discord link" }], (v, k) => {
    const feats = String(v.features || "").split("\n").map(x => x.trim()).filter(Boolean), esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const f = { name: v.name, developer: v.studio, genre: v.genre, platforms: v.platforms, release: v.release, price: v.price, description: v.pitch, steam: v.url, website: v.website, social: v.social, press_kit: v.kit, contact: v.email, features: feats };
    let text;
    if (v.format === "json") text = JSON.stringify(Object.fromEntries(Object.entries(f).filter(([, x]) => (Array.isArray(x) ? x.length : x))), null, 2);
    else if (v.format === "html") text = `<h1>${esc(v.name || "Game name")}</h1>\n<p>${esc(v.pitch || "")}</p>\n<ul>\n${[["Developer", v.studio], ["Genre", v.genre], ["Platforms", v.platforms], ["Release date", v.release], ["Price", v.price], ["Steam", v.url], ["Website", v.website], ["Social", v.social], ["Press kit", v.kit], ["Contact", v.email]].filter(x => x[1]).map(([a, b]) => `  <li><strong>${a}:</strong> ${esc(b)}</li>`).join("\n")}\n</ul>${feats.length ? `\n<h2>Key features</h2>\n<ul>\n${feats.map(x => `  <li>${esc(x)}</li>`).join("\n")}\n</ul>` : ""}`;
    else { const md = v.format === "md", line = (a, b) => (b ? (md ? `- **${a}:** ${b}\n` : `${a}: ${b}\n`) : ""); text = `${md ? "# " : ""}${v.name || "Game name"}\n\n${v.pitch ? v.pitch + "\n\n" : ""}${line("Developer", v.studio)}${line("Genre", v.genre)}${line("Platforms", v.platforms)}${line("Release date", v.release)}${line("Price", v.price)}${line("Steam", v.url)}${line("Website", v.website)}${line("Social", v.social)}${line("Press kit", v.kit)}${line("Contact", v.email)}${feats.length ? `\n${md ? "## " : ""}Key features\n${feats.map(x => (md ? "- " : "• ") + x).join("\n")}\n` : ""}`; }
    return [out(ctx, "Fact sheet", text, 16), k.note("Put this on your press kit page so journalists and creators never have to hunt for the basics.")]; }));

  // ---------- market research ----------
  reg("appid-finder", ctx => { const k = kit(ctx), { h } = ctx, input = h("input", { type: "text", placeholder: "A game's name or a Steam store link", "aria-label": "Game name or link" }), btn = h("button", { class: "btn blue small", type: "button", text: "Find it" }), out = h("div", { class: "ix-out" });
    const go = () => ctx.busy(btn, async () => {
      const d = await ctx.api("/api/indie/lookup?q=" + encodeURIComponent(input.value.trim()));
      const rows = d.game ? [{ appid: d.game.appid, name: d.game.title, image: d.game.image, price: d.game.price }] : d.results;
      out.replaceChildren(rows.length ? h("div", { class: "ix-results" }, rows.map(r => h("div", { class: "ix-result-row" }, h("img", { src: r.image, alt: "", width: 120, height: 45, loading: "lazy" }), h("div", {}, h("b", { text: r.name }), h("div", { class: "muted small", text: r.price ?? "" })), h("code", { text: String(r.appid) }), k.copy("Copy ID", () => String(r.appid))))) : h("p", { class: "muted", text: "No games found with that name." }));
    });
    btn.addEventListener("click", go); input.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
    return h("div", { class: "ix-tool" }, h("div", { class: "ix-steam" }, input, btn), out); });

  reg("rival-compare", ctx => { const k = kit(ctx), { h } = ctx, games = [null, null], out = h("div", { class: "ix-out" });
    const show = () => { if (!games[0] || !games[1]) { out.replaceChildren(k.note("Load both games to compare them.")); return; }
      const row = (label, f) => h("tr", {}, h("th", { text: label }), games.map(g => h("td", { text: f(g) })));
      out.replaceChildren(h("div", { class: "ix-scroll" }, h("table", { class: "ix-table" }, h("thead", {}, h("tr", {}, h("th"), games.map(g => h("th", {}, h("img", { src: g.image, alt: "", width: 184, height: 69 }), h("div", { text: g.title }))))), h("tbody", {},
        row("Studio", g => g.studio || "–"), row("Price", g => g.price ?? "–"), row("Release", g => g.release || "–"), row("Reviews", g => (g.reviews?.total ? int(g.reviews.total) : "none yet")), row("Review label", g => (g.reviews?.total ? C.reviewLabel(g.reviews.positive, g.reviews.negative).label : "–")),
        row("Positive", g => (g.reviews?.total ? C.reviewLabel(g.reviews.positive, g.reviews.negative).pct + "%" : "–")), row("Estimated copies", g => (g.reviews?.total ? int(C.revenueFromReviews({ reviews: g.reviews.total, price: 0 }).typical.copies) : "–")), row("Genres", g => g.genres.join(", ") || "–"), row("Platforms", g => g.platforms.join(", ") || "–")))),
        k.note("Estimated copies use reviews × about 35, a rough middle. Compare the genres and price points first: they tell you who you're really up against."));
    };
    const box = i => { const input = h("input", { type: "text", placeholder: i ? "Rival's name or store link" : "Your game's name or store link", "aria-label": i ? "Rival's name or store link" : "Your game's name or store link" }), btn = h("button", { class: "btn blue small", type: "button", text: "Load" });
      const go = () => ctx.busy(btn, async () => { let d = await ctx.api("/api/indie/lookup?q=" + encodeURIComponent(input.value.trim())); if (!d.game && d.results?.length) d = await ctx.api("/api/indie/lookup?q=" + d.results[0].appid); if (!d.game) { ctx.toast("Steam found nothing under that. Try the store link."); return; } games[i] = d.game; show(); });
      btn.addEventListener("click", go); input.addEventListener("keydown", e => { if (e.key === "Enter") go(); }); return h("div", { class: "ix-steam" }, input, btn); };
    show();
    return h("div", { class: "ix-tool" }, h("div", { class: "ix-two" }, box(0), box(1)), out); });

  root.IndieTools = { render: (id, ctx) => (TOOLS[id] ? TOOLS[id](ctx) : null), ids: Object.keys(TOOLS) };
})(typeof globalThis !== "undefined" ? globalThis : this);

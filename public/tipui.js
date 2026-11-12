// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls TipUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, busy, ext, h, pageHead, routeText, select, state, toast } = ctx;
    const tip = state.cfg && state.cfg.tipUrl;
    app.replaceChildren(pageHead("Support the project", "Both tools are free, and they stay free. If one saved you money or time, you can chip in."),
      h("div", { class: "panel" },
        h("p", { text: "I make Steam Value Checker and FanaticalGrabber on my own and pay for the hosting out of pocket. Tips go toward the server bill and the time I spend fixing things. Nothing is locked behind them, and nobody gets treated differently for giving." }),
        tip ? h("p", {}, ext("https://www.paypal.com/paypalme/Lucadosus", "Chip in on PayPal", "btn blue")) : null,
        h("div", { id: "supporter-box" }),
        h("div", { id: "referral-box" }),
        h("h3", { text: "Other ways to help" }),
        h("ul", {},
          h("li", { text: "Add Steam Value Checker to a server and tell friends who buy too many bundles." }),
          h("li", { text: "Vote for the bot on Top.gg. Voting is free, and it earns you bonus XP in your servers." }),
          h("li", {}, "Send me a bug or an idea on ", ext("https://x.com/twit_user69", "X"), ". I read all of them.")),
        h("h3", { text: "Good to know" }),
        h("p", { class: "muted", text: "The PayPal button opens PayPal, which handles the payment. This dashboard never sees any payment details. A tip is a gift, not a purchase, and it doesn't buy a feature or a promise of support." })));
    if (!state.me) return;
    try { // invite links: each friend who joins earns the person a few supporter days
      const r = await api("/api/referral"), rb = document.getElementById("referral-box");
      if (rb) {
        const copy = h("button", { class: "btn blue", type: "button", text: "Copy my link" });
        copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(r.link); toast("Copied.", "ok"); } catch { toast("Select the link and copy it."); } });
        rb.replaceChildren(h("h3", { text: "Invite friends, earn supporter days" }),
          h("p", { class: "muted", text: `Share your own link. Every friend who signs in through it for the first time adds ${r.daysEach} days of supporter to your pass, up to ${r.max} friends.` }),
          h("div", { class: "row" }, h("input", { type: "text", value: r.link, readonly: "", size: "34", "aria-label": "Your invite link" }), copy),
          h("p", { class: r.full ? "notice ok" : "muted small", text: r.full ? `You've reached the limit: ${r.max} friends, ${r.daysEarned} days earned. Thank you for spreading the word!` : `${r.joined} of ${r.max} friends so far${r.joined ? ` (${r.daysEarned} days earned)` : ""}. Their Discord account has to be at least a week old to count.` }));
      }
    } catch { /* signed out or the feature is off */ }
    try {
      const s = await api("/api/supporter"), box = document.getElementById("supporter-box");
      if (!box || (!s.enabled && !s.until)) return;
      const fmt = ms => new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
      box.replaceChildren(h("h3", { text: "Supporter pass" }),
        routeText().includes("thanks=gift") ? h("div", { class: "notice ok", text: "Thank you! Your gift is on its way. They get a DM when it lands, and so do you." }) : routeText().includes("thanks=1") ? h("div", { class: "notice ok", text: "Thank you! Your pass shows up within a minute or two, and the bot will DM you when it does." }) : null,
        s.founder ? h("p", {}, h("span", { class: "pf-badge founder", text: "✦ Founding supporter" }), " You were one of the first 50, so this stays on your profile for good.") : null,
        s.until ? h("p", {}, h("strong", { text: "You're a supporter until " + fmt(s.until) + "." }), " Buying another pass adds to the time you have left.") : null,
        h("p", { class: "muted", text: `A pass gives you a Supporter role in the Steam Value Checker server, a badge and glowing ring on your profile, three exclusive profile themes, 24 overlay slots instead of 12, your own color on your price-alert cards and ${Math.round((s.boost - 1) * 100)}% more XP. Everything else stays free for everyone.` }),
        s.enabled && !s.founder && s.founding_left > 0 ? h("p", { class: "muted small", text: s.founding_left === 50 ? "The first 50 paid passes earn a Founding supporter mark that never expires." : `${s.founding_left} of 50 Founding supporter spots left. It's a mark that never expires.` }) : null,
        s.enabled ? h("div", { class: "row" }, ...s.plans.map(p => h("button", { class: "btn blue", type: "button", text: `${p.name} · $${(p.cents / 100).toFixed(p.cents % 100 ? 2 : 0)}`, onclick: e => busy(e.currentTarget, async () => { const r = await api("/api/supporter/checkout", { plan: p.id }); location.href = r.url; }) }))) : null,
        s.enabled ? (() => {
          const to = h("input", { type: "text", placeholder: "Their page name or Discord ID", "aria-label": "Who to gift a pass to" });
          const plan = select(s.plans.map(p => [p.id, `${p.name} · $${(p.cents / 100).toFixed(p.cents % 100 ? 2 : 0)}`]), s.plans[0].id);
          return h("div", { class: "pass-gift" }, h("h4", { text: "Gift a pass 🎁" }), h("p", { class: "muted small", text: "Treat a friend. They get the role and perks, and a DM saying it's from you." }),
            h("div", { class: "row" }, to, plan, h("button", { class: "btn gray", type: "button", text: "Gift it", onclick: e => busy(e.currentTarget, async () => { try { const r = await api("/api/supporter/checkout", { plan: plan.value, gift_to: to.value }); location.href = r.url; } catch (err) { toast(err.message, "error"); } }) })));
        })() : null,
        s.enabled ? h("p", { class: "muted small", text: "Checkout is handled by Square. The bot never sees your card." }) : null,
        (s.until || s.founder) ? (() => {
          const nm = h("input", { type: "text", maxlength: "24", value: s.wall || "", placeholder: "A name to show, like Jacob" });
          return h("div", { class: "pass-wall-opt" }, h("h4", { text: "Supporter wall" }), h("p", { class: "muted small", text: "Want to be thanked in public? Pick a name and you'll show up below. It never links to your Discord. Clear it to leave." }),
            h("div", { class: "row" }, nm, h("button", { class: "btn gray", type: "button", text: "Save", onclick: e => busy(e.currentTarget, async () => { try { await api("/api/supporter/wall", { name: nm.value }); toast(nm.value.trim() ? "You're on the wall." : "Removed from the wall.", "ok"); tipView(); } catch (err) { toast(err.message, "error"); } }) })));
        })() : null,
        (s.until || s.founder) ? (() => {
          const pick = h("input", { type: "color", value: s.alert_color || "#57f287", "aria-label": "Alert color" });
          return h("div", { class: "pass-wall-opt" }, h("h4", { text: "Alert color" }), h("p", { class: "muted small", text: "Your own price alerts from the bot get the color you pick down the side of the card." }),
            h("div", { class: "row" }, pick,
              h("button", { class: "btn gray", type: "button", text: "Save", onclick: e => busy(e.currentTarget, async () => { try { await api("/api/supporter/alertcolor", { color: pick.value }); toast("Your alerts will use that color.", "ok"); } catch (err) { toast(err.message, "error"); } }) }),
              h("button", { class: "btn gray", type: "button", text: "Back to the default", onclick: e => busy(e.currentTarget, async () => { try { await api("/api/supporter/alertcolor", { color: "" }); toast("Back to the usual colors.", "ok"); tipView(); } catch (err) { toast(err.message, "error"); } }) })));
        })() : null);
    } catch { /* the pass is optional, so the rest of the page stands on its own */ }
    try {
      const w = (await api("/api/public/supporters")).wall;
      if (w.length) document.getElementById("supporter-box")?.after(h("div", { class: "panel pass-wall" }, h("h3", { text: "Thank you to" }), h("div", { class: "pass-wall-list" }, ...w.map(x => h("span", { class: "pf-badge" + (x.founder ? " founder" : ""), title: x.founder ? "Founding supporter" : "Supporter", text: (x.founder ? "✦ " : "★ ") + x.name })))));
    } catch { /* the wall is a nicety */ }
  }
  root.TipUI = { view };
})(window);

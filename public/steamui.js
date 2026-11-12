// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls SteamUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { LOC, analyticsPanel, api, app, busy, field, h, hoursText, money, pageHead, recapPanel, replaceUrl, state, steamArt, steamLoginBtn, steamProfileCard, toast, twitchLinkPanel } = ctx;
    const out = h("div", { class: "muted", text: "Loading…" });
    const profile = h("input", { type: "text", placeholder: "Steam profile link, custom name or SteamID64", maxlength: "200" });
    const linkBtn = h("button", { class: "btn blue", text: "Link and import", onclick: () => busy(linkBtn, async () => {
      const r = await api("/api/steam/link", { profile: profile.value });
      state.artForce = true;
      toast(`Found ${r.owned} games` + (r.value && r.value.games ? ` worth ${money(r.value.msrp, r.value.currency)}` : "") + `. Added ${r.added}, updated ${r.updated}.` + (r.unmatched ? ` ${r.unmatched} had no price match.` : ""), "ok"); load();
    }) });
    // Look up anyone's public profile. Nothing is saved; it just shows their card and play stats.
    const found = h("div");
    const q = h("input", { type: "text", placeholder: "Steam profile link, custom name or SteamID64", maxlength: "200", "aria-label": "Steam profile to look up" });
    const findBtn = h("button", { class: "btn blue", text: "Look up", onclick: () => busy(findBtn, async () => {
      const r = await api("/api/steam/lookup?profile=" + encodeURIComponent(q.value));
      const st = r.stats, tile = (k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: v }), sub && h("div", { class: "s", text: sub }));
      const linkIt = !state.steamLinked && !r.mine ? h("button", { class: "btn green small", type: "button", text: "Link this profile", onclick: e => busy(e.currentTarget, async () => { await api("/api/steam/link", { profile: r.card.steamid }); toast("Linked.", "ok"); load(); }) }) : null;
      found.replaceChildren(steamProfileCard(r.card, linkIt),
        h("div", { class: "grid four" }, tile("Games", String(st.games), st.playedGames + " played"), tile("Hours played", hoursText(st.totalMinutes)), tile("Barely played", String(st.barely), "under an hour each")),
        st.mostPlayed.length ? h("div", { class: "panel" }, h("h3", { text: "Most played" }), h("ul", { class: "plain" }, st.mostPlayed.map(g => h("li", {}, h("b", { text: g.title }), " ", h("span", { class: "muted", text: hoursText(g.minutes) }))))) : null,
        h("p", { class: "muted small", text: "Only what their public profile shows. Nothing is saved." }));
    }) });
    q.addEventListener("keydown", e => { if (e.key === "Enter") findBtn.click(); });
    const lookup = h("div", {}, h("div", { class: "panel" }, h("h3", { text: "Look up a profile" }), field("Any public Steam profile", q), h("p"), findBtn,
      h("p", { class: "muted small", text: "See someone's card, games and hours. Nothing is saved." })), found);
    const linkPanel = h("div", { class: "panel steam-hero" }, h("h3", { text: "Sign in through Steam" }),
      h("p", { class: "muted", text: "One click and your library, hours played and taste profile fill in on their own. You sign in on Steam's own page; the bot never sees your password and only keeps your public ID." }),
      h("div", { class: "row" }, steamLoginBtn("Sign in through Steam", "btn steam big")),
      h("p", { class: "muted small", text: "Set Game details to Public in Steam's privacy settings so your games can be read." }),
      h("details", { class: "paste" }, h("summary", { text: "Use a profile link instead" }), field("Steam profile", profile), h("p"), linkBtn),
      h("div", { class: "lr-option" }, h("b", { text: "Or connect it through Discord Linked Roles" }),
        h("p", { class: "muted small", text: "Signs you in with Discord and Steam in one go, and shows Steam Verified, your games owned and hours on your Discord profile, so servers can give roles for it." }),
        h("a", { class: "btn gray", href: "/auth/linked", text: "Connect with Linked Roles" })));
    // Once Steam is linked: show what Discord will display, and let the member (re)connect it.
    const linkedRolesPanel = () => {
      const box = h("div", { class: "panel" }, h("h3", { text: "Discord Linked Roles" }), h("p", { class: "muted", text: "Loading…" }));
      api("/api/steam/linkedroles").then(r => {
        const pv = r.preview;
        box.replaceChildren(h("h3", { text: "Discord Linked Roles" }),
          h("p", { class: "muted", text: "Show your Steam on your Discord profile. Servers can then give roles to people who are Steam Verified, own enough games or have enough hours. Discord only shows what you connect here." }),
          pv ? h("p", {}, h("b", { text: "What Discord will show: " }), `Steam Verified ${pv.steam_verified ? "✅" : "❌ (sign in through Steam to verify)"} · ${pv.games_owned.toLocaleString()} games · ${pv.hours_played.toLocaleString()} hours`) : null,
          r.available ? h("div", { class: "row" }, h("a", { class: "btn blue", href: r.url, text: "Connect or update Linked Roles" })) : h("p", { class: "muted", text: "Linked Roles is not available on this bot." }),
          h("p", { class: "muted small", text: "Press it again after a sync to refresh your games and hours on your profile. Your normal Steam link works the same either way." }));
      }).catch(() => box.replaceChildren());
      return box;
    };
    // Steam Family: games these people own are skipped in sale alerts and counted as owned in bundle checks.
    const familyPanel = () => {
      const box = h("div", { class: "panel" });
      const draw = v => {
        const who = h("input", { type: "text", placeholder: "Their Steam profile link, custom name or SteamID64", maxlength: "200" });
        const add = h("button", { class: "btn blue small", text: "Add" });
        add.addEventListener("click", () => busy(add, async () => { if (!who.value.trim()) return; draw(await api("/api/steam/family", { add: who.value.trim() })); toast("Added.", "ok"); }));
        box.replaceChildren(h("h3", { text: "Steam Family" }),
          h("p", { class: "muted small", text: "Add the people in your Steam Family (their Game details have to be public). Sale alerts for games they own are held, and bundle checks count those games as owned. Most games can be shared in a family, but not all." }),
          v.members.length ? h("ul", { class: "plain" }, v.members.map(m => { const rm = h("button", { class: "btn gray small", text: "Remove" });
            rm.addEventListener("click", () => busy(rm, async () => draw(await api("/api/steam/family", { remove: m.steamid }))));
            return h("li", {}, h("b", { text: m.name }), " ", h("span", { class: "muted", text: m.games + " games" }), " ", rm); })) : null,
          v.members.length < v.max ? h("div", { class: "row" }, who, add) : h("p", { class: "muted small", text: "That is a full family. Remove someone to add another." }),
          v.covered.length ? h("p", { class: "muted small", text: `On your wishlist and already in the family (${v.covered.length}): ` + v.covered.slice(0, 12).map(c => c.title).join(", ") + (v.covered.length > 12 ? "…" : "") }) : null);
      };
      api("/api/steam/family").then(draw).catch(() => box.remove());
      return box;
    };
    const slot = h("div");
    async function load() {
      try {
        const d = await api("/api/steam");
        state.steamLinked = !!d.link;
        state.me.steam = d.link ? { linked: true, verified: Boolean(d.link.verified), synced: Boolean(d.link.synced_at) } : { linked: false };
        state.artForce = false;
        // Linked: the look-up takes the link box's place. Not linked: link first, look-up below.
        slot.replaceChildren(...(d.link ? [d.link.verified ? null : h("div", { class: "notice" }, "This profile was added from a link. ", steamLoginBtn("Verify with Steam", "btn steam small"), " Verified accounts can sign in with Steam and need no links."), lookup].filter(Boolean) : [linkPanel, lookup]));
        if (!d.link) { out.className = ""; out.replaceChildren(h("div", { class: "empty", text: "No Steam profile linked yet. Your Game details must be public on Steam for this to work." })); return; }
        const st = d.stats, cur = d.currency;
        const tile = (k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: v }), sub && h("div", { class: "s", text: sub }));
        const list = (rows, f) => h("ul", { class: "plain" }, rows.map(r => h("li", {}, h("b", { text: r.title }), " ", f(r))));
        const sync = h("button", { class: "btn gray", text: "Sync now", onclick: () => busy(sync, async () => { const r = await api("/api/steam/sync", {}); state.artForce = true; toast(`Synced ${r.owned} games.` + (r.achievements && r.achievements.checked ? ` Checked achievements for ${r.achievements.checked}` + (r.achievements.newlyFinished ? `, ${r.achievements.newlyFinished} marked Finished.` : ".") : ""), "ok"); load(); }) });
        const unlinkGames = h("input", { type: "checkbox" });
        const unlink = h("button", { class: "btn red", text: "Unlink", onclick: () => busy(unlink, async () => { const r = await api("/api/steam/unlink", { removeGames: unlinkGames.checked }); toast(r.removed ? `Unlinked, and removed ${r.removed} games.` : "Unlinked.", "ok"); load(); }) });

        // What to play next: a pick from your own library. "Pick another" never repeats one already offered.
        const offered = [];
        const nextOut = h("div");
        const nextBtn = h("button", { class: "btn green", text: "What should I play next?" });
        async function pickNext() {
          const q = offered.length ? "?skip=" + encodeURIComponent(offered.join(",")) : "";
          const r = await api("/api/steam/next" + q);
          if (!r.next) { nextOut.replaceChildren(h("div", { class: "notice warn", text: offered.length ? "That is everything. Start over to see them again." : "Nothing left to suggest. Everything is finished or dropped." })); offered.length = 0; nextBtn.textContent = "What should I play next?"; return; }
          const n = r.next;
          offered.push(n.pick.itad_id);
          nextBtn.textContent = "Pick another";
          nextOut.replaceChildren(h("div", { class: "panel" },
            n.pick.appid ? steamArt(n.pick.appid, "next-art") : null,
            h("h3", { text: "" + n.pick.title }), h("p", { class: "muted", text: n.why }),
            n.others.length ? h("p", { class: "muted small", text: "Also good: " + n.others.map(o => o.title).join(", ") }) : null,
            h("p", { class: "muted small", text: n.remaining ? `${n.remaining} more to choose from.` : "That is everything left that you have not finished." })));
        }
        nextBtn.addEventListener("click", () => busy(nextBtn, pickNext));

        out.className = "";
        const valueImageBtn = h("button", { class: "btn gray small", type: "button", text: "Save as image", title: "The same picture /me steam value posts in Discord", onclick: e => busy(e.currentTarget, async () => {
          const res = await fetch("/api/steam/value.png", { credentials: "same-origin" });
          if (!res.ok) { let m = "Could not draw the picture."; try { m = (await res.json()).error || m; } catch { /* keep the default */ } throw new Error(m); }
          const url = URL.createObjectURL(await res.blob()), a = h("a", { href: url, download: "steam-account-value.png" }); a.click(); setTimeout(() => URL.revokeObjectURL(url), 4000);
        }) });
        const quickUnlink = h("button", { class: "btn red small", type: "button", text: "Unlink", title: "Unlink this profile (your games stay unless you remove them under Manage)", onclick: () => { if (confirm("Unlink this Steam profile? Your library games stay.")) busy(quickUnlink, async () => { await api("/api/steam/unlink", { removeGames: false }); toast("Unlinked.", "ok"); load(); }); } });
        out.replaceChildren(
          d.card ? steamProfileCard(d.card, quickUnlink) : null,
          analyticsPanel(cur, st),
          h("div", { class: "panel" }, h("div", { class: "panel-head" }, h("h3", { text: "Estimated account value" }), valueImageBtn),
            h("div", { class: "grid four" },
              tile("At full price", money(st.value.msrp, cur), "list price today"),
              tile("At today's cheapest", money(st.value.cheapest, cur), "best current deal"),
              st.value.atl ? tile("At all-time lows", money(st.value.atl, cur), "if bought at the lowest ever") : null),
            st.value.achTotal ? h("p", { class: "muted small", text: `Achievements: ${st.value.achDone.toLocaleString()} of ${st.value.achTotal.toLocaleString()} unlocked across ${st.value.achGames} games.` }) : null,
            st.value.top.length ? h("p", { class: "muted small", text: "Most valuable: " + st.value.top.map(r => `${r.title} (${money(r.msrp, cur)})`).join(", ") }) : null,
            h("p", { class: "muted small", text: `${st.value.priced} of ${d.link.games} games priced. An estimate from current prices, not what was paid. Free, removed or unlisted games are not counted.` })),
          recapPanel(),
          h("div", { class: "panel" }, h("h3", { text: "What should I play next?" }),
            h("p", { class: "muted small", text: "A pick from your own library: what you are playing, games you started and never finished, then the most valuable ones you never touched." }), nextBtn),
          nextOut,
          h("div", { class: "grid two" },
            st.unplayedTop.length ? h("div", { class: "panel" }, h("h3", { text: "Biggest unplayed" }), list(st.unplayedTop, r => h("span", { class: "muted", text: r.msrp ? money(r.msrp, cur) : "no price" }))) : null),
          h("p", { class: "muted small", text: "Last synced " + (d.link.synced_at ? new Date(d.link.synced_at).toLocaleString() : "never") + ". Steam does not share what you paid. The FanaticalGrabber extension can fill it in from your Steam purchase history (open store.steampowered.com/account/history and press Send what I paid), or add it on the Library page." }),
          linkedRolesPanel(),
          familyPanel(),
          h("div", { class: "panel" }, h("h3", { text: "Manage" }), h("div", { class: "row" }, sync), h("p"), h("label", { class: "check" }, unlinkGames, " Also remove the games that came from Steam"), h("p"), unlink));
      } catch (e) { out.className = ""; out.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    app.replaceChildren(pageHead("Steam", "Sign in through Steam to fill your library automatically: your games, hours played, what you never played and what to play next."),
      slot, out, twitchLinkPanel());
    if (/[?&]linked=1/.test(LOC.search)) {
      // Just came back from Steam: read the library straight away, then tidy the address.
      replaceUrl("/steam");
      out.className = "muted"; out.textContent = "Reading your Steam library…";
      api("/api/steam/sync", {}).then(r => { state.artForce = true; state.me.steam = { linked: true, verified: true, synced: true }; toast(`Signed in. Found ${r.owned} games` + (r.value && r.value.games ? ` worth ${money(r.value.msrp, r.value.currency)}` : "") + ".", "ok"); })
        .then(() => api("/api/wishlist/import", { profile: "" }).then(w => { if (w.added) { state.me.games += w.added; toast(`Also added ${w.added} game${w.added === 1 ? "" : "s"} from your Steam wishlist. I'll keep it in sync.`, "ok"); } }).catch(() => { /* private wishlist: the Wishlist page explains it */ }))
        .catch(e => toast(e.message, "error")).finally(load);
    } else load();
  }
  root.SteamUI = { view };
})(window);

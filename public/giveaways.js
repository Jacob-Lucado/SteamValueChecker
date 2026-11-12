// The giveaways page: running and reviewing giveaways.
// app.js hands over its helpers (ctx) and calls GiveawaysUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, busy, field, giveawayPreview, h, pageHead, pendingPanel, prizeButtons, roleMulti, select, serverPicker, state, stepsEditor, toast } = ctx;
    const servers = state.me.servers.filter(g => g.manageable);
    const holder = h("div");
    const guild = serverPicker(servers);
    const statusLabel = { active: "Running", scheduled: "Scheduled", ended: "Ended", cancelled: "Canceled" };

    // Entry counts tick up live while a giveaway runs, without touching the form.
    const liveTimer = setInterval(async () => {
      const cells = [...holder.querySelectorAll(".live-entries")];
      if (!cells.length) { if (!document.body.contains(holder)) clearInterval(liveTimer); return; }
      try {
        const list = await api("/api/giveaways?guild=" + encodeURIComponent(guild.value));
        for (const c of cells) { const g = list.giveaways.find(x => String(x.id) === c.dataset.gid); if (g) c.textContent = String(g.entries); }
      } catch { /* try again next time */ }
    }, 15000);
    async function load() {
      holder.replaceChildren(h("p", { class: "muted", text: "Loading…" }));
      try {
        const [list, ch, ro] = await Promise.all([
          api("/api/giveaways?guild=" + encodeURIComponent(guild.value)),
          api("/api/servers/channels?guild=" + encodeURIComponent(guild.value)).catch(() => ({ channels: [] })),
          api("/api/servers/roles?guild=" + encodeURIComponent(guild.value)).catch(() => ({ roles: [] }))
        ]);
        holder.replaceChildren(pendingPanel(list.pending, id => api("/api/giveaways/remind", { guild_id: guild.value, key_id: id }), load), giveawayForm(ch.channels, ro.roles, list.settings, list.stepKinds || []), giveawayTable(list.giveaways, ro.roles), setupPanel(ch.channels, ro.roles, list.settings));
      } catch (e) { holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }

    function giveawayForm(channels, roles, settings, stepKinds) {
      const text = (ph, max, type = "text") => h("input", { type, placeholder: ph, maxlength: String(max) });
      const chSel = select(channels.map(c => [c.id, "#" + c.name]), channels[0] && channels[0].id);
      const roleSel = () => select([["", "None"], ...roles.map(r => [r.id, r.name])], "");
      const vouchSel = select([["", "A channel named #vouches (or the server default)"], ...channels.map(c => [c.id, "#" + c.name])], "");
      const title = text("Title (optional, made from the prizes if blank)", 100), length = text("2h, 3d, 1w, 1d12h", 20), game = text("Game name (optional, taken from the first prize)", 100);
      length.value = "24h";
      const presets = h("div", { class: "chips" }, ["1h", "6h", "24h", "3d", "1w"].map(p => h("button", { type: "button", class: "tab small", text: p, onclick: () => { length.value = p; } })));
      const preview = h("div", { class: "gw-preview muted small", text: "Artwork appears here once you add a prize." });
      let previewTimer = 0, previewKey = "";
      const refreshPreview = () => {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(async () => {
          if (image.value.trim()) { preview.replaceChildren(h("span", { text: "Using your own image." })); return; }
          const first = (keys.value.split("\n").find(l => l.trim()) || "").split("|")[0].trim();
          const q = game.value.trim() || (keys.value.includes("|") ? first : "");
          if (!q || !auto.checked) { preview.replaceChildren(h("span", { text: "Artwork appears here once you add a prize." })); return; }
          if (q === previewKey) return; previewKey = q;
          preview.replaceChildren(h("span", { text: "Looking for artwork…" }));
          try { const r = await api("/api/giveaways/art?game=" + encodeURIComponent(q)); preview.replaceChildren(r.image ? h("img", { src: r.image, alt: q }) : h("span", { text: "No artwork found. Paste an image link under Look and rules." })); gp.paint(); }
          catch { preview.replaceChildren(h("span", { text: "Could not look up artwork." })); }
        }, 500);
      };
      const desc = h("textarea", { placeholder: "Extra text on the giveaway (optional)", maxlength: "1500" });
      const regions = text("Regions allowed, e.g. US, CA, EU (blank = anywhere)", 200), video = window.GwExtras.videoInput();
      const image = text("Your own image, GIF or video link, https (optional)", 500), thumb = text("Your own small picture or GIF link, https (optional)", 500);
      const auto = h("input", { type: "checkbox", checked: true });
      const color = text("#5865F2", 8), label = text("Enter giveaway", 40);
      const claim = text("48", 3, "number"), acct = text("0", 4, "number"), memb = text("0", 4, "number"), bonusN = text("2", 2, "number");
      const reqRole = roleMulti(roles), bonusRole = roleMulti(roles), overRole = roleMulti(roles), pingRole = roleSel();
      const reqAll = select([["any", "Any one of them"], ["all", "All of them"]], "any");
      const steps = stepsEditor(stepKinds);
      const boosters = h("input", { type: "checkbox" }), steamV = h("input", { type: "checkbox" });
      const startIn = text("Start later, e.g. 2h or 1d (blank = now)", 20), rounds = text("1", 2, "number"), repeatEvery = text("e.g. 7d", 20);
      const keys = h("textarea", { placeholder: "Hades | AAAAA-BBBBB-CCCCC\nCeleste | DDDDD-EEEEE-FFFFF\n(a key on its own uses the game name)", maxlength: "20000", autocomplete: "off", spellcheck: "false" });
      for (const el of [keys, game, image]) el.addEventListener("input", refreshPreview);
      const gp = giveawayPreview(() => ({ title: title.value.trim(), desc: desc.value.trim(), keys: keys.value, image: image.value, thumb: thumb.value, color: color.value, label: label.value.trim(), regions: regions.value, hasVideo: Boolean(video.files && video.files.length), length: length.value.trim(), host: "@you", artUrl: preview.querySelector("img")?.src || "" }));
      for (const el of [title, desc, keys, image, thumb, color, label, length, regions]) el.addEventListener("input", gp.paint);
      video.addEventListener("change", gp.paint);
      auto.addEventListener("change", () => { previewKey = ""; refreshPreview(); });
      // Templates keep everything except the prize keys.
      const FIELDS = { title, length, game, desc, image, thumb, auto, color, label, claim, acct, memb, bonusN, reqRole, reqAll, overRole, bonusRole, pingRole, vouchSel, regions, boosters, startIn, rounds, repeatEvery, chSel };
      const grab = () => Object.fromEntries(Object.entries(FIELDS).map(([k, el]) => [k, el.type === "checkbox" ? el.checked : el.value]));
      const apply = data => { for (const [k, el] of Object.entries(FIELDS)) if (data[k] !== undefined) { if (el.type === "checkbox") el.checked = Boolean(data[k]); else el.value = data[k]; } previewKey = ""; refreshPreview(); gp.paint(); };
      let tpls = [];
      const tplSel = select([["", "Load a template…"]], "");
      const tplName = text("Template name", 40);
      const paintTpls = () => { tplSel.replaceChildren(h("option", { value: "", text: "Load a template…" }), ...tpls.map(t => h("option", { value: String(t.id), text: t.name }))); };
      api("/api/giveaways/templates?guild=" + encodeURIComponent(guild.value)).then(r => { tpls = r.templates; paintTpls(); }).catch(() => {});
      tplSel.addEventListener("change", () => { const t = tpls.find(x => String(x.id) === tplSel.value); if (t) { apply(t.data); toast(`Loaded "${t.name}".`, "ok"); } });
      const saveTpl = h("button", { type: "button", class: "btn gray small", text: "Save as template", onclick: () => busy(saveTpl, async () => { const r = await api("/api/giveaways/templates", { guild_id: guild.value, name: tplName.value, data: grab() }); tpls = r.templates; paintTpls(); toast("Template saved. Prize keys are never saved in it.", "ok"); }) });
      const delTpl = h("button", { type: "button", class: "btn red small", text: "Delete", onclick: () => busy(delTpl, async () => { if (!tplSel.value) return; const r = await api("/api/giveaways/templates", { guild_id: guild.value, remove: Number(tplSel.value) }); tpls = r.templates; paintTpls(); }) });
      const create = h("button", { class: "btn green", text: "Start giveaway", onclick: () => busy(create, async () => {
        const num = el => (el.value === "" ? undefined : Number(el.value));
        const vid = await window.GwExtras.videoBody(video);
        const r = await api("/api/giveaways/create", {
          ...vid, guild_id: guild.value, channel_id: chSel.value, title: title.value, length: length.value, game: game.value, description: desc.value,
          image: image.value, thumbnail: thumb.value, auto_image: auto.checked, color: color.value, button_label: label.value,
          claim_hours: num(claim), min_account_days: num(acct), min_member_days: num(memb), bonus_entries: num(bonusN),
          require_role_ids: reqRole.value, require_all: reqAll.value === "all", override_role_ids: overRole.value, bonus_role_ids: bonusRole.value, ping_role_id: pingRole.value, vouch_channel_id: vouchSel.value, regions: regions.value, keys: keys.value,
          boosters: boosters.checked, steam_verified: steamV.checked, start_in: startIn.value, rounds: num(rounds), repeat_every: repeatEvery.value, steps: steps.get()
        });
        keys.value = "";
        toast(r.rounds > 1 ? `Series created: ${r.rounds} rounds scheduled.` : r.scheduled ? `Giveaway #${r.id} is scheduled.` : `Giveaway #${r.id} is live with ${r.prizes} prize${r.prizes === 1 ? "" : "s"}.`, "ok");
        load();
      }) });
      return h("div", { class: "panel" }, h("h3", { text: "Start a giveaway" }),
        h("div", { class: "row" }, field("Template", tplSel), field("Save these settings as", tplName), h("div", { class: "shrink" }, saveTpl, " ", delTpl)),
        field("Prizes (one per line)", keys), prizeButtons(keys, gp.paint),
        h("p", { class: "muted small", text: "Game keys, Discord Nitro links and gift card codes are kept encrypted and handed to the winner by the Claim button. Money and other prizes have no code: the bot tells you who won and you send it yourself." }),
        preview,
        h("div", { class: "row" }, field("Channel", chSel), field("Length", length)), presets,
        field("Title", title),
        h("p", { class: "muted small", text: "Codes are encrypted as soon as they are saved. Each is deleted once the winner confirms, and unused codes are sent back to you by DM. One winner per prize." }),
        h("h4", { text: "Look" }),
        h("div", { class: "grid two" }, h("div", {},
          field("Description", desc),
          h("div", { class: "row" }, field("Big picture, GIF or video link (https)", image), field("Small picture or GIF link (https)", thumb)),
          field("Or upload a video (MP4, WebM or MOV, up to 10 MB). It is posted with the giveaway.", video),
          h("div", { class: "row" }, field("Game (for automatic artwork)", game), field("Enter button text", label), field("Color (#ff9800)", color)),
          h("label", { class: "check" }, auto, "Find artwork automatically when I don't give an image"),
          h("p", { class: "muted small", text: "Use a direct link to a picture (it ends in .png, .jpg, .gif or .webp). Links copied from a Discord message can expire, so host it somewhere permanent like Imgur." })),
          h("div", {}, h("b", { text: "Preview" }), gp.el)),
        h("h4", { text: "Required steps (optional)" }),
        h("p", { class: "muted small", text: "Ask people to do something first, like following you on X or Twitch, joining a Discord or wishlisting a game. Each step shows on the post as a numbered line and a link button. Discord can't check these, so it works on trust and winners may be checked." }),
        steps.el,
        h("details", { class: "more" }, h("summary", { text: "Rules, schedule and more (all optional)" }),
          h("div", { class: "row" }, field("Roles needed to enter (pick as many as you like)", reqRole), field("Entrants need", reqAll)),
          h("div", { class: "row" }, field("Skip every rule with this role (like Booster)", overRole)),
          h("div", { class: "row" }, field("Roles that get extra entries", bonusRole), field("Bonus entries (2-10)", bonusN)),
          h("div", { class: "row" }, field("Ping role", pingRole), field("Hours to claim", claim), field("Vouches channel", vouchSel)),
          h("div", { class: "row" }, field("Min. Discord account age (days)", acct), field("Min. days in this server", memb)),
          h("label", { class: "check" }, boosters, "Only server boosters can enter"),
          field("Regions allowed", regions),
          h("p", { class: "muted small", text: window.GwExtras.regionHelp }),
          h("label", { class: "check" }, steamV, "Only Steam Verified members can enter"),
          h("h4", { text: "Schedule" }),
          h("div", { class: "row" }, field("Start in", startIn), field("Rounds (prizes are split across them)", rounds), field("Repeat every", repeatEvery))),
        h("p"), create);
    }

    // Change who can enter a giveaway that is already running. Blank pickers keep what is set; "Remove all rules" wipes them.
    function rulesEditor(g, roles, into) {
      const req = roleMulti(roles), over = roleMulti(roles), bonus = roleMulti(roles);
      const mode = select([["any", "Any one of them"], ["all", "All of them"]], "any");
      const extra = h("input", { type: "number", min: "2", max: "10", placeholder: "Extra entries (2-10)" });
      const steam = h("input", { type: "checkbox" });
      const rg = h("input", { type: "text", maxlength: "200", placeholder: "Regions allowed, e.g. US, EU (type worldwide to clear)", value: g.regions || "" });
      const save = h("button", { class: "btn blue small", type: "button", text: "Save rules" }), wipe = h("button", { class: "btn red small", type: "button", text: "Remove all rules" });
      const send = (b, extraBody, msg) => busy(b, async () => { await api("/api/giveaways/rules", { guild_id: guild.value, id: g.id, ...extraBody }); toast(msg, "ok"); into.replaceChildren(); });
      save.addEventListener("click", () => send(save, { require_role_ids: req.value, require_all: mode.value === "all", override_role_ids: over.value, bonus_role_ids: bonus.value, bonus_entries: extra.value || undefined, regions: rg.value.trim() ? rg.value : undefined, steam_verified: steam.checked ? true : undefined }, "Rules updated. The giveaway message now shows them."));
      wipe.addEventListener("click", () => send(wipe, { clear: true }, "All rules removed."));
      into.replaceChildren(h("div", { class: "panel" }, h("h4", { text: `Rules for #${g.id} (only what you fill in is added)` }),
        field("Roles needed to enter", req), field("Entrants need", mode), field("Skip every rule with this role", over), field("Roles that get extra entries", bonus), field("Bonus entries", extra), field("Regions allowed", rg), h("p", { class: "muted small", text: window.GwExtras.regionHelp }),
        h("label", { class: "check" }, steam, "Only Steam Verified members can enter"), h("div", { class: "row" }, save, wipe)));
    }

    function giveawayTable(rows, roles = []) {
      const detail = h("div");
      const act = (text, cls, path, bodyExtra, done) => {
        const b = h("button", { class: "btn small " + cls, text });
        b.addEventListener("click", () => busy(b, async () => { const r = await api(path, { guild_id: guild.value, ...bodyExtra }); toast(done(r), "ok"); load(); }));
        return b;
      };
      const body = rows.map(g => {
        const details = h("button", { class: "btn gray small", text: "Details" });
        details.addEventListener("click", () => busy(details, () => showDetails(g, detail)));
        return h("tr", {}, h("td", { text: "#" + g.id }), h("td", {}, g.title, g.regions ? h("span", { class: "muted small", text: "  🌍 " + g.regions.split(",").join(", ") }) : null), h("td", { text: statusLabel[g.status] || g.status }), h("td", { class: "muted small", text: g.outcome || "" }),
          h("td", { class: "num live-entries", "data-gid": String(g.id), text: String(g.entries) }), h("td", { class: "num", text: `${g.redeemed}/${g.prizes}` }),
          h("td", { text: g.status === "active" ? new Date(g.ends_at).toLocaleString() : g.status === "scheduled" ? "Starts " + new Date(g.starts_at).toLocaleString() : "" }),
          h("td", { class: "actions" }, details,
            g.status === "active" && !g.is_global ? (() => { const r = h("button", { class: "btn gray small", type: "button", text: "Rules" }); r.addEventListener("click", () => rulesEditor(g, roles, detail)); return r; })() : null,
            g.status === "active" ? act("End now", "blue", "/api/giveaways/end", { id: g.id }, r => `Ended. ${r.winners} winner${r.winners === 1 ? "" : "s"} drawn.`) : null,
            g.status === "active" || g.status === "scheduled" ? act("Cancel", "red", "/api/giveaways/cancel", { id: g.id }, () => "Cancelled. Unused keys were sent to you by DM.") : null,
            g.status === "ended" ? act("Draw for open prizes", "gray", "/api/giveaways/reroll", { id: g.id }, r => `Drew ${r.winners} new winner${r.winners === 1 ? "" : "s"}.`) : null));
      });
      return h("div", { class: "panel" }, h("h3", { text: "Giveaways" }),
        rows.length ? h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["", "Title", "Status", "Prizes", "Entries", "Redeemed", "Ends", ""].map((c, i) => h("th", { class: i === 4 || i === 5 ? "num" : "", text: c })))), h("tbody", {}, body)))
          : h("div", { class: "empty", text: "No giveaways yet." }), detail);
    }

    async function showDetails(g, into) {
      const d = await api(`/api/giveaways/info?guild=${encodeURIComponent(guild.value)}&id=${g.id}`);
      const names = { assigned: "Waiting to claim", delivered: "Key sent", confirmed: "Redeemed", problem: "Reported a problem", available: "No winner", expired: "Expired", returned: "No winner (sent back to you)" };
      const rows = d.keys.map(k => {
        const key = h("input", { type: "text", placeholder: "New key", maxlength: "200", autocomplete: "off", spellcheck: "false" });
        const rep = h("button", { class: "btn gray small", text: "Replace key" });
        rep.addEventListener("click", () => busy(rep, async () => { await api("/api/giveaways/replace", { guild_id: guild.value, id: g.id, user_id: k.winner_id, key: key.value }); toast("Replaced. The winner was told to claim again.", "ok"); key.value = ""; showDetails(g, into); }));
        const reroll = h("button", { class: "btn red small", text: "Take away and redraw" });
        reroll.addEventListener("click", () => busy(reroll, async () => { await api("/api/giveaways/reroll", { guild_id: guild.value, id: g.id, user_id: k.winner_id }); toast("Drew a new winner.", "ok"); showDetails(g, into); }));
        const canEdit = k.winner_id && g.status !== "active" && !["confirmed", "expired"].includes(k.status);
        return h("tr", {}, h("td", { text: String(k.position) }), h("td", { text: k.label }), h("td", { text: k.winner_id ? "Winner ID " + k.winner_id : "–" }), h("td", { text: names[k.status] || k.status }),
          h("td", { class: "actions" }, canEdit ? [key, rep, reroll] : null));
      });
      into.replaceChildren(h("div", { class: "subpanel" }, h("h4", { text: `#${d.id} ${d.title}: ${d.entries} entries` }),
        h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["#", "Prize", "Winner", "Status", ""].map(c => h("th", { text: c })))), h("tbody", {}, rows))),
        h("p", { class: "muted small", text: "Prize keys are never shown here." })));
    }

    function setupPanel(channels, roles, settings) {
      const vouch = select([["", "A channel named #vouches"], ...channels.map(c => [c.id, "#" + c.name])], settings.vouch_channel_id || "");
      const mgr = select([["", "Only people with Manage Server"], ...roles.map(r => [r.id, r.name])], settings.manager_role_id || "");
      const gwCh = select([["", "The alert channel"], ...channels.map(c => [c.id, "#" + c.name])], settings.giveaway_channel_id || "");
      const save = h("button", { class: "btn gray", text: "Save", onclick: () => busy(save, async () => { await api("/api/giveaways/setup", { guild_id: guild.value, vouch_channel_id: vouch.value, giveaway_channel_id: gwCh.value, manager_role_id: mgr.value }); toast("Saved.", "ok"); }) });
      return h("div", { class: "panel" }, h("h3", { text: "Server settings" }),
        h("div", { class: "row" }, field("Vouches channel (winners' confirmations are posted here)", vouch), field("Role that can run giveaways in Discord", mgr)),
        h("div", { class: "row" }, field("Giveaway channel (network-wide giveaways from the bot owner appear here)", gwCh)), h("p"), save);
    }

    guild.addEventListener("change", load);
    app.replaceChildren(pageHead("Giveaways", "Give away game keys to your server. Winners claim with a button, and confirm when it worked."),
      ...(servers.length > 1 ? [h("div", { class: "panel" }, field("Server", guild))] : []), holder);
    load();
  }
  root.GiveawaysUI = { view };
})(window);

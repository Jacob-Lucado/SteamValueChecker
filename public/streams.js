// The Streams page: going live, the stream card and the giveaway overlay.
// app.js hands over its helpers (ctx) and calls StreamsUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx, opts = {}) {
    const { api, app, busy, currentParam, field, giveawayPreview, h, pageHead, prizeButtons, roleMulti, select, serverPicker, state, stepsEditor, toast } = ctx;
    const servers = state.me.servers.filter(g => g.bot !== false);
    const holder = opts.into ?? h("div");
    if (!opts.into) app.replaceChildren(pageHead("Streams", "Link your channel and the bot posts when you go live, by itself. Choose whether you get pinged when others do, and set up your OBS overlay. In Discord: /server stream."), holder);
    if (!servers.length) { holder.replaceChildren(h("div", { class: "notice warn", text: "The bot is not in any of your servers yet. Add it from the Servers page." })); return; }
    const guild = opts.guild ?? serverPicker(servers, currentParam());
    guild.addEventListener("change", () => { load(); });
    /** The giveaway tool for streamers: the same options as a server giveaway, plus drawing when the stream ends. */
    function streamGiveawayPanel(d, unset, post, run) {
      const text = (ph, max, type = "text") => h("input", { type, placeholder: ph, maxlength: String(max) });
      const keys = h("textarea", { placeholder: "Hades | AAAAA-BBBBB-CCCCC\nCeleste | DDDDD-EEEEE-FFFFF\n(a key on its own uses the game name)", maxlength: "20000", autocomplete: "off", spellcheck: "false" });
      const game = text("Game name (for the artwork, optional)", 100), title = text("Title (optional)", 100), desc = h("textarea", { placeholder: "Extra text on the giveaway (optional)", maxlength: "1500" });
      const length = text("30m, 1h, 2h", 20); length.value = "1h";
      const presets = h("div", { class: "chips" }, ["30m", "1h", "2h", "3h", "6h"].map(p => h("button", { type: "button", class: "tab small", text: p, onclick: () => { length.value = p; } })));
      const endWith = h("input", { type: "checkbox", id: "sgw-end", checked: true });
      const image = text("Your own image, GIF or video link, https (optional)", 500), thumb = text("Your own small picture or GIF link, https (optional)", 500);
      const auto = h("input", { type: "checkbox", checked: true }), color = text("#9146ff", 8), label = text("Enter giveaway", 40);
      const claim = text("24", 3, "number"), acct = text("0", 4, "number"), memb = text("0", 4, "number"), bonusN = text("2", 2, "number");
      const boosters = h("input", { type: "checkbox" }), steamV = h("input", { type: "checkbox" });
      const roles = d.roles || null, roleSel = () => select([["", "None"], ...(roles || []).map(r => [r.id, r.name])], "");
      const reqRole = roleMulti(roles || []), bonusRole = roleMulti(roles || []), overRole = roleMulti(roles || []), pingRole = roleSel();
      const reqAll = select([["any", "Any one of them"], ["all", "All of them"]], "any");
      const tw = (d.links || []).find(l => l.platform === "twitch"), yt = (d.links || []).find(l => l.platform === "youtube");
      const prefill = tw ? [{ kind: "follow_twitch", url: tw.url }] : yt ? [{ kind: "youtube", url: yt.url }] : [];
      const steps = stepsEditor(d.stepKinds || [], { prefill });
      const gp = giveawayPreview(() => ({ title: title.value.trim(), desc: desc.value.trim(), keys: keys.value, image: image.value, thumb: thumb.value, color: color.value, label: label.value.trim(), length: length.value.trim(), host: "you" }));
      for (const el of [title, desc, keys, image, thumb, color, label, length]) el.addEventListener("input", gp.paint);
      const isTwitch = Boolean(tw);
      const chatOn = h("input", { type: "checkbox", id: "sgw-chat", disabled: !isTwitch }), chatInvite = text("https://discord.gg/yourserver", 120, "url");
      const go = h("button", { class: "btn blue", type: "button", text: "🎁 Start the giveaway", disabled: unset });
      go.addEventListener("click", () => run(go, async () => {
        const num = el => (el.value === "" ? undefined : Number(el.value));
        const r = await post("/api/streams/giveaway", {
          keys: keys.value, game: game.value, title: title.value, description: desc.value, length: length.value, end_with_stream: endWith.checked,
          image: image.value, thumbnail: thumb.value, auto_image: auto.checked, color: color.value, button_label: label.value,
          claim_hours: num(claim), min_account_days: num(acct), min_member_days: num(memb), bonus_entries: num(bonusN), boosters: boosters.checked, steam_verified: steamV.checked,
          require_role_ids: reqRole.value, require_all: reqAll.value === "all", override_role_ids: overRole.value, bonus_role_ids: bonusRole.value, ping_role_id: pingRole.value, steps: steps.get(), chat_enter: chatOn.checked, chat_invite: chatInvite.value
        });
        keys.value = "";
        toast(`Giveaway posted in the live channel with ${r.prizes} prize${r.prizes === 1 ? "" : "s"}.${r.endsWithStream ? " It draws when you end your stream." : ""}${r.chat ? (r.chatReplies ? " Viewers can type !enter in your chat." : " Linked viewers can type !enter in your chat (the bot can't answer in chat until a Twitch bot login is set).") : ""}`, "ok");
      }));
      return h("div", { class: "panel" }, h("h3", { text: "Giveaway for your viewers" }),
        unset ? h("div", { class: "notice warn", text: "No live channel is set yet." + (d.can.manage ? " Pick one in the settings below." : " Ask a manager.") }) : null,
        h("p", { class: "muted small", text: "Give away one or more prizes while you are live. It is posted in the live channel and draws winners when you end your stream, or when the time is up. Winners get their prize from the bot by message. You must be marked live first." }),
        field("Prizes (one per line)", keys), prizeButtons(keys, gp.paint),
        h("p", { class: "muted small", text: "Keys, Discord Nitro links and gift card codes are kept encrypted and handed to the winner by a Claim button. Money and other prizes have no code: the bot tells you who won and you send it yourself." }),
        h("div", { class: "row" }, field("Runs for at most", length), field("Title", title)), presets,
        h("label", { class: "check", for: "sgw-end" }, endWith, " Draw the winners as soon as I end my stream"),
        h("h4", { text: "Look" }),
        h("div", { class: "grid two" }, h("div", {},
          field("Description", desc),
          h("div", { class: "row" }, field("Big picture, GIF or video link (https)", image), field("Small picture or GIF link (https)", thumb)),
          h("div", { class: "row" }, field("Game (for automatic artwork)", game), field("Enter button text", label), field("Color (#9146ff)", color)),
          h("label", { class: "check" }, auto, " Find artwork automatically when I don't give an image")),
          h("div", {}, h("b", { text: "Preview" }), gp.el)),
        h("h4", { text: "Required steps (optional)" }),
        h("p", { class: "muted small", text: "Ask viewers to do something first, like following your channel, joining your Discord or wishlisting your game. Each step shows on the post as a numbered line and a link button. Discord can't check these, so it works on trust and winners may be checked." }),
        steps.el,
        h("h4", { text: "Enter from Twitch chat" }),
        h("label", { class: "check", for: "sgw-chat" }, chatOn, " Let viewers type !enter in my Twitch chat"),
        isTwitch ? h("div", {}, field("Your Discord invite (the bot tells new viewers to join it)", chatInvite),
          h("p", { class: "muted small", text: "Viewers link their Twitch to the bot once on the Steam page (it reads the Twitch account shown in their Discord connections, so it can't be faked), then !enter works like the Enter button. Anyone who isn't linked gets a reply in chat pointing them to your Discord invite and the link page." + (d.chatReplies ? "" : " The bot can't write in chat yet (no Twitch bot login is set on the bot), so it only counts linked viewers.") }))
          : h("p", { class: "muted small", text: "Link your Twitch channel in the Your channel box above first, so I know which chat to listen to." }),
        h("details", { class: "more" }, h("summary", { text: "Rules (all optional)" }),
          h("div", { class: "row" }, field("Min. Discord account age (days)", acct), field("Min. days in this server", memb), field("Hours to claim", claim)),
          h("label", { class: "check" }, boosters, " Only server boosters can enter"),
          h("label", { class: "check" }, steamV, " Only Steam Verified members can enter"),
          roles ? h("div", {}, h("div", { class: "row" }, field("Roles needed to enter (pick as many as you like)", reqRole), field("Entrants need", reqAll)), h("div", { class: "row" }, field("Skip every rule with this role (like Booster)", overRole)), h("div", { class: "row" }, field("Roles that get extra entries", bonusRole), field("Bonus entries (2-10)", bonusN), field("Ping role", pingRole))) : h("p", { class: "muted small", text: "Role rules and pings are set by a server manager." })),
        h("p"), h("div", { class: "row" }, go));
    }
    async function load() {
      holder.replaceChildren(h("p", { class: "muted", text: "Loading…" }));
      let d;
      try { d = await api("/api/streams?guild=" + encodeURIComponent(guild.value)); } catch (e) { return holder.replaceChildren(servers.length > 1 && !opts.guild ? h("div", { class: "panel" }, field("Server", guild)) : null, h("div", { class: "notice warn", text: e.message })); }
      const gid = guild.value, post = (path, body) => api(path, { guild_id: gid, ...body });
      const run = (btn, fn, msg) => busy(btn, async () => { await fn(); if (msg) toast(msg, "ok"); load(); });
      const picker = servers.length > 1 && !opts.guild ? h("div", { class: "panel" }, field("Server", guild)) : null;
      const unset = !d.settings.live_channel;

      const liveList = h("div", { class: "panel" }, h("h3", { text: "Live now" }),
        d.live.length ? h("ul", { class: "plain" }, d.live.map(r => {
          const end = (d.can.manage || r.mine) ? h("button", { class: "btn gray small", text: "End", onclick: e => run(e.currentTarget, () => post("/api/streams/end", { user_id: r.userId }), "Marked as ended.") }) : null;
          return h("li", {}, "🔴 ", h("a", { href: r.url, target: "_blank", rel: "noopener noreferrer", text: r.title }), r.game ? " · " + r.game : "", " ", end);
        })) : h("p", { class: "muted", text: "Nobody is streaming right now." }));

      let pingPanel;
      if (!d.settings.ping_stream) pingPanel = h("div", { class: "panel" }, h("h3", { text: "Go-live pings" }), h("p", { class: "muted", text: "Pings aren't set up in this server yet." + (d.can.manage ? " Pick a ping role below." : " Ask a manager to set one up.") }));
      else {
        const on = d.optedIn === true, b = h("button", { class: "btn small " + (on ? "gray" : "blue"), text: on ? "Stop pinging me" : "Ping me when someone goes live" });
        b.addEventListener("click", () => run(b, () => post("/api/streams/ping", { on: !on }), on ? "No more stream pings." : "You'll get pinged when someone goes live."));
        pingPanel = h("div", { class: "panel" }, h("h3", { text: "Go-live pings" }), h("p", { class: "muted small", text: d.optedIn === null ? "I can't tell if you have the ping role right now, but the button still works." : on ? "You're opted in. You'll be pinged in the live channel whenever someone goes live." : "Get pinged in the live channel whenever someone in this server goes live." }), h("div", { class: "row" }, b));
      }

      let linkPanel = null;
      if (d.can.go) {
        const NAMES = { twitch: "Twitch", kick: "Kick", youtube: "YouTube" };
        const links = d.links || [];
        const url = h("input", { type: "url", placeholder: "https://twitch.tv/yourname", maxlength: "200", "aria-label": "Add a channel link" });
        const save = h("button", { class: "btn blue", type: "button", text: links.length ? "Add this channel" : "Link my channel", disabled: unset });
        save.addEventListener("click", () => run(save, () => post("/api/streams/link", { channel: url.value }), "Linked. I'll post when you go live."));
        const rows = links.map(l => {
          const gone = h("button", { class: "btn gray small", type: "button", text: "Remove", "aria-label": "Remove " + NAMES[l.platform] });
          gone.addEventListener("click", () => run(gone, () => post("/api/streams/unlink", { platform: l.platform }), "Removed " + NAMES[l.platform] + "."));
          return h("div", { class: "row stream-link-row" }, h("strong", { text: NAMES[l.platform] }), h("a", { href: l.url.replace(/\/live$/, ""), target: "_blank", rel: "noopener", text: l.handle }),
            h("span", { class: "muted small", text: d.watch[l.platform] ? "checked every couple of minutes" : "can't be checked on this bot yet" }), gone);
        });
        const note = links.length
          ? (links.length > 1 ? "I watch all of these. If you're live on more than one, there's a single post that links to each." : "I check every couple of minutes. When you go live I post in the live channel and ping the people who opted in, and I close the post when you finish.") + " You can link one channel on each site."
          : "Link your Twitch, Kick and YouTube channels and I'll notice when you go live on any of them, so you never have to post it yourself.";
        linkPanel = h("div", { class: "panel" }, h("h3", { text: links.length > 1 ? "Your channels" : "Your channel" }), unset ? h("div", { class: "notice warn", text: "No live channel is set yet." + (d.can.manage ? " Pick one in the settings below." : " Ask a manager.") }) : null,
          h("p", { class: "muted small", text: note }), ...rows, field(links.length ? "Add another channel (Twitch, Kick or YouTube)" : "Channel link (Twitch, Kick or YouTube)", url), h("div", { class: "row" }, save));
      }

      let goPanel;
      if (d.can.go) {
        const url = h("input", { type: "url", placeholder: "https://twitch.tv/yourname", maxlength: "300" }), title = h("input", { type: "text", placeholder: "What are you streaming?", maxlength: "120" }), game = h("input", { type: "text", placeholder: "Game (optional)", maxlength: "60" });
        const go = h("button", { class: "btn blue", text: "🔴 Go live", disabled: unset });
        go.addEventListener("click", () => run(go, async () => { const r = await post("/api/streams/live", { url: url.value, title: title.value, game: game.value }); toast(r.edited ? "Updated your post." : r.pinged ? "You're live! Everyone who opted in was pinged." : "You're live!", "ok"); }));
        goPanel = h("div", { class: "panel" }, h("h3", { text: linkPanel ? "Go live by hand" : "Go live" }), unset ? h("div", { class: "notice warn", text: "No live channel is set yet." + (d.can.manage ? " Pick one in the settings below." : " Ask a manager.") }) : null,
          h("div", { class: "grid two" }, field("Stream link", url), field("Title", title)), field("Game", game), h("div", { class: "row" }, go),
          h("p", { class: "muted small", text: "Posts in the live channel. If you went live in the last half hour, it updates your post instead of pinging again." }));
      } else goPanel = h("div", { class: "panel" }, h("h3", { text: "Go live" }), h("p", { class: "muted", text: d.settings.streamer_role_id ? "Only people with the streamer role, moderators and managers can announce streams here. Ask a manager for the role." : "This server hasn't picked a streamer role yet." }));

      let settings = null;
      if (d.can.manage) {
        const roles = [["", "Not set"], ...(d.roles ?? []).map(r => [r.id, r.name])], chans = [["", "Not set"], ...(d.channels ?? []).map(c => [c.id, "#" + c.name])];
        const sr = select(roles, d.settings.streamer_role_id || ""), lc = select(chans, d.settings.live_channel || ""), pr = select(roles, d.settings.ping_stream || "");
        const sv = h("button", { class: "btn blue small", text: "Save settings" });
        const autoBox = h("input", { type: "checkbox", id: "stream-auto" }); autoBox.checked = d.settings.auto !== false;
        sv.addEventListener("click", () => run(sv, () => post("/api/streams/settings", { streamer_role_id: sr.value, live_channel: lc.value, ping_stream: pr.value, auto: autoBox.checked }), "Saved."));
        settings = h("div", { class: "panel" }, h("h3", { text: "Settings (managers)" }), h("div", { class: "grid two" }, field("Streamer role", sr), field("Live channel", lc)), field("Ping role (members opt in to it)", pr), h("label", { class: "check", for: "stream-auto" }, autoBox, " Post by itself when linked streamers go live"), h("div", { class: "row" }, sv),
          h("p", { class: "muted small", text: "The streamer role, moderators and managers can announce streams, and see the OBS overlay in the music player. Community setup makes all three for you." }));
      }
      let gwPanel = null;
      if (d.can.go) {
        gwPanel = streamGiveawayPanel(d, unset, post, run);
      }
      holder.replaceChildren(...[picker, liveList, linkPanel, goPanel, gwPanel, pingPanel, settings].filter(Boolean));
      if (d.can.go) holder.append(h("div", { class: "notice" }, "Your OBS overlays (now playing, giveaway, deals and cards) live in the ", h("a", { href: "#/overlays", text: "Overlay studio" }), " now."));
    }
    load();
  }
  root.StreamsUI = { view };
})(window);

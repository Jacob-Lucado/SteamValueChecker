// The Community page: a server's emoji, polls, roles and welcome setup.
// app.js hands over its helpers (ctx) and calls CommunityUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { PLAYTEST_SOURCES, api, app, busy, currentParam, field, h, pageHead, progressBar, select, serverPicker, state, toast } = ctx;
    const servers = state.me.servers.filter(g => g.bot !== false);
    const holder = h("div");
    app.replaceChildren(pageHead("Community", "Welcome messages, levels, invites and emoji for your gaming server. In Discord: /manage community, /server rank, /server levels, /server invites and /manage emoji."), holder);
    if (!servers.length) { holder.replaceChildren(h("div", { class: "notice warn", text: "The bot is not in any of your servers yet. Add it from the Servers page." })); return; }
    const guild = serverPicker(servers, currentParam());
    const GID = () => guild.value;
    const post = (path, body) => api(path, { guild_id: GID(), ...body });
    async function load() {
      holder.replaceChildren(h("p", { class: "muted", text: "Loading…" }));
      try {
        const d = await api("/api/community?guild=" + encodeURIComponent(GID()));
        const picker = servers.length > 1 ? h("div", { class: "panel" }, field("Server", guild)) : null;
        const intent = d.membersIntent ? null : h("div", { class: "notice warn", text: "Welcome messages and invite tracking are paused: turn on Server Members Intent for the bot in the Discord Developer Portal (Bot, Privileged Gateway Intents)." });
        const nameOr = r => r.name || "Member";
        const me = d.me;
        const inv = me.invites;
        const linkBtn = h("button", { class: "btn blue", text: inv.link ? "Copy my invite link" : "Get my invite link" });
        linkBtn.addEventListener("click", () => busy(linkBtn, async () => {
          const r = inv.link ? { link: inv.link } : await post("/api/community/invite-link", {});
          try { await navigator.clipboard.writeText(r.link); toast("Link copied: " + r.link, "ok"); } catch { toast(r.link, "ok"); }
          inv.link = r.link; linkBtn.textContent = "Copy my invite link";
        }));
        const standing = h("div", { class: "panel" }, h("h3", { text: "Your standing" }),
          h("div", { class: "grid four" },
            h("div", { class: "tile" }, h("div", { class: "k", text: "Level" }), h("div", { class: "v", text: String(me.level) }), h("div", { class: "s", text: me.rank ? `#${me.rank} of ${me.members}` : "not ranked yet" })),
            h("div", { class: "tile" }, h("div", { class: "k", text: "XP" }), h("div", { class: "v", text: me.xp.toLocaleString() }), h("div", { class: "s", text: `${me.messages.toLocaleString()} messages` })),
            h("div", { class: "tile" }, h("div", { class: "k", text: "Invited" }), h("div", { class: "v", text: String(inv.active) }), h("div", { class: "s", text: `${inv.total} joined, ${inv.left} left` })),
            h("div", { class: "tile" }, h("div", { class: "k", text: "Voice" }), h("div", { class: "v", text: me.voiceMinutes + " min" }), h("div", { class: "s", text: "time in voice with others" }))),
          h("p", { class: "muted small", text: `${me.into.toLocaleString()} of ${me.need.toLocaleString()} XP to level ${me.level + 1}` }), progressBar(me.into / me.need),
          h("div", { class: "row" }, linkBtn), h("p", { class: "muted small", text: "Everyone who joins with your link counts for you. Chat and talk in voice to earn XP." }));
        const board = (title, rows, line) => h("div", { class: "panel" }, h("h3", { text: title }),
          rows.length ? h("ol", { class: "plain" }, rows.map((r, n) => h("li", {}, h("b", { text: `${n + 1}. ${nameOr(r)}` }), " ", h("span", { class: "muted", text: line(r) })))) : h("p", { class: "muted", text: "Nobody yet." }));
        const rewards = d.rewards.length ? h("p", { class: "muted small", text: "Invite rewards: " + d.rewards.map(r => `${r.count} invited`).join(", ") }) : null;
        const vBtn = h("button", { class: "btn steam", text: "Verify me with Steam" });
        vBtn.addEventListener("click", () => busy(vBtn, async () => { try { await post("/api/community/verify", {}); toast("You are verified ✅", "ok"); load(); } catch (e) { toast(e.message, "warn"); if (!d.verify.steamVerified) location.href = "/auth/linked"; } }));
        const verifyPanel = d.verify.available ? h("div", { class: "panel" }, h("h3", { text: "Steam Verified" }),
          h("p", { class: "muted", text: d.verify.steamVerified ? "Your Steam account is verified. Press the button to get the role in this server." : "Prove your Steam account to get the Steam Verified role. You sign in on Steam's own page." }),
          h("div", { class: "row" }, vBtn, h("a", { class: "btn gray", href: "/auth/linked", text: "Connect Linked Roles" }))) : null;
        const boards = h("div", { class: "grid two" }, board("Top inviters", d.inviteTop, r => `${r.active} here · ${r.total} joined`), h("div", { class: "panel" }, h("h3", { text: "Levels and XP" }), h("p", { class: "muted", text: `You are level ${me.level}${me.rank ? `, #${me.rank} in the server` : ""}.` }), h("a", { class: "btn blue", href: "#/xp/" + GID(), text: "Open the Server XP page" })));
        holder.replaceChildren(...[picker, intent, standing, verifyPanel, boards, rewards, d.manager && d.growth ? growthPanel(d.growth) : null, d.manager ? manager(d) : null].filter(Boolean));
      } catch (e) { holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    // Joins and leaves for the last 30 days, people only. Only members the bot saw join are counted, so it fills in from when the bot arrived.
    function growthPanel(g) {
      const peak = Math.max(1, ...g.days.map(d => Math.max(d.joins, d.leaves)));
      const tile = (k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: v }), sub && h("div", { class: "s", text: sub }));
      const bars = h("div", { class: "grow-bars", role: "img", "aria-label": "People joining and leaving per day, last 30 days" }, g.days.map((d, n) => {
        const j = h("i", { class: "j" }), l = h("i", { class: "l" });
        j.style.height = Math.round(d.joins / peak * 100) + "%"; l.style.height = Math.round(d.leaves / peak * 100) + "%";
        return h("div", { class: "grow-col", title: `${new Date(d.day + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}: ${d.joins} joined, ${d.leaves} left` }, h("div", { class: "pair" }, j, l), n % 7 === 0 ? h("span", { text: d.day.slice(5) }) : h("span", { text: "" }));
      }));
      return h("div", { class: "panel" }, h("h3", { text: "Member growth, last 30 days" }),
        h("div", { class: "grid four" }, tile("Joined", String(g.joins)), tile("Left", String(g.leaves)), tile("Net", (g.net > 0 ? "+" : "") + g.net, g.net >= 0 ? "growing" : "shrinking"), tile("Tracked here now", String(g.trackedHere), `of ${g.trackedEver} the bot has seen join`)),
        g.trackedEver ? bars : h("p", { class: "muted", text: "Nothing yet. The bot records people as they join, so this fills in from now on." }),
        h("p", { class: "muted small", text: "People only: bots are never counted. Green is joining, gray is leaving." }));
    }
    let mgrTab = 0;
    /** The announcement designer: every part of the embed is editable, with a live preview that looks like Discord. */
    function announceDesigner({ chSel, roSel, defaultCh, history, roleName, chName }) {
      const inp = (ph, max = 256, type = "text") => h("input", { type, maxlength: String(max), placeholder: ph, "aria-label": ph });
      const ch = chSel(defaultCh), title = inp("Title", 256), body = h("textarea", { rows: "6", maxlength: "4000", placeholder: "Message (Discord formatting works: **bold**, *italic*, > quote)", "aria-label": "Message" });
      const color = h("input", { type: "color", value: "#4d8cff", "aria-label": "Color" });
      const author = inp("Small text above the title (optional)", 100), footer = inp("Footer text (optional)", 200), image = inp("Big image link, https (optional)", 500, "url");
      const thumbKind = select([["", "No small image"], ["server", "This server's icon"], ["url", "A link"]], ""), thumb = inp("Small image link, https", 500, "url");
      const linkUrl = inp("Make the title a link (optional)", 500, "url"), bLabel = inp("Button text (optional)", 40), bUrl = inp("Button link, https", 500, "url");
      const stamp = h("input", { type: "checkbox" }), ping = select([["none", "Nobody"], ["everyone", "@everyone"], ["here", "@here"], ["role", "A role"]], "none"), pingRole = roSel("", "Choose a role");
      pingRole.hidden = true;
      const fieldRows = [], fieldBox = h("div"), addField = h("button", { class: "btn gray small", type: "button", text: "Add a field" });
      const addRow = () => {
        if (fieldRows.length >= 5) return;
        const n = inp("Field title", 100), v = inp("Field text", 500), inl = h("input", { type: "checkbox" });
        const row = { n, v, inl }; fieldRows.push(row);
        const rm = h("button", { class: "btn gray small", type: "button", text: "Remove" });
        const el = h("div", { class: "row" }, n, v, h("label", { class: "muted small" }, inl, " side by side"), rm);
        rm.addEventListener("click", () => { fieldRows.splice(fieldRows.indexOf(row), 1); el.remove(); paint(); });
        fieldBox.append(el); [n, v, inl].forEach(x => x.addEventListener("input", paint)); paint();
      };
      addField.addEventListener("click", addRow);
      const pv = h("div", { class: "dpreview" });
      function paint() {
        const parts = [];
        if (author.value.trim()) parts.push(h("div", { class: "dp-author", text: author.value.trim() }));
        if (title.value.trim()) parts.push(h("div", { class: "dp-title", text: title.value.trim() }));
        if (body.value.trim()) parts.push(h("div", { class: "dp-body", text: body.value.trim() }));
        const fl = fieldRows.filter(r => r.n.value.trim() && r.v.value.trim());
        if (fl.length) parts.push(h("div", { class: "dp-fields" }, fl.map(r => h("div", { class: "dp-field" + (r.inl.checked ? " inline" : "") }, h("b", { text: r.n.value.trim() }), h("div", { text: r.v.value.trim() })))));
        if (/^https:\/\//.test(image.value.trim())) parts.push(h("img", { class: "dp-image", src: image.value.trim(), alt: "", referrerpolicy: "no-referrer" }));
        if (bLabel.value.trim()) parts.push(h("div", { class: "dp-btn", text: bLabel.value.trim() + " ↗" }));
        if (footer.value.trim() || stamp.checked) parts.push(h("div", { class: "dp-foot muted small", text: [footer.value.trim(), stamp.checked ? "Today" : ""].filter(Boolean).join(" · ") }));
        const pre = ping.value === "everyone" ? "@everyone" : ping.value === "here" ? "@here" : ping.value === "role" && pingRole.value ? "@" + roleName(pingRole.value) : "";
        pv.replaceChildren(...(pre ? [h("div", { class: "dp-ping", text: pre })] : []), h("div", { class: "dp-card" }, ...(parts.length ? parts : [h("div", { class: "muted", text: "Your announcement shows here." })])));
        pv.firstElementChild && pv.lastElementChild.style.setProperty("border-left-color", color.value);
      }
      ping.addEventListener("change", () => { pingRole.hidden = ping.value !== "role"; sendBtn.textContent = "Post announcement"; armed = false; paint(); });
      [title, body, color, author, footer, image, thumb, linkUrl, bLabel, bUrl, stamp, pingRole].forEach(x => x.addEventListener("input", paint));
      thumbKind.addEventListener("change", () => { thumb.hidden = thumbKind.value !== "url"; }); thumb.hidden = true;
      const sendBtn = h("button", { class: "btn green", type: "button", text: "Post announcement" });
      let armed = false;
      const hist = h("div");
      const paintHist = rows => hist.replaceChildren(rows.length ? h("ul", { class: "plain" }, rows.map(r => h("li", {}, h("b", { text: r.title || "Announcement" }), h("span", { class: "muted small", text: ` · ${new Date(r.at).toLocaleString()} · #${chName(r.channel_id) || "channel"}` })))) : h("p", { class: "muted small", text: "Nothing posted yet." }));
      paintHist(history || []);
      sendBtn.addEventListener("click", () => busy(sendBtn, async () => {
        if ((ping.value === "everyone" || ping.value === "here") && !armed) { armed = true; sendBtn.textContent = "Click again to ping " + (ping.value === "here" ? "@here" : "@everyone"); return; }
        armed = false; sendBtn.textContent = "Post announcement";
        const r = await api("/api/community/announce", { guild_id: GID(), channel_id: ch.value, title: title.value, body: body.value, color: color.value, author: author.value, footer: footer.value, image: image.value, thumbnail: thumbKind.value === "server" ? "server" : thumbKind.value === "url" ? thumb.value : "",
          link_url: linkUrl.value, button_label: bLabel.value, button_url: bUrl.value, timestamp: stamp.checked, ping: ping.value, role_id: pingRole.value, fields: fieldRows.map(x => ({ name: x.n.value, value: x.v.value, inline: x.inl.checked })) });
        paintHist(r.history); toast("Announcement posted.", "ok");
      }));
      paint();
      return h("div", { class: "panel" }, h("h3", { text: "Announcements" }),
        h("p", { class: "muted", text: "Design a message and post it as an embed. Needs the bot to have Send Messages and Embed Links in the channel (and Mention Everyone to ping @everyone)." }),
        h("div", { class: "grid two" }, h("div", {}, field("Post in", ch), field("Title", title), field("Message", body), h("div", { class: "row" }, field("Color", color), field("Ping", ping), pingRole),
          field("Small text above the title", author), field("Footer", footer), h("label", { class: "muted small" }, stamp, " Show the time"), field("Big image", image), field("Small image", thumbKind), thumb, field("Title link", linkUrl),
          h("div", { class: "row" }, field("Button text", bLabel), field("Button link", bUrl)), h("h4", { text: "Fields" }), fieldBox, addField),
          h("div", {}, h("h4", { text: "Preview" }), pv, h("div", { class: "row" }, sendBtn), h("h4", { text: "Recently posted" }), hist)));
    }
    function manager(d) {
      const st = d.settings;
      const box = h("div");
      (async () => {
        const [ch, ro, fo] = await Promise.all([api("/api/servers/channels?guild=" + encodeURIComponent(GID())).catch(() => ({ channels: [] })), api("/api/servers/roles?guild=" + encodeURIComponent(GID())).catch(() => ({ roles: [] })), api("/api/servers/forums?guild=" + encodeURIComponent(GID())).catch(() => ({ forums: [] }))]);
        const forumSel = cur => select([["", "Not set"], ...fo.forums.map(c => [c.id, "#" + c.name])], cur || "");
        const chSel = cur => select([["", "Not set"], ...ch.channels.map(c => [c.id, "#" + c.name])], cur || "");
        const roSel = (cur, none = "No role") => select([["", none], ...ro.roles.map(r => [r.id, r.name])], cur || "");
        const roleName = id => (ro.roles.find(r => r.id === id) || {}).name || "a role";
        const save = (label, fn, cls = "btn blue small") => { const b = h("button", { class: cls, text: label }); b.addEventListener("click", () => busy(b, async () => { await fn(); toast("Saved.", "ok"); load(); })); return b; };
        const toggle = (on, path, key, labelOn, labelOff) => { const b = h("button", { class: "btn small " + (on ? "red" : "green"), text: on ? labelOn : labelOff }); b.addEventListener("click", () => busy(b, async () => { await post(path, { [key]: !on }); load(); })); return b; };
        // build
        const build = h("div", { class: "panel" }, h("h3", { text: "Build my server" }),
          h("p", { class: "muted", text: "Creates the usual gaming-server layout: Information (welcome, rules, announcements, roles), Community (general, introductions, memes, clips, off-topic, bot-commands), Gaming (looking-for-group, game-chat, game-night, wishlists), Deals and Giveaways, Support (get-help tickets and report-a-bug), Music (a #music-commands channel with an intro of every music command, plus two Music voice channels), Voice lobbies and a private Staff area. Also creates Moderator, Member and level roles and a role picker, posts the rules (with the bot logo), the support buttons and the welcome, and connects deal alerts, giveaways, music, support tickets, welcome and XP. Safe to run again: a server that is already built only gets the channels that are new, and nothing you renamed, moved, deleted or changed is touched. A brand-new server is built automatically when the bot joins." }),
          (() => { const b = h("button", { class: "btn green", text: d.built ? "Run setup again (adds only what's new)" : "Set up this server" }); b.addEventListener("click", () => busy(b, async () => { const r = await post("/api/community/setup", {}); toast(r.updated ? `Updated: ${r.created.channels.length} new channel${r.created.channels.length === 1 ? "" : "s"} added, nothing else changed.` : `Done: ${r.created.channels.length} channels, ${r.created.roles.length} roles created.`, "ok"); load(); })); return b; })());
        // welcome
        const wCh = chSel(st.welcome_channel), logCh = chSel(st.log_channel), wMsg = h("textarea", { rows: "3", maxlength: "1000", placeholder: st.defaultWelcome }); wMsg.value = st.welcome_msg || "";
        const auto = roSel(st.autorole_id, "No automatic role");
        const welcome = h("div", { class: "panel" }, h("h3", { text: "Welcome new members" }),
          h("div", { class: "row" }, toggle(st.welcome_on, "/api/community/welcome", "enabled", "Turn off", "Turn on"), toggle(st.welcome_dm, "/api/community/welcome", "dm", "Stop private welcome", "Also send a private welcome"), toggle(st.welcome_card !== 0, "/api/community/welcome", "card", "Stop the picture card", "Show a picture card"), toggle(st.leave_on, "/api/community/welcome", "leave", "Stop leave notes", "Post a note when someone leaves")),
          field("Welcome channel", wCh), field("Log channel (joins, who invited them)", logCh), field("Message", wMsg),
          h("p", { class: "muted small", text: "Use " + st.fields.join(" ") + ". Leave empty for the default message." }),
          (() => {
            const shot = h("img", { class: "welcome-prev", alt: "Preview of the welcome picture card", hidden: true });
            const b = h("button", { type: "button", class: "btn gray", text: "Preview the picture card" });
            b.addEventListener("click", () => busy(b, async () => { const r = await post("/api/community/welcome/preview", {}); shot.src = r.image; shot.hidden = false; }));
            return h("div", {}, h("div", { class: "row" }, save("Save welcome", () => post("/api/community/welcome", { channel_id: wCh.value, log_channel_id: logCh.value, message: wMsg.value })), b), shot);
          })(),
          field("Role every new member gets", auto), h("div", { class: "row" }, save("Save role", () => post("/api/community/autorole", { role_id: auto.value }))));
        const vRole = roSel(st.verified_role_id, "No Steam Verified role");
        const verify = h("div", { class: "panel" }, h("h3", { text: "Steam verification" }),
          h("p", { class: "muted", text: "Members prove their Steam account (they sign in on Steam's own page) and get this role from the button in #verify or /me steam verify. Members who already verified get it the moment they join." }),
          field("Steam Verified role", vRole), h("div", { class: "row" }, save("Save", () => post("/api/community/verifyrole", { role_id: vRole.value }))),
          h("p", { class: "muted small", text: "Want Discord itself to require it? In Discord open Server Settings, Roles, pick the role, open Links, and add this bot's Steam Verified condition. That one step can only be done in Discord." }));
        // ping roles
        const pDeals = roSel(st.ping_deals, "Nobody"), pFree = roSel(st.ping_free, "Nobody"), pGw = roSel(st.ping_giveaway, "Nobody"), pLfg = roSel(st.ping_lfg, "Nobody"), pPlay = roSel(st.ping_playtest, "Nobody"), pPlayAll = h("input", { type: "checkbox", checked: Boolean(st.playtest_all) }), pPlayCh = chSel(st.playtest_channel), pSquad = roSel(st.ping_squad, "Nobody"), pSquadCh = chSel(st.squad_channel), pIndie = roSel(st.ping_indie, "Nobody"), pIndieCh = chSel(st.indie_channel), pIndieDev = roSel(st.indie_dev_role, "Nobody");
        // Pick the sources whose every listing is posted in the playtest channel, demos included (Alpha Beta Gamer already is).
        const FULL = [["playtester", "Playtester (alphas, betas, playtests and demos)"], ["itch", "itch.io (playtests, betas, alphas and demos)"], ["gamerpower", "GamerPower (beta and playtest key listings)"], ["steamdemo", "Steam's new demos (a lot of them)"]];
        const fullOn = new Set(String(st.playtest_full || "").split(",").filter(Boolean));
        const fullBoxes = FULL.map(([id, label]) => { const cb = h("input", { type: "checkbox", checked: fullOn.has(id) }); cb.dataset.src = id; return h("label", { class: "check-row" }, cb, " " + label); });
        const fullField = h("div", { class: "field" }, h("label", { text: "Post every listing from these sources in the playtest channel" }), h("div", { class: "stack" }, ...fullBoxes),
          h("p", { class: "muted small", text: "Without a tick, a source's demos only post for games your members have on a wishlist. Ticking one posts all of its listings. Turning one on starts quiet, so today's backlog isn't dumped." }));
        const genreIn = h("input", { type: "text", maxlength: "300", placeholder: "Any genre. Or e.g. Co-op, Roguelike, Cozy", value: String(st.playtest_genres || "").split(",").filter(Boolean).join(", ") });
        const genreField = h("div", { class: "field" }, h("label", { text: "Only these genres from Playtester (optional)" }), genreIn,
          h("p", { class: "muted small", text: "Playtester tags every game with genres like Action, Co-op or Cozy. List the ones you want, separated by commas, and the rest of its listings are skipped. Games your members have on a wishlist always post. Leave it empty for everything." }));
        const skipOnS = new Set(String(st.playtest_skip || "").split(",").filter(Boolean));
        const skipBoxesS = PLAYTEST_SOURCES.map(([id, label]) => { const cb = h("input", { type: "checkbox", checked: skipOnS.has(id) }); cb.dataset.src = id; return h("label", { class: "check-row" }, cb, " " + label); });
        const skipFieldS = h("div", { class: "field" }, h("label", { text: "Never post listings from" }), h("div", { class: "stack" }, ...skipBoxesS),
          h("p", { class: "muted small", text: "Ticked sites are left out of this server's playtest posts, even for games your members watch. Leave them all empty to use every site." }));
        const skipSources = () => skipBoxesS.map(l => l.firstChild).filter(cb => cb.checked).map(cb => cb.dataset.src);
        const fullSources = () => fullBoxes.map(l => l.firstChild).filter(cb => cb.checked).map(cb => cb.dataset.src);
        const pings = h("div", { class: "panel" }, h("h3", { text: "Ping roles" }),
          h("p", { class: "muted", text: "Members opt in to these roles in #roles. The bot pings them (and nobody else) when it posts." }),
          field("Free games feed", pFree), field("Deals (big discounts, sale starts, group alerts)", pDeals), field("New giveaways (used unless a giveaway picks its own)", pGw), field("Looking-for-group posts", pLfg), field("Playtest channel (every playtest, demo and beta is posted here, and the role below is pinged)", pPlayCh), fullField, genreField, skipFieldS, field("Playtest ping role", pPlay), field("Now playing channel (squad-up posts when two or more members are in the same game)", pSquadCh), field("Squad ping role", pSquad), field("Indie spotlight channel (the weekly indie game is posted here every Wednesday)", pIndieCh), field("Indie ping role", pIndie), field("Verified IndieDev role (the bot gives it to developers when their game is approved in the showcase)", pIndieDev), h("label", { class: "check" }, pPlayAll, "No playtest channel? Post every playtest in the alert channel too, not just games your members watch"),
          h("div", { class: "row" }, h("button", { class: "btn gray", type: "button", text: "Post current playtests now", title: "Posts the newest listed playtests, demos and betas in the playtest channel, without pinging the role", onclick: ev => busy(ev.currentTarget, async () => { const r = await post("/api/community/playtests", { count: 8 }); toast(r.posted ? `Posted ${r.posted} of ${r.found} listed. New ones are posted on their own.` : "Nothing is listed right now.", "ok"); }) }), save("Save ping roles", () => post("/api/community/pings", { playtest_full: fullSources(), playtest_genres: genreIn.value, playtest_skip: skipSources(), free: pFree.value, deals: pDeals.value, giveaway: pGw.value, lfg: pLfg.value, playtest: pPlay.value, squad: pSquad.value, squad_channel: pSquadCh.value, indie: pIndie.value, indie_dev: pIndieDev.value, indie_channel: pIndieCh.value, playtest_all: pPlayAll.checked, playtest_channel: pPlayCh.value }))));
        // referral
        const bonus = h("input", { type: "number", min: "0", max: "1000", value: String(st.referral_xp) }), rCount = h("input", { type: "number", min: "1", max: "1000", placeholder: "Invited members" }), rRole = roSel("", "Choose a role");
        const referral = h("div", { class: "panel" }, h("h3", { text: "Invites and referrals" }),
          h("p", { class: "muted", text: "Members get their own invite link (/server invites link or the button above). Every member who joins with it counts for them, earns the inviter bonus XP, and can unlock a role." }),
          field("Bonus XP for each new member they bring (0 for none)", bonus), h("div", { class: "row" }, save("Save bonus", () => post("/api/community/referral", { bonus: bonus.value }))),
          d.rewards.length ? h("ul", { class: "plain" }, d.rewards.map(r => h("li", {}, `${r.count} invited: `, h("b", { text: roleName(r.role_id) }), " ", save("Remove", () => post("/api/community/referral", { count: r.count, remove: true }), "btn gray small")))) : h("p", { class: "muted", text: "No role rewards yet." }),
          h("div", { class: "row" }, rCount, rRole, save("Add reward", () => post("/api/community/referral", { count: rCount.value, role_id: rRole.value }))));
        // emoji
        const eText = h("textarea", { rows: "3", placeholder: "Paste custom emoji, Discord emoji links, or links to pictures on any website, up to 20. Example: <:pog:123456789012345678>" }), eOut = h("div"), eList = h("div", { class: "emoji-grid" });
        const loadEmoji = async () => { try { const r = await api("/api/community/emoji?guild=" + encodeURIComponent(GID())); eList.replaceChildren(...r.emojis.slice(0, 60).map(e => h("img", { src: e.url, alt: e.name, title: ":" + e.name + ":", width: "32", height: "32", loading: "lazy" }))); if (!r.emojis.length) eList.replaceChildren(h("span", { class: "muted", text: "No custom emoji yet." })); } catch { eList.replaceChildren(h("span", { class: "muted", text: "Could not read the emoji list." })); } };
        const upName = h("input", { type: "text", maxlength: "32", placeholder: "Name for the emoji (letters, numbers, _)", "aria-label": "Emoji name" });
        const upFile = h("input", { type: "file", accept: "image/png,image/gif,image/jpeg,image/webp", "aria-label": "Emoji image" });
        upFile.addEventListener("change", () => { const f = upFile.files[0]; if (f && !upName.value) upName.value = f.name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 32); });
        const upBtn = h("button", { class: "btn blue", text: "Upload as emoji" });
        upBtn.addEventListener("click", () => busy(upBtn, async () => {
          const f = upFile.files[0];
          if (!f) { toast("Choose an image first.", "warn"); return; }
          if (f.size > 256 * 1024) { toast("That image is over 256 KB. Make it smaller (128x128 is plenty).", "warn"); return; }
          const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error("Could not read that file.")); r.readAsDataURL(f); });
          const r = await post("/api/community/emoji", { image_data: data, name: upName.value });
          toast("Added :" + r.added[0] + ":", "ok"); upFile.value = ""; upName.value = ""; loadEmoji();
        }));
        // emoji.gg packs: pick a pack, untick what you don't want, import in batches
        const packSort = select([["recent", "Newest"], ["downloads", "Most popular"], ["oldest", "Oldest"]], "recent");
        const packBox = h("div", { class: "muted", text: "Loading packs…" });
        const showPacks = async () => {
          packBox.className = "muted"; packBox.replaceChildren("Loading packs…");
          try {
            const r = await api("/api/community/emoji-packs?guild=" + encodeURIComponent(GID()) + "&sort=" + packSort.value);
            packBox.className = "";
            packBox.replaceChildren(h("div", { class: "pack-grid" }, ...r.packs.map(p => {
              const open = h("button", { class: "btn blue small", type: "button", text: "Open" });
              open.addEventListener("click", () => openPack(p));
              return h("div", { class: "pack-card" }, h("div", { class: "pack-previews" }, ...p.previews.map(u => h("img", { src: u, alt: "", width: "40", height: "40", loading: "lazy", referrerpolicy: "no-referrer" }))),
                h("b", { text: p.title }), h("span", { class: "muted small", text: p.count ? p.count + " emoji" : "" }), open);
            })));
          } catch (e) { packBox.className = ""; packBox.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
        };
        const openPack = async p => {
          packBox.className = "muted"; packBox.replaceChildren("Reading the pack…");
          let r; try { r = await api("/api/community/emoji-pack?guild=" + encodeURIComponent(GID()) + "&key=" + encodeURIComponent(p.key)); } catch (e) { packBox.className = ""; packBox.replaceChildren(h("div", { class: "notice warn", text: e.message }), (() => { const b = h("button", { class: "btn gray small", text: "Back" }); b.addEventListener("click", showPacks); return b; })()); return; }
          packBox.className = "";
          const boxes = r.emojis.map(e => { const c = h("input", { type: "checkbox", checked: true }); return { e, c, el: h("label", { class: "emoji-pick", title: ":" + e.name + ":" }, c, h("img", { src: e.url, alt: e.name, width: "40", height: "40", loading: "lazy", referrerpolicy: "no-referrer" }), h("span", { text: e.name })) }; });
          const count = h("span", { class: "muted small" }), out = h("div");
          const picked = () => boxes.filter(x => x.c.checked);
          const sync = () => { count.textContent = `${picked().length} of ${boxes.length} ticked`; };
          boxes.forEach(x => x.c.addEventListener("change", sync)); sync();
          const only = (label, f) => { const b = h("button", { class: "btn gray small", type: "button", text: label }); b.addEventListener("click", () => { boxes.forEach(x => { x.c.checked = f(x.e); }); sync(); }); return b; };
          const back = h("button", { class: "btn gray small", type: "button", text: "← All packs" }); back.addEventListener("click", showPacks);
          const go = h("button", { class: "btn green", type: "button", text: "Import the ticked emoji" });
          go.addEventListener("click", () => busy(go, async () => {
            const ids = picked().map(x => x.e.id); if (!ids.length) { toast("Tick at least one emoji.", "warn"); return; }
            let added = [], failed = [];
            for (let n = 0; n < ids.length; n += 30) {
              out.replaceChildren(h("p", { class: "muted", text: `Importing… ${Math.min(n, ids.length)} of ${ids.length}` }));
              const res = await post("/api/community/emoji-pack", { key: p.key, ids: ids.slice(n, n + 30) });
              added = added.concat(res.added); failed = failed.concat(res.failed);
              if (res.full && res.full.static && res.full.animated) break;
            }
            out.replaceChildren(h("p", {}, added.length ? `Added ${added.length}: ${added.slice(0, 40).map(x => ":" + x + ":").join(" ")}` : "Nothing was added."), ...failed.slice(0, 6).map(f => h("p", { class: "muted small", text: `${f.name}: ${f.why}` })), failed.length > 6 ? h("p", { class: "muted small", text: `…and ${failed.length - 6} more were skipped.` }) : "");
            if (added.length) loadEmoji();
          }));
          packBox.replaceChildren(h("div", { class: "row" }, back, h("b", { text: p.title }), h("a", { href: p.url, target: "_blank", rel: "noopener noreferrer", text: "emoji.gg ↗" })),
            h("p", { class: "muted small", text: "Still and animated emoji have separate slots in a server, so tick only what fits. Check the pack's license on emoji.gg." }),
            h("div", { class: "row" }, only("All", () => true), only("None", () => false), only("Still only", e => !e.animated), only("Animated only", e => e.animated), count),
            h("div", { class: "pick-grid" }, ...boxes.map(x => x.el)), h("div", { class: "row" }, go), out);
        };
        packSort.addEventListener("change", showPacks);
        showPacks();
        const emoji = h("div", { class: "panel" }, h("h3", { text: "Emoji import" }),
          h("p", { class: "muted", text: "Copy emoji from other servers (they look like <:name:id> in a message), paste a Discord emoji link, or paste a link to a picture on any website (PNG, GIF, JPG or WebP under 256 KB). Animated emoji keep their movement. Needs the Manage Expressions permission for the bot." }), eText,
          h("div", { class: "row" }, (() => { const b = h("button", { class: "btn blue", text: "Add the emoji" }); b.addEventListener("click", () => busy(b, async () => {
            const r = await post("/api/community/emoji", { text: eText.value });
            eOut.replaceChildren(h("p", {}, r.added.length ? `Added ${r.added.length}: ${r.added.map(n => ":" + n + ":").join(" ")}` : "Nothing was added."), ...r.failed.map(f => h("p", { class: "muted small", text: `${f.name}: ${f.why}` })));
            if (r.added.length) { eText.value = ""; loadEmoji(); }
          })); return b; })()), eOut,
          h("h4", { text: "Emoji packs from emoji.gg" }), h("div", { class: "row" }, field("Show", packSort)), packBox,
          h("h4", { text: "Or add one image" }), h("p", { class: "muted small", text: "PNG, GIF, JPG or WebP under 256 KB. Square images work best." }), h("div", { class: "row" }, upFile, upName, upBtn),
          h("h4", { text: "This server's emoji" }), eList);
        loadEmoji();
        // rules, announcements, support: where things are posted and what they say
        const annCh = chSel(st.announce_channel || (ch.channels.find(c => c.name === "announcements") || {}).id), rulesCh = chSel(st.rules_channel || (ch.channels.find(c => c.name === "rules") || {}).id);
        const reqCh = forumSel(st.requests_channel), trapCh = chSel(st.honeypot_channel);
        const places = h("div", { class: "panel" }, h("h3", { text: "Where things are posted" }),
          field("Announcements channel (your announcements, and the bot developer's notices to all servers)", annCh), field("Rules channel", rulesCh),
          field("Feature requests forum (each idea is a post tagged with its status; needs a forum channel)", reqCh),
          field("Trap channel for spam bots: anyone who types there is banned (staff are exempt)", trapCh),
          h("p", { class: "muted small", text: "Pick a channel that members can see and write in, and let me post the warning there. Make sure my role has Ban Members and sits above the members. The warning notice and channel description are added when you save a new channel." }),
          h("div", { class: "row" }, save("Save channels", () => post("/api/community/places", { announce_channel: annCh.value, rules_channel: rulesCh.value, requests_channel: reqCh.value, honeypot_channel: trapCh.value }))));
        // AI companion: members write "Hey AI ..." and get a short answer
        const ai = d.ai || {};
        const aiOn = h("input", { type: "checkbox", checked: Boolean(st.ai_on), disabled: !ai.available && !ai.lite });
        const guidesOn = h("input", { type: "checkbox", checked: st.guides_on !== 0 });
        const aiCh = chSel(st.ai_channel);
        const provs = ai.providers || [{ id: "anthropic", label: "Anthropic (Claude)", needsModel: false, keyHelp: "console.anthropic.com" }];
        const provNow = ai.keySet ? ai.keyProvider : "anthropic";
        const provSel = select(provs.map(p => [p.id, p.label]), provNow);
        provSel.disabled = Boolean(ai.keySet); // switching service means pasting a key for the new one: remove it first
        const provOf = () => provs.find(p => p.id === provSel.value) || provs[0];
        const keyIn = h("input", { type: "password", autocomplete: "off", spellcheck: "false", maxlength: "400", placeholder: ai.keySet ? "Paste a new key to replace it" : "Paste your API key" });
        const modelIn = h("input", { type: "text", maxlength: "100", spellcheck: "false", value: ai.keyModel || "", placeholder: "Model name" });
        const modelList = h("datalist", { id: "ai-models-" + st.guild_id });
        modelIn.setAttribute("list", "ai-models-" + st.guild_id); modelIn.setAttribute("autocomplete", "off");
        const loadModels = () => { const b = h("button", { class: "btn gray small", type: "button", text: "Load models" });
          b.addEventListener("click", () => busy(b, async () => {
            const r = await post("/api/community/ai-models", { ai_key: keyIn.value, ai_provider: provSel.value });
            modelList.replaceChildren(...r.models.map(m => h("option", { value: m })));
            toast(r.models.length ? `${r.models.length} models found. Click the Model box to pick one.` : "That key can't see any chat models.", r.models.length ? "ok" : "warn");
          })); return b; };
        const keyHelp = h("p", { class: "muted small" });
        const refresh = () => {
          const pv = provOf();
          modelIn.placeholder = pv.needsModel ? `Model name from ${pv.label}'s model list (required)` : "Leave empty for the default";
          keyHelp.textContent = `Get a key at ${pv.keyHelp}. It is checked when you save, stored encrypted, never shown again and never sent anywhere except ${pv.label}. With your own key your server pays ${pv.label} for its answers (they are small, usually a fraction of a cent each) and the bot's daily limit does not apply. You can remove it any time.`;
        };
        provSel.addEventListener("change", refresh); refresh();
        const provName = (provs.find(p => p.id === provNow) || provs[0]).label;
        const keyBox = h("div", {},
          ai.keyBad ? h("div", { class: "notice warn", text: `${provName} rejected this server's key the last time it was used, so the AI companion is silent here. Paste a working key to fix it.` }) : null,
          ai.keySet ? h("p", { class: "ai-use", text: `Using your own ${provName} key, ending ${ai.keyLast4 || "••••"}${ai.keyModel ? `, model ${ai.keyModel}` : ""}. ${ai.botKey ? "Your server is not counted against the bot's daily limit." : ""}` }) : null,
          ai.canStoreKey ? field("AI service", provSel) : h("p", { class: "muted small", text: "This bot can't store keys for servers yet." }),
          ai.canStoreKey ? field("Your own API key (optional)", keyIn) : null,
          ai.canStoreKey ? field("Model (press Load models to see what your key can use)", h("div", {}, modelIn, modelList)) : null,
          ai.canStoreKey ? keyHelp : null,
          ai.canStoreKey ? h("div", { class: "row" },
            save(ai.keySet ? "Replace key" : "Save key", () => { if (!keyIn.value.trim()) throw new Error("Paste your key first."); return post("/api/community/places", { ai_key: keyIn.value, ai_provider: provSel.value, ai_model: modelIn.value }); }),
            loadModels(),
            ai.keySet ? save("Save model", () => post("/api/community/places", { ai_provider: provNow, ai_model: modelIn.value })) : null,
            ai.keySet ? save("Remove key", () => post("/api/community/places", { ai_key_clear: true })) : null) : null);
        const aiP = h("div", { class: "panel" }, h("h3", {}, "AI companion", ai.available ? null : h("span", { class: "pill", text: "Coming soon" })),
          ai.available ? null : h("div", { class: "notice", text: "The full AI is coming soon. Until then, when you switch this on, the bot answers the common questions itself: game prices, the free games right now, and a member's own wishlist and library (try “Hey AI is Hades on sale?”). Anything else gets a polite “coming soon”. Want the full AI today? Add your own AI key below (Anthropic, OpenAI, Gemini and more)." }),
          h("label", { class: "check" }, guidesOn, " Answer how-to questions with a step by step guide (no AI needed), like “how do I get Steam Verified”"),
          h("label", { class: "check" }, aiOn, " Answer when members say “Hey AI” followed by a question"),
          field("Only answer in this channel (leave empty for every channel)", aiCh),
          h("p", { class: "muted small", text: "The bot needs View Channel, Read Message History and Send Messages in the channel. If it can't send there, it tells the person who asked (by DM) what to allow." }),
          h("p", { class: "muted small", text: ai.phrase ? "Members write “Hey AI, …” or mention the bot." : "Members mention the bot, because this bot can't read “Hey AI” yet (it needs the Message Content intent)." }),
          (ai.available || ai.lite) ? h("p", { class: "ai-use", text: ai.main ? `Answers today: ${ai.usedToday}. This is the bot owner's own server, so it has no daily limit.` : ai.keySet && ai.unlimited ? `Answers today: ${ai.usedToday}. No daily limit while your own key is used.` : `Used today: ${ai.usedToday} of ${ai.dailyCap} answers (resets at midnight UTC).${ai.plus ? " AI Plus is on for this server." : ""}` }) : null,
          h("div", { class: "row" }, save("Save AI settings", () => post("/api/community/places", { ai_on: aiOn.checked, ai_channel: aiCh.value, guides_on: guidesOn.checked }))),
          h("h4", { text: "Your own API key" }), keyBox,
          h("h4", { text: "How it works and its limits" }),
          h("ul", { class: "ai-limits" },
            h("li", { text: ai.main ? "This server is the bot owner's own, so it has no daily answer limit." : ai.keySet ? "Your server uses its own key, so there is no daily answer limit. The bot owner can still switch the AI off or set a limit for your server." : `Each server gets up to ${ai.dailyCap || 300} answers a day. After that the bot says it has reached the limit and starts again the next day. A server with its own key has no daily limit.` }),
            h("li", { text: `Each person can ask once every ${ai.cooldownSec || 15} seconds. Faster than that, the bot just reacts with ⏳.` }),
            h("li", { text: `Questions are cut at ${ai.maxQuestion || 700} characters. Answers are short, never longer than ${ai.maxReply || 1900} characters, and ping nobody.` }),
            h("li", { text: `Replying to one of its answers continues the conversation (it remembers the last ${ai.history || 6} messages of that thread). It remembers nothing else.` }),
            h("li", { text: (ai.available ? "" : "Right now it works from fixed questions, not free chat. ") + "It can look up live game prices, the free games right now, and the asker's own wishlist and library, and add a game to the asker's wishlist when asked. It never sees anyone else's lists or other channels." }),
            h("li", { text: ai.available ? "Only messages that say “Hey AI” or mention the bot are read. The question, the thread it replies to, the person's display name and the results of those lookups are sent to the AI service you chose (Anthropic by default; your own key can use another) to write the answer. Nothing else from your server is sent." : "Only messages that say “Hey AI” or mention the bot are read. While the full AI is coming soon, the bot answers them itself and nothing is sent to any AI provider." }),
            h("li", { text: "Servers that turn it on are responsible for who can use it: pick one channel above if you only want it in one place." })));
        const plusBtn = save(ai.plusInterest ? "Never mind" : "Tell me when it's ready", () => post("/api/community/places", { ai_plus_interest: !ai.plusInterest }));
        const plusP = ai.plusVisible && !ai.main ? h("div", { class: "panel" }, h("h3", {}, "AI Plus ", h("span", { class: "pill", text: "Work in progress" })),
          h("p", { text: `When your server reaches its daily limit, AI Plus would keep the answers coming using the bot's own AI, with a bigger limit (${(ai.plusCap || 2000).toLocaleString()} answers a day), and nothing for you to set up.` }),
          h("p", { class: "muted small", text: "Payments are not switched on yet, so there is nothing to buy today. Until then you can lift the limit for free with your own AI key above. Press the button and the bot owner will know your server wants this." }),
          ai.plus ? h("div", { class: "notice", text: "AI Plus is on for this server right now, so the bigger limit applies." }) : null,
          ai.plusInterest ? h("p", { class: "ai-use", text: "Noted. Your server is on the list." }) : null,
          h("div", { class: "row" }, plusBtn)) : null;
        const rText = h("textarea", { rows: "9", maxlength: "3000", placeholder: d.defaultRules }); rText.value = st.rules_text || "";
        const rulesP = h("div", { class: "panel" }, h("h3", { text: "Rules" }),
          h("p", { class: "muted", text: "Edit the rules shown in the rules channel. Leave it empty to use the standard community rules. The post comes with the bot logo and banner." }), field("Rules (Discord formatting works)", rText),
          h("div", { class: "row" }, save("Save", () => post("/api/community/rules", { text: rText.value })), save("Save and post in the rules channel", () => post("/api/community/rules", { text: rText.value, post: true }), "btn green small")));
        const tkCh = chSel(d.support.ticket_channel), tkRole = roSel(d.support.staff_role_id, "Server managers only");
        const supportP = h("div", { class: "panel" }, h("h3", { text: "Support tickets" }),
          h("p", { class: "muted", text: "Members press Open a ticket in #get-help (or use /bot support open). Tickets land in the channel below with Reply, Assign me and Resolve buttons. Bug reports go to the bot's developer instead." }),
          field("Tickets channel (staff only)", tkCh), field("Role that answers tickets", tkRole),
          h("div", { class: "row" }, save("Save support", () => post("/api/community/support", { ticket_channel: tkCh.value, staff_role_id: tkRole.value }))));
        const announceP = announceDesigner({ chSel, roSel, defaultCh: st.announce_channel || (ch.channels.find(c => c.name === "announcements") || {}).id, history: d.announcements, roleName, chName: id => (ch.channels.find(c => c.id === id) || {}).name });
        const lbCh = chSel(st.lb_channel), lbHours = h("input", { type: "number", min: "1", max: "48", value: String(st.lb_hours || 5), "aria-label": "Hours between refreshes" });
        const lbP = h("div", { class: "panel" }, h("h3", { text: "XP leaderboard" }),
          h("p", { class: "muted", text: "A read-only channel with the top members and top inviters. The bot edits the same message on a timer, so it never fills the channel. Members use /server rank for their own place." }),
          field("Leaderboard channel", lbCh), field("Refresh every (hours, 1 to 48)", lbHours),
          h("p", { class: "muted small", text: st.lb_at ? "Last updated " + new Date(st.lb_at).toLocaleString() + "." : "Not posted yet." }),
          h("div", { class: "row" }, save("Save", () => post("/api/community/leaderboard", { channel_id: lbCh.value, hours: lbHours.value })),
            save("Save and refresh now", () => post("/api/community/leaderboard", { channel_id: lbCh.value, hours: lbHours.value, refresh: true }), "btn green small")));
        const mCh = chSel(st.meme_channel || (ch.channels.find(c => c.name === "memes") || {}).id), mHours = h("select", { "aria-label": "How often" }, ...[1, 2, 3, 6, 12, 24].map(n => h("option", { value: String(n), text: n === 1 ? "Every hour" : `Every ${n} hours`, selected: n === (st.meme_hours || 1) })));
        const mOn = h("input", { type: "checkbox", checked: st.meme_on !== 0 });
        const mBody = () => ({ channel_id: mCh.value, hours: mHours.value, enabled: mOn.checked });
        const memeP = h("div", { class: "panel" }, h("h3", { text: "Auto memes" }),
          h("p", { class: "muted", text: "The bot posts a fresh gaming and internet meme in this channel on a timer. Nothing marked NSFW is used and a server never gets the same post twice." }),
          field("Memes channel", mCh), field("How often", mHours), h("label", { class: "check" }, mOn, " Post memes automatically"),
          h("p", { class: "muted small", text: st.meme_at ? "Last meme " + new Date(st.meme_at).toLocaleString() + "." : "None posted yet." }),
          h("div", { class: "row" }, save("Save", () => post("/api/community/memes", mBody())), save("Save and post one now", () => post("/api/community/memes", { ...mBody(), now: true }), "btn green small")));
        // group everything a manager can customize into tabs
        // Guides managers write for their own server: the bot answers matching questions by itself, and the AI can use them too
        const gTitle = h("input", { type: "text", maxlength: "80", placeholder: "How do I get the Raider role?" });
        const gKeys = h("textarea", { rows: "2", maxlength: "400", placeholder: "get raider role, raider role, how to join raids" });
        const gBody = h("textarea", { rows: "5", maxlength: "1500", placeholder: "Write the answer exactly as members should read it." });
        const guidesP = h("div", { class: "panel" }, h("h3", { text: "Server guides" }),
          h("p", { class: "muted", text: "Write answers to the questions your members keep asking: rules, roles, channels, how things work here. When someone asks something that contains one of your phrases, the bot replies with the guide by itself. The AI companion uses them too." }),
          (st.serverGuides || d.serverGuides || []).length ? h("ul", { class: "plain" }, (st.serverGuides || d.serverGuides || []).map(g => h("li", {}, h("b", { text: g.title }), h("span", { class: "muted small", text: "  ·  " + g.keywords.join(", ") }), " ", save("Remove", () => post("/api/community/guides", { remove: g.id }), "btn gray small")))) : h("p", { class: "muted small", text: "No guides yet." }),
          field("Title", gTitle), field("Phrases that trigger it (separate with commas)", gKeys), field("The answer", gBody),
          h("div", { class: "row" }, save("Add guide", () => post("/api/community/guides", { title: gTitle.value, keywords: gKeys.value, body: gBody.value }))));
        const groups = [["Setup", [build]], ["Welcome & verify", [welcome, verify]], ["AI companion", [aiP, guidesP, plusP].filter(Boolean)], ["Rules & announcements", [places, rulesP, announceP]], ["Support", [supportP]], ["Roles & pings", [pings, referral]], ["Leaderboard", [lbP]], ["Memes", [memeP]], ["Emoji", [emoji]]];
        const tabBar = h("div", { class: "tabs" }), body = h("div");
        const show = n => { mgrTab = n; [...tabBar.children].forEach((b, k) => b.classList.toggle("active", k === n)); body.replaceChildren(...groups[n][1]); };
        groups.forEach(([label], n) => tabBar.append(h("button", { class: "tab small", type: "button", text: label, onclick: () => show(n) })));
        box.replaceChildren(h("h2", { text: "Server settings" }), h("p", { class: "muted", text: "Everything you can customize for this server, in one place." }), tabBar, body);
        show(Math.min(mgrTab, groups.length - 1));
      })();
      return box;
    }
    guild.addEventListener("change", load);
    load();
  }
  root.CommunityUI = { view };
})(window);

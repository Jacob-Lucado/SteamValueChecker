// The owner's admin panel: sign-in, the overview, members, servers, giveaways, indie review, the staff chat and everything else behind the
// admin address. app.js hands over its helpers (ctx) and calls create(ctx), then wires boot and route to the page load and hash changes.
(function (root) {
  "use strict";
  function create(ctx) {
    const { api, app, busy, field, giveawayPreview, h, lineChart, logPanel, pendingPanel, prizeButtons, renderChrome, requestList, route, scrollTop0, select, state, themeButton, toast } = ctx;
    async function adminView() {
      const opts = { shell: true };
      let d, ins, bugData;
      try { [d, ins, bugData] = await Promise.all([api("/api/admin/stats"), api("/api/admin/insights"), api("/api/admin/bugs")]); }
      catch (e) { throw e; }
      const st = d.stats, hl = d.health || {}, bot = ins.bot || {};
      const tile = (k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: String(v) }), sub && h("div", { class: "s", text: sub }));
      const when = t => (t ? new Date(t).toLocaleString() : "never");
      const n0 = v => (v === null || v === undefined ? "–" : Number(v).toLocaleString());
      const table = (head, rows) => {
        if (!rows.length) return h("p", { class: "muted", text: "Nothing yet." });
        const th = head.map((c, i) => h("th", { class: i ? "num" : "", text: c }));
        const trs = rows.map(r => h("tr", {}, r.map((c, i) => h("td", { class: i ? "num" : "", text: String(c) }))));
        return h("div", { class: "scroll-y" }, h("table", {}, h("thead", {}, h("tr", {}, th)), h("tbody", {}, trs)));
      };
      const daily = (rows, name, cls) => lineChart([{ name, cls, points: rows.map(r => ({ x: Date.parse(r.day + "T00:00:00Z"), y: r.n })) }], { format: v => (Number.isInteger(v) ? String(v) : ""), label: name + " per day, last 30 days" });
      const sum = rows => rows.reduce((t, r) => t + r.n, 0);

      const bugs = () => {
        const list = bugData.bugs;
        const newOnes = new Set(list.filter(b => b.isNew).map(b => b.id));
        // Opening this tab counts as reading them: the menu badge clears, while "New" stays on the cards until you leave.
        if (bugData.newCount && state.me) { api("/api/admin/bugs/seen", {}).then(() => { state.me.bugsNew = 0; bugData.newCount = 0; renderChrome(); }).catch(() => {}); }
        const ago = t => { const m = Math.max(1, Math.round((Date.now() - t) / 60000)); return m < 60 ? m + " min ago" : m < 2880 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago"; };
        return [h("div", { class: "panel" }, h("h3", { text: `Bug reports (${bugData.open} open)` }),
          h("p", { class: "muted small", text: "Sent by members with /bot bug, /bot support open (type: bug) or the Support page. Open one to read the thread and reply." }),
          list.length ? h("div", { class: "scroll-y tall" }, list.map(b => h("div", { class: "bug-card" + (newOnes.has(b.id) ? " new" : "") },
            h("div", { class: "row" }, h("strong", { text: `#${b.id} ${b.subject}` }), newOnes.has(b.id) ? h("span", { class: "badge-count", text: "NEW" }) : null, h("span", { class: "chip dim", text: b.status })),
            h("div", { class: "muted small", text: `${b.user_name || b.user_id} · ${ago(b.created_at)}${b.replies ? " · " + b.replies + " repl" + (b.replies === 1 ? "y" : "ies") : ""}` }),
            h("p", { class: "bug-text", text: b.text }),
            h("a", { class: "btn gray small", href: "#/support/" + b.id, text: "Open ticket" })))) : h("p", { class: "muted", text: "No bug reports yet." }))];
      };

      const overview = () => [
        bugData.newCount ? h("div", { class: "notice warn" }, h("strong", { text: `${bugData.newCount} new bug report${bugData.newCount === 1 ? "" : "s"}. ` }), h("a", { href: "#/bugs", text: "Read them" })) : null,
        h("div", { class: "grid four" }, tile("Members", st.users, `${st.activeUsers} with alerts on`), tile("Wishlist games", st.wishlistGames, `${st.uniqueGames} different games`),
          tile("Library games", st.libraryGames), tile("Servers with a channel", st.serversWithChannel),
          tile("Alerts, last 24h", st.alerts24h), tile("DM delivery", st.dmUsers, `${st.channelUsers} use the channel`), tile("DMs failing", st.usersFailingDm, "3 or more failures in a row"),
          tile("New members, 7 days", sum(ins.signups.slice(-7)), `${sum(ins.signups)} in 30 days`)),
        h("div", { class: "panel" }, h("h3", { text: "The bot right now" }),
          h("div", { class: "grid four" }, tile("Version", bot.version || "–", bot.node), tile("Uptime", bot.uptime || "–"), tile("Discord ping", bot.pingMs === null || bot.pingMs === undefined ? "–" : bot.pingMs + " ms"), tile("Servers", n0(bot.servers), "the bot is in"),
            tile("Memory", bot.rssMb + " MB"))),
        h("div", { class: "panel" }, h("h3", { text: "Alerts in the last 7 days" }),
          Object.keys(st.alerts7d).length ? h("p", { text: Object.entries(st.alerts7d).map(([k, n]) => `${k}: ${n}`).join("   ") }) : h("p", { class: "muted", text: "None." })),
        h("div", { class: "panel" }, h("h3", { text: "Health" }),
          h("p", { text: "Last price check: " + when(hl.cycle && hl.cycle.at) + (hl.cycle && hl.cycle.priceErrors ? ` (${hl.cycle.priceErrors} price errors)` : "") }),
          h("p", { text: "Last backup: " + (hl.backup ? `${when(hl.backup.at)} (${hl.backup.ok ? "ok" : "FAILED"})` : "none yet") }),
          h("p", { class: "muted small", text: "Recent errors: " + ((hl.errors || []).slice(0, 5).map(e => `${e.where} (${when(e.at)})`).join(", ") || "none") }))];

      const growth = () => [
        h("div", { class: "panel" }, h("h3", { text: "New members per day" }), daily(ins.signups, "New members", "s0")),
        h("div", { class: "panel" }, h("h3", { text: "Alerts sent per day" }), daily(ins.alerts, "Alerts", "s1")),
        h("div", { class: "grid two" },
          h("div", { class: "panel" }, h("h3", { text: "Regions" }), table(["Region", "Members"], ins.regions.map(r => [r.k, r.n]))),
          h("div", { class: "panel" }, h("h3", { text: "Languages" }), table(["Language", "Members"], ins.languages.map(r => [r.k, r.n]))))];

      const features = () => [
        h("div", { class: "panel" }, h("h3", { text: "Who uses what" }), h("div", { class: "kv" }, ins.features.map(([k, v]) => h("div", { class: v ? "" : "zero" }, h("span", { text: k }), h("b", { text: n0(v) }))))),
        h("div", { class: "panel" }, h("h3", { text: "Most watched games" }), table(["Game", "Members watching"], ins.watched.map(r => [r.title, r.n]))),
        h("div", { class: "panel" }, h("h3", { text: "Idle accounts" }),
          h("p", { text: `${n0(ins.idle.noWishlistOrLibrary)} member${ins.idle.noWishlistOrLibrary === 1 ? " has" : "s have"} no wishlist and no library games.` }),
          h("p", { text: `${n0(ins.idle.dmFailing)} member${ins.idle.dmFailing === 1 ? " has" : "s have"} DMs that keep failing.` }))];

      const funnelPanel = () => {
        const f = ins.funnel || { joined: 0, started: 0, setup: 0, recent: [] };
        const pct = n => (f.joined ? Math.round((n / f.joined) * 100) + "%" : "-");
        const when = t => (t ? new Date(t).toLocaleString() : "-");
        const tile = (k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: String(v) }), h("div", { class: "s", text: sub }));
        return h("div", { class: "panel" }, h("h3", { text: "Setup funnel, last 30 days" }),
          h("p", { class: "muted small", text: "Servers that added the bot, got the start-here channel, and then ran a setup command. Counted from when this started being tracked." }),
          h("div", { class: "tiles" }, tile("Added the bot", f.joined, "new servers"), tile("Got the start channel", f.started, pct(f.started)), tile("Ran setup", f.setup, pct(f.setup))),
          f.recent.length ? h("table", {}, h("thead", {}, h("tr", {}, ["Server", "Added", "Start channel", "Setup"].map(c => h("th", { text: c })))),
            h("tbody", {}, f.recent.map(r => h("tr", {}, h("td", { text: r.name || r.id }), h("td", { text: when(r.join) }), h("td", { text: when(r.start) }), h("td", { text: r.setup ? when(r.setup) : "not yet" }))))) : h("p", { class: "muted", text: "No new servers tracked yet." }));
      };
      const servers = () => [funnelPanel(), h("div", { class: "panel" }, h("h3", { text: `Servers (${ins.servers.length})` }),
        ins.servers.length ? h("div", { class: "scroll-y tall" }, h("table", {}, h("thead", {}, h("tr", {}, ["Server", "Members", "Using the bot", "Alert channel", "Free feed", "Group alerts", "Digest", ""].map((c, i) => h("th", { class: i === 1 || i === 2 ? "num" : "", text: c })))),
          h("tbody", {}, ins.servers.map(g => h("tr", {}, h("td", {}, g.name || "Unknown server", h("div", { class: "muted small", text: g.id + (g.inServer === false ? " · bot has left" : "") })), h("td", { class: "num", text: n0(g.members) }), h("td", { class: "num", text: String(g.tracked) }),
            h("td", { text: g.channel ? "Yes" : "No" }), h("td", { text: g.freeFeed ? "On" : "Off" }), h("td", { text: g.groupMin ? "At " + g.groupMin : "Off" }), h("td", { text: g.digest ? "On" : "Off" }), h("td", {}, g.inServer === false ? null : (() => {
            const b = h("button", { class: "btn gray small", type: "button", text: "Get invite" });
            const out = h("div", { class: "muted small" });
            b.addEventListener("click", () => busy(b, async () => {
              const r = await api("/api/admin/server/invite", { id: g.id });
              const a = h("a", { href: r.url, target: "_blank", rel: "noopener noreferrer", text: r.url });
              out.replaceChildren("One use, expires in an hour: ", a);
            }));
            const act = (label, body, ask) => { const x = h("button", { class: "btn gray small", type: "button", text: label }); x.addEventListener("click", () => { if (ask && !confirm(ask)) return; busy(x, async () => { await api(body.path, body.data); toast("Done.", "ok"); route(); }); }); return x; };
            const acts = g.blocked ? [h("span", { class: "chip warn", text: "Blocked" }), act("Unblock", { path: "/api/admin/server/unblock", data: { id: g.id } })]
              : g.inServer === false ? [] : [act("Leave", { path: "/api/admin/server/leave", data: { id: g.id } }, `Make the bot leave ${g.name || g.id}? It can be invited back.`), act("Leave and block", { path: "/api/admin/server/leave", data: { id: g.id, block: true } }, `Leave ${g.name || g.id} and block it? If someone invites the bot back it will leave again until you unblock it.`)];
            return h("div", { class: "row" }, b, ...acts, out);
          })())))))) : h("p", { class: "muted", text: "No servers yet." }))];

      const members = () => {
        const ago = ms => { if (!ms) return "never"; const m = Math.floor((Date.now() - ms) / 60000); if (m < 2) return "just now"; if (m < 120) return m + " min ago"; const hr = Math.floor(m / 60); if (hr < 48) return hr + " hours ago"; return Math.floor(hr / 24) + " days ago"; };
        const setBan = async (uid, ban, reason) => { await api("/api/admin/ban", { id: uid, ban, reason }); };
        const askBan = uid => { const reason = prompt("Why are you restricting this person? (optional, only you see it)"); if (reason === null) return null; return reason; };

        // 1. Pick a server, see who's actually using the bot there.
        const pick = h("select", { "aria-label": "Server" }, h("option", { value: "", text: "Choose a server…" }), ...ins.servers.map(g => h("option", { value: g.id, text: (g.name || "Unknown server") + " (" + g.id + ")" })));
        const range = h("select", { "aria-label": "Activity" }, [["7", "Active in the last 7 days"], ["30", "Active in the last 30 days"], ["90", "Active in the last 90 days"], ["0", "Everyone who has used it"]].map(([v, t]) => h("option", { value: v, text: t, selected: v === "30" })));
        const search = h("input", { type: "search", placeholder: "Filter by name or ID", "aria-label": "Filter people" });
        const list = h("div", { class: "muted", text: "Pick a server to see its people." });
        let rows = [];
        const drawList = () => {
          const q = search.value.trim().toLowerCase();
          const shown = rows.filter(m => !q || m.id.includes(q) || (m.name || "").toLowerCase().includes(q) || (m.username || "").toLowerCase().includes(q));
          if (!shown.length) return list.replaceChildren(h("p", { class: "muted", text: rows.length ? "Nobody matches that." : "Nobody has been active here in that time." }));
          list.replaceChildren(h("div", { class: "scroll-y tall" }, h("table", {}, h("thead", {}, h("tr", {}, ["Person", "Last seen", "Wishlist", "Alerts", ""].map((c, i) => h("th", { class: i === 2 || i === 3 ? "num" : "", text: c })))),
            h("tbody", {}, shown.map(m => {
              const b = h("button", { class: "btn small " + (m.banned ? "green" : "red"), text: m.banned ? "Lift restriction" : "Restrict" });
              b.addEventListener("click", () => busy(b, async () => {
                if (m.banned) { await setBan(m.id, false); m.banned = false; toast("Restriction lifted.", "ok"); }
                else { const r = askBan(m.id); if (r === null) return; await setBan(m.id, true, r); m.banned = true; m.banReason = r; toast("Restricted. They're signed out and the bot ignores them.", "ok"); }
                drawList(); loadBans();
              }));
              return h("tr", { class: m.banned ? "banned" : "" }, h("td", {}, m.name || m.username || "Member", m.banned ? h("span", { class: "pill red", text: " restricted" }) : "", h("div", { class: "muted small", text: m.id + (m.banned && m.banReason ? " · " + m.banReason : "") })),
                h("td", { text: ago(m.lastSeen) }), h("td", { class: "num", text: String(m.wishlist) }), h("td", { class: "num", text: String(m.alerts) }), h("td", {}, b));
            })))));
        };
        const load = async () => {
          if (!pick.value) { rows = []; return list.replaceChildren(h("p", { class: "muted", text: "Pick a server to see its people." })); }
          list.replaceChildren(h("p", { class: "muted", text: "Loading…" }));
          try { rows = (await api("/api/admin/server-members?guild=" + pick.value + "&days=" + range.value)).members; drawList(); }
          catch (e) { list.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
        };
        pick.addEventListener("change", load); range.addEventListener("change", load); search.addEventListener("input", drawList);

        // 2. Everyone currently restricted.
        const banBox = h("div");
        async function loadBans() {
          try {
            const { bans } = await api("/api/admin/bans");
            banBox.replaceChildren(bans.length ? h("div", {}, ...bans.map(x => {
              const lift = h("button", { class: "btn green small", text: "Lift restriction" });
              lift.addEventListener("click", () => busy(lift, async () => { await setBan(x.discord_id, false); toast("Restriction lifted.", "ok"); loadBans(); if (pick.value) load(); }));
              return h("div", { class: "row", style: "align-items:center;justify-content:space-between;gap:12px" }, h("span", { text: x.discord_id + (x.reason ? " · " + x.reason : "") + " · " + new Date(x.at).toLocaleDateString() }), h("div", { style: "flex:none" }, lift));
            })) : h("p", { class: "muted", text: "Nobody is restricted." }));
          } catch (e) { banBox.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
        }
        loadBans();

        // 3. Look up anyone by ID.
        const id = h("input", { type: "text", inputmode: "numeric", placeholder: "Discord user ID (paste it, or a mention)", maxlength: "30", "aria-label": "Discord user ID" });
        const out = h("div");
        const draw = u => {
          const act = (label, action, cls = "gray") => { const b = h("button", { class: "btn " + cls + " small", text: label }); b.addEventListener("click", () => busy(b, async () => { draw(await api("/api/admin/user", { id: u.id, action })); toast("Done.", "ok"); })); return b; };
          const banBtn = h("button", { class: "btn small " + (u.banned ? "green" : "red"), text: u.banned ? "Lift restriction" : "Restrict from bot and dashboard" });
          banBtn.addEventListener("click", () => busy(banBtn, async () => {
            if (u.banned) await setBan(u.id, false); else { const r = askBan(u.id); if (r === null) return; await setBan(u.id, true, r); }
            u.banned = !u.banned; draw(u); loadBans(); if (pick.value) load();
          }));
          out.replaceChildren(h("div", { class: "panel" }, h("h3", { text: "Member " + u.id }),
            u.banned ? h("div", { class: "notice warn", text: "This person is restricted." }) : "",
            h("div", { class: "grid four" }, tile("Joined", new Date(u.joined).toLocaleDateString()), tile("Wishlist", u.wishlist), tile("Library", u.library), tile("Alerts received", u.alerts)),
            h("p", { text: `Region ${u.region} · delivery by ${u.delivery} · language ${u.lang} · last seen ${ago(u.lastSeen)} · ${u.paused ? "alerts paused" : "alerts on"} · ${u.dmFailures} failed DMs · ${u.share ? "on server boards" : "not on server boards"} · Steam ${u.steam ? "linked" : "not linked"} · grabber ${u.grabber ? "linked" : "not linked"}` }),
            h("div", { class: "row" }, act("Reset failed DMs", "reset_dm"), u.paused ? act("Resume alerts", "resume", "green") : act("Pause alerts", "pause"), banBtn)));
        };
        const find = h("button", { class: "btn blue", text: "Look up" });
        const go = () => busy(find, async () => { try { draw(await api("/api/admin/user?id=" + encodeURIComponent(id.value.replace(/\D/g, "")))); } catch (e) { out.replaceChildren(h("div", { class: "notice warn", text: e.message })); } });
        find.addEventListener("click", go);
        id.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
        return [
          h("div", { class: "panel" }, h("h3", { text: "People by server" }),
            h("p", { class: "muted small", text: "Choose a server to see who's using the bot there, most recent first. Restricting someone stops the bot answering them, ends their dashboard sign-in and stops alerts to them. Counts only; no games, keys or messages." }),
            h("div", { class: "lookup-row" }, pick, range), h("div", { class: "lookup-row" }, search), list),
          h("div", { class: "panel" }, h("h3", { text: "Restricted people" }), banBox),
          h("div", { class: "panel" }, h("h3", { text: "Look up by ID" }),
            h("p", { class: "muted small", text: "Find anyone who has used the bot, even if you don't know their server." }), h("div", { class: "lookup-row" }, id, find)), out];
      };

      const tools = () => {
        const clear = h("button", { class: "btn gray small", text: "Reset failed DMs for everyone" });
        clear.addEventListener("click", () => busy(clear, async () => { const r = await api("/api/admin/clear-dm-failures", {}); toast(`Reset for ${r.cleared} member${r.cleared === 1 ? "" : "s"}.`, "ok"); }));
        return [
          h("div", { class: "panel" }, h("h3", { text: "Backup" }),
            h("p", { text: "Last backup: " + (hl.backup ? `${when(hl.backup.at)} (${hl.backup.ok ? "ok" : "FAILED"})` : "none yet") }),
            h("p", {}, h("a", { href: "/api/admin/backup", class: "btn gray small", download: "" }, "Download the latest backup"), h("span", { class: "muted small", text: "  (the whole database, including encrypted giveaway keys. Keep it private.)" }))),
          (() => {
            const box = h("div", { class: "panel" }, h("h3", { text: "Offsite backup" }), h("p", { class: "muted", text: "Checking…" }));
            const size = n => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
            const load = async () => {
              try {
                const o = await api("/api/admin/offsite");
                if (!o.enabled) return box.replaceChildren(h("h3", { text: "Offsite backup" }), h("p", { text: "Not set up. Right now the backups live on the same disk as the database, so losing that disk loses both." }),
                  h("p", { class: "muted small", text: "To switch it on, create a Tigris storage bucket from your Fly dashboard (Storage) and attach it to this app. Fly adds the access keys as secrets for you. Any other S3-style bucket works too, using the secrets BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_KEY and BACKUP_S3_SECRET. Restart the app afterwards." }));
                const check = h("button", { class: "btn gray small", type: "button", text: "Test the newest copy" }), out = h("p", { class: "muted small" });
                check.addEventListener("click", () => busy(check, async () => {
                  try { const r = await api("/api/admin/offsite/verify", {}); out.className = r.ok ? "" : "bad"; out.textContent = r.ok ? `Good: ${r.key.split("/").pop()} downloaded, opened and passed the integrity check (${Number(r.users).toLocaleString()} members, ${size(r.bytes)}).` : "The copy downloaded but failed the integrity check."; }
                  catch (e) { out.className = "bad"; out.textContent = e.message; }
                }));
                box.replaceChildren(h("h3", { text: "Offsite backup" }),
                  h("p", { text: o.last ? `Last upload: ${when(o.last.at)} · ${size(o.last.bytes)}${o.last.encrypted ? " · encrypted" : " · not encrypted (set KEY_ENCRYPTION_SECRET to encrypt)"}` : "Nothing uploaded yet. The next daily backup sends the first one." }),
                  o.error ? h("p", { class: "bad", text: "Could not read the bucket: " + o.error }) : o.list.length ? h("table", {}, h("thead", {}, h("tr", {}, [h("th", { text: "Copy" }), h("th", { text: "Size" })])), h("tbody", {}, o.list.map(x => h("tr", {}, h("td", { text: x.key.split("/").pop() }), h("td", { text: size(x.size) }))))) : null,
                  h("p", {}, check), out);
              } catch (e) { box.replaceChildren(h("h3", { text: "Offsite backup" }), h("p", { class: "bad", text: e.message })); }
            };
            load();
            return box;
          })(),
          h("div", { class: "panel" }, h("h3", { text: "Maintenance" }),
            h("p", { class: "muted small", text: "Members whose DMs failed 3 times in a row are skipped until they change something. This gives all of them another try." }), clear),
          logPanel()];
      };

      const announce = () => {
        const title = h("input", { type: "text", maxlength: "100", placeholder: "Title (optional), e.g. Bot update tonight" });
        const msg = h("textarea", { rows: "5", maxlength: "1500", placeholder: "The bot will be offline around 11pm Eastern for about 10 minutes for an update. Alerts will catch up afterwards.", "aria-label": "Message" });
        const count = h("span", { class: "muted small", text: "0 / 1500" });
        const who = h("select", { "aria-label": "Who gets it" });
        const confirm = h("input", { type: "text", placeholder: "SEND", maxlength: "4", autocomplete: "off", "aria-label": "Type SEND to confirm" });
        const mention = select([["none", "No ping"], ["everyone", "@everyone"], ["here", "@here"]], "none");
        const mentionRow = field("Ping in server channels", mention);
        const preview = h("div", { class: "notice" });
        const progress = h("div"), history = h("div");
        const send = h("button", { class: "btn red", type: "button", text: "Send announcement" });
        const test = h("button", { class: "btn gray", type: "button", text: "Send a test to me only" });
        let info = null, timer = 0;
        const box = h("div");
        const promoPanel = () => {
          const pWho = select([["me", "Only me (preview)"], ["dm", `DMs to members who have not opted out (${info.counts.promoDm})`], ["channels", `Every server's #announcements channel (${info.counts.channels})`], ["both", `Both (${info.counts.promoDm + info.counts.channels})`]], "me");
          const pConfirm = h("input", { type: "text", placeholder: "SEND", maxlength: "4", autocomplete: "off", "aria-label": "Type SEND to confirm" });
          const pBtn = h("button", { class: "btn red", type: "button", text: "Send the advertisement" });
          pBtn.addEventListener("click", () => busy(pBtn, async () => {
            const r = await api("/api/admin/broadcast", { kind: "promo", audience: pWho.value, confirm: pConfirm.value });
            toast(pWho.value === "me" ? "Preview sent to your DMs." : `Sending to ${r.total} places. You can leave this page.`, "ok");
            if (pWho.value !== "me") pConfirm.value = "";
            await refresh();
          }));
          return h("div", { class: "panel" }, h("h3", { text: "Advertise FanaticalGrabber" }),
            h("p", { class: "muted small", text: "A message from you (marked as from the bot developer) that lists the extension's features with example pictures, with Get it, Open the dashboard and No more promos buttons. Only people the bot already knows are messaged, and anyone who presses No more promos is skipped from then on. Always send yourself the preview first. /bot grabberad does the same in Discord." }),
            h("div", { class: "grid three" }, ["hero", "cart", "paid"].map(n => h("img", { src: `/grabber-ad-${n}.png`, alt: "", loading: "lazy", width: "300", height: "158", class: "ad-thumb" }))),
            h("div", { class: "row" }, field("Send to", pWho), field("Type SEND to confirm", pConfirm)), h("div", { class: "row" }, pBtn));
        };
        const quickPanel = () => {
          const kinds = { restart: ["Restarting for an update", "Tells people the bot is restarting, that nothing is lost and that missed alerts catch up."], dev: ["Still in active development", "A heads-up that updates and random downtime are normal while the bot is being built, and where to report bugs."], thanks: ["Thank you", "A thank-you note from you for using the bot."] };
          const pick = select(Object.entries(kinds).map(([k, v]) => [k, v[0]]), "restart");
          const pWho = select([["me", "Only me (preview)"], ["dm", `DMs to members (${info.counts.dm})`], ["channels", `Every server's #announcements channel (${info.counts.channels})`], ["both", `Both (${info.counts.dm + info.counts.channels})`]], "me");
          const pConfirm = h("input", { type: "text", placeholder: "SEND", maxlength: "4", autocomplete: "off", "aria-label": "Type SEND to confirm" });
          const img = h("img", { src: "/notice-restart.png", alt: "", class: "preset-img", width: "1200", height: "630", loading: "lazy" });
          const blurb = h("p", { class: "muted small", text: kinds.restart[1] });
          pick.addEventListener("change", () => { img.src = `/notice-${pick.value}.png`; blurb.textContent = kinds[pick.value][1]; });
          const pBtn = h("button", { class: "btn red", type: "button", text: "Send this announcement" });
          pBtn.addEventListener("click", () => busy(pBtn, async () => {
            const r = await api("/api/admin/broadcast", { kind: "preset", preset: pick.value, audience: pWho.value, confirm: pConfirm.value });
            toast(pWho.value === "me" ? "Preview sent to your DMs." : `Sending to ${r.total} places. You can leave this page.`, "ok");
            if (pWho.value !== "me") pConfirm.value = "";
            await refresh();
          }));
          return h("div", { class: "panel" }, h("h3", { text: "Ready-made announcements" }),
            h("p", { class: "muted small", text: "Pre-written, with a picture and buttons, marked as from the bot developer. Send yourself a preview first." }),
            h("div", { class: "row" }, field("Announcement", pick), field("Send to", pWho), field("Type SEND to confirm", pConfirm)), blurb, img, h("div", { class: "row" }, pBtn));
        };
        const paintPreview = () => {
          count.textContent = msg.value.length + " / 1500";
          preview.replaceChildren(h("div", { class: "muted small", text: "Official message from the Steam Value Checker developer" }), h("strong", { text: title.value.trim() || "Steam Value Checker notice" }), h("div", { text: msg.value.trim() || "Your message shows here." }), h("div", { class: "muted small", text: "Sent by the bot's owner/developer to every server using Steam Value Checker. It is not from this server's staff." }));
        };
        who.addEventListener("change", () => syncMention());
        const syncMention = () => { mentionRow.hidden = who.value === "dm" || who.value === "me"; if (mentionRow.hidden) mention.value = "none"; };
        const paintWho = () => {
          const c = info.counts;
          who.replaceChildren(...[["dm", `DMs to members (${c.dm})`], ["channels", `Every server's #announcements channel (${c.channels})`], ["both", `Both (${c.dm + c.channels})`]].map(([v, t]) => h("option", { value: v, text: t })));
        };
        const paintProgress = cur => {
          if (!cur) { progress.replaceChildren(); return; }
          const done = cur.sent + cur.failed;
          progress.replaceChildren(h("p", { text: `Sending #${cur.id}: ${done} of ${cur.total} (${cur.failed} could not be delivered)` }), (() => { const bar = h("div", { class: "bar" }); const f = h("div", { class: "fill" }); f.style.width = Math.round(done / Math.max(1, cur.total) * 100) + "%"; bar.append(f); return bar; })());
        };
        const paintHistory = () => {
          history.replaceChildren(info.history.length ? table(["When", "Title", "To", "Delivered"], info.history.map(b => [new Date(b.at).toLocaleString(), b.title, b.audience === "me" ? "test" : b.audience, `${b.sent} of ${b.total}${b.failed ? " (" + b.failed + " failed)" : ""}${b.done ? "" : " …"}`])) : h("p", { class: "muted", text: "Nothing sent yet." }));
        };
        async function refresh() {
          info = await api("/api/admin/broadcast");
          const keep = who.value; paintWho(); if (keep) who.value = keep; syncMention();
          paintProgress(info.current); paintHistory();
          clearTimeout(timer);
          if (info.current && document.body.contains(box)) timer = setTimeout(() => refresh().catch(() => {}), 2500);
        }
        const go = async audience => {
          const r = await api("/api/admin/broadcast", { title: title.value, body: msg.value, audience, confirm: confirm.value, mention: mention.value });
          toast(audience === "me" ? "Test sent to you." : `Sending to ${r.total} places. You can leave this page.`, "ok");
          if (audience !== "me") confirm.value = "";
          await refresh();
        };
        test.addEventListener("click", () => busy(test, () => go("me")));
        send.addEventListener("click", () => busy(send, () => go(who.value)));
        for (const el of [title, msg]) el.addEventListener("input", paintPreview);
        paintPreview();
        refresh().then(() => {
          box.replaceChildren(
            h("div", { class: "panel" }, h("h3", { text: "Announce something" }),
              h("p", { class: "muted small", text: "For things like downtime for an update. DMs go out about one a second, so a large list takes a while. Members whose DMs keep failing are skipped." }),
              field("Title", title), field("Message", msg), count, h("h4", { text: "Preview" }), preview,
              h("div", { class: "row" }, field("Send to", who), mentionRow, field("Type SEND to confirm", confirm)),
              h("p", { class: "muted small", text: "The ping only goes on the server-channel copy (never DMs). Each server needs to let the bot mention everyone, otherwise Discord just shows the text." }),
              h("div", { class: "row" }, test, send)),
            quickPanel(), promoPanel(),
            h("div", { class: "panel" }, h("h3", { text: "Progress" }), progress, h("h4", { text: "Recent announcements" }), history));
        }).catch(e => box.replaceChildren(h("div", { class: "notice warn", text: e.message })));
        return [box];
      };

      const giveaway = () => {
        const title = h("input", { type: "text", maxlength: "100", placeholder: "Title (optional, made from the prizes)", "aria-label": "Giveaway title" });
        const game = h("input", { type: "text", maxlength: "100", placeholder: "Game name for the artwork (optional)", "aria-label": "Game name" });
        const desc = h("textarea", { class: "short", rows: "3", maxlength: "1500", placeholder: "Extra text shown on the giveaway (optional)", "aria-label": "Description" });
        const keys = h("textarea", { rows: "6", maxlength: "20000", autocomplete: "off", spellcheck: "false", placeholder: "Hades | AAAAA-BBBBB-CCCCC\nCeleste | DDDDD-EEEEE-FFFFF\n(a key on its own uses the game name)", "aria-label": "Prize keys" });
        const length = h("input", { type: "text", value: "24h", maxlength: "20", placeholder: "24h, 3d, 1w", "aria-label": "How long it runs" });
        const claim = h("input", { type: "number", min: "1", max: "168", value: "48", "aria-label": "Hours to claim" });
        const gImage = h("input", { type: "url", maxlength: "500", placeholder: "https://… (picture, GIF or video)", "aria-label": "Big picture link" });
        const gThumb = h("input", { type: "url", maxlength: "500", placeholder: "https://… (small picture or GIF)", "aria-label": "Small picture link" });
        const gColor = h("input", { type: "text", maxlength: "8", placeholder: "#ff9800", "aria-label": "Color" });
        const gLabel = h("input", { type: "text", maxlength: "40", placeholder: "Enter giveaway", "aria-label": "Enter button text" });
        const gRegions = h("input", { type: "text", maxlength: "200", placeholder: "US, CA, EU (blank = anywhere)", "aria-label": "Regions allowed" }), gVideo = window.GwExtras.videoInput();
        const gp = giveawayPreview(() => ({ title: title.value.trim(), desc: desc.value.trim(), keys: keys.value, image: gImage.value, thumb: gThumb.value, color: gColor.value, regions: gRegions.value, hasVideo: Boolean(gVideo.files && gVideo.files.length), label: gLabel.value.trim(), length: length.value.trim(), host: "you" }));
        for (const el of [title, desc, keys, gImage, gThumb, gColor, gLabel, length, gRegions]) el.addEventListener("input", gp.paint);
        gVideo.addEventListener("change", gp.paint);
        const steamOnly = h("input", { type: "checkbox" });
        const who = select([["both", "Every server's giveaway channel and DMs"], ["channels", "Server giveaway channels only"], ["dm", "DMs only"]], "both");
        const confirm = h("input", { type: "text", placeholder: "SEND", maxlength: "4", autocomplete: "off", "aria-label": "Type SEND to confirm" });
        const go = h("button", { class: "btn red", type: "button", text: "Start the giveaway" });
        // Who hosts it, and what people should do to be considered.
        const hostKind = select([["network", "Me (cross-server giveaway hosted by you)"], ["partner", "A partner"]], "network");
        const pName = h("input", { type: "text", maxlength: "60", placeholder: "Partner name", "aria-label": "Partner name" });
        const pLogo = h("input", { type: "url", maxlength: "300", placeholder: "Logo image link (https, optional)", "aria-label": "Partner logo" });
        const pWeb = h("input", { type: "url", maxlength: "300", placeholder: "https://partner-website.com", "aria-label": "Partner website" });
        const pDiscord = h("input", { type: "url", maxlength: "300", placeholder: "https://discord.gg/invite", "aria-label": "Partner Discord" });
        const pX = h("input", { type: "url", maxlength: "300", placeholder: "https://x.com/partner", "aria-label": "Partner X" });
        const pOther = h("input", { type: "url", maxlength: "300", placeholder: "Another link (Twitch, YouTube, Steam page...)", "aria-label": "Another partner link" });
        const partnerBox = h("div", { class: "panel", hidden: true }, h("h4", { text: "Partner" }), h("p", { class: "muted small", text: "The giveaway shows the partner as host, with these links. You still hold the keys and handle key problems." }),
          h("div", { class: "grid two" }, field("Name", pName), field("Logo", pLogo), field("Website", pWeb), field("Discord", pDiscord), field("X (Twitter)", pX), field("Another link", pOther)));
        hostKind.addEventListener("change", () => { partnerBox.hidden = hostKind.value !== "partner"; });
        const stepRows = h("div"), stepList = [];
        const addStep = (kind = "follow_x") => {
          const kinds = (info && info.stepKinds) || [];
          const sel = select(kinds.map(k => [k.id, k.label]), kind), url = h("input", { type: "url", maxlength: "300", placeholder: "https://…", "aria-label": "Step link" }), label = h("input", { type: "text", maxlength: "80", placeholder: "Button text (optional)", "aria-label": "Step text" });
          const hint = h("span", { class: "muted small" });
          const setHint = () => { const k = kinds.find(x => x.id === sel.value); hint.textContent = k ? k.hint : ""; };
          sel.addEventListener("change", setHint); setHint();
          const del = h("button", { class: "btn gray small", type: "button", text: "Remove" });
          const row = h("div", { class: "setup-row" }, h("div", { class: "row" }, sel, label, url, del), hint);
          const entry = { sel, url, label, row };
          del.addEventListener("click", () => { stepList.splice(stepList.indexOf(entry), 1); row.remove(); });
          stepList.push(entry); stepRows.append(row);
        };
        const addStepBtn = h("button", { class: "btn gray small", type: "button", text: "Add an entry step" });
        addStepBtn.addEventListener("click", () => { if (stepList.length >= 8) { toast("Up to 8 steps.", "warn"); return; } addStep(); });
        const box = h("div"), list = h("div");
        let info = null, timer = 0;
        const paintList = () => {
          const when = t => new Date(t).toLocaleString();
          list.replaceChildren(info.list.length ? table(["#", "Title", "Host", "Status", "Prizes", "Entries", "Shown in", "Ends"], info.list.map(g => [g.id, g.title, g.host || "-", g.status, g.outcome || "-", g.entries,
            `${g.channels} server${g.channels === 1 ? "" : "s"}, ${g.dms} DM${g.dms === 1 ? "" : "s"}${g.spread && !g.spread.done ? ` (sending ${g.spread.sent + g.spread.failed}/${g.spread.total})` : g.spread && g.spread.failed ? ` (${g.spread.failed} failed)` : ""}`, when(g.ends_at)])) : h("p", { class: "muted", text: "No network-wide giveaways yet." }));
          list.prepend(pendingPanel(info.pending, id => api("/api/admin/giveaways/remind", { key_id: id }), refresh));
          // Why a send missed someone, so a server that didn't get it isn't a mystery.
          const bad = info.list.filter(g => g.spread && g.spread.errors && g.spread.errors.length);
          if (bad.length) list.prepend(h("div", { class: "notice warn" }, h("b", { text: "Some copies didn't go out. " }), ...bad.flatMap(g => [h("div", { class: "small", text: `#${g.id} ${g.title}:` }), h("ul", {}, [...new Set(g.spread.errors.map(e => `${e.what}: ${e.reason}`))].slice(0, 8).map(t => h("li", { text: t })))])));
          if (info.skipped && info.skipped.length) list.prepend(h("div", { class: "notice" }, h("b", { text: "Not reached: " }), `${info.skipped.join(", ")}. These servers have no giveaway, alert or announcements channel set, so there was nowhere to post.`));
          // End buttons sit under the table so the table helper stays plain text.
          const active = info.list.filter(g => g.status === "active");
          if (active.length) list.append(h("div", { class: "row" }, ...active.map(g => { const b = h("button", { class: "btn gray small", type: "button", text: `End #${g.id} now and draw` }); b.addEventListener("click", () => busy(b, async () => { const r = await api("/api/admin/giveaways/end", { id: g.id }); toast(`Ended. ${r.winners} winner${r.winners === 1 ? "" : "s"} drawn.`, "ok"); await refresh(); })); return b; })));
        };
        async function refresh() {
          info = await api("/api/admin/giveaways");
          paintList();
          clearTimeout(timer);
          if (info.list.some(g => g.spread && !g.spread.done) && document.body.contains(box)) timer = setTimeout(() => refresh().catch(() => {}), 2500);
        }
        go.addEventListener("click", () => busy(go, async () => {
          const vid = await window.GwExtras.videoBody(gVideo);
          const r = await api("/api/admin/giveaways/create", { ...vid, regions: gRegions.value, title: title.value, game: game.value, description: desc.value, image: gImage.value, thumbnail: gThumb.value, color: gColor.value, button_label: gLabel.value, steam_verified: steamOnly.checked, keys: keys.value, length: length.value, claim_hours: claim.value, audience: who.value, confirm: confirm.value,
            host: hostKind.value === "partner" ? { kind: "partner", name: pName.value, logo: pLogo.value, links: [["Website", pWeb.value], ["Discord", pDiscord.value], ["X", pX.value], ["", pOther.value]].filter(l => l[1].trim()).map(l => ({ label: l[0], url: l[1] })) } : { kind: "network" },
            steps: stepList.map(e => ({ kind: e.sel.value, url: e.url.value, label: e.label.value })) });
          toast(`Your giveaway is live with ${r.prizes} prize${r.prizes === 1 ? "" : "s"}. Sending it out to ${r.total} more place${r.total === 1 ? "" : "s"}.`, "ok");
          if (r.videoDropped) toast("The giveaway went out without your video. Give the bot Attach Files in that channel, and keep the video under the server's upload limit.", "warn");
          if (r.skipped && r.skipped.length) toast(`I couldn't post in ${r.skipped.join(", ")}, so I started it from another server. Check the bot's permissions in that channel.`, "warn");
          confirm.value = ""; keys.value = "";
          await refresh();
        }));
        refresh().then(() => {
          if (!info.available) { box.replaceChildren(h("div", { class: "notice warn", text: "Giveaways are not set up on this bot (the owner needs to set KEY_ENCRYPTION_SECRET)." })); return; }
          box.replaceChildren(
            h("div", { class: "panel" }, h("h3", { text: "Network-wide giveaway" }),
              h("p", { class: "muted small", text: `One giveaway, shown in every server's giveaway channel (or its alert channel if none is set) and in DMs. Entries from everywhere count together, and winners are drawn once. It is posted in ${info.destinations.length} server${info.destinations.length === 1 ? "" : "s"} and ${info.dm} member DM${info.dm === 1 ? "" : "s"}. Winners claim their key by DM.` }),
              info.destinations.length ? null : h("div", { class: "notice warn", text: "No server has a giveaway or alert channel yet. Set one on the Giveaways page (Server settings) first." }),
              field("Title", title), field("Game (for the artwork)", game), field("Description", desc),
              field("Regions allowed", gRegions), h("p", { class: "muted small", text: window.GwExtras.regionHelp }),
              h("label", { class: "check" }, steamOnly, " Only Steam Verified members can enter (checked on their account, so it works in every server)"),
              field("Prizes (one per line)", keys), prizeButtons(keys, gp.paint),
              h("p", { class: "muted small", text: "Game keys, Nitro links and gift card codes are handed out by the Claim button. Money and other prizes have no code: you get a DM when a winner claims one and you send it yourself." }),
              h("h4", { text: "Look" }),
              h("div", { class: "grid two" }, h("div", {},
                h("div", { class: "row" }, field("Big picture, GIF or video link", gImage), field("Small picture or GIF link", gThumb)),
                field("Or upload a video (MP4, WebM or MOV, up to 10 MB)", gVideo),
                h("div", { class: "row" }, field("Color", gColor), field("Enter button text", gLabel)),
                h("p", { class: "muted small", text: "Leave the big picture empty to use the game's artwork. Use a direct, permanent link to a picture (.png, .jpg, .gif, .webp)." })),
                h("div", {}, h("b", { text: "Preview" }), gp.el)),
              field("Hosted by", hostKind), partnerBox,
              h("h4", { text: "Entry steps (optional)" }), h("p", { class: "muted small", text: "Ask people to do something first, like following a partner on X or joining their Discord. Each step shows as a numbered line and a link button on the giveaway. Discord cannot check these, so the post says winners may be checked." }), stepRows, addStepBtn,
              h("div", { class: "row" }, field("Runs for", length), field("Hours to claim a key", claim)),
              h("div", { class: "row" }, field("Send to", who), field("Type SEND to confirm", confirm)),
              go),
            h("div", { class: "panel" }, h("h3", { text: "Your network-wide giveaways" }), list));
        }).catch(e => box.replaceChildren(h("div", { class: "notice warn", text: e.message })));
        return [box];
      };

      // Community features across every server: what is built, what is used, and which giveaway partners ran what. Counts only.
      const community = () => {
        const box = h("div", { class: "muted", text: "Loading…" });
        api("/api/admin/community").then(c => {
          const t = c.totals, u = c.usage, g = c.giveaways;
          const use = k => (u[k] ? u[k].n : 0);
          const last = k => (u[k] && u[k].last_at ? new Date(u[k].last_at).toLocaleDateString() : "never");
          const row = (label, key) => [label, n0(use(key)), last(key)];
          box.className = "";
          box.replaceChildren(
            c.membersIntent ? null : h("div", { class: "notice warn", text: "Server Members Intent is off for the bot, so welcome messages and invite tracking are paused everywhere. Turn it on in the Discord Developer Portal (Bot, Privileged Gateway Intents) and restart." }),
            h("div", { class: "grid four" }, tile("Servers using community", t.servers, `${t.built} built with /manage community setup`), tile("Welcome on", t.welcomeOn, "servers"), tile("XP on", t.xpOn, `${n0(t.xpMembers)} members earning`), tile("Total XP earned", n0(t.xpTotal)),
              tile("Joins tracked", n0(t.joins), `${n0(t.referred)} through an invite`), tile("Personal invite links", n0(t.inviteLinks)), tile("Level rewards set", n0(t.levelRoles), `${n0(t.rewards)} referral rewards`), tile("Role picker roles", n0(t.selfRoles)), tile("Moderation cases", n0(t.modCases), `${t.modServers} servers · ${n0(t.activeWarnings)} active warnings`)),
            h("div", { class: "panel" }, h("h3", { text: "Feature use" }),
              table(["What", "Times", "Last used"], [row("Server built automatically (fresh server)", "setup_auto"), row("Server built with /manage community setup", "setup_manual"), row("Server built from the dashboard", "dash_setup"), row("Channels created", "channels_created"), row("Welcome messages posted", "welcomes"), row("Welcome DMs sent", "welcome_dms"), row("Welcome DMs that could not be delivered", "welcome_dm_failed"),
                row("Joins tracked", "joins_tracked"), row("Referrals credited", "referrals"), row("Invite links made", "invite_links"), row("Level-ups", "level_ups"), row("Roles picked from the panel", "role_picks"), row("Emoji added", "emoji_added"), row("Emoji added from the dashboard", "dash_emoji"), row("Emoji images uploaded on the dashboard", "dash_emoji_upload"), row("Steam Verified roles given", "steam_verified_roles"),
                row("/server rank used", "cmd:rank"), row("/server levels used", "cmd:levels"), row("/server invites me used", "cmd:invites/me"), row("/server invites top used", "cmd:invites/top"), row("/server invites link used", "cmd:invites/link"), row("/manage emoji import used", "cmd:emoji/import"), row("/manage emoji list used", "cmd:emoji/list"), row("/manage community used", "cmd:community/status"),
                row("Warnings", "mod_warn"), row("Timeouts", "mod_timeout"), row("Timeouts lifted", "mod_untimeout"), row("Kicks", "mod_kick"), row("Bans", "mod_ban"), row("Unbans", "mod_unban"), row("Message cleanups", "mod_purge"), row("Messages deleted", "mod_messages_cleared"), row("Warnings cleared", "mod_warnings_cleared"), row("Moderation done on the dashboard", "dash_mod"), row("/mod warn used", "cmd:mod/warn"), row("/mod timeout used", "cmd:mod/timeout"), row("/mod kick used", "cmd:mod/kick"), row("/mod ban used", "cmd:mod/ban"), row("/mod purge used", "cmd:mod/purge"), row("/mod cases used", "cmd:mod/cases")])),
            h("div", { class: "panel" }, h("h3", { text: "Cross-server giveaways" }),
              h("div", { class: "grid four" }, tile("Cross-server giveaways", g.crossServer), tile("Hosted by a partner", g.partner), tile("With entry steps", g.withSteps), tile("Entries", n0(g.crossEntries))),
              h("h4", { text: "Partners" }), table(["Partner", "Giveaways", "Entries"], g.partners.map(p => [p.name, p.giveaways, n0(p.entries)]))),
            h("div", { class: "panel" }, h("h3", { text: `Servers (${c.servers.length})` }),
              table(["Server", "Built", "Welcome", "XP", "Members with XP", "XP total", "Joins", "Through an invite", "Level roles", "Mod cases"], c.servers.map(r => [r.name || r.id, r.setup_at ? "Yes" : "No", r.welcome_on ? "On" : "Off", r.xp_on ? `On ×${r.xp_mult}` : "Off", n0(r.xp_members), n0(r.xp_total), n0(r.joins), n0(r.referred), r.level_roles, n0(r.mod_cases)]))));
        }).catch(e => box.replaceChildren(h("div", { class: "notice warn", text: e.message })));
        return [box];
      };

      const giftsTab = () => {
        const box = h("div", { class: "muted", text: "Loading…" });
        const load = () => api("/api/admin/gifts").then(r => {
          box.className = "";
          const act = (id, action, label, cls) => { const b = h("button", { class: "btn " + cls + " small", type: "button", text: label }); b.addEventListener("click", () => busy(b, async () => { await api("/api/admin/gifts", { claimer: id, action }); toast("Done.", "ok"); await load(); })); return b; };
          const who = x => `${x.name || "Unknown name"} (${x.claimer_id})`;
          box.replaceChildren(h("div", { class: "panel" }, h("h3", { text: "Gift mark reports" }),
            h("p", { class: "muted small", text: "List owners release a mark and report it when it looks fake. Three reports in 60 days blocks the account from marking gifts automatically, and its marks are removed." }),
            r.reports.length ? h("div", { class: "scroll-y" }, r.reports.map(x => h("div", { class: "bug-card" }, h("strong", { text: who(x) }),
              h("div", { class: "muted small", text: `${x.reports} report${x.reports === 1 ? "" : "s"} · last ${when(x.last_at)} · lists: ${x.lists || "?"} · games: ${x.games || "?"} · holds ${x.holding} now` }),
              h("div", { class: "row" }, x.banned ? h("span", { class: "chip warn", text: "Blocked" }) : act(x.claimer_id, "ban", "Block", "red"), x.banned ? act(x.claimer_id, "unban", "Unblock and clear", "gray") : act(x.claimer_id, "dismiss", "Dismiss reports", "gray"))))) : h("p", { class: "muted", text: "No reports." })),
            h("div", { class: "panel" }, h("h3", { text: "Blocked from gift marks" }),
              r.bans.length ? h("div", { class: "scroll-y" }, r.bans.map(x => h("div", { class: "row" }, h("span", { text: `${x.claimer_id} · ${x.auto ? "automatic" : "by you"} · ${when(x.at)} · ${x.reason}` }), act(x.claimer_id, "unban", "Unblock", "gray")))) : h("p", { class: "muted", text: "Nobody is blocked." })));
        }).catch(e => { box.className = ""; box.replaceChildren(h("div", { class: "notice warn", text: e.message })); });
        load();
        return [box];
      };
      const socialTab = () => {
        const box = h("div", { class: "muted", text: "Loading…" });
        const load = () => api("/api/admin/social").then(r => {
          box.className = "";
          const act = (body, label, cls, ok) => { const b = h("button", { class: "btn " + cls + " small", type: "button", text: label }); b.addEventListener("click", () => busy(b, async () => { await api("/api/admin/social", body); toast(ok, "ok"); await load(); })); return b; };
          box.replaceChildren(h("div", { class: "panel" }, h("h3", { text: "Reported posts" }),
            h("p", { class: "muted small", text: "Three different people reporting a post hides it until you decide. Restore keeps it, Delete removes it and any replies, and Block stops the author posting." }),
            r.reports.length ? h("div", { class: "scroll-y" }, r.reports.map(x => h("div", { class: "bug-card" }, h("strong", { text: `${x.by.name}${x.slug ? " (@" + x.slug + ")" : ""}` }),
              h("div", { class: "muted small", text: `${x.reports} report${x.reports === 1 ? "" : "s"} · last ${when(x.last_at)}${x.hidden ? " · hidden" : ""}${x.reasons ? " · " + x.reasons : ""}` }),
              h("p", { text: x.snapshot }),
              h("div", { class: "row" }, act({ action: "dismiss", id: x.feed_id }, "Restore", "gray", "Restored."), act({ action: "delete", id: x.feed_id }, "Delete", "red", "Deleted."), act({ action: "ban", id: x.feed_id, reason: "reported posts" }, "Delete and block author", "red", "Blocked."))))) : h("div", { class: "empty", text: "Nothing reported." })),
            h("div", { class: "panel" }, h("h3", { text: "Blocked from posting" }),
              r.bans.length ? h("div", { class: "scroll-y" }, r.bans.map(x => h("div", { class: "row" }, h("span", { text: `${x.by.name}${x.slug ? " (@" + x.slug + ")" : ""} · ${when(x.at)}${x.reason ? " · " + x.reason : ""}` }), act({ action: "unban", user: x.discord_id }, "Unblock", "gray", "Unblocked.")))) : h("div", { class: "empty", text: "Nobody." })));
        }).catch(e => { box.className = ""; box.replaceChildren(h("div", { class: "notice warn", text: e.message })); });
        load();
        return [box];
      };
      const requestsTab = () => { const box = h("div", { class: "muted", text: "Loading…" }); requestList(box, { admin: true }).then(() => { box.className = ""; }); return [box]; };
      const musicTab = () => {
        const box = h("div", { class: "muted", text: "Loading…" });
        const load = () => api("/api/admin/music").then(r => {
          box.className = "";
          const force = (gid, action, b) => busy(b, async () => { await api("/api/admin/music", { guild_id: gid, action }); toast(action === "leave" ? "Left." : "Stopped.", "ok"); await load(); });
          const rows = r.sessions.map(x => { const st = h("button", { class: "btn gray small", type: "button", text: "Stop" }), lv = h("button", { class: "btn red small", type: "button", text: "Leave" }); st.addEventListener("click", () => force(x.guildId, "stop", st)); lv.addEventListener("click", () => force(x.guildId, "leave", lv));
            return h("div", { class: "cal-row" }, h("span", { text: x.track?.live ? "📻" : "🎵" }), h("div", {}, h("b", { text: x.guildName }), h("div", { class: "muted small", text: [x.channelName ? "in " + x.channelName : "", x.track ? x.track.title + (x.track.live ? " (live)" : x.track.auto ? " (Auto DJ)" : "") : "idle", `${x.queue} queued`, `${x.listeners} listening`, x.autoDj ? "Auto DJ on" : ""].filter(Boolean).join(" · ") })), h("div", { class: "row" }, st, lv)); });
          box.replaceChildren(h("div", { class: "panel" }, h("h3", { text: `Voice sessions (${r.sessions.length})` }), h("p", { class: "muted small", text: "Every server where the bot is in a voice channel right now. Stop clears the queue and the Auto DJ stays quiet until someone adds a song; Leave disconnects." }), r.sessions.length ? h("div", { class: "scroll-y tall" }, ...rows) : h("p", { class: "muted", text: "The bot isn't in any voice channel." })));
        }).catch(e => { box.className = ""; box.replaceChildren(h("div", { class: "notice warn", text: e.message })); });
        load();
        return [box];
      };
      const panelsTab = () => {
        const box = h("div", { class: "muted", text: "Loading…" });
        api("/api/admin/panels").then(r => {
          box.className = "";
          box.replaceChildren(h("div", { class: "panel" }, h("h3", { text: `Run from panels (${n0(r.total)})` }),
            h("p", { class: "muted small", text: "How often each command was run with the Run button in a menu or panel. Typed commands are not counted here." }),
            r.rows.length ? table(["Command", "Runs"], r.rows.map(x => [x.command, n0(x.runs)])) : h("p", { class: "muted", text: "Nothing yet." })));
        }).catch(e => { box.className = ""; box.replaceChildren(h("div", { class: "notice warn", text: e.message })); });
        return [box];
      };
      // ---- live settings: every adjustable value, saved with one button and applied at once ----
      const settingsPanels = (view, groupKeys, after) => {
        const inputs = new Map();
        const control = def => {
          let el;
          if (def.type === "bool") { el = h("input", { type: "checkbox", checked: Boolean(def.value) }); inputs.set(def.key, () => el.checked); return h("label", { class: "check" }, el, " " + def.label); }
          if (def.type === "int") el = h("input", { type: "number", min: def.min, max: def.max, step: "1", value: String(def.value) });
          else if (def.type === "enum") el = select(def.options, def.value);
          else if (def.type === "text") { el = h("textarea", { rows: "4", maxlength: String(def.maxLen) }); el.value = def.value; }
          else if (def.key === "ai_model") {
            const anth = (view.settings.find(x => x.key === "ai_provider") || {}).value === "anthropic";
            const known = anth && view.models.some(([v]) => v === def.value);
            const pick = select(anth ? [...view.models, ["__custom", "Another model…"]] : [["__custom", "Model name…"]], known ? def.value : "__custom");
            if (!anth) pick.hidden = true;
            const custom = h("input", { type: "text", maxlength: "100", placeholder: "model name", value: known ? "" : def.value });
            custom.hidden = known;
            pick.addEventListener("change", () => { custom.hidden = pick.value !== "__custom"; });
            inputs.set(def.key, () => (pick.value === "__custom" ? custom.value.trim() : pick.value));
            const dl = h("datalist", { id: "ai-bot-models" }); custom.setAttribute("list", "ai-bot-models"); custom.setAttribute("autocomplete", "off");
            const loadBtn = h("button", { class: "btn gray small", type: "button", text: "Load models" });
            loadBtn.addEventListener("click", () => busy(loadBtn, async () => {
              const r = await api("/api/admin/ai/models", {});
              dl.replaceChildren(...r.models.map(m => h("option", { value: m })));
              if (pick.value !== "__custom") { custom.value = def.value; pick.value = "__custom"; custom.hidden = false; }
              toast(`${r.models.length} models found. Click the model box to pick one.`, "ok");
            }));
            return h("div", {}, h("label", { text: def.label }), pick, custom, dl, h("div", { class: "row" }, loadBtn), h("p", { class: "muted small", text: def.help + " Load models asks the service what the bot's key can use." }));
          } else el = h("input", { type: "text", maxlength: String(def.maxLen), value: def.value });
          inputs.set(def.key, () => (def.type === "int" ? Number(el.value) : el.value));
          return h("div", {}, h("label", { text: def.label }), el, h("p", { class: "muted small", text: def.help + (def.type === "int" ? ` (${def.min} to ${def.max}, normally ${def.default})` : "") }));
        };
        const save = h("button", { class: "btn green", type: "button", text: "Save settings" });
        const panels = groupKeys.map(g => h("div", { class: "panel" }, h("h3", { text: view.groups[g] }), ...view.settings.filter(x => x.group === g).map(x => (x.type === "bool" ? h("div", {}, control(x), h("p", { class: "muted small", text: x.help })) : control(x)))));
        save.addEventListener("click", () => busy(save, async () => {
          const patch = {};
          for (const [k, get] of inputs) patch[k] = get();
          const r = await api("/api/admin/settings", { patch });
          toast(r.changed.length ? `Saved. ${r.changed.length} changed, live now.` : "Nothing changed.", "ok");
          if (after) after(r);
        }));
        return [...panels, h("div", { class: "row" }, save)];
      };

      const aiTab = () => {
        const box = h("div", { class: "muted", text: "Loading…" });
        const load = () => api("/api/admin/ai").then(r => {
          box.className = "";
          const t = r.stats[0] || {};
          const week = r.stats.slice(0, 7).reduce((a, d) => ({ answers: a.answers + d.answers, errors: a.errors + d.errors, inTok: a.inTok + d.inTok, outTok: a.outTok + d.outTok }), { answers: 0, errors: 0, inTok: 0, outTok: 0 });
          const status = h("div", { class: "grid" },
            tile("API key", r.available ? "Set" : "Coming soon", r.available ? "The bot can reach the AI provider." : "No key yet, so servers get the bot's own answers for prices, free games, wishlist and library. Add the AI_API_KEY secret to switch the full AI on."),
            tile("“Hey AI” text", r.phrase ? "Works" : "Mentions only", r.phrase ? "Message Content intent is on." : "Turn on Message Content intent in the Developer Portal."),
            tile("Answers today", n0(t.answers), `${n0(t.errors)} failed · ${t.ms ? t.ms + " ms average" : "no timing yet"}`),
            tile("Last 7 days", n0(week.answers), `${n0(week.inTok + week.outTok)} tokens`),
            tile("Servers using it", n0(r.servers.filter(x => x.on).length), `${n0(r.blockedServers.length)} blocked · ${n0(r.blockedUsers.length)} people blocked`));
          const lastErr = r.lastError ? h("p", { class: "muted small", text: "Last problem: " + r.lastError }) : null;

          // try it
          const q = h("input", { type: "text", maxlength: "500", placeholder: "Ask it something, like a member would", value: "What should I play after Hades?" });
          const out = h("div", { class: "ai-test-out muted small", text: "" });
          const go = h("button", { class: "btn gray", type: "button", text: "Try it" });
          go.addEventListener("click", () => busy(go, async () => {
            out.className = "ai-test-out muted small"; out.textContent = "Thinking…";
            const a = await api("/api/admin/ai/test", { question: q.value });
            if (!a.ok) { out.className = "notice warn"; out.textContent = a.error || "No answer."; return; }
            out.className = "ai-test-out"; out.textContent = a.text;
            out.append(h("div", { class: "muted small", text: `${a.model} · ${a.ms} ms · ${a.inTok} in, ${a.outTok} out tokens. Uses the settings above, ignores the limits.` }));
          }));
          const tryIt = h("div", { class: "panel" }, h("h3", { text: "Try it" }), h("div", { class: "row" }, q, go), out);

          // usage by day
          const usage = h("div", { class: "panel" }, h("h3", { text: "Last 14 days" }),
            table(["Day", "Answers", "Failed", "Avg ms", "Tokens in", "Tokens out"], r.stats.map(d => [d.day, n0(d.answers), n0(d.errors), d.ms ? n0(d.ms) : "–", n0(d.inTok), n0(d.outTok)])),
            h("p", { class: "muted small", text: "Days are UTC. Tokens are what the provider counted, so you can work out the cost from its price list." }));

          // servers
          const rows = r.servers.map(x => {
            const cap = h("input", { type: "number", min: "0", max: "50000", placeholder: "normal", value: x.cap === null ? "" : String(x.cap), "aria-label": "Daily limit for " + (x.name || x.id) });
            const doIt = (label, body, cls = "btn gray small") => { const b = h("button", { class: cls, type: "button", text: label }); b.addEventListener("click", () => busy(b, async () => { await api("/api/admin/ai/server", { id: x.id, ...body }); toast("Done.", "ok"); await load(); })); return b; };
            const plus = h("button", { class: "btn gray small", type: "button", text: x.plus ? "Remove Plus" : "Give Plus" });
            plus.addEventListener("click", () => busy(plus, async () => { await api("/api/admin/ai/server", { id: x.id, plus: !x.plus }); await load(); }));
            const block = h("button", { class: "btn " + (x.blocked ? "gray" : "red") + " small", type: "button", text: x.blocked ? "Unblock" : "Block" });
            block.addEventListener("click", () => busy(block, async () => { await api("/api/admin/ai/block", { kind: "server", id: x.id, on: !x.blocked }); await load(); }));
            return h("tr", {}, h("td", {}, h("b", { text: x.name || "Unknown server" }), h("div", { class: "muted small", text: x.id })),
              h("td", { text: (x.main ? "Main server · " : "") + (x.blocked ? "Blocked" : x.on ? "On" : "Off") + (x.ownKey ? " · own key" : "") + (x.plus ? " · Plus" : "") + (x.interested && !x.plus ? " · wants Plus" : "") }), h("td", { class: "num", text: x.main ? `${n0(x.used)} / no limit` : `${n0(x.used)} / ${x.cap === null ? n0(r.settings.find(s => s.key === (x.plus ? "ai_plus_cap" : "ai_daily_cap")).value) : n0(x.cap)}` }),
              h("td", {}, h("div", { class: "row" }, cap, doIt("Set limit", { cap: cap.value === "" ? null : Number(cap.value) }))),
              h("td", {}, h("div", { class: "row" }, doIt("Reset today", { resetToday: true }), x.on ? doIt("Turn off", { turnOff: true }) : null, x.main ? null : plus, x.main ? null : block)));
          });
          const servers = h("div", { class: "panel" }, h("h3", { text: "Servers" }),
            h("p", { class: "muted small", text: "Servers that turned it on, used it today, have their own limit, or are blocked. A server's own limit replaces the general one (0 stops it). Servers with their own API key skip the general limit, since they pay for their answers. Your own server is never limited. Give Plus is the manual switch for the subscription that is still being built. Blocking a server silences it even if its managers switch it on." }),
            rows.length ? h("div", { class: "scroll-y" }, h("table", {}, h("thead", {}, h("tr", {}, ["Server", "Status", "Today / limit", "Daily limit", ""].map(c => h("th", { text: c })))), h("tbody", {}, rows))) : h("p", { class: "muted", text: "No server has used it yet." }));

          // blocked people and servers by ID
          const listPanel = (title, kind, ids, help) => {
            const id = h("input", { type: "text", inputmode: "numeric", maxlength: "25", placeholder: "Discord ID" });
            const add = h("button", { class: "btn gray small", type: "button", text: "Block" });
            add.addEventListener("click", () => busy(add, async () => { await api("/api/admin/ai/block", { kind, id: id.value.trim(), on: true }); toast("Blocked.", "ok"); await load(); }));
            return h("div", { class: "panel" }, h("h3", { text: title }), h("p", { class: "muted small", text: help }),
              ids.length ? h("div", { class: "chips" }, ids.map(v => { const b = h("button", { type: "button", class: "chip", text: v + " ✕", "aria-label": "Unblock " + v }); b.addEventListener("click", () => busy(b, async () => { await api("/api/admin/ai/block", { kind, id: v, on: false }); await load(); })); return b; })) : h("p", { class: "muted", text: "Nobody." }),
              h("div", { class: "row" }, id, add));
          };
          const blocked = [listPanel("Blocked people", "user", r.blockedUsers, "These people get no answers anywhere. Right-click a member in Discord with Developer Mode on to copy their ID."),
            listPanel("Blocked servers", "server", r.blockedServers, "These servers get no answers, whatever their managers choose.")];

          box.replaceChildren(status, lastErr, ...settingsPanels(r, ["ai"], load), tryIt, usage, servers, ...blocked);
        }).catch(e => { box.className = ""; box.replaceChildren(h("div", { class: "notice warn", text: e.message })); });
        load();
        return [box];
      };

      const settingsTab = () => {
        const box = h("div", { class: "muted", text: "Loading…" });
        api("/api/admin/settings").then(r => {
          box.className = "";
          box.replaceChildren(h("p", { class: "muted small", text: "Changes apply straight away, no restart. Anything you leave alone keeps its normal value. The AI companion has its own page." }), ...settingsPanels(r, Object.keys(r.groups).filter(g => g !== "ai")));
        }).catch(e => { box.className = ""; box.replaceChildren(h("div", { class: "notice warn", text: e.message })); });
        return [box];
      };
      const TABS = [["overview", "Overview", overview], ["bugs", "Bugs", bugs], ["requests", "Requests", requestsTab], ["gifts", "Gift marks", giftsTab], ["social", "Community", socialTab], ["music", "Music", musicTab], ["panels", "Panels", panelsTab], ["ai", "AI companion", aiTab], ["settings", "Bot settings", settingsTab], ["growth", "Growth", growth], ["features", "Usage", features], ["community", "Community", community], ["servers", "Servers", servers], ["members", "People", members], ["announce", "Announce", announce], ["giveaway", "Giveaway", giveaway], ["tools", "Tools and logs", tools]];
      return { TABS, tile, table, when, n0, st, hl, bot, ins, bugData, sum, daily };
    }

    // ---------- the admin panel (admin.html): a sidebar app around the same pages as adminView ----------
    const ADMIN_NAV = [
      ["Overview", [["overview", "Overview", "◧", "How the bot is doing right now."], ["system", "System health", "♥", "The bot's process, memory and sign-ins, refreshed live."]]],
      ["Insights", [["growth", "Growth", "↗", "New members and alerts over the last 30 days."], ["features", "Usage", "▦", "Who uses what, and the most watched games."], ["community", "Server features", "◎", "Community features across every server."], ["votes", "Top.gg votes", "▲", "Who voted for the bot and the XP it paid out."], ["panels", "Panel runs", "▤", "Which commands people run from menus and panels."], ["traffic", "Link traffic", "↗", "How many people open the bot's links and click through to the stores."]]],
      ["People and moderation", [["servers", "Servers", "▣", "Every server the bot is in."], ["members", "People and restrictions", "☺", "Find anyone, see who is active, restrict or restore."], ["supporters", "Supporters", "★", "Who has a supporter pass, and a way to hand one out."], ["profiles", "Profile pages", "▭", "Reported profile pages, and a way to hide or restore one."], ["gifts", "Gift marks", "🎁", "Reported gift marks and who is blocked from making them."], ["social", "Feed posts", "💬", "Reported feed posts and who is blocked from posting."]]],
      ["Publish and promote", [["announce", "Announcements", "✉", "Tell members and servers something."], ["giveaway", "Giveaways", "★", "Network-wide key giveaways."], ["xposts", "X posting", "✕", "Post to the project's X account: ads, scheduled posts and the automatic free-game posts."], ["indie", "Indie showcase", "◈", "Review submissions, feature games and pause the form."]]],
      ["Bot", [["settings", "Bot settings", "☰", "Switches and numbers you can change without a restart."], ["ai", "AI companion", "✦", "Turn it on or off, tune it, see who uses it, try it."], ["music", "Music sessions", "♫", "Voice sessions running right now."], ["radio", "Radio", "📻", "Add SoundCloud links and play them together."]]],
      ["Team and safety", [["chat", "Staff chat", "💬", "Chat with the team, and answer tickets and bug reports without leaving."], ["admins", "Admin users", "👤", "Give other people their own login to this admin panel."], ["audit", "Audit log", "☰", "What you did in this panel, newest first."], ["datareq", "Data requests", "⌫", "Who asked to export or delete their data, and when."], ["tools", "Backups and logs", "⚙", "Download a backup, reset failed DMs, read the log."], ["account", "Account and security", "⚿", "A username and password as a second way in, and a two-step code."], ["personalize", "Personalize", "🎨", "Pick the look and the wallpaper of your desktop. Only you see it."]]]
    ];
    const ADMIN_PAGES = Object.fromEntries(ADMIN_NAV.flatMap(([, items]) => items.map(([id, title, icon, sub]) => [id, { title, icon, sub }])));
    let adminCtx = null, adminCtxAt = 0, adminTimer = 0;

    async function adminContext(force = false) {
      if (!force && adminCtx && Date.now() - adminCtxAt < 45_000) return adminCtx;
      adminCtx = await adminView();
      adminCtxAt = Date.now();
      return adminCtx;
    }
    const admEl = id => document.getElementById(id);

    // Anywhere the admin panel shows a bare Discord ID in a table cell or label, look up the person's name and show it beside the number.
    const idNames = new Map(), idAsked = new Set();
    let idTimer = 0;
    function nameAdminIds(root) {
      if (!root || !(adminCtx || document.body.classList.contains("adm-body"))) return;
      const hits = [];
      for (const el of root.querySelectorAll("td, th + td, dd, code, b, span, strong, div.v")) {
        if (el.children.length || el.dataset.named) continue;
        const t = el.textContent.trim();
        if (/^\d{17,20}$/.test(t)) hits.push([el, t]);
      }
      if (!hits.length) return;
      const show = () => { for (const [el, id] of hits) { const n = idNames.get(id); if (n && !el.dataset.named) { el.dataset.named = "1"; el.textContent = ""; el.append(h("b", { text: n }), h("span", { class: "muted small", "data-named": "1", text: "  " + id })); } } };
      const need = [...new Set(hits.map(x => x[1]))].filter(id => !idNames.has(id) && !idAsked.has(id)).slice(0, 40);
      show();
      if (!need.length) return;
      need.forEach(id => idAsked.add(id));
      api("/api/admin/names?ids=" + need.join(",")).then(r => { for (const [id, n] of Object.entries(r?.names ?? {})) idNames.set(id, n); show(); }).catch(() => { need.forEach(id => idAsked.delete(id)); });
    }
    new MutationObserver(() => { clearTimeout(idTimer); idTimer = setTimeout(() => nameAdminIds(document.body.classList.contains("adm-body") ? document.body : app), 250); }).observe(document.body, { childList: true, subtree: true });

    /** A flock of geese flying back and forth across the whole screen. Returns a function that clears them. */
    function honkFlock(geese) {
      const sky = h("div", { "aria-hidden": "true" }); sky.style.cssText = "position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:1";
      document.body.appendChild(sky);
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) geese = Math.min(geese, 8);
      for (let i = 0; i < geese; i++) {
        const g = h("div", { text: "🪿" }), size = 28 + Math.random() * 56, ltr = Math.random() < 0.5;
        g.style.cssText = `position:absolute;left:0;top:0;font-size:${size}px;line-height:1;will-change:transform`;
        sky.appendChild(g);
        const w = innerWidth, hh = innerHeight, y0 = Math.random() * hh, y1 = Math.random() * hh, mid = Math.random() * hh;
        const x0 = ltr ? -120 : w + 120, x1 = ltr ? w + 120 : -120, flip = ltr ? -1 : 1; // the emoji faces left
        const frames = [
          { transform: `translate(${x0}px, ${y0}px) scaleX(${flip}) rotate(${(Math.random() - 0.5) * 40}deg)` },
          { transform: `translate(${(x0 + x1) / 2}px, ${mid}px) scaleX(${flip}) rotate(${(Math.random() - 0.5) * 60}deg)`, offset: 0.5 },
          { transform: `translate(${x1}px, ${y1}px) scaleX(${flip}) rotate(${(Math.random() - 0.5) * 40}deg)` }];
        const run = () => { if (sky.isConnected) g.animate(frames, { duration: 2600 + Math.random() * 3200, delay: Math.random() * 2500, easing: "ease-in-out" }).onfinish = run; };
        run();
      }
      return () => sky.remove();
    }

    /** Wrong username or password on the admin sign-in: geese everywhere and a pop-up asking if they should be here. */
    function wrongPasswordGeese() {
      if (document.getElementById("honkPop")) return;
      const clear = honkFlock(innerWidth < 700 ? 12 : 26);
      const pop = h("div", { id: "honkPop", role: "alertdialog", "aria-modal": "true" });
      pop.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:50;background:rgba(0,0,0,.35);padding:16px";
      const card = h("div", { class: "panel", style: "text-align:center;max-width:380px;position:relative;z-index:60" },
        h("div", { text: "🪿", style: "font-size:56px;line-height:1" }),
        h("h2", { text: "You silly goose." }),
        h("p", { text: "That's the wrong password. Should you even be here?" }),
        h("div", { class: "row", style: "justify-content:center" }, h("button", { class: "btn gray", type: "button", text: "Honk, I'll go", onclick: () => { clear(); pop.remove(); } })));
      pop.appendChild(card); document.body.appendChild(pop);
      card.querySelector("button").focus();
    }

    /** For anyone who signs in to the admin panel without being on the list: a joke, a flock of geese, and a trip to the owner's X after ten seconds. */
    function gooseScreen() {
      const DEST = "https://x.com/twit_user69";
      document.title = "Honk";
      const count = h("strong", { text: "10" });
      app.replaceChildren(h("div", { class: "adm-center" }, h("div", { class: "panel", style: "text-align:center;position:relative;z-index:2" },
        h("div", { text: "🪿", style: "font-size:64px;line-height:1" }),
        h("h2", { text: "You silly goose." }),
        h("p", { class: "muted", text: "This page isn't for you. Honk." }),
        h("p", { class: "muted" }, "Sending you somewhere better in ", count, " seconds..."),
        h("div", { class: "row" }, h("a", { class: "btn gray", href: DEST, text: "Take me there now" })))));
      honkFlock(innerWidth < 700 ? 12 : 26);
      let left = 10;
      const tick = setInterval(() => { left -= 1; count.textContent = String(Math.max(left, 0)); if (left <= 0) { clearInterval(tick); location.href = DEST; } }, 1000);
    }

    function adminCenter(title, text, ...actions) {
      app.replaceChildren(h("div", { class: "adm-center" }, h("div", { class: "panel" }, h("h2", { text: title }), h("p", { class: "muted", text }), h("div", { class: "row" }, actions))));
    }

    /** The signed-out screen: username and password, or Discord. Nothing of the panel is shown until one of them works. */
    function adminLoginScreen() {
      admEl("adm").classList.add("adm-bare");
      document.body.classList.add("adm-bare-body");
      document.title = "Sign in · LucadoOS";
      const user = h("input", { type: "text", name: "username", autocomplete: "username", autocapitalize: "none", spellcheck: "false", required: "" });
      const pass = h("input", { type: "password", name: "password", autocomplete: "current-password", required: "" });
      const code = h("input", { type: "text", name: "code", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "7", placeholder: "123456" });
      const codeRow = field("Authenticator code", code); codeRow.hidden = true;
      const msg = h("p", { class: "adm-login-msg", role: "alert", hidden: "" });
      const go = h("button", { class: "btn blue big", type: "submit", text: "Sign in" });
      const form = h("form", { class: "adm-login-form", novalidate: "" }, field("Username", user), field("Password", pass), codeRow, msg, go);
      form.addEventListener("submit", async e => {
        e.preventDefault();
        msg.hidden = true; go.disabled = true;
        try {
          const r = await api("/api/admin/login", { username: user.value, password: pass.value, code: code.value });
          if (r.needCode) { codeRow.hidden = false; code.focus(); msg.textContent = "Enter the 6-digit code from your authenticator app."; msg.hidden = false; return; }
          location.reload();
        } catch (err) { msg.textContent = err.message || "Could not sign in."; msg.hidden = false; wrongPasswordGeese(); }
        finally { go.disabled = false; }
      });
      // The sign-in screen looks like an operating system's: wallpaper, a big clock, a round picture and the fields underneath.
      const clock = h("div", { class: "adm-lock-clock" }), tick = () => { const d = new Date(); clock.replaceChildren(h("b", { text: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) }), h("span", { text: d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) })); };
      tick(); const clockTimer = setInterval(() => { if (!clock.isConnected) return clearInterval(clockTimer); tick(); }, 15_000);
      go.textContent = "→"; go.setAttribute("aria-label", "Sign in"); go.className = "adm-lock-go";
      form.replaceChildren(h("div", { class: "adm-lock-fields" }, user, h("div", { class: "adm-lock-pass" }, pass, go)), codeRow, msg);
      user.placeholder = "Username"; pass.placeholder = "Password"; user.setAttribute("aria-label", "Username"); pass.setAttribute("aria-label", "Password");
      app.replaceChildren(h("div", { class: "adm-lock" }, clock,
        h("div", { class: "adm-lock-card" },
          h("div", { class: "adm-lock-avatar" }, h("img", { src: "/logo.png", alt: "", width: "96", height: "96" })),
          h("h2", { text: "LucadoOS" }), h("p", { class: "adm-lock-sub", text: "Sign in to continue." }),
          form,
          h("a", { class: "adm-lock-alt", href: "/auth/login?next=admin", text: "Sign in with Discord" })),
        h("div", { class: "adm-lock-corner" }, themeButton())));
      user.focus();
    }

    const randomPassword = () => { const set = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789", a = crypto.getRandomValues(new Uint32Array(18)); return Array.from(a, n => set[n % set.length]).join(""); };

    /** The owner's list of other people who can use this panel, and what each may change. */
    /** The look and wallpaper of the desktop, saved for whoever is signed in. */
    async function adminPersonalize(body, fail) {
      let data; try { data = await api("/api/admin/prefs"); } catch (e) { return fail(e); }
      let prefs = data.prefs;
      const os = window.AdminOS;
      const save = async patch => { prefs = { ...prefs, ...patch }; os?.applyPrefs(prefs, data.walls); draw(); try { await api("/api/admin/prefs", prefs); } catch (e) { toast(e.message); } };
      const box = h("div", { class: "pz" });
      const draw = () => {
        const looks = [["original", "Original", "The LucadoOS colors, rounded windows"], ["windows", "Windows", "Flat and square, like a PC"]].map(([id, name, sub]) => h("button", { type: "button", class: "pz-look" + (prefs.look === id ? " on" : ""), onclick: () => save({ look: id }) }, h("b", { text: name }), h("small", { text: sub })));
        const swatches = data.walls.map(w => { const b = h("button", { type: "button", class: "pz-wall" + (prefs.wall === w.id ? " on" : ""), title: w.name, "aria-label": w.name, onclick: () => save({ wall: w.id }) }, h("span", { text: w.name })); if (w.css) b.style.setProperty("background", w.css); return b; });
        const color = h("input", { type: "color", "aria-label": "Pick any color", value: /^#/.test(prefs.wall) ? prefs.wall : "#1b2a4a" });
        color.addEventListener("change", () => save({ wall: color.value }));
        const wv = h("input", { type: "checkbox" }); wv.checked = Boolean(prefs.waves); wv.addEventListener("change", () => save({ waves: wv.checked }));
        box.replaceChildren(h("h3", { text: "Look" }), h("div", { class: "pz-row" }, ...looks), h("h3", { text: "Wallpaper" }), h("div", { class: "pz-row" }, ...swatches, h("label", { class: "pz-color" + (/^#/.test(prefs.wall) ? " on" : "") }, color, h("span", { text: "Your color" }))),
          h("label", { class: "pz-waves" }, wv, h("span", {}, h("b", { text: "Neon waves" }), h("small", { text: "Glowing lines rolling over the wallpaper. Works with any color above, or on the default one." })))   ,
          os?.active() ? null : h("p", { class: "muted small", text: "The desktop look only shows on a wider screen, in desktop view." }));
      };
      draw(); body.replaceChildren(box);
    }

    async function adminAdmins(body, fail) {
      let d;
      try { d = await api("/api/admin/admins"); } catch (e) { return fail(e); }
      const redraw = () => adminAdmins(body, fail);
      const when = t => t ? new Date(t).toLocaleString() : "never";
      // A picker for "may change": everything, nothing, or particular areas.
      const picker = initial => {
        const all = h("input", { type: "checkbox" }), boxes = d.areas.map(a => { const c = h("input", { type: "checkbox", value: a.id }); return [a, c, h("label", { class: "check" }, c, " ", a.label)]; });
        all.checked = initial.includes("*");
        for (const [a, c] of boxes) c.checked = all.checked || initial.includes(a.id);
        const sync = () => { for (const [, c] of boxes) { c.disabled = all.checked; if (all.checked) c.checked = true; } };
        all.addEventListener("change", sync); sync();
        const node = h("div", { class: "adm-perms" }, h("label", { class: "check" }, all, h("b", { text: " Can change everything on the panel" })), h("div", { class: "adm-perm-grid" }, boxes.map(x => x[2])), h("p", { class: "muted small", text: "Everyone can look at every page. Leave all of these off for a view-only login." }));
        return { node, value: () => all.checked ? ["*"] : boxes.filter(([, c]) => c.checked).map(([a]) => a.id) };
      };
      let kind = "password";
      const kindSel = h("select", { "aria-label": "How they sign in" }, h("option", { value: "password", text: "Username and password" }), h("option", { value: "discord", text: "Discord account (their Discord ID)" }));
      const uName = h("input", { type: "text", autocapitalize: "none", spellcheck: "false", autocomplete: "off", "aria-label": "Username", placeholder: "username" });
      const pass = h("input", { type: "text", autocomplete: "off", spellcheck: "false", "aria-label": "Password", placeholder: "at least 12 characters" });
      const make = h("button", { type: "button", class: "btn gray small", text: "Make one", onclick: () => { pass.value = randomPassword(); } });
      const did = h("input", { type: "text", inputmode: "numeric", autocomplete: "off", "aria-label": "Discord ID", placeholder: "17 to 20 digits" });
      const label = h("input", { type: "text", maxlength: "40", autocomplete: "off", "aria-label": "A name to remember them by", placeholder: "e.g. Sam (mod)" });
      const pwFields = h("div", {}, field("Username", uName), field("Password", h("div", { class: "row" }, pass, make)));
      const dcFields = h("div", { hidden: "" }, field("Discord ID", did), field("Name (just for your list)", label),
        h("p", { class: "muted small", text: "They sign in with the Discord button on the admin page. In Discord, turn on Developer Mode, right-click them and choose Copy User ID." }));
      kindSel.addEventListener("change", () => { kind = kindSel.value; pwFields.hidden = kind !== "password"; dcFields.hidden = kind !== "discord"; });
      const perms = picker([]);
      const add = h("button", { type: "submit", class: "btn blue", text: "Add admin user" });
      const form = h("form", { class: "adm-form", novalidate: "" }, field("How they sign in", kindSel), pwFields, dcFields, h("h4", { text: "What they may change" }), perms.node,
        h("p", { class: "muted small", text: "Admin users never get bot powers, and they can't manage other admin users, change your sign-in, or download backups." }), add);
      form.addEventListener("submit", e => { e.preventDefault(); busy(add, async () => {
        await api("/api/admin/admins/add", kind === "discord" ? { kind, discordId: did.value, label: label.value, edit: perms.value() } : { kind, username: uName.value, password: pass.value, edit: perms.value() });
        toast(kind === "discord" ? "Added. They can sign in with Discord on this page." : "Added. Give them the username and password.", "ok"); redraw(); }); });
      const rows = d.admins.map(a => {
        const open = h("button", { type: "button", class: "btn gray small", text: "What they can change" }), del = h("button", { type: "button", class: "btn red small", text: "Remove" });
        const extra = [open];
        if (a.kind === "password") { const reset = h("button", { type: "button", class: "btn gray small", text: "New password" }); reset.addEventListener("click", () => { const np = prompt(`New password for ${a.username} (at least 12 characters). Leave it empty to make one.`, ""); if (np === null) return; const pw = np || randomPassword(); busy(reset, async () => { await api("/api/admin/admins/reset", { id: a.id, password: pw }); prompt(`Done. ${a.username} was signed out. Their new password:`, pw); }); }); extra.push(reset); }
        del.addEventListener("click", () => { if (confirm(`Remove ${a.username || a.label || a.id}? They lose access right away.`)) busy(del, async () => { await api("/api/admin/admins/remove", { id: a.id }); toast("Removed.", "ok"); redraw(); }); });
        const detail = h("tr", { hidden: "" }), p2 = picker(a.edit), save = h("button", { type: "button", class: "btn blue small", text: "Save" });
        save.addEventListener("click", () => busy(save, async () => { await api("/api/admin/admins/access", { id: a.id, edit: p2.value() }); toast("Saved.", "ok"); redraw(); }));
        detail.append(h("td", { colspan: "5" }, p2.node, save));
        open.addEventListener("click", () => { detail.hidden = !detail.hidden; });
        const summary = a.edit.includes("*") ? "Everything" : a.edit.length ? `${a.edit.length} area${a.edit.length === 1 ? "" : "s"}` : "View only";
        return [h("tr", {}, h("td", {}, h("b", { text: a.username || a.label || a.id }), a.kind === "discord" ? h("div", { class: "muted small", text: a.id }) : null), h("td", { text: a.kind === "discord" ? "Discord" : "Password" }), h("td", { text: summary }), h("td", { text: when(a.last_login) }), h("td", {}, h("div", { class: "row" }, ...extra, del))), detail];
      });
      body.replaceChildren(
        h("div", { class: "panel" }, h("h3", { text: "Add an admin user" }), form),
        h("div", { class: "panel" }, h("h3", { text: `Admin users (${d.admins.length})` }), rows.length
          ? h("div", { class: "scroll-y" }, h("table", {}, h("thead", {}, h("tr", {}, ["Who", "Signs in with", "May change", "Last password sign-in", ""].map(c => h("th", { text: c })))), h("tbody", {}, rows.flat())))
          : h("p", { class: "muted", text: "Nobody yet. It's just you." })));
    }
    /** What an admin user sees instead of the owner's Account page: their own password. */
    function adminSelf(body) {
      const cur = h("input", { type: "password", autocomplete: "current-password", "aria-label": "Current password", required: "" });
      const np = h("input", { type: "password", autocomplete: "new-password", "aria-label": "New password", required: "" });
      const np2 = h("input", { type: "password", autocomplete: "new-password", "aria-label": "Repeat the new password", required: "" });
      const save = h("button", { type: "submit", class: "btn blue", text: "Change password" });
      const form = h("form", { class: "adm-form", novalidate: "" }, field("Current password", cur), field("New password", np), field("Repeat the new password", np2), h("p", { class: "muted small", text: "Use at least 12 characters." }), save);
      form.addEventListener("submit", e => { e.preventDefault(); if (np.value !== np2.value) return toast("The two passwords don't match.", "error"); busy(save, async () => { await api("/api/admin/self/password", { current: cur.value, password: np.value }); toast("Saved. Your other sign-ins were ended.", "ok"); form.reset(); }); });
      body.replaceChildren(h("div", { class: "panel" }, h("h3", { text: "Your password" }), h("p", { class: "muted", text: `You're signed in as ${state.me.user.username}.` }), form));
    }

    /** Create or change the username and password, and turn the two-step code on or off. */
    async function adminAccount(body, fail) {
      let info;
      try { info = await api("/api/admin/account"); } catch (e) { return fail(e); }
      const redraw = () => adminAccount(body, fail);
      const pw = (label, ac) => h("input", { type: "password", autocomplete: ac, "aria-label": label, required: "" });
      const when = t => t ? new Date(t).toLocaleString() : "never";
      const note = h("p", { class: "muted small" });
      const status = h("div", { class: "panel" }, h("h3", { text: "Sign-in methods" }),
        h("p", {}, h("b", { text: "Discord" }), " is always on. It is the main way in and cannot be removed."),
        h("p", {}, h("b", { text: "Username and password" }), info.exists ? ` is on for “${info.username}”. Last used: ${when(info.lastLogin)}.` : " is not set up yet."),
        info.exists ? h("p", {}, h("b", { text: "Two-step code" }), info.totp ? " is on." : " is off.") : null,
        info.viaPassword ? h("p", { class: "muted small", text: "You are signed in with the password right now. This kind of sign-in lasts 12 hours and only opens this panel." }) : null);

      const uName = h("input", { type: "text", autocomplete: "username", autocapitalize: "none", spellcheck: "false", value: info.username || "", "aria-label": "Username", required: "" });
      const pNew = pw("New password", "new-password"), pNew2 = pw("Repeat the new password", "new-password"), pCur = pw("Current password", "current-password");
      const save = h("button", { class: "btn blue", type: "submit", text: info.exists ? "Save changes" : "Create sign-in" });
      const form = h("form", { class: "adm-form", novalidate: "" },
        field("Username", uName), field(info.exists ? "New password" : "Password", pNew), field("Repeat the password", pNew2),
        info.exists ? field("Current password (to confirm it is you)", pCur) : null,
        h("p", { class: "muted small", text: "Use at least 12 characters. A few random words in a row is easy to remember and hard to guess. The password is stored only as a salted hash, never as text." }), save);
      form.addEventListener("submit", async e => {
        e.preventDefault();
        if (pNew.value !== pNew2.value) return toast("The two passwords don't match.", "error");
        await busy(save, async () => {
          await api("/api/admin/account/save", { username: uName.value, password: pNew.value, current: pCur.value });
          toast(info.exists ? "Saved. Other password sign-ins were ended." : "Done. You can now sign in with this username and password.");
          redraw();
        });
      });
      const setup = h("div", { class: "panel" }, h("h3", { text: info.exists ? "Change the username or password" : "Create a username and password" }), form);

      const parts = [status, setup];
      if (info.exists) {
        // Two-step code
        const two = h("div", { class: "panel" }, h("h3", { text: "Two-step code" }), h("p", { class: "muted", text: "Adds a 6-digit code from an authenticator app (Google Authenticator, Authy, 1Password and so on) to the password sign-in. Strongly recommended." }));
        if (info.totp) {
          const cur = pw("Current password", "current-password");
          const off = h("button", { class: "btn red", type: "button", text: "Turn off two-step code" });
          off.addEventListener("click", () => busy(off, async () => { await api("/api/admin/account/totp/disable", { current: cur.value }); toast("Two-step code is off."); redraw(); }));
          two.append(field("Current password", cur), h("div", { class: "row" }, off));
        } else {
          const cur = pw("Current password", "current-password");
          const begin = h("button", { class: "btn blue", type: "button", text: "Set up two-step code" });
          const slot = h("div");
          begin.addEventListener("click", () => busy(begin, async () => {
            const r = await api("/api/admin/account/totp/start", { current: cur.value });
            const code = h("input", { type: "text", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "7", placeholder: "123456", "aria-label": "Code from the app" });
            const on = h("button", { class: "btn green", type: "button", text: "Check the code and turn it on" });
            on.addEventListener("click", () => busy(on, async () => { await api("/api/admin/account/totp/enable", { code: code.value }); toast("Two-step code is on."); redraw(); }));
            slot.replaceChildren(
              h("p", { text: "In your authenticator app choose “Enter a setup key” and paste this key. Pick “time based” if asked." }),
              h("div", { class: "adm-secret" }, h("code", { text: r.secret.replace(/(.{4})/g, "$1 ").trim() }),
                h("button", { class: "btn gray small", type: "button", text: "Copy", onclick: () => { navigator.clipboard?.writeText(r.secret).then(() => toast("Copied.")).catch(() => {}); } })),
              h("p", { class: "muted small", text: "Or open this link on the phone that has the app:" }), h("a", { href: r.uri, text: "Add to authenticator app" }),
              field("Then type the 6-digit code it shows", code), h("div", { class: "row" }, on));
          }));
          two.append(field("Current password", cur), h("div", { class: "row" }, begin), slot);
        }
        // Remove
        const rm = pw("Current password", "current-password");
        const del = h("button", { class: "btn red", type: "button", text: "Remove username and password" });
        del.addEventListener("click", () => busy(del, async () => {
          await api("/api/admin/account/remove", { current: rm.value });
          if (info.viaPassword) return location.reload();
          toast("Removed."); redraw();
        }));
        parts.push(two, h("div", { class: "panel" }, h("h3", { text: "Remove the password sign-in" }), h("p", { class: "muted", text: "Discord sign-in keeps working. Any open password sessions end." }), field("Current password", rm), h("div", { class: "row" }, del)));
      }
      parts.push(h("div", { class: "panel" }, h("h3", { text: "Good to know" }),
        h("p", { class: "muted small", text: "Five wrong tries in a row lock the password sign-in for 15 minutes (longer if it keeps happening). Discord sign-in is never locked. Every sign-in and change is written to the audit log, without any passwords." }), note));
      body.replaceChildren(...parts);
    }

    async function adminBoot() {
      try { state.cfg = await api("/api/config"); } catch (e) { return adminCenter("Can't reach the bot", e.message); }
      try { state.me = await api("/api/me"); } catch { state.me = null; }
      if (!state.me) return adminLoginScreen();
      if (!state.me.isOwner && !state.me.panel) return gooseScreen();
      if (state.me.panel) { // someone the owner let in: no page for managing admins; a username login gets "My password", a Discord login has nothing to change
        const drop = new Set(state.me.panel.kind === "password" ? ["admins"] : ["admins", "account"]);
        for (const g of ADMIN_NAV) g[1] = g[1].filter(([id]) => !drop.has(id));
        for (const id of drop) delete ADMIN_PAGES[id];
        if (ADMIN_PAGES.account) { ADMIN_PAGES.account = { ...ADMIN_PAGES.account, title: "My password", sub: "Change the password for your admin login." }; ADMIN_NAV.forEach(g => g[1] = g[1].map(it => it[0] === "account" ? ["account", "My password", it[2], "Change the password for your admin login."] : it)); }
      }
      adminChrome();
      let look = null; try { look = await api("/api/admin/prefs"); } catch { /* the default look is fine */ }
      if (window.AdminOS?.wanted()) window.AdminOS.begin({ nav: ADMIN_NAV, pages: ADMIN_PAGES, siteUrl: state.cfg.siteUrl, render: (id, host) => adminMount(id, host), prefs: look?.prefs, walls: look?.walls });
      adminRoute();
      adminPulse();
      window.AdminChat?.watch({ api, toast });
      setInterval(adminPulse, 30_000);
    }

    function adminChrome() {
      const nav = admEl("admNav");
      nav.replaceChildren(...ADMIN_NAV.flatMap(([group, items]) => [h("div", { class: "adm-group", text: group }),
        ...items.map(([id, title, icon]) => h("a", { class: "adm-link", href: "#/" + id, "data-page": id }, h("i", { text: icon, "aria-hidden": "true" }), h("span", { text: title }), h("span", { class: "adm-badge", "data-badge": id, hidden: true })))]));
      admEl("admFoot").replaceChildren(h("a", { href: state.cfg.siteUrl || "/", text: "← Steam Value Checker" }), h("span", { text: "Signed in as " + (state.me.user?.username || "owner") }));
      admEl("admUser").replaceChildren(state.me.user?.avatar ? h("img", { src: state.me.user.avatar, alt: "", width: "30", height: "30", referrerpolicy: "no-referrer" }) : null, themeButton(),
        window.AdminOS && window.innerWidth >= 900 ? h("button", { class: "btn gray small", type: "button", text: "Desktop view", onclick: () => window.AdminOS.setMode("os") }) : null,
        h("button", { class: "btn gray small", type: "button", text: "Sign out", onclick: async () => { try { await api("/auth/logout", {}); } catch { /* already out */ } location.reload(); } }));
      const shell = admEl("adm");
      admEl("admBurger").addEventListener("click", () => shell.classList.toggle("open"));
      admEl("admScrim").addEventListener("click", () => shell.classList.remove("open"));
      admEl("admSearch").addEventListener("click", () => adminPalette());
      document.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); adminPalette(); } });
    }

    /** The little status light in the top bar, and the badge on Bug reports. */
    async function adminPulse() {
      const box = admEl("admStatus");
      try {
        const sys = await api("/api/admin/system");
        const b = sys.bot || {};
        box.replaceChildren(h("i", { class: "adm-dot ok", "aria-hidden": "true" }), h("span", { class: "txt", text: `Online${b.pingMs != null ? " · " + b.pingMs + " ms" : ""}${b.servers != null ? " · " + b.servers + " servers" : ""}` }));
      } catch (e) { box.replaceChildren(h("i", { class: "adm-dot bad", "aria-hidden": "true" }), h("span", { class: "txt", text: "Can't reach the bot" })); }
    }

    /** Draws one admin page (its heading, refresh button and content) into any box. The sidebar layout and the desktop windows both use this. */
    function adminMount(page, host, { classic = false } = {}) {
      const meta = ADMIN_PAGES[page];
      const body = h("div", {}, h("p", { class: "muted", text: "Loading…" }));
      const refresh = h("button", { class: "btn gray small", type: "button", text: "Refresh", onclick: () => { adminCtx = null; adminMount(page, host, { classic }); adminPulse(); } });
      host.replaceChildren(h("div", { class: "adm-head" }, h("div", {}, h("h1", { text: meta.title }), h("p", { text: meta.sub })), h("div", { class: "adm-actions" }, refresh)), body);
      if (classic) scrollTop0();
      if (page === "radio") { host.classList.add("adm-chat-host"); host.replaceChildren(); if (window.AdminRadio) window.AdminRadio.mount(host, { h, api, toast }); else host.append(h("div", { class: "notice warn", text: "The radio didn't load. Refresh the page." })); return; }
      if (page === "chat") { host.classList.add("adm-chat-host"); host.replaceChildren(); if (window.AdminChat) window.AdminChat.mount(host, { h, api, toast }); else host.append(h("div", { class: "notice warn", text: "The chat didn't load. Refresh the page." })); return; }
      const pm = state.me.panel;
      if (pm && pm.areas.includes(page) && !pm.edit.includes("*") && !pm.edit.includes(page)) host.insertBefore(h("div", { class: "notice", text: "You can look at this page, but you can't change anything on it. Ask the owner if you need edit access." }), body);
      const draw = nodes => body.replaceChildren(...nodes);
      const fail = e => body.replaceChildren(h("div", { class: "notice warn", text: e.message || "Something went wrong." }));
      if (page === "system") return void adminSystem(body, fail);
      if (page === "xposts") return void adminXPosts(body, fail);
      if (page === "traffic") return void adminTraffic(body, fail);
      if (page === "indie") return void adminIndie(body, fail);
      if (page === "votes") return void adminVotes(body, fail);
      if (page === "datareq") return void adminDataReq(body, fail);
      if (page === "supporters") return void adminSupporters(body, fail);
      if (page === "profiles") return void adminProfiles(body, fail);
      if (page === "audit") return void adminAudit(body);
      if (page === "account") return void (state.me.panel ? adminSelf(body) : adminAccount(body, fail));
      if (page === "admins") return void adminAdmins(body, fail);
      if (page === "personalize") return void adminPersonalize(body, fail);
      adminContext().then(ctx => {
        const tab = ctx.TABS.find(t => t[0] === page);
        const nodes = tab[2]();
        if (page === "overview") {
          // Quick doors first, then the headline numbers, then the charts.
          const firstGrid = nodes.findIndex(n => n && n.classList && n.classList.contains("grid"));
          nodes.splice(firstGrid + 1, 0, ...adminTrends(ctx));
          nodes.unshift(adminQuick(ctx));
          nodes.unshift(adminAttention());
        }
        draw(nodes);
      }).catch(fail);
    }
    function adminRoute() {
      clearTimeout(adminTimer);
      admEl("adm").classList.remove("open");
      const id = (location.hash.replace(/^#\/?/, "").split(/[/?]/)[0]) || "overview";
      const page = ({ bugs: "chat", requests: "chat" })[id] || (ADMIN_PAGES[id] ? id : "overview");
      if (window.AdminOS?.active()) { window.AdminOS.open(page); return; } // on the desktop, a link opens that page's window
      document.querySelectorAll(".adm-link").forEach(a => { const on = a.dataset.page === page; a.classList.toggle("active", on); on ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"); });
      const meta = ADMIN_PAGES[page];
      document.title = `${meta.title} · LucadoOS`;
      admEl("admCrumb").replaceChildren("Admin / ", h("b", { text: meta.title }));
      adminMount(page, app, { classic: true });
    }


    /** One-click doors to the things you do most. */
    /** What needs the owner right now. Fills in by itself; empty means all quiet. */
    function adminAttention() {
      const box = h("div", { class: "panel adm-attn" }, h("h3", { text: "Needs your attention" }), h("p", { class: "muted small", text: "Checking…" }));
      api("/api/admin/attention").then(r => {
        box.replaceChildren(h("h3", { text: "Needs your attention" }),
          r.items.length ? h("ul", { class: "adm-attn-list" }, ...r.items.map(i => h("li", { class: i.level }, h("a", { href: i.href, text: i.text })))) : h("p", { class: "muted", text: "All quiet. Nothing is waiting on you." }));
      }).catch(() => box.remove());
      return box;
    }
    function adminQuick(ctx) {
      const q = (href, title, text, extra = {}) => h("a", { href, ...extra }, h("b", { text: title }), h("span", { text }));
      return h("div", { class: "adm-quick" },
        q("#/announce", "Announce something", "Message members and servers"),
        q("#/giveaway", "Start a giveaway", "Network-wide, all servers"),
        q("#/chat", ctx.bugData.newCount ? `${ctx.bugData.newCount} new bug report${ctx.bugData.newCount === 1 ? "" : "s"}` : "Tickets and bugs", `${ctx.bugData.open} open`),
        q("/api/admin/backup", "Download the backup", "The latest database copy", { download: "" }));
    }
    function adminTrends(ctx) {
      return [h("div", { class: "grid two" },
        h("div", { class: "panel" }, h("h3", { text: "New members per day" }), ctx.daily(ctx.ins.signups, "New members", "s0")),
        h("div", { class: "panel" }, h("h3", { text: "Alerts sent per day" }), ctx.daily(ctx.ins.alerts, "Alerts", "s1")))];
    }

    /** Every link the bot posts goes through a page on the site first. This shows how many people opened them and how many went on to the store. */
    async function adminIndie(body, fail) {
      const tile = (k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: String(v) }), sub && h("div", { class: "s", text: sub }));
      let status = "pending";
      const draw = async () => {
        let d;
        try { d = await api("/api/admin/indie?status=" + status); } catch (e) { return fail(e); }
        if (!document.body.contains(body)) return;
        const act = async (g, action, extra = {}) => { try { await api("/api/admin/indie/review", { id: g.id, action, ...extra }); toast("Done.", "ok"); await draw(); } catch (e) { toast(e.message); } };
        const open = h("input", { type: "checkbox" }); open.checked = d.open; open.addEventListener("change", async () => { try { await api("/api/admin/indie/open", { open: open.checked }); toast(open.checked ? "Submissions are open." : "Submissions are paused.", "ok"); } catch (e) { toast(e.message); open.checked = !open.checked; } });
        const syncAll = h("button", { class: "btn gray small", type: "button", text: "Sync games from Steam now" }); syncAll.addEventListener("click", () => busy(syncAll, async () => { const r = await api("/api/admin/indie/review", { action: "syncall" }); toast(`Refreshed ${r.synced} game${r.synced === 1 ? "" : "s"}.`, "ok"); await draw(); }));
        const tabs = h("div", { class: "row" }, ["pending", "approved", "rejected"].map(k => { const b = h("button", { class: "btn small " + (status === k ? "blue" : "gray"), type: "button", text: `${k[0].toUpperCase() + k.slice(1)} (${d.counts[k] ?? 0})` }); b.addEventListener("click", () => { status = k; draw(); }); return b; }));
        const card = g => {
          const note = h("input", { type: "text", placeholder: "Note to the developer (optional)", maxlength: 300 }), btns = [];
          const mk = (text, cls, fn) => { const b = h("button", { class: "btn small " + cls, type: "button", text }); b.addEventListener("click", () => busy(b, fn)); btns.push(b); };
          if (g.status !== "approved") mk("Approve", "green", () => act(g, "approve", { note: note.value }));
          if (g.status !== "rejected") mk("Reject", "red", () => act(g, "reject", { note: note.value }));
          if (g.status === "approved") { mk(g.featured ? "Unfeature" : "Feature", g.featured ? "gray" : "blue", () => act(g, g.featured ? "unfeature" : "feature")); mk("Sync", "gray", () => act(g, "refresh")); mk("Post to X", "gray", async () => { if (confirm(`Post ${g.title} to the project's X account? Posts with a link cost about 20 cents.`)) await act(g, "xpost"); }); }
          if (g.status === "approved") mk(g.verified ? "Remove verified mark" : "Mark verified", "gray", () => act(g, g.verified ? "unverify" : "verify"));
          mk("Remove", "gray", async () => { if (confirm(`Remove ${g.title} for good?`)) await act(g, "remove"); });
          return h("div", { class: "panel ix-adm" }, h("div", { class: "ix-adm-head" }, h("img", { src: g.image, alt: "", width: 184, height: 69 }), h("div", {}, h("b", { text: g.title }), h("div", { class: "muted small", text: `${g.studio || "Unknown studio"} · Steam app ${g.appid} · by Discord user ${g.owner}` }), h("div", { class: "muted small", text: `${(g.genres || []).join(", ")} · ${g.price || "no price"} · ${g.release || ""}` }))),
            h("p", { text: g.pitch || "" }), g.note ? h("p", { class: "muted small", text: "Note: " + g.note }) : null, g.verified ? h("p", { class: "muted small", text: "✓ Verified by Steam page code" }) : null, g.reports ? h("p", { class: "notice warn", text: `${g.reports} open report${g.reports === 1 ? "" : "s"} on this game` }) : null,
            h("div", { class: "row" }, h("a", { href: g.steamUrl, target: "_blank", rel: "noopener noreferrer", text: "Steam page ↗" }), g.status === "approved" ? h("a", { href: `/indie/game/${g.id}`, target: "_blank", text: "Showcase page ↗" }) : null, Object.entries(g.links || {}).map(([k, u]) => h("a", { href: u, target: "_blank", rel: "noopener noreferrer nofollow", text: k + " ↗" })), g.status === "approved" ? h("span", { class: "muted small", text: `${g.views} views · ${g.clicks} clicks · ♥ ${g.likes}` }) : null),
            h("div", { class: "row" }, note, btns));
        };
        let rep = { reports: [] }, spot = null;
        try { rep = await api("/api/admin/indie/reports"); } catch { /* leave the panel empty */ }
        try { spot = await api("/api/admin/indie/spotlight"); } catch { /* spotlight not available */ }
        const when = ms => new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        const reportsPanel = h("div", { class: "panel" }, h("h3", { text: `Reports (${rep.reports.length})` }), rep.reports.length ? rep.reports.map(r => {
          const closeBtn = h("button", { class: "btn gray small", type: "button", text: "Dismiss" }), takeDown = h("button", { class: "btn red small", type: "button", text: "Take the game down" });
          closeBtn.addEventListener("click", () => busy(closeBtn, async () => { await api("/api/admin/indie/report", { gameId: r.gameId, action: "close" }); await draw(); }));
          takeDown.addEventListener("click", () => busy(takeDown, async () => { if (!confirm(`Take ${r.title} down?`)) return; await api("/api/admin/indie/report", { gameId: r.gameId, action: "remove" }); await draw(); }));
          return h("div", { class: "ix-adm-report" }, h("b", { text: r.title || "(removed game)" }), h("span", { class: "muted small", text: ` · reported ${when(r.created)}` }), h("p", { text: r.reason }), h("div", { class: "row" }, r.title ? h("a", { href: `/indie/game/${r.gameId}`, target: "_blank", text: "Showcase page ↗" }) : null, closeBtn, takeDown));
        }) : h("p", { class: "muted", text: "No open reports." }));
        let spotPanel = null;
        if (spot) {
          const on = h("input", { type: "checkbox" }); on.checked = spot.on; const chan = h("input", { type: "text", placeholder: "Discord channel ID (optional)", value: spot.channel || "", maxlength: 22 }), save = h("button", { class: "btn blue small", type: "button", text: "Save" }), runNow = h("button", { class: "btn gray small", type: "button", text: "Spotlight the next game now" });
          save.addEventListener("click", () => busy(save, async () => { try { await api("/api/admin/indie/spotlight", { on: on.checked, channel: chan.value }); toast("Saved.", "ok"); } catch (e) { toast(e.message); } }));
          runNow.addEventListener("click", () => busy(runNow, async () => { if (!confirm(spot.next ? `Spotlight ${spot.next.title} right now? It posts to X (if connected) and your channel.` : "There's no game ready to spotlight.")) return; try { const r = await api("/api/admin/indie/spotlight", { run: true }); toast(r.ran?.skipped ? r.ran.skipped : `Spotlighted ${r.ran.game}.`, "ok"); await draw(); } catch (e) { toast(e.message); } }));
          spotPanel = h("div", { class: "panel" }, h("h3", { text: "Weekly spotlight" }), h("label", { class: "check" }, on, " Spotlight one game every Wednesday at noon (Eastern)"),
            h("p", { class: "muted small", text: "It posts the game to X with #WishlistWednesday (when X posting is on) and to a Discord channel if you set one, then marks it Featured for the week. Every game gets a turn; verified and well-liked games go first." }),
            h("div", { class: "row" }, chan, save), h("p", { class: "muted small", text: spot.next ? `Up next: ${spot.next.title}${spot.next.studio ? " by " + spot.next.studio : ""}` : "Up next: nothing yet. Approve a game first." }),
            spot.last ? h("p", { class: "muted small", text: `Last: ${spot.last.game}, ${when(spot.last.at)}${spot.last.x ? " · posted to X" : ""}${spot.last.discord === true ? " · posted in Discord" : ""}` }) : null, runNow);
        }
        body.replaceChildren(
          h("div", { class: "panel" }, h("div", { class: "grid four" }, tile("Waiting", d.counts.pending ?? 0, "need a look"), tile("Live", d.counts.approved ?? 0, "in the showcase"), tile("Views", d.totals.views, "on game pages"), tile("Clicks to Steam", d.totals.clicks), tile("Likes", d.totals.likes))),
          h("div", { class: "panel" }, h("h3", { text: "Submissions" }), h("label", { class: "check" }, open, " Accept new submissions"), h("p", { class: "muted small", text: "Games re-sync from their Steam pages every day on their own, so prices and release dates stay current. You can also do it now." }), syncAll, h("a", { class: "btn gray small", href: "/indie", target: "_blank", text: "Open the showcase" })),
          ...(spotPanel ? [spotPanel] : []), reportsPanel,
          tabs, d.games.length ? d.games.map(card) : h("p", { class: "muted", text: status === "pending" ? "Nothing is waiting. You're all caught up." : "Nothing here." }));
      };
      await draw();
    }

    async function adminTraffic(body, fail) {
      const tile = (k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: String(v) }), sub && h("div", { class: "s", text: sub }));
      let t;
      try { t = await api("/api/admin/traffic"); } catch (e) { return fail(e); }
      if (!document.body.contains(body)) return;
      const rate = (c, v) => (v ? Math.round(c / v * 100) + "%" : "-");
      const peak = Math.max(1, ...t.days.map(d => d.visits));
      const bars = h("div", { class: "tr-bars" }, ...t.days.map(d => {
        const bar = h("i", { title: `${d.day}: ${d.visits} visits, ${d.clicks} clicks` });
        bar.style.height = Math.max(2, Math.round(d.visits / peak * 100)) + "%";
        return h("div", { class: "tr-col" }, bar, h("span", { text: d.day.slice(5) }));
      }));
      body.replaceChildren(
        h("div", { class: "panel" }, h("h3", { text: "At a glance" }),
          h("div", { class: "grid four" },
            tile("Visits today", t.today.visits, `${t.today.clicks} went on to the store`),
            tile("Last 7 days", t.week.visits, `${t.week.clicks} clicks, ${rate(t.week.clicks, t.week.visits)} went through`),
            tile("All time", t.total.visits, `${t.total.clicks} clicks`),
            tile("Link previews", t.week.previews, "robots reading a post, this week")),
          h("p", { class: "muted small", text: "A visit is a person opening one of the bot's links. Discord and X reading a link to build its preview is counted separately, so it doesn't inflate this." })),
        t.invites && h("div", { class: "panel" }, h("h3", { text: "Where new servers come from" }),
          h("div", { class: "grid four" }, tile("Add-bot clicks", t.invites.clicks, "last 30 days"), tile("Servers joined", t.invites.joins, "last 30 days")),
          t.invites.sources.length ? h("table", {}, h("thead", {}, h("tr", {}, ["Source", "Clicks"].map(c => h("th", { text: c })))), h("tbody", {}, ...t.invites.sources.map(x => h("tr", {}, h("td", { text: x.source }), h("td", { text: String(x.clicks) }))))) : h("p", { class: "muted", text: "No clicks yet. Every Add the bot button on the site and in the weekly post now counts here." }),
          h("p", { class: "muted small", text: "Discord doesn't say which link a server came from, so joins are a total. Compare it with the clicks to see roughly how many turn into servers. Link-preview robots aren't counted." })),
        h("div", { class: "panel" }, h("h3", { text: "Visits per day" }), t.days.length ? bars : h("p", { class: "muted", text: "Nothing yet. Counts start once the bot has posted a few links." })),
        h("div", { class: "panel" }, h("h3", { text: "Most opened links" }),
          t.top.length ? h("table", {}, h("thead", {}, h("tr", {}, ["Page", "Type", "Store", "Visits", "Clicks", "Through", ""].map(c => h("th", { text: c })))),
            h("tbody", {}, ...t.top.map(p => h("tr", {}, h("td", {}, p.url ? h("a", { href: p.url, target: "_blank", rel: "noopener noreferrer" }, h("b", { text: p.title })) : h("b", { text: p.title })), h("td", { text: p.kind }), h("td", { text: p.store }), h("td", { text: String(p.visits) }), h("td", { text: String(p.clicks) }), h("td", { text: rate(p.clicks, p.visits) }), h("td", {}, h("a", { href: p.url, target: "_blank", rel: "noopener", text: "Open" })))))) : h("p", { class: "muted", text: "No visits yet." })));
    }

    /** The project's X account: automatic free-game posts, a composer for ads and announcements, a schedule and the recent posts. */
    async function adminXPosts(body, fail) {
      const tile = (k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: String(v) }), sub && h("div", { class: "s", text: sub }));
      const money = n => (n > 0 && n < 0.1 ? (n * 100).toFixed(1).replace(/\.0$/, "") + " cents" : "$" + n.toFixed(2));
      // what X counts: a link is 23, and emoji and most non-Latin characters count double
      const LINK = /https?:\/\/\S+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|gg|tv|me|co|app|dev|xyz)\b(?:\/\S*)?/gi;
      const xLen = t => { let n = 0; for (const ch of t.replace(LINK, () => "x".repeat(23))) { const cp = ch.codePointAt(0); n += cp <= 4351 || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247) ? 1 : 2; } return n; };
      const hasLink = t => { LINK.lastIndex = 0; return LINK.test(t); };
      const when = at => new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      let draft = { text: "", image: null, imageName: "", at: "", bundleId: null }, bundleLink = true, freeLink = true;
      const draw = async () => {
        const xs = await api("/api/admin/xposter");
        const bl = await api("/api/admin/xposter/bundles?link=" + (bundleLink ? 1 : 0)).catch(() => ({ bundles: [] }));
        const fl = await api("/api/admin/xposter/free?link=" + (freeLink ? 1 : 0)).catch(() => ({ games: [] }));
        const wk = await api("/api/admin/weekly").catch(() => null);
        const nx = await api("/api/admin/xposter/next").catch(() => null);
        if (!document.body.contains(body)) return;
        const save = async patch => { try { await api("/api/admin/xposter", patch); toast("Saved.", "ok"); await draw(); } catch (e) { toast(e.message); } };

        // ----- status and the automatic posts -----
        const note = h("p", { class: "muted small", text: "" });
        const on = h("input", { type: "checkbox" }); on.checked = xs.enabled; on.disabled = !xs.configured; on.addEventListener("change", () => save({ enabled: on.checked }));
        const per = h("input", { type: "number", min: "1", max: String(xs.maxDaily), value: String(xs.daily), class: "x-num" });
        const chk = h("button", { class: "btn gray small", type: "button", text: "Check the keys" });
        chk.addEventListener("click", () => busy(chk, async () => { try { const r = await api("/api/admin/xposter/check", {}); note.textContent = "Connected" + (r.username ? " as @" + r.username : "") + "."; } catch (e) { note.textContent = e.message; } }));
        const sv = h("button", { class: "btn gray small", type: "button", text: "Save" }); sv.addEventListener("click", () => save({ daily: Number(per.value) }));
        const linksOn = h("input", { type: "checkbox" }); linksOn.checked = xs.links; linksOn.addEventListener("change", () => save({ links: linksOn.checked }));
        const alwaysOn = h("input", { type: "checkbox" }); alwaysOn.checked = xs.always; alwaysOn.addEventListener("change", () => save({ always: alwaysOn.checked }));
        const ingameOn = h("input", { type: "checkbox" }); ingameOn.checked = xs.ingame; ingameOn.addEventListener("change", () => save({ ingame: ingameOn.checked }));
        const steamOnly = h("input", { type: "checkbox" }); steamOnly.checked = xs.steamOnly; steamOnly.addEventListener("change", () => save({ steamOnly: steamOnly.checked }));
        const tagsIn = h("input", { type: "text", value: xs.tags, class: "x-tags", placeholder: "#FreeGames #PCGaming …" });
        const tagsSave = h("button", { class: "btn gray small", type: "button", text: "Save tags" }); tagsSave.addEventListener("click", () => save({ tags: tagsIn.value }));
        const tagsReset = h("button", { class: "btn gray small", type: "button", text: "Reset" }); tagsReset.addEventListener("click", () => save({ tags: xs.defaultTags }));
        const status = h("div", { class: "panel" }, h("h3", { text: "Account and automatic posts" }),
          h("div", { class: "grid four" },
            tile("This month", money(xs.monthSpend), "about what X has charged"),
            tile("Automatic today", `${xs.postedToday} of ${xs.daily}`, xs.enabled ? "free games" : "switched off"),
            tile("Manual today", `${xs.manualToday} of ${xs.manualMax}`, "posts you wrote"),
            tile("Waiting", String(xs.queue.length), xs.queue.length ? "scheduled" : "nothing scheduled")),
          !xs.configured && h("p", { class: "bad", text: "The four X keys aren't set in Fly yet, so nothing can be posted." }),
          xs.error && h("p", { class: "bad", text: "Last problem: " + xs.error.message }),
          xs.imageError && h("p", { class: "bad small", text: "Last automatic post went out without a picture: " + xs.imageError.message }),
          h("label", { class: "check" }, on, " Post new free games automatically"),
          h("label", { class: "check" }, linksOn, " Put the game's link in automatic posts (about " + money(xs.linkCost) + " each instead of " + money(xs.plainCost) + ")"),
          h("label", { class: "check" }, steamOnly, " Only post Steam games (skip Epic, GOG and the rest)"),
          h("label", { class: "check" }, ingameOn, " Post free items and packs inside free-to-play games (worded as an in-game offer)"),
          h("label", { class: "check" }, alwaysOn, " Also post older games that are always free to play (new free launches are always posted)"),
          h("div", { class: "row" }, h("label", { text: "Posts per day, at most " }), per, sv, chk),
          h("div", { class: "row" }, h("label", { text: "Hashtags " }), tagsIn, tagsSave, tagsReset),
          h("p", { class: "muted small", text: "Each automatic post gets its store's own tag (like #EpicGames) plus up to three from this list, rotating so no two posts match. Bundles skip the free and giveaway ones. A few well-picked tags do better than a wall of them." }),
          h("p", { class: "muted small", text: `Automatic posts carry the game's cover art (or the logo when there isn't any) and are spaced at least 3 hours apart. X charges about ${money(xs.plainCost)} for a plain post and about ${money(xs.linkCost)} for one with a link. ${xs.daily} a day is roughly ${money(xs.monthlyCost)} a month at the current setting.` }), note);

        // ----- the composer -----
        const text = h("textarea", { rows: "7", placeholder: "Write a post, or start from one of the ready-made ones…", class: "x-text" }); text.value = draft.text;
        const tpl = h("select", {}, h("option", { value: "", text: "Start from…" }), ...xs.templates.map(t => h("option", { value: t.id, text: t.name })));
        const addLink = h("input", { type: "checkbox" });
        const count = h("span", { class: "muted small" }), cost = h("span", { class: "muted small" });
        const fileIn = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif" });
        const preview = h("div", { class: "muted small", text: "" });
        const GRAPHICS = [["/img/x-post.jpg", "Project graphic"], ["/img/x-logo.jpg", "Logo"]];
        const pic = h("select", {}, h("option", { value: "", text: "Pick a ready-made picture…" }), ...GRAPHICS.map(([u, n]) => h("option", { value: u, text: n })));
        const setImage = (b64, name) => { draft.image = b64; draft.imageName = name; refresh(); };
        const useGraphic = async url => { try { const blob = await (await fetch(url)).blob(); const r = new FileReader(); r.onload = () => setImage(String(r.result).split(",")[1], GRAPHICS.find(g => g[0] === url)?.[1] || "picture"); r.readAsDataURL(blob); } catch { toast("Couldn't load that picture."); } };
        pic.addEventListener("change", () => { if (pic.value) { fileIn.value = ""; useGraphic(pic.value); } else setImage(null, ""); });
        const vidBox = h("input", { type: "checkbox" });
        vidBox.checked = Boolean(draft.video);
        vidBox.addEventListener("change", () => { draft.video = vidBox.checked; if (vidBox.checked) { fileIn.value = ""; pic.value = ""; draft.image = null; draft.imageName = ""; } refresh(); });
        const at = h("input", { type: "datetime-local" }); at.value = draft.at;
        const go = h("button", { class: "btn green", type: "button", text: "Post now" });
        const full = () => text.value.trim() + (addLink.checked && !hasLink(text.value) ? "\n\nsteamvaluechecker.com" : "");
        const refresh = () => {
          const t = full(), n = xLen(t);
          count.textContent = `${n} / 280`; count.className = n > 280 ? "bad small" : "muted small";
          cost.textContent = t ? `About ${money(hasLink(t) ? xs.linkCost : xs.plainCost)} on X${hasLink(t) ? " (it has a link)" : ""}.` : "";
          go.textContent = at.value ? "Schedule it" : "Post now"; go.disabled = !xs.configured || !t || n > 280 || (draft.video && Boolean(at.value));
          preview.textContent = draft.video ? (at.value ? "The promo video can only go out right now. Clear the time to post it." : "The 40 second promo video will be attached.") : draft.image ? `Picture: ${draft.imageName}` : draft.bundleId ? (/steamvaluechecker\.com\/[bd]\/\d+/i.test(draft.text) ? "The link will show the bundle's picture as a big card." : "The bundle's own picture will be attached.") : "No picture. Posts with one get noticed far more.";
          draft.text = text.value; draft.at = at.value;
        };
        tpl.addEventListener("change", () => { const t = xs.templates.find(x => x.id === tpl.value); if (t) { draft.bundleId = null; text.value = t.text; if (t.id === "promo") { draft.video = true; vidBox.checked = true; fileIn.value = ""; pic.value = ""; draft.image = null; draft.imageName = ""; refresh(); return; } if (!draft.image) { pic.value = GRAPHICS[0][0]; useGraphic(GRAPHICS[0][0]); } else refresh(); } });
        [text, addLink, at].forEach(el => el.addEventListener("input", refresh));
        [pic, fileIn].forEach(el => el.addEventListener("change", () => { if (draft.video && (pic.value || fileIn.value)) { draft.video = false; vidBox.checked = false; refresh(); } }));
        fileIn.addEventListener("change", () => {
          const f = fileIn.files?.[0]; pic.value = ""; if (!f) { draft.image = null; draft.imageName = ""; return refresh(); }
          if (f.size > (at.value ? 2 : 5) * 1024 * 1024) { toast(`Pictures can be ${at.value ? 2 : 5} MB at most${at.value ? " on scheduled posts" : ""}.`); fileIn.value = ""; return; }
          const r = new FileReader(); r.onload = () => { draft.image = String(r.result).split(",")[1]; draft.imageName = f.name; refresh(); }; r.readAsDataURL(f);
        });
        go.addEventListener("click", () => busy(go, async () => {
          const t = full(), sched = at.value ? new Date(at.value).getTime() : null;
          if (!confirm(sched ? `Schedule this post for ${when(sched)}?` : "Post this to X now? It goes out right away.")) return;
          try {
            await api("/api/admin/xposter/post", { text: t, ...(sched ? { at: sched } : {}), ...(draft.image ? { image: draft.image } : {}), ...(draft.video ? { video: "promo" } : {}), ...(!sched && draft.bundleId ? { bundle_id: draft.bundleId } : {}) });
            toast(sched ? "Scheduled." : "Posted.", "ok"); draft = { text: "", image: null, imageName: "", at: "", bundleId: null, video: false }; await draw();
          } catch (e) { toast(e.message); }
        }));
        refresh();
        const composer = h("div", { class: "panel" }, h("h3", { text: "Write a post" }),
          h("p", { class: "muted", text: "For ads, announcements and anything else you'd rather word yourself. Ready-made posts say \"link in bio\"; add the website link with the tickbox when you want people to click straight through." }),
          h("div", { class: "row" }, tpl),
          text,
          h("div", { class: "row", style: "justify-content:space-between" }, count, cost),
          h("label", { class: "check" }, addLink, " Add the website link"),
          h("div", { class: "row" }, h("label", { text: "Picture " }), pic, fileIn), preview,
          h("label", { class: "check" }, vidBox, " Attach the promo video instead (40 seconds, posts right now only)"),
          h("div", { class: "row" }, h("label", { text: "Send at " }), at, h("span", { class: "muted small", text: "Leave empty to post now. Scheduled posts go out within a few minutes of the time." })),
          h("div", { class: "row" }, go),
          h("p", { class: "muted small", text: "Pictures are uploaded when the post goes out. If X turns the picture down, nothing gets posted and you'll see why." }));

        // ----- the latest bundles -----
        const postBundle = (b, btn) => busy(btn, async () => {
          if (!confirm(`Post "${b.title}" to X now?`)) return;
          try { await api("/api/admin/xposter/post", { text: b.text, bundle_id: b.id }); toast("Posted.", "ok"); await draw(); } catch (e) { toast(e.message); }
        });
        const linkBox = h("input", { type: "checkbox" }); linkBox.checked = bundleLink; linkBox.addEventListener("change", () => { bundleLink = linkBox.checked; draw(); });
        const fresh = bl.bundles.filter(b => !b.posted);
        const newest = h("button", { class: "btn green small", type: "button", text: "Post the newest", disabled: !xs.configured || !fresh.length }); if (fresh.length) newest.addEventListener("click", () => postBundle(fresh[0], newest));
        const bundles = h("div", { class: "panel" }, h("h3", { text: "Latest bundles" }),
          h("p", { class: "muted", text: "The newest bundles the bot has found. Each one goes out with its own picture and a link to a page on the site that shows the bundle and sends people on to the store after a few seconds. Post one as is, or send it to the box above to reword it first." }),
          h("div", { class: "row" }, newest, h("label", { class: "check" }, linkBox, ` Include the bundle's link (about ${money(xs.linkCost)} each instead of ${money(xs.plainCost)})`)),
          bl.bundles.length ? h("table", {}, h("thead", {}, h("tr", {}, ["Bundle", "Store", "Price", "Ends", "Visits", ""].map(c => h("th", { text: c })))),
            h("tbody", {}, bl.bundles.map(b => {
              const go = h("button", { class: "btn gray small", type: "button", text: "Post to X", disabled: !xs.configured }); go.addEventListener("click", () => postBundle(b, go));
              const ed = h("button", { class: "btn gray small", type: "button", text: "Edit first" });
              ed.addEventListener("click", () => { draft.text = b.text; draft.bundleId = b.id; draft.image = null; draft.imageName = ""; pic.value = ""; text.value = b.text; refresh(); text.scrollIntoView({ behavior: "smooth", block: "center" }); text.focus(); });
              return h("tr", {}, h("td", {}, h("b", { text: b.title }), b.gameCount ? h("div", { class: "muted small", text: b.gameCount + " games" }) : null), h("td", { text: b.storeName }), h("td", { text: b.price || "–" }),
                h("td", { text: b.expiresAt ? when(b.expiresAt) : "–" }), h("td", { text: b.visits ? `${b.visits} (${b.clicks} went on)` : "–" }), h("td", {}, b.posted ? h("span", { class: "muted", text: "Posted ✓ " }) : null, go, " ", ed));
            }))) : h("p", { class: "muted", text: "No active bundles right now." }));

        // ----- free games right now -----
        const postFree = (g, btn) => busy(btn, async () => {
          if (!confirm(`Post "${g.title}" to X now?`)) return;
          try { await api("/api/admin/xposter/post", { text: g.text, free_id: g.id }); toast("Posted.", "ok"); await draw(); } catch (e) { toast(e.message); }
        });
        const freeBox = h("input", { type: "checkbox" }); freeBox.checked = freeLink; freeBox.addEventListener("change", () => { freeLink = freeBox.checked; draw(); });
        const freshFree = fl.games.filter(g => !g.posted);
        const newestFree = h("button", { class: "btn green small", type: "button", text: "Post the soonest to end", disabled: !xs.configured || !freshFree.length }); if (freshFree.length) newestFree.addEventListener("click", () => postFree(freshFree[0], newestFree));
        const nextPanel = h("div", { class: "panel" }, h("h3", { text: "Next automatic post" }),
          !nx || nx.off ? h("p", { class: "muted", text: "Automatic posting is off, so nothing is lined up. Turn it on above and the next one shows up here." })
            : nx.nothing ? h("p", { class: "muted", text: "Nothing new to post right now. Every free game has already gone out." })
            : h("div", {},
              h("p", { class: "muted", text: `${nx.title} on ${nx.shop || "the store"}${nx.expiry ? ", ends " + new Date(nx.expiry).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET" : ""}. ${nx.capped ? "Today's limit is used up, so it goes out tomorrow." : nx.waitMs > 0 ? `It goes out in about ${Math.ceil(nx.waitMs / 60000)} min.` : "It goes out on the next check, within a few minutes."}` }),
              h("pre", { class: "xprev", text: nx.text }),
              h("p", { class: "muted small", text: `${nx.chars} characters, about ${money(nx.cost)} to send.${nx.link ? " X turns the link into a card with the game's picture." : ""}` })));
        const freeGames = h("div", { class: "panel" }, h("h3", { text: "Free games right now" }),
          h("p", { class: "muted", text: "Every game that's free to keep at the moment, soonest to end first. Each one goes out with a link to its page on the site, which shows the game's picture and sends people on to the store. Games you post here are skipped by the automatic posts." }),
          h("div", { class: "row" }, newestFree, h("label", { class: "check" }, freeBox, ` Include the game's link (about ${money(xs.linkCost)} each instead of ${money(xs.plainCost)})`)),
          fl.games.length ? h("table", {}, h("thead", {}, h("tr", {}, ["Game", "Store", "Ends", "Visits", ""].map(c => h("th", { text: c })))),
            h("tbody", {}, fl.games.map(g => {
              const go = h("button", { class: "btn gray small", type: "button", text: "Post to X", disabled: !xs.configured }); go.addEventListener("click", () => postFree(g, go));
              const ed = h("button", { class: "btn gray small", type: "button", text: "Edit first" });
              ed.addEventListener("click", () => { draft.text = g.text; draft.bundleId = null; draft.image = null; draft.imageName = ""; pic.value = ""; text.value = g.text; refresh(); text.scrollIntoView({ behavior: "smooth", block: "center" }); });
              return h("tr", {}, h("td", {}, h("b", { text: g.title })), h("td", { text: g.shop }), h("td", { text: g.expiry ? when(g.expiry) : "–" }), h("td", { text: g.visits ? `${g.visits} (${g.clicks} went on)` : "–" }),
                h("td", {}, g.posted ? h("span", { class: "muted small", text: "Already posted " }) : null, go, " ", ed));
            }))) : h("p", { class: "muted", text: "No free games right now." }));

        // ----- the Friday roundup -----
        const weeklyPanel = wk && h("div", { class: "panel" }, h("h3", { text: "Weekly best deals" }),
          h("p", { class: "muted", text: "Every Friday around noon Eastern, the bot posts the five biggest Steam savings of the week: one X post (when auto posting is on) and one Discord post in the channel below. Both link to one page on the site, so the visits show up on Link traffic." }),
          (() => {
            const on = h("input", { type: "checkbox" }); on.checked = wk.on; on.addEventListener("change", () => api("/api/admin/weekly", { on: on.checked }).then(() => toast("Saved.", "ok")).catch(e => toast(e.message)));
            const ch = h("input", { type: "text", placeholder: "Discord channel ID (optional)", value: wk.channel, size: "28" });
            const save = h("button", { class: "btn gray small", type: "button", text: "Save channel" }); save.addEventListener("click", () => busy(save, async () => { try { await api("/api/admin/weekly", { channel: ch.value }); toast("Saved.", "ok"); } catch (e) { toast(e.message); } }));
            const now = h("button", { class: "btn green small", type: "button", text: "Post it now", disabled: !wk.picks.length }); now.addEventListener("click", () => busy(now, async () => { if (!confirm("Post this week's deals now?")) return; try { await api("/api/admin/weekly/run", {}); toast("Posted.", "ok"); await draw(); } catch (e) { toast(e.message); } }));
            return h("div", {}, h("div", { class: "row" }, h("label", { class: "check" }, on, " Post every Friday"), ch, save, now),
              wk.last ? h("p", { class: "muted small", text: `Last post: ${when(wk.last.at)}. X: ${wk.last.x === null ? "not posted" : String(wk.last.x).startsWith("failed") ? wk.last.x : "posted"}. Discord: ${wk.last.discord === null ? "no channel set" : wk.last.discord === true ? "posted" : wk.last.discord}.` }) : h("p", { class: "muted small", text: "Nothing posted yet." }));
          })(),
          wk.picks.length ? h("table", {}, h("thead", {}, h("tr", {}, ["This week's picks", "Was", "Now", "Off"].map(c => h("th", { text: c })))),
            h("tbody", {}, wk.picks.map(p => h("tr", {}, h("td", {}, h("b", { text: p.title })), h("td", { text: p.regular }), h("td", { text: p.price }), h("td", { text: "-" + p.cut + "%" }))))) : h("p", { class: "muted", text: "No deals good enough to post right now." }),
          wk.page ? h("p", { class: "muted small" }, "The page the posts link to: ", h("a", { href: wk.page, target: "_blank", rel: "noopener noreferrer", text: "open the deals page" })) : null,
          wk.xText ? h("pre", { class: "x-text", text: wk.xText }) : null);

        // ----- schedule -----
        const queue = h("div", { class: "panel" }, h("h3", { text: "Scheduled" }),
          xs.queue.length ? h("table", {}, h("thead", {}, h("tr", {}, ["When", "Post", ""].map(c => h("th", { text: c })))),
            h("tbody", {}, xs.queue.map(q => { const b = h("button", { class: "btn gray small", type: "button", text: "Remove" }); b.addEventListener("click", () => busy(b, async () => { await api("/api/admin/xposter/unschedule", { key: q.key }); await draw(); })); return h("tr", {}, h("td", { text: when(q.at) }), h("td", { text: q.text.length > 120 ? q.text.slice(0, 120) + "…" : q.text }), h("td", {}, b)); })))
            : h("p", { class: "muted", text: "Nothing is scheduled." }));

        // ----- what went out -----
        const kinds = { auto: "Free game", manual: "Manual", scheduled: "Scheduled", bundle: "Bundle" };
        const hist = h("div", { class: "panel" }, h("h3", { text: "Recent posts" }),
          xs.history.length ? h("div", { class: "scroll-y" }, h("table", {}, h("thead", {}, h("tr", {}, ["When", "Kind", "Post", ""].map(c => h("th", { text: c })))),
            h("tbody", {}, xs.history.map(x => {
              const del = h("button", { class: "btn gray small", type: "button", text: "Delete" });
              del.addEventListener("click", () => busy(del, async () => { if (!confirm("Delete this post from X?")) return; try { await api("/api/admin/xposter/delete", { id: x.id }); toast("Deleted.", "ok"); await draw(); } catch (e) { toast(e.message); } }));
              return h("tr", {}, h("td", { text: when(x.at) }), h("td", { text: (kinds[x.kind] || x.kind) + (x.media ? " + picture" : "") }), h("td", { text: x.text.length > 110 ? x.text.slice(0, 110) + "…" : x.text }),
                h("td", {}, x.id && h("a", { href: "https://x.com/i/status/" + x.id, target: "_blank", rel: "noopener", text: "View" }), " ", x.id && del));
            })))) : h("p", { class: "muted", text: "Nothing posted yet." }));
        body.replaceChildren(status, nextPanel, composer, weeklyPanel, freeGames, bundles, queue, hist);
      };
      try { await draw(); } catch (e) { fail(e); }
    }

    async function adminSystem(body, fail) {
      const draw = async () => {
        // don't redraw under someone who is typing in a box on this page
        if (body.children.length && body.contains(document.activeElement) && document.activeElement.tagName === "INPUT" && document.activeElement.type !== "checkbox") { adminTimer = setTimeout(() => draw().catch(() => {}), 10_000); return; }
        const sys = await api("/api/admin/system");
        if (!document.body.contains(body)) return;
        const p = sys.process, b = sys.bot || {};
        const up = s => { const d = Math.floor(s / 86400), hr = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${hr}h` : hr ? `${hr}h ${m}m` : `${m}m`; };
        const tile = (k, v, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: String(v) }), sub && h("div", { class: "s", text: sub }));
        const lagBad = p.lagMs > 100;
        const st = await api("/api/admin/storage").catch(() => null);
        const [eg, se, cw, pb] = await Promise.all([api("/api/admin/errors").catch(() => null), api("/api/admin/serverevents").catch(() => null), api("/api/admin/commandwatch").catch(() => null), api("/api/admin/problems").catch(() => null)]);
        const ago = at => { const d = Math.round((Date.now() - at) / 1000); return d < 90 ? "just now" : up(d) + " ago"; };
        const errPanel = eg && h("div", { class: "panel" }, h("h3", { text: "Errors by cause" }),
          eg.groups.length ? h("div", { class: "scroll-y" }, h("table", {}, h("thead", {}, h("tr", {}, ["Where", "What", "Times", "Last seen"].map(c => h("th", { text: c })))),
            h("tbody", {}, eg.groups.map(g => h("tr", {}, h("td", {}, h("b", { text: g.where })), h("td", { text: g.message }), h("td", { text: String(g.count), class: g.count >= 10 ? "bad" : "" }), h("td", { text: ago(g.last) })))))) : h("p", { class: "muted", text: eg.available ? "No errors logged. Nice." : "The log isn't running." }));
        const pbPanel = pb && h("div", { class: "panel" }, h("h3", { text: "Quiet problems" }),
          h("p", { class: "muted", text: "Things that failed without anyone being told: a thank-you DM that wouldn't send, an X post that errored, a weekly post that didn't go out." }),
          pb.list.length ? h("div", {}, h("table", {}, h("thead", {}, h("tr", {}, ["Where", "What", "When"].map(c => h("th", { text: c })))),
            h("tbody", {}, pb.list.map(e => h("tr", {}, h("td", {}, h("b", { text: e.where })), h("td", { text: e.message }), h("td", { text: ago(e.at) }))))),
            (() => { const b = h("button", { class: "btn gray small", type: "button", text: "Clear the list" }); b.addEventListener("click", () => busy(b, async () => { await api("/api/admin/problems/clear", {}); adminRoute(); })); return b; })())
            : h("p", { class: "muted", text: "Nothing has failed quietly. All good." }));
        const cwPanel = cw && h("div", { class: "panel" }, h("h3", { text: "Busiest users" }),
          cw.rows.length ? h("table", {}, h("thead", {}, h("tr", {}, ["Discord ID", "Last hour", "Last 24 h", "Most used", ""].map(c => h("th", { text: c })))),
            h("tbody", {}, cw.rows.map(r => h("tr", {}, h("td", { text: r.id }), h("td", {}, h("b", { text: String(r.hour), class: r.heavy ? "bad" : "" })), h("td", { text: String(r.day) }), h("td", { text: r.top }),
              h("td", {}, (() => { const b = h("button", { class: "btn gray small", type: "button", text: "Restrict" }); b.addEventListener("click", () => { if (confirm("Cut " + r.id + " off from the bot and dashboard? You can undo it on the People page.")) busy(b, async () => { await api("/api/admin/ban", { id: r.id, ban: true, reason: "Too many commands" }); toast("Restricted.", "ok"); }); }); return b; })()))))) : h("p", { class: "muted", text: "No commands since the bot started." }),
          h("p", { class: "muted small", text: `Counts reset when the bot restarts. ${cw.threshold} or more in an hour is flagged.` }));
        const srvPanel = se && h("div", { class: "panel" }, h("h3", { text: "Server joins and leaves" }),
          se.list.length ? h("table", {}, h("thead", {}, h("tr", {}, ["", "Server", "Members", "When"].map(c => h("th", { text: c })))),
            h("tbody", {}, se.list.map(e => h("tr", {}, h("td", { text: e.kind === "join" ? "➕ Joined" : "➖ Left" }), h("td", {}, h("b", { text: e.name }), h("div", { class: "muted small", text: e.id })), h("td", { text: e.members != null ? String(e.members) : "–" }), h("td", { text: ago(e.at) }))))) : h("p", { class: "muted", text: "Nothing since this feature started. You also get a DM each time the bot is added or removed." }));
        const fmt = n => n >= 1024 ? (n / 1024).toFixed(2) + " GB" : n > 0 && n < 0.1 ? "under 0.1 MB" : n + " MB";
        const storagePanel = st && h("div", { class: "panel" }, h("h3", { text: "Storage" }),
          st.volume ? h("div", { class: "grid four" },
            tile("Disk used", st.volume.pct + "%", `${fmt(st.volume.usedMb)} of ${fmt(st.volume.totalMb)}`),
            tile("Free space", fmt(st.volume.freeMb), st.volume.pct >= 85 ? "Running low: extend the volume" : st.volume.pct >= 70 ? "Getting full, plan to extend" : "Plenty of room"),
            tile("Database", fmt(st.dbMb), st.walMb ? fmt(st.walMb) + " in the write log" : "Write log is empty"),
            tile("Backups", fmt(st.backupsMb), st.backupCount + (st.backupCount === 1 ? " file" : " files"))) : h("p", { class: "muted", text: "Disk size isn't available on this host." }),
          st.tables.length ? h("table", {}, h("thead", {}, h("tr", {}, [h("th", { text: "Biggest tables" }), h("th", { text: "Size" })])), h("tbody", {}, st.tables.map(t => h("tr", {}, h("td", { text: t.name }), h("td", { text: fmt(t.mb) }))))) : null);
        body.replaceChildren(
          h("div", { class: "grid four" }, tile("Uptime", up(p.uptimeS), b.version ? "Version " + b.version : p.node), tile("Discord ping", b.pingMs != null ? b.pingMs + " ms" : "–", b.servers != null ? b.servers + " servers" : null),
            tile("Memory", p.rssMb + " MB", `${p.heapMb} MB of ${p.heapLimitMb} MB heap`), tile("Event loop lag", p.lagMs + " ms", lagBad ? "Slow: something is blocking" : "Healthy")),
          h("div", { class: "grid four" }, tile("Started", new Date(sys.deploy.startedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }), sys.deploy.release ? `Release ${sys.deploy.release}${sys.deploy.machine ? " · machine " + sys.deploy.machine : ""}${sys.deploy.region ? " · " + sys.deploy.region : ""}` : "Not running on Fly"), tile("Signed in now", sys.sessions.signedIn, `${sys.sessions.steamOnly} Steam-only`), tile("Node", p.node, p.platform), tile("Admin address", sys.admin.host || "path /admin", sys.admin.sharedCookie ? "Shared sign-in on" : "Sign-in on this address only")),
          storagePanel,
          pbPanel,
          errPanel,
          cwPanel,
          srvPanel,
          h("div", { class: "panel" }, h("h3", { text: "Background jobs" }),
            sys.jobs && sys.jobs.length ? h("div", { class: "scroll-y" }, h("table", {}, h("thead", {}, h("tr", {}, ["Job", "Last run", "Took", "Result", "Failures"].map(c => h("th", { text: c })))),
              h("tbody", {}, sys.jobs.map(j => {
                const ago = j.lastRun ? up(Math.round((Date.now() - j.lastRun) / 1000)) + " ago" : "never";
                const bad = Boolean(j.lastError), stale = j.lastRun && Date.now() - j.lastRun > 3 * 3600_000;
                const det = j.detail ? Object.entries(j.detail).map(([k, v]) => `${v} ${k}`).join(", ") : "";
                return h("tr", {}, h("td", {}, h("b", { text: j.name })), h("td", { text: ago, class: stale ? "bad" : "" }), h("td", { text: j.ms != null ? (j.ms < 1000 ? j.ms + " ms" : (j.ms / 1000).toFixed(1) + " s") : "–" }),
                  h("td", { class: bad ? "bad" : "", text: (bad ? "⚠️ " + j.lastError : "✅ ok") + (det ? " · " + det : "") }), h("td", { text: j.failures + " of " + j.runs }));
              })))) : h("p", { class: "muted", text: "No job has run yet since the bot started. They run every few minutes." })),
          h("div", { class: "panel" }, h("h3", { text: "Recent errors" }),
            sys.errors.length ? h("div", { class: "scroll-y" }, h("table", {}, h("thead", {}, h("tr", {}, [h("th", { text: "Where" }), h("th", { text: "When" })])), h("tbody", {}, sys.errors.map(e => h("tr", {}, h("td", { text: String(e.where) }), h("td", { text: new Date(e.at).toLocaleString() })))))) : h("p", { class: "muted", text: "None since the bot started." })),
          h("p", { class: "muted small", text: "This page refreshes by itself every 10 seconds." }));
        adminTimer = setTimeout(() => draw().catch(() => {}), 10_000);
      };
      try { await draw(); } catch (e) { fail(e); }
    }

    async function adminVotes(body, fail) {
      try {
        const v = await api("/api/admin/votes");
        if (!v.enabled) return body.replaceChildren(h("div", { class: "notice warn", text: "Top.gg isn't connected. Add the TOPGG_TOKEN secret on Fly and restart." }));
        const tile = (k, val, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: String(val) }), sub && h("div", { class: "s", text: sub }));
        const ago = at => { const d = Math.round((Date.now() - at) / 1000); return d < 90 ? "just now" : d < 3600 ? Math.round(d / 60) + " min ago" : d < 86400 ? Math.round(d / 3600) + " h ago" : Math.round(d / 86400) + " d ago"; };
        const ok = v.health.lastOkAt;
        body.replaceChildren(
          h("div", { class: "grid four" }, tile("Votes counted", v.votes.toLocaleString(), "Since tracking began"), tile("People who voted", v.voters.toLocaleString(), "All time"), tile("XP paid out", v.xp.toLocaleString(), `${v.perVote} per vote, double on weekends`),
            tile("Top.gg check", v.health.lastError ? "Failing" : ok ? "Working" : "Waiting", v.health.lastError ? "Last error: " + v.health.lastError : ok ? "Last check " + ago(ok) : "Runs every few minutes")),
          h("div", { class: "grid two" },
            h("div", { class: "panel" }, h("h3", { text: "Top voters" }),
              v.top.length ? h("table", {}, h("thead", {}, h("tr", {}, [h("th", { text: "Discord ID" }), h("th", { text: "Votes" })])), h("tbody", {}, v.top.map(t => h("tr", {}, h("td", { text: t.id }), h("td", { text: String(t.votes) }))))) : h("p", { class: "muted", text: "No votes yet." })),
            h("div", { class: "panel" }, h("h3", { text: "Latest votes" }),
              v.recent.length ? h("table", {}, h("thead", {}, h("tr", {}, ["When", "Voter", "XP"].map(c => h("th", { text: c })))), h("tbody", {}, v.recent.map(r => h("tr", {}, h("td", { text: ago(r.at) }), h("td", { text: r.id }), h("td", { text: `${r.xp}${r.servers ? " × " + r.servers + (r.servers === 1 ? " server" : " servers") : " (no XP yet)"}` }))))) : h("p", { class: "muted", text: "Nothing yet." }))));
      } catch (e) { fail(e); }
    }

    async function adminSupporters(body, fail) {
      try {
        const r = await api("/api/admin/supporters");
        const when = ms => new Date(ms).toLocaleDateString("en-US", { timeZone: "America/New_York" });
        const WHY = {
          "no-home-server": "I can't tell which server is your home server, because the bot is in more than one. On Fly, add a secret called MAIN_GUILD_ID with that server's ID (right-click the server with Developer Mode on, Copy Server ID), then restart.",
          "not-in-server": "The bot isn't in your home server any more.",
          "no-permission": "The bot doesn't have the Manage Roles permission in your home server. Turn it on for the bot's role in Server Settings, Roles.",
          "role-too-high": "A role called Supporter exists but sits above the bot's own role. In Server Settings, Roles, drag the bot's role above Supporter.",
          "not-a-member": "That person isn't in your home server. They get the role the moment they join.",
          "failed": "Discord refused the change. Check the bot's role is above Supporter and try again."
        };
        const id = h("input", { type: "text", placeholder: "Discord ID", inputmode: "numeric" }), days = h("input", { type: "number", min: "1", max: "3660", value: "30", class: "ovs-cur" });
        body.replaceChildren(
          r.home && !r.home.ok ? h("div", { class: "notice warn" }, h("strong", { text: "The Supporter role can't be given right now. " }), WHY[r.home.why] || "Something is off with the home server.") : null,
          r.home && r.home.ok ? h("div", { class: "notice ok", text: `The Supporter role goes out in ${r.home.name}.` }) : null,
          r.enabled ? null : h("div", { class: "notice warn", text: "Square isn't connected, so members can't buy a pass. Add SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID and SQUARE_WEBHOOK_SIGNATURE_KEY as secrets on Fly and restart. You can still hand passes out below." }),
          r.revenue && h("div", { class: "grid four" },
            ...[["Last 30 days", r.revenue.last30, r.revenue.count30 + " passes"], ["All time", r.revenue.total, r.revenue.count + " passes"], ["Refunded", r.revenue.refunded, r.revenue.refunds + " refund" + (r.revenue.refunds === 1 ? "" : "s") + ", not counted above"]].map(([k, c, s]) =>
              h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: "$" + (c / 100).toFixed(2) }), h("div", { class: "s", text: s })))),
          r.revenue && h("div", { class: "panel" }, h("h3", { text: "By month" }),
            h("p", { class: "muted small", text: `${r.revenue.founders} of ${r.revenue.foundersMax} founding spots taken. ${r.revenue.gifts} of the paid passes were gifts. Months are Eastern time.` }),
            r.revenue.months.length ? h("div", { class: "scroll-x" }, h("table", { class: "sup-table" }, h("thead", {}, h("tr", {}, ["Month", "Passes", "Sales", "Refunded"].map(c => h("th", { text: c })))),
              h("tbody", {}, ...r.revenue.months.map(m => h("tr", {}, h("td", { text: m.month }), h("td", { text: String(m.count) }), h("td", { text: "$" + (m.cents / 100).toFixed(2) }), h("td", { text: m.refunded ? "$" + (m.refunded / 100).toFixed(2) : "-" })))))) : h("p", { class: "muted", text: "No paid passes yet." })),
          h("div", { class: "panel" }, h("h3", { text: "Give someone a pass" }),
            h("div", { class: "row" }, id, days, h("span", { class: "muted small", text: "days" }),
              h("button", { class: "btn blue", type: "button", text: "Give pass", onclick: e => busy(e.currentTarget, async () => { const x = await api("/api/admin/supporters/grant", { user_id: id.value, days: Number(days.value) }); toast("Pass runs until " + when(x.until) + "." + (x.role && x.role !== "ok" ? " Role not given: " + (WHY[x.role] || x.role) : ""), x.role && x.role !== "ok" ? "warn" : "ok"); adminSupporters(body, fail); }) }))),
          h("div", { class: "panel" }, h("h3", { text: "Supporters" }),
            h("div", { class: "row" }, h("button", { class: "btn gray small", type: "button", text: "Re-send roles", title: "Give the Supporter role to everyone with a live pass", onclick: e => busy(e.currentTarget, async () => { const x = await api("/api/admin/supporters/resync", {}); const bad = Object.entries(x.problems); toast(bad.length ? `${x.ok} done. Not given: ` + bad.map(([k, n]) => `${n} (${(WHY[k] || k).split(".")[0]})`).join("; ") : `Role sent to ${x.ok}.`, bad.length ? "warn" : "ok"); }) }),
              h("button", { class: "btn gray small", type: "button", text: "Download CSV", onclick: e => busy(e.currentTarget, async () => { const x = await api("/api/admin/supporters.csv"); const a = h("a", { href: URL.createObjectURL(new Blob([x.csv], { type: "text/csv" })), download: "supporters.csv" }); document.body.append(a); a.click(); a.remove(); }) }),
              h("span", { class: "muted small", text: "Dates are Eastern time and end at 11:59 pm. Everything here is saved to the audit log." })),
            r.everyone.length ? h("div", { class: "scroll-x" }, h("table", { class: "sup-table" }, h("thead", {}, h("tr", {}, ["Discord ID", "Status", "Pass ends", "Add or remove days", "Founder", "Wall name", ""].map(c => h("th", { text: c })))),
              h("tbody", {}, r.everyone.map(a => {
                const call = (body, msg) => api("/api/admin/supporters/edit", { id: a.id, ...body }).then(x => { toast(msg + (x && x.role && x.role !== "ok" ? " Role not changed: " + (WHY[x.role] || x.role).split(".")[0] + "." : ""), x && x.role && x.role !== "ok" ? "warn" : "ok"); adminSupporters(body_, fail); }).catch(err => toast(err.message, "error"));
                const body_ = body;
                const date = h("input", { type: "date", value: a.until ? new Date(a.until).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : "", "aria-label": "Pass ends" });
                const days = h("input", { type: "number", value: "30", class: "ovs-cur", "aria-label": "Days to add" });
                const founder = h("input", { type: "checkbox", checked: a.founder, "aria-label": "Founding supporter" });
                const wall = h("input", { type: "text", maxlength: "24", value: a.wall, placeholder: "not shown", "aria-label": "Wall name" });
                return h("tr", {}, h("td", { text: a.id }), h("td", {}, h("span", { class: "pf-badge" + (a.active ? "" : " off"), text: a.active ? "Active" : "Ended" })),
                  h("td", {}, h("div", { class: "row" }, date, h("button", { class: "btn gray small", type: "button", text: "Set", onclick: e => busy(e.currentTarget, () => call({ action: "set_until", date: date.value }, "Pass end date saved.")) }))),
                  h("td", {}, h("div", { class: "row" }, days, h("button", { class: "btn gray small", type: "button", text: "Apply", onclick: e => busy(e.currentTarget, () => call({ action: "add_days", days: Number(days.value) }, "Days changed.")) }))),
                  h("td", {}, (() => { founder.addEventListener("change", () => call({ action: "founder", on: founder.checked }, founder.checked ? "Marked as a founder." : "Founder mark removed.")); return founder; })()),
                  h("td", {}, h("div", { class: "row" }, wall, h("button", { class: "btn gray small", type: "button", text: "Save", onclick: e => busy(e.currentTarget, () => call({ action: "wall", name: wall.value }, wall.value.trim() ? "Wall name saved." : "Taken off the wall.")) }))),
                  h("td", {}, h("div", { class: "row" },
                    h("button", { class: "btn gray small", type: "button", text: "Re-send role", onclick: e => busy(e.currentTarget, () => call({ action: "resync" }, "Role re-sent.")) }),
                    a.active ? h("button", { class: "btn red small", type: "button", text: "End pass", onclick: e => busy(e.currentTarget, async () => { if (!confirm("End this pass now and take the Supporter role back?")) return; await call({ action: "remove" }, "Pass ended."); }) }) : null)));
              })))) : h("div", { class: "empty", text: "No supporters yet." })),
          h("div", { class: "panel" }, h("h3", { text: "Square activity" }), h("p", { class: "muted small", text: "Every call Square makes to the bot, newest first. If a payment never shows up here, Square isn't reaching it: check the webhook address and its events." }),
            r.payments.length ? h("table", {}, h("thead", {}, h("tr", {}, ["When", "What", "Details"].map(c => h("th", { text: c })))), h("tbody", {}, r.payments.map(e => h("tr", {}, h("td", { text: new Date(e.at).toLocaleString("en-US", { timeZone: "America/New_York" }) }), h("td", {}, h("b", { class: /Rejected|Error/.test(e.what) ? "bad" : "", text: e.what })), h("td", { text: e.detail || "" }))))) : h("div", { class: "empty", text: "Nothing yet." })),
          h("div", { class: "grid two" },
            h("div", { class: "panel" }, h("h3", { text: "Latest" }),
              r.recent.length ? h("table", {}, h("thead", {}, h("tr", {}, ["When", "Who", "Days", "Via"].map(c => h("th", { text: c })))), h("tbody", {}, r.recent.map(e => h("tr", {}, h("td", { text: new Date(e.at).toLocaleString("en-US", { timeZone: "America/New_York" }) }), h("td", { text: e.id }), h("td", { text: String(e.days) }), h("td", { text: e.via }))))) : h("div", { class: "empty", text: "Nothing yet." }))));
      } catch (e) { fail(e); }
    }

    /** Reported profile pages, plus a box to hide or restore any page by its name. */
    async function adminProfiles(body, fail) {
      try {
        const r = await api("/api/admin/profiles");
        const act = (slug, action, msg) => api("/api/admin/profiles", { slug, action }).then(() => { toast(msg, "ok"); adminProfiles(body, fail); }).catch(e => toast(e.message, "error"));
        const slug = h("input", { type: "text", placeholder: "Page name, like jacob", autocapitalize: "none", "aria-label": "Page name" });
        const ago = t => new Date(t).toLocaleString("en-US", { timeZone: "America/New_York" });
        const bySlug = new Map(); for (const x of r.reports) { const e = bySlug.get(x.slug) ?? { slug: x.slug, hidden: x.hidden, reasons: [], last: 0 }; e.reasons.push(x.reason); e.last = Math.max(e.last, x.at); bySlug.set(x.slug, e); }
        body.replaceChildren(
          h("div", { class: "panel" }, h("h3", { text: `Reported pages (${bySlug.size})` }),
            bySlug.size ? h("div", { class: "scroll-x" }, h("table", {}, h("thead", {}, h("tr", {}, ["Page", "Reports", "Latest", "What people said", ""].map(c => h("th", { text: c })))),
              h("tbody", {}, [...bySlug.values()].sort((a, b) => b.last - a.last).map(x => h("tr", {}, h("td", {}, h("a", { href: "/u/" + encodeURIComponent(x.slug), target: "_blank", rel: "noopener", text: "@" + x.slug }), x.hidden ? h("span", { class: "pf-badge off", text: "Hidden" }) : null),
                h("td", { text: String(x.reasons.length) }), h("td", { text: ago(x.last) }), h("td", { text: [...new Set(x.reasons)].slice(0, 3).join(" | ") }),
                h("td", {}, h("div", { class: "row" }, x.hidden ? h("button", { class: "btn gray small", type: "button", text: "Show again", onclick: e => busy(e.currentTarget, () => act(x.slug, "show", "Page is visible again.")) }) : h("button", { class: "btn red small", type: "button", text: "Hide page", onclick: e => busy(e.currentTarget, () => act(x.slug, "hide", "Page hidden.")) }),
                  h("button", { class: "btn gray small", type: "button", text: "Dismiss", onclick: e => busy(e.currentTarget, () => act(x.slug, "dismiss", "Reports cleared.")) })))))))) : h("div", { class: "empty", text: "No reports. Nice." })),
          h("div", { class: "panel" }, h("h3", { text: "Hide or restore a page by name" }),
            h("div", { class: "row" }, slug, h("button", { class: "btn red small", type: "button", text: "Hide", onclick: e => busy(e.currentTarget, () => act(slug.value.trim().replace(/^@/, "").toLowerCase(), "hide", "Page hidden.")) }), h("button", { class: "btn gray small", type: "button", text: "Show", onclick: e => busy(e.currentTarget, () => act(slug.value.trim().replace(/^@/, "").toLowerCase(), "show", "Page is visible again.")) })),
            h("p", { class: "muted small", text: "A hidden page shows a not-found message to visitors. The owner can still see and edit it." })));
      } catch (e) { fail(e); }
    }

    async function adminDataReq(body, fail) {
      try {
        const r = await api("/api/admin/datarequests");
        const tile = (k, val, sub) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: String(val) }), sub && h("div", { class: "s", text: sub }));
        body.replaceChildren(
          h("div", { class: "grid four" }, tile("Exports, 30 days", r.month.export), tile("Deletions, 30 days", r.month.delete), tile("Logged in all", r.list.length, "Newest 100 kept")),
          h("div", { class: "panel" }, h("h3", { text: "Requests" }),
            r.list.length ? h("table", {}, h("thead", {}, h("tr", {}, ["When", "Request", "From"].map(c => h("th", { text: c })))), h("tbody", {}, r.list.map(e => h("tr", {}, h("td", { text: new Date(e.at).toLocaleString() }), h("td", { text: e.kind === "delete" ? "🗑️ Deleted their data" : "📦 Exported their data" }), h("td", { text: e.via }))))) : h("p", { class: "muted", text: "Nobody has asked yet." }),
            h("p", { class: "muted small", text: "Requests are handled the moment they are made, so this is a record, not a queue. It keeps no names or IDs, so deleting someone's data never leaves a trace of who they were." })));
      } catch (e) { fail(e); }
    }

    async function adminAudit(body) {
      const rows = [];
      let more = false, q = "";
      const list = h("div"), search = h("input", { type: "search", placeholder: "Filter by action, person or detail", "aria-label": "Filter the audit log" });
      const more$ = h("button", { class: "btn gray small", type: "button", text: "Load older" });
      const csv = h("button", { class: "btn gray small", type: "button", text: "Download CSV" });
      const paint = () => {
        list.replaceChildren(rows.length ? h("div", { class: "scroll-y tall" }, h("table", {}, h("thead", {}, h("tr", {}, ["When", "Action", "Target", "Details"].map(c => h("th", { text: c })))),
          h("tbody", {}, rows.map(r => h("tr", {}, h("td", { text: new Date(r.at).toLocaleString() }), h("td", {}, h("b", { text: r.action })), h("td", { text: r.target || "–" }), h("td", { class: "adm-audit-detail", text: r.detail || "" })))))) : h("p", { class: "muted", text: q ? "Nothing matches." : "Nothing yet. Actions you take in this panel show up here." }));
        more$.hidden = !more;
      };
      const load = async reset => {
        if (reset) rows.length = 0;
        const before = rows.length ? rows[rows.length - 1].id : "";
        const r = await api(`/api/admin/audit?q=${encodeURIComponent(q)}${before ? "&before=" + before : ""}`);
        rows.push(...r.rows); more = r.more; paint();
      };
      let t = 0;
      search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { q = search.value.trim(); load(true).catch(e => toast(e.message, "bad")); }, 250); });
      more$.addEventListener("click", () => busy(more$, () => load(false)));
      csv.addEventListener("click", () => {
        const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const text = ["when,action,target,details", ...rows.map(r => [new Date(r.at).toISOString(), r.action, r.target, r.detail].map(esc).join(","))].join("\n");
        const a = h("a", { href: URL.createObjectURL(new Blob([text], { type: "text/csv" })), download: "admin-audit-log.csv" }); document.body.append(a); a.click(); a.remove();
      });
      body.replaceChildren(h("div", { class: "panel" }, h("div", { class: "lookup-row" }, search, csv), list, h("div", { class: "row" }, more$)));
      try { await load(true); } catch (e) { list.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }

    /** Ctrl+K: jump to a page, run a quick action, or look someone up by Discord ID. */
    function adminPalette() {
      if (document.querySelector(".adm-pal-back")) return;
      const items = [
        ...Object.entries(ADMIN_PAGES).map(([id, m]) => ({ label: m.title, hint: "Page", run: () => { location.hash = "#/" + id; } })),
        { label: "Download the latest backup", hint: "Action", run: () => { location.href = "/api/admin/backup"; } },
        { label: "Switch light / dark theme", hint: "Action", run: () => { window.svcTheme && window.svcTheme.toggle(); } },
        { label: "Open Steam Value Checker", hint: "Link", run: () => { location.href = state.cfg.siteUrl || "/"; } }];
      const input = h("input", { type: "text", placeholder: "Type a page, an action, or paste a Discord ID…", "aria-label": "Search the admin panel", autocomplete: "off", spellcheck: "false" });
      const ul = h("ul", { role: "listbox" });
      let shown = [], at = 0;
      const close = () => back.remove();
      const choose = it => { close(); it.run(); };
      const paint = () => {
        const q = input.value.trim().toLowerCase(), id = input.value.replace(/\D/g, "");
        shown = items.filter(i => !q || i.label.toLowerCase().includes(q));
        if (/^\d{5,25}$/.test(id)) shown.unshift({ label: `Look up member ${id}`, hint: "Person", run: () => adminMemberCard(id) });
        at = Math.min(at, Math.max(0, shown.length - 1));
        ul.replaceChildren(...(shown.length ? shown.map((it, i) => h("li", { class: i === at ? "on" : "", role: "option", onclick: () => choose(it) }, it.label, h("small", { text: it.hint }))) : [h("li", {}, "Nothing matches.")]));
      };
      input.addEventListener("input", () => { at = 0; paint(); });
      input.addEventListener("keydown", e => {
        if (e.key === "Escape") return close();
        if (e.key === "ArrowDown") { e.preventDefault(); at = Math.min(shown.length - 1, at + 1); paint(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); at = Math.max(0, at - 1); paint(); }
        else if (e.key === "Enter" && shown[at]) { e.preventDefault(); choose(shown[at]); }
      });
      const back = h("div", { class: "adm-pal-back", onclick: e => { if (e.target === back) close(); } },
        h("div", { class: "adm-pal" }, input, ul, h("div", { class: "adm-pal-foot" }, h("span", {}, h("kbd", { text: "↑↓" }), " move"), h("span", {}, h("kbd", { text: "Enter" }), " open"), h("span", {}, h("kbd", { text: "Esc" }), " close"))));
      document.body.append(back);
      paint(); input.focus();
    }

    /** A quick look at one person from the palette, with the actions you would reach for. */
    async function adminMemberCard(id) {
      const back = h("div", { class: "adm-pal-back", onclick: e => { if (e.target === back) back.remove(); } });
      const card = h("div", { class: "adm-card-modal" }, h("p", { class: "muted", text: "Looking them up…" }));
      back.append(card); document.body.append(back);
      document.addEventListener("keydown", function esc(e) { if (e.key === "Escape") { back.remove(); document.removeEventListener("keydown", esc); } });
      const draw = u => {
        const act = (label, action, cls = "gray") => h("button", { class: `btn ${cls} small`, type: "button", text: label, onclick: ev => busy(ev.currentTarget, async () => { draw(await api("/api/admin/user", { id: u.id, action })); toast("Done.", "ok"); }) });
        const ban = h("button", { class: "btn small " + (u.banned ? "green" : "red"), type: "button", text: u.banned ? "Lift restriction" : "Restrict", onclick: ev => busy(ev.currentTarget, async () => {
          if (u.banned) await api("/api/admin/ban", { id: u.id, ban: false });
          else { const r = prompt("Why are you restricting this person? (optional, only you see it)"); if (r === null) return; await api("/api/admin/ban", { id: u.id, ban: true, reason: r }); }
          u.banned = !u.banned; draw(u);
        }) });
        const t = (k, v) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: String(v) }));
        card.replaceChildren(h("h3", { text: "Member " + u.id }), u.banned ? h("div", { class: "notice warn", text: "This person is restricted." }) : null,
          h("div", { class: "grid four" }, t("Wishlist", u.wishlist), t("Library", u.library), t("Alerts", u.alerts), t("Failed DMs", u.dmFailures)),
          h("p", { class: "muted small", text: `Region ${u.region} · ${u.delivery} · language ${u.lang} · ${u.paused ? "alerts paused" : "alerts on"} · joined ${new Date(u.joined).toLocaleDateString()}` }),
          h("div", { class: "row" }, act("Reset failed DMs", "reset_dm"), u.paused ? act("Resume alerts", "resume", "green") : act("Pause alerts", "pause"), ban));
      };
      try { draw(await api("/api/admin/user?id=" + encodeURIComponent(id))); } catch (e) { card.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    return { boot: adminBoot, route: adminRoute };
  }
  root.AdminUI = { create };
})(window);

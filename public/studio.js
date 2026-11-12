// The Overlay studio page: everything for making, styling and linking OBS overlays. app.js hands over its helpers (ctx)
// and calls view(ctx) when the address is /overlays. The overlays themselves are drawn by ov.js, so the preview here is the real thing.
(function (root) {
  "use strict";
  async function view(ctx) {
    const { h, api, app, state, pageHead, toast, busy, select, field, serverPicker, currentParam, currentView, overlayAssets, giveawayOverlayPanel, streamCardPanel } = ctx;
      app.replaceChildren(pageHead("Overlay studio", "Build a goal bar, server stats, timer, alerts, sale countdown or a rotating scene, style it, and paste its link into OBS as a Browser source."), h("div", { class: "muted", text: "Loading…" }));
      let d;
      try { d = await api("/api/overlays"); } catch (e) { return app.replaceChildren(pageHead("Overlay studio", ""), h("div", { class: "notice warn", text: e.message })); }
      const KIND = { goal: ["Goal bar", "A progress bar toward a number you pick"], stats: ["Server stats", "Live member and boost counts"], timer: ["Timer", "Count down to a time, or count up from one"],
        alerts: ["Alerts", "A pop-up for each new member or boost"], board: ["Leaderboard", "Your server's top XP members"], poll: ["Poll", "Ask your Discord a question and show the votes live"], playing: ["Who is playing", "Members playing a game right now"], price: ["Game price", "Price, lowest ever and a buy-or-wait call for one game"], deals: ["Best deals", "The biggest discounts on Steam right now"], free: ["Free games", "The free games you can claim right now"], sale: ["Sale countdown", "Counts down to the next big Steam sale"], scene: ["Scene", "One link that rotates through your other overlays"] };
      const SIZE = { poll: [460, 280], free: [460, 220], deals: [460, 220], price: [460, 220], board: [420, 330], playing: [460, 220], goal: [520, 120], stats: [380, 140], timer: [440, 150], alerts: [900, 150], sale: [480, 180], scene: [520, 180] };
      const sampleData = (k, cfg, value) => k === "goal" ? { current: cfg.source === "manual" ? Number(value) || 0 : Math.round(cfg.target * 0.6), target: cfg.target, pct: cfg.source === "manual" ? Math.max(0, Math.min(100, Math.round((Number(value) || 0) / cfg.target * 100))) : 60 } : k === "stats" ? { members: 1280, boosts: 14 } : k === "board" ? { rows: [["Alex", 12, 4210], ["Sam", 9, 2890], ["Riley", 7, 1760], ["Jo", 5, 940], ["Kai", 3, 410]].slice(0, cfg.limit || 5).map(([name, level, xp]) => ({ name, level, xp })) } : k === "playing" ? { games: [{ game: "Deep Rock Galactic", count: 4, names: ["Alex", "Sam", "Riley"] }, { game: "Hades II", count: 1, names: ["Jo"] }] } : k === "price" ? { game: { title: cfg.gameName || "Hades II", price: 17.99, currency: "USD", shop: "Steam", msrp: 29.99, atl: 14.99, verdict: "lean_buy" } } : k === "deals" ? { deals: [{ title: "Hades II", cut: 40, price: 17.99, currency: "USD" }, { title: "Balatro", cut: 25, price: 10.49, currency: "USD" }, { title: "Elden Ring", cut: 35, price: 38.99, currency: "USD" }, { title: "Hollow Knight", cut: 50, price: 7.49, currency: "USD" }].slice(0, cfg.limit || 4) } : k === "free" ? { games: [{ title: "Hades", shop: "Epic", expiry: new Date(Date.now() + 2 * 86400000).toISOString() }, { title: "Balatro", shop: "GOG", expiry: null }, { title: "Dead Cells", shop: "Steam", expiry: new Date(Date.now() + 5 * 3600000).toISOString() }].slice(0, cfg.limit || 4) } : k === "sale" ? { name: "Steam Winter Sale", start: Date.now() + 6 * 86400_000 + 4 * 3600_000, end: Date.now() + 24 * 86400_000, live: false } : { at: cfg.at, mode: cfg.mode };
      let sel = d.overlays[0]?.token ?? null, draft = null, frameTimer = 0, connTimer = 0;
      const list = h("div", { class: "ovs-list" }), editor = h("div", { class: "ovs-edit" });
      const find = tok => d.overlays.find(o => o.token === tok);
      const pad = v => String(v).padStart(2, "0");
      const toLocal = ms => { const x = new Date(ms || Date.now() + 30 * 60_000); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`; };
      const reload = async keep => { d = await api("/api/overlays"); if (keep !== undefined) sel = keep; paintList(); paintEditor(); };

      function paintList() {
        list.replaceChildren(
          ...d.overlays.map(o => h("button", { type: "button", class: "ovs-item" + (o.token === sel ? " on" : ""), onclick: () => { sel = o.token; paintList(); paintEditor(); } },
            h("strong", { text: (o.seen != null && o.seen < 30_000 ? "● " : "") + o.name }), h("span", { class: "muted small", text: KIND[o.kind][0] + (o.seen != null && o.seen < 30_000 ? " · live in OBS" : "") }))),
          d.overlays.length ? null : h("p", { class: "muted small", text: "Nothing yet. Add one below." }),
          h("div", { class: "ovs-add" }, h("div", { class: "muted small", text: "Add an overlay" }),
            ...d.kinds.map(k => h("button", { type: "button", class: "btn gray small", title: KIND[k][1], text: "+ " + KIND[k][0], onclick: e => busy(e.currentTarget, async () => {
              const cfg = k === "timer" ? { at: Date.now() + 30 * 60_000 } : k === "goal" ? { target: 100 } : {};
              try { const r = await api("/api/overlays", { action: "create", kind: k, guild_id: ["stats", "alerts", "board", "playing", "poll"].includes(k) ? d.guilds[0]?.id : undefined, config: cfg }); await reload(r.token); }
              catch (err) { toast(err.message, "error"); }
            }) })),
            d.overlays.length ? h("div", { class: "ovs-add" }, h("div", { class: "muted small", text: "Get them into OBS" }),
              h("button", { type: "button", class: "btn blue small", text: "Download an OBS scene", title: "A scene collection with every overlay already placed as a Browser source", onclick: downloadObs }),
              h("button", { type: "button", class: "btn gray small", text: "Copy all links", onclick: async () => { try { await navigator.clipboard.writeText(d.overlays.map(o => o.name + ": " + o.url).join("\n")); toast("All links copied.", "ok"); } catch { toast("Your browser wouldn't let me copy.", "warn"); } } })) : null));
      }

      /** An OBS scene collection with each overlay already set up as a Browser source. In OBS: Scene Collection, Import, pick the file. */
      function downloadObs() {
        const sources = [], items = []; let y = 20, id = 0;
        for (const o of d.overlays) {
          const [w0, h0] = SIZE[o.kind] || [500, 150], sc = o.config.scale || 1, w = Math.round(w0 * sc), hh = Math.round(h0 * sc);
          const name = "SVC " + o.name; id++;
          sources.push({ balance: 0.5, deinterlace_field_order: 0, deinterlace_mode: 0, enabled: true, flags: 0, hotkeys: {}, id: "browser_source", mixers: 255, monitoring_type: 0, muted: false, name, prev_ver: 536936448, private_settings: {}, "push-to-mute": false, "push-to-mute-delay": 0, "push-to-talk": false, "push-to-talk-delay": 0, settings: { url: o.url, width: w, height: hh, fps: 30, css: "", shutdown: false, restart_when_active: false, reroute_audio: false }, sync: 0, versioned_id: "browser_source", volume: 1.0 });
          items.push({ align: 5, blend_method: "default", blend_type: "normal", bounds: { x: 0, y: 0 }, bounds_align: 0, bounds_crop: false, bounds_type: 0, crop_bottom: 0, crop_left: 0, crop_right: 0, crop_top: 0, group_item_backup: false, hide_transition: { duration: 0 }, id, locked: false, name, pos: { x: 20, y }, private_settings: {}, rot: 0, scale: { x: 1, y: 1 }, scale_filter: "disable", scale_ref: { x: 1920, y: 1080 }, show_transition: { duration: 0 }, visible: true });
          y += hh + 20; if (y > 1000) y = 20;
        }
        sources.unshift({ balance: 0.5, deinterlace_field_order: 0, deinterlace_mode: 0, enabled: true, flags: 0, hotkeys: {}, id: "scene", mixers: 0, monitoring_type: 0, muted: false, name: "Steam Value Checker", prev_ver: 536936448, private_settings: {}, "push-to-mute": false, "push-to-mute-delay": 0, "push-to-talk": false, "push-to-talk-delay": 0, settings: { custom_size: false, id_counter: id, items }, sync: 0, versioned_id: "scene", volume: 1.0 });
        const json = { current_program_scene: "Steam Value Checker", current_scene: "Steam Value Checker", current_transition: "Fade", groups: [], modules: {}, name: "Steam Value Checker", preview_locked: false, quick_transitions: [], saved_projectors: [], scaling_enabled: false, scene_order: [{ name: "Steam Value Checker" }], sources, transition_duration: 300, transitions: [] };
        const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(json, null, 4)], { type: "application/json" })), download: "Steam-Value-Checker-overlays.json" });
        document.body.append(a); a.click(); a.remove();
        toast("Downloaded. In OBS: Scene Collection, Import, then pick the file. This file holds your private links, so keep it to yourself.", "ok");
      }

      // One-click looks. Each sets the colors, corners and font that suit it; the card's styling for the name lives in ov.css.
      const THEMES = [
        ["classic", "Classic", { accent: "#5865f2", text: "#ffffff", muted: "#94a3b8", bg: "#0b0e14", border: "#1e2638", bgOpacity: 85, radius: 16, font: "Inter", showBorder: true, shadow: true }],
        ["glass", "Glass", { accent: "#7dd3fc", text: "#ffffff", muted: "#dbeafe", bg: "#1e293b", border: "#ffffff", bgOpacity: 38, radius: 22, font: "Inter", showBorder: true, shadow: true }],
        ["neon", "Neon", { accent: "#22d3ee", text: "#e0f2fe", muted: "#7dd3fc", bg: "#050816", border: "#22d3ee", bgOpacity: 90, radius: 12, font: "Inter", showBorder: true, shadow: false }],
        ["gradient", "Gradient", { accent: "#c026d3", text: "#ffffff", muted: "#f5d0fe", bg: "#312e81", border: "#a78bfa", bgOpacity: 95, radius: 20, font: "Inter", showBorder: true, shadow: true }],
        ["retro", "Retro", { accent: "#facc15", text: "#fefce8", muted: "#d6d3d1", bg: "#111827", border: "#facc15", bgOpacity: 95, radius: 0, font: "Mono", showBorder: true, shadow: false }],
        ["minimal", "Minimal", { accent: "#ffffff", text: "#ffffff", muted: "#e2e8f0", bg: "#000000", border: "#ffffff", bgOpacity: 0, radius: 0, font: "Inter", showBorder: false, shadow: false }],
        ["steam", "Steam", { accent: "#66c0f4", text: "#c7d5e0", muted: "#8f98a0", bg: "#1b2838", border: "#2a475e", bgOpacity: 100, radius: 4, font: "System", showBorder: true, shadow: true }],
        ["cyber", "Cyber", { accent: "#fcee0a", text: "#fcee0a", muted: "#00f0ff", bg: "#0a0a12", border: "#fcee0a", bgOpacity: 95, radius: 0, font: "Mono", showBorder: false, shadow: false }],
        ["sunset", "Sunset", { accent: "#fb923c", text: "#fff7ed", muted: "#fed7aa", bg: "#7c2d12", border: "#fb923c", bgOpacity: 95, radius: 18, font: "Georgia", showBorder: true, shadow: true }]
      ];

      function paintEditor() {
        const o = find(sel);
        if (!o) { editor.replaceChildren(h("div", { class: "panel" }, h("p", { class: "muted", text: "Pick an overlay on the left, or add a new one." }))); return; }
        draft = { name: o.name, guild_id: o.guild_id, config: { ...o.config }, value: o.value };
        clearInterval(connTimer);
        const conn = h("p", { class: "small" });
        const paintConn = () => { const live = o.seen != null && o.seen < 30_000; conn.textContent = live ? `● Connected. OBS loaded this overlay ${Math.max(1, Math.round(o.seen / 1000)) === 1 ? "a second" : Math.round(o.seen / 1000) + " seconds"} ago.` : o.seen != null ? "○ Not open right now. OBS last loaded it a while ago." : "○ Not connected yet. Paste the link into OBS and this turns green by itself."; conn.style.color = live ? "var(--good, #3ddc97)" : "var(--muted, #94a3b8)"; };
        paintConn();
        connTimer = setInterval(async () => { if (!conn.isConnected) return clearInterval(connTimer); try { const r = await api("/api/overlays"); const m = r.overlays.find(x => x.token === o.token); if (m) { o.seen = m.seen; d.overlays.forEach(x => { const y = r.overlays.find(z => z.token === x.token); if (y) x.seen = y.seen; }); paintConn(); paintList(); } } catch { /* try again next time */ } }, 5000);
        const c = draft.config;
        const frame = h("iframe", { class: "ovs-frame", title: "Preview", loading: "lazy" });
        const sample = () => ({ current: o.kind === "goal" && c.source === "manual" ? draft.value : Math.round(c.target * 0.6), members: 1280, boosts: 14, children: o.kind === "scene" ? (c.items || []).map(t => find(t)).filter(Boolean).map(k => ({ kind: k.kind, config: k.config, data: sampleData(k.kind, k.config, k.value) })) : undefined });
        const refresh = () => { clearTimeout(frameTimer); frameTimer = setTimeout(() => { frame.src = "/ov?demo=1&k=" + o.kind + "&c=" + encodeURIComponent(JSON.stringify(c)) + "&v=" + encodeURIComponent(JSON.stringify(sample())); }, 120); };
        const row = (label, input) => h("label", { class: "ovs-row" }, h("span", { text: label }), input);
        const text = (key, max, ph) => { const i = h("input", { type: "text", maxlength: String(max), value: c[key] ?? "", placeholder: ph || "" }); i.addEventListener("input", () => { c[key] = i.value; refresh(); }); return i; };
        const color = key => { const i = h("input", { type: "color", value: c[key] }); i.addEventListener("input", () => { c[key] = i.value; refresh(); }); return i; };
        const range = (key, lo, hi, step = 1, unit = "") => { const out = h("span", { class: "muted small", text: c[key] + unit }); const i = h("input", { type: "range", min: String(lo), max: String(hi), step: String(step), value: String(c[key]) }); i.addEventListener("input", () => { c[key] = Number(i.value); out.textContent = i.value + unit; refresh(); }); return h("span", { class: "ovs-range" }, i, out); };
        const check = (key, label) => { const i = h("input", { type: "checkbox", checked: Boolean(c[key]) }); i.addEventListener("change", () => { c[key] = i.checked; refresh(); }); return h("label", { class: "ovs-check" }, i, " " + label); };
        const name = h("input", { type: "text", maxlength: "40", value: o.name }); name.addEventListener("input", () => { draft.name = name.value; });
        const server = h("select"); server.append(h("option", { value: "", text: "No server" }), ...d.guilds.map(g => h("option", { value: g.id, text: g.name, selected: g.id === o.guild_id })));
        server.addEventListener("change", () => { draft.guild_id = server.value || null; });
        const needsServer = ["stats", "alerts", "board", "playing", "poll"].includes(o.kind) || (o.kind === "goal" && c.source !== "manual");

        const specific = [];
        if (o.kind === "goal") {
          const src = select([["manual", "A number I update myself"], ["members", "Server member count"], ["boosts", "Server boosts"]], c.source); src.addEventListener("change", () => { c.source = src.value; paintEditor(); });
          const tgt = h("input", { type: "number", min: "1", value: String(c.target) }); tgt.addEventListener("input", () => { c.target = Math.max(1, Number(tgt.value) || 1); refresh(); });
          specific.push(row("Label", text("label", 40, "Goal")), row("Counts", src), row("Target", tgt), row("Unit", text("unit", 12, "subs, $, boosts…")), row("When it's reached", text("doneText", 40, "Goal reached!")), check("showPercent", "Show the percentage"), check("celebrate", "Confetti when it is reached"));
          if (c.source === "manual") {
            const cur = h("input", { type: "number", min: "0", value: String(o.value), class: "ovs-cur" });
            const send = async (by, set) => { try { const r = set !== undefined ? (await api("/api/overlays", { action: "save", token: o.token, value: set }), { value: set }) : await api("/api/overlays", { action: "bump", token: o.token, by }); o.value = draft.value = r.value; cur.value = String(r.value); refresh(); } catch (e) { toast(e.message, "error"); } };
            specific.push(h("div", { class: "ovs-bump" }, h("span", { class: "muted small", text: "Right now (changes show on stream within seconds)" }),
              h("div", { class: "row" }, ...[-10, -1, 1, 10].map(n => h("button", { type: "button", class: "btn gray small", text: (n > 0 ? "+" : "") + n, onclick: () => send(n) })), cur,
                h("button", { type: "button", class: "btn blue small", text: "Set", onclick: () => send(0, Math.max(0, Number(cur.value) || 0)) }))));
          }
        } else if (o.kind === "stats") {
          specific.push(row("Heading", text("label", 40, "Optional")), check("showMembers", "Show members"), row("Members label", text("membersLabel", 20)), check("showBoosts", "Show boosts"), row("Boosts label", text("boostsLabel", 20)));
        } else if (o.kind === "alerts") {
          const soundSel = select([["off", "No sound"], ["chime", "Chime"], ["pop", "Pop"], ["coin", "Coin"], ["fanfare", "Fanfare"]], c.sound); soundSel.addEventListener("change", () => { c.sound = soundSel.value; refresh(); playSample(c.sound, c.volume); });
          const playSample = (name, vol) => {
            const N = { chime: [[880, 0, .18], [1318, .14, .35]], pop: [[420, 0, .09], [640, .05, .12]], coin: [[988, 0, .08], [1319, .08, .3]], fanfare: [[523, 0, .14], [659, .14, .14], [784, .28, .14], [1047, .42, .5]] }[name]; if (!N || !(vol > 0)) return;
            try { const a = new (window.AudioContext || window.webkitAudioContext)(), t0 = a.currentTime; for (const [f, at, len] of N) { const o = a.createOscillator(), g = a.createGain(); o.type = name === "coin" ? "square" : "sine"; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t0 + at); g.gain.exponentialRampToValueAtTime(Math.min(1, vol / 100) * 0.25, t0 + at + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len); o.connect(g).connect(a.destination); o.start(t0 + at); o.stop(t0 + at + len + 0.05); } } catch { /* no audio here */ }
          };
          const pos = select([["top", "Top of the screen"], ["bottom", "Bottom of the screen"]], c.position); pos.addEventListener("change", () => { c.position = pos.value; refresh(); });
          specific.push(check("showJoins", "Show new members"), check("showNames", "Show their name and picture"), row("New member text", text("joinText", 60, "Welcome {name}! We're at {count}")), check("showBoosts", "Show new boosts"), row("Boost text", text("boostText", 60, "{name} boosted the server! {count} boosts")), check("showLevels", "Show level-ups (needs XP turned on)"), row("Sound", soundSel), row("Volume", range("volume", 0, 100, 5, "%")), h("button", { type: "button", class: "btn gray small", text: "Play the sound", onclick: () => playSample(c.sound, c.volume) }), row("Level-up text", text("levelText", 60, "{name} reached level {count}!")), row("Seconds on screen", range("hold", 3, 20, 1, "s")), row("Where", pos),
            h("p", { class: "muted small", text: "{name} is the person, {count} is the new total. Alerts show as people join or boost while the overlay is open." }),
            h("div", { class: "row" }, h("button", { type: "button", class: "btn gray small", text: "Send a test alert", onclick: e => busy(e.currentTarget, async () => { try { await api("/api/overlays", { action: "test", token: o.token }); toast("Sent. It appears on your stream within a few seconds if OBS has the link open.", "ok"); } catch (err) { toast(err.message, "error"); } }) })));
        } else if (o.kind === "poll") {
          const q = h("input", { type: "text", maxlength: "120", placeholder: "What should we play next?" });
          const opts = h("textarea", { rows: "4", placeholder: "One option per line (2 to 5)", maxlength: "400" });
          const mins = select([["1", "1 minute"], ["2", "2 minutes"], ["5", "5 minutes"], ["10", "10 minutes"], ["30", "30 minutes"], ["60", "1 hour"]], "5");
          const chan = h("select"); chan.append(h("option", { value: "", text: o.guild_id ? "Loading channels…" : "Pick a server above, save, then choose a channel" }));
          if (o.guild_id) api("/api/overlays/channels?guild=" + encodeURIComponent(o.guild_id)).then(r => { chan.replaceChildren(h("option", { value: "", text: "Choose a channel" }), ...r.channels.map(ch => h("option", { value: ch.id, text: "#" + ch.name }))); }).catch(e => { chan.replaceChildren(h("option", { value: "", text: e.message })); });
          specific.push(check("showPercent", "Show percentages"), h("div", { class: "muted small", text: "Start a poll: the bot posts it in the channel you pick with a button for each option. Members vote there with the buttons, or by typing the option number in the channel, and the bars move on stream. Typing a vote needs the Message Content intent turned on for the bot." }),
            row("Question", q), row("Options", opts), row("Open for", mins), row("Post it in", chan),
            h("div", { class: "row" },
              h("button", { type: "button", class: "btn blue small", text: o.config.pollId ? "Start a new poll" : "Start the poll", onclick: e => busy(e.currentTarget, async () => { try { await api("/api/overlays", { action: "poll", token: o.token, question: q.value, options: opts.value.split("\n"), minutes: Number(mins.value), channel_id: chan.value }); toast("Poll posted. The bars show on stream within seconds.", "ok"); await reload(o.token); } catch (err) { toast(err.message, "error"); } }) }),
              o.config.pollId ? h("button", { type: "button", class: "btn gray small", text: "End it now", onclick: e => busy(e.currentTarget, async () => { try { await api("/api/overlays", { action: "endpoll", token: o.token }); toast("Voting closed.", "ok"); } catch (err) { toast(err.message, "error"); } }) }) : null));
        } else if (o.kind === "board") {
          const lim = h("input", { type: "number", min: "3", max: "10", value: String(c.limit) }); lim.addEventListener("input", () => { c.limit = Math.max(3, Math.min(10, Number(lim.value) || 5)); refresh(); });
          specific.push(row("Heading", text("label", 40, "Top members")), row("How many", lim), check("showLevel", "Show levels"), h("p", { class: "muted small", text: "Ranks your server's members by the XP they earn from chatting (turn XP on under Servers, Community). Names are the ones people use in your server." }));
        } else if (o.kind === "playing") {
          const lim = h("input", { type: "number", min: "2", max: "8", value: String(c.limit) }); lim.addEventListener("input", () => { c.limit = Math.max(2, Math.min(8, Number(lim.value) || 4)); refresh(); });
          specific.push(row("Heading", text("label", 40, "Playing now")), row("How many games", lim), h("p", { class: "muted small", text: "Shows the games your members are playing right now. Only people who turned on Now playing and share their library appear, so nobody shows up without choosing to." }));
        } else if (o.kind === "price") {
          const gin = h("input", { type: "text", placeholder: "Steam store link or app number", value: c.appid ? "app/" + c.appid : "" });
          specific.push(row("Game", gin), h("button", { type: "button", class: "btn blue small", text: c.appid ? "Change game" : "Use this game", onclick: e => busy(e.currentTarget, async () => { try { const r = await api("/api/overlays", { action: "game", token: o.token, game: gin.value }); toast(r.title + " is set.", "ok"); await reload(o.token); } catch (err) { toast(err.message, "error"); } }) }),
            check("showVerdict", "Show the buy-or-wait verdict"), h("p", { class: "muted small", text: c.gameName ? "Showing " + c.gameName + ". Change it any time, for example when you start a new game." : "Paste the game's Steam store link (store.steampowered.com/app/…). Needs no server." }));
        } else if (o.kind === "deals") {
          const lim = h("input", { type: "number", min: "2", max: "8", value: String(c.limit) }); lim.addEventListener("input", () => { c.limit = Math.max(2, Math.min(8, Number(lim.value) || 4)); refresh(); });
          specific.push(row("Heading", text("label", 40, "Best deals right now")), row("How many games", lim), h("p", { class: "muted small", text: "The biggest Steam discounts right now (US prices), refreshed by itself. Needs no server." }));
        } else if (o.kind === "free") {
          const lim = h("input", { type: "number", min: "2", max: "8", value: String(c.limit) }); lim.addEventListener("input", () => { c.limit = Math.max(2, Math.min(8, Number(lim.value) || 4)); refresh(); });
          specific.push(row("Heading", text("label", 40, "Free right now")), row("How many games", lim), check("showDlc", "Include free DLC"), h("p", { class: "muted small", text: "Lists the games that are free to claim right now on Steam, Epic, GOG and others, with how long is left. It updates by itself, and needs no server." }));
        } else if (o.kind === "sale") {
          specific.push(row("Heading", text("label", 40, "Leave empty to use the sale's name")), check("showDate", "Show the start date"), check("includeFests", "Include festivals like Next Fest"), row("When it starts", text("endText", 40, "The sale is on!")),
            h("p", { class: "muted small", text: "It counts down to the next Steam sale on Valve's published schedule, then to the end while it runs, and moves on to the next one by itself." }));
        } else if (o.kind === "scene") {
          const pickable = d.overlays.filter(x => ["goal", "stats", "timer", "sale", "board", "playing", "free", "deals"].includes(x.kind));
          const sec = h("input", { type: "number", min: "4", max: "120", value: String(c.seconds) }); sec.addEventListener("input", () => { c.seconds = Math.max(4, Math.min(120, Number(sec.value) || 10)); refresh(); });
          const tr = select([["fade", "Fade"], ["slide", "Slide"]], c.transition); tr.addEventListener("change", () => { c.transition = tr.value; refresh(); });
          specific.push(row("Seconds each", sec), row("Change with", tr), h("div", { class: "muted small", text: "Pick the overlays to rotate through (up to 8). They show in this order, each in its own style." }),
            ...(pickable.length ? pickable.map(x => { const i = h("input", { type: "checkbox", checked: (c.items || []).includes(x.token) }); i.addEventListener("change", () => { c.items = (c.items || []).filter(t => t !== x.token); if (i.checked) c.items.push(x.token); refresh(); }); return h("label", { class: "ovs-check" }, i, ` ${x.name} (${KIND[x.kind][0]})`); }) : [h("p", { class: "muted small", text: "Add a goal bar, server stats, timer or sale countdown first, then come back." })]));
        } else {
          const mode = select([["countdown", "Count down to a time"], ["countup", "Count up from a time"]], c.mode); mode.addEventListener("change", () => { c.mode = mode.value; refresh(); });
          const at = h("input", { type: "datetime-local", value: toLocal(c.at) }); at.addEventListener("input", () => { const ms = new Date(at.value).getTime(); if (Number.isFinite(ms)) { c.at = ms; refresh(); } });
          const soon = h("div", { class: "ovs-bump" }, h("span", { class: "muted small", text: "Start from now" }), h("div", { class: "row" }, ...[[5, "5 min"], [15, "15 min"], [30, "30 min"], [60, "1 hour"]].map(([m, l]) => h("button", { type: "button", class: "btn gray small", text: "In " + l, onclick: () => { c.at = Date.now() + m * 60_000; c.mode = "countdown"; mode.value = "countdown"; at.value = toLocal(c.at); refresh(); } }))));
          specific.push(row("Label", text("label", 40, "Starting soon")), row("Mode", mode), row("Time", at), soon, row("When it hits zero", text("endText", 40, "We're live!")));
        }
        const font = select(d.fonts.map(f => [f, f]), c.font); font.addEventListener("change", () => { c.font = font.value; refresh(); });
        const url = h("input", { type: "text", readonly: "readonly", value: o.url, onfocus: e => e.target.select() });
        const save = h("button", { type: "button", class: "btn blue", text: "Save", onclick: e => busy(e.currentTarget, async () => {
          try { await api("/api/overlays", { action: "save", token: o.token, name: draft.name, guild_id: needsServer ? (draft.guild_id || undefined) : (draft.guild_id ?? null), config: c }); toast("Saved. The overlay updates within seconds.", "ok"); await reload(o.token); }
          catch (err) { toast(err.message, "error"); }
        }) });
        editor.replaceChildren(
          h("div", { class: "panel" }, h("h3", { text: KIND[o.kind][0] }), row("Name", name), needsServer ? row("Server", server) : null, ...specific),
          o.kind === "scene" ? null : h("div", { class: "panel" }, h("h3", { text: "Look" }),
            h("div", { class: "ovs-themes", role: "group", "aria-label": "Theme" }, ...THEMES.map(([key, label, p]) => { const btn = h("button", { type: "button", class: "ovs-theme" + ((c.theme || "classic") === key ? " on" : ""), title: label, "aria-pressed": String((c.theme || "classic") === key), onclick: () => { Object.assign(o.config, c, p, { theme: key }); o.name = draft.name; paintEditor(); } }, h("span", { class: "ovs-tswatch t-" + key }, h("i", {}), h("i", {})), h("span", { text: label })); btn.style.setProperty("--a", p.accent); btn.style.setProperty("--b", p.bg); btn.style.setProperty("--t", p.text); return btn; })),
            h("div", { class: "ovs-grid" }, row("Accent", color("accent")), row("Text", color("text")), row("Muted text", color("muted")), row("Background", color("bg")), row("Border", color("border")), row("Font", font)),
            row("Background opacity", range("bgOpacity", 0, 100, 1, "%")), row("Corner radius", range("radius", 0, 40, 1, "px")), row("Padding", range("padding", 4, 48, 1, "px")), row("Size", range("scale", 0.5, 3, 0.1, "×")),
            row("Refresh every", range("refresh", 5, 120, 5, "s")), h("div", { class: "row" }, check("showBorder", "Border"), check("shadow", "Drop shadow"))),
          h("div", { class: "panel" }, h("h3", { text: "Live preview" }), h("div", { class: "ovs-stage" }, frame),
            o.kind !== "timer" && (o.kind === "stats" || c.source !== "manual") ? h("p", { class: "muted small", text: "The preview uses sample numbers. On stream it shows your real ones." }) : null),
          h("div", { class: "panel" }, h("h3", { text: "OBS link" }), conn, h("p", { class: "muted small", text: "In OBS: Sources, Add, Browser. Paste this as the URL, set the width and height to fit, and leave the background transparent. Keep the link private." }),
            h("div", { class: "row" }, url, h("button", { type: "button", class: "btn gray", text: "Copy", onclick: async () => { try { await navigator.clipboard.writeText(o.url); toast("Link copied.", "ok"); } catch { url.select(); toast("Select the link and copy it by hand.", "warn"); } } })),
            h("div", { class: "row" }, save,
              h("button", { type: "button", class: "btn gray", text: "New link", title: "The old link stops working", onclick: e => busy(e.currentTarget, async () => { if (!confirm("Make a new link? The old one stops working, so you'll need to paste the new one into OBS.")) return; try { const r = await api("/api/overlays", { action: "reset", token: o.token }); await reload(r.token); toast("New link made.", "ok"); } catch (err) { toast(err.message, "error"); } }) }),
              h("button", { type: "button", class: "btn gray", text: "Delete", onclick: e => busy(e.currentTarget, async () => { if (!confirm("Delete this overlay? Its link stops working.")) return; try { await api("/api/overlays", { action: "delete", token: o.token }); await reload(d.overlays.find(x => x.token !== o.token)?.token ?? null); } catch (err) { toast(err.message, "error"); } }) }))));
        refresh();
      }
      const mine = h("div", { class: "ovs" }, h("div", { class: "panel ovs-side" }, h("h3", { text: "Your overlays" }), list), editor);
      const TABS = [["mine", "Goal bars, stats and timers", () => mine], ["np", "Now playing", nowPlayingOverlayPanel], ["gw", "Giveaway", giveawayOverlayPanel], ["cards", "Deals and cards", streamCardPanel]];
      let tab = "mine"; try { tab = localStorage.getItem("svc_ovs_tab") || "mine"; } catch { /* fine */ }
      if (!TABS.some(t => t[0] === tab)) tab = "mine";
      const tabs = h("div", { class: "chips ovs-tabs", role: "tablist" }), stage = h("div");
      const show = key => {
        tab = key; try { localStorage.setItem("svc_ovs_tab", key); } catch { /* fine */ }
        tabs.replaceChildren(...TABS.map(([k, label]) => h("button", { type: "button", role: "tab", class: "chip-btn" + (k === key ? " on" : ""), "aria-selected": String(k === key), text: label, onclick: () => show(k) })));
        stage.replaceChildren(TABS.find(t => t[0] === key)[2]());
      };
      app.replaceChildren(pageHead("Overlay studio", "Every overlay for OBS in one place. Pick one, style it, and paste its link in as a Browser source."), tabs, stage);
      paintList(); paintEditor(); show(tab);
    }

    /** The now-playing card for OBS, with a server picker. Same panel the music page used to carry. */
    function nowPlayingOverlayPanel() {
      const servers = state.me.servers.filter(g => g.bot !== false);
      if (!servers.length) return h("div", { class: "notice warn", text: "The bot is not in any of your servers yet. Add it from the Servers page." });
      const guild = serverPicker(servers, currentParam());
      const box = h("div"), wrap = h("div");
      let ov = null, data = null, viz = null, vizGuild = "", ovBox = null;
      guild.addEventListener("change", () => { data = null; if (ov) ov.reload(); });
      const alive = () => wrap.isConnected && currentView() === "overlays";
      async function poll() {
        if (!alive()) { viz?.close(); viz = null; return; }
        try { data = await api("/api/music?guild=" + encodeURIComponent(guild.value)); } catch { data = null; }
        if (ov && data?.access?.canStream) {
          ovBox.hidden = false; ov.update();
          if (!viz || vizGuild !== guild.value) { viz?.close(); vizGuild = guild.value; viz = window.EventSource ? new EventSource("/api/music/viz?guild=" + encodeURIComponent(guild.value)) : null; if (viz) viz.onmessage = ev => { try { const m = JSON.parse(ev.data); if (m.p) ov.viz(m); } catch { /* ignore */ } }; }
          box.replaceChildren();
        } else if (ovBox) { ovBox.hidden = true; box.replaceChildren(h("div", { class: "notice", text: "You need permission to stream in this server to use this overlay. Ask a server manager, or pick another server." })); }
        setTimeout(poll, 3000);
      }
      (async () => {
        try { await overlayAssets(); } catch { box.replaceChildren(h("div", { class: "notice warn", text: "The overlay couldn't load. Refresh and try again." })); return; }
        ov = window.SvcOverlayPanel({ api, toast, getData: () => data, getGuild: () => guild.value, storeKey: "svc_music_ov" });
        ovBox = h("div", { class: "panel" }, h("h3", { text: "Now playing overlay" }), ov.el);
        wrap.append(ovBox); poll();
      })();
      wrap.prepend(servers.length > 1 ? h("div", { class: "panel" }, field("Server", guild)) : null, box);
      return wrap;
    }
  root.OverlayStudio = { view };
})(window);

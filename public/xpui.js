// A page of the dashboard, split out of app.js.
// app.js hands over its helpers (ctx) and calls XpUI.view(ctx).
(function (root) {
  "use strict";
  async function view(ctx) {
    const { api, app, busy, currentParam, field, h, pageHead, progressBar, select, serverPicker, state, toast } = ctx;
    const servers = state.me.servers.filter(g => g.bot !== false);
    const holder = h("div");
    app.replaceChildren(pageHead("Server XP", "Levels, the leaderboard and rewards for your server. In Discord: /server rank and /server levels."), holder);
    if (!servers.length) { holder.replaceChildren(h("div", { class: "notice warn", text: "The bot is not in any of your servers yet. Add it from the Servers page." })); return; }
    const guild = serverPicker(servers, currentParam());
    let page = 1;
    async function load() {
      holder.replaceChildren(h("p", { class: "muted", text: "Loading…" }));
      try {
        const d = await api("/api/community/xp?guild=" + encodeURIComponent(guild.value) + "&page=" + page);
        const picker = servers.length > 1 ? h("div", { class: "panel" }, field("Server", guild)) : null;
        const me = d.me, t = d.totals;
        const off = d.enabled ? null : h("div", { class: "notice warn", text: "XP is turned off in this server." + (d.manager ? " Turn it on below." : "") });
        const tile = (k, v, s) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: String(v) }), s && h("div", { class: "s", text: s }));
        const card = h("div", { class: "panel xp-card" }, h("div", { class: "xp-level" }, h("span", { class: "xp-lv-k", text: "LEVEL" }), h("b", { text: String(me.level) })),
          h("div", { class: "xp-card-main" }, h("h3", { text: me.rank ? `You are #${me.rank} of ${me.members}` : "You have no XP yet" }),
            h("p", { class: "muted small", text: `${me.into.toLocaleString()} / ${me.need.toLocaleString()} XP to level ${me.level + 1} · ${me.xp.toLocaleString()} XP in total` }), progressBar(me.into / me.need),
            h("p", { class: "muted small", text: `${me.messages.toLocaleString()} messages · ${me.voiceMinutes.toLocaleString()} minutes in voice` })));
        const stats = h("div", { class: "grid four" }, tile("Members with XP", t.members.toLocaleString()), tile("Total XP", t.xp.toLocaleString()), tile("Messages counted", t.messages.toLocaleString()), tile("Highest level", t.topLevel));
        const medal = r => (r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : String(r));
        const board = h("div", { class: "panel" }, h("h3", { text: "Leaderboard" }),
          d.board.length ? h("div", { class: "scroll-y tall" }, h("table", { class: "xp-board" }, h("thead", {}, h("tr", {}, ["#", "Member", "Level", "XP", "Messages", "Voice"].map((c, i) => h("th", { class: i > 1 ? "num" : "", text: c })))),
            h("tbody", {}, d.board.map(r => h("tr", {}, h("td", { text: medal(r.rank) }), h("td", { text: r.name || "Member" }), h("td", { class: "num", text: String(r.level) }), h("td", { class: "num", text: r.xp.toLocaleString() }), h("td", { class: "num", text: r.messages.toLocaleString() }), h("td", { class: "num", text: r.voice_minutes + " min" })))))) : h("p", { class: "muted", text: "Nobody has earned XP yet. Start chatting!" }),
          d.pages > 1 ? h("div", { class: "row lib-pager" }, h("button", { class: "btn gray small", text: "Previous", disabled: d.page <= 1, onclick: () => { page = d.page - 1; load(); } }), h("span", { class: "muted", text: `Page ${d.page} of ${d.pages}` }), h("button", { class: "btn gray small", text: "Next", disabled: d.page >= d.pages, onclick: () => { page = d.page + 1; load(); } })) : null);
        const rewards = h("div", { class: "panel" }, h("h3", { text: "Level rewards" }),
          d.rewards.length ? h("ul", { class: "plain" }, d.rewards.map(r => h("li", {}, h("b", { text: "Level " + r.level }), " → ", r.name, me.level >= r.level ? " ✅" : ""))) : h("p", { class: "muted", text: "No level rewards yet." }),
          h("p", { class: "muted small", text: "Reach the level and the bot gives you the role." }));
        const how = h("div", { class: "panel" }, h("h3", { text: "How XP works" }), h("ul", {},
          h("li", { text: `Chat: ${d.how.message[0]} to ${d.how.message[1]} XP for a message, at most once a minute.` }),
          h("li", { text: `Voice: ${d.how.voicePerMinute} XP a minute in a voice channel with someone else (not muted or deafened, not in AFK).` }),
          h("li", { text: d.how.referral ? `Invites: ${d.how.referral} XP each time someone joins through your invite link.` : "Invites: bring friends with your own link (/server invites link)." }),
          h("li", { text: d.multiplier === 1 ? "XP speed is normal." : `This server runs XP at ×${d.multiplier}.` })));
        const curve = h("div", { class: "panel" }, h("h3", { text: "XP needed per level" }),
          h("div", { class: "scroll-y" }, h("table", {}, h("thead", {}, h("tr", {}, ["Level", "XP to reach it", "Total XP"].map((c, i) => h("th", { class: i ? "num" : "", text: c })))), h("tbody", {}, d.curve.map(c => h("tr", {}, h("td", { text: String(c.level) }), h("td", { class: "num", text: c.need.toLocaleString() }), h("td", { class: "num", text: c.total.toLocaleString() })))))));
        const shop = h("div", { class: "panel shop-soon" }, h("div", { class: "shop-badge", text: "COMING SOON" }), h("h3", { text: "Prize shop" }),
          h("p", { text: "Spend the XP you earn on rewards from your server's team. Game keys, roles, perks and more." }),
          h("div", { class: "shop-ghosts", "aria-hidden": "true" }, [["🎮", "Game key"], ["👑", "Special role"], ["✨", "Server perk"]].map(([i, n]) => h("div", { class: "shop-ghost" }, h("span", { text: i }), h("b", { text: n }), h("small", { text: "??? XP" })))),
          h("p", { class: "muted small", text: "Keep earning XP. Nothing you earn is lost when the shop opens." }));
        holder.replaceChildren(...[picker, off, card, stats, h("div", { class: "grid two" }, board, h("div", {}, rewards, how)), shop, curve, d.manager ? manage(d) : null].filter(Boolean));
      } catch (e) { holder.replaceChildren(h("div", { class: "notice warn", text: e.message })); }
    }
    function manage(d) {
      const box = h("div");
      (async () => {
        const [ch, ro] = await Promise.all([api("/api/servers/channels?guild=" + encodeURIComponent(guild.value)).catch(() => ({ channels: [] })), api("/api/servers/roles?guild=" + encodeURIComponent(guild.value)).catch(() => ({ roles: [] }))]);
        const post = (path, body) => api(path, { guild_id: guild.value, ...body });
        const save = (label, fn, cls = "btn blue small") => { const b = h("button", { class: cls, text: label }); b.addEventListener("click", () => busy(b, async () => { await fn(); toast("Saved.", "ok"); load(); })); return b; };
        const st = d.settings;
        const mult = h("input", { type: "number", min: "0.1", max: "5", step: "0.1", value: String(st.xp_mult) });
        const ann = select([["same", "In the channel where they chat"], ["channel", "In one channel"], ["off", "Nowhere"]], st.levelup_mode);
        const annCh = select([["", "Not set"], ...ch.channels.map(c => [c.id, "#" + c.name])], st.levelup_channel || "");
        const lvlN = h("input", { type: "number", min: "1", max: "200", placeholder: "Level" }), lvlR = select([["", "Choose a role"], ...ro.roles.map(r => [r.id, r.name])], "");
        const tog = h("button", { class: "btn small " + (st.xp_on ? "red" : "green"), text: st.xp_on ? "Turn XP off" : "Turn XP on" });
        tog.addEventListener("click", () => busy(tog, async () => { await post("/api/community/xp", { enabled: !st.xp_on }); load(); }));
        box.replaceChildren(h("div", { class: "panel" }, h("h3", { text: "Manage XP" }), h("div", { class: "row" }, tog),
          h("div", { class: "grid two" }, field("XP speed (1 is normal)", mult), field("Announce level-ups", ann)), field("Level-up channel", annCh),
          h("div", { class: "row" }, save("Save XP settings", () => post("/api/community/xp", { multiplier: mult.value, announce: ann.value, channel_id: annCh.value }))),
          h("h4", { text: "Level rewards" }),
          d.rewards.length ? h("ul", { class: "plain" }, d.rewards.map(r => h("li", {}, `Level ${r.level}: `, h("b", { text: r.name }), " ", save("Remove", () => post("/api/community/levelrole", { level: r.level, remove: true }), "btn gray small")))) : h("p", { class: "muted", text: "No level rewards yet." }),
          h("div", { class: "row" }, lvlN, lvlR, save("Add reward", () => post("/api/community/levelrole", { level: lvlN.value, role_id: lvlR.value })))));
      })();
      return box;
    }
    guild.addEventListener("change", () => { page = 1; load(); });
    load();
  }
  root.XpUI = { view };
})(window);

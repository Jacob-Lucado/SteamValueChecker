// One or two live lines for the top of each panel area, read from the database. Never throws: a panel without a status line still works.
const day = 86_400_000;
const more = (rows, fmt, max = 3) => rows.slice(0, max).map(r => `• ${fmt(r)}`).concat(rows.length > max ? [`…and ${rows.length - max} more`] : []);
const n = (v, one, many) => `**${v}** ${v === 1 ? one : many}`;

export function areaGlance(db) {
    const rules = {
        "me/wishlist": u => { const r = db.listItems(u.discord_id); return [`You are watching ${n(r.length, "game", "games")}.`, ...more(r, x => x.title, 4)]; },
        "me/library": u => [`${n(db.countLibrary(u.discord_id), "game", "games")} in your library · ${n(db.countBundles(u.discord_id), "bundle", "bundles")} logged.`],
        "me/steam": u => { const l = db.getSteamLink(u.discord_id); return [l ? "Steam is **linked**." : "Steam is **not linked** yet. Use `link` first."]; },
        "me/friend": u => [`${n(db.countFriends(u.discord_id), "friend", "friends")} saved.`],
        "me/mydata": () => ["Export or delete everything the bot holds about you."],
        "games/saleprep": u => [`${n(db.countItems(u.discord_id), "game", "games")} on your wishlist to plan with.`],
        "server/giveaway": (u, g) => { if (!g) return []; const r = db.listGiveaways(g).filter(x => x.status === "active" || x.status === "scheduled"); return [`${n(r.length, "giveaway", "giveaways")} running here.`, ...more(r, x => `#${x.id} ${x.title}`)]; },
        "server/serverlist": (u, g) => g ? [`${n(db.listServerGames(g, u.discord_id).length, "game", "games")} on the server list.`] : [],
        "server/lfg": (u, g) => { if (!g) return []; const r = db.listOpenLfg(g); return [`${n(r.length, "open post", "open posts")}.`, ...more(r, x => `${x.game} <t:${Math.floor(x.starts_at / 1000)}:R>`)]; },
        "server/calendar": (u, g) => { if (!g) return []; const r = db.listCalEvents(g, Date.now(), Date.now() + 60 * day); return [`${n(db.countUpcomingCalEvents(g, Date.now()), "upcoming event", "upcoming events")}.`, ...more(r, x => `${x.title} <t:${Math.floor(x.starts_at / 1000)}:R>`)]; },
        "server/invites": (u, g) => g ? [db.getInviteLink(g, u.discord_id) ? "You have an invite link." : "You do not have an invite link yet. Use `link`."] : [],
        "server/stream": (u, g) => { if (!g) return []; const rows = db.listStreamLive(g), mine = db.getStreamLink(g, u.discord_id); return [`${n(rows.length, "stream", "streams")} live now · your channel is ${mine ? "**linked**" : "**not linked**"}.`, ...more(rows, x => `<@${x.user_id}>${x.game ? ` playing ${x.game}` : ""}`)]; },
        "server/club": (u, g) => { const c = g && db.getClub?.(g); return [c?.title ? `This month's pick: **${c.title}**.` : "No pick this month."]; },
        "server/main": (u, g) => g ? [`${db.countXpMembers(g)} members have XP here.`] : [],
        "manage/community": (u, g) => { const c = g && db.getCommunity(g); return [c ? "Community setup is **done** for this server." : "Community setup has **not been run** yet."]; },
        "manage/alertchannel": (u, g) => { const c = g && db.getGuild(g); return [c ? `Alerts post in <#${c.channel_id}>.` : "No alert channel set yet."]; },
        "bot/support": u => [`${n(db.countOpenTickets(u.discord_id), "open ticket", "open tickets")} of yours.`],
        "bot/feature": () => ["Vote for ideas, or suggest your own."],
        "mod/main": (u, g) => g ? [`${n(db.countCases(g), "case", "cases")} logged in this server.`] : [],
        "games/codes": () => ["Latest codes, and where they are posted."],
        "server/promos": (u, g) => g ? [`${n(db.listDrops(g, { status: "active" }).length, "promo drop", "promo drops")} going.`] : []
    };
    return (ctx, hub, area) => {
        try {
            const r = rules[`${hub}/${area}`];
            return r ? r(ctx.user, ctx.i?.guildId ?? ctx.user.guild_id ?? null) : [];
        } catch { return []; }
    };
}

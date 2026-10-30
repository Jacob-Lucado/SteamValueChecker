// The #leaderboard channel: one embed with the XP top ten and top inviters that the bot edits on a timer (default every 5 hours).
// Managers can refresh it at once with /leaderboardrefresh or from the dashboard.
import { UserError } from "./errors.js";

export const LB_DEFAULT_HOURS = 5, LB_MIN_HOURS = 1, LB_MAX_HOURS = 48;
const MEDAL = ["🥇", "🥈", "🥉"];
const place = n => MEDAL[n] ?? `\`${String(n + 1).padStart(2, " ")}.\``;

/** The embed. `rows` are { name, level, xp }, `inviters` are { name, active }. */
export function leaderboardEmbed({ server = "Server", rows = [], inviters = [], totals = null, base = null, hours = LB_DEFAULT_HOURS, at = Date.now() }) {
    const root = base ? String(base).replace(/\/$/, "") : null;
    const fields = [];
    if (inviters.length) fields.push({ name: "🤝 Top inviters", value: inviters.slice(0, 5).map((r, n) => `${place(n)} **${r.name}** · ${r.active} invited`).join("\n"), inline: true });
    if (totals) fields.push({ name: "📊 Server", value: `**${totals.members.toLocaleString()}** ranked members\n**${totals.messages.toLocaleString()}** messages\nTop level **${totals.topLevel}**`, inline: true });
    fields.push({ name: "​", value: "Chat and hang out in voice to earn XP. Check your own place with `/rank`.", inline: false });
    return {
        color: 0xf1c40f, title: `🏆  ${server} · XP Leaderboard`,
        description: rows.length ? rows.map((r, n) => `${place(n)} **${r.name}**\n└ Level **${r.level}** · ${r.xp.toLocaleString()} XP`).join("\n") : "Nobody has earned XP yet. Start chatting!",
        fields,
        footer: { text: `Updates every ${hours} hour${hours === 1 ? "" : "s"} · Steam Value Checker`, ...(root ? { icon_url: `${root}/logo.png` } : {}) },
        timestamp: new Date(at).toISOString(),
        ...(root ? { thumbnail: { url: `${root}/logo.png` } } : {})
    };
}

/** Builds the board and edits the existing message (or posts a new one). Throws UserError when it cannot. */
export async function refreshLeaderboard({ db, api, guildId, base = null, now = () => Date.now() }) {
    const c = db.getCommunity(guildId);
    if (!c.lb_channel) throw new UserError("No leaderboard channel is set. Run /community setup or choose one on the dashboard.");
    const name = async id => (await api.memberName(guildId, id).catch(() => null)) ?? `<@${id}>`;
    const [guild, rows, inviters] = await Promise.all([
        api.getGuild(guildId).catch(() => null),
        Promise.all(db.xpTop(guildId, 10).map(async r => ({ name: await name(r.user_id), level: r.level, xp: r.xp }))),
        Promise.all(db.inviteTop(guildId, 5).map(async r => ({ name: await name(r.user_id), active: Number(r.active) })))
    ]);
    const hours = c.lb_hours || LB_DEFAULT_HOURS, at = now();
    const payload = { embeds: [leaderboardEmbed({ server: guild?.name ?? "Server", rows, inviters, totals: db.xpTotals(guildId), base, hours, at })], allowed_mentions: { parse: [] } };
    let posted = false;
    if (c.lb_message_id) { try { await api.editMessage(c.lb_channel, c.lb_message_id, payload); } catch { posted = true; } } else posted = true;
    let messageId = c.lb_message_id;
    if (posted) {
        const m = await api.sendMessage(c.lb_channel, payload).catch(() => null);
        if (!m) throw new UserError("I could not post in the leaderboard channel. Give me View Channel, Send Messages and Embed Links there.");
        messageId = m.id;
    }
    db.setCommunity(guildId, { lb_message_id: messageId, lb_at: at });
    db.bumpUsage("leaderboard_updates");
    return { posted, messageId, at };
}

/** Called every few minutes: refreshes every server whose board is due. One failure never stops the rest. */
export async function tickLeaderboards({ db, api, base = null, now = () => Date.now(), has = () => true, sleep = ms => new Promise(r => setTimeout(r, ms)), log = () => {} }) {
    let done = 0;
    for (const c of db.allCommunity()) {
        if (!c.lb_channel || !has(c.guild_id)) continue;
        const every = (c.lb_hours || LB_DEFAULT_HOURS) * 3_600_000;
        if (c.lb_at && now() - c.lb_at < every) continue;
        try { await refreshLeaderboard({ db, api, guildId: c.guild_id, base, now }); done++; }
        catch (e) { db.setCommunity(c.guild_id, { lb_at: now() }); log(`leaderboard ${c.guild_id}: ${e.message}`); } // try again next time round, not every tick
        await sleep(500);
    }
    return done;
}

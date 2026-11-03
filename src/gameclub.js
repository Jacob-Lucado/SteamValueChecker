// Game club: the server plays one game a month. A manager sets the pick, members who share their library show up in the progress list
// (hours, achievements, finished), and the bot posts a card in the club channel once a week. Nothing is asked of members beyond sharing.
import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { steamArt } from "./render.js";
import { UserError } from "./errors.js";

export const clubSchema = `
CREATE TABLE IF NOT EXISTS game_club (
    guild_id   TEXT PRIMARY KEY,
    channel_id TEXT,
    month      TEXT,
    title      TEXT,
    appid      INTEGER,
    set_by     TEXT,
    last_post  INTEGER NOT NULL DEFAULT 0,
    ended_post TEXT
);
`;
const WEEK = 7 * 86400_000;
export const monthOf = ms => new Date(ms).toISOString().slice(0, 7);

export function clubStore({ run, get, all }) {
    return {
        getClub: gid => get("SELECT * FROM game_club WHERE guild_id = ?", String(gid)) ?? null,
        setClub(gid, patch) {
            run("INSERT OR IGNORE INTO game_club (guild_id) VALUES (?)", String(gid));
            for (const k of ["channel_id", "month", "title", "appid", "set_by", "last_post", "ended_post"]) if (k in patch) run(`UPDATE game_club SET ${k} = ? WHERE guild_id = ?`, patch[k], String(gid));
        },
        removeClub: gid => run("DELETE FROM game_club WHERE guild_id = ?", String(gid)),
        clubGuilds: () => all("SELECT * FROM game_club WHERE channel_id IS NOT NULL AND channel_id != '' AND title IS NOT NULL")
    };
}

/** Who in the server (sharing members only) has the game, and how far along they are. */
export function clubProgress(db, club) {
    const want = String(club.title ?? "").trim().toLowerCase();
    const rows = [];
    for (const id of db.sharingMembers(club.guild_id)) {
        const g = db.listLibrary(id).find(x => (club.appid && x.appid === club.appid) || x.title.trim().toLowerCase() === want);
        if (!g) continue;
        const hours = Math.round((g.minutes ?? 0) / 6) / 10, total = g.ach_total ?? 0, done = g.ach_done ?? 0;
        rows.push({ userId: id, hours, ach_done: done, ach_total: total, finished: g.status === "finished" || (total > 0 && done >= total), started: (g.minutes ?? 0) > 0 || g.status === "playing" || g.status === "finished" });
    }
    rows.sort((a, b) => Number(b.finished) - Number(a.finished) || b.hours - a.hours);
    return { owners: rows, sharing: db.sharingMembers(club.guild_id).length };
}

export function clubEmbed(club, prog, { rollCall = false } = {}) {
    const fin = prog.owners.filter(r => r.finished), going = prog.owners.filter(r => !r.finished && r.started), notYet = prog.owners.filter(r => !r.started);
    const line = r => `<@${r.userId}> ${r.hours}h${r.ach_total ? `, ${r.ach_done}/${r.ach_total} achievements` : ""}`;
    const fields = [];
    if (fin.length) fields.push({ name: `✅ Finished (${fin.length})`, value: fin.map(line).join("\n").slice(0, 1000) });
    if (going.length) fields.push({ name: `▶️ Playing (${going.length})`, value: going.map(line).join("\n").slice(0, 1000) });
    if (notYet.length) fields.push({ name: `⏳ Own it, not started (${notYet.length})`, value: notYet.map(r => `<@${r.userId}>`).join(" ").slice(0, 1000) });
    return {
        color: 0x5865f2, title: `📚 Game club: ${club.title}`, ...(club.appid ? { url: `https://store.steampowered.com/app/${club.appid}/`, thumbnail: { url: steamArt(club.appid) } } : {}),
        description: prog.owners.length ? (rollCall ? "Roll call! Where is everyone at?" : `${prog.owners.length} of ${prog.sharing} sharing members own it.`) : "Nobody who shares their library owns it yet. Share with `/alerts share` and it counts you in.",
        fields, footer: { text: `${club.month} pick  •  /server club status` }
    };
}

/** Weekly card in the club channel, and a "pick the next one" note once when the month is over. Everything is posted without pinging anyone. */
export async function runGameClubs({ db, notifier, now = () => Date.now(), log = () => {} }) {
    const stats = { clubs: 0, posted: 0 };
    for (const club of db.clubGuilds()) {
        stats.clubs++;
        const t = now();
        try {
            if (club.month !== monthOf(t)) {
                if (club.ended_post !== club.month) {
                    const prog = clubProgress(db, club), fin = prog.owners.filter(r => r.finished).length;
                    const ok = await notifier.postChannel(club.channel_id, { embeds: [{ ...clubEmbed(club, prog), title: `📚 ${club.month} is over: ${club.title}`, description: `${fin} finished it. A manager can set the next pick with \`/server club pick\`.` }], allowedMentions: { parse: [] } }, null);
                    if (ok) { db.setClub(club.guild_id, { ended_post: club.month }); stats.posted++; }
                }
                continue;
            }
            if (t - club.last_post < WEEK) continue;
            const ok = await notifier.postChannel(club.channel_id, { embeds: [clubEmbed(club, clubProgress(db, club), { rollCall: true })], allowedMentions: { parse: [] } }, null);
            if (ok) { db.setClub(club.guild_id, { last_post: t }); stats.posted++; }
        } catch (err) { log(`game club ${club.guild_id}: ${err.message}`); }
    }
    return stats;
}

/** Sets this month's pick. A title that matches a sharing member's library borrows its Steam id, so progress and art work. */
export function setPick(db, guildId, title, byUser, now = Date.now()) {
    const clean = String(title ?? "").trim().slice(0, 100);
    if (!clean) throw new UserError("Say which game.");
    let appid = null;
    for (const id of db.sharingMembers(guildId)) { const g = db.listLibrary(id).find(x => x.appid && x.title.trim().toLowerCase() === clean.toLowerCase()); if (g) { appid = g.appid; break; } }
    db.setClub(guildId, { title: clean, appid, month: monthOf(now), set_by: byUser, last_post: 0, ended_post: null });
    return db.getClub(guildId);
}

export function createClubHandlers({ db, now = () => Date.now() }) {
    const eph = (i, content) => i.reply({ content, flags: MessageFlags.Ephemeral });
    const manage = i => { if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new UserError("You need the Manage Server permission to change the game club."); };
    async function handle(i) {
        try {
            if (!i.guildId) throw new UserError("Use this in a server.");
            const sub = i.options.getSubcommand();
            if (sub === "status") {
                const club = db.getClub(i.guildId);
                if (!club?.title) return void await eph(i, "This server has no game club pick yet. A manager can set one with `/server club pick`.");
                return void await i.reply({ embeds: [clubEmbed(club, clubProgress(db, club))], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
            }
            manage(i);
            if (sub === "pick") { const c = setPick(db, i.guildId, i.options.getString("game", true), i.user.id, now()); return void await eph(i, `This month's club pick is **${c.title}**.${c.appid ? "" : " I could not match it to a member's Steam library, so progress will match by name."}${c.channel_id ? " A card is posted in <#" + c.channel_id + "> every week." : " Choose where the weekly card goes with `/server club channel`."}`); }
            if (sub === "channel") { db.setClub(i.guildId, { channel_id: i.options.getChannel("channel", true).id }); return void await eph(i, "Saved. The weekly game club card goes there."); }
            if (sub === "off") { db.removeClub(i.guildId); return void await eph(i, "Game club turned off."); }
        } catch (err) {
            const content = err instanceof UserError ? err.message : "Something went wrong. Try again in a moment.";
            if (!(err instanceof UserError)) console.error(`[club] ${err.message}`);
            if (i.deferred || i.replied) await i.editReply({ content }).catch(() => {}); else await eph(i, content).catch(() => {});
        }
    }
    return { handle };
}

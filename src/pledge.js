// Backlog pledges. You say "I'll put 10 more hours into Hades by the 15th", friends back or doubt you with a button, and when the date
// comes the bot looks at your real Steam playtime and settles it. Playtime comes from the synced library, so nobody can fib.
import { UserError } from "./errors.js";

export const PLEDGE_BACK = "pledge_back", PLEDGE_DOUBT = "pledge_doubt", PLEDGE_CANCEL = "pledge_cancel";
const MAX_OPEN = 2, DAY = 86400_000;
export const PLEDGE_LIMITS = { minHours: 1, maxHours: 200, minDays: 2, maxDays: 60 };

const hoursOf = m => Math.round(m / 6) / 10;
export const progressOf = (p, minutes) => Math.max(0, minutes - p.base_minutes);
const bar = ratio => { const n = Math.round(Math.min(1, Math.max(0, ratio)) * 12); return "▰".repeat(n) + "▱".repeat(12 - n); };

export function pledgeEmbed(p, votes, minutes = null) {
    const open = p.status === "open", backers = votes.filter(v => v.side === "back"), doubters = votes.filter(v => v.side === "doubt");
    const done = progressOf(p, minutes ?? p.final_minutes ?? p.base_minutes);
    const ratio = done / (p.hours * 60);
    const head = open ? "Backlog pledge" : p.status === "kept" ? "Pledge kept" : p.status === "failed" ? "Pledge missed" : "Pledge cancelled";
    const list = a => a.length ? a.map(v => `<@${v.user_id}>`).join(" ") : "Nobody yet";
    return {
        color: p.status === "kept" ? 0x57f287 : p.status === "failed" ? 0xed4245 : open ? 0x4da3ff : 0x747f8d,
        title: `🎯 ${head}: ${p.title}`.slice(0, 250),
        description: open ? `<@${p.user_id}> swears to play **${p.hours} more hours** by <t:${Math.floor(p.due_at / 1000)}:D>. I'll check their real Steam playtime when time is up.`
            : p.status === "kept" ? `<@${p.user_id}> played **${hoursOf(done)} hours** and made the **${p.hours}** they promised.`
            : p.status === "failed" ? `<@${p.user_id}> only got **${hoursOf(done)} of ${p.hours} hours** in. The backlog wins this round.` : "The pledge was cancelled.",
        fields: [
            { name: "Progress so far", value: `${bar(ratio)} ${hoursOf(done)} / ${p.hours} h`, inline: false },
            { name: `🙌 Backing (${backers.length})`, value: list(backers), inline: true },
            { name: `🤨 Doubting (${doubters.length})`, value: list(doubters), inline: true }
        ],
        footer: { text: open ? "Back or doubt them with the buttons. Right calls earn points on the server board." : "Steam Value Checker · backlog pledges" }
    };
}

export function pledgeComponents(p) {
    if (p.status !== "open") return [];
    return [{ type: 1, components: [
        { type: 2, style: 3, label: "I back them", emoji: { name: "🙌" }, custom_id: `${PLEDGE_BACK}:${p.id}` },
        { type: 2, style: 2, label: "I doubt it", emoji: { name: "🤨" }, custom_id: `${PLEDGE_DOUBT}:${p.id}` },
        { type: 2, style: 4, label: "Cancel", custom_id: `${PLEDGE_CANCEL}:${p.id}` }
    ] }];
}

export function boardEmbed(rows, title = "Pledge board") {
    return {
        color: 0xfee75c, title: `🏆 ${title}`,
        description: rows.length ? rows.map((r, i) => `**${i + 1}.** <@${r.user_id}> · ${r.points} pts · ${r.kept} kept, ${r.failed} missed, ${r.calls} right calls`).join("\n") : "No settled pledges yet. Start one with `/games pledge`.",
        footer: { text: "10 points for keeping your own pledge, 3 for each call you got right" }
    };
}

export function createPledgeService({ db, discord, refresh = null, now = () => Date.now(), log = () => {} }) {
    const post = async p => { if (p.message_id) try { await discord.edit(p.channel_id, p.message_id, { embeds: [pledgeEmbed(p, db.pledgeVotes(p.id), db.listLibrary(p.user_id).find(g => g.itad_id === p.itad_id)?.minutes ?? null)], components: pledgeComponents(p), allowedMentions: { parse: [] } }); } catch (err) { log(`could not update pledge ${p.id}: ${err.message}`); } };

    async function create({ guildId, channelId, userId, title, hours, days }) {
        hours = Math.round(Number(hours)); days = Math.round(Number(days ?? 14));
        if (!(hours >= PLEDGE_LIMITS.minHours && hours <= PLEDGE_LIMITS.maxHours)) throw new UserError(`Pledge between ${PLEDGE_LIMITS.minHours} and ${PLEDGE_LIMITS.maxHours} hours.`);
        if (!(days >= PLEDGE_LIMITS.minDays && days <= PLEDGE_LIMITS.maxDays)) throw new UserError(`Give yourself between ${PLEDGE_LIMITS.minDays} and ${PLEDGE_LIMITS.maxDays} days.`);
        const q = String(title ?? "").trim().toLowerCase();
        if (!q) throw new UserError("Say which game.");
        const lib = db.listLibrary(userId);
        if (!lib.length) throw new UserError("I can only hold you to games I can see. Link your Steam account first with `/me steam`, then try again.");
        const game = lib.find(g => g.title?.toLowerCase() === q) ?? lib.find(g => g.title?.toLowerCase().includes(q));
        if (!game || !game.appid) throw new UserError(`I couldn't find "${title}" in your synced Steam library.`);
        if (db.countOpenPledgesBy(guildId, userId) >= MAX_OPEN) throw new UserError(`You already have ${MAX_OPEN} open pledges here. Finish or cancel one first.`);
        if (db.hasOpenPledgeFor(userId, game.itad_id)) throw new UserError(`You already have an open pledge for ${game.title}.`);
        const p = db.createPledge({ guild_id: guildId, channel_id: channelId, user_id: userId, itad_id: game.itad_id, appid: game.appid, title: game.title, hours, base_minutes: game.minutes ?? 0, due_at: now() + days * DAY });
        const msg = await discord.post(channelId, { embeds: [pledgeEmbed(p, [], game.minutes ?? 0)], components: pledgeComponents(p), allowedMentions: { parse: [] } });
        db.setPledgeMessage(p.id, msg.id);
        return db.getPledge(p.id);
    }

    async function vote(id, userId, side) {
        const p = db.getPledge(id);
        if (!p || p.status !== "open") throw new UserError("That pledge is settled.");
        const r = db.votePledge(id, userId, side);
        if (r === "own") throw new UserError("You can't vote on your own pledge. Just go play.");
        if (r !== "same") await post(p);
        return { result: r, pledge: p };
    }

    async function cancel(id, userId, { canManage = false } = {}) {
        const p = db.getPledge(id);
        if (!p) throw new UserError("I can't find that pledge.");
        if (p.user_id !== userId && !canManage) throw new UserError("Only the person who made it, or a server manager, can cancel it.");
        if (!db.closePledge(id, "cancelled")) throw new UserError("That pledge is already settled.");
        await post({ ...p, status: "cancelled" });
        return p;
    }

    /** Settles every pledge that reached its hours, or ran out of time. Playtime is refreshed from Steam right before a verdict. */
    async function tick() {
        const at = now(), stats = { kept: 0, failed: 0, checked: 0 };
        for (const p of db.openPledges()) {
            stats.checked++;
            const lapsed = p.due_at <= at;
            let minutes = db.listLibrary(p.user_id).find(g => g.itad_id === p.itad_id)?.minutes ?? p.base_minutes;
            if (lapsed || progressOf(p, minutes) >= p.hours * 60) {
                if (lapsed && refresh) { try { await refresh(p.user_id); minutes = db.listLibrary(p.user_id).find(g => g.itad_id === p.itad_id)?.minutes ?? minutes; } catch (err) { log(`could not refresh ${p.user_id}: ${err.message}`); } }
                const kept = progressOf(p, minutes) >= p.hours * 60;
                if (!lapsed && !kept) continue;
                if (!db.closePledge(p.id, kept ? "kept" : "failed", minutes)) continue;
                kept ? stats.kept++ : stats.failed++;
                const settled = db.getPledge(p.id), votes = db.pledgeVotes(p.id);
                const right = votes.filter(v => (v.side === "back") === kept).map(v => v.user_id);
                try {
                    await discord.post(p.channel_id, {
                        content: [p.user_id, ...right].map(u => `<@${u}>`).join(" "),
                        embeds: [{ ...pledgeEmbed(settled, votes, minutes), footer: { text: right.length ? `${right.length} right call${right.length === 1 ? "" : "s"} · +3 points each${kept ? ", +10 for the pledger" : ""}` : kept ? "+10 points for the pledger" : "Nobody called that one" } }],
                        allowedMentions: { users: [p.user_id, ...right] }
                    });
                } catch (err) { log(`could not announce pledge ${p.id}: ${err.message}`); }
                await post(settled);
            }
        }
        return stats;
    }
    return { create, vote, cancel, tick };
}

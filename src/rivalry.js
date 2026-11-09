// Server rivalries: once a month, servers that turned on the weekly digest are paired by size and compared on last month's backlog.
// Only totals are shared (games finished and hours among members who opted in with /alerts share), never anyone's name or library.
const MIN_MEMBERS = 3;
const day = ms => new Date(ms).toISOString().slice(0, 10);

/** Last calendar month in UTC: { key, from, to, label }. */
export function lastMonth(nowMs) {
    const d = new Date(nowMs), y = d.getUTCFullYear(), m = d.getUTCMonth();
    const from = Date.UTC(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1, 1), to = Date.UTC(y, m, 1);
    const f = new Date(from);
    return { key: `${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, "0")}`, from, to, label: f.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) };
}

export function monthTotals(db, guildId, { from, to }) {
    const { minutes, members } = db.sharedHoursBetween(guildId, day(from), day(to));
    const finished = db.sharedFinished(guildId, from, to).reduce((t, r) => t + r.done, 0);
    return { members, finished, hours: Math.round(minutes / 60), perMember: members ? finished / members : 0 };
}

/** The bigger "games finished per sharing member" wins, hours per member settles a tie. Returns "a", "b" or "tie". */
export function winner(a, b) {
    const pa = a.perMember, pb = b.perMember;
    if (Math.abs(pa - pb) > 1e-9) return pa > pb ? "a" : "b";
    const ha = a.members ? a.hours / a.members : 0, hb = b.members ? b.hours / b.members : 0;
    return Math.abs(ha - hb) > 1e-9 ? (ha > hb ? "a" : "b") : "tie";
}

export function pairUp(rows) {
    const sorted = [...rows].sort((x, y) => y.t.members - x.t.members || String(x.id).localeCompare(String(y.id)));
    const out = [];
    for (let i = 0; i + 1 < sorted.length; i += 2) out.push([sorted[i], sorted[i + 1]]);
    return out;
}

export function rivalryEmbed(me, rival, who, month) {
    const n = x => x.toLocaleString("en-US"), won = who === "a" ? me.name : who === "b" ? rival.name : null;
    const line = s => `**${n(s.t.finished)}** finished · **${n(s.t.hours)} h** played · ${s.t.members} members sharing`;
    return { color: who === "a" ? 0x57f287 : who === "b" ? 0xed4245 : 0xfee75c, title: `${me.name} vs ${rival.name}: ${month}`,
        description: (won ? `**${won}** took the month.` : "A dead heat.") + " Games finished per member who shares decides it, hours played settles ties.",
        fields: [{ name: me.name, value: line(me), inline: false }, { name: rival.name, value: line(rival), inline: false }],
        footer: { text: "Only totals from members who opted in with /alerts share are counted. Turn off this server's weekly digest to sit the rivalry out." } };
}

/** On the first days of the month, posts each pairing once. A server with no rival this month is skipped and tries again next time. */
export async function runRivalries({ db, notifier, guildName = () => null, now = () => Date.now(), log = () => {} }) {
    const stats = { posted: 0, unpaired: 0 };
    if (new Date(now()).getUTCDate() > 3) return stats;
    const month = lastMonth(now()), key = `rivalry:${month.key}`;
    const rows = [];
    for (const g of db.guildsWithDigest()) {
        if (db.guildHasSeen(g.guild_id, key)) continue;
        const t = monthTotals(db, g.guild_id, month);
        if (t.members >= MIN_MEMBERS) rows.push({ id: g.guild_id, name: guildName(g.guild_id) ?? "Your server", t });
    }
    const pairs = pairUp(rows);
    stats.unpaired = rows.length - pairs.length * 2;
    for (const [a, b] of pairs) {
        const who = winner(a.t, b.t);
        for (const [me, rival, w] of [[a, b, who], [b, a, who === "a" ? "b" : who === "b" ? "a" : "tie"]]) {
            try { if (await notifier.postGuild(me.id, { embeds: [rivalryEmbed(me, rival, w, month.label)] })) { db.guildMarkSeen(me.id, key); stats.posted++; } }
            catch (err) { log(`rivalry failed: ${err.code ?? err.name}`); }
        }
    }
    return stats;
}

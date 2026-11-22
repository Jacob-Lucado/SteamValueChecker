// Channel check: before a post fails, test each channel a server has chosen for the bot's posts. The bot needs to see the channel,
// send messages and embed links there. Each row says what is wrong in plain words and how to fix it, so a server's manager can
// fix a hidden channel or a category override without waiting for a failed post and an owner DM.
import { FEATURES } from "./feedhealth.js";
import { reportProblem, clearProblems } from "./guildproblems.js";

const NEED = ["View Channel", "Send Messages", "Embed Links"];

/** The channels a server has set up, as [{ feature, label, channelId }] (one row per feature, nothing for features left off). */
export function configuredChannels(db, guildId) {
    const out = [];
    const add = (feature, channelId) => { if (channelId) out.push({ feature, label: FEATURES[feature]?.label ?? feature, channelId: String(channelId) }); };
    add("feed", db.getGuild?.(guildId)?.channel_id);
    add("codes", db.getCodeSettings?.(guildId)?.channel_id);
    add("bundles", db.getBundleFeedSettings?.(guildId)?.channel_id);
    add("drops", db.getDropSettings?.(guildId)?.channel_id);
    return out;
}

/**
 * `inspect(channelId)` is async and returns { exists, name, missing } where `missing` lists the permissions the bot lacks
 * (names from NEED). Returns { rows, bad } with one row per configured channel: { ...channel, name, ok, problem, fix }.
 */
export async function checkChannels({ db, guildId, inspect }) {
    const rows = [];
    for (const c of configuredChannels(db, guildId)) {
        let r;
        try { r = await inspect(c.channelId); } catch { r = null; }
        let problem = null;
        if (!r) problem = "I couldn't look at that channel right now.";
        else if (!r.exists) problem = "That channel was deleted or I can't see it. A channel or category permission may be hiding it from me.";
        else if (r.missing?.length) problem = `I'm missing: ${r.missing.join(", ")}.`;
        rows.push({ ...c, name: r?.name ?? null, unknown: !r, ok: !problem, problem, fix: problem ? FEATURES[c.feature]?.fix ?? "Fix the channel's permissions." : null });
    }
    return { rows, bad: rows.filter(r => !r.ok).length };
}

export function checkEmbed(res) {
    if (!res.rows.length) return { color: 0x5865f2, title: "Channel check", description: "No post channels are set up yet. Run `/setup` to pick them." };
    const lines = res.rows.map(r => r.ok
        ? `✅ **${r.label}**: <#${r.channelId}> is fine.`
        : `❌ **${r.label}**: <#${r.channelId}>. ${r.problem}\n   ${r.fix}`);
    return {
        color: res.bad ? 0xed4245 : 0x57f287, title: res.bad ? `Channel check: ${res.bad} problem${res.bad === 1 ? "" : "s"}` : "Channel check: all good",
        description: lines.join("\n").slice(0, 3800),
        footer: { text: `The bot needs ${NEED.join(", ")} in each channel. Check the category's permissions too.` }
    };
}

/** Builds `inspect` from a discord.js client. */
export function clientInspector(client, guildId, PermissionFlagsBits) {
    const flags = [[PermissionFlagsBits.ViewChannel, NEED[0]], [PermissionFlagsBits.SendMessages, NEED[1]], [PermissionFlagsBits.EmbedLinks, NEED[2]]];
    return async channelId => {
        const g = client.guilds.cache.get(String(guildId));
        if (!g) return null;
        const ch = g.channels.cache.get(channelId) ?? await g.channels.fetch(channelId).catch(() => null);
        if (!ch) return { exists: false, name: null, missing: [] };
        const me = g.members.me ?? await g.members.fetchMe().catch(() => null);
        const p = me ? ch.permissionsFor(me) : null;
        return { exists: true, name: ch.name, missing: p ? flags.filter(([f]) => !p.has(f)).map(([, n]) => n) : NEED };
    };
}

/** The sentence a server manager sees when the bot can post text in a channel but not embeds (a plain test message goes through anyway). */
export function embedGapMessage(name) {
    return `I can post in #${name}, but I'm missing Embed Links there, and every post I make is an embed. Allow Embed Links for the bot in that channel (check its category too), then try again.`;
}

/**
 * Once a day, checks the channels every server picked and keeps the result on the server's Community page: a channel the bot can
 * no longer post in (a permission changed, a category was locked) shows up there before a real post fails. A channel the bot just
 * couldn't look at is left as it was. `inspectFor(guildId)` is the same inspector the /setup check uses.
 */
export async function runChannelAudit({ db, guildIds, inspectFor, now = () => Date.now(), log = () => {} }) {
    const stats = { servers: 0, checked: 0, problems: 0, skipped: false };
    const last = Number(db.getMeta("chanaudit:last") ?? 0);
    if (now() - last < 20 * 3_600_000) return { ...stats, skipped: true };
    db.setMeta("chanaudit:last", String(now()));
    for (const gid of guildIds) {
        if (!configuredChannels(db, gid).length) continue;
        stats.servers++;
        const { rows } = await checkChannels({ db, guildId: gid, inspect: inspectFor(gid) });
        for (const r of rows) {
            if (r.unknown) continue;
            stats.checked++;
            const key = `audit:${r.feature}`;
            if (r.ok) clearProblems(db, gid, key);
            else {
                stats.problems++;
                reportProblem(db, gid, key, `${r.label.toLowerCase()} in ${r.name ? `#${r.name}` : "the channel"}`, { message: `${r.problem} ${r.fix}` }, now());
                log(`Channel check: ${r.label} in server ${gid}, channel ${r.channelId}: ${r.problem}`);
            }
        }
    }
    return stats;
}

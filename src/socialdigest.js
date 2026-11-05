// A weekly rundown, sent as a DM to members who asked for it: what the people they follow finished, unlocked and posted.
import { isQuiet } from "./timeutil.js";

const WEEK = 7 * 86400_000, PER_RUN = 25, MAX_LINES = 8;

const trim = (text, n) => { const t = String(text ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

/** One line for one feed item, or null for kinds the digest skips. */
export function digestLine(it, nameOf) {
    const who = `**${nameOf(it)}**`;
    if (it.kind === "finished") return `🏁 ${who} finished **${it.game ?? "a game"}**`;
    if (it.kind === "rare") return `💎 ${who} unlocked **${it.data?.name ?? "a rare achievement"}**${it.game ? ` in ${it.game}` : ""}${it.data?.pct != null ? ` (${it.data.pct}% of players)` : ""}`;
    if (it.kind === "trophy") return `🏆 ${who} earned the ${it.data?.name ?? "a"} trophy (${it.data?.tier ?? "new tier"})`;
    if (it.kind === "post") return `💬 ${who}: “${trim(it.body, 90)}”`;
    return null;
}

export function digestEmbed({ counts, items, people }, nameOf, url) {
    const lines = items.map(i => digestLine(i, nameOf)).filter(Boolean).slice(0, MAX_LINES);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const bits = [counts.finished ? `${counts.finished} finished` : null, counts.rare ? `${counts.rare} rare unlock${counts.rare === 1 ? "" : "s"}` : null, counts.post ? `${counts.post} post${counts.post === 1 ? "" : "s"}` : null, counts.trophy ? `${counts.trophy} trophy tier${counts.trophy === 1 ? "" : "s"}` : null].filter(Boolean);
    return {
        color: 0x5865f2, title: "📰 This week from the people you follow",
        description: `${people} ${people === 1 ? "person was" : "people were"} busy: ${bits.join(", ")}.\n\n${lines.join("\n")}${total > lines.length ? `\n\n…and ${total - lines.length} more in the feed.` : ""}${url ? `\n\n[Open the feed](${url.replace(/\/$/, "")}/feed)` : ""}`,
        footer: { text: "Turn this off in the Feed settings on the dashboard" }
    };
}

export async function runSocialDigest({ db, notifier, dashboardUrl = null, now = () => Date.now() }) {
    const stats = { checked: 0, delivered: 0, failed: 0, empty: 0, deferred: 0 };
    let sent = 0;
    for (const row of db.socialDigestUsers()) {
        const id = row.discord_id, t = now();
        if (t - row.last_digest < WEEK - 3600_000) continue;
        if (sent >= PER_RUN) break;
        const user = db.getUser(id);
        if (!user) continue;
        stats.checked++;
        const d = db.digestFor(id, Math.max(row.last_digest, t - WEEK));
        if (!d.items.length) { stats.empty++; continue; }
        if (isQuiet(user, t)) { stats.deferred++; continue; }
        sent++;
        const names = new Map();
        const nameOf = it => { if (!names.has(it.author)) { const u = db.getUser(it.author); names.set(it.author, db.getProfileData(it.author).data.name || u?.profile_slug || "Someone"); } return names.get(it.author); };
        const res = await notifier.deliver(user, { embeds: [digestEmbed(d, nameOf, dashboardUrl)] }, "digest");
        if (!res.ok) { stats.failed++; continue; }
        stats.delivered++;
        db.markDigest(id, t);
    }
    return stats;
}

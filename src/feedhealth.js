// Feed health: what to do when a post to a server's channel fails. It names the server and channel in the log, says in plain words
// why Discord refused, stops hitting a broken channel every cycle (a permanent problem is retried once a day), and tells the server's
// owner by DM, once a week at most, once it is clear the problem isn't going away. The bot owner can see every server that is
// failing right now on the Admin page, and the server's own dashboard shows it in that server's problem list.
import { reportProblem, clearProblems } from "./guildproblems.js";

const DAY = 86400_000;
export const NOTIFY_AFTER_FAILS = 2;      // permanent problems: second failed cycle in a row
export const NOTIFY_AFTER_TRANSIENT = 6;  // anything else: six in a row
export const NOTIFY_EVERY_DAYS = 7;
export const RETRY_AFTER_HOURS = 24;

export const FEATURES = {
    codes: { label: "Game code posts", fix: "Use `/codes channel` to pick another channel, or fix the permissions on the current one." },
    bundles: { label: "Bundle posts", fix: "Use `/codes bundles` to pick another channel, or fix the permissions on the current one." },
    feed: { label: "Free game posts", fix: "Pick another alert channel on the dashboard's Server page (or with `/setup`), or fix the permissions on the current one." },
    deals: { label: "Hot deal posts", fix: "Pick another alert channel on the dashboard's Server page (or with `/setup`), or fix the permissions on the current one." },
    drops: { label: "Promo drop posts", fix: "Use `/server promos` to pick another channel, or fix the permissions on the current one." },
    news: { label: "Promo news posts", fix: "Use `/server promos` to pick another channel, or fix the permissions on the current one." },
    memes: { label: "Auto meme posts", fix: "Use `/manage memes setup` to pick another channel, or fix the permissions on the current one." },
    sale: { label: "Steam sale posts", fix: "Pick another alert channel on the dashboard's Server page (or with `/setup`), or fix the permissions on the current one." }
};

const PERMANENT_CODES = new Set([10003, 10004, 10013, 50001, 50007, 50013, 50278]);

/** Turns whatever failed (a REST error, a discord.js error, or a saved failure) into { code, status, text, why, permanent }. */
export function explain(err) {
    const raw = err?.raw ?? err;
    const status = Number(raw?.status) || null;
    const fromDetail = String(raw?.detail ?? "").match(/code (\d+)/);
    const code = Number(raw?.code) || (fromDetail ? Number(fromDetail[1]) : null);
    const text = String(raw?.rawError?.message ?? String(raw?.detail ?? "").replace(/\s*\(code \d+\)/, "") ?? raw?.message ?? "").trim()
        || String(raw?.message ?? raw?.name ?? "unknown").replace(/\s+/g, " ").slice(0, 100);
    let why;
    if (code === 10003 || (status === 404 && !code)) why = "The channel was deleted.";
    else if (code === 10004) why = "The bot isn't in that server anymore.";
    else if (code === 50001) why = "The bot can't see that channel. A channel or category permission is usually hiding it from the bot.";
    else if (code === 50013) why = "The bot is missing a permission in that channel. It needs View Channel, Send Messages and Embed Links.";
    else if (status === 403) why = "Discord refused the post. Most often the bot can't see the channel or can't send embeds there.";
    else if (status === 429) why = "Discord asked the bot to slow down.";
    else if (status >= 500) why = "Discord had a hiccup on its side.";
    else why = "Discord didn't say why.";
    const permanent = (code !== null && PERMANENT_CODES.has(code)) || status === 403 || status === 404;
    return { code, status, text: text.slice(0, 100), why, permanent, short: [status, code && code !== status ? code : null, text].filter(x => x !== null && x !== "").join(" ").slice(0, 120) };
}

export function ownerNotice({ feature, serverName, channelId, channelName, info, since }) {
    const f = FEATURES[feature] ?? { label: "Posts", fix: "Check the bot's permissions in that channel." };
    return {
        embeds: [{
            color: 0xfaa61a, title: `⚠️ I can't post in ${serverName}`,
            description: [
                `${f.label} for **${serverName}** keep failing in ${channelName ? `**#${channelName}**` : `<#${channelId}>`}${since ? ` (since <t:${Math.floor(since / 1000)}:R>)` : ""}.`,
                `Discord says: \`${info.short}\`. ${info.why}`,
                `**To fix it:** give the bot View Channel, Send Messages and Embed Links in that channel (check the category's permissions too). ${f.fix}`,
                "Once it's fixed, run `/setup check:True` in the server to confirm and I'll try again right away. Otherwise I try once a day, and I won't message you about this again for a week."
            ].join("\n\n").slice(0, 1800),
            footer: { text: "You got this because you own the server. Steam Value Checker" }
        }]
    };
}

/**
 * `guildInfo(id)` returns { name, ownerId, channelName(channelId) } for the log and the owner DM (or null when the bot can't see it).
 * `sendDm(userId, payload)` sends the owner notice.
 */
export function createFeedHealth({ db, guildInfo = async () => null, sendDm = async () => { throw new Error("no dm"); }, log = () => {}, now = () => Date.now() }) {
    const recKey = (feature, gid) => `feedfail:${feature}:${gid}`;
    const blockKey = (feature, gid) => `feedblock:${feature}:${gid}`;
    const read = (feature, gid) => { try { const v = db.getMeta(recKey(feature, gid)); return v ? JSON.parse(v) : null; } catch { return null; } };
    const write = (feature, gid, rec) => db.setMeta(recKey(feature, gid), rec ? JSON.stringify(rec) : "");

    const blocked = (feature, gid) => Number(db.getMeta(blockKey(feature, gid)) ?? 0) > now();

    async function report({ feature, guildId, channelId, err }) {
        const info = explain(err);
        const t = now();
        const prev = read(feature, guildId);
        const rec = { feature, guildId: String(guildId), channelId: channelId ? String(channelId) : null, count: (prev?.count ?? 0) + 1, since: prev?.since ?? t, last: t, short: info.short, why: info.why, permanent: info.permanent, notifiedAt: prev?.notifiedAt ?? null, owner: prev?.owner ?? null, name: prev?.name ?? null };
        let gi = null;
        try { gi = await guildInfo(guildId, channelId); } catch { /* names are a nicety */ }
        if (gi?.name) rec.name = gi.name;
        if (info.permanent) db.setMeta(blockKey(feature, guildId), String(t + RETRY_AFTER_HOURS * 3_600_000));

        let ownerLine = "";
        const due = !rec.notifiedAt || t - rec.notifiedAt > NOTIFY_EVERY_DAYS * DAY;
        const ready = info.permanent ? rec.count >= NOTIFY_AFTER_FAILS : rec.count >= NOTIFY_AFTER_TRANSIENT;
        if (ready && due) {
            if (!gi?.ownerId) { rec.owner = "unknown owner"; ownerLine = " Owner: couldn't find who owns it."; }
            else {
                try {
                    await sendDm(gi.ownerId, ownerNotice({ feature, serverName: gi.name ?? `server ${guildId}`, channelId, channelName: gi.channelName ?? null, info, since: rec.since }));
                    rec.notifiedAt = t; rec.owner = "notified";
                    ownerLine = ` Owner (${gi.ownerId}) notified by DM.`;
                } catch (e) {
                    rec.notifiedAt = t;   // closed DMs stay closed, so the next try is in a week like any other notice
                    rec.owner = `DM failed: ${String(e?.detail ?? e?.message ?? e).slice(0, 60)}`;
                    ownerLine = ` Owner (${gi.ownerId}) couldn't be messaged (${rec.owner.slice(11)}).`;
                }
            }
        } else if (rec.owner === "notified" && rec.notifiedAt) ownerLine = ` Owner was told ${Math.max(0, Math.round((t - rec.notifiedAt) / DAY))} day(s) ago.`;
        else ownerLine = ready ? "" : ` Will message the owner if it keeps failing (${rec.count}/${info.permanent ? NOTIFY_AFTER_FAILS : NOTIFY_AFTER_TRANSIENT}).`;

        write(feature, guildId, rec);
        reportProblem(db, guildId, `feed:${feature}`, `${(FEATURES[feature]?.label ?? "Posts").toLowerCase()} in ${gi?.channelName ? `#${gi.channelName}` : "the channel"}`, { ...(err?.raw ?? err), detail: info.short }, t);
        const where = `${gi?.name ? `"${gi.name}" (${guildId})` : `server ${guildId}`}${channelId ? `, ${gi?.channelName ? `#${gi.channelName}` : "channel"} ${channelId}` : ""}`;
        const line = `${FEATURES[feature]?.label ?? feature} failed in ${where}: ${info.short}. ${info.why}${info.permanent ? ` Skipping it for ${RETRY_AFTER_HOURS} hours.` : ""}${ownerLine}`;
        log(line);
        return { ...rec, line };
    }

    /** A post worked again: forget the failure and say so once. */
    function ok(feature, guildId) {
        const rec = read(feature, guildId);
        if (!rec) return false;
        write(feature, guildId, null);
        clearProblems(db, guildId, `feed:${feature}`);
        db.setMeta(blockKey(feature, guildId), "0");
        log(`${FEATURES[feature]?.label ?? feature} work again in ${rec.name ? `"${rec.name}" (${guildId})` : `server ${guildId}`} after ${rec.count} failed attempt${rec.count === 1 ? "" : "s"}.`);
        return true;
    }

    /** Lets the next cycle try that server again right away instead of waiting out the back-off. */
    function retry(feature, guildId) { db.setMeta(blockKey(feature, guildId), "0"); return true; }

    /** Every server that is failing right now, newest first. */
    function list() {
        return db.listMetaPrefix("feedfail:").map(r => { try { return JSON.parse(r.value); } catch { return null; } }).filter(Boolean).sort((a, b) => b.last - a.last);
    }

    return { report, ok, blocked, list, retry };
}

// Auto-moderation: the bot watches messages and joins and deals with the common problems on its own, then logs each one as a case.
// Everything is off until a server turns it on (dashboard Moderation page or /mod automod). Staff, exempt roles and exempt channels are never touched.
// Settings live in one small JSON value per server, so there is no table to migrate.

import { reportProblem } from "./guildproblems.js";
import { scamScore, normalize } from "./scamfilter.js";
import { phishLinks } from "./phishlinks.js";

export const RULES = {
    spam: "Message spam",
    mentions: "Mass mentions",
    invites: "Discord invite links",
    links: "Links",
    words: "Blocked words",
    caps: "SHOUTING (too many capitals)",
    crosspost: "The same message in several channels",
    everyone: "@everyone and @here",
    emoji: "Too many emoji",
    lines: "Wall of lines",
    files: "Risky file types",
    newlinks: "Links from brand-new members"
};
export const RISKY_FILES = ["exe", "scr", "bat", "cmd", "com", "msi", "jar", "vbs", "ps1", "lnk", "hta", "js", "reg", "apk", "dll"];
export const DEFAULTS = Object.freeze({
    on: false,
    rules: {
        spam: { on: false, count: 5, seconds: 6 },
        mentions: { on: false, max: 5 },
        invites: { on: false },
        links: { on: false, allow: [] },
        words: { on: false, list: [] },
        caps: { on: false, percent: 70, minLength: 12 },
        crosspost: { on: false, channels: 3, seconds: 60 },
        everyone: { on: false },
        emoji: { on: false, max: 15 },
        lines: { on: false, max: 15 },
        files: { on: false, list: RISKY_FILES },
        newlinks: { on: false, minutes: 10 }
    },
    // Scam posts (stolen cards for sale, cash-out schemes). This one is on unless a server turns it off, and it works even when the rest of auto-mod is off.
    scam: { on: true, action: "ban" },
    // Fake Steam and Discord links (look-alike addresses, "free Nitro" pages). Same deal: on unless turned off, same action as the scam guard.
    phish: { on: true },
    // What happens to a message that breaks a rule: it is deleted, and optionally the person is warned or timed out too.
    action: { warn: true, timeoutMinutes: 0 },
    // After this many active warnings the bot acts on its own (0 = never): "timeout" (for escalateMinutes), "kick" or "ban".
    escalate: { warns: 0, action: "timeout", minutes: 60 },
    exemptRoles: [], exemptChannels: [],
    raid: { on: false, joins: 8, seconds: 20, action: "timeout", minutes: 60, minAccountDays: 0 }
});

const int = (v, lo, hi, d) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const bool = (v, d = false) => (v === undefined || v === null ? d : v === true || v === 1 || v === "1" || v === "true");
const ids = (v, max = 25) => [...new Set((Array.isArray(v) ? v : []).map(String).filter(x => /^\d{15,25}$/.test(x)))].slice(0, max);
const strs = (v, max, len) => [...new Set((Array.isArray(v) ? v : String(v ?? "").split(/[\n,]+/)).map(x => String(x).toLowerCase().replace(/[\u0000-\u001f]/g, "").trim()).filter(Boolean))].map(x => x.slice(0, len)).slice(0, max);
const domain = x => String(x).replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0].replace(/[^a-z0-9.-]/g, "");

/** Turns whatever was sent (dashboard form, stored JSON) into a complete, safe settings object. */
export function cleanAutomod(raw, base = DEFAULTS) {
    const r = raw && typeof raw === "object" ? raw : {}, rr = r.rules ?? {}, b = base.rules ?? DEFAULTS.rules;
    const pick = (k, f) => f({ ...DEFAULTS.rules[k], ...(b[k] ?? {}), ...(rr[k] && typeof rr[k] === "object" ? rr[k] : {}) });
    const esc = { ...DEFAULTS.escalate, ...(base.escalate ?? {}), ...(r.escalate ?? {}) }, rd = { ...DEFAULTS.raid, ...(base.raid ?? {}), ...(r.raid ?? {}) }, ac = { ...DEFAULTS.action, ...(base.action ?? {}), ...(r.action ?? {}) };
    return {
        on: bool(r.on, base.on),
        rules: {
            spam: pick("spam", x => ({ on: bool(x.on), count: int(x.count, 3, 20, 5), seconds: int(x.seconds, 2, 60, 6) })),
            mentions: pick("mentions", x => ({ on: bool(x.on), max: int(x.max, 2, 30, 5) })),
            invites: pick("invites", x => ({ on: bool(x.on) })),
            links: pick("links", x => ({ on: bool(x.on), allow: strs(x.allow, 30, 80).map(domain).filter(Boolean) })),
            words: pick("words", x => ({ on: bool(x.on), list: strs(x.list, 100, 40) })),
            caps: pick("caps", x => ({ on: bool(x.on), percent: int(x.percent, 40, 100, 70), minLength: int(x.minLength, 8, 200, 12) })),
            crosspost: pick("crosspost", x => ({ on: bool(x.on), channels: int(x.channels, 2, 10, 3), seconds: int(x.seconds, 10, 600, 60) })),
            everyone: pick("everyone", x => ({ on: bool(x.on) })),
            emoji: pick("emoji", x => ({ on: bool(x.on), max: int(x.max, 3, 100, 15) })),
            lines: pick("lines", x => ({ on: bool(x.on), max: int(x.max, 4, 100, 15) })),
            files: pick("files", x => { const l = strs(x.list, 40, 10).map(e => e.replace(/^\./, "").replace(/[^a-z0-9]/g, "")).filter(Boolean); return { on: bool(x.on), list: l.length ? l : RISKY_FILES }; }),
            newlinks: pick("newlinks", x => ({ on: bool(x.on), minutes: int(x.minutes, 1, 1440, 10) }))
        },
        scam: (() => { const x = { ...DEFAULTS.scam, ...(base.scam ?? {}), ...(r.scam && typeof r.scam === "object" ? r.scam : {}) }; return { on: bool(x.on, true), action: ["ban", "kick", "delete"].includes(x.action) ? x.action : "ban" }; })(),
        phish: { on: bool(({ ...DEFAULTS.phish, ...(base.phish ?? {}), ...(r.phish && typeof r.phish === "object" ? r.phish : {}) }).on, true) },
        action: { warn: bool(ac.warn), timeoutMinutes: int(ac.timeoutMinutes, 0, 40320, 0) },
        escalate: { warns: int(esc.warns, 0, 20, 0), action: ["timeout", "kick", "ban"].includes(esc.action) ? esc.action : "timeout", minutes: int(esc.minutes, 1, 40320, 60) },
        exemptRoles: ids(r.exemptRoles ?? base.exemptRoles), exemptChannels: ids(r.exemptChannels ?? base.exemptChannels),
        raid: { on: bool(rd.on), joins: int(rd.joins, 3, 50, 8), seconds: int(rd.seconds, 5, 300, 20), action: ["timeout", "kick"].includes(rd.action) ? rd.action : "timeout", minutes: int(rd.minutes, 1, 40320, 60), minAccountDays: int(rd.minAccountDays, 0, 365, 0) }
    };
}

const INVITE = /(?:discord\.gg|discord(?:app)?\.com\/invite|dsc\.gg|invite\.gg)\/[\w-]{2,}/i;
const URL_RE = /\bhttps?:\/\/[^\s<>()]+|\bwww\.[^\s<>()]+/gi;
const hostOf = u => { try { return new URL(/^https?:/i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

/** Which rule a message breaks, or null. Pure: spam tracking is passed in as `recent` (timestamps of this person's recent messages). */
export function breaks(cfg, { content = "", mentionCount = 0, recent = [], now = Date.now(), attachments = [], memberAgeMin = null, crossChannels = 1 }) {
    const R = cfg.rules, text = String(content ?? "");
    if (R.spam.on && recent.filter(t => now - t <= R.spam.seconds * 1000).length >= R.spam.count) return "spam";
    if (R.mentions.on && mentionCount > R.mentions.max) return "mentions";
    if (R.crosspost.on && crossChannels >= R.crosspost.channels) return "crosspost";
    if (R.everyone.on && /@(?:everyone|here)\b/.test(text)) return "everyone";
    if (R.invites.on && INVITE.test(text)) return "invites";
    if (R.files.on && attachments.some(n => R.files.list.includes(String(n).toLowerCase().split(".").pop()))) return "files";
    if (R.newlinks.on && memberAgeMin !== null && memberAgeMin < R.newlinks.minutes && (text.match(URL_RE) ?? []).length) return "newlinks";
    if (R.emoji.on) {
        const n = (text.match(/\p{Extended_Pictographic}|<a?:\w+:\d+>/gu) ?? []).length;
        if (n > R.emoji.max) return "emoji";
    }
    if (R.lines.on && text.split("\n").length > R.lines.max) return "lines";
    if (R.links.on) {
        const found = (text.match(URL_RE) ?? []).map(hostOf).filter(Boolean);
        if (found.some(h => !R.links.allow.some(a => h === a || h.endsWith("." + a)))) return "links";
    }
    if (R.words.on && R.words.list.length) {
        const low = text.toLowerCase();
        if (R.words.list.some(w => new RegExp(`(?<![a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`, "i").test(low))) return "words";
    }
    if (R.caps.on) {
        const letters = text.replace(/[^a-zA-Z]/g, "");
        if (letters.length >= R.caps.minLength && (letters.replace(/[^A-Z]/g, "").length / letters.length) * 100 >= R.caps.percent) return "caps";
    }
    return null;
}

export function createAutomod({ db, api, mod, botId = () => null, now = () => Date.now(), log = () => {} }) {
    const KEY = gid => `automod:${gid}`;
    const cache = new Map(); // guildId -> { at, cfg }
    const posted = new Map(); // `${guildId}:${userId}` -> recent messages, to spot one text sent to many channels
    const recent = new Map(); // `${guildId}:${userId}` -> timestamps
    const joins = new Map(); // guildId -> { times: [], until }

    function get(guildId) {
        const hit = cache.get(guildId);
        if (hit && now() - hit.at < 30_000) return hit.cfg;
        let cfg;
        try { cfg = cleanAutomod(JSON.parse(db.getMeta(KEY(guildId)) ?? "null") ?? {}); } catch { cfg = cleanAutomod({}); }
        cache.set(guildId, { at: now(), cfg });
        return cfg;
    }
    function save(guildId, patch) {
        const cfg = cleanAutomod(patch, get(guildId));
        db.setMeta(KEY(guildId), JSON.stringify(cfg));
        cache.set(guildId, { at: now(), cfg });
        return cfg;
    }
    const exempt = (cfg, { channelId, roles = [], staff }) => staff || cfg.exemptChannels.includes(channelId) || roles.some(r => cfg.exemptRoles.includes(r));

    /** Looks at one message. Returns the rule it broke (after dealing with it), or null. Never throws. */
    async function onMessage({ guildId, channelId, messageId, authorId, content, mentionCount = 0, roles = [], staff = false, deleteMessage, attachments = [], joinedAt = null, edited = false }) {
        try {
            const cfg = get(guildId);
            if (authorId === botId() || exempt(cfg, { channelId, roles, staff })) return null;
            if (cfg.scam.on && scamScore(content).scam) return await dealWithScam({ cfg, guildId, channelId, authorId, deleteMessage, content });
            if (cfg.phish.on && phishLinks(content).length) return await dealWithScam({ cfg, guildId, channelId, authorId, deleteMessage, content, what: "A fake Steam or Discord link" });
            if (edited || !cfg.on) return null; // an edit is only checked for scams (people post something harmless, then edit the scam in)
            const k = `${guildId}:${authorId}`, t = now();
            const list = (recent.get(k) ?? []).filter(x => t - x < 60_000); list.push(t); recent.set(k, list);
            if (recent.size > 5000) for (const [key, v] of recent) if (!v.length || t - v.at(-1) > 60_000) recent.delete(key);
            let crossChannels = 1;
            if (cfg.rules.crosspost.on) {
                const key = normalize(content).slice(0, 200);
                if (key.length >= 12) {
                    const seen = (posted.get(k) ?? []).filter(x => t - x.t < cfg.rules.crosspost.seconds * 1000); seen.push({ t, key, channelId }); posted.set(k, seen);
                    crossChannels = new Set(seen.filter(x => x.key === key).map(x => x.channelId)).size;
                    if (posted.size > 5000) for (const [kk, v] of posted) if (!v.length || t - v.at(-1).t > 600_000) posted.delete(kk);
                }
            }
            const rule = breaks(cfg, { content, mentionCount, recent: list, now: t, attachments, crossChannels, memberAgeMin: joinedAt ? (t - joinedAt) / 60_000 : null });
            if (!rule) return null;
            await Promise.resolve(deleteMessage?.()).catch(() => {});
            if (rule === "spam") recent.set(k, []); // one action per burst, not one per message
            const why = `${RULES[rule]} in <#${channelId}>`;
            let res = null;
            if (cfg.action.timeoutMinutes) res = await mod.auto({ guildId, userId: authorId, action: "timeout", reason: why, durationS: cfg.action.timeoutMinutes * 60 }).catch(e => { log(`automod timeout: ${e.message}`); reportProblem(db, guildId, "automod", "time someone out for breaking an auto-mod rule", e); return null; });
            else if (cfg.action.warn) res = await mod.auto({ guildId, userId: authorId, action: "warn", reason: why }).catch(e => { log(`automod warn: ${e.message}`); reportProblem(db, guildId, "automod", "warn someone for breaking an auto-mod rule", e); return null; });
            else res = await mod.auto({ guildId, userId: authorId, action: "automod", reason: why }).catch(() => null);
            db.bumpUsage(`automod_${rule}`);
            if (res && cfg.escalate.warns && res.warnings >= cfg.escalate.warns && cfg.action.warn) {
                const e = cfg.escalate;
                await mod.auto({ guildId, userId: authorId, action: e.action, reason: `${res.warnings} warnings`, durationS: e.action === "timeout" ? e.minutes * 60 : null, dmVerb: true }).catch(err => { log(`automod escalate: ${err.message}`); reportProblem(db, guildId, "automod-escalate", `${cfg.escalate.action} someone after repeated warnings`, err); });
            }
            return rule;
        } catch (e) { log(`automod: ${e.message}`); return null; }
    }

    // Accounts caught posting scams anywhere the bot is. When one joins another server with the scam guard on, it's removed before it can post.
    const SCAMMER = id => `scammer:${id}`;
    const knownScammer = id => { try { return Boolean(db.getMeta(SCAMMER(id))); } catch { return false; } };
    const markScammer = id => { try { const cur = JSON.parse(db.getMeta(SCAMMER(id)) ?? "null") ?? { n: 0 }; db.setMeta(SCAMMER(id), JSON.stringify({ at: now(), n: (cur.n ?? 0) + 1 })); } catch { /* the list is a bonus */ } };
    /** Dry run for the dashboard's "try a message" box: what the guards would do with this text. Changes nothing. */
    function test(guildId, content) {
        const cfg = get(guildId), sc = scamScore(content), ph = phishLinks(content);
        const rule = breaks(cfg, { content, mentionCount: 0, recent: [], now: now(), attachments: [], crossChannels: 1, memberAgeMin: null });
        const verdict = cfg.scam.on && sc.scam ? "scam" : cfg.phish.on && ph.length ? "phish" : cfg.on && rule ? rule : null;
        return { verdict, label: verdict === "scam" ? "Scam guard" : verdict === "phish" ? "Fake link guard" : verdict ? RULES[verdict] : null, score: sc.score, hits: sc.hits, links: ph, scamOn: cfg.scam.on, phishOn: cfg.phish.on, autoOn: cfg.on };
    }

    /** A scam post: the message goes, and so does the account (with its last day of messages), unless the server picked a gentler action. */
    async function dealWithScam({ cfg, guildId, channelId, authorId, deleteMessage, content = "", what = "Scam message (stolen cards or a cash-out scheme)" }) {
        await Promise.resolve(deleteMessage?.()).catch(() => {});
        const act = cfg.scam.action, why = `${what} in <#${channelId}>`;
        if (act !== "delete") {
            await mod.auto({ guildId, userId: authorId, action: act, reason: why, deleteSeconds: act === "ban" ? 86400 : 0, dmVerb: false })
                .catch(e => { log(`automod scam: ${e.message}`); reportProblem(db, guildId, "automod", `${act} someone who posted a scam message (I need the ${act === "ban" ? "Ban" : "Kick"} Members permission)`, e); });
        }
        db.bumpUsage("automod_scam"); markScammer(authorId);
        // Show staff what was removed, so a wrong call is easy to spot and undo.
        const ch = mod.logChannel?.(guildId);
        if (ch && api?.sendMessage) {
            const shown = String(content ?? "").replace(/`/g, "'").replace(/@(everyone|here)/gi, "@\u200b$1").slice(0, 900);
            const verdict = act === "ban" ? "Banned" : act === "kick" ? "Kicked" : "Message removed";
            await api.sendMessage(ch, { allowed_mentions: { parse: [] }, embeds: [{ color: 0xed4245, title: `🛡️ Scam guard: ${verdict.toLowerCase()}`,
                description: `**${what}** from <@${authorId}> in <#${channelId}>.\n\`\`\`\n${shown || "(no text)"}\n\`\`\``,
                fields: [{ name: "Who", value: `<@${authorId}>\n\`${authorId}\``, inline: true }, { name: "What happened", value: act === "delete" ? "Only the message was removed." : `${verdict}, and their last day of messages was deleted.`, inline: true },
                    ...(act === "delete" ? [] : [{ name: "Wrong call?", value: "Lift it with `/mod unban`, and switch this off under Moderation on the dashboard if it keeps happening.", inline: false }])],
                footer: { text: "Steam Value Checker · scam guard" } }] }).catch(() => {});
        }
        return "scam";
    }

    /** A new member joined. Returns "raid" when the raid guard dealt with them, "young" for a too-new account, else null. */
    async function onJoin({ guildId, userId, createdAtMs = null, bot = false }) {
        try {
            const cfg = get(guildId);
            if (bot || userId === botId()) return null;
            if (cfg.scam.on && cfg.scam.action !== "delete" && knownScammer(userId)) {
                await mod.auto({ guildId, userId, action: cfg.scam.action, reason: "Known scam account (caught posting scams in another server)", dmVerb: false })
                    .catch(e => { log(`scam join: ${e.message}`); reportProblem(db, guildId, "automod", `${cfg.scam.action} a known scam account as it joined`, e); });
                db.bumpUsage("automod_scammer_join");
                return "scammer";
            }
            if (!cfg.raid.on) return null;
            const R = cfg.raid, t = now(), st = joins.get(guildId) ?? { times: [], until: 0, alerted: false };
            st.times = st.times.filter(x => t - x < R.seconds * 1000); st.times.push(t); joins.set(guildId, st);
            const young = R.minAccountDays && createdAtMs && t - createdAtMs < R.minAccountDays * 86400_000;
            if (st.times.length >= R.joins && t >= st.until) { st.until = t + 10 * 60_000; st.alerted = false; }
            const raiding = t < st.until;
            if (!raiding && !young) return null;
            const why = raiding ? `Join flood: ${st.times.length} joins in ${R.seconds}s` : `Account younger than ${R.minAccountDays} day${R.minAccountDays === 1 ? "" : "s"}`;
            await mod.auto({ guildId, userId, action: R.action, reason: why, durationS: R.action === "timeout" ? R.minutes * 60 : null, dmVerb: R.action === "kick", caseAs: raiding && !st.alerted ? "raid" : null })
                .catch(e => { log(`raid guard: ${e.message}`); reportProblem(db, guildId, "raid", `${R.action} a new member (raid guard)`, e); });
            if (raiding) st.alerted = true;
            db.bumpUsage(raiding ? "automod_raid" : "automod_young");
            return raiding ? "raid" : "young";
        } catch (e) { log(`raid guard: ${e.message}`); return null; }
    }
    return { get, save, onMessage, onJoin, test, rules: RULES };
}

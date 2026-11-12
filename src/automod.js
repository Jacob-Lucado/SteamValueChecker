// Auto-moderation: the bot watches messages and joins and deals with the common problems on its own, then logs each one as a case.
// Everything is off until a server turns it on (dashboard Moderation page or /mod automod). Staff, exempt roles and exempt channels are never touched.
// Settings live in one small JSON value per server, so there is no table to migrate.

import { reportProblem } from "./guildproblems.js";

export const RULES = {
    spam: "Message spam",
    mentions: "Mass mentions",
    invites: "Discord invite links",
    links: "Links",
    words: "Blocked words",
    caps: "SHOUTING (too many capitals)"
};
export const DEFAULTS = Object.freeze({
    on: false,
    rules: {
        spam: { on: false, count: 5, seconds: 6 },
        mentions: { on: false, max: 5 },
        invites: { on: false },
        links: { on: false, allow: [] },
        words: { on: false, list: [] },
        caps: { on: false, percent: 70, minLength: 12 }
    },
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
            caps: pick("caps", x => ({ on: bool(x.on), percent: int(x.percent, 40, 100, 70), minLength: int(x.minLength, 8, 200, 12) }))
        },
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
export function breaks(cfg, { content = "", mentionCount = 0, recent = [], now = Date.now() }) {
    const R = cfg.rules, text = String(content ?? "");
    if (R.spam.on && recent.filter(t => now - t <= R.spam.seconds * 1000).length >= R.spam.count) return "spam";
    if (R.mentions.on && mentionCount > R.mentions.max) return "mentions";
    if (R.invites.on && INVITE.test(text)) return "invites";
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
    async function onMessage({ guildId, channelId, messageId, authorId, content, mentionCount = 0, roles = [], staff = false, deleteMessage }) {
        try {
            const cfg = get(guildId);
            if (!cfg.on || authorId === botId() || exempt(cfg, { channelId, roles, staff })) return null;
            const k = `${guildId}:${authorId}`, t = now();
            const list = (recent.get(k) ?? []).filter(x => t - x < 60_000); list.push(t); recent.set(k, list);
            if (recent.size > 5000) for (const [key, v] of recent) if (!v.length || t - v.at(-1) > 60_000) recent.delete(key);
            const rule = breaks(cfg, { content, mentionCount, recent: list, now: t });
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

    /** A new member joined. Returns "raid" when the raid guard dealt with them, "young" for a too-new account, else null. */
    async function onJoin({ guildId, userId, createdAtMs = null, bot = false }) {
        try {
            const cfg = get(guildId);
            if (!cfg.raid.on || bot || userId === botId()) return null;
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
    return { get, save, onMessage, onJoin, rules: RULES };
}

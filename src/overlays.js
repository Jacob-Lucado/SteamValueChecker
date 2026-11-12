// Stream overlays for OBS that a streamer builds on the dashboard: a goal bar, server stats and a timer.
// Each one has its own private link and its own look. The link only ever shows what the streamer chose to put on screen.
import { randomBytes } from "node:crypto";
import { upcomingSales } from "./salescal.js";

export const OVERLAY_KINDS = ["goal", "stats", "timer", "alerts", "sale", "scene", "board", "playing", "poll"];
export const SCENE_MAX_ITEMS = 8;
export const SCENE_KINDS = ["goal", "stats", "timer", "sale", "board", "playing"]; // what a scene may rotate through (alerts need their own live feed)
export const OVERLAY_FONTS = ["Inter", "System", "Georgia", "Mono"];
export const MAX_OVERLAYS = 12;
export const MAX_SUPPORTER_OVERLAYS = 24;

export const streamOverlaySchema = `
CREATE TABLE IF NOT EXISTS stream_overlays (
    token    TEXT PRIMARY KEY,
    user_id  TEXT NOT NULL,
    kind     TEXT NOT NULL,
    name     TEXT NOT NULL,
    guild_id TEXT,
    config   TEXT NOT NULL DEFAULT '{}',
    value    REAL NOT NULL DEFAULT 0,
    created  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS stream_overlays_user ON stream_overlays (user_id);
`;

const hex = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(String(v ?? "")) ? String(v).toLowerCase() : d);
const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) && v !== "" && v !== null && v !== undefined ? Math.max(lo, Math.min(hi, n)) : d; };
const text = (v, d, max) => { const s = String(v ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max); return s || d; };
const flag = (v, d) => (v === undefined || v === null ? d : v === true || v === 1 || v === "1" || v === "true");
const pick = (v, list, d) => (list.includes(v) ? v : d);

const LOOK_DEFAULTS = { accent: "#5865f2", text: "#ffffff", muted: "#94a3b8", bg: "#0b0e14", border: "#1e2638", bgOpacity: 85, font: "Inter", radius: 16, padding: 20, scale: 1, showBorder: true, shadow: true, refresh: 10 };

/** Turns whatever the browser sent into a safe, complete settings object for that kind. Unknown fields are dropped. */
export function cleanConfig(kind, input = {}) {
    const c = input && typeof input === "object" ? input : {};
    const look = {
        accent: hex(c.accent, LOOK_DEFAULTS.accent), text: hex(c.text, LOOK_DEFAULTS.text), muted: hex(c.muted, LOOK_DEFAULTS.muted), bg: hex(c.bg, LOOK_DEFAULTS.bg), border: hex(c.border, LOOK_DEFAULTS.border),
        bgOpacity: num(c.bgOpacity, LOOK_DEFAULTS.bgOpacity, 0, 100), font: pick(c.font, OVERLAY_FONTS, LOOK_DEFAULTS.font), radius: num(c.radius, LOOK_DEFAULTS.radius, 0, 40),
        padding: num(c.padding, LOOK_DEFAULTS.padding, 4, 48), scale: num(c.scale, LOOK_DEFAULTS.scale, 0.5, 3), showBorder: flag(c.showBorder, true), shadow: flag(c.shadow, true), refresh: num(c.refresh, LOOK_DEFAULTS.refresh, 5, 120)
    };
    if (kind === "goal") return { ...look, label: text(c.label, "Goal", 40), target: Math.round(num(c.target, 100, 1, 1_000_000_000)), source: pick(c.source, ["manual", "members", "boosts"], "manual"), unit: text(c.unit, "", 12), showPercent: flag(c.showPercent, true), doneText: text(c.doneText, "Goal reached!", 40) };
    if (kind === "stats") return { ...look, label: text(c.label, "", 40), showMembers: flag(c.showMembers, true), showBoosts: flag(c.showBoosts, true), membersLabel: text(c.membersLabel, "Members", 20), boostsLabel: text(c.boostsLabel, "Boosts", 20) };
    if (kind === "timer") return { ...look, label: text(c.label, "Starting soon", 40), mode: pick(c.mode, ["countdown", "countup"], "countdown"), at: Math.round(num(c.at, 0, 0, 4_102_444_800_000)), endText: text(c.endText, "We're live!", 40) };
    if (kind === "alerts") return { ...look, refresh: num(c.refresh, 5, 5, 60), showJoins: flag(c.showJoins, true), showBoosts: flag(c.showBoosts, true), showNames: flag(c.showNames, true), hold: num(c.hold, 6, 3, 20), joinText: text(c.joinText, "Welcome {name}! We're at {count}", 60), boostText: text(c.boostText, "{name} boosted the server! {count} boosts", 60), position: pick(c.position, ["top", "bottom"], "top") };
    if (kind === "sale") return { ...look, label: text(c.label, "", 40), includeFests: flag(c.includeFests, false), showDate: flag(c.showDate, true), endText: text(c.endText, "The sale is on!", 40) };
    if (kind === "board") return { ...look, label: text(c.label, "Top members", 40), limit: Math.round(num(c.limit, 5, 3, 10)), showLevel: flag(c.showLevel, true) };
    if (kind === "poll") return { ...look, refresh: num(c.refresh, 5, 5, 60), pollId: /^\d{5,25}$/.test(String(c.pollId ?? "")) ? String(c.pollId) : "", showPercent: flag(c.showPercent, true) };
    if (kind === "playing") return { ...look, label: text(c.label, "Playing now", 40), limit: Math.round(num(c.limit, 4, 2, 8)) };
    if (kind === "scene") return { ...look, seconds: Math.round(num(c.seconds, 10, 4, 120)), transition: pick(c.transition, ["fade", "slide"], "fade"), items: (Array.isArray(c.items) ? c.items : []).map(x => String(x)).filter(x => /^svcx_[A-Za-z0-9_-]{32}$/.test(x)).filter((x, i, a) => a.indexOf(x) === i).slice(0, SCENE_MAX_ITEMS) };
    return look;
}

export function streamOverlayStore({ run, get, all, now }) {
    const row = r => {
        if (!r) return null;
        let config = {}; try { config = JSON.parse(r.config); } catch { /* fall back to the defaults below */ }
        return { token: r.token, user_id: r.user_id, kind: r.kind, name: r.name, guild_id: r.guild_id, value: r.value, created: r.created, config: cleanConfig(r.kind, config) };
    };
    return {
        listOvs: userId => all("SELECT * FROM stream_overlays WHERE user_id = ? ORDER BY created", String(userId)).map(row),
        ovById: (userId, token) => row(get("SELECT * FROM stream_overlays WHERE token = ? AND user_id = ?", String(token), String(userId))),
        ovByToken: token => /^svcx_[A-Za-z0-9_-]{32}$/.test(String(token ?? "")) ? row(get("SELECT * FROM stream_overlays WHERE token = ?", String(token))) : null,
        createOv(userId, kind, { name, guildId = null, config = {}, max = MAX_OVERLAYS } = {}) {
            if (!OVERLAY_KINDS.includes(kind)) throw new Error("Unknown overlay type.");
            if (get("SELECT COUNT(*) AS n FROM stream_overlays WHERE user_id = ?", String(userId)).n >= max) throw new Error(`You can have up to ${max} overlays. Delete one first.${max === MAX_OVERLAYS ? " Supporters get more." : ""}`);
            const token = "svcx_" + randomBytes(24).toString("base64url");
            run("INSERT INTO stream_overlays (token, user_id, kind, name, guild_id, config, value, created) VALUES (?,?,?,?,?,?,0,?)", token, String(userId), kind, text(name, ({ goal: "Goal", stats: "Server stats", timer: "Timer", alerts: "Alerts", sale: "Sale countdown", scene: "Scene", board: "Leaderboard", playing: "Who is playing", poll: "Poll" })[kind], 40), guildId, JSON.stringify(cleanConfig(kind, config)), now());
            return token;
        },
        updateOv(userId, token, { name, guildId, config, value }) {
            const o = get("SELECT * FROM stream_overlays WHERE token = ? AND user_id = ?", String(token), String(userId));
            if (!o) return false;
            run("UPDATE stream_overlays SET name = ?, guild_id = ?, config = ?, value = ? WHERE token = ?", name === undefined ? o.name : text(name, o.name, 40), guildId === undefined ? o.guild_id : guildId, config === undefined ? o.config : JSON.stringify(cleanConfig(o.kind, config)), value === undefined ? o.value : num(value, o.value, 0, 1_000_000_000), String(token));
            return true;
        },
        /** A new link; the old one stops working at once. */
        resetOvToken(userId, token) {
            const next = "svcx_" + randomBytes(24).toString("base64url");
            run("UPDATE stream_overlays SET token = ? WHERE token = ? AND user_id = ?", next, String(token), String(userId));
            return get("SELECT token FROM stream_overlays WHERE token = ?", next) ? next : null;
        },
        removeOv: (userId, token) => run("DELETE FROM stream_overlays WHERE token = ? AND user_id = ?", String(token), String(userId)),
        removeUserOvs: userId => run("DELETE FROM stream_overlays WHERE user_id = ?", String(userId))
    };
}

/** The numbers an overlay shows right now. `guild` is { members, boosts } for the overlay's server, or null when the bot can't see it. */
export function overlayData(o, guild, at = Date.now()) {
    const c = o.config;
    if (o.kind === "goal") {
        const current = c.source === "members" ? guild?.members ?? 0 : c.source === "boosts" ? guild?.boosts ?? 0 : o.value;
        return { current: Math.round(current), target: c.target, pct: Math.max(0, Math.min(100, Math.round((current / c.target) * 100))) };
    }
    if (o.kind === "stats") return { members: guild?.members ?? null, boosts: guild?.boosts ?? null };
    if (o.kind === "timer") {
        const ms = c.mode === "countdown" ? c.at - at : at - c.at;
        return { at: c.at, mode: c.mode, remainingMs: Math.max(0, ms), done: c.mode === "countdown" && c.at > 0 && ms <= 0, set: c.at > 0 };
    }
    if (o.kind === "sale") {
        const ev = upcomingSales(at, { limit: 1, salesOnly: !c.includeFests })[0] ?? null;
        return ev ? { name: ev.name, start: ev.start, end: ev.end, live: ev.live, note: ev.note ?? "" } : { name: null };
    }
    return {};
}

// Stream overlays for OBS that a streamer builds on the dashboard: a goal bar, server stats and a timer.
// Each one has its own private link and its own look. The link only ever shows what the streamer chose to put on screen.
import { randomBytes } from "node:crypto";

export const OVERLAY_KINDS = ["goal", "stats", "timer"];
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
            run("INSERT INTO stream_overlays (token, user_id, kind, name, guild_id, config, value, created) VALUES (?,?,?,?,?,?,0,?)", token, String(userId), kind, text(name, kind === "goal" ? "Goal" : kind === "stats" ? "Server stats" : "Timer", 40), guildId, JSON.stringify(cleanConfig(kind, config)), now());
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
    return {};
}

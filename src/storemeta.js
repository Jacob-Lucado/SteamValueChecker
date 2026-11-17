// Two things worth knowing before you pay for a game, both read from Steam's own store tags: whether it is still in
// Early Access, and how well it plays with a controller. Cached for a week and shared by everyone. Any failure just
// leaves the line off, same as the other card facts.
import { fetchAppTags } from "./taste.js";

const KEEP_MS = 7 * 86400_000, MISS_MS = 3600_000;

/** Pulls the two facts out of Steam's tag lists. */
export function readTags(tags) {
    if (!tags) return null;
    const cats = (tags.cats ?? []).map(c => c.toLowerCase());
    const earlyAccess = (tags.genres ?? []).some(g => /^early access$/i.test(g));
    const controller = cats.some(c => /full controller support/.test(c)) ? "full" : cats.some(c => /partial controller support/.test(c)) ? "partial" : null;
    const vr = cats.some(c => /^vr only$/.test(c)) ? "only" : cats.some(c => /^vr (supported|support)$/.test(c)) ? "supported" : null;
    const has = re => cats.some(c => re.test(c));
    const modes = {
        online: has(/online co-op/), local: has(/shared\/split screen co-op|lan co-op|local co-op/),
        coop: has(/co-op/), pvp: has(/pvp/), multi: has(/multi-player|mmo/), remote: has(/remote play together/)
    };
    return Object.values(modes).some(Boolean) ? { earlyAccess, controller, vr, modes } : { earlyAccess, controller, vr };
}

export function createStoreMeta({ fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
    const mem = new Map();
    return {
        async meta(appid) {
            if (!Number.isInteger(appid) || appid <= 0 || !fetchImpl) return null;
            const hit = mem.get(appid);
            if (hit && now() - hit.at < (hit.v ? KEEP_MS : MISS_MS)) return hit.v;
            let v = null;
            try { v = readTags(await fetchAppTags(appid, fetchImpl)); } catch { /* optional */ }
            if (mem.size > 4000) mem.clear();
            mem.set(appid, { at: now(), v });
            return v;
        }
    };
}

export const earlyAccessLine = m => (m?.earlyAccess ? "🚧 **Early Access:** still in development, so it can change a lot, and the price may too." : null);
export const vrLine = m => (m?.vr === "only" ? "🥽 VR only: needs a VR headset" : m?.vr === "supported" ? "🥽 VR supported" : null);
/** Who can play with whom: "Co-op (online, local), PvP, Remote Play Together". Nothing for single-player games. */
export function modesLine(m) {
    const x = m?.modes;
    if (!x) return null;
    const parts = [];
    if (x.coop) { const how = [x.online && "online", x.local && "local"].filter(Boolean); parts.push(how.length ? `Co-op (${how.join(", ")})` : "Co-op"); }
    if (x.pvp) parts.push("PvP");
    if (!parts.length && x.multi) parts.push("Multiplayer");
    if (x.remote) parts.push("Remote Play Together");
    if (!parts.length) return null; // single-player is the norm, so it never gets a line
    return `👥 ${parts.join(", ")}`;
}
export const controllerLine = m => (m?.controller === "full" ? "🎮 Full controller support" : m?.controller === "partial" ? "🎮 Partial controller support" : null);

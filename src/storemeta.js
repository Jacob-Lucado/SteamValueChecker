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
    return { earlyAccess, controller };
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
export const controllerLine = m => (m?.controller === "full" ? "🎮 Full controller support" : m?.controller === "partial" ? "🎮 Partial controller support" : null);

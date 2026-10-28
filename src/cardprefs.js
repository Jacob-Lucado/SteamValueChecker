// What a member's shareable profile card shows: the gaming names they add, the colour, picture links and which stats.
// Kept as one small JSON blob per member so the website and /profilecard draw the same card.
import { UserError } from "./errors.js";

export const PLATFORMS = [
    ["steam", "Steam"], ["xbox", "Xbox"], ["playstation", "PlayStation"], ["nintendo", "Nintendo"], ["epic", "Epic Games"],
    ["gog", "GOG"], ["battlenet", "Battle.net"], ["ea", "EA app"], ["ubisoft", "Ubisoft Connect"], ["riot", "Riot Games"],
    ["itch", "itch.io"], ["roblox", "Roblox"], ["minecraft", "Minecraft"]
];
export const PLATFORM_LABEL = new Map(PLATFORMS);
export const THEMES = { steam: ["#1b2838", "#66c0f4"], night: ["#14151a", "#b388ff"], forest: ["#13241c", "#5fd38d"], sunset: ["#2a1620", "#ff9a62"] };
export const SHOW_KEYS = ["games", "finished", "hours", "saved", "streak", "badges", "genres"];
export const MAX_PLATFORMS = 13;
export const DEFAULT_SHOW = Object.fromEntries(SHOW_KEYS.map(k => [k, true]));

// Control and direction-override characters never belong in a name drawn on an image.
const tidy = s => String(s ?? "").replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩<>]/g, "").replace(/\s+/g, " ").trim();

export function okImageUrl(u) {
    if (!u) return false;
    try { const x = new URL(u); return x.protocol === "https:" && !x.username && !x.password && String(u).length <= 500; } catch { return false; }
}

/** Merge a partial update into the stored prefs. Only the keys that are present change. Throws UserError for bad input. */
export function mergePrefs(old = {}, patch = {}) {
    const out = { ...old };
    if (patch.platforms !== undefined) {
        if (!Array.isArray(patch.platforms)) throw new UserError("Send the platforms as a list.");
        const seen = new Map();
        for (const p of patch.platforms.slice(0, 40)) {
            const id = String(p?.id ?? "");
            const name = tidy(p?.name).slice(0, 40);
            if (!PLATFORM_LABEL.has(id)) throw new UserError("Pick a platform from the list.");
            if (!name) continue;
            seen.set(id, name);
        }
        out.platforms = [...seen].slice(0, MAX_PLATFORMS).map(([id, name]) => ({ id, name }));
    }
    if (patch.theme !== undefined) {
        if (!THEMES[patch.theme]) throw new UserError("Pick one of the card colours.");
        out.theme = patch.theme;
    }
    for (const k of ["avatar", "banner"]) {
        if (patch[k] === undefined) continue;
        const v = String(patch[k] ?? "").trim();
        if (v && !okImageUrl(v)) throw new UserError(`The ${k === "avatar" ? "picture" : "banner"} link must start with https://`);
        out[k] = v;
    }
    if (patch.show !== undefined) {
        if (!patch.show || typeof patch.show !== "object") throw new UserError("Send the stats to show as an object.");
        out.show = { ...DEFAULT_SHOW, ...(old.show ?? {}) };
        for (const k of SHOW_KEYS) if (typeof patch.show[k] === "boolean") out.show[k] = patch.show[k];
    }
    return out;
}

/** Prefs with every default filled in, ready to draw. */
export function viewPrefs(p = {}) {
    return {
        platforms: Array.isArray(p.platforms) ? p.platforms : [],
        theme: THEMES[p.theme] ? p.theme : "steam",
        avatar: okImageUrl(p.avatar) ? p.avatar : "",
        banner: okImageUrl(p.banner) ? p.banner : "",
        show: { ...DEFAULT_SHOW, ...(p.show ?? {}) }
    };
}

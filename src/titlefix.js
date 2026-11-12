// "When I type this, I mean that game." A member's own corrections for titles the value checker guessed wrong or
// couldn't find. Nothing is stored unless the member saves a correction, and it only ever applies to their own lookups.
import { normalize } from "./itad.js";

export class FixError extends Error {}

export const fixKey = typed => normalize(String(typed ?? "")).slice(0, 120);

/** Looks titles up, then swaps in the member's saved corrections. Same shape as itad.lookupTitles(). */
export async function lookupWithFixes({ itad, db, userId, titles }) {
    const fixes = userId ? new Map(db.listTitleFixes(userId).map(f => [f.key, f])) : new Map();
    if (!fixes.size) return itad.lookupTitles(titles);
    const fixed = t => fixes.get(fixKey(t));
    const rest = await itad.lookupTitles(titles.filter(t => !fixed(t)));
    const byTitle = new Map(rest.map(r => [r.title, r]));
    return titles.map(t => {
        const f = fixed(t);
        return f ? { title: t, id: f.itad_id, approx: true, exact: true, fixed: true, matched: f.title } : byTitle.get(t);
    });
}

/** Saves a correction. `game` is the right game's name or its Steam store link. Returns { typed, title }. */
export async function saveFix({ itad, db, userId, typed, game }) {
    const key = fixKey(typed);
    if (!key) throw new FixError("Type the title the way you entered it in the value checker.");
    const [hit] = await itad.lookupTitles([String(game ?? "").trim().slice(0, 300)]);
    if (!hit?.id) throw new FixError("I couldn't find that game either. Paste its Steam store link and I'll use that.");
    const title = hit.matched ?? hit.title;
    db.ensureUser(userId);
    if (!db.setTitleFix(userId, key, String(typed).trim().slice(0, 120), hit.id, title)) throw new FixError("You have saved 300 corrections, which is the limit. Remove one first.");
    return { typed: String(typed).trim().slice(0, 120), title };
}

export const forgetFix = ({ db, userId, typed }) => db.removeTitleFix(userId, fixKey(typed));

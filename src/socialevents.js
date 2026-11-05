// Feed events that need a little work to spot. Trophy tiers are recalculated from the library, so a member's tiers are
// compared against what the feed has already seen: the first look is recorded quietly, and a later tier-up posts.
import { trophyCase } from "./badges.js";

export function refreshTrophies(db, userId) {
    try { return db.trophyEvents(userId, trophyCase(db, userId).badges); } catch { return 0; }
}

/** The daily pass: everyone with a public page gets their trophies looked at, and old feed events are cleared. */
export function dailySocial(db) {
    let posted = 0;
    for (const id of db.publicProfileIds?.() ?? []) posted += refreshTrophies(db, id);
    db.pruneFeed();
    return posted;
}

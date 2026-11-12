// Steam Family: games someone in your family already owns are (mostly) yours to play too, so there is no point
// alerting you about a sale on them or counting them as new in a bundle. A member adds their family's public Steam
// profiles (`/me steam family`, or the dashboard's Steam page); the bot keeps each profile's list of app ids and
// refreshes it once a day. Steam has no public family API, which is why the profiles are added by hand.
import { UserError } from "./errors.js";
import { fetchOwnedGames, fetchProfileCard, resolveProfile } from "./steamlib.js";

export const MAX_FAMILY = 5; // a Steam Family is six people: you and five others
const DAY = 86400_000;

export const familySchema = `
CREATE TABLE IF NOT EXISTS family_members (discord_id TEXT NOT NULL, steamid TEXT NOT NULL, name TEXT, games INTEGER NOT NULL DEFAULT 0, synced_at INTEGER, added_at INTEGER NOT NULL, PRIMARY KEY (discord_id, steamid));
CREATE TABLE IF NOT EXISTS family_apps (discord_id TEXT NOT NULL, steamid TEXT NOT NULL, appid INTEGER NOT NULL, PRIMARY KEY (discord_id, steamid, appid));
CREATE INDEX IF NOT EXISTS family_apps_user ON family_apps(discord_id, appid);`;

export function familyStore({ db, run, get, all, now }) {
    const listFamily = userId => all("SELECT steamid, name, games, synced_at, added_at FROM family_members WHERE discord_id = ? ORDER BY added_at", userId);
    /** Saves (or refreshes) one family member and the games they own. */
    const saveFamilyMember = (userId, steamid, name, appids) => {
        const ids = [...new Set(appids.map(Number).filter(a => Number.isInteger(a) && a > 0))];
        db.exec("BEGIN");
        try {
            run("INSERT INTO family_members (discord_id, steamid, name, games, synced_at, added_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(discord_id, steamid) DO UPDATE SET name = COALESCE(excluded.name, name), games = excluded.games, synced_at = excluded.synced_at", userId, steamid, name ?? null, ids.length, now(), now());
            run("DELETE FROM family_apps WHERE discord_id = ? AND steamid = ?", userId, steamid);
            for (const a of ids) run("INSERT OR IGNORE INTO family_apps (discord_id, steamid, appid) VALUES (?, ?, ?)", userId, steamid, a);
            db.exec("COMMIT");
        } catch (err) { db.exec("ROLLBACK"); throw err; }
        return ids.length;
    };
    const removeFamilyMember = (userId, steamid) => { run("DELETE FROM family_apps WHERE discord_id = ? AND steamid = ?", userId, steamid); return run("DELETE FROM family_members WHERE discord_id = ? AND steamid = ?", userId, steamid).changes > 0; };
    const forgetFamily = userId => { run("DELETE FROM family_apps WHERE discord_id = ?", userId); run("DELETE FROM family_members WHERE discord_id = ?", userId); };
    /** Every app id someone in the member's family owns. */
    const familyAppIds = userId => new Set(all("SELECT DISTINCT appid FROM family_apps WHERE discord_id = ?", userId).map(r => r.appid));
    /** Wishlist games a family member already owns: their alerts are held. */
    const familyCovered = userId => all("SELECT i.title, i.appid, m.name, m.steamid FROM items i JOIN family_apps f ON f.discord_id = i.discord_id AND f.appid = i.appid JOIN family_members m ON m.discord_id = f.discord_id AND m.steamid = f.steamid WHERE i.discord_id = ? GROUP BY i.itad_id ORDER BY i.title COLLATE NOCASE", userId);
    const familyDue = (before, limit) => all("SELECT discord_id, steamid FROM family_members WHERE synced_at IS NULL OR synced_at < ? ORDER BY synced_at LIMIT ?", before, limit);
    const touchFamilyMember = (userId, steamid) => run("UPDATE family_members SET synced_at = ? WHERE discord_id = ? AND steamid = ?", now(), userId, steamid);
    return { listFamily, saveFamilyMember, removeFamilyMember, forgetFamily, familyAppIds, familyCovered, familyDue, touchFamilyMember };
}

/** Adds a family member by profile link, custom name or SteamID64. Their games must be public. Returns { steamid, name, games, covered }. */
export async function addFamily({ db, userId, input, apiKey = null, fetchImpl = globalThis.fetch }) {
    const steamid = await resolveProfile(input, fetchImpl);
    if (db.getSteamLink(userId)?.steamid === steamid) throw new UserError("That's your own profile. Add the other people in your Steam Family.");
    const have = db.listFamily(userId);
    if (!have.some(m => m.steamid === steamid) && have.length >= MAX_FAMILY) throw new UserError(`A Steam Family is you and ${MAX_FAMILY} others, and you've added ${MAX_FAMILY}. Remove one first.`);
    const games = await fetchOwnedGames(steamid, { apiKey, fetchImpl }); // throws a readable error for a private profile
    let name = null;
    try { name = (await fetchProfileCard(steamid, fetchImpl))?.name ?? null; } catch { /* the id is shown instead */ }
    const count = db.saveFamilyMember(userId, steamid, name, games.map(g => g.appid));
    return { steamid, name, games: count, covered: db.familyCovered(userId).length };
}

/** Removes a family member by the same kind of input, or by the name shown in the list. */
export async function removeFamily({ db, userId, input, fetchImpl = globalThis.fetch }) {
    const typed = String(input ?? "").trim();
    const byName = db.listFamily(userId).find(m => m.steamid === typed || (m.name && m.name.toLowerCase() === typed.toLowerCase()));
    const steamid = byName?.steamid ?? await resolveProfile(typed, fetchImpl);
    if (!db.removeFamilyMember(userId, steamid)) throw new UserError("That profile isn't in your family list.");
    return { steamid };
}

/** What the family list shows: the people, and the wishlist games they cover. */
export function familyView(db, userId) {
    const covered = db.familyCovered(userId);
    return {
        max: MAX_FAMILY,
        members: db.listFamily(userId).map(m => ({ steamid: m.steamid, name: m.name ?? m.steamid, games: m.games, synced_at: m.synced_at })),
        covered: covered.map(c => ({ title: c.title, appid: c.appid, owner: c.name ?? c.steamid }))
    };
}

export function familyEmbed(view) {
    const people = view.members.map(m => `**${m.name}** · ${m.games} games${m.synced_at ? ` · checked <t:${Math.floor(m.synced_at / 1000)}:R>` : ""}`);
    const held = view.covered.slice(0, 15).map(c => `${c.title} *(${c.owner})*`);
    return {
        color: 0x1b9aaa, title: "Your Steam Family",
        description: people.length ? people.join("\n") : "Nobody added yet. Add someone with `/me steam family add:` and a link to their Steam profile (their game details have to be public).",
        fields: view.covered.length ? [{ name: `Wishlist games your family already owns (${view.covered.length})`, value: (held.join("\n") + (view.covered.length > held.length ? `\n…and ${view.covered.length - held.length} more` : "")).slice(0, 1024) }] : [],
        footer: { text: "Sale alerts for those games are held, and bundle checks count them as owned. Most games can be shared in a family, but not all." }
    };
}

/** Library ids a bundle check should treat as owned: the member's own games plus anything their family has. */
export async function ownedWithFamily({ db, itad, userId, gameIds }) {
    const owned = new Set(db.listLibrary(userId).map(l => l.itad_id));
    let fam; try { fam = db.familyAppIds?.(userId); } catch { fam = null; }
    if (!fam?.size || !itad.steamAppIds) return owned;
    try { for (const [id, app] of await itad.steamAppIds(gameIds.filter(id => !owned.has(id)))) if (app && fam.has(app)) owned.add(id); } catch { /* the member's own games still count */ }
    return owned;
}

/** Refreshes the family lists that are a day old, a few per run. A profile that went private keeps its last list. */
export async function runFamilySync({ db, apiKey = null, fetchImpl = globalThis.fetch, now = Date.now(), max = 6, log = () => {} }) {
    let synced = 0, failed = 0;
    for (const m of db.familyDue(now - DAY, max)) {
        try {
            const games = await fetchOwnedGames(m.steamid, { apiKey, fetchImpl });
            db.saveFamilyMember(m.discord_id, m.steamid, null, games.map(g => g.appid));
            synced++;
        } catch (err) {
            failed++;
            db.touchFamilyMember(m.discord_id, m.steamid); // try again tomorrow, not every hour
            if (err?.code === "rate_limited") { log("Steam is rate limiting, stopping the family refresh for now"); break; }
        }
    }
    return { synced, failed };
}

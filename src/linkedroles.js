// Discord "Linked Roles": a member's Steam details appear on their Discord profile, and a server can make a role require them
// (Server Settings, Roles, the role, Links). The member proves the Steam account by signing in on Steam's own page.
export const METADATA = [
    { key: "steam_verified", name: "Steam Verified", description: "Signed in through Steam to prove the account is theirs", type: 7 },
    { key: "games_owned", name: "Games owned", description: "Steam games in their library (at least)", type: 2 },
    { key: "hours_played", name: "Hours played", description: "Total hours played on Steam (at least)", type: 2 }
];

/** What to show for this member. Only a verified Steam link counts as Steam Verified. */
export function connectionPayload(db, userId) {
    const link = db.getSteamLink(userId);
    if (!link) return null;
    const lib = db.listLibrary(userId);
    const games = lib.length, minutes = lib.reduce((n, g) => n + (Number(g.minutes) || 0), 0);
    return {
        platform_name: "Steam", platform_username: String(link.uname || "Steam player").slice(0, 100),
        metadata: { steam_verified: Boolean(link.verified), games_owned: games, hours_played: Math.round(minutes / 60) }
    };
}

/** Tells Discord about the conditions and the verification address. Never throws: a failure only means Linked Roles is not offered. */
export async function registerLinkedRoles(rest, publicUrl, log = () => {}) {
    try { await rest.registerRoleMetadata(METADATA); } catch (e) { log(`[linked roles] could not register conditions: ${e.status ?? e.message}`); return false; }
    if (publicUrl) { try { await rest.setVerificationUrl(`${publicUrl}/auth/linked`); } catch (e) { log(`[linked roles] could not set the verification address: ${e.status ?? e.message} (set it in the Developer Portal: Linked Roles Verification URL = ${publicUrl}/auth/linked)`); } }
    return true;
}

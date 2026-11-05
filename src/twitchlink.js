// A viewer's Twitch account tied to their Discord account, so "!enter" in a streamer's chat can enter the giveaway as them.
// The tie comes from Discord itself (the Twitch account shown in their Discord connections), so nobody can claim someone else's name.
export const twitchLinkSchema = `
CREATE TABLE IF NOT EXISTS twitch_link (
    discord_id TEXT PRIMARY KEY,
    twitch_id  TEXT NOT NULL UNIQUE,
    login      TEXT NOT NULL,
    at         INTEGER NOT NULL
);
`;

export function twitchLinkStore({ run, get, now }) {
    const row = r => r ? { discord_id: r.discord_id, twitch_id: r.twitch_id, login: r.login, at: r.at } : null;
    return {
        getTwitchLink: discordId => row(get("SELECT * FROM twitch_link WHERE discord_id = ?", String(discordId))),
        twitchLinkByTwitchId: twitchId => row(get("SELECT * FROM twitch_link WHERE twitch_id = ?", String(twitchId))),
        /** One Twitch account belongs to one Discord account: linking it again moves it. */
        setTwitchLink(discordId, { twitchId, login }) {
            run("DELETE FROM twitch_link WHERE twitch_id = ? AND discord_id <> ?", String(twitchId), String(discordId));
            run("INSERT INTO twitch_link (discord_id, twitch_id, login, at) VALUES (?,?,?,?) ON CONFLICT(discord_id) DO UPDATE SET twitch_id = excluded.twitch_id, login = excluded.login, at = excluded.at", String(discordId), String(twitchId), String(login).slice(0, 40), now());
        },
        removeTwitchLink: discordId => run("DELETE FROM twitch_link WHERE discord_id = ?", String(discordId)).changes > 0
    };
}

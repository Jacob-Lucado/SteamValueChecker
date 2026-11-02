// The private link a streamer pastes into OBS. One link per server; anyone who has it can see what is playing, nothing else.
import { randomBytes } from "node:crypto";

export const overlaySchema = `
CREATE TABLE IF NOT EXISTS music_overlay (
    guild_id TEXT PRIMARY KEY,
    token    TEXT NOT NULL UNIQUE,
    created  INTEGER NOT NULL
);
`;

export function overlayStore({ run, get, now }) {
    const newToken = () => "svco_" + randomBytes(24).toString("base64url");
    return {
        getOverlay: guildId => get("SELECT guild_id, token, created FROM music_overlay WHERE guild_id = ?", String(guildId)) ?? null,
        /** Makes the link, or replaces it with a new one (the old link stops working at once). */
        resetOverlay(guildId) {
            const token = newToken();
            run("INSERT INTO music_overlay (guild_id, token, created) VALUES (?,?,?) ON CONFLICT(guild_id) DO UPDATE SET token = excluded.token, created = excluded.created", String(guildId), token, now());
            return token;
        },
        removeOverlay: guildId => run("DELETE FROM music_overlay WHERE guild_id = ?", String(guildId)),
        guildForOverlay: token => /^svco_[A-Za-z0-9_-]{32}$/.test(String(token ?? "")) ? (get("SELECT guild_id FROM music_overlay WHERE token = ?", String(token))?.guild_id ?? null) : null
    };
}

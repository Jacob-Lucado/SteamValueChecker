// The private link a streamer pastes into OBS. Every person gets their own link for each server they stream from, so nobody shares a token and
// one person can reset theirs without breaking anyone else's. Anyone who has a link can see what is playing in that server, nothing else.
import { randomBytes } from "node:crypto";

export const overlaySchema = `
CREATE TABLE IF NOT EXISTS stream_overlay (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    token    TEXT NOT NULL UNIQUE,
    via      TEXT NOT NULL DEFAULT 'role',
    created  INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
);
`;

export function overlayStore({ run, get, all, now }) {
    const newToken = () => "svco_" + randomBytes(24).toString("base64url");
    return {
        getOverlay: (guildId, userId) => get("SELECT guild_id, user_id, token, via, created FROM stream_overlay WHERE guild_id = ? AND user_id = ?", String(guildId), String(userId)) ?? null,
        /** Makes this person's link, or replaces it with a new one (the old link stops working at once). `via` is how they got access: "manager", "owner" or "role". */
        resetOverlay(guildId, userId, via = "role") {
            const token = newToken();
            run("INSERT INTO stream_overlay (guild_id, user_id, token, via, created) VALUES (?,?,?,?,?) ON CONFLICT(guild_id, user_id) DO UPDATE SET token = excluded.token, via = excluded.via, created = excluded.created", String(guildId), String(userId), token, via, now());
            return token;
        },
        removeOverlay: (guildId, userId) => run("DELETE FROM stream_overlay WHERE guild_id = ? AND user_id = ?", String(guildId), String(userId)),
        /** Which server and person a link belongs to, or null. */
        overlayByToken: token => /^svco_[A-Za-z0-9_-]{32}$/.test(String(token ?? "")) ? (get("SELECT guild_id, user_id, via FROM stream_overlay WHERE token = ?", String(token)) ?? null) : null,
        /** Everyone's links in a server (never the tokens), so a manager can see who has one. */
        listOverlays: guildId => all("SELECT user_id, via, created FROM stream_overlay WHERE guild_id = ? ORDER BY created", String(guildId))
    };
}

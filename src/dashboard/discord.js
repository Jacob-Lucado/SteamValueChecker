// Discord REST calls used by the dashboard: OAuth2 login and the bot's channel access.
// The user's OAuth token is used once at login to read their identity and server list, then dropped.

const API = "https://discord.com/api/v10";

export class DiscordApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

export function createDiscordRest({ clientId, clientSecret, redirectUri, botToken, fetchImpl = globalThis.fetch }) {
    async function call(path, { method = "GET", headers = {}, body } = {}) {
        let res;
        try {
            res = await fetchImpl(`${API}${path}`, { method, headers, body, signal: AbortSignal.timeout(15000) });
        } catch {
            throw new DiscordApiError(0, "Could not reach Discord.");
        }
        if (!res.ok) throw new DiscordApiError(res.status, `Discord returned HTTP ${res.status}.`);
        return res.status === 204 ? null : res.json();
    }

    const bearer = token => ({ Authorization: `Bearer ${token}` });
    const bot = { Authorization: `Bot ${botToken}` };

    return {
        authorizeUrl(state) {
            const u = new URL("https://discord.com/oauth2/authorize");
            u.searchParams.set("client_id", clientId);
            u.searchParams.set("response_type", "code");
            u.searchParams.set("redirect_uri", redirectUri);
            u.searchParams.set("scope", "identify guilds");
            u.searchParams.set("state", state);
            u.searchParams.set("prompt", "none");
            return u.toString();
        },

        /** Code from the redirect -> { user, guilds }. The access token never leaves this function. */
        async login(code) {
            const form = new URLSearchParams({
                client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code",
                code, redirect_uri: redirectUri
            });
            const token = await call("/oauth2/token", {
                method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form
            });
            const [user, guilds] = await Promise.all([
                call("/users/@me", { headers: bearer(token.access_token) }),
                call("/users/@me/guilds", { headers: bearer(token.access_token) })
            ]);
            return { user, guilds };
        },

        /** Text and announcement channels of a server the bot is in. Throws DiscordApiError 403/404 otherwise. */
        async listChannels(guildId) {
            const all = await call(`/guilds/${encodeURIComponent(guildId)}/channels`, { headers: bot });
            return (Array.isArray(all) ? all : [])
                .filter(c => c.type === 0 || c.type === 5)
                .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
                .map(c => ({ id: c.id, name: c.name }));
        },

        /** Display name of a member of a server the bot is in, or null when unknown. */
        async memberName(guildId, userId) {
            try {
                const m = await call(`/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`, { headers: bot });
                return m?.nick || m?.user?.global_name || m?.user?.username || null;
            } catch { return null; }
        },

        async sendMessage(channelId, payload) {
            return call(`/channels/${encodeURIComponent(channelId)}/messages`, {
                method: "POST", headers: { ...bot, "Content-Type": "application/json" }, body: JSON.stringify(payload)
            });
        }
    };
}

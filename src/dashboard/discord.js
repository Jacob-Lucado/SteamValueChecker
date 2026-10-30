// Discord REST calls used by the dashboard: OAuth2 login and the bot's channel access.
// The user's OAuth token is used once at login to read their identity and server list, then dropped.

const API = "https://discord.com/api/v10";

export class DiscordApiError extends Error {
    constructor(status, message, detail = null) {
        super(message);
        this.status = status;
        this.detail = detail; // what Discord itself said, like "Missing Permissions (code 50013)"
    }
}

export function createDiscordRest({ clientId, clientSecret, redirectUri, botToken, fetchImpl = globalThis.fetch }) {
    async function call(path, { method = "GET", headers = {}, body } = {}, attempt = 0) {
        let res;
        try {
            res = await fetchImpl(`${API}${path}`, { method, headers, body, signal: AbortSignal.timeout(15000) });
        } catch {
            throw new DiscordApiError(0, "Could not reach Discord.");
        }
        if (res.status === 429 && attempt < 3) { // rate limited: wait the time Discord asks for, then try again
            let wait = Number(res.headers?.get?.("retry-after")) || 1;
            try { wait = Number((await res.json())?.retry_after) || wait; } catch { /* keep the header value */ }
            await new Promise(r => setTimeout(r, Math.min(10, wait) * 1000 + 50));
            return call(path, { method, headers, body }, attempt + 1);
        }
        if (!res.ok) {
            let detail = null;
            try { const j = await res.json(); detail = j?.message ? `${j.message}${j.code ? ` (code ${j.code})` : ""}` : null; } catch { /* no body */ }
            throw new DiscordApiError(res.status, `Discord returned HTTP ${res.status}.`, detail);
        }
        return res.status === 204 ? null : res.json();
    }

    const bearer = token => ({ Authorization: `Bearer ${token}` });
    const bot = { Authorization: `Bot ${botToken}` };
    /** Discord's audit log shows this text next to the action. */
    const audit = reason => (reason ? { "X-Audit-Log-Reason": encodeURIComponent(String(reason).slice(0, 400)) } : {});

    return {
        authorizeUrl(state, { linkedRoles = false } = {}) {
            const u = new URL("https://discord.com/oauth2/authorize");
            u.searchParams.set("client_id", clientId);
            u.searchParams.set("response_type", "code");
            u.searchParams.set("redirect_uri", redirectUri);
            u.searchParams.set("scope", linkedRoles ? "identify guilds role_connections.write" : "identify guilds");
            u.searchParams.set("state", state);
            u.searchParams.set("prompt", "none");
            return u.toString();
        },

        /** Code from the redirect -> { user, guilds }. The access token never leaves this function. */
        async login(code, { withToken = false } = {}) {
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
            return { user, guilds, ...(withToken ? { accessToken: token.access_token } : {}) };
        },

        /** Text and announcement channels of a server the bot is in. Throws DiscordApiError 403/404 otherwise. */
        async listChannels(guildId) {
            const all = await call(`/guilds/${encodeURIComponent(guildId)}/channels`, { headers: bot });
            return (Array.isArray(all) ? all : [])
                .filter(c => c.type === 0 || c.type === 5)
                .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
                .map(c => ({ id: c.id, name: c.name }));
        },

        /** Forum channels of a server the bot is in (for the feature requests forum). */
        async listForums(guildId) {
            const all = await call(`/guilds/${encodeURIComponent(guildId)}/channels`, { headers: bot });
            return (Array.isArray(all) ? all : []).filter(c => c.type === 15).map(c => ({ id: c.id, name: c.name }));
        },
        getChannel: channelId => call(`/channels/${encodeURIComponent(channelId)}`, { headers: bot }),
        /** A new post in a forum channel: { name, message: {...}, applied_tags }. */
        createForumPost: (channelId, body) => call(`/channels/${encodeURIComponent(channelId)}/threads`, { method: "POST", headers: { ...bot, "Content-Type": "application/json" }, body: JSON.stringify(body) }),

        /** Roles people can be given (not @everyone, not bot-managed roles). */
        async listRoles(guildId) {
            const all = await call(`/guilds/${encodeURIComponent(guildId)}/roles`, { headers: bot });
            return (Array.isArray(all) ? all : []).filter(r => r.id !== guildId && !r.managed).sort((a, b) => (b.position ?? 0) - (a.position ?? 0)).map(r => ({ id: r.id, name: r.name }));
        },

        /** Display name of a member of a server the bot is in, or null when unknown. */
        async memberName(guildId, userId) {
            try {
                const m = await call(`/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`, { headers: bot });
                return m?.nick || m?.user?.global_name || m?.user?.username || null;
            } catch { return null; }
        },

        async createChannel(guildId, body) {
            return call(`/guilds/${encodeURIComponent(guildId)}/channels`, { method: "POST", headers: { ...bot, "Content-Type": "application/json" }, body: JSON.stringify(body) });
        },

        /** Linked Roles: shows a member's Steam details on their Discord profile, so server roles can require them. Uses the member's own token, once. */
        setRoleConnection: (accessToken, body) => call(`/users/@me/applications/${encodeURIComponent(clientId)}/role-connection`, { method: "PUT", headers: { ...bearer(accessToken), "Content-Type": "application/json" }, body: JSON.stringify(body) }),
        /** The conditions a server can pick when it links a role to this bot. */
        registerRoleMetadata: list => call(`/applications/${encodeURIComponent(clientId)}/role-connections/metadata`, { method: "PUT", headers: { ...bot, "Content-Type": "application/json" }, body: JSON.stringify(list) }),
        /** The address Discord opens from a server's "Link a connection" button. */
        setVerificationUrl: url => call(`/applications/@me`, { method: "PATCH", headers: { ...bot, "Content-Type": "application/json" }, body: JSON.stringify({ role_connections_verification_url: url }) }),

        // ---- community setup: the bot's own permissions, so these only work in servers it is in ----
        allChannels: guildId => call(`/guilds/${encodeURIComponent(guildId)}/channels`, { headers: bot }),
        allRoles: guildId => call(`/guilds/${encodeURIComponent(guildId)}/roles`, { headers: bot }),
        getGuild: guildId => call(`/guilds/${encodeURIComponent(guildId)}?with_counts=true`, { headers: bot }),
        editChannel: (channelId, body) => call(`/channels/${encodeURIComponent(channelId)}`, { method: "PATCH", headers: { ...bot, "Content-Type": "application/json" }, body: JSON.stringify(body) }),
        deleteChannel: channelId => call(`/channels/${encodeURIComponent(channelId)}`, { method: "DELETE", headers: bot }),
        editRole: (guildId, roleId, body) => call(`/guilds/${encodeURIComponent(guildId)}/roles/${encodeURIComponent(roleId)}`, { method: "PATCH", headers: { ...bot, "Content-Type": "application/json" }, body: JSON.stringify(body) }),
        createRole: (guildId, body) => call(`/guilds/${encodeURIComponent(guildId)}/roles`, { method: "POST", headers: { ...bot, "Content-Type": "application/json" }, body: JSON.stringify(body) }),
        editGuild: (guildId, body) => call(`/guilds/${encodeURIComponent(guildId)}`, { method: "PATCH", headers: { ...bot, "Content-Type": "application/json" }, body: JSON.stringify(body) }),
        addRole: (guildId, userId, roleId) => call(`/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`, { method: "PUT", headers: bot }),
        removeRole: (guildId, userId, roleId) => call(`/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`, { method: "DELETE", headers: bot }),
        listEmojis: guildId => call(`/guilds/${encodeURIComponent(guildId)}/emojis`, { headers: bot }),
        createEmoji: (guildId, body) => call(`/guilds/${encodeURIComponent(guildId)}/emojis`, { method: "POST", headers: { ...bot, "Content-Type": "application/json" }, body: JSON.stringify(body) }),
        createInvite: (channelId, body) => call(`/channels/${encodeURIComponent(channelId)}/invites`, { method: "POST", headers: { ...bot, "Content-Type": "application/json" }, body: JSON.stringify(body) }),
        listInvites: guildId => call(`/guilds/${encodeURIComponent(guildId)}/invites`, { headers: bot }),
        editMessage: (channelId, messageId, payload) => call(`/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`, { method: "PATCH", headers: { ...bot, "Content-Type": "application/json" }, body: JSON.stringify(payload) }),

        // ---- moderation (the bot's own permissions) ----
        /** A server member, or null when they are not in the server. */
        async getMember(guildId, userId) {
            try { return await call(`/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`, { headers: bot }); }
            catch (e) { if (e?.status === 404) return null; throw e; }
        },
        /** Time a member out until an ISO date, or lift it with null. */
        timeoutMember: (guildId, userId, untilIso, reason) => call(`/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`, { method: "PATCH", headers: { ...bot, ...audit(reason), "Content-Type": "application/json" }, body: JSON.stringify({ communication_disabled_until: untilIso }) }),
        kickMember: (guildId, userId, reason) => call(`/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE", headers: { ...bot, ...audit(reason) } }),
        banMember: (guildId, userId, { deleteSeconds = 0, reason } = {}) => call(`/guilds/${encodeURIComponent(guildId)}/bans/${encodeURIComponent(userId)}`, { method: "PUT", headers: { ...bot, ...audit(reason), "Content-Type": "application/json" }, body: JSON.stringify({ delete_message_seconds: deleteSeconds }) }),
        unbanMember: (guildId, userId, reason) => call(`/guilds/${encodeURIComponent(guildId)}/bans/${encodeURIComponent(userId)}`, { method: "DELETE", headers: { ...bot, ...audit(reason) } }),
        getMessages: (channelId, limit = 100) => call(`/channels/${encodeURIComponent(channelId)}/messages?limit=${Math.min(100, Math.max(1, limit))}`, { headers: bot }),
        bulkDelete: (channelId, ids) => call(`/channels/${encodeURIComponent(channelId)}/messages/bulk-delete`, { method: "POST", headers: { ...bot, "Content-Type": "application/json" }, body: JSON.stringify({ messages: ids }) }),
        deleteMessage: (channelId, messageId) => call(`/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`, { method: "DELETE", headers: bot }),

        editMessage: (channelId, messageId, payload) => call(`/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`, { method: "PATCH", headers: { ...bot, "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
        async sendMessage(channelId, payload) {
            return call(`/channels/${encodeURIComponent(channelId)}/messages`, {
                method: "POST", headers: { ...bot, "Content-Type": "application/json" }, body: JSON.stringify(payload)
            });
        }
    };
}

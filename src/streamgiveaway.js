// A giveaway tied to a stream: the streamer hands over one key while live, the giveaway runs in the live channel, and it draws by itself
// when the stream ends (or when the time runs out, whichever comes first). It is the normal giveaway system underneath.
import { UserError } from "./errors.js";

const MAX_MIN = 720;

export function createStreamGiveaways({ db, giveaways, now = () => Date.now() }) {
    const svc = () => (typeof giveaways === "function" ? giveaways() : giveaways);
    const metaKey = (gid, uid) => `streamgw:${gid}:${uid}`;
    const active = (gid, uid) => {
        const id = Number(db.getMeta(metaKey(gid, uid)) ?? 0);
        const g = id ? db.getGiveaway(id) : null;
        return g && (g.status === "active" || g.status === "scheduled") ? g : null;
    };
    return {
        enabled: () => Boolean(svc()),
        active,
        /** Starts it. The caller has already checked they may stream here. */
        async start(guildId, who, { game, key, minutes = 60 }) {
            const gw = svc();
            if (!gw) throw new UserError("Giveaways aren't set up on this bot.");
            const c = db.getCommunity(guildId);
            if (!c.live_channel) throw new UserError("This server has no live channel yet. A manager can pick one with `/server stream setup`.");
            if (!db.getStreamLive(guildId, who.id)) throw new UserError("Go live first (`/server stream live`). The giveaway ends when your stream does.");
            if (active(guildId, who.id)) throw new UserError("You already have a stream giveaway running. It ends when your stream does.");
            const title = String(game ?? "").replace(/\s+/g, " ").trim().slice(0, 80), k = String(key ?? "").trim();
            if (!title) throw new UserError("Say which game the key is for.");
            if (k.length < 4 || k.length > 200) throw new UserError("That doesn't look like a game key.");
            const mins = Math.min(MAX_MIN, Math.max(5, Math.trunc(Number(minutes)) || 60));
            const r = await gw.create({
                guild_id: guildId, channel_id: c.live_channel, host_id: who.id, keys: [{ label: title, key: k, kind: "key" }], title: `${who.name || "A streamer"}'s stream giveaway: ${title}`,
                game_title: title, duration_ms: mins * 60_000, claim_hours: 24, host: { host_name: who.name ?? null }
            });
            db.setMeta(metaKey(guildId, who.id), String(r.id));
            return { id: r.id, channelId: c.live_channel, endsAt: now() + mins * 60_000 };
        },
        /** Called when a stream ends. Draws the winner right away. Never throws: ending a stream must not fail because of this. */
        async onEnd(guildId, userId) {
            try { const g = active(guildId, userId); if (g && svc()) await svc().end(g.id, { by: userId }); } catch { /* already over */ }
        }
    };
}
